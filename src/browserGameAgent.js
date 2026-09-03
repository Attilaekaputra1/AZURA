/**
 * AZURA Autonomous Headless Browser Game Player - Co-Op Interactive Edition
 * Plays 2048 collaboratively with Attila & members.
 * - Receives moves via Web Text/Voice commands and Discord Chat.
 * - Streams live 60fps video directly to http://203.175.10.163:7860/live.
 * - Lively persona voice & thinking dialogue for every move.
 * - Clean final scorecard only at game end.
 */

const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBrowser } = require('./headlessBrowser');
const { broadcastFrame, updateStreamMeta, STREAM_URL } = require('./livePortal');
const config = require('./config');

// Active game sessions: guildId -> session object
const activeGameSessions = new Map();

/**
 * Built-in Modern HTML5 2048 Game Engine
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
    <div class="subtitle">Live Interactive Companion • Voice & Text Command Stream</div>
    <div class="stats-bar">
      <div class="stat-box"><div class="stat-label">Score</div><div id="score" class="stat-value">0</div></div>
      <div class="stat-box"><div class="stat-label">Highest Tile</div><div id="highest-tile" class="stat-value">2</div></div>
      <div class="stat-box"><div class="stat-label">Moves</div><div id="move-count" class="stat-value">0</div></div>
    </div>
  </div>
  <div class="grid-container">
    <div id="grid" class="grid"></div>
  </div>
  <div id="thought" class="thought-bubble">Siap menerima aba-aba dari Attila! Ketik atau bicara di portal web 🎤</div>

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
  if (thoughtText) {
    document.getElementById('thought').textContent = thoughtText;
  }
  return {
    changed,
    score,
    moves,
    highestTile: parseInt(document.getElementById('highest-tile').textContent, 10),
    board
  };
};

window.getGameState = function() {
  return {
    score,
    moves,
    highestTile: parseInt(document.getElementById('highest-tile').textContent, 10),
    board
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
 * Get or create active session
 */
async function getOrCreateGameSession(guildId = 'global', message = null) {
  let session = activeGameSessions.get(guildId);
  if (session && !session.page.isClosed()) {
    return session;
  }

  console.log(`[Browser Game Agent]: 🚀 Launching new Co-Op Game session for ${guildId}...`);
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
    url: 'http://203.175.10.163:7860/live',
    activeGuild: guildId
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
    userName: message?.member?.displayName || message?.author?.username || 'Attila',
    statusMsg: null
  };

  activeGameSessions.set(guildId, session);
  return session;
}

