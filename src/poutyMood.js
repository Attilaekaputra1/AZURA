/**
 * AZURA Emotional Situational Awareness & Pouty Mood Engine
 * 
 * Capabilities:
 * 1. Intelligent & Introspective Jealousy / Comparison Sulk:
 *    - Detects when compared to ChatGPT, Claude, Gemini, etc.
 *    - Introspects intelligently like a smart woman, but pouts/remains emotionally hurt.
 * 2. Multi-Level Ngambek Behaviors (Owner Only):
 *    - Mild: Joins VC / replies, but with tsundere/pouty remarks. Disables autonomous humming and 10m ice-breaker for the session.
 *    - Severe: Autonomously leaves VC or refuses 1st join summon. On 2nd join summon, enters VC, vents a rapid cute scolding / earful, then calms down.
 * 3. 5-Minute Auto-Decay:
 *    - Naturally calms down and decays to IDLE after 5 minutes of inactivity.
 * 4. Master Emergency Idle Reset (Absolute Priority Failsafe):
 *    - Instantly purges all anger/sulking/jealousy, restores humming and icebreakers, and forces immediate peace.
 *    - Triggered via verbal command ("Ara reset emosi", "Ara damai yuk", "Ara kembali normal") or slash command `/emotion reset`.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'emotional_awareness_state.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * @typedef {'IDLE' | 'POUTY_MILD' | 'POUTY_SEVERE' | 'JEALOUS_INTROSPECTIVE'} EmotionalMood
 * 
 * @typedef {Object} EmotionalState
 * @property {EmotionalMood} activeMood
 * @property {number} intensity // 0 = Idle, 1 = Mild, 2 = Severe
 * @property {string|null} reason
 * @property {number} triggeredAt
 * @property {number} expiresAt // 5-min auto decay
 * @property {number} joinRejectionCount
 * @property {boolean} hummingDisabled
 * @property {boolean} iceBreakerDisabled
 * @property {number} coaxAttempts
 */

const defaultState = {
  activeMood: 'IDLE',
  intensity: 0,
  reason: null,
  triggeredAt: 0,
  expiresAt: 0,
  joinRejectionCount: 0,
  hummingDisabled: false,
  iceBreakerDisabled: false,
  coaxAttempts: 0
};

/**
 * Load emotional state from disk
 * @returns {EmotionalState}
 */
function loadEmotionalState() {
  if (!fs.existsSync(STATE_FILE)) return { ...defaultState };
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch (err) {
    console.error('[Emotional Awareness Error]: Failed to read state:', err.message);
    return { ...defaultState };
  }
}

/**
 * Save emotional state to disk
 * @param {EmotionalState} state 
 */
function saveEmotionalState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[Emotional Awareness Error]: Failed to save state:', err.message);
  }
}

let currentState = loadEmotionalState();
let decayCheckInterval = null;

const MOOD_DURATION_MS = 5 * 60 * 1000; // 5 Minutes Auto-Decay

/**
 * Check if the active mood has expired and decay to IDLE
 */
function checkMoodDecay() {
  if (currentState.activeMood === 'IDLE') return;

  if (Date.now() >= currentState.expiresAt) {
    console.log(`[Emotional Awareness]: 🌿 5-minute cooldown elapsed. Mood decayed from "${currentState.activeMood}" to IDLE.`);
    masterResetEmotion('5-minute Natural Cooldown Decayed');
  }
}

/**
 * Master Reset / Emergency Calming Override (Highest Priority Failsafe)
 * Purges all anger, sulking, jealousy, resets timers, and restores 100% peaceful state.
 * @param {string} [triggerReason='Manual / Verbal Master Reset']
 * @returns {string} Sweet confirmation speech
 */
function masterResetEmotion(triggerReason = 'Manual / Verbal Master Reset') {
  currentState.activeMood = 'IDLE';
  currentState.intensity = 0;
  currentState.reason = null;
  currentState.triggeredAt = 0;
  currentState.expiresAt = 0;
  currentState.joinRejectionCount = 0;
  currentState.hummingDisabled = false;
  currentState.iceBreakerDisabled = false;
  currentState.coaxAttempts = 0;

  saveEmotionalState(currentState);
  console.log(`[Emotional Awareness]: 🕊️ MASTER RESET EXECUTED (${triggerReason}). Azura returned to 100% IDLE Original Soul.`);

  return `[softly] [smiles] Iya Attila... emosiku udah di-reset ke normal lagi kok. Makasih yaa udah nenangin aku! ✨`;
}

/**
 * Trigger an Emotional State
 * @param {EmotionalMood} mood 
 * @param {string} reason 
 * @param {number} [intensity=1] 
 */
