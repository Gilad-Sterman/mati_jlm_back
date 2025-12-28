const JobService = require('../services/jobService');
const SessionService = require('../services/sessionService');
const openaiService = require('../services/openaiService');
const ReportService = require('../services/reportService');
const socketService = require('../services/socketService');

class AIWorker {
  constructor() {
    this.isRunning = false;
    this.pollInterval = 5000; // Check for jobs every 5 seconds
    this.currentJob = null;
  }

  /**
   * Start the worker
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Worker is already running');
      return;
    }
    
    // Aggressive startup cleanup to handle cached data
    console.log('🧹 Performing startup cleanup...');
    await this.startupCleanup();
    
    // Check if OpenAI is configured
    if (!openaiService.isConfigured()) {
      console.error('❌ OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
      return;
    }

    // Test OpenAI connection
    const connectionTest = await openaiService.testConnection();
    if (!connectionTest.success) {
      console.error('❌ OpenAI connection failed:', connectionTest.error);
      return;
    }

    console.log(`✅ OpenAI connection successful (${connectionTest.models} models available)`);

    this.isRunning = true;
    this.processJobs();
  }

  /**
   * Stop the worker
   */
  stop() {
    console.log('🛑 Stopping AI Worker...');
    this.isRunning = false;
  }

  /**
   * Main job processing loop
   */
  async processJobs() {
    while (this.isRunning) {
      try {
        // Check memory usage before processing jobs
        this.checkMemoryUsage();
        
        // Get next job from queue
        const job = await JobService.getNextJob();

        if (job) {
          this.currentJob = job;
          console.log(`📋 Processing job ${job.job_id} (${job.job_type})`);
          
          await this.processJob(job);
          this.currentJob = null;
        }

        // Wait before checking for next job
        await this.sleep(this.pollInterval);

      } catch (error) {
        console.error('❌ Error in job processing loop:', error);
        
        // If there was a current job, mark it as failed
        if (this.currentJob) {
          try {
            await JobService.markJobFailed(this.currentJob.job_id, error.message);
          } catch (failError) {
            console.error('❌ Failed to mark job as failed:', failError);
          }
          this.currentJob = null;
        }

        // Wait a bit longer on error to avoid rapid retries
        await this.sleep(this.pollInterval * 2);
      }
    }

    console.log('✅ AI Worker stopped');
  }

  /**
   * Process a single job
   */
  async processJob(job) {
    const { job_id, job_type, session_id, payload } = job;

    try {
      // Mark job as processing (attempts will be incremented by markJobFailed if job fails)
      await JobService.updateJob(job_id, { 
        status: 'processing'
      });

      // Process based on job type
      switch (job_type) {
        case 'transcribe':
          await this.processTranscriptionJob(job_id, session_id, payload);
          break;
        
        case 'generate_reports':
          await this.processReportGenerationJob(job_id, session_id, payload);
          break;
        
        case 'regenerate_report':
          await this.processReportRegenerationJob(job_id, session_id, payload);
          break;
        
        default:
          throw new Error(`Unknown job type: ${job_type}`);
      }

      // Mark job as completed
      await JobService.updateJob(job_id, { 
        status: 'completed',
        completed_at: new Date()
      });

      console.log(`✅ Job ${job_id} completed successfully`);

    } catch (error) {
      console.error(`❌ Job ${job_id} failed:`, error);
      
      // Mark job as failed (with retry logic)
      await JobService.markJobFailed(job_id, error.message);
    }
  }

