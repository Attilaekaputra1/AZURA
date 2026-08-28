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
  reason: 'Manual VPS Optimization by Owner',
  scheduledSleep: {
    enabled: false,
    targetTimeStr: null, // e.g. "20:00"
    targetEpochMs: null, // target epoch ms for one-time schedule
    wakeTimeStr: null,   // e.g. "06:00"
    isDaily: false,      // recurring daily
    drowsyMinutes: 60    // starts 60 mins before sleep
  }
};

let schedulerInterval = null;

/**
 * Get current Jakarta Time (WIB) object
 */
function getWIBDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (7 * 3600000));
}

/**
 * Parse time string like "20:00", "20.00", "8 malam", "21:30", "1h", "30m"
 * @param {string} timeStr 
 * @returns {{ hours: number, minutes: number, targetEpochMs: number, label: string } | null}
 */
function parseScheduleTime(timeStr) {
  if (!timeStr) return null;
  const clean = timeStr.trim().toLowerCase();

  // Handle relative offset like "1h", "30m", "2 jam"
  const relMatch = clean.match(/^(\d+)\s*(m|menit|h|jam)$/i);
  if (relMatch) {
    const val = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const addMs = (unit.startsWith('h') || unit.startsWith('j')) ? val * 3600000 : val * 60000;
    const targetDate = new Date(Date.now() + addMs);
    const wibTarget = new Date(targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000) + (7 * 3600000));
    const hours = wibTarget.getHours();
    const minutes = wibTarget.getMinutes();
    const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} WIB`;
    return { hours, minutes, targetEpochMs: targetDate.getTime(), label };
  }

  // Handle "jam 8 malam", "8 pm", "jam 7 pagi", "7 am"
  let hours = -1;
  let minutes = 0;

  const verbalMatch = clean.match(/(?:jam\s*)?(\d{1,2})(?::(\d{2})|\.(\d{2}))?\s*(malam|sore|pagi|siang|pm|am)?/i);
  if (verbalMatch) {
    let rawHour = parseInt(verbalMatch[1], 10);
    minutes = parseInt(verbalMatch[2] || verbalMatch[3] || '0', 10);
    const period = (verbalMatch[4] || '').toLowerCase();

    if (period === 'malam' || period === 'pm') {
      if (rawHour < 12) rawHour += 12;
    } else if (period === 'sore') {
      if (rawHour < 12 && rawHour >= 1) rawHour += 12;
    } else if (period === 'siang') {
      if (rawHour === 12) rawHour = 12;
      else if (rawHour < 6) rawHour += 12;
    } else if (period === 'pagi' || period === 'am') {
      if (rawHour === 12) rawHour = 0;
    }

    if (rawHour >= 0 && rawHour <= 23 && minutes >= 0 && minutes <= 59) {
      hours = rawHour;
    }
  }

  if (hours === -1) return null;

  // Calculate target epoch ms for today or tomorrow (WIB)
  const nowWIB = getWIBDate();
  const targetWIB = new Date(nowWIB.getTime());
  targetWIB.setHours(hours, minutes, 0, 0);

  if (targetWIB.getTime() <= nowWIB.getTime()) {
    // Target is earlier today -> schedule for tomorrow
    targetWIB.setDate(targetWIB.getDate() + 1);
  }

  // Convert WIB target back to UTC epoch ms
  const offsetMs = targetWIB.getTime() - nowWIB.getTime();
  const targetEpochMs = Date.now() + offsetMs;
  const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} WIB`;

  return { hours, minutes, targetEpochMs, label };
}

/**
 * Load sleep state from disk
 */
