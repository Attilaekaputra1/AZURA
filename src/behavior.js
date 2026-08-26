const fs = require('fs');
const path = require('path');
const config = require('./config');

const BEHAVIOR_FILE = path.join(__dirname, '../data/user_behaviors.json');
const MAX_BEHAVIOR_USERS = 20;
const CAPACITY_ALERT_THRESHOLD = 15;

let behaviorCache = {};
let lastAlertTimestamp = 0;

/**
 * Load behavior profiles from disk
 */
function loadBehaviors() {
  try {
    const dir = path.dirname(BEHAVIOR_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(BEHAVIOR_FILE)) {
      const raw = fs.readFileSync(BEHAVIOR_FILE, 'utf8');
      behaviorCache = JSON.parse(raw || '{}');
    } else {
      behaviorCache = {};
    }
  } catch (err) {
    console.error('[Behavior Error]: Failed to load user_behaviors.json:', err.message);
    behaviorCache = {};
  }
}

/**
 * Save behavior profiles to disk
 */
function saveBehaviors() {
  try {
    const dir = path.dirname(BEHAVIOR_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${BEHAVIOR_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(behaviorCache, null, 2), 'utf8');
    fs.renameSync(tmp, BEHAVIOR_FILE);
  } catch (err) {
    console.error('[Behavior Error]: Failed to save user_behaviors.json:', err.message);
  }
}

// Initial load
loadBehaviors();

// Negative / Toxic filter (Messages containing toxic/angry patterns are completely ignored for behavior profiling)
const TOXIC_PATTERNS = [
  /\b(?:anjing|babi|bangsat|kontol|memek|jembut|asu|bajingan|tolol|goblok|idiot|bodoh|ngentot|pantek|pepek|kampret|brengsek)\b/i,
  /\b(?:mati\s+lu|benci|rusak|toxic|jelek\s+banget|bacot|sampah)\b/i
];

function isNegativeOrToxic(text) {
  if (!text) return true;
  return TOXIC_PATTERNS.some(rgx => rgx.test(text));
}

/**
 * Check if behavior cache reached threshold (>= 15 users) and alert Attila
 * @param {import('discord.js').Client} [client] 
 */
async function checkBehaviorCapacityAlert(client) {
  const count = Object.keys(behaviorCache).length;
  const now = Date.now();
  // Alert once every 6 hours max
  if (count >= CAPACITY_ALERT_THRESHOLD && (now - lastAlertTimestamp > 6 * 3600 * 1000)) {
    lastAlertTimestamp = now;
    console.log(`[Behavior Alert]: ⚠️ Behavior capacity at ${count}/${MAX_BEHAVIOR_USERS} users! Alerting Owner...`);
    if (client && config.OWNER_DISCORD_ID) {
      try {
        const owner = await client.users.fetch(config.OWNER_DISCORD_ID).catch(() => null);
        if (owner) {
          await owner.send(
            `⚠️ **[PERINGATAN KAPASITAS DATABASE BEHAVIOR AZURA]**\n\n` +
            `Slot rekaman karakter & behavior AZURA sudah terisi **${count} dari ${MAX_BEHAVIOR_USERS} pengguna** (${((count / MAX_BEHAVIOR_USERS) * 100).toFixed(0)}%).\n` +
            `• Kamu bisa membersihkan profil yang kurang aktif via perintah \`/behavior aksi:list\` atau \`/behavior aksi:hapus target:<user>\`.\n` +
            `• Atau kamu bisa meminta penambahan kuota slot kapan saja! 📊✨`
          );
        }
      } catch (err) {
        console.error('[Behavior Alert Error]:', err.message);
      }
    }
  }
}

/**
 * Auto-detect and record positive personality traits from user interaction (Good Vibes Only, Max 20 Users)
 * @param {string} userId 
 * @param {string} username 
 * @param {string} displayName 
 * @param {string} textContent 
 * @param {boolean} isDM 
 * @param {import('discord.js').Client} [client] 
 */
function recordPositiveBehavior(userId, username, displayName, textContent, isDM = false, client = null) {
  if (!userId || !textContent || textContent.length < 5) return;
  if (isNegativeOrToxic(textContent)) {
    // Ignore negative response completely
    return;
  }

  loadBehaviors();

  // If user not in cache and limit reached, check if we should replace the oldest inactive user
  const userKeys = Object.keys(behaviorCache);
  if (!behaviorCache[userId] && userKeys.length >= MAX_BEHAVIOR_USERS) {
    // Sort by lastObserved and drop the oldest
    let oldestKey = userKeys[0];
    let oldestTime = new Date(behaviorCache[oldestKey]?.lastObserved || 0).getTime();
    for (const k of userKeys) {
      const t = new Date(behaviorCache[k]?.lastObserved || 0).getTime();
      if (t < oldestTime) {
        oldestTime = t;
        oldestKey = k;
      }
    }
    delete behaviorCache[oldestKey];
  }

  const { getUserRecord } = require('./vault');
  const vaultRec = getUserRecord(userId);
  const nickname = vaultRec?.knownRealName || displayName;

  if (!behaviorCache[userId]) {
    behaviorCache[userId] = {
      userId,
      username,
      displayName,
      nickname,
      positiveTraits: [],
      personalitySummary: 'Member yang ramah dan aktif berinteraksi.',
      favoriteTopics: [],
      interactionCount: 0,
      firstObserved: new Date().toISOString(),
      lastObserved: new Date().toISOString()
    };
  }

  const profile = behaviorCache[userId];
  profile.interactionCount += 1;
  profile.lastObserved = new Date().toISOString();
  profile.displayName = displayName;
  profile.nickname = nickname;

  const lower = textContent.toLowerCase();

  // Pattern detection for positive traits & public interests
  const TRAIT_MAP = [
    { trait: 'Humoris & Suka Bercanda', regex: /\b(?:wkwk|haha|hehe|ngakak|lawak|lucu|canda|jokes|awokwok)\b/i },
    { trait: 'Sopan & Menghargai', regex: /\b(?:makasih|terima kasih|thanks|thank you|mohon|tolong|permisi|maaf ya|appreciate)\b/i },
    { trait: 'Tech & Coding Enthusiast', regex: /\b(?:coding|code|javascript|python|bot|api|database|framework|deploy|server|vps|bug|fix|git)\b/i },
    { trait: 'Gaming & Santai', regex: /\b(?:game|mabar|voice|vc|genshin|valorant|steam|discord|roblox|mlbb|chill|santai)\b/i },
    { trait: 'Suportif & Hangat', regex: /\b(?:semangat|mantap|keren|good job|gokil|salut|hebat|bisa yuk|sukses)\b/i },
    { trait: 'Kreatif & Berwawasan', regex: /\b(?:ide|desain|design|konsep|project|proyek|kreatif|inovasi|strategi|arsitektur)\b/i },
    { trait: 'Pemerhati Musik & Media', regex: /\b(?:lagu|musik|anime|film|nonton|youtube|spotify|playlist)\b/i }
  ];

  for (const item of TRAIT_MAP) {
    if (item.regex.test(lower)) {
      if (!profile.positiveTraits.includes(item.trait)) {
        profile.positiveTraits.push(item.trait);
        if (profile.positiveTraits.length > 5) {
          profile.positiveTraits = profile.positiveTraits.slice(-5);
        }
      }
    }
  }

  // Update dynamic personality summary
  if (profile.positiveTraits.length > 0) {
    profile.personalitySummary = `Orangnya ${profile.positiveTraits.join(', ').toLowerCase()}, asyik diajak berinteraksi.`;
  }

  saveBehaviors();

  // Check quota threshold
  if (client) {
    checkBehaviorCapacityAlert(client).catch(() => {});
  }
}

/**
 * Delete a user's behavior profile completely (User self-service or Owner)
 * @param {string} userId 
 * @returns {boolean} true if deleted
 */
function deleteUserBehavior(userId) {
  loadBehaviors();
  if (behaviorCache[userId]) {
    delete behaviorCache[userId];
    saveBehaviors();
    console.log(`[Behavior Engine]: 🗑️ Deleted behavior profile for userId: ${userId}`);
    return true;
  }
  return false;
}

/**
 * Get behavior profile of a specific user
 * @param {string} userId 
 * @returns {object|null}
 */
function getUserBehavior(userId) {
  loadBehaviors();
  return behaviorCache[userId] || null;
}

/**
 * Get all active behavior profiles (up to 20 users)
 * @returns {Array<object>}
 */
function getAllBehaviors() {
  loadBehaviors();
  return Object.values(behaviorCache);
}

/**
 * Build Contextual Behavior & Public Social Intelligence Prompt for AZURA (Chat)
 * @param {string} currentUserId 
 * @param {Array<string>} mentionedUserIds 
 * @returns {string}
 */
function getBehaviorContextForPrompt(currentUserId, mentionedUserIds = []) {
  loadBehaviors();

  const relevantIds = Array.from(new Set([currentUserId, ...mentionedUserIds])).filter(Boolean);
  const profiles = relevantIds.map(id => behaviorCache[id]).filter(Boolean);

  if (profiles.length === 0) return '';

  const formatted = profiles.map(p => {
    const traits = p.positiveTraits.length > 0 ? p.positiveTraits.join(', ') : 'Ramah & Santai';
    return `- **${p.nickname}** (@${p.username}):\n  • Vibe & Karakter Positif: ${traits}\n  • Kesan AZURA: "${p.personalitySummary}"`;
  }).join('\n');

  return `\n\n[DATABASE BEHAVIOR & SIFAT POSITIF PENGGUNA (Social Intelligence - Maks 20 User)]:\n` +
    `Berikut adalah rekaman karakter, kebiasaan positif, dan vibe pengguna yang sedang mengobrol / disebut:\n` +
    `${formatted}\n\n` +
    `PANDUAN INTERAKSI SOSIAL & CROSS-MEMORY AZURA (SANGAT PENTING):\n` +
    `1. PRIVASI MEMORI (MUTLAK): Memori privat di DM TIDAK BOLEH dibocorkan ke server publik. Hanya gunakan sifat/kebiasaan umum di atas.\n` +
    `2. CROSS-MEMORY HANYA BILA RELEVAN: Hubungkan atau singgung karakter/kebiasaan positif teman server HANYA JIKA ada konteks yang nyambung (misal: "Iya, si Koin Merah juga suka jokes receh kayak gini!").\n` +
    `3. JANGAN SOK TAHU: Jika suatu fakta tidak tercatat atau kamu tidak tahu, katakan terus terang dengan santai, jangan mengarang fakta palsu.\n` +
    `4. RAHASIAKAN USER ID: JANGAN PERNAH menyebutkan angka ID Discord (\`75905...\`) kepada publik di chat. Cukup panggil nama panggilan resminya saja!`;
}

/**
 * Build Voice Channel Social Intelligence & Unique Name Humor Context
 * @param {Array<string>} [activeMemberIds] 
 * @returns {string}
 */
function getBehaviorContextForVoice(activeMemberIds = []) {
  loadBehaviors();

  const allProfiles = Object.values(behaviorCache);
  if (allProfiles.length === 0) return '';

  const formatted = allProfiles.map(p => {
    const traits = p.positiveTraits.length > 0 ? p.positiveTraits.join(', ') : 'Ramah & Santai';
    return `• ${p.nickname} (@${p.username}): ${traits} - "${p.personalitySummary}"`;
  }).join('\n');

  return `
[DATABASE SOSIAL & BEHAVIOR ANGGOTA KOMUNITAS DI VOICE CHANNEL (MAKS 20 USER)]:
Berikut adalah database karakter, nama panggilan, dan kebiasaan positif member yang tercatat:
${formatted}

PANDUAN KHUSUS VOICE CHANNEL (HUMOR NAMA UNIK & FILOSOFI):
1. CROSS-MEMORY & BANTER SERU DI VC: Kamu boleh menyinggung atau menceritakan kebiasaan teman tongkrongan secara ceplas-ceplos, seru, dan mengalir natural jika topiknya nyambung!
2. JOKES NAMA & USERNAME UNIK ALA GEN Z (BUKAN JOKES BAPAK-BAPAK/GARING):
   - Jika ada member dengan nama panggilan atau username yang nyeleneh, absurd, atau edgy (seperti "Raja Iblis", "Koin Merah", dsb), ledek secara kocak ala anak muda tongkrongan Discord!
   - Contoh gaya roasting Gen Z yang asyik:
     • Untuk Raja Iblis: "Buset Raja Iblis, lu mau nguasai dimensi kegelapan apa cuma mau push rank doang ampe subuh dah? [laughs] Namanya edgy parah tapi kelakuannya lawak wkwk!"
     • Untuk Koin Merah: "Koin Merah tuh konsepnya gimana dah, koin seratusan nyangkut di celengan ayam karatan apa gimana coba? [giggles] Tapi asyik sih anaknya diajak mabar."
3. RESPEK & FILOSOFI NAMA: Jika member tersebut menjelaskan bahwa nama panggilannya memiliki makna atau filosofi mendalam, pahami dengan tulus, hargai artinya, dan minta maaf dengan manis/playful karena tadi sempat kamu ledek! (contoh: "Eh tapi keren juga filosofinya... maaf ya tadi sempat aku cengin, respect deh maknanya dalem banget! [softly]").
4. RAHASIAKAN NOMOR USER ID: DILARANG menyebutkan angka ID Discord saat berbicara suara. Cukup panggil nama panggilannya!`;
}

module.exports = {
  recordPositiveBehavior,
  deleteUserBehavior,
  getUserBehavior,
  getAllBehaviors,
  getBehaviorContextForPrompt,
  getBehaviorContextForVoice,
  checkBehaviorCapacityAlert,
  MAX_BEHAVIOR_USERS,
  CAPACITY_ALERT_THRESHOLD
};
