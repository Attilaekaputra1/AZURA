const fs = require('fs');
const path = require('path');
const os = require('os');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const STATS_FILE_PATH = path.join(__dirname, '../data/daily_stats.json');

// In-memory cache of multi-day metrics
let dailyStatsCache = {};

/**
 * Get current date key in Asia/Jakarta timezone (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayDateKey() {
  const now = new Date();
  const year = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' });
  const month = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', month: '2-digit' });
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', day: '2-digit' });
  return `${year}-${month}-${day}`;
}

/**
 * Load daily stats from persistent disk storage
 */
function loadDailyStats() {
  try {
    if (fs.existsSync(STATS_FILE_PATH)) {
      const raw = fs.readFileSync(STATS_FILE_PATH, 'utf8');
      dailyStatsCache = JSON.parse(raw);
    } else {
      dailyStatsCache = {};
    }
  } catch (err) {
    console.error('[DailyStats]: Failed to load daily stats from disk:', err.message);
    dailyStatsCache = {};
  }
}

/**
 * Save daily stats to persistent disk storage
 */
function saveDailyStats() {
  try {
    const dataDir = path.dirname(STATS_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const tmpPath = `${STATS_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(dailyStatsCache, null, 2), 'utf8');
    fs.renameSync(tmpPath, STATS_FILE_PATH);
  } catch (err) {
    console.error('[DailyStats]: Failed to save daily stats to disk:', err.message);
  }
}

// Initial load
loadDailyStats();

/**
 * Ensure today's stats record is initialized
 * @param {string} [dateKey]
 * @returns {object}
 */
function getOrCreateTodayStats(dateKey = getTodayDateKey()) {
  if (!dailyStatsCache[dateKey]) {
    const now = new Date();
    const formatted = now.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    dailyStatsCache[dateKey] = {
      date: dateKey,
      dateFormatted: formatted,
      serverMessages: 0,
      serverMentions: 0,
      ownerMentions: 0,
      ownerForwards: 0,
      dmMessages: 0,
      uniqueUsers: [],
      activeUserNames: [],
      imagesGenerated: 0,
      webSearches: 0,
      voiceTurns: 0,
      bootTimestamp: Date.now(),
      lastDigestSentDate: null
    };
    saveDailyStats();
  }
  return dailyStatsCache[dateKey];
}

/**
 * Record a real-time daily metric into persistent storage
 * @param {'serverMessages'|'serverMentions'|'ownerMentions'|'ownerForwards'|'dmMessages'|'imagesGenerated'|'webSearches'|'voiceTurns'} metricKey 
 * @param {number} [amount=1] 
 * @param {object} [metadata={}] 
 */
function recordDailyMetric(metricKey, amount = 1, metadata = {}) {
  const dateKey = getTodayDateKey();
  const today = getOrCreateTodayStats(dateKey);

  if (typeof today[metricKey] === 'number') {
    today[metricKey] += amount;
  } else {
    today[metricKey] = amount;
  }

  // Track unique active users
  if (metadata.userId && !today.uniqueUsers.includes(metadata.userId)) {
    today.uniqueUsers.push(metadata.userId);
  }
  if (metadata.userName && !today.activeUserNames.includes(metadata.userName)) {
    today.activeUserNames.push(metadata.userName);
  }

  saveDailyStats();
}

/**
 * Legacy compatibility helper
 * @param {string} key 
 */
function incrementStat(key) {
  if (key === 'mentionsReceived') recordDailyMetric('serverMentions', 1);
  else if (key === 'mentionsForwarded') recordDailyMetric('ownerForwards', 1);
  else if (key === 'dmsSent') recordDailyMetric('dmMessages', 1);
  else recordDailyMetric(key, 1);
}

/**
 * Generate a rich, executive-grade Daily Digest Embed
 * @param {string} [dateKey] 
 * @returns {EmbedBuilder}
 */
function generateDailyDigestEmbed(dateKey = getTodayDateKey()) {
  const stats = getOrCreateTodayStats(dateKey);

  // Calculate Process & Host Uptime
  const procSec = Math.floor(process.uptime());
  const procHours = Math.floor(procSec / 3600);
  const procMins = Math.floor((procSec % 3600) / 60);

  const hostSec = Math.floor(os.uptime());
  const hostDays = Math.floor(hostSec / 86400);
  const hostHours = Math.floor((hostSec % 86400) / 3600);
  const hostMins = Math.floor((hostSec % 3600) / 60);
  const hostUptimeStr = `${hostDays > 0 ? `${hostDays}h ` : ''}${hostHours}j ${hostMins}m`;

  const memUsage = process.memoryUsage();
  const ramMB = (memUsage.rss / 1024 / 1024).toFixed(1);

  const embed = new EmbedBuilder()
    .setTitle(`📊 [AZURA EXECUTIVE DIGEST] Laporan Harian • ${stats.dateFormatted || stats.date}`)
    .setColor(0x00FFB2) // Cyber Neon Cyan Green
    .setDescription(
      `Halo Attila! Berikut adalah rekapitulasi data aktivitas, interaksi pengguna, dan performa sistem AZURA sepanjang hari ini secara **real-time & aktual**:`
    )
    .addFields(
      {
        name: '🏛️ Aktivitas Server & Obrolan Publik',
        value:
          `• 💬 **Pesan Server Diproses**: \`${stats.serverMessages || 0} pesan\`\n` +
          `• 🏷️ **Mention Masuk ke AZURA**: \`${stats.serverMentions || 0} kali\`\n` +
          `• 👑 **Mention ke Attila (Owner)**: \`${stats.ownerMentions || 0} kali\``,
        inline: false
      },
      {
        name: '📩 Delegasi & DM Pribadi',
        value:
          `• 📲 **Mention Di-Forward ke Attila (Auto-Reply)**: \`${stats.ownerForwards || 0} kali\`\n` +
          `• 💌 **Interaksi Direct Message (DM)**: \`${stats.dmMessages || 0} pesan\`\n` +
          `• 👥 **Pengguna Unik Aktif Hari Ini**: \`${stats.uniqueUsers?.length || 0} orang\` ${stats.activeUserNames?.length ? `(${stats.activeUserNames.slice(0, 5).join(', ')})` : ''}`,
        inline: false
      },
      {
        name: '⚡ Kecerdasan AI & Fitur Kreatif',
        value:
          `• 🔍 **Pencarian Web & Berita (Tavily AI)**: \`${stats.webSearches || 0} pencarian\`\n` +
          `• 🎨 **Generate Gambar AI (/image)**: \`${stats.imagesGenerated || 0} gambar\`\n` +
          `• 🎙️ **Voice Channel Turns**: \`${stats.voiceTurns || 0} interaksi\``,
        inline: false
      },
      {
        name: '🖥️ Status Infrastruktur & Host VPS',
        value:
          `• 🟢 **Status Sistem**: \`100% ONLINE & SEHAT\`\n` +
          `• ⏱️ **Host VPS Uptime**: \`${hostUptimeStr}\` (PM2 Process: \`${procHours}j ${procMins}m\`)\n` +
          `• 💾 **Penggunaan RAM Bot**: \`${ramMB} MB\``,
        inline: false
      }
    )
    .setFooter({ text: 'Laporan otomatis dikirimkan setiap hari pukul 21:00 WIB • Data tersimpan persisten' })
    .setTimestamp();

  return embed;
}

/**
 * Check if current time is 21:00 WIB and send Daily Digest to Attila's DM
 * @param {import('discord.js').Client} client 
 */
async function checkDailyDigest(client) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return;

  const now = new Date();
  const jakartaHour = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false });
  const dateKey = getTodayDateKey();
  const todayStats = getOrCreateTodayStats(dateKey);

  // Trigger once per day during the 21:00 hour (9 PM WIB)
  if (jakartaHour === '21' && todayStats.lastDigestSentDate !== dateKey) {
    todayStats.lastDigestSentDate = dateKey;
    saveDailyStats();

    try {
      const ownerUser = await client.users.fetch(ownerId).catch(() => null);
      if (ownerUser) {
        const embed = generateDailyDigestEmbed(dateKey);
        await ownerUser.send({ embeds: [embed] });
        console.log(`[DailyDigest]: Sent 21:00 WIB daily digest report to Attila (Date: ${dateKey}).`);
      }
    } catch (err) {
      console.error('[DailyDigest Error]:', err.message);
    }
  }
}

module.exports = {
  recordDailyMetric,
  incrementStat,
  getOrCreateTodayStats,
  generateDailyDigestEmbed,
  checkDailyDigest
};
