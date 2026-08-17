const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'user_profiles.json');

// Ensure data directory and file exist
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify({}, null, 2), 'utf8');
}

/**
 * Read all user memories from disk
 * @returns {Record<string, { name: string, facts: string[], updatedAt: string }>}
 */
function loadMemories() {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('[Memory Error]: Failed to read user_profiles.json:', err.message);
    return {};
  }
}

/**
 * Save user memories to disk
 * @param {Record<string, any>} data 
 */
function saveMemories(data) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Memory Error]: Failed to write user_profiles.json:', err.message);
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
 * Add a new fact to a user's long-term memory
 * @param {string} userId 
 * @param {string} fact 
 * @returns {boolean} True if added, false if duplicate
 */
function addFact(userId, fact) {
  const cleanFact = fact.trim();
  if (!cleanFact) return false;

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
  if (isDuplicate) return false;

  userMem.facts.push(cleanFact);
  // Cap at max 20 key facts per user for maximum token efficiency
  if (userMem.facts.length > 20) {
    userMem.facts = userMem.facts.slice(-20);
  }

  userMem.updatedAt = new Date().toISOString();
  saveMemories(memories);
  return true;
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

  // Explicit trigger: "ingat ya...", "catat ya...", "remember...", "ingetin ya..."
  const explicitMatch = lower.match(/(?:ingat|ingetin|catat|remember|simpan)\s*(?:ya|yah|nih)?\s*[:,]?\s*(.+)/i);
  if (explicitMatch && explicitMatch[1]) {
    let fact = explicitMatch[1].trim();
    // Clean up ending punctuation/words
    fact = fact.replace(/(?:ya|yah|dong|pls|please)[!.]*$/i, '').trim();
    if (fact.length >= 3) {
      addFact(userId, fact);
      console.log(`[Memory Auto-Save] Saved fact for ${userId}: "${fact}"`);
      return fact;
    }
  }

  // Personal attributes trigger: "hobi gw...", "panggil gw...", "ultah gw..."
  const attrMatch = lower.match(/(?:hobi|panggil|panggilan|nama panggilan|ultah|ulang tahun|tanggal lahir|makanan favorit|minuman favorit)\s*(?:gw|aku|saya)\s*[:=]?\s*(.+)/i);
  if (attrMatch && attrMatch[1]) {
    let fact = prompt.trim();
    if (fact.length >= 5) {
      addFact(userId, fact);
      console.log(`[Memory Auto-Save] Saved attribute fact for ${userId}: "${fact}"`);
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
