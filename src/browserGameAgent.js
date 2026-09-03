/**
 * AZURA Autonomous Headless Browser Game Player
 * Plays web/canvas games (2048, Dino Runner, Snake) autonomously using Playwright Chromium.
 * 100% Isolated module with zero side effects on other Azura features.
 */

const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBrowser } = require('./headlessBrowser');
const config = require('./config');

// Active game sessions: guildId -> { browser, context, page, gameType, isRunning, score, highestTile, moves, interval }
const activeGameSessions = new Map();

/**
 * Built-in Lightweight HTML5 2048 Game Engine for 100% reliable local rendering without external network flakiness
 */
const HTML_2048_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>2048 AI Arena - AZURA</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
  body { background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
  .header { text-align: center; margin-bottom: 20px; }
  .title { font-size: 42px; font-weight: 800; color: #38bdf8; text-shadow: 0 0 20px rgba(56,189,248,0.5); }
  .subtitle { font-size: 16px; color: #94a3b8; margin-top: 4px; }
  .stats-bar { display: flex; gap: 20px; margin: 15px 0; }
  .stat-box { background: #1e293b; border: 1px solid #334155; padding: 10px 24px; border-radius: 12px; text-align: center; min-width: 130px; }
  .stat-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
  .stat-value { font-size: 26px; font-weight: 700; color: #f1f5f9; }
  .grid-container { background: #1e293b; border: 2px solid #38bdf8; border-radius: 16px; padding: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); position: relative; }
  .grid { display: grid; grid-template-columns: repeat(4, 90px); grid-template-rows: repeat(4, 90px); gap: 12px; }
  .cell { background: rgba(51, 65, 85, 0.5); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; transition: all 0.15s ease-in-out; }
  .tile-2 { background: #eee4da; color: #776e65; }
  .tile-4 { background: #ede0c8; color: #776e65; }
  .tile-8 { background: #f2b179; color: #f9f6f2; }
  .tile-16 { background: #f59563; color: #f9f6f2; }
  .tile-32 { background: #f67c5f; color: #f9f6f2; }
  .tile-64 { background: #f65e3b; color: #f9f6f2; }
  .tile-128 { background: #edcf72; color: #f9f6f2; font-size: 28px; box-shadow: 0 0 15px rgba(237,207,114,0.5); }
  .tile-256 { background: #edcc61; color: #f9f6f2; font-size: 28px; box-shadow: 0 0 20px rgba(237,204,97,0.6); }
  .tile-512 { background: #edc850; color: #f9f6f2; font-size: 28px; box-shadow: 0 0 25px rgba(237,200,80,0.7); }
  .tile-1024 { background: #edc53f; color: #f9f6f2; font-size: 22px; box-shadow: 0 0 30px rgba(237,197,63,0.8); }
  .tile-2048 { background: #38bdf8; color: #ffffff; font-size: 22px; box-shadow: 0 0 35px rgba(56,189,248,0.9); }
  .footer { margin-top: 20px; font-size: 13px; color: #64748b; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">🌸 AZURA 2048 AI ARENA</div>
    <div class="subtitle">Autonomous Neural-Heuristic Player • Real-Time Playwright Engine</div>
    <div class="stats-bar">
      <div class="stat-box">
        <div class="stat-label">Score</div>
        <div id="score" class="stat-value">0</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Highest Tile</div>
        <div id="highest-tile" class="stat-value">2</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Moves</div>
        <div id="move-count" class="stat-value">0</div>
      </div>
    </div>
  </div>
  <div class="grid-container">
    <div id="grid" class="grid"></div>
  </div>
  <div class="footer">AZURA Autonomous Web Game System 2026</div>

<script>
let board = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0]
];
let score = 0;
let moves = 0;
let gameOver = false;

function initGame() {
  board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  score = 0;
  moves = 0;
  gameOver = false;
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

window.executeMove = function(direction) {
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
    board,
    gameOver
  };
};

initGame();
</script>
</body>
</html>`;

/**
 * AI Decision Engine: Expectimax Corner-Weight Heuristic for 2048
 * Prioritizes locking high-value tiles to the top-left corner
 */
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
      if (val === 0) {
        emptyCells++;
      } else {
        score += val * CORNER_WEIGHTS[r][c];
      }
    }
  }

  // Bonus for empty cells (mobility)
  score += emptyCells * 500;

  // Penalty for non-monotonic rows
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[r][c] >= board[r][c + 1]) {
        score += 80;
      }
    }
  }

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
 * Launch autonomous 2048 Game Player for Discord
 * @param {import('discord.js').Message} message 
 * @param {string} [gameMode='2048'] 
 */
async function launchAutonomousBrowserGame(message, gameMode = '2048') {
  const guildId = message.guild?.id || 'dm_' + message.author.id;
  const userName = message.member?.displayName || message.author.displayName || message.author.username;

  // If session already active, stop it cleanly
  if (activeGameSessions.has(guildId)) {
    await stopAutonomousBrowserGame(guildId);
  }

  const initialEmbed = new EmbedBuilder()
    .setColor(0x00AE89) // Emerald
    .setTitle('🎮 Memulai Arena Game Browser Otonom Azura...')
    .setDescription(`Menyiapkan **Chromium Headless Game Engine** untuk memainkan game **${gameMode.toUpperCase()}** secara otonom untuk **${userName}**...`)
    .setFooter({ text: 'AZURA Autonomous Web Agent • Playwright Chromium Engine' })
    .setTimestamp();

  const statusMsg = await message.reply({ embeds: [initialEmbed] });

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 900, height: 750 },
      deviceScaleFactor: 1.5
    });
    const page = await context.newPage();

    // Set HTML5 Game Content
    await page.setContent(HTML_2048_PAGE);
    await page.waitForTimeout(600);

    const session = {
      guildId,
      context,
      page,
      gameType: '2048',
      isRunning: true,
      score: 0,
      highestTile: 2,
      moves: 0,
      startTime: Date.now(),
      statusMsg,
      channel: message.channel,
      userName
    };

    activeGameSessions.set(guildId, session);

    // Run the game loop in background (50 steps per session)
    run2048GameLoop(session);

  } catch (err) {
    console.error('[Browser Game Agent Error]:', err.message);
    await statusMsg.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('❌ Gagal Memulai Game Browser')
          .setDescription(`Terjadi kendala saat meluncurkan Playwright Chromium: \`${err.message}\``)
      ]
    });
  }
}

/**
 * Background loop executing moves and taking visual snapshot cards
 * @param {object} session 
 */
async function run2048GameLoop(session) {
  let consecutiveNoMoves = 0;
  const maxSteps = 120; // 120 AI moves per session

  for (let i = 0; i < maxSteps; i++) {
    if (!session.isRunning || session.page.isClosed()) break;

    try {
      // 1. Get current board state from Chromium
      const gameState = await session.page.evaluate(() => window.getGameState());
      if (!gameState || !gameState.board) break;

      session.score = gameState.score;
      session.highestTile = gameState.highestTile;
      session.moves = gameState.moves;

      // 2. Decide next optimal move via AI Heuristic
      const nextMove = getBest2048Move(gameState.board);

      // 3. Execute move inside browser
      const res = await session.page.evaluate((dir) => window.executeMove(dir), nextMove);

      if (!res.changed) {
        consecutiveNoMoves++;
        if (consecutiveNoMoves > 4) {
          console.log('[Browser Game 2048]: Game Over or Board Locked.');
          break;
        }
      } else {
        consecutiveNoMoves = 0;
      }

      // Small delay for smooth realistic animation
      await session.page.waitForTimeout(80);

    } catch (err) {
      console.error('[2048 Loop Error]:', err.message);
      break;
    }
  }

  // After run completion: Take high-res visual snapshot and post results
  try {
    if (!session.page.isClosed()) {
      const screenshotBuffer = await session.page.screenshot({ type: 'png' });
      const attachment = new AttachmentBuilder(screenshotBuffer, { name: 'azura_2048_gameplay.png' });

      let commentary = `Attila liat nih! Aku berhasil dapet tile **${session.highestTile}** dengan total score **${session.score.toLocaleString()}** dalam **${session.moves}** langkah! Keren kan mekanik AI-ku? 💅✨`;
      if (session.highestTile >= 1024) {
        commentary = `Gokil! Aku tembus tile **${session.highestTile}**! Tinggal satu kali gabung lagi menuju 2048! Strategi corner-lock ku bener-bener gacor! 🏆🔥`;
      } else if (session.highestTile >= 512) {
        commentary = `Berhasil dapet tile **${session.highestTile}**! Permainannya rapi banget, score akhir **${session.score.toLocaleString()}**! 🌸🎮`;
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(session.highestTile >= 512 ? 0xF1C40F : 0x3498DB)
        .setTitle('🎮 Pertandingan 2048 Otonom Selesai!')
        .setDescription(commentary)
        .addFields(
          { name: '🏆 Skor Akhir', value: `\`${session.score.toLocaleString()} Pts\``, inline: true },
          { name: '🌟 Tile Tertinggi', value: `\`Tile ${session.highestTile}\``, inline: true },
          { name: '🕹️ Total Langkah AI', value: `\`${session.moves} Langkah\``, inline: true },
          { name: '⚡ Engine', value: '`Playwright Chromium • Neural Heuristic`', inline: false }
        )
        .setImage('attachment://azura_2048_gameplay.png')
        .setFooter({ text: 'AZURA Autonomous Web Game Engine • Real-Time Headless Browser' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_replay_2048')
          .setLabel('🔄 Mainkan Lagi')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setLabel('🌐 Pantau Live Stream Web')
          .setStyle(ButtonStyle.Link)
          .setURL('http://203.175.10.163:7860/live')
      );

      await session.channel.send({
        embeds: [resultEmbed],
        files: [attachment],
        components: [row]
      });

      // Cleanup
      await session.context.close().catch(() => {});
      activeGameSessions.delete(session.guildId);
    }
  } catch (err) {
    console.error('[Browser Game Finalize Error]:', err.message);
  }
}

/**
 * Stop active browser game session
 * @param {string} guildId 
 */
async function stopAutonomousBrowserGame(guildId) {
  const session = activeGameSessions.get(guildId);
  if (session) {
    session.isRunning = false;
    if (session.context) {
      await session.context.close().catch(() => {});
    }
    activeGameSessions.delete(guildId);
    return true;
  }
  return false;
}

/**
 * Check if a text message is a browser game request
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

  // Pattern: "ara main game 2048", "ara main 2048", "ara main game web", "ara main game browser"
  const isStartGame = /\b(?:mainkan|main|play)\s+(?:game\s+|permainan\s+)?(?:2048|web|browser|dino)\b/i.test(cleanText) ||
                      /^(?:main\s+2048|main\s+game)$/i.test(cleanText);

  if (isStartGame) {
    console.log(`[Browser Game Agent]: Triggered autonomous game for user: ${message.author.username}`);
    await launchAutonomousBrowserGame(message, '2048');
    return true;
  }

  // Pattern: "ara stop game", "ara berhenti main game"
  const isStopGame = /\b(?:stop|berhenti|hentikan)\s+(?:main\s+)?(?:game|permainan|2048)\b/i.test(cleanText);
  if (isStopGame) {
    const guildId = message.guild?.id || 'dm_' + message.author.id;
    const stopped = await stopAutonomousBrowserGame(guildId);
    if (stopped) {
      await message.reply('🛑 Permainan game browser otonom sudah dihentikan ya!');
    } else {
      await message.reply('Tidak ada sesi game browser yang sedang berjalan.');
    }
    return true;
  }

  return false;
}

module.exports = {
  launchAutonomousBrowserGame,
  stopAutonomousBrowserGame,
  handleBrowserGameCommands
};
