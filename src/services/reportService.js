const { supabaseAdmin } = require('../config/database');

class ReportService {
  /**
   * Create a new report in the database
   */
  static async createReport(reportData) {
    try {
      const {
        session_id,
        type, // 'adviser' or 'client'
        title,
        content,
        content_format = 'markdown',
        summary,
        key_points = [],
        generation_method = 'ai_generated',
        generation_metadata = {},
        status = 'draft'
      } = reportData;

      const { data, error } = await supabaseAdmin
        .from('reports')
        .insert([{
          session_id,
          type,
          title,
          content,
          content_format,
          summary,
          key_points,
          generation_method,
          generation_metadata,
          status,
          version_number: 1,
          is_current_version: true,
          word_count: this.countWords(content),
          character_count: content.length
        }])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create report: ${error.message}`);
      }

      console.log(`✅ Created ${type} report for session ${session_id}: ${data.id}`);
      return data;

    } catch (error) {
      console.error('Error creating report:', error);
      throw error;
    }
  }

  /**
   * Create both advisor and client reports for a session
   */
  static async createReportsForSession(sessionId, advisorReportData, clientReportData) {
    try {
      console.log(`📝 Saving reports to database for session ${sessionId}`);

      // Prepare advisor report
      const advisorReport = {
        session_id: sessionId,
        type: 'adviser',
        title: `Advisor Report - ${new Date().toLocaleDateString()}`,
        content: advisorReportData.content,
        generation_metadata: {
          model: advisorReportData.metadata.model,
          tokens_used: advisorReportData.metadata.tokens_used,
          processing_time_ms: advisorReportData.metadata.processing_time_ms,
          generated_at: advisorReportData.metadata.generated_at,
          mock_mode: advisorReportData.metadata.mock_mode || false
        },
        status: 'draft' // Reports start as drafts for review
      };

      // Prepare client report
      const clientReport = {
        session_id: sessionId,
        type: 'client',
        title: `Client Report - ${new Date().toLocaleDateString()}`,
        content: clientReportData.content,
        generation_metadata: {
          model: clientReportData.metadata.model,
          tokens_used: clientReportData.metadata.tokens_used,
          processing_time_ms: clientReportData.metadata.processing_time_ms,
          generated_at: clientReportData.metadata.generated_at,
          mock_mode: clientReportData.metadata.mock_mode || false
        },
        status: 'draft'
      };

      // Create both reports
      const [savedAdvisorReport, savedClientReport] = await Promise.all([
        this.createReport(advisorReport),
        this.createReport(clientReport)
      ]);

      console.log(`✅ Saved both reports for session ${sessionId}`);

      return {
        advisor_report: savedAdvisorReport,
        client_report: savedClientReport
      };

    } catch (error) {
      console.error('Error creating reports for session:', error);
      throw error;
    }
  }

  /**
   * Get ALL reports - simple and efficient!
   */
  static async getAllReports() {
    try {
      const { data, error } = await supabaseAdmin
        .from('reports')
        .select('*')
        .eq('is_current_version', true)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get all reports: ${error.message}`);
      }

      console.log(`📊 Retrieved ${data.length} reports from database`);
      return data;

    } catch (error) {
      console.error('Error getting all reports:', error);
      throw error;
    }
  }

  /**
   * Get reports for a session
   */
  static async getReportsForSession(sessionId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('reports')
        .select('*')
        .eq('session_id', sessionId)
        .eq('is_current_version', true)
        .order('type', { ascending: true });

      if (error) {
        throw new Error(`Failed to get reports: ${error.message}`);
      }

      return data;

    } catch (error) {
      console.error('Error getting reports for session:', error);
      throw error;
    }
  }

  /**
   * Update report status (e.g., approve, reject)
   */
  static async updateReportStatus(reportId, status, approvedBy = null, approvalNotes = null) {
    try {
      const updateData = {
        status,
        updated_at: new Date()
      };

      if (status === 'approved' && approvedBy) {
        updateData.approved_by = approvedBy;
        updateData.approved_at = new Date();
        updateData.approval_notes = approvalNotes;
      }

      const { data, error } = await supabaseAdmin
        .from('reports')
        .update(updateData)
        .eq('id', reportId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update report status: ${error.message}`);
      }

      return data;

    } catch (error) {
      console.error('Error updating report status:', error);
      throw error;
    }
  }

  /**
   * Count words in text (simple implementation)
   */
  static countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Extract key points from report content (simple implementation)
   */
  static extractKeyPoints(content) {
    if (!content) return [];
    
    // Simple extraction - look for bullet points or numbered lists
    const lines = content.split('\n');
    const keyPoints = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Look for markdown bullet points or numbered lists
      if (trimmed.match(/^[-*+]\s+/) || trimmed.match(/^\d+\.\s+/)) {
        keyPoints.push(trimmed.replace(/^[-*+\d.]\s*/, ''));
      }
    }
    
    return keyPoints.slice(0, 10); // Limit to 10 key points
  }
}

module.exports = ReportService;
