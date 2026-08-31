const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUOTA_FILE = path.join(DATA_DIR, 'voice_quota.enc');
const MEMBER_VC_QUOTA_FILE = path.join(DATA_DIR, 'member_vc_quota.enc');

const MAX_MEMBER_DAILY_VC = 3;

// Auto-sync interval: every 30 minutes
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
let _lastSyncTimestamp = 0;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getTodayKey() {
  const now = new Date();
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).format(now); // YYYY-MM-DD
  return parts;
}

function loadQuotaData() {
  const currentMonth = getCurrentMonthKey();
  try {
    const data = readSecureJson(QUOTA_FILE, null);
    if (data && data.monthKey === currentMonth) {
      return data;
    }
  } catch (err) {
    console.error('[VoiceQuota Error]: Failed to read secure voice_quota.enc:', err.message);
  }

  // New month or fresh initialization — will be overwritten on first API sync
  const freshData = {
    monthKey: currentMonth,
    usedCredits: 0,
    totalCredits: 0,
    remainingCredits: 0,
    tier: 'unknown',
    nextResetDate: '-',
    warning80Sent: false,
    warning100Sent: false,
    lastApiSync: null,
    updatedAt: new Date().toISOString()
  };
  saveQuotaData(freshData);
  return freshData;
}

function saveQuotaData(data) {
  try {
    data.updatedAt = new Date().toISOString();
    writeSecureJson(QUOTA_FILE, data);
  } catch (err) {
    console.error('[VoiceQuota Error]: Failed to save secure voice_quota.enc:', err.message);
  }
}

function loadMemberVcQuota() {
  const today = getTodayKey();
  try {
    const data = readSecureJson(MEMBER_VC_QUOTA_FILE, null);
    if (data && data.dateKey === today) {
      return data;
    }
  } catch (err) {
    console.error('[VoiceQuota Error]: Failed to read secure member_vc_quota.enc:', err.message);
  }

  const fresh = {
    dateKey: today,
    usage: {}
  };
  saveMemberVcQuota(fresh);
  return fresh;
}

function saveMemberVcQuota(data) {
  try {
    writeSecureJson(MEMBER_VC_QUOTA_FILE, data);
  } catch (err) {
    console.error('[VoiceQuota Error]: Failed to save secure member_vc_quota.enc:', err.message);
  }
}

/**
 * Check daily VC Voice quota for a member (3x/day)
 * @param {string} userId 
 * @returns {{ allowed: boolean, usedToday: number, remaining: number, maxDaily: number }}
 */
function getMemberDailyVcQuota(userId) {
  if (!userId) return { allowed: false, usedToday: 0, remaining: 0, maxDaily: MAX_MEMBER_DAILY_VC };
  const data = loadMemberVcQuota();
  const used = data.usage[userId] || 0;
  const remaining = Math.max(0, MAX_MEMBER_DAILY_VC - used);
  return {
    allowed: remaining > 0,
    usedToday: used,
    remaining,
    maxDaily: MAX_MEMBER_DAILY_VC
  };
}

/**
 * Consume 1 daily VC Voice quota for a member
 * @param {string} userId 
 * @returns {{ usedToday: number, remaining: number }}
 */
function consumeMemberDailyVcQuota(userId) {
  if (!userId) return { usedToday: 0, remaining: 0 };
  const data = loadMemberVcQuota();
  const current = data.usage[userId] || 0;
  data.usage[userId] = current + 1;
  saveMemberVcQuota(data);
  return {
    usedToday: data.usage[userId],
    remaining: Math.max(0, MAX_MEMBER_DAILY_VC - data.usage[userId])
  };
}

// ═══════════════════════════════════════════════════════════════════
//  LIVE ELEVENLABS API SYNC (Source of Truth)
// ═══════════════════════════════════════════════════════════════════

/**
 * Fetch live subscription & quota data directly from ElevenLabs API
 * Syncs local cache with real dashboard numbers (credits-based)
 * @returns {Promise<{ character_count: number, character_limit: number, remaining: number, percent: string, status: string, tier: string, next_reset: string }>}
 */