/**
 * Execute an interactive move ordered by the user (via Web Voice/Text or Discord)
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

  let direction = null;
  let isAuto = false;
  let isReset = false;
  let isHint = false;

  // Direction parser
  if (/\b(?:kiri|left|geser\s+kiri|ke\s+kiri|arah\s+kiri)\b/i.test(cleanCmd)) direction = 'left';
  else if (/\b(?:kanan|right|geser\s+kanan|ke\s+kanan|arah\s+kanan)\b/i.test(cleanCmd)) direction = 'right';
  else if (/\b(?:atas|up|geser\s+atas|ke\s+atas|arah\s+atas|naik)\b/i.test(cleanCmd)) direction = 'up';
  else if (/\b(?:bawah|down|geser\s+bawah|ke\s+bawah|arah\s+bawah|turun)\b/i.test(cleanCmd)) direction = 'down';
  else if (/\b(?:auto|bantu|otonom|mainkan|mainin|jalan\s+sendiri)\b/i.test(cleanCmd)) isAuto = true;
  else if (/\b(?:reset|ulang|restart|baru)\b/i.test(cleanCmd)) isReset = true;
  else if (/\b(?:saran|hint|bagusnya|kemana|rekomendasi)\b/i.test(cleanCmd)) isHint = true;

  // 1. Reset Board
  if (isReset) {
    const newState = await session.page.evaluate(() => window.resetGame());
    session.score = newState.score;
    session.moves = newState.moves;
    session.highestTile = newState.highestTile;
    const resp = `Sip ${userName}! Papan 2048-nya sudah aku reset bersih yaa. Yuk mulai susun dari awal lagi! 🌸`;
    try {
      const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
      if (guildId && guildId !== 'global') speakTextInVC(guildId, resp, session.client || null, userName).catch(() => {});
      else speakInAllActiveVCs(resp, session.client || null).catch(() => {});
    } catch (_) {}
    return { success: true, response: resp, state: newState };
  }

  // 2. Hint / Suggestion
  if (isHint) {
    const currentState = await session.page.evaluate(() => window.getGameState());
    const bestMove = getBest2048Move(currentState.board);
    const indonesianDirs = { up: 'ATAS', down: 'BAWAH', left: 'KIRI', right: 'KANAN' };
    const resp = `Hmm setelah aku analisis papannya, langkah paling aman dan optimal sekarang adalah geser ke **${indonesianDirs[bestMove]}**! Mau aku eksekusikan sekarang? 😉`;
    try {
      const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
      if (guildId && guildId !== 'global') speakTextInVC(guildId, resp, session.client || null, userName).catch(() => {});
      else speakInAllActiveVCs(resp, session.client || null).catch(() => {});
    } catch (_) {}
    return { success: true, response: resp, state: currentState };
  }

  // 3. Auto Play 5 Steps
  if (isAuto) {
    let stepsDone = 0;
    for (let s = 0; s < 5; s++) {
      const currentState = await session.page.evaluate(() => window.getGameState());
      const bestMove = getBest2048Move(currentState.board);
      const thought = `Auto-play langkah ${s + 1}/5: geser ${bestMove.toUpperCase()}...`;
      const res = await session.page.evaluate(({ dir, thoughtText }) => window.executeMove(dir, thoughtText), {
        dir: bestMove,
        thoughtText: thought
      });
      if (!res.changed) break;
      stepsDone++;
      session.score = res.score;
      session.highestTile = res.highestTile;
      session.moves = res.moves;
      await session.page.waitForTimeout(200);
    }
    const finalState = await session.page.evaluate(() => window.getGameState());
    const resp = `Selesai ${userName}! Aku sudah eksekusi ${stepsDone} langkah otonom. Skor kita sekarang **${finalState.score.toLocaleString()}** dengan tile tertinggi **${finalState.highestTile}**! Sekarang giliranmu, mau geser kemana lagi? 💅✨`;
    try {
      const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
      if (guildId && guildId !== 'global') speakTextInVC(guildId, resp, session.client || null, userName).catch(() => {});
      else speakInAllActiveVCs(resp, session.client || null).catch(() => {});
    } catch (_) {}
    return { success: true, response: resp, state: finalState };
  }

  // 4. Single Direction Move
  if (direction) {
    const indonesianDirs = { up: 'ATAS', down: 'BAWAH', left: 'KIRI', right: 'KANAN' };
    const thought = `Mengikuti aba-aba ${userName}: geser ${indonesianDirs[direction]}!`;
    const res = await session.page.evaluate(({ dir, thoughtText }) => window.executeMove(dir, thoughtText), {
      dir: direction,
      thoughtText: thought
    });

    session.score = res.score;
    session.highestTile = res.highestTile;
    session.moves = res.moves;

    let resp = '';
    if (res.changed) {
      const reactions = [
        `Siap ${userName}! Aku geser ke **${indonesianDirs[direction]}**! Papan bergerak rapi, skor jadi **${res.score.toLocaleString()}**! ✨`,
        `Oke meluncur ke **${indonesianDirs[direction]}**! Mantap, langkahmu tepat! 👍`,
        `Sip! Geser **${indonesianDirs[direction]}** berhasil! Tile tertinggi kita sekarang **Tile ${res.highestTile}**! 🔥`,
        `Aba-aba diterima! Bidak bergeser ke **${indonesianDirs[direction]}**. Next kemana lagi nih? 😉`
      ];
      resp = reactions[Math.floor(Math.random() * reactions.length)];
    } else {
      resp = `Hmm ${userName}, geser ke **${indonesianDirs[direction]}** gak ada bidak yang bisa digabung atau bergerak nih. Coba arah yang lain yaa!`;
    }

    // 🎙️ Voice Output directly to Discord Voice Channel (Kak Ceria / Edge-TTS)
    try {
      const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
      if (guildId && guildId !== 'global') {
        speakTextInVC(guildId, resp, session.client || null, userName).catch(() => {});
      } else {
        speakInAllActiveVCs(resp, session.client || null).catch(() => {});
      }
    } catch (_) {}

    return { success: true, response: resp, state: res };
  }

  const fallbackResp = `Aku kurang paham arahnya nih ${userName}. Kamu bisa bilang: *"geser kiri"*, *"ke atas"*, *"kanan"*, *"bawah"*, atau *"auto"*!`;
  try {
    const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
    if (guildId && guildId !== 'global') {
      speakTextInVC(guildId, fallbackResp, session.client || null, userName).catch(() => {});
    } else {
      speakInAllActiveVCs(fallbackResp, session.client || null).catch(() => {});
    }
  } catch (_) {}

  return {
    success: false,
    response: fallbackResp,
    state: null
  };
}

/**
 * Launch Interactive Co-Op Game from Discord
 * @param {import('discord.js').Message} message 
 */