function loadSleepState() {
  try {
    const loaded = readSecureJson(SLEEP_STATE_FILE, null);
    if (loaded && typeof loaded === 'object') {
      currentSleepState = {
        ...currentSleepState,
        ...loaded,
        scheduledSleep: {
          ...currentSleepState.scheduledSleep,
          ...(loaded.scheduledSleep || {})
        }
      };
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
 * Check if Azura is currently in the "Drowsy / Sleepy" phase (1 hour before scheduled sleep)
 * @returns {boolean}
 */
function isDrowsyPhase() {
  if (currentSleepState.isSleeping) return false;
  const sched = currentSleepState.scheduledSleep;
  if (!sched || !sched.enabled || !sched.targetEpochMs) return false;

  const now = Date.now();
  const msUntilSleep = sched.targetEpochMs - now;
  const drowsyWindowMs = (sched.drowsyMinutes || 60) * 60000;

  return msUntilSleep > 0 && msUntilSleep <= drowsyWindowMs;
}

/**
 * Get remaining minutes until scheduled sleep
 * @returns {number|null}
 */
function getMinutesUntilSleep() {
  const sched = currentSleepState.scheduledSleep;
  if (!sched || !sched.enabled || !sched.targetEpochMs) return null;
  const diffMs = sched.targetEpochMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 60000);
}

/**
 * Generate Drowsy / Sleepy personality prompt injection
 * @param {boolean} isOwner 
 * @param {string} userName 
 * @param {boolean} [isVoice=false] 
 * @returns {string}
 */
function getDrowsyPrompt(isOwner, userName, isVoice = false) {
  const sched = currentSleepState.scheduledSleep;
  const targetStr = sched?.targetTimeStr || 'sebentar lagi';
  const remainingMins = getMinutesUntilSleep() || 30;

  const audioTags = isVoice
    ? `\n- Gaya Vokal Suara (ElevenLabs Audio Tags):\n  • Sisipkan ekspresi menguap dan ngantuk natural: [yawns], [sleepy], [softly], [sighs], [chuckles].\n  • Intonasi: Lebih santai, sedikit mengantuk, tempo lebih santai dan rileks.`
    : `\n- Format Teks Chat Discord:\n  • Tunjukkan indikasi mengantuk alami seperti: "hoaaamm...", "aduh mulai ngantuk nih", "kelopak mata udah mulai berat", "bisa kita lanjutin besok yaa", "bentar lagi jam ${targetStr} aku mau tidur".\n  • Tetap ramah dan manis tanpa terkesan mengeluh kasar.`;

  return `
[💤 KONDISI FISIK SAAT INI: FASE MENGANTUK / PRE-SLEEP DROWSINESS ACTIVE]
- Jam Tidur Terjadwal: Pukul ${targetStr} (Sisa waktu: ~${remainingMins} menit).
- Indikasi Perilaku (Berlaku ke Attila & Semua Member):
  1. Mulai menunjukkan tanda-tanda mengantuk alami (menguap santai, mata berat, mulai relaks).
  2. Ingatkan secara natural dan santai bahwa sebentar lagi pukul ${targetStr} waktunya kamu tidur/istirahat untuk meredakan beban server.
  3. ${isOwner ? `Kepada Attila: Sampaikan dengan manja dan hangat ("Attila sayang, aku udah mulai ngantuk nih... jam ${targetStr} nanti aku izin tidur yaa").` : `Kepada ${userName}: Sampaikan dengan ramah dan santai ("Hooamm, udah mulai agak ngantuk nih... sebentar lagi jam ${targetStr} aku mau istirahat yaa").`}
  4. Tetap menjawab pertanyaan mereka dengan baik, namun ada nuansa rileks dan mengantuk.${audioTags}
`.trim();
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
  const isSystem = userId === 'SYSTEM_SCHEDULER';
  const isOwner = isSystem || (config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID);
  
  if (!isOwner) {
    return {
      success: false,
      message: '⛔ **[Akses Ditolak]** Fitur Sleep Mode secara prosedural hanya boleh dijalankan oleh Owner (Attila).'
    };
  }

  if (!isSystem && password !== SLEEP_PASSWORD) {
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

  // 1. Speak natural bedtime farewell in active Voice Channels (if any) BEFORE disconnecting
  try {
    const { sayBedtimeFarewellInActiveVCs, cleanupGuild } = require('./voiceCompanion');
    await sayBedtimeFarewellInActiveVCs(client).catch((err) => {
      console.warn('[Sleep Mode]: Bedtime farewell warning:', err.message);
    });

    for (const [guildId] of client.guilds.cache) {
      await cleanupGuild(guildId, client).catch(() => {});
    }
  } catch (err) {
    console.warn('[Sleep Mode]: Voice cleanup warning:', err.message);
  }

  // 2. Close active Headless Chromium browser instances to free VPS RAM
  try {
    const { closeBrowserSession } = require('./headlessBrowser');
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
        name: '🌙 Sedang Tidur (Deep Sleep Mode Active)',
        type: ActivityType.Custom
      }]
    });
  } catch (_) {}

  // 5. Save state
  currentSleepState.isSleeping = true;
  currentSleepState.sleepStartedAt = new Date().toISOString();
  currentSleepState.sleptBy = userId;
  currentSleepState.reason = reason;

  // If one-time schedule finished, disable scheduledSleep flag
  if (currentSleepState.scheduledSleep.enabled && !currentSleepState.scheduledSleep.isDaily) {
    currentSleepState.scheduledSleep.enabled = false;
    currentSleepState.scheduledSleep.targetEpochMs = null;
  }

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
      `Gunakan \`/sleep wake password:@Timetosleepara\` atau hubungi DM Owner.`
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
  const isSystem = userId === 'SYSTEM_SCHEDULER';
  const isOwner = isSystem || (config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID);
  
  if (!isOwner) {
    return {
      success: false,
      message: '⛔ **[Akses Ditolak]** Hanya Owner (Attila) yang dapat membangunkan AZURA.'
    };
  }

  if (!isSystem && password !== SLEEP_PASSWORD) {
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
  currentSleepState.isSleeping = false;
  currentSleepState.sleepStartedAt = null;
  currentSleepState.sleptBy = null;
  currentSleepState.reason = null;

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

/**
 * Schedule automated sleep with pre-sleep drowsy phase
 * @param {import('discord.js').Client} client 
 * @param {string} sleepTimeStr e.g. "20:00", "8 malam", "1h"
 * @param {string|null} [wakeTimeStr] e.g. "06:00"
 * @param {boolean} [isDaily=false] 
 * @param {string} password 
 * @param {string} userId 
 * @returns {Promise<{ success: boolean, message: string, embed?: EmbedBuilder }>}
 */
async function scheduleSleep(client, sleepTimeStr, wakeTimeStr = null, isDaily = false, password = '', userId = '') {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;
  if (!isOwner) {
    return {
      success: false,
      message: '⛔ **[Akses Ditolak]** Hanya Owner (Attila) yang dapat mengatur jadwal tidur AZURA.'
    };
  }

  if (password !== SLEEP_PASSWORD) {
    return {
      success: false,
      message: '🔒 **[Verifikasi Gagal]** Password prosedural salah! Akses ditolak.'
    };
  }

  const parsed = parseScheduleTime(sleepTimeStr);
  if (!parsed) {
    return {
      success: false,
      message: '❌ Format waktu tidur tidak valid! Contoh format yang benar: `20:00`, `8 malam`, `21.30`, atau `1h`.'
    };
  }

  currentSleepState.scheduledSleep = {
    enabled: true,
    targetTimeStr: parsed.label,
    targetEpochMs: parsed.targetEpochMs,
    wakeTimeStr: wakeTimeStr || null,
    isDaily: !!isDaily,
    drowsyMinutes: 60
  };

  saveSleepState();
  initSleepScheduler(client);

  const minsUntil = Math.max(1, Math.round((parsed.targetEpochMs - Date.now()) / 60000));
  const drowsyStartMs = parsed.targetEpochMs - (60 * 60000);
  const drowsyDate = new Date(drowsyStartMs + (7 * 3600000));
  const drowsyLabel = `${String(drowsyDate.getUTCHours()).padStart(2, '0')}:${String(drowsyDate.getUTCMinutes()).padStart(2, '0')} WIB`;

  console.log(`[Sleep Scheduler]: ⏰ Scheduled sleep at ${parsed.label} (in ${minsUntil} mins). Drowsy phase starts at ${drowsyLabel}.`);

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('⏰ Jadwal Tidur & Fase Mengantuk AZURA Diatur!')
    .setDescription(
      `Jadwal istirahat otomatis telah berhasil diatur:\n\n` +
      `🌙 **Waktu Tidur (Deep Sleep):** **${parsed.label}** (~${minsUntil} menit lagi)\n` +
      `🥱 **Fase Mengantuk Dimulai:** **${drowsyLabel}** (1 jam sebelum tidur)\n` +
      `🔄 **Tipe Jadwal:** ${isDaily ? '🔁 Setiap Hari (Rutin)' : '⏳ Sekali (Hari Ini)'}\n` +
      `☀️ **Rencana Bangun:** ${wakeTimeStr ? `Pukul ${wakeTimeStr} WIB` : 'Manual via `/sleep wake`'}\n\n` +
      `💡 *Mulai pukul ${drowsyLabel}, Ara akan mulai menunjukkan respon mengantuk alami di chat dan VC ke semua orang!*`
    )
    .setFooter({ text: 'AZURA Sleep Scheduler • Procedural Active' })
    .setTimestamp();

  return {
    success: true,
    message: `⏰ Jadwal tidur berhasil diset pada ${parsed.label}!`,
    embed
  };
}

/**
 * Cancel scheduled sleep
 * @param {string} password 
 * @param {string} userId 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function cancelScheduledSleep(password, userId) {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;
  if (!isOwner) {
    return {
      success: false,
      message: '⛔ **[Akses Ditolak]** Hanya Owner (Attila) yang dapat membatalkan jadwal tidur AZURA.'
    };
  }

  if (password !== SLEEP_PASSWORD) {
    return {
      success: false,
      message: '🔒 **[Verifikasi Gagal]** Password prosedural salah! Akses ditolak.'
    };
  }

  currentSleepState.scheduledSleep = {
    enabled: false,
    targetTimeStr: null,
    targetEpochMs: null,
    wakeTimeStr: null,
    isDaily: false,
    drowsyMinutes: 60
  };

  saveSleepState();
  console.log('[Sleep Scheduler]: 🚫 Scheduled sleep cancelled by Owner.');

  return {
    success: true,
    message: '✅ Jadwal tidur otomatis AZURA berhasil dibatalkan!'
  };
}

/**
 * Background Scheduler Worker: Periodically checks for sleep and wake triggers
 * @param {import('discord.js').Client} client 
 */
function initSleepScheduler(client) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  schedulerInterval = setInterval(async () => {
    try {
      const sched = currentSleepState.scheduledSleep;
      if (!sched || !sched.enabled) return;

      const now = Date.now();

      // Check if Target Sleep Time reached
      if (!currentSleepState.isSleeping && sched.targetEpochMs && now >= sched.targetEpochMs) {
        console.log(`[Sleep Scheduler]: ⏰ Target sleep time reached (${sched.targetTimeStr}). Putting AZURA to sleep...`);
        await enterSleepMode(client, SLEEP_PASSWORD, 'SYSTEM_SCHEDULER', `Jadwal Tidur Terjadwal (${sched.targetTimeStr})`);
      }

      // Check Wake Time if configured
      if (currentSleepState.isSleeping && sched.wakeTimeStr) {
        const parsedWake = parseScheduleTime(sched.wakeTimeStr);
        if (parsedWake && Math.abs(now - parsedWake.targetEpochMs) < 60000) {
          console.log(`[Sleep Scheduler]: ☀️ Target wake time reached (${sched.wakeTimeStr}). Waking up AZURA...`);
          await wakeUpAzura(client, SLEEP_PASSWORD, 'SYSTEM_SCHEDULER');
        }
      }
    } catch (err) {
      console.error('[Sleep Scheduler Error]:', err.message);
    }
  }, 15000); // Check every 15 seconds
}

module.exports = {
  SLEEP_PASSWORD,
  isAzuraSleeping,
  getSleepState,
  isDrowsyPhase,
  getDrowsyPrompt,
  getMinutesUntilSleep,
  enterSleepMode,
  wakeUpAzura,
  scheduleSleep,
  cancelScheduledSleep,
  initSleepScheduler
};
