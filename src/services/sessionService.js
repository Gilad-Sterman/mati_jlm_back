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
          client:clients(id, name, email, phone, metadata)
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
          client:clients(id, name, email, phone, metadata),
          adviser:users(id, name, email, phone)
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
          adviser:users(id, name, email, phone)
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
          client:clients(id, name, email, phone, metadata)
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
   * Get comprehensive dashboard statistics including adviser performance
   */
  static async getSessionStats(userId, userRole) {
    try {
      const client = supabaseAdmin || supabase;

      // Get sessions with adviser and report data (similar to getSessionsWithReports)
      let query = client
        .from('sessions')
        .select(`
          id, client_id, adviser_id, title, file_url, file_name, 
          file_size, file_type, duration, status, created_at, updated_at,
          client:clients(id, name, email, phone, metadata),
          adviser:users(id, name, email, phone),
          reports(
            id, session_id, type, status, content, created_at, updated_at,
            version_number, is_current_version
          )
        `);

      // Role-based filtering
      if (userRole === 'adviser') {
        query = query.eq('adviser_id', userId);
      }

      const { data: sessions, error } = await query;
      if (error) throw error;


      // Calculate basic statistics
      const stats = {
        totalSessions: sessions.length,
        sessionsByStatus: {},
        totalFileSize: 0,
        totalDuration: 0,
        recentSessions: 0,
        lastSessions: [],
        averageScores: {
          advisorPerformance: 0,
          entrepreneurReadiness: 0
        },
        topAdvisers: [],
        worstAdvisers: []
      };

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Track adviser performance
      const adviserStats = new Map();
      let totalAdvisorScores = [];
      let totalEntrepreneurScores = [];

      sessions.forEach(session => {
        // Count by status
        stats.sessionsByStatus[session.status] = (stats.sessionsByStatus[session.status] || 0) + 1;

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

        // Process adviser performance
        if (session.adviser) {
          const adviserId = session.adviser.id;
          if (!adviserStats.has(adviserId)) {
            adviserStats.set(adviserId, {
              id: adviserId,
              name: session.adviser.name,
              email: session.adviser.email,
              totalSessions: 0,
              completedSessions: 0,
              scores: []
            });
          }

          const adviserData = adviserStats.get(adviserId);
          adviserData.totalSessions++;
          
          // Count sessions with "completed" status as successful
          if (session.status === 'completed') {
            adviserData.completedSessions++;
          }

          // Extract scores from reports
          if (session.reports && session.reports.length > 0) {
            session.reports
              .filter(report => report.is_current_version)
              .forEach(report => {
                try {
                  const content = typeof report.content === 'string' 
                    ? JSON.parse(report.content) 
                    : report.content;

                  if (report.type === 'adviser' && content) {
                    // Extract adviser performance score - handle both new and legacy structures
                    let advisorScore = null;
                    
                    // NEW STRUCTURE: Calculate average from listening, clarity, continuation scores (0-5 scale)
                    if (content.listening?.score && content.clarity?.score && content.continuation?.score) {
                      const listeningScore = parseFloat(content.listening.score);
                      const clarityScore = parseFloat(content.clarity.score);
                      const continuationScore = parseFloat(content.continuation.score);
                      
                      if (!isNaN(listeningScore) && !isNaN(clarityScore) && !isNaN(continuationScore)) {
                        // Convert from 0-5 scale to 0-100 scale
                        advisorScore = ((listeningScore + clarityScore + continuationScore) / 3) * 20;
                      }
                    }
                    // LEGACY STRUCTURE: Direct advisor_performance_score
                    else if (content.advisor_performance_score) {
                      advisorScore = parseFloat(content.advisor_performance_score);
                    }

                    if (advisorScore && !isNaN(advisorScore)) {
                      adviserData.scores.push(advisorScore);
                      totalAdvisorScores.push(advisorScore);
                    }

                    // Extract entrepreneur/client readiness score - handle both structures
                    let entrepreneurScore = null;
                    
                    // NEW STRUCTURE: client_readiness_score
                    if (content.client_readiness_score) {
                      entrepreneurScore = parseFloat(content.client_readiness_score);
                    }
                    // LEGACY STRUCTURE: entrepreneur_readiness_score
                    else if (content.entrepreneur_readiness_score) {
                      entrepreneurScore = parseFloat(content.entrepreneur_readiness_score);
                    }

                    if (entrepreneurScore && !isNaN(entrepreneurScore)) {
                      totalEntrepreneurScores.push(entrepreneurScore);
                    }

                  }
                } catch (parseError) {
                  console.warn('Error parsing report content:', parseError);
                }
              });
          }
        }
      });

      // Calculate average scores (rounded to whole numbers)
      if (totalAdvisorScores.length > 0) {
        stats.averageScores.advisorPerformance = Math.round(
          totalAdvisorScores.reduce((sum, score) => sum + score, 0) / totalAdvisorScores.length
        );
      }

      if (totalEntrepreneurScores.length > 0) {
        stats.averageScores.entrepreneurReadiness = Math.round(
          totalEntrepreneurScores.reduce((sum, score) => sum + score, 0) / totalEntrepreneurScores.length
        );
      }

      // Process adviser rankings
      const advisers = Array.from(adviserStats.values())
        .filter(adviser => adviser.totalSessions > 0)
        .map(adviser => ({
          ...adviser,
          averageScore: adviser.scores.length > 0 
            ? Math.round(adviser.scores.reduce((sum, score) => sum + score, 0) / adviser.scores.length)
            : 0,
          successRate: adviser.totalSessions > 0 
            ? Math.round((adviser.completedSessions / adviser.totalSessions) * 100)
            : 0
        }))
        .filter(adviser => adviser.averageScore > 0); // Only include advisers with scores

      // Sort by average score
      advisers.sort((a, b) => b.averageScore - a.averageScore);

      // Get top and worst advisers
      stats.topAdvisers = advisers.slice(0, 3);
      stats.worstAdvisers = advisers.slice(-3).reverse();

      // Get recent sessions for display (sessions with reports)
      stats.lastSessions = sessions
        .filter(session => session.reports && session.reports.length > 0)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5)
        .map(session => {
          // Extract both scores from reports
          let advisorScore = 0;
          let entrepreneurScore = 0;
          let duration = '';
          let mainTopics = [];

          if (session.reports && session.reports.length > 0) {
            const adviserReport = session.reports.find(r => r.type === 'adviser' && r.is_current_version);
            if (adviserReport) {
              try {
                const content = typeof adviserReport.content === 'string' 
                  ? JSON.parse(adviserReport.content) 
                  : adviserReport.content;

                // Extract advisor score - handle both new and legacy structures
                if (content.listening?.score && content.clarity?.score && content.continuation?.score) {
                  const listeningScore = parseFloat(content.listening.score);
                  const clarityScore = parseFloat(content.clarity.score);
                  const continuationScore = parseFloat(content.continuation.score);
                  
                  if (!isNaN(listeningScore) && !isNaN(clarityScore) && !isNaN(continuationScore)) {
                    // Convert from 0-5 scale to 0-100 scale
                    advisorScore = ((listeningScore + clarityScore + continuationScore) / 3) * 20;
                  }
                }
                // LEGACY STRUCTURE: Direct advisor_performance_score
                else if (content.advisor_performance_score) {
                  advisorScore = parseFloat(content.advisor_performance_score);
                }

                // Extract entrepreneur/client readiness score - handle both structures
                if (content.client_readiness_score) {
                  entrepreneurScore = parseFloat(content.client_readiness_score);
                }
                // LEGACY STRUCTURE: entrepreneur_readiness_score
                else if (content.entrepreneur_readiness_score) {
                  entrepreneurScore = parseFloat(content.entrepreneur_readiness_score);
                }
                if (content.conversation_duration) {
                  duration = content.conversation_duration;
                }
                if (content.main_topics && Array.isArray(content.main_topics)) {
                  mainTopics = content.main_topics.slice(0, 3); // First 3 topics
                }
              } catch (parseError) {
                console.warn('Error parsing session report:', parseError);
              }
            }
          }

          // Determine score colors
          const getScoreColor = (score) => {
            if (score >= 85) return 'high';
            if (score >= 70) return 'medium';
            return 'low';
          };

          // Map status to Hebrew display
          const statusMap = {
            'completed': 'הושלם',
            'reports_generated': 'דוחות הופקו',
            'processing': 'בעיבוד',
            'uploaded': 'הועלה',
            'failed': 'נכשל'
          };

          // Format file size
          const formatFileSize = (bytes) => {
            if (!bytes) return '';
            const mb = bytes / (1024 * 1024);
            return `${mb.toFixed(1)} MB`;
          };

          return {
            id: session.id,
            title: session.title,
            status: statusMap[session.status] || session.status,
            advisor: {
              name: session.adviser?.name || 'Unknown',
              email: session.adviser?.email || ''
            },
            client: {
              name: session.client?.name || 'Unknown',
              email: session.client?.email || '',
              businessDomain: session.client?.metadata?.business_domain || ''
            },
            date: new Date(session.created_at).toISOString().split('T')[0],
            time: new Date(session.created_at).toLocaleTimeString('he-IL', { 
              hour: '2-digit', 
              minute: '2-digit' 
            }),
            scores: {
              advisor: Math.round(advisorScore),
              entrepreneur: Math.round(entrepreneurScore),
              advisorColor: getScoreColor(advisorScore),
              entrepreneurColor: getScoreColor(entrepreneurScore)
            },
            fileInfo: {
              name: session.file_name || '',
              size: formatFileSize(session.file_size),
              duration: duration || ''
            },
            mainTopics: mainTopics
          };
        });


      return stats;

    } catch (error) {
      console.error('Error in getSessionStats:', error);
      throw new Error(error.message || 'Failed to get session statistics');
    }
  }

  /**
   * Get sessions with their associated reports in one optimized query
   * with support for search, filtering, and sorting
   */
  static async getSessionsWithReports(userId, userRole, pagination = {}, filters = {}) {
    try {
      
      const client = supabaseAdmin || supabase;
      const { page = 1, limit = 20 } = pagination;
      const { 
        status, 
        client_id, 
        adviser_id, 
        search_term,
        date_from,
        date_to,
        sort_by = 'created_at',
        sort_direction = 'desc'
      } = filters;
      const offset = (page - 1) * limit;

      // Build the main query with reports joined
      let query = client
        .from('sessions')
        .select(`
          id, client_id, adviser_id, title, file_url, file_name, 
          file_size, file_type, duration, status, created_at, updated_at, transcription_text,
          client:clients(id, name, email, phone, metadata),
          adviser:users(id, name, email, phone),
          reports(
            id, session_id, type, status, content, created_at, updated_at,
            version_number, is_current_version
          )
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
      // Admin-only filter by adviser
      if (adviser_id && userRole === 'admin') {
        query = query.eq('adviser_id', adviser_id);
      }
      
      // Date range filtering
      if (date_from) {
        // Convert date string to start of day in ISO format
        const startDate = new Date(date_from + 'T00:00:00.000Z');
        query = query.gte('created_at', startDate.toISOString());
      }
      if (date_to) {
        // Convert date string to end of day in ISO format
        const endDate = new Date(date_to + 'T23:59:59.999Z');
        query = query.lte('created_at', endDate.toISOString());
      }
      
      // Enhanced search functionality - prepare search data first
      let matchingClients = null;
      let matchingAdvisers = null;
      let searchValue = null;
      
      if (search_term && search_term.trim() !== '') {
        searchValue = search_term.trim();
        
        // Get client IDs that match the search term (name, phone only)
        const clientSearch = await client
          .from('clients')
          .select('id')
          .or(`name.ilike.%${searchValue}%,phone.ilike.%${searchValue}%`);
        matchingClients = clientSearch.data;
        
        // Get adviser IDs that match the search term (name, phone only)
        const adviserSearch = await client
          .from('users')
          .select('id')
          .or(`name.ilike.%${searchValue}%,phone.ilike.%${searchValue}%`);
        matchingAdvisers = adviserSearch.data;
        
        // Build search conditions
        const searchConditions = [];
        
        // Search in session fields (title only)
        searchConditions.push(`title.ilike.%${searchValue}%`);
        
        // Add client ID matches if any
        if (matchingClients && matchingClients.length > 0) {
          const clientIds = matchingClients.map(c => c.id);
          searchConditions.push(`client_id.in.(${clientIds.join(',')})`);
        }
        
        // Add adviser ID matches if any
        if (matchingAdvisers && matchingAdvisers.length > 0) {
          const adviserIds = matchingAdvisers.map(a => a.id);
          searchConditions.push(`adviser_id.in.(${adviserIds.join(',')})`);
        }
        
        // Apply the combined search conditions
        if (searchConditions.length > 0) {
          query = query.or(searchConditions.join(','));
        }
      }

      // Get total count for pagination (same filtering logic)
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
      // Admin-only filter by adviser for count query
      if (adviser_id && userRole === 'admin') {
        countQuery = countQuery.eq('adviser_id', adviser_id);
      }
      
      // Date range filtering for count query
      if (date_from) {
        // Convert date string to start of day in ISO format
        const startDate = new Date(date_from + 'T00:00:00.000Z');
        countQuery = countQuery.gte('created_at', startDate.toISOString());
      }
      if (date_to) {
        // Convert date string to end of day in ISO format
        const endDate = new Date(date_to + 'T23:59:59.999Z');
        countQuery = countQuery.lte('created_at', endDate.toISOString());
      }
      
      // Search functionality for count query (enhanced version)
      if (search_term && search_term.trim() !== '') {
        const searchValue = search_term.trim();
        
        // Use the same search logic as the main query for accurate count
        const countSearchConditions = [];
        
        // Search in session fields (title only)
        countSearchConditions.push(`title.ilike.%${searchValue}%`);
        
        // Add client ID matches if any (reuse the same client search)
        if (matchingClients && matchingClients.length > 0) {
          const clientIds = matchingClients.map(c => c.id);
          countSearchConditions.push(`client_id.in.(${clientIds.join(',')})`);
        }
        
        // Add adviser ID matches if any (reuse the same adviser search)
        if (matchingAdvisers && matchingAdvisers.length > 0) {
          const adviserIds = matchingAdvisers.map(a => a.id);
          countSearchConditions.push(`adviser_id.in.(${adviserIds.join(',')})`);
        }
        
        // Apply the combined search conditions to count query
        if (countSearchConditions.length > 0) {
          countQuery = countQuery.or(countSearchConditions.join(','));
        }
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      // Apply sorting
      const validSortFields = ['created_at', 'title', 'status', 'file_name'];
      const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
      const sortDir = sort_direction === 'asc' ? true : false;
      
      // Get sessions with reports and pagination
      const { data: sessions, error } = await query
        .order(sortField, { ascending: sortDir })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Process the data to organize reports by type and filter current versions
      const processedSessions = sessions.map(session => ({
        ...session,
        reports: session.reports
          ? session.reports
              .filter(report => report.is_current_version) // Only current versions
              .reduce((acc, report) => {
                acc[report.type] = report;
                return acc;
              }, {})
          : {}
      }));

      // For admin users, also fetch all advisers and admins for the dropdown
      let advisers = [];
      if (userRole === 'admin') {
        const { data: advisersData, error: advisersError } = await client
          .from('users')
          .select('id, name, email, role')
          .in('role', ['adviser', 'admin'])
          .eq('status', 'active')
          .order('name');
        
        if (!advisersError && advisersData) {
          advisers = advisersData;
        }
      }

      return {
        sessions: processedSessions,
        advisers: advisers, // Include advisers for admin users
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };

    } catch (error) {
      console.error('Error in getSessionsWithReports:', error);
      throw new Error(error.message || 'Failed to get sessions with reports');
    }
  }

  /**
   * Search sessions by title, client name, client phone, adviser name, or adviser phone
   */
  static async searchSessions(searchTerm, userId, userRole, limit = 20) {
    try {
      const client = supabaseAdmin || supabase;
      const searchValue = searchTerm.trim();

      // Get client IDs that match the search term (name, phone only)
      const { data: matchingClients } = await client
        .from('clients')
        .select('id')
        .or(`name.ilike.%${searchValue}%,phone.ilike.%${searchValue}%`);
      
      // Get adviser IDs that match the search term (name, phone only)
      const { data: matchingAdvisers } = await client
        .from('users')
        .select('id')
        .or(`name.ilike.%${searchValue}%,phone.ilike.%${searchValue}%`);
      
      // Build search conditions
      const searchConditions = [];
      
      // Search in session fields (title only)
      searchConditions.push(`title.ilike.%${searchValue}%`);
      
      // Add client ID matches if any
      if (matchingClients && matchingClients.length > 0) {
        const clientIds = matchingClients.map(c => c.id);
        searchConditions.push(`client_id.in.(${clientIds.join(',')})`);
      }
      
      // Add adviser ID matches if any
      if (matchingAdvisers && matchingAdvisers.length > 0) {
        const adviserIds = matchingAdvisers.map(a => a.id);
        searchConditions.push(`adviser_id.in.(${adviserIds.join(',')})`);
      }

      let query = client
        .from('sessions')
        .select(`
          id, client_id, adviser_id, title, file_name, status, created_at,
          client:clients(id, name, email, phone)
        `);
      
      // Apply search conditions if any
      if (searchConditions.length > 0) {
        query = query.or(searchConditions.join(','));
      }

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
