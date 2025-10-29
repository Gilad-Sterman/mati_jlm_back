const express = require('express');
const router = express.Router();

// Import controllers and middleware
const ReportController = require('../controllers/reportController');
const { authenticate, requireAdmin, requireAdminOrAdviser } = require('../middleware/auth');
const { 
  validateUUIDParam, 
  validatePagination 
} = require('../middleware/validation');

/**
 * @route   GET /api/reports
 * @desc    Get all reports (admin) or own reports (adviser)
 * @access  Private (Admin or Adviser)
 */
router.get('/', 
  authenticate, 
  requireAdminOrAdviser, 
  validatePagination, 
  ReportController.getReports
);

/**
 * @route   GET /api/reports/session/:sessionId
 * @desc    Get reports for a specific session
 * @access  Private (Admin or own session)
 */
router.get('/session/:sessionId', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('sessionId'), 
  ReportController.getReportsForSession
);

/**
 * @route   POST /api/reports/:id/approve
 * @desc    Approve report
 * @access  Private (Admin or own report)
 */
router.post('/:id/approve', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  ReportController.approveReport
);

/**
 * @route   POST /api/reports/:id/regenerate
 * @desc    Regenerate report with AI
 * @access  Private (Admin or own report)
 */
router.post('/:id/regenerate', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  ReportController.regenerateReport
);

/**
 * @route   GET /api/reports/:id
 * @desc    Get report by ID
 * @access  Private (Admin or own report)
 */
router.get('/:id', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  ReportController.getReportById
);

/**
 * @route   PUT /api/reports/:id
 * @desc    Update report
 * @access  Private (Admin or own report)
 */
router.put('/:id', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  ReportController.updateReport
);

// Test route
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Report routes working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
