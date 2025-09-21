const express = require('express');
const router = express.Router();

// Import controllers and middleware
const SocketController = require('../controllers/socketController');
const { authenticate, requireAdmin, requireAdminOrAdviser } = require('../middleware/auth');
const { validateUUIDParam } = require('../middleware/validation');

/**
 * @route   GET /api/socket/users
 * @desc    Get connected users (admin only)
 * @access  Private (Admin)
 */
router.get('/users', 
  authenticate, 
  requireAdmin, 
  SocketController.getConnectedUsers
);

/**
 * @route   GET /api/socket/stats
 * @desc    Get socket connection statistics (admin only)
 * @access  Private (Admin)
 */
router.get('/stats', 
  authenticate, 
  requireAdmin, 
  SocketController.getSocketStats
);

/**
 * @route   GET /api/socket/test
 * @desc    Test socket connection for current user
 * @access  Private (Admin or Adviser)
 */
router.get('/test', 
  authenticate, 
  requireAdminOrAdviser, 
  SocketController.testConnection
);

/**
 * @route   POST /api/socket/send-to-user
 * @desc    Send message to specific user (admin only)
 * @access  Private (Admin)
 */
router.post('/send-to-user', 
  authenticate, 
  requireAdmin, 
  SocketController.sendMessageToUser
);

/**
 * @route   POST /api/socket/send-to-role
 * @desc    Send message to all users with specific role (admin only)
 * @access  Private (Admin)
 */
router.post('/send-to-role', 
  authenticate, 
  requireAdmin, 
  SocketController.sendMessageToRole
);

/**
 * @route   POST /api/socket/broadcast
 * @desc    Broadcast message to all connected users (admin only)
 * @access  Private (Admin)
 */
router.post('/broadcast', 
  authenticate, 
  requireAdmin, 
  SocketController.broadcastMessage
);

/**
 * @route   POST /api/socket/session-update
 * @desc    Send session update to subscribers (for AI processing)
 * @access  Private (Admin or Adviser)
 */
router.post('/session-update', 
  authenticate, 
  requireAdminOrAdviser, 
  SocketController.sendSessionUpdate
);

// Test route
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Socket routes working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
