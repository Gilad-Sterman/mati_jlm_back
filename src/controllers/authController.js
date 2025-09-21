const AuthService = require('../services/authService');

class AuthController {
  /**
   * Login user
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      
      const result = await AuthService.login(email, password);
      
      res.json({
        success: true,
        message: 'Login successful',
        data: result
      });
      
    } catch (error) {
      res.status(401).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
      }
      
      const result = await AuthService.refreshToken(refreshToken);
      
      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: result
      });
      
    } catch (error) {
      res.status(401).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get current user profile
   */
  static async getProfile(req, res) {
    try {
      // User is already attached to req by auth middleware
      res.json({
        success: true,
        data: {
          user: req.user
        }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get user profile'
      });
    }
  }

  /**
   * Update current user profile
   */
  static async updateProfile(req, res) {
    try {
      const { name } = req.body;
      const userId = req.user.id;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Name is required'
        });
      }
      
      const userService = require('../services/userService');
      const updatedUser = await userService.updateUser(userId, { name });
      
      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: updatedUser
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
   * Change password
   */
  static async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
        });
      }
      
      // Validate new password strength
      const passwordValidation = AuthService.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet requirements',
          errors: passwordValidation.errors
        });
      }
      
      const userService = require('../services/userService');
      await userService.changePassword(userId, currentPassword, newPassword);
      
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
      
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Logout (client-side token invalidation)
   */
  static async logout(req, res) {
    try {
      // In a JWT-based system, logout is typically handled client-side
      // by removing the token from storage. We could implement a token blacklist
      // here if needed for additional security.
      
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
  }

  /**
   * Validate token (for client-side token checking)
   */
  static async validateToken(req, res) {
    try {
      // If we reach here, the auth middleware has already validated the token
      res.json({
        success: true,
        message: 'Token is valid',
        data: {
          user: req.user
        }
      });
      
    } catch (error) {
      res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  }
}

module.exports = AuthController;
