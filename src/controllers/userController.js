const UserService = require('../services/userService');

class UserController {
  /**
   * Get all users (admin only)
   */
  static async getAllUsers(req, res) {
    try {
      const result = await UserService.getAllUsers(req.pagination);
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(req, res) {
    try {
      const { id } = req.params;
      
      // Users can only view their own profile unless they're admin
      if (req.user.role !== 'admin' && req.user.id !== id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      const user = await UserService.getUserById(id);
      
      res.json({
        success: true,
        data: { user }
      });
      
    } catch (error) {
      const statusCode = error.message === 'User not found' ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Create new user (admin only)
   */
  static async createUser(req, res) {
    try {
      const userData = req.body;
      
      const user = await UserService.createUser(userData);
      
      res.status(201).json({
        success: true,
        message: 'User created successfully',
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
   * Update user
   */
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      // Users can only update their own profile (except role/status)
      if (req.user.role !== 'admin' && req.user.id !== id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      // Non-admin users cannot change role or status
      if (req.user.role !== 'admin') {
        delete updateData.role;
        delete updateData.status;
      }
      
      const user = await UserService.updateUser(id, updateData);
      
      res.json({
        success: true,
        message: 'User updated successfully',
        data: { user }
      });
      
    } catch (error) {
      const statusCode = error.message === 'User not found' ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Delete user (admin only)
   */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      
      // Prevent users from deleting themselves
      if (req.user.id === id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete your own account'
        });
      }
      
      await UserService.deleteUser(id);
      
      res.json({
        success: true,
        message: 'User deleted successfully'
      });
      
    } catch (error) {
      const statusCode = error.message === 'User not found' ? 404 : 400;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get user statistics (admin only)
   */
  static async getUserStats(req, res) {
    try {
      const stats = await UserService.getUserStats();
      
      res.json({
        success: true,
        data: { stats }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get current user's clients
   */
  static async getUserClients(req, res) {
    try {
      const userId = req.user.id;
      
      // Only advisers have clients, admins can view all
      if (req.user.role !== 'admin' && req.user.role !== 'adviser') {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      const clientService = require('../services/clientService');
      const clients = await clientService.getClientsByAdviser(userId, req.pagination);
      
      res.json({
        success: true,
        data: clients
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get current user's sessions
   */
  static async getUserSessions(req, res) {
    try {
      const userId = req.user.id;
      
      if (req.user.role !== 'admin' && req.user.role !== 'adviser') {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      const sessionService = require('../services/sessionService');
      const sessions = await sessionService.getSessionsByAdviser(userId, req.pagination);
      
      res.json({
        success: true,
        data: sessions
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = UserController;
