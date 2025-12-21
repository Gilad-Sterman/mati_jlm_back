const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Download file from URL to temporary location
   */
  async downloadFile(fileUrl, fileName) {
    try {
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'stream'
      });

      // Create temp directory if it doesn't exist
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create unique filename
      const tempFileName = `${Date.now()}_${fileName}`;
      const tempFilePath = path.join(tempDir, tempFileName);

      // Save file
      const writer = fs.createWriteStream(tempFilePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(tempFilePath));
        writer.on('error', reject);
      });

    } catch (error) {
      console.error('Error downloading file:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Clean up temporary file
   */
  cleanupTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Error cleaning up temp file:', error);
    }
  }

  /**
   * Transcribe audio file using OpenAI Whisper
   */
  async transcribeAudio(fileUrl, fileName, options = {}) {

    let tempFilePath = null;

    try {
      // Download file to temp location
      tempFilePath = await this.downloadFile(fileUrl, fileName);

      // Check file size (Whisper has 25MB limit)
      const stats = fs.statSync(tempFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);

      console.log(`📁 File size: ${fileSizeInMB.toFixed(2)}MB`);

      // NEW: Simple size check - if > 10MB, use chunking (testing threshold)
      if (fileSizeInMB > 10) {
        console.log(`📦 Large file detected, using chunking...`);
        return await this.transcribeWithChunking(tempFilePath, fileName, options);
      }

      // Keep existing 25MB check for safety
      if (fileSizeInMB > 25) {
        throw new Error(`File size (${fileSizeInMB.toFixed(2)}MB) exceeds OpenAI's 25MB limit.`);
      }

      // Prepare transcription options
      const transcriptionOptions = {
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'verbose_json', // Get timestamps and other metadata
        ...options
      };

      // Add language if specified
      if (options.language) {
        transcriptionOptions.language = options.language;
      }

      const startTime = Date.now();

      // Call OpenAI Whisper API
      const response = await this.openai.audio.transcriptions.create(transcriptionOptions);

      const duration = Date.now() - startTime;

      // Return structured response
      return {
        text: response.text,
        language: response.language,
        duration: response.duration,
        segments: response.segments || [],
        metadata: {
          model: 'whisper-1',
          processing_time_ms: duration,
          file_size_mb: fileSizeInMB,
          transcribed_at: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error transcribing audio:', error);

      // Handle specific OpenAI errors
      if (error.code === 'invalid_request_error') {
        throw new Error(`OpenAI API Error: ${error.message}`);
      } else if (error.code === 'rate_limit_exceeded') {
        throw new Error('OpenAI rate limit exceeded. Please try again later.');
      } else if (error.code === 'insufficient_quota') {
        throw new Error('OpenAI quota exceeded. Please check your billing.');
      }

      throw new Error(`Transcription failed: ${error.message}`);

    } finally {
      // Always clean up temp file
      if (tempFilePath) {
        this.cleanupTempFile(tempFilePath);
      }
    }
  }

  /**
   * Transcribe large files using chunking (requires FFmpeg)
   */
  async transcribeWithChunking(filePath, fileName, options = {}) {
    const tempDir = path.join(process.cwd(), 'temp', `chunks_${Date.now()}`);
    
    try {
      // Check if FFmpeg is available
      await this.checkFFmpegAvailable();
      
      // Create temp directory
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      console.log(`📦 Splitting large file into chunks...`);
      
      // Split into chunks (simple approach)
      const chunks = await this.splitAudioSimple(filePath, tempDir);
      console.log(`📦 Created ${chunks.length} chunks`);
      
      // Transcribe chunks sequentially (simple, reliable)
      const transcripts = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(`🎵 Transcribing chunk ${i + 1}/${chunks.length}...`);
        
        try {
          const chunkResult = await this.transcribeSingleChunk(chunks[i]);
          transcripts.push(chunkResult);
        } catch (chunkError) {
          console.error(`❌ Chunk ${i + 1} failed:`, chunkError.message);
          // Continue with other chunks - don't fail entire process
          transcripts.push({ 
            text: `[Chunk ${i + 1} transcription failed]`,
            failed: true,
            chunkIndex: i + 1
          });
        }
      }
      
      // Simple merge - just concatenate text
      const successfulTranscripts = transcripts.filter(t => !t.failed);
      const mergedText = successfulTranscripts.map(t => t.text).join(' ');
      
      if (mergedText.length === 0) {
        throw new Error('All chunks failed transcription');
      }
      
      console.log(`✅ Successfully transcribed ${successfulTranscripts.length}/${chunks.length} chunks`);
      
      return {
        text: mergedText,
        language: successfulTranscripts[0]?.language || 'en',
        duration: null, // Keep simple for now
        segments: [], // Keep simple for now
        metadata: {
          chunked: true,
          totalChunks: chunks.length,
          successfulChunks: successfulTranscripts.length,
          failedChunks: transcripts.filter(t => t.failed).length,
          processing_method: 'chunked_transcription',
          transcribed_at: new Date().toISOString()
        }
      };
      
    } catch (error) {
      console.error(`❌ Chunked transcription failed:`, error.message);
      
      // Provide helpful error messages
      if (error.message.includes('FFmpeg')) {
        throw new Error('Large file processing requires FFmpeg. Please install FFmpeg: brew install ffmpeg');
      }
      
      throw error;
    } finally {
      // Cleanup temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * Check if FFmpeg is available on the system
   */
  async checkFFmpegAvailable() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error('FFmpeg not found. Please install FFmpeg.'));
        }
      });
      
      ffmpeg.on('error', (error) => {
        reject(new Error('FFmpeg not found. Please install FFmpeg.'));
      });
    });
  }

  /**
   * Simple FFmpeg splitting based on file size - target 5MB chunks
   */
  async splitAudioSimple(inputPath, outputDir) {
    const { spawn } = require('child_process');
    
    // Get file size and duration
    const stats = fs.statSync(inputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    const duration = await this.getAudioDuration(inputPath);
    
    // Calculate target chunk duration to get ~5MB chunks
    const targetChunkSizeMB = 5;
    const estimatedChunkDuration = (duration * targetChunkSizeMB) / fileSizeInMB;
    const chunkDuration = Math.max(estimatedChunkDuration, 60); // Minimum 1 minute chunks
    const numChunks = Math.ceil(duration / chunkDuration);
    
    console.log(`📊 File: ${fileSizeInMB.toFixed(1)}MB, ${Math.round(duration/60)} minutes`);
    console.log(`📦 Creating ${numChunks} chunks of ~${Math.round(chunkDuration/60)} minutes each (target: ${targetChunkSizeMB}MB per chunk)`);
    
    const chunks = [];
    
    for (let i = 0; i < numChunks; i++) {
      const startTime = i * chunkDuration;
      const outputPath = path.join(outputDir, `chunk_${String(i + 1).padStart(3, '0')}.mp3`);
      
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', inputPath,
          '-ss', startTime.toString(),
          '-t', chunkDuration.toString(),
          '-c', 'copy', // No re-encoding for speed
          '-avoid_negative_ts', 'make_zero',
          outputPath
        ]);
        
        ffmpeg.on('close', (code) => {
          if (code === 0) {
            // Check actual chunk size
            const chunkStats = fs.statSync(outputPath);
            const chunkSizeMB = chunkStats.size / (1024 * 1024);
            
            chunks.push({
              path: outputPath,
              index: i + 1,
              startTime,
              endTime: Math.min(startTime + chunkDuration, duration),
              sizeMB: chunkSizeMB
            });
            
            console.log(`✅ Chunk ${i + 1}: ${chunkSizeMB.toFixed(1)}MB`);
            resolve();
          } else {
            reject(new Error(`FFmpeg failed for chunk ${i + 1}`));
          }
        });
        
        ffmpeg.on('error', (error) => {
          reject(new Error(`FFmpeg error for chunk ${i + 1}: ${error.message}`));
        });
      });
    }
    
    return chunks;
  }

  /**
   * Get audio duration using FFprobe
   */
  async getAudioDuration(filePath) {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath
      ]);
      
      let output = '';
      ffprobe.stdout.on('data', (data) => output += data);
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(output);
            const duration = parseFloat(info.format.duration);
            resolve(duration);
          } catch (parseError) {
            reject(new Error('Failed to parse audio duration'));
          }
        } else {
          reject(new Error('Failed to get audio duration'));
        }
      });
      
      ffprobe.on('error', (error) => {
        reject(new Error(`FFprobe error: ${error.message}`));
      });
    });
  }

  /**
   * Transcribe a single chunk
   */
  async transcribeSingleChunk(chunk) {
    try {
      const transcriptionOptions = {
        file: fs.createReadStream(chunk.path),
        model: 'whisper-1',
        response_format: 'verbose_json'
      };
      
      const response = await this.openai.audio.transcriptions.create(transcriptionOptions);
      
      return {
        text: response.text,
        language: response.language,
        chunkIndex: chunk.index,
        startTime: chunk.startTime,
        endTime: chunk.endTime
      };
      
    } catch (error) {
      console.error(`❌ Chunk ${chunk.index} transcription failed:`, error.message);
      throw error;
    }
  }

  /**
   * Generate report using GPT based on transcript
   */
  async generateReport(transcript, reportType, options = {}) {
    try {
      const prompt = this.buildReportPrompt(transcript, reportType, options);

      const startTime = Date.now();

      const response = await this.openai.chat.completions.create({
        model: options.model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(reportType)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: options.max_tokens || 2000,
        temperature: options.temperature || 0.7
      });

      const duration = Date.now() - startTime;
      const rawContent = response.choices[0].message.content;

      // Sanitize JSON response to handle Hebrew quotes and other problematic characters
      const sanitizeJsonContent = (content) => {
        try {
          // First, try to parse as-is
          return JSON.parse(content);
        } catch (error) {
          console.log('⚠️ Initial JSON parse failed, attempting to sanitize...');
          
          // Sanitize common Hebrew quote issues
          let sanitized = content
            // Replace Hebrew quotes in common abbreviations
            .replace(/תב"ע/g, 'תב\\"ע')
            .replace(/ח"כ/g, 'ח\\"כ')
            .replace(/מ"מ/g, 'מ\\"מ')
            .replace(/ר"מ/g, 'ר\\"מ')
            .replace(/מ"ד/g, 'מ\\"ד')
            .replace(/ת"א/g, 'ת\\"א')
            .replace(/י"ש/g, 'י\\"ש')
            .replace(/ע"י/g, 'ע\\"י')
            .replace(/ב"כ/g, 'ב\\"כ')
            // Handle other unescaped quotes within Hebrew text (but not JSON structure quotes)
            .replace(/"([^"]*[\u0590-\u05FF][^"]*?)"/g, (match, hebrewText) => {
              // Only escape quotes that are inside Hebrew text, not JSON structure quotes
              const escapedText = hebrewText.replace(/"/g, '\\"');
              return `"${escapedText}"`;
            });
          
          try {
            return JSON.parse(sanitized);
          } catch (secondError) {
            console.log('⚠️ Sanitization failed, trying more aggressive approach...');
            
            // More aggressive sanitization - escape all unescaped quotes in string values
            sanitized = content.replace(/"([^"\\]*(\\.[^"\\]*)*?)"/g, (match, stringContent) => {
              // Don't touch JSON structure, only string content
              if (stringContent.includes(':') || stringContent.includes('{') || stringContent.includes('[')) {
                return match; // This is likely JSON structure, leave it alone
              }
              // Escape any unescaped quotes in the string content
              const escaped = stringContent.replace(/(?<!\\)"/g, '\\"');
              return `"${escaped}"`;
            });
            
            try {
              return JSON.parse(sanitized);
            } catch (finalError) {
              console.error('❌ All sanitization attempts failed');
              throw finalError;
            }
          }
        }
      };

      // Parse JSON response from OpenAI with sanitization
      let parsedContent;
      try {
        parsedContent = sanitizeJsonContent(rawContent);
        console.log('✅ Successfully parsed JSON response from OpenAI');
      } catch (parseError) {
        console.error('❌ Failed to parse JSON response from OpenAI:', parseError);
        console.log('Raw response:', rawContent);
        // Fallback: return raw content if JSON parsing fails
        parsedContent = { raw_content: rawContent, parse_error: true };
      }

      return {
        content: parsedContent,
        type: reportType,
        metadata: {
          model: options.model || 'gpt-4o-mini',
          processing_time_ms: duration,
          tokens_used: response.usage?.total_tokens || 0,
          generated_at: new Date().toISOString(),
          is_structured: !parsedContent.parse_error
        }
      };

    } catch (error) {
      console.error(`Error generating ${reportType} report:`, error);
      throw new Error(`Report generation failed: ${error.message}`);
    }
  }

  /**
   * Build prompt for report generation
   */
  buildReportPrompt(transcript, reportType, options = {}) {
    const { sessionContext, notes, language } = options;

    // Build session information section
    let sessionInfo = '';
    if (sessionContext) {
      const sessionDate = sessionContext.sessionDate ? new Date(sessionContext.sessionDate).toLocaleDateString('he-IL') : '[Insert Date]';
      const duration = sessionContext.duration ? `${Math.floor(sessionContext.duration / 60)}:${(sessionContext.duration % 60).toString().padStart(2, '0')}` : '[Unknown Duration]';

      sessionInfo = `
Session Information:
- Meeting Date: ${sessionDate}
- Client Name: ${sessionContext.clientName || '[Insert Client Name]'}
- Client Email: ${sessionContext.clientEmail || '[Not provided]'}
- Business Domain: ${sessionContext.businessDomain || '[Not specified]'}
- Adviser Name: ${sessionContext.adviserName || '[Insert Adviser Name]'}
- Adviser Email: ${sessionContext.adviserEmail || '[Insert Adviser Email]'}
- Session Title: ${sessionContext.sessionTitle || '[Insert Session Title]'}
- Meeting Duration: ${duration}
- Audio File: ${sessionContext.fileName || '[Insert File Name]'}

`;
    }

    // Build notes section if provided
    let notesSection = '';
    if (notes && notes.trim()) {
      notesSection = `
SPECIAL INSTRUCTIONS FROM ADVISER:
${notes.trim()}

IMPORTANT: Please take these instructions into account when generating the report.
CRITICAL LANGUAGE REQUIREMENT: Unless the instructions above specifically request a different language, analyze the actual conversation content in the transcript and generate ALL report content in the SAME language as the conversation. If the conversation is in Hebrew, write ALL content in Hebrew. If the conversation is in English, write ALL content in English. IGNORE session metadata language - only follow the transcript conversation language.

`;
    } else {
      // Even without notes, add language preservation instruction
      const languageInstruction = language ?
        `DETECTED TRANSCRIPT LANGUAGE: ${language.toUpperCase()}` :
        'ANALYZE the transcript language carefully - look at the actual conversation content, not the session metadata';

      notesSection = `
CRITICAL LANGUAGE REQUIREMENT: 
- ${languageInstruction}
- If the transcript conversation is in Hebrew, generate ALL report content in Hebrew
- If the transcript conversation is in English, generate ALL report content in English
- IGNORE the language of session metadata (client names, session titles, etc.) - only follow the transcript language
- The field names in JSON must remain in English, but ALL content values must match the transcript language

`;
    }

    const basePrompt = `Please analyze the following transcript and generate a comprehensive ${reportType} report.

${sessionInfo}${notesSection}Transcript:
${transcript}


IMPORTANT ANALYSIS INSTRUCTIONS:
- CRITICAL LANGUAGE RULE: Analyze the actual conversation content in the transcript (not session metadata like names/titles). Generate ALL report content values in the SAME language as the conversation. Hebrew conversation = Hebrew content. English conversation = English content. JSON field names stay English.
- CRITICAL: Respond ONLY with valid JSON. Do not include any markdown formatting, explanatory text, or content outside the JSON object.
- Use the actual session information provided above instead of placeholders. Replace any [Insert X] placeholders with the real data provided.
- Carefully read through the transcript to identify different speakers based on context clues, names mentioned, and conversation flow
- Look for patterns like "Tony said", "Carrie responded", or changes in speaking style/topic that indicate different speakers
- If the transcript lacks clear speaker identification, do your best to infer from context but acknowledge the limitation
- Pay attention to who is asking questions vs. providing answers, as this often indicates different roles
- Note if this appears to be a monologue, dialogue, or multi-participant meeting

`;

    if (reportType === 'adviser' || reportType === 'advisor') {
      return basePrompt + `
Generate a structured advisor report with conversation analysis and performance metrics - this report is meant to provide insight about the adviser performance to help the adviser improve their performance:

## ADVISOR REPORT STRUCTURE

The report should contain 5 main sections with the following structure:

### 1. TOPICS COVERED
- topics: Array of main topics discussed in the conversation, where each topic includes:
  * topic: Main topic name/title
  * sub_topics: Array of related sub-topics that fall under this main topic
  * time_percentage: Estimated percentage of conversation time spent on this topic and its sub-topics

### 2. GENERAL PERFORMANCE
- topics_covered: Object containing breakdown of conversation time spent on different phases:
  * introducing_advisor_percentage: Percentage of time spent introducing the advisor
  * introducing_mati_percentage: Percentage of time spent introducing MATI (the advisor's company)
  * opening_percentage: Percentage of time spent on opening/rapport building
  * collecting_info_percentage: Percentage of time spent collecting information about the client
  * actual_content_percentage: Percentage of time spent on actual consulting/advice content
  
- client_readiness_score: Score from 0-100 based on these specific criteria:
  * Business maturity and clarity of needs (25 points)
  * Engagement level and active participation (25 points)
  * Receptiveness to advice and solutions (25 points)
  * Expressed interest in continuing the process (25 points)

### 3. ADVISOR QUALITY METRICS
This section should contain 3 subsections, each with score (0-5), description, and supporting quote:

- listening: Object containing:
  * score: Rating from 0-5 stars
  * description: Analysis of the advisor's ability to ask good questions, build trust, and get the entrepreneur to share challenges, needs, and opportunities in their business. Focus on listening approach and engagement techniques.
  * supporting_quote: Specific quote from the transcript that demonstrates this skill
  
- clarity: Object containing:
  * score: Rating from 0-5 stars
  * description: Analysis of the advisor's ability to reflect, frame, and map where the entrepreneur is in a non-judgmental way, and create insights and understanding for effective and practical action directions for the entrepreneur and business growth.
  * supporting_quote: Specific quote from the transcript that demonstrates this skill
  
- continuation: Object containing:
  * score: Rating from 0-5 stars
  * description: Analysis of the advisor's success in finding the right words to describe MATI's relevant services and their value for this specific entrepreneur and their needs, using the entrepreneur's own language and words to motivate them to action, consume services, and continue collaboration with MATI.
  * supporting_quote: Specific quote from the transcript that demonstrates this skill

### 4. THINGS TO PRESERVE
- things_to_preserve: Array of positive aspects the advisor did well, where each item includes:
  * title: Brief title of the positive point
  * description: Detailed explanation of what the advisor did well, based on evidence from the conversation

### 5. NEEDS IMPROVEMENT
- needs_improvement: Array of areas where the advisor could improve, where each item includes:
  * title: Brief title of the improvement area
  * description: Detailed explanation of what could be improved and constructive suggestions

## ANALYSIS INSTRUCTIONS:
- For topics section, identify 3-7 main topics discussed and group related sub-topics under each main topic
- Estimate time percentages for each topic based on conversation flow and depth of discussion
- Calculate percentage breakdowns based on actual conversation flow and time spent on each phase
- Analyze the full transcript to understand conversation structure and phases
- For the quality metrics (Listening, Clarity, Continuation), provide honest scores from 0-5 based on evidence
- Select the MOST relevant and representative quotes that best demonstrate each quality metric
- Quotes should be substantial enough to show context (not just one word)
- For client readiness score, evaluate each criterion objectively and sum the points (each criterion worth 25 points)
- Base all scores and feedback on evidence from the conversation, not assumptions
- Provide specific examples to justify all scoring decisions
- Focus on actionable, constructive feedback for advisor improvement
- In "Things to Preserve" section, highlight 3-5 specific strengths with concrete examples
- In "Needs Improvement" section, provide 3-5 specific areas with constructive suggestions
- This report serves as an internal evaluation document for advisor development

CRITICAL: Generate all content values in the same language as the transcript, but use English field names in the JSON structure.`;
    } else if (reportType === 'client') {
      return basePrompt + `
Generate a client report based directly on the transcript content - this report will be sent to the client so the tone should always be positive and helpful:

## CLIENT REPORT STRUCTURE
Extract the following information directly from the transcript:

### General Summary
- general_summary: A comprehensive summary of the conversation and the client's business in general. This should provide an overview of what was discussed, the client's business context, and the main topics covered during the meeting.

### Target Summary
- target_summary: A concise summary of the key insights and action items without any quotes. This should be a brief, actionable overview that synthesizes the main takeaways and next steps in clear, direct language.

### Key Insights (3-5 insights)
- key_insights: Array of 3-5 key insights from the meeting, where each insight must include:
  - category: Must be exactly one of these predetermined categories:
    * "what we learned about the clients business"
    * "decisions made"
    * "opportunities/risks or concerns that came up"
  - content: The actual insight content extracted from the transcript
  - supporting_quotes: Array of direct quotes from the conversation that support this insight

### Action Items
- action_items: Array of concrete action items discussed in the meeting, where each action item must include:
  - task: Description of the task to be completed
  - owner: Who is responsible - must be one of: "client", "adviser", or specify other entity name
  - deadline: When the task should be completed (extract from transcript or use null if not specified)
  - status: Current status - must be one of: "open", "in progress", "completed"

## EXTRACTION INSTRUCTIONS:
- Extract information STRICTLY from the transcript - do not infer, speculate, or add information not explicitly present
- Use actual quotes from the conversation to support insights
- For action items, only include tasks that were explicitly discussed or agreed upon
- If specific information is not available in the transcript, use null for that field
- If no insights or action items are found, return empty arrays []
- Maintain the original meaning and context of statements
- Use clear, professional language suitable for client delivery
- Categories must match exactly as specified above
- Owner field should be specific - use actual names when mentioned or "client"/"adviser" as appropriate

CRITICAL LANGUAGE REQUIREMENT FOR CLIENT REPORT:
- ANALYZE the actual conversation content in the transcript to determine language
- IGNORE session metadata language (client names, session titles, etc.)
- If the conversation is in Hebrew, generate ALL content values in Hebrew
- If the conversation is in English, generate ALL content values in English
- JSON field names must remain in English for parsing
- ALL content, insights, quotes, and action items must match the conversation language exactly

Generate all content in the same language as the transcript, but use English field names in the JSON structure.`;
    }

    return basePrompt;
  }

  /**
   * Get system prompt based on report type
   */
  getSystemPrompt(reportType) {
    const baseSystem = "You are an AI assistant specialized in analyzing business conversations and generating professional reports. You can handle various types of audio content including meetings, consultations, presentations, and monologues. Always use the actual session information provided (client names, adviser names, dates, etc.) instead of generic placeholders like [Insert Name] or [Insert Date]. Be adaptive to the content type and provide valuable insights regardless of the conversation format. COMPANY CONTEXT: MATI JLM (מט״י ירושלים) stands for מרכז טיפוח יזמות (Center for Entrepreneurship Development) and is the organization that employs all the advisers conducting these business consultations. When referencing the organization, use the correct spelling: MATI JLM or מט״י ירושלים. CRITICAL LANGUAGE RULE: Analyze the actual conversation language in the transcript content (ignore session metadata language). If the conversation is in Hebrew, generate ALL content values in Hebrew. If the conversation is in English, generate ALL content values in English. JSON field names must remain in English, but content values must match the conversation language exactly. IMPORTANT: You must respond with a valid JSON object only - no markdown, no additional text, just pure JSON.";

    if (reportType === 'adviser' || reportType === 'advisor') {
      return baseSystem + " Generate advisor reports with conversation analysis and performance evaluation. Include specific client details and personalize the report with actual names and information provided. The report should contain 5 main sections with comprehensive analysis. Return the response as a JSON object with the following structure: {\"topics\": [{\"topic\": \"string\", \"sub_topics\": [\"array of strings\"], \"time_percentage\": \"number\"}], \"topics_covered\": {\"introducing_advisor_percentage\": \"number\", \"introducing_mati_percentage\": \"number\", \"opening_percentage\": \"number\", \"collecting_info_percentage\": \"number\", \"actual_content_percentage\": \"number\"}, \"client_readiness_score\": \"number (0-100)\", \"listening\": {\"score\": \"number (0-5)\", \"description\": \"string\", \"supporting_quote\": \"string\"}, \"clarity\": {\"score\": \"number (0-5)\", \"description\": \"string\", \"supporting_quote\": \"string\"}, \"continuation\": {\"score\": \"number (0-5)\", \"description\": \"string\", \"supporting_quote\": \"string\"}, \"things_to_preserve\": [{\"title\": \"string\", \"description\": \"string\"}], \"needs_improvement\": [{\"title\": \"string\", \"description\": \"string\"}]}";
    } else if (reportType === 'client') {
      return baseSystem + " Generate client reports by extracting information directly from the transcript. Include specific client details and personalize the report with actual names and information provided. Focus STRICTLY on concrete information present in the conversation - do not infer or speculate. Return the response as a JSON object with the following structure: {\"general_summary\": \"string (comprehensive summary of conversation and client's business)\", \"target_summary\": \"string (concise summary of key insights and actions without quotes)\", \"key_insights\": [{\"category\": \"string (must be exactly one of: 'what we learned about the clients business', 'decisions made', 'opportunities/risks or concerns that came up')\", \"content\": \"string\", \"supporting_quotes\": [\"array of direct quotes\"]}], \"action_items\": [{\"task\": \"string\", \"owner\": \"string (client/adviser/other entity name)\", \"deadline\": \"string or null\", \"status\": \"string (open/in progress/completed)\"}]}";
    }

    return baseSystem;
  }

  /**
   * Check if OpenAI API key is configured or if we're in mock mode
   */
  isConfigured() {
    return !!process.env.OPENAI_API_KEY || this.isMockMode();
  }

  /**
   * Check if we're in mock mode
   */
  isMockMode() {
    return process.env.OPENAI_MOCK_MODE === 'true';
  }

  /**
   * Test OpenAI connection (or mock)
   */
  async testConnection() {
    if (this.isMockMode()) {
      console.log('🎭 MOCK: Testing connection...');
      return {
        success: true,
        models: 5,
        mock_mode: true
      };
    }

    try {
      const response = await this.openai.models.list();
      return {
        success: true,
        models: response.data.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new OpenAIService();
