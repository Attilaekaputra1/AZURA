/**
 * AZURA Autonomous Headless Browser Game Player - Co-Op & Strategic Discussion Edition
 * - Autonomous & Smooth Gameplay with Live 60fps Stream to http://203.175.10.163:7860/live.
 * - Silent & Snappy Move Execution (Zero noisy TTS on keystrokes).
 * - Live Strategic Discussion Partner: Ask questions, tactical advice, or casual banter with real-time board awareness!
 * - Real-Time accurate score evaluation directly from browser DOM upon game end/over.
 * - Speaks thoughtfully in Discord Voice Channel (Kak Ceria persona).
 */

const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBrowser } = require('./headlessBrowser');
const { broadcastFrame, updateStreamMeta, STREAM_URL } = require('./livePortal');
const config = require('./config');

// Active game sessions: guildId -> session object
const activeGameSessions = new Map();

/**
 * Built-in Modern HTML5 2048 Game Engine with GameOver Detection
 */
const HTML_2048_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>2048 AI Arena - AZURA</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
  body { background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; overflow: hidden; }
  .header { text-align: center; margin-bottom: 16px; }
  .title { font-size: 36px; font-weight: 800; color: #38bdf8; text-shadow: 0 0 25px rgba(56,189,248,0.6); }
  .subtitle { font-size: 14px; color: #94a3b8; margin-top: 2px; }
  .stats-bar { display: flex; gap: 14px; margin: 12px 0; }
  .stat-box { background: #1e293b; border: 1px solid #334155; padding: 8px 18px; border-radius: 12px; text-align: center; min-width: 110px; }
  .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
  .stat-value { font-size: 22px; font-weight: 700; color: #f1f5f9; }
  .grid-container { background: #1e293b; border: 2px solid #38bdf8; border-radius: 16px; padding: 12px; box-shadow: 0 20px 45px rgba(0,0,0,0.7); }
  .grid { display: grid; grid-template-columns: repeat(4, 82px); grid-template-rows: repeat(4, 82px); gap: 10px; }
  .cell { background: rgba(51, 65, 85, 0.4); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800; transition: all 0.12s ease-in-out; }
  .tile-2 { background: #eee4da; color: #776e65; }
  .tile-4 { background: #ede0c8; color: #776e65; }
  .tile-8 { background: #f2b179; color: #f9f6f2; }
  .tile-16 { background: #f59563; color: #f9f6f2; }
  .tile-32 { background: #f67c5f; color: #f9f6f2; }
  .tile-64 { background: #f65e3b; color: #f9f6f2; }
  .tile-128 { background: #edcf72; color: #f9f6f2; font-size: 24px; box-shadow: 0 0 15px rgba(237,207,114,0.5); }
  .tile-256 { background: #edcc61; color: #f9f6f2; font-size: 24px; box-shadow: 0 0 20px rgba(237,204,97,0.6); }
  .tile-512 { background: #edc850; color: #f9f6f2; font-size: 24px; box-shadow: 0 0 25px rgba(237,200,80,0.7); }
  .tile-1024 { background: #edc53f; color: #f9f6f2; font-size: 20px; box-shadow: 0 0 30px rgba(237,197,63,0.8); }
  .tile-2048 { background: #38bdf8; color: #ffffff; font-size: 20px; box-shadow: 0 0 35px rgba(56,189,248,0.9); }
  .thought-bubble { margin-top: 14px; font-size: 14px; color: #38bdf8; font-style: italic; background: rgba(56,189,248,0.1); border: 1px dashed rgba(56,189,248,0.3); padding: 6px 18px; border-radius: 20px; max-width: 480px; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">🌸 AZURA & ATTILA 2048 CO-OP</div>
    <div class="subtitle">Autonomous AI Player & Strategic Discussion Partner</div>
    <div class="stats-bar">
      <div class="stat-box"><div class="stat-label">Score</div><div id="score" class="stat-value">0</div></div>
      <div class="stat-box"><div class="stat-label">Highest Tile</div><div id="highest-tile" class="stat-value">2</div></div>
      <div class="stat-box"><div class="stat-label">Moves</div><div id="move-count" class="stat-value">0</div></div>
    </div>
  </div>
  <div class="grid-container">
    <div id="grid" class="grid"></div>
  </div>
  <div id="thought" class="thought-bubble">Azura siap bermain & berdiskusi strategi bersamamu! 🎮💬</div>

<script>
let board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
let score = 0;
let moves = 0;

function initGame() {
  board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  score = 0;
  moves = 0;
  addRandomTile();
  addRandomTile();
  render();
}

function addRandomTile() {
  const empty = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0) empty.push({ r, c });
    }
  }
  if (empty.length > 0) {
    const spot = empty[Math.floor(Math.random() * empty.length)];
    board[spot.r][spot.c] = Math.random() < 0.9 ? 2 : 4;
  }
}

function render() {
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';
  let highest = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const val = board[r][c];
      if (val > highest) highest = val;
      const cell = document.createElement('div');
      cell.className = 'cell ' + (val > 0 ? 'tile-' + val : '');
      cell.textContent = val > 0 ? val : '';
      gridEl.appendChild(cell);
    }
  }
  document.getElementById('score').textContent = score;
  document.getElementById('highest-tile').textContent = highest;
  document.getElementById('move-count').textContent = moves;
}

function slide(row) {
  let arr = row.filter(val => val);
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] === arr[i + 1]) {
      arr[i] *= 2;
      score += arr[i];
      arr[i + 1] = 0;
    }
  }
  arr = arr.filter(val => val);
  while (arr.length < 4) arr.push(0);
  return arr;
}

function moveLeft() {
  let changed = false;
  for (let r = 0; r < 4; r++) {
    const oldRow = [...board[r]];
    const newRow = slide(board[r]);
    board[r] = newRow;
    if (oldRow.join(',') !== newRow.join(',')) changed = true;
  }
  return changed;
}

function moveRight() {
  let changed = false;
  for (let r = 0; r < 4; r++) {
    const oldRow = [...board[r]];
    const reversed = [...board[r]].reverse();
    const newRow = slide(reversed).reverse();
    board[r] = newRow;
    if (oldRow.join(',') !== newRow.join(',')) changed = true;
  }
  return changed;
}

function moveUp() {
  let changed = false;
  for (let c = 0; c < 4; c++) {
    const col = [board[0][c], board[1][c], board[2][c], board[3][c]];
    const newCol = slide(col);
    for (let r = 0; r < 4; r++) {
      if (board[r][c] !== newCol[r]) changed = true;
      board[r][c] = newCol[r];
    }
  }
  return changed;
}

function moveDown() {
  let changed = false;
  for (let c = 0; c < 4; c++) {
    const col = [board[0][c], board[1][c], board[2][c], board[3][c]].reverse();
    const newCol = slide(col).reverse();
    for (let r = 0; r < 4; r++) {
      if (board[r][c] !== newCol[r]) changed = true;
      board[r][c] = newCol[r];
    }
  }
  return changed;
}

function checkGameOver() {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0) return false;
    }
  }
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[r][c] === board[r][c + 1]) return false;
    }
  }
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 3; r++) {
      if (board[r][c] === board[r + 1][c]) return false;
    }
  }
  return true;
}

window.executeMove = function(direction, thoughtText) {
  let changed = false;
  if (direction === 'left') changed = moveLeft();
  else if (direction === 'right') changed = moveRight();
  else if (direction === 'up') changed = moveUp();
  else if (direction === 'down') changed = moveDown();

  if (changed) {
    moves++;
    addRandomTile();
    render();
  }

  const isOver = checkGameOver();
  if (isOver) {
    document.getElementById('thought').textContent = "Papan terkunci (Game Over)! Permainan selesai.";
  } else if (thoughtText) {
    document.getElementById('thought').textContent = thoughtText;
  }

  return {
    changed,
    score,
    moves,
    highestTile: parseInt(document.getElementById('highest-tile').textContent, 10),
    board,
    gameOver: isOver
  };
};

window.getGameState = function() {
  return {
    score,
    moves,
    highestTile: parseInt(document.getElementById('highest-tile').textContent, 10),
    board,
    gameOver: checkGameOver()
  };
};

window.resetGame = function() {
  initGame();
  document.getElementById('thought').textContent = "Papan baru telah dimulai! Yuk kita susun lagi!";
  return window.getGameState();
};

initGame();
</script>
</body>
</html>`;

const CORNER_WEIGHTS = [
  [4096, 1024, 256, 64],
  [16,   32,   64,  128],
  [8,    4,    2,   1],
  [0.5,  0.2,  0.1, 0]
];

function evaluateBoard(board) {
  let score = 0;
  let emptyCells = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const val = board[r][c];
      if (val === 0) emptyCells++;
      else score += val * CORNER_WEIGHTS[r][c];
    }
  }
  score += emptyCells * 600;
  return score;
}

function simulateMove(board, direction) {
  function slideRow(row) {
    let arr = row.filter(v => v);
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i] === arr[i + 1]) {
        arr[i] *= 2;
        arr[i + 1] = 0;
      }
    }
    arr = arr.filter(v => v);
    while (arr.length < 4) arr.push(0);
    return arr;
  }

  const newBoard = board.map(r => [...r]);
  let changed = false;

  if (direction === 'left') {
    for (let r = 0; r < 4; r++) {
      const old = [...newBoard[r]];
      newBoard[r] = slideRow(newBoard[r]);
      if (old.join(',') !== newBoard[r].join(',')) changed = true;
    }
  } else if (direction === 'right') {
    for (let r = 0; r < 4; r++) {
      const old = [...newBoard[r]];
      const rev = [...newBoard[r]].reverse();
      newBoard[r] = slideRow(rev).reverse();
      if (old.join(',') !== newBoard[r].join(',')) changed = true;
    }
  } else if (direction === 'up') {
    for (let c = 0; c < 4; c++) {
      const col = [newBoard[0][c], newBoard[1][c], newBoard[2][c], newBoard[3][c]];
      const newCol = slideRow(col);
      for (let r = 0; r < 4; r++) {
        if (newBoard[r][c] !== newCol[r]) changed = true;
        newBoard[r][c] = newCol[r];
      }
    }
  } else if (direction === 'down') {
    for (let c = 0; c < 4; c++) {
      const col = [newBoard[0][c], newBoard[1][c], newBoard[2][c], newBoard[3][c]].reverse();
      const newCol = slideRow(col).reverse();
      for (let r = 0; r < 4; r++) {
        if (newBoard[r][c] !== newCol[r]) changed = true;
        newBoard[r][c] = newCol[r];
      }
    }
  }

  return { changed, newBoard };
}

function getBest2048Move(board) {
  const directions = ['up', 'left', 'right', 'down'];
  let bestScore = -Infinity;
  let bestMove = 'up';

  for (const dir of directions) {
    const { changed, newBoard } = simulateMove(board, dir);
    if (!changed) continue;

    const evalScore = evaluateBoard(newBoard);
    if (evalScore > bestScore) {
      bestScore = evalScore;
      bestMove = dir;
    }
  }

  return bestMove;
}

/**
 * Unified finder for active session across Guild and Web lookups
 * @param {string} [guildId='global'] 
 */
function findActiveGameSession(guildId = 'global') {
  if (guildId && activeGameSessions.has(guildId)) {
    const s = activeGameSessions.get(guildId);
    if (s && s.page && !s.page.isClosed()) return s;
  }
  for (const session of activeGameSessions.values()) {
    if (session && session.page && !session.page.isClosed()) {
      return session;
    }
  }
  return null;
}

/**
 * Get or create active session
 */
async function getOrCreateGameSession(guildId = 'global', message = null) {
  let session = findActiveGameSession(guildId);
  if (session) {
    if (message?.channel) session.channel = message.channel;
    if (message?.member?.displayName || message?.author?.username) {
      session.userName = message.member?.displayName || message.author.displayName || message.author.username;
    }
    return session;
  }

  console.log(`[Browser Game Agent]: 🚀 Launching new Game session for ${guildId}...`);
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 850, height: 720 },
    deviceScaleFactor: 1.25
  });
  const page = await context.newPage();

  await page.setContent(HTML_2048_PAGE);
  await page.waitForTimeout(400);

  // Attach CDP Screencast
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 850,
    maxHeight: 720,
    everyNthFrame: 1
  });

  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
      broadcastFrame(data);
    } catch (_) {}
  });

  updateStreamMeta({
    title: '🌸 AZURA & ATTILA 2048 Co-Op Arena',
    url: 'http://203.175.10.163:7860/game',
    activeGuild: guildId,
    mode: 'game'
  });

  session = {
    guildId,
    context,
    page,
    cdp,
    isRunning: true,
    score: 0,
    highestTile: 2,
    moves: 0,
    channel: message?.channel || null,
    userName: message?.member?.displayName || message?.author?.displayName || message?.author?.username || 'Attila',
    statusMsg: null,
    client: message?.client || null
  };

  activeGameSessions.set(guildId, session);
  return session;
}

/**
 * Intelligent Tactical Discussion & Open Q&A with Live Game Awareness
 * @param {string} question 
 * @param {string} [userName='Attila'] 
 * @param {object} session 
 * @returns {Promise<string>}
 */
async function discussGameWithAzura(question, userName = 'Attila', session = null) {
  const currentState = session?.page && !session.page.isClosed()
    ? await session.page.evaluate(() => window.getGameState()).catch(() => null)
    : null;

  let gameContextPrompt = '';
  if (currentState && currentState.board) {
    const bestMove = getBest2048Move(currentState.board);
    const indonesianDirs = { up: 'ATAS', down: 'BAWAH', left: 'KIRI', right: 'KANAN' };
    gameContextPrompt = `[GAMEPLAY CONTEXT - LIVE 2048 MATCH]:
Kamu (Azura) sedang bermain game 2048 secara otonom di live stream bersama ${userName}.
Kondisi papan saat ini:
- Skor saat ini: ${currentState.score.toLocaleString()} Pts
- Tile tertinggi di papan: Tile ${currentState.highestTile}
- Total langkah yang sudah dimainkan: ${currentState.moves}
- Rekomendasi langkah terbaik menurut algoritma corner-lock mu: Geser ke ${indonesianDirs[bestMove]}
- Susunan baris papan 4x4:
  Baris 1: [${currentState.board[0].join(', ')}]
  Baris 2: [${currentState.board[1].join(', ')}]
  Baris 3: [${currentState.board[2].join(', ')}]
  Baris 4: [${currentState.board[3].join(', ')}]

${userName} sedang menonton kamu bermain dan mengajakmu berdiskusi / bertanya: "${question}".
Instruksi respons:
- Jawablah secara santai, cerdas, taktis, dan hidup seperti partner mabar yang asyik!
- Jika dia bertanya tentang taktik/langkah papan atau minta saran, berikan analisa taktis yang jelas berdasarkan posisi angka di atas.
- Jika dia bertanya hal santai/umum, jawablah dengan persona Azura yang ceria dan akrab.
- Buat jawaban ringkas, natural untuk didengarkan di Voice Channel (hindari format markdown berlebihan).`;
  } else {
    gameContextPrompt = `Kamu (Azura) sedang di arena game bersama ${userName}. Dia bertanya: "${question}". Jawablah dengan ceria dan natural!`;
  }

  const { askAzura } = require('./azura');
  const rawAnswer = await askAzura(
    config.OWNER_DISCORD_ID || 'game_user',
    gameContextPrompt,
    userName,
    [],
    false,
    session?.channel?.id || null,
    session?.guildId || null,
    true
  );

  let cleanAnswer = typeof rawAnswer === 'string' ? rawAnswer : (rawAnswer?.content || 'Oke!');
  cleanAnswer = cleanAnswer
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~`#>]/g, '')
    .trim();

  // Speak thoughtful answer in Discord Voice Channel (Kak Ceria)
  try {
    const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
    if (session?.guildId && session.guildId !== 'global') {
      speakTextInVC(session.guildId, cleanAnswer, session.client || null, userName).catch(() => {});
    } else {
      speakInAllActiveVCs(cleanAnswer, session?.client || null).catch(() => {});
    }
  } catch (_) {}

  return cleanAnswer;
}

