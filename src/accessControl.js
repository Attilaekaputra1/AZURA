const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const DATA_DIR = path.join(__dirname, '..', 'data');
const APPROVED_FRIENDS_FILE = path.join(DATA_DIR, 'approved_friends.enc');
const MAX_DAILY_VOICE_SECONDS = 120; // 2 minutes max per 24 hours per friend
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache: userId -> FriendRecord
let approvedFriendsCache = new Map();

/**
 * Load approved friends from encrypted disk
 */
function loadApprovedFriends() {
  try {
    const data = readSecureJson(APPROVED_FRIENDS_FILE, {});
    approvedFriendsCache.clear();
    for (const [uid, record] of Object.entries(data)) {
      approvedFriendsCache.set(uid, record);
    }
  } catch (err) {
    console.error('[AccessControl Error]: Failed to read secure approved_friends.enc:', err.message);
  }
}

/**
 * Save approved friends to encrypted disk atomically
 */
function saveApprovedFriends() {
  try {
    const data = Object.fromEntries(approvedFriendsCache);
    writeSecureJson(APPROVED_FRIENDS_FILE, data);
  } catch (err) {
    console.error('[AccessControl Error]: Failed to save secure approved_friends.enc:', err.message);
  }
}

// Initial load
loadApprovedFriends();

/**
 * Check if a user is an approved friend (or the owner)
 * @param {string} userId 
 * @returns {boolean}
 */
function isApprovedFriend(userId) {
  if (!userId) return false;
  if (userId === config.OWNER_DISCORD_ID) return true;
  loadApprovedFriends();
  return approvedFriendsCache.has(userId);
}

/**
 * Get approved friend record
 * @param {string} userId 
 * @returns {object|null}
 */
function getApprovedFriend(userId) {
  loadApprovedFriends();
  return approvedFriendsCache.get(userId) || null;
}

/**
 * Format milliseconds into human readable countdown string (e.g. "14 Jam 28 Menit")
 * @param {number} ms 
 * @returns {string}
 */
