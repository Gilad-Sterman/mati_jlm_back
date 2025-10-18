const { supabase, supabaseAdmin } = require('../config/database');

class SessionService {
  /**
   * Create new session with file upload
   */
  static async createSession(sessionData, adviserId) {
    try {
      const client = supabaseAdmin || supabase;
      const {
        client_id,
        title,
        file_url,
        file_name,
        file_size,
        file_type,
        duration
      } = sessionData;

      // Validate client exists and belongs to adviser (or admin can access any)
      const { data: clientData, error: clientError } = await client
        .from('clients')
        .select('id, adviser_id')
        .eq('id', client_id)
        .single();

      if (clientError || !clientData) {
        throw new Error('Client not found');
      }

      // Check if adviser has access to this client (admins bypass this check)
      const { data: userData } = await client
        .from('users')
        .select('role')
        .eq('id', adviserId)
        .single();

      if (userData?.role !== 'admin' && clientData.adviser_id !== adviserId) {
        throw new Error('Access denied: Client does not belong to this adviser');
      }

      // Create session
      const { data: newSession, error } = await client
        .from('sessions')
        .insert({
          client_id,
          adviser_id: adviserId,
          title: title?.trim() || null,
          file_url,
          file_name,
          file_size,
          file_type,
          duration,
          status: 'uploaded'
        })
        .select(`
          id, client_id, adviser_id, title, file_url, file_name, 
          file_size, file_type, duration, status, created_at, updated_at,
          client:clients(id, name, email, metadata)
        `)
        .single();

      if (error) throw error;

      return newSession;

    } catch (error) {
      throw new Error(error.message || 'Failed to create session');
    }
  }

  /**
   * Get sessions for user (adviser sees own, admin sees all)
   */
  static async getSessionsForUser(userId, userRole, pagination = {}, filters = {}) {
    try {
      const client = supabaseAdmin || supabase;
      const { page = 1, limit = 20 } = pagination;
      const { status, client_id } = filters;
      const offset = (page - 1) * limit;

      let query = client
        .from('sessions')
        .select(`
          id, client_id, adviser_id, title, file_url, file_name, 
          file_size, file_type, duration, status, created_at, updated_at, transcription_text,
          client:clients(id, name, email, metadata),
          adviser:users(id, name, email)
        `);

      // Role-based filtering
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      // Apply filters
      if (status) {
        query = query.eq('status', status);
      }
      if (client_id) {
        query = query.eq('client_id', client_id);
      }

      // Get total count for pagination
      let countQuery = client
        .from('sessions')
        .select('*', { count: 'exact', head: true });

      if (userRole === 'adviser') {
        countQuery = countQuery.eq('adviser_id', userId);
      }
      if (status) {
        countQuery = countQuery.eq('status', status);
      }
      if (client_id) {
        countQuery = countQuery.eq('client_id', client_id);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      // Get sessions with pagination
      const { data: sessions, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        sessions,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };

    } catch (error) {
      throw new Error(error.message || 'Failed to get sessions');
    }
  }

  /**
   * Get session by ID with access control
   */
  static async getSessionById(sessionId, userId, userRole) {
    try {
      const client = supabaseAdmin || supabase;

      let query = client
        .from('sessions')
        .select(`
          id, client_id, adviser_id, title, file_url, file_name, 
          file_size, file_type, duration, status, transcription_text,
          transcription_metadata, processing_metadata, created_at, updated_at,
          client:clients(id, name, email, phone, metadata),
          adviser:users(id, name, email)
        `)
        .eq('id', sessionId);

      // If user is adviser, ensure they can only access their sessions
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: session, error } = await query.single();

      if (error || !session) {
        throw new Error('Session not found or access denied');
      }

      return session;

    } catch (error) {
      throw new Error(error.message || 'Failed to get session');
    }
  }

  /**
   * Update session status and metadata
   */
  static async updateSession(sessionId, updateData, userId, userRole) {
    try {
      const client = supabaseAdmin || supabase;

      // First check access
      await this.getSessionById(sessionId, userId, userRole);

      const allowedFields = [
        'title', 'status', 'transcription_text', 
        'transcription_metadata', 'processing_metadata'
      ];

      const updateFields = {};
      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          updateFields[key] = updateData[key];
        }
      });

      if (Object.keys(updateFields).length === 0) {
        throw new Error('No valid fields to update');
      }

      const { data: updatedSession, error } = await client
        .from('sessions')
        .update(updateFields)
        .eq('id', sessionId)
        .select(`
          id, client_id, adviser_id, title, file_url, file_name, 
          file_size, file_type, duration, status, created_at, updated_at,
          client:clients(id, name, email, metadata)
        `)
        .single();

      if (error) throw error;

      return updatedSession;

    } catch (error) {
      throw new Error(error.message || 'Failed to update session');
    }
  }

  /**
   * Delete session (admin only)
   */
  static async deleteSession(sessionId, userId, userRole) {
    try {
      if (userRole !== 'admin') {
        throw new Error('Only admins can delete sessions');
      }

      const client = supabaseAdmin || supabase;

      // Get session details first
      const session = await this.getSessionById(sessionId, userId, userRole);

      // Delete from database
      const { error } = await client
        .from('sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;

      return { deleted: true, session };

    } catch (error) {
      throw new Error(error.message || 'Failed to delete session');
    }
  }

  /**
   * Get session statistics
   */
  static async getSessionStats(userId, userRole) {
    try {
      const client = supabaseAdmin || supabase;

      let query = client
        .from('sessions')
        .select('status, created_at, file_size, duration');

      // Role-based filtering
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: sessions, error } = await query;
      if (error) throw error;

      // Calculate statistics
      const stats = {
        total: sessions.length,
        byStatus: {},
        totalFileSize: 0,
        totalDuration: 0,
        recentSessions: 0
      };

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      sessions.forEach(session => {
        // Count by status
        stats.byStatus[session.status] = (stats.byStatus[session.status] || 0) + 1;

        // Sum file sizes and durations
        if (session.file_size) {
          stats.totalFileSize += session.file_size;
        }
        if (session.duration) {
          stats.totalDuration += session.duration;
        }

        // Count recent sessions
        const createdAt = new Date(session.created_at);
        if (createdAt > thirtyDaysAgo) {
          stats.recentSessions++;
        }
      });

      return stats;

    } catch (error) {
      throw new Error(error.message || 'Failed to get session statistics');
    }
  }

  /**
   * Search sessions by title or client name
   */
  static async searchSessions(searchTerm, userId, userRole, limit = 20) {
    try {
      const client = supabaseAdmin || supabase;

      let query = client
        .from('sessions')
        .select(`
          id, client_id, adviser_id, title, file_name, status, created_at,
          client:clients(id, name, email)
        `)
        .or(`title.ilike.%${searchTerm}%,file_name.ilike.%${searchTerm}%`);

      // Role-based filtering
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: sessions, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return sessions;

    } catch (error) {
      throw new Error(error.message || 'Failed to search sessions');
    }
  }

  /**
   * Validate session access for user
   */
  static async validateSessionAccess(sessionId, userId, userRole) {
    try {
      if (userRole === 'admin') {
        return true; // Admin can access any session
      }

      const client = supabaseAdmin || supabase;
      
      const { data: session, error } = await client
        .from('sessions')
        .select('adviser_id')
        .eq('id', sessionId)
        .single();

      if (error || !session) {
        return false;
      }

      return session.adviser_id === userId;

    } catch (error) {
      return false;
    }
  }
}

module.exports = SessionService;
