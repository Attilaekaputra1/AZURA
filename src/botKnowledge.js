const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEARNED_BOTS_FILE = path.join(DATA_DIR, 'bot_learned_commands.enc');

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});

// In-memory cache for learned bot commands
// botId -> Array<{ label: string, command: string, description: string, emoji: string }>
let learnedBotsCache = {};

function loadLearnedBots() {
  try {
    learnedBotsCache = readSecureJson(LEARNED_BOTS_FILE, {});
  } catch (err) {
    console.error('[Bot Knowledge]: Failed to read bot_learned_commands.enc:', err.message);
    learnedBotsCache = {};
  }
}

function saveLearnedBots() {
  try {
    writeSecureJson(LEARNED_BOTS_FILE, learnedBotsCache);
  } catch (err) {
    console.error('[Bot Knowledge]: Failed to save bot_learned_commands.enc:', err.message);
  }
}

// Load on startup
loadLearnedBots();

/**
 * Built-in Verified Preset Commands for Top Popular Discord Bots
 */
const VERIFIED_BOT_PRESETS = {
  // 1. Mudae (Anime Gacha & Marriage)
  mudae: [
    { label: '$waifu', command: '$waifu', description: 'Gacha / Roll karakter waifu anime acak', emoji: '🎲' },
    { label: '$marry', command: '$marry', description: 'Klaim / nikahi karakter yang baru di-roll', emoji: '💍' },
    { label: '$daily', command: '$daily', description: 'Ambil kuota rolls dan bonus harian', emoji: '🎁' },
    { label: '$rolls', command: '$rolls', description: 'Cek sisa kuota roll karakter kamu saat ini', emoji: '🔄' },
    { label: '$top', command: '$top', description: 'Lihat peringkat waifu terpopuler di server', emoji: '🏆' },
    { label: '$profile', command: '$profile', description: 'Lihat profil harem dan koleksi karakter', emoji: '👤' },
    { label: '$harem', command: '$harem', description: 'Tampilkan daftar harem waifu yang kamu miliki', emoji: '📜' }
  ],

  // 2. Music Bots (Lofi Radio, 24/7, Rythm, Jockie Music, Chip, Green-Bot)
  lofi: [
    { label: '!play lofi', command: '!play lofi', description: 'Mulai memutar radio lofi hip hop santai', emoji: '🎵' },
    { label: '!pause', command: '!pause', description: 'Jeda sementara pemutaran musik', emoji: '⏸️' },
    { label: '!resume', command: '!resume', description: 'Lanjutkan pemutaran musik', emoji: '▶️' },
    { label: '!stop', command: '!stop', description: 'Hentikan musik dan keluar dari VC', emoji: '⏹️' },
    { label: '!np', command: '!np', description: 'Lihat judul lagu yang sedang diputar (Now Playing)', emoji: '📻' }
  ],
  rythm: [
    { label: '!play lofi chill', command: '!play lofi chill', description: 'Putar lagu lofi santai di VC', emoji: '🎵' },
    { label: '!skip', command: '!skip', description: 'Lewati lagu yang sedang diputar', emoji: '⏭️' },
    { label: '!queue', command: '!queue', description: 'Lihat daftar antrean lagu di server', emoji: '📋' },
    { label: '!pause', command: '!pause', description: 'Jeda pemutaran lagu', emoji: '⏸️' },
    { label: '!disconnect', command: '!disconnect', description: 'Keluarkan bot dari Voice Channel', emoji: '🚪' }
  ],
  jockie: [
    { label: 'm!play lofi beats', command: 'm!play lofi beats', description: 'Putar lagu via Jockie Music', emoji: '🎵' },
    { label: 'm!skip', command: 'm!skip', description: 'Lewati lagu saat ini', emoji: '⏭️' },
    { label: 'm!queue', command: 'm!queue', description: 'Lihat antrean playlist lagu', emoji: '📜' },
    { label: 'm!stop', command: 'm!stop', description: 'Hentikan pemutaran musik', emoji: '⏹️' }
  ],
  green: [
    { label: 'g!play lofi', command: 'g!play lofi', description: 'Putar musik dengan Green-Bot', emoji: '🎵' },
    { label: 'g!skip', command: 'g!skip', description: 'Lewati lagu saat ini', emoji: '⏭️' },
    { label: 'g!queue', command: 'g!queue', description: 'Cek antrean lagu', emoji: '📜' }
  ],
  chip: [
    { label: 'ch!play lofi', command: 'ch!play lofi', description: 'Putar lagu lofi via Chip Music', emoji: '🎵' },
    { label: 'ch!skip', command: 'ch!skip', description: 'Lewati lagu saat ini', emoji: '⏭️' },
    { label: 'ch!pause', command: 'ch!pause', description: 'Jeda lagu', emoji: '⏸️' }
  ],

  // 3. Carl-bot / Dyno / MEE6 (Moderation & Utility)
  carl: [
    { label: '!rank', command: '!rank', description: 'Lihat peringkat level, rank, dan EXP kamu', emoji: '⭐' },
    { label: '!leaderboard', command: '!leaderboard', description: 'Tampilkan papan peringkat EXP tertinggi', emoji: '🏆' },
    { label: '!warn', command: '!warn', description: 'Beri peringatan ke member yang melanggar', emoji: '⚠️' },
    { label: '!serverinfo', command: '!serverinfo', description: 'Lihat informasi lengkap server Discord', emoji: 'ℹ️' },
    { label: '!botinfo', command: '!botinfo', description: 'Cek statistik performa dan uptime bot', emoji: '🤖' }
  ],
  dyno: [
    { label: '?rank', command: '?rank', description: 'Cek peringkat level kamu', emoji: '⭐' },
    { label: '?serverinfo', command: '?serverinfo', description: 'Lihat detail info server', emoji: 'ℹ️' }
  ],

  // 4. Truth or Dare
  truth: [
    { label: '/truth', command: '/truth', description: 'Minta pertanyaan jujur acak untuk dijawab', emoji: '🗣️' },
    { label: '/dare', command: '/dare', description: 'Minta tantangan seru acak untuk dilakukan', emoji: '🔥' },
    { label: '/paranoia', command: '/paranoia', description: 'Pertanyaan paranoia rahasia', emoji: '🤫' },
    { label: '/neverhaveiever', command: '/neverhaveiever', description: 'Game Pernah / Nggak Pernah', emoji: '🙈' }
  ],

  // 5. FreeStuff (Game Gratis)
  freestuff: [
    { label: '/free', command: '/free', description: 'Cek daftar game gratis (Steam/Epic) hari ini', emoji: '🎮' },
    { label: '/settings', command: '/settings', description: 'Lihat pengaturan notifikasi game gratis', emoji: '⚙️' }
  ],

  // 6. Kotoba (Kuis Kanji & Jepang)
  kotoba: [
    { label: 'k!quiz', command: 'k!quiz', description: 'Mulai sesi kuis kosakata bahasa Jepang', emoji: '🇯🇵' },
    { label: 'k!word', command: 'k!word', description: 'Cari arti kosakata kanji/romaji', emoji: '📖' }
  ],

  // 7. Dice Witch / Dice Roller (D&D Tabletop)
  dice: [
    { label: '/roll 1d20', command: '/roll 1d20', description: 'Lempar 1 dadu 20 sisi (D20 standard D&D)', emoji: '🎲' },
    { label: '/roll 2d6', command: '/roll 2d6', description: 'Lempar 2 dadu 6 sisi (2D6)', emoji: '🎲' },
    { label: '/roll 1d100', command: '/roll 1d100', description: 'Lempar dadu persentase (1-100)', emoji: '🎯' }
  ],

  // 8. TTS Bot
  tts: [
    { label: '/say Halo semuanya!', command: '/say Halo semuanya!', description: 'Ucapkan pesan teks ke Voice Channel', emoji: '🗣️' },
    { label: '/voices', command: '/voices', description: 'Lihat daftar suara TTS yang tersedia', emoji: '🎙️' }
  ],

  // 9. Pingcord
  pingcord: [
    { label: '/pingcord status', command: '/pingcord status', description: 'Cek status integrasi notifikasi Twitch/YouTube', emoji: '📡' }
  ]
};

