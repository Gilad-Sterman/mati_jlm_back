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

    console.log('🚀 Starting embedded AI Worker...');
    
    this.worker = new AIWorker();
    await this.worker.start();
    this.isRunning = true;

    console.log('✅ Embedded AI Worker started successfully');
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
    // 2. NODE_ENV is development (for easier local development)
    // 3. ENABLE_EMBEDDED_WORKER is true
    return (
      process.env.WORKER_MODE === 'embedded' ||
      process.env.NODE_ENV === 'development' ||
      process.env.ENABLE_EMBEDDED_WORKER === 'true'
    );
  }
}

module.exports = WorkerManager;
