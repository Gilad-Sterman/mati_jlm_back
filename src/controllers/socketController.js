class SocketController {
  /**
   * Get connected users (admin only)
   */
  static async getConnectedUsers(req, res) {
    try {
      const socketService = req.app.get('socketService');
      const users = socketService.getConnectedUsers();

      res.json({
        success: true,
        data: { users }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get socket connection statistics (admin only)
   */
  static async getSocketStats(req, res) {
    try {
      const socketService = req.app.get('socketService');
      const stats = socketService.getStats();

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
   * Send message to specific user (admin only)
   */
  static async sendMessageToUser(req, res) {
    try {
      const { userId, event, data } = req.body;
      
      if (!userId || !event) {
        return res.status(400).json({
          success: false,
          message: 'userId and event are required'
        });
      }

      const socketService = req.app.get('socketService');
      const sent = socketService.sendToUser(userId, event, data);

      res.json({
        success: true,
        data: {
          sent,
          message: sent ? 'Message sent successfully' : 'User not connected'
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
   * Send message to all users with specific role (admin only)
   */
  static async sendMessageToRole(req, res) {
    try {
      const { role, event, data } = req.body;
      
      if (!role || !event) {
        return res.status(400).json({
          success: false,
          message: 'role and event are required'
        });
      }

      const validRoles = ['admin', 'adviser'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role'
        });
      }

      const socketService = req.app.get('socketService');
      socketService.sendToRole(role, event, data);

      res.json({
        success: true,
        data: {
          message: `Message sent to all users with role: ${role}`
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
   * Broadcast message to all connected users (admin only)
   */
  static async broadcastMessage(req, res) {
    try {
      const { event, data } = req.body;
      
      if (!event) {
        return res.status(400).json({
          success: false,
          message: 'event is required'
        });
      }

      const socketService = req.app.get('socketService');
      socketService.broadcast(event, data);

      res.json({
        success: true,
        data: {
          message: 'Message broadcasted to all connected users'
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
   * Send session update to subscribers (for AI processing)
   */
  static async sendSessionUpdate(req, res) {
    try {
      const { sessionId, event, data } = req.body;
      
      if (!sessionId || !event) {
        return res.status(400).json({
          success: false,
          message: 'sessionId and event are required'
        });
      }

      const socketService = req.app.get('socketService');
      socketService.sendToSession(sessionId, event, data);

      res.json({
        success: true,
        data: {
          message: `Session update sent to subscribers of session: ${sessionId}`
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
   * Test socket connection
   */
  static async testConnection(req, res) {
    try {
      const socketService = req.app.get('socketService');
      const stats = socketService.getStats();

      // Send test message to current user
      const testSent = socketService.sendToUser(req.user.id, 'test_message', {
        message: 'Socket connection test successful!',
        timestamp: new Date(),
        from: 'server'
      });

      res.json({
        success: true,
        data: {
          message: 'Socket test completed',
          userConnected: testSent,
          totalConnections: stats.totalConnected,
          connectionsByRole: stats.byRole
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = SocketController;
