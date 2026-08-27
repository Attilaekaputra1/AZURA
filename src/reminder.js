const fs = require('fs');
const path = require('path');
const https = require('https');
const { readSecureJson, writeSecureJson } = require('./security');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'reminders.enc');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load initial reminders
function loadReminders() {
  try {
    return readSecureJson(FILE_PATH, []);
  } catch {
    return [];
  }
}

// Save reminders
function saveReminders(reminders) {
  try {
    writeSecureJson(FILE_PATH, reminders);
  } catch (err) {
    console.error('[AZURA Reminder Save Error]:', err.message);
  }
}

/**
 * Add a new reminder
 * @param {string} userId 
 * @param {string} channelId 
 * @param {number} delayMs 
 * @param {string} text 
 */
function addReminder(userId, channelId, delayMs, text) {
  const reminders = loadReminders();
  const targetTime = Date.now() + delayMs;
  const newReminder = {
    id: Date.now().toString(36),
    userId,
    channelId,
    targetTime,
    text
  };
  reminders.push(newReminder);
  saveReminders(reminders);
  return newReminder;
}

/**
 * Fetch Live Prayer Times from Aladhan API (Real-Time WIB)
 * @param {string} prayerName 
 * @returns {Promise<string|null>} e.g. "04:35"
 */
async function getPrayerTime(prayerName) {
  const defaults = {
    'subuh': '04:35',
    'fajr': '04:35',
    'dzuhur': '12:05',
    'zuhur': '12:05',
    'dhuhr': '12:05',
    'ashar': '15:20',
    'asar': '15:20',
    'asr': '15:20',
    'maghrib': '18:08',
    'isya': '19:20',
    'isha': '19:20'
  };

  const key = prayerName.toLowerCase();

  return new Promise((resolve) => {
    https.get('https://api.aladhan.com/v1/timingsByCity?city=Jakarta&country=Indonesia', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data.timings) {
            const timings = json.data.timings;
            const map = {
              'subuh': timings.Fajr,
              'fajr': timings.Fajr,
              'dzuhur': timings.Dhuhr,
              'zuhur': timings.Dhuhr,
              'dhuhr': timings.Dhuhr,
              'ashar': timings.Asr,
              'asar': timings.Asr,
              'asr': timings.Asr,
              'maghrib': timings.Maghrib,
              'isya': timings.Isha,
              'isha': timings.Isha
            };
            resolve(map[key] || defaults[key] || null);
          } else {
            resolve(defaults[key] || null);
          }
        } catch {
          resolve(defaults[key] || null);
        }
      });
    }).on('error', () => resolve(defaults[key] || null)).setTimeout(4000, function() {
      this.destroy();
      resolve(defaults[key] || null);
    });
  });
}

/**
 * Format milliseconds into readable duration string (e.g. "4 jam 15 menit")
 * @param {number} ms 
 * @returns {string}
 */
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} jam`);
  if (minutes > 0) parts.push(`${minutes} menit`);
  if (parts.length === 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds} detik`);

  return parts.join(' ');
}

