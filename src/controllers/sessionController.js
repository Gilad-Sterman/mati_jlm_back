const SessionService = require('../services/sessionService');
const CloudinaryService = require('../services/cloudinaryService');
const ClientService = require('../services/clientService');
const JobService = require('../services/jobService');
const socketService = require('../services/socketService');
const FFmpegService = require('../services/ffmpegService');

class SessionController {
  /**
   * Create new session with file upload (supports creating new client) - Async with socket notifications
   */
  static async createSession(req, res) {
    try {
      const userId = req.user.id;
      const { client_id, title, newClient, fileName } = req.body;
      
      // Check if files were uploaded
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      // Parse newClient if it's a JSON string (from FormData)
      let parsedNewClient = null;
      if (newClient) {
        try {
          parsedNewClient = typeof newClient === 'string' ? JSON.parse(newClient) : newClient;
        } catch (parseError) {
          return res.status(400).json({
            success: false,
            message: 'Invalid new client data format'
          });
        }
      }

      // Validate client data - either existing client_id or new client data
      if (!client_id && !parsedNewClient) {
        return res.status(400).json({
          success: false,
          message: 'Either client_id or new client data is required'
        });
      }

      if (parsedNewClient) {
        // Validate new client data
        if (!parsedNewClient.name || parsedNewClient.name.trim().length < 2) {
          return res.status(400).json({
            success: false,
            message: 'Client name is required and must be at least 2 characters'
          });
        }

        if (!parsedNewClient.email || !parsedNewClient.email.trim()) {
          return res.status(400).json({
            success: false,
            message: 'Client email is required'
          });
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(parsedNewClient.email.trim())) {
          return res.status(400).json({
            success: false,
            message: 'Please provide a valid email address'
          });
        }

        // Phone validation
        if (!parsedNewClient.phone || !parsedNewClient.phone.trim()) {
          return res.status(400).json({
            success: false,
            message: 'Client phone number is required'
          });
        }

        // Basic phone validation
        const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
        if (!phoneRegex.test(parsedNewClient.phone.trim())) {
          return res.status(400).json({
            success: false,
            message: 'Please provide a valid phone number'
          });
        }
      }

      let finalClientId = client_id;

      // Create new client if needed (this is fast, so we do it synchronously)
      if (parsedNewClient) {
        try {
          // Build metadata object from individual fields
          const metadata = {};
          if (parsedNewClient.business_domain && parsedNewClient.business_domain.trim()) {
            metadata.business_domain = parsedNewClient.business_domain.trim();
          }
          if (parsedNewClient.business_number && parsedNewClient.business_number.trim()) {
            metadata.business_number = parsedNewClient.business_number.trim();
          }

          const clientData = {
            name: parsedNewClient.name.trim(),
            email: parsedNewClient.email.trim(),
            phone: parsedNewClient.phone ? parsedNewClient.phone.trim() : null,
            metadata: Object.keys(metadata).length > 0 ? metadata : {}
          };

          const newClientResult = await ClientService.createClient(clientData, userId);
          finalClientId = newClientResult.id;

        } catch (clientError) {
          // If client creation fails, we should handle it gracefully
          return res.status(400).json({
            success: false,
            message: `Failed to create client: ${clientError.message}`
          });
        }
      }

      // Calculate total file info from multiple files
      const totalFileSize = req.files.reduce((sum, file) => sum + file.size, 0);
      const fileNames = req.files.map(file => file.originalname).join(', ');
      const primaryFileName = fileName || req.files[0].originalname;
      const primaryMimeType = req.files[0].mimetype;
      
      // Create session in database with temporary file info (before concatenation and Cloudinary upload)
      const sessionData = {
        client_id: finalClientId,
        title: title?.trim() || null,
        file_url: null, // Will be updated after Cloudinary upload
        file_name: req.files.length > 1 ? `${req.files.length} files: ${fileNames}` : primaryFileName,
        file_size: totalFileSize,
        file_type: primaryMimeType,
        status: 'uploading', // New status to indicate upload in progress
        duration: null // Will be updated after Cloudinary upload
      };

      // Create session in database
      const session = await SessionService.createSession(sessionData, userId);

      // Respond immediately to frontend
      res.status(201).json({
        success: true,
        message: parsedNewClient 
          ? 'Client and session created successfully. File upload in progress...' 
          : 'Session created successfully. File upload in progress...',
        data: { 
          session: {
            ...session,
            uploadStatus: 'started'
          }
        }
      });

      // Emit socket event that upload started
      socketService.sendToUser(userId, 'upload_started', {
        sessionId: session.id,
        fileName: req.files.length > 1 ? `${req.files.length} files` : primaryFileName,
        fileSize: totalFileSize,
        message: req.files.length > 1 ? 'Multiple files upload started' : 'File upload to cloud storage started'
      });

      // Start background file processing (concatenation + Cloudinary upload)
      SessionController.handleBackgroundUpload(session.id, req.files, userId, primaryFileName);

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Handle background file upload to Cloudinary with socket notifications
   */
  static async handleBackgroundUpload(sessionId, files, userId, actualFileName) {
    try {
      // Emit progress update
      socketService.sendToUser(userId, 'upload_progress', {
        sessionId,
        progress: 10,
        message: files.length > 1 ? 'Preparing files for concatenation...' : 'Preparing file for upload...'
      });

      let finalFile;
      let tempDir = null;

      if (files.length > 1) {
        // Concatenate multiple files using FFmpeg
        socketService.sendToUser(userId, 'upload_progress', {
          sessionId,
          progress: 30,
          message: `Concatenating ${files.length} files...`
        });

        const filePaths = files.map(file => file.path);
        const concatenationResult = await FFmpegService.concatenateFiles(filePaths, `session_${sessionId}_merged.mp3`);
        
        if (!concatenationResult.success) {
          throw new Error(`File concatenation failed: ${concatenationResult.error}`);
        }

        finalFile = {
          path: concatenationResult.outputPath,
          originalname: actualFileName,
          mimetype: 'audio/mp3',
          size: concatenationResult.outputSize
        };
        tempDir = concatenationResult.tempDir;

        socketService.sendToUser(userId, 'upload_progress', {
          sessionId,
          progress: 50,
          message: 'Files concatenated, uploading to cloud...'
        });
      } else {
        // Single file - use as-is
        finalFile = files[0];
        
        socketService.sendToUser(userId, 'upload_progress', {
          sessionId,
          progress: 30,
          message: 'Uploading file to cloud...'
        });
      }

      // Upload final file to Cloudinary with compression
      const uploadResult = await CloudinaryService.uploadTempFile(
        finalFile.path,
        actualFileName,
        { 
          folder: 'mati/sessions',
          fileType: finalFile.mimetype
        }
      );

      // Check if upload was successful
      if (!uploadResult.success) {
        throw new Error(`Cloudinary upload failed: ${uploadResult.error}`);
      }

      // Emit progress update
      socketService.sendToUser(userId, 'upload_progress', {
        sessionId,
        progress: 80,
        message: 'File uploaded, updating database...'
      });

      // Update session with Cloudinary URL and metadata
      const updateData = {
        file_url: uploadResult.data.secure_url,
        status: 'uploaded',
        duration: uploadResult.data.duration ? Math.round(uploadResult.data.duration) : null,
        processing_metadata: {
          cloudinary_public_id: uploadResult.data.public_id,
          upload_completed_at: new Date().toISOString(),
          compression_info: uploadResult.data.compression_info // Store compression stats
        }
      };

      await SessionService.updateSession(sessionId, updateData, userId, 'advisor');

      // Emit final success
      const completeSent = socketService.sendToUser(userId, 'upload_complete', {
        sessionId,
        progress: 100,
        message: 'File upload completed successfully!',
        fileUrl: uploadResult.data.secure_url,
        duration: updateData.duration
      });

      // Create transcription job after successful upload
      try {
        const transcriptionJob = await JobService.createJob({
          session_id: sessionId,
          type: 'transcribe',
          payload: {
            file_url: uploadResult.data.secure_url,
            file_name: actualFileName,
            file_type: finalFile.mimetype,
            duration: updateData.duration
          },
          priority: 8 // Lower priority - let reports complete first
        });

        // Emit job created event
        socketService.sendToUser(userId, 'transcription_queued', {
          sessionId,
          jobId: transcriptionJob.id,
          message: 'Transcription job created and queued for processing'
        });

      } catch (jobError) {
        console.error(`❌ Failed to create transcription job for session ${sessionId}:`, jobError);
        
        // Don't fail the entire upload, but notify user
        socketService.sendToUser(userId, 'transcription_queue_error', {
          sessionId,
          message: 'File uploaded successfully, but transcription could not be queued',
          error: jobError.message
        });
      }

      // Clean up temporary files
      try {
        // Clean up FFmpeg concatenation temp directory if used
        if (tempDir) {
          FFmpegService.cleanupTempFiles(tempDir);
          console.log(`🗑️ Cleaned up temporary concatenation files`);
        }
        
        // Clean up original uploaded files from Multer
        const originalFilePaths = files.map(file => file.path);
        FFmpegService.cleanupTempFiles(null, originalFilePaths);
        console.log(`🗑️ Cleaned up ${originalFilePaths.length} original uploaded files`);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp files:', cleanupError.message);
      }

    } catch (error) {
      console.error(`❌ Background upload failed for session ${sessionId}:`, error);
      
      // Clean up temporary files on error
      try {
        // Clean up FFmpeg concatenation temp directory if used
        if (typeof tempDir !== 'undefined' && tempDir) {
          FFmpegService.cleanupTempFiles(tempDir);
        }
        
        // Clean up original uploaded files from Multer
        const originalFilePaths = files.map(file => file.path);
        FFmpegService.cleanupTempFiles(null, originalFilePaths);
        console.log(`🗑️ Cleaned up files after error`);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp files after error:', cleanupError.message);
      }
      
      // Update session status to failed
      try {
        await SessionService.updateSession(sessionId, { 
          status: 'failed',
          processing_metadata: {
            error: error.message,
            failed_at: new Date().toISOString()
          }
        }, userId, 'advisor');
      } catch (updateError) {
        console.error('Failed to update session status:', updateError);
      }

      // Emit error to user
      socketService.sendToUser(userId, 'upload_error', {
        sessionId,
        message: 'File upload failed. Please try again.',
        error: error.message
      });
    }
  }

  /**
   * Get sessions with their reports for current user (optimized single query)
   */
  static async getSessionsWithReports(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { 
        status, 
        client_id, 
        adviser_id, 
        search_term,
        date_from,
        date_to,
        sort_by,
        sort_direction 
      } = req.query;
      const filters = {};
      
      if (status) filters.status = status;
      if (client_id) filters.client_id = client_id;
      if (adviser_id && userRole === 'admin') filters.adviser_id = adviser_id;
      if (search_term) filters.search_term = search_term;
      if (date_from) filters.date_from = date_from;
      if (date_to) filters.date_to = date_to;
      if (sort_by) filters.sort_by = sort_by;
      if (sort_direction) filters.sort_direction = sort_direction;

      const result = await SessionService.getSessionsWithReports(
        userId, 
        userRole, 
        req.pagination,
        filters
      );

      res.json({
        success: true,
        message: 'Sessions with reports retrieved successfully',
        data: result
      });

    } catch (error) {
      console.error('Error getting sessions with reports:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get sessions for current user
   */
  static async getSessions(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { status, client_id } = req.query;
      
      const filters = {};
      if (status) filters.status = status;
      if (client_id) filters.client_id = client_id;

      const result = await SessionService.getSessionsForUser(
        userId, 
        userRole, 
        req.pagination,
        filters
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get session by ID
   */
  static async getSessionById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const session = await SessionService.getSessionById(id, userId, userRole);

      res.json({
        success: true,
        data: { session }
      });

    } catch (error) {
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Update session
   */
  static async updateSession(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      const updateData = req.body;

      const session = await SessionService.updateSession(id, updateData, userId, userRole);

      res.json({
        success: true,
        message: 'Session updated successfully',
        data: { session }
      });

    } catch (error) {
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Delete session (admin only)
   */
  static async deleteSession(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const result = await SessionService.deleteSession(id, userId, userRole);

      res.json({
        success: true,
        message: 'Session deleted successfully',
        data: result
      });

    } catch (error) {
      const statusCode = error.message.includes('not found') ? 404 : 
                        error.message.includes('Only admins') ? 403 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get session statistics
   */
  static async getSessionStats(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      const stats = await SessionService.getSessionStats(userId, userRole);

      res.json({
        success: true,
        data: { stats }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Search sessions
   */
  static async searchSessions(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { q: searchTerm, limit = 20 } = req.query;

      if (!searchTerm || searchTerm.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search term must be at least 2 characters long'
        });
      }

      const sessions = await SessionService.searchSessions(
        searchTerm.trim(),
        userId,
        userRole,
        parseInt(limit)
      );

      res.json({
        success: true,
        data: {
          sessions,
          searchTerm: searchTerm.trim()
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Validate session access
   */
  static async validateSessionAccess(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const hasAccess = await SessionService.validateSessionAccess(id, userId, userRole);

      res.json({
        success: true,
        data: {
          sessionId: id,
          hasAccess
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Update session status (for AI processing pipeline)
   */
  static async updateSessionStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, metadata } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      const validStatuses = [
        'uploaded', 'processing', 'transcribed', 
        'reports_generated', 'completed', 'failed'
      ];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status value'
        });
      }

      const updateData = { status };
      if (metadata) {
        updateData.processing_metadata = metadata;
      }

      const session = await SessionService.updateSession(id, updateData, userId, userRole);

      res.json({
        success: true,
        message: 'Session status updated successfully',
        data: { session }
      });

    } catch (error) {
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = SessionController;
