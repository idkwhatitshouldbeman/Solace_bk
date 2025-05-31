-- Supabase SQL Schema for Anonymous Chat Platform

-- Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat Sessions Table
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'abandoned'))
);

-- Messages Table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Blocked IPs Table
CREATE TABLE blocked_ips (
  ip_address TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  block_count INTEGER NOT NULL DEFAULT 1
);

-- Indexes for performance
CREATE INDEX idx_chat_sessions_user1 ON chat_sessions(user1_id);
CREATE INDEX idx_chat_sessions_user2 ON chat_sessions(user2_id);
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_flagged ON messages(flagged);
CREATE INDEX idx_blocked_ips_expires ON blocked_ips(expires_at);

-- Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_ips ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data" 
  ON users FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own data" 
  ON users FOR UPDATE 
  USING (auth.uid() = id);

-- Chat sessions policies
CREATE POLICY "Users can view their own chat sessions" 
  ON chat_sessions FOR SELECT 
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Messages policies
CREATE POLICY "Users can view messages in their sessions" 
  ON messages FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM chat_sessions 
      WHERE chat_sessions.id = messages.session_id 
      AND (chat_sessions.user1_id = auth.uid() OR chat_sessions.user2_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert messages in their sessions" 
  ON messages FOR INSERT 
  WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM chat_sessions 
      WHERE chat_sessions.id = messages.session_id 
      AND (chat_sessions.user1_id = auth.uid() OR chat_sessions.user2_id = auth.uid())
    )
  );

-- Blocked IPs policies (admin only)
CREATE POLICY "Only admins can manage blocked IPs" 
  ON blocked_ips 
  USING (auth.uid() IN (SELECT id FROM users WHERE is_admin = TRUE));

-- Create function to check if IP is blocked
CREATE OR REPLACE FUNCTION is_ip_blocked(check_ip TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM blocked_ips 
    WHERE ip_address = check_ip 
    AND (expires_at IS NULL OR expires_at > NOW())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to record message and check moderation
CREATE OR REPLACE FUNCTION record_message(
  p_session_id UUID,
  p_sender_id UUID,
  p_content TEXT,
  p_flagged BOOLEAN DEFAULT FALSE,
  p_flag_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  message_id UUID;
BEGIN
  INSERT INTO messages (session_id, sender_id, content, flagged, flag_reason)
  VALUES (p_session_id, p_sender_id, p_content, p_flagged, p_flag_reason)
  RETURNING id INTO message_id;
  
  RETURN message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
