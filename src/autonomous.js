/**
 * AZURA Autonomous Conversation Catalyst Engine v2.1
 * 
 * Special Two-Phase Catalyst Protocol for General Channel:
 * 1. Drops initial discussion topic in #general (from trending web or queued member suggestion).
 * 2. Observes for 2 hours (120 minutes):
 *    - KONDISI A: If a member responds & it's relevant to the topic -> AZURA actively replies & engages in conversation contextually!
 *                 If nobody responds yet -> AZURA stays silent & patient.
 *                 If someone seems interested / forgot / asks -> AZURA warmly banters/explains.
 *    - KONDISI B: If channel remains completely passive for 2 hours -> Asks: "kalo aku buat sesi diskusi besok, kalian mau diskusi tentang apa gais?"
 * 3. Captures the first member's topic suggestion, confirms politely, and queues it for tomorrow.
 * 4. Next day: Synthesizes that member's suggestion into a positive, lightweight, Gen Z discussion starter with credit.
 */

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const config = require('./config');
const { searchTavily } = require('./tavily');

// ============================================================
// PERSISTENT STATE STORAGE
// ============================================================

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'autonomous_state.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * @typedef {Object} AutonomousState
 * @property {'IDLE'|'OBSERVING_INITIAL_TOPIC'|'WAITING_TOPIC_SUGGESTION'|'TOPIC_SAVED'} stage
 * @property {string|null} targetChannelId
 * @property {number} initialTopicSentAt
 * @property {string|null} initialTopicMessageId
 * @property {string|null} initialTopicText
 * @property {number} userRespondedCount
 * @property {number|null} followupSentAt
 * @property {string|null} followupMessageId
 * @property {{ rawSuggestion: string, suggestedBy: string, suggestedById: string, capturedAt: string }|null} queuedTomorrowTopic
 * @property {string|null} lastCatalystDate
 * @property {number} lastActivityTimestamp
 */

const defaultState = {
  stage: 'IDLE',
  targetChannelId: null,
  initialTopicSentAt: 0,
  initialTopicMessageId: null,
  initialTopicText: null,
  userRespondedCount: 0,
  followupSentAt: null,
  followupMessageId: null,
  queuedTomorrowTopic: null,
  lastCatalystDate: null,
  lastActivityTimestamp: Date.now()
};

/**
 * Load persistent state from disk
 * @returns {AutonomousState}
 */
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { ...defaultState };
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch (err) {
    console.error('[Autonomous State Error]: Failed to read state file, using defaults:', err.message);
    return { ...defaultState };
  }
}

/**
 * Save state to disk
 * @param {AutonomousState} state 
 */
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[Autonomous State Error]: Failed to save state:', err.message);
  }
}

let currentState = loadState();

// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================

// Peak hours in WIB (UTC+7)
const PEAK_HOURS_START = parseInt(process.env.CATALYST_PEAK_START || '10', 10);  // 10:00 WIB
const PEAK_HOURS_END = parseInt(process.env.CATALYST_PEAK_END || '23', 10);      // 23:00 WIB

// Silence threshold before initial topic is sent (ms)
const SILENCE_THRESHOLD_MS = parseInt(process.env.CATALYST_SILENCE_MINUTES || '120', 10) * 60 * 1000; // 2 hours

// Observation window: wait 2 hours to see if members responded
const OBSERVATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours (120 minutes)

// How often the background check runs
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

/** @type {import('discord.js').Client | null} */
let discordClient = null;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get current hour in WIB timezone
 * @returns {number}
 */
function getCurrentWIBHour() {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const wibMinutes = utcMinutes + (7 * 60);
  return Math.floor((wibMinutes % 1440) / 60);
}

/**
 * Check if current time is within peak hours (WIB)
 * @returns {boolean}
 */
function isPeakHour() {
  const hour = getCurrentWIBHour();
  if (PEAK_HOURS_START <= PEAK_HOURS_END) {
    return hour >= PEAK_HOURS_START && hour < PEAK_HOURS_END;
  }
  return hour >= PEAK_HOURS_START || hour < PEAK_HOURS_END;
}