/**
 * Match a bot to a verified preset by username or display name
 * @param {object} bot 
 * @returns {Array<object>|null}
 */
function matchVerifiedPreset(bot) {
  if (!bot) return null;
  const name = (bot.username + ' ' + bot.displayName).toLowerCase();

  if (name.includes('mudae')) return VERIFIED_BOT_PRESETS.mudae;
  if (name.includes('lofi') || name.includes('24/7')) return VERIFIED_BOT_PRESETS.lofi;
  if (name.includes('rythm') || name.includes('domba')) return VERIFIED_BOT_PRESETS.rythm;
  if (name.includes('jockie') || name.includes('ampun dj')) return VERIFIED_BOT_PRESETS.jockie;
  if (name.includes('green-bot') || name.includes('kambing')) return VERIFIED_BOT_PRESETS.green;
  if (name.includes('chip')) return VERIFIED_BOT_PRESETS.chip;
  if (name.includes('carl')) return VERIFIED_BOT_PRESETS.carl;
  if (name.includes('dyno')) return VERIFIED_BOT_PRESETS.dyno;
  if (name.includes('truth') || name.includes('dare')) return VERIFIED_BOT_PRESETS.truth;
  if (name.includes('freestuff') || name.includes('free stuff')) return VERIFIED_BOT_PRESETS.freestuff;
  if (name.includes('kotoba')) return VERIFIED_BOT_PRESETS.kotoba;
  if (name.includes('dice')) return VERIFIED_BOT_PRESETS.dice;
  if (name.includes('tts')) return VERIFIED_BOT_PRESETS.tts;
  if (name.includes('pingcord')) return VERIFIED_BOT_PRESETS.pingcord;

  return null;
}