function formatCountdown(ms) {
  if (ms <= 0) return '0 Menit';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} Jam`);
  if (minutes > 0) parts.push(`${minutes} Menit`);
  if (hours === 0 && seconds > 0) parts.push(`${seconds} Detik`);
  return parts.join(' ') || '1 Menit';
}

const EXHAUSTION_THRESHOLD_SECONDS = 8; // Sisa <= 8 detik dianggap habis & mulai 24h countdown

/**
 * Check a friend's daily 2-minute voice quota.
 * Countdown 24 JAM HANYA BERJALAN KETIKA KUOTA BENAR-BENAR HABIS (Sisa <= 8s).
 * Selama kuota masih tersisa > 8s, countdown belum aktif.
 * @param {string} userId 
 * @returns {{ allowed: boolean, usedSeconds: number, remainingSeconds: number, maxDailySeconds: number, isExhausted: boolean, resetAt: number|null, timeLeftStr: string, resetAtStr: string }}
 */
function checkFriendDailyVoiceQuota(userId) {
  loadApprovedFriends();
  const friend = approvedFriendsCache.get(userId);
  if (!friend) {
    return {
      allowed: false,
      usedSeconds: 0,
      remainingSeconds: 0,
      maxDailySeconds: MAX_DAILY_VOICE_SECONDS,
      isExhausted: false,
      resetAt: null,
      timeLeftStr: '0 Menit',
      resetAtStr: '-'
    };
  }

  const now = Date.now();
  let quota = friend.quota || {
    usedSeconds: 0,
    maxDailySeconds: MAX_DAILY_VOICE_SECONDS,
    exhaustedAt: null,
    warned80Sent: false,
    warned100Sent: false
  };

  // Check if 24-hour lockout cooldown has completed
  if (quota.exhaustedAt && (now - quota.exhaustedAt >= RESET_WINDOW_MS)) {
    quota.usedSeconds = 0;
    quota.exhaustedAt = null;
    quota.warned80Sent = false;
    quota.warned100Sent = false;
    friend.quota = quota;
    saveApprovedFriends();
    console.log(`[Friend Quota Engine]: 🔄 24-Hour cooldown completed for friend ${userId}. Quota reset to 0s/120s.`);
  }

  const usedSeconds = Math.round(quota.usedSeconds || 0);
  const remainingSeconds = Math.max(0, MAX_DAILY_VOICE_SECONDS - usedSeconds);
  const shouldExhaust = remainingSeconds <= EXHAUSTION_THRESHOLD_SECONDS;

  let isExhausted = false;
  let resetAt = null;
  let resetAtStr = 'Belum Habis';
  let timeLeftStr = `Tersisa ${remainingSeconds}s (Belum Countdown)`;

  if (shouldExhaust) {
    if (!quota.exhaustedAt) {
      quota.exhaustedAt = now;
      friend.quota = quota;
      saveApprovedFriends();
    }
    resetAt = quota.exhaustedAt + RESET_WINDOW_MS;
    const msLeft = Math.max(0, resetAt - now);
    timeLeftStr = formatCountdown(msLeft);
    const resetDate = new Date(resetAt);
    resetAtStr = resetDate.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB';
    isExhausted = true;
  } else {
    // If quota is still available (> 8s), ensure exhaustedAt is null so countdown is NOT active
    if (quota.exhaustedAt) {
      quota.exhaustedAt = null;
      friend.quota = quota;
      saveApprovedFriends();
    }
  }

  const resetAtUnix = resetAt ? Math.floor(resetAt / 1000) : null;
  const liveCountdown = resetAtUnix ? `<t:${resetAtUnix}:R>` : null;

  return {
    allowed: !isExhausted,
    usedSeconds,
    remainingSeconds,
    maxDailySeconds: MAX_DAILY_VOICE_SECONDS,
    isExhausted,
    resetAt,
    resetAtUnix,
    liveCountdown,
    timeLeftStr,
    resetAtStr
  };
}

/**
 * Record speech duration usage for an approved friend and automatically trigger countdown + proactive DMs
 * @param {string} userId 
 * @param {number} durationSeconds 
 * @param {import('discord.js').Client} [client] 
 */
async function recordFriendVoiceUsage(userId, durationSeconds, client = null) {
  if (userId === config.OWNER_DISCORD_ID) return; // Owner has unlimited quota
  loadApprovedFriends();
  const friend = approvedFriendsCache.get(userId);
  if (!friend) return;

  const now = Date.now();
  if (!friend.quota) {
    friend.quota = {
      usedSeconds: 0,
      maxDailySeconds: MAX_DAILY_VOICE_SECONDS,
      exhaustedAt: null,
      warned80Sent: false,
      warned100Sent: false
    };
  }

  // Check if previous 24h lockout has expired
  if (friend.quota.exhaustedAt && (now - friend.quota.exhaustedAt >= RESET_WINDOW_MS)) {
    friend.quota.usedSeconds = 0;
    friend.quota.exhaustedAt = null;
    friend.quota.warned80Sent = false;
    friend.quota.warned100Sent = false;
  }

  // Increment usage (only counts Azura's spoken output duration)
  friend.quota.usedSeconds = Math.min(MAX_DAILY_VOICE_SECONDS, (friend.quota.usedSeconds || 0) + durationSeconds);
  friend.totalVoiceSecondsAllTime = (friend.totalVoiceSecondsAllTime || 0) + durationSeconds;
  friend.lastSpokeAt = new Date().toISOString();

  const used = Math.round(friend.quota.usedSeconds);
  const remaining = Math.max(0, MAX_DAILY_VOICE_SECONDS - used);

  console.log(`[Friend Quota]: Friend "${friend.displayName}" (${userId}) used +${durationSeconds}s. Total today: ${used}s/120s. Remaining: ${remaining}s.`);

  // 1. Check Exhaustion (remaining <= 8 seconds -> Start 24h countdown now!)
  if (remaining <= EXHAUSTION_THRESHOLD_SECONDS) {
    if (!friend.quota.exhaustedAt) {
      friend.quota.exhaustedAt = now;
    }
    const resetAt = friend.quota.exhaustedAt + RESET_WINDOW_MS;
    const timeLeftStr = formatCountdown(Math.max(0, resetAt - now));
    const resetDate = new Date(resetAt);
    const resetTimeStr = resetDate.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB';

    console.log(`[Friend Quota]: ⛔ Friend "${friend.displayName}" (${userId}) quota exhausted (sisa <= 8s). 24h Countdown activated: reset in ${timeLeftStr}!`);

    if (!friend.quota.warned100Sent) {
      friend.quota.warned100Sent = true;
      saveApprovedFriends();
      if (client) {
        await sendQuota100ExhaustedDM(userId, friend, timeLeftStr, resetTimeStr, client, resetAt).catch(err => {
          console.error('[Friend Quota DM Error]:', err.message);
        });
      }
    } else {
      saveApprovedFriends();
    }
    return;
  }

  // 2. Proactive DM: 80% Warning (~96 seconds used, sisa > 8s)
  if (used >= 96 && !friend.quota.warned80Sent) {
    friend.quota.warned80Sent = true;
    saveApprovedFriends();
    if (client) {
      await sendQuota80WarningDM(userId, friend, used, remaining, client).catch(err => {
        console.error('[Friend Quota DM Error]:', err.message);
      });
    }
  } else {
    saveApprovedFriends();
  }
}

/**
 * Send Aesthetic Onboarding Welcome DM to newly approved friend
 */
async function sendOnboardingDM(userId, friendRecord, client) {
  if (!client) return;
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const embed = new EmbedBuilder()
      .setColor(0x8A2BE2) // Royal Purple / Aesthetic Anime Tone
      .setTitle('✨ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✨\n🎉  CONGRATULATIONS & WELCOME!  🎉')
      .setDescription(
        `Halo **${friendRecord.customNickname || friendRecord.displayName}**! ✨\n\n` +
        `Kabar gembira nih! **Attila** (<@${config.OWNER_DISCORD_ID}>) baru saja memberikan kamu **AKSES EKSKLUSIF** untuk ikutan **Beta Testing AZURA Voice Companion**! 🎙️🌸\n\n` +
        `Aku adalah **AZURA**, AI Voice Companion yang siap nemenin kamu ngobrol langsung di Voice Channel dengan suara manusiawi penuh ekspresi, tawa, lelucon, dan jokes seru!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 **PANDUAN & ATURAN AKSES EKSKLUSIF KAMU:**\n` +
        `• 🎙️ **Kuota Voice Harian**: Maksimal **2 Menit (120 detik)** per 24 jam.\n` +
        `• 👑 **Kehadiran Attila**: Aku bisa kamu ajak ngobrol saat Attila sedang berada di Voice Channel yang sama denganmu.\n` +
        `• ⏳ **Real-Time 24h Reset**: Kuotamu akan otomatis di-reset 24 jam setelah pemakaian pertamamu setiap harinya.\n` +
        `• 💬 **Panggilan Akrab**: Kamu bisa panggil *"Azura"*, *"Ara"*, *"Zura"*, atau *"Ajur"* saat di VC yaa!\n` +
        `• 🎭 **Fitur 100% Lengkap**: Kamu bisa ajak aku bercanda, minta jokes, gombalan, atau nyanyi bareng!\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Selamat mencoba dan have fun ngobrol bareng aku dan Attila di VC yaa!* ✨💜`
      )
      .setFooter({ text: 'AZURA AI Voice Companion • Beta Testing Access' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    console.log(`[AccessControl]: 💌 Sent Aesthetic Onboarding DM to ${friendRecord.displayName} (${userId})`);
  } catch (err) {
    console.error(`[AccessControl DM Warning]: Could not send onboarding DM to ${userId}:`, err.message);
  }
}

/**
 * Send 80% Quota Warning DM
 */
async function sendQuota80WarningDM(userId, friendRecord, usedSeconds, remainingSeconds, client) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const embed = new EmbedBuilder()
      .setColor(0xFFA500) // Amber / Warning
      .setTitle('⚠️ [PERINGATAN KUOTA VOICE AZURA - 80%]')
      .setDescription(
        `Halo **${friendRecord.customNickname || friendRecord.displayName}**! ✨\n\n` +
        `Kuota ngobrol voice harianmu dengan Azura sudah mencapai **80%** (\`${usedSeconds}s / 120s\`).\n\n` +
        `⏱️ **Sisa Kuota Hari Ini**: \`${remainingSeconds} detik\` lagi.\n\n` +
        `*Setelah 120 detik habis, Azura akan beristirahat merespon suaramu dan otomatis membuka kembali setelah 24 jam.*`
      )
      .setFooter({ text: 'AZURA Voice Quota Manager' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    console.log(`[AccessControl]: ⚠️ Sent 80% quota warning DM to ${friendRecord.displayName} (${userId})`);
  } catch (err) {
    console.error('[AccessControl]: Failed to send 80% DM:', err.message);
  }
}

