const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { readSecureJson, writeSecureJson, isSacredData } = require('./security');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'user_profiles.enc');
const GUILD_MEMORY_FILE = path.join(__dirname, '..', 'data', 'guild_profiles.enc');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let memoriesCache = null;
let guildMemoriesCache = null;

/**
 * Read user memories from encrypted disk
 */
function loadMemories() {
  if (memoriesCache) return memoriesCache;
  try {
    memoriesCache = readSecureJson(MEMORY_FILE, {});
    return memoriesCache;
  } catch (err) {
    console.error('[Memory Error]: Failed to read secure user_profiles.enc:', err.message);
    memoriesCache = {};
    return memoriesCache;
  }
}

/**
 * Read guild/server public memories from encrypted disk
 */
function loadGuildMemories() {
  if (guildMemoriesCache) return guildMemoriesCache;
  try {
    guildMemoriesCache = readSecureJson(GUILD_MEMORY_FILE, {});
    return guildMemoriesCache;
  } catch (err) {
    guildMemoriesCache = {};
    return guildMemoriesCache;
  }
}

let userMemFlushTimer = null;
let isUserMemDirty = false;

function flushMemoriesSync() {
  if (userMemFlushTimer) {
    clearTimeout(userMemFlushTimer);
    userMemFlushTimer = null;
  }
  try {
    if (memoriesCache) writeSecureJson(MEMORY_FILE, memoriesCache);
    if (guildMemoriesCache) writeSecureJson(GUILD_MEMORY_FILE, guildMemoriesCache);
    isUserMemDirty = false;
  } catch (err) {
    console.error('[Memory Save Error]:', err.message);
  }
}

function saveMemories(immediate = false) {
  isUserMemDirty = true;
  if (immediate) {
    flushMemoriesSync();
    return;
  }
  if (!userMemFlushTimer) {
    userMemFlushTimer = setTimeout(() => {
      userMemFlushTimer = null;
      if (isUserMemDirty) flushMemoriesSync();
    }, 1500);
  }
}

process.on('SIGTERM', () => { if (isUserMemDirty) flushMemoriesSync(); });
process.on('SIGINT', () => { if (isUserMemDirty) flushMemoriesSync(); });
process.on('beforeExit', () => { if (isUserMemDirty) flushMemoriesSync(); });

/**
 * Get facts list for a user (and optionally merge with guild public facts)
 * @param {string} userId 
 * @param {'all'|'private'|'public'} [scope='all']
 * @param {string|null} [guildId=null]
 * @returns {string[]}
 */
function getUserFacts(userId, scope = 'all', guildId = null) {
  const userMems = loadMemories();
  const guildMems = loadGuildMemories();

  const privateFacts = (userMems[userId]?.facts || []);
  const publicFacts = guildId ? (guildMems[guildId]?.facts || []) : [];

  if (scope === 'private') return privateFacts;
  if (scope === 'public') return publicFacts;
  return [...privateFacts, ...publicFacts];
}

/**
 * Add a new fact (Private to user or Public to guild)
 * @param {string} userId 
 * @param {string} fact 
 * @param {'private'|'public'} [scope='private'] 
 * @param {string|null} [guildId=null] 
 */
function addFact(userId, fact, scope = 'private', guildId = null) {
  const cleanFact = fact.trim();
  if (!cleanFact) return { success: false };

  // 🛡️ Filter questions, interrogation & interrogative sentences
  if (cleanFact.includes('?') || /^(?:kamu\s+)?(?:inget|ingat|tau|tahu|siapa|apa|kenapa|gimana|apakah|boleh|bisa)\b/i.test(cleanFact)) {
    return { success: false, invalid: true };
  }

  // 🛡️ SECURITY GUARD: Block passwords, PINs, credentials, KTP/NIK
  if (isSacredData(cleanFact)) {
    console.warn(`[Memory Security Guard]: ⚠️ Blocked attempt to save sacred/confidential data.`);
    return { success: false, blocked: true };
  }

  if (scope === 'public' && guildId) {
    const guildMems = loadGuildMemories();
    if (!guildMems[guildId]) {
      guildMems[guildId] = { facts: [], updatedAt: new Date().toISOString() };
    }
    const isDup = guildMems[guildId].facts.some(f => f.toLowerCase() === cleanFact.toLowerCase());
    if (isDup) return { success: false, duplicate: true };

    guildMems[guildId].facts.push(cleanFact);
    if (guildMems[guildId].facts.length > 20) {
      guildMems[guildId].facts = guildMems[guildId].facts.slice(-20);
    }
    guildMems[guildId].updatedAt = new Date().toISOString();
    saveMemories();
    return { success: true, scope: 'public' };
  }

  // Default: Private user fact
  const userMems = loadMemories();
  if (!userMems[userId]) {
    userMems[userId] = { name: '', facts: [], updatedAt: new Date().toISOString() };
  }

  const isDuplicate = userMems[userId].facts.some(f => f.toLowerCase() === cleanFact.toLowerCase());
  if (isDuplicate) return { success: false, duplicate: true };

  userMems[userId].facts.push(cleanFact);
  if (userMems[userId].facts.length > 20) {
    userMems[userId].facts = userMems[userId].facts.slice(-20);
  }
  userMems[userId].updatedAt = new Date().toISOString();
  saveMemories();
  return { success: true, scope: 'private' };
}

