/**
 * AZURA Live WebRTC & WebSocket Companion Stream Portal
 * Serves dedicated interactive pages on port 7860:
 * - /browse : Dedicated Headless Browsing & Autonomous Search Page
 * - /game   : Dedicated 2048 Co-Op Arena Page
 * - /live   : Master Stream Hub with Dynamic Mode Tabs
 * - REST & WebSocket command interfaces with Voice Speech-to-Text & Text input
 */

const http = require('http');
const urlParser = require('url');
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
  activeGuild: null,
  mode: 'browse' // 'browse' | 'game'
};

/**
 * Initialize HTTP & WebSocket Stream Server
 */
function initLivePortal() {
  if (server) return;

  server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    const parsedUrl = urlParser.parse(req.url, true);
    const pathname = parsedUrl.pathname || '/';

    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'online',
        clients: connectedClients.size,
        streamUrl: STREAM_URL,
        currentMode: currentMeta.mode
      }));
    }

    // ── DEDICATED PAGE: HEADLESS BROWSING ──
    if (pathname === '/browse' || pathname.startsWith('/browse/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml('browse'));
    }

    // ── DEDICATED PAGE: 2048 GAME ARENA ──
    if (pathname === '/game' || pathname === '/2048' || pathname.startsWith('/game/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml('game'));
    }

    // ── MASTER LIVE STREAM ROUTE ──
    if (pathname === '/live' || pathname.startsWith('/live/')) {
      const requestedMode = parsedUrl.query.mode || currentMeta.mode || 'browse';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml(requestedMode));
    }

    // ── REST API: HEADLESS BROWSING COMMANDS ──
    if (pathname === '/api/browser/command' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      return req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const rawCmd = (payload.command || '').trim();
          const cleanCmd = rawCmd.toLowerCase();
          const { scrollWebpage, takeScreenshotOnDemand, closeBrowserSession, typeIntoWebpage, clickOnWebpage, getWebpageSummary, openWebpage } = require('./headlessBrowser');
          const { executeAutonomousBrowsingMission } = require('./webSurfAgent');
          
          let responseText = '';
          if (/^scroll\s*(?:ke\s*)?bawah|^down$/i.test(cleanCmd)) {
            await scrollWebpage('global', 'down');
            responseText = ''; // Diam aja!
          } else if (/^scroll\s*(?:ke\s*)?atas|^up$/i.test(cleanCmd)) {
            await scrollWebpage('global', 'up');
            responseText = ''; // Diam aja!
          } else if (/^screenshot$|^ss$|^tangkapan\s*layar$/i.test(cleanCmd)) {
            await takeScreenshotOnDemand('global');
            responseText = 'Tangkapan layar browser terbaru telah diambil!';
          } else if (/^refresh$/i.test(cleanCmd)) {
            const { activeBrowserSessions } = require('./headlessBrowser');
            const sess = activeBrowserSessions.get('global');
            if (sess && sess.page) await sess.page.reload().catch(() => {});
            responseText = ''; // Diam aja!
          } else if (/^tutup$|^close$|^stop$/i.test(cleanCmd)) {
            await closeBrowserSession('global');
            responseText = 'Sesi browser telah ditutup dan memori dibebaskan!';
          } else if (/^tanya\s*azura|^baca\s*layar|^jelaskan\s*layar/i.test(cleanCmd)) {
            // Tanya Azura on Demand
            const summary = await getWebpageSummary('global');
            const text = summary.success ? (summary.bodyText || summary.headings) : 'Halaman kosong.';
            const { askAzura } = require('./azura');
            const config = require('./config');
            const reply = await askAzura(
              config.OWNER_DISCORD_ID || 'manual_user',
              `Jelaskan secara ramah, informatif, dan padat apa yang sedang terbuka di layar browser saat ini: ${text.slice(0, 1000)}`,
              payload.userName || 'Attila',
              [],
              false,
              null,
              'global',
              true
            );
            responseText = typeof reply === 'string' ? reply.replace(/<[^>]+>/g, '').trim() : 'Aku sedang melihat tampilan halaman web saat ini.';
          } else if (/^(?:ara\s+|azura\s+)?(?:tolong\s+)?ketik\s+(.+)/i.test(rawCmd)) {
            const match = rawCmd.match(/^(?:ara\s+|azura\s+)?(?:tolong\s+)?ketik\s+(.+)/i);
            const textToType = match[1].trim();
            await typeIntoWebpage('global', textToType);
            responseText = ''; // Diam aja!
          } else if (/^(?:ara\s+|azura\s+)?(?:tolong\s+)?klik\s+(.+)/i.test(rawCmd)) {
            const match = rawCmd.match(/^(?:ara\s+|azura\s+)?(?:tolong\s+)?klik\s+(.+)/i);
            const targetToClick = match[1].trim();
            await clickOnWebpage('global', targetToClick);
            responseText = ''; // Diam aja!
          } else if (/^(?:ara\s+|azura\s+)?(?:tolong\s+)?browsing\s+(.+)/i.test(rawCmd) || /terus\s+(?:masuk|cari|pilih|klik)/i.test(rawCmd)) {
            // Explicit Autonomous Mission
            responseText = `Memulai misi browsing otonom: "${rawCmd}"...`;
            executeAutonomousBrowsingMission('global', rawCmd, payload.userName || 'Attila', null, null)
              .then(res => {
                const finishMsg = JSON.stringify({
                  type: 'azura_reply',
                  text: res.success ? `✅ Misi Selesai: ${res.title}` : `⚠️ ${res.error || 'Misi selesai'}`
                });
                for (const client of connectedClients) {
                  if (client.readyState === WebSocket.OPEN) client.send(finishMsg);
                }
              })
              .catch(() => {});
          } else {
            // Manual silent navigation/search ("diam aja")
            await openWebpage('global', rawCmd).catch(() => {});
            responseText = ''; // Diam aja!
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, response: responseText }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }

    // ── REST API: INTERACTIVE 2048 GAME COMMANDS ──
    if (pathname === '/api/game/command' && req.method === 'POST') {
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
      pathname === '/todo' || pathname === '/tasks' || pathname.startsWith('/todo?') ||
      pathname === '/feedback' || pathname === '/reports' || pathname.startsWith('/feedback?') ||
      pathname === '/roadmap' || pathname.startsWith('/roadmap?')
    ) {
      const { getTodos } = require('./todo');
      const { getAllFeedbackTickets } = require('./feedback');
      const { generateMasterDashboardHtml } = require('./dashboardHtml');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(generateMasterDashboardHtml(getTodos(), getAllFeedbackTickets()));
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Attach WebSocket Server
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    connectedClients.add(ws);
    console.log(`[Live Portal]: 👤 New viewer connected. Total viewers: ${connectedClients.size}`);

    // Send initial frame & metadata
    if (latestFrame) {
      ws.send(JSON.stringify({ type: 'frame', data: latestFrame, meta: currentMeta }));
    }

    // Handle WebSocket commands
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // 1. Game Command (2048)
        if (msg.type === 'game_command') {
          const { executeInteractiveMove } = require('./browserGameAgent');
          const result = await executeInteractiveMove(msg.command, msg.userName || 'Attila');
          const respPayload = JSON.stringify({
            type: 'azura_reply',
            text: result.response,
            userName: msg.userName || 'Attila'
          });
          for (const client of connectedClients) {
            if (client.readyState === WebSocket.OPEN) client.send(respPayload);
          }
        }

        // 2. Browser Command (Headless Browsing)
        if (msg.type === 'browser_command') {
          const rawCmd = (msg.command || '').trim();
          const cleanCmd = rawCmd.toLowerCase();
          const { scrollWebpage, takeScreenshotOnDemand, closeBrowserSession, typeIntoWebpage, clickOnWebpage } = require('./headlessBrowser');
          const { executeAutonomousBrowsingMission } = require('./webSurfAgent');
          let replyText = '';

          if (/^scroll\s*(?:ke\s*)?bawah|^down$/i.test(cleanCmd)) {
            await scrollWebpage('global', 'down');
            replyText = ''; // Diam aja!
          } else if (/^scroll\s*(?:ke\s*)?atas|^up$/i.test(cleanCmd)) {
            await scrollWebpage('global', 'up');
            replyText = ''; // Diam aja!
          } else if (/^screenshot$|^ss$/i.test(cleanCmd)) {
            await takeScreenshotOnDemand('global');
            replyText = 'Tangkapan layar browser terbaru telah diperbarui!';
          } else if (/^refresh$/i.test(cleanCmd)) {
            const { activeBrowserSessions } = require('./headlessBrowser');
            const sess = activeBrowserSessions.get('global');
            if (sess && sess.page) await sess.page.reload().catch(() => {});
            replyText = ''; // Diam aja!
          } else if (/^tutup$|^close$|^stop$/i.test(cleanCmd)) {
            await closeBrowserSession('global');
            replyText = 'Sesi browser telah ditutup dan memori dibebaskan!';
          } else if (/^tanya\s*azura|^baca\s*layar|^jelaskan\s*layar/i.test(cleanCmd)) {
            // Tanya Azura on Demand
            const summary = await getWebpageSummary('global');
            const text = summary.success ? (summary.bodyText || summary.headings) : 'Halaman kosong.';
            const { askAzura } = require('./azura');
            const config = require('./config');
            const reply = await askAzura(
              config.OWNER_DISCORD_ID || 'manual_user',
              `Jelaskan secara ramah, informatif, dan padat apa yang sedang terbuka di layar browser saat ini: ${text.slice(0, 1000)}`,
              msg.userName || 'Attila',
              [],
              false,
              null,
              'global',
              true
            );
            replyText = typeof reply === 'string' ? reply.replace(/<[^>]+>/g, '').trim() : 'Aku sedang melihat tampilan halaman web saat ini.';
          } else if (/^(?:ara\s+|azura\s+)?(?:tolong\s+)?ketik\s+(.+)/i.test(rawCmd)) {
            const match = rawCmd.match(/^(?:ara\s+|azura\s+)?(?:tolong\s+)?ketik\s+(.+)/i);
            const textToType = match[1].trim();
            await typeIntoWebpage('global', textToType);
            replyText = ''; // Diam aja!
          } else if (/^(?:ara\s+|azura\s+)?(?:tolong\s+)?klik\s+(.+)/i.test(rawCmd)) {
            const match = rawCmd.match(/^(?:ara\s+|azura\s+)?(?:tolong\s+)?klik\s+(.+)/i);
            const targetToClick = match[1].trim();
            await clickOnWebpage('global', targetToClick);
            replyText = ''; // Diam aja!
          } else if (/^(?:ara\s+|azura\s+)?(?:tolong\s+)?browsing\s+(.+)/i.test(rawCmd) || /terus\s+(?:masuk|cari|pilih|klik)/i.test(rawCmd)) {
            // Explicit Autonomous Mission
            replyText = `Memulai misi browsing otonom: "${rawCmd}"...`;
            executeAutonomousBrowsingMission('global', rawCmd, msg.userName || 'Attila', null, null)
              .then(res => {
                const finishMsg = JSON.stringify({
                  type: 'azura_reply',
                  text: res.success ? `✅ Misi Selesai: ${res.title}` : `⚠️ ${res.error || 'Misi selesai'}`
                });
                for (const client of connectedClients) {
                  if (client.readyState === WebSocket.OPEN) client.send(finishMsg);
                }
              })
              .catch(() => {});
          } else {
            // Manual silent navigation/search ("diam aja")
            await openWebpage('global', rawCmd).catch(() => {});
            replyText = ''; // Diam aja!
          }

          if (replyText) {
            const respPayload = JSON.stringify({
              type: 'azura_reply',
              text: replyText,
              userName: msg.userName || 'Attila'
            });
            for (const client of connectedClients) {
              if (client.readyState === WebSocket.OPEN) client.send(respPayload);
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
 * Update current stream metadata (URL, title, mode)
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
 * Broadcast an Azura speech/thought bubble to all live portal viewers
 * @param {string} text
 */
function broadcastAzuraReply(text) {
  if (connectedClients.size === 0) return;
  const payload = JSON.stringify({
    type: 'azura_reply',
    text: text
  });
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function hasActiveViewers() {
  return connectedClients.size > 0;
}

/**
 * Generates Dedicated HTML Portal Page
 * @param {'browse'|'game'} mode 
 */
function getPortalHtml(mode = 'browse') {
  const isBrowse = mode === 'browse';

  const brandTitle = isBrowse ? 'AZURA Headless Browser Live' : 'AZURA 2048 Co-Op Arena';
  const brandSubtitle = isBrowse ? 'Autonomous Web Agent & Screen Companion' : 'Interactive 2048 Arena & Tactical Companion';
  const initialBubbleText = isBrowse
    ? 'Halo! Aku siap browsing secara otonom di web. Ketik apa yang mau dicari atau bicara lewat tombol mic di bawah yaa! 🌐✨'
    : 'Halo Attila! Aku yang pegang bidak di browser, kamu yang kasih aba-aba yaa! Bisa ketik atau klik tombol mic di bawah 🪄✨';
  const inputPlaceholder = isBrowse
    ? 'Ketik perintah browsing: "cari tiket pesawat...", "buka wikipedia.org", "scroll bawah"...'
    : 'Ketik perintah: "geser kiri", "ke atas", "auto 5x", "saran"...';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandTitle} - Live 60FPS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #07090e;
      --card-bg: rgba(18, 24, 38, 0.75);
      --accent: ${isBrowse ? '#38bdf8' : '#a855f7'};
      --accent-glow: ${isBrowse ? 'rgba(56, 189, 248, 0.4)' : 'rgba(168, 85, 247, 0.4)'};
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: rgba(255, 255, 255, 0.1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body {
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(circle at 15% 15%, ${isBrowse ? 'rgba(56, 189, 248, 0.08)' : 'rgba(168, 85, 247, 0.08)'} 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(0, 242, 254, 0.05) 0%, transparent 40%);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      padding: 14px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      background: rgba(10, 14, 23, 0.85);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
      flex-wrap: wrap;
      gap: 12px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), #00f2fe);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
      box-shadow: 0 0 16px var(--accent-glow);
    }

    .brand-title {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }

    /* ── DEDICATED MODE TABS ── */
    .mode-nav {
      display: flex;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 4px;
      gap: 4px;
    }

    .mode-tab {
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      color: var(--text-muted);
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .mode-tab:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.05);
    }

    .mode-tab.active {
      color: #fff;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent-glow);
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
      padding: 16px 24px;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
      gap: 14px;
    }

    .stream-wrapper {
      width: 100%;
      background: #000;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(56, 189, 248, 0.1);
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

    /* ── AZURA LIVE DIALOGUE / STATUS BUBBLE ── */
    .azura-speech-card {
      width: 100%;
      background: linear-gradient(135deg, rgba(88, 101, 242, 0.12), rgba(0, 242, 254, 0.08));
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 14px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }

    .azura-avatar-badge {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), #38bdf8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 16px var(--accent-glow);
      flex-shrink: 0;
    }

    .azura-speech-content { flex: 1; }

    .azura-name-tag {
      font-size: 11px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }

    .azura-speech-text {
      font-size: 14px;
      color: #f8fafc;
      font-weight: 500;
      line-height: 1.4;
    }

    /* ── INTERACTIVE CONTROL CONSOLE ── */
    .control-console {
      width: 100%;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }

    .input-row {
      display: flex;
      gap: 10px;
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
      border-color: var(--accent);
      box-shadow: 0 0 16px var(--accent-glow);
    }

    .mic-btn {
      background: linear-gradient(135deg, #ef4444, #f97316);
      border: none;
      color: #fff;
      padding: 12px 18px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
      white-space: nowrap;
    }

    .mic-btn.recording {
      background: linear-gradient(135deg, #dc2626, #991b1b);
      animation: pulse 1s infinite;
    }

    .send-btn {
      background: linear-gradient(135deg, var(--accent), #00f2fe);
      border: none;
      color: #fff;
      padding: 12px 22px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .send-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 18px var(--accent-glow);
    }

    .quick-actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: center;
    }

    .action-btn {
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f1f5f9;
      padding: 9px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .action-btn:hover {
      background: rgba(56, 189, 248, 0.18);
      border-color: var(--accent);
      color: var(--accent);
      transform: translateY(-2px);
    }

    .action-btn.danger:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: #ef4444;
      color: #ef4444;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-badge">AZ</div>
      <div>
        <div class="brand-title">${brandTitle}</div>
        <div style="font-size: 12px; color: var(--text-muted);" id="page-title">${brandSubtitle}</div>
      </div>
    </div>

    <!-- DEDICATED MODE TABS -->
    <nav class="mode-nav">
      <a href="/browse" class="mode-tab ${isBrowse ? 'active' : ''}">🌐 Headless Browser</a>
      <a href="/game" class="mode-tab ${!isBrowse ? 'active' : ''}">🎮 Arena 2048</a>
    </nav>

    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="status-text">LIVE 60FPS</span>
    </div>
  </header>

  <main>
    <!-- VIDEO STREAM -->
    <div class="stream-wrapper" id="stream-box">
      <div id="standby-notice" style="position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #94a3b8; z-index: 5; pointer-events: none;">
        <div style="font-size: 34px;">${isBrowse ? '🌐' : '🎮'}</div>
        <div style="font-size: 15px; font-weight: 700; color: var(--accent);">${isBrowse ? 'Layar Headless Browser Siap' : 'Arena Game 2048 Siap'}</div>
        <div style="font-size: 12px; color: #64748b;">Live Stream 60 FPS • Berikan perintah untuk mulai</div>
      </div>
      <img id="stream-canvas" src="" alt="Live Stream Screen">
      <div class="overlay-controls">
        <button class="ctrl-btn" onclick="toggleFullscreen()">⛶ Fullscreen</button>
      </div>
    </div>

    <!-- AZURA LIVE DIALOGUE BUBBLE -->
    <div class="azura-speech-card">
      <div class="azura-avatar-badge">🌸</div>
      <div class="azura-speech-content">
        <div class="azura-name-tag">Azura • Companion Voice</div>
        <div class="azura-speech-text" id="azura-text">"${initialBubbleText}"</div>
      </div>
    </div>

    <!-- INTERACTIVE CONTROL CONSOLE -->
    <div class="control-console">
      <div class="input-row">
        <button class="mic-btn" id="mic-btn" onclick="toggleVoiceInput()">
          <span id="mic-icon">🎙️</span> <span id="mic-label">Bicara ke Azura</span>
        </button>
        <input type="text" id="cmd-input" class="cmd-input" placeholder="${inputPlaceholder}" onkeydown="if(event.key==='Enter') sendCommand()">
        <button class="send-btn" onclick="sendCommand()">Kirim Perintah 🚀</button>
      </div>

      <!-- MODE-SPECIFIC BUTTONS -->
      <div class="quick-actions-row">
        ${isBrowse ? `
          <button class="action-btn" onclick="sendAction('scroll bawah')">📜 Scroll Bawah</button>
          <button class="action-btn" onclick="sendAction('scroll atas')">📜 Scroll Atas</button>
          <button class="action-btn" onclick="sendAction('screenshot')">📸 Screenshot</button>
          <button class="action-btn" onclick="sendAction('tanya azura')">💬 Tanya Azura</button>
          <button class="action-btn danger" onclick="sendAction('tutup')">🛑 Tutup Browser</button>
        ` : `
          <button class="action-btn" onclick="sendAction('atas')">⬆️ Ke Atas</button>
          <button class="action-btn" onclick="sendAction('kiri')">⬅️ Geser Kiri</button>
          <button class="action-btn" onclick="sendAction('kanan')">➡️ Geser Kanan</button>
          <button class="action-btn" onclick="sendAction('bawah')">⬇️ Ke Bawah</button>
          <button class="action-btn" onclick="sendAction('auto')">🤖 Auto 5 Langkah</button>
          <button class="action-btn" onclick="sendAction('saran')">💡 Minta Saran</button>
          <button class="action-btn" onclick="sendAction('reset')">🔄 Reset Papan</button>
        `}
      </div>
    </div>
  </main>

  <script>
    const currentMode = '${mode}';
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
            const notice = document.getElementById('standby-notice');
            if (notice) notice.style.display = 'none';
          }
          if (msg.type === 'azura_reply' && msg.text) {
            azuraTextEl.innerText = msg.text;
          }
        } catch (e) {}
      };
      ws.onclose = () => setTimeout(connectWs, 2000);
      ws.onerror = () => ws.close();
    }

    connectWs();

    function sendCommand() {
      const text = cmdInput.value.trim();
      if (!text) return;
      cmdInput.value = '';

      azuraTextEl.innerText = 'Mendengar aba-aba: "' + text + '"... mengeksekusi ke layar!';

      const msgType = currentMode === 'browse' ? 'browser_command' : 'game_command';
      const apiUrl = currentMode === 'browse' ? '/api/browser/command' : '/api/game/command';

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: msgType, command: text, userName: 'Attila' }));
      } else {
        fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: text, userName: 'Attila' })
        })
        .then(res => res.json())
        .then(data => {
          if (data.response) azuraTextEl.innerText = data.response;
          else if (data.result && data.result.response) azuraTextEl.innerText = data.result.response;
        })
        .catch(() => {});
      }
    }

    function sendAction(act) {
      cmdInput.value = act;
      sendCommand();
    }

    // ── KEYBOARD CONTROLS ──
    window.addEventListener('keydown', (e) => {
      if (document.activeElement === cmdInput) return;

      if (currentMode === 'game') {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); sendAction('kiri'); }
        else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); sendAction('kanan'); }
        else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); sendAction('atas'); }
        else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); sendAction('bawah'); }
        else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); sendAction('auto'); }
      } else {
        if (e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); sendAction('scroll bawah'); }
        else if (e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); sendAction('scroll atas'); }
      }
    });

    // ── SPEECH-TO-TEXT VOICE MIC (WEB SPEECH API) ──
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

      recognition.onerror = () => stopVoiceInput();
      recognition.onend = () => stopVoiceInput();
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
        try { recognition.start(); } catch (_) {}
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
  broadcastAzuraReply,
  hasActiveViewers,
  STREAM_URL
};
