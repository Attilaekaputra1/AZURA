/**
 * AZURA Live WebRTC & WebSocket Companion Stream Portal
 * Serves an ultra-fast, zero-latency 60fps web streamer UI on port 7860
 * Powered by Chrome DevTools Protocol (CDP) Screencast.
 * Now features:
 * - Real-Time Interactive Co-Op Gaming Command Center
 * - Speech-to-Text Voice Mic Input (Web Speech API)
 * - Text Command Chat & D-Pad Direction Buttons
 * - Live Azura Spoken Persona Response Bubble
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const config = require('./config');

const PORT = process.env.STREAM_PORT || 7860;
const VPS_PUBLIC_IP = process.env.VPS_IP || '203.175.10.163';
const STREAM_URL = `http://${VPS_PUBLIC_IP}:${PORT}/live`;

let server = null;
let wss = null;
const connectedClients = new Set();
let latestFrame = null;
let currentMeta = {
  title: 'AZURA Companion Standby',
  url: 'about:blank',
  activeGuild: null
};

/**
 * Initialize HTTP & WebSocket Stream Server
 */
function initLivePortal() {
  if (server) return;

  server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'online', clients: connectedClients.size, streamUrl: STREAM_URL }));
    }

    if (req.url.startsWith('/live')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml());
    }

    // ── REST API: INTERACTIVE GAME COMMANDS ──
    if (req.url === '/api/game/command' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { executeInteractiveMove } = require('./browserGameAgent');
          const result = await executeInteractiveMove(payload.command, payload.userName || 'Attila');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    // ── MASTER DASHBOARD (TO-DO, ADVICE & BUG REPORTS) ──
    if (
      req.url === '/todo' || req.url === '/tasks' || req.url.startsWith('/todo?') ||
      req.url === '/feedback' || req.url === '/reports' || req.url.startsWith('/feedback?') ||
      req.url === '/roadmap' || req.url.startsWith('/roadmap?')
    ) {
      const { getTodos } = require('./todo');
      const { getAllFeedbackTickets } = require('./feedback');
      const { generateMasterDashboardHtml } = require('./dashboardHtml');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(generateMasterDashboardHtml(getTodos(), getAllFeedbackTickets()));
    }

    // ── REST API: TO-DO TASKS ──
    if (req.url === '/api/todo/list') {
      const { getTodos } = require('./todo');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, tasks: getTodos() }));
    }

    if (req.url === '/api/todo/create' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { createTodo } = require('./todo');
          const task = createTodo(payload.title, payload.category, payload.priority, payload.dueDate, payload.notes, 'web', 'Web User');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, task }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    if (req.url === '/api/todo/toggle' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { toggleTodoStatus } = require('./todo');
          const task = toggleTodoStatus(payload.id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: !!task, task }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    if (req.url === '/api/todo/delete' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { deleteTodo } = require('./todo');
          const deleted = deleteTodo(payload.id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: deleted }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    // ── REST API: FEEDBACK & BUG REPORT TICKETS ──
    if (req.url === '/api/feedback/list') {
      const { getAllFeedbackTickets } = require('./feedback');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, tickets: getAllFeedbackTickets() }));
    }

    if (req.url === '/api/feedback/status' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { updateFeedbackStatus } = require('./feedback');
          const ticket = updateFeedbackStatus(payload.ticketId, payload.status, payload.rejectReason);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: !!ticket, ticket }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    if (req.url === '/api/feedback/delete' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { deleteFeedbackTicket } = require('./feedback');
          const deleted = deleteFeedbackTicket(payload.ticketId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: deleted }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    connectedClients.add(ws);
    console.log(`[Live Portal]: 👤 New viewer connected. Total active viewers: ${connectedClients.size}`);

    // Send metadata immediately
    ws.send(JSON.stringify({ type: 'meta', meta: currentMeta }));

    // Send latest frame if available
    if (latestFrame) {
      ws.send(JSON.stringify({ type: 'frame', data: latestFrame }));
    }

    // Handle interactive game commands over WebSocket
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'game_command') {
          const { executeInteractiveMove } = require('./browserGameAgent');
          const result = await executeInteractiveMove(msg.command, msg.userName || 'Attila');
          
          // Broadcast Azura's reaction to all connected viewers
          const respPayload = JSON.stringify({
            type: 'azura_reply',
            text: result.response,
            userName: msg.userName || 'Attila'
          });
          for (const client of connectedClients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(respPayload);
            }
          }
        }
      } catch (err) {
        console.error('[Live Portal WS Error]:', err.message);
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
      console.log(`[Live Portal]: 👤 Viewer disconnected. Remaining viewers: ${connectedClients.size}`);
    });

    ws.on('error', () => {
      connectedClients.delete(ws);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Live Portal]: 🚀 High-Speed Live Stream Server running at ${STREAM_URL}`);
  });
}

/**
 * Broadcast frame to all connected WebSocket viewers
 * @param {string} base64Data 
 * @param {object} [meta] 
 */
function broadcastFrame(base64Data, meta = null) {
  latestFrame = base64Data;
  if (meta) {
    currentMeta = { ...currentMeta, ...meta };
  }

  if (connectedClients.size === 0) return;

  const payload = JSON.stringify({
    type: 'frame',
    data: base64Data,
    meta: currentMeta
  });

  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Update current stream metadata (URL, title)
 * @param {object} meta 
 */
function updateStreamMeta(meta) {
  currentMeta = { ...currentMeta, ...meta };
  if (connectedClients.size === 0) return;

  const payload = JSON.stringify({
    type: 'meta',
    meta: currentMeta
  });

  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Check if there are active viewers waiting for screencast frames
 */
function hasActiveViewers() {
  return connectedClients.size > 0;
}

/**
 * Sleek Modern Cyber-Companion HTML5 Viewer UI with Interactive Co-Op Controls
 */
function getPortalHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AZURA Live Screen & Interactive Co-Op Gaming</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0a0c10;
      --card-bg: rgba(18, 22, 31, 0.85);
      --accent: #5865F2;
      --accent-glow: rgba(88, 101, 242, 0.4);
      --neon-cyan: #00f2fe;
      --neon-pink: #ff007f;
      --text-main: #f0f4f8;
      --text-muted: #94a3b8;
      --border-color: rgba(255, 255, 255, 0.08);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    body {
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(circle at 10% 20%, rgba(88, 101, 242, 0.15) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(0, 242, 254, 0.12) 0%, transparent 40%);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    header {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      background: linear-gradient(135deg, var(--accent), var(--neon-cyan));
      width: 38px;
      height: 38px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      box-shadow: 0 0 16px var(--accent-glow);
    }

    .brand-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(46, 204, 113, 0.15);
      border: 1px solid rgba(46, 204, 113, 0.4);
      color: #2ecc71;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      background: #2ecc71;
      border-radius: 50%;
      box-shadow: 0 0 8px #2ecc71;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.2); }
    }

    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 18px 24px;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
      gap: 16px;
    }

    .stream-wrapper {
      width: 100%;
      background: #000;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(88, 101, 242, 0.15);
      position: relative;
      aspect-ratio: 16 / 9;
      display: flex;
      align-items: center;
      justify-content: center;
      max-height: 520px;
    }

    #stream-canvas {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

    .overlay-controls {
      position: absolute;
      top: 14px;
      right: 14px;
      display: flex;
      gap: 10px;
      z-index: 10;
    }

    .ctrl-btn {
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .ctrl-btn:hover {
      background: var(--accent);
      border-color: var(--accent);
    }

    /* ── AZURA LIVE DIALOGUE BUBBLE ── */
    .azura-speech-card {
      width: 100%;
      background: linear-gradient(135deg, rgba(88, 101, 242, 0.15), rgba(0, 242, 254, 0.1));
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 14px;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }

    .azura-avatar-badge {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #a855f7, #38bdf8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 0 16px rgba(168, 85, 247, 0.5);
      flex-shrink: 0;
    }

    .azura-speech-content {
      flex: 1;
    }

    .azura-name-tag {
      font-size: 12px;
      font-weight: 700;
      color: #38bdf8;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }

    .azura-speech-text {
      font-size: 15px;
      color: #f8fafc;
      font-weight: 500;
      line-height: 1.4;
    }

    /* ── CO-OP CONTROL CONSOLE ── */
    .control-console {
      width: 100%;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 18px 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }

    .input-row {
      display: flex;
      gap: 12px;
      align-items: center;
      width: 100%;
    }

    .cmd-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 12px 18px;
      border-radius: 12px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }

    .cmd-input:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.3);
    }

    .mic-btn {
      background: linear-gradient(135deg, #ef4444, #f97316);
      border: none;
      color: #fff;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
    }

    .mic-btn.recording {
      background: linear-gradient(135deg, #dc2626, #991b1b);
      animation: pulse 1s infinite;
    }

    .mic-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.6);
    }

    .send-btn {
      background: linear-gradient(135deg, var(--accent), var(--neon-cyan));
      border: none;
      color: #fff;
      padding: 12px 22px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }

    .send-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 18px var(--accent-glow);
    }

    .quick-dpad-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: center;
    }

    .dpad-btn {
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f1f5f9;
      padding: 10px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .dpad-btn:hover {
      background: rgba(56, 189, 248, 0.2);
      border-color: #38bdf8;
      color: #38bdf8;
      transform: translateY(-2px);
    }

    .dpad-btn.special {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(56, 189, 248, 0.2));
      border-color: rgba(168, 85, 247, 0.5);
      color: #c084fc;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-badge">AZ</div>
      <div>
        <div class="brand-title">AZURA Co-Op Companion</div>
        <div style="font-size: 12px; color: var(--text-muted);" id="page-title">2048 Interactive Arena</div>
      </div>
    </div>
    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="status-text">LIVE 60FPS</span>
    </div>
  </header>

  <main>
    <!-- VIDEO STREAM -->
    <div class="stream-wrapper" id="stream-box">
      <img id="stream-canvas" src="" alt="Live Stream Screen">
      <div class="overlay-controls">
        <button class="ctrl-btn" onclick="toggleFullscreen()">⛶ Fullscreen</button>
      </div>
    </div>

    <!-- AZURA SPOKEN DIALOGUE BUBBLE -->
    <div class="azura-speech-card">
      <div class="azura-avatar-badge">🌸</div>
      <div class="azura-speech-content">
        <div class="azura-name-tag">Azura • Companion Voice</div>
        <div class="azura-speech-text" id="azura-text">"Halo Attila! Aku yang pegang bidak di browser, kamu yang kasih aba-aba yaa! Bisa ketik atau klik tombol mic di bawah 🎤✨"</div>
      </div>
    </div>

    <!-- INTERACTIVE CONTROL CONSOLE -->
    <div class="control-console">
      <div class="input-row">
        <button class="mic-btn" id="mic-btn" onclick="toggleVoiceInput()">
          <span id="mic-icon">🎙️</span> <span id="mic-label">Bicara ke Azura</span>
        </button>
        <input type="text" id="cmd-input" class="cmd-input" placeholder="Ketik perintah: 'geser kiri', 'ke atas', 'auto 5x', 'saran'..." onkeydown="if(event.key==='Enter') sendCommand()">
        <button class="send-btn" onclick="sendCommand()">Kirim Perintah 🚀</button>
      </div>

      <!-- QUICK D-PAD BUTTONS -->
      <div class="quick-dpad-row">
        <button class="dpad-btn" onclick="sendDirectMove('atas')">⬆️ Ke Atas</button>
        <button class="dpad-btn" onclick="sendDirectMove('kiri')">⬅️ Geser Kiri</button>
        <button class="dpad-btn" onclick="sendDirectMove('kanan')">➡️ Geser Kanan</button>
        <button class="dpad-btn" onclick="sendDirectMove('bawah')">⬇️ Ke Bawah</button>
        <button class="dpad-btn special" onclick="sendDirectMove('auto')">🤖 Auto 5 Langkah</button>
        <button class="dpad-btn special" onclick="sendDirectMove('saran')">💡 Minta Saran</button>
        <button class="dpad-btn" onclick="sendDirectMove('reset')">🔄 Reset Papan</button>
      </div>
    </div>
  </main>

  <script>
    const streamImg = document.getElementById('stream-canvas');
    const azuraTextEl = document.getElementById('azura-text');
    const cmdInput = document.getElementById('cmd-input');
    const micBtn = document.getElementById('mic-btn');
    const micIcon = document.getElementById('mic-icon');
    const micLabel = document.getElementById('mic-label');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host;
    let ws = null;

    function connectWs() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {};

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'frame' && msg.data) {
            streamImg.src = 'data:image/jpeg;base64,' + msg.data;
          }
          if (msg.type === 'azura_reply' && msg.text) {
            azuraTextEl.innerText = msg.text;
            playVoiceResponse(msg.text);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

    function sendCommand() {
      const text = cmdInput.value.trim();
      if (!text) return;
      cmdInput.value = '';

      azuraTextEl.innerText = 'Mendengar aba-aba: "' + text + '"... mengeksekusi ke papan!';

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'game_command', command: text, userName: 'Attila' }));
      } else {
        // Fallback REST API
        fetch('/api/game/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: text, userName: 'Attila' })
        })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.result.response) {
            azuraTextEl.innerText = data.result.response;
          }
        });
      }
    }

    function sendDirectMove(dir) {
      cmdInput.value = dir;
      sendCommand();
    }

    // ── SPEECH-TO-TEXT VOICE MIC INPUT (WEB SPEECH API) ──
    let recognition = null;
    let isRecording = false;

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRec();
      recognition.lang = 'id-ID';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        isRecording = true;
        micBtn.classList.add('recording');
        micIcon.innerText = '🔴';
        micLabel.innerText = 'Mendengarkan...';
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        cmdInput.value = transcript;
        sendCommand();
      };

      recognition.onerror = () => {
        stopVoiceInput();
      };

      recognition.onend = () => {
        stopVoiceInput();
      };
    }

    function toggleVoiceInput() {
      if (!recognition) {
        alert('Fitur Voice Speech Recognition tidak didukung di browser ini. Gunakan Google Chrome / Edge ya!');
        return;
      }

      if (isRecording) {
        recognition.stop();
        stopVoiceInput();
      } else {
        try {
          recognition.start();
        } catch (_) {}
      }
    }

    function stopVoiceInput() {
      isRecording = false;
      micBtn.classList.remove('recording');
      micIcon.innerText = '🎙️';
      micLabel.innerText = 'Bicara ke Azura';
    }

    function toggleFullscreen() {
      const box = document.getElementById('stream-box');
      if (!document.fullscreenElement) {
        box.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  </script>
</body>
</html>`;
}

module.exports = {
  initLivePortal,
  broadcastFrame,
  updateStreamMeta,
  hasActiveViewers,
  STREAM_URL
};
