const { supabase, supabaseAdmin } = require('../config/database');
const AuthService = require('./authService');

class UserService {
  /**
   * Get all users (admin only)
   */
  static async getAllUsers(pagination = {}) {
    try {
      const client = supabaseAdmin || supabase;
      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      // Get total count
      const { count, error: countError } = await client
        .from('users')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      // Get users with pagination
      const { data: users, error } = await client
        .from('users')
        .select('id, email, name, phone, role, status, created_at, updated_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        users,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };

    } catch (error) {
      throw new Error(error.message || 'Failed to get users');
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
        .select('id, email, name, phone, role, status, created_at, updated_at')
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
   * Create new user (admin only)
   */
  static async createUser(userData) {
    try {
      const client = supabaseAdmin || supabase;
      const { email, name, phone, password, role = 'adviser', status = 'inactive' } = userData;

      // Check if user already exists
      const { data: existingUser } = await client
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();

      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Validate password
      const passwordValidation = AuthService.validatePassword(password);
      if (!passwordValidation.isValid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash password
      const passwordHash = await AuthService.hashPassword(password);

      // Create user
      const { data: user, error } = await client
        .from('users')
        .insert({
          email: email.toLowerCase(),
          name,
          phone,
          password_hash: passwordHash,
          role,
          status
        })
        .select('id, email, name, phone, role, status, created_at, updated_at')
        .single();

      if (error) throw error;

      return user;

    } catch (error) {
      throw new Error(error.message || 'Failed to create user');
    }
  }

  /**
   * Update user
   */
  static async updateUser(userId, updateData) {
    try {
      const client = supabaseAdmin || supabase;
      const allowedFields = ['name', 'phone', 'role', 'status'];
      
      // Filter only allowed fields
      const filteredData = {};
      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key) && updateData[key] !== undefined) {
          filteredData[key] = updateData[key];
        }
      });

      if (Object.keys(filteredData).length === 0) {
        throw new Error('No valid fields to update');
      }

      // Update user
      const { data: user, error } = await client
        .from('users')
        .update(filteredData)
        .eq('id', userId)
        .select('id, email, name, phone, role, status, created_at, updated_at')
        .single();

      if (error) throw error;

      if (!user) {
        throw new Error('User not found');
      }

      return user;

    } catch (error) {
      throw new Error(error.message || 'Failed to update user');
    }
  }

  /**
   * Change user password
   */
  static async changePassword(userId, currentPassword, newPassword) {
    try {
      const client = supabaseAdmin || supabase;

      // Get user with password hash
      const { data: user, error: getUserError } = await client
        .from('users')
        .select('password_hash')
        .eq('id', userId)
        .single();

      if (getUserError || !user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValidPassword = await AuthService.comparePassword(currentPassword, user.password_hash);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Validate new password
      const passwordValidation = AuthService.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash new password
      const newPasswordHash = await AuthService.hashPassword(newPassword);

      // Update password
      const { error: updateError } = await client
        .from('users')
        .update({ password_hash: newPasswordHash })
        .eq('id', userId);

      if (updateError) throw updateError;

      return true;

    } catch (error) {
      throw new Error(error.message || 'Failed to change password');
    }
  }

  /**
   * Delete user (admin only)
   */
  static async deleteUser(userId) {
    try {
      const client = supabaseAdmin || supabase;

      // Check if user exists
      const { data: user, error: getUserError } = await client
        .from('users')
        .select('id, role')
        .eq('id', userId)
        .single();

      if (getUserError || !user) {
        throw new Error('User not found');
      }

      // Prevent deleting the last admin
      if (user.role === 'admin') {
        const { count, error: countError } = await client
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('status', 'active');

        if (countError) throw countError;

        if (count <= 1) {
          throw new Error('Cannot delete the last active admin user');
        }
      }

      // Delete user (this will cascade to related records)
      const { error: deleteError } = await client
        .from('users')
        .delete()
        .eq('id', userId);

      if (deleteError) throw deleteError;

      return true;

    } catch (error) {
      throw new Error(error.message || 'Failed to delete user');
    }
  }

  /**
   * Get user statistics (admin only)
   */
  static async getUserStats() {
    try {
      const client = supabaseAdmin || supabase;

      // Get user counts by role and status
      const { data: stats, error } = await client
        .from('users')
        .select('role, status')
        .order('role');

      if (error) throw error;

      // Process statistics
      const result = {
        total: stats.length,
        byRole: {},
        byStatus: {},
        active: 0,
        inactive: 0
      };

      stats.forEach(user => {
        // Count by role
        result.byRole[user.role] = (result.byRole[user.role] || 0) + 1;
        
        // Count by status
        result.byStatus[user.status] = (result.byStatus[user.status] || 0) + 1;
        
        // Count active/inactive
        if (user.status === 'active') {
          result.active++;
        } else {
          result.inactive++;
        }
      });

      return result;

    } catch (error) {
      throw new Error(error.message || 'Failed to get user statistics');
    }
  }
}

module.exports = UserService;
