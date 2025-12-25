const AIWorker = require('./aiWorker');

class WorkerManager {
  constructor() {
    this.worker = null;
    this.isRunning = false;
  }

  /**
   * Start worker in the same process as the server
   */
  async startEmbedded() {
    if (this.isRunning) {
      console.log('⚠️ Worker is already running');
      return;
    }
    
    this.worker = new AIWorker();
    await this.worker.start();
    this.isRunning = true;
  }

  /**
   * Stop the embedded worker
   */
  stop() {
    if (this.worker && this.isRunning) {
      console.log('🛑 Stopping embedded AI Worker...');
      this.worker.stop();
      this.isRunning = false;
      console.log('✅ Embedded AI Worker stopped');
    }
  }

  /**
   * Get worker status
   */
  getStatus() {
    if (!this.worker) {
      return { status: 'not_initialized' };
    }

    return {
      status: this.isRunning ? 'running' : 'stopped',
      workerDetails: this.worker.getStatus()
    };
  }

  /**
   * Check if we should run worker embedded (based on environment)
   */
  static shouldRunEmbedded() {
    // Run embedded if:
    // 1. WORKER_MODE is set to 'embedded'
    // 2. ENABLE_EMBEDDED_WORKER is true
    // Note: Removed NODE_ENV=development auto-embedded to allow external worker testing in dev
    return (
      process.env.WORKER_MODE === 'embedded' ||
      process.env.ENABLE_EMBEDDED_WORKER === 'true'
    );
  }

  /**
   * Check if external worker is configured
   */
  static isExternalWorkerConfigured() {
    return !!(process.env.WORKER_API_KEY && !this.shouldRunEmbedded());
  }

  /**
   * Get worker configuration info
   */
  static getWorkerConfig() {
    return {
      useEmbedded: this.shouldRunEmbedded(),
      hasWorkerApiKey: !!process.env.WORKER_API_KEY,
      workerMode: process.env.WORKER_MODE || 'auto',
      enableEmbeddedWorker: process.env.ENABLE_EMBEDDED_WORKER,
      environment: process.env.NODE_ENV || 'development'
    };
  }
}

module.exports = WorkerManager;