/**
 * Execute an interactive move or discuss strategy
 * @param {string} rawCommand 
 * @param {string} [userName='Attila'] 
 * @param {string} [guildId='global'] 
 * @returns {Promise<{ success: boolean, response: string, state: object }>}
 */
async function executeInteractiveMove(rawCommand, userName = 'Attila', guildId = 'global') {
  const cleanCmd = (rawCommand || '').toLowerCase().trim();
  const session = await getOrCreateGameSession(guildId);

  if (!session || session.page.isClosed()) {
    return { success: false, response: 'Sesi browser game belum aktif. Buka dulu di Discord atau web yaa!', state: null };
  }

  // 1. Direct Move Control: SILENT & FAST (No repetitive TTS spamming per step!)
  let direction = null;
  if (/^(?:kiri|left|geser\s*(?:ke\s*)?kiri|arah\s*kiri|ke\s*kiri)$/i.test(cleanCmd)) direction = 'left';
  else if (/^(?:kanan|right|geser\s*(?:ke\s*)?kanan|arah\s*kanan|ke\s*kanan)$/i.test(cleanCmd)) direction = 'right';
  else if (/^(?:atas|up|geser\s*(?:ke\s*)?atas|arah\s*atas|ke\s*atas|naik)$/i.test(cleanCmd)) direction = 'up';
  else if (/^(?:bawah|down|geser\s*(?:ke\s*)?bawah|arah\s*bawah|ke\s*bawah|turun)$/i.test(cleanCmd)) direction = 'down';

  if (direction) {
    const indonesianDirs = { up: 'ATAS', down: 'BAWAH', left: 'KIRI', right: 'KANAN' };
    const res = await session.page.evaluate(({ dir, thoughtText }) => window.executeMove(dir, thoughtText), {
      dir: direction,
      thoughtText: `Geser ${indonesianDirs[direction]} (Skor: ${session.score.toLocaleString()})`
    });

    session.score = res.score;
    session.highestTile = res.highestTile;
    session.moves = res.moves;

    if (res.gameOver) {
      setTimeout(() => stopAutonomousBrowserGame(session.guildId), 1200);
    }

    return {
      success: true,
      response: `Bidak digeser ke ${indonesianDirs[direction]} (Skor: ${res.score.toLocaleString()} | Tile Tertinggi: ${res.highestTile})`,
      state: res
    };
  }

  // 2. Reset Board
  if (/^(?:reset|ulang|restart|baru|mulai\s*lagi)$/i.test(cleanCmd)) {
    const newState = await session.page.evaluate(() => window.resetGame());
    session.score = newState.score;
    session.moves = newState.moves;
    session.highestTile = newState.highestTile;
    const resp = `Papan 2048 sudah di-reset! Yuk kita susun lagi dari awal.`;
    return { success: true, response: resp, state: newState };
  }

  // 3. Autonomous Play Loop (Azura plays 10 steps autonomously and smoothly)
  if (/\b(?:auto|otonom|mainkan|mainin|jalan\s*sendiri|bot|bantu\s*main)\b/i.test(cleanCmd)) {
    let stepsDone = 0;
    for (let s = 0; s < 10; s++) {
      const currentState = await session.page.evaluate(() => window.getGameState());
      if (!currentState || currentState.gameOver) break;
      const bestMove = getBest2048Move(currentState.board);
      const thought = `Auto-Play langkah ${s + 1}/10: geser ${bestMove.toUpperCase()}...`;
      const res = await session.page.evaluate(({ dir, thoughtText }) => window.executeMove(dir, thoughtText), {
        dir: bestMove,
        thoughtText: thought
      });
      if (!res.changed) break;
      stepsDone++;
      session.score = res.score;
      session.highestTile = res.highestTile;
      session.moves = res.moves;
      await session.page.waitForTimeout(160);
      if (res.gameOver) {
        setTimeout(() => stopAutonomousBrowserGame(session.guildId), 1200);
        break;
      }
    }
    const finalState = await session.page.evaluate(() => window.getGameState());
    return {
      success: true,
      response: `Azura mengeksekusi ${stepsDone} langkah otonom. Skor sekarang: ${finalState.score.toLocaleString()} (Tile ${finalState.highestTile})`,
      state: finalState
    };
  }

  // 4. Open-Ended Strategic Discussion / Tactical Q&A / Banter with Live Board Awareness!
  const discussionAnswer = await discussGameWithAzura(rawCommand, userName, session);
  return {
    success: true,
    response: discussionAnswer,
    state: await session.page.evaluate(() => window.getGameState()).catch(() => null)
  };
}

