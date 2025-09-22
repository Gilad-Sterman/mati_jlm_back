const SessionService = require('../services/sessionService');
const CloudinaryService = require('../services/cloudinaryService');
const ClientService = require('../services/clientService');
const socketService = require('../services/socketService');

class SessionController {
  /**
   * Create new session with file upload (supports creating new client) - Async with socket notifications
   */
  static async createSession(req, res) {
    try {
      const userId = req.user.id;
      const { client_id, title, newClient } = req.body;
      
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
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

      // Create session in database with temporary file info (before Cloudinary upload)
      const sessionData = {
        client_id: finalClientId,
        title: title?.trim() || null,
        file_url: null, // Will be updated after Cloudinary upload
        file_name: req.file.originalname,
        file_size: req.file.size,
        file_type: req.file.mimetype,
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
        fileName: req.file.originalname,
        fileSize: req.file.size,
        message: 'File upload to cloud storage started'
      });

      // Start background Cloudinary upload
      SessionController.handleBackgroundUpload(session.id, req.file, userId);

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
  static async handleBackgroundUpload(sessionId, file, userId) {
    try {
      console.log(`🚀 Starting background upload for session ${sessionId}`);
      
      // Emit progress update
      console.log(`📡 Sending upload_progress to user ${userId}`);
      const progressSent = socketService.sendToUser(userId, 'upload_progress', {
        sessionId,
        progress: 10,
        message: 'Preparing file for upload...'
      });
      console.log(`📡 Progress event sent: ${progressSent}`);

      // Upload file to Cloudinary
      const uploadResult = await CloudinaryService.uploadTempFile(
        file.path,
        file.originalname,
        { folder: 'mati/sessions' }
      );

      // Emit progress update
      console.log(`📡 Sending upload_progress (80%) to user ${userId}`);
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
          upload_completed_at: new Date().toISOString()
        }
      };

      await SessionService.updateSession(sessionId, updateData, userId, 'advisor');

      // Emit final success
      console.log(`📡 Sending upload_complete to user ${userId}`);
      const completeSent = socketService.sendToUser(userId, 'upload_complete', {
        sessionId,
        progress: 100,
        message: 'File upload completed successfully!',
        fileUrl: uploadResult.data.secure_url,
        duration: updateData.duration
      });
      console.log(`📡 Complete event sent: ${completeSent}`);

      console.log(`✅ Background upload completed for session ${sessionId}`);

    } catch (error) {
      console.error(`❌ Background upload failed for session ${sessionId}:`, error);
      
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
