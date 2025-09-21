const { supabase } = require('../config/database');

/**
 * Database utility functions for common operations
 */
class DatabaseUtils {
  
  /**
   * Execute raw SQL with parameters
   */
  static async executeSQL(sql, params = []) {
    try {
      const { data, error } = await supabase.rpc('exec_sql', { 
        sql, 
        params: params 
      });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('SQL execution error:', error);
      throw error;
    }
  }

  /**
   * Get current report version for a session and type
   */
  static async getCurrentReport(sessionId, type) {
    const { data, error } = await supabase
      .from('current_reports')
      .select('*')
      .eq('session_id', sessionId)
      .eq('type', type)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  /**
   * Create a new report version
   */
  static async createReportVersion(reportData) {
    // Get the next version number
    const { data: maxVersion } = await supabase
      .from('reports')
      .select('version_number')
      .eq('session_id', reportData.session_id)
      .eq('type', reportData.type)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    const nextVersion = maxVersion ? maxVersion.version_number + 1 : 1;

    // Create the new version
    const { data, error } = await supabase
      .from('reports')
      .insert({
        ...reportData,
        version_number: nextVersion,
        is_current_version: true,
        content_hash: this.generateContentHash(reportData.content),
        word_count: this.countWords(reportData.content),
        character_count: reportData.content.length
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get version history for a report
   */
  static async getReportVersionHistory(sessionId, type) {
    const { data, error } = await supabase
      .rpc('get_report_version_history', {
        p_session_id: sessionId,
        p_type: type
      });

    if (error) throw error;
    return data;
  }

  /**
   * Rollback to a specific version
   */
  static async rollbackToVersion(sessionId, type, versionNumber) {
    // Get the target version
    const { data: targetVersion, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('session_id', sessionId)
      .eq('type', type)
      .eq('version_number', versionNumber)
      .single();

    if (fetchError) throw fetchError;

    // Create a new version based on the target version
    const newVersionData = {
      session_id: targetVersion.session_id,
      type: targetVersion.type,
      title: targetVersion.title,
      content: targetVersion.content,
      content_format: targetVersion.content_format,
      summary: targetVersion.summary,
      key_points: targetVersion.key_points,
      generation_method: 'manual_edit',
      generation_metadata: { rollback_from_version: versionNumber },
      parent_version_id: targetVersion.id
    };

    return await this.createReportVersion(newVersionData);
  }

  /**
   * Add job to queue
   */
  static async addJob(jobData) {
    const { data, error } = await supabase
      .from('jobs')
      .insert(jobData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update job status
   */
  static async updateJobStatus(jobId, status, result = null, errorLog = null) {
    const updateData = { 
      status,
      updated_at: new Date().toISOString()
    };

    if (result) updateData.result = result;
    if (errorLog) updateData.error_log = errorLog;
    if (status === 'processing') updateData.started_at = new Date().toISOString();
    if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get next job from queue
   */
  static async getNextJob() {
    const { data, error } = await supabase
      .rpc('get_next_job');

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  }

  /**
   * Generate content hash for duplicate detection
   */
  static generateContentHash(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Count words in text
   */
  static countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Transaction wrapper
   */
  static async transaction(callback) {
    // Note: Supabase doesn't support transactions in the same way as traditional SQL
    // This is a placeholder for future implementation or custom transaction logic
    try {
      return await callback();
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }

  /**
   * Health check for database connection
   */
  static async healthCheck() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('count')
        .limit(1);

      return { healthy: !error, error: error?.message };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
}

module.exports = DatabaseUtils;