  /**
   * Process transcription job
   */
  async processTranscriptionJob(jobId, sessionId, payload) {
    const { file_url, file_name, file_type } = payload;

    try {
      // Get session info to find the user
      const session = await SessionService.getSessionById(sessionId, null, 'admin');
      const userId = session.adviser_id;

      // Update session processing metadata (keep existing status)
      await SessionService.updateSession(sessionId, { 
        processing_metadata: {
          transcription_started_at: new Date().toISOString(),
          job_id: jobId
        }
      }, userId, 'admin');

      // Note: Removed transcription_started socket emission - using static processing display

      // Determine language (you can make this configurable)
      const transcriptionOptions = {};
      
      // If Hebrew content is expected, specify language
      // transcriptionOptions.language = 'he';

      // Call OpenAI Whisper (removed socket support for chunked progress)
      const transcriptionResult = await openaiService.transcribeAudio(
        file_url, 
        file_name, 
        transcriptionOptions
      );

      console.log(`✅ Transcription completed for session ${sessionId}`);

      // Update session with transcript and status
      await SessionService.updateSession(sessionId, {
        status: 'transcribed',
        transcription_text: transcriptionResult.text,
        transcription_metadata: {
          language: transcriptionResult.language,
          duration: transcriptionResult.duration,
          model: transcriptionResult.metadata.model,
          processing_time_ms: transcriptionResult.metadata.processing_time_ms,
          transcribed_at: transcriptionResult.metadata.transcribed_at,
          mock_mode: transcriptionResult.metadata.mock_mode || false
        },
        processing_metadata: {
          transcription_completed_at: new Date().toISOString(),
          transcription_duration_ms: transcriptionResult.metadata.processing_time_ms,
          language: transcriptionResult.language,
          model: transcriptionResult.metadata.model
        }
      }, userId, 'admin');

      // Store result in job
      await JobService.updateJob(jobId, {
        result: {
          transcript: transcriptionResult.text,
          metadata: transcriptionResult.metadata
        }
      });

      // Note: Removed transcription_complete socket emission - using static processing display

      // Create report generation job
      await this.createReportGenerationJob(sessionId, transcriptionResult.text);

    } catch (error) {
      console.error(`❌ Transcription failed for session ${sessionId}:`, error);
      
      // Update session status
      try {
        const session = await SessionService.getSessionById(sessionId, null, 'admin');
        const userId = session.adviser_id;

        await SessionService.updateSession(sessionId, {
          status: 'failed',
          processing_metadata: {
            transcription_error: error.message,
            transcription_failed_at: new Date().toISOString()
          }
        }, userId, 'advisor');

        // Note: Removed transcription_error socket emission - using static processing display

      } catch (updateError) {
        console.error('Failed to update session after transcription error:', updateError);
      }

      throw error;
    }
  }

  /**
   * Create report generation job after successful transcription
   */
  async createReportGenerationJob(sessionId, transcript) {
    try {
      const reportJob = await JobService.createJob({
        session_id: sessionId,
        type: 'generate_reports',
        payload: {
          transcript: transcript
        },
        priority: 8 // Lower priority than transcription
      });

    } catch (error) {
      console.error(`❌ Failed to create report generation job for session ${sessionId}:`, error);
    }
  }

