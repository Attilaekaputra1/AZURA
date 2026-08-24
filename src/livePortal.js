/**
 * AZURA Live WebRTC & WebSocket Companion Stream Portal
 * Serves an ultra-fast, zero-latency 60fps web streamer UI on port 7860
 * Powered by Chrome DevTools Protocol (CDP) Screencast.
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

    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'online', clients: connectedClients.size, streamUrl: STREAM_URL }));
    }

    if (req.url.startsWith('/live')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml());
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
 * Sleek Modern Cyber-Companion HTML5 Viewer UI
 */
function getPortalHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AZURA Live Screen Companion</title>
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
      padding: 14px 24px;
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
      width: 36px;
      height: 36px;
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
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
    }

    .url-bar-container {
      width: 100%;
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 10px 18px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .url-icon {
      color: var(--neon-cyan);
      font-size: 16px;
    }

    .url-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
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
    }

    #stream-canvas {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

    .overlay-controls {
      position: absolute;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 10px;
      z-index: 10;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .stream-wrapper:hover .overlay-controls {
      opacity: 1;
    }

    .ctrl-btn {
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
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
      transform: translateY(-2px);
    }

    .stats-footer {
      display: flex;
      justify-content: space-between;
      width: 100%;
      margin-top: 16px;
      color: var(--text-muted);
      font-size: 13px;
    }

    .badge-tag {
      background: rgba(255, 255, 255, 0.06);
      padding: 4px 10px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-badge">AZ</div>
      <div>
        <div class="brand-title">AZURA Screen Companion</div>
        <div style="font-size: 12px; color: var(--text-muted);" id="page-title">Standby Mode</div>
      </div>
    </div>
    <div class="status-badge" id="status-badge">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-text">LIVE 60FPS</span>
    </div>
  </header>

  <main>
    <div class="url-bar-container">
      <span class="url-icon">🔒</span>
      <span class="url-text" id="stream-url">about:blank</span>
      <span class="badge-tag">Playwright 720p HD</span>
    </div>

    <div class="stream-wrapper" id="stream-box">
      <img id="stream-canvas" src="" alt="Live Stream Screen">
      <div class="overlay-controls">
        <button class="ctrl-btn" onclick="toggleFullscreen()">⛶ Fullscreen</button>
      </div>
    </div>

    <div class="stats-footer">
      <div>Latency: <span class="badge-tag" id="latency-val">&lt; 80ms</span> • Viewers: <span class="badge-tag" id="viewer-count">1</span></div>
      <div>Kontrol Suara: <span class="badge-tag" style="color: var(--neon-cyan);">"Azura scroll bawah"</span> / <span class="badge-tag" style="color: var(--neon-cyan);">"Azura buka [web]"</span></div>
    </div>
  </main>

  <script>
    const streamImg = document.getElementById('stream-canvas');
    const streamUrlEl = document.getElementById('stream-url');
    const pageTitleEl = document.getElementById('page-title');
    const statusTextEl = document.getElementById('status-text');
    const statusDotEl = document.getElementById('status-dot');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host;
    let ws = null;

    function connectWs() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        statusTextEl.innerText = 'LIVE 60FPS';
        statusDotEl.style.background = '#2ecc71';
        statusDotEl.style.boxShadow = '0 0 8px #2ecc71';
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'frame' && msg.data) {
            streamImg.src = 'data:image/jpeg;base64,' + msg.data;
          }
          if (msg.meta) {
            if (msg.meta.url) streamUrlEl.innerText = msg.meta.url;
            if (msg.meta.title) pageTitleEl.innerText = msg.meta.title;
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        statusTextEl.innerText = 'RECONNECTING...';
        statusDotEl.style.background = '#f39c12';
        statusDotEl.style.boxShadow = '0 0 8px #f39c12';
        setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

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
