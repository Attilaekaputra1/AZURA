const fs = require('fs');
const path = require('path');
const { ActivityType, EmbedBuilder } = require('discord.js');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const SLEEP_STATE_FILE = path.join(__dirname, '../data/sleep_mode.enc');
const SLEEP_PASSWORD = '@Timetosleepara';

let currentSleepState = {
  isSleeping: false,
  sleepStartedAt: null,
  sleptBy: null,
  reason: 'Manual VPS Optimization by Owner'
};

/**
 * Load sleep state from disk
 */
function loadSleepState() {
  try {
    const loaded = readSecureJson(SLEEP_STATE_FILE, null);
    if (loaded && typeof loaded === 'object') {
      currentSleepState = loaded;
    }
  } catch (err) {
    console.error('[Sleep Mode Error]: Failed to load sleep state:', err.message);
  }
}

/**
 * Save sleep state to disk
 */
function saveSleepState() {
  try {
    writeSecureJson(SLEEP_STATE_FILE, currentSleepState);
  } catch (err) {
    console.error('[Sleep Mode Error]: Failed to save sleep state:', err.message);
  }
}

// Initial load
loadSleepState();

/**
 * Check if Azura is currently in sleep mode
 * @returns {boolean}
 */
function isAzuraSleeping() {
  return !!currentSleepState.isSleeping;
}

/**
 * Get current sleep status details
 * @returns {object}
 */
function getSleepState() {
  return { ...currentSleepState };
}

/**
 * Put Azura into deep sleep mode
 * @param {import('discord.js').Client} client 
 * @param {string} password 
 * @param {string} userId 
 * @param {string} [reason] 
 * @returns {Promise<{ success: boolean, message: string, embed?: EmbedBuilder }>}
 */
async function enterSleepMode(client, password, userId, reason = 'Meredakan kinerja VPS & Optimasi Memori') {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;
  if (!isOwner) {
    return {
      success: false,
      message: '⛔ **[Akses Ditolak]** Fitur Sleep Mode secara prosedural hanya boleh dijalankan oleh Owner (Attila).'
    };
  }

  if (password !== SLEEP_PASSWORD) {
    console.warn(`[Sleep Mode Security]: ❌ Invalid sleep password attempt from UID ${userId}`);
    return {
      success: false,
      message: '🔒 **[Verifikasi Gagal]** Password prosedural Sleep Mode salah! Akses ditolak.'
    };
  }

  if (currentSleepState.isSleeping) {
    return {
      success: false,
      message: '🌙 AZURA saat ini sudah berada dalam **Mode Tidur (Sleep Mode)**.'
    };
  }

  console.log(`[Sleep Mode]: 🌙 Putting AZURA into Deep Sleep Mode. Reason: "${reason}"...`);

  // 1. Disconnect and cleanup all Voice Channels
  try {
    const { cleanupGuild } = require('./voiceCompanion');
    for (const [guildId] of client.guilds.cache) {
      await cleanupGuild(guildId, client).catch(() => {});
    }
  } catch (err) {
    console.warn('[Sleep Mode]: Voice cleanup warning:', err.message);
  }

  // 2. Close active Headless Chromium browser instances to free VPS RAM
  try {
    const { activeBrowserSessions, closeBrowserSession } = require('./headlessBrowser');
    for (const [guildId] of client.guilds.cache) {
      await closeBrowserSession(guildId).catch(() => {});
    }
  } catch (err) {
    console.warn('[Sleep Mode]: Browser cleanup warning:', err.message);
  }

  // 3. Stop Background Intervals & Workers
  try {
    const { stopBotHealthMonitor } = require('./botOrchestrator');
    if (typeof stopBotHealthMonitor === 'function') {
      stopBotHealthMonitor();
    }
  } catch (_) {}

  // 4. Update Discord Presence to Idle / Sleeping Status
  try {
    client.user?.setPresence({
      status: 'idle',
      activities: [{
        name: '🌙 Sedang Istirahat / Sleep Mode (VPS Optimized)',
        type: ActivityType.Custom
      }]
    });
  } catch (_) {}

  // 5. Save state
  currentSleepState = {
    isSleeping: true,
    sleepStartedAt: new Date().toISOString(),
    sleptBy: userId,
    reason
  };
  saveSleepState();

  const memUsage = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
  console.log(`[Sleep Mode]: ✅ AZURA is now ASLEEP. RAM footprint: ${memUsage} MB.`);

  const embed = new EmbedBuilder()
    .setColor(0x2C2F33)
    .setTitle('🌙 AZURA Masuk ke Mode Tidur (Deep Sleep Mode Active)')
    .setDescription(
      `Sistem AZURA telah dinonaktifkan secara prosedural untuk meredakan beban VPS & mengoptimalkan memori:\n\n` +
      `🛑 **Status Fitur yang Ditidurkan:**\n` +
      `• **Voice Channel & Auto-Follow:** Terputus & Dihentikan total\n` +
      `• **Respon Chat Server & DM:** Nonaktif (Semua trigger di-bypass)\n` +
      `• **Headless Chromium & Live Stream:** Ditutup & RAM dibebaskan\n` +
      `• **Autonomous Catalyst & Health Monitor:** Suspended\n` +
      `• **Penggunaan RAM Saat Ini:** \`${memUsage} MB\` (Ultra Low Idle)\n\n` +
      `🔐 **Cara Membangunkan:**\n` +
      `Gunakan \`/sleep aksi:bangun password:@Timetosleepara\` atau hubungi DM Owner.`
    )
    .setFooter({ text: 'AZURA System Sleep Engine • Procedural Password Verified' })
    .setTimestamp();

  return {
    success: true,
    message: '🌙 AZURA berhasil masuk ke Mode Tidur!',
    embed
  };
}

