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
const BLACKLIST_FILE_PATH = path.join(__dirname, '../data/user_blacklist.enc');
const VAULT_SALT = 'azura_salt_zero_knowledge_vault_2026';

// In-memory cache of decrypted records (accessible strictly by internal vault functions)
let userVaultCache = new Map();
let userBlacklistCache = new Map(); // userId -> { userId, username, displayName, reason, bannedAt, bannedBy }
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
 * Load and decrypt user database and blacklist database from disk
 */
function loadVault() {
  if (isVaultLoaded) return;
  try {
    const dataDir = path.dirname(VAULT_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 1. Load User Vault
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

    // 2. Load Blacklist Database
    if (fs.existsSync(BLACKLIST_FILE_PATH)) {
      const encryptedBl = fs.readFileSync(BLACKLIST_FILE_PATH, 'utf8');
      const decryptedBl = decryptPayload(encryptedBl);
      if (decryptedBl && typeof decryptedBl === 'object') {
        userBlacklistCache = new Map(Object.entries(decryptedBl));
        console.log(`[User Vault Engine]: 🛡️ Decrypted and loaded ${userBlacklistCache.size} blacklisted identities.`);
      }
    } else {
      userBlacklistCache = new Map();
    }

    isVaultLoaded = true;
  } catch (err) {
    console.error('[User Vault Load Error]:', err.message);
    userVaultCache = new Map();
    userBlacklistCache = new Map();
    isVaultLoaded = true;
  }
}

/**
 * Encrypt and atomically save user database and blacklist to disk
 */
function saveVault() {
  try {
    // 1. Save User Vault
    const plainObj = Object.fromEntries(userVaultCache);
    const encryptedEnvelope = encryptPayload(plainObj);
    const tmpPath = `${VAULT_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, encryptedEnvelope, 'utf8');
    fs.renameSync(tmpPath, VAULT_FILE_PATH);

    // 2. Save Blacklist Vault
    const plainBl = Object.fromEntries(userBlacklistCache);
    const encryptedBl = encryptPayload(plainBl);
    const tmpBlPath = `${BLACKLIST_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpBlPath, encryptedBl, 'utf8');
    fs.renameSync(tmpBlPath, BLACKLIST_FILE_PATH);
  } catch (err) {
    console.error('[User Vault Save Error]: Failed to save encrypted vault/blacklist:', err.message);
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
 * Comprehensive Stop Words to prevent false-positive name extractions from slang/filler words
 */
const STOP_WORDS = new Set([
  'bukan', 'siapa', 'apa', 'kenapa', 'gimana', 'bisa', 'mau', 'lagi', 'udah', 'belum',
  'kalian', 'mereka', 'kamu', 'dia', 'kita', 'kami', 'itu', 'ini', 'dong', 'sih', 'deh',
  'kok', 'kan', 'yang', 'yg', 'dan', 'atau', 'kalau', 'kalo', 'pada', 'sama', 'dari',
  'ke', 'di', 'untuk', 'dengan', 'ada', 'tidak', 'nggak', 'gak', 'nya', 'annya', 'azura', 'ara', 'zura', 'ajur', 'ajura', 'asura',
  'halo', 'hei', 'hai', 'oi', 'oy', 'pagi', 'siang', 'sore', 'malam', 'test', 'tes', 'ping', 'help',
  'lah', 'jir', 'wkwk', 'wkwkwk', 'haha', 'hahaha', 'oalah', 'oalahhh', 'bro', 'bang', 'mas', 'kak',
  'gua', 'gw', 'aku', 'saya', 'gue', 'lu', 'luu', 'elu', 'anjir', 'anjay', 'bjir', 'buset', 'anj',
  'yoi', 'yoii', 'ok', 'oke', 'sip', 'siap', 'noted', 'mantap', 'santai', 'sans', 'gpp', 'gapapa',
  'nama', 'panggilan', 'asli', 'siapakah', 'apakah', 'adalah', 'yaitu'
]);

/**
 * Strict First-Time Registration Extraction
 * Only triggers for new users when message explicitly intends to set/register a nickname.
 * @param {string} text 
 * @param {boolean} isDM 
 * @returns {string|null}
 */
function extractRegistrationName(text, isDM = false) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // If text contains question marks or obvious conversational inquiries, ignore
  if (trimmed.includes('?') || /\b(?:siapa|apa|kenapa|gimana|tau|tahu|kenal)\b/i.test(trimmed)) {
    return null;
  }

  const strictRegistrationPatterns = [
    // "nama asli gw/gue/gua/aku/saya/ane/ku adalah Putra" or "nama asliku Putra"
    /\b(?:nama\s+asli\s+(?:gw|gue|gua|aku|saya|ane|ku)|nama\s+asliku)\s*(?:adalah|yaitu|:|=|\s+)\s*([a-zA-Z\s]{2,25})/i,
    // "nama panggilan gw/aku/saya/ku adalah Putra" or "nama panggilanku Putra"
    /\b(?:nama\s+panggilan\s+(?:gw|gue|gua|aku|saya|ane|ku)|nama\s+panggilanku)\s*(?:adalah|yaitu|:|=|\s+)\s*([a-zA-Z\s]{2,25})/i,
    // "panggil gw/gue/gua/aku/saya/ane (aja)? Putra" or "panggilan gw Putra"
    /\b(?:panggil\s+(?:aja\s+)?(?:gw|gue|gua|aku|saya|ane|ku)|panggil\s+(?:gw|gue|gua|aku|saya|ane|ku)\s+aja|panggilan\s+(?:gw|gue|gua|aku|saya|ane|ku))\s*(?:adalah|yaitu|:|=|\s+)?\s*([a-zA-Z\s]{2,25})/i,
    // "namaku Putra", "nama saya Putra", "nama gw Putra", "nama gua Putra"
    /^(?:namaku|nama\s+(?:gw|gue|gua|aku|saya|ane|ku))\s+(?:adalah|yaitu|:|=)?\s*([a-zA-Z\s]{2,25})$/i,
    // Direct command: "panggil aku/gw/saya Putra"
    /^panggil\s+(?:aku|gw|gue|gua|saya|ane|ku)\s+([a-zA-Z\s]{2,25})$/i
  ];

  for (const pat of strictRegistrationPatterns) {
    const match = trimmed.match(pat);
    if (match && match[1]) {
      let rawCaptured = match[1].trim();
      const firstSegment = rawCaptured
        .split(/[.,!?;:'"()[\]\n\r]+/)[0]
        .replace(/\b(?:ya|yah|dong|plis|please|bang|kak|om|bro|sis|nih|deh|aja|sih|azura|ara|zura|ajur|ajura)\b/gi, '')
        .trim();

      const words = firstSegment.split(/\s+/).filter(Boolean);
      if (words.length >= 1 && words.length <= 3) {
        const hasStopWord = words.some(w => STOP_WORDS.has(w.toLowerCase()));
        if (!hasStopWord) {
          const cleanName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
          if (cleanName.length >= 2 && cleanName.length <= 25) {
            return cleanName;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Strict Name Change Request Extraction (STRICTLY EXCLUSIVE TO DM)
 * User must explicitly express intent to change their existing registered name.
 * @param {string} text 
 * @returns {string|null}
 */
function extractNameChangeRequest(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // If text contains question marks or conversational inquiries, ignore
  if (trimmed.includes('?') || /\b(?:siapa|apa|kenapa|gimana|tau|tahu|kenal)\b/i.test(trimmed)) {
    return null;
  }

  const changePatterns = [
    // "ganti namaku/namaku jadi/menjadi Putra" or "ubah nama panggilan jadi Putra"
    /\b(?:ganti|ubah|request\s+ganti|mau\s+ganti)\s+(?:nama\s+panggilan\s+(?:gw|gue|gua|aku|saya|ku)|nama\s+panggilanku|nama\s+(?:gw|gue|gua|aku|saya|ku)|namaku|nama)?\s*(?:menjadi|jadi|ke)\s*([a-zA-Z\s]{2,25})/i,
    // "panggil aku Putra aja mulai sekarang"
    /\bpanggil\s+(?:aku|gw|gue|gua|saya)\s+([a-zA-Z\s]{2,25})\s+aja\s+mulai\s+sekarang/i
  ];

  for (const pat of changePatterns) {
    const match = trimmed.match(pat);
    if (match && match[1]) {
      let rawCaptured = match[1].trim();
      const firstSegment = rawCaptured
        .split(/[.,!?;:'"()[\]\n\r]+/)[0]
        .replace(/\b(?:ya|yah|dong|plis|please|bang|kak|om|bro|sis|nih|deh|aja|sih|azura|ara|zura|ajur|ajura)\b/gi, '')
        .trim();

      const words = firstSegment.split(/\s+/).filter(Boolean);
      if (words.length >= 1 && words.length <= 3) {
        const hasStopWord = words.some(w => STOP_WORDS.has(w.toLowerCase()));
        if (!hasStopWord) {
          const cleanName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
          if (cleanName.length >= 2 && cleanName.length <= 25) {
            return cleanName;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Legacy extraction helper (Strict)
 * @param {string} text 
 * @returns {string|null}
 */
function extractRealName(text) {
  return extractRegistrationName(text, false);
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

// Protected Name Blacklist (Anti-Impersonation Defense)
const PROTECTED_OWNER_NAMES = new Set([
  'putra', 'attila', 'attilaekaputra', 'owner', 'creator', 'pemilik',
  'admin', 'administrator', 'azura', 'ara', 'zura', 'ajur', 'ajura',
  'developer', 'dev', 'bot'
]);

/**
 * Record a user interaction into the encrypted database (Accumulates Lifetime Metrics & Strict Lock-In)
 * @param {string} userId 
 * @param {object} meta 
 * @param {string} meta.username
 * @param {string} meta.displayName
 * @param {string} [meta.guildName]
 * @param {string} [meta.channelName]
 * @param {string} [meta.textContent]
 * @param {boolean} [meta.isVoice]
 * @param {boolean} [meta.isDM]
 * @returns {object|null} nameActionResult
 */
function recordUserInteraction(userId, meta = {}) {
  if (!userId) return null;
  loadVault();

  const nowIso = new Date().toISOString();
  let user = userVaultCache.get(userId);

  if (!user) {
    user = {
      userId,
      username: meta.username || 'unknown',
      displayName: meta.displayName || meta.username || 'User',
      knownRealName: null,
      isNameLocked: false,
      pendingNameChange: null,
      firstSeen: nowIso,
      lastSeen: nowIso,
      totalMessages: 0,
      totalVoiceTurns: 0,
      totalInteractions: 0,
      serverMessages: 0,
      dmMessages: 0,
      usedInServer: false,
      usedInDm: false,
      isBanned: false,
      banReason: null,
      bannedAt: null,
      bannedBy: null,
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

  // Track Scope: DM vs Server
  const isDM = meta.isDM || !meta.guildName;
  if (isDM) {
    user.dmMessages = (user.dmMessages || 0) + 1;
    user.usedInDm = true;
  } else {
    user.serverMessages = (user.serverMessages || 0) + 1;
    user.usedInServer = true;
  }

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

  // Strict Real Name Extraction & Lock-in Protocol
  let nameActionResult = null;

  if (meta.textContent) {
    const isOwner = (userId === config.OWNER_DISCORD_ID);

    // Case 1: First-time Registration (User has NO registered nickname yet)
    if (!user.knownRealName) {
      const extracted = extractRegistrationName(meta.textContent, isDM);
      if (extracted) {
        const isProtected = PROTECTED_OWNER_NAMES.has(extracted.toLowerCase());
        if (!isOwner && isProtected) {
          console.warn(`[User Vault Security]: 🚫 User ${userId} attempted to impersonate protected identity: "${extracted}"`);
          nameActionResult = {
            status: 'IMPERSONATION_BLOCKED',
            userId,
            username: user.username,
            displayName: user.displayName,
            requestedName: extracted
          };
        } else {
          user.knownRealName = extracted;
          user.isNameLocked = true;
          user.pendingNameChange = null;
          console.log(`[User Vault]: 🔒 First-time locked real name for ${userId} (@${user.username}): "${extracted}"`);
          nameActionResult = {
            status: 'FIRST_REGISTRATION',
            userId,
            username: user.username,
            displayName: user.displayName,
            name: extracted
          };
        }
      }
    } else if (isOwner) {
      // Owner can freely update name anytime
      const extracted = extractRegistrationName(meta.textContent, isDM) || (isDM && extractNameChangeRequest(meta.textContent));
      if (extracted) {
        user.knownRealName = extracted;
        user.isNameLocked = true;
        user.pendingNameChange = null;
        nameActionResult = {
          status: 'OWNER_UPDATED',
          userId,
          name: extracted
        };
      }
    } else {
      // Case 2: User ALREADY has a registered & locked nickname
      // 🔒 STRICT RULE: In Server Chat, name is 100% LOCKED. NEVER extract or trigger name changes from server chatter!
      // Name change requests are STRICTLY EXCLUSIVE to Direct Messages (DM) with explicit intent!
      if (isDM) {
        const requestedNewName = extractNameChangeRequest(meta.textContent);
        if (requestedNewName && requestedNewName.toLowerCase() !== user.knownRealName.toLowerCase()) {
          const isProtected = PROTECTED_OWNER_NAMES.has(requestedNewName.toLowerCase());
          if (isProtected) {
            console.warn(`[User Vault Security]: 🚫 User ${userId} attempted to request protected identity: "${requestedNewName}"`);
            nameActionResult = {
              status: 'IMPERSONATION_BLOCKED',
              userId,
              username: user.username,
              displayName: user.displayName,
              requestedName: requestedNewName
            };
          } else {
            user.pendingNameChange = {
              requestedName: requestedNewName,
              requestedAt: nowIso
            };
            console.log(`[User Vault]: ⏳ Nickname change request queued in DM for ${userId} (@${user.username}): "${user.knownRealName}" -> "${requestedNewName}" (Pending Attila's Approval)`);
            nameActionResult = {
              status: 'PENDING_APPROVAL',
              userId,
              username: user.username,
              displayName: user.displayName,
              currentName: user.knownRealName,
              requestedName: requestedNewName
            };
          }
        }
      }
      // If in Server (!isDM), nameActionResult remains null! No intercept, no false positive approval requests!
    }
  }

  userVaultCache.set(userId, user);
  saveVault();
  return nameActionResult;
}

/**
 * Check if a user is currently banned / blacklisted (O(1) in-memory check)
 * @param {string} userId 
 * @returns {boolean}
 */
function isUserBanned(userId) {
  if (!userId) return false;
  loadVault();
  return userBlacklistCache.has(userId);
}

/**
 * Ban / Blacklist a user from all AZURA services (Owner Only or Auto-Security)
 * @param {string} targetQuery 
 * @param {string} reason 
 * @param {string} bannedBy 
 */
function banUser(targetQuery, reason = 'Pelanggaran ketentuan penggunaan AZURA', bannedBy = 'ATTILA_OWNER') {
  loadVault();
  const user = getUserRecord(targetQuery);
  const targetId = user ? user.userId : String(targetQuery).replace(/<@!?(\d+)>/, '$1').trim();
  const targetUsername = user ? user.username : 'unknown';
  const targetDisplayName = user ? user.displayName : 'User';

  const banRecord = {
    userId: targetId,
    username: targetUsername,
    displayName: targetDisplayName,
    reason,
    bannedAt: new Date().toISOString(),
    bannedBy
  };

  userBlacklistCache.set(targetId, banRecord);

  // If user exists in vault, mark banned status
  if (userVaultCache.has(targetId)) {
    const u = userVaultCache.get(targetId);
    u.isBanned = true;
    u.banReason = reason;
    u.bannedAt = banRecord.bannedAt;
    u.bannedBy = bannedBy;
  }

  saveVault();
  console.log(`[User Vault Security]: 🚫 User ${targetId} (@${targetUsername}) has been PERMANENTLY BLACKLISTED by ${bannedBy}. Reason: ${reason}`);
  return { success: true, ...banRecord };
}

/**
 * Unban / Remove user from blacklist (Owner Only)
 * @param {string} targetQuery 
 */
function unbanUser(targetQuery) {
  loadVault();
  const user = getUserRecord(targetQuery);
  const targetId = user ? user.userId : String(targetQuery).replace(/<@!?(\d+)>/, '$1').trim();

  if (!userBlacklistCache.has(targetId)) {
    return { success: false, message: 'User tidak ditemukan di daftar blacklist.' };
  }

  const prev = userBlacklistCache.get(targetId);
  userBlacklistCache.delete(targetId);

  if (userVaultCache.has(targetId)) {
    const u = userVaultCache.get(targetId);
    u.isBanned = false;
    u.banReason = null;
    u.bannedAt = null;
    u.bannedBy = null;
  }

  saveVault();
  console.log(`[User Vault Security]: 🔓 User ${targetId} has been UNBANNED.`);
  return { success: true, userId: targetId, username: prev.username };
}

/**
 * Get all blacklisted users
 */
function getBlacklist() {
  loadVault();
  return Array.from(userBlacklistCache.values());
}

/**
 * Approve a pending nickname change for a user (Owner Only)
 * @param {string} userId 
 */
function approvePendingNameChange(userId) {
  loadVault();
  const user = userVaultCache.get(userId);
  if (!user || !user.pendingNameChange) return null;
  const newName = user.pendingNameChange.requestedName;
  const oldName = user.knownRealName;
  user.knownRealName = newName;
  user.isNameLocked = true;
  user.pendingNameChange = null;
  saveVault();
  return { success: true, userId, username: user.username, oldName, newName };
}

/**
 * Reject a pending nickname change for a user (Owner Only)
 * @param {string} userId 
 */
function rejectPendingNameChange(userId) {
  loadVault();
  const user = userVaultCache.get(userId);
  if (!user || !user.pendingNameChange) return null;
  const rejectedName = user.pendingNameChange.requestedName;
  user.pendingNameChange = null;
  saveVault();
  return { success: true, userId, username: user.username, rejectedName, currentName: user.knownRealName };
}

/**
 * Explicitly set or override a user's nickname by Owner
 * @param {string} targetQuery 
 * @param {string} newName 
 * @param {boolean} [lock=true] 
 */
function setUserNameByOwner(targetQuery, newName, lock = true) {
  loadVault();
  const user = getUserRecord(targetQuery);
  if (!user) return null;
  const actualUser = userVaultCache.get(user.userId);
  const oldName = actualUser.knownRealName;
  actualUser.knownRealName = newName;
  actualUser.isNameLocked = lock;
  actualUser.pendingNameChange = null;
  saveVault();
  return {
    success: true,
    userId: actualUser.userId,
    username: actualUser.username,
    displayName: actualUser.displayName,
    oldName,
    newName,
    isLocked: lock
  };
}

/**
 * Unlock a user's nickname allowing them to register a new one
 * @param {string} targetQuery 
 */
function unlockUserNameByOwner(targetQuery) {
  loadVault();
  const user = getUserRecord(targetQuery);
  if (!user) return null;
  const actualUser = userVaultCache.get(user.userId);
  actualUser.isNameLocked = false;
  saveVault();
  return { success: true, userId: actualUser.userId, username: actualUser.username, currentName: actualUser.knownRealName };
}

/**
 * Get formatted list of all registered users in vault
 */
function getAllUsersList() {
  loadVault();
  return Array.from(userVaultCache.values()).map(u => ({
    userId: u.userId,
    username: u.username,
    displayName: u.displayName,
    knownRealName: u.knownRealName || null,
    isNameLocked: !!u.isNameLocked,
    pendingNameChange: u.pendingNameChange || null,
    totalMessages: u.totalMessages || 0,
    totalVoiceTurns: u.totalVoiceTurns || 0,
    totalInteractions: (u.totalMessages || 0) + (u.totalVoiceTurns || 0),
    serverMessages: u.serverMessages || 0,
    dmMessages: u.dmMessages || 0,
    usedInServer: !!u.usedInServer || (u.activeServers && u.activeServers.length > 0),
    usedInDm: !!u.usedInDm,
    isBanned: userBlacklistCache.has(u.userId) || !!u.isBanned,
    banReason: u.banReason || userBlacklistCache.get(u.userId)?.reason || null,
    relationshipTier: getRelationshipTier(u.userId, (u.totalMessages || 0) + (u.totalVoiceTurns || 0)).badge,
    activeServers: u.activeServers || [],
    firstSeen: u.firstSeen,
    lastSeen: u.lastSeen
  }));
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
  const totalDmMessages = allUsers.reduce((sum, u) => sum + (u.dmMessages || 0), 0);
  const totalServerMessages = allUsers.reduce((sum, u) => sum + (u.serverMessages || 0), 0);
  const usersWithDm = allUsers.filter(u => u.usedInDm || u.dmMessages > 0).length;
  const totalBanned = userBlacklistCache.size;

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
        serverMessages: u.serverMessages || 0,
        dmMessages: u.dmMessages || 0,
        usedInDm: !!u.usedInDm,
        isBanned: userBlacklistCache.has(u.userId) || !!u.isBanned,
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
    totalServerMessages,
    totalDmMessages,
    usersWithDm,
    totalBanned,
    activeToday,
    topUsers,
    storageFile: VAULT_FILE_PATH,
    blacklistFile: BLACKLIST_FILE_PATH,
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
    const isBanned = userBlacklistCache.has(user.userId) || !!user.isBanned;
    const banInfo = userBlacklistCache.get(user.userId) || null;
    return {
      ...user,
      totalInteractions: count,
      serverMessages: user.serverMessages || 0,
      dmMessages: user.dmMessages || 0,
      usedInServer: !!user.usedInServer || (user.activeServers && user.activeServers.length > 0),
      usedInDm: !!user.usedInDm,
      isBanned,
      banReason: user.banReason || banInfo?.reason || null,
      bannedAt: user.bannedAt || banInfo?.bannedAt || null,
      bannedBy: user.bannedBy || banInfo?.bannedBy || null,
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
    const headers = ['User ID', 'Username', 'Display Name', 'Known Real Name', 'Total Interactions', 'Total Messages', 'Server Messages', 'DM Messages', 'Used In DM', 'Total Voice Turns', 'Is Banned', 'First Seen', 'Last Seen', 'Active Servers', 'Session Cookie'];
    const rows = allUsers.map(u => {
      const count = (u.totalInteractions || (u.totalMessages || 0) + (u.totalVoiceTurns || 0));
      return [
        `"${u.userId}"`,
        `"${(u.username || '').replace(/"/g, '""')}"`,
        `"${(u.displayName || '').replace(/"/g, '""')}"`,
        `"${(u.knownRealName || '-').replace(/"/g, '""')}"`,
        count,
        u.totalMessages || 0,
        u.serverMessages || 0,
        u.dmMessages || 0,
        u.usedInDm ? 'YES' : 'NO',
        u.totalVoiceTurns || 0,
        userBlacklistCache.has(u.userId) || u.isBanned ? 'BANNED' : 'ACTIVE',
        `"${u.firstSeen}"`,
        `"${u.lastSeen}"`,
        `"${(u.activeServers || []).join(', ').replace(/"/g, '""')}"`,
        `"${u.sessionCookie || '-'}"`
      ];
    });
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  return JSON.stringify({
    users: allUsers,
    blacklist: Array.from(userBlacklistCache.values())
  }, null, 2);
}

module.exports = {
  loadVault,
  saveVault,
  recordUserInteraction,
  extractRealName,
  extractRegistrationName,
  extractNameChangeRequest,
  getRelationshipTier,
  getVaultStats,
  getUserRecord,
  exportVaultData,
  encryptPayload,
  decryptPayload,
  approvePendingNameChange,
  rejectPendingNameChange,
  setUserNameByOwner,
  unlockUserNameByOwner,
  getAllUsersList,
  isUserBanned,
  banUser,
  unbanUser,
  getBlacklist
};
