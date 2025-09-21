const ClientService = require('../services/clientService');

class ClientController {
  /**
   * Get clients for current user (adviser sees own, admin sees all)
   */
  static async getClients(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const result = await ClientService.getClientsForUser(userId, userRole, req.pagination);
      
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
   * Get clients with session count (for upload selection dropdown)
   */
  static async getClientsForSelection(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { limit = 50 } = req.query;
      
      const clients = await ClientService.getClientsWithSessionCount(
        userId, 
        userRole, 
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: {
          clients
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
   * Search clients by name or email
   */
  static async searchClients(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { q: searchTerm, limit = 20 } = req.query;
      
      if (!searchTerm || searchTerm.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search term must be at least 2 characters long'
        });
      }
      
      const clients = await ClientService.searchClients(
        searchTerm.trim(), 
        userId, 
        userRole, 
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: {
          clients,
          searchTerm: searchTerm.trim()
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
   * Get client by ID
   */
  static async getClientById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const client = await ClientService.getClientById(id, userId, userRole);
      
      res.json({
        success: true,
        data: { client }
      });
      
    } catch (error) {
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Create new client
   */
  static async createClient(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const clientData = req.body;
      
      // Determine adviser ID
      let adviserId = userId; // Default to current user
      
      // If admin is creating client, they can specify adviser_id
      if (userRole === 'admin' && clientData.adviser_id) {
        adviserId = clientData.adviser_id;
      }
      
      const client = await ClientService.createClient(clientData, adviserId);
      
      res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: { client }
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
   * Get client statistics
   */
  static async getClientStats(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const stats = await ClientService.getClientStats(userId, userRole);
      
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
   * Validate client access (utility endpoint)
   */
  static async validateClientAccess(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const hasAccess = await ClientService.validateClientAccess(id, userId, userRole);
      
      res.json({
        success: true,
        data: {
          clientId: id,
          hasAccess
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
   * Quick create client (for use during upload process)
   */
  static async quickCreateClient(req, res) {
    try {
      const userId = req.user.id;
      const { name, email, business_domain, business_number } = req.body;
      
      if (!name || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Client name is required and must be at least 2 characters'
        });
      }
      
      // Build metadata object from individual fields
      const metadata = {};
      if (business_domain && business_domain.trim()) {
        metadata.business_domain = business_domain.trim();
      }
      if (business_number && business_number.trim()) {
        metadata.business_number = business_number.trim();
      }
      
      const clientData = {
        name: name.trim(),
        email: email ? email.trim() : null,
        metadata: Object.keys(metadata).length > 0 ? metadata : {}
      };
      
      const client = await ClientService.createClient(clientData, userId);
      
      res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: { client }
      });
      
    } catch (error) {
      const statusCode = error.message.includes('already exists') ? 409 : 400;
      res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = ClientController;