function fetchLiveElevenLabsQuota() {
  return new Promise((resolve) => {
    const apiKey = config.ELEVENLABS_API_KEY;
    if (!apiKey) {
      const fallback = getQuotaStatus();
      return resolve({
        character_count: fallback.usedCredits,
        character_limit: fallback.totalCredits,
        remaining: fallback.remainingCredits,
        percent: fallback.percentage,
        status: 'no_api_key',
        tier: 'unknown',
        next_reset: '-'
      });
    }

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: '/v1/user/subscription',
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        'User-Agent': 'AZURA-Bot/3.0'
      },
      timeout: 8000
    }, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(rawData);

          // ElevenLabs API returns character_count and character_limit
          const used = json.character_count ?? 0;
          const total = json.character_limit ?? 0;
          const remaining = Math.max(0, total - used);
          const percent = total > 0 ? ((used / total) * 100).toFixed(1) : '0.0';

          let resetDateStr = '-';
          if (json.next_character_count_reset_unix) {
            resetDateStr = new Date(json.next_character_count_reset_unix * 1000).toLocaleDateString('id-ID', {
              year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta'
            });
          }

          const tier = json.tier || 'unknown';

          // Sync local cache with live API data
          const local = loadQuotaData();
          local.usedCredits = used;
          local.totalCredits = total;
          local.remainingCredits = remaining;
          local.tier = tier;
          local.nextResetDate = resetDateStr;
          local.lastApiSync = new Date().toISOString();
          saveQuotaData(local);

          _lastSyncTimestamp = Date.now();
          console.log(`[VoiceQuota]: ✅ Synced with ElevenLabs API — ${used.toLocaleString('id-ID')} / ${total.toLocaleString('id-ID')} credits used (${percent}%) | Tier: ${tier} | Reset: ${resetDateStr}`);

          return resolve({
            character_count: used,
            character_limit: total,
            remaining,
            percent,
            status: json.status || 'active',
            tier,
            next_reset: resetDateStr
          });
        } catch (e) {
          console.error('[VoiceQuota API Parse Error]:', e.message);
        }

        // Fallback to local cache
        const fallback = getQuotaStatus();
        resolve({
          character_count: fallback.usedCredits,
          character_limit: fallback.totalCredits,
          remaining: fallback.remainingCredits,
          percent: fallback.percentage,
          status: 'parse_error_cached',
          tier: fallback.tier,
          next_reset: fallback.nextResetDate
        });
      });
    });

    req.on('error', (err) => {
      console.error('[VoiceQuota API Error]:', err.message);
      const fallback = getQuotaStatus();
      resolve({
        character_count: fallback.usedCredits,
        character_limit: fallback.totalCredits,
        remaining: fallback.remainingCredits,
        percent: fallback.percentage,
        status: 'error_cached',
        tier: fallback.tier,
        next_reset: fallback.nextResetDate
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const fallback = getQuotaStatus();
      resolve({
        character_count: fallback.usedCredits,
        character_limit: fallback.totalCredits,
        remaining: fallback.remainingCredits,
        percent: fallback.percentage,
        status: 'timeout_cached',
        tier: fallback.tier,
        next_reset: fallback.nextResetDate
      });
    });

    req.end();
  });
}

/**
 * Background auto-sync: called periodically to keep local cache accurate
 */
function backgroundSyncIfNeeded() {
  const elapsed = Date.now() - _lastSyncTimestamp;
  if (elapsed >= SYNC_INTERVAL_MS) {
    fetchLiveElevenLabsQuota().catch(() => {});
  }
}

// Auto-sync on module load (startup)
setTimeout(() => {
  fetchLiveElevenLabsQuota().then(() => {
    console.log('[VoiceQuota]: 🚀 Initial startup sync completed.');
  }).catch(() => {});
}, 5000);

// Periodic auto-sync every 30 minutes
setInterval(() => {
  fetchLiveElevenLabsQuota().catch(() => {});
}, SYNC_INTERVAL_MS);

// ═══════════════════════════════════════════════════════════════════
//  CORE QUOTA FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if ElevenLabs can be used (always true — let API handle actual limits)
 * @returns {boolean}
 */
function canUseElevenLabs() {
  return true;
}

/**
 * Record usage of ElevenLabs characters and handle automatic DM warnings
 * @param {number} charCount 
 * @param {import('discord.js').Client} client 
 */