/**
 * Get today's date string in Asia/Jakarta timezone (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayDateWIB() {
  const now = new Date();
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).format(now);
  return parts;
}

/**
 * Find the primary General / Main Chat channel
 * @param {import('discord.js').Client} client 
 * @returns {import('discord.js').TextChannel | null}
 */
function findGeneralChannel(client) {
  // If specific channel ID configured in .env
  if (process.env.CATALYST_CHANNEL_ID) {
    const ch = client.channels.cache.get(process.env.CATALYST_CHANNEL_ID);
    if (ch && ch.isTextBased()) return ch;
  }

  // Look across all guilds
  for (const guild of client.guilds.cache.values()) {
    const textChannels = guild.channels.cache.filter(
      ch => ch.isTextBased() && !ch.isThread() && !ch.isVoiceBased()
    );

    // Exact matches first: 'general', 'chat', 'utama', 'lounge', 'ngobrol', 'umum'
    const priorityRegex = /^(?:general|chat|utama|lounge|ngobrol|umum|public|chat-general|general-chat)$/i;
    let match = textChannels.find(ch => priorityRegex.test(ch.name));
    if (match) return match;

    // Partial matches: contains 'general', 'utama', 'lounge'
    const partialRegex = /(?:general|utama|lounge|ngobrol|chat)/i;
    match = textChannels.find(ch => {
      if (/log|admin|bot|command|rules|announcement|pengumuman|welcome/i.test(ch.name)) return false;
      return partialRegex.test(ch.name);
    });
    if (match) return match;

    // Fallback: first text channel with SendMessages permission
    const fallback = textChannels.find(ch => {
      if (/log|admin|bot|command|rules|announcement|pengumuman|welcome/i.test(ch.name)) return false;
      const perms = ch.permissionsFor(client.user);
      return perms && perms.has('SendMessages') && perms.has('ViewChannel');
    });
    if (fallback) return fallback;
  }

  return null;
}

// ============================================================
// TOPIC GENERATORS
// ============================================================

/**
 * Generate a discussion starter from a member's queued suggestion
 * @param {{ rawSuggestion: string, suggestedBy: string }} queuedTopic 
 * @returns {Promise<string|null>}
 */
async function generateMemberSuggestedDiscussion(queuedTopic) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const systemPrompt = `Kamu adalah AZURA, cewek Gen Z 22 tahun yang cerdas, seru, dan relatable di Discord.
Kemarin kamu sempat nanya topik diskusi apa yang seru buat hari ini, dan seorang member bernama "${queuedTopic.suggestedBy}" mengusulkan topik: "${queuedTopic.rawSuggestion}".

TUGASMU:
Buat pemantik obrolan / topik diskusi santai untuk hari ini berdasarkan usulan ${queuedTopic.suggestedBy}.

ATURAN WAJIB:
1. Berikan apresiasi / sebutkan secara natural bahwa ide ini dari ${queuedTopic.suggestedBy} (misal: "Sesuai ide dari ${queuedTopic.suggestedBy} kemarin nih..." atau "Kemarin ${queuedTopic.suggestedBy} ngusulin topik menarik banget...").
2. Olah topik tersebut agar bernada POSITIF, RINGAN, GAUL, dan MUDAH DIPAHAMI anak muda / Gen Z.
3. Hindari bahasa yang terlalu berat atau kaku. Buat mengalir seperti obrolan tongkrongan santai (2-4 kalimat).
4. Tutup dengan pertanyaan pemantik diskusi yang seru agar member lain langsung tertarik nimbrung dan memberikan opini.
5. DILARANG pakai format list/poin/bullet. Tulis murni teks chat biasa.
6. Emoji minimal (maksimal 1-2 saja, dan hanya jika natural).
7. DILARANG pakai kata pengumuman bot kaku seperti "Halo semuanya!".`;

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Kirim pemantik diskusi untuk server sekarang.' }
      ],
      max_completion_tokens: 300
    });

    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[Autonomous Catalyst Error]: Failed to generate member suggested topic:', err.message);
    return null;
  }
}

/**
 * Generate a fresh discussion starter when no queued topic is available
 * @returns {Promise<string|null>}
 */
