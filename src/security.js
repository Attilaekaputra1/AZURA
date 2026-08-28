/**
 * AZURA High-Security Core Engine
 * 1. Military-Grade AES-256-GCM Database & File Encryption
 * 2. Multi-Layer Master Password Authentication & 15-Minute Session Token System
 * 3. Sacred & Sensitive Data Protection Filter (Anti-credential / Anti-password leak)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const MASTER_SALT = 'azura_high_security_master_salt_2026_aes_gcm';
const VAULT_SALT = 'azura_salt_zero_knowledge_vault_2026';
const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes session token validity

// Active security sessions: userId -> sessionExpiryTimestamp
const activeSessions = new Map();

/**
 * Derive 32-byte key from master secret using scrypt
 * @param {string} [customKey] 
 * @param {string} [salt]
 * @returns {Buffer}
 */
function getDerivedKey(customKey = null, salt = MASTER_SALT) {
  const secret = customKey || config.DATABASE_ENCRYPTION_KEY || 'azura_master_vault_key_fallback_2026';
  return crypto.scryptSync(secret, salt, 32);
}

/**
 * Encrypt arbitrary data with AES-256-GCM envelope
 * @param {string|object} data 
 * @returns {string} JSON-serialized envelope string
 */
function encryptPayload(data) {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12); // 12-byte random IV for GCM

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  const envelope = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: authTag,
    ciphertext: encrypted
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt an AES-256-GCM envelope with automatic multi-salt fallbacks
 * @param {string} envelopeStr 
 * @returns {any} Decrypted object or string (or null if corrupted/wrong key)
 */
function decryptPayload(envelopeStr) {
  try {
    if (!envelopeStr || typeof envelopeStr !== 'string') return null;
    let envelope;
    try {
      envelope = JSON.parse(envelopeStr);
    } catch (_) {
      return null;
    }
    if (!envelope.iv || !envelope.tag || !envelope.ciphertext) {
      // Might be legacy plain JSON string
      return envelope;
    }

    const saltsToTry = [MASTER_SALT, VAULT_SALT];
    for (const salt of saltsToTry) {
      try {
        const key = getDerivedKey(null, salt);
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
      } catch (_) {
        // Try next salt
      }
    }
    return null;
  } catch (err) {
    console.error('[Security Decryption Error]:', err.message);
    return null;
  }
}

/**
 * Read securely encrypted JSON file from disk.
 * Automatically checks for legacy plain .json and migrates to encrypted .enc.
 * @param {string} encFilePath 
 * @param {any} [defaultValue] 
 * @returns {any}
 */
function readSecureJson(encFilePath, defaultValue = {}) {
  try {
    const dataDir = path.dirname(encFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 1. If encrypted file exists, decrypt and return
    if (fs.existsSync(encFilePath)) {
      const raw = fs.readFileSync(encFilePath, 'utf8');
      const decrypted = decryptPayload(raw);
      if (decrypted !== null) return decrypted;
    }

    // 2. Auto-migration: check if plain .json version exists
    const plainJsonPath = encFilePath.replace(/\.enc$/i, '.json');
    if (plainJsonPath !== encFilePath && fs.existsSync(plainJsonPath)) {
      try {
        const rawPlain = fs.readFileSync(plainJsonPath, 'utf8');
        const parsed = JSON.parse(rawPlain || '{}');
        // Encrypt and save to .enc
        writeSecureJson(encFilePath, parsed);
        // Safely remove unencrypted plain file
        fs.unlinkSync(plainJsonPath);
        console.log(`[Security Engine]: 🔒 Successfully migrated & encrypted "${path.basename(plainJsonPath)}" -> "${path.basename(encFilePath)}".`);
        return parsed;
      } catch (_) {}
    }

    return defaultValue;
  } catch (err) {
    console.error(`[Security Read Error]: Failed to read secure file "${encFilePath}":`, err.message);
    return defaultValue;
  }
}

/**
 * Write data to disk using AES-256-GCM atomic encryption
 * @param {string} encFilePath 
 * @param {any} data 
 * @returns {boolean}
 */
function writeSecureJson(encFilePath, data) {
  try {
    const dataDir = path.dirname(encFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const encryptedEnvelope = encryptPayload(data);
    const tmpPath = `${encFilePath}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpPath, encryptedEnvelope, 'utf8');
    fs.renameSync(tmpPath, encFilePath);
    return true;
  } catch (err) {
    console.error(`[Security Write Error]: Failed to write secure file "${encFilePath}":`, err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// ── Master Password & Multi-Layer Session Authentication ──────
// ══════════════════════════════════════════════════════════════

/**
 * Verify user-provided password against Master Security Password
 * @param {string} inputPassword 
 * @returns {boolean}
 */
function verifyMasterPassword(inputPassword) {
  if (!inputPassword || typeof inputPassword !== 'string') return false;
  const master = config.MASTER_SECURITY_PASSWORD || 'AzuraSecurity2026!';
  const inputBuf = Buffer.from(inputPassword.trim());
  const masterBuf = Buffer.from(master.trim());
  if (inputBuf.length !== masterBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, masterBuf);
}

/**
 * Create a verified 15-minute authenticated security session
 * @param {string} userId 
 * @returns {{ expiresAt: number, expiresInStr: string }}
 */
function createAuthSession(userId) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  activeSessions.set(userId, expiresAt);
  return {
    expiresAt,
    expiresInStr: '15 Menit'
  };
}

/**
 * Check if a user's security session is currently active and valid
 * @param {string} userId 
 * @returns {boolean}
 */
function isAuthSessionActive(userId) {
  if (!userId) return false;
  if (!activeSessions.has(userId)) return false;
  const expiresAt = activeSessions.get(userId);
  if (Date.now() >= expiresAt) {
    activeSessions.delete(userId);
    return false;
  }
  return true;
}

/**
 * Revoke / Logout user security session
 * @param {string} userId 
 */
function revokeAuthSession(userId) {
  activeSessions.delete(userId);
}

// ══════════════════════════════════════════════════════════════
// ── Sacred & Sensitive Data Protection Filter ─────────────────
// ══════════════════════════════════════════════════════════════

const SACRED_PATTERNS = [
  /\b(?:password|passwd|kata\s*sandi|passcode|secret_key|api_key|token|bearer|id_rsa|private_key)\b/i,
  /\b(?:pin\s*atm|cvv|cvc|nomor\s*rekening|kartu\s*kredit|credit\s*card|bank\s*account)\b/i,
  /\b(?:nik|nomor\s*ktp|kartu\s*keluarga|passport|sim\s*card|dokumen\s*rahasia)\b/i,
  /\b(?:seed\s*phrase|recovery\s*phrase|mnemonic|wallet\s*key)\b/i,
  /\b(?:sk-[a-zA-Z0-9]{20,}|tvly-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,})\b/i
];

/**
 * Check if a given string contains sacred, critical, or sensitive data
 * @param {string} text 
 * @returns {boolean}
 */
function isSacredData(text) {
  if (!text || typeof text !== 'string') return false;
  return SACRED_PATTERNS.some(pattern => pattern.test(text));
}

module.exports = {
  encryptPayload,
  decryptPayload,
  readSecureJson,
  writeSecureJson,
  verifyMasterPassword,
  createAuthSession,
  isAuthSessionActive,
  revokeAuthSession,
  isSacredData,
  SESSION_DURATION_MS
};