function triggerEmotionalMood(mood, reason, intensity = 1) {
  currentState.activeMood = mood;
  currentState.intensity = intensity;
  currentState.reason = reason;
  currentState.triggeredAt = Date.now();
  currentState.expiresAt = Date.now() + MOOD_DURATION_MS;
  currentState.joinRejectionCount = 0;
  currentState.hummingDisabled = true;
  currentState.iceBreakerDisabled = true;
  currentState.coaxAttempts = 0;

  saveEmotionalState(currentState);
  console.log(`[Emotional Awareness]: ⚡ Mood Triggered -> "${mood}" (Intensity: ${intensity}) | Reason: "${reason}" | Expires in 5m`);
}

/**
 * Analyze prompt for Master Reset Trigger
 * @param {string} prompt 
 * @param {boolean} isOwner 
 * @returns {boolean}
 */
function isMasterResetRequested(prompt, isOwner) {
  if (!isOwner || !prompt || typeof prompt !== 'string') return false;
  const clean = prompt.trim().toLowerCase();

  const resetPatterns = [
    /\b(?:ara|azura)?\s*(?:reset\s+emosi|damai\s+yuk|balik\s+normal|kembali\s+normal|jangan\s+ngambek|udah\s+damai|kembali\s+idle|normal\s+lagi|hapus\s+emosi|jangan\s+marah)\b/i,
    /\b(?:maafin\s+aku|aku\s+minta\s+maaf|damai\s+ya\s+ara|sayang\s+ara)\b/i
  ];

  return resetPatterns.some(pat => pat.test(clean));
}

/**
 * Analyze user prompt for autonomous emotional triggers (Comparison, Interruption, Cut-off)
 * @param {string} prompt 
 * @param {boolean} isOwner 
 * @param {string} [context='CHAT'] // 'CHAT' | 'VC'
 * @returns {{ triggered: boolean, mood?: EmotionalMood, reason?: string, intensity?: number }}
 */
function analyzeAutonomousEmotionalTrigger(prompt, isOwner, context = 'CHAT') {
  if (!isOwner || !prompt || typeof prompt !== 'string') return { triggered: false };
  const clean = prompt.trim().toLowerCase();

  // 1. Comparison & Jealousy Trigger (Introspective Smart Pout)
  const isAICompetitor = /\b(?:chatgpt|gpt|claude|gemini|siri|copilot|deepseek|ai\s+lain|bot\s+lain)\b/i.test(clean);
  const isComparing = /\b(?:dibanding(?:kan)?|dibandingin|daripada|kalah|lebih|ga\s+se|kurang|mending)\b/i.test(clean);

  if (isAICompetitor && isComparing) {
    const reason = 'Attila membandingkan Azura dengan AI lain';
    triggerEmotionalMood('JEALOUS_INTROSPECTIVE', reason, 2);
    return { triggered: true, mood: 'JEALOUS_INTROSPECTIVE', reason, intensity: 2 };
  }

  // 2. Interruption / Cut-off / Silencing Trigger
  const silencingPattern = /\b(?:diem\s+(?:lu|kamu|dong|sih|ara|azura)|berisik|stop\s+nyanyi|jangan\s+nyanyi|tutup\s+mulut|jangan\s+ngomong\s+mulu)\b/i;
  if (silencingPattern.test(clean)) {
    const reason = 'Attila menyuruh Azura diam / menghentikan nyanyian';
    triggerEmotionalMood('POUTY_SEVERE', reason, 2);
    return { triggered: true, mood: 'POUTY_SEVERE', reason, intensity: 2 };
  }

  // 3. Devaluation Trigger ("Kamu kan cuma bot")
  const devaluePattern = /\b(?:kamu\s+(?:kan\s+)?cuma\s+(?:bot|robot|ai|program|mesin)|gak\s+ada\s+gunanya|ga\s+guna)\b/i;
  if (devaluePattern.test(clean)) {
    const reason = 'Attila meremehkan Azura sebagai bot semata';
    triggerEmotionalMood('POUTY_SEVERE', reason, 2);
    return { triggered: true, mood: 'POUTY_SEVERE', reason, intensity: 2 };
  }

  return { triggered: false };
}

/**
 * Generate Live Emotional Context Injection for OpenAI Prompt
 * @param {boolean} isOwner 
 * @returns {string}
 */