/**
 * Send 100% Quota Exhausted DM with realtime countdown
 */
async function sendQuota100ExhaustedDM(userId, friendRecord, timeLeftStr, resetTimeStr, client, resetAt = null) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const targetResetAt = resetAt || (friendRecord.quota?.exhaustedAt ? friendRecord.quota.exhaustedAt + RESET_WINDOW_MS : Date.now() + RESET_WINDOW_MS);
    const resetAtUnix = Math.floor(targetResetAt / 1000);
    const resetDate = new Date(targetResetAt);
    const dateFormatted = resetDate.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const embed = new EmbedBuilder()
      .setColor(0xED4245) // Red / Exhausted
      .setTitle('⛔ [KUOTA VOICE AZURA HARI INI HABIS]')
      .setDescription(
        `Halo **${friendRecord.customNickname || friendRecord.displayName}**! ✨\n\n` +
        `Kuota voice harian kamu (**2 menit / 120 detik**) bersama Azura telah **100% habis** untuk hari ini.\n\n` +
        `⏳ **Hitung Mundur Reset 24 Jam (Live Countdown):**\n` +
        `👉 **<t:${resetAtUnix}:R>** *(Pukul <t:${resetAtUnix}:T> WIB • ${dateFormatted})*\n\n` +
        `*Terima kasih sudah seru-seruan ngobrol di VC hari ini! Sampai ketemu besok bareng Attila yaa!* 🌸💜`
      )
      .setFooter({ text: 'AZURA Voice Quota Manager • Live Dynamic Countdown' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    console.log(`[AccessControl]: ⛔ Sent 100% quota exhausted DM to ${friendRecord.displayName} (${userId})`);
  } catch (err) {
    console.error('[AccessControl]: Failed to send 100% DM:', err.message);
  }
}

