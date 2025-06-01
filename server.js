const { app, server } = require('./app');
const env = require('./config/env');
const { logger, performanceMonitor, errorTracker, requestLogger } = require('./services/monitoring');

// Apply monitoring middleware
app.use(requestLogger);
app.use(performanceMonitor);

// Error tracking middleware should be last
app.use(errorTracker);

// Start server
const port = env.PORT;
const startServer = () => {
  server.listen(port, () => {
    logger.info(`Server is running on port ${port} in ${env.NODE_ENV} mode`);
  });
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer();

module.exports = server;
