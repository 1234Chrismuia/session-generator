const express = require('express');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Store active sessions
const sessions = new Map();

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Generate new session
app.get('/api/generate', (req, res) => {
    const sessionId = 'sess_' + Date.now() + Math.random().toString(36).substr(2, 9);
    res.json({ 
        success: true, 
        sessionId: sessionId,
        message: 'Session created. Go to /session/' + sessionId
    });
});

// Session page with QR
app.get('/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Session Generator</title>
        <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                background: white;
                padding: 40px;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
                width: 100%;
            }
            h1 {
                color: #333;
                margin-bottom: 10px;
            }
            .status {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
                font-size: 16px;
                min-height: 24px;
            }
            #qr-container {
                margin: 30px auto;
                padding: 20px;
                background: white;
                border-radius: 15px;
                border: 2px dashed #ddd;
                max-width: 300px;
            }
            #session-data {
                display: none;
                margin-top: 30px;
                text-align: left;
            }
            textarea {
                width: 100%;
                height: 120px;
                padding: 15px;
                border: 2px solid #ddd;
                border-radius: 10px;
                font-family: monospace;
                margin: 15px 0;
                resize: vertical;
            }
            button {
                background: #25D366;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                margin: 5px;
                transition: all 0.3s;
            }
            button:hover {
                background: #1da851;
                transform: translateY(-2px);
            }
            .loading {
                display: inline-block;
                width: 30px;
                height: 30px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #25D366;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-right: 10px;
                vertical-align: middle;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📱 WhatsApp Session Generator</h1>
            <p>Session ID: ${sessionId}</p>
            
            <div class="status" id="status">
                <div class="loading"></div>
                Initializing session...
            </div>
            
            <div id="qr-container">
                <!-- QR will appear here -->
            </div>
            
            <div id="session-data">
                <h3>✅ Session Generated Successfully!</h3>
                <p><strong>Copy this to your bot's config.env:</strong></p>
                <textarea id="session-string" readonly></textarea>
                <div>
                    <button onclick="copySession()">📋 Copy Session</button>
                    <button onclick="downloadSession()">💾 Download</button>
                    <button onclick="newSession()">🔄 New Session</button>
                </div>
                <div id="session-info" style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 10px;">
                    <!-- Session info will appear here -->
                </div>
            </div>
        </div>
        
        <script>
            const socket = io();
            const sessionId = '${sessionId}';
            
            socket.emit('join', sessionId);
            
            socket.on('qr', (qrImage) => {
                document.getElementById('status').innerHTML = '📱 Scan QR code with WhatsApp';
                document.getElementById('qr-container').innerHTML = '<img src="' + qrImage + '" alt="QR Code" style="max-width: 100%;">';
            });
            
            socket.on('status', (message) => {
                document.getElementById('status').innerHTML = message;
            });
            
            socket.on('connected', (data) => {
                document.getElementById('status').innerHTML = '✅ Connected! Generating session...';
                setTimeout(() => {
                    document.getElementById('session-data').style.display = 'block';
                    document.getElementById('qr-container').innerHTML = '';
                    
                    const sessionString = data.sessionString;
                    const escapedString = sessionString.replace(/'/g, "\\\\'");
                    const configLine = "SESSION_ID='" + escapedString + "'";
                    
                    document.getElementById('session-string').value = configLine;
                    
                    // Show session info
                    document.getElementById('session-info').innerHTML = \`
                        <h4>📊 Session Information:</h4>
                        <p><strong>User ID:</strong> \${data.userInfo?.id || 'N/A'}</p>
                        <p><strong>JSON Length:</strong> \${sessionString.length} characters</p>
                        <p><strong>Base64 Length:</strong> \${data.base64String.length} characters</p>
                        <p><strong>Generated:</strong> \${new Date().toLocaleString()}</p>
                    \`;
                    
                    document.getElementById('status').innerHTML = '✅ Session ready! Copy below.';
                }, 1000);
            });
            
            socket.on('error', (error) => {
                document.getElementById('status').innerHTML = '❌ Error: ' + error;
                document.getElementById('qr-container').innerHTML = '';
            });
            
            function copySession() {
                const textarea = document.getElementById('session-string');
                textarea.select();
                document.execCommand('copy');
                
                const btn = event.target;
                const original = btn.innerHTML;
                btn.innerHTML = '✅ Copied!';
                btn.style.background = '#4CAF50';
                
                setTimeout(() => {
                    btn.innerHTML = original;
                    btn.style.background = '';
                }, 2000);
            }
            
            function downloadSession() {
                const textarea = document.getElementById('session-string');
                const blob = new Blob([textarea.value], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'whatsapp-session.txt';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            
            function newSession() {
                window.location.href = '/';
            }
        </script>
    </body>
    </html>
    `);
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
    socket.on('join', async (sessionId) => {
        socket.join(sessionId);
        
        try {
            // Create temp directory for this session
            const sessionDir = path.join(__dirname, 'temp', sessionId);
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
            fs.mkdirSync(sessionDir, { recursive: true });
            
            // Initialize WhatsApp connection
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: { level: 'silent' }
            });
            
            // Store in sessions map
            sessions.set(sessionId, { sock, sessionDir });
            
            sock.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;
                
                if (qr) {
                    // Generate QR code as data URL
                    try {
                        const qrImage = await QRCode.toDataURL(qr);
                        io.to(sessionId).emit('qr', qrImage);
                        io.to(sessionId).emit('status', '📱 Scan QR code with WhatsApp');
                    } catch (error) {
                        console.error('QR generation error:', error);
                        io.to(sessionId).emit('status', '❌ Error generating QR code');
                    }
                }
                
                if (connection === 'open') {
                    io.to(sessionId).emit('status', '✅ Connected! Getting session...');
                    
                    // Wait a moment for session to save
                    setTimeout(async () => {
                        try {
                            const credsPath = path.join(sessionDir, 'creds.json');
                            if (fs.existsSync(credsPath)) {
                                const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                                const sessionString = JSON.stringify(creds);
                                const base64String = Buffer.from(sessionString).toString('base64');
                                
                                io.to(sessionId).emit('connected', {
                                    sessionId: sessionId,
                                    sessionString: sessionString,
                                    base64String: base64String,
                                    userInfo: sock.user
                                });
                                
                                // Cleanup after 5 minutes
                                setTimeout(() => {
                                    cleanupSession(sessionId);
                                }, 5 * 60 * 1000);
                            } else {
                                io.to(sessionId).emit('status', '❌ Session file not found');
                            }
                        } catch (error) {
                            io.to(sessionId).emit('error', 'Failed to read session: ' + error.message);
                        }
                    }, 2000);
                }
                
                if (connection === 'close') {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        io.to(sessionId).emit('status', '❌ Connection closed. Try again.');
                    }
                    cleanupSession(sessionId);
                }
            });
            
            sock.ev.on('creds.update', saveCreds);
            
        } catch (error) {
            console.error('Session initialization error:', error);
            io.to(sessionId).emit('error', 'Failed to initialize: ' + error.message);
        }
    });
    
    socket.on('disconnect', () => {
        // Cleanup if needed
    });
});

// Cleanup function
function cleanupSession(sessionId) {
    if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        try {
            if (session.sock) session.sock.end();
            if (session.sessionDir && fs.existsSync(session.sessionDir)) {
                fs.rmSync(session.sessionDir, { recursive: true, force: true });
            }
        } catch (error) {
            console.error('Cleanup error:', error);
        }
        sessions.delete(sessionId);
    }
}

// Clean temp directory on startup
const tempDir = path.join(__dirname, 'temp');
if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Session Generator running on port ${PORT}`);
    console.log(`🌐 Open: http://localhost:${PORT}`);
    console.log(`📱 Ready to generate WhatsApp sessions!`);
});

// Handle process exit
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    // Cleanup all sessions
    for (const [sessionId] of sessions) {
        cleanupSession(sessionId);
    }
    process.exit(0);
});