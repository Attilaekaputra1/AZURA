/**
 * AZURA Autonomous Realtime Memory & Cross-User Lore Engine
 * Realtime detection, storage, and cross-user context recall for explicit & implicit facts, relationships, and lore.
 */

const {
  loadMemories,
  loadGuildMemories,
  addFact,
  saveMemories,
  getUserFacts
} = require('./memory');
const { isSacredData } = require('./security');

/**
 * Universal Realtime Fact Extractor (Explicit & Implicit Memory Signals)
 * @param {string} speakerId 
 * @param {string} speakerName 
 * @param {string} prompt 
 * @param {string|null} [guildId=null] 
 * @param {string[]} [mentionedUserIds=[]] 
 * @param {import('discord.js').Guild|null} [guild=null] 
 * @param {string|null} [replyContext=null] 
 * @returns {{ saved: boolean, factsSaved: Array<{ target: string, fact: string, scope: string }> }}
 */
function extractAndPersistRealtimeMemory(speakerId, speakerName, prompt, guildId = null, mentionedUserIds = [], guild = null, replyContext = null) {
  if (!prompt || typeof prompt !== 'string') return { saved: false, factsSaved: [] };

  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // Filter questions, interrogations, or quizzes (e.g., "siapa suaminya X?", "kamu ingat gak?")
  if (clean.includes('?') || /\b(?:siapa|apa|kenapa|gimana|kapan|apakah|tau\s+gak|tahu\s+gak|inget\s+gak|ingat\s+gak|coba\s+tebak)\b/i.test(clean)) {
    return { saved: false, factsSaved: [] };
  }

  const factsSaved = [];

  // Helper to determine target user
  let targetUserId = speakerId;
  let targetDisplayName = speakerName;

  // 1. Check if a user is mentioned directly
  if (mentionedUserIds && mentionedUserIds.length > 0) {
    targetUserId = mentionedUserIds[0];
  } else if (guild && /@?([a-zA-Z0-9_.-]{3,32})/i.test(prompt)) {
    // Try resolving username from guild members
    const nameMatch = prompt.match(/@?([a-zA-Z0-9_.-]{3,32})/);
    if (nameMatch && nameMatch[1]) {
      const matchLower = nameMatch[1].toLowerCase();
      if (!['azura', 'ara', 'zura', 'ajur', 'dia', 'aku', 'kamu', 'fyi', 'fakta'].includes(matchLower)) {
        const found = guild.members.cache.find(m =>
          m.user.username.toLowerCase() === matchLower ||
          (m.nickname && m.nickname.toLowerCase() === matchLower) ||
          m.displayName.toLowerCase() === matchLower
        );
        if (found) {
          targetUserId = found.id;
          targetDisplayName = found.displayName || found.user.username;
        }
      }
    }
  }

  // ── PATTERN A: "tambahkan dia / si X / ke profil: <fakta>" ──
  const addPattern = lower.match(/(?:tambah(?:kan)?|masuk(?:kan)?|catat(?:kan)?|update)\s*(?:ke\s+(?:profil|lore|bio|fakta|data)\s*)?(?:dia|si\s+@?[a-zA-Z0-9_.-]+|profil(?:nya)?|lore)?\s*[:,]?\s*(.+)/i);
  if (addPattern && addPattern[1]) {
    let fact = addPattern[1].trim();
    fact = fact.replace(/^(?:dia|bahwa\s+dia|bahwa|kalo\s+dia|kalau\s+dia)\s+/i, '').trim();
    if (fact.length >= 3 && !isSacredData(fact)) {
      const fullFact = `${targetDisplayName} ${fact}`.trim();
      addFact(targetUserId, fullFact, 'private', guildId);
      if (guildId) addFact(targetUserId, fullFact, 'public', guildId);
      factsSaved.push({ target: targetDisplayName, fact: fullFact, scope: 'both' });
      console.log(`[RealtimeMemory]: 💾 Saved Add Pattern Fact for @${targetDisplayName}: "${fullFact}"`);
    }
  }

  // ── PATTERN B: Relational / Spouse / Lore Assertions ("dia suaminya X", "si Ryhz suaminya Y", "aku suaminya Z") ──
  const relationPattern = clean.match(/(?:si\s+)?(@?[a-zA-Z0-9_.-]+|\bdia\b|\baku\b|\bgw\b)\s+(?:itu|adalah|merupakan)?\s*(?:suami(?:nya)?|istri(?:nya)?|pacar(?:nya)?|tunangan(?:nya)?|sahabat(?:nya)?|teman(?:nya)?|partner(?:nya)?)\s+([^,.\n]+)/i);
  if (relationPattern) {
    const subjectRaw = relationPattern[1].toLowerCase();
    const factText = clean.replace(/^(?:azura|ara|zura|ajur)[,:\s]*/i, '').trim();

    if (factText.length >= 4 && !isSacredData(factText)) {
      let resolvedSubject = targetDisplayName;
      if (['aku', 'gw', 'gua', 'saya'].includes(subjectRaw)) {
        resolvedSubject = speakerName;
        targetUserId = speakerId;
      }
      const structuredFact = `${resolvedSubject} ${relationPattern[0].replace(relationPattern[1], '').trim()}`.trim();
      addFact(targetUserId, structuredFact, 'private', guildId);
      if (guildId) addFact(targetUserId, structuredFact, 'public', guildId);
      factsSaved.push({ target: resolvedSubject, fact: structuredFact, scope: 'both' });
      console.log(`[RealtimeMemory]: 💍 Saved Relational Fact for @${resolvedSubject}: "${structuredFact}"`);
    }
  }

  // ── PATTERN C: Explicit Memory Directives ("ingat ya...", "catat ya...", "fyi...", "simpan ini...") ──
  const explicitMatch = lower.match(/(?:ingat|ingetin|catat|remember|simpan|fyi|jangan\s+lupa)\s*(?:ya|yah|nih|bro|azura|ara)?\s*[:,]?\s*(.+)/i);
  if (explicitMatch && explicitMatch[1]) {
    let fact = explicitMatch[1].trim();
    fact = fact.replace(/(?:ya|yah|dong|pls|please|kan)[!.]*$/i, '').trim();
    if (fact.length >= 3 && fact.length <= 200 && !isSacredData(fact)) {
      addFact(targetUserId, fact, 'private', guildId);
      if (guildId) addFact(targetUserId, fact, 'public', guildId);
      factsSaved.push({ target: targetDisplayName, fact, scope: 'both' });
      console.log(`[RealtimeMemory]: 🧠 Saved Explicit Directive Fact for @${targetDisplayName}: "${fact}"`);
    }
  }

  // ── PATTERN D: Personal Attributes ("nama asliku X", "hobiku Y", "makanan favoritku Z") ──
  const attrMatch = lower.match(/(?:nama\s+asli|nama\s+panggilan|nama|panggil\s+aja|panggilan|hobi|ultah|ulang\s+tahun|tanggal\s+lahir|makanan\s+favorit|minuman\s+favorit|game\s+favorit|anime\s+favorit|pekerjaan(?:ku)?|kantor(?:ku)?|rumah(?:ku)?)\s*(?:gw|gue|gua|aku|saya|ane|ku)?\s*[:=]?\s*(.+)/i);
  if (attrMatch && attrMatch[1]) {
    let fact = clean.replace(/^(?:azura|ara|zura|ajur)[,:\s]*/i, '').trim();
    if (fact.length >= 5 && fact.length <= 200 && !isSacredData(fact)) {
      addFact(speakerId, fact, 'private', guildId);
      factsSaved.push({ target: speakerName, fact, scope: 'private' });
      console.log(`[RealtimeMemory]: 👤 Saved Personal Attribute for @${speakerName}: "${fact}"`);
    }
  }

  if (factsSaved.length > 0) {
    saveMemories(true); // Immediate flush to encrypted disk
    return { saved: true, factsSaved };
  }

  return { saved: false, factsSaved: [] };
}

