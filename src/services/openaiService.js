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
        this.cleanupTempFileSafe(tempFilePath);
      }
      
      // Periodic cleanup of old temp files
      await this.cleanupTempFiles();
    }
  }

  /**
   * Transcribe large files using chunking (requires FFmpeg)
   */
  async transcribeWithChunking(filePath, fileName, options = {}) {
    const tempDir = path.join(process.cwd(), 'temp', `chunks_${Date.now()}`);
    const { sessionId, socketService } = options;
    
    try {
      // Check if FFmpeg is available
      await this.checkFFmpegAvailable();
      
      // Create temp directory
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      console.log(`📦 Splitting large file into chunks...`);
      
      // Emit chunking started event
      if (sessionId && socketService) {
        socketService.sendToSession(sessionId, 'transcription_chunking_started', {
          sessionId,
          fileName,
          messageKey: 'chunkingStarted'
        });
      }
      
      // Split into chunks (simple approach)
      const chunks = await this.splitAudioSimple(filePath, tempDir);
      console.log(`📦 Created ${chunks.length} chunks`);
      
      // Emit chunks created event
      if (sessionId && socketService) {
        socketService.sendToSession(sessionId, 'transcription_chunks_created', {
          sessionId,
          totalChunks: chunks.length,
          messageKey: 'chunksCreated'
        });
      }
      
      // Transcribe chunks sequentially (simple, reliable)
      const transcripts = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(`🎵 Transcribing chunk ${i + 1}/${chunks.length}...`);
        
        // Emit chunk progress event
        if (sessionId && socketService) {
          socketService.sendToSession(sessionId, 'transcription_chunk_progress', {
            sessionId,
            currentChunk: i + 1,
            totalChunks: chunks.length,
            progress: Math.round(((i) / chunks.length) * 100),
            messageKey: 'chunkProgress'
          });
        }
        
        try {
          const chunkResult = await this.transcribeSingleChunk(chunks[i]);
          transcripts.push(chunkResult);
          
          // Emit chunk completed event
          if (sessionId && socketService) {
            socketService.sendToSession(sessionId, 'transcription_chunk_completed', {
              sessionId,
              chunkIndex: i + 1,
              totalChunks: chunks.length,
              progress: Math.round(((i + 1) / chunks.length) * 100),
              messageKey: 'chunkCompleted'
            });
          }
        } catch (chunkError) {
          console.error(`❌ Chunk ${i + 1} failed:`, chunkError.message);
          
          // Emit chunk failed event
          if (sessionId && socketService) {
            socketService.sendToSession(sessionId, 'transcription_chunk_failed', {
              sessionId,
              chunkIndex: i + 1,
              totalChunks: chunks.length,
              error: chunkError.message,
              messageKey: 'chunkFailed'
            });
          }
          
          // Continue with other chunks - don't fail entire process
          transcripts.push({ 
            text: `[Chunk ${i + 1} transcription failed]`,
            failed: true,
            chunkIndex: i + 1
          });
        }
      }
      
      // Memory-optimized merge - avoid large string concatenation
      const successfulTranscripts = transcripts.filter(t => !t.failed);
      
      if (successfulTranscripts.length === 0) {
        throw new Error('All chunks failed transcription');
      }
      
      // Use streaming approach for large transcripts
      const mergedText = this.mergeTranscriptsMemoryOptimized(successfulTranscripts);
      
      console.log(`✅ Successfully transcribed ${successfulTranscripts.length}/${chunks.length} chunks`);
      
      // Emit chunking completed event
      if (sessionId && socketService) {
        socketService.sendToSession(sessionId, 'transcription_chunking_completed', {
          sessionId,
          totalChunks: chunks.length,
          successfulChunks: successfulTranscripts.length,
          failedChunks: transcripts.filter(t => t.failed).length,
          messageKey: 'chunkingCompleted'
        });
      }
      
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
      // Clean up temp directory with improved error handling
      this.cleanupTempFileSafe(tempDir);
      
      // Periodic cleanup of old temp files
      await this.cleanupTempFiles();
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
   * Generate report from transcript using OpenAI with memory optimization
   */
  async generateReport(transcript, reportType = 'advisor', options = {}) {
    // Check if transcript is too large and needs chunking
    const transcriptLength = transcript.length;
    const TOKEN_LIMIT = 5000; // Very low threshold for testing chunked processing (was 20000)
    const CHARS_PER_TOKEN = 4; // Rough estimate
    
    console.log(`📊 Transcript length: ${transcriptLength} chars, threshold: ${TOKEN_LIMIT * CHARS_PER_TOKEN} chars`);
    
    if (transcriptLength > TOKEN_LIMIT * CHARS_PER_TOKEN) {
      console.log(`📊 Large transcript detected (${transcriptLength} chars), using chunked processing...`);
      return await this.generateReportChunked(transcript, reportType, options);
    }
    
    console.log(`📊 Using direct processing for transcript (${transcriptLength} chars)`);
    return await this.generateReportDirect(transcript, reportType, options);
  }

  /**
   * Direct report generation for smaller transcripts
   */
  async generateReportDirect(transcript, reportType = 'advisor', options = {}) {
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
          console.log('Error position:', error.message.match(/position (\d+)/)?.[1] || 'unknown');
          
          // Step 1: Fix common Hebrew abbreviations with quotes
          let sanitized = content
            .replace(/תב"ע/g, 'תב\\"ע')
            .replace(/ח"כ/g, 'ח\\"כ')
            .replace(/מ"מ/g, 'מ\\"מ')
            .replace(/ר"מ/g, 'ר\\"מ')
            .replace(/מ"ד/g, 'מ\\"ד')
            .replace(/ת"א/g, 'ת\\"א')
            .replace(/י"ש/g, 'י\\"ש')
            .replace(/ע"י/g, 'ע\\"י')
            .replace(/ב"כ/g, 'ב\\"כ')
            .replace(/נדל"ן/g, 'נדל\\"ן')
            .replace(/הדריכלות/g, 'האדריכלות'); // Fix typo that might cause issues
          
          try {
            return JSON.parse(sanitized);
          } catch (secondError) {
            console.log('⚠️ Basic sanitization failed, trying advanced approach...');
            
            // Step 2: More comprehensive quote handling
            // Find and fix unescaped quotes within string values
            sanitized = sanitized.replace(/"([^"]*(?:\\.[^"]*)*)"/g, (match, content) => {
              // Skip if this looks like a JSON key or structure
              if (content.match(/^\s*[\{\[\]\}]/) || content.includes('":')) {
                return match;
              }
              
              // Escape unescaped quotes within the string content
              const fixed = content.replace(/(?<!\\)"/g, '\\"');
              return `"${fixed}"`;
            });
            
            try {
              return JSON.parse(sanitized);
            } catch (thirdError) {
              console.log('⚠️ Advanced sanitization failed, trying final approach...');
              
              // Step 3: Last resort - fix malformed JSON structure
              sanitized = sanitized
                // Fix missing commas before closing braces/brackets
                .replace(/"\s*\n\s*}/g, '"\n}')
                .replace(/"\s*\n\s*]/g, '"\n]')
                // Fix trailing commas
                .replace(/,(\s*[}\]])/g, '$1')
                // Fix double quotes in Hebrew text more aggressively
                .replace(/:\s*"([^"]*)"([^",\]\}]*)"([^",\]\}]*?)"/g, (match, p1, p2, p3) => {
                  return `: "${p1}\\"${p2}\\"${p3}"`;
                });
              
              try {
                return JSON.parse(sanitized);
              } catch (finalError) {
                console.error('❌ All sanitization attempts failed');
                console.log('Final sanitized content:', sanitized.substring(0, 500) + '...');
                throw finalError;
              }
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
   * Generate report for large transcripts using chunked processing
   */
  async generateReportChunked(transcript, reportType = 'advisor', options = {}) {
    try {
      console.log(`📊 Processing large transcript (${transcript.length} chars) in chunks...`);
      
      // Split transcript into manageable chunks
      const chunks = this.splitTranscriptIntoChunks(transcript);
      console.log(`📦 Split into ${chunks.length} chunks`);
      
      // Process each chunk to create summaries
      const chunkSummaries = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(`🔄 Processing chunk ${i + 1}/${chunks.length}...`);
        
        const summary = await this.summarizeChunk(chunks[i], reportType, options);
        chunkSummaries.push(summary);
        
        // Small delay to avoid rate limiting
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Combine summaries into final report
      console.log(`🔗 Combining ${chunkSummaries.length} chunk summaries...`);
      const finalReport = await this.combineChunkSummaries(chunkSummaries, reportType, options);
      
      return finalReport;
      
    } catch (error) {
      console.error('Error in chunked report generation:', error);
      throw new Error(`Chunked report generation failed: ${error.message}`);
    }
  }

  /**
   * Split transcript into token-aware chunks
   */
  splitTranscriptIntoChunks(transcript) {
    const CHUNK_SIZE = 15000; // Smaller chunks for better processing (~3.75k tokens)
    const chunks = [];
    
    // Split by sentences to maintain context
    const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    for (const sentence of sentences) {
      const potentialChunk = currentChunk + sentence + '. ';
      
      if (potentialChunk.length > CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence + '. ';
      } else {
        currentChunk = potentialChunk;
      }
    }
    
    // Add the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    // Ensure we have at least 2 chunks for testing if transcript is large enough
    if (chunks.length === 1 && transcript.length > 20000) {
      const midPoint = Math.floor(transcript.length / 2);
      const firstHalf = transcript.substring(0, midPoint);
      const secondHalf = transcript.substring(midPoint);
      return [firstHalf, secondHalf];
    }
    
    return chunks;
  }

  /**
   * Summarize a single chunk of transcript
   */
  async summarizeChunk(chunk, reportType, options = {}) {
    const summaryPrompt = `Please analyze this portion of a business consultation meeting and extract key insights:

TRANSCRIPT SEGMENT:
${chunk}

Please provide a concise summary focusing on:
1. Key business topics discussed
2. Important decisions or recommendations
3. Client concerns or questions
4. Advisor guidance provided

Respond in JSON format:
{
  "key_topics": ["topic1", "topic2"],
  "decisions": ["decision1", "decision2"],
  "client_concerns": ["concern1", "concern2"],
  "advisor_guidance": ["guidance1", "guidance2"],
  "summary": "Brief overall summary"
}`;

    const response = await this.openai.chat.completions.create({
      model: options.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert business consultant analyzer. Provide structured summaries in JSON format.'
        },
        {
          role: 'user',
          content: summaryPrompt
        }
      ],
      max_tokens: 800,
      temperature: 0.3
    });

    const rawContent = response.choices[0].message.content;
    
    try {
      return JSON.parse(rawContent);
    } catch (parseError) {
      console.warn('Failed to parse chunk summary JSON, attempting to fix...');
      console.log('Raw chunk response:', rawContent.substring(0, 200) + '...');
      
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = rawContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (secondError) {
          console.warn('Failed to parse extracted JSON from markdown');
        }
      }
      
      // Try basic cleanup
      let cleaned = rawContent
        .replace(/```json\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      
      try {
        return JSON.parse(cleaned);
      } catch (thirdError) {
        console.warn('All chunk JSON parsing attempts failed, using fallback');
        
        // Extract key information using regex as fallback
        const extractArrayFromText = (text, pattern) => {
          const matches = text.match(pattern);
          return matches ? matches.slice(1).filter(Boolean) : [];
        };
        
        return {
          summary: rawContent.replace(/[{}"\[\]]/g, '').substring(0, 200),
          key_topics: extractArrayFromText(rawContent, /"key_topics":\s*\[(.*?)\]/s),
          decisions: extractArrayFromText(rawContent, /"decisions":\s*\[(.*?)\]/s),
          client_concerns: extractArrayFromText(rawContent, /"client_concerns":\s*\[(.*?)\]/s),
          advisor_guidance: extractArrayFromText(rawContent, /"advisor_guidance":\s*\[(.*?)\]/s)
        };
      }
    }
  }

  /**
   * Combine chunk summaries into final report
   */
  async combineChunkSummaries(summaries, reportType, options = {}) {
    // Aggregate all insights from chunks
    const aggregated = {
      key_topics: [],
      decisions: [],
      client_concerns: [],
      advisor_guidance: [],
      summaries: []
    };

    summaries.forEach(summary => {
      if (summary.key_topics) aggregated.key_topics.push(...summary.key_topics);
      if (summary.decisions) aggregated.decisions.push(...summary.decisions);
      if (summary.client_concerns) aggregated.client_concerns.push(...summary.client_concerns);
      if (summary.advisor_guidance) aggregated.advisor_guidance.push(...summary.advisor_guidance);
      if (summary.summary) aggregated.summaries.push(summary.summary);
    });

    // Create final report prompt with aggregated data
    const finalPrompt = this.buildReportPromptFromSummaries(aggregated, reportType, options);

    const response = await this.openai.chat.completions.create({
      model: options.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(reportType)
        },
        {
          role: 'user',
          content: finalPrompt
        }
      ],
      max_tokens: options.max_tokens || 2000,
      temperature: options.temperature || 0.7
    });

    const rawContent = response.choices[0].message.content;
    let parsedContent;

    try {
      parsedContent = JSON.parse(rawContent);
    } catch (parseError) {
      console.warn('Failed to parse final report JSON, using raw content');
      parsedContent = { content: rawContent, parse_error: true };
    }

    return {
      content: parsedContent,
      metadata: {
        model: response.model,
        tokens_used: response.usage.total_tokens,
        processing_time_ms: Date.now(),
        generated_at: new Date().toISOString(),
        mock_mode: false,
        chunked_processing: true,
        chunks_processed: summaries.length
      }
    };
  }

  /**
   * Build report prompt from aggregated summaries
   */
  buildReportPromptFromSummaries(aggregated, reportType, options = {}) {
    const { sessionContext, notes, language } = options;
    
    let prompt = `Based on the following aggregated insights from a business consultation meeting, generate a comprehensive ${reportType} report.\n\n`;
    
    if (sessionContext) {
      prompt += `SESSION CONTEXT:\n`;
      prompt += `Client: ${sessionContext.clientName}\n`;
      prompt += `Advisor: ${sessionContext.adviserName}\n`;
      prompt += `Date: ${new Date(sessionContext.sessionDate).toLocaleDateString()}\n`;
      prompt += `Duration: ${sessionContext.duration ? Math.round(sessionContext.duration/60) : 'Unknown'} minutes\n\n`;
    }

    prompt += `AGGREGATED INSIGHTS:\n\n`;
    
    if (aggregated.key_topics.length > 0) {
      prompt += `KEY TOPICS DISCUSSED:\n${aggregated.key_topics.map(topic => `- ${topic}`).join('\n')}\n\n`;
    }
    
    if (aggregated.decisions.length > 0) {
      prompt += `DECISIONS MADE:\n${aggregated.decisions.map(decision => `- ${decision}`).join('\n')}\n\n`;
    }
    
    if (aggregated.client_concerns.length > 0) {
      prompt += `CLIENT CONCERNS:\n${aggregated.client_concerns.map(concern => `- ${concern}`).join('\n')}\n\n`;
    }
    
    if (aggregated.advisor_guidance.length > 0) {
      prompt += `ADVISOR GUIDANCE:\n${aggregated.advisor_guidance.map(guidance => `- ${guidance}`).join('\n')}\n\n`;
    }

    if (notes) {
      prompt += `SPECIAL INSTRUCTIONS FROM ADVISER:\n${notes}\n\n`;
    }

    if (language) {
      prompt += `IMPORTANT: Generate the report in ${language} language to match the original meeting language.\n\n`;
    }

    prompt += `Please generate a structured ${reportType} report based on these insights.`;
    
    return prompt;
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

  /**
   * Memory-optimized transcript merging to avoid large string concatenation
   */
  mergeTranscriptsMemoryOptimized(transcripts) {
    // For small transcripts, use simple join
    if (transcripts.length <= 5) {
      return transcripts.map(t => t.text).join(' ');
    }

    // For large transcripts, use chunked processing to avoid memory spikes
    const CHUNK_SIZE = 10; // Process 10 transcripts at a time
    let result = '';
    
    for (let i = 0; i < transcripts.length; i += CHUNK_SIZE) {
      const chunk = transcripts.slice(i, i + CHUNK_SIZE);
      const chunkText = chunk.map(t => t.text).join(' ');
      result += (result ? ' ' : '') + chunkText;
      
      // Force garbage collection hint for large strings
      if (result.length > 1000000) { // 1MB threshold
        if (global.gc) {
          global.gc();
        }
      }
    }
    
    return result;
  }

  /**
   * Comprehensive temp file cleanup
   */
  async cleanupTempFiles(basePath = null) {
    const tempDirs = [
      path.join(process.cwd(), 'temp'),
      path.join(__dirname, '../../uploads/temp')
    ];
    
    if (basePath) {
      tempDirs.push(basePath);
    }

    for (const tempDir of tempDirs) {
      try {
        if (fs.existsSync(tempDir)) {
          const files = fs.readdirSync(tempDir);
          const now = Date.now();
          
          for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            
            // Delete files older than 1 hour
            const ageMs = now - stats.mtime.getTime();
            if (ageMs > 60 * 60 * 1000) {
              if (stats.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(filePath);
              }
              console.log(`🧹 Cleaned up old temp file: ${file}`);
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup temp directory ${tempDir}:`, error.message);
      }
    }
  }

  /**
   * Safe temp file cleanup with error handling
   */
  cleanupTempFileSafe(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
        console.log(`🧹 Cleaned up temp file: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to cleanup temp file ${filePath}:`, error.message);
    }
  }
}

module.exports = new OpenAIService();
