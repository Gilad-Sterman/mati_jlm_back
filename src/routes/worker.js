const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const WorkerManager = require('../workers/workerManager');
const WorkerController = require('../controllers/workerController');

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

/**
 * External Worker Webhook Endpoints
 * These endpoints are called by the external worker service
 */

// Progress webhook endpoint - receives progress updates from worker
router.post('/progress', WorkerController.receiveProgress);

// Health check endpoint - allows worker to validate connection
router.post('/health', WorkerController.healthCheck);

// Worker configuration endpoint - for debugging and monitoring
router.get('/config', WorkerController.getWorkerConfig);

module.exports = router;