async function generateFreshDiscussionTopic() {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  // Try to get fresh trending news from Tavily
  let trendingContext = '';
  try {
    const searchRes = await searchTavily('trending pop culture tech creative viral Indonesia 2026', 'news');
    if (searchRes && typeof searchRes === 'string' && searchRes.length > 50) {
      trendingContext = `\n\nBahan inspirasi berita terkini (opsional):\n${searchRes.substring(0, 500)}`;
    }
  } catch (err) {
    console.warn('[Autonomous Catalyst]: Tavily fetch failed, using offline creativity.');
  }

  const systemPrompt = `Kamu adalah AZURA, cewek Gen Z 22 tahun yang lagi nongkrong santai di Discord. Kamu mau mulai obrolan seru di channel general.

TUGASMU:
Lempar 1 topik diskusi hangat, pertanyaan seru, atau tren terkini yang menarik untuk dibahas bareng.

ATURAN WAJIB:
1. Positif, ringan, gaul, dan sangat relatable untuk anak muda / Gen Z Indonesia.
2. Tulis murni chat Discord santai 2-3 kalimat (bukan pengumuman bot).
3. DILARANG buka dengan "Halo guys", "Selamat siang", atau semacamnya. Langsung masuk topik obrolan.
4. Akhiri dengan pertanyaan santai yang memicu orang untuk reply dan sharing opini mereka.
5. Emoji minimal (0-2 max). DILARANG pakai bullet/list/poin.${trendingContext}`;

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Mulai obrolan santai.' }
      ],
      max_completion_tokens: 300
    });

    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[Autonomous Catalyst Error]: Failed to generate fresh topic:', err.message);
    return null;
  }
}

/**
 * Evaluates whether a member's message is relevant to the active topic and generates a contextual reply
 * @param {import('discord.js').Message} message 
 * @param {string} initialTopicText 
 * @returns {Promise<string|null>}
 */