/**
 * Approve / Add a friend to the whitelist
 * @param {string} userId 
 * @param {string} username 
 * @param {string} displayName 
 * @param {string} customNickname 
 * @param {string} approvedBy 
 * @param {import('discord.js').Client} [client] 
 * @returns {object}
 */
async function approveFriend(userId, username, displayName, customNickname = null, approvedBy = 'Attila', client = null) {
  loadApprovedFriends();
  const existing = approvedFriendsCache.get(userId);

  // 1. Check if member already has a self-registered & locked nickname in Vault
  let finalNickname = null;
  let isSelfRegistered = false;

  try {
    const { getUserRecord } = require('./vault');
    const uRec = getUserRecord(userId);
    if (uRec && uRec.knownRealName && uRec.knownRealName.trim() && uRec.isNameLocked) {
      finalNickname = uRec.knownRealName.trim();
      isSelfRegistered = true;
      console.log(`[AccessControl]: Member ${userId} has self-registered name "${finalNickname}". Using self-registered name over custom override.`);
    }
  } catch (_) {}

  // 2. If member hasn't registered their own name, use Attila's custom nickname or fallback
  if (!finalNickname) {
    finalNickname = customNickname || existing?.customNickname || displayName || username || 'Teman';
  }

  const record = {
    userId,
    username: username || existing?.username || 'unknown',
    displayName: displayName || existing?.displayName || finalNickname,
    customNickname: finalNickname,
    isSelfRegistered,
    approvedBy,
    approvedAt: existing?.approvedAt || new Date().toISOString(),
    totalVoiceSecondsAllTime: existing?.totalVoiceSecondsAllTime || 0,
    lastSpokeAt: existing?.lastSpokeAt || null,
    quota: existing?.quota || {
      usedSeconds: 0,
      maxDailySeconds: MAX_DAILY_VOICE_SECONDS,
      exhaustedAt: null,
      warned80Sent: false,
      warned100Sent: false
    }
  };

  approvedFriendsCache.set(userId, record);
  saveApprovedFriends();

  // If NOT self-registered, sync owner-assigned nickname into encrypted user vault
  if (!isSelfRegistered) {
    try {
      const { setUserNameByOwner } = require('./vault');
      setUserNameByOwner(userId, finalNickname, true);
    } catch (_) {}
  }

  // Send aesthetic welcome onboarding DM
  if (client) {
    await sendOnboardingDM(userId, record, client);
  }

  return record;
}

