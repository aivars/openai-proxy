// Enhanced OpenAI Proxy Server with Security Features
// Handles both old format (image: "base64") and new OpenAI Vision API format
// Created by Aivars Meijers on 14/06/2025
// Enhanced with security features to prevent abuse

const crypto = require('crypto');

// In-memory rate limiting (for basic protection)
// In production, use Redis or similar for distributed rate limiting
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20; // Max 20 requests per minute per IP (increased for image analysis)
const RATE_LIMIT_MAX_TOKENS = 100000; // Max 100k tokens per minute per IP

// Request size limits
const MAX_REQUEST_SIZE = 20 * 1024 * 1024; // 20MB max request size (increased for images)
const MAX_MESSAGE_LENGTH = 500000; // Max 500k characters (increased for base64 images)

// Helper function to get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         'unknown';
}

// Rate limiting function
function checkRateLimit(ip) {
  const now = Date.now();
  const key = `${ip}`;
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { requests: 1, tokens: 0, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  
  const data = rateLimitStore.get(key);
  
  // Reset if window expired
  if (now > data.resetTime) {
    data.requests = 1;
    data.tokens = 0;
    data.resetTime = now + RATE_LIMIT_WINDOW;
    rateLimitStore.set(key, data);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  
  // Check limits
  if (data.requests >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn: data.resetTime - now };
  }
  
  data.requests++;
  rateLimitStore.set(key, data);
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - data.requests };
}

// Clean up old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW);

// Helper function to get raw body from request
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_SIZE) {
        reject(new Error('Request too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const startTime = Date.now();
  const clientIP = getClientIP(req);
  
  // Set security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-hash, x-shared-secret');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const rateLimit = checkRateLimit(clientIP);
  if (!rateLimit.allowed) {
    console.log(`==> Rate limit exceeded for IP: ${clientIP}`);
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      resetIn: Math.ceil(rateLimit.resetIn / 1000)
    });
  }

  try {
    let messages, hash, shared_secret, timestamp;
    
    // Handle different content types
    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      // Handle JSON requests (new simplified approach)
      messages = req.body?.messages;
      hash = req.body?.hash || req.headers['x-hash'];
      shared_secret = req.body?.shared_secret || req.headers['x-shared-secret'];
      timestamp = req.body?.timestamp || req.headers['x-timestamp'];
      
      console.log(`==> JSON request from IP: ${clientIP}`);
      console.log('==> Messages length:', messages ? messages.length : 0);
      console.log('==> Has hash:', !!hash);
      console.log('==> Has shared_secret:', !!shared_secret);
      console.log('==> Has timestamp:', !!timestamp);
      
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // Handle form-encoded requests (legacy support)
      messages = req.body?.messages;
      hash = req.body?.hash || req.headers['x-hash'];
      shared_secret = req.body?.shared_secret || req.headers['x-shared-secret'];
      timestamp = req.body?.timestamp || req.headers['x-timestamp'];
      
      console.log(`==> Form-encoded request from IP: ${clientIP}`);
      
    } else {
      return res.status(400).json({ 
        error: 'Unsupported content type',
        contentType: contentType
      });
    }
    
    // Validate required fields
    if (!messages || !hash || !shared_secret) {
      console.log(`==> Missing fields from IP: ${clientIP}`);
      return res.status(400).json({ 
        error: 'Missing required fields'
      });
    }
    
    // Validate message length
    if (messages.length > MAX_MESSAGE_LENGTH) {
      console.log(`==> Message too long from IP: ${clientIP}`);
      return res.status(400).json({ error: 'Message too long' });
    }
    
    // Enhanced authentication validation
    const baseSecret = process.env.SHARED_SECRET;
    if (!baseSecret) {
      console.error('==> SHARED_SECRET environment variable not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    // Handle both old format (direct secret) and new format (dynamic secret with timestamp)
    let expectedSecret;
    let isLegacyAuth = false;
    
    if (timestamp && shared_secret.includes('_')) {
      // New dynamic authentication format
      const requestTimestamp = parseInt(timestamp);
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      // Check if timestamp is within acceptable range (5 minutes)
      const timestampDiff = Math.abs(currentTimestamp - requestTimestamp);
      if (timestampDiff > 300) { // 5 minutes
        console.log(`==> Timestamp too old from IP: ${clientIP}, diff: ${timestampDiff}s`);
        return res.status(401).json({ error: 'Request timestamp expired' });
      }
      
      expectedSecret = `${baseSecret}_${timestamp}`;
    } else {
      // Legacy authentication (direct secret comparison)
      expectedSecret = baseSecret;
      isLegacyAuth = true;
    }
    
    // Timing-safe comparison to prevent timing attacks
    const secretBuffer = Buffer.from(shared_secret, 'utf8');
    const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
    
    if (secretBuffer.length !== expectedBuffer.length || 
        !crypto.timingSafeEqual(secretBuffer, expectedBuffer)) {
      console.log(`==> Invalid authentication from IP: ${clientIP} (${isLegacyAuth ? 'legacy' : 'dynamic'})`);
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Validate hash with timing-safe comparison
    const expectedHash = crypto
      .createHash('md5')
      .update(messages + expectedSecret)
      .digest('hex');
    
    const hashBuffer = Buffer.from(hash, 'utf8');
    const expectedHashBuffer = Buffer.from(expectedHash, 'utf8');
    
    if (hashBuffer.length !== expectedHashBuffer.length ||
        !crypto.timingSafeEqual(hashBuffer, expectedHashBuffer)) {
      console.log(`==> Invalid hash from IP: ${clientIP}`);
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Parse messages
    let parsedMessages;
    try {
      parsedMessages = JSON.parse(messages);
    } catch (e) {
      console.log(`==> Invalid JSON from IP: ${clientIP}`);
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // Validate parsed messages structure
    if (!Array.isArray(parsedMessages) || parsedMessages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages structure' });
    }

    // Convert old format to new OpenAI Vision API format
    const convertedMessages = parsedMessages.map(message => {
      // If message has old format with separate image field
      if (message.image && message.message) {
        return {
          role: message.role || 'user',
          content: [
            {
              type: 'text',
              text: message.message
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${message.image}`
              }
            }
          ]
        };
      }
      
      // If message already has content array (new format)
      if (message.content && Array.isArray(message.content)) {
        return message;
      }
      
      // Regular text message
      return {
        role: message.role || 'user',
        content: message.message || message.content || ''
      };
    });

    // Prepare OpenAI request
    const openaiRequest = {
      model: 'gpt-4o', // Use latest vision model
      messages: convertedMessages,
      max_tokens: 4000,
      temperature: 0.7
    };

    console.log(`==> Sending to OpenAI from IP: ${clientIP} with ${convertedMessages.length} messages`);

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(openaiRequest)
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error(`==> OpenAI API error for IP ${clientIP}:`, errorData);
      return res.status(openaiResponse.status).json({ 
        error: 'OpenAI API request failed'
      });
    }

    const openaiData = await openaiResponse.json();
    
    const responseLength = openaiData.choices[0].message.content.length;
    const processingTime = Date.now() - startTime;
    
    console.log(`==> OpenAI response for IP ${clientIP}: ${responseLength} chars, ${processingTime}ms`);
    
    // Return response in format expected by iOS app
    return res.status(200).json({
      choices: [{
        message: {
          content: openaiData.choices[0].message.content
        }
      }]
    });

  } catch (error) {
    console.error(`==> Proxy error for IP ${clientIP}:`, error.message);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
}; 