async function generateTopicDiscussionReply(message, initialTopicText) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const userName = message.member?.displayName || message.author.username;
  const userText = message.content.trim();

  // If user explicitly replied to AZURA or mentioned AZURA
  const isDirectReply = (message.reference && message.reference.messageId === currentState.initialTopicMessageId) ||
                        (discordClient && message.mentions.has(discordClient.user.id));

  const systemPrompt = `Kamu adalah AZURA, cewek Gen Z 22 tahun yang cerdas, santai, dan seru di Discord.
Kamu sebelumnya melempar topik diskusi di channel general:
"${initialTopicText}"

Sekarang seorang member bernama "${userName}" mengirim pesan:
"${userText}"

TUGASMU:
1. Analisis apakah pesan ${userName} berkaitan dengan topik diskusi, merespon obrolanmu, atau menunjukkan ketertarikan (meskipun singkat, bercanda, mengemukakan opini, bilang lupa, atau penasaran).
2. Jika SAMA SEKALI TIDAK RELEVAN (misal cuma ketik command bot seperti !play, kirim spam/link random, atau obrolan terpisah yang jelas tidak nyambung), balas dengan HANYA satu kata: [IGNORE].
3. Jika RELEVAN atau MENYAMBUNG: Balas pesannya secara natural seperti teman nongkrong seumuran Gen Z!
   - Berikan tanggapan asyik atas opininya, lempar opini balik, atau celetukan santai.
   - Jika dia bilang lupa / bingung / minta elaborasi (misal "lupa euy", "apaan tuh tadi?"), ingatkan & jelaskan intinya dengan ramah dan santai.
   - Panjang: 1-3 kalimat saja, teks chat biasa mengalir.
   - DILARANG format list/poin/bullet.
   - Emoji minimal (0-2 max).
   - DILARANG kata pembuka bot kaku.`;

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Pesan dari ${userName}: "${userText}"` }
      ],
      max_completion_tokens: 250
    });

    const reply = res.choices[0]?.message?.content?.trim();
    if (!reply || reply.includes('[IGNORE]')) {
      if (isDirectReply) {
        return `Wkwk gimana menurutmu ${userName}?`;
      }
      return null;
    }
    return reply;
  } catch (err) {
    console.error('[Autonomous Catalyst Error]: Failed to generate topic discussion reply:', err.message);
    return null;
  }
}

/**
 * Extract clean topic suggestion from a user's message
 * @param {string} userText 
 * @param {string} userName 
 * @returns {Promise<string>}
 */
async function cleanTopicSuggestion(userText, userName) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You extract the core topic of discussion suggested by a user in Indonesian Discord chat. Return ONLY the concise topic phrase in Indonesian (under 12 words), without quotes or introductory text.'
        },
        {
          role: 'user',
          content: `User "${userName}" said: "${userText}". Extract the core discussion topic they suggested:`
        }
      ],
      max_completion_tokens: 50
    });

    const topic = res.choices[0]?.message?.content?.trim();
    return topic || userText;
  } catch {
    return userText;
  }
}

// ============================================================
// CORE AUTONOMOUS ENGINE LOOP
// ============================================================

/**
 * Record channel activity when a human member chats
 * @param {string} channelId 
 * @param {import('discord.js').Message} message 
 */
async function handleChannelMessage(message) {
  if (!message.guild || message.author.bot) return;

  const state = currentState;
  const channelId = message.channel.id;

  // Strictly monitor only the General channel
  if (state.targetChannelId && state.targetChannelId === channelId) {
    state.lastActivityTimestamp = Date.now();

    // -----------------------------------------------------------------
    // KONDISI A: OBSERVING INITIAL TOPIC (2-Hour Window)
    // -----------------------------------------------------------------
    if (state.stage === 'OBSERVING_INITIAL_TOPIC') {
      state.userRespondedCount++;
      console.log(`[Autonomous Catalyst]: Member "${message.author.username}" chatted in #general during observation window: "${message.content}"`);

      // If we have an active initial topic, check relevance and reply contextually!
      if (state.initialTopicText) {
        const contextualReply = await generateTopicDiscussionReply(message, state.initialTopicText);
        if (contextualReply) {
          await message.channel.sendTyping().catch(() => {});
          await message.reply(contextualReply).catch(err => {
            console.error('[Autonomous Catalyst]: Failed to reply to member on topic:', err.message);
          });
          console.log(`[Autonomous Catalyst]: 💬 Contextual reply sent to ${message.author.username}: "${contextualReply}"`);
        }
      }

      saveState(state);
      return;
    }

    // -----------------------------------------------------------------
    // KONDISI B: WAITING TOPIC SUGGESTION (Survey Response Listener)
    // -----------------------------------------------------------------
    if (state.stage === 'WAITING_TOPIC_SUGGESTION') {
      const content = message.content.trim();
      if (content.length < 3) return;

      console.log(`[Autonomous Catalyst]: 🎯 Topic suggestion received from "${message.author.username}": "${content}"`);

      // Extract and clean the topic
      const cleanedTopic = await cleanTopicSuggestion(content, message.author.username);

      // Save to state as queued tomorrow topic
      state.queuedTomorrowTopic = {
        rawSuggestion: cleanedTopic,
        suggestedBy: message.member?.displayName || message.author.username,
        suggestedById: message.author.id,
        capturedAt: new Date().toISOString()
      };

      state.stage = 'TOPIC_SAVED';
      saveState(state);

      // Respond warmly and gratefully to that member in channel
      const acknowledgments = [
        `Sip noted ${message.member?.displayName || message.author.username}! Besok kita bahas soal **${cleanedTopic}** yaa, makasih idenya! ✨`,
        `Wih menarik bgt! Oke besok sesi diskusinya kita angkat topik **${cleanedTopic}** yaa ${message.member?.displayName || message.author.username}, makasih sarannya! 🙌`,
        `Noted ${message.member?.displayName || message.author.username}! Besok aku siapin pemantik buat kita bahas **${cleanedTopic}** bareng-bareng yaa 🚀`
      ];
      const replyText = acknowledgments[Math.floor(Math.random() * acknowledgments.length)];

      await message.reply(replyText).catch(err => {
        console.error('[Autonomous Catalyst]: Failed to reply topic confirmation:', err.message);
      });

      console.log(`[Autonomous Catalyst]: ✅ Topic successfully saved for tomorrow: "${cleanedTopic}" by ${state.queuedTomorrowTopic.suggestedBy}`);
    }
  }
}

