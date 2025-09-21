const SessionService = require('../services/sessionService');
const CloudinaryService = require('../services/cloudinaryService');

class SessionController {
  /**
   * Create new session with file upload
   */
  static async createSession(req, res) {
    try {
      const userId = req.user.id;
      const { client_id, title } = req.body;
      
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      // Validate required fields
      if (!client_id) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required'
        });
      }

      // Upload file to Cloudinary
      const uploadResult = await CloudinaryService.uploadTempFile(
        req.file.path,
        req.file.originalname,
        { folder: 'mati/sessions' }
      );

      // Prepare session data
      const sessionData = {
        client_id,
        title: title?.trim() || null,
        file_url: uploadResult.data.secure_url,
        file_name: req.file.originalname,
        file_size: req.file.size,
        file_type: req.file.mimetype,
        duration: uploadResult.data.duration ? Math.round(uploadResult.data.duration) : null
      };

      // Create session in database
      const session = await SessionService.createSession(sessionData, userId);

      res.status(201).json({
        success: true,
        message: 'Session created successfully',
        data: { session }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
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
