const { supabase, supabaseAdmin } = require('../config/database');

class ClientService {
  /**
   * Get clients for adviser (own clients) or admin (all clients)
   */
  static async getClientsForUser(userId, userRole, pagination = {}) {
    try {
      const client = supabaseAdmin || supabase;
      const { page = 1, limit = 50 } = pagination;
      const offset = (page - 1) * limit;

      let query = client
        .from('clients')
        .select('id, name, email, phone, metadata, adviser_id, created_at, updated_at');

      // If user is adviser, only show their clients
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }
      // Admin can see all clients (no filter needed)

      // Get total count for pagination
      const countQuery = client
        .from('clients')
        .select('*', { count: 'exact', head: true });
      
      if (userRole === 'adviser') {
        countQuery.eq('adviser_id', userId);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      // Get clients with pagination
      const { data: clients, error } = await query
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        clients,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };

    } catch (error) {
      throw new Error(error.message || 'Failed to get clients');
    }
  }

  /**
   * Get client by ID (with access control)
   */
  static async getClientById(clientId, userId, userRole) {
    try {
      const client = supabaseAdmin || supabase;

      let query = client
        .from('clients')
        .select('id, name, email, phone, metadata, adviser_id, created_at, updated_at')
        .eq('id', clientId);

      // If user is adviser, ensure they can only access their clients
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: clientData, error } = await query.single();

      if (error || !clientData) {
        throw new Error('Client not found or access denied');
      }

      return clientData;

    } catch (error) {
      throw new Error(error.message || 'Failed to get client');
    }
  }

  /**
   * Create new client
   */
  static async createClient(clientData, adviserId) {
    try {
      const client = supabaseAdmin || supabase;
      const { name, email, phone, metadata } = clientData;

      // Check if client with same email already exists for this adviser
      if (email) {
        const { data: existingClient } = await client
          .from('clients')
          .select('id')
          .eq('email', email.toLowerCase())
          .eq('adviser_id', adviserId)
          .single();

        if (existingClient) {
          throw new Error('Client with this email already exists for this adviser');
        }
      }

      // Create client
      const { data: newClient, error } = await client
        .from('clients')
        .insert({
          name: name.trim(),
          email: email ? email.toLowerCase().trim() : null,
          phone: phone ? phone.trim() : null,
          metadata: metadata || {},
          adviser_id: adviserId
        })
        .select('id, name, email, phone, metadata, adviser_id, created_at, updated_at')
        .single();

      if (error) throw error;

      return newClient;

    } catch (error) {
      throw new Error(error.message || 'Failed to create client');
    }
  }

  /**
   * Search clients by name or email (for selection during upload)
   */
  static async searchClients(searchTerm, userId, userRole, limit = 20) {
    try {
      const client = supabaseAdmin || supabase;
      
      let query = client
        .from('clients')
        .select('id, name, email, phone, metadata, adviser_id')
        .or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,metadata->>business_domain.ilike.%${searchTerm}%`);

      // If user is adviser, only search their clients
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: clients, error } = await query
        .order('name', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return clients;

    } catch (error) {
      throw new Error(error.message || 'Failed to search clients');
    }
  }

  /**
   * Get client statistics for adviser/admin
   */
  static async getClientStats(userId, userRole) {
    try {
      const client = supabaseAdmin || supabase;

      let query = client
        .from('clients')
        .select('adviser_id, created_at');

      // If user is adviser, only count their clients
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: clients, error } = await query;
      if (error) throw error;

      // Calculate statistics
      const stats = {
        total: clients.length,
        byAdviser: {},
        recentlyAdded: 0
      };

      // Count clients by adviser (useful for admin view)
      clients.forEach(clientData => {
        const adviserId = clientData.adviser_id;
        stats.byAdviser[adviserId] = (stats.byAdviser[adviserId] || 0) + 1;

        // Count clients added in last 30 days
        const createdAt = new Date(clientData.created_at);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        if (createdAt > thirtyDaysAgo) {
          stats.recentlyAdded++;
        }
      });

      return stats;

    } catch (error) {
      throw new Error(error.message || 'Failed to get client statistics');
    }
  }

  /**
   * Check if client belongs to adviser (for access control)
   */
  static async validateClientAccess(clientId, userId, userRole) {
    try {
      if (userRole === 'admin') {
        return true; // Admin can access any client
      }

      const client = supabaseAdmin || supabase;
      
      const { data: clientData, error } = await client
        .from('clients')
        .select('adviser_id')
        .eq('id', clientId)
        .single();

      if (error || !clientData) {
        return false;
      }

      return clientData.adviser_id === userId;

    } catch (error) {
      return false;
    }
  }

  /**
   * Get clients with session count (for upload selection)
   */
  static async getClientsWithSessionCount(userId, userRole, limit = 50) {
    try {
      const client = supabaseAdmin || supabase;

      // Build the query based on user role
      let clientsQuery = `
        id, name, email, phone, metadata, adviser_id, created_at,
        sessions:sessions(count)
      `;

      let query = client
        .from('clients')
        .select(clientsQuery);

      // If user is adviser, only show their clients
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: clients, error } = await query
        .order('name', { ascending: true })
        .limit(limit);

      if (error) throw error;

      // Transform the data to include session count
      const clientsWithCount = clients.map(clientData => ({
        ...clientData,
        session_count: clientData.sessions?.[0]?.count || 0,
        sessions: undefined // Remove the sessions object
      }));

      return clientsWithCount;

    } catch (error) {
      throw new Error(error.message || 'Failed to get clients with session count');
    }
  }
}

module.exports = ClientService;
