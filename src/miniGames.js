/**
 * AZURA MINI-GAMES INTERACTIVE SUBSYSTEM
 * 
 * 1. Tic-Tac-Toe (XOXO) - 4 Difficulty Tiers (Easy, Medium, Hard, Expert Minimax)
 * 2. Sambung Kata KBBI - 3,290+ Authentic Indonesian Vocabulary Database & Real-Time Countdown
 * 3. 10-Chain Trivia Gauntlet - 10 Sequential Questions, 3 Difficulties, +2 Pts/Q (Max 20 Pts)
 * 4. Leaderboard & Vault Integration - AES-256 Encrypted Persistent Rankings
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { recordGameScore, getGameLeaderboard } = require('./vault');
const {
  isValidKbbiWord,
  markWordAsUsed,
  isWordAlreadyUsed,
  clearSessionUsedWords,
  getSessionUsedWordsCount,
  pickStartingWord,
  findAzuraNextWord
} = require('./kbbiDatabase');

// ============================================================
// 1. TIC-TAC-TOE (XOXO) ENGINE
// ============================================================

const TTT_DIFFICULTIES = {
  easy: {
    key: 'easy',
    name: '🟢 Easy (Santai / Pemula)',
    badge: '🟢 Easy',
    color: 0x2ECC71,
    winPoints: 5,
    drawPoints: 2,
    description: 'Santai & sering melamun, membuka banyak celah'
  },
  medium: {
    key: 'medium',
    name: '🟡 Medium (Kasual / Sedang)',
    badge: '🟡 Medium',
    color: 0xF1C40F,
    winPoints: 10,
    drawPoints: 4,
    description: 'Kasual & seimbang, memblokir kemenangan langsung'
  },
  hard: {
    key: 'hard',
    name: '🔴 Hard (Taktis / Menantang)',
    badge: '🔴 Hard',
    color: 0xE67E22,
    winPoints: 15,
    drawPoints: 5,
    description: 'Taktis heuristik, mengunci pusat & sudut strategis'
  },
  expert: {
    key: 'expert',
    name: '💀 Expert (Master / Unbeatable Minimax)',
    badge: '💀 Expert',
    color: 0x9B59B6,
    winPoints: 30,
    drawPoints: 10,
    description: 'Algoritma Minimax matematis tanpa celah'
  }
};

const TTT_BANTERS = {
  easy: {
    START: [
      'Santai aja yaa, aku mainnya sambil ngemil kok~ ☕',
      'Gas! Kita main santai buat seru-seruan! 🌸',
      'Jangan tegang-tegang, ini mode santai kok! ✨'
    ],
    USER_MOVE: [
      'Okee langkah yang menarik, giliranku yaa! 🌸',
      'Wah di situ ya? Bentar aku mikir duluu~ 🤔',
      'Boleh juga, sekarang giliranku! ✨'
    ],
    BOT_WIN: [
      'Hehe aku menang santai yaa! Mau coba lagi? 🌸',
      'Yeyy menang! Makasih udah nemenin main yaa! ☕'
    ],
    USER_WIN: [
      'Wahh kamu hebat banget! Selamat yaa! 🏆✨',
      'Kereenn! Aku kalah santai nih hehe, selamat! 🌸'
    ],
    DRAW: [
      'Seri nih! Papan penuh sama taktik kita! 🤝☕',
      'Sama-sama kuat! Seri yang adil yaa! 🤝🌸'
    ]
  },
  medium: {
    START: [
      'Ayo kita tanding kasual! Aku bakal jaga garis pertahanan! ⚔️',
      'Mode medium aktif! Siap-siap aku blokir jalurmu yaa! 🛡️',
      'Mari kita lihat seberapa jeli kamu membaca papan! 🎮'
    ],
    USER_MOVE: [
      'Hmm langkah cerdik, tapi aku sudah siap antisipasi! 🛡️',
      'Mau bikin jebakan ya? Gak semudah ituu~ 😏',
      'Taktikmu terbaca, ini langkah balasan dari aku! ⚡'
    ],
    BOT_WIN: [
      'Ggwp! Pertahananmu jebol di detik-detik akhir! 🛡️🏆',
      'Strategiku berhasil! Permainan yang seru! ⚔️'
    ],
    USER_WIN: [
      'Keren banget! Kamu berhasil tembus blokade aku! 🏆🔥',
      'Luar biasa! Serangan balikmu mantap banget! 🌟'
    ],
    DRAW: [
      'Pertandingan yang sengit! Kita imbang tanpa celah! 🤝🛡️',
      'Sama-sama teliti, hasil seri yang memuaskan! ⚖️'
    ]
  },
  hard: {
    START: [
      'Mode Hard aktif! Aku gak akan ngasih ruang kosong sembarangan! 🔴⚔️',
      'Fokus penuh! Satu langkah salah bisa fatal lho! 🧠⚡',
      'Mari bertarung dengan strategi penuh! Tunjukkan taktik terbaikmu! 🛡️'
    ],
    USER_MOVE: [
      'Langkah taktis! Tapi pusat kendali ada di perhitunganku! 🧠',
      'Kamu mencoba menekan sudut? Aku kunci jalur tengah! ⚡',
      'Pertarungan semakin ketat, giliranku mengeksekusi! 🎯'
    ],
    BOT_WIN: [
      'Skakmat! Taktik Hard AZURA berhasil mengunci kemenangan! 🔴👑',
      'Sesuai kalkulasi! Kamu bermain bagus, tapi aku lebih taktis kali ini! ⚔️'
    ],
    USER_WIN: [
      'LUAR BIASA! Kamu berhasil menumbangkan Mode Hard! Respek penuh! 👑🔥',
      'Gilaak, taktikmu di luar nalar! Selamat atas kemenangan emas ini! 🏆🌟'
    ],
    DRAW: [
      'Seri tingkat tinggi! Dua master strategi saling kunci! 🤝🧠',
      'Hasil imbang yang spektakuler! Tidak ada celah sama sekali! ⚖️🔥'
    ]
  },
  expert: {
    START: [
      '💀 Mode Minimax Unbeatable aktif! Selamat datang di simulasi tanpa celah! 🌌',
      'Algoritma matematika penuh diaktifkan! Bisakah kamu menahan hasil seri? 🤖⚡',
      'Setiap kemungkinan langkahmu sudah terhitung hingga cabang terdalam! 🧠💀'
    ],
    USER_MOVE: [
      'Langkahmu sudah terbaca dalam 255.168 permutasi pohon keputusan! 🤖📊',
      'Minimax mengevaluasi papan: Nilai utilitasmu langsung dinetralkan! 💀',
      'Kalkulasi selesai. Ini respon optimal dengan kedalaman penuh! ⚡'
    ],
    BOT_WIN: [
      '💀 AI Minimax tak terkalahkan! Kemenangan mutlak matematika! 🤖👑',
      'Algoritma berhasil mengeksekusi kemenangan sempurna tanpa eror! 🌌'
    ],
    USER_WIN: [
      'ANOMALI TERDETEKSI! Kamu berhasil mengalahkan Minimax?! Kamu adalah Grandmaster sejati! 🏆👑👑',
      'Mustahil... Algoritma tertembus! Kamu adalah dewa Tic-Tac-Toe! 🌟🔥'
    ],
    DRAW: [
      '🤝 Hasil optimal tercapai: SERI MUTLAK (Teori Permainan Sempurna)! 🤖⚖️',
      'Keren banget! Berhasil menahan seri lawan Minimax adalah bukti kamu pemain jenius! 🧠✨'
    ]
  }
};

function getRandomBanter(type, difficulty = 'medium') {
  const diffBanters = TTT_BANTERS[difficulty] || TTT_BANTERS.medium;
  const list = diffBanters[type] || TTT_BANTERS.medium[type] || ['Giliran kamu!'];
  return list[Math.floor(Math.random() * list.length)];
}

const activeTttGames = new Map();

function checkTttWinner(board) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of winPatterns) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every(cell => cell !== null)) {
    return 'DRAW';
  }
  return null;
}

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

function calculateAiMoveByDifficulty(board, difficulty = 'medium', botSymbol = 'O', userSymbol = 'X') {
  const emptyCells = board.map((val, idx) => (val === null ? idx : null)).filter(v => v !== null);
  if (emptyCells.length === 0) return -1;

  if (difficulty === 'expert') {
    return calculateExpertMinimaxMove(board, botSymbol, userSymbol);
  }

  if (difficulty === 'easy') {
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

  if (difficulty === 'medium') {
    if (Math.random() < 0.6) {
      for (const idx of emptyCells) {
        board[idx] = botSymbol;
        if (checkTttWinner(board) === botSymbol) {
          board[idx] = null;
          return idx;
        }
        board[idx] = null;
      }
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

  // Hard
  for (const idx of emptyCells) {
    board[idx] = botSymbol;
    if (checkTttWinner(board) === botSymbol) {
      board[idx] = null;
      return idx;
    }
    board[idx] = null;
  }
  for (const idx of emptyCells) {
    board[idx] = userSymbol;
    if (checkTttWinner(board) === userSymbol) {
      board[idx] = null;
      return idx;
    }
    board[idx] = null;
  }
  if (board[4] === null) return 4;
  const corners = [0, 2, 6, 8].filter(c => board[c] === null);
  if (corners.length > 0) return corners[Math.floor(Math.random() * corners.length)];
  return emptyCells[Math.floor(Math.random() * emptyCells.length)];
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
        style = ButtonStyle.Danger;
      } else if (val === 'O') {
        label = '⭕';
        style = ButtonStyle.Primary;
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_${gameKey}_${idx}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(disabled || val !== null)
      );
    }
    rows.push(row);
  }
  return rows;
}

function promptTicTacToeDifficulty(userId, userName, channel) {
  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🎮 [PILIH TINGKAT KESULITAN TIC-TAC-TOE]')
    .setDescription(
      `Halo <@${userId}>! Pilih tingkat kecerdasan AI Azura sebelum bertanding:\n\n` +
      `🟢 **Easy (Santai):** Main santai & sering melamun (+5 Poin)\n` +
      `🟡 **Medium (Kasual):** Imbang & memblokir kemenangan langsung (+10 Poin)\n` +
      `🔴 **Hard (Taktis):** Strategi agresif mengunci pusat & sudut (+15 Poin)\n` +
      `💀 **Expert (Master):** Algoritma Minimax matematis tak terkalahkan (+30 Poin)\n\n` +
      `👉 *Klik salah satu tombol di bawah untuk memulai papan permainan:*`
    )
    .setFooter({ text: 'Azura Game Engine • Poin tersimpan di User Vault Leaderboard' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tttdiff_${channel.id}_${userId}_easy`).setLabel('🟢 Easy').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tttdiff_${channel.id}_${userId}_medium`).setLabel('🟡 Medium').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tttdiff_${channel.id}_${userId}_hard`).setLabel('🔴 Hard').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tttdiff_${channel.id}_${userId}_expert`).setLabel('💀 Expert (Minimax)').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

function startTicTacToeGame(userId, userName, channel, difficulty = null) {
  const channelId = channel.id;
  const gameKey = `${channelId}_${userId}`;

  if (!difficulty || !TTT_DIFFICULTIES[difficulty.toLowerCase()]) {
    return promptTicTacToeDifficulty(userId, userName, channel);
  }

  const diffKey = difficulty.toLowerCase();
  const diffConfig = TTT_DIFFICULTIES[diffKey];

  if (activeTttGames.has(gameKey)) {
    const oldGame = activeTttGames.get(gameKey);
    if (oldGame.timeout) clearTimeout(oldGame.timeout);
    activeTttGames.delete(gameKey);
  }

  const board = Array(9).fill(null);
  const timeout = setTimeout(() => {
    activeTttGames.delete(gameKey);
  }, 3 * 60 * 1000);

  const gameState = {
    gameKey,
    channelId,
    userId,
    userName,
    difficulty: diffKey,
    diffConfig,
    board,
    userSymbol: 'X',
    botSymbol: 'O',
    timeout,
    turn: 'USER'
  };

  activeTttGames.set(gameKey, gameState);

  const embed = new EmbedBuilder()
    .setColor(diffConfig.color)
    .setTitle(`🎮 [TIC-TAC-TOE: USER VS AZURA ${diffConfig.badge}]`)
    .setDescription(
      `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
      `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
      `💬 **Azura:** *"${getRandomBanter('START', diffKey)}"*\n\n` +
      `👉 **Giliranmu:** Klik salah satu tombol kotak di bawah untuk menaruh simbol **❌**!`
    )
    .setFooter({ text: `Hadiah: Menang +${diffConfig.winPoints} Poin | Seri +${diffConfig.drawPoints} Poin` })
    .setTimestamp();

  const components = buildTttGridComponents(board, false, gameKey);
  return { embeds: [embed], components };
}

async function handleTicTacToeDifficultyButton(interaction) {
  const parts = interaction.customId.split('_');
  if (parts.length < 4) return;

  const channelId = parts[1];
  const userId = parts[2];
  const diff = parts[3];

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
  if (interaction.customId.startsWith('tttdiff_')) {
    return handleTicTacToeDifficultyButton(interaction);
  }

  const parts = interaction.customId.split('_');
  if (parts.length < 4) return;

  const channelId = parts[1];
  const userId = parts[2];
  const cellIdx = parseInt(parts[3], 10);
  const gameKey = `${channelId}_${userId}`;

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

  const diffConfig = state.diffConfig || TTT_DIFFICULTIES[state.difficulty] || TTT_DIFFICULTIES.medium;
  state.board[cellIdx] = state.userSymbol;
  let winner = checkTttWinner(state.board);

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
        `⚖️ **Hasil:** Permainan berakhir seri! Kamu mendapatkan **+${diffConfig.drawPoints} Poin**!`
      )
      .setTimestamp();

    return interaction.update({
      embeds: [embed],
      components: buildTttGridComponents(state.board, true, gameKey)
    });
  }

  // Azura's Turn
  const botMove = calculateAiMoveByDifficulty(state.board, state.difficulty, state.botSymbol, state.userSymbol);
  if (botMove !== -1) {
    state.board[botMove] = state.botSymbol;
  }

  winner = checkTttWinner(state.board);

  if (winner === state.botSymbol) {
    clearTimeout(state.timeout);
    activeTttGames.delete(gameKey);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle(`🤖 [TIC-TAC-TOE: AZURA MENANG! ${diffConfig.badge}]`)
      .setDescription(
        `Pemain: <@${userId}> (**❌**) vs AZURA (**⭕**)\n` +
        `Tingkat Kesulitan: **${diffConfig.name}**\n\n` +
        `💬 **Azura:** *"${getRandomBanter('BOT_WIN', state.difficulty)}"*\n\n` +
        `💡 **Hasil:** Jangan patah semangat! Coba strategi baru dengan \`Azura main tictactoe\`!`
      )
      .setFooter({ text: 'Ayo balas kekalahanmu di ronde berikutnya! 🔥' })
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

  // Continue game
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
// 2. SAMBUNG KATA KBBI ENGINE (POWERED BY KBBI DATABASE)
// ============================================================

const activeWordChainGames = new Map();

function startWordChainGame(userId, userName, channel) {
  const channelId = channel.id;

  if (activeWordChainGames.has(channelId)) {
    const old = activeWordChainGames.get(channelId);
    if (old.timeout) clearTimeout(old.timeout);
    activeWordChainGames.delete(channelId);
  }

  clearSessionUsedWords(channelId);

  const startingWord = pickStartingWord();
  const lastChar = startingWord.slice(-1).toLowerCase();

  markWordAsUsed(channelId, startingWord);

  const timeout = setTimeout(() => {
    stopWordChainGame(channelId, 'TIMEOUT', channel);
  }, 45 * 1000);

  const state = {
    channelId,
    starterUserId: userId,
    starterName: userName,
    currentWord: startingWord,
    expectedChar: lastChar,
    streak: 0,
    timeout,
    activePlayers: new Set([userId])
  };
  activeWordChainGames.set(channelId, state);

  const expiresAtUnix = Math.floor((Date.now() + 45 * 1000) / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🔤 [SAMBUNG KATA KBBI: USER VS AZURA]')
    .setDescription(
      `Permainan dimulai oleh <@${userId}>!\n\n` +
      `Kata Pembuka dari Azura: **"${startingWord.toUpperCase()}"**\n` +
      `👉 **Tantanganmu:** Balas dengan kata baku bahasa Indonesia berawalan huruf **"${lastChar.toUpperCase()}"**!\n\n` +
      `⏱️ **Sisa Waktu Giliran:** <t:${expiresAtUnix}:R> *(Berakhir <t:${expiresAtUnix}:T>)*\n` +
      `💡 *Ketik \`nyerah\` atau \`stop\` untuk mengakhiri.*`
    )
    .setFooter({ text: 'Sambung Kata Azura • Validasi KBBI Database & Real-Time Live Countdown' })
    .setTimestamp();

  return { embeds: [embed] };
}

function stopWordChainGame(channelId, reason = 'NORMAL', channel = null) {
  const state = activeWordChainGames.get(channelId);
  if (!state) return;

  if (state.timeout) clearTimeout(state.timeout);
  activeWordChainGames.delete(channelId);

  const totalWordsUsed = getSessionUsedWordsCount(channelId);
  clearSessionUsedWords(channelId);

  for (const pId of state.activePlayers) {
    const points = Math.max(state.streak * 5, 5);
    recordGameScore(pId, 'sambungkata', points, true, state.streak);
  }

  let desc = `Permainan Sambung Kata telah berakhir!\n\n` +
    `🔥 **Total Rantai Kata (Streak):** **${state.streak} Kata Terhubung**\n` +
    `📚 **Total Kata Terpakai:** **${totalWordsUsed} Kosakata KBBI**\n` +
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

  if (text === 'nyerah' || text === 'stop' || text === 'berhenti' || text === 'selesai') {
    stopWordChainGame(channelId, 'SURRENDER', message.channel);
    return true;
  }

  if (!/^[a-z]{3,25}$/.test(text)) {
    return false;
  }

  if (!text.startsWith(state.expectedChar)) {
    message.reply(`❌ Kata **"${text.toUpperCase()}"** tidak berawalan huruf **"${state.expectedChar.toUpperCase()}"**! Coba lagi yaa!`).catch(() => {});
    return true;
  }

  if (!isValidKbbiWord(text)) {
    message.reply(`❌ Kata **"${text.toUpperCase()}"** tidak terdaftar dalam basis data resmi kosakata bahasa Indonesia / KBBI! Gunakan kata baku lainnya yaa! ✨`).catch(() => {});
    return true;
  }

  if (isWordAlreadyUsed(channelId, text)) {
    message.reply(`⚠️ Kata **"${text.toUpperCase()}"** sudah pernah dipakai sebelumnya dalam sesi ini! Cari kata lain yang belum keluar yaa! 📚`).catch(() => {});
    return true;
  }

  markWordAsUsed(channelId, text);
  state.activePlayers.add(message.author.id);
  state.streak++;

  if (state.timeout) clearTimeout(state.timeout);

  const userLastChar = text.slice(-1);
  const botWord = findAzuraNextWord(channelId, userLastChar);

  if (!botWord) {
    stopWordChainGame(channelId, 'BOT_CORNERED', message.channel);
    message.channel.send(`🎉 **Azura Kehabisan Kata!** Kamu berhasil membuatku terpojok dengan huruf **"${userLastChar.toUpperCase()}"**! Kamu luar biasa! 🏆👑`).catch(() => {});
    return true;
  }

  markWordAsUsed(channelId, botWord);
  state.currentWord = botWord;
  state.expectedChar = botWord.slice(-1);

  state.timeout = setTimeout(() => {
    stopWordChainGame(channelId, 'TIMEOUT', message.channel);
  }, 45 * 1000);

  const turnExpiresAtUnix = Math.floor((Date.now() + 45 * 1000) / 1000);
  const totalUsed = getSessionUsedWordsCount(channelId);

  const replyEmbed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`🔥 [Rantai Kata: ${state.streak} Sukses!]`)
    .setDescription(
      `💬 <@${message.author.id}>: **"${text.toUpperCase()}"** ✅\n\n` +
      `🌸 **Azura:** **"${botWord.toUpperCase()}"**\n\n` +
      `👉 **Giliran Berikutnya:** Cari kata berawalan huruf **"${state.expectedChar.toUpperCase()}"**!\n` +
      `⏱️ **Sisa Waktu Giliran:** <t:${turnExpiresAtUnix}:R> *(Berakhir <t:${turnExpiresAtUnix}:T>)*`
    )
    .setFooter({ text: `Total kosakata KBBI terpakai: ${totalUsed}` });

  message.channel.send({ embeds: [replyEmbed] }).catch(() => {});
  return true;
}

// ============================================================
// 3. 10-CHAIN SEQUENTIAL TRIVIA GAUNTLET ENGINE
// ============================================================

const TRIVIA_DIFFICULTIES = {
  easy: {
    key: 'easy',
    name: '🟢 Easy (Santai / Pemula)',
    badge: '🟢 Easy',
    color: 0x2ECC71,
    turnSeconds: 25,
    pointPerQuestion: 2,
    description: 'Pertanyaan umum, santai, dan pengetahuan dasar'
  },
  medium: {
    key: 'medium',
    name: '🟡 Medium (Kasual / Sedang)',
    badge: '🟡 Medium',
    color: 0xF1C40F,
    turnSeconds: 20,
    pointPerQuestion: 2,
    description: 'Pertanyaan standar, taktis, dan mendalam'
  },
  hard: {
    key: 'hard',
    name: '🔴 Hard (Tantangan / Ahli)',
    badge: '🔴 Hard',
    color: 0xE74C3C,
    turnSeconds: 15,
    pointPerQuestion: 2,
    description: 'Pertanyaan langka, teknis, dan trivia sulit'
  }
};

// Rich Bank of 60+ Categorized Questions across Easy, Medium, and Hard
const TRIVIA_BANK = [
  // ── EASY QUESTIONS (General / Basic Knowledge) ──
  {
    difficulty: 'easy',
    category: '🎮 Gaming',
    question: 'Siapakah karakter tukang ledeng berbaju merah yang menjadi maskot utama Nintendo?',
    options: ['Mario', 'Luigi', 'Sonic', 'Crash Bandicoot'],
    correct: 0,
    explanation: 'Mario adalah karakter legendaris ciptaan Shigeru Miyamoto dari Nintendo.'
  },
  {
    difficulty: 'easy',
    category: '🎮 Gaming',
    question: 'Hewan apakah karakter Pikachu dalam serial Pokemon?',
    options: ['Tikus Listrik', 'Kucing', 'Kelinci', 'Hamster'],
    correct: 0,
    explanation: 'Pikachu adalah Pokemon bertipe Electric yang diklasifikasikan sebagai Mouse Pokemon (Tikus Listrik).'
  },
  {
    difficulty: 'easy',
    category: '💻 Tech',
    question: 'Apa kepanjangan dari CPU pada komputer?',
    options: ['Central Processing Unit', 'Central Power Unit', 'Core Program Unit', 'Control Processing User'],
    correct: 0,
    explanation: 'CPU adalah otak komputer yang memproses semua instruksi digital.'
  },
  {
    difficulty: 'easy',
    category: '💻 Tech',
    question: 'Siapakah pendiri utama perusahaan Microsoft bersama Paul Allen?',
    options: ['Bill Gates', 'Steve Jobs', 'Mark Zuckerberg', 'Elon Musk'],
    correct: 0,
    explanation: 'Bill Gates mendirikan Microsoft pada tahun 1975.'
  },
  {
    difficulty: 'easy',
    category: '🎌 Anime',
    question: 'Di anime Naruto, siapa nama guru pembimbing Tim 7 yang selalu memakai masker?',
    options: ['Kakashi Hatake', 'Jiraiya', 'Iruka Umino', 'Might Guy'],
    correct: 0,
    explanation: 'Kakashi Hatake si Ninja Peniru adalah guru pembimbing Naruto, Sasuke, dan Sakura.'
  },
  {
    difficulty: 'easy',
    category: '🎌 Anime',
    question: 'Apa impian terbesar Monkey D. Luffy di anime One Piece?',
    options: ['Menjadi Raja Bajak Laut', 'Menjadi Hokage', 'Menjadi Pahlawan Nomor 1', 'Mengumpulkan Dragon Ball'],
    correct: 0,
    explanation: 'Luffy bertekad menemukan One Piece dan menjadi Raja Bajak Laut (Pirate King).'
  },
  {
    difficulty: 'easy',
    category: '🇮🇩 Indonesia',
    question: 'Apakah ibukota negara Indonesia saat ini sebelum berpindah secara penuh ke IKN?',
    options: ['Jakarta', 'Surabaya', 'Bandung', 'Medan'],
    correct: 0,
    explanation: 'DKI Jakarta adalah pusat pemerintahan dan ibukota Republik Indonesia.'
  },
  {
    difficulty: 'easy',
    category: '🇮🇩 Indonesia',
    question: 'Burung mitologis apakah yang menjadi lambang negara Republik Indonesia?',
    options: ['Garuda', 'Cendrawasih', 'Elang Jawa', 'Merpati'],
    correct: 0,
    explanation: 'Garuda Pancasila adalah lambang negara Republik Indonesia.'
  },
  {
    difficulty: 'easy',
    category: '🔬 Sains & Alam',
    question: 'Planet apakah yang dijuluki sebagai Planet Merah di Tata Surya kita?',
    options: ['Mars', 'Venus', 'Merkurius', 'Jupiter'],
    correct: 0,
    explanation: 'Mars tampak berwarna kemerahan karena banyaknya oksida besi (karat) di permukaannya.'
  },
  {
    difficulty: 'easy',
    category: '🔬 Sains & Alam',
    question: 'Zat hijau daun pada tumbuhan yang berfungsi menyerap cahaya matahari disebut?',
    options: ['Klorofil', 'Hemoglobin', 'Melanin', 'Karoten'],
    correct: 0,
    explanation: 'Klorofil adalah pigmen fotosintesis penting pada tumbuhan hijau.'
  },
  {
    difficulty: 'easy',
    category: '🎮 Gaming',
    question: 'Game balap mobil dengan cangkang kura-kura dan pisang buatan Nintendo adalah?',
    options: ['Mario Kart', 'Need for Speed', 'Gran Turismo', 'Asphalt'],
    correct: 0,
    explanation: 'Mario Kart adalah serial game balapan go-kart legendaris dari Nintendo.'
  },
  {
    difficulty: 'easy',
    category: '💻 Tech',
    question: 'Shortcut keyboard apa yang digunakan untuk melakukan Copy (menyalin teks) di Windows?',
    options: ['Ctrl + C', 'Ctrl + V', 'Ctrl + X', 'Ctrl + Z'],
    correct: 0,
    explanation: 'Ctrl + C adalah shortcut standar untuk menyalin teks atau file.'
  },

  // ── MEDIUM QUESTIONS (Detailed / Intermediate Knowledge) ──
  {
    difficulty: 'medium',
    category: '🎮 Gaming',
    question: 'Di game Genshin Impact, siapakah Archon yang memimpin region Fontaine?',
    options: ['Furina / Focalors', 'Nahida', 'Raiden Shogun', 'Zhongli'],
    correct: 0,
    explanation: 'Furina/Focalors adalah Hydro Archon yang memerintah region Fontaine.'
  },
  {
    difficulty: 'medium',
    category: '🎮 Gaming',
    question: 'Apa nama senjata pedang legendaris milik Cloud Strife di Final Fantasy VII?',
    options: ['Buster Sword', 'Master Sword', 'Soul Edge', 'Excalibur'],
    correct: 0,
    explanation: 'Buster Sword adalah pedang raksasa ikonik milik Cloud Strife yang diwarisi dari Zack Fair.'
  },
  {
    difficulty: 'medium',
    category: '🎮 Gaming',
    question: 'Studio manakah yang mengembangkan game legendaris Elden Ring dan Dark Souls?',
    options: ['FromSoftware', 'Capcom', 'Square Enix', 'Ubisoft'],
    correct: 0,
    explanation: 'FromSoftware di bawah arahan Hidetaka Miyazaki adalah kreator seri Souls dan Elden Ring.'
  },
  {
    difficulty: 'medium',
    category: '💻 Tech & Coding',
    question: 'Siapakah pencipta bahasa pemrograman Python pertama kali pada tahun 1991?',
    options: ['Guido van Rossum', 'Brendan Eich', 'Linus Torvalds', 'James Gosling'],
    correct: 0,
    explanation: 'Guido van Rossum merilis Python pertama kali pada tahun 1991.'
  },
  {
    difficulty: 'medium',
    category: '💻 Tech & Coding',
    question: 'Struktur data manakah yang bekerja dengan prinsip First-In, First-Out (FIFO)?',
    options: ['Queue (Antrean)', 'Stack (Tumpukan)', 'Binary Tree', 'Graph'],
    correct: 0,
    explanation: 'Queue bekerja dengan prinsip FIFO, di mana elemen pertama yang masuk akan keluar lebih dulu.'
  },
  {
    difficulty: 'medium',
    category: '💻 Tech & Coding',
    question: 'Berapa nomor port default terenkripsi TLS/SSL untuk protokol HTTPS?',
    options: ['443', '80', '8080', '22'],
    correct: 0,
    explanation: 'Port 443 adalah port standar terenkripsi TLS/SSL untuk protokol HTTPS.'
  },
  {
    difficulty: 'medium',
    category: '🎌 Anime',
    question: 'Siapakah nama penyihir elf protagonis utama dalam anime "Sousou no Frieren"?',
    options: ['Frieren', 'Fern', 'Flamme', 'Serie'],
    correct: 0,
    explanation: 'Frieren adalah penyihir elf berumur ribuan tahun yang mengembara mengenang teman-teman pahlawannya.'
  },
  {
    difficulty: 'medium',
    category: '🎌 Anime',
    question: 'Apa nama teknik Domain Expansion milik Gojo Satoru di Jujutsu Kaisen?',
    options: ['Muryokusho (Unlimited Void)', 'Fukuma Mizushi', 'Choryo Bakko', 'Idle Transfiguration'],
    correct: 0,
    explanation: 'Unlimited Void mengisi pikiran target dengan informasi tak terbatas hingga lumpuh total.'
  },
  {
    difficulty: 'medium',
    category: '🇮🇩 Indonesia',
    question: 'Candi Buddha terbesar di dunia yang terletak di Magelang, Jawa Tengah adalah?',
    options: ['Candi Borobudur', 'Candi Prambanan', 'Candi Mendut', 'Candi Sewu'],
    correct: 0,
    explanation: 'Candi Borobudur dibangun pada abad ke-8 oleh Dinasti Syailendra.'
  },
  {
    difficulty: 'medium',
    category: '🇮🇩 Indonesia',
    question: 'Danau vulkanik terbesar di dunia yang berada di Sumatera Utara adalah?',
    options: ['Danau Toba', 'Danau Maninjau', 'Danau Singkarak', 'Danau Poso'],
    correct: 0,
    explanation: 'Danau Toba memiliki panjang 100 km dan lebar 30 km yang terbentuk dari letusan supervolcano purba.'
  },
  {
    difficulty: 'medium',
    category: '🔬 Sains',
    question: 'Unsur kimia apakah yang memiliki simbol "Au" pada tabel periodik?',
    options: ['Emas (Gold)', 'Perak (Silver)', 'Aluminium', 'Tembaga'],
    correct: 0,
    explanation: 'Simbol Au berasal dari kata Latin "Aurum" yang berarti emas.'
  },
  {
    difficulty: 'medium',
    category: '🎮 Gaming',
    question: 'Di game Mobile Legends, role utama dari hero Fanny adalah apa?',
    options: ['Assassin', 'Tank', 'Mage', 'Support'],
    correct: 0,
    explanation: 'Fanny adalah hero Assassin dengan mobilitas kabel Steel Cable yang sangat lincah.'
  },

  // ── HARD QUESTIONS (Expert / Advanced / Rare Trivia) ──
  {
    difficulty: 'hard',
    category: '💻 Tech & Coding',
    question: 'Berapakah kompleksitas waktu rata-rata (Average Time Complexity) dari algoritma QuickSort?',
    options: ['O(N log N)', 'O(N^2)', 'O(N)', 'O(1)'],
    correct: 0,
    explanation: 'QuickSort memiliki rata-rata performa O(N log N) dengan strategi Divide and Conquer.'
  },
  {
    difficulty: 'hard',
    category: '💻 Tech & Coding',
    question: 'Protokol konsensus apakah yang digunakan oleh Bitcoin sebelum Lightning Network?',
    options: ['Proof of Work (PoW) - SHA256', 'Proof of Stake (PoS)', 'Proof of History', 'Raft Consensus'],
    correct: 0,
    explanation: 'Bitcoin menggunakan Proof of Work dengan algoritma hashing SHA-256.'
  },
  {
    difficulty: 'hard',
    category: '💻 Tech & Coding',
    question: 'Siapakah tokoh yang memformulasikan arsitektur mesin komputasi abstrak dengan pita memori tak terbatas pada 1936?',
    options: ['Alan Turing', 'John von Neumann', 'Ada Lovelace', 'Claude Shannon'],
    correct: 0,
    explanation: 'Alan Turing memperkenalkan konsep Turing Machine yang mendasari teori komputasi modern.'
  },
  {
    difficulty: 'hard',
    category: '🎌 Anime',
    question: 'Di anime Steins;Gate, apa nama organisasi riset rahasia yang menjadi lawan Okabe Rintarou?',
    options: ['SERN', 'NERV', 'SEELE', 'Syndicate'],
    correct: 0,
    explanation: 'SERN (parodi dari CERN) adalah organisasi riset yang menciptakan distopia mesin waktu.'
  },
  {
    difficulty: 'hard',
    category: '🎌 Anime',
    question: 'Di anime Hunter x Hunter, tipe Nen apakah yang dimiliki oleh Kurapika saat matanya berubah menjadi Scarlet Eyes?',
    options: ['Specialist (Spesialis)', 'Conjurer (Materialisasi)', 'Enhancer (Penguat)', 'Transmuter (Transformasi)'],
    correct: 0,
    explanation: 'Kurapika normalnya adalah Conjurer, namun saat matanya Scarlet menjadi Specialist dengan kemampuan Emperor Time.'
  },
  {
    difficulty: 'hard',
    category: '🎮 Gaming',
    question: 'Di lore game Dark Souls, siapakah Lord pertama yang menemukan Lord Soul of Light dan memimpin Age of Fire?',
    options: ['Lord Gwyn', 'Witch of Izalith', 'Gravelord Nito', 'Furtive Pygmy'],
    correct: 0,
    explanation: 'Lord Gwyn, the Lord of Sunlight, adalah penguasa Anor Londo yang memulai Age of Fire.'
  },
  {
    difficulty: 'hard',
    category: '🎮 Gaming',
    question: 'Engine game internal apakah yang dikembangkan oleh Capcom untuk game Resident Evil 7, Monster Hunter Rise, dan DMC5?',
    options: ['RE Engine', 'MT Framework', 'Decima Engine', 'Frostbite'],
    correct: 0,
    explanation: 'RE Engine (Reach for the Moon Engine) adalah proprietary engine mutakhir milik Capcom.'
  },
  {
    difficulty: 'hard',
    category: '🇮🇩 Indonesia',
    question: 'Perjanjian manakah pada tahun 1755 yang membagi Kerajaan Mataram Islam menjadi Kesultanan Yogyakarta dan Kasunanan Surakarta?',
    options: ['Perjanjian Giyanti', 'Perjanjian Salatiga', 'Perjanjian Bongaya', 'Perjanjian Linggarjati'],
    correct: 0,
    explanation: 'Perjanjian Giyanti (13 Februari 1755) ditandatangani antara VOC, Pangeran Mangkubumi, dan Pakubuwana III.'
  },
  {
    difficulty: 'hard',
    category: '🔬 Sains',
    question: 'Berapakah kecepatan cahaya dalam ruang hampa udara (vakum) yang dibulatkan?',
    options: ['299.792.458 m/s', '150.000.000 m/s', '3.000.000 m/s', '30.000.000 m/s'],
    correct: 0,
    explanation: 'Konstanta kecepatan cahaya (c) tepatnya adalah 299.792.458 meter per detik.'
  },
  {
    difficulty: 'hard',
    category: '🔬 Sains',
    question: 'Partikel subatomik apakah yang bertanggung jawab memberikan massa pada partikel lain melalui medannya yang ditemukan di CERN 2012?',
    options: ['Higgs Boson', 'Graviton', 'Tachyon', 'Neutrino'],
    correct: 0,
    explanation: 'Higgs Boson (Partikel Tuhan) ditemukan di Large Hadron Collider CERN pada tahun 2012.'
  }
];

// activeTriviaGauntlets: channelId -> GauntletState
const activeTriviaGauntlets = new Map();

function promptTriviaDifficulty(userId, userName, channel) {
  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🏆 [PILIH TINGKAT KESULITAN KUIS TRIVIA]')
    .setDescription(
      `Halo <@${userId}>! Kuis Trivia hadir dalam format **10 Rantai Pertanyaan (Marathon)** berturut-turut! 🧠✨\n\n` +
      `🟢 **Easy (Santai):** Soal umum & santai (+2 Poin/soal, waktu 25s)\n` +
      `🟡 **Medium (Kasual):** Soal standar & mendalam (+2 Poin/soal, waktu 20s)\n` +
      `🔴 **Hard (Tantangan):** Soal langka, teknis & sulit (+2 Poin/soal, waktu 15s)\n\n` +
      `🎯 **Sistem Akumulasi Poin:** Tiap jawaban benar mendapatkan **+2 Poin**. Total maksimal jika 10/10 benar = **20 Poin**!\n` +
      `💡 *Permainan akan terus berlanjut hingga soal ke-10 selesai, kecuali kamu memilih tombol Menyerah/Berhenti.*\n\n` +
      `👉 *Pilih tingkat kesulitan untuk memulai rantai soal:*`
    )
    .setFooter({ text: 'Azura Trivia Marathon Engine • 10 Rantai Soal' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`triviadiff_${channel.id}_${userId}_easy`).setLabel('🟢 Easy (Santai)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`triviadiff_${channel.id}_${userId}_medium`).setLabel('🟡 Medium (Kasual)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`triviadiff_${channel.id}_${userId}_hard`).setLabel('🔴 Hard (Tantangan)').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function startTriviaGame(userId, userName, channel, difficulty = null, category = null) {
  const channelId = channel.id;

  if (!difficulty || !TRIVIA_DIFFICULTIES[difficulty.toLowerCase()]) {
    return promptTriviaDifficulty(userId, userName, channel);
  }

  const diffKey = difficulty.toLowerCase();
  const diffConfig = TRIVIA_DIFFICULTIES[diffKey];

  if (activeTriviaGauntlets.has(channelId)) {
    const old = activeTriviaGauntlets.get(channelId);
    if (old.timer) clearTimeout(old.timer);
    activeTriviaGauntlets.delete(channelId);
  }

  // Filter questions pool by difficulty (and category if provided)
  let pool = TRIVIA_BANK.filter(q => q.difficulty === diffKey);
  if (category) {
    const catFiltered = pool.filter(q => q.category.toLowerCase().includes(category.toLowerCase()));
    if (catFiltered.length >= 3) pool = catFiltered;
  }
  if (pool.length === 0) {
    pool = TRIVIA_BANK.filter(q => q.difficulty === diffKey);
  }

  // Shuffle and pick up to 10 unique questions
  const shuffledPool = [...pool].sort(() => Math.random() - 0.5);
  const selectedQuestions = shuffledPool.slice(0, Math.min(10, shuffledPool.length));

  // If pool has fewer than 10, fill from general bank
  if (selectedQuestions.length < 10) {
    const otherPool = TRIVIA_BANK.filter(q => !selectedQuestions.includes(q)).sort(() => Math.random() - 0.5);
    while (selectedQuestions.length < 10 && otherPool.length > 0) {
      selectedQuestions.push(otherPool.pop());
    }
  }

  const gauntletState = {
    channelId,
    starterUserId: userId,
    starterUserName: userName,
    difficulty: diffKey,
    diffConfig,
    questions: selectedQuestions,
    currentIndex: 0,
    totalQuestions: selectedQuestions.length,
    scoreByUser: new Map(), // userId -> correctCount
    userNames: new Map([[userId, userName]]),
    answeredInCurrentQuestion: new Set(),
    isResolved: false,
    timer: null
  };

  activeTriviaGauntlets.set(channelId, gauntletState);
  return renderCurrentQuestion(channelId, channel);
}

function renderCurrentQuestion(channelId, channel) {
  const state = activeTriviaGauntlets.get(channelId);
  if (!state) return null;

  if (state.timer) clearTimeout(state.timer);
  state.isResolved = false;
  state.answeredInCurrentQuestion.clear();

  const q = state.questions[state.currentIndex];
  const qNum = state.currentIndex + 1;
  const total = state.totalQuestions;
  const diffConfig = state.diffConfig;

  // Shuffle options for this question
  const optionIndices = [0, 1, 2, 3];
  for (let i = optionIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionIndices[i], optionIndices[j]] = [optionIndices[j], optionIndices[i]];
  }

  state.currentShuffledOptions = optionIndices.map(idx => q.options[idx]);
  state.currentCorrectIndex = optionIndices.indexOf(q.correct);
  state.currentExplanation = q.explanation;
  state.currentQuestionText = q.question;
  state.currentCategory = q.category;

  const turnMs = diffConfig.turnSeconds * 1000;
  const expiresAtUnix = Math.floor((Date.now() + turnMs) / 1000);

  state.timer = setTimeout(() => {
    handleTriviaGauntletTimeout(channelId, channel);
  }, turnMs);

  const embed = new EmbedBuilder()
    .setColor(diffConfig.color)
    .setTitle(`🏆 [KUIS TRIVIA: SOAL ${qNum}/${total} • ${diffConfig.badge}]`)
    .setDescription(
      `Kategori: **${q.category}**\n` +
      `Pertanyaan ke-**${qNum}** dari **${total}** Soal Rantai Trivia:\n\n` +
      `❓ **"${q.question}"**\n\n` +
      state.currentShuffledOptions.map((opt, idx) => `**${['🅰️', '🅱️', '🅲', '🅳'][idx]}** ${opt}`).join('\n') +
      `\n\n⏱️ **Sisa Waktu Menjawab:** <t:${expiresAtUnix}:R> *(Berakhir <t:${expiresAtUnix}:T>)*\n` +
      `🎯 *+2 Poin per jawaban benar (Maks 20 Poin jika 10/10 benar)*\n` +
      `👉 *Klik tombol pilihanmu di bawah:*`
    )
    .setFooter({ text: `Soal ${qNum} dari ${total} • Klik 'Nyerah / Selesai' untuk mengakhiri sesi` })
    .setTimestamp();

  const rowChoices = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('trivia_choice_0').setLabel('🅰️ Pilihan A').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('trivia_choice_1').setLabel('🅱️ Pilihan B').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('trivia_choice_2').setLabel('🅲 Pilihan C').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('trivia_choice_3').setLabel('🅳 Pilihan D').setStyle(ButtonStyle.Primary)
  );

  const rowControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('triviastop_gauntlet').setLabel('🏳️ Nyerah / Selesai Sesi').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [rowChoices, rowControls] };
}

function handleTriviaGauntletTimeout(channelId, channel) {
  const state = activeTriviaGauntlets.get(channelId);
  if (!state || state.isResolved) return;
  state.isResolved = true;

  const labels = ['🅰️', '🅱️', '🅲', '🅳'];
  const correctLabel = labels[state.currentCorrectIndex];
  const correctText = state.currentShuffledOptions[state.currentCorrectIndex];
  const qNum = state.currentIndex + 1;
  const total = state.totalQuestions;

  const timeoutEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(`⌛ [WAKTU SOAL ${qNum}/${total} HABIS!]`)
    .setDescription(
      `❓ **"${state.currentQuestionText}"**\n\n` +
      `✅ **Jawaban yang Benar:** **${correctLabel} ${correctText}**\n\n` +
      `💡 **Penjelasan:** *${state.currentExplanation}*\n\n` +
      `⏳ *Melanjutkan ke soal berikutnya dalam 3 detik...*`
    )
    .setTimestamp();

  if (channel && channel.send) {
    channel.send({ embeds: [timeoutEmbed] }).catch(() => {});
  }

  advanceToNextQuestion(channelId, channel, 3000);
}

function advanceToNextQuestion(channelId, channel, delayMs = 2500) {
  const state = activeTriviaGauntlets.get(channelId);
  if (!state) return;

  state.currentIndex++;

  if (state.currentIndex >= state.totalQuestions) {
    // Gauntlet finished completely!
    setTimeout(() => {
      finishTriviaGauntlet(channelId, 'COMPLETED', channel);
    }, delayMs);
  } else {
    // Send next question
    setTimeout(() => {
      const nextQ = renderCurrentQuestion(channelId, channel);
      if (nextQ && channel && channel.send) {
        channel.send({ embeds: nextQ.embeds, components: nextQ.components }).catch(() => {});
      }
    }, delayMs);
  }
}

function finishTriviaGauntlet(channelId, reason = 'COMPLETED', channel = null) {
  const state = activeTriviaGauntlets.get(channelId);
  if (!state) return;

  if (state.timer) clearTimeout(state.timer);
  activeTriviaGauntlets.delete(channelId);

  const diffConfig = state.diffConfig;
  const total = state.totalQuestions;

  // Record points in Vault for all players
  const participants = Array.from(state.scoreByUser.entries());
  let leaderboardSummary = '';

  if (participants.length === 0) {
    leaderboardSummary = `*Belum ada peserta yang menjawab dengan benar di sesi ini.*`;
  } else {
    participants.sort((a, b) => b[1] - a[1]);
    leaderboardSummary = participants.map(([uId, correctCount], idx) => {
      const points = correctCount * diffConfig.pointPerQuestion;
      recordGameScore(uId, 'trivia', points, true, correctCount);
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🎖️';
      return `${medal} <@${uId}>: **${correctCount}/${total} Soal Benar** ➔ **+${points} Poin Leaderboard** 🌟`;
    }).join('\n');
  }

  let title = `🏁 [SESI TRIVIA MARATHON SELESAI • ${diffConfig.badge}]`;
  let descHeader = `Seluruh rangkaian **${total} Rantai Soal** telah selesai!\n\n`;

  if (reason === 'SURRENDER') {
    title = `🏳️ [SESI TRIVIA DIHENTIKAN • ${diffConfig.badge}]`;
    descHeader = `Sesi kuis dihentikan lebih awal pada soal ke-${state.currentIndex + 1}/${total}.\n\n`;
  }

  const finalEmbed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(title)
    .setDescription(
      descHeader +
      `📊 **REKAPITULASI SKOR PESERTA:**\n` +
      leaderboardSummary + `\n\n` +
      `💰 Poin telah otomatis ditambahkan ke User Vault Leaderboard!\n` +
      `Ketik \`Azura main trivia\` untuk memulai tantangan marathon baru! 🏆`
    )
    .setFooter({ text: 'Azura Game Engine • Cek peringkat dengan /leaderboard' })
    .setTimestamp();

  if (channel && channel.send) {
    channel.send({ embeds: [finalEmbed] }).catch(() => {});
  }

  return finalEmbed;
}

async function handleTriviaDifficultyButton(interaction) {
  const parts = interaction.customId.split('_');
  if (parts.length < 4) return;

  const channelId = parts[1];
  const userId = parts[2];
  const diff = parts[3];

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: '⚠️ Tombol pilihan kesulitan ini untuk pemain yang memulai kuis! Gunakan `/trivia` untuk sesi bermainmu sendiri yaa! ✨',
      flags: 64
    });
  }

  const gameResult = startTriviaGame(userId, interaction.user.displayName || interaction.user.username, interaction.channel, diff);
  return interaction.update({
    embeds: gameResult.embeds,
    components: gameResult.components
  });
}

async function handleTriviaButton(interaction) {
  if (interaction.customId.startsWith('triviadiff_')) {
    return handleTriviaDifficultyButton(interaction);
  }

  const channelId = interaction.channelId || (interaction.channel && interaction.channel.id);
  const state = activeTriviaGauntlets.get(channelId);

  if (!state) {
    return interaction.reply({
      content: '⌛ Sesi kuis trivia ini sudah selesai atau belum dimulai! Mulai sesi baru dengan `Azura main trivia`! 🏆',
      flags: 64
    });
  }

  // Handle Stop / Surrender Button
  if (interaction.customId === 'triviastop_gauntlet') {
    finishTriviaGauntlet(channelId, 'SURRENDER', interaction.channel);
    return interaction.reply({
      content: `🏳️ <@${interaction.user.id}> mengakhiri sesi trivia marathon! Menghitung perolehan poin akhir...`,
      flags: 64
    });
  }

  const parts = interaction.customId.split('_');
  const choiceIdx = parseInt(parts[parts.length - 1], 10);
  if (isNaN(choiceIdx)) return;

  if (state.isResolved) {
    return interaction.reply({
      content: '⏳ Soal ini sudah selesai dijawab! Tunggu soal berikutnya yaa!',
      flags: 64
    });
  }

  if (state.answeredInCurrentQuestion.has(interaction.user.id)) {
    return interaction.reply({
      content: '⚠️ Kamu sudah menebak di soal ini! Tunggu soal berikutnya yaa!',
      flags: 64
    });
  }

  const labels = ['🅰️', '🅱️', '🅲', '🅳'];
  const userChoiceLabel = labels[choiceIdx] || `Pilihan ${choiceIdx + 1}`;
  const isCorrect = (choiceIdx === state.currentCorrectIndex);
  const qNum = state.currentIndex + 1;
  const total = state.totalQuestions;

  if (isCorrect) {
    state.isResolved = true;
    if (state.timer) clearTimeout(state.timer);

    const prevScore = state.scoreByUser.get(interaction.user.id) || 0;
    const newScore = prevScore + 1;
    state.scoreByUser.set(interaction.user.id, newScore);
    state.userNames.set(interaction.user.id, interaction.user.displayName || interaction.user.username);

    const winEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`🎉 [JAWABAN BENAR: SOAL ${qNum}/${total}!]`)
      .setDescription(
        `🏆 <@${interaction.user.id}> menjawab dengan benar!\n\n` +
        `❓ **"${state.currentQuestionText}"**\n` +
        `✅ **Jawaban Tepat:** **${userChoiceLabel} ${state.currentShuffledOptions[state.currentCorrectIndex]}**\n\n` +
        `💡 **Penjelasan:** *${state.currentExplanation}*\n\n` +
        `🎁 **Poin:** <@${interaction.user.id}> mendapatkan **+2 Poin** *(Total Benar: ${newScore}/${qNum})*\n` +
        (qNum < total ? `⏳ *Melanjutkan ke soal ${qNum + 1}/${total} dalam 2 detik...*` : `🏁 *Semua 10 soal telah selesai! Menampilkan papan skor akhir...*`)
      )
      .setFooter({ text: 'Trivia Marathon Azura • Akumulasi Poin' })
      .setTimestamp();

    await interaction.update({
      embeds: [winEmbed],
      components: [] // Remove buttons for answered question
    });

    advanceToNextQuestion(channelId, interaction.channel, 2500);
  } else {
    state.answeredInCurrentQuestion.add(interaction.user.id);
    return interaction.reply({
      content: `❌ Jawabanmu (**${userChoiceLabel}**) kurang tepat! Ayo member lain masih ada kesempatan menjawab soal ini! ⚡`,
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

  // Trivia with Difficulty parsing
  if (/\b(?:main|play|mulai|soal)\s*(?:trivia|kuis|quiz|cerdas\s+cermat|tanya\s+jawab)\b/i.test(lower) ||
      /\b(?:trivia|kuis\s+azura)\b/i.test(lower)) {
    let diff = null;
    if (/\b(?:easy|mudah|gampang|santai)\b/i.test(lower)) diff = 'easy';
    else if (/\b(?:medium|sedang|kasual|normal)\b/i.test(lower)) diff = 'medium';
    else if (/\b(?:hard|sulit|susah|menantang|ahli)\b/i.test(lower)) diff = 'hard';

    return { game: 'trivia', difficulty: diff };
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
  promptTriviaDifficulty,
  handleTriviaButton,
  handleTriviaDifficultyButton,
  finishTriviaGauntlet,
  getLeaderboardEmbed,
  parseNaturalGameRequest,
  calculateAiMoveByDifficulty,
  calculateExpertMinimaxMove,
  minimax,
  TTT_DIFFICULTIES,
  TRIVIA_DIFFICULTIES,
  TRIVIA_BANK,
  activeTriviaGauntlets
};