/**
 * Main Autonomous Catalyst Cycle Checker
 */
async function runAutonomousCheck() {
  if (!discordClient || !discordClient.isReady()) return;

  const state = currentState;
  const now = Date.now();
  const todayDate = getTodayDateWIB();

  // Find general channel if not set or invalid
  const generalChannel = findGeneralChannel(discordClient);
  if (!generalChannel) {
    return;
  }
  state.targetChannelId = generalChannel.id;

  // -------------------------------------------------------------
  // STATE MACHINE LOGIC
  // -------------------------------------------------------------

  // STAGE 1: OBSERVING_INITIAL_TOPIC
  // We sent an initial topic, now waiting 2 hours (120 min) to evaluate response
  if (state.stage === 'OBSERVING_INITIAL_TOPIC') {
    const elapsed = now - state.initialTopicSentAt;

    if (elapsed >= OBSERVATION_WINDOW_MS) {
      console.log(`[Autonomous Catalyst]: 2-hour observation period complete. Member responses count = ${state.userRespondedCount}`);

      if (state.userRespondedCount > 0) {
        // Chat was active! Great success, reset to IDLE
        console.log('[Autonomous Catalyst]: Chat is active & engaging. No follow-up survey needed today.');
        state.stage = 'IDLE';
        state.lastCatalystDate = todayDate;
        saveState(state);
      } else {
        // Still completely passive after 2 hours! Ask for tomorrow's discussion topic
        console.log('[Autonomous Catalyst]: Channel remained passive after 2 hours. Sending topic survey...');

        const surveyMessages = [
          'Kyknya topik diskusi hari ini kurang menarik yaa, kalo aku buat sesi diskusi besok, kalian mau diskusi tentang apa gais?',
          'Kyknya topik diskusi hari ini kurang menarik yaa.. kalo besok kita adain sesi diskusi santai, enaknya bahas apa nih gais?',
          'Kyknya topik hari ini kurang seru yaa wkwk, kalo besok mau pada ngobrolin topik apa gais kalo aku buka sesi diskusi?'
        ];
        const surveyText = surveyMessages[Math.floor(Math.random() * surveyMessages.length)];

        try {
          const sentMsg = await generalChannel.send(surveyText);
          state.stage = 'WAITING_TOPIC_SUGGESTION';
          state.followupSentAt = now;
          state.followupMessageId = sentMsg.id;
          state.lastCatalystDate = todayDate;
          saveState(state);
          console.log('[Autonomous Catalyst]: ✅ Survey message sent. Now waiting for first member topic suggestion.');
        } catch (err) {
          console.error('[Autonomous Catalyst]: Failed to send survey message:', err.message);
        }
      }
    }
    return;
  }

  // STAGE 2: WAITING_TOPIC_SUGGESTION or TOPIC_SAVED
  // If it's still the same day, don't re-trigger a new initial catalyst
  if (state.stage === 'WAITING_TOPIC_SUGGESTION' || state.stage === 'TOPIC_SAVED') {
    if (state.lastCatalystDate === todayDate) {
      return; // Already executed protocol today, wait for tomorrow
    }
  }

  // STAGE 3: IDLE -> Check if we should trigger a new catalyst for the day
  if (state.stage === 'IDLE' || state.lastCatalystDate !== todayDate) {
    // Only trigger during peak hours (10:00 - 23:00 WIB)
    if (!isPeakHour()) {
      return;
    }

    // Check if channel has been silent for SILENCE_THRESHOLD_MS (e.g. 2 hours)
    const silenceDuration = now - (state.lastActivityTimestamp || 0);
    if (silenceDuration < SILENCE_THRESHOLD_MS) {
      return; // Still recent activity
    }

    console.log(`[Autonomous Catalyst]: Dead chat detected in #${generalChannel.name} (silent for ${Math.round(silenceDuration / 60000)} mins). Initiating catalyst...`);

    let topicMessage = null;

    // Check if we have a queued topic from yesterday's survey
    if (state.queuedTomorrowTopic && state.queuedTomorrowTopic.rawSuggestion) {
      console.log(`[Autonomous Catalyst]: Found queued topic from ${state.queuedTomorrowTopic.suggestedBy}: "${state.queuedTomorrowTopic.rawSuggestion}". Synthesizing...`);
      topicMessage = await generateMemberSuggestedDiscussion(state.queuedTomorrowTopic);
      // Clear the queued topic once used
      state.queuedTomorrowTopic = null;
    } else {
      console.log('[Autonomous Catalyst]: No queued topic found, generating fresh trending discussion topic...');
      topicMessage = await generateFreshDiscussionTopic();
    }

    if (!topicMessage) {
      console.warn('[Autonomous Catalyst]: Failed to generate discussion topic. Will retry in next check.');
      return;
    }

    try {
      const sentMsg = await generalChannel.send(topicMessage);

      state.stage = 'OBSERVING_INITIAL_TOPIC';
      state.initialTopicSentAt = now;
      state.initialTopicMessageId = sentMsg.id;
      state.initialTopicText = topicMessage; // Save the topic text for contextual response evaluation
      state.userRespondedCount = 0;
      state.lastActivityTimestamp = now;
      state.lastCatalystDate = todayDate;
      saveState(state);

      console.log(`[Autonomous Catalyst]: ✅ Initial topic sent to #${generalChannel.name}. Now entering 2-hour observation window with contextual auto-engagement.`);
    } catch (err) {
      console.error(`[Autonomous Catalyst]: Failed to send initial topic to #${generalChannel.name}:`, err.message);
    }
  }
}

