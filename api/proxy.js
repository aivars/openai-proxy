// Updated OpenAI Proxy Server for SwiftUI AI Wrapper
// Handles both old format (image: "base64") and new OpenAI Vision API format
// Created by Aivars Meijers on 14/06/2025
// Fixed for Vercel deployment compatibility

const crypto = require('crypto');

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
    const { messages, hash, shared_secret } = req.body;
    
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