// Updated OpenAI Proxy Server for SwiftUI AI Wrapper
// Handles both old format (image: "base64") and new OpenAI Vision API format
// Created by Aivars Meijers on 14/06/2025
// Fixed for Vercel deployment compatibility

const crypto = require('crypto');

// Helper function to get raw body from request
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-hash, x-shared-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let messages, hash, shared_secret;
    let bodyData = ''; // Declare outside the if block
    
    // Handle different content types
    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('multipart/form-data')) {
      // For multipart form data, get from headers
      hash = req.headers['x-hash'];
      shared_secret = req.headers['x-shared-secret'];
      
      // Try to get raw body data from multiple sources
      if (req.body) {
        bodyData = Buffer.isBuffer(req.body) ? req.body.toString() : String(req.body);
      } else if (req.rawBody) {
        bodyData = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString() : String(req.rawBody);
      } else {
        // Try to read from request stream
        try {
          bodyData = await getRawBody(req);
        } catch (e) {
          console.log('Failed to read raw body:', e.message);
        }
      }
      
      // Extract messages from multipart form data
      if (bodyData) {
        // Look for: name="messages"...Content-Type: text/plain...[content]
        const messagesMatch = bodyData.match(/name="messages"[^]*?Content-Type:\s*text\/plain[^]*?\r?\n\r?\n([^]*?)(?:\r?\n--[^]*?(?:--)?$|\r?\n--[^]*?\r?\n)/);
        if (messagesMatch && messagesMatch[1]) {
          messages = messagesMatch[1].trim();
        }
        
        // If that doesn't work, try a simpler pattern
        if (!messages) {
          const simpleMatch = bodyData.match(/name="messages"[^]*?\r?\n\r?\n([^]*?)(?:\r?\n--)/);
          if (simpleMatch && simpleMatch[1]) {
            messages = simpleMatch[1].trim();
          }
        }
        
        // Even simpler fallback
        if (!messages) {
          const basicMatch = bodyData.match(/name="messages"[^]*?\n\n([^]*?)(?:\n--)/);
          if (basicMatch && basicMatch[1]) {
            messages = basicMatch[1].trim();
          }
        }
      }
    } else {
      // For JSON data
      messages = req.body?.messages;
      hash = req.body?.hash;
      shared_secret = req.body?.shared_secret;
    }
    
    // Validate required fields
    if (!messages || !hash || !shared_secret) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        debug: {
          hasMessages: !!messages,
          hasHash: !!hash,
          hasSharedSecret: !!shared_secret,
          contentType: contentType,
          bodyType: typeof req.body,
          rawBodyType: typeof req.rawBody,
          bodyLength: req.body ? String(req.body).length : 0,
          rawBodyLength: req.rawBody ? String(req.rawBody).length : 0,
          messagesPreview: messages ? messages.substring(0, 100) + '...' : 'null',
          bodyDataLength: bodyData ? bodyData.length : 0,
          bodyDataPreview: bodyData ? bodyData.substring(0, 200) + '...' : 'null',
          hasReadableStream: req.readable,
          requestComplete: req.complete
        }
      });
    }
    
    // Validate authentication
    const expectedSecret = process.env.SHARED_SECRET;
    if (!expectedSecret || shared_secret !== expectedSecret) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Validate hash
    const expectedHash = crypto
      .createHash('md5')
      .update(messages + expectedSecret)
      .digest('hex');
    
    if (hash !== expectedHash) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Parse messages
    let parsedMessages;
    try {
      parsedMessages = JSON.parse(messages);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid messages format' });
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
      max_tokens: 1000
    };

    console.log('Sending to OpenAI:', JSON.stringify(openaiRequest, null, 2));

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
      console.error('OpenAI API error:', errorData);
      return res.status(openaiResponse.status).json({ 
        error: 'OpenAI API request failed',
        details: errorData
      });
    }

    const openaiData = await openaiResponse.json();
    
    // Return response in format expected by iOS app
    return res.status(200).json({
      choices: [{
        message: {
          content: openaiData.choices[0].message.content
        }
      }]
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
} 