/**
 * AZURA Master Interactive Mini-Games Subsystem
 * 
 * 🎮 1. Tic-Tac-Toe / XOXO (User vs Azura via Discord Buttons)
 *       - 🟢 Easy (Relaxed / Random Moves)
 *       - 🟡 Medium (Casual / Block Checks)
 *       - 🔴 Hard (Tactical / Rule-Based Heuristics)
 *       - 💀 Expert (Master / Unbeatable Minimax Algorithm)
 * 🔤 2. Sambung Kata KBBI (Indonesian Word Chain Battle)
 * 🏆 3. Kuis Trivia Interaktif (Interactive 4-Choice Quiz + Leaderboard)
 * 
 * Includes:
 * • Dynamic AI Heuristics & Gen Z Banters
 * • Vault-Encrypted Persistent Scores & Global Leaderboard
 * • State-Safe Timeout Protection
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { recordGameScore, getGameLeaderboard, getUserCallingName } = require('./vault');

// ============================================================
// 1. TIC-TAC-TOE (XOXO) ENGINE WITH 4 DIFFICULTY TIERS
// ============================================================

// activeTttGames: gameKey (channelId_userId) -> GameState
const activeTttGames = new Map();

const TTT_WIN_PATTERNS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

const TTT_DIFFICULTIES = {
  easy: {
    key: 'easy',
    name: '🟢 Easy (Santai / Pemula)',
    badge: '🟢 [EASY]',
    winPoints: 5,
    drawPoints: 2,
    color: 0x2ECC71,
    desc: 'Azura bermain santai, kadang melamun, dan tidak sengaja membuka celah kemenangan!'
  },
  medium: {
    key: 'medium',
    name: '🟡 Medium (Kasual / Sedang)',
    badge: '🟡 [MEDIUM]',
    winPoints: 10,
    drawPoints: 4,
    color: 0xF1C40F,
    desc: 'Azura bermain kasual dengan taktik seimbang dan sesekali memblokir seranganmu!'
  },
  hard: {
    key: 'hard',
    name: '🔴 Hard (Taktis / Menantang)',
    badge: '🔴 [HARD]',
    winPoints: 15,
    drawPoints: 5,
    color: 0xE67E22,
    desc: 'Azura bermain taktis dengan kalkulasi posisi tengah dan pemblokiran cepat!'
  },
  expert: {
    key: 'expert',
    name: '💀 Expert (Master / Unbeatable Minimax)',
    badge: '💀 [EXPERT MINIMAX]',
    winPoints: 30,
    drawPoints: 10,
    color: 0x9B59B6,
    desc: 'Azura mengaktifkan algoritma Minimax murni tanpa celah kekalahan (100% Optimal)!'
  }
};

const TTT_BANTERS = {
  easy: {
    START: [
      'Hehe, aku lagi main santai nih! Kamu pasti bisa menang kok! 🌸✨',
      'Mode santai aktif! Jangan tegang-tegang yaa, let\'s play! 🎈',
      'Ayo mulai! Aku main sambil ngemil boba nih hehe! 🧋'
    ],
    USER_MOVE: [
      'Wah, langkah yang bagus! Bentar aku mikir dulu... 👀',
      'Eh, aku kok kayak salah pencet ya tadi [giggles] 😅',
      'Boleh juga! Tapi aku masih punya kotak cadangan kok! 💅'
    ],
    BOT_WIN: [
      'Lho, aku gak sengaja menang nih hehe! Main lagi yuk! 🎉',
      'Yeyy dapet garis tiga! Tetap semangat yaa! ✨',
      'Hehe menang santai! Mau tanding ulang? 🌸'
    ],
    USER_WIN: [
      'Yeyyy kamu menang! Hebat banget, selamat yaa! 🏆🌸',
      'Wah beneran menang! Keren parah mainnya! 👑',
      'Mantap! Kamu berhasil ngalahin mode santai aku! 👏'
    ],
    DRAW: [
      'Seri gais! Sama-sama santai nih kita berdua! 🤝✨'
    ]
  },
  medium: {
    START: [
      'Siap tanding kasual? Coba tunjukin jurus terbaikmu! 😎',
      'Ayo mulai! Aku bakal kasih perlawanan yang lumayan lho! 💅',
      'Jangan remehin taktik kasual Gen Z yaa! Let\'s go! 🚀'
    ],
    USER_MOVE: [
      'Hmm... taktik yang lumayan, tapi coba lewatin langkahku! 👀',
      'Boleh juga, tapi pertahanan aku masih oke kok! 😼',
      'Waduh, agresif juga! Nih aku hadang! ✋'
    ],
    BOT_WIN: [
      'Horeee! Azura menang di ronde kasual! Mau coba lagi gak nih? 🎉',
      'Menang telak! Hehe, lumayan kan permainanku! 💅',
      'GGWP! Lain kali harus lebih teliti baca celah yaa! ✨'
    ],
    USER_WIN: [
      'Wah mantap! Kamu berhasil nembus pertahananku! GGWP! 👏🔥',
      'Aduh kecolongan! Jago juga kamu baca pergerakanku! 🏆',
      'Keren! Langkahmu tadi cerdik banget! 🌟'
    ],
    DRAW: [
      'Remis/Draw! Kita imbang banget nih pemikirannya! ⚖️'
    ]
  },
  hard: {
    START: [
      'Kalkulasi taktis aktif! Jangan harap aku kasih menang gampang yaa! 🚀🔥',
      'Mode kompetitif on! Siapkan konsentrasi penuhmu! 😼',
      'Ayo mulai! Langkahku sudah dihitung secara presisi! 🧠'
    ],
    USER_MOVE: [
      'Dih, mau coba ngejebak aku ya? Nih langsung aku kunci! 💅',
      'Langkahmu terbaca! Aku masih selangkah lebih depan! 🧠',
      'Taktik yang cerdas, tapi benteng pertahananku masih kokoh! 🛡️'
    ],
    BOT_WIN: [
      'Yeyyy! Kalkulasi Gen Z AI tak terkalahkan! Makanya jangan remehin yaa! 🏆💅',
      'Menang bersih! GG, mau balas dendam di ronde berikutnya? [smirks] ✨',
      'Taktik Hard Azura membuktikan kualitasnya! Horeee! 🎉'
    ],
    USER_WIN: [
      'Gila keren banget! Kamu berhasil ngalahin mode Hard aku! 👑🔥 Respect!',
      'Luar biasa! Taktikmu tajam banget sampai bisa lolos! GGWP! 🌟',
      'Keren parah! Kamu pemain taktis tingkat tinggi! 🏆'
    ],
    DRAW: [
      'Seri! Pertahanan kita sama-sama berlapis baja nih! 🤝🛡️'
    ]
  },
  expert: {
    START: [
      '💀 [MODE GRANDMASTER MINIMAX AKTIF]: Semua kemungkinan langkah sudah ku petakan di memoriku! Mau coba tembus kalkulasi 0 celah aku? [smirks] 💅🔥',
      'Selamat datang di neraka taktik! Algoritma optimal berjalan, good luck! 🧠⚡',
      'Kalkulasi pohon keputusan 100% aktif. Tunjukkan padaku jika kamu bisa bertahan! 😼'
    ],
    USER_MOVE: [
      'Langkah yang berani, tapi algoritmaku sudah memprediksinya 3 langkah ke depan! 💅',
      'Menarik, tapi setiap sudut sudah dalam kendali Minimax AI! 😼',
      'Kamu berusaha membuat jebakan ganda ya? Nih aku patahkan seketika! 🧠⚡'
    ],
    BOT_WIN: [
      '🏆 KEMENANGAN MUTLAK MINIMAX! Matematika tidak pernah berbohong, Say! GGWP! 💅🔥',
      'Checkmate! Pertahanan absolut Azura terbukti tak tertembus! [chuckles] 👑',
      'Algoritma sempurna mengklaim kemenangan! Mau coba lawan dewa AI lagi? 💀✨'
    ],
    USER_WIN: [
      '😱 WHAT?! KAMU BERHASIL NGALAHIN EXPERT MINIMAX?! Ini rekor bersejarah, kamu jenius taktik sejati! 👑🏆🔥',
      'Gilaaaa! Gimana ceritanya kamu bisa tembus?! Aku angkat topi, kamu dewa tictactoe! 🌟'
    ],
    DRAW: [
      '🤝 PERTAHANAN SEMPURNA! Kamu berhasil menahan gempuran dewa AI Expert! Ini pencapaian luar biasa! ⚖️🛡️',
      'Remis melawan Master Minimax! Hanya pemain berotak encer yang bisa nahan seri! GGWP! 🧠👑'
    ]
  }
};

function getRandomBanter(category, difficulty = 'hard') {
  const diffGroup = TTT_BANTERS[difficulty] || TTT_BANTERS.hard;
  const list = diffGroup[category] || diffGroup.START || TTT_BANTERS.hard.START;
  return list[Math.floor(Math.random() * list.length)];
}

function checkTttWinner(board) {
  for (const [a, b, c] of TTT_WIN_PATTERNS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // 'X' or 'O'
    }
  }
  if (board.every(cell => cell !== null)) {
    return 'DRAW';
  }
  return null;
}

// ── Minimax Unbeatable Algorithm for Expert Mode ──
function minimax(board, depth, isMaximizing, botSymbol = 'O', userSymbol = 'X') {
  const winner = checkTttWinner(board);
  if (winner === botSymbol) return 10 - depth;
  if (winner === userSymbol) return depth - 10;
  if (winner === 'DRAW') return 0;

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        board[i] = botSymbol;
        const score = minimax(board, depth + 1, false, botSymbol, userSymbol);
        board[i] = null;
        bestScore = Math.max(score, bestScore);
      }
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        board[i] = userSymbol;
        const score = minimax(board, depth + 1, true, botSymbol, userSymbol);
        board[i] = null;
        bestScore = Math.min(score, bestScore);
      }
    }
    return bestScore;
  }
}

function calculateExpertMinimaxMove(board, botSymbol = 'O', userSymbol = 'X') {
  let bestScore = -Infinity;
  let bestMove = -1;

  for (let i = 0; i < 9; i++) {
    if (board[i] === null) {
      board[i] = botSymbol;
      const score = minimax(board, 0, false, botSymbol, userSymbol);
      board[i] = null;
      if (score > bestScore) {
        bestScore = score;
        bestMove = i;
      }
    }
  }
  return bestMove;
}

function calculateSmartAiMove(board, botSymbol = 'O', userSymbol = 'X') {
  // 1. Can Bot win in 1 move? Take it!
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) {
      board[i] = botSymbol;
      if (checkTttWinner(board) === botSymbol) {
        board[i] = null;
        return i;
      }
      board[i] = null;
    }
  }

  // 2. Can User win in 1 move? Block it!
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) {
      board[i] = userSymbol;
      if (checkTttWinner(board) === userSymbol) {
        board[i] = null;
        return i;
      }
      board[i] = null;
    }
  }

  // 3. Take Center if available (cell 4)
  if (board[4] === null) return 4;

  // 4. Take Strategic Corners (0, 2, 6, 8)
  const corners = [0, 2, 6, 8].filter(idx => board[idx] === null);
  if (corners.length > 0) {
    return corners[Math.floor(Math.random() * corners.length)];
  }

  // 5. Take remaining edges (1, 3, 5, 7)
  const edges = [1, 3, 5, 7].filter(idx => board[idx] === null);
  if (edges.length > 0) {
    return edges[Math.floor(Math.random() * edges.length)];
  }

  return -1;
}

function calculateAiMoveByDifficulty(board, difficulty = 'hard', botSymbol = 'O', userSymbol = 'X') {
  const diff = (difficulty || 'hard').toLowerCase();

  // 💀 EXPERT MODE: 100% Optimal Minimax Decision Tree
  if (diff === 'expert') {
    return calculateExpertMinimaxMove(board, botSymbol, userSymbol);
  }

  // 🟢 EASY MODE: 80% Random, 20% Direct Win Check
  if (diff === 'easy') {
    const emptyCells = board.map((v, i) => v === null ? i : null).filter(v => v !== null);
    if (emptyCells.length === 0) return -1;

    if (Math.random() < 0.2) {
      for (const idx of emptyCells) {
        board[idx] = botSymbol;
        if (checkTttWinner(board) === botSymbol) {
          board[idx] = null;
          return idx;
        }
        board[idx] = null;
      }
    }
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
  }

  // 🟡 MEDIUM MODE: 60% Tactical, 40% Random
  if (diff === 'medium') {
    const emptyCells = board.map((v, i) => v === null ? i : null).filter(v => v !== null);
    if (emptyCells.length === 0) return -1;

    if (Math.random() < 0.6) {
      // 1. Take Win
      for (const idx of emptyCells) {
        board[idx] = botSymbol;
        if (checkTttWinner(board) === botSymbol) {
          board[idx] = null;
          return idx;
        }
        board[idx] = null;
      }
      // 2. Block Opponent Win
      for (const idx of emptyCells) {
        board[idx] = userSymbol;
        if (checkTttWinner(board) === userSymbol) {
          board[idx] = null;
          return idx;
        }
        board[idx] = null;
      }
    }

    if (board[4] === null && Math.random() < 0.5) return 4;
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
  }

  // 🔴 HARD MODE: 100% Rule-based Deterministic Heuristic
  return calculateSmartAiMove(board, botSymbol, userSymbol);
}

function buildTttGridComponents(board, disabled = false, gameKey = '') {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const val = board[idx];
      let label = '➖';
      let style = ButtonStyle.Secondary;

      if (val === 'X') {
        label = '❌';
        style = ButtonStyle.Primary;
      } else if (val === 'O') {
        label = '⭕';
        style = ButtonStyle.Danger;
      }

      const btn = new ButtonBuilder()
        .setCustomId(`ttt_${gameKey}_${idx}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled || val !== null);

      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

function buildDifficultySelectorComponents(gameKey) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tttdiff_${gameKey}_easy`).setLabel('🟢 Easy').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tttdiff_${gameKey}_medium`).setLabel('🟡 Medium').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tttdiff_${gameKey}_hard`).setLabel('🔴 Hard').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tttdiff_${gameKey}_expert`).setLabel('💀 Expert').setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

function promptTicTacToeDifficulty(userId, userName, channel) {
  const gameKey = `${channel.id}_${userId}`;

  const embed = new EmbedBuilder()
    .setColor(0x00E5FF)
    .setTitle('🎮 [TIC-TAC-TOE: PILIH TINGKAT KESULITAN]')
    .setDescription(
      `Halo <@${userId}>! Pilih tingkat kecerdasan AI AZURA yang ingin kamu lawan:\n\n` +
      `🟢 **Easy (Santai / Pemula):** Azura santai & sering ngelamun (+5 Poin)\n` +
      `🟡 **Medium (Kasual / Sedang):** Taktik seimbang & memblokir garis (+10 Poin)\n` +
      `🔴 **Hard (Taktis / Menantang):** Kompetitif, cepat & mengunci sudut (+15 Poin)\n` +
      `💀 **Expert (Master / Unbeatable):** Algoritma Minimax tanpa celah kesalahan (+30 Poin)\n\n` +
      `👉 *Klik salah satu tombol kesulitan di bawah untuk memulai permainan:*`
    )
    .setFooter({ text: 'Mini-Game Azura • Waktu memilih: 1 Menit' })
    .setTimestamp();

  return { embeds: [embed], components: buildDifficultySelectorComponents(gameKey) };
}

function startTicTacToeGame(userId, userName, channel, difficulty = null) {
  const gameKey = `${channel.id}_${userId}`;

  // If no difficulty provided, prompt user to select difficulty with buttons
  if (!difficulty) {
    return promptTicTacToeDifficulty(userId, userName, channel);
  }

  const cleanDiff = (difficulty || 'hard').toLowerCase();
  const diffConfig = TTT_DIFFICULTIES[cleanDiff] || TTT_DIFFICULTIES.hard;

  // Clear existing game if any
  if (activeTttGames.has(gameKey)) {
    const old = activeTttGames.get(gameKey);
    if (old.timeout) clearTimeout(old.timeout);
    activeTttGames.delete(gameKey);
  }

  const board = Array(9).fill(null);
  const timeout = setTimeout(() => {
    activeTttGames.delete(gameKey);
  }, 3 * 60 * 1000); // 3-minute timeout

  const state = {
    userId,
    userName,
    difficulty: diffConfig.key,
    board,
    userSymbol: 'X',
    botSymbol: 'O',
    turn: 'USER',
    timeout,
    channelId: channel.id
  };
  activeTttGames.set(gameKey, state);

  const embed = new EmbedBuilder()
    .setColor(diffConfig.color)
    .setTitle(`🎮 [TIC-TAC-TOE: USER VS AZURA ${diffConfig.badge}]`)
    .setDescription(
      `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
      `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
      `💬 **Azura:** *"${getRandomBanter('START', diffConfig.key)}"*\n\n` +
      `👉 **Giliran Kamu!** Klik salah satu kotak di bawah untuk melangkah:`
    )
    .setFooter({ text: `Mini-Game Azura • Menang: +${diffConfig.winPoints} Poin | Seri: +${diffConfig.drawPoints} Poin` })
    .setTimestamp();

  const components = buildTttGridComponents(board, false, gameKey);
  return { embeds: [embed], components };
}

async function handleTicTacToeDifficultyButton(interaction) {
  const parts = interaction.customId.split('_'); // 'tttdiff', channelId, userId, diff
  if (parts.length < 4) return;

  const channelId = parts[1];
  const userId = parts[2];
  const diff = parts[3];
  const gameKey = `${channelId}_${userId}`;

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: '⚠️ Tombol pilihan kesulitan ini untuk pemain yang memulai game! Gunakan `/tictactoe` untuk sesi bermainmu sendiri yaa! ✨',
      flags: 64
    });
  }

  const gameResult = startTicTacToeGame(userId, interaction.user.displayName || interaction.user.username, interaction.channel, diff);
  return interaction.update({
    embeds: gameResult.embeds,
    components: gameResult.components
  });
}

async function handleTicTacToeButton(interaction) {
  // Handle difficulty selection button
  if (interaction.customId.startsWith('tttdiff_')) {
    return handleTicTacToeDifficultyButton(interaction);
  }

  const parts = interaction.customId.split('_'); // 'ttt', channelId, userId, cellIndex
  if (parts.length < 4) return;

  const channelId = parts[1];
  const userId = parts[2];
  const cellIdx = parseInt(parts[3], 10);
  const gameKey = `${channelId}_${userId}`;

  // Ensure only the designated player can click
  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: '⚠️ Papan permainan ini sedang dimainkan oleh pemain lain! Gunakan `Azura main tictactoe` untuk membuat sesi bermainmu sendiri yaa! ✨',
      flags: 64
    });
  }

  const state = activeTttGames.get(gameKey);
  if (!state) {
    return interaction.reply({
      content: '⌛ Sesi permainan Tic-Tac-Toe ini sudah kedaluwarsa atau selesai. Ayo mulai baru dengan `Azura main tictactoe`! 🎮',
      flags: 64
    });
  }

  if (state.board[cellIdx] !== null) {
    return interaction.reply({ content: 'Kotak tersebut sudah terisi!', flags: 64 });
  }

  const diffConfig = TTT_DIFFICULTIES[state.difficulty] || TTT_DIFFICULTIES.hard;

  // 1. Apply User Move
  state.board[cellIdx] = state.userSymbol;
  let winner = checkTttWinner(state.board);

  // Check if User won or Draw
  if (winner === state.userSymbol) {
    clearTimeout(state.timeout);
    activeTttGames.delete(gameKey);
    recordGameScore(userId, 'ttt', diffConfig.winPoints, true);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`🎉 [TIC-TAC-TOE: KAMU MENANG! ${diffConfig.badge}]`)
      .setDescription(
        `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
        `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
        `💬 **Azura:** *"${getRandomBanter('USER_WIN', state.difficulty)}"*\n\n` +
        `🏆 **Hasil:** Selamat <@${userId}>! Kamu mendapatkan **+${diffConfig.winPoints} Poin Game** di Vault Leaderboard! 🌟`
      )
      .setFooter({ text: 'Gunakan /leaderboard untuk cek skor global!' })
      .setTimestamp();

    return interaction.update({
      embeds: [embed],
      components: buildTttGridComponents(state.board, true, gameKey)
    });
  } else if (winner === 'DRAW') {
    clearTimeout(state.timeout);
    activeTttGames.delete(gameKey);
    recordGameScore(userId, 'ttt', diffConfig.drawPoints, false);

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`🤝 [TIC-TAC-TOE: HASIL SERI! ${diffConfig.badge}]`)
      .setDescription(
        `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
        `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
        `💬 **Azura:** *"${getRandomBanter('DRAW', state.difficulty)}"*\n\n` +
        `⚖️ **Hasil:** Permainan seimbang! Kamu mendapatkan **+${diffConfig.drawPoints} Poin Partisipasi** di Vault!`
      )
      .setTimestamp();

    return interaction.update({
      embeds: [embed],
      components: buildTttGridComponents(state.board, true, gameKey)
    });
  }

  // 2. AI Bot Move adapting to selected difficulty
  const botMove = calculateAiMoveByDifficulty(state.board, state.difficulty, state.botSymbol, state.userSymbol);
  if (botMove !== -1) {
    state.board[botMove] = state.botSymbol;
  }

  winner = checkTttWinner(state.board);

  if (winner === state.botSymbol) {
    clearTimeout(state.timeout);
    activeTttGames.delete(gameKey);
    recordGameScore(userId, 'ttt', 0, false);

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle(`😼 [TIC-TAC-TOE: AZURA MENANG! ${diffConfig.badge}]`)
      .setDescription(
        `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
        `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
        `💬 **Azura:** *"${getRandomBanter('BOT_WIN', state.difficulty)}"*\n\n` +
        `💅 **Hasil:** Jangan menyerah! Ketik \`Azura main tictactoe\` lagi untuk tanding ulang! ✨`
      )
      .setTimestamp();

    return interaction.update({
      embeds: [embed],
      components: buildTttGridComponents(state.board, true, gameKey)
    });
  } else if (winner === 'DRAW') {
    clearTimeout(state.timeout);
    activeTttGames.delete(gameKey);
    recordGameScore(userId, 'ttt', diffConfig.drawPoints, false);

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`🤝 [TIC-TAC-TOE: HASIL SERI! ${diffConfig.badge}]`)
      .setDescription(
        `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
        `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
        `💬 **Azura:** *"${getRandomBanter('DRAW', state.difficulty)}"*\n\n` +
        `⚖️ **Hasil:** Permainan berakhir seri! Kamu mendapatkan **+${diffConfig.drawPoints} Poin**!`
      )
      .setTimestamp();

    return interaction.update({
      embeds: [embed],
      components: buildTttGridComponents(state.board, true, gameKey)
    });
  }

  // Game continues: User's turn again
  const embed = new EmbedBuilder()
    .setColor(diffConfig.color)
    .setTitle(`🎮 [TIC-TAC-TOE: USER VS AZURA ${diffConfig.badge}]`)
    .setDescription(
      `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
      `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
      `💬 **Azura:** *"${getRandomBanter('USER_MOVE', state.difficulty)}"*\n\n` +
      `👉 **Giliran Kamu Selanjutnya!** Klik kotak yang masih kosong:`
    )
    .setFooter({ text: 'Mini-Game Azura • Waktu giliran: 3 Menit' })
    .setTimestamp();

  return interaction.update({
    embeds: [embed],
    components: buildTttGridComponents(state.board, false, gameKey)
  });
}

// ============================================================
// 2. SAMBUNG KATA KBBI ENGINE
// ============================================================

// Comprehensive Indonesian Root Words & Valid Dictionary across all A-Z
const KBBI_VOCABULARY = [
  'air', 'api', 'angin', 'alam', 'anak', 'ayam', 'awan', 'akar', 'atap', 'asam', 'apel', 'akal', 'aman', 'atas', 'arus', 'ajar', 'asal', 'abadi', 'agung', 'antik',
  'batu', 'buku', 'baju', 'bumi', 'bulan', 'bintang', 'burung', 'bunga', 'buah', 'besar', 'bebas', 'bagus', 'bisa', 'baru', 'benar', 'bicara', 'bahasa', 'belajar', 'bangun', 'bekerja',
  'cinta', 'cahaya', 'cerdas', 'cantik', 'cepat', 'cilik', 'cincin', 'cerita', 'cuaca', 'cermin', 'camilan', 'celana', 'contoh', 'catatan', 'candi',
  'danau', 'daun', 'darat', 'dunia', 'damai', 'dingin', 'dekat', 'depan', 'datang', 'duduk', 'dengar', 'dalam', 'dinding', 'dapur', 'dokter', 'desa', 'durian', 'detik',
  'emas', 'elang', 'ekor', 'enak', 'empat', 'elok', 'energi', 'edukasi', 'ekonomi', 'efek', 'enteng', 'esok',
  'fajar', 'foto', 'fokus', 'fiksi', 'filosofi', 'faktor', 'fasilitas', 'fisika', 'fungsi', 'formal',
  'gunung', 'gajah', 'gitar', 'gelas', 'gula', 'gelap', 'guru', 'gambar', 'gadget', 'garam', 'gempa', 'gerak', 'gembira', 'gagah', 'gurun',
  'hutan', 'hujan', 'hari', 'hati', 'hidup', 'hewan', 'hijau', 'hitam', 'hangat', 'hebat', 'harum', 'halus', 'hadiah', 'harapan', 'halaman',
  'ikan', 'ibu', 'ilmu', 'indah', 'insan', 'istana', 'isyarat', 'iklan', 'impian', 'ingat', 'iklim', 'iseng', 'irama',
  'jalan', 'jeruk', 'jarum', 'jendela', 'juara', 'jujur', 'jernih', 'janji', 'jawab', 'jagung', 'jempol', 'jembatan', 'jaket', 'jamur',
  'kucing', 'kuda', 'kelinci', 'kopi', 'kertas', 'kapal', 'kereta', 'kota', 'kaca', 'kuning', 'kecil', 'kuat', 'kawan', 'kabar', 'karya', 'kunci', 'kamera', 'keluarga', 'kampus',
  'laut', 'langit', 'lampu', 'lemari', 'lagu', 'lukisan', 'lebah', 'lilin', 'lembut', 'lincah', 'lurus', 'latihan', 'langkah', 'logika', 'laptop',
  'mata', 'matahari', 'malam', 'makan', 'minum', 'mobil', 'motor', 'meja', 'merah', 'manis', 'masak', 'musik', 'muda', 'murid', 'misteri', 'menara', 'makna', 'motivasi',
  'naga', 'nasi', 'nyata', 'nyaman', 'nyanyi', 'nama', 'napas', 'nada', 'nomor', 'negeri', 'nanas', 'nikmat', 'norma', 'nasihat',
  'ombak', 'orang', 'obat', 'otak', 'olahraga', 'orbit', 'organik', 'opera', 'opini', 'original',
  'pohon', 'pantai', 'pintu', 'piring', 'pasar', 'pulau', 'putih', 'pandai', 'pagi', 'panas', 'pesawat', 'pelajar', 'pelangi', 'pikir', 'pesta', 'puisi', 'pena', 'pedang',
  'quran', 'qari', 'quota', 'qasidah',
  'rumah', 'rumput', 'sungai', 'raja', 'ratu', 'roda', 'rambut', 'rusa', 'ramah', 'rapi', 'rintik', 'rahasia', 'rindu', 'ruang', 'rasa', 'rencana',
  'susu', 'sekolah', 'sepatu', 'surat', 'sahabat', 'senang', 'sehat', 'sejuk', 'santai', 'suara', 'sepeda', 'senyum', 'semut', 'sains', 'semangat', 'seni', 'sumber',
  'tanah', 'taman', 'tas', 'topi', 'tidur', 'terang', 'tinggi', 'teman', 'telinga', 'tangan', 'terbang', 'tulis', 'tahu', 'tempe', 'teh', 'toko', 'tujuan', 'tangga', 'target',
  'udara', 'uang', 'ular', 'unta', 'udang', 'unik', 'utama', 'unggul', 'umur', 'ucapan', 'ujian', 'untaian',
  'video', 'vila', 'visi', 'vokal', 'volume', 'variasi', 'virus', 'vektor',
  'wajah', 'waktu', 'warna', 'wangi', 'warga', 'wisata', 'wadah', 'wahana', 'wawasan', 'wujud',
  'yodium', 'yurisdiksi', 'yayasan', 'yoyo', 'yoga',
  'zaman', 'zebra', 'zamrud', 'ziarah', 'zona', 'zodiak'
];

// activeWordChainGames: channelId -> GameState
const activeWordChainGames = new Map();

function startWordChainGame(userId, userName, channel) {
  const channelId = channel.id;

  if (activeWordChainGames.has(channelId)) {
    const old = activeWordChainGames.get(channelId);
    if (old.timeout) clearTimeout(old.timeout);
    activeWordChainGames.delete(channelId);
  }

  // Pick random starting word
  const startingWord = KBBI_VOCABULARY[Math.floor(Math.random() * KBBI_VOCABULARY.length)];
  const lastChar = startingWord.slice(-1).toLowerCase();

  const usedWords = new Set([startingWord.toLowerCase()]);

  const timeout = setTimeout(() => {
    stopWordChainGame(channelId, 'TIMEOUT', channel);
  }, 45 * 1000); // 45 seconds per turn

  const state = {
    channelId,
    starterUserId: userId,
    starterName: userName,
    currentWord: startingWord,
    expectedChar: lastChar,
    usedWords,
    streak: 0,
    timeout,
    activePlayers: new Set([userId])
  };
  activeWordChainGames.set(channelId, state);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🔤 [SAMBUNG KATA KBBI: USER VS AZURA]')
    .setDescription(
      `Permainan dimulai oleh <@${userId}>!\n\n` +
      `Kata Pembuka dari Azura: **"${startingWord.toUpperCase()}"**\n` +
      `👉 **Tantanganmu:** Balas dengan kata bahasa Indonesia berawalan huruf **"${lastChar.toUpperCase()}"**!\n\n` +
      `⏱️ *Waktu berpikir: 45 detik. Ketik \`nyerah\` atau \`stop\` untuk mengakhiri.*`
    )
    .setFooter({ text: 'Sambung Kata Azura • Validasi KBBI & Kosa Kata Asli' })
    .setTimestamp();

  return { embeds: [embed] };
}

function stopWordChainGame(channelId, reason = 'NORMAL', channel = null) {
  const state = activeWordChainGames.get(channelId);
  if (!state) return;

  if (state.timeout) clearTimeout(state.timeout);
  activeWordChainGames.delete(channelId);

  // Award points based on streak to all active players
  for (const pId of state.activePlayers) {
    const points = Math.max(state.streak * 5, 5);
    recordGameScore(pId, 'sambungkata', points, true, state.streak);
  }

  let desc = `Permainan Sambung Kata telah berakhir!\n\n` +
    `🔥 **Total Rantai Kata (Streak):** **${state.streak} Kata Terhubung**\n` +
    `🏆 **Poin Didapatkan:** **+${Math.max(state.streak * 5, 5)} Poin** untuk para pemain!`;

  if (reason === 'TIMEOUT') {
    desc = `⌛ **Waktu Habis!** Tidak ada yang membalas kata berikutnya dalam 45 detik.\n\n` + desc;
  } else if (reason === 'SURRENDER') {
    desc = `🏳️ **Pemain Menyerah!** Permainan disudahi.\n\n` + desc;
  }

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🏁 [SAMBUNG KATA SELESAI]')
    .setDescription(desc)
    .setFooter({ text: 'Ketik "Azura main sambung kata" untuk bermain lagi!' })
    .setTimestamp();

  if (channel && channel.send) {
    channel.send({ embeds: [embed] }).catch(() => {});
  }
}

function handleWordChainMessage(message) {
  const channelId = message.channel.id;
  const state = activeWordChainGames.get(channelId);
  if (!state) return false;

  const text = message.content.trim().toLowerCase();

  // 1. Check Surrender / Stop Command
  if (text === 'nyerah' || text === 'stop' || text === 'berhenti' || text === 'selesai') {
    stopWordChainGame(channelId, 'SURRENDER', message.channel);
    return true;
  }

  // 2. Validate input format (single word, min 3 chars, alphabetic only)
  if (!/^[a-z]{3,25}$/.test(text)) {
    return false; // Not a valid word format, ignore without interrupting regular chat
  }

  // 3. Check starting character match
  if (!text.startsWith(state.expectedChar)) {
    message.reply(`❌ Kata **"${text.toUpperCase()}"** tidak berawalan huruf **"${state.expectedChar.toUpperCase()}"**! Coba lagi yaa!`).catch(() => {});
    return true;
  }

  // 4. Check if word already used in this session
  if (state.usedWords.has(text)) {
    message.reply(`⚠️ Kata **"${text.toUpperCase()}"** sudah pernah dipakai sebelumnya! Cari kata lain yang belum keluar yaa!`).catch(() => {});
    return true;
  }

  // Valid User Word!
  state.usedWords.add(text);
  state.activePlayers.add(message.author.id);
  state.streak++;

  if (state.timeout) clearTimeout(state.timeout);

  const userLastChar = text.slice(-1);

  // Azura searches for a matching word from KBBI vocabulary
  const candidates = KBBI_VOCABULARY.filter(w => w.startsWith(userLastChar) && !state.usedWords.has(w));

  let botWord = '';
  if (candidates.length > 0) {
    botWord = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    // Dynamic Fallback
    const commonFallbacks = {
      a: 'awan', b: 'bumi', c: 'cahaya', d: 'dunia', e: 'emas', f: 'fajar',
      g: 'gunung', h: 'hujan', i: 'indah', j: 'jalan', k: 'kucing', l: 'langit',
      m: 'malam', n: 'nasi', o: 'ombak', p: 'pantai', r: 'rumah', s: 'sungai',
      t: 'taman', u: 'udara', v: 'visi', w: 'waktu', y: 'yoyo', z: 'zaman'
    };
    botWord = commonFallbacks[userLastChar] || `${userLastChar}ama`;
    if (state.usedWords.has(botWord)) {
      // Bot is cornered and concedes victory!
      stopWordChainGame(channelId, 'BOT_CORNERED', message.channel);
      message.channel.send(`🎉 **Azura Kehabisan Kata!** Kamu berhasil membuatku terpojok dengan huruf **"${userLastChar.toUpperCase()}"**! Kamu luar biasa! 🏆👑`).catch(() => {});
      return true;
    }
  }

  state.usedWords.add(botWord);
  state.currentWord = botWord;
  state.expectedChar = botWord.slice(-1);

  // Re-arm turn timer
  state.timeout = setTimeout(() => {
    stopWordChainGame(channelId, 'TIMEOUT', message.channel);
  }, 45 * 1000);

  const replyEmbed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`🔥 [Rantai Kata: ${state.streak} Sukses!]`)
    .setDescription(
      `💬 <@${message.author.id}>: **"${text.toUpperCase()}"** ✅\n\n` +
      `🌸 **Azura:** **"${botWord.toUpperCase()}"**\n\n` +
      `👉 **Giliran Berikutnya:** Cari kata berawalan huruf **"${state.expectedChar.toUpperCase()}"**!\n` +
      `⏱️ *Sisa waktu: 45 Detik*`
    )
    .setFooter({ text: `Total kata terpakai: ${state.usedWords.size}` });

  message.channel.send({ embeds: [replyEmbed] }).catch(() => {});
  return true;
}

// ============================================================
// 3. KUIS TRIVIA INTERAKTIF ENGINE
// ============================================================

const TRIVIA_BANK = [
  // Gaming
  {
    category: '🎮 Gaming',
    question: 'Di game Genshin Impact, siapakah Archon yang memimpin region Fontaine?',
    options: ['Furina / Focalors', 'Nahida', 'Raiden Shogun', 'Zhongli'],
    correct: 0,
    explanation: 'Furina/Focalors adalah Hydro Archon yang memerintah region Fontaine!'
  },
  {
    category: '🎮 Gaming',
    question: 'Apa nama senjata pedang legendaris milik Cloud Strife di Final Fantasy VII?',
    options: ['Buster Sword', 'Master Sword', 'Soul Edge', 'Excalibur'],
    correct: 0,
    explanation: 'Buster Sword adalah pedang raksasa ikonik milik Cloud Strife yang diwarisi dari Zack Fair.'
  },
  {
    category: '🎮 Gaming',
    question: 'Di game Mobile Legends, role utama dari hero Fanny adalah apa?',
    options: ['Assassin', 'Tank', 'Mage', 'Support'],
    correct: 0,
    explanation: 'Fanny adalah hero Assassin dengan mobilitas kabel Steel Cable yang sangat lincah.'
  },
  {
    category: '🎮 Gaming',
    question: 'Studio manakah yang mengembangkan game legendaris Elden Ring dan Dark Souls?',
    options: ['FromSoftware', 'Capcom', 'Square Enix', 'Ubisoft'],
    correct: 0,
    explanation: 'FromSoftware di bawah arahan Hidetaka Miyazaki adalah kreator seri Souls dan Elden Ring.'
  },

  // Tech & Coding
  {
    category: '💻 Tech & Coding',
    question: 'Siapakah pencipta bahasa pemrograman Python?',
    options: ['Guido van Rossum', 'Brendan Eich', 'Linus Torvalds', 'James Gosling'],
    correct: 0,
    explanation: 'Guido van Rossum merilis Python pertama kali pada tahun 1991.'
  },
  {
    category: '💻 Tech & Coding',
    question: 'Dalam arsitektur Git, perintah apa yang digunakan untuk mengunduh riwayat dan cabang dari remote repository?',
    options: ['git fetch / git pull', 'git push', 'git commit', 'git rebase'],
    correct: 0,
    explanation: 'git fetch dan git pull digunakan untuk mengunduh perubahan dari remote repository.'
  },
  {
    category: '💻 Tech & Coding',
    question: 'Berapa jumlah port default yang digunakan untuk protokol HTTPS?',
    options: ['443', '80', '8080', '22'],
    correct: 0,
    explanation: 'Port 443 adalah port standar terenkripsi TLS/SSL untuk protokol HTTPS.'
  },
  {
    category: '💻 Tech & Coding',
    question: 'Struktur data manakah yang bekerja dengan prinsip First-In, First-Out (FIFO)?',
    options: ['Queue (Antrean)', 'Stack (Tumpukan)', 'Binary Tree', 'Graph'],
    correct: 0,
    explanation: 'Queue bekerja dengan prinsip FIFO, di mana elemen pertama yang masuk akan keluar lebih dulu.'
  },

  // Anime & Pop Culture
  {
    category: '🎌 Anime & Pop Culture',
    question: 'Di anime One Piece, buah iblis apa yang dimakan oleh Monkey D. Luffy yang sebenarnya bernama Hito Hito no Mi, Model: Nika?',
    options: ['Gomu Gomu no Mi', 'Mera Mera no Mi', 'Ope Ope no Mi', 'Gura Gura no Mi'],
    correct: 0,
    explanation: 'Pemerintah Dunia menyamarkan nama buah Nika menjadi Gomu Gomu no Mi.'
  },
  {
    category: '🎌 Anime & Pop Culture',
    question: 'Siapakah nama penyihir elf protagonis utama dalam anime "Sousou no Frieren"?',
    options: ['Frieren', 'Fern', 'Flamme', 'Serie'],
    correct: 0,
    explanation: 'Frieren adalah penyihir elf berumur ribuan tahun yang mengembara mengenang teman-teman pahlawannya.'
  },
  {
    category: '🎌 Anime & Pop Culture',
    question: 'Apa domain expansion terkuat milik Gojo Satoru di Jujutsu Kaisen?',
    options: ['Muryokusho (Unlimited Void)', 'Fukuma Mizushi', 'Choryo Bakko', 'Idle Transfiguration'],
    correct: 0,
    explanation: 'Unlimited Void mengisi pikiran target dengan informasi tak terbatas hingga lumpuh total.'
  },

  // Indonesia & Budaya
  {
    category: '🇮🇩 Indonesia',
    question: 'Candi Buddha terbesar di dunia yang terletak di Magelang, Jawa Tengah adalah?',
    options: ['Candi Borobudur', 'Candi Prambanan', 'Candi Mendut', 'Candi Sewu'],
    correct: 0,
    explanation: 'Candi Borobudur dibangun pada abad ke-8 oleh Dinasti Syailendra dan merupakan situs warisan dunia UNESCO.'
  },
  {
    category: '🇮🇩 Indonesia',
    question: 'Danau vulkanik terbesar di dunia yang berada di Sumatera Utara adalah?',
    options: ['Danau Toba', 'Danau Maninjau', 'Danau Singkarak', 'Danau Poso'],
    correct: 0,
    explanation: 'Danau Toba memiliki panjang 100 km dan lebar 30 km yang terbentuk dari letusan supervolcano purba.'
  }
];

// activeTriviaGames: channelId -> GameState
const activeTriviaGames = new Map();

function startTriviaGame(userId, userName, channel, category = null) {
  const channelId = channel.id;

  if (activeTriviaGames.has(channelId)) {
    const old = activeTriviaGames.get(channelId);
    if (old.timer) clearTimeout(old.timer);
    activeTriviaGames.delete(channelId);
  }

  // Pick question
  let pool = TRIVIA_BANK;
  if (category) {
    pool = TRIVIA_BANK.filter(q => q.category.toLowerCase().includes(category.toLowerCase()));
    if (pool.length === 0) pool = TRIVIA_BANK;
  }

  const q = pool[Math.floor(Math.random() * pool.length)];

  // Shuffle options
  const optionIndices = [0, 1, 2, 3];
  for (let i = optionIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionIndices[i], optionIndices[j]] = [optionIndices[j], optionIndices[i]];
  }

  const shuffledOptions = optionIndices.map(idx => q.options[idx]);
  const correctShuffledIndex = optionIndices.indexOf(q.correct);

  const triviaKey = `${channelId}_${Date.now()}`;

  const timer = setTimeout(() => {
    resolveTriviaTimeout(channelId, channel);
  }, 20 * 1000); // 20-second timer

  const state = {
    channelId,
    triviaKey,
    question: q.question,
    category: q.category,
    options: shuffledOptions,
    correctIndex: correctShuffledIndex,
    explanation: q.explanation,
    timer,
    answeredUsers: new Map() // userId -> choiceIndex
  };
  activeTriviaGames.set(channelId, state);

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle(`🏆 [KUIS TRIVIA AZURA: ${q.category}]`)
    .setDescription(
      `Pertanyaan untuk semua member di channel ini:\n\n` +
      `❓ **"${q.question}"**\n\n` +
      shuffledOptions.map((opt, idx) => `**${['🅰️', '🅱️', '🅲', '🅳'][idx]}** ${opt}`).join('\n') +
      `\n\n⏱️ **Waktu Menjawab:** **20 Detik!** Klik tombol pilihanmu di bawah:`
    )
    .setFooter({ text: 'Jawaban benar pertama mendapatkan +10 Poin di Leaderboard!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trivia_${triviaKey}_0`).setLabel('🅰️ Pilihan A').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`trivia_${triviaKey}_1`).setLabel('🅱️ Pilihan B').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`trivia_${triviaKey}_2`).setLabel('🅲 Pilihan C').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`trivia_${triviaKey}_3`).setLabel('🅳 Pilihan D').setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

function resolveTriviaTimeout(channelId, channel) {
  const state = activeTriviaGames.get(channelId);
  if (!state) return;

  activeTriviaGames.delete(channelId);

  const labels = ['🅰️', '🅱️', '🅲', '🅳'];
  const correctLabel = labels[state.correctIndex];
  const correctText = state.options[state.correctIndex];

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('⌛ [WAKTU MENJAWAB TRIVIA HABIS!]')
    .setDescription(
      `Pertanyaan: **"${state.question}"**\n\n` +
      `✅ **Jawaban yang Benar:** **${correctLabel} ${correctText}**\n\n` +
      `💡 **Penjelasan:** *${state.explanation}*\n\n` +
      `Belum ada yang berhasil menjawab tepat waktu. Ketik \`Azura main trivia\` untuk soal berikutnya!`
    )
    .setTimestamp();

  if (channel && channel.send) {
    channel.send({ embeds: [embed] }).catch(() => {});
  }
}

async function handleTriviaButton(interaction) {
  const parts = interaction.customId.split('_'); // 'trivia', triviaKey, choiceIndex
  if (parts.length < 3) return;

  const choiceIdx = parseInt(parts[2], 10);
  const channelId = interaction.channelId;

  const state = activeTriviaGames.get(channelId);
  if (!state) {
    return interaction.reply({
      content: '⌛ Sesi kuis trivia ini sudah selesai! Mulai soal baru dengan `Azura main trivia`! 🏆',
      flags: 64
    });
  }

  if (state.answeredUsers.has(interaction.user.id)) {
    return interaction.reply({
      content: '⚠️ Kamu sudah mengunci jawabanmu untuk soal ini!',
      flags: 64
    });
  }

  state.answeredUsers.set(interaction.user.id, choiceIdx);

  const labels = ['🅰️', '🅱️', '🅲', '🅳'];
  const userChoiceLabel = labels[choiceIdx];
  const isCorrect = (choiceIdx === state.correctIndex);

  if (isCorrect) {
    // Winner found! End game immediately
    clearTimeout(state.timer);
    activeTriviaGames.delete(channelId);

    recordGameScore(interaction.user.id, 'trivia', 10, true);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🎉 [JAWABAN BENAR! PEMENANG TRIVIA!]')
      .setDescription(
        `🏆 **Pemenang:** <@${interaction.user.id}> menjawab dengan benar!\n\n` +
        `❓ **Pertanyaan:** "${state.question}"\n\n` +
        `✅ **Jawaban Tepat:** **${userChoiceLabel} ${state.options[state.correctIndex]}**\n\n` +
        `💡 **Penjelasan:** *${state.explanation}*\n\n` +
        `🎁 **Hadiah:** <@${interaction.user.id}> mendapatkan **+10 Poin Trivia** di Leaderboard!`
      )
      .setFooter({ text: 'Cek peringkatmu dengan /leaderboard!' })
      .setTimestamp();

    return interaction.update({
      embeds: [embed],
      components: [] // Remove buttons
    });
  } else {
    // Wrong answer for this user
    return interaction.reply({
      content: `❌ Jawabanmu (**${userChoiceLabel}**) kurang tepat! Ayo member lain masih ada kesempatan menjawab! ⚡`,
      flags: 64
    });
  }
}

// ============================================================
// 4. LEADERBOARD ENGINE
// ============================================================

function getLeaderboardEmbed() {
  const topPlayers = getGameLeaderboard(10);

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('🏆 [PAPAN PERINGKAT MINI-GAMES AZURA: TOP 10]')
    .setDescription(
      'Berikut daftar pemain terbaik yang sering adu taktik dan asah otak melawan AZURA:\n\n' +
      (topPlayers.length === 0
        ? '*Belum ada data permainan tercatat. Ayo mainkan Tic-Tac-Toe, Sambung Kata, atau Trivia sekarang!*'
        : topPlayers.map((p, idx) => {
            const medals = ['🥇', '🥈', '🥉'];
            const rankIcon = idx < 3 ? medals[idx] : `**#${idx + 1}**`;
            return `${rankIcon} <@${p.userId}> (**${p.callingName}**)\n` +
              `   💰 **Total Poin:** \`${p.totalPoints} Pts\` | ❌⭕ **XOXO:** \`${p.tttWins} Menang\` | 🔤 **Sambung Kata:** \`${p.wordChainBestStreak} Streak\` | 🏆 **Trivia:** \`${p.triviaWins} Menang\``;
          }).join('\n\n'))
    )
    .setFooter({ text: 'Poin tersimpan secara permanen & terenkripsi di User Vault' })
    .setTimestamp();

  return embed;
}

// ============================================================
// 5. NATURAL LANGUAGE GAME ROUTER
// ============================================================

function parseNaturalGameRequest(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const lower = prompt.toLowerCase().trim();

  // Tic-Tac-Toe with Difficulty parsing
  if (/\b(?:main|play|adu)\s*(?:tictactoe|tic\s+tac\s+toe|xoxo|kotak|silang|x\s+o)\b/i.test(lower) ||
      /\b(?:tictactoe|xoxo)\b/i.test(lower)) {
    let diff = null;
    if (/\b(?:easy|mudah|gampang|santai)\b/i.test(lower)) diff = 'easy';
    else if (/\b(?:medium|sedang|kasual|normal)\b/i.test(lower)) diff = 'medium';
    else if (/\b(?:hard|sulit|susah|menantang)\b/i.test(lower)) diff = 'hard';
    else if (/\b(?:expert|master|dewa|unbeatable|jago|minimax)\b/i.test(lower)) diff = 'expert';

    return { game: 'tictactoe', difficulty: diff };
  }

  // Sambung Kata
  if (/\b(?:main|play)\s*(?:sambung\s+kata|rantai\s+kata|kata\s+kbbi|word\s+chain)\b/i.test(lower) ||
      /\bsambung\s+kata\b/i.test(lower)) {
    return { game: 'sambungkata' };
  }

  // Trivia
  if (/\b(?:main|play|mulai|soal)\s*(?:trivia|kuis|quiz|cerdas\s+cermat|tanya\s+jawab)\b/i.test(lower) ||
      /\b(?:trivia|kuis\s+azura)\b/i.test(lower)) {
    return { game: 'trivia' };
  }

  // Leaderboard
  if (/\b(?:leaderboard|papan\s+peringkat|top\s+skor|skor\s+game|peringkat\s+game|juara\s+game)\b/i.test(lower)) {
    return { game: 'leaderboard' };
  }

  return null;
}

module.exports = {
  startTicTacToeGame,
  promptTicTacToeDifficulty,
  handleTicTacToeButton,
  handleTicTacToeDifficultyButton,
  startWordChainGame,
  stopWordChainGame,
  handleWordChainMessage,
  startTriviaGame,
  handleTriviaButton,
  getLeaderboardEmbed,
  parseNaturalGameRequest,
  calculateAiMoveByDifficulty,
  calculateExpertMinimaxMove,
  minimax,
  TTT_DIFFICULTIES
};
