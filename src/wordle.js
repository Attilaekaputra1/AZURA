/**
 * AZURA Interactive Wordle Mini-Game Engine
 * Supports 5-letter words in Indonesian & English with rich emoji boards, hints, and co-op gameplay.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Curated 5-letter Indonesian Word List
const INDONESIAN_WORDS = [
  'KABAR', 'RUMAH', 'POHON', 'SUARA', 'SURAT', 'TANAH', 'PANTAI', 'BUKAN', 'MALAM', 'SIANG',
  'BULAN', 'BINTA', 'CINTA', 'HUJAN', 'ANGIN', 'BADAI', 'OMBAK', 'DANAU', 'SUNGA', 'JALAN',
  'KOTAK', 'PINTU', 'LAMPU', 'MEJAA', 'KURSI', 'KASUR', 'KUNCI', 'KERTAS', 'PENA', 'BUKUU',
  'MAKAN', 'MINUM', 'TIDUR', 'MIMPI', 'LARII', 'JALAN', 'DUDUK', 'SENYUM', 'TAWAA', 'TANGI',
  'MERAH', 'PUTIH', 'HITAM', 'HIJAU', 'KUNIN', 'BIRUU', 'COKLA', 'EMASS', 'PERAK', 'BATUU',
  'MANIS', 'PAHIT', 'ASINN', 'PEDAS', 'ASAMM', 'GURAS', 'LEZAT', 'SEGAR', 'HARUM', 'WANGI',
  'SEJUK', 'PANAS', 'DINGI', 'HANGT', 'TERIK', 'REDUP', 'GELAP', 'TERAN', 'CERAH', 'SENJA',
  'FAJAR', 'SUBAS', 'PETAN', 'KEMAR', 'BESOK', 'WAKTU', 'DETIK', 'MENIT', 'ZAMAN', 'MASAA',
  'ORANG', 'TEMAN', 'SAHAB', 'BAPAK', 'IBUUU', 'ANAKK', 'KAKAK', 'ADIKK', 'NENEK', 'KAKEI',
  'GAJAH', 'SINGA', 'HARIM', 'KUCIN', 'ANJIN', 'BURUN', 'BEBEK', 'AYAMM', 'IKANN', 'UDANG',
  'KODOK', 'BUAYA', 'LALAT', 'NYAMU', 'LEBAH', 'SEMUT', 'LABAA', 'ULARR', 'KUDAS', 'SAPII',
  'PINTA', 'CERDI', 'BIJAK', 'HEBAT', 'GAGAH', 'BERAN', 'TAJMM', 'KOKOH', 'KUATT', 'LEMAH',
  'GEMAR', 'SEMNG', 'ASYIK', 'RAMEI', 'SEPII', 'TENNG', 'DAMAI', 'INDHH', 'CANTK', 'BAGUS',
  'KEREN', 'CUKUP', 'LEBIH', 'KURNG', 'PASSS', 'TEPAT', 'BENAR', 'SALAH', 'NYATA', 'SEMUA'
].map(w => w.slice(0, 5).toUpperCase()).filter(w => w.length === 5);

// Curated 5-letter English Word List
const ENGLISH_WORDS = [
  'ABOUT', 'ABOVE', 'ACUTE', 'ADMIT', 'ADOPT', 'ADULT', 'AFTER', 'AGAIN', 'AGENT', 'AGILE',
  'AGREE', 'AHEAD', 'ALARM', 'ALBUM', 'ALERT', 'ALIEN', 'ALIGN', 'ALIKE', 'ALIVE', 'ALLOW',
  'ALONE', 'ALONG', 'ALTER', 'AMONG', 'ANGEL', 'ANGER', 'ANGLE', 'ANGRY', 'APART', 'APPLE',
  'APPLY', 'ARENA', 'ARGUE', 'ARISE', 'ARMOR', 'ARRAY', 'ARROW', 'ASIDE', 'ASSET', 'AUDIO',
  'AUDIT', 'AVOID', 'AWAIT', 'AWAKE', 'AWARD', 'AWARE', 'BADGE', 'BASIC', 'BASIS', 'BEACH',
  'BEGIN', 'BEING', 'BELOW', 'BENCH', 'BLACK', 'BLADE', 'BLAME', 'BLANK', 'BLAST', 'BLESS',
  'BLIND', 'BLOCK', 'BLOOD', 'BLOOM', 'BLOWN', 'BLUES', 'BLUNT', 'BOARD', 'BOAST', 'BOOST',
  'BOOTH', 'BOUND', 'BRAIN', 'BRAND', 'BRAVE', 'BREAD', 'BREAK', 'BREED', 'BRIEF', 'BRIGHT',
  'BRING', 'BROAD', 'BROKE', 'BROWN', 'BUILD', 'BUILT', 'BUYER', 'CABIN', 'CABLE', 'CANDY',
  'CRAFT', 'CRANE', 'CRASH', 'CRAZY', 'CREAM', 'CRIME', 'CROSS', 'CROWD', 'CROWN', 'CRUSH',
  'CYBER', 'DANCE', 'DEATH', 'DEBUG', 'DELAY', 'DELTA', 'DENSE', 'DEVIL', 'DIGIT', 'DISCO',
  'DRAFT', 'DRAIN', 'DREAM', 'DRESS', 'DRIVE', 'DRONE', 'EAGLE', 'EARLY', 'EARTH', 'ELITE',
  'EMAIL', 'EMPTY', 'ENEMY', 'ENJOY', 'ENTER', 'ENTRY', 'EQUAL', 'ERROR', 'EVENT', 'EXACT',
  'EXIST', 'EXTRA', 'FAITH', 'FALSE', 'FANCY', 'FATAL', 'FAULT', 'FAVOR', 'FIBER', 'FIELD',
  'FIFTH', 'FINAL', 'FIRST', 'FLAME', 'FLASH', 'FLEET', 'FLOAT', 'FLOOD', 'FLOOR', 'FLUID',
  'FOCUS', 'FORCE', 'FORTH', 'FORTY', 'FORUM', 'FOUND', 'FRAME', 'FRESH', 'FRONT', 'FRUIT',
  'GHOST', 'GIANT', 'GLASS', 'GLOBE', 'GLORY', 'GRACE', 'GRADE', 'GRAIN', 'GRAND', 'GRANT',
  'GRAPE', 'GRAPH', 'GRASP', 'GRASS', 'GRAVE', 'GREAT', 'GREEN', 'GREET', 'GRIEF', 'GROUP',
  'GUARD', 'GUESS', 'GUEST', 'GUIDE', 'HABIT', 'HAPPY', 'HARSH', 'HEART', 'HEAVY', 'HONEY',
  'HONOR', 'HORSE', 'HOTEL', 'HOUSE', 'HUMAN', 'IDEAL', 'IMAGE', 'INDEX', 'INNER', 'INPUT',
  'ISSUE', 'JEWEL', 'JOINT', 'JUDGE', 'JUICE', 'KNIFE', 'KNOCK', 'LABEL', 'LABOR', 'LARGE',
  'LASER', 'LATER', 'LAUGH', 'LAYER', 'LEARN', 'LEASE', 'LEAST', 'LEMON', 'LEVEL', 'LIGHT',
  'LIMIT', 'LINKS', 'LOGIC', 'LOVER', 'LUCKY', 'LUNCH', 'MAGIC', 'MAJOR', 'MAKER', 'MARCH',
  'MATCH', 'MEDAL', 'MEDIA', 'MERIT', 'METAL', 'MIGHT', 'MINER', 'MODEL', 'MONEY', 'MONTH',
  'MORAL', 'MOTOR', 'MOUNT', 'MOUSE', 'MOUTH', 'MOVIE', 'MUSIC', 'NERVE', 'NIGHT', 'NOBLE',
  'NOISE', 'NORTH', 'NOVEL', 'NURSE', 'OCEAN', 'OFFER', 'ONION', 'ORDER', 'OTHER', 'OUTER',
  'OWNER', 'PANEL', 'PANIC', 'PAPER', 'PARTY', 'PEACE', 'PHASE', 'PHONE', 'PHOTO', 'PIANO',
  'PILOT', 'PITCH', 'PIXEL', 'PIZZA', 'PLACE', 'PLAIN', 'PLANE', 'PLANT', 'PLATE', 'POINT',
  'POWER', 'PRESS', 'PRICE', 'PRIDE', 'PRIME', 'PRINT', 'PRIZE', 'PULSE', 'QUEEN', 'QUERY',
  'QUEST', 'QUICK', 'QUIET', 'RADIO', 'RAISE', 'RALLY', 'RANCH', 'RANGE', 'RAPID', 'RATIO',
  'REACH', 'REACT', 'READY', 'REALM', 'REBEL', 'REFER', 'RELAX', 'REPLY', 'RESET', 'RIDER',
  'RIVER', 'ROBOT', 'ROCKY', 'ROUND', 'ROUTE', 'ROYAL', 'RULER', 'SCALE', 'SCENE', 'SCOPE',
  'SCORE', 'SCOUT', 'SHARE', 'SHIFT', 'SHINE', 'SHIRT', 'SHOCK', 'SHOOT', 'SHORE', 'SHORT',
  'SIGHT', 'SKILL', 'SLEEP', 'SMART', 'SMILE', 'SMOKE', 'SOLAR', 'SOLID', 'SOLVE', 'SOUND',
  'SPACE', 'SPARK', 'SPEED', 'SPICE', 'SPORT', 'STAFF', 'STAGE', 'STAND', 'START', 'STATE',
  'STEAM', 'STEEL', 'STICK', 'STILL', 'STOCK', 'STONE', 'STORM', 'STORY', 'SUGAR', 'SUPER',
  'SWEET', 'SWORD', 'TABLE', 'TASTE', 'TEACH', 'THEME', 'THINK', 'TIGER', 'TITLE', 'TODAY',
  'TOKEN', 'TOPIC', 'TOTAL', 'TOUCH', 'TOWER', 'TRACK', 'TRADE', 'TRAIN', 'TREND', 'TRIAL',
  'TRIBE', 'TRICK', 'TRUCK', 'TRUTH', 'TWICE', 'UNCLE', 'UNDER', 'UNION', 'UNITY', 'URBAN',
  'USAGE', 'VALID', 'VALUE', 'VIDEO', 'VIRUS', 'VISIT', 'VITAL', 'VOICE', 'WASTE', 'WATCH',
  'WATER', 'WHEEL', 'WHERE', 'WHICH', 'WHITE', 'WHOLE', 'WORLD', 'WORRY', 'YOUTH', 'ZEBRA'
];

// Active game sessions: Map<channelId, WordleGame>
const activeGames = new Map();

/**
 * Wordle Letter Emoji Mappings
 */
