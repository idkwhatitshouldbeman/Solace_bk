const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/db');
const auth = require('../middleware/auth');
const moderationService = require('../services/moderationService');
const env = require('../config/env');

const router = express.Router();

// Rate limiter for matching requests
const matchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many match requests, please try again later.'
});

/**
 * User matching service
 * Handles the logic for matching users in chat sessions
 */
class MatchingService {
  constructor() {
    // Queue of users waiting to be matched
    this.waitingQueue = [];
    
    // Map of active sessions
    this.activeSessions = new Map(); // sessionId -> { user1Id, user2Id, startTime }
    
    // Map of user to session
    this.userSessions = new Map(); // userId -> sessionId
  }
  
  /**
   * Add a user to the waiting queue
   * @param {string} userId - User ID to add to queue
   * @returns {boolean} - True if user was added to queue
   */
  addToWaitingQueue(userId) {
    // Check if user is already in a session
    if (this.userSessions.has(userId)) {
      return false;
    }
    
    // Check if user is already in queue
    if (this.waitingQueue.includes(userId)) {
      return false;
    }
    
    // Add user to queue
    this.waitingQueue.push(userId);
    return true;
  }
  
  /**
   * Remove a user from the waiting queue
   * @param {string} userId - User ID to remove from queue
   */
  removeFromWaitingQueue(userId) {
    this.waitingQueue = this.waitingQueue.filter(id => id !== userId);
  }
  
  /**
   * Find a match for a user
   * @param {string} userId - User ID to find match for
   * @returns {Object|null} - Match result or null if no match found
   */
  findMatch(userId) {
    // Check if user is already in a session
    if (this.userSessions.has(userId)) {
      return null;
    }
    
    // Check if there are other users in the queue
    if (this.waitingQueue.length === 0) {
      // Add user to queue
      this.addToWaitingQueue(userId);
      return null;
    }
    
    // Find first user in queue that isn't the current user
    const matchIndex = this.waitingQueue.findIndex(id => id !== userId);
    
    if (matchIndex === -1) {
      // No match found, add user to queue
      this.addToWaitingQueue(userId);
      return null;
    }
    
    // Get matched user ID
    const matchedUserId = this.waitingQueue[matchIndex];
    
    // Remove matched user from queue
    this.waitingQueue.splice(matchIndex, 1);
    
    // Create new session
    const sessionId = uuidv4();
    const session = {
      user1Id: userId,
      user2Id: matchedUserId,
      startTime: new Date()
    };
    
    // Store session
    this.activeSessions.set(sessionId, session);
    this.userSessions.set(userId, sessionId);
    this.userSessions.set(matchedUserId, sessionId);
    
    // Return match result
    return {
      sessionId,
      partnerId: matchedUserId
    };
  }
  
  /**
   * Get a user's current session
   * @param {string} userId - User ID to get session for
   * @returns {Object|null} - Session object or null if not in session
   */
  getUserSession(userId) {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return null;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      // Clean up inconsistent state
      this.userSessions.delete(userId);
      return null;
    }
    
    return {
      sessionId,
      partnerId: session.user1Id === userId ? session.user2Id : session.user1Id,
      startTime: session.startTime
    };
  }
  
  /**
   * End a chat session
   * @param {string} sessionId - Session ID to end
   * @param {string} reason - Reason for ending session
   * @returns {Object} - Session that was ended
   */
  endSession(sessionId, reason = 'ended') {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;
    
    // Remove session from maps
    this.activeSessions.delete(sessionId);
    this.userSessions.delete(session.user1Id);
    this.userSessions.delete(session.user2Id);
    
    // Return ended session
    return {
      ...session,
      endTime: new Date(),
      reason
    };
  }
  
  /**
   * End a user's current session
   * @param {string} userId - User ID to end session for
   * @param {string} reason - Reason for ending session
   * @returns {Object} - Session that was ended
   */
  endUserSession(userId, reason = 'ended') {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return null;
    
    return this.endSession(sessionId, reason);
  }
  
  /**
   * Get statistics about the matching service
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      waitingUsers: this.waitingQueue.length,
      activeSessions: this.activeSessions.size,
      totalUsers: this.userSessions.size + this.waitingQueue.length
    };
  }
}

// Create singleton instance
const matchingService = new MatchingService();

// Export for use in socket.io
module.exports = matchingService;

// API routes for matching
router.post('/match', matchLimiter, auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const ipAddress = req.ip;
    
    // Check if IP is blocked
    const isBlocked = await moderationService.isIPBlocked(ipAddress);
    if (isBlocked) {
      return res.status(403).json({
        error: 'Your IP address has been blocked due to violations.'
      });
    }
    
    // Add user to waiting queue
    const added = matchingService.addToWaitingQueue(userId);
    if (!added) {
      return res.status(400).json({
        error: 'You are already in a chat session or waiting queue.'
      });
    }
    
    // Return success
    res.status(200).json({
      message: 'Added to matching queue',
      position: matchingService.waitingQueue.length
    });
  } catch (error) {
    console.error('Error in match endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/skip', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // End current session
    const session = matchingService.endUserSession(userId, 'skipped');
    if (!session) {
      return res.status(400).json({
        error: 'You are not in a chat session.'
      });
    }
    
    // Add user back to waiting queue
    matchingService.addToWaitingQueue(userId);
    
    // Update session in database
    await supabase
      .from('chat_sessions')
      .update({
        ended_at: new Date().toISOString(),
        status: 'ended'
      })
      .eq('id', session.sessionId);
    
    res.status(200).json({
      message: 'Session ended and added back to matching queue'
    });
  } catch (error) {
    console.error('Error in skip endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/end', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // End current session
    const session = matchingService.endUserSession(userId, 'ended');
    if (!session) {
      return res.status(400).json({
        error: 'You are not in a chat session.'
      });
    }
    
    // Update session in database
    await supabase
      .from('chat_sessions')
      .update({
        ended_at: new Date().toISOString(),
        status: 'ended'
      })
      .eq('id', session.sessionId);
    
    res.status(200).json({
      message: 'Session ended successfully'
    });
  } catch (error) {
    console.error('Error in end endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status', auth.requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's current session
    const session = matchingService.getUserSession(userId);
    
    // Get waiting queue position
    const queuePosition = matchingService.waitingQueue.indexOf(userId);
    
    res.status(200).json({
      inSession: !!session,
      session,
      inQueue: queuePosition !== -1,
      queuePosition: queuePosition !== -1 ? queuePosition + 1 : null,
      stats: matchingService.getStats()
    });
  } catch (error) {
    console.error('Error in status endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
