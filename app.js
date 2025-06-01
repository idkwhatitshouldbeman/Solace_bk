const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const env = require('./config/env');
const https = require('https');
const fs = require('fs');

// Import routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

// Initialize Express app
const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: env.NODE_ENV
  });
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.socket.io"],
      connectSrc: ["'self'", "wss:", "ws:"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Request logging
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to all requests
app.use(limiter);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Serve static files from the correct frontend directory
const frontendPath = path.join(__dirname, '..', 'anonymous-chat-frontend');
app.use(express.static(frontendPath));

// Catch-all route to serve index.html for SPA
app.get('*', (req, res) => {
  // Check if the request is for an API route
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // For all other routes, try to serve index.html from frontend directory
  const indexPath = path.join(frontendPath, 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      // If index.html doesn't exist, send API-friendly response
      res.status(200).json({ 
        message: 'Anonymous Chat API Server',
        status: 'running',
        endpoints: {
          auth: '/api/auth',
          api: '/api'
        }
      });
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Log error to monitoring service
  if (env.NODE_ENV === 'production') {
    // TODO: Add your error tracking service here (e.g., Sentry)
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }
  
  const statusCode = err.statusCode || 500;
  const message = env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message;
  
  res.status(statusCode).json({
    error: {
      message,
      status: statusCode
    }
  });
});

// SSL/TLS Configuration for production
let server;
if (env.NODE_ENV === 'production' && env.SSL_KEY_PATH && env.SSL_CERT_PATH) {
  const options = {
    key: fs.readFileSync(env.SSL_KEY_PATH),
    cert: fs.readFileSync(env.SSL_CERT_PATH)
  };
  server = https.createServer(options, app);
} else {
  server = app;
}

module.exports = { app, server };