const TILE_GREEN = '🟩';  // Correct letter, correct position
const TILE_YELLOW = '🟨'; // Correct letter, wrong position
const TILE_GRAY = '⬛';   // Letter not in word
const TILE_EMPTY = '⬜';  // Empty row

/**
 * Evaluate guess against target word
 * @param {string} target 
 * @param {string} guess 
 * @returns {Array<{letter: string, status: 'correct'|'present'|'absent'}>}
 */
function evaluateGuess(target, guess) {
  const result = [];
  const targetChars = target.split('');
  const guessChars = guess.split('');
  const matchedTargetIndices = new Set();

  // First pass: Find exact matches (Green)
  for (let i = 0; i < 5; i++) {
    if (guessChars[i] === targetChars[i]) {
      result[i] = { letter: guessChars[i], status: 'correct' };
      matchedTargetIndices.add(i);
    }
  }

  // Second pass: Find present matches (Yellow) or absent (Gray)
  for (let i = 0; i < 5; i++) {
    if (result[i]) continue; // Already green

    const char = guessChars[i];
    let foundIndex = -1;

    for (let j = 0; j < 5; j++) {
      if (!matchedTargetIndices.has(j) && targetChars[j] === char) {
        foundIndex = j;
        break;
      }
    }

    if (foundIndex !== -1) {
      result[i] = { letter: char, status: 'present' };
      matchedTargetIndices.add(foundIndex);
    } else {
      result[i] = { letter: char, status: 'absent' };
    }
  }

  return result;
}