  /**
   * Process report generation job
   */
  async processReportGenerationJob(jobId, sessionId, payload) {
    const { transcript } = payload;

    try {
      // Get session info
      const session = await SessionService.getSessionById(sessionId, null, 'admin');
      const userId = session.adviser_id;

      // Update session processing metadata (keep existing status)
      await SessionService.updateSession(sessionId, {
        processing_metadata: {
          report_generation_started_at: new Date().toISOString(),
          job_id: jobId
        }
      }, userId, 'advisor');

      // Note: Removed report_generation_started socket emission - using static processing display

      // Generate both advisor and client reports with session context
      const actualDuration = session.transcription_metadata?.duration || session.duration;
      const sessionContext = {
        sessionId: session.id,
        clientName: session.client?.name || 'Unknown Client',
        clientEmail: session.client?.email,
        clientPhone: session.client?.phone,
        businessDomain: session.client?.metadata?.business_domain,
        adviserName: session.adviser?.name || 'Unknown Adviser',
        adviserEmail: session.adviser?.email,
        sessionTitle: session.title,
        sessionDate: session.created_at,
        fileName: session.file_name,
        duration: actualDuration,
        fileSize: session.file_size
      };

      const advisorReport = await openaiService.generateReport(transcript, 'advisor', {
        sessionContext,
        language: session.transcription_metadata?.language
      });

      const clientReport = await openaiService.generateReport(transcript, 'client', {
        sessionContext,
        language: session.transcription_metadata?.language
      });

      console.log(`✅ Both advisor and client reports generated for session ${sessionId}`);

      // Save advisor report (Level 1 - non-editable metrics) with idempotency protection
      const advisorContentString = typeof advisorReport.content === 'object' ? 
        JSON.stringify(advisorReport.content) : 
        advisorReport.content;
      
      const savedAdvisorReport = await this.createReportSafely({
        session_id: sessionId,
        type: 'adviser',
        title: `Advisor Report - ${new Date().toLocaleDateString()}`,
        content: advisorContentString,
        generation_metadata: {
          model: advisorReport.metadata.model,
          tokens_used: advisorReport.metadata.tokens_used,
          processing_time_ms: advisorReport.metadata.processing_time_ms,
          generated_at: advisorReport.metadata.generated_at,
          mock_mode: advisorReport.metadata.mock_mode || false
        },
        status: 'draft'
      });

      // Save client report (Level 2 - editable insights) with idempotency protection
      const clientContentString = typeof clientReport.content === 'object' ? 
        JSON.stringify(clientReport.content) : 
        clientReport.content;
      
      const savedClientReport = await this.createReportSafely({
        session_id: sessionId,
        type: 'client',
        title: `דוח יזם (${sessionContext.clientName})`,
        content: clientContentString,
        generation_metadata: {
          model: clientReport.metadata.model,
          tokens_used: clientReport.metadata.tokens_used,
          processing_time_ms: clientReport.metadata.processing_time_ms,
          generated_at: clientReport.metadata.generated_at,
          mock_mode: clientReport.metadata.mock_mode || false
        },
        status: 'draft'
      });

      // Update session status and metadata
      await SessionService.updateSession(sessionId, {
        status: 'reports_generated',
        processing_metadata: {
          reports_generation_completed_at: new Date().toISOString(),
          advisor_report_tokens: advisorReport.metadata.tokens_used,
          client_report_tokens: clientReport.metadata.tokens_used,
          advisor_report_id: savedAdvisorReport.id,
          client_report_id: savedClientReport.id
        }
      }, userId, 'advisor');

      // Store results in job
      await JobService.updateJob(jobId, {
        result: {
          advisor_report: advisorReport,
          client_report: clientReport
        }
      });

      // Emit final completion to user for global notifications
      socketService.sendToUser(userId, 'reports_generated', {
        sessionId,
        message: 'Both advisor and client reports generated successfully!'
      });

    } catch (error) {
      console.error(`❌ Report generation failed for session ${sessionId}:`, error);
      
      // Update session status
      try {
        const session = await SessionService.getSessionById(sessionId, null, 'admin');
        const userId = session.adviser_id;

        await SessionService.updateSession(sessionId, {
          status: 'failed',
          processing_metadata: {
            report_generation_error: error.message,
            report_generation_failed_at: new Date().toISOString()
          }
        }, userId, 'advisor');

        // Emit error to user for global notifications
        socketService.sendToUser(userId, 'processing_error', {
          sessionId,
          message: 'Report generation failed',
          error: error.message
        });

      } catch (updateError) {
        console.error('Failed to update session after report generation error:', updateError);
      }

      throw error;
    }
  }

