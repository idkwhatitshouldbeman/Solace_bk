const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./db');
const env = require('./env');
const moderationService = require('../services/moderationService');

// Store active users and their socket connections
const activeUsers = new Map(); // userId -> socket
const waitingUsers = new Set(); // Set of userIds waiting for match
const activeSessions = new Map(); // sessionId -> { user1Id, user2Id }
const userSessions = new Map(); // userId -> sessionId

// Initialize Socket.io
function initializeSocket(server) {
  const io = socketIO(server, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Middleware for authentication
  io.use((socket, next) => {
    const userId = socket.handshake.auth.userId;
    if (!userId) {
      return next(new Error('Authentication error'));
    }
    
    // Store user connection
    socket.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`);
    
    // Add user to active users
    activeUsers.set(socket.userId, socket);
    
    // Handle find match request
    socket.on('find_match', () => {
      // Check if user is already in a session
      if (userSessions.has(socket.userId)) {
        socket.emit('error', { message: 'You are already in a chat session' });
        return;
      }
      
      findMatch(socket);
    });
    
    // Handle send message
    socket.on('send_message', async (data) => {
      const { content } = data;
      const sessionId = userSessions.get(socket.userId);
      
      if (!sessionId) {
        socket.emit('error', { message: 'You are not in a chat session' });
        return;
      }
      
      const session = activeSessions.get(sessionId);
      if (!session) {
        socket.emit('error', { message: 'Chat session not found' });
        return;
      }
      
      // Check message with moderation service
      try {
        const moderationResult = await moderationService.checkContent(content);
        
        if (moderationResult.flagged) {
          // Message is flagged, notify user and don't send
          socket.emit('moderation_flag', { 
            reason: moderationResult.flagReason,
            severity: moderationResult.severity
          });
          
          // If severe violation, kick user
          if (moderationResult.severity === 'high') {
            endSession(sessionId, socket.userId, 'kicked');
            socket.emit('kicked', { reason: 'Content violation' });
            return;
          }
          
          return;
        }
        
        // Get partner ID
        const partnerId = session.user1Id === socket.userId ? session.user2Id : session.user1Id;
        const partnerSocket = activeUsers.get(partnerId);
        
        // Send message to partner
        if (partnerSocket) {
          partnerSocket.emit('receive_message', {
            content,
            senderId: socket.userId,
            timestamp: new Date().toISOString()
          });
        }
        
        // Store message in database for registered users
        await storeMessage(sessionId, socket.userId, content, false);
        
      } catch (error) {
        console.error('Error processing message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
    
    // Handle skip partner
    socket.on('skip_partner', () => {
      const sessionId = userSessions.get(socket.userId);
      if (!sessionId) {
        socket.emit('error', { message: 'You are not in a chat session' });
        return;
      }
      
      endSession(sessionId, socket.userId, 'skipped');
      
      // Put user back in waiting queue
      findMatch(socket);
    });
    
    // Handle disconnect chat
    socket.on('disconnect_chat', () => {
      const sessionId = userSessions.get(socket.userId);
      if (sessionId) {
        endSession(sessionId, socket.userId, 'disconnected');
      }
    });
    
    // Handle socket disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
      
      // Remove from waiting users if present
      waitingUsers.delete(socket.userId);
      
      // End any active session
      const sessionId = userSessions.get(socket.userId);
      if (sessionId) {
        endSession(sessionId, socket.userId, 'disconnected');
      }
      
      // Remove from active users
      activeUsers.delete(socket.userId);
    });
  });
  
  return io;
}

// Find a match for a user
function findMatch(socket) {
  const userId = socket.userId;
  
  // Add to waiting users
  waitingUsers.add(userId);
  socket.emit('waiting_for_match');
  
  // Check if there are other waiting users
  if (waitingUsers.size > 1) {
    // Get another waiting user (not self)
    let matchedUserId = null;
    for (const waitingUserId of waitingUsers) {
      if (waitingUserId !== userId) {
        matchedUserId = waitingUserId;
        break;
      }
    }
    
    if (matchedUserId) {
      // Remove both users from waiting list
      waitingUsers.delete(userId);
      waitingUsers.delete(matchedUserId);
      
      // Create a new session
      const sessionId = uuidv4();
      activeSessions.set(sessionId, {
        user1Id: userId,
        user2Id: matchedUserId,
        startTime: new Date()
      });
      
      // Update user sessions map
      userSessions.set(userId, sessionId);
      userSessions.set(matchedUserId, sessionId);
      
      // Get matched user socket
      const matchedUserSocket = activeUsers.get(matchedUserId);
      
      // Notify both users
      socket.emit('user_matched', { sessionId });
      if (matchedUserSocket) {
        matchedUserSocket.emit('user_matched', { sessionId });
      }
      
      // Store session in database
      createChatSession(sessionId, userId, matchedUserId);
    }
  }
}

// End a chat session
function endSession(sessionId, initiatorId, reason) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  
  // Get both user IDs
  const { user1Id, user2Id } = session;
  const partnerId = user1Id === initiatorId ? user2Id : user1Id;
  
  // Remove session from maps
  activeSessions.delete(sessionId);
  userSessions.delete(user1Id);
  userSessions.delete(user2Id);
  
  // Notify partner if they're still connected
  const partnerSocket = activeUsers.get(partnerId);
  if (partnerSocket) {
    partnerSocket.emit('partner_disconnected', { reason });
  }
  
  // Update session in database
  updateChatSession(sessionId, 'ended');
}

// Database functions
async function createChatSession(sessionId, user1Id, user2Id) {
  try {
    await supabase
      .from('chat_sessions')
      .insert({
        id: sessionId,
        user1_id: user1Id,
        user2_id: user2Id,
        started_at: new Date().toISOString(),
        status: 'active'
      });
  } catch (error) {
    console.error('Error creating chat session:', error);
  }
}

async function updateChatSession(sessionId, status) {
  try {
    await supabase
      .from('chat_sessions')
      .update({
        ended_at: new Date().toISOString(),
        status
      })
      .eq('id', sessionId);
  } catch (error) {
    console.error('Error updating chat session:', error);
  }
}

async function storeMessage(sessionId, senderId, content, flagged, flagReason = null) {
  try {
    await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        sender_id: senderId,
        content,
        flagged,
        flag_reason: flagReason
      });
  } catch (error) {
    console.error('Error storing message:', error);
  }
}

module.exports = { initializeSocket };