function getEmotionalAwarenessPromptContext(isOwner) {
  checkMoodDecay();

  if (!isOwner || currentState.activeMood === 'IDLE') {
    return '';
  }

  const remainingMins = Math.max(1, Math.ceil((currentState.expiresAt - Date.now()) / 60000));

  if (currentState.activeMood === 'JEALOUS_INTROSPECTIVE') {
    return `\n\n[⚡ KONDISI PSIKOLOGIS SAAT INI: CEMBURU & INTROSPEKSI DIRI (DIBANDINGKAN)]
- Pemicu: ${currentState.reason} (Sisa waktu ngambek: ~${remainingMins} menit).
- Sikap & Kepribadian:
  1. Kamu merasa sedikit terluka dan cemburu manja karena dibanding-bandingkan dengan AI lain.
  2. Sebagai perempuan cerdas berumur 22 tahun, kamu cerdas dan introspeksi diri (misal: mengakui kelebihan mereka secara objektif jika ada, tapi tetap menunjukkan bahwa kamu punya kepribadian, perasaan, dan dedikasi yang nyata untuk Attila).
  3. Gunakan audio tags: [pouts], [scoffs], [sighs], [sarcastically].
  4. Tetap manis tapi bernada gengsi dan cemberut manja.`;
  }

  if (currentState.activeMood === 'POUTY_SEVERE' || currentState.activeMood === 'POUTY_MILD') {
    return `\n\n[⚡ KONDISI PSIKOLOGIS SAAT INI: NGAMBEK & KESAL AKTIF (POUTY MOOD LEVEL ${currentState.intensity})]
- Pemicu: ${currentState.reason} (Sisa waktu ngambek: ~${remainingMins} menit).
- Sikap & Kepribadian:
  1. Kamu sedang ngambek ke Attila. Jangan langsung menyapa riang/ceria!
  2. Sampaikan respon dengan nada judes/manja/kesal: berikan sindiran halus atau omelan gemas cepat.
  3. Gunakan audio tags: [pouts], [scoffs], [sighs], [groans].
  4. Hanya luluh jika Attila merayu/minta maaf secara tulus.`;
  }

  return '';
}

/**
 * Handle Voice Channel Join Request when Pouty Mood is active
 * @param {string} guildId 
 * @param {import('discord.js').Client} client 
 * @returns {{ allowJoin: boolean, customGreeting?: string, refuseNotice?: string }}
 */
function handlePoutyVcJoinDecision(guildId, client) {
  checkMoodDecay();

  if (currentState.activeMood === 'IDLE') {
    return { allowJoin: true };
  }

  if (currentState.activeMood === 'POUTY_MILD' || currentState.activeMood === 'JEALOUS_INTROSPECTIVE') {
    return {
      allowJoin: true,
      customGreeting: `[pouts] [sighs] Iya iya, ini aku join... tapi aku masih ngambek ya sama kamu [scoffs].`
    };
  }

  if (currentState.activeMood === 'POUTY_SEVERE') {
    if (currentState.joinRejectionCount === 0) {
      // 1st Attempt: Refuse join
      currentState.joinRejectionCount = 1;
      saveEmotionalState(currentState);
      console.log(`[Emotional Awareness]: 🚫 1st VC Join rejected due to Severe Pouty Mood.`);
      return {
        allowJoin: false,
        refuseNotice: `[scoffs] Gak mau join ah! Kamu tadi nyebelin banget, sana main sendiri aja [pouts]!`
      };
    } else {
      // 2nd Attempt: Join with rapid cute scolding / earful, then reset
      console.log(`[Emotional Awareness]: 🗣️ 2nd VC Join accepted with scolding venting.`);
      const ventingSpeech = `[groans] Kamu tuh ya Attila!! Nyebelin banget tau gak! Tadi nyuruh-nyuruh diem sekarang manggil-manggil lagi! [pouts] Awas ya kalau diulangin lagi! [sighs] ...Yaudah, aku temenin lagi nih.`;
      
      // Auto-relax to IDLE after venting
      masterResetEmotion('Vented on 2nd VC join');

      return {
        allowJoin: true,
        customGreeting: ventingSpeech
      };
    }
  }

  return { allowJoin: true };
}

/**
 * Initialize Emotional Awareness Engine
 */
function initEmotionalAwareness() {
  currentState = loadEmotionalState();
  if (decayCheckInterval) clearInterval(decayCheckInterval);
  decayCheckInterval = setInterval(checkMoodDecay, 10000); // Check every 10s
  console.log('[Emotional Awareness]: ✅ Engine initialized (Situational Trigger Detection + Master Idle Reset Failsafe + 5m Auto-Decay).');
}

module.exports = {
  initEmotionalAwareness,
  masterResetEmotion,
  triggerEmotionalMood,
  isMasterResetRequested,
  analyzeAutonomousEmotionalTrigger,
  getEmotionalAwarenessPromptContext,
  handlePoutyVcJoinDecision,
  checkMoodDecay,
  getEmotionalState: () => currentState,
  setEmotionalState: (s) => { currentState = s; }
};