/**
 * Render visual Discord Wordle Board Embed
 * @param {object} game 
 * @returns {EmbedBuilder}
 */
function renderWordleBoard(game) {
  let boardRows = [];

  for (let r = 0; r < game.maxAttempts; r++) {
    if (r < game.attempts.length) {
      const evaluation = game.attempts[r].evaluation;
      const tiles = evaluation.map(e => {
        if (e.status === 'correct') return TILE_GREEN;
        if (e.status === 'present') return TILE_YELLOW;
        return TILE_GRAY;
      }).join(' ');
      const wordText = `\` ${game.attempts[r].guess.split('').join(' ')} \``;
      boardRows.push(`${tiles}  ${wordText}`);
    } else {
      boardRows.push(`${TILE_EMPTY} ${TILE_EMPTY} ${TILE_EMPTY} ${TILE_EMPTY} ${TILE_EMPTY}  \` - - - - - \``);
    }
  }

  // Keyboard letter tracking
  const correctLetters = new Set();
  const presentLetters = new Set();
  const absentLetters = new Set();

  for (const att of game.attempts) {
    for (const item of att.evaluation) {
      if (item.status === 'correct') correctLetters.add(item.letter);
      else if (item.status === 'present' && !correctLetters.has(item.letter)) presentLetters.add(item.letter);
      else if (item.status === 'absent' && !correctLetters.has(item.letter) && !presentLetters.has(item.letter)) absentLetters.add(item.letter);
    }
  }

  const allAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  let keyboardStr = allAlphabet.map(char => {
    if (correctLetters.has(char)) return `**[${char}]**`;
    if (presentLetters.has(char)) return `*${char}*`;
    if (absentLetters.has(char)) return `~~${char}~~`;
    return char;
  }).join(' ');

  const embed = new EmbedBuilder()
    .setColor(game.isWon ? 0x57F287 : (game.isOver ? 0xED4245 : 0x5865F2))
    .setTitle(`🟩 AZURA Wordle — 5 Huruf (${game.language === 'id' ? 'Bahasa Indonesia' : 'English'})`)
    .setDescription(
      `Sesi permainan dimulai oleh **${game.creatorName}**!\n` +
      `Ketik kata **5 huruf** langsung di chat ini untuk menebak.\n\n` +
      `${boardRows.join('\n')}\n\n` +
      `🔤 **Status Huruf:**\n${keyboardStr}\n\n` +
      `*Legenda: 🟩 Benar & Tepat | 🟨 Ada tapi Salah Posisi | ⬛ Tidak Ada di Kata*`
    )
    .setFooter({
      text: game.isWon
        ? `🎉 Selamat! Berhasil ditebak dalam ${game.attempts.length}/${game.maxAttempts} percobaan!`
        : (game.isOver
          ? `💀 Kesempatan habis! Kata yang benar adalah: ${game.targetWord}`
          : `Kesempatan tersisa: ${game.maxAttempts - game.attempts.length}/${game.maxAttempts}`)
    })
    .setTimestamp();

  return embed;
}

