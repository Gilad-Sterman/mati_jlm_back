const express = require('express');
const router = express.Router();

// Import controllers and middleware
const UserController = require('../controllers/userController');
const { authenticate, requireAdmin, requireAdminOrAdviser } = require('../middleware/auth');
const { 
  validateCreateUser, 
  validateUpdateUser, 
  validateUUIDParam, 
  validatePagination 
} = require('../middleware/validation');

/**
 * @route   GET /api/users
 * @desc    Get all users (admin only)
 * @access  Private (Admin)
 */
router.get('/', 
  authenticate, 
  requireAdmin, 
  validatePagination, 
  UserController.getAllUsers
);

/**
 * @route   POST /api/users
 * @desc    Create new user (admin only)
 * @access  Private (Admin)
 */
router.post('/', 
  authenticate, 
  requireAdmin, 
  validateCreateUser, 
  UserController.createUser
);

/**
 * @route   GET /api/users/stats
 * @desc    Get user statistics (admin only)
 * @access  Private (Admin)
 */
router.get('/stats', 
  authenticate, 
  requireAdmin, 
  UserController.getUserStats
);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private (Admin or own profile)
 */
router.get('/:id', 
  authenticate, 
  validateUUIDParam('id'), 
  UserController.getUserById
);

/**
 * @route   PUT /api/users/:id
 * @desc    Update user
 * @access  Private (Admin or own profile)
 */
router.put('/:id', 
  authenticate, 
  validateUUIDParam('id'), 
  validateUpdateUser, 
  UserController.updateUser
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user (admin only)
 * @access  Private (Admin)
 */
router.delete('/:id', 
  authenticate, 
  requireAdmin, 
  validateUUIDParam('id'), 
  UserController.deleteUser
);

/**
 * @route   GET /api/users/:id/clients
 * @desc    Get user's clients
 * @access  Private (Admin or own clients)
 */
router.get('/:id/clients', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  validatePagination, 
  UserController.getUserClients
);

/**
 * @route   GET /api/users/:id/sessions
 * @desc    Get user's sessions
 * @access  Private (Admin or own sessions)
 */
router.get('/:id/sessions', 
  authenticate, 
  requireAdminOrAdviser, 
  validateUUIDParam('id'), 
  validatePagination, 
  UserController.getUserSessions
);

// Test route
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'User routes working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
