# Anonymous Chat Backend

Backend server for the Anonymous Chat Platform, built with Node.js, Express, Socket.io, and Supabase.

## Features

- **Real-time Chat**: Socket.io integration for instant messaging
- **User Authentication**: JWT-based auth with guest and registered user support
- **Content Moderation**: OpenAI Moderation API integration
- **Safety Features**: IP blocking, auto-kick for violations, rate limiting
- **Database Integration**: Supabase for data storage and retrieval

## Prerequisites

- Node.js (v16 or higher)
- Supabase account
- OpenAI API key

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/anonymous-chat-backend.git
   cd anonymous-chat-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

4. Update the `.env` file with your credentials:
   - Supabase URL and key
   - OpenAI API key
   - JWT secret
   - Frontend URL for CORS

## Supabase Setup

1. Create a new Supabase project
2. Run the SQL commands from `database-schema.sql` in the Supabase SQL editor
3. Copy your Supabase URL and anon key to the `.env` file

## Development

Start the development server:

```
npm run dev
```

The server will be available at http://localhost:3000

## Deployment on Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Configure the service:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variables**: Add all variables from your `.env` file

## Environment Variables

```
# Server Configuration
PORT=3000
NODE_ENV=development

# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key

# JWT Configuration
JWT_SECRET=your_jwt_secret_change_in_production
JWT_EXPIRY=7d

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100

# CORS Configuration
CORS_ORIGIN=https://your-frontend-url.onrender.com
```

## API Endpoints

### Authentication
- POST /api/auth/register - Register new user
- POST /api/auth/login - Login user
- POST /api/auth/guest - Create guest account
- GET /api/auth/me - Get current user info

### Chat
- GET /api/chat/history - Get chat history (for registered users)
- GET /api/chat/sessions - Get user's chat sessions

## Socket.io Events

### Server to Client
- 'connect_success' - Connection successful
- 'user_matched' - User matched with another user
- 'receive_message' - Receive message from chat partner
- 'partner_disconnected' - Chat partner disconnected
- 'moderation_flag' - Message flagged by moderation
- 'kicked' - User kicked due to violation

### Client to Server
- 'find_match' - Request to find a chat partner
- 'send_message' - Send message to chat partner
- 'skip_partner' - Skip current chat partner
- 'disconnect_chat' - Disconnect from current chat

## License

MIT
