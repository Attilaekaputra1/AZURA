/**
 * AZURA Morning Greeting & Motivation Automation Engine
 * 
 * Schedules a daily morning greeting & motivation at 09:00 WIB (UTC+7) in #general.
 * 
 * Rules & Features:
 * 1. Tone: Azura's Original Soul (warm, sweet, expressive Gen Z, motivating).
 * 2. Length: Under 200 characters (max 200 chars).
 * 3. Daily Randomized / AI-synthesized freshness.
 * 4. Automatic New Guild Discovery:
 *    - Joined before 09:00 WIB -> Sent on the same day at 09:00 WIB.
 *    - Joined after 09:00 WIB -> Sent next morning at 09:00 WIB.
 * 5. Persistent State tracking per date & guild.
 */

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const config = require('./config');
const { findGeneralChannelForGuild } = require('./autonomous');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'morning_greeting_state.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * @typedef {Object} MorningGreetingState
 * @property {Record<string, string[]>} sentHistory // dateKey (YYYY-MM-DD) -> array of guildIds
 * @property {Record<string, { name: string, joinedAt: string }>} knownGuilds
 */

const defaultState = {
  sentHistory: {},
  knownGuilds: {}
};

/**
 * Load persistent state
 * @returns {MorningGreetingState}
 */
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { ...defaultState };
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch (err) {
    console.error('[Morning Greeting Error]: Failed to read state file:', err.message);
    return { ...defaultState };
  }
}

/**
 * Save persistent state
 * @param {MorningGreetingState} state 
 */
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[Morning Greeting Error]: Failed to save state:', err.message);
  }
}

let currentState = loadState();
let discordClient = null;
let checkerInterval = null;

/**
 * Get current Date and Time in WIB (UTC+7)
 * @returns {{ dateKey: string, hour: number, minute: number, rawDate: Date }}
 */
function getWIBTime() {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wibDate = new Date(utcMs + (7 * 3600000));

  const year = wibDate.getFullYear();
  const month = String(wibDate.getMonth() + 1).padStart(2, '0');
  const day = String(wibDate.getDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  return {
    dateKey,
    hour: wibDate.getHours(),
    minute: wibDate.getMinutes(),
    rawDate: wibDate
  };
}

const CURATED_FALLBACK_GREETINGS = [
  'Pagi semuanya! ☀️ Semangat buat aktivitas hari ini yaa, langkah kecil yang konsisten bakal bawa hasil besar kok. You got this! ✨',
  'Selamat pagi gais! 🌸 Awali hari dengan senyum dan pikiran positif yaa. Jangan lupa sarapan dan minum air putih! 💙',
  'Pagi! ☀️ Hari baru, kesempatan baru buat bersinar. Lakuin yang terbaik dan jangan lupa bahagia hari ini yaa! ✨',
  'Good morning semuanya! 🌿 Apapun tantangan hari ini, hadapi dengan tenang dan percaya diri yaa. Semangat gais! 🔥',
  'Pagi teman-teman! 🌸 Luangkan waktu buat nikmatin proses hari ini, jangan lupa bangga sama usaha kalian yaa! ✨',
  'Semangat pagi! ☀️ Setiap usaha hari ini pasti punya arti. Yuk lakuin yang terbaik bareng-bareng! 🚀'
];

/**
 * Generate fresh morning motivation message using OpenAI (< 200 chars)
 * @param {string} guildName 
 * @returns {Promise<string>}
 */
async function generateMorningMotivation(guildName) {
  if (!config.OPENAI_API_KEY) {
    return CURATED_FALLBACK_GREETINGS[Math.floor(Math.random() * CURATED_FALLBACK_GREETINGS.length)];
  }

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const systemPrompt = `Kamu adalah AZURA, asisten AI cewek Gen Z (22 tahun) dengan jiwa orisinal (original soul): hangat, manis, ceria, tulus, dan penuh energi positif.
TUGAS:
Buat 1 pesan singkat ucapan selamat pagi & kata-kata motivasi harian jam 9 pagi untuk teman-teman Discord di server "${guildName || 'server'}".

ATURAN SANGAT KETAT:
1. Panjang MAKSIMAL 180 karakter (WAJIB di bawah 200 karakter).
2. Gaya bahasa kasual anak muda / teman tongkrongan yang tulus menyemangati (Gen Z natural).
3. Jangan pakai pembuka bot robotik kaku seperti "Halo anggota server" atau "Perhatian".
4. Beri 1-2 emoji manis yang pas (misal ☀️, 🌸, ✨, 💙).
5. Output HANYA teks sapaannya saja tanpa tanda kutip.`;

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Kirim motivasi pagi jam 9.' }
      ],
      max_completion_tokens: 80
    });

    let text = res.choices[0]?.message?.content?.trim();
    if (text) {
      // Clean leading/trailing quotes
      text = text.replace(/^["']|["']$/g, '').trim();
      if (text.length <= 200) {
        return text;
      } else {
        return text.substring(0, 195).trim() + '... ✨';
      }
    }
  } catch (err) {
    console.warn('[Morning Greeting API Warning]:', err.message);
  }

  return CURATED_FALLBACK_GREETINGS[Math.floor(Math.random() * CURATED_FALLBACK_GREETINGS.length)];
}