/**
 * Remove a fact by index
 */
function removeFact(userId, index, scope = 'private', guildId = null) {
  if (scope === 'public' && guildId) {
    const guildMems = loadGuildMemories();
    if (!guildMems[guildId] || !guildMems[guildId].facts[index]) return false;
    guildMems[guildId].facts.splice(index, 1);
    guildMems[guildId].updatedAt = new Date().toISOString();
    saveMemories();
    return true;
  }

  const userMems = loadMemories();
  if (!userMems[userId] || !userMems[userId].facts[index]) return false;
  userMems[userId].facts.splice(index, 1);
  userMems[userId].updatedAt = new Date().toISOString();
  saveMemories();
  return true;
}

/**
 * Clear all long-term memory
 */
function clearUserMemory(userId, scope = 'all', guildId = null) {
  const userMems = loadMemories();
  if (scope === 'private' || scope === 'all') {
    if (userMems[userId]) {
      delete userMems[userId];
    }
  }
  if ((scope === 'public' || scope === 'all') && guildId) {
    const guildMems = loadGuildMemories();
    if (guildMems[guildId]) {
      delete guildMems[guildId];
    }
  }
  saveMemories(true);
}

/**
 * Build interactive memory embed + dropdown StringSelectMenu
 * @param {string} userId 
 * @param {string|null} guildId 
 * @param {string} channelId 
 * @param {'private'|'public'|'priority'|'audit'} [selectedScope='private'] 
 */