/**
 * Deep Search across all User Facts, Guild Lore, Behaviors, and Permanent Summaries
 * @param {string} query 
 * @param {string|null} [guildId=null] 
 * @param {string[]} [mentionedUserIds=[]] 
 * @returns {string} Formatted relevant memory context
 */
function searchAllMemories(query, guildId = null, mentionedUserIds = []) {
  if (!query || typeof query !== 'string') return '';

  const cleanQuery = query.toLowerCase().trim();
  const searchTerms = cleanQuery
    .replace(/[?,!.:;'"()[\]]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !['siapa', 'apa', 'kenapa', 'gimana', 'kapan', 'ara', 'azura', 'zura', 'ajur', 'dan', 'yang', 'ini', 'itu', 'adalah', 'di', 'ke', 'dari', 'ya', 'kan', 'dong'].includes(w));

  if (searchTerms.length === 0) return '';

  const matchedFacts = new Set();
  const userMems = loadMemories();
  const guildMems = loadGuildMemories();

  // 1. Search in user private facts
  for (const [uid, userRecord] of Object.entries(userMems)) {
    if (userRecord && userRecord.facts && Array.isArray(userRecord.facts)) {
      for (const fact of userRecord.facts) {
        const factLower = fact.toLowerCase();
        if (searchTerms.some(term => factLower.includes(term))) {
          matchedFacts.add(fact);
        }
      }
    }
  }

  // 2. Search in guild public facts
  if (guildId && guildMems[guildId] && guildMems[guildId].facts) {
    for (const fact of guildMems[guildId].facts) {
      const factLower = fact.toLowerCase();
      if (searchTerms.some(term => factLower.includes(term))) {
        matchedFacts.add(fact);
      }
    }
  }

  // 3. Search in User Behaviors
  try {
    const { getUserBehavior } = require('./behavior');
    for (const uid of mentionedUserIds) {
      const beh = getUserBehavior(uid);
      if (beh) {
        if (beh.summary) matchedFacts.add(`Profil @${beh.displayName || uid}: ${beh.summary}`);
        if (beh.positiveTraits && beh.positiveTraits.length > 0) {
          matchedFacts.add(`Karakter @${beh.displayName || uid}: ${beh.positiveTraits.join(', ')}`);
        }
      }
    }
  } catch (_) {}

  if (matchedFacts.size === 0) return '';

  const factList = Array.from(matchedFacts).slice(0, 8);
  return `\n\n[HASIL PENCARIAN MEMORI & LORE REALTIME (TERVERIFIKASI DI DATABASE)]:\n` +
    factList.map((f, i) => `• ${f}`).join('\n') + `\n\n` +
    `PEDOMAN MEMORI:\n` +
    `Gunakan fakta terverifikasi dari database di atas sebagai KEBENARAN MUTLAK saat menjawab pertanyaan lawan bicara!`;
}

module.exports = {
  extractAndPersistRealtimeMemory,
  searchAllMemories
};
