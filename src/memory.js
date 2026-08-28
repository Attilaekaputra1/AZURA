const fs = require('fs');
const path = require('path');
const { readSecureJson, writeSecureJson, isSacredData } = require('./security');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'user_profiles.enc');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Read all user memories from encrypted disk
 * @returns {Record<string, { name: string, facts: string[], updatedAt: string }>}
 */
function loadMemories() {
  try {
    return readSecureJson(MEMORY_FILE, {});
  } catch (err) {
    console.error('[Memory Error]: Failed to read secure user_profiles.enc:', err.message);
    return {};
  }
}

/**
 * Save user memories to encrypted disk
 * @param {Record<string, any>} data 
 */
function saveMemories(data) {
  try {
    writeSecureJson(MEMORY_FILE, data);
  } catch (err) {
    console.error('[Memory Error]: Failed to write secure user_profiles.enc:', err.message);
  }
}

/**
 * Get facts list for a specific user
 * @param {string} userId 
 * @returns {string[]}
 */
function getUserFacts(userId) {
  const memories = loadMemories();
  return memories[userId]?.facts || [];
}

/**
 * Add a new fact to a user's long-term memory.
 * Strictly filters out sacred/sensitive credentials (passwords, PINs, bank data, KTP/NIK).
 * @param {string} userId 
 * @param {string} fact 
 * @returns {{ success: boolean, blocked?: boolean, duplicate?: boolean }}
 */
function addFact(userId, fact) {
  const cleanFact = fact.trim();
  if (!cleanFact) return { success: false };

  // 🛡️ SECURITY GUARD: Block passwords, PINs, credentials, KTP/NIK
  if (isSacredData(cleanFact)) {
    console.warn(`[Memory Security Guard]: ⚠️ Blocked attempt to save sacred/confidential data for user ${userId}.`);
    return { success: false, blocked: true };
  }

  const memories = loadMemories();
  if (!memories[userId]) {
    memories[userId] = {
      name: '',
      facts: [],
      updatedAt: new Date().toISOString()
    };
  }

  const userMem = memories[userId];

  // Prevent duplicate facts (case insensitive check)
  const isDuplicate = userMem.facts.some(f => f.toLowerCase() === cleanFact.toLowerCase());
  if (isDuplicate) return { success: false, duplicate: true };

  userMem.facts.push(cleanFact);
  // Cap at max 20 key facts per user for maximum token efficiency
  if (userMem.facts.length > 20) {
    userMem.facts = userMem.facts.slice(-20);
  }

  userMem.updatedAt = new Date().toISOString();
  saveMemories(memories);
  return { success: true };
}

/**
 * Remove a fact by index
 * @param {string} userId 
 * @param {number} index 
 * @returns {boolean}
 */
function removeFact(userId, index) {
  const memories = loadMemories();
  if (!memories[userId] || !memories[userId].facts[index]) return false;

  memories[userId].facts.splice(index, 1);
  memories[userId].updatedAt = new Date().toISOString();
  saveMemories(memories);
  return true;
}

/**
 * Clear all long-term memory for a user
 * @param {string} userId 
 */
function clearUserMemory(userId) {
  const memories = loadMemories();
  if (memories[userId]) {
    delete memories[userId];
    saveMemories(memories);
  }
}

/**
 * Auto-detect if user is explicitly telling AZURA a fact to remember
 * @param {string} userId 
 * @param {string} prompt 
 */
function autoExtractFact(userId, prompt) {
  const lower = prompt.toLowerCase().trim();

  // Explicit trigger: "ingat ya...", "catat ya...", "remember...", "ingetin ya...", "fyi..."
  const explicitMatch = lower.match(/(?:ingat|ingetin|catat|remember|simpan|fyi)\s*(?:ya|yah|nih|bro|azura|ara)?\s*[:,]?\s*(.+)/i);
  if (explicitMatch && explicitMatch[1]) {
    let fact = explicitMatch[1].trim();
    // Clean up ending punctuation/words
    fact = fact.replace(/(?:ya|yah|dong|pls|please)[!.]*$/i, '').trim();
    if (fact.length >= 3 && fact.length <= 150) {
      addFact(userId, fact);
      console.log(`[Memory Auto-Save] Saved explicit fact for ${userId}: "${fact}"`);
      return fact;
    }
  }

  // Personal attributes & profile trigger: "nama asli gw...", "nama panggilan gw...", "hobi gw...", "panggil gw...", "ultah gw..."
  const attrMatch = lower.match(/(?:nama\s+asli|nama\s+panggilan|nama|panggil\s+aja|panggilan|hobi|ultah|ulang tahun|tanggal lahir|makanan favorit|minuman favorit|game favorit|anime favorit)\s*(?:gw|gue|gua|aku|saya|ane|ku)?\s*[:=]?\s*(.+)/i);
  if (attrMatch && attrMatch[1]) {
    let fact = prompt.trim();
    if (fact.length >= 5 && fact.length <= 150) {
      addFact(userId, fact);
      console.log(`[Memory Auto-Save] Saved attribute fact for ${userId}: "${fact}"`);
      return fact;
    }
  }

  // Career, project, tech stack & lifestyle trigger: "gw kerja sebagai...", "gw lagi bikin...", "tech stack gw..."
  const careerMatch = lower.match(/(?:(?:gw|aku|saya|gua)\s+(?:kerja sebagai|seorang|lagi ngerjain project|lagi bikin|pake stack|pake framework|tinggal di|asal dari)\s+.+)/i);
  if (careerMatch) {
    let fact = prompt.trim();
    if (fact.length >= 8 && fact.length <= 150) {
      addFact(userId, fact);
      console.log(`[Memory Auto-Save] Saved career/context fact for ${userId}: "${fact}"`);
      return fact;
    }
  }

  // Preferences, Likes & Dislikes trigger: "aku lebih suka art", "aku tidak terlalu suka coding", "minatku di hardware"
  const prefMatch = lower.match(/(?:(?:gw|aku|saya|gua)\s+(?:lebih\s+suka|tidak\s+terlalu\s+suka|nggak\s+suka|gak\s+suka|suka\s+banget|tertarik\s+sama|fokus\s+di|lebih\s+condong\s+ke)\s+.+)/i);
  if (prefMatch) {
    let fact = prompt.trim();
    if (fact.length >= 8 && fact.length <= 150) {
      // If user says doesn't like coding, purge old coding facts
      if (/\b(?:tidak|nggak|gak|bukan)\s+(?:terlalu\s+)?(?:suka|minat)?\s*(?:sama\s+)?(?:coding|koding)\b/i.test(fact)) {
        const memories = loadMemories();
        if (memories[userId] && Array.isArray(memories[userId].facts)) {
          memories[userId].facts = memories[userId].facts.filter(f => !/\b(?:suka\s+coding|coding\s+enthusiast)\b/i.test(f));
          saveMemories(memories);
        }
      }
      addFact(userId, fact);
      console.log(`[Memory Auto-Save] Saved preference fact for ${userId}: "${fact}"`);
      return fact;
    }
  }

  return null;
}

module.exports = {
  getUserFacts,
  addFact,
  removeFact,
  clearUserMemory,
  autoExtractFact,
  loadMemories
};
