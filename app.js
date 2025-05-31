const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const env = require('./config/env');

// Import routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());

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

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Catch-all route to serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
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

module.exports = app;
