const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/db');
const env = require('../config/env');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts, please try again later.'
});

// Register a new user
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Check if username or email already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .or(`username.eq.${username},email.eq.${email}`)
      .single();
    
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const userId = uuidv4();
    const { error } = await supabase
      .from('users')
      .insert({
        id: userId,
        username,
        email,
        password_hash: hashedPassword,
        is_guest: false,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error creating user:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: userId, username, email, isGuest: false },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRY }
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        username,
        email,
        isGuest: false
      }
    });
  } catch (error) {
    console.error('Error in register endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user by email
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if user is a guest
    if (user.is_guest) {
      return res.status(401).json({ error: 'This account is a guest account. Please register for a full account.' });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, isGuest: false },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRY }
    );
    
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isGuest: false
      }
    });
  } catch (error) {
    console.error('Error in login endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create guest account
router.post('/guest', async (req, res) => {
  try {
    // Generate random username
    const guestUsername = `guest_${Math.random().toString(36).substring(2, 10)}`;
    
    // Create guest user
    const userId = uuidv4();
    const { error } = await supabase
      .from('users')
      .insert({
        id: userId,
        username: guestUsername,
        is_guest: true,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error creating guest user:', error);
      return res.status(500).json({ error: 'Failed to create guest user' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: userId, username: guestUsername, isGuest: true },
      env.JWT_SECRET,
      { expiresIn: '24h' } // Guest tokens expire after 24 hours
    );
    
    res.status(201).json({
      message: 'Guest account created',
      token,
      user: {
        id: userId,
        username: guestUsername,
        isGuest: true
      }
    });
  } catch (error) {
    console.error('Error in guest endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Verify token
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      
      // Get user from database
      const { data: user } = await supabase
        .from('users')
        .select('id, username, email, is_guest, created_at, last_login')
        .eq('id', decoded.id)
        .single();
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.status(200).json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isGuest: user.is_guest,
          createdAt: user.created_at,
          lastLogin: user.last_login
        }
      });
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Error in me endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
