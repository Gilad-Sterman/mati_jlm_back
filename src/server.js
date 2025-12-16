require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { createServer } = require('http');

// Import configurations
const corsConfig = require('./config/cors');

// Import services
const socketService = require('./services/socketService');
const WorkerManager = require('./workers/workerManager');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const clientRoutes = require('./routes/clients');
const sessionRoutes = require('./routes/sessions');
const reportRoutes = require('./routes/reports');
const socketRoutes = require('./routes/socket');
const workerRoutes = require('./routes/worker');
const salesforceRoutes = require('./routes/salesforceRoutes');

const app = express();
const server = createServer(app);

// Initialize Socket.io with our service
const io = socketService.initialize(server);

// Basic middleware
app.use(morgan('combined'));
app.use(cors(corsConfig));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Initialize worker manager
const workerManager = new WorkerManager();

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/socket', socketRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/salesforce', salesforceRoutes);

// Make socket service accessible to routes
app.set('socketService', socketService);
app.set('io', io);
app.set('workerManager', workerManager);

// Catch-all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;


// Graceful shutdown
const gracefulShutdown = () => {
  console.log('Received shutdown signal, closing server gracefully...');
  
  // Stop worker first
  workerManager.stop();
  
  server.close(() => {
    console.log('Server closed successfully');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
  
  // Start embedded worker if configured
  if (WorkerManager.shouldRunEmbedded()) {
    try {
      await workerManager.startEmbedded();
      console.log('✅ Embedded AI worker started successfully');
    } catch (error) {
      console.error('❌ Failed to start embedded worker:', error);
    }
  } else {
    console.log('ℹ️ Worker will run as separate process. Start with: npm run worker');
  }
});

module.exports = { app, server, io };