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
      
      if (fileSizeInMB > 25) {
        throw new Error(`File size (${fileSizeInMB.toFixed(2)}MB) exceeds OpenAI's 25MB limit`);
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

      // Parse JSON response from OpenAI
      let parsedContent;
      try {
        parsedContent = JSON.parse(rawContent);
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
    const { sessionContext, notes } = options;
    
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
LANGUAGE PRESERVATION: Unless the instructions above specifically request a different language, maintain the same language as the original transcript. If the transcript is in Hebrew, generate the report in Hebrew. If in English, generate in English. Match the language exactly.

`;
    } else {
      // Even without notes, add language preservation instruction
      notesSection = `
LANGUAGE PRESERVATION: Generate the report in the same language as the transcript. If the transcript is in Hebrew, write the report in Hebrew. If in English, write in English. Match the language exactly.

`;
    }

    const basePrompt = `Please analyze the following transcript and generate a comprehensive ${reportType} report.

${sessionInfo}${notesSection}Transcript:
${transcript}

Please provide:
1. Meeting Summary
2. Key Discussion Points
3. Action Items
4. Next Steps
5. Important Decisions Made

IMPORTANT ANALYSIS INSTRUCTIONS:
- CRITICAL: Generate the entire report in the same language as the transcript. If the transcript is in Hebrew, write the report in Hebrew. If in English, write in English. Match the language exactly.
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
Extract and analyze the following information from the transcript:

### Speaking Time Analysis
- advisor_speaking_percentage: Percentage of speaking time by the advisor
- entrepreneur_speaking_percentage: Percentage of speaking time by the entrepreneur
- conversation_duration: Use the "Meeting Duration" value from the Session Information section above (do not calculate, just copy the provided value)

### Main Topics Tags
- main_topics: Array of key topics that came up in the conversation (as tags/keywords)

### Points to Preserve - remember to use the same language as the transcript for the actual content of the points to preserve
- points_to_preserve: Analysis of what the adviser did well in the conversation - should be positive and flattering - but based on evidence from the conversation, not assumptions or generalizations should be a array where each item is an object that includes:
  - "title": The title of the point
  - "description": A description of the point

### Points for Improvement - remember to use the same language as the transcript for the actual content of the points to improve
- points_for_improvement: Analysis of areas where the adviser could improve - this is meant to be constructive feedback to help the adviser improve their performance and should include:
  - recommendations: What could have been done better in the conversation to encourage the entrepreneur to continue the process
  - missed_opportunities: Important points that may have been missed in the conversation that should be emphasized

### Performance Scores
- entrepreneur_readiness_score: Score from 1-100% based on these specific criteria:
  * Business maturity and clarity of needs (25 points)
  * Engagement level and active participation (25 points)
  * Receptiveness to advice and solutions (25 points)
  * Expressed interest in continuing the process (25 points)
- advisor_performance_score: Score from 1-100% based on these specific criteria:
  * Active listening and understanding of client needs (25 points)
  * Quality and relevance of responses and advice (25 points)
  * Ability to build rapport and trust (25 points)
  * Effectiveness in presenting value proposition and next steps (25 points)

## ANALYSIS INSTRUCTIONS:
- Calculate speaking percentages based on conversation flow and speaker identification
- Use the exact duration from the session context provided above
- Extract actual quotes to support analysis points
- For performance scores, evaluate each criterion objectively and sum the points (each criterion worth 25 points)
- Base scores on evidence from the conversation, not assumptions
- Provide specific examples and quotes to justify scoring decisions
- Focus on actionable feedback for advisor improvement
- This report serves as an internal evaluation document for advisor development

Generate all content in the same language as the transcript, but use English field names in the JSON structure.`;
    } else if (reportType === 'client') {
      return basePrompt + `
Generate a comprehensive client report based directly on the transcript content - this report will be sent to the client so the tone when regarding the client should always be positive and helpful:

## CLIENT REPORT STRUCTURE
Extract the following information directly from the transcript:

### Executive Summary
- executive_summary: Brief management summary reflecting the entrepreneur's current state and the general direction of the conversation, should be at least 3 sentences long, and should include some subtle flattering of the client - but in a proffesional way, and not too over the top.

### Entrepreneur Needs Analysis
- entrepreneur_needs: this field should always return an array even if there is only one need, Summary of needs from the entrepreneur's side, this should be a list of sevral needs (if available) where each need should include:
  - need_conceptualization: Clear definition of the identified need
  - need_explanation: Detailed explanation of the need
  - supporting_quotes: Direct quotes from the conversation that support this need

### Advisor Solutions and Recommendations
- advisor_solutions: this field should always return an array even if there is only one solution, Summary of solutions, advice, and recommendations provided by the advisor, this should be a list of sevral solutions (if available) where each solution should include:
  - solution_conceptualization: Clear definition of the proposed solution
  - solution_explanation: Detailed explanation of the solution/advice
  - supporting_quotes: Direct quotes from the advisor in the conversation

### Agreed Actions for Follow-up
- agreed_actions: Concrete actions agreed upon for continuation, including:
  - immediate_actions: Specific immediate actions to be taken
  - concrete_recommendation: Specific recommendation for continuing the process with the advisory organization

## EXTRACTION INSTRUCTIONS:
- Extract information DIRECTLY from the transcript - do not infer or add information not present
- Use actual quotes from the conversation to support each section
- Identify who said what (entrepreneur vs advisor) based on context clues
- Focus on concrete needs, solutions, and agreements mentioned in the conversation
- Maintain the original meaning and context of statements
- If information for a section is not available in the transcript, indicate this clearly
- Use clear, professional language suitable for client delivery
- This report serves as a working document for client consultation

Generate all content in the same language as the transcript, but use English field names in the JSON structure.`;
    }

    return basePrompt;
  }

  /**
   * Get system prompt based on report type
   */
  getSystemPrompt(reportType) {
    const baseSystem = "You are an AI assistant specialized in analyzing business conversations and generating professional reports. You can handle various types of audio content including meetings, consultations, presentations, and monologues. Always use the actual session information provided (client names, adviser names, dates, etc.) instead of generic placeholders like [Insert Name] or [Insert Date]. Be adaptive to the content type and provide valuable insights regardless of the conversation format. CRITICAL: Always respond in the same language as the transcript provided. If the transcript is in Hebrew, respond entirely in Hebrew. If in English, respond entirely in English. Match the language of the conversation exactly. IMPORTANT: You must respond with a valid JSON object only - no markdown, no additional text, just pure JSON.";

    if (reportType === 'adviser' || reportType === 'advisor') {
      return baseSystem + " Generate advisor reports with conversation analysis and performance evaluation. Include specific client details and personalize the report with actual names and information provided. Focus on speaking time analysis, performance scores, and actionable feedback. Return the response as a JSON object with the following structure: {\"advisor_speaking_percentage\": \"number\", \"entrepreneur_speaking_percentage\": \"number\", \"conversation_duration\": \"string\", \"main_topics\": [\"array of topic tags\"], \"points_to_preserve\": [{\"title\": \"string\", \"description\": \"string\"}], \"points_for_improvement\": {\"recommendations\": [\"array of improvement suggestions\"], \"missed_opportunities\": [\"array of missed points\"], \"supporting_quotes\": [\"array of quotes\"]}, \"entrepreneur_readiness_score\": \"number\", \"advisor_performance_score\": \"number\"}";
    } else if (reportType === 'client') {
      return baseSystem + " Generate client reports by extracting information directly from the transcript. Include specific client details and personalize the report with actual names and information provided. Focus on concrete information present in the conversation. Return the response as a JSON object with the following structure: {\"executive_summary\": \"string\", \"entrepreneur_needs\": [ {\"need_conceptualization\": \"string\", \"need_explanation\": \"string\", \"supporting_quotes\": [\"array of direct quotes\"]} ], \"advisor_solutions\": [ {\"solution_conceptualization\": \"string\", \"solution_explanation\": \"string\", \"supporting_quotes\": [\"array of direct quotes\"]} ], \"agreed_actions\": {\"immediate_actions\": [\"array of specific actions\"], \"concrete_recommendation\": [\"array of recommendations\"]}}";
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
