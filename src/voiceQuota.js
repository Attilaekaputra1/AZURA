const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUOTA_FILE = path.join(DATA_DIR, 'voice_quota.json');

// Default monthly limit (40,000 characters as indicated by user dashboard)
const DEFAULT_MONTHLY_LIMIT = 40000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function loadQuotaData() {
  const currentMonth = getCurrentMonthKey();
  try {
    if (fs.existsSync(QUOTA_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
      if (data.monthKey === currentMonth) {
        return data;
      }
    }
  } catch (err) {
    console.error('[VoiceQuota Error]: Failed to read voice_quota.json:', err.message);
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
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[VoiceQuota Error]: Failed to save voice_quota.json:', err.message);
  }
}

/**
 * Check if ElevenLabs can be used for a given character count
 * @param {number} charCount 
 * @returns {boolean}
 */
function canUseElevenLabs(charCount = 0) {
  const data = loadQuotaData();
  return (data.usedChars + charCount) <= data.maxMonthlyChars;
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
  getQuotaStatus
};
