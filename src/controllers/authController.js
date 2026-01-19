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
   * Register new adviser
   */
  static async register(req, res) {
    try {
      const { email, name, phone, password } = req.body;
      
      // Validate required fields
      if (!email || !name || !phone || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email, name, phone, and password are required'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      // Validate phone format
      const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format'
        });
      }

      // Validate password strength
      const passwordValidation = AuthService.validatePassword(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet requirements',
          errors: passwordValidation.errors
        });
      }

      const userService = require('../services/userService');
      const user = await userService.createUser({
        email,
        name,
        phone,
        password,
        role: 'adviser',
        status: 'inactive'  // New advisers start as inactive until approved by admin
      });
      
      res.status(201).json({
        success: true,
        message: 'Registration successful. Your account is pending approval by an administrator.',
        data: { user }
      });
      
    } catch (error) {
      const statusCode = error.message.includes('already exists') ? 409 : 400;
      res.status(statusCode).json({
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

  /**
   * Forgot password - send reset email
   */
  static async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      // Clean and validate email format
      const cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      const PasswordResetService = require('../services/passwordResetService');
      const result = await PasswordResetService.createResetToken(cleanEmail);
      
      res.json({
        success: true,
        message: result.message
      });
      
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process password reset request'
      });
    }
  }

  /**
   * Reset password with token
   */
  static async resetPassword(req, res) {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({
          success: false,
          message: 'Token and password are required'
        });
      }

      // Validate password strength
      const passwordValidation = AuthService.validatePassword(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet requirements',
          errors: passwordValidation.errors
        });
      }

      const PasswordResetService = require('../services/passwordResetService');
      const result = await PasswordResetService.resetPassword(token, password);
      
      res.json({
        success: true,
        message: result.message
      });
      
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to reset password'
      });
    }
  }
}

module.exports = AuthController;
