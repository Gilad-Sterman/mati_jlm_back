const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { supabase, supabaseAdmin } = require('../config/database');
const authConfig = require('../config/auth');

class AuthService {
  /**
   * Generate JWT token for user
   */
  static generateToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status
    };

    return jwt.sign(payload, authConfig.jwt.secret, {
      expiresIn: authConfig.jwt.expiresIn
    });
  }

  /**
   * Generate refresh token
   */
  static generateRefreshToken(user) {
    const payload = {
      id: user.id,
      type: 'refresh'
    };

    return jwt.sign(payload, authConfig.jwt.secret, {
      expiresIn: authConfig.jwt.refreshExpiresIn
    });
  }

  /**
   * Verify JWT token
   */
  static verifyToken(token) {
    try {
      return jwt.verify(token, authConfig.jwt.secret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Hash password
   */
  static async hashPassword(password) {
    return await bcrypt.hash(password, authConfig.bcrypt.saltRounds);
  }

  /**
   * Compare password with hash
   */
  static async comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Login user with email and password
   */
  static async login(email, password) {
    try {
      // Use admin client to bypass RLS for authentication
      const client = supabaseAdmin || supabase;

      // Find user by email
      const { data: user, error } = await client
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('status', 'active')
        .single();

      if (error || !user) {
        throw new Error('Invalid email or password');
      }

      // Verify password
      const isValidPassword = await this.comparePassword(password, user.password_hash);
      if (!isValidPassword) {
        throw new Error('Invalid email or password');
      }

      // Generate tokens
      const token = this.generateToken(user);
      const refreshToken = this.generateRefreshToken(user);

      // Remove password hash from response
      const { password_hash, ...userWithoutPassword } = user;

      return {
        user: userWithoutPassword,
        token,
        refreshToken
      };

    } catch (error) {
      throw new Error(error.message || 'Login failed');
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(refreshToken) {
    try {
      const decoded = this.verifyToken(refreshToken);
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid refresh token');
      }

      // Get current user data
      const client = supabaseAdmin || supabase;
      const { data: user, error } = await client
        .from('users')
        .select('*')
        .eq('id', decoded.id)
        .eq('status', 'active')
        .single();

      if (error || !user) {
        throw new Error('User not found or inactive');
      }

      // Generate new access token
      const newToken = this.generateToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      // Remove password hash from response
      const { password_hash, ...userWithoutPassword } = user;

      return {
        user: userWithoutPassword,
        token: newToken,
        refreshToken: newRefreshToken
      };

    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId) {
    try {
      const client = supabaseAdmin || supabase;
      
      const { data: user, error } = await client
        .from('users')
        .select('id, email, name, role, status, created_at, updated_at')
        .eq('id', userId)
        .single();

      if (error || !user) {
        throw new Error('User not found');
      }

      return user;

    } catch (error) {
      throw new Error(error.message || 'Failed to get user');
    }
  }

  /**
   * Check if user has permission
   */
  static hasPermission(userRole, requiredPermission) {
    const permissions = authConfig.permissions[userRole] || [];
    return permissions.includes(requiredPermission);
  }

  /**
   * Check if user has any of the required roles
   */
  static hasRole(userRole, requiredRoles) {
    if (typeof requiredRoles === 'string') {
      return userRole === requiredRoles;
    }
    
    if (Array.isArray(requiredRoles)) {
      return requiredRoles.includes(userRole);
    }
    
    return false;
  }

  /**
   * Validate password strength
   */
  static validatePassword(password) {
    const minLength = 6;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);

    const errors = [];

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }

    if (!hasUpperCase) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!hasLowerCase) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!hasNumbers) {
      errors.push('Password must contain at least one number');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = AuthService;
