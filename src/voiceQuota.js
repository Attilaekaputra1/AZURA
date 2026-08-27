const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUOTA_FILE = path.join(DATA_DIR, 'voice_quota.enc');
const MEMBER_VC_QUOTA_FILE = path.join(DATA_DIR, 'member_vc_quota.enc');

// Default monthly limit (40,000 characters as indicated by user dashboard)
const DEFAULT_MONTHLY_LIMIT = 40000;
const MAX_MEMBER_DAILY_VC = 3;

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

  // New month or fresh initialization
  const freshData = {
    monthKey: currentMonth,
    usedChars: 0,
    maxMonthlyChars: DEFAULT_MONTHLY_LIMIT,
    warning80Sent: false,
    warning100Sent: false,
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

/**
 * Fetch live subscription & quota data directly from ElevenLabs API
 * @returns {Promise<{ character_count: number, character_limit: number, percent: string, status: string, tier: string, next_reset: string }>}
 */
function fetchLiveElevenLabsQuota() {
  return new Promise((resolve) => {
    const apiKey = config.ELEVENLABS_API_KEY;
    if (!apiKey) {
      const fallback = getQuotaStatus();
      return resolve({
        character_count: fallback.usedChars,
        character_limit: fallback.maxMonthlyChars,
        percent: fallback.percentage,
        status: 'local_tracking',
        tier: 'free',
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
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.character_count !== undefined && json.character_limit !== undefined) {
            const count = json.character_count;
            const limit = json.character_limit;
            const percent = limit > 0 ? ((count / limit) * 100).toFixed(1) : '0.0';
            let resetDateStr = '-';
            if (json.next_character_count_reset_unix) {
              resetDateStr = new Date(json.next_character_count_reset_unix * 1000).toLocaleDateString('id-ID', {
                year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta'
              });
            }

            // Sync with local tracking file
            const local = loadQuotaData();
            local.usedChars = count;
            local.maxMonthlyChars = limit;
            saveQuotaData(local);

            return resolve({
              character_count: count,
              character_limit: limit,
              percent: percent,
              status: json.status || 'active',
              tier: json.tier || 'starter',
              next_reset: resetDateStr
            });
          }
        } catch (e) {
          console.error('[VoiceQuota Live API Parse Error]:', e.message);
        }
        // Fallback to local
        const fallback = getQuotaStatus();
        resolve({
          character_count: fallback.usedChars,
          character_limit: fallback.maxMonthlyChars,
          percent: fallback.percentage,
          status: 'cached',
          tier: 'starter',
          next_reset: '-'
        });
      });
    });

    req.on('error', (err) => {
      console.error('[VoiceQuota Live API Error]:', err.message);
      const fallback = getQuotaStatus();
      resolve({
        character_count: fallback.usedChars,
        character_limit: fallback.maxMonthlyChars,
        percent: fallback.percentage,
        status: 'cached',
        tier: 'starter',
        next_reset: '-'
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const fallback = getQuotaStatus();
      resolve({
        character_count: fallback.usedChars,
        character_limit: fallback.maxMonthlyChars,
        percent: fallback.percentage,
        status: 'timeout_cached',
        tier: 'starter',
        next_reset: '-'
      });
    });

    req.end();
  });
}

/**
 * Check if ElevenLabs can be used
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
  data.usedChars += charCount;

  const usageRatio = data.usedChars / data.maxMonthlyChars;
  const percentage = (usageRatio * 100).toFixed(1);

  console.log(`[VoiceQuota]: Recorded +${charCount} chars. Total this month: ${data.usedChars} / ${data.maxMonthlyChars} (${percentage}%)`);

  // Warning at 80% (32,000 chars)
  if (usageRatio >= 0.8 && !data.warning80Sent && client && config.OWNER_DISCORD_ID) {
    data.warning80Sent = true;
    try {
      const owner = await client.users.fetch(config.OWNER_DISCORD_ID);
      if (owner) {
        await owner.send(
          `⚠️ **[PERINGATAN KUOTA VOICE ELEVENLABS - 80%]**\n` +
          `Penggunaan karakter ElevenLabs bulan ini telah mencapai **${data.usedChars.toLocaleString('id-ID')} / ${data.maxMonthlyChars.toLocaleString('id-ID')} karakter (${percentage}%)**.\n` +
          `Sisa kuota: **${(data.maxMonthlyChars - data.usedChars).toLocaleString('id-ID')} karakter** (~${Math.floor((data.maxMonthlyChars - data.usedChars) / 150)} percakapan lagi).\n\n` +
          `*Begitu kuota mencapai 100%, AZURA akan otomatis beralih ke OpenAI TTS (nova) agar kamu tidak terkena biaya tambahan.*`
        );
        console.log('[VoiceQuota]: Sent 80% quota warning to Owner DM.');
      }
    } catch (e) {
      console.error('[VoiceQuota Warning Error]:', e.message);
    }
  }

  // Alert at 100% (40,000 chars) -> Auto-fallback activated
  if (usageRatio >= 1.0 && !data.warning100Sent && client && config.OWNER_DISCORD_ID) {
    data.warning100Sent = true;
    try {
      const owner = await client.users.fetch(config.OWNER_DISCORD_ID);
      if (owner) {
        await owner.send(
          `🛑 **[KUOTA VOICE ELEVENLABS HABIS (100%) - AUTO-FALLBACK AKTIF]**\n` +
          `Penggunaan karakter ElevenLabs bulan ini telah mencapai batas **${data.maxMonthlyChars.toLocaleString('id-ID')} karakter**.\n\n` +
          `🛡️ **Pengamanan Otomatis:**\n` +
          `AZURA sekarang otomatis mengalihkan seluruh suara Voice Channel & Voice Note ke **OpenAI TTS (suara Nova)**. Kamu tetap bisa ngobrol normal tanpa takut kena tagihan overage di kartu kredit kamu!`
        );
        console.log('[VoiceQuota]: Sent 100% quota auto-fallback alert to Owner DM.');
      }
    } catch (e) {
      console.error('[VoiceQuota Alert Error]:', e.message);
    }
  }

  saveQuotaData(data);
}

/**
 * Get formatted quota status report
 */
function getQuotaStatus() {
  const data = loadQuotaData();
  const remaining = Math.max(0, data.maxMonthlyChars - data.usedChars);
  const percentage = ((data.usedChars / data.maxMonthlyChars) * 100).toFixed(1);
  const estConversationsRemaining = Math.floor(remaining / 150);

  return {
    monthKey: data.monthKey,
    usedChars: data.usedChars,
    maxMonthlyChars: data.maxMonthlyChars,
    remainingChars: remaining,
    percentage: percentage,
    isQuotaAvailable: data.usedChars < data.maxMonthlyChars,
    estConversationsRemaining
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
