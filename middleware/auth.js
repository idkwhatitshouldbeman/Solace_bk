const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Authentication middleware
 */
const auth = {
  /**
   * Middleware to require authentication
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireAuth: (req, res, next) => {
    try {
      // Get token from header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization token required' });
      }
      
      const token = authHeader.split(' ')[1];
      
      // Verify token
      const decoded = jwt.verify(token, env.JWT_SECRET);
      
      // Add user to request
      req.user = decoded;
      
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  },
  
  /**
   * Middleware to require non-guest user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireRegistered: (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (req.user.isGuest) {
      return res.status(403).json({ error: 'This feature is only available for registered users' });
    }
    
    next();
  }
};

module.exports = auth;