/**
 * Autonomously analyze and learn a bot's features & commands using OpenAI GPT
 * @param {object} bot 
 * @returns {Promise<Array<object>>}
 */
async function analyzeAndLearnBot(bot) {
  if (!bot || !bot.id) return [];

  // Check cache first
  if (learnedBotsCache[bot.id] && learnedBotsCache[bot.id].length > 0) {
    return learnedBotsCache[bot.id];
  }

  // Check verified preset
  const preset = matchVerifiedPreset(bot);
  if (preset) {
    learnedBotsCache[bot.id] = preset;
    saveLearnedBots();
    return preset;
  }

  // Autonomous AI Learning for Unknown / Custom Bots
  console.log(`[Bot Knowledge AI]: 🔍 Analyzing features & commands for unknown bot "${bot.displayName}" (@${bot.username})...`);
  try {
    const prompt = `Analisa bot Discord berikut dan buatkan 5 sampai 7 daftar perintah (slash command atau prefix command yang paling umum dan berguna) yang didukung oleh bot ini.
Data Bot:
- Nama Tampilan: ${bot.displayName}
- Username: @${bot.username}
- Roles: ${bot.roles?.join(', ') || '-'}
- Kategori Fungsional: ${bot.category || 'Tools & Utilities'}

Berikan respon HANYA berupa JSON Array murni tanpa markdown, dengan format:
[
  {
    "label": "Nama perintah (contoh: /help atau !play)",
    "command": "Perintah teks lengkap yang siap dikirim (contoh: /help)",
    "description": "Penjelasan singkat fungsi perintah dalam bahasa Indonesia santai (maks 50 huruf)",
    "emoji": "Emoji yang cocok (contoh: ℹ️, 🎵, ⚙️, 🎮)"
  }
]`;

    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-5.6-luna',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 400
    });

    const raw = res.choices[0]?.message?.content?.trim() || '{}';
    let parsed = JSON.parse(raw);
    let commands = Array.isArray(parsed) ? parsed : (parsed.commands || parsed.perintah || Object.values(parsed)[0]);

    if (!Array.isArray(commands) || commands.length === 0) {
      commands = [
        { label: '/help', command: '/help', description: 'Lihat menu bantuan dan daftar fitur bot', emoji: 'ℹ️' },
        { label: '/info', command: '/info', description: 'Informasi status dan konfigurasi bot', emoji: '🤖' },
        { label: '!help', command: '!help', description: 'Tampilkan panduan prefix perintah', emoji: '📖' }
      ];
    }

    learnedBotsCache[bot.id] = commands.slice(0, 8);
    saveLearnedBots();
    console.log(`[Bot Knowledge AI]: ✅ Successfully learned ${commands.length} commands for "${bot.displayName}"!`);
    return learnedBotsCache[bot.id];

  } catch (err) {
    console.error(`[Bot Knowledge AI Error]: Failed to analyze bot ${bot.username}:`, err.message);
    const fallback = [
      { label: '/help', command: '/help', description: 'Bantuan dan daftar perintah bot', emoji: 'ℹ️' },
      { label: '!help', command: '!help', description: 'Panduan prefix bot', emoji: '📖' }
    ];
    return fallback;
  }
}

/**
 * Get commands list for a bot (combining verified presets, cached learning, or real-time AI analysis)
 * @param {object} bot 
 * @returns {Promise<Array<object>>}
 */
async function getBotCommands(bot) {
  if (!bot) return [];
  const preset = matchVerifiedPreset(bot);
  if (preset) return preset;

  if (learnedBotsCache[bot.id] && learnedBotsCache[bot.id].length > 0) {
    return learnedBotsCache[bot.id];
  }

  return await analyzeAndLearnBot(bot);
}

module.exports = {
  getBotCommands,
  analyzeAndLearnBot,
  VERIFIED_BOT_PRESETS
};
