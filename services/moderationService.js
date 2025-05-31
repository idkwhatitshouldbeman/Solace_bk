const { Configuration, OpenAIApi } = require('openai');
const env = require('../config/env');
const supabase = require('../config/db');

// Initialize OpenAI API client
const configuration = new Configuration({
  apiKey: env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// IP tracking for rate limiting and blocking
const ipTracker = new Map(); // ip -> { count, lastViolation, warnings }

/**
 * Check content using OpenAI Moderation API
 * @param {string} content - Message content to check
 * @param {string} [ipAddress] - Optional IP address for tracking violations
 * @returns {Promise<Object>} - Moderation result with flagged status and reason
 */
async function checkContent(content, ipAddress = null) {
  try {
    // Skip empty content
    if (!content || content.trim() === '') {
      return { flagged: false };
    }
    
    // Call OpenAI Moderation API
    const response = await openai.createModeration({
      input: content,
    });
    
    const result = response.data.results[0];
    
    // Check if content is flagged
    if (result.flagged) {
      // Get the categories that were flagged
      const flaggedCategories = Object.entries(result.categories)
        .filter(([_, value]) => value)
        .map(([key, _]) => key);
      
      // Determine severity based on category and score
      const severity = determineSeverity(result);
      
      // Track IP violation if provided
      if (ipAddress && severity !== 'low') {
        trackViolation(ipAddress, severity, flaggedCategories.join(', '));
      }
      
      return {
        flagged: true,
        flagReason: `Content flagged for: ${flaggedCategories.join(', ')}`,
        severity,
        categories: flaggedCategories
      };
    }
    
    return { flagged: false };
  } catch (error) {
    console.error('Error checking content with OpenAI Moderation API:', error);
    // Fail open - allow content if moderation API fails
    return { flagged: false, error: 'Moderation service unavailable' };
  }
}

/**
 * Determine severity of flagged content
 * @param {Object} result - OpenAI moderation result
 * @returns {string} - Severity level: 'low', 'medium', or 'high'
 */
function determineSeverity(result) {
  // High severity categories
  const highSeverityCategories = [
    'sexual/minors',
    'hate/threatening',
    'violence/graphic',
    'self-harm'
  ];
  
  // Check for high severity categories
  for (const category of highSeverityCategories) {
    if (result.categories[category] && result.category_scores[category] > 0.8) {
      return 'high';
    }
  }
  
  // Check overall score
  const maxScore = Math.max(...Object.values(result.category_scores));
  if (maxScore > 0.9) return 'high';
  if (maxScore > 0.7) return 'medium';
  return 'low';
}

/**
 * Track IP violations for potential blocking
 * @param {string} ipAddress - User IP address
 * @param {string} severity - Violation severity
 * @param {string} reason - Violation reason
 */
async function trackViolation(ipAddress, severity, reason) {
  if (!ipTracker.has(ipAddress)) {
    ipTracker.set(ipAddress, { count: 0, lastViolation: Date.now(), warnings: 0 });
  }
  
  const record = ipTracker.get(ipAddress);
  record.count++;
  record.lastViolation = Date.now();
  
  // Increment warnings for medium/high severity
  if (severity !== 'low') {
    record.warnings++;
  }
  
  // Check if IP should be blocked
  if (
    (severity === 'high' && record.warnings >= 1) || // Block immediately for high severity
    (severity === 'medium' && record.warnings >= 3) || // Block after 3 medium warnings
    (record.warnings >= 5) // Block after 5 total warnings
  ) {
    await blockIP(ipAddress, reason, severity);
  }
}

/**
 * Block an IP address in the database
 * @param {string} ipAddress - IP address to block
 * @param {string} reason - Reason for blocking
 * @param {string} severity - Violation severity
 */
async function blockIP(ipAddress, reason, severity) {
  try {
    // Check if IP is already blocked
    const { data: existingBlock } = await supabase
      .from('blocked_ips')
      .select('*')
      .eq('ip_address', ipAddress)
      .single();
    
    if (existingBlock) {
      // Update existing block
      await supabase
        .from('blocked_ips')
        .update({
          block_count: existingBlock.block_count + 1,
          reason: `${existingBlock.reason}; ${reason}`,
          // Extend block duration for repeat offenders
          expires_at: severity === 'high' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days or permanent
        })
        .eq('ip_address', ipAddress);
    } else {
      // Create new block
      const expiryDate = severity === 'high' 
        ? null // Permanent block for high severity
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days for others
      
      await supabase
        .from('blocked_ips')
        .insert({
          ip_address: ipAddress,
          reason,
          blocked_at: new Date().toISOString(),
          expires_at: expiryDate ? expiryDate.toISOString() : null,
          block_count: 1
        });
    }
    
    console.log(`IP ${ipAddress} blocked for: ${reason}`);
  } catch (error) {
    console.error('Error blocking IP:', error);
  }
}

/**
 * Check if an IP address is blocked
 * @param {string} ipAddress - IP address to check
 * @returns {Promise<boolean>} - True if IP is blocked
 */
async function isIPBlocked(ipAddress) {
  try {
    const { data } = await supabase
      .from('blocked_ips')
      .select('*')
      .eq('ip_address', ipAddress)
      .single();
    
    if (!data) return false;
    
    // Check if block has expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error checking if IP is blocked:', error);
    return false;
  }
}

module.exports = {
  checkContent,
  isIPBlocked,
  blockIP
};
