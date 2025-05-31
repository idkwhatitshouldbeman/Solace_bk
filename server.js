const http = require('http');
const app = require('./app');
const { initializeSocket } = require('./config/socket');
const env = require('./config/env');

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with the server
const io = initializeSocket(server);

// Start the server
const PORT = env.PORT;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${env.NODE_ENV}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Graceful shutdown
  server.close(() => {
    process.exit(1);
  });
  
  // If server doesn't close in 5 seconds, force shutdown
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application continues running
});

module.exports = server;
