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
        status = 'draft',
        version_number = 1
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
          version_number,
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
   * Update report content and metadata
   */
  static async updateReport(reportId, updateData) {
    try {
      
      const { data, error } = await supabaseAdmin
        .from('reports')
        .update({
          ...updateData,
          updated_at: new Date()
        })
        .eq('id', reportId)
        .select();

      if (error) {
        throw new Error(`Failed to update report: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error(`Report ${reportId} not found for update`);
      }

      console.log(`✅ Updated report ${reportId} successfully`);
      return data[0]; // Return first (and should be only) result

    } catch (error) {
      console.error('Error updating report:', error);
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
        .select();

      if (error) {
        throw new Error(`Failed to update report status: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error(`Report ${reportId} not found for status update`);
      }

      return data[0];

    } catch (error) {
      console.error('Error updating report status:', error);
      throw error;
    }
  }

  /**
   * Export client report as PDF and update statuses
   */
  static async exportClientReport(reportId, exportedBy) {
    try {
      console.log(`📤 Starting export process for client report ${reportId}`);

      // Get the report with session information
      const { data: reportWithSession, error: reportError } = await supabaseAdmin
        .from('reports')
        .select(`
          *,
          session:sessions(
            id, title, client_id, adviser_id, status,
            client:clients(id, name, email, metadata)
          )
        `)
        .eq('id', reportId)
        .eq('is_current_version', true)
        .single();

      if (reportError || !reportWithSession) {
        throw new Error(`Report not found: ${reportError?.message || 'Unknown error'}`);
      }

      const report = reportWithSession;
      const session = report.session;

      // Validate this is a client report
      if (report.type !== 'client') {
        throw new Error('Only client reports can be exported');
      }

      console.log(`📋 Exporting client report for session: ${session.title || session.id}`);

      // Step 1: Update report status to 'approved' (marking it as finalized)
      const approvedReport = await this.updateReportStatus(
        reportId, 
        'approved', 
        exportedBy, 
        'Report exported and sent to client'
      );

      // Step 2: Update session status to 'completed' (marking the entire workflow as done)
      const { data: updatedSession, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .update({
          status: 'completed',
          updated_at: new Date()
        })
        .eq('id', session.id)
        .select(`
          id, title, status, updated_at,
          client:clients(id, name, email, metadata)
        `)
        .single();

      if (sessionError) {
        console.error('Failed to update session status:', sessionError);
        throw new Error(`Failed to update session status: ${sessionError.message}`);
      }

      // Step 3: Also update the adviser report to 'approved' if it exists
      try {
        const { data: adviserReport, error: adviserError } = await supabaseAdmin
          .from('reports')
          .select('id')
          .eq('session_id', session.id)
          .eq('type', 'adviser')
          .eq('is_current_version', true)
          .single();

        if (adviserReport && !adviserError) {
          await this.updateReportStatus(
            adviserReport.id, 
            'approved', 
            exportedBy, 
            'Approved along with client report export'
          );
          console.log(`✅ Also approved adviser report: ${adviserReport.id}`);
        }
      } catch (adviserReportError) {
        console.warn('Could not update adviser report status:', adviserReportError.message);
        // Don't fail the export if adviser report update fails
      }

      console.log(`✅ Export process completed for report ${reportId}`);
      console.log(`📧 Session ${session.id} marked as completed`);

      // TODO: Future implementations (add these as separate services/functions):
      // 
      // Step 4: Generate PDF from report content
      // const pdfBuffer = await PDFService.generateReportPDF(report, session);
      // const pdfUrl = await CloudinaryService.uploadPDF(pdfBuffer, `client-report-${reportId}.pdf`);
      //
      // Step 5: Send email to client with PDF attachment
      // await EmailService.sendClientReport({
      //   clientEmail: session.client.email,
      //   clientName: session.client.name,
      //   reportTitle: report.title,
      //   pdfUrl: pdfUrl,
      //   sessionTitle: session.title
      // });
      //
      // Step 6: Update external CRM system
      // await CRMService.updateClientSession({
      //   clientId: session.client_id,
      //   sessionId: session.id,
      //   status: 'completed',
      //   reportUrl: pdfUrl,
      //   completedAt: new Date()
      // });

      return {
        report: approvedReport,
        session: updatedSession,
        pdf_generated: false, // TODO: Set to true when PDF generation is implemented
        email_sent: false,    // TODO: Set to true when email sending is implemented
        crm_updated: false    // TODO: Set to true when CRM integration is implemented
      };

    } catch (error) {
      console.error('Error exporting client report:', error);
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
   * Get report by ID
   */
  static async getReportById(reportId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('reports')
        .select('*')
        .eq('id', reportId)
        .eq('is_current_version', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Report not found
        }
        throw new Error(`Failed to get report: ${error.message}`);
      }

      return data;

    } catch (error) {
      console.error('Error getting report by ID:', error);
      throw error;
    }
  }

  /**
   * Regenerate full report - creates new version and queues regeneration job
   */
  static async regenerateFullReport(reportId, notes, userId) {
    const JobService = require('./jobService');
    
    try {
      // Get the current report
      const currentReport = await this.getReportById(reportId);
      if (!currentReport) {
        throw new Error('Report not found');
      }

      // Get the session to access transcript
      const SessionService = require('./sessionService');
      const session = await SessionService.getSessionById(currentReport.session_id, null, 'admin');
      
      if (!session || !session.transcription_text) {
        throw new Error('Session transcript not found - cannot regenerate report');
      }

      // Mark current report as not current version
      await supabaseAdmin
        .from('reports')
        .update({ is_current_version: false })
        .eq('id', reportId);

      // Get next version number (check ALL reports, not just current versions)
      const { data: versionData } = await supabaseAdmin
        .from('reports')
        .select('version_number')
        .eq('session_id', currentReport.session_id)
        .eq('type', currentReport.type)
        .order('version_number', { ascending: false })
        .limit(1);

      const nextVersion = (versionData?.[0]?.version_number || 0) + 1;
      
      // Create new report version (draft status)
      const newReport = await this.createReport({
        session_id: currentReport.session_id,
        type: currentReport.type,
        title: `${currentReport.type === 'adviser' ? 'Advisor' : 'Client'} Report v${nextVersion} - ${new Date().toLocaleDateString()}`,
        content: '{}', // Placeholder content
        status: 'draft', // Use valid status - will be updated during processing
        version_number: nextVersion, // Pass the calculated version number
        generation_metadata: {
          regeneration_notes: notes,
          regenerated_by: userId,
          regenerated_at: new Date().toISOString(),
          original_report_id: reportId
        }
      });

      // Create regeneration job
      const job = await JobService.createJob({
        session_id: currentReport.session_id,
        type: 'regenerate_report',
        payload: {
          report_id: newReport.id,
          original_report_id: reportId,
          transcript: session.transcription_text,
          notes: notes,
          report_type: currentReport.type,
          session_context: {
            sessionId: session.id,
            clientName: session.client?.name,
            clientEmail: session.client?.email,
            businessDomain: session.client?.metadata?.business_domain,
            adviserName: session.adviser?.name,
            adviserEmail: session.adviser?.email,
            sessionTitle: session.title,
            sessionDate: session.created_at,
            fileName: session.file_name,
            duration: session.duration,
            fileSize: session.file_size
          }
        },
        priority: 9 // High priority for regeneration
      });

      console.log(`✅ Created regeneration job ${job.id} for report ${reportId} -> ${newReport.id}`);

      return {
        ...job,
        new_report_id: newReport.id,
        version_number: nextVersion,
        session_id: currentReport.session_id
      };

    } catch (error) {
      console.error('Error creating regeneration job:', error);
      throw error;
    }
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
