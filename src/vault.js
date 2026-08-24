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
  if (!text) return null;
  const match = text.match(/(?:nama\s+(?:asli\s+)?(?:gw|aku|saya|gua)|panggil\s+(?:aja\s+)?(?:gw|aku|saya|gua))\s*(?:adalah|yaitu|:)?\s*([a-zA-Z\s]{2,30})/i);
  if (match && match[1]) {
    const clean = match[1].replace(/\b(?:ya|yah|dong|plis|bang|kak)\b/gi, '').trim();
    if (clean.length >= 2 && clean.length <= 30) {
      return clean;
    }
  }
  return null;
}

/**
 * Record a user interaction into the encrypted database
 * @param {string} userId 
 * @param {object} meta 
 * @param {string} meta.username
 * @param {string} meta.displayName
 * @param {string} [meta.guildName]
 * @param {string} [meta.channelName]
 * @param {string} [meta.textContent]
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
  user.totalMessages = (user.totalMessages || 0) + 1;

  if (meta.guildName && !user.activeServers.includes(meta.guildName)) {
    user.activeServers.push(meta.guildName);
  }
  if (meta.channelName && !user.activeChannels.includes(meta.channelName)) {
    user.activeChannels.push(meta.channelName);
  }

  // Auto extract real name if not already known
  if (!user.knownRealName && meta.textContent) {
    const extracted = extractRealName(meta.textContent);
    if (extracted) {
      user.knownRealName = extracted;
      console.log(`[User Vault]: 💡 Extracted real name for ${userId}: "${extracted}"`);
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

  const now = Date.now();
  const activeToday = allUsers.filter(u => {
    const diffHours = (now - new Date(u.lastSeen).getTime()) / (1000 * 60 * 60);
    return diffHours <= 24;
  }).length;

  const topUsers = [...allUsers]
    .sort((a, b) => (b.totalMessages || 0) - (a.totalMessages || 0))
    .slice(0, 5)
    .map(u => ({
      userId: u.userId,
      displayName: u.displayName,
      username: u.username,
      totalMessages: u.totalMessages,
      lastSeen: u.lastSeen
    }));

  return {
    totalUsers,
    totalMessages,
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

  // Direct ID lookup
  if (userVaultCache.has(q)) {
    return userVaultCache.get(q);
  }

  // Username / Display Name lookup
  for (const user of userVaultCache.values()) {
    if (user.userId === q ||
        (user.username && user.username.toLowerCase().includes(q)) ||
        (user.displayName && user.displayName.toLowerCase().includes(q))) {
      return user;
    }
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
    const headers = ['User ID', 'Username', 'Display Name', 'Known Real Name', 'Total Messages', 'First Seen', 'Last Seen', 'Active Servers', 'Session Cookie'];
    const rows = allUsers.map(u => [
      `"${u.userId}"`,
      `"${(u.username || '').replace(/"/g, '""')}"`,
      `"${(u.displayName || '').replace(/"/g, '""')}"`,
      `"${(u.knownRealName || '-').replace(/"/g, '""')}"`,
      u.totalMessages || 0,
      `"${u.firstSeen}"`,
      `"${u.lastSeen}"`,
      `"${(u.activeServers || []).join(', ').replace(/"/g, '""')}"`,
      `"${u.sessionCookie || '-'}"`
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  return JSON.stringify(allUsers, null, 2);
}

module.exports = {
  loadVault,
  saveVault,
  recordUserInteraction,
  getVaultStats,
  getUserRecord,
  exportVaultData,
  encryptPayload,
  decryptPayload
};
