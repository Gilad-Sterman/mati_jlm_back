const AuthService = require('../services/authService');

/**
 * Middleware to authenticate JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify token
    const decoded = AuthService.verifyToken(token);
    
    // Get current user data
    const user = await AuthService.getUserById(decoded.id);
    
    // Add user to request object
    req.user = user;
    
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid token'
    });
  }
};

/**
 * Middleware to check if user has required role(s)
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const hasRole = AuthService.hasRole(req.user.role, roles);
    
    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

/**
 * Middleware to check if user has required permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const hasPermission = AuthService.hasPermission(req.user.role, permission);
    
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Permission required: ${permission}`
      });
    }

    next();
  };
};

/**
 * Middleware to check if user is admin
 */
const requireAdmin = requireRole('admin');

/**
 * Middleware to check if user is admin or adviser
 */
const requireAdminOrAdviser = requireRole(['admin', 'adviser']);

/**
 * Optional authentication - adds user to request if token is valid, but doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = AuthService.verifyToken(token);
      const user = await AuthService.getUserById(decoded.id);
      req.user = user;
    }
    
    next();
  } catch (error) {
    // Don't fail on optional auth, just continue without user
    next();
  }
};

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  requireAdmin,
  requireAdminOrAdviser,
  optionalAuth
};
