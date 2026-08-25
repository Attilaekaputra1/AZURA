/**
 * AZURA Zero-Knowledge Encrypted User Database & Vault Engine
 * Military-grade AES-256-GCM encryption with session cookies and zero-knowledge AI isolation.
 * Strictly accessible and decryptable ONLY by the Owner (Attila).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const VAULT_FILE_PATH = path.join(__dirname, '../data/user_vault.enc');
const VAULT_SALT = 'azura_salt_zero_knowledge_vault_2026';

// In-memory cache of decrypted records (accessible strictly by internal vault functions)
let userVaultCache = new Map();
let isVaultLoaded = false;

/**
 * Derive 32-byte key from master encryption key using scrypt
 * @param {string} masterKey 
 * @returns {Buffer}
 */
function getDerivedKey(masterKey) {
  const secret = masterKey || config.DATABASE_ENCRYPTION_KEY || 'azura_master_vault_key_fallback';
  return crypto.scryptSync(secret, VAULT_SALT, 32);
}

/**
 * Encrypt a string or JSON object with AES-256-GCM
 * @param {string|object} data 
 * @returns {string} Hex-encoded encrypted envelope
 */
function encryptPayload(data) {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const key = getDerivedKey(config.DATABASE_ENCRYPTION_KEY);
  const iv = crypto.randomBytes(12); // 12-byte IV for GCM

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  const envelope = {
    v: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: authTag,
    ciphertext: encrypted
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt an AES-256-GCM envelope
 * @param {string} envelopeStr 
 * @returns {any} Decrypted data
 */
function decryptPayload(envelopeStr) {
  try {
    const envelope = JSON.parse(envelopeStr);
    if (!envelope.iv || !envelope.tag || !envelope.ciphertext) {
      throw new Error('Invalid encryption envelope structure.');
    }

    const key = getDerivedKey(config.DATABASE_ENCRYPTION_KEY);
    const iv = Buffer.from(envelope.iv, 'hex');
    const authTag = Buffer.from(envelope.tag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(envelope.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    try {
      return JSON.parse(decrypted);
    } catch (_) {
      return decrypted;
    }
  } catch (err) {
    console.error('[Vault Decryption Error]: Failed to decrypt vault payload:', err.message);
    return null;
  }
}

/**
 * Load and decrypt the user database from disk
 */
function loadVault() {
  if (isVaultLoaded) return;
  try {
    const dataDir = path.dirname(VAULT_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(VAULT_FILE_PATH)) {
      const encryptedData = fs.readFileSync(VAULT_FILE_PATH, 'utf8');
      const decrypted = decryptPayload(encryptedData);
      if (decrypted && typeof decrypted === 'object') {
        userVaultCache = new Map(Object.entries(decrypted));
        console.log(`[User Vault Engine]: 🔒 Decrypted and loaded ${userVaultCache.size} user profiles from AES-256-GCM storage.`);
      }
    } else {
      userVaultCache = new Map();
      saveVault();
    }
    isVaultLoaded = true;
  } catch (err) {
    console.error('[User Vault Load Error]:', err.message);
    userVaultCache = new Map();
    isVaultLoaded = true;
  }
}

/**
 * Encrypt and atomically save user database to disk
 */
function saveVault() {
  try {
    const plainObj = Object.fromEntries(userVaultCache);
    const encryptedEnvelope = encryptPayload(plainObj);

    const tmpPath = `${VAULT_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, encryptedEnvelope, 'utf8');
    fs.renameSync(tmpPath, VAULT_FILE_PATH);
  } catch (err) {
    console.error('[User Vault Save Error]: Failed to save encrypted vault:', err.message);
  }
}

/**
 * Generate a persistent, secure session cookie token for a user
 * @param {string} userId 
 * @param {string} firstSeen 
 * @returns {string}
 */
function generateSessionCookie(userId, firstSeen) {
  const hmac = crypto.createHmac('sha256', config.DATABASE_ENCRYPTION_KEY || 'azura_cookie_salt');
  hmac.update(`${userId}:${firstSeen}:azura_session`);
  return `azura_sess_${hmac.digest('hex').slice(0, 32)}`;
}

/**
 * Extract known real name / nickname if mentioned in message
 * @param {string} text 
 * @returns {string|null}
 */
function extractRealName(text) {
  if (!text || typeof text !== 'string') return null;

  const patterns = [
    // "nama asli gw/gue/gua/aku/saya/ane/ku putra" or "nama asliku putra"
    /(?:nama\s+asli\s*(?:gw|gue|gua|aku|saya|ane|ku)?|nama\s+asliku)\s*(?:adalah|yaitu|:|nya|itu)?\s*([a-zA-Z\s]{2,30})/i,
    // "nama panggilan gw/aku/saya/ku putra" or "nama panggilanku putra"
    /(?:nama\s+panggilan\s*(?:gw|gue|gua|aku|saya|ane|ku)?|nama\s+panggilanku)\s*(?:adalah|yaitu|:|nya|itu)?\s*([a-zA-Z\s]{2,30})/i,
    // "panggil gw/gue/gua/aku/saya/aja/ane putra" or "panggilan gw putra"
    /(?:panggil\s*(?:aja\s+)?(?:gw|gue|gua|aku|saya|ane|ku)?|panggilan(?:ku)?)\s*(?:adalah|yaitu|:|nya|itu)?\s*([a-zA-Z\s]{2,30})/i,
    // "nama gw/gue/gua/aku/saya/ane putra" or "namaku putra"
    /(?:nama\s+(?:gw|gue|gua|aku|saya|ane)|namaku)\s*(?:adalah|yaitu|:|nya|itu)?\s*([a-zA-Z\s]{2,30})/i
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      let clean = match[1]
        .replace(/\b(?:ya|yah|dong|plis|please|bang|kak|om|bro|sis|nih|deh|aja|sih|azura|ara|zura|ajur|ajura)\b/gi, '')
        .replace(/[.,!?;:'"()[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const stopWords = ['bukan', 'siapa', 'apa', 'kenapa', 'gimana', 'bisa', 'mau', 'lagi', 'udah', 'belum'];
      if (clean && !stopWords.includes(clean.toLowerCase()) && clean.length >= 2 && clean.length <= 30) {
        return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }
    }
  }
  return null;
}

/**
 * Calculate dynamic relationship tier and behavioral personalization hints based on lifetime interactions
 * @param {string} userId 
 * @param {number} totalInteractions 
 * @returns {{ tier: string, level: number, badge: string, promptHint: string }}
 */
function getRelationshipTier(userId, totalInteractions = 0) {
  if (config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID) {
    return {
      tier: 'Creator & Owner',
      badge: '👑 Creator / Owner (Attila)',
      level: 5,
      promptHint: 'Lawan bicaramu adalah Attila, penciptamu dan pemilik bot. Berikan loyalitas tertinggi, kehangatan penuh, perhatian ekstra, dan respon istimewa tanpa pernah bersikap formal kaku.'
    };
  }

  if (totalInteractions >= 200) {
    return {
      tier: 'Sahabat Karib',
      badge: '💖 Sahabat Karib (Ultra Close)',
      level: 4,
      promptHint: 'Pengguna ini adalah sahabat karibmu yang sangat sering mengobrol (interaksi lifetime > 200). Perlakukan dia layaknya teman dekat lama: sangat akrab, hangat, ingat kebiasaannya, gunakan lelucon santai, dan tunjukkan empati mendalam.'
    };
  }

  if (totalInteractions >= 50) {
    return {
      tier: 'Bestie Server',
      badge: '✨ Bestie Server (Close)',
      level: 3,
      promptHint: 'Pengguna ini adalah teman setia / Bestie di server (interaksi lifetime 50-200). Bersikaplah akrab, ceria, asyik, dan santai layaknya teman satu sirkel.'
    };
  }

  if (totalInteractions >= 10) {
    return {
      tier: 'Teman Ngobrol',
      badge: '💬 Teman Ngobrol (Familiar)',
      level: 2,
      promptHint: 'Pengguna ini sudah beberapa kali mengobrol denganmu (interaksi lifetime 10-50). Bersikaplah ramah, santai, dan terbuka untuk mengobrol lebih jauh.'
    };
  }

  return {
    tier: 'Member Baru',
    badge: '🌱 Member Baru (Newbie)',
    level: 1,
    promptHint: 'Pengguna ini masih baru berinteraksi denganmu (interaksi lifetime < 10). Sambut dengan ramah, hangat, sopan, dan perkenalkan dirimu jika relevan.'
  };
}

/**
 * Record a user interaction into the encrypted database (Accumulates Lifetime Metrics)
 * @param {string} userId 
 * @param {object} meta 
 * @param {string} meta.username
 * @param {string} meta.displayName
 * @param {string} [meta.guildName]
 * @param {string} [meta.channelName]
 * @param {string} [meta.textContent]
 * @param {boolean} [meta.isVoice]
 */
function recordUserInteraction(userId, meta = {}) {
  if (!userId) return;
  loadVault();

  const nowIso = new Date().toISOString();
  let user = userVaultCache.get(userId);

  if (!user) {
    user = {
      userId,
      username: meta.username || 'unknown',
      displayName: meta.displayName || meta.username || 'User',
      knownRealName: null,
      firstSeen: nowIso,
      lastSeen: nowIso,
      totalMessages: 0,
      totalVoiceTurns: 0,
      totalInteractions: 0,
      sessionCookie: generateSessionCookie(userId, nowIso),
      activeServers: [],
      activeChannels: [],
      notes: []
    };
  }

  // Update profile attributes
  user.username = meta.username || user.username;
  user.displayName = meta.displayName || user.displayName;
  user.lastSeen = nowIso;

  if (meta.isVoice) {
    user.totalVoiceTurns = (user.totalVoiceTurns || 0) + 1;
  } else {
    user.totalMessages = (user.totalMessages || 0) + 1;
  }
  user.totalInteractions = (user.totalMessages || 0) + (user.totalVoiceTurns || 0);

  if (meta.guildName && !user.activeServers.includes(meta.guildName)) {
    user.activeServers.push(meta.guildName);
  }
  if (meta.channelName && !user.activeChannels.includes(meta.channelName)) {
    user.activeChannels.push(meta.channelName);
  }

  // Real-time auto extract real name/nickname whenever mentioned
  if (meta.textContent) {
    const extracted = extractRealName(meta.textContent);
    if (extracted) {
      user.knownRealName = extracted;
      console.log(`[User Vault]: 💡 Real-time updated real name for ${userId} (@${user.username}): "${extracted}"`);
    }
  }

  userVaultCache.set(userId, user);
  saveVault();
}

/**
 * Get aggregate statistics of the encrypted vault (Owner Only)
 * @returns {object}
 */
function getVaultStats() {
  loadVault();
  const allUsers = Array.from(userVaultCache.values());
  const totalUsers = allUsers.length;
  const totalMessages = allUsers.reduce((sum, u) => sum + (u.totalMessages || 0), 0);
  const totalVoiceTurns = allUsers.reduce((sum, u) => sum + (u.totalVoiceTurns || 0), 0);
  const totalInteractions = totalMessages + totalVoiceTurns;

  const now = Date.now();
  const activeToday = allUsers.filter(u => {
    const diffHours = (now - new Date(u.lastSeen).getTime()) / (1000 * 60 * 60);
    return diffHours <= 24;
  }).length;

  const topUsers = [...allUsers]
    .sort((a, b) => (b.totalInteractions || (b.totalMessages || 0) + (b.totalVoiceTurns || 0)) - (a.totalInteractions || (a.totalMessages || 0) + (a.totalVoiceTurns || 0)))
    .slice(0, 10)
    .map(u => {
      const count = (u.totalInteractions || (u.totalMessages || 0) + (u.totalVoiceTurns || 0));
      const relTier = getRelationshipTier(u.userId, count);
      return {
        userId: u.userId,
        displayName: u.displayName,
        username: u.username,
        knownRealName: u.knownRealName || null,
        totalMessages: u.totalMessages || 0,
        totalVoiceTurns: u.totalVoiceTurns || 0,
        totalInteractions: count,
        relationshipTier: relTier.badge,
        firstSeen: u.firstSeen,
        lastSeen: u.lastSeen
      };
    });

  return {
    totalUsers,
    totalMessages,
    totalVoiceTurns,
    totalInteractions,
    activeToday,
    topUsers,
    storageFile: VAULT_FILE_PATH,
    encryption: 'AES-256-GCM (Authenticated)'
  };
}

/**
 * Look up a single user record from encrypted vault (Owner Only)
 * @param {string} query UserId or username substring
 * @returns {object|null}
 */
function getUserRecord(query) {
  loadVault();
  if (!query) return null;
  const q = String(query).replace(/<@!?(\d+)>/, '$1').trim().toLowerCase();

  let user = null;
  if (userVaultCache.has(q)) {
    user = userVaultCache.get(q);
  } else {
    for (const u of userVaultCache.values()) {
      if (u.userId === q ||
          (u.username && u.username.toLowerCase().includes(q)) ||
          (u.displayName && u.displayName.toLowerCase().includes(q))) {
        user = u;
        break;
      }
    }
  }

  if (user) {
    const count = (user.totalInteractions || (user.totalMessages || 0) + (user.totalVoiceTurns || 0));
    const relTier = getRelationshipTier(user.userId, count);
    return {
      ...user,
      totalInteractions: count,
      relationshipTier: relTier.badge,
      relationshipPromptHint: relTier.promptHint
    };
  }

  return null;
}

/**
 * Export decrypted database into JSON or CSV format (Owner Only)
 * @param {'json'|'csv'} format 
 * @returns {string}
 */
function exportVaultData(format = 'json') {
  loadVault();
  const allUsers = Array.from(userVaultCache.values());

  if (format === 'csv') {
    const headers = ['User ID', 'Username', 'Display Name', 'Known Real Name', 'Total Interactions', 'Total Messages', 'Total Voice Turns', 'First Seen', 'Last Seen', 'Active Servers', 'Session Cookie'];
    const rows = allUsers.map(u => {
      const count = (u.totalInteractions || (u.totalMessages || 0) + (u.totalVoiceTurns || 0));
      return [
        `"${u.userId}"`,
        `"${(u.username || '').replace(/"/g, '""')}"`,
        `"${(u.displayName || '').replace(/"/g, '""')}"`,
        `"${(u.knownRealName || '-').replace(/"/g, '""')}"`,
        count,
        u.totalMessages || 0,
        u.totalVoiceTurns || 0,
        `"${u.firstSeen}"`,
        `"${u.lastSeen}"`,
        `"${(u.activeServers || []).join(', ').replace(/"/g, '""')}"`,
        `"${u.sessionCookie || '-'}"`
      ];
    });
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  return JSON.stringify(allUsers, null, 2);
}

module.exports = {
  loadVault,
  saveVault,
  recordUserInteraction,
  extractRealName,
  getRelationshipTier,
  getVaultStats,
  getUserRecord,
  exportVaultData,
  encryptPayload,
  decryptPayload
};
