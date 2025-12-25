const socketService = require('../services/socketService');

class WorkerController {
  /**
   * Receive progress updates from external worker
   */
  static async receiveProgress(req, res) {
    try {
      const { userId, sessionId, eventType, data, workerKey, timestamp } = req.body;
      
      // Validate worker authentication
      if (workerKey !== process.env.WORKER_API_KEY) {
        console.warn(`❌ Unauthorized worker request from ${req.ip}`);
        return res.status(401).json({ 
          success: false,
          error: 'Unauthorized worker request' 
        });
      }

      // Validate required fields
      if (!userId || !eventType || !data) {
        console.warn(`⚠️ Invalid worker request: missing required fields`);
        return res.status(400).json({ 
          success: false,
          error: 'Missing required fields: userId, eventType, data' 
        });
      }
      
      // Log the progress update for debugging
      console.log(`📡 Worker progress: ${eventType} for user ${userId} (session: ${sessionId})`);
      
      // Send socket event to user (existing functionality)
      socketService.sendToUser(userId, eventType, {
        sessionId,
        timestamp: timestamp || new Date().toISOString(),
        ...data
      });
      
      // Also send to session room if sessionId is provided
      if (sessionId) {
        socketService.sendToSession(sessionId, eventType, {
          sessionId,
          timestamp: timestamp || new Date().toISOString(),
          ...data
        });
      }
      
      console.log(`✅ Forwarded ${eventType} to user ${userId} via socket`);
      res.status(200).json({ 
        success: true,
        message: 'Progress update forwarded successfully',
        eventType,
        userId,
        sessionId
      });
      
    } catch (error) {
      console.error('❌ Worker progress webhook error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error processing worker progress update' 
      });
    }
  }

  /**
   * Health check endpoint for worker validation
   */
  static async healthCheck(req, res) {
    try {
      const { workerKey, timestamp, status } = req.body;
      
      // Validate worker authentication
      if (workerKey !== process.env.WORKER_API_KEY) {
        console.warn(`❌ Unauthorized worker health check from ${req.ip}`);
        return res.status(401).json({ 
          success: false,
          error: 'Unauthorized' 
        });
      }

      console.log(`💓 Worker health check: ${status} at ${timestamp}`);
      
      res.status(200).json({ 
        success: true,
        message: 'Web server is healthy',
        timestamp: new Date().toISOString(),
        serverStatus: 'healthy'
      });
      
    } catch (error) {
      console.error('❌ Worker health check error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error' 
      });
    }
  }

  /**
   * Get worker configuration (for debugging)
   */
  static async getWorkerConfig(req, res) {
    try {
      // This endpoint can be used by admins to check worker configuration
      const config = {
        useEmbeddedWorker: process.env.USE_EMBEDDED_WORKER === 'true',
        hasWorkerApiKey: !!process.env.WORKER_API_KEY,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      };

      res.status(200).json({ 
        success: true,
        config
      });
      
    } catch (error) {
      console.error('❌ Worker config error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error' 
      });
    }
  }
}

module.exports = WorkerController;