/**
 * Wake up Azura from sleep mode
 * @param {import('discord.js').Client} client 
 * @param {string} password 
 * @param {string} userId 
 * @returns {Promise<{ success: boolean, message: string, embed?: EmbedBuilder }>}
 */
async function wakeUpAzura(client, password, userId) {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;
  if (!isOwner) {
    return {
      success: false,
      message: '⛔ **[Akses Ditolak]** Hanya Owner (Attila) yang dapat membangunkan AZURA.'
    };
  }

  if (password !== SLEEP_PASSWORD) {
    console.warn(`[Sleep Mode Security]: ❌ Invalid wake password attempt from UID ${userId}`);
    return {
      success: false,
      message: '🔒 **[Verifikasi Gagal]** Password prosedural salah! Akses ditolak.'
    };
  }

  if (!currentSleepState.isSleeping) {
    return {
      success: false,
      message: '☀️ AZURA saat ini sudah dalam keadaan **Aktif (Online)**.'
    };
  }

  console.log('[Sleep Mode]: ☀️ Waking up AZURA from Deep Sleep Mode...');

  // 1. Resume Bot Health Monitor
  try {
    const { initBotHealthMonitor } = require('./botOrchestrator');
    initBotHealthMonitor(client);
  } catch (err) {
    console.warn('[Sleep Mode]: Bot health monitor resume error:', err.message);
  }

  // 2. Restore Discord Presence
  try {
    client.user?.setPresence({
      status: 'online',
      activities: [{
        name: 'Bersama Attila & Server 🌸',
        type: ActivityType.Custom
      }]
    });
  } catch (_) {}

  const sleepDurationMs = Date.now() - new Date(currentSleepState.sleepStartedAt).getTime();
  const sleepDurationMins = Math.floor(sleepDurationMs / 60000);

  // 3. Reset sleep state
  currentSleepState = {
    isSleeping: false,
    sleepStartedAt: null,
    sleptBy: null,
    reason: null
  };
  saveSleepState();

  console.log(`[Sleep Mode]: ✅ AZURA is now WIDE AWAKE (Slept for ${sleepDurationMins} minutes).`);

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('☀️ AZURA Telah Bangun & Siap Beroperasi!')
    .setDescription(
      `Selamat datang kembali! Seluruh sistem, listener, dan fitur AZURA telah diaktifkan kembali secara normal.\n\n` +
      `⏱️ **Durasi Istirahat:** \`${sleepDurationMins} menit\`\n` +
      `✨ **Status Sistem:** \`100% ONLINE & OPTIMIZED\``
    )
    .setFooter({ text: 'AZURA System Sleep Engine • Wake Verified' })
    .setTimestamp();

  return {
    success: true,
    message: '☀️ AZURA telah bangun dan siap beroperasi kembali!',
    embed
  };
}

module.exports = {
  SLEEP_PASSWORD,
  isAzuraSleeping,
  getSleepState,
  enterSleepMode,
  wakeUpAzura
};
