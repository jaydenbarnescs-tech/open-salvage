// ~/claude-agent/whisper-proxy.js
// Translates OpenAI /v1/audio/transcriptions → whisper-server /inference
const http = require('http');
const https = require('https');

const PORT = 8083;
const WHISPER_HOST = '127.0.0.1';
const WHISPER_PORT = 8082;

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Only handle /v1/audio/transcriptions
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }

  // Collect raw body (multipart form data)
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';

    // Forward to whisper-server /inference
    const options = {
      hostname: WHISPER_HOST,
      port: WHISPER_PORT,
      path: '/inference',
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': body.length
      }
    };

    const proxyReq = http.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try {
          // whisper-server returns { text: "..." }
          // OpenAI format also returns { text: "..." } — compatible!
          const parsed = JSON.parse(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: parsed.text || '' }));
        } catch(e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: data.trim() }));
        }
      });
    });

    proxyReq.on('error', err => {
      console.error('Proxy error:', err.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Whisper proxy listening on port ${PORT}`);
  console.log(`Forwarding /v1/audio/transcriptions → http://${WHISPER_HOST}:${WHISPER_PORT}/inference`);
});
