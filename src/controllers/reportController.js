const ReportService = require('../services/reportService');

class ReportController {
  /**
   * Get all reports (admin) or own reports (adviser)
   */
  static async getReports(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const user = req.user;

      // Get all reports from database
      const reports = await ReportService.getAllReports();
      
      res.json({
        success: true,
        message: 'Reports retrieved successfully',
        data: {
          reports: reports,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: reports.length,
            totalPages: Math.ceil(reports.length / parseInt(limit))
          }
        }
      });

    } catch (error) {
      console.error('Error getting reports:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get reports for a specific session
   */
  static async getReportsForSession(req, res) {
    try {
      const { sessionId } = req.params;
      const user = req.user;

      // Basic validation
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID is required'
        });
      }

      // TODO: Add authorization check - user should own the session or be admin
      
      const reports = await ReportService.getReportsForSession(sessionId);

      res.json({
        success: true,
        message: 'Session reports retrieved successfully',
        data: {
          reports: reports || []
        }
      });

    } catch (error) {
      console.error('Error getting session reports:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve session reports',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get report by ID
   */
  static async getReportById(req, res) {
    try {
      const { id } = req.params;
      const user = req.user;

      // Basic validation
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Report ID is required'
        });
      }

      // TODO: Implement actual report fetching by ID
      // TODO: Add authorization check
      
      // For now, return placeholder data
      res.json({
        success: true,
        message: 'Report retrieved successfully',
        data: {
          report: {
            id: id,
            title: 'Sample Report',
            type: 'adviser',
            status: 'approved',
            content: 'This is a sample report content...',
            version_number: 1,
            is_current_version: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }
      });

    } catch (error) {
      console.error('Error getting report by ID:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve report',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Update report
   */
  static async updateReport(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const user = req.user;

      // Basic validation
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Report ID is required'
        });
      }

      // TODO: Implement actual report update
      // TODO: Add authorization check
      
      res.json({
        success: true,
        message: 'Report updated successfully',
        data: {
          report: {
            id: id,
            ...updateData,
            updated_at: new Date().toISOString()
          }
        }
      });

    } catch (error) {
      console.error('Error updating report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update report',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Approve report
   */
  static async approveReport(req, res) {
    try {
      const { id } = req.params;
      const { approval_notes } = req.body;
      const user = req.user;

      // Basic validation
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Report ID is required'
        });
      }

      // Get the report to validate it exists
      const report = await ReportService.getReportById(id);
      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // TODO: Add authorization check - user should own the session or be admin
      
      // Approve the report using ReportService
      const approvedReport = await ReportService.updateReportStatus(
        id, 
        'approved', 
        user.id, 
        approval_notes || 'Report approved'
      );
      
      res.json({
        success: true,
        message: 'Report approved successfully',
        data: {
          report: approvedReport
        }
      });

    } catch (error) {
      console.error('Error approving report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve report',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Regenerate report with AI
   */
  static async regenerateReport(req, res) {
    try {
      
      const { id } = req.params;
      const { notes } = req.body;
      const user = req.user;

      // Basic validation
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Report ID is required'
        });
      }

      if (!notes || !notes.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Notes are required for report regeneration'
        });
      }

      // Get the report to find session and validate ownership
      const report = await ReportService.getReportById(id);
      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // TODO: Add authorization check - user should own the session or be admin
      
      // Start regeneration process
      const job = await ReportService.regenerateFullReport(id, notes.trim(), user.id);
      
      res.json({
        success: true,
        message: 'Report regeneration started',
        data: {
          job: {
            id: job.id,
            type: job.type,
            status: job.status,
            original_report_id: id,
            new_report_id: job.new_report_id,
            version_number: job.version_number,
            session_id: job.session_id,
            created_at: job.created_at
          }
        }
      });

    } catch (error) {
      console.error('Error regenerating report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start report regeneration',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Export report as PDF and send to client
   */
  static async exportReport(req, res) {
    try {
      const { id } = req.params;
      const user = req.user;
      const pdfFile = req.file; // PDF file from frontend

      // Basic validation
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Report ID is required'
        });
      }

      if (!pdfFile) {
        return res.status(400).json({
          success: false,
          message: 'PDF file is required'
        });
      }

      // Get the report to validate it exists and get session info
      const report = await ReportService.getReportById(id);
      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }

      // Only allow export of client reports
      if (report.type !== 'client') {
        return res.status(400).json({
          success: false,
          message: 'Only client reports can be exported'
        });
      }

      // TODO: Add authorization check - user should own the session or be admin
      
      // Start the export process with PDF file
      const exportResult = await ReportService.exportClientReport(id, user.id, pdfFile);
      
      res.json({
        success: true,
        message: 'Report export completed successfully',
        data: {
          report: exportResult.report,
          session: exportResult.session,
          export_metadata: {
            exported_by: user.id,
            exported_at: new Date().toISOString(),
            pdf_generated: exportResult.pdf_generated,
            pdf_url: exportResult.pdf_url,
            email_sent: exportResult.email_sent,
            crm_updated: exportResult.crm_updated
          }
        }
      });

    } catch (error) {
      console.error('Error exporting report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export report',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

module.exports = ReportController;
