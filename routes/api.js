const express = require('express');
const auth = require('../middleware/auth');
const supabase = require('../config/db');

const router = express.Router();

// Get chat history for a user (registered users only)
router.get('/chat/history', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if user is a guest
    if (req.user.isGuest) {
      return res.status(403).json({ error: 'Chat history is only available for registered users' });
    }
    
    // Get user's chat sessions
    const { data: sessions, error: sessionsError } = await supabase
      .from('chat_sessions')
      .select('id, user1_id, user2_id, started_at, ended_at, status')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('started_at', { ascending: false })
      .limit(20);
    
    if (sessionsError) {
      console.error('Error fetching chat sessions:', sessionsError);
      return res.status(500).json({ error: 'Failed to fetch chat history' });
    }
    
    // Get messages for each session
    const sessionsWithMessages = await Promise.all(sessions.map(async (session) => {
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('id, sender_id, content, created_at, flagged')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true });
      
      if (messagesError) {
        console.error('Error fetching messages:', messagesError);
        return { ...session, messages: [] };
      }
      
      // Get partner info
      const partnerId = session.user1_id === userId ? session.user2_id : session.user1_id;
      const { data: partner } = await supabase
        .from('users')
        .select('username, is_guest')
        .eq('id', partnerId)
        .single();
      
      return {
        ...session,
        messages,
        partner: partner ? {
          id: partnerId,
          username: partner.username,
          isGuest: partner.is_guest
        } : { id: partnerId, username: 'Unknown User', isGuest: true }
      };
    }));
    
    res.status(200).json({ sessions: sessionsWithMessages });
  } catch (error) {
    console.error('Error in chat history endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's active chat sessions
router.get('/chat/sessions', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's active chat sessions
    const { data: sessions, error } = await supabase
      .from('chat_sessions')
      .select('id, user1_id, user2_id, started_at')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'active');
    
    if (error) {
      console.error('Error fetching active sessions:', error);
      return res.status(500).json({ error: 'Failed to fetch active sessions' });
    }
    
    // Get partner info for each session
    const sessionsWithPartners = await Promise.all(sessions.map(async (session) => {
      const partnerId = session.user1_id === userId ? session.user2_id : session.user1_id;
      const { data: partner } = await supabase
        .from('users')
        .select('username, is_guest')
        .eq('id', partnerId)
        .single();
      
      return {
        ...session,
        partner: partner ? {
          id: partnerId,
          username: partner.username,
          isGuest: partner.is_guest
        } : { id: partnerId, username: 'Unknown User', isGuest: true }
      };
    }));
    
    res.status(200).json({ sessions: sessionsWithPartners });
  } catch (error) {
    console.error('Error in active sessions endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Report a user
router.post('/report', auth.requireAuth, async (req, res) => {
  try {
    const { sessionId, reason } = req.body;
    const reporterId = req.user.id;
    
    if (!sessionId || !reason) {
      return res.status(400).json({ error: 'Session ID and reason are required' });
    }
    
    // Verify reporter is part of the session
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('user1_id, user2_id')
      .eq('id', sessionId)
      .single();
    
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    
    if (session.user1_id !== reporterId && session.user2_id !== reporterId) {
      return res.status(403).json({ error: 'You are not part of this chat session' });
    }
    
    // Get reported user ID
    const reportedUserId = session.user1_id === reporterId ? session.user2_id : session.user1_id;
    
    // Store report in database
    const { error } = await supabase
      .from('reports')
      .insert({
        session_id: sessionId,
        reporter_id: reporterId,
        reported_id: reportedUserId,
        reason,
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error creating report:', error);
      return res.status(500).json({ error: 'Failed to submit report' });
    }
    
    res.status(201).json({ message: 'Report submitted successfully' });
  } catch (error) {
    console.error('Error in report endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
