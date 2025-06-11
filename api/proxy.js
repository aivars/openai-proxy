import crypto from 'crypto';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, hash } = req.body;
    
    // Validate required fields
    if (!messages || !hash) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Your shared secret key (change this to something secure)
    const SHARED_SECRET = process.env.SHARED_SECRET || 'your_secure_secret_key_here';
    
    // Verify the hash
    const hashInput = messages + SHARED_SECRET;
    const expectedHash = crypto
      .createHash('md5')
      .update(hashInput)
      .digest('hex');
    
    // DEBUG LOGGING
    console.log('=== SERVER HASH VERIFICATION ===');
    console.log('Received messages length:', messages.length);
    console.log('Received hash:', hash);
    console.log('Shared secret:', SHARED_SECRET);
    console.log('Hash input length:', hashInput.length);
    console.log('Expected hash:', expectedHash);
    console.log('Hash match:', hash === expectedHash);
    console.log('================================');
    
    if (hash !== expectedHash) {
      console.log('HASH MISMATCH - Authentication failed');
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Parse messages
    let parsedMessages;
    try {
      parsedMessages = JSON.parse(messages);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // Convert to OpenAI format
    const openAIMessages = parsedMessages.map(msg => {
      if (msg.image) {
        // Handle image messages
        const imageData = msg.image.startsWith('data:') ? msg.image : `data:image/jpeg;base64,${msg.image}`;
        return {
          role: msg.role === 'system' ? 'assistant' : msg.role,
          content: [
            { type: 'text', text: msg.message || 'What is this?' },
            { type: 'image_url', image_url: { url: imageData } }
          ]
        };
      } else {
        // Handle text-only messages
        return {
          role: msg.role === 'system' ? 'assistant' : msg.role,
          content: msg.message
        };
      }
    });

    // Call OpenAI API
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cost-effective model
        messages: openAIMessages,
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!openAIResponse.ok) {
      const error = await openAIResponse.text();
      console.error('OpenAI API Error:', error);
      return res.status(500).json({ error: 'OpenAI API request failed' });
    }

    const data = await openAIResponse.json();
    const reply = data.choices[0]?.message?.content || 'No response generated';

    // Return the response as plain text (matching the original PHP proxy)
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(reply);

  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
} 