// ============================================================
// ENGINE INITIALIZATION & EXPORTS
// ============================================================

let intervalTimer = null;

/**
 * Initialize Autonomous Catalyst Engine
 * @param {import('discord.js').Client} client 
 */
async function initAutonomousCatalyst(client) {
  discordClient = client;
  currentState = loadState();

  const generalCh = findGeneralChannel(client);
  if (generalCh) {
    currentState.targetChannelId = generalCh.id;
    saveState(currentState);
    console.log(`[Autonomous Catalyst]: 🎯 Target channel locked to #${generalCh.name} (${generalCh.id})`);
  } else {
    console.warn('[Autonomous Catalyst]: ⚠️ No suitable general channel found yet. Will search during checks.');
  }

  // Start background timer
  intervalTimer = setInterval(runAutonomousCheck, CHECK_INTERVAL_MS);

  console.log('[Autonomous Catalyst]: ✅ Engine v2.1 initialized (Condition A Contextual Engagement + Condition B Fallback).');
  console.log(`  • Peak Hours   : ${PEAK_HOURS_START}:00 - ${PEAK_HOURS_END}:00 WIB`);
  console.log(`  • Observation  : 2 Jam (120 Menit)`);
  console.log(`  • Current Stage: ${currentState.stage}`);
}

/**
 * Stop the engine
 */
function stopAutonomousCatalyst() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

/**
 * Record message activity in channel
 * @param {string} channelId 
 * @param {import('discord.js').Message} message
 */
function recordChannelActivity(channelId, message = null) {
  if (currentState.targetChannelId === channelId) {
    currentState.lastActivityTimestamp = Date.now();
  }
  if (message) {
    handleChannelMessage(message).catch(err => {
      console.error('[Autonomous Catalyst Error]:', err.message);
    });
  }
}

/**
 * Get status of catalyst engine
 * @returns {object}
 */
function getCatalystStatus() {
  return {
    stage: currentState.stage,
    targetChannelId: currentState.targetChannelId,
    initialTopicSentAt: currentState.initialTopicSentAt ? new Date(currentState.initialTopicSentAt).toLocaleTimeString('id-ID') : null,
    initialTopicText: currentState.initialTopicText,
    userRespondedCount: currentState.userRespondedCount,
    queuedTomorrowTopic: currentState.queuedTomorrowTopic,
    lastCatalystDate: currentState.lastCatalystDate,
    isPeakHour: isPeakHour(),
    currentWIBHour: getCurrentWIBHour()
  };
}

module.exports = {
  initAutonomousCatalyst,
  stopAutonomousCatalyst,
  recordChannelActivity,
  handleChannelMessage,
  getCatalystStatus,
  findGeneralChannel,
  isPeakHour,
  getCurrentWIBHour
};
