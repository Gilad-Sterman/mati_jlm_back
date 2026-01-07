const axios = require('axios');
const ClientService = require('./clientService');
const { generateReportHtml } = require('../utils/reportHtmlGenerator');

class SalesforceService {
  /**
   * Lookup client data from Salesforce (for frontend form auto-fill)
   */
  static async lookupClientData(businessNumber) {
    try {
      console.log(`🔍 Looking up Salesforce data for business number: ${businessNumber}`);

      // Check if required environment variables are set
      if (!process.env.MAKE_WEBHOOK_URL || !process.env.MAKE_WH_API_KEY) {
        console.warn('⚠️ Make.com webhook not configured');
        return { success: false, error: 'Webhook not configured' };
      }

      // Prepare webhook payload
      const payload = {
        business_number: businessNumber,
        timestamp: new Date().toISOString()
      };

      // Call Make.com webhook
      const response = await axios.post(process.env.MAKE_WEBHOOK_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-make-apikey': process.env.MAKE_WH_API_KEY
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data && response.data.success && response.data.client_data) {
        const salesforceData = response.data.client_data;
        
        console.log(`✅ Salesforce data found for business number ${businessNumber}`);

        return { 
          success: true, 
          data: salesforceData,
          message: 'Client data found in Salesforce'
        };
      } else {
        console.warn(`⚠️ No Salesforce data found for business number: ${businessNumber}`);
        return { 
          success: false, 
          error: 'No matching Salesforce record found' 
        };
      }

    } catch (error) {
      console.error(`❌ Salesforce lookup failed for business number ${businessNumber}:`, error.message);
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  }


  /**
   * Send approved client report via Make.com email webhook
   */
  static async sendClientReport(reportData, sessionData, clientData, pdfUrl = null, pdfBuffer = null) {
    try {
      console.log(`📧 Sending client report via Make.com for session: ${sessionData.id}`);

      // Check if required environment variables are set
      if (!process.env.MAKE_EMAIL_WEBHOOK_URL || !process.env.MAKE_EMAIL_WH_API_KEY) {
        console.warn('⚠️ Make.com email webhook not configured');
        return { success: false, error: 'Email webhook not configured' };
      }

      // Use PDF URL from Cloudinary instead of base64 encoding
      let pdfFilename = null;
      
      if (pdfUrl) {
        // Extract filename from Cloudinary URL or generate one
        pdfFilename = `client-report-${reportData.id}-${Date.now()}.pdf`;
        console.log(`📎 Using PDF URL from Cloudinary: ${pdfUrl}`);
      } else {
        console.warn('⚠️ No PDF URL provided - email will be sent without attachment');
      }

      // Generate HTML content from report data
      let reportHtml = null;
      try {
        reportHtml = generateReportHtml(reportData, sessionData, clientData);
        console.log('✅ Generated HTML content for report');
      } catch (htmlError) {
        console.error('⚠️ Failed to generate HTML content:', htmlError.message);
        // Continue with the process even if HTML generation fails
      }

      // Prepare email webhook payload
      const payload = {
        // Client information
        client: {
          id: clientData.id,
          name: clientData.name,
          email: clientData.email,
          phone: clientData.phone || null,
          business_number: clientData.metadata?.business_number || null,
          company: clientData.metadata?.company || null,
          address: clientData.metadata?.address || null,
          created_at: clientData.created_at
        },
        // Session information
        session: {
          id: sessionData.id,
          title: sessionData.title,
          client_id: sessionData.client_id,
          adviser_id: sessionData.adviser_id,
          status: sessionData.status,
          created_at: sessionData.created_at,
          updated_at: sessionData.updated_at
        },
        // Adviser information
        adviser: {
          id: sessionData.adviser?.id || null,
          name: sessionData.adviser?.name || null,
          email: sessionData.adviser?.email || null,
          role: sessionData.adviser?.role || null
        },
        // Report information
        report: {
          id: reportData.id,
          type: reportData.type,
          content: reportData.content,
          pdf_url: pdfUrl, // Cloudinary URL for PDF download
          pdf_filename: pdfFilename, // Filename for reference
          approved_at: new Date().toISOString(),
          html_content: reportHtml // Add HTML content for Make.com to use
        },
        // PDF attachment info (URL-based instead of base64)
        attachment: pdfUrl ? {
          name: pdfFilename,
          url: pdfUrl,
          type: 'application/pdf'
        } : null,
        // Metadata
        timestamp: new Date().toISOString(),
        action: 'send_client_report'
      };

      // Call Make.com email webhook
      const response = await axios.post(process.env.MAKE_EMAIL_WEBHOOK_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-make-apikey': process.env.MAKE_EMAIL_WH_API_KEY
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data && response.data.success) {
        console.log(`✅ Client report sent successfully to ${clientData.email}`);
        
        return { 
          success: true, 
          data: response.data,
          message: `Report sent to ${clientData.email}`,
          email_id: response.data.email_id || null,
          salesforce_updated: response.data.salesforce_updated || false
        };
      } else {
        console.warn(`⚠️ Failed to send client report: ${response.data?.error || 'Unknown error'}`);
        return { 
          success: false, 
          error: response.data?.error || 'Email sending failed' 
        };
      }

    } catch (error) {
      console.error(`❌ Failed to send client report via Make.com:`, error.message);
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Test Make.com webhook connectivity
   */
  static async testWebhookConnection() {
    try {
      if (!process.env.MAKE_WEBHOOK_URL || !process.env.MAKE_WH_API_KEY) {
        return { success: false, error: 'Webhook not configured' };
      }

      const testPayload = {
        test: true,
        client_id: 'test-client',
        business_number: '2017-172790', // Use known test number
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(process.env.MAKE_WEBHOOK_URL, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'x-make-apikey': process.env.MAKE_WH_API_KEY
        },
        timeout: 10000
      });

      return { 
        success: true, 
        data: response.data,
        message: 'Webhook connection successful'
      };

    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

module.exports = SalesforceService;
