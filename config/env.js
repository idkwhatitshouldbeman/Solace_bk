require('dotenv').config();

// Environment variables configuration
const env = {
  // Server configuration
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Supabase configuration
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  
  // JWT configuration
  JWT_SECRET: process.env.JWT_SECRET || 'your-default-jwt-secret-change-in-production',
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  
  // OpenAI configuration
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 100 requests per minute
  
  // CORS configuration
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
};

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'OPENAI_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !env[varName]);

if (missingEnvVars.length > 0) {
  console.warn(`Warning: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  if (env.NODE_ENV === 'production') {
    console.error('Missing required environment variables in production mode. Exiting.');
    process.exit(1);
  }
}

module.exports = env;
