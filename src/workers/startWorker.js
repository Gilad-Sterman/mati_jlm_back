require('dotenv').config();
const AIWorker = require('./aiWorker');

// Create worker instance
const worker = new AIWorker();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  worker.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  worker.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  worker.stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  worker.stop();
  process.exit(1);
});

// Start the worker
async function startWorker() {
  try {
    console.log('🚀 Starting MATI AI Worker...');
    console.log('📋 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔑 OpenAI configured:', !!process.env.OPENAI_API_KEY);
    
    await worker.start();
    
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();