/**
 * Start a new Wordle game
 * @param {string} channelId 
 * @param {string} userId 
 * @param {string} userName 
 * @param {'id'|'en'} language 
 * @returns {{ success: boolean, message?: string, embed?: EmbedBuilder }}
 */
function startWordle(channelId, userId, userName, language = 'id') {
  if (activeGames.has(channelId)) {
    const existing = activeGames.get(channelId);
    return {
      success: false,
      message: `Masih ada sesi Wordle yang sedang berjalan di channel ini oleh **${existing.creatorName}**! Ketik tebakan kata 5 hurufmu, atau ketik \`menyerah\` untuk mengakhiri game.`
    };
  }

  const wordList = language === 'en' ? ENGLISH_WORDS : INDONESIAN_WORDS;
  const targetWord = wordList[Math.floor(Math.random() * wordList.length)];

  const game = {
    channelId,
    creatorId: userId,
    creatorName: userName,
    language,
    targetWord,
    attempts: [],
    maxAttempts: 6,
    isOver: false,
    isWon: false,
    startTime: Date.now()
  };

  activeGames.set(channelId, game);
  console.log(`[Wordle Engine]: Started new ${language.toUpperCase()} game in channel ${channelId} (Target: ${targetWord})`);

  return {
    success: true,
    embed: renderWordleBoard(game)
  };
}