/**
 * Smart Reminder Processor for Chat Prompts
 * Automatically detects prayer times, specific clock times, or relative durations.
 * @param {string} userId 
 * @param {string} channelId 
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function processSmartReminder(userId, arg2, arg3) {
  let channelId = typeof arg2 === 'string' && /^\d{17,20}$/.test(arg2) ? arg2 : (typeof arg3 === 'string' && /^\d{17,20}$/.test(arg3) ? arg3 : null);
  let prompt = typeof arg2 === 'string' && !/^\d{17,20}$/.test(arg2) ? arg2 : (typeof arg3 === 'string' ? arg3 : '');
  if (!prompt || typeof prompt !== 'string') return null;
  const lower = prompt.toLowerCase().trim();

  // Guard: Must contain reminder intent keyword
  const isReminderIntent = lower.includes('ingetin') ||
                           lower.includes('remind') ||
                           lower.includes('ingatkan') ||
                           lower.includes('ingat kan') ||
                           lower.includes('ingatin');

  if (!isReminderIntent) return null;

  console.log(`[Reminder Engine]: Analyzing prompt for natural reminder request: "${prompt.slice(0, 50)}..."`);

  // Scenario 1: Prayer Time Reminders (e.g. "ingetin shalat subuh", "remind me sholat maghrib")
  const prayerMatch = lower.match(/(?:shalat|sholat|waktu)?\s*(subuh|fajr|dzuhur|zuhur|dhuhr|ashar|asar|asr|maghrib|isya)\b/i);
  if (prayerMatch) {
    const prayerName = prayerMatch[1].toLowerCase();
    const timingStr = await getPrayerTime(prayerName); // e.g. "04:35"

    if (timingStr) {
      const [p = '00', pMinStr] = timingStr.split(':');
      const targetHour = parseInt(p, 10);
      const targetMinute = parseInt(pMinStr.slice(0, 2), 10);

      const now = new Date();
      // Calculate delay in Asia/Jakarta timezone
      const jakartaNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const targetDate = new Date(jakartaNow);
      targetDate.setHours(targetHour, targetMinute, 0, 0);

      let delayMs = targetDate.getTime() - jakartaNow.getTime();
      let dayDesc = 'hari ini';

      if (delayMs <= 0) {
        // If prayer time passed today, set for tomorrow
        targetDate.setDate(targetDate.getDate() + 1);
        delayMs = targetDate.getTime() - jakartaNow.getTime();
        dayDesc = 'besok pagi/hari';
      }

      const reminderTitle = `Waktu Shalat ${prayerName.toUpperCase()}`;
      addReminder(userId, channelId, delayMs, reminderTitle);

      const readableDelay = formatDuration(delayMs);
      console.log(`[Reminder Engine]: Set prayer reminder for ${prayerName} in ${readableDelay}`);

      return `⏰ **Pengingat Otomatis Berhasil Diaktifkan!**\n- Event: Shalat ${prayerName.toUpperCase()}\n- Jadwal Real-Time: Pukul ${timingStr} WIB (${dayDesc})\n- Durasi Pengingat: Dalam ${readableDelay}\n- AZURA akan otomatis nge-tag kamu di channel ini begitu waktunya tiba.`;
    }
  }

  // Scenario 2: Relative Duration (e.g. "ingetin 30 menit lagi angkat jemuran")
  const relMatch = lower.match(/(\d+)\s*(detik|sec|menit|min|jam|hour|hari|d)\s*(?:lagi)?\s*(.*)/i);
  if (relMatch) {
    const num = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const messageText = relMatch[3].trim() || 'Pengingat Kamu';

    const multipliers = {
      'detik': 1000, 'sec': 1000,
      'menit': 60000, 'min': 60000,
      'jam': 3600000, 'hour': 3600000,
      'hari': 86400000, 'd': 86400000
    };

    const mult = multipliers[unit] || 60000;
    const delayMs = num * mult;

    if (delayMs >= 10000 && delayMs <= 86400000 * 7) {
      addReminder(userId, channelId, delayMs, messageText);
      const readableDelay = formatDuration(delayMs);

      return `⏰ **Pengingat Berhasil Dicatat!**\n- Pesan: "${messageText}"\n- Waktu: Dalam ${readableDelay}\n- AZURA akan ingetin kamu tepat waktu ya!`;
    }
  }

  // Scenario 3: Specific Clock Time (e.g. "ingetin jam 5 sore ada meeting", "ingetin jam 14:30")
  const clockMatch = lower.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?\s*(.*)/i);
  if (clockMatch) {
    let hour = parseInt(clockMatch[1], 10);
    const minute = clockMatch[2] ? parseInt(clockMatch[2], 10) : 0;
    const period = clockMatch[3] ? clockMatch[3].toLowerCase() : null;
    const taskText = clockMatch[4].trim() || 'Pengingat Jadwal';

    if (period === 'sore' || period === 'malam') {
      if (hour < 12) hour += 12;
    } else if (period === 'siang') {
      if (hour < 12 && hour !== 12) hour += 12;
    } else if (period === 'pagi') {
      if (hour === 12) hour = 0;
    }

    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      const now = new Date();
      const jakartaNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const targetDate = new Date(jakartaNow);
      targetDate.setHours(hour, minute, 0, 0);

      let delayMs = targetDate.getTime() - jakartaNow.getTime();
      let dayDesc = 'hari ini';

      if (delayMs <= 0) {
        targetDate.setDate(targetDate.getDate() + 1);
        delayMs = targetDate.getTime() - jakartaNow.getTime();
        dayDesc = 'besok';
      }

      addReminder(userId, channelId, delayMs, taskText);
      const timeFormatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const readableDelay = formatDuration(delayMs);

      return `⏰ **Pengingat Berhasil Dicatat!**\n- Jadwal: Pukul ${timeFormatted} WIB (${dayDesc})\n- Pesan: "${taskText}"\n- Durasi: Dalam ${readableDelay}`;
    }
  }

  return null;
}

/**
 * Initialize background checker for due reminders
 * @param {import('discord.js').Client} client 
 */
function initReminderChecker(client) {
  setInterval(async () => {
    const reminders = loadReminders();
    if (reminders.length === 0) return;

    const now = Date.now();
    const remaining = [];

    for (const r of reminders) {
      if (r.targetTime <= now) {
        try {
          const channel = await client.channels.fetch(r.channelId).catch(() => null);
          if (channel) {
            await channel.send(`⏰ <@${r.userId}> **Pengingat dari AZURA**: ${r.text}`);
          }
        } catch (err) {
          console.error('[AZURA Reminder Delivery Error]:', err.message);
        }
      } else {
        remaining.push(r);
      }
    }

    if (remaining.length !== reminders.length) {
      saveReminders(remaining);
    }
  }, 15000); // Check every 15 seconds
}

module.exports = {
  addReminder,
  initReminderChecker,
  processSmartReminder
};
