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
    const { sessionContext } = options;
    
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

    const basePrompt = `Please analyze the following transcript and generate a comprehensive ${reportType} report.

${sessionInfo}Transcript:
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

    if (reportType === 'advisor') {
      return basePrompt + `
Generate a structured report with the following two levels:

## LEVEL 1 - STRUCTURE DISPLAY (Non-editable metrics)
This section contains dry metrics and summary information:

### Key Metrics
- Estimate word count from transcript
- Count number of speakers identified
- Provide engagement score (high/medium/low) based on conversation analysis

### Main Topics
- Identify 3-5 main discussion topics from the conversation
- Focus on business-relevant themes and subjects

### Conversation Summary
- ai_summary: Objective summary of what was discussed
- advisor_summary: Strategic summary focusing on business implications

### General Sentiment
- Overall emotional tone of the conversation (positive/neutral/negative/mixed)

### Report Status
- Set to "draft" for new reports

## LEVEL 2 - INSIGHTS AND ANALYSIS (Editable advisor workspace)
This section contains actionable insights and recommendations:

### Part A - Insights
Generate 3-7 insight cards, each containing:
- insight_title: Clear, descriptive title
- description: Detailed explanation of the insight
- entrepreneur_quote: Relevant quote from transcript (if available)
- insight_type: Categorize as "opportunity", "challenge", "strength", or "concern"
- confidence_level: "high", "medium", or "low" based on evidence strength
- source: "transcript", "context", or "inference"

### Part B - Recommendations
Generate 3-5 recommendation cards, each containing:
- recommendation_description: Clear, actionable recommendation
- execution_target: Timeline or target for implementation
- priority: "high", "medium", or "low"
- domain: "marketing", "finance", "operations", "strategy", or "other"
- linked_insight_id: Reference to related insight (use array index, starting from 0)

## ANALYSIS INSTRUCTIONS:
- Analyze conversation dynamics, speaker engagement, and business context
- Extract meaningful quotes that support insights
- Focus on actionable business intelligence
- Identify opportunities, challenges, and strategic considerations
- Ensure insights are specific and evidence-based
- Link recommendations to specific insights where possible
- Adapt analysis based on conversation type (meeting, consultation, presentation, etc.)

Generate all content in the same language as the transcript, but use English field names in the JSON structure.`;
    } else if (reportType === 'client') {
      return basePrompt + `
Focus on:
- Clear, client-friendly language
- Actionable next steps for the client
- Summary of agreements and commitments
- Positive and constructive tone
- Professional presentation suitable for client delivery

Format the report professionally for client delivery.`;
    }

    return basePrompt;
  }

  /**
   * Get system prompt based on report type
   */
  getSystemPrompt(reportType) {
    const baseSystem = "You are an AI assistant specialized in analyzing business conversations and generating professional reports. You can handle various types of audio content including meetings, consultations, presentations, and monologues. Always use the actual session information provided (client names, adviser names, dates, etc.) instead of generic placeholders like [Insert Name] or [Insert Date]. Be adaptive to the content type and provide valuable insights regardless of the conversation format. CRITICAL: Always respond in the same language as the transcript provided. If the transcript is in Hebrew, respond entirely in Hebrew. If in English, respond entirely in English. Match the language of the conversation exactly. IMPORTANT: You must respond with a valid JSON object only - no markdown, no additional text, just pure JSON.";

    if (reportType === 'advisor') {
      return baseSystem + " Generate detailed internal reports for business advisors with analytical insights and strategic recommendations. Include specific client details and personalize the report with actual names and information provided. Focus on actionable insights for the advisor. Return the response as a JSON object with the following structure: {\"level1_structure_display\": {\"key_metrics\": {\"word_count\": \"number\", \"speaker_count\": \"number\", \"engagement_score\": \"string\"}, \"main_topics\": [\"array of main discussion topics\"], \"conversation_summary\": {\"ai_summary\": \"string\", \"advisor_summary\": \"string\"}, \"general_sentiment\": \"string\"}, \"level2_insights_and_analysis\": {\"insights\": [{\"insight_title\": \"string\", \"description\": \"string\", \"entrepreneur_quote\": \"string\", \"insight_type\": \"opportunity|challenge|strength|concern\", \"confidence_level\": \"high|medium|low\", \"source\": \"transcript|context|inference\"}], \"recommendations\": [{\"recommendation_description\": \"string\", \"execution_target\": \"string\", \"priority\": \"high|medium|low\", \"domain\": \"marketing|finance|operations|strategy|other\", \"linked_insight_id\": \"number or null\"}]}}";
    } else if (reportType === 'client') {
      return baseSystem + " Generate client-facing reports that are clear, professional, and actionable for business clients. Use the client's actual name and business context throughout the report. Return the response as a JSON object with the following structure: {\"meeting_summary\": \"string\", \"key_points\": [\"array of strings\"], \"action_items\": [\"array of strings\"], \"next_steps\": [\"array of strings\"], \"decisions_made\": [\"array of strings\"], \"recommendations\": \"string\", \"follow_up_items\": [\"array of strings\"]}";
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
