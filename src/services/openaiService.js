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
    // Check if we're in mock mode
    if (this.isMockMode()) {
      return this.mockGenerateReport(transcript, reportType, options);
    }

    try {
      console.log(`📝 Generating ${reportType} report...`);

      const prompt = this.buildReportPrompt(transcript, reportType, options);
      
      const startTime = Date.now();

      const response = await this.openai.chat.completions.create({
        model: options.model || 'gpt-4',
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
          model: options.model || 'gpt-4',
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
    const basePrompt = `Please analyze the following meeting transcript and generate a comprehensive ${reportType} report.

Transcript:
${transcript}

Please provide:
1. Meeting Summary
2. Key Discussion Points
3. Action Items
4. Next Steps
5. Important Decisions Made

`;

    if (reportType === 'advisor') {
      return basePrompt + `
Focus on:
- Detailed analysis for internal use
- Client insights and observations
- Recommendations for follow-up
- Areas requiring attention
- Strategic considerations

Format the report professionally for advisor review.`;
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
    const baseSystem = "You are an AI assistant specialized in analyzing business meeting transcripts and generating professional reports.";

    if (reportType === 'advisor') {
      return baseSystem + " Generate detailed internal reports for business advisors with analytical insights and strategic recommendations.";
    } else if (reportType === 'client') {
      return baseSystem + " Generate client-facing reports that are clear, professional, and actionable for business clients.";
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
