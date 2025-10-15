const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const WorkerManager = require('../workers/workerManager');

// Get worker status (admin only)
router.get('/status', authenticate, requireAdmin, (req, res) => {
  try {
    // Get worker status from the server's worker manager
    const workerManager = req.app.get('workerManager');
    const status = workerManager ? workerManager.getStatus() : { status: 'not_available' };

    res.json({
      success: true,
      data: {
        worker: status,
        environment: {
          worker_mode: process.env.WORKER_MODE || 'separate',
          embedded_enabled: process.env.ENABLE_EMBEDDED_WORKER === 'true',
          openai_mock_mode: process.env.OPENAI_MOCK_MODE === 'true'
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