async function launchAutonomousBrowserGame(message) {
  const guildId = message.guild?.id || 'dm_' + message.author.id;
  const userName = message.member?.displayName || message.author.displayName || message.author.username;

  const streamUrl = STREAM_URL || 'http://203.175.10.163:7860/live';

  const session = await getOrCreateGameSession(guildId, message);
  session.userName = userName;
  session.channel = message.channel;

  const startEmbed = new EmbedBuilder()
    .setColor(0x00AE89) // Emerald
    .setTitle('🎮 Arena 2048 Co-Op Azura & Attila Telah Dibuka!')
    .setDescription(
      `Halo **${userName}**! Aku sudah membuka papan **2048 di browser live** nih! 🌸✨\n\n` +
      `🕹️ **Kita main bareng ya! Kamu yang kasih aba-aba/perintah, aku yang geserkan bidaknya!**\n\n` +
      `📺 **Buka Portal Web Live Stream untuk Memberi Perintah & Nonton 60 FPS:**\n` +
      `👉 **[KLIK DI SINI UNTUK BUKA PORTAL INTERAKTIF](${streamUrl})**\n\n` +
      `💡 **Cara Mengontrol Azura:**\n` +
      `• **Di Portal Web:** Bisa ketik teks, tekan tombol D-Pad, atau **klik tombol Mic 🎙️ untuk bicara langsung ke Azura!**\n` +
      `• **Di Chat Discord:** Kamu juga bisa ketik \`ara geser kiri\`, \`ara ke atas\`, \`ara auto play\`, dll.`
    )
    .addFields(
      { name: '🌐 Portal Web Interaktif', value: `[\`${streamUrl}\`](${streamUrl})`, inline: false },
      { name: '🎙️ Fitur Kontrol', value: '`Voice Speech Mic • Text Chat • Quick D-Pad`', inline: true },
      { name: '⚡ Streaming', value: '`Playwright Chromium 60fps HD`', inline: true }
    )
    .setFooter({ text: 'AZURA Interactive Co-Op Gaming 2026' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🌐 Buka Portal Web Interaktif (60 FPS)')
      .setStyle(ButtonStyle.Link)
      .setURL(streamUrl),
    new ButtonBuilder()
      .setCustomId('btn_stop_game')
      .setLabel('🛑 Selesai & Lapor Skor Akhir')
      .setStyle(ButtonStyle.Danger)
  );

  const statusMsg = await message.reply({ embeds: [startEmbed], components: [row] });
  session.statusMsg = statusMsg;
}

/**
 * Stop active session and post final scorecard to Discord
 * @param {string} guildId 
 */
async function stopAutonomousBrowserGame(guildId) {
  const session = activeGameSessions.get(guildId);
  if (!session) return false;

  try {
    session.isRunning = false;
    let attachment = null;

    if (!session.page.isClosed()) {
      const screenshotBuffer = await session.page.screenshot({ type: 'png' }).catch(() => null);
      if (screenshotBuffer) {
        attachment = new AttachmentBuilder(screenshotBuffer, { name: 'azura_2048_final.png' });
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(session.highestTile >= 512 ? 0xF1C40F : 0x38BDF8)
        .setTitle('🏆 HASIL AKHIR PERTANDINGAN 2048 CO-OP')
        .setDescription(
          `Permainan kita selesai! Terima kasih sudah mabar bareng aku yaa **${session.userName}**! 🌸✨\n\n` +
          `Skor akhir yang berhasil kita kumpulkan adalah **${session.score.toLocaleString()}** dengan tile tertinggi **Tile ${session.highestTile}** dalam **${session.moves}** langkah!`
        )
        .addFields(
          { name: '🏆 Skor Akhir', value: `\`${session.score.toLocaleString()} Pts\``, inline: true },
          { name: '🌟 Tile Tertinggi', value: `\`Tile ${session.highestTile}\``, inline: true },
          { name: '🕹️ Total Langkah', value: `\`${session.moves} Langkah\``, inline: true }
        )
        .setFooter({ text: 'AZURA Co-Op Web Gaming • Selesai' })
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

      if (session.cdp) await session.cdp.detach().catch(() => {});
      await session.context.close().catch(() => {});
    }

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
    console.log(`[Browser Game Agent]: Triggered Co-Op game for user: ${userName}`);
    await launchAutonomousBrowserGame(message);
    return true;
  }

  // 2. Stop game: "ara stop game", "ara berhenti main game"
  if (/\b(?:stop|berhenti|hentikan|selesai)\s+(?:main\s+)?(?:game|permainan|2048)\b/i.test(cleanText)) {
    const stopped = await stopAutonomousBrowserGame(guildId);
    if (stopped) {
      await message.reply('🛑 Permainan game 2048 sudah diakhiri dan skor akhir sudah dilaporkan ya!');
    } else {
      await message.reply('Tidak ada sesi game browser yang sedang berjalan.');
    }
    return true;
  }

  // 3. Move commands from Discord: "ara geser kiri", "ara ke atas", "ara geser kanan", "ara ke bawah", "ara auto play"
  const isMoveCommand = /\b(?:geser|ke|arah|move)\s+(?:kiri|kanan|atas|bawah|left|right|up|down)\b/i.test(cleanText) ||
                        /\b(?:auto|auto\s+play|saran|hint|reset\s+board)\b/i.test(cleanText);

  if (isMoveCommand && activeGameSessions.has(guildId)) {
    const res = await executeInteractiveMove(cleanText, userName, guildId);
    await message.reply(res.response);
    return true;
  }

  return false;
}

module.exports = {
  launchAutonomousBrowserGame,
  stopAutonomousBrowserGame,
  handleBrowserGameCommands,
  executeInteractiveMove
};