  /**
   * Process report regeneration job
   */
  async processReportRegenerationJob(jobId, sessionId, payload) {
    const { report_id, original_report_id, transcript, notes, report_type, session_context } = payload;

    try {
      // Get session info to find the user
      const session = await SessionService.getSessionById(sessionId, null, 'admin');
      const userId = session.adviser_id;

      // Keep report in draft status during processing
      // Note: Skipping status update as 'review' may not be valid in current DB schema

      // Note: Removed report_regeneration_started socket emission - using static processing display

      // Generate new report with notes and session context
      const regeneratedReport = await openaiService.generateReport(transcript, report_type, {
        sessionContext: session_context,
        notes: notes,
        language: session.transcription_metadata?.language
      });

      console.log(`✅ Report regenerated for session ${sessionId}, report ${report_id}`);

      // Update the new report with generated content
      const contentString = typeof regeneratedReport.content === 'object' ? 
        JSON.stringify(regeneratedReport.content) : 
        regeneratedReport.content;

      await ReportService.updateReport(report_id, {
        content: contentString,
        status: 'draft',
        generation_metadata: {
          ...regeneratedReport.metadata,
          regeneration_notes: notes,
          regenerated_at: new Date().toISOString(),
          original_report_id: original_report_id
        },
        word_count: ReportService.countWords(contentString),
        character_count: contentString.length
      });

      // Store result in job
      await JobService.updateJob(jobId, {
        result: {
          regenerated_report: regeneratedReport,
          report_id: report_id
        }
      });

      // Note: Removed report_regeneration_complete socket emission - report regeneration handled via Redux

    } catch (error) {
      console.error(`❌ Report regeneration failed for session ${sessionId}, report ${report_id}:`, error);
      
      // Keep report in draft status on error (no 'failed' status available)
      try {
        await ReportService.updateReportStatus(report_id, 'draft');
        
        const session = await SessionService.getSessionById(sessionId, null, 'admin');
        const userId = session.adviser_id;

        // Note: Removed report_regeneration_error socket emission - report regeneration handled via Redux

      } catch (updateError) {
        console.error('Failed to update report after regeneration error:', updateError);
      }

      throw error;
    }
  }

