const express = require('express');
const router = express.Router();

// Import controllers and middleware
const ClientController = require('../controllers/clientController');
const { authenticate, requireAdmin, requireAdminOrAdviser } = require('../middleware/auth');
const { 
  validateCreateClient, 
  validateUUIDParam, 
  validatePagination 
} = require('../middleware/validation');

/**
 * @route   GET /api/clients
 * @desc    Get all clients (admin) or own clients (adviser)
 * @access  Private (Admin or Adviser)
 */
router.get('/', 
  authenticate, 
  requireAdminOrAdviser, 
  validatePagination, 
  ClientController.getClients
);

/**
 * @route   GET /api/clients/selection
 * @desc    Get clients for selection dropdown (with session count)
 * @access  Private (Admin or Adviser)
 */
router.get('/selection', 
  authenticate, 
  requireAdminOrAdviser, 
  ClientController.getClientsForSelection
);

/**
 * @route   GET /api/clients/search
 * @desc    Search clients by name or email
 * @access  Private (Admin or Adviser)
 */
router.get('/search', 
  authenticate, 
  requireAdminOrAdviser, 
  ClientController.searchClients
);

/**
 * @route   GET /api/clients/stats
 * @desc    Get client statistics
 * @access  Private (Admin or Adviser)
 */
router.get('/stats', 
  authenticate, 
  requireAdminOrAdviser, 
  ClientController.getClientStats
);

/**
 * @route   POST /api/clients
 * @desc    Create new client
 * @access  Private (Admin or Adviser)
 */
router.post('/', 
  authenticate, 
  requireAdminOrAdviser, 
  validateCreateClient, 
  ClientController.createClient
);

/**
 * @route   POST /api/clients/quick
 * @desc    Quick create client (for upload process)
 * @access  Private (Admin or Adviser)
 */
router.post('/quick', 
  authenticate, 
  requireAdminOrAdviser, 
  ClientController.quickCreateClient
);

/**
 * @route   GET /api/clients/:id
 * @desc    Get client by ID
 * @access  Private (Admin or own client)
 */
router.get('/:id', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  ClientController.getClientById
);

/**
 * @route   GET /api/clients/:id/validate-access
 * @desc    Validate client access for current user
 * @access  Private (Admin or Adviser)
 */
router.get('/:id/validate-access', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  ClientController.validateClientAccess
);

// Update and delete routes will be added later if needed

// Test route
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Client routes working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
