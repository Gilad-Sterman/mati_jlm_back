const express = require('express');
const router = express.Router();
const SalesforceService = require('../services/salesforceService');
const { authenticate } = require('../middleware/auth');

/**
 * Lookup client data from Salesforce by business number
 * POST /api/salesforce/lookup
 */
router.post('/lookup', authenticate, async (req, res) => {
  try {
    const { business_number } = req.body;

    if (!business_number || !business_number.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Business number is required'
      });
    }

    // Call the existing SalesforceService but without client ID (just for lookup)
    const result = await SalesforceService.lookupClientData(business_number.trim());

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: 'Client data found in Salesforce'
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.error || 'No client data found for this business number'
      });
    }

  } catch (error) {
    console.error('Salesforce lookup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lookup client data'
    });
  }
});

module.exports = router;