  /**
   * Create report with idempotency protection
   * If report already exists for this session and type, return the existing one
   */
  async createReportSafely(reportData) {
    try {
      // First, try to create the report normally
      return await ReportService.createReport(reportData);
    } catch (error) {
      // Check if this is a unique constraint violation (report already exists)
      if (error.message && (
        error.message.includes('duplicate key') || 
        error.message.includes('unique constraint') ||
        error.message.includes('UNIQUE constraint failed') ||
        error.message.includes('already exists')
      )) {
        console.log(`⚠️ Report already exists for session ${reportData.session_id}, type ${reportData.type}. Fetching existing report...`);
        
        try {
          // Get the existing report
          const existingReports = await ReportService.getReportsForSession(reportData.session_id);
          const existingReport = existingReports.find(r => r.type === reportData.type && r.is_current_version);
          
          if (existingReport) {
            console.log(`✅ Found existing ${reportData.type} report for session ${reportData.session_id}: ${existingReport.id}`);
            return existingReport;
          } else {
            // This shouldn't happen, but if it does, re-throw the original error
            console.error(`❌ Could not find existing ${reportData.type} report for session ${reportData.session_id} after constraint violation`);
            throw error;
          }
        } catch (fetchError) {
          console.error(`❌ Failed to fetch existing report after constraint violation:`, fetchError);
          throw error; // Re-throw original error
        }
      } else {
        // This is a different kind of error, re-throw it
        throw error;
      }
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check memory usage and trigger cleanup if needed
   */
  checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // Log memory usage periodically
    if (this.currentJob) {
      console.log(`💾 Memory: ${heapUsedMB}MB used, ${heapTotalMB}MB total, ${rssMB}MB RSS`);
    }
    
    // Trigger cleanup if memory usage is high (conservative for Render's 512MB limit)
    const MEMORY_WARNING_THRESHOLD = 150; // 150MB (30% of 512MB)
    const MEMORY_CRITICAL_THRESHOLD = 200; // 200MB (40% of 512MB)
    
    if (heapUsedMB > MEMORY_CRITICAL_THRESHOLD) {
      console.warn(`🚨 CRITICAL: Memory usage ${heapUsedMB}MB exceeds ${MEMORY_CRITICAL_THRESHOLD}MB threshold!`);
      this.forceMemoryCleanup();
    } else if (heapUsedMB > MEMORY_WARNING_THRESHOLD) {
      console.warn(`⚠️ WARNING: Memory usage ${heapUsedMB}MB exceeds ${MEMORY_WARNING_THRESHOLD}MB threshold`);
      this.triggerGarbageCollection();
    }
  }

  /**
   * Force memory cleanup
   */
  async forceMemoryCleanup() {
    console.log('🧹 Forcing memory cleanup...');
    
    // Trigger garbage collection if available
    this.triggerGarbageCollection();
    
    // Clean up temp files
    try {
      const openaiService = require('../services/openaiService');
      await openaiService.cleanupTempFiles();
    } catch (error) {
      console.warn('Failed to cleanup temp files:', error.message);
    }
    
    // Small delay to allow cleanup to complete
    await this.sleep(2000);
    
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    console.log(`🧹 Memory after cleanup: ${heapUsedMB}MB`);
  }

  /**
   * Startup cleanup to handle cached data and memory issues
   */
  async startupCleanup() {
    try {
      const startMemory = process.memoryUsage();
      console.log(`💾 Startup memory: ${Math.round(startMemory.heapUsed / 1024 / 1024)}MB heap, ${Math.round(startMemory.rss / 1024 / 1024)}MB RSS`);
      
      // Clean up temp files aggressively
      const openaiService = require('../services/openaiService');
      await openaiService.cleanupTempFiles();
      
      // Force multiple garbage collections to clear any cached data
      if (global.gc) {
        console.log('♻️ Performing aggressive startup garbage collection...');
        for (let i = 0; i < 3; i++) {
          global.gc();
          await this.sleep(100);
        }
      }
      
      // Clear any Node.js module cache for non-core modules (if needed)
      const moduleKeys = Object.keys(require.cache);
      let clearedCount = 0;
      
      for (const key of moduleKeys) {
        // Only clear temp/upload related modules to avoid breaking the app
        if (key.includes('/temp/') || key.includes('/uploads/')) {
          delete require.cache[key];
          clearedCount++;
        }
      }
      
      if (clearedCount > 0) {
        console.log(`🧹 Cleared ${clearedCount} cached modules`);
      }
      
      const endMemory = process.memoryUsage();
      console.log(`💾 After cleanup: ${Math.round(endMemory.heapUsed / 1024 / 1024)}MB heap, ${Math.round(endMemory.rss / 1024 / 1024)}MB RSS`);
      
      const memoryReduction = startMemory.heapUsed - endMemory.heapUsed;
      if (memoryReduction > 0) {
        console.log(`✅ Freed ${Math.round(memoryReduction / 1024 / 1024)}MB during startup cleanup`);
      }
      
    } catch (error) {
      console.warn('⚠️ Startup cleanup failed:', error.message);
    }
  }

  /**
   * Trigger garbage collection if available
   */
  triggerGarbageCollection() {
    if (global.gc) {
      console.log('♻️ Triggering garbage collection...');
      global.gc();
    } else {
      console.log('♻️ Garbage collection not available (run with --expose-gc flag)');
    }
  }

  /**
   * Get worker status
   */
  getStatus() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    return {
      isRunning: this.isRunning,
      currentJob: this.currentJob ? {
        id: this.currentJob.job_id,
        type: this.currentJob.job_type,
        sessionId: this.currentJob.session_id
      } : null,
      pollInterval: this.pollInterval,
      memory: {
        heapUsedMB,
        heapTotalMB,
        rssMB: Math.round(memUsage.rss / 1024 / 1024)
      }
    };
  }
}

module.exports = AIWorker;