/**
 * Submit a guess to an active Wordle game
 * @param {string} channelId 
 * @param {string} userId 
 * @param {string} userName 
 * @param {string} guessInput 
 * @returns {{ handled: boolean, embed?: EmbedBuilder, commentary?: string, isOver?: boolean }}
 */
function processWordleGuess(channelId, userId, userName, guessInput) {
  const game = activeGames.get(channelId);
  if (!game || game.isOver) return { handled: false };

  const cleanGuess = guessInput.trim().toUpperCase().replace(/[^A-Z]/g, '');

  // Check if player wants to give up
  if (/^(?:menyerah|giveup|surrender|stop wordle|udahan wordle)$/i.test(guessInput.trim())) {
    game.isOver = true;
    game.isWon = false;
    activeGames.delete(channelId);
    const finalEmbed = renderWordleBoard(game);
    return {
      handled: true,
      embed: finalEmbed,
      commentary: `Permainan Wordle dihentikan! Kata yang benar adalah **${game.targetWord}** yaa gais ✨`,
      isOver: true
    };
  }

  // Must be exactly 5 letters
  if (cleanGuess.length !== 5) {
    return {
      handled: true,
      commentary: `⚠️ Kata harus terdiri dari tepat **5 huruf** yaa ${userName}! (Kamu mengetik: "${guessInput}")`
    };
  }

  // Check if word already guessed
  if (game.attempts.some(a => a.guess === cleanGuess)) {
    return {
      handled: true,
      commentary: `⚠️ Kata **${cleanGuess}** sudah pernah kamu tebak sebelumnya di sesi ini!`
    };
  }

  // Evaluate guess
  const evaluation = evaluateGuess(game.targetWord, cleanGuess);
  game.attempts.push({
    guess: cleanGuess,
    guesserName: userName,
    guesserId: userId,
    evaluation
  });

  // Check win condition
  if (cleanGuess === game.targetWord) {
    game.isOver = true;
    game.isWon = true;
    activeGames.delete(channelId);
    const winEmbed = renderWordleBoard(game);
    return {
      handled: true,
      embed: winEmbed,
      commentary: `🎉 **GOKIL! ${userName} berhasil menebak kata "${game.targetWord}" dalam ${game.attempts.length}/${game.maxAttempts} percobaan!** 🏆✨`,
      isOver: true
    };
  }

  // Check loss condition (out of attempts)
  if (game.attempts.length >= game.maxAttempts) {
    game.isOver = true;
    game.isWon = false;
    activeGames.delete(channelId);
    const loseEmbed = renderWordleBoard(game);
    return {
      handled: true,
      embed: loseEmbed,
      commentary: `Yahhh kesempatan habis! 😭 Jawaban yang benar adalah **${game.targetWord}**. Mau coba main lagi? Ketik \`/wordle\` yaa! ✨`,
      isOver: true
    };
  }

  // Ongoing game
  const updateEmbed = renderWordleBoard(game);
  return {
    handled: true,
    embed: updateEmbed,
    commentary: `Giliran ${game.attempts.length}/${game.maxAttempts} oleh **${userName}** (\`${cleanGuess}\`)`,
    isOver: false
  };
}

/**
 * Check if a text prompt is asking to start Wordle
 * @param {string} prompt 
 * @returns {boolean}
 */
function isWordleRequest(prompt) {
  if (!prompt) return false;
  return /\b(?:main\s+wordle|start\s+wordle|main\s+tebak\s+kata|tebak\s+kata\s+5\s+huruf|buka\s+wordle|game\s+wordle|play\s+wordle)\b/i.test(prompt);
}

/**
 * Check if channel currently has an active Wordle session
 * @param {string} channelId 
 * @returns {boolean}
 */
function hasActiveWordle(channelId) {
  return activeGames.has(channelId);
}

module.exports = {
  startWordle,
  processWordleGuess,
  isWordleRequest,
  hasActiveWordle,
  renderWordleBoard
};