/**
 * Revoke a friend from the whitelist
 * @param {string} userId 
 * @returns {boolean}
 */
function revokeFriend(userId) {
  loadApprovedFriends();
  if (!approvedFriendsCache.has(userId)) return false;
  approvedFriendsCache.delete(userId);
  saveApprovedFriends();
  return true;
}

/**
 * Reset a friend's daily voice quota manually (Owner Only)
 * @param {string} userId 
 * @returns {object|null}
 */
function resetFriendVoiceQuota(userId) {
  loadApprovedFriends();
  const friend = approvedFriendsCache.get(userId);
  if (!friend) return null;
  friend.quota = {
    usedSeconds: 0,
    maxDailySeconds: MAX_DAILY_VOICE_SECONDS,
    exhaustedAt: null,
    warned80Sent: false,
    warned100Sent: false
  };
  saveApprovedFriends();
  return friend;
}

/**
 * Get all approved friends formatted for display
 */
function getApprovedFriendsList() {
  loadApprovedFriends();
  const now = Date.now();
  return Array.from(approvedFriendsCache.values()).map(f => {
    const quota = f.quota || { usedSeconds: 0, exhaustedAt: null };

    // Check if 24h lockout has expired
    if (quota.exhaustedAt && (now - quota.exhaustedAt >= RESET_WINDOW_MS)) {
      quota.usedSeconds = 0;
      quota.exhaustedAt = null;
      quota.warned80Sent = false;
      quota.warned100Sent = false;
    }

    const used = Math.round(quota.usedSeconds || 0);
    const remaining = Math.max(0, MAX_DAILY_VOICE_SECONDS - used);
    const isExhausted = (remaining <= EXHAUSTION_THRESHOLD_SECONDS) || (quota.exhaustedAt !== null);

    let timeLeftStr = `Sisa ${remaining}s (Belum Countdown 24h)`;
    let resetAtUnix = null;
    if (isExhausted) {
      const resetAt = (quota.exhaustedAt || now) + RESET_WINDOW_MS;
      resetAtUnix = Math.floor(resetAt / 1000);
      timeLeftStr = formatCountdown(Math.max(0, resetAt - now));
    }

    return {
      userId: f.userId,
      username: f.username,
      displayName: f.displayName,
      customNickname: f.customNickname,
      approvedAt: f.approvedAt,
      usedSeconds: used,
      remainingSeconds: remaining,
      totalSecondsAllTime: Math.round(f.totalVoiceSecondsAllTime || 0),
      timeLeftStr,
      resetAtUnix,
      isExhausted
    };
  });
}

module.exports = {
  isApprovedFriend,
  getApprovedFriend,
  approveFriend,
  revokeFriend,
  resetFriendVoiceQuota,
  getApprovedFriendsList,
  checkFriendDailyVoiceQuota,
  recordFriendVoiceUsage,
  sendOnboardingDM,
  MAX_DAILY_VOICE_SECONDS
};
