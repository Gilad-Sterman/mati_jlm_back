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