async function recordVoiceUsage(charCount, client = null) {
  const data = loadQuotaData();
  data.usedCredits += charCount;
  data.remainingCredits = Math.max(0, data.totalCredits - data.usedCredits);

  const usagePercent = data.totalCredits > 0
    ? ((data.usedCredits / data.totalCredits) * 100).toFixed(1)
    : '0.0';

  console.log(`[VoiceQuota]: +${charCount} credits → ${data.usedCredits.toLocaleString('id-ID')} / ${data.totalCredits.toLocaleString('id-ID')} (${usagePercent}%) | Sisa: ${data.remainingCredits.toLocaleString('id-ID')}`);

  const usageRatio = data.totalCredits > 0 ? data.usedCredits / data.totalCredits : 0;

  // Warning at 80%
  if (usageRatio >= 0.8 && !data.warning80Sent && client && config.OWNER_DISCORD_ID) {
    data.warning80Sent = true;
    try {
      const owner = await client.users.fetch(config.OWNER_DISCORD_ID);
      if (owner) {
        await owner.send(
          `⚠️ **[PERINGATAN KUOTA VOICE ELEVENLABS — 80%]**\n` +
          `Penggunaan ElevenLabs bulan ini: **${data.usedCredits.toLocaleString('id-ID')} / ${data.totalCredits.toLocaleString('id-ID')} credits (${usagePercent}%)**.\n` +
          `Sisa kuota: **${data.remainingCredits.toLocaleString('id-ID')} credits**.\n\n` +
          `*Begitu kuota mencapai 100%, AZURA akan otomatis beralih ke OpenAI TTS (nova).*`
        );
        console.log('[VoiceQuota]: Sent 80% quota warning to Owner DM.');
      }
    } catch (e) {
      console.error('[VoiceQuota Warning Error]:', e.message);
    }
  }

  // Alert at 100% -> Auto-fallback activated
  if (usageRatio >= 1.0 && !data.warning100Sent && client && config.OWNER_DISCORD_ID) {
    data.warning100Sent = true;
    try {
      const owner = await client.users.fetch(config.OWNER_DISCORD_ID);
      if (owner) {
        await owner.send(
          `🛑 **[KUOTA VOICE ELEVENLABS HABIS (100%) — AUTO-FALLBACK AKTIF]**\n` +
          `Penggunaan ElevenLabs bulan ini telah mencapai batas **${data.totalCredits.toLocaleString('id-ID')} credits**.\n\n` +
          `🛡️ **Pengamanan Otomatis:**\n` +
          `AZURA sekarang otomatis beralih ke **OpenAI TTS (Nova)**. Kamu tetap bisa ngobrol normal tanpa kena biaya tambahan!`
        );
        console.log('[VoiceQuota]: Sent 100% quota auto-fallback alert to Owner DM.');
      }
    } catch (e) {
      console.error('[VoiceQuota Alert Error]:', e.message);
    }
  }

  saveQuotaData(data);

  // Trigger background sync if stale
  backgroundSyncIfNeeded();
}

/**
 * Get formatted quota status report (from local cache, synced with API)
 */
function getQuotaStatus() {
  const data = loadQuotaData();
  const remaining = Math.max(0, data.totalCredits - data.usedCredits);
  const percentage = data.totalCredits > 0
    ? ((data.usedCredits / data.totalCredits) * 100).toFixed(1)
    : '0.0';

  return {
    monthKey: data.monthKey,
    usedCredits: data.usedCredits || 0,
    totalCredits: data.totalCredits || 0,
    remainingCredits: remaining,
    percentage,
    isQuotaAvailable: data.usedCredits < data.totalCredits,
    tier: data.tier || 'unknown',
    nextResetDate: data.nextResetDate || '-',
    lastApiSync: data.lastApiSync || null,
    // Backward compat aliases
    usedChars: data.usedCredits || 0,
    maxMonthlyChars: data.totalCredits || 0,
    remainingChars: remaining,
    estConversationsRemaining: Math.floor(remaining / 150)
  };
}

module.exports = {
  canUseElevenLabs,
  recordVoiceUsage,
  getQuotaStatus,
  fetchLiveElevenLabsQuota,
  getMemberDailyVcQuota,
  consumeMemberDailyVcQuota
};