function buildMemoryEmbedAndDropdown(userId, guildId, channelId, selectedScope = 'private') {
  const { getPermanentSummaries, MAX_SUMMARIES_PER_CONTEXT } = require('./permanentMemory');

  const privateKey = `user_${userId}`;
  const publicKey = guildId ? `channel_${channelId}_user_${userId}` : `user_${userId}`;

  const privateFacts = getUserFacts(userId, 'private');
  const publicFacts = guildId ? getUserFacts(userId, 'public', guildId) : [];

  const privateSummaries = getPermanentSummaries(privateKey);
  const publicSummaries = guildId ? getPermanentSummaries(publicKey) : [];

  const safetyBanner =
    `🔒 **PERLINDUNGAN PRIVASI & DATA SENSITIF:**\n` +
    `*Semua memori dienkripsi dengan standar AES-256-GCM. Dilarang keras mencantumkan password, PIN, atau data rahasia.*`;

  let embedColor = 0x00FFB2;
  let title = '🧠 Sistem Memori & Arsip Terenkripsi AZURA';
  let desc = `${safetyBanner}\n\n`;
  let fields = [];

  if (selectedScope === 'private') {
    embedColor = 0x3498DB;
    title = '🔒 [Memori Privat / Personal] (DM & Preferensi Pribadi)';
    desc += `Memori ini bersifat rahasia dan hanya digunakan dalam obrolan personal antara kamu dan Azura:`;
    
    const pFactsList = privateFacts.length > 0
      ? privateFacts.map((f, i) => `• **${i + 1}.** ${f}`).join('\n')
      : '*(Belum ada fakta personal yang tersimpan)*';

    const pSummList = privateSummaries.length > 0
      ? privateSummaries.slice(0, 5).map((s, i) => `**${i + 1}. ${s.title}** (\`${s.id}\` - ${s.dateFormatted})\n📝 *${s.summary}*`).join('\n\n')
      : '*(Belum ada ringkasan sesi DM yang dipermanenkan)*';

    fields.push(
      { name: `📌 Fakta & Preferensi Personal (${privateFacts.length}/20)`, value: pFactsList, inline: false },
      { name: `💾 Arsip Ringkasan DM Pribadi (${privateSummaries.length}/${MAX_SUMMARIES_PER_CONTEXT})`, value: pSummList, inline: false }
    );

  } else if (selectedScope === 'public') {
    embedColor = 0xE67E22;
    title = '🌐 [Memori Publik Server] (Konteks Bersama Komunitas)';
    desc += `Memori dan ringkasan percakapan yang terekam di server ini (${guildId ? 'Server Aktif' : 'Global'}):`;

    const gFactsList = publicFacts.length > 0
      ? publicFacts.map((f, i) => `• **${i + 1}.** ${f}`).join('\n')
      : '*(Belum ada fakta publik server yang tersimpan)*';

    const gSummList = publicSummaries.length > 0
      ? publicSummaries.slice(0, 5).map((s, i) => `**${i + 1}. ${s.title}** (\`${s.id}\` - ${s.dateFormatted})\n📝 *${s.summary}*`).join('\n\n')
      : '*(Belum ada ringkasan sesi server yang dipermanenkan)*';

    fields.push(
      { name: `📌 Fakta Bersama Server (${publicFacts.length}/20)`, value: gFactsList, inline: false },
      { name: `💾 Arsip Ringkasan Obrolan Server (${publicSummaries.length}/${MAX_SUMMARIES_PER_CONTEXT})`, value: gSummList, inline: false }
    );

  } else if (selectedScope === 'priority') {
    embedColor = 0xF1C40F;
    title = '⭐ [Memori Prioritas & Fakta Kunci Utama]';
    desc += `Daftar ringkasan memori yang telah di-pin/diprioritaskan secara permanen:`;

    const allSumms = [...privateSummaries, ...publicSummaries];
    const priorityList = allSumms.filter(s => s.isPriority);

    const pListStr = priorityList.length > 0
      ? priorityList.slice(0, 7).map((s, i) => `⭐ **${i + 1}. ${s.title}** (\`${s.id}\` - ${s.dateFormatted})\n📝 *${s.summary}*`).join('\n\n')
      : '*(Belum ada ringkasan yang ditandai sebagai Prioritas Utama)*';

    fields.push({ name: `⭐ Ringkasan Prioritas (${priorityList.length})`, value: pListStr, inline: false });
  }

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(title)
    .setDescription(desc)
    .addFields(fields)
    .setFooter({ text: 'Gunakan Dropdown di bawah untuk beralih antara Memori Privat & Publik' })
    .setTimestamp();

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`mem_scope_select:${userId}:${guildId || 'dm'}:${channelId}`)
    .setPlaceholder('📂 Pilih Lingkup / Kategori Memori...')
    .addOptions([
      {
        label: '🔒 Memori Privat / Personal',
        description: 'Fakta pribadi & arsip ringkasan DM khusus kamu',
        value: 'private',
        default: selectedScope === 'private',
        emoji: '🔒'
      },
      {
        label: '🌐 Memori Publik Server',
        description: 'Fakta bersama & ringkasan obrolan di server ini',
        value: 'public',
        default: selectedScope === 'public',
        emoji: '🌐'
      },
      {
        label: '⭐ Memori Prioritas Utama',
        description: 'Ringkasan sesi yang dipin/diprioritaskan permanen',
        value: 'priority',
        default: selectedScope === 'priority',
        emoji: '⭐'
      }
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  return { embed, row };
}

/**
 * Auto-detect if user is explicitly telling AZURA a fact to remember
 */
function autoExtractFact(userId, prompt, guildId = null) {
  if (!prompt || typeof prompt !== 'string') return null;

  // Ignore questions, quizzes, or interrogations
  if (prompt.includes('?') || /\b(?:siapa|apa|kenapa|gimana|kapan|apakah|tau\s+gak|tahu\s+gak|inget\s+gak|ingat\s+gak|coba\s+tebak)\b/i.test(prompt)) {
    return null;
  }

  const lower = prompt.toLowerCase().trim();

  // Explicit trigger: "ingat ya...", "catat ya...", "remember...", "ingetin ya...", "fyi..."
  const explicitMatch = lower.match(/(?:ingat|ingetin|catat|remember|simpan|fyi)\s*(?:ya|yah|nih|bro|azura|ara)?\s*[:,]?\s*(.+)/i);
  if (explicitMatch && explicitMatch[1]) {
    let fact = explicitMatch[1].trim();
    fact = fact.replace(/(?:ya|yah|dong|pls|please)[!.]*$/i, '').trim();
    if (fact.length >= 3 && fact.length <= 150) {
      addFact(userId, fact, 'private', guildId);
      console.log(`[Memory Auto-Save] Saved explicit fact for ${userId}: "${fact}"`);
      return fact;
    }
  }

  // Personal attributes & profile trigger
  const attrMatch = lower.match(/(?:nama\s+asli|nama\s+panggilan|nama|panggil\s+aja|panggilan|hobi|ultah|ulang tahun|tanggal lahir|makanan favorit|minuman favorit|game favorit|anime favorit)\s*(?:gw|gue|gua|aku|saya|ane|ku)?\s*[:=]?\s*(.+)/i);
  if (attrMatch && attrMatch[1]) {
    let fact = prompt.trim();
    if (fact.length >= 5 && fact.length <= 150) {
      addFact(userId, fact, 'private', guildId);
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
  loadMemories,
  loadGuildMemories,
  saveMemories,
  flushMemoriesSync,
  buildMemoryEmbedAndDropdown
};
