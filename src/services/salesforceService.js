const axios = require('axios');
const ClientService = require('./clientService');

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

      // Encode PDF buffer as base64 if available
      let pdfBase64 = null;
      let pdfFilename = null;
      let pdfMimeType = null;
      
      if (pdfBuffer) {
        try {
          // Ensure we have a proper Buffer
          const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
          
          // Validate PDF header to ensure it's a valid PDF
          const pdfHeader = buffer.slice(0, 4).toString();
          if (pdfHeader !== '%PDF') {
            console.error('❌ Invalid PDF buffer - missing PDF header');
            console.log('Buffer start:', buffer.slice(0, 20).toString('hex'));
            throw new Error('Invalid PDF buffer');
          }
          
          // Encode as base64 without any formatting
          pdfBase64 = buffer.toString('base64');
          pdfFilename = `client-report-${reportData.id}-${Date.now()}.pdf`;
          pdfMimeType = 'application/pdf';
          
          console.log(`📎 PDF validated and encoded as base64 (${Math.round(pdfBase64.length / 1024)}KB)`);
          console.log(`📎 PDF buffer size: ${buffer.length} bytes`);
          console.log(`📎 Base64 length: ${pdfBase64.length} characters`);
          console.log(`📎 PDF header: ${buffer.slice(0, 8).toString()}`);
          
        } catch (error) {
          console.error('Failed to encode PDF as base64:', error);
          // Fall back to URL if base64 encoding fails
          pdfBase64 = null;
          pdfFilename = null;
          pdfMimeType = null;
        }
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
          pdf_url: pdfUrl, // Keep URL as fallback
          pdf_base64: pdfBase64, // Direct PDF content
          pdf_filename: pdfFilename, // Filename for attachment
          pdf_mime_type: pdfMimeType, // MIME type for proper attachment handling
          approved_at: new Date().toISOString()
        },
        // Attachment format for Outlook (alternative structure)
        attachment: pdfBase64 ? {
          name: pdfFilename,
          data: pdfBase64,
          type: pdfMimeType
        } : null,
        // Alternative attachment format (Microsoft Graph API style)
        attachments: pdfBase64 ? [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          "name": pdfFilename,
          "contentType": pdfMimeType,
          "contentBytes": pdfBase64
        }] : [],
        // Simple attachment format (basic email clients)
        files: pdfBase64 ? [{
          filename: pdfFilename,
          data: pdfBase64,
          mimetype: pdfMimeType
        }] : [],
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