/**
 * Launch Interactive Co-Op Game from Discord
 * @param {import('discord.js').Message} message 
 */
async function launchAutonomousBrowserGame(message) {
  const guildId = message.guild?.id || 'dm_' + message.author.id;
  const userName = message.member?.displayName || message.author.displayName || message.author.username;

  const gameUrl = 'http://203.175.10.163:7860/game';

  const session = await getOrCreateGameSession(guildId, message);
  session.userName = userName;
  session.channel = message.channel;
  session.client = message.client;

  const startEmbed = new EmbedBuilder()
    .setColor(0x00AE89) // Emerald
    .setTitle('🎮 Arena 2048 Otonom & Diskusi Terbuka Azura!')
    .setDescription(
      `Halo **${userName}**! Papan **2048 live stream** sudah dibuka! 🌸✨\n\n` +
      `🕹️ **Azura bermain secara otonom & kamu bisa main sendiri atau berdiskusi taktik kapanpun!**\n\n` +
      `📺 **Buka Halaman Game Arena 2048:**\n` +
      `👉 **[KLIK DI SINI UNTUK BUKA GAME ARENA](${gameUrl})**\n\n` +
      `💡 **Fitur:**\n` +
      `• **Mode Otonom & Manual:** Bisa main sendiri pakai panah keyboard/swipe HP, atau biarkan Azura bermain!\n` +
      `• **Diskusi Terbuka di VC:** Tanya strategi (*"Menurutmu gimana?"*, *"Saran dong"*), Azura akan menjawab lewat suara VC!`
    )
    .addFields(
      { name: '🎮 Halaman Game 2048', value: `[\`${gameUrl}\`](${gameUrl})`, inline: false },
      { name: '💬 Diskusi Taktis', value: '`Voice VC • Chat Diskusi • Analisis Papan Realtime`', inline: true },
      { name: '⚡ Streaming', value: '`Playwright Chromium 60fps HD`', inline: true }
    )
    .setFooter({ text: 'AZURA Autonomous & Strategic Companion 2026' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🎮 Buka Halaman Game Arena 2048')
      .setStyle(ButtonStyle.Link)
      .setURL(gameUrl),
    new ButtonBuilder()
      .setCustomId('btn_stop_game')
      .setLabel('🛑 Selesai & Lapor Skor Akhir')
      .setStyle(ButtonStyle.Danger)
  );

  const statusMsg = await message.reply({ embeds: [startEmbed], components: [row] });
  session.statusMsg = statusMsg;
}

/**
 * Stop active session and post 100% accurate, live-verified scorecard to Discord
 * @param {string} [guildId='global'] 
 */
async function stopAutonomousBrowserGame(guildId = 'global') {
  const session = findActiveGameSession(guildId);
  if (!session) return false;

  try {
    session.isRunning = false;
    let attachment = null;

    if (session.page && !session.page.isClosed()) {
      const liveState = await session.page.evaluate(() => window.getGameState()).catch(() => null);
      if (liveState) {
        session.score = liveState.score || 0;
        session.highestTile = liveState.highestTile || 2;
        session.moves = liveState.moves || 0;
      }

      await session.page.waitForTimeout(150);
      const screenshotBuffer = await session.page.screenshot({ type: 'png' }).catch(() => null);
      if (screenshotBuffer) {
        attachment = new AttachmentBuilder(screenshotBuffer, { name: 'azura_2048_final.png' });
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(session.highestTile >= 512 ? 0xF1C40F : 0x38BDF8)
        .setTitle('🏆 HASIL AKHIR PERTANDINGAN 2048 (REAL-TIME)')
        .setDescription(
          `Permainan selesai! Terima kasih sudah menemani dan mabar bareng aku yaa **${session.userName}**! 🌸✨\n\n` +
          `📊 **Rekapitulasi Skor Aktual:**\n` +
          `• 🏆 **Skor Akhir:** \`${session.score.toLocaleString()} Pts\`\n` +
          `• 🌟 **Tile Tertinggi:** \`Tile ${session.highestTile}\`\n` +
          `• 🕹️ **Total Langkah:** \`${session.moves} Langkah\``
        )
        .addFields(
          { name: '🏆 Skor Akhir', value: `\`${session.score.toLocaleString()} Pts\``, inline: true },
          { name: '🌟 Tile Tertinggi', value: `\`Tile ${session.highestTile}\``, inline: true },
          { name: '🕹️ Total Langkah', value: `\`${session.moves} Langkah\``, inline: true }
        )
        .setFooter({ text: 'AZURA Co-Op Web Gaming • Skor Realtime' })
        .setTimestamp();

      if (attachment) {
        resultEmbed.setImage('attachment://azura_2048_final.png');
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_replay_2048')
          .setLabel('🔄 Main Bareng Lagi')
          .setStyle(ButtonStyle.Primary)
      );

      if (session.channel) {
        await session.channel.send({
          embeds: [resultEmbed],
          files: attachment ? [attachment] : [],
          components: [row]
        }).catch(() => {});
      }

      // Voice commentary in Discord VC
      const farewellVoice = `Selesai ${session.userName}! Skor akhir kita mencapai ${session.score.toLocaleString()} poin dengan tile tertinggi ${session.highestTile} dalam ${session.moves} langkah! Seru banget mabar dan diskusi bareng kamu! 🌸✨`;
      try {
        const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
        if (session.guildId && session.guildId !== 'global') {
          speakTextInVC(session.guildId, farewellVoice, session.client || null, session.userName).catch(() => {});
        } else {
          speakInAllActiveVCs(farewellVoice, session.client || null).catch(() => {});
        }
      } catch (_) {}

      if (session.cdp) await session.cdp.detach().catch(() => {});
      await session.context.close().catch(() => {});
    }

    activeGameSessions.delete(session.guildId);
    activeGameSessions.delete(guildId);
    return true;
  } catch (err) {
    console.error('[Stop Game Error]:', err.message);
    activeGameSessions.delete(guildId);
    return true;
  }
}

/**
 * Handle game commands from Discord chat
 * @param {import('discord.js').Message} message 
 * @returns {Promise<boolean>}
 */
async function handleBrowserGameCommands(message) {
  const cleanText = (message.content || '')
    .replace(/<@!?\d+>/g, '')
    .replace(/[.,!?;:'"()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

  const guildId = message.guild?.id || 'dm_' + message.author.id;
  const userName = message.member?.displayName || message.author.displayName || message.author.username;

  // 1. Start game: "ara main game 2048", "ara main 2048"
  if (/\b(?:mainkan|main|play)\s+(?:game\s+|permainan\s+)?(?:2048|web|browser)\b/i.test(cleanText) ||
      /^(?:main\s+2048|main\s+game)$/i.test(cleanText)) {
    console.log(`[Browser Game Agent]: Triggered game for user: ${userName}`);
    await launchAutonomousBrowserGame(message);
    return true;
  }

  // 2. Stop game: "ara stop game", "ara berhenti main game"
  if (/\b(?:stop|berhenti|hentikan|selesai)\s+(?:main\s+)?(?:game|permainan|2048)\b/i.test(cleanText)) {
    const stopped = await stopAutonomousBrowserGame(guildId);
    if (stopped) {
      await message.reply('🛑 Permainan game 2048 sudah diakhiri dan skor akhir aktual sudah dilaporkan ya!');
    } else {
      await message.reply('Tidak ada sesi game browser yang sedang berjalan.');
    }
    return true;
  }

  // 3. Move or discussion commands from Discord chat while game session is active
  if (activeGameSessions.has(guildId)) {
    const isDirection = /^(?:geser\s*)?(?:kiri|kanan|atas|bawah|left|right|up|down|auto|reset)$/i.test(cleanText);
    const isDiscussion = /\b(?:menurutmu|kenapa|gimana|saran|taktik|bisa\s*menang|mikirin\s*apa|bingung|strategi)\b/i.test(cleanText);

    if (isDirection || isDiscussion) {
      const res = await executeInteractiveMove(cleanText, userName, guildId);
      if (res.response) {
        await message.reply(res.response);
      }
      return true;
    }
  }

  return false;
}

module.exports = {
  launchAutonomousBrowserGame,
  stopAutonomousBrowserGame,
  handleBrowserGameCommands,
  executeInteractiveMove,
  discussGameWithAzura
};
