/**
 * AZURA Voice Session State Persistence Subsystem (Solving Concurrency State Loss on Restart)
 * Periodically caches active VC session context, conversation modes, and recent turns
 * to encrypted storage every 30 seconds and restores on bot boot.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const CACHE_FILE = path.join(__dirname, '../data/vc_session_cache.enc');
const SALT = 'azura_vc_session_salt_2026';

function getDerivedKey() {
  const secret = config.DATABASE_ENCRYPTION_KEY || 'azura_master_vault_key_fallback';
  return crypto.scryptSync(secret, SALT, 32);
}

function encryptState(data) {
  const text = JSON.stringify(data);
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), tag, ciphertext: encrypted });
}

function decryptState(envelopeStr) {
  try {
    const envelope = JSON.parse(envelopeStr);
    const key = getDerivedKey();
    const iv = Buffer.from(envelope.iv, 'hex');
    const tag = Buffer.from(envelope.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(envelope.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

/**
 * Save active session memory and conversation modes to disk cache
 */
function saveVoiceStateCache(voiceSessions, conversationMode) {
  try {
    const payload = {
      timestamp: Date.now(),
      sessions: Object.fromEntries(voiceSessions || new Map()),
      modes: Object.fromEntries(conversationMode || new Map())
    };

    const envelope = encryptState(payload);
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, envelope, 'utf8');
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    console.error('[Voice State Persistence Error]:', err.message);
  }
}

/**
 * Load cached voice session state on startup
 */
function loadVoiceStateCache(voiceSessions, conversationMode) {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const state = decryptState(raw);
    if (!state || !state.sessions) return;

    // Discard cache if older than 30 minutes
    if (Date.now() - state.timestamp > 30 * 60 * 1000) return;

    if (voiceSessions && state.sessions) {
      for (const [gid, val] of Object.entries(state.sessions)) {
        voiceSessions.set(gid, val);
      }
    }
    if (conversationMode && state.modes) {
      for (const [gid, val] of Object.entries(state.modes)) {
        conversationMode.set(gid, val);
      }
    }
    console.log(`[Voice State Persistence]: 🔄 Restored ${voiceSessions.size} active voice session contexts from disk cache.`);
  } catch (err) {
    console.warn('[Voice State Restore Warning]:', err.message);
  }
}

module.exports = {
  saveVoiceStateCache,
  loadVoiceStateCache
};
