const express = require('express');
const router = express.Router();

// Import controllers and middleware
const SessionController = require('../controllers/sessionController');
const CloudinaryService = require('../services/cloudinaryService');
const { authenticate, requireAdmin, requireAdminOrAdviser } = require('../middleware/auth');
const { 
  validateUUIDParam, 
  validatePagination 
} = require('../middleware/validation');

/**
 * @route   GET /api/sessions/with-reports
 * @desc    Get all sessions with their reports in a single optimized query
 * @access  Private (Admin or Adviser)
 */
router.get('/with-reports', 
  authenticate, 
  requireAdminOrAdviser, 
  validatePagination, 
  SessionController.getSessionsWithReports
);

/**
 * @route   GET /api/sessions
 * @desc    Get all sessions (admin) or own sessions (adviser)
 * @access  Private (Admin or Adviser)
 */
router.get('/', 
  authenticate, 
  requireAdminOrAdviser, 
  validatePagination, 
  SessionController.getSessions
);

/**
 * @route   GET /api/sessions/search
 * @desc    Search sessions by title or file name
 * @access  Private (Admin or Adviser)
 */
router.get('/search', 
  authenticate, 
  requireAdminOrAdviser, 
  SessionController.searchSessions
);

/**
 * @route   GET /api/sessions/stats
 * @desc    Get session statistics
 * @access  Private (Admin or Adviser)
 */
router.get('/stats', 
  authenticate, 
  requireAdminOrAdviser, 
  SessionController.getSessionStats
);

/**
 * @route   POST /api/sessions
 * @desc    Create new session (upload recording)
 * @access  Private (Admin or Adviser)
 */
router.post('/', 
  authenticate, 
  requireAdminOrAdviser,
  CloudinaryService.createUploadMiddleware().array('files', 10), // Allow up to 10 files
  SessionController.createSession
);

/**
 * @route   GET /api/sessions/:id
 * @desc    Get session by ID
 * @access  Private (Admin or own session)
 */
router.get('/:id', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  SessionController.getSessionById
);

/**
 * @route   GET /api/sessions/:id/validate-access
 * @desc    Validate session access for current user
 * @access  Private (Admin or Adviser)
 */
router.get('/:id/validate-access', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  SessionController.validateSessionAccess
);

/**
 * @route   PUT /api/sessions/:id
 * @desc    Update session
 * @access  Private (Admin or own session)
 */
router.put('/:id', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  SessionController.updateSession
);

/**
 * @route   PUT /api/sessions/:id/status
 * @desc    Update session status (for AI processing)
 * @access  Private (Admin or own session)
 */
router.put('/:id/status', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  SessionController.updateSessionStatus
);

/**
 * @route   DELETE /api/sessions/:id
 * @desc    Delete session (admin only)
 * @access  Private (Admin)
 */
router.delete('/:id', 
  authenticate, 
  requireAdmin, 
  validateUUIDParam('id'), 
  SessionController.deleteSession
);

// Test route
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Session routes working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