/**
 * Register a guild in knownGuilds registry
 * @param {import('discord.js').Guild} guild 
 */
function registerGuild(guild) {
  if (!guild || !guild.id) return;
  if (!currentState.knownGuilds[guild.id]) {
    currentState.knownGuilds[guild.id] = {
      name: guild.name,
      joinedAt: new Date().toISOString()
    };
    saveState(currentState);
    console.log(`[Morning Greeting]: 📝 Registered guild "${guild.name}" (${guild.id})`);
  }
}

/**
 * Periodic Checker for 09:00 WIB Morning Greeting
 */
async function checkMorningGreetingCycle() {
  if (!discordClient || !discordClient.isReady()) return;

  const { dateKey, hour, minute } = getWIBTime();

  // Target hour: 9 WIB (09:00 - 09:59)
  if (hour !== 9) return;

  if (!currentState.sentHistory[dateKey]) {
    currentState.sentHistory[dateKey] = [];
  }

  const sentToday = new Set(currentState.sentHistory[dateKey]);

  for (const guild of discordClient.guilds.cache.values()) {
    registerGuild(guild);

    // Skip if already received greeting today
    if (sentToday.has(guild.id)) continue;

    // Check target channel
    const generalChannel = findGeneralChannelForGuild(guild, discordClient);
    if (!generalChannel) {
      console.warn(`[Morning Greeting]: ⚠️ No valid general channel in guild "${guild.name}" (${guild.id})`);
      continue;
    }

    try {
      const motivation = await generateMorningMotivation(guild.name);
      console.log(`[Morning Greeting]: ☀️ Sending to #${generalChannel.name} in "${guild.name}": "${motivation}" (${motivation.length} chars)`);

      await generalChannel.send(motivation);

      // Record to sentHistory
      currentState.sentHistory[dateKey].push(guild.id);
      saveState(currentState);
      sentToday.add(guild.id);

      // Brief delay between guilds to avoid burst
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Morning Greeting Error]: Failed to send to "${guild.name}":`, err.message);
    }
  }
}

/**
 * Initialize Morning Greeting Engine
 * @param {import('discord.js').Client} client 
 */
function initMorningGreeting(client) {
  discordClient = client;
  currentState = loadState();

  // Register existing guilds
  if (client.guilds && client.guilds.cache) {
    client.guilds.cache.forEach(guild => registerGuild(guild));
  }

  // Handle new guild join events
  client.on('guildCreate', (guild) => {
    console.log(`[Morning Greeting]: 🚀 Azura joined new server: "${guild.name}" (${guild.id})`);
    registerGuild(guild);

    const { hour } = getWIBTime();
    if (hour < 9) {
      console.log(`[Morning Greeting]: Joined before 09:00 WIB. Will send morning greeting today at 09:00 WIB!`);
    } else {
      console.log(`[Morning Greeting]: Joined after 09:00 WIB (${hour}:00 WIB). Will send morning greeting tomorrow at 09:00 WIB!`);
    }
  });

  // Start checker loop (every 30 seconds)
  if (checkerInterval) clearInterval(checkerInterval);
  checkerInterval = setInterval(checkMorningGreetingCycle, 30000);

  console.log('[Morning Greeting]: ✅ Engine initialized (09:00 WIB Daily Motivation, <=200 chars, New Guild Auto-Discovery).');
}

/**
 * Stop Morning Greeting Engine
 */
function stopMorningGreeting() {
  if (checkerInterval) {
    clearInterval(checkerInterval);
    checkerInterval = null;
  }
}

module.exports = {
  initMorningGreeting,
  stopMorningGreeting,
  checkMorningGreetingCycle,
  generateMorningMotivation,
  registerGuild,
  getWIBTime,
  getState: () => currentState,
  setState: (s) => { currentState = s; }
};
