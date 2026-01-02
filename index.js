const express = require('express');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Store active sessions
const activeSessions = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

app.get('/generate', (req, res) => {
  const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  res.json({
    success: true,
    sessionId: sessionId,
    qrUrl: `/qr-generate?session=${sessionId}`
  });
});

app.get('/qr-generate', async (req, res) => {
  const sessionId = req.query.session;
  if (!sessionId) {
    return res.status(400).send('No session ID provided');
  }

  try {
    const sessionDir = path.join(__dirname, 'temp_sessions', sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: { level: 'silent' }
    });

    // Store socket reference
    activeSessions.set(sessionId, { sock, sessionDir });

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        // Generate QR code image
        const qrImage = await QRCode.toDataURL(qr);
        
        // Send QR to client via Socket.io
        io.to(sessionId).emit('qr', qrImage);
        io.to(sessionId).emit('status', 'Scan QR code with WhatsApp');
      }

      if (connection === 'open') {
        console.log(`✅ Session ${sessionId} connected!`);
        
        // Get session data
        const credsPath = path.join(sessionDir, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
          
          // Send session data to client
          io.to(sessionId).emit('connected', {
            sessionId: sessionId,
            sessionString: JSON.stringify(creds),
            base64String: Buffer.from(JSON.stringify(creds)).toString('base64'),
            userInfo: sock.user
          });
          
          io.to(sessionId).emit('status', '✅ Connected! Session generated successfully.');
          
          // Cleanup after 30 seconds
          setTimeout(() => {
            if (activeSessions.has(sessionId)) {
              sock.end();
              activeSessions.delete(sessionId);
              
              // Remove temp files
              try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
              } catch (e) {}
            }
          }, 30000);
        }
      }

      if (connection === 'close') {
        if (lastDisconnect?.error?.output?.statusCode !== 401) {
          io.to(sessionId).emit('status', '❌ Connection closed. Please try again.');
        }
        
        // Cleanup
        if (activeSessions.has(sessionId)) {
          activeSessions.delete(sessionId);
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch (e) {}
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Generator</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
          body { font-family: Arial; text-align: center; padding: 20px; }
          #qr-container { margin: 20px auto; }
          #status { margin: 20px; padding: 10px; }
          #session-data { 
            background: #f5f5f5; 
            padding: 20px; 
            margin: 20px; 
            border-radius: 10px;
            text-align: left;
            word-wrap: break-word;
            display: none;
          }
          textarea {
            width: 100%;
            height: 100px;
            margin: 10px 0;
            padding: 10px;
            font-family: monospace;
          }
          button {
            background: #25D366;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin: 5px;
          }
          button:hover { background: #1da851; }
        </style>
      </head>
      <body>
        <h2>📱 WhatsApp Session Generator</h2>
        <div id="status">Initializing...</div>
        <div id="qr-container"></div>
        <div id="session-data">
          <h3>✅ Session Generated Successfully!</h3>
          <p><strong>Copy this to your config.env:</strong></p>
          <textarea id="session-string" readonly></textarea>
          <button onclick="copySession()">📋 Copy Session</button>
          <button onclick="downloadSession()">💾 Download Session</button>
          <button onclick="window.location.href='/'">🔄 Generate Another</button>
        </div>
        
        <script>
          const socket = io();
          const sessionId = '${sessionId}';
          
          socket.emit('join', sessionId);
          
          socket.on('qr', (qrImage) => {
            document.getElementById('status').innerHTML = '📱 Scan QR Code with WhatsApp';
            document.getElementById('qr-container').innerHTML = \`<img src="\${qrImage}" alt="QR Code">\`;
          });
          
          socket.on('status', (message) => {
            document.getElementById('status').innerHTML = message;
          });
          
          socket.on('connected', (data) => {
            document.getElementById('qr-container').innerHTML = '';
            document.getElementById('session-data').style.display = 'block';
            
            // Show session string
            const sessionString = data.sessionString;
            document.getElementById('session-string').value = \`SESSION_ID='\${sessionString.replace(/'/g, "\\\\'")}'\`;
            
            // Also show other info
            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = \`
              <p><strong>User ID:</strong> \${data.userInfo?.id || 'N/A'}</p>
              <p><strong>Session ID:</strong> \${data.sessionId}</p>
              <p><strong>Base64 Length:</strong> \${data.base64String.length} characters</p>
            \`;
            document.getElementById('session-data').appendChild(infoDiv);
          });
          
          function copySession() {
            const textarea = document.getElementById('session-string');
            textarea.select();
            document.execCommand('copy');
            alert('Session copied to clipboard!');
          }
          
          function downloadSession() {
            const textarea = document.getElementById('session-string');
            const blob = new Blob([textarea.value], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'whatsapp-session.txt';
            a.click();
            URL.revokeObjectURL(url);
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error generating session');
  }
});

// Socket.io connection
io.on('connection', (socket) => {
  socket.on('join', (sessionId) => {
    socket.join(sessionId);
  });
});

// Cleanup temp sessions on startup
const tempDir = path.join(__dirname, 'temp_sessions');
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Session Generator running on: http://localhost:${PORT}`);
  console.log(`📱 Open in browser to generate WhatsApp sessions`);
});
