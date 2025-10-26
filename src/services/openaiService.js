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
        console.log(`🗑️ Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      console.error('Error cleaning up temp file:', error);
    }
  }

  /**
   * Transcribe audio file using OpenAI Whisper (or mock)
   */
  async transcribeAudio(fileUrl, fileName, options = {}) {
    // Check if we're in mock mode
    if (this.isMockMode()) {
      return this.mockTranscribeAudio(fileUrl, fileName, options);
    }

    let tempFilePath = null;

    try {
      console.log(`🎵 Starting transcription for: ${fileName}`);

      // Download file to temp location
      tempFilePath = await this.downloadFile(fileUrl, fileName);
      console.log(`📥 Downloaded file to: ${tempFilePath}`);

      // Check file size (Whisper has 25MB limit)
      const stats = fs.statSync(tempFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      if (fileSizeInMB > 25) {
        throw new Error(`File size (${fileSizeInMB.toFixed(2)}MB) exceeds OpenAI's 25MB limit`);
      }

      console.log(`📊 File size: ${fileSizeInMB.toFixed(2)}MB`);

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

      console.log(`🚀 Sending to OpenAI Whisper...`);
      const startTime = Date.now();

      // Call OpenAI Whisper API
      const response = await this.openai.audio.transcriptions.create(transcriptionOptions);

      const duration = Date.now() - startTime;
      console.log(`✅ Transcription completed in ${duration}ms`);

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
   * Mock transcription for testing without OpenAI API
   */
  async mockTranscribeAudio(fileUrl, fileName, options = {}) {
    console.log(`🎭 MOCK: Starting transcription for: ${fileName}`);
    console.log(`🎭 MOCK: File URL: ${fileUrl}`);

    const startTime = Date.now();

    // Simulate processing delay (3-8 seconds)
    const delayMs = Math.floor(Math.random() * 5000) + 3000;
    console.log(`🎭 MOCK: Simulating ${delayMs}ms processing delay...`);
    
    await new Promise(resolve => setTimeout(resolve, delayMs));

    const duration = Date.now() - startTime;

    // Generate mock transcript
    const mockTranscripts = [
      "שלום, זה פגישה לדוגמה עם לקוח. אנחנו דנים על האסטרטגיה העסקית שלהם ואיך לשפר את הביצועים. הלקוח מעוניין בפתרונות דיגיטליים חדשים.",
      "Hello, this is a sample business meeting. We are discussing the client's current challenges and potential solutions. The main focus is on improving operational efficiency and customer satisfaction.",
      "בפגישה זו דנו על תוכנית העבודה לרבעון הבא. הלקוח הציג את המטרות שלו ואנחנו הצענו מספר אסטרטגיות לביצוע. יש צורך במעקב צמוד על ההתקדמות.",
      "The client expressed concerns about their current market position. We discussed various approaches to strengthen their competitive advantage and explored new business opportunities."
    ];

    const randomTranscript = mockTranscripts[Math.floor(Math.random() * mockTranscripts.length)];

    console.log(`✅ MOCK: Transcription completed in ${duration}ms`);

    return {
      text: randomTranscript,
      language: randomTranscript.includes('שלום') || randomTranscript.includes('בפגישה') ? 'he' : 'en',
      duration: 120 + Math.floor(Math.random() * 180), // 2-5 minutes
      segments: [
        {
          start: 0,
          end: 30,
          text: randomTranscript.substring(0, Math.floor(randomTranscript.length / 2))
        },
        {
          start: 30,
          end: 120,
          text: randomTranscript.substring(Math.floor(randomTranscript.length / 2))
        }
      ],
      metadata: {
        model: 'whisper-1-mock',
        processing_time_ms: duration,
        file_size_mb: 2.5 + Math.random() * 10, // Random size between 2.5-12.5MB
        transcribed_at: new Date().toISOString(),
        mock_mode: true
      }
    };
  }

  /**
   * Generate report using GPT based on transcript (or mock)
   */
  async generateReport(transcript, reportType, options = {}) {
    try {
      console.log(`📝 Generating ${reportType} report...`);

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
      console.log(`✅ ${reportType} report generated in ${duration}ms`);

      return {
        content: response.choices[0].message.content,
        type: reportType,
        metadata: {
          model: options.model || 'gpt-4o-mini',
          processing_time_ms: duration,
          tokens_used: response.usage?.total_tokens || 0,
          generated_at: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error(`Error generating ${reportType} report:`, error);
      throw new Error(`Report generation failed: ${error.message}`);
    }
  }

  /**
   * Mock report generation for testing
   */
  async mockGenerateReport(transcript, reportType, options = {}) {
    console.log(`🎭 MOCK: Generating ${reportType} report...`);
    
    const startTime = Date.now();

    // Simulate processing delay (2-5 seconds)
    const delayMs = Math.floor(Math.random() * 3000) + 2000;
    console.log(`🎭 MOCK: Simulating ${delayMs}ms processing delay...`);
    
    await new Promise(resolve => setTimeout(resolve, delayMs));

    const duration = Date.now() - startTime;

    // Generate mock report based on type
    let mockContent;
    
    if (reportType === 'advisor') {
      mockContent = `# דוח יועץ - סיכום פגישה

## סיכום כללי
הפגישה התמקדה בהערכת המצב העסקי הנוכחי של הלקוח וזיהוי הזדמנויות לשיפור.

## נקודות מפתח שנדונו:
- אסטרטגיה עסקית ותכנון לטווח הארוך
- שיפור יעילות תפעולית
- פתרונות טכנולוגיים חדשים
- ניתוח תחרותי ומיצוב בשוק

## המלצות פעולה:
1. **שיפור תהליכים**: יישום מערכות ניהול חדשות
2. **פיתוח דיגיטלי**: השקעה בכלים טכנולוגיים
3. **אסטרטגיה שיווקית**: חיזוק המיתוג והנוכחות הדיגיטלית

## צעדים הבאים:
- קביעת פגישת המשך תוך שבועיים
- הכנת תוכנית עבודה מפורטת
- ניתוח כדאיות כלכלית

## הערות יועץ:
הלקוח מראה מוטיבציה גבוהה ליישום השינויים. מומלץ להתחיל בצעדים קטנים ולבנות בהדרגה.

**תאריך הדוח**: ${new Date().toLocaleDateString('he-IL')}
**סטטוס**: טיוטה לבדיקה`;

    } else if (reportType === 'client') {
      mockContent = `# סיכום פגישה - דוח לקוח

## תודה על הפגישה המועילה!

זה היה נהדר להכיר אתכם ולשמוע על החזון והמטרות שלכם. הנה סיכום של הנושאים העיקריים שדנו עליהם:

## מה דנו:
✅ **המצב הנוכחי**: סקרנו את המצב העסקי הקיים והאתגרים העיקריים
✅ **הזדמנויות צמיחה**: זיהינו תחומים עם פוטנציאל לשיפור
✅ **פתרונות מומלצים**: הצגנו גישות שיכולות לעזור להשיג את המטרות

## הצעדים הבאים:
🎯 **תוכנית עבודה**: נכין תוכנית מפורטת המותאמת לצרכים שלכם
🎯 **יישום הדרגתי**: נתחיל בשינויים קטנים ונבנה בהדרגה
🎯 **מעקב והתאמה**: נבצע מעקב שוטף ונתאים את התוכנית לפי הצורך

## מה חשוב לזכור:
- השינויים יתבצעו בקצב שמתאים לכם
- נהיה זמינים לכל שאלה או הבהרה
- נעדכן אתכם בכל שלב של התהליך

## פרטי יצירת קשר:
📧 **אימייל**: advisor@mati.com
📞 **טלפון**: 03-1234567

תודה שבחרתם בנו ללוות אתכם במסע הזה!

**תאריך**: ${new Date().toLocaleDateString('he-IL')}`;
    }

    console.log(`✅ MOCK: ${reportType} report generated in ${duration}ms`);

    return {
      content: mockContent,
      type: reportType,
      metadata: {
        model: 'gpt-4-mock',
        processing_time_ms: duration,
        tokens_used: Math.floor(Math.random() * 500) + 300, // Random tokens 300-800
        generated_at: new Date().toISOString(),
        mock_mode: true
      }
    };
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
- Use the actual session information provided above instead of placeholders. Replace any [Insert X] placeholders with the real data provided.
- Carefully read through the transcript to identify different speakers based on context clues, names mentioned, and conversation flow
- Look for patterns like "Tony said", "Carrie responded", or changes in speaking style/topic that indicate different speakers
- If the transcript lacks clear speaker identification, do your best to infer from context but acknowledge the limitation
- Pay attention to who is asking questions vs. providing answers, as this often indicates different roles
- Note if this appears to be a monologue, dialogue, or multi-participant meeting

`;

    if (reportType === 'advisor') {
      return basePrompt + `
Additionally, please include these specific sections for advisor analysis:

## Meeting Tone and Engagement Analysis
- Overall tone of the conversation (excited, interested, hesitant, not interested, confused, etc.)
- Client's level of engagement and enthusiasm
- Any concerns or resistance detected
- Energy level throughout the conversation

## Speaking Time Analysis
Analyze the transcript carefully to identify speakers and estimate speaking time:
- If speaker names are clearly mentioned (like "Tony said" or "Carrie responded"), calculate approximate percentage breakdown
- Count the number of words/sentences each identified speaker contributed
- Estimate speaking time percentages based on content length per speaker
- If speakers cannot be clearly identified, note: "Speaker identification unclear from transcript format - unable to calculate precise percentages"
- Identify who appears to be facilitating/leading the conversation
- Note the balance between dialogue and monologue sections
- For single-person recordings, indicate "Single speaker - 100%" and explain the context

SPECIFIC ANALYSIS APPROACH for this transcript format:
1. Look for direct name mentions and dialogue attribution (e.g., "Tony said", "Carrie responded")
2. Identify conversation turns by analyzing question-answer patterns
3. Count approximate word/sentence contributions per identified speaker
4. Estimate percentages based on content length and speaking turns
5. If precise calculation isn't possible, provide best estimates with clear disclaimers

Example format:
- Tony (Meeting Facilitator): ~40% - Led discussion, asked questions, guided agenda
- Carrie (Marketing): ~35% - Provided detailed updates on marketing strategy  
- Jason (Minutes): ~15% - Acknowledged tasks, brief responses
- Other participants: ~10% - Brief contributions and agreements

If unable to calculate precise percentages, provide format like:
- Tony: Dominant speaker - Facilitated meeting, asked most questions (~estimated 35-45%)
- Carrie: Major contributor - Provided detailed marketing updates (~estimated 30-40%)
- Jason: Moderate participation - Task acknowledgments and brief responses (~estimated 10-20%)
- Others: Limited participation - Brief agreements and contributions (~estimated 5-15%)

## Key Quotes and Insights
Extract the most significant quotes from the transcript:
- Select 3-5 direct quotes that reveal important insights
- Include the actual quoted text in quotation marks
- Identify the speaker if possible (e.g., "Tony stated:" or "As mentioned by Carrie:")
- Explain what each quote reveals about priorities, concerns, or business direction
- Focus on statements that show decision-making, strategic thinking, or key concerns
- If timestamps are not available in the transcript, don't fabricate them
- Note: If no meaningful quotes are available, explain why (e.g., "Limited dialogue due to monologue format")

Example format:
1. **"Let's make this the next Red Bull energy drink"** (Speaker: Tony/Team) - Shows ambitious market positioning and competitive aspirations
2. **"We need to give back to the community"** (Speaker: Tony) - Indicates strong commitment to corporate social responsibility
3. **"We have decided to pitch the new ginger cola as a health and energy drink"** (Speaker: Carrie) - Reveals strategic product positioning decision

## Professional Assessment
- Client's readiness level for next steps
- Potential challenges or objections identified
- Opportunities for deeper engagement
- Recommended approach for follow-up

Focus on:
- Detailed analysis for internal use
- Client insights and observations
- Recommendations for follow-up
- Areas requiring attention
- Strategic considerations

Fallback Instructions:
- If the audio appears to be a monologue or presentation rather than a meeting, adapt your analysis to focus on the speaker's content, goals, and potential needs
- If certain sections cannot be completed due to the nature of the recording, clearly state why and provide alternative insights
- Always provide value even if the format differs from a typical business meeting

Format the report professionally for advisor review using clear markdown sections.`;
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
    const baseSystem = "You are an AI assistant specialized in analyzing business conversations and generating professional reports. You can handle various types of audio content including meetings, consultations, presentations, and monologues. Always use the actual session information provided (client names, adviser names, dates, etc.) instead of generic placeholders like [Insert Name] or [Insert Date]. Be adaptive to the content type and provide valuable insights regardless of the conversation format.";

    if (reportType === 'advisor') {
      return baseSystem + " Generate detailed internal reports for business advisors with analytical insights and strategic recommendations. Include specific client details and personalize the report with actual names and information provided. Focus on actionable insights for the advisor, including conversation dynamics, client psychology, and strategic recommendations. If the content is not a typical meeting format, adapt your analysis to still provide valuable business insights.";
    } else if (reportType === 'client') {
      return baseSystem + " Generate client-facing reports that are clear, professional, and actionable for business clients. Use the client's actual name and business context throughout the report.";
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
