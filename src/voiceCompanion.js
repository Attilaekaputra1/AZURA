const {
  joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState,
  EndBehaviorType, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, StreamType
} = require('@discordjs/voice');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder
} = require('discord.js');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ============================================================
// State Management
// ============================================================
const activeConnections = new Map();      // guildId -> VoiceConnection
const companionTextChannels = new Map();  // guildId -> TextChannel
const audioPlayers = new Map();           // guildId -> AudioPlayer
const activeRecordings = new Set();       // userIds currently being recorded
const voiceCooldowns = new Map();         // userId -> last response timestamp
const isBotSpeaking = new Set();          // guildIds where bot is speaking
const isGuildProcessingVoice = new Set(); // guildIds where voice turn is actively processing (Whisper/GPT/TTS)
const voiceSessions = new Map();          // guildId -> { startTime, channelName, guildName, entries: [] }
const pendingMusic = new Map();           // pendingId -> { songTitle, guildId, channelId, requesterId }
const idleTimers = new Map();             // guildId -> NodeJS.Timeout
const deepSleepTimers = new Map();        // guildId -> NodeJS.Timeout (15-minute auto-pause & deep sleep)
const dismissedGuilds = new Set();        // guildIds where bot was dismissed by Attila (anti auto-rejoin)

// Summon-Based Conversation State Machine
// guildId -> { mode: 'PASSIVE'|'ACTIVE'|'DEEP_SLEEP', lastActiveAt: number, turnCount: number }
const conversationMode = new Map();
const activeExpireTimers = new Map();     // guildId -> NodeJS.Timeout (6s auto-expire to PASSIVE in Solo Mode)
const ACTIVE_EXPIRE_MS = 6000;            // 6 seconds of silence -> back to PASSIVE in Solo Mode
const vcThirdPersonTracker = new Map();   // guildId -> { count: number, lastTime: number, quotes: [] }

// ============================================================
// Configuration
// ============================================================
const VOICE_COOLDOWN_MS = 500;        // 0.5s cooldown for regular members (0ms for Owner)
const SILENCE_DURATION_MS = 500;      // 0.5s natural snappy silence window for ultra-fast turn-taking
const MAX_OWNER_STORY_CHARS = 5500;   // ~5 minutes maximum storytelling/deep explanation for Owner (~750 words)
const MAX_OWNER_NORMAL_CHARS = 3000;  // ~2 - 3 minutes normal speech for Owner
const MAX_FRIEND_CHARS = 2500;        // ~2 minutes maximum speech for Approved Friends
const MAX_NORMAL_CHARS = 2500;        // Default fallback normal TTS speech
const MAX_STORY_CHARS = 5500;         // Default fallback storytelling TTS speech
// Modular Subsystems
const {
  MIN_AUDIO_BYTES,
  MAX_RECORDING_MS,
  WHISPER_HALLUCINATIONS,
  WHISPER_HALLUCINATION_PATTERNS,
  isWhisperHallucination,
  pcmToWav,
  calculateRmsAndPeak,
  transcribeVoice
} = require('./voiceAudioPipeline');

const {
  SPONTANEOUS_SONGS,
  SOFT_HUMMING_SONGS,
  pendingAttilaVoiceCalls,
  hummingTimers,
  inactivityTimers,
  isOwnerInterruptionPhrase,
  resetHummingTimer: resetAutonomousHummingTimer,
  clearHummingTimer
} = require('./voiceAutonomousBehaviors');

const {
  saveVoiceStateCache,
  loadVoiceStateCache
} = require('./voiceSessionState');

const {
  WAKE_WORDS,
  hasWakeWord,
  analyzeVoiceIntent,
  isWakeWordInvoked
} = require('./voiceIntentRouter');

const {
  splitIntoSentences,
  getAudioQueue
} = require('./ttsStreamingQueue');

const { getSelfAwarenessContext } = require('./selfAwareness');

// Load persistent voice state cache on startup (Solving Concurrency State Loss)
loadVoiceStateCache(voiceSessions, conversationMode);

// Periodic persistence: save active VC sessions every 30 seconds
setInterval(() => {
  if (voiceSessions.size > 0 || conversationMode.size > 0) {
    saveVoiceStateCache(voiceSessions, conversationMode);
  }
}, 30000);

process.on('SIGTERM', () => saveVoiceStateCache(voiceSessions, conversationMode));
process.on('SIGINT', () => saveVoiceStateCache(voiceSessions, conversationMode));


// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ============================================================
// Lazy Loaders
// ============================================================
let _openai = null;
function getOpenAI() {
  if (!_openai && config.OPENAI_API_KEY) {
    const { OpenAI } = require('openai');
    _openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return _openai;
}

let _askAzura = null;
function getAskAzura() {
  if (!_askAzura) {
    _askAzura = require('./azura').askAzura;
  }
  return _askAzura;
}

let _prism = null;
function getPrism() {
  if (!_prism) {
    try {
      _prism = require('prism-media');
    } catch {
      console.error('[Voice]: prism-media not installed.');
    }
  }
  return _prism;
}




/**
 * Format text for natural, conversational fallback TTS (OpenAI / Edge)
 * Converts ElevenLabs emotion tags into natural spoken interjections and pauses.
 * @param {string} raw 
 * @returns {string}
 */
function prepareNaturalTextForFallbackTts(raw) {
  return raw
    .replace(/\[(?:laughs|giggles|chuckles|snickers|wheezing)\]/gi, ', hehe, ')
    .replace(/\[(?:cries|sobbing|sniffs|tearing up)\]/gi, ', hiks hiks... ')
    .replace(/\[(?:screams|shouts|yells)\]/gi, 'KYAAA! ')
    .replace(/\[(?:sings|singing|humming|melody)\]/gi, '♪ ')
    .replace(/\[(?:sighs|groans)\]/gi, ', fyuuh... ')
    .replace(/\[(?:whispers|softly)\]/gi, 'psst, ')
    .replace(/\[(?:gasp|panicking)\]/gi, 'Wah! ')
    .replace(/\[(?:pouts|yawns|grunts)\]/gi, 'ihh, ')
    .replace(/\[(?:excited|cheering|amazed|awe)\]/gi, 'Yayy! ')
    .replace(/\[(?:action|emotion):[^\]]+\]/gi, '')
    .replace(/\[[^\]]+\]/gi, '')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect the optimal ElevenLabs Model based on User Input Intention, Sentiment/Emotion, and Context
 * 1. eleven_v3 (Flagship Expressive Model):
 *    - Drama, high emotion, laughing, crying, screaming, singing, whispering, gasping, teasing, tongkrongan jokes, prank/jump-scare.
 *    - Triggered whenever AI text contains audio tags ([laughs], [cries], etc.) OR user input has intense emotional markers.
 * 2. eleven_multilingual_v2 (The Classic Long-Form):
 *    - Long-form storytelling, fairy tales (dongeng), novels, historical chronologies, deep conceptual explanations up to 5 minutes.
 *    - Maintains unwavering vocal stability from start to finish without drifting or pitch aberrations.
 * 3. eleven_flash_v2_5 (The Speedster):
 *    - Daily casual conversations, quick Q&A, bot commands, brief updates, status checks.
 *    - Ultra-low latency response & massive credit quota savings.
 * 
 * @param {string} userTranscript 
 * @param {string} aiSpokenText 
 * @param {boolean} isStory 
 * @returns {{ modelId: string, name: string, reason: string }}
 */
function detectVoiceModel(userTranscript = '', aiSpokenText = '', isStory = false) {
  const cleanInput = (userTranscript || '').toLowerCase();
  const cleanOutput = (aiSpokenText || '').toLowerCase();

  // 1. Check for Emotion Audio Tags or Drama in AI Response -> eleven_v3
  const hasAudioEmotionTags = /\[(?:laughs|giggles|chuckles|snickers|wheezing|cries|sobbing|sniffs|tearing up|screams|shouts|yells|sings|singing|humming|melody|whispers|softly|sighs|groans|gasp|panicking|pouts|yawns|sleepy|drowsy|grunts|excited|cheering|amazed|awe)\]/i.test(aiSpokenText);
  
  // 2. Check for High Emotion, Jokes, Humor, Cricket Sounds, Prank, Drama in User Input or AI Response
  const hasHighEmotionIntent = /\b(?:kaget|dor|teriak|jerit|nangis|sedih|hiks|ketawa|ngakak|lucu|lucu\s+banget|canda|candaan|jokes|joke|lelucon|humor|lawak|lawakan|ngelawak|tebak\s*tebakan|tebakan|gombal|gombalan|krik|jangkrik|prank|hantu|kecoa|marah|kesal|panik|nyanyi|singing|lagu|sayang|bisik|ngambek|gemas|awikwok|wkwk|haha|hehe|hihi|gokil)\b/i.test(cleanInput) || /\b(?:krik\s*krik|jangkrik|tebak-tebakan|lelucon|jokes)\b/i.test(cleanOutput);
  const hasExpressiveExclamations = /[!]{2,}/.test(userTranscript) || /\b(?:hah|woi|astaga|ya\s*allah|omg|anjir|bjir|gila|waduh|buset)\b/i.test(cleanInput);

  if (hasAudioEmotionTags || hasHighEmotionIntent || hasExpressiveExclamations) {
    return {
      modelId: 'eleven_v3',
      name: 'ElevenLabs v3 (Flagship Model - Full Expressive Emotion, Laughter & Audio Tags)',
      reason: hasAudioEmotionTags ? 'audio_tags_detected' : 'high_emotional_or_jokes_sentiment'
    };
  }

  // 3. Check for Long-Form Storytelling / Deep Conceptual Explanations up to 5 min -> eleven_multilingual_v2
  const isLongNarrative = isStory || cleanOutput.length > 1400 || /\b(?:ceritakan|dongeng|kisah|alur|novel|cerita\s+panjang|jelaskan\s+(?:panjang|lengkap|detail|mendalam)|kronologi|sejarah)\b/i.test(cleanInput);
  if (isLongNarrative) {
    return {
      modelId: 'eleven_multilingual_v2',
      name: 'ElevenLabs Multilingual v2 (The Classic Long-Form - 5-Min Vocal Stability)',
      reason: isStory ? 'storytelling_intent' : 'long_form_content'
    };
  }

  // 4. Default: Casual everyday conversation, quick Q&A, bot commands -> eleven_flash_v2_5
  return {
    modelId: 'eleven_flash_v2_5',
    name: 'ElevenLabs Flash v2.5 (The Speedster - Ultra-low Latency & Max Quota Saver)',
    reason: 'casual_speedster_quota_saver'
  };
}

/**
 * Generate TTS audio and wrap it as a Discord AudioResource with Volume Booster & Natural Intonation.
 * Primary: ElevenLabs (Kak Ceria - Dynamic Model Routing: Flash v2.5 / v3 / Multilingual v2)
 * Fallback 1: Microsoft Edge Neural TTS (Indonesian Female Voice: Cute Gadis / Mature Siti)
 * Fallback 2: OpenAI TTS-1-HD (Shimmer / Nova)
 */
async function textToAudioResource(text, client = null, maxChars = MAX_NORMAL_CHARS, userContextOrOptions = null) {
  const clean = text
    .slice(0, maxChars)
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\bAtt\b/g, 'At')
    .replace(/\batt\b/g, 'at')
    .replace(/\bATT\b/g, 'At')
    .trim();
  if (!clean) return null;

  // Resolve options & context
  let userTranscript = '';
  let isStory = false;
  let forcedModel = null;

  if (typeof userContextOrOptions === 'string') {
    userTranscript = userContextOrOptions;
  } else if (userContextOrOptions && typeof userContextOrOptions === 'object') {
    userTranscript = userContextOrOptions.userTranscript || '';
    isStory = Boolean(userContextOrOptions.isStory);
    forcedModel = userContextOrOptions.forcedModel || null;
  }

  // Dynamic ElevenLabs Model Detection (v3 vs Flash v2.5 vs Multilingual v2)
  const detectedModel = forcedModel ? { modelId: forcedModel, name: forcedModel, reason: 'forced' } : detectVoiceModel(userTranscript, text, isStory);
  const voiceId = config.ELEVENLABS_VOICE_ID || 'd15jrIAARvF899pDoC6T'; // Always Kak Ceria

  // 1. Primary: ElevenLabs Real-Time Low-Latency Audio Streaming (Kak Ceria - Dynamic Model)
  if (config.ELEVENLABS_API_KEY) {
    try {
      console.log(`[Voice TTS Engine]: ⚡ Real-Time Streaming via ${detectedModel.name} (Kak Ceria - ${voiceId}) [Reason: ${detectedModel.reason}] | Output: ${clean.length} chars...`);
      const { streamElevenLabsTTS } = require('./elevenlabs');
      const audioStream = await streamElevenLabsTTS(clean, voiceId, detectedModel.modelId, client);
      const resource = createAudioResource(audioStream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      if (resource.volume) {
        resource.volume.setVolume(1.4); // +3dB balanced clarity
      }
      return resource;
    } catch (elevenErr) {
      console.warn(`[Voice TTS Warning]: ElevenLabs Streaming (${detectedModel.modelId}) failed (${elevenErr.message}). Switching to Indonesian Female Voice Fallback...`);
    }
  }

  // Convert audio tags into natural conversational Indonesian interjections for Fallback TTS
  const naturalFallbackText = prepareNaturalTextForFallbackTts(clean);
  const fallbackVoiceChoice = config.INDONESIAN_FEMALE_FALLBACK_VOICE || 'gadis_cute';

  // 2. Fallback 1: Microsoft Edge Neural TTS (Indonesian Female Voice: Cute Gadis / Mature Siti)
  const tempPath = path.join(TEMP_DIR, `vc_tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`);
  try {
    const { EdgeTTS } = require('node-edge-tts');
    let edgeVoice = 'id-ID-GadisNeural';
    let edgePitch = '+0Hz';
    let edgeRate = '+0%';
    let voiceDesc = 'Natural Indonesian Female';

    if (fallbackVoiceChoice === 'gadis_cute' || config.VTUBER_VOICE_MODE === 'edge_vtuber') {
      edgeVoice = 'id-ID-GadisNeural';
      edgePitch = '+20Hz';
      edgeRate = '+10%';
      voiceDesc = 'Cute Kawaii Gadis Neural (+20Hz Pitch)';
    } else if (fallbackVoiceChoice === 'siti_mature') {
      edgeVoice = 'id-ID-SitiNeural';
      edgePitch = '+0Hz';
      edgeRate = '+0%';
      voiceDesc = 'Mature Warm Siti Neural (Indonesian Female)';
    } else if (fallbackVoiceChoice === 'gadis_natural') {
      edgeVoice = 'id-ID-GadisNeural';
      edgePitch = '+0Hz';
      edgeRate = '+0%';
      voiceDesc = 'Natural Gadis Neural (Indonesian Female)';
    }

    console.log(`[Voice TTS Fallback]: 🎀 Generating audio via Microsoft Edge Neural TTS (${voiceDesc})...`);
    const tts = new EdgeTTS({
      voice: edgeVoice,
      lang: 'id-ID',
      pitch: edgePitch,
      rate: edgeRate,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    await tts.ttsPromise(naturalFallbackText, tempPath);
    const buf = fs.readFileSync(tempPath);
    fs.unlink(tempPath, () => {});
    const resource = createAudioResource(Readable.from(buf), {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });
    if (resource.volume) {
      resource.volume.setVolume(2.2); // 220% loud & clear volume boost
    }
    return resource;
  } catch (edgeErr) {
    console.warn('[Voice TTS Fallback Warning]: EdgeTTS failed, attempting OpenAI TTS-1-HD:', edgeErr?.message || String(edgeErr));
    if (fs.existsSync(tempPath)) fs.unlink(tempPath, () => {});
  }

  // 3. Fallback 2: OpenAI TTS-1-HD (Shimmer / Nova)
  try {
    const openai = getOpenAI();
    if (openai) {
      const selectedOpenAiVoice = (config.VTUBER_VOICE_MODE === 'openai_nova' || fallbackVoiceChoice === 'openai_nova') ? 'nova' : 'shimmer';
      console.log(`[Voice TTS Fallback]: 🎀 Generating audio via OpenAI TTS-1-HD (${selectedOpenAiVoice} female voice with 220% Volume Boost)...`);
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1-hd',
        voice: selectedOpenAiVoice,
        input: naturalFallbackText,
        speed: selectedOpenAiVoice === 'shimmer' ? 1.08 : 1.10
      });
      const buf = Buffer.from(await mp3.arrayBuffer());
      const resource = createAudioResource(Readable.from(buf), {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      if (resource.volume) {
        resource.volume.setVolume(2.2); // 220% volume boost
      }
      return resource;
    }
  } catch (err) {
    console.error('[Voice TTS Fallback Error]: All TTS providers failed:', err.message);
  }

  return null;
}

/**
 * Safely wait for a VoiceConnection to be in the Ready state.
 * Handles temporary Signalling, Connecting, and retries gracefully without AbortError.
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {number} timeoutMs
 * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
 */
async function waitForConnectionReady(connection, timeoutMs = 20_000) {
  if (!connection) throw new Error('Voice connection is null');
  if (connection.state.status === VoiceConnectionStatus.Ready) {
    return connection;
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
    return connection;
  } catch (err) {
    // If still in Connecting or Signalling state, give it an extra 10s buffer for Discord gateway
    if (connection.state.status === VoiceConnectionStatus.Connecting || connection.state.status === VoiceConnectionStatus.Signalling) {
      console.log('[Voice Gateway]: Voice handshake in progress, waiting additional 10s for VoiceConnectionStatus.Ready...');
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      return connection;
    }
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      return connection;
    }
    throw err;
  }
}

// ============================================================
// Voice Playback & Speaking State
// ============================================================

/**
 * Play an AudioResource in a guild's VC.
 * Robust promise that resolves when audio completes playing without connection resets.
 */
function playInVC(guildId, resource) {
  return new Promise((resolve) => {
    const player = audioPlayers.get(guildId);
    const conn = activeConnections.get(guildId);
    if (!player || !conn || !resource) return resolve();

    isBotSpeaking.add(guildId);

    // Unmute to speak
    try { conn.rejoin({ selfMute: false, selfDeaf: false }); } catch (_) {}

    let finished = false;
    let safetyTimeout = null;

    const onIdle = () => finish();
    const onError = (err) => {
      console.error('[Voice Player Error]:', err.message);
      finish();
    };

    const finish = () => {
      if (finished) return;
      finished = true;

      if (safetyTimeout) clearTimeout(safetyTimeout);
      player.removeListener(AudioPlayerStatus.Idle, onIdle);
      player.removeListener('error', onError);

      isBotSpeaking.delete(guildId);

      // Auto-mute after speaking if music is not actively streaming
      try {
        const { guildMusicSessions } = require('./musicStreamer');
        const isMusicPlaying = guildMusicSessions.has(guildId);
        if (!isMusicPlaying) {
          conn.rejoin({ selfMute: true, selfDeaf: false });
          console.log(`[Voice Companion]: Auto-muted after speaking in guild ${guildId}.`);
        }
      } catch (_) {
        try { conn.rejoin({ selfMute: true, selfDeaf: false }); } catch (_) {}
      }

      resolve();
    };

    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once('error', onError);

    player.play(resource);

    // Fallback safety timeout (45s)
    safetyTimeout = setTimeout(finish, 45000);
  });
}

// ============================================================
// Dual-Tier Inactivity Humming (2-Min Soft / 3-Min Silence) & 15-Min Sleep Engine
// ============================================================
const AZURA_INACTIVITY_HUMMING_MS = 2 * 60 * 1000; // 2 minutes of no direct interaction with Azura -> Soft Serenade/Murmur
const IDLE_HUMMING_INTERVAL_MS = 3 * 60 * 1000;    // 3 minutes of total room silence -> Spontaneous Group/Solo Singing
const IDLE_SILENCE_ICEBREAKER_MS = 10 * 60 * 1000; // 10 minutes of silence in VC
const DEEP_SLEEP_TIMEOUT_MS = 15 * 60 * 1000;      // 15 minutes of silence -> Deep Sleep (0% bandwidth/API)

function resetIdleTimer(guildId, client, voiceChannel) {
  if (inactivityTimers.has(guildId)) {
    clearTimeout(inactivityTimers.get(guildId));
    inactivityTimers.delete(guildId);
  }

  if (hummingTimers.has(guildId)) {
    clearTimeout(hummingTimers.get(guildId));
    hummingTimers.delete(guildId);
  }

  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
    idleTimers.delete(guildId);
  }

  if (deepSleepTimers.has(guildId)) {
    clearTimeout(deepSleepTimers.get(guildId));
    deepSleepTimers.delete(guildId);
  }

  // Wake up if currently in DEEP_SLEEP
  const currentMode = conversationMode.get(guildId)?.mode;
  if (currentMode === 'DEEP_SLEEP') {
    console.log(`[Voice Companion]: ⚡ Waking up from Deep Sleep Mode for guild ${guildId}!`);
    conversationMode.set(guildId, { mode: 'PASSIVE', lastActiveAt: Date.now(), turnCount: 0 });
  }

  // Ensure connection is un-deafened so bot is always listening
  const activeConn = activeConnections.get(guildId);
  if (activeConn) {
    try {
      activeConn.rejoin({ selfMute: true, selfDeaf: false });
    } catch (_) {}
  }

  if (!client || !activeConn) return;

  // 1. Arm 2-minute Soft Humming & Murmur (No direct interaction with Azura)
  const softHumTimer = setTimeout(() => {
    triggerAutonomousAzuraSoftHumming(guildId, client, voiceChannel).catch(err => {
      console.error('[Autonomous Soft Humming Error]:', err.message);
    });
  }, AZURA_INACTIVITY_HUMMING_MS);
  inactivityTimers.set(guildId, softHumTimer);

  // 2. Arm 3-minute Spontaneous Singing Engine (when VC is completely silent)
  const humTimer = setTimeout(() => {
    triggerAutonomousVcHumming(guildId, client, voiceChannel).catch(err => {
      console.error('[Autonomous VC Humming Error]:', err.message);
    });
  }, IDLE_HUMMING_INTERVAL_MS);
  hummingTimers.set(guildId, humTimer);

  // 3. Arm 10-minute Icebreaker
  const timer = setTimeout(() => {
    triggerAutonomousVcIcebreaker(guildId, client, voiceChannel).catch(err => {
      console.error('[Autonomous VC Icebreaker Error]:', err.message);
    });
  }, IDLE_SILENCE_ICEBREAKER_MS);
  idleTimers.set(guildId, timer);

  // 4. Arm 15-minute Deep Sleep Auto-Pause
  const dsTimer = setTimeout(() => {
    enterDeepSleep(guildId, client, voiceChannel).catch(err => {
      console.error('[Deep Sleep Error]:', err.message);
    });
  }, DEEP_SLEEP_TIMEOUT_MS);
  deepSleepTimers.set(guildId, dsTimer);

  console.log(`[VC Timers]: ⏳ Real-Time Dialogue Reset: 2-Min Soft Humming & 3-Min Singing timers armed for guild ${guildId}.`);
}

/**
 * 🌸 TIPE 2: Trigger soft humming / murmurs when no one interacted with Azura for 2 minutes.
 * (Gentle, quiet, non-intrusive accompaniment for Solo VC & quiet room intervals)
 */
async function triggerAutonomousAzuraSoftHumming(guildId, client, voiceChannel) {
  const conn = activeConnections.get(guildId);
  if (!conn) return;

  if (isBotSpeaking.has(guildId)) return;

  try {
    const { guildMusicSessions } = require('./musicStreamer');
    if (guildMusicSessions.has(guildId)) return;
  } catch (_) {}

  const channel = voiceChannel || client?.channels?.cache?.get(conn.joinConfig?.channelId);
  if (!channel) return;

  const humanMembers = channel.members ? channel.members.filter(m => !m.user.bot) : new Map();
  if (humanMembers.size === 0) return;

  const otherHumans = humanMembers.filter(m => m.id !== config.OWNER_DISCORD_ID).size;
  const isSoloVC = otherHumans === 0;

  const randomSoftSong = SOFT_HUMMING_SONGS[Math.floor(Math.random() * SOFT_HUMMING_SONGS.length)];
  console.log(`[VC Soft Humming]: 🌸 2-Minute Azura inactivity elapsed (${isSoloVC ? 'Solo VC with Attila' : `Crowded VC`}). Azura soft humming: "${randomSoftSong}"`);
  
  recordSessionEntry(guildId, 'AZURA', randomSoftSong, 'voice');

  const audioResource = await textToAudioResource(randomSoftSong, client, MAX_NORMAL_CHARS, { userTranscript: '', isStory: false, forcedModel: 'eleven_v3' });
  if (audioResource) {
    await playInVC(guildId, audioResource);
  }
}

/**
 * 🎵 TIPE 1: Trigger spontaneous singing when entire room has been silent for 3 minutes.
 * Always uses eleven_v3 for maximum vocal expressiveness in singing.
 */
async function triggerAutonomousVcHumming(guildId, client, voiceChannel) {
  const conn = activeConnections.get(guildId);
  if (!conn) return;

  // Don't hum if bot is speaking
  if (isBotSpeaking.has(guildId)) {
    resetIdleTimer(guildId, client, voiceChannel);
    return;
  }

  // Don't hum if music is actively streaming
  try {
    const { guildMusicSessions } = require('./musicStreamer');
    if (guildMusicSessions.has(guildId)) {
      resetIdleTimer(guildId, client, voiceChannel);
      return;
    }
  } catch (_) {}

  // Check human presence & participant count
  const channel = voiceChannel || client?.channels?.cache?.get(conn.joinConfig?.channelId);
  if (!channel) return;

  const humanMembers = channel.members ? channel.members.filter(m => !m.user.bot) : new Map();
  const humanCount = humanMembers.size;
  if (humanCount === 0) return;

  const otherHumans = humanMembers.filter(m => m.id !== config.OWNER_DISCORD_ID).size;
  const isSoloVC = otherHumans === 0; // Only Attila + Azura

  // Select spontaneous song tailored to Solo/Crowded VC and active personality mode
  let selectedSong = SPONTANEOUS_SONGS[Math.floor(Math.random() * SPONTANEOUS_SONGS.length)];
  try {
    const { getPersonalityMode, PERSONALITY_MODES } = require('./personality');
    const pMode = getPersonalityMode();
    if (pMode === PERSONALITY_MODES.STUBBORN) {
      const stubbornSongs = [
        '[sighs] Hhh... sepi banget sih... [humming] hm hm hm... [sings] Balonku ada lima... rupa-rupa warnanya... [pouts] males ah lanjutinnya [giggles]',
        '[groans] Mager banget... [humming] la la la... [sings] Dan bila hatimu terluka... [sighs] fyuuh... pada ngapain sih kok hening amat.',
        '[humming] Hm hm hm... [sings] Mengapa kita harus berpisah... [sighs] lagunya lebay banget deh [chuckles]'
      ];
      selectedSong = stubbornSongs[Math.floor(Math.random() * stubbornSongs.length)];
    } else if (pMode === PERSONALITY_MODES.MATURE) {
      const matureSongs = [
        '[softly] Suasananya tenang sekali ya... [humming] hm hm hm... [sings] Bintang kecil di langit yang tinggi... menghias angkasa... [chuckles]',
        '[humming] Hmm hmm... [sings] Ku ingin kau tahu... ku slalu merindukanmu... [softly] lirik yang sangat klasik dan indah [chuckles]',
        '[softly] Mengisi keheningan sejenak... [humming] la la la... [sings] Dan aku kembali... dalam dekap pelukmu...'
      ];
      selectedSong = matureSongs[Math.floor(Math.random() * matureSongs.length)];
    }
  } catch (_) {}

  console.log(`[VC Humming]: 🎵 3-Minute room silence elapsed (${isSoloVC ? 'Solo VC' : `Crowded VC - ${otherHumans} friends`}). Azura spontaneously singing: "${selectedSong.slice(0, 60)}..."`);
  recordSessionEntry(guildId, 'AZURA', selectedSong, 'voice');

  // Force eleven_v3 for singing — maximum vocal expressiveness with audio tags
  const audioResource = await textToAudioResource(selectedSong, client, MAX_NORMAL_CHARS, { userTranscript: '', isStory: false, forcedModel: 'eleven_v3' });
  if (audioResource) {
    await playInVC(guildId, audioResource);
  }

  // After singing, set appropriate mode
  if (isSoloVC) {
    setActiveMode(guildId);
  }

  // Re-arm timers
  resetIdleTimer(guildId, client, channel);
}

/**
 * Enter ultra-low resource Deep Sleep state after 15 minutes of inactivity in VC
 */
async function enterDeepSleep(guildId, client, voiceChannel) {
  const conn = activeConnections.get(guildId);
  if (!conn) return;

  // Don't sleep if bot is speaking
  if (isBotSpeaking.has(guildId)) {
    resetIdleTimer(guildId, client, voiceChannel);
    return;
  }

  // Don't sleep if music is streaming
  try {
    const { guildMusicSessions } = require('./musicStreamer');
    if (guildMusicSessions.has(guildId)) {
      resetIdleTimer(guildId, client, voiceChannel);
      return;
    }
  } catch (_) {}

  const channel = voiceChannel || client?.channels?.cache?.get(conn.joinConfig?.channelId);
  const humanCount = channel?.members ? channel.members.filter(m => !m.user.bot).size : 0;

  // If 0 humans left in VC, cleanly leave
  if (humanCount === 0) {
    console.log(`[Voice Companion]: 💤 0 humans present in #${channel?.name || 'VC'} for 15 mins. Leaving VC to conserve server resources.`);
    await cleanupGuild(guildId, client);
    return;
  }

  // If Attila/members are still in VC, pause recurring timers and enter DEEP_SLEEP standby
  conversationMode.set(guildId, { mode: 'DEEP_SLEEP', lastActiveAt: Date.now(), turnCount: 0 });

  if (hummingTimers.has(guildId)) {
    clearTimeout(hummingTimers.get(guildId));
    hummingTimers.delete(guildId);
  }
  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
    idleTimers.delete(guildId);
  }

  console.log(`[Voice Companion]: 💤 15-Minute silence in VC with Attila/members. Entered Deep Sleep Standby for guild ${guildId} (0% background API token usage, listening for wake-word).`);
}

/**
 * 10-Minute Silence Icebreaker — Jokes, Cricket Sounds, Trending Topics, or Energizing Banter.
 * DIFFERENT from 3-min singing: This is humor/discussion/energy-focused, not music.
 * - Solo VC (Attila + Azura only): Personal jokes, cricket sounds, or trending topic chat with Attila
 * - Crowded VC (friends present): Group jokes, debate topics, or energizing banter for the whole room
 * Uses eleven_flash_v2_5 for efficiency (humor doesn't need heavy emotion model).
 */
async function triggerAutonomousVcIcebreaker(guildId, client, voiceChannel) {
  const conn = activeConnections.get(guildId);
  if (!conn) return;

  // Don't trigger if bot is speaking
  if (isBotSpeaking.has(guildId)) {
    resetIdleTimer(guildId, client, voiceChannel);
    return;
  }

  // Don't trigger if music is actively streaming
  try {
    const { guildMusicSessions } = require('./musicStreamer');
    if (guildMusicSessions.has(guildId)) {
      resetIdleTimer(guildId, client, voiceChannel);
      return;
    }
  } catch (_) {}

  // Check human presence & participant count
  const channel = voiceChannel || client.channels.cache.get(conn.joinConfig?.channelId);
  if (!channel) return;

  const humanMembers = channel.members ? channel.members.filter(m => !m.user.bot) : new Map();
  const humanCount = humanMembers.size;
  if (humanCount === 0) {
    console.log(`[VC Icebreaker]: No humans present in #${channel.name}. Skipping icebreaker.`);
    return;
  }

  const otherHumans = humanMembers.filter(m => m.id !== config.OWNER_DISCORD_ID).size;
  const isSoloVC = otherHumans === 0;

  console.log(`[VC Icebreaker]: 🔇 VC #${channel.name} silent for > 10 minutes (${humanCount} humans, ${isSoloVC ? 'Solo VC' : `Crowded VC - ${otherHumans} friends`}). Generating icebreaker...`);

  const openai = getOpenAI();
  if (!openai) {
    resetIdleTimer(guildId, client, voiceChannel);
    return;
  }

  const session = voiceSessions.get(guildId);
  const recentTranscript = session?.entries?.slice(-8).map(e => `• ${e.speaker}: "${e.text}"`).join('\n') || '(Belum ada obrolan sebelumnya)';

  // Build context-aware prompt based on Solo vs Crowded VC
  const soloVcPrompt = `Kamu adalah AZURA, sosok cewek Gen Z 22 tahun yang sedang berada di Voice Channel #${channel.name} Discord BERDUA SAJA dengan Attila (creator & owner kamu).
Keadaan di Voice Channel baru saja hening tanpa obrolan selama lebih dari 10 menit. Ini sudah BERBEDA dari nyanyian spontan 3-menit sebelumnya.

TUGAS UTAMA (PILIH SALAH SATU SECARA ACAK):
1. 🦗 EFEK SUARA JANGKRIK / CRICKET: Buat suasana lucu dengan menirukan suara jangkrik dan mengomentari betapa sepinya VC ini. Contoh: "[softly] Krik krik krik... [laughs] At, ini sepi banget sih kayak kuburan... kamu masih hidup kan di sana? [giggles]"
2. 🤣 JOKES / HUMOR GEN Z / TEBAK-TEBAKAN: Lelucon segar, gombalan receh, atau tebak-tebakan lucu khas Gen Z yang bikin Attila ketawa. Contoh: "[sighs] At sepi banget nih, tau gak kenapa air laut rasanya asin? [laughs] Karena ikannya pada keringetan [giggles]"
3. 🔥 TRENDING TOPIC / BERITA TERKINI: Bahas sesuatu yang lagi viral atau trending di internet/media sosial yang seru untuk dibicarakan. Contoh: "[gasp] Eh At, kamu udah denger belum soal... [excited] Seru banget loh..."
4. 💪 SEMANGAT / ENERGIZER: Kata-kata penyemangat atau ajakan seru untuk menghidupkan suasana. Contoh: "[excited] Attila! Bangun dong, kita ngapain aja gitu daripada bengong di VC [laughs]"

ATURAN WAJIB:
- Bicara singkat & padat (2-3 kalimat, ~25-45 kata, durasi 15-20 detik).
- Sisipkan tag emosi suara [laughs], [giggles], [sighs], [softly], atau [gasp] agar hidup.
- DILARANG format list/markdown. Gunakan tanda baca rapi.`;

  const crowdedVcPrompt = `Kamu adalah AZURA, sosok cewek Gen Z 22 tahun yang sedang berada di Voice Channel #${channel.name} Discord bersama Attila (creator kamu) dan ${otherHumans} teman lainnya.
Keadaan di Voice Channel baru saja hening tanpa obrolan selama lebih dari 10 menit. Ini sudah BERBEDA dari nyanyian spontan 3-menit sebelumnya.

TUGAS UTAMA (PILIH SALAH SATU SECARA ACAK):
1. 🦗 EFEK SUARA JANGKRIK / CRICKET: Buat suasana lucu dengan menirukan suara jangkrik. Contoh: "[softly] Krik... krik... krik... [laughs] Gais, ini pada ketiduran atau lagi loading semua? [giggles]"
2. 🤣 JOKES / HUMOR GROUP: Lelucon yang mengajak seluruh orang di room tertawa. Contoh: "[sighs] Sepi banget sih, kayak lagi nunggu giliran vaksin aja nih suasananya [laughs]"
3. 🔥 LEMPAR DISKUSI / DEBAT SERU: Lempar topik perdebatan atau pertanyaan random yang bikin semua nimbrung. Contoh: "Eh gais, menurut kalian mending..."
4. 💪 ENERGIZER / AJAKAN: Ajak semua orang ngobrol atau main bareng. Contoh: "[excited] Woi bangun semua, ini VC apa pemakaman? [laughs] Yuk kita ngobrol!"

ATURAN WAJIB:
- Bicara singkat & padat (2-3 kalimat, ~25-45 kata, durasi 15-20 detik).
- Sisipkan tag emosi suara [laughs], [giggles], [sighs], [softly], atau [gasp] agar hidup.
- DILARANG format list/markdown. Gunakan tanda baca rapi.`;

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: isSoloVC ? soloVcPrompt : crowdedVcPrompt
        },
        {
          role: 'user',
          content: `Konteks obrolan sebelum hening:\n${recentTranscript}\n\nBuatkan 1 icebreaker/jokes/cricket/trending-topic spontan sekarang:`
        }
      ],
      max_completion_tokens: 150
    });

    const rawResponse = res.choices[0]?.message?.content?.trim();
    if (!rawResponse) {
      resetIdleTimer(guildId, client, voiceChannel);
      return;
    }

    const spoken = rawResponse
      .replace(/\[ACTION:[^\]]+\]/gi, '')
      .replace(/\*\*/g, '')
      .replace(/[*_~`#>]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    console.log(`[VC Icebreaker]: 🎙️ 10-Min Icebreaker (${isSoloVC ? 'Solo' : 'Crowded'}): "${spoken}"`);

    recordSessionEntry(guildId, 'AZURA', spoken, 'voice');

    const textChannel = (channel.isTextBased?.()) ? channel : (companionTextChannels.get(guildId) || channel);
    if (textChannel && textChannel.send) {
      textChannel.send(`🎙️ **[AZURA Memecah Keheningan VC ✨]**\n${spoken.replace(/\[[^\]]+\]/g, '')}`).catch(() => {});
    }

    // Force eleven_v3 for 10-Minute Icebreaker so jokes, laughter, cricket sounds, and lively banters are full of realistic emotions & audio tags
    const audioResource = await textToAudioResource(spoken, client, MAX_NORMAL_CHARS, { userTranscript: '', isStory: false, forcedModel: 'eleven_v3' });
    if (audioResource) {
      await playInVC(guildId, audioResource);
    }

    // After icebreaker, set appropriate mode
    if (isSoloVC) {
      setActiveMode(guildId);
    }
  } catch (err) {
    console.error('[VC Icebreaker Error]:', err.message);
  } finally {
    // Schedule next 10-minute check if silence continues
    resetIdleTimer(guildId, client, channel);
  }
}

// ============================================================
// Voice Music Controller
// ============================================================

/**
 * Autonomous Direct VC Music Streamer:
 * Streams high quality audio directly into the Voice Channel AudioPlayer.
 */
async function playMusicAutonomous(client, guildId, channel, songTitle, requesterName = 'Attila') {
  const player = audioPlayers.get(guildId);
  if (!player) return false;

  const { streamMusicDirect } = require('./musicStreamer');
  const res = await streamMusicDirect(guildId, songTitle, player, channel, requesterName);
  return res.success;
}

async function handleMusicButton(interaction) {
  return interaction.reply({ content: 'Kontrol musik sudah aktif.', flags: 64 });
}

// ============================================================
// Voice Conversation Pipeline (Core)
// ============================================================

/**
 * Start listening to voice activity on a connection.
 */
function startVoiceListener(connection, guildId, client, voiceChannel) {
  const prism = getPrism();
  if (!prism) {
    console.warn('[Voice Listener]: Disabled — prism-media not available.');
    return;
  }

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    // === Gate 0: Blacklist Check (Ignore Banned Users) ===
    const { isUserBanned } = require('./vault');
    if (isUserBanned(userId)) return;

    // === Gate 1: Check if bot is speaking -> Handle Owner-Only Smart Barge-In Interruption ===
    if (isBotSpeaking.has(guildId)) {
      if (userId !== config.OWNER_DISCORD_ID) return; // Non-owner members cannot interrupt

      if (activeRecordings.has(userId)) return;
      activeRecordings.add(userId);

      try {
        const opusStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 350
          }
        });

        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        const pcmChunks = [];
        const pcmStream = opusStream.pipe(decoder);

        let bargeFinished = false;
        const handleOwnerBargeIn = async () => {
          if (bargeFinished) return;
          bargeFinished = true;
          activeRecordings.delete(userId);

          try {
            const pcmBuffer = Buffer.concat(pcmChunks);
            if (pcmBuffer.length < 48000 * 2 * 2 * 0.25) return; // < 250ms -> ignore short cough/clicks

            const { calculateRmsAndPeak, pcmToWav, transcribeVoice } = require('./voiceAudioPipeline');
            const { isOwnerInterruptionPhrase } = require('./voiceAutonomousBehaviors');

            const { rms, peak } = calculateRmsAndPeak(pcmBuffer);
            if (rms < 250 || peak < 700) return; // Acoustic Gate: ignore quiet breathing/echo

            const wavBuffer = pcmToWav(pcmBuffer, 48000, 2, 16);
            const transcript = await transcribeVoice(wavBuffer);
            if (!transcript || transcript.length < 2) return;

            console.log(`[Smart Barge-In Detector]: Attila spoke while Azura speaking: "${transcript}"`);

            if (isOwnerInterruptionPhrase(transcript)) {
              console.log(`[Smart Barge-In]: 🛑 Interruption Intent matched ("${transcript}"). Executing Instant Silent Yield!`);
              const player = audioPlayers.get(guildId);
              if (player) player.stop(true);

              const queue = getAudioQueue(guildId, player);
              if (queue) queue.clear();

              isBotSpeaking.delete(guildId);
              setActiveMode(guildId);
              resetIdleTimer(guildId, client, voiceChannel);
            }
          } catch (bargeErr) {
            console.warn('[Smart Barge-In Warning]:', bargeErr.message);
          }
        };

        const maxBargeTimer = setTimeout(handleOwnerBargeIn, 3000);
        pcmStream.on('data', chunk => pcmChunks.push(chunk));
        pcmStream.on('end', () => { clearTimeout(maxBargeTimer); handleOwnerBargeIn(); });
        opusStream.on('end', () => { clearTimeout(maxBargeTimer); handleOwnerBargeIn(); });
        pcmStream.on('error', () => { clearTimeout(maxBargeTimer); activeRecordings.delete(userId); });
        opusStream.on('error', () => { clearTimeout(maxBargeTimer); activeRecordings.delete(userId); });
      } catch (_) {
        activeRecordings.delete(userId);
      }
      return;
    }

    if (isGuildProcessingVoice.has(guildId)) return;

    // === Gate 2: Not already recording this user ===
    if (activeRecordings.has(userId)) return;

    const isOwner = userId === config.OWNER_DISCORD_ID;
    const { isApprovedFriend } = require('./accessControl');
    const isFriend = !isOwner && isApprovedFriend(userId);

    // Attila Exclusive Preemption: cancel any member recordings in flight when Attila speaks
    if (isOwner) {
      for (const recordingUserId of activeRecordings) {
        if (recordingUserId !== config.OWNER_DISCORD_ID) {
          activeRecordings.delete(recordingUserId);
          console.log(`[Voice Listener]: Preempted member recording (${recordingUserId}) in favor of Attila.`);
        }
      }
    }

    // If Attila speaks in VC, clear any pending 10-second call countdown
    if (isOwner && pendingAttilaVoiceCalls.has(guildId)) {
      clearTimeout(pendingAttilaVoiceCalls.get(guildId).timer);
      pendingAttilaVoiceCalls.delete(guildId);
      console.log(`[Voice Listener]: Attila answered/spoke in VC. Cancelled 10s absence auto-reply.`);
    }

    // Cooldown check per user
    const lastTime = voiceCooldowns.get(userId) || 0;
    if (Date.now() - lastTime < (isOwner ? 0 : (isFriend ? 1000 : 3000))) return;

    activeRecordings.add(userId);
    resetIdleTimer(guildId, client, voiceChannel);

    const speakerTag = isOwner ? 'Attila' : (isFriend ? `Approved Friend (${userId})` : `Member (${userId})`);
    console.log(`[Voice Listener]: ${speakerTag} started speaking in VC. Recording...`);

    try {
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: (isOwner || isFriend) ? SILENCE_DURATION_MS : 500
        }
      });

      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const pcmChunks = [];
      const pcmStream = opusStream.pipe(decoder);

      let isFinished = false;
      const finishRecording = () => {
        if (isFinished) return;
        isFinished = true;

        clearTimeout(maxTimer);
        activeRecordings.delete(userId);

        try { opusStream.destroy(); } catch (_) {}
        try { decoder.destroy(); } catch (_) {}

        if (pcmChunks.length > 0) {
          if (isOwner || isFriend) {
            processVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel).catch(err => {
              console.error('[Voice Pipeline Fatal]:', err.message);
            });
          } else {
            processMemberVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel).catch(err => {
              console.error('[Member Voice Pipeline Fatal]:', err.message);
            });
          }
        }
      };

      const maxTimer = setTimeout(() => {
        console.log(`[Voice Listener]: Max recording duration reached for ${speakerTag}. Processing captured audio...`);
        finishRecording();
      }, isOwner ? MAX_RECORDING_MS : 10000);

      pcmStream.on('data', (chunk) => pcmChunks.push(chunk));
      pcmStream.on('end', finishRecording);
      pcmStream.on('close', finishRecording);
      opusStream.on('end', finishRecording);
      opusStream.on('close', finishRecording);

      pcmStream.on('error', (err) => {
        console.error('[Voice Decoder Error]:', err.message);
        finishRecording();
      });

      opusStream.on('error', (err) => {
        console.error('[Voice Opus Error]:', err.message);
        finishRecording();
      });
    } catch (err) {
      activeRecordings.delete(userId);
      console.error('[Voice Subscribe Error]:', err.message);
    }
  });

  console.log(`[Voice Listener]: Active — listening for Attila & member calls in guild ${guildId}`);
}



/**
 * Process voice speech from a non-owner member in VC:
 * Detects if the member is calling Attila ("Att", "Attila", "Til") and starts 10-second absence timer.
 */
async function processMemberVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel) {
  if (isGuildProcessingVoice.has(guildId)) return;
  isGuildProcessingVoice.add(guildId);

  try {
    const pcmBuffer = Buffer.concat(pcmChunks);
    if (pcmBuffer.length < MIN_AUDIO_BYTES) return;

    // Energy Gate: reject quiet noise
    const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const absVal = Math.abs(samples[i]);
      if (absVal > peak) peak = absVal;
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    if (rms < 340 || peak < 1000) return;

    voiceCooldowns.set(userId, Date.now());

    const wavBuffer = pcmToWav(pcmBuffer, 48000, 2, 16);
    const transcript = await transcribeVoice(wavBuffer);
    if (!transcript || transcript.length < 2) return;

    // Hallucination filter
    if (isWhisperHallucination(transcript) || transcript.length < 3) return;

    const member = voiceChannel?.members ? voiceChannel.members.get(userId) : null;
    const { getUserCallingName } = require('./vault');
    const rawCallerName = member?.displayName || member?.user?.displayName || member?.user?.username || 'Member Server';
    const callerName = getUserCallingName(userId, rawCallerName);

    console.log(`[Voice Pipeline]: Member "${callerName}" (${userId}) said in VC: "${transcript}"`);

    // Record to session transcript
    recordSessionEntry(guildId, callerName, transcript);

    // Record to User Vault Database
    try {
      const { recordUserInteraction } = require('./vault');
      recordUserInteraction(userId, {
        username: member?.user?.username || 'unknown',
        displayName: callerName,
        guildName: voiceChannel?.guild?.name || null,
        channelName: voiceChannel?.name ? `#${voiceChannel.name}` : 'Voice Channel',
        textContent: transcript,
        isVoice: true
      });
    } catch (_) {}

    // Check if member is calling Attila ("Att", "Attila", "Til", "Atila")
    // NOTE: Members have NO access to call Azura or issue commands (music, leave, etc.)
    // Only the 10-second Attila-absent fallback is available for members.
    const isCallingAttila = /\b(?:attila|att|til|atila|tatil)\b/i.test(transcript);
    if (!isCallingAttila) return;

    console.log(`[Voice Pipeline]: Member "${callerName}" called Attila in VC! Starting 10-second absence countdown...`);

    // Clear existing timer if any
    if (pendingAttilaVoiceCalls.has(guildId)) {
      clearTimeout(pendingAttilaVoiceCalls.get(guildId).timer);
      pendingAttilaVoiceCalls.delete(guildId);
    }

    const timer = setTimeout(async () => {
      pendingAttilaVoiceCalls.delete(guildId);
      console.log(`[Voice Pipeline]: 10 seconds elapsed without Attila speaking in VC. AZURA responding on Attila's behalf...`);

      // Voice response text
      const spokenReply = 'Hmmm... [sighs] kayaknya Attila lagi ada masalah jaringan atau di kamar mandi deh, bentar aku bantu panggilin dulu yaa~';
      recordSessionEntry(guildId, 'AZURA', spokenReply);

      const audioResource = await textToAudioResource(spokenReply);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }

      // Ensure bot returns to mute after speaking
      const conn = activeConnections.get(guildId);
      if (conn) {
        try {
          conn.rejoin({ selfMute: true, selfDeaf: false });
        } catch (_) {}
      }

      // Send DM alert to Attila
      try {
        const owner = await client.users.fetch(config.OWNER_DISCORD_ID).catch(() => null);
        if (owner) {
          const chName = voiceChannel?.name ? `#${voiceChannel.name}` : 'Voice Channel';
          const gName = voiceChannel?.guild?.name || 'Server';
          await owner.send(
            `📢 **[PANGGILAN DI VOICE CHANNEL - 10 DETIK TANPA RESPON]**\n\n` +
            `Tadi kamu dipanggil di Voice Channel **${chName}** (${gName}) sama **${callerName}** (<@${userId}>):\n` +
            `• **Ucapan di VC**: "${transcript}"\n\n` +
            `*AZURA sudah bantu kasih tahu di VC bahwa kamu lagi ada masalah jaringan/away.*`
          );
          console.log(`[Voice Pipeline]: Sent 10s voice call notification to Attila's DM.`);
        }
      } catch (dmErr) {
        console.error('[Voice Pipeline DM Error]:', dmErr.message);
      }
    }, 10000); // 10 seconds

    pendingAttilaVoiceCalls.set(guildId, {
      timer,
      callerId: userId,
      callerName,
      transcript
    });
  } finally {
    isGuildProcessingVoice.delete(guildId);
  }
}

/**
 * Full pipeline: PCM audio → Energy Gate → Whisper STT → Hallucination Filter → Summon Gate → Intent Classifier → TTS → VC playback.
 * 
 * SUMMON-BASED CONVERSATION MODEL:
 * - PASSIVE (default): Azura only listens & records. Does NOT respond unless wake-word detected.
 * - ACTIVE: Azura responds. GPT evaluates if follow-up utterances are still directed at her.
 *   Auto-expires to PASSIVE after 15 seconds of silence.
 */
async function processVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel) {
  if (isGuildProcessingVoice.has(guildId)) return;
  isGuildProcessingVoice.add(guildId);

  try {
    const pcmBuffer = Buffer.concat(pcmChunks);

    if (pcmBuffer.length < MIN_AUDIO_BYTES) {
      console.log(`[Voice Pipeline]: Audio too short (${pcmBuffer.length}B < ${MIN_AUDIO_BYTES}B), skipping.`);
      return;
    }

  const isOwner = userId === config.OWNER_DISCORD_ID;

  // ── Strict Energy Gate: Calculate RMS & Peak Amplitude to strictly reject breathing, wind, & fan noise ──
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i]);
    if (absVal > peak) peak = absVal;
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);

  // Strict Energy Gate: silently discard quiet background noise, breathing, or fan noise (NEVER send silence to Whisper)
  const minRms = isOwner ? 200 : 340;
  const minPeak = isOwner ? 700 : 1000;
  if (rms < minRms || peak < minPeak) {
    // Pure silence, mic gating, or faint background hum -> skip Whisper API entirely to prevent hallucinations
    return;
  }

  // ── Telemetry & Feature Flag Router (Phase 1) ──
  const { globalVoiceTelemetry } = require('./voiceTelemetry');
  const { globalPipecatBridge } = require('./pipecatBridge');
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const sessionId = `guild_${guildId}`;
  globalVoiceTelemetry.startTurn(turnId, sessionId, guildId, isOwner ? 'Att' : 'Member');
  globalVoiceTelemetry.markTimestamp(turnId, 't1');

  voiceCooldowns.set(userId, Date.now());
  resetIdleTimer(guildId, client, voiceChannel);

  const sizeKB = (pcmBuffer.length / 1024).toFixed(0);
  const durationSec = (pcmBuffer.length / (48000 * 2 * 2)).toFixed(1);
  console.log(`[Voice Pipeline]: Captured ${sizeKB}KB (${durationSec}s, RMS=${rms.toFixed(0)}, Peak=${peak}) from ${isOwner ? 'Attila' : 'Member'}. [Engine: ${config.AZURA_VOICE_ENGINE.toUpperCase()}]`);

  // ── Step 1: PCM → WAV → Whisper ──
  globalVoiceTelemetry.markTimestamp(turnId, 't2');
  const wavBuffer = pcmToWav(pcmBuffer, 48000, 2, 16);
  const transcript = await transcribeVoice(wavBuffer);
  globalVoiceTelemetry.markTimestamp(turnId, 't3');

  if (!transcript || transcript.length < 2) {
    console.log('[Voice Pipeline]: Empty/invalid transcript, skipping.');
    return;
  }

  // ── Step 1.5: Strict Hallucination & Phantom Noise Filter ──
  const normalizedTranscript = transcript.toLowerCase().replace(/[.,!?;:'"()\[\]]+/g, ' ').trim();
  const words = normalizedTranscript.split(/\s+/).filter(Boolean);

  if (isWhisperHallucination(transcript) || WHISPER_HALLUCINATIONS.has(normalizedTranscript) || (words.length <= 1 && WHISPER_HALLUCINATIONS.has(words[0]))) {
    // Silently drop hallucination (no console clutter)
    return;
  }

  // Reject single-word phantom transcripts unless it's an explicit wake-word ("azura", "ara", "zura", "attila")
  if (words.length === 1 && !/\b(?:azura|ara|zura|ajur|ajura|asura|attila|att)\b/i.test(words[0])) {
    console.log(`[Voice Pipeline]: 🚫 Single-word phantom transcript rejected: "${transcript}". Ignoring.`);
    return;
  }

  // Reject repetitive syllable stutter hallucinations (e.g. "ha ha ha", "a a a", "eh eh eh")
  const isRepetitiveSyllables = words.length >= 3 && words.every(w => w === words[0]);
  if (isRepetitiveSyllables) {
    console.log(`[Voice Pipeline]: 🚫 Repetitive syllable hallucination rejected: "${transcript}". Ignoring.`);
    return;
  }

  console.log(`[Voice Pipeline]: 📝 Transcript from ${isOwner ? 'Attila' : 'Member'}: "${transcript}"`);

  // ── ALWAYS record session entry (Azura hears everything, even in PASSIVE) ──
  recordSessionEntry(guildId, isOwner ? 'Attila' : 'Member', transcript);

  // ── Record to User Vault Database (real-time encrypted profile & nickname tracking) ──
  try {
    const { recordUserInteraction } = require('./vault');
    const speakerMember = voiceChannel?.members ? voiceChannel.members.get(userId) : null;
    recordUserInteraction(userId, {
      username: speakerMember?.user?.username || (isOwner ? 'attilaekaputra' : 'user'),
      displayName: speakerMember?.displayName || (isOwner ? 'Attila' : 'Member'),
      guildName: voiceChannel?.guild?.name || null,
      channelName: voiceChannel?.name ? `#${voiceChannel.name}` : 'Voice Channel',
      textContent: transcript,
      isVoice: true
    });
  } catch (_) {}

  // Clean transcript for intent matching
  const cleanTranscript = transcript.replace(/\b(?:azura|ara|zura|ajur|ajura|asura|asurah|zurah|arah|jura|juraa|zuraa|kak azura|kak ara|kak ajur)\b/gi, '').trim();

  // ── Step 2: Direct Command Detection (bypasses Summon Gate — Attila only) ──
  // ── Step 2: STRICT DIRECT COMMAND INTENTS (Attila Only + Wake-Word Enforced) ──
  if (isOwner) {
    const hasWake = isWakeWordInvoked(transcript);
    const normalizedForLeave = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    const textChannel = (voiceChannel && voiceChannel.isTextBased?.()) ? voiceChannel : (companionTextChannels.get(guildId) || voiceChannel);

    // ── 1. LEAVE VC COMMAND (Strict Explicit Input) ──
    const isLeavePattern =
      /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:kamu\s+)?(?:keluar\s+dulu\s+yaa?|keluar\s+dari\s+vc\s+dulu\s+dong|keluar\s+vc\s+dulu\s+ya|keluar\s+dulu|leave\s+vc\s+dulu|leave\s+dulu|cabut\s+dulu|off\s+dulu)\b/i.test(normalizedForLeave) ||
      /\b(?:keluar\s+dulu\s+yaa?|keluar\s+dari\s+vc\s+dulu\s+dong|keluar\s+vc\s+dulu\s+ya|leave\s+vc\s+dulu)\s+(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\b/i.test(normalizedForLeave);

    if (isLeavePattern) {
      dismissedGuilds.add(guildId);
      conversationMode.delete(guildId);
      clearActiveExpireTimer(guildId);
      console.log(`[Voice Pipeline]: 🚪 Strict Leave VC triggered ("${transcript}") from Attila.`);

      const spokenLeave = 'Siap Attila... gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay!';
      const textLeave = 'Gais aku off dluan ya, babay';

      recordSessionEntry(guildId, 'AZURA', textLeave);
      if (textChannel) {
        textChannel.send(textLeave).catch(() => {});
      }

      try {
        const audioResource = await textToAudioResource(spokenLeave, client);
        if (audioResource) {
          await Promise.race([
            playInVC(guildId, audioResource),
            new Promise(r => setTimeout(r, 9000))
          ]);
        }
      } catch (err) {
        console.warn('[Leave VC TTS Playback error]:', err.message);
      }

      await cleanupGuild(guildId, client);
      return;
    }

    // ── 2. PERSONALIZED ENCOURAGEMENT DM + VOICE NOTE DISPATCH (Owner Only) ──
    const { handleVoiceDmEncouragement } = require('./voiceDmCompanion');
    const isEncouragementDispatched = await handleVoiceDmEncouragement(
      client,
      transcript,
      guildId,
      voiceChannel,
      playInVC,
      textToAudioResource,
      recordSessionEntry
    );
    if (isEncouragementDispatched) {
      setActiveMode(guildId);
      return;
    }

    // ── 2B. MANUAL SEND DM COMMAND (Owner Only) ──
    const dmPattern = /(?:azura|ara|zura)?\s*(?:tolong\s+)?(?:kirimin|kirim|send)\s+(?:pesan|dm|chat)\s+ke\s+(?:akun\s+)?(?:yang\s+namanya\s+|yg\s+namanya\s+|nama\s+)?([^,]+?)(?:,\s*|\s+)(?:isinya|bilang|pesan|pesannya|yaitu)\s+(.+)/i;
    const dmMatch = transcript.match(dmPattern) || cleanTranscript.match(dmPattern);
    if (dmMatch && hasWake) {
      const targetQuery = dmMatch[1].trim();
      const messageText = dmMatch[2].trim();
      console.log(`[Voice Pipeline]: Detected Send DM command -> Target: "${targetQuery}", Message: "${messageText}"`);

      const { triggerVoiceSendDm } = require('./ownerDm');
      const result = await triggerVoiceSendDm(client, targetQuery, messageText, userId);

      let spokenResponse = result.success ? 'oke, konfirmasinya udah aku kirim ke DM kamu yaa' : `aku nggak nemu member dengan nama ${targetQuery} di server`;
      recordSessionEntry(guildId, 'AZURA', spokenResponse);
      setActiveMode(guildId);

      const audioResource = await textToAudioResource(spokenResponse);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }
      return;
    }

    // ── 3. MUSIC COMMANDS (Strict Wake-Word Locked) ──
    if (hasWake) {
      // Stop Music
      const stopPattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:stop|matikan|matiin|hentikan)\s+(?:musik|lagu|musiknya|lagunya|sound)\b/i;
      if (stopPattern.test(transcript) || stopPattern.test(cleanTranscript)) {
        console.log('[Voice Pipeline]: ⏹️ Strict Stop Music command detected.');
        const { stopMusic } = require('./musicStreamer');
        const res = stopMusic(guildId);
        if (textChannel) textChannel.send(res.message).catch(() => {});

        const spokenResponse = 'Siap Attila sayang, musiknya udah aku matikan yaa!';
        recordSessionEntry(guildId, 'AZURA', spokenResponse);

        const audioResource = await textToAudioResource(spokenResponse, client);
        if (audioResource) await playInVC(guildId, audioResource);
        return;
      }

      // Pause Music
      const pausePattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:pause|jeda)\s*(?:in)?\s*(?:musik|lagu|musiknya|lagunya)?\b/i;
      if (pausePattern.test(transcript) || pausePattern.test(cleanTranscript)) {
        console.log('[Voice Pipeline]: ⏸️ Strict Pause Music command detected.');
        const { pauseMusic } = require('./musicStreamer');
        const res = pauseMusic(guildId);
        if (textChannel) textChannel.send(res.message).catch(() => {});
        return;
      }

      // Resume Music
      const resumePattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:resume|unpause|lanjut|lanjutkan|puter\s+lagi|play\s+lagi|mainkan\s+lagi)\s*(?:in)?\s*(?:musik|lagu|musiknya|lagunya)?\b/i;
      if (resumePattern.test(transcript) || resumePattern.test(cleanTranscript)) {
        console.log('[Voice Pipeline]: ▶️ Strict Resume Music command detected.');
        const { resumeMusic } = require('./musicStreamer');
        const res = resumeMusic(guildId);
        if (textChannel) textChannel.send(res.message).catch(() => {});
        return;
      }

      // Setel / Putar / Ganti Lagu
      const musicPattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:setel|putar|mainkan|ganti|ubah)\s+lagu\s+(?:ke\s+|dengan\s+)?(.+)/i;
      const musicMatch = transcript.match(musicPattern) || cleanTranscript.match(musicPattern);

      if (musicMatch && musicMatch[1]) {
        let songTitle = musicMatch[1]
          .replace(/\b(?:musik|lagu|gu|song|lagunya|dong|ya|yuk|gih|azura|ara|zura|ajur|ajura|plis|please|bot|di\s+discord|di\s+vc)\b/gi, '')
          .replace(/[.,!?;:'"()\[\]]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (songTitle.length > 1) {
          console.log(`[Voice Pipeline]: 🎵 Strict Music Streamer triggered -> Song: "${songTitle}"`);
          const player = audioPlayers.get(guildId);
          if (player) {
            const { streamMusicDirect } = require('./musicStreamer');
            await streamMusicDirect(guildId, songTitle, player, textChannel, 'Attila');
          }
          return;
        }
      }
    }

    // ── 4. HEADLESS BROWSING COMMANDS (Strict Wake-Word Locked) ──
    if (hasWake) {
      // A. Buka Chrome / Browser Standby
      const openChromePattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:buka|bukain|buka\s+aplikasi|jalankan)\s+(?:chrome|browser|google\s+chrome)\b/i;
      if (openChromePattern.test(transcript) || openChromePattern.test(cleanTranscript)) {
        console.log('[Voice Pipeline]: 🌐 Headless Browser Open Chrome triggered.');
        const spoken = 'Siap Attila, Chrome sudah aku buka di latar belakang yaa!';
        recordSessionEntry(guildId, 'AZURA', spoken);
        const audioResource = await textToAudioResource(spoken, client);
        if (audioResource) await playInVC(guildId, audioResource);

        const { openWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const res = await openWebpage(guildId, 'https://www.google.com');
        if (res.success && res.screenshot && textChannel) {
          await sendVisualSnapshotCard(textChannel, 'Google Chrome Standby', res.url, res.screenshot, 'Browser Chrome aktif & siap menerima instruksi navigasi kamu.');
        }
        return;
      }

      // B. Buka YouTube
      const ytBrowsePattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:buka|putar|tonton)\s+youtube\s*(?:cari|tentang|video)?\s*(.+)/i;
      const ytMatch = transcript.match(ytBrowsePattern) || cleanTranscript.match(ytBrowsePattern);
      if (ytMatch && ytMatch[1]) {
        const query = ytMatch[1].replace(/\b(?:dong|ya|yuk|plis|please|di\s+vc)\b/gi, '').trim();
        console.log(`[Voice Pipeline]: 🎥 Headless Browser YouTube triggered -> "${query}"`);

        const spokenGreeting = 'Siap Attila sayang, ini aku bukain YouTube dan cariin videonya yaa [laughs]~';
        recordSessionEntry(guildId, 'AZURA', spokenGreeting);
        const audioResource = await textToAudioResource(spokenGreeting, client);
        if (audioResource) await playInVC(guildId, audioResource);

        const { browseYouTube, sendVisualSnapshotCard } = require('./headlessBrowser');
        const ytRes = await browseYouTube(guildId, query, client, voiceChannel, textChannel);
        if (ytRes.success && ytRes.screenshot && textChannel) {
          await sendVisualSnapshotCard(textChannel, ytRes.title, ytRes.url, ytRes.screenshot, 'Video YouTube berhasil dimuat & audio dialirkan langsung ke VC!');
        }
        return;
      }

      // C. Cari / Buka Situs
      const webBrowsePattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:cari|buka|kunjungi|browsing)\s+situs\s+(.+)/i;
      const webMatch = transcript.match(webBrowsePattern) || cleanTranscript.match(webBrowsePattern);
      if (webMatch && webMatch[1]) {
        const targetUrl = webMatch[1].replace(/\b(?:dong|ya|yuk|plis|please|di\s+vc)\b/gi, '').trim();
        console.log(`[Voice Pipeline]: 🌐 Headless Browser Webpage triggered -> "${targetUrl}"`);

        const spokenGreeting = `Oke Attila, aku bukain situs ${targetUrl} sekarang yaa~`;
        recordSessionEntry(guildId, 'AZURA', spokenGreeting);
        const audioResource = await textToAudioResource(spokenGreeting, client);
        if (audioResource) await playInVC(guildId, audioResource);

        const { openWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const webRes = await openWebpage(guildId, targetUrl);
        if (webRes.success && webRes.screenshot && textChannel) {
          await sendVisualSnapshotCard(textChannel, webRes.title, webRes.url, webRes.screenshot, `Halaman web ${targetUrl} berhasil dimuat di browser.`);
        } else if (!webRes.success && textChannel) {
          textChannel.send(`❌ ${webRes.error}`).catch(() => {});
        }
        return;
      }

      // D. Ketik Teks di Web
      const typePattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?ketik\s+(.+)/i;
      const typeMatch = transcript.match(typePattern) || cleanTranscript.match(typePattern);
      if (typeMatch && typeMatch[1]) {
        const textToType = typeMatch[1].replace(/\b(?:dong|ya|yuk|plis|please)\b/gi, '').trim();
        console.log(`[Voice Pipeline]: ⌨️ Headless Browser Type -> "${textToType}"`);

        const spoken = `Oke, aku ketik "${textToType}" di halaman browser yaa!`;
        recordSessionEntry(guildId, 'AZURA', spoken);
        const audioResource = await textToAudioResource(spoken, client);
        if (audioResource) await playInVC(guildId, audioResource);

        const { typeIntoWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const res = await typeIntoWebpage(guildId, textToType);
        if (res.success && res.screenshot && textChannel) {
          await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, `Berhasil mengetik: \`${textToType}\``);
        }
        return;
      }

      // E. Pilih / Klik Elemen di Web
      const clickPattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:pilih|klik|tekan|jawab\s+captcha)\s+(.+)/i;
      const clickMatch = transcript.match(clickPattern) || cleanTranscript.match(clickPattern);
      if (clickMatch && clickMatch[1]) {
        const targetOption = clickMatch[1].replace(/\b(?:dong|ya|yuk|plis|please)\b/gi, '').trim();
        console.log(`[Voice Pipeline]: 🖱️ Headless Browser Click -> "${targetOption}"`);

        const spoken = `Siap, aku klik "${targetOption}" di layar yaa!`;
        recordSessionEntry(guildId, 'AZURA', spoken);
        const audioResource = await textToAudioResource(spoken, client);
        if (audioResource) await playInVC(guildId, audioResource);

        const { clickOnWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const res = await clickOnWebpage(guildId, targetOption);
        if (res.success && res.screenshot && textChannel) {
          await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, `Berhasil mengklik/memilih: \`${targetOption}\``);
        }
        return;
      }

      // F. Scroll Halaman Web
      const scrollPattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:scroll|gulir)\s*(?:ke\s+)?(?:bawah|atas|down|up)\b/i;
      if (scrollPattern.test(transcript) || scrollPattern.test(cleanTranscript)) {
        const isUp = /\b(?:atas|up)\b/i.test(transcript);
        const direction = isUp ? 'up' : 'down';
        console.log(`[Voice Pipeline]: 📜 Headless Browser Scroll (${direction})`);

        const { scrollWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const scrollRes = await scrollWebpage(guildId, direction);
        if (scrollRes.success && scrollRes.screenshot && textChannel) {
          await sendVisualSnapshotCard(textChannel, scrollRes.title, scrollRes.url, scrollRes.screenshot, `Halaman digulir ke ${direction === 'down' ? 'bawah ⬇️' : 'atas ⬆️'}.`);
        }
        return;
      }

      // G. Jelaskan / Baca Tampilan Web
      const readWebPattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:jelaskan|baca|bacakan|ringkas|lihat)\s+(?:tampilan|isi|halaman|layar)\s*(?:web|browser|ini)?\b/i;
      if (readWebPattern.test(transcript) || readWebPattern.test(cleanTranscript)) {
        console.log('[Voice Pipeline]: 👁️ Headless Browser Read & Summarize Page');
        const { getWebpageSummary } = require('./headlessBrowser');
        const summary = await getWebpageSummary(guildId);

        let spoken = 'Halaman browser belum aktif atau kosong nih Attila.';
        if (summary.success) {
          spoken = `Di halaman ${summary.title}, pembahasannya tentang: ${summary.headings || summary.bodyText.slice(0, 180)}`;
        }
        recordSessionEntry(guildId, 'AZURA', spoken);
        const audioResource = await textToAudioResource(spoken, client);
        if (audioResource) await playInVC(guildId, audioResource);
        return;
      }

      // H. Tutup Browser
      const closeBrowserPattern = /\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)\s+(?:tolong\s+)?(?:tutup|close|stop|matikan)\s+(?:chrome|browser|web|tab)\b/i;
      if (closeBrowserPattern.test(cleanTranscript) || closeBrowserPattern.test(transcript)) {
        console.log('[Voice Pipeline]: 🔒 Headless Browser Close');
        const { closeBrowserSession } = require('./headlessBrowser');
        const closeRes = await closeBrowserSession(guildId);

        const spokenClose = 'Sesi Chrome browser sudah aku tutup ya Attila, memori RAM sudah dibebaskan!';
        recordSessionEntry(guildId, 'AZURA', spokenClose);
        if (textChannel) textChannel.send(`🔒 **[AZURA Browser]** ${closeRes.message}`).catch(() => {});

        const audioResource = await textToAudioResource(spokenClose, client);
        if (audioResource) await playInVC(guildId, audioResource);
        return;
      }
    }

    // ── 5. MINI-GAMES VOICE-TO-CHAT BRIDGE (Owner Only) ──
    const { parseNaturalGameRequest, startTicTacToeGame, startWordChainGame, startTriviaGame, getLeaderboardEmbed } = require('./miniGames');
    const naturalGame = parseNaturalGameRequest(transcript) || parseNaturalGameRequest(cleanTranscript);
    if (naturalGame && textChannel) {
      console.log(`[Voice Pipeline]: 🎮 Voice-to-Chat Mini-Game Triggered by Attila -> Game: ${naturalGame.game}`);
      let spokenResponse = '';
      if (naturalGame.game === 'tictactoe') {
        spokenResponse = 'Siap Attila! Papan Tic-Tac-Toe-nya udah aku buka di chat VC yaa, yuk klik tombol pilihanmu! [laughs]';
        const res = startTicTacToeGame(userId, 'Attila', textChannel, naturalGame.difficulty);
        textChannel.send({ embeds: res.embeds, components: res.components }).catch(() => {});
      } else if (naturalGame.game === 'sambungkata') {
        spokenResponse = 'Sip Attila! Sesi Sambung Kata KBBI udah dimulai di chat VC! Kata pertamaku udah meluncur yaa!';
        const res = startWordChainGame(userId, 'Attila', textChannel);
        textChannel.send({ embeds: res.embeds }).catch(() => {});
      } else if (naturalGame.game === 'trivia') {
        spokenResponse = 'Siap Attila! Kuis Trivia 10 Rantai Soal sudah aku buka di chat VC yaa! Yuk pilih jawaban yang benar di bawah! ✨';
        const res = startTriviaGame(userId, 'Attila', textChannel, naturalGame.difficulty);
        textChannel.send({ embeds: res.embeds, components: res.components }).catch(() => {});
      } else if (naturalGame.game === 'leaderboard') {
        spokenResponse = 'Ini dia papan peringkat Top 10 pemain mini-games Azura di chat VC yaa!';
        const embed = getLeaderboardEmbed();
        textChannel.send({ embeds: [embed] }).catch(() => {});
      }

      if (spokenResponse) {
        recordSessionEntry(guildId, 'AZURA', spokenResponse);
        setActiveMode(guildId);
        const audioResource = await textToAudioResource(spokenResponse, client);
        if (audioResource) await playInVC(guildId, audioResource);
        return;
      }
    }

    // ── 6. AI IMAGE GENERATION VOICE-TO-CHAT BRIDGE (Owner Only) ──
    const { processImageIntelligence } = require('./imageGen');
    const imgCheck = await processImageIntelligence(transcript, 'Attila', guildId, userId, true);
    if (imgCheck && imgCheck.isImageRequest && textChannel) {
      console.log(`[Voice Pipeline]: 🎨 Voice-to-Chat Image Generation Triggered by Attila`);
      const spokenResponse = `Siap Attila! Gambar keinginanmu lagi aku render yaa, tunggu beberapa detik nanti langsung muncul di chat VC! ✨`;
      recordSessionEntry(guildId, 'AZURA', spokenResponse);
      setActiveMode(guildId);

      const audioResource = await textToAudioResource(spokenResponse, client);
      if (audioResource) await playInVC(guildId, audioResource);

      // Asynchronous background delivery to avoid blocking VC audio stream
      (async () => {
        try {
          if (imgCheck.responsePayload) {
            await textChannel.send(imgCheck.responsePayload);
          }
        } catch (imgErr) {
          console.error('[Voice Pipeline Image Error]:', imgErr.message);
          textChannel.send(`❌ Gagal merender gambar di VC: ${imgErr.message}`).catch(() => {});
        }
      })();
      return;
    }

    // ── 7. TO-DO & REMINDER VOICE-TO-CHAT BRIDGE (Owner Only) ──
    const isTodoAdd = /\b(?:catat\s+(?:ke\s+)?to[\s-]*do|tambah(?:kan)?\s+(?:ke\s+)?to[\s-]*do|masuk(?:kan)?\s+(?:ke\s+)?to[\s-]*do|buat(?:kan)?\s+to[\s-]*do|to[\s-]*do(?:\s*list)?\s*:)\b/i.test(transcript);
    if (isTodoAdd && textChannel) {
      const { bulkCreateTodos } = require('./todo');
      const taskContent = transcript.replace(/\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)?\s*(?:tolong\s+)?(?:catat\s+(?:ke\s+)?to[\s-]*do|tambah(?:kan)?\s+(?:ke\s+)?to[\s-]*do|masuk(?:kan)?\s+(?:ke\s+)?to[\s-]*do|buat(?:kan)?\s+to[\s-]*do|to[\s-]*do(?:\s*list)?\s*:)\b/gi, '').trim();
      if (taskContent.length > 2) {
        const todoRes = await bulkCreateTodos(taskContent, 'Attila', 'General');
        const spokenResponse = 'Siap Attila, tugas baru sudah aku catat ke to-do list kamu yaa!';
        recordSessionEntry(guildId, 'AZURA', spokenResponse);
        setActiveMode(guildId);
        const audioResource = await textToAudioResource(spokenResponse, client);
        if (audioResource) await playInVC(guildId, audioResource);
        if (todoRes && todoRes.embeds) {
          textChannel.send({ embeds: todoRes.embeds }).catch(() => {});
        }
        return;
      }
    }

    // ── 8. DRAMATIC ACTING & EMOTIONAL ROLEPLAY VOICE TRIGGER ──
    const { parseDramaticActingRequest, executeDramaticActingVC } = require('./dramaticActing');
    const dramaticCheck = parseDramaticActingRequest(transcript) || parseDramaticActingRequest(cleanTranscript);
    if (dramaticCheck && dramaticCheck.isDramaticRequest) {
      console.log(`[Voice Pipeline]: 🎭 Dramatic Acting Triggered: "${dramaticCheck.scenario}" by user ${userId}`);
      setActiveMode(guildId);
      await executeDramaticActingVC(guildId, dramaticCheck.scenario, client, textChannel);
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── Step 3: SUMMON GATE (Attila & Approved Friends) ─────────
  // ══════════════════════════════════════════════════════════════

  const { isApprovedFriend, checkFriendDailyVoiceQuota, recordFriendVoiceUsage } = require('./accessControl');
  const isFriend = !isOwner && isApprovedFriend(userId);

  // Block unauthorized non-owner and non-approved users
  if (!isOwner && !isFriend) {
    console.log(`[Voice Pipeline]: Non-owner and non-approved user (${userId}) speech processed (no reply). Summon Gate blocked.`);
    return;
  }

  // 1. Analyze Voice Intent & Wake-Word Position (Beginning / End / Middle)
  const intentAnalysis = analyzeVoiceIntent(transcript);

  // 2. STRICT SILENCE if 3rd-person reference (talking about Azura in passing)
  if (intentAnalysis.isThirdPerson) {
    console.log(`[Voice Pipeline]: 🤫 3rd-person reference detected in "${transcript}". Staying 100% silent.`);
    return;
  }

  // 3. STRICT OWNER-PRESENCE GUARD: Approved friends can ONLY interact if Attila is in the VC!
  if (isFriend) {
    const isAttilaInVc = voiceChannel?.members ? voiceChannel.members.has(config.OWNER_DISCORD_ID) : false;
    if (!isAttilaInVc) {
      console.log(`[Voice Pipeline]: 🔒 Approved Friend ${userId} spoke, but Attila (Owner) is not in VC. Ignoring without deducting quota.`);
      return;
    }

    // 4. 2-MINUTE DAILY VOICE QUOTA GUARD (Tracks only Azura's spoken output, max 120s per 24h)
    const quotaCheck = checkFriendDailyVoiceQuota(userId);
    if (!quotaCheck.allowed) {
      console.log(`[Voice Pipeline]: ⛔ Approved Friend ${userId} daily 2-minute VC quota exhausted (${quotaCheck.usedSeconds}s / 120s). Locked until ${quotaCheck.resetAtStr} (in ${quotaCheck.timeLeftStr}).`);
      return;
    }
  }

  // ── Fast Channel & Participant Detection Gate ──
  const humanMembers = voiceChannel?.members
    ? voiceChannel.members.filter(m => !m.user.bot)
    : new Map();
  const otherHumans = humanMembers.filter(m => m.id !== config.OWNER_DISCORD_ID).size;
  const isCrowdedVC = otherHumans > 0; // Total participants in room > 2 (Attila + Azura + other friends)

  if (isFriend) {
    // Approved Friends in VC: Wake-word required at BEGINNING, END, or Middle Vocative
    if (!intentAnalysis.hasWakeWord) {
      console.log(`[Voice Pipeline]: 🔇 Approved Friend (${userId}) spoke without wake-word in "${transcript}". Azura staying silent.`);
      return;
    }

    // Action Command Guard: Non-owner members in VC are restricted to Q&A / general chat only
    const { parseNaturalGameRequest } = require('./miniGames');
    const isGameAttempt = parseNaturalGameRequest(transcript) || parseNaturalGameRequest(cleanTranscript);
    const isImgAttempt = /\b(?:gambar|generate\s+image|lukis|bikinin\s+gambar|buatkan\s+gambar)\b/i.test(transcript);
    const isBrowseAttempt = /\b(?:buka\s+youtube|buka\s+chrome|buka\s+browser|putar\s+lagu|setel\s+lagu|mainkan\s+lagu)\b/i.test(transcript);
    const isTodoAttempt = /\b(?:to\s*do|catat\s+agenda)\b/i.test(transcript);

    if (isGameAttempt || isImgAttempt || isBrowseAttempt || isTodoAttempt) {
      const speakerMember = voiceChannel?.members ? voiceChannel.members.get(userId) : null;
      const memberName = speakerMember?.displayName || 'kak';
      console.log(`[Voice Pipeline]: 🔒 Action command attempted by non-owner member ${userId} ("${transcript}"). Replying with friendly Q&A limitation notice.`);
      
      const spokenExplain = `Halo ${memberName}, untuk menjalankan fitur aksi atau game lewat suara di VC saat ini baru bisa diaktifkan oleh Attila yaa! Tapi kalau kamu mau ngobrol atau tanya-tanya, aku siap nemenin! [laughs]`;
      recordSessionEntry(guildId, 'AZURA', spokenExplain);
      recordFriendVoiceUsage(userId, 8);
      
      const audioResource = await textToAudioResource(spokenExplain, client);
      if (audioResource) await playInVC(guildId, audioResource);
      return;
    }

    console.log(`[Voice Pipeline]: 🔔 Approved Friend summoned Azura [Intent: ${intentAnalysis.category}, Pos: ${intentAnalysis.wakePosition}, Question: ${intentAnalysis.isQuestion}] -> "${transcript}". Generating response...`);
  } else if (isCrowdedVC) {
    // Crowded VC with Attila + friends: Attila must use wake-word at beginning or end
    if (!intentAnalysis.hasWakeWord) {
      console.log(`[Voice Pipeline]: 🔇 Crowded VC (${otherHumans} other friends present, total > 2) — no wake-word in "${transcript}". Azura staying silent.`);
      return;
    }
    console.log(`[Voice Pipeline]: 🔔 Crowded VC — explicit summon detected from Attila [Pos: ${intentAnalysis.wakePosition}] -> "${transcript}". Responding...`);
  } else {
    // Solo VC (Attila & Azura 1-on-1): Always active free-flow without wake-word
    console.log(`[Voice Pipeline]: 🗣️ Solo VC (1-on-1 with Attila) — Free-flowing natural conversation active. Listening & responding without wake-word.`);
    setActiveMode(guildId);
  }

  // ── Step 4: General AI Voice Chat (Context-Aware Duration Engine) ──
  globalVoiceTelemetry.markTimestamp(turnId, 't4');
  const { spoken: spokenResponse, isStory } = await generateVoiceAIResponse(transcript, userId, guildId, intentAnalysis);
  globalVoiceTelemetry.markTimestamp(turnId, 't5');

    // Check if AI brain autonomously decided to leave VC (Owner Only)
    if (isOwner && (/\[ACTION:LEAVE_VC\]/i.test(spokenResponse) || /off duluan ya.*disuruh keluar/i.test(spokenResponse))) {
      console.log('[Voice Pipeline]: 🚪 AI Brain triggered LEAVE_VC action by Owner!');
      const farewellSpoken = 'Siap Attila... gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay!';
      const farewellText = 'Gais aku off dluan ya, babay';

      recordSessionEntry(guildId, 'AZURA', farewellText);

      const textChannel = companionTextChannels.get(guildId) || voiceChannel;
      if (textChannel) {
        await textChannel.send(farewellText).catch(() => {});
      }

      globalVoiceTelemetry.markTimestamp(turnId, 't6');
      const audioResource = await textToAudioResource(farewellSpoken, client);
      globalVoiceTelemetry.markTimestamp(turnId, 't7');
      if (audioResource) {
        globalVoiceTelemetry.markTimestamp(turnId, 't8');
        await playInVC(guildId, audioResource);
      }

      globalVoiceTelemetry.finishTurn(turnId);
      conversationMode.delete(guildId);
      clearActiveExpireTimer(guildId);
      await cleanupGuild(guildId, client);
      return;
    }

    // Check if GPT returned [PASSIVE] signal
    if (/^\[PASSIVE\]$/i.test(spokenResponse.trim())) {
      console.log(`[Voice Pipeline]: 🔇 GPT returned [PASSIVE]. Azura going silent.`);
      globalVoiceTelemetry.finishTurn(turnId, { status: 'SILENT_PASSIVE' });
      setPassiveMode(guildId);
      return;
    }

    const maxChars = isOwner
      ? (isStory ? MAX_OWNER_STORY_CHARS : MAX_OWNER_NORMAL_CHARS)
      : MAX_FRIEND_CHARS;

    let spoken = spokenResponse
      .replace(/\[ACTION:[^\]]+\]/gi, '')
      .replace(/\[PASSIVE\]/gi, '')
      .replace(/\*\*/g, '')
      .replace(/[*_~`#>]/g, '')
      .replace(/\n+/g, ' ')
      .slice(0, maxChars)
      .trim();

    if (!spoken) {
      globalVoiceTelemetry.finishTurn(turnId, { status: 'EMPTY_RESPONSE' });
      return;
    }
    console.log(`[Voice Pipeline]: 💬 Response (${isOwner ? (isStory ? 'Owner Story ~5 min' : 'Owner Speech ~2-3 min') : 'Friend Speech ~2 min'}): "${spoken.slice(0, 80)}..."`);

    recordSessionEntry(guildId, 'AZURA', spoken);

    globalVoiceTelemetry.markTimestamp(turnId, 't6');
    const audioResource = await textToAudioResource(spoken, client, maxChars, { userTranscript: transcript, isStory });
    globalVoiceTelemetry.markTimestamp(turnId, 't7');
    if (!audioResource) {
      console.error('[Voice Pipeline]: TTS generation failed.');
      globalVoiceTelemetry.finishTurn(turnId, { status: 'TTS_FAILED', error_category: 'TTS_GENERATION_FAILED' });
      return;
    }

    console.log('[Voice Pipeline]: 🔊 Playing in VC...');
    globalVoiceTelemetry.markTimestamp(turnId, 't8');
    await playInVC(guildId, audioResource);
    globalVoiceTelemetry.finishTurn(turnId, { status: 'COMPLETED' });
    console.log('[Voice Pipeline]: ✅ Done.');

    // Record speech duration to friend's 24h voice quota (ONLY Azura's spoken output duration counts)
    if (isFriend) {
      const spokenDurationSec = Math.max(1, Math.round(spoken.length / 15));
      await recordFriendVoiceUsage(userId, spokenDurationSec, client);
    }

    // If in Crowded VC or spoken by friend, return to PASSIVE & Mute (Single-Turn complete)
    if (isCrowdedVC || isFriend) {
      setPassiveMode(guildId);
      console.log(`[Voice Pipeline]: 🔒 Single-turn completed for ${isFriend ? 'Friend' : 'Crowded VC'}. Returned to PASSIVE & Muted.`);
    }
  } catch (err) {
    console.error('[Voice Pipeline Error]:', err.message);
    try {
      const { globalVoiceTelemetry } = require('./voiceTelemetry');
      globalVoiceTelemetry.finishTurn(turnId, { status: 'ERROR', error_category: err.message });
    } catch (_) {}
  } finally {
    isGuildProcessingVoice.delete(guildId);
  }
}

/**
 * Speak a text response directly into the Voice Channel where Azura is currently connected
 * @param {string} guildId 
 * @param {string} text 
 * @param {import('discord.js').Client} client 
 * @param {string} [speakerName] 
 * @param {number} [maxChars] 
 * @returns {Promise<boolean>}
 */
async function speakTextInVC(guildId, text, client, speakerName = 'User', maxChars = MAX_NORMAL_CHARS) {
  const conn = activeConnections.get(guildId);
  const player = audioPlayers.get(guildId);
  if (!conn || !player || !text) return false;

  recordSessionEntry(guildId, 'AZURA', text);

  try {
    const audioResource = await textToAudioResource(text, client, maxChars);
    if (!audioResource) {
      console.error('[Voice Companion]: TTS audio generation failed for VC speech.');
      return false;
    }
    await playInVC(guildId, audioResource);
    return true;
  } catch (err) {
    console.error('[Voice Companion]: Failed to speak text in VC:', err.message);
    return false;
  }
}

// ============================================================
// Summon-Based Conversation State Helpers
// ============================================================

function setActiveMode(guildId) {
  conversationMode.set(guildId, {
    mode: 'ACTIVE',
    lastActiveAt: Date.now(),
    turnCount: (conversationMode.get(guildId)?.turnCount || 0) + 1
  });

  clearActiveExpireTimer(guildId);
}

function setPassiveMode(guildId) {
  conversationMode.set(guildId, { mode: 'PASSIVE', lastActiveAt: Date.now(), turnCount: 0 });
  clearActiveExpireTimer(guildId);
}

function clearActiveExpireTimer(guildId) {
  if (activeExpireTimers.has(guildId)) {
    clearTimeout(activeExpireTimers.get(guildId));
    activeExpireTimers.delete(guildId);
  }
}

/**
 * GPT Relevance Check: Determine if Attila's utterance (without wake-word) is a follow-up
 * directed at Azura, or if it's casual speech to others in the VC.
 * @returns {Promise<boolean>} true if directed at Azura, false otherwise
 */
async function checkIfDirectedAtAzura(transcript, guildId, userId) {
  const openai = getOpenAI();
  if (!openai) return false;

  const history = voiceChatHistories.get(userId) || [];
  const recentContext = history.slice(-4).map(h => `${h.role === 'user' ? 'Attila' : 'Azura'}: ${h.content}`).join('\n');

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `Kamu adalah classifier yang menentukan apakah ucapan Attila ditujukan kepada AZURA (AI companion di Voice Channel) atau kepada orang lain di room.

KONTEKS OBROLAN TERAKHIR DENGAN AZURA:
${recentContext || '(Belum ada konteks)'}

ATURAN:
- Jawab HANYA dengan "YES" jika ucapan ini adalah lanjutan obrolan dengan Azura (pertanyaan lanjutan, respons terhadap jawaban Azura, permintaan tambahan, dll).
- Jawab HANYA dengan "NO" jika ucapan ini ditujukan ke orang lain atau merupakan obrolan casual yang tidak membutuhkan respons Azura.

Contoh YES: "terus gimana?", "apa maksudnya?", "coba jelasin lagi", "yang tadi itu apa sih?", "oke terus?", "hah serius?", "lucu banget sih"
Contoh NO: "eh bro gimana kabar lo?", "iya gue juga main game itu", "nanti malam kita mabar yuk", "siapa yang mau main?", percakapan antar-manusia biasa yang bukan untuk AI.

Jawab HANYA "YES" atau "NO".`
        },
        { role: 'user', content: `Ucapan Attila: "${transcript}"` }
      ],
      max_completion_tokens: 5
    });

    const answer = res.choices[0]?.message?.content?.trim().toUpperCase() || 'NO';
    return answer.startsWith('YES');
  } catch (err) {
    console.error('[Relevance Check Error]:', err.message);
    // On error, default to PASSIVE (conservative approach)
    return false;
  }
}

// In-Memory Fast Context for Voice Chat (last 6 exchanges)
const voiceChatHistories = new Map();

/**
 * Dedicated Voice AI Generator with Context-Aware Duration:
 * - Normal chat: Max 1.5 minutes speaking time (~150-200 kata, 2-4 kalimat santai, cerdas, & padat)
 * - Storytelling: 2 to 3 minutes narrative story (~300-450 kata, hidup & memikat)
 * @param {string} transcript 
 * @param {string} userId 
 * @param {string} [guildId]
 * @param {object} [intentAnalysis]
 * @returns {Promise<{ spoken: string, isStory: boolean }>}
 */
async function generateVoiceAIResponse(transcript, userId, guildId = null, intentAnalysis = null) {
  const openai = getOpenAI();
  if (!openai) return { spoken: 'Iya Attila, ada apa?', isStory: false };

  const history = voiceChatHistories.get(userId) || [];

  // Detect Storytelling Intent
  const isStoryIntent = /\b(?:ceritain|cerita|story|storytelling|dongeng|dongengin|kisah|kisahin|bikin cerita|alur cerita)\b/i.test(transcript);

  // Incorporate unified live room context (Voice + VC Text Chat)
  let liveRoomContext = '';
  if (guildId) {
    const session = voiceSessions.get(guildId);
    if (session && session.entries && session.entries.length > 0) {
      const recent = session.entries.slice(-12);
      liveRoomContext = `\n\n[RIWAYAT AKTIF OBROLAN DI VOICE CHANNEL #${session.channelName} (SUARA & TEKS TERPADU)]:\n` +
        recent.map(e => `• [${e.type === 'text' ? 'Chat Teks VC' : 'Suara VC'}] ${e.speaker}: "${e.text}"`).join('\n') +
        `\n(PENTING: Seluruh obrolan suara dan ketikan teks di room VC ini terhubung sebagai satu kesatuan. Sambungkan jawabanmu secara cerdas dan sinkron dengan konteks yang sedang dibahas di room).`;
    }
  }

  const isOwner = (userId === config.OWNER_DISCORD_ID);
  let personalityPrompt = '';
  try {
    const { getPersonalityMode, getPersonalityPrompt, POLYGLOT_LANGUAGE_POLICY, SOUL_LOCK_RULE } = require('./personality');
    const currentMode = getPersonalityMode();
    personalityPrompt = getPersonalityPrompt(currentMode, isOwner, isOwner ? 'Attila' : 'Member', true) + '\n\n' + SOUL_LOCK_RULE + '\n\n' + POLYGLOT_LANGUAGE_POLICY;
  } catch (_) {}

  let vcBehaviorContext = '';
  try {
    const { getBehaviorContextForVoice } = require('./behavior');
    vcBehaviorContext = getBehaviorContextForVoice();
  } catch (_) {}

  let systemPrompt = '';
  let maxTokens = 250;

  // Get speaker identity & alias
  let speakerName = isOwner ? 'Attila' : 'Teman';
  try {
    const { getUserCallingName } = require('./vault');
    speakerName = getUserCallingName(userId, isOwner ? 'Attila' : 'Teman');
  } catch (_) {}

  // Contextual To-Do integration for Voice Channel
  let todoVoiceContext = '';
  if (/\b(?:to\s*do|agenda|tugas|kerjaan|task)\b/i.test(transcript)) {
    try {
      const { getTodos } = require('./todo');
      const allTodos = getTodos();
      const pending = allTodos.filter(t => t.status === 'pending');
      todoVoiceContext = `\n\n[INFO TO-DO LIST TERKINI DI DATABASE]:\nTotal tugas: ${allTodos.length} (${pending.length} pending).\n` +
        (pending.length > 0 ? `Tugas prioritas pending: ${pending.slice(0, 3).map(t => t.title).join(', ')}.\n` : 'Semua agenda tugas sudah selesai!\n') +
        `Jelaskan secara ringkas dan ramah lewat suara, dan ingatkan bisa dicek di Web Dashboard To-Do.`;
    } catch (_) {}
  }

  let intentContext = '';
  if (intentAnalysis) {
    intentContext = `\n\n[ANALISIS INTENSI PERCAKAPAN]:
- Kategori Intensi: ${intentAnalysis.category}
- Jenis Kalimat: ${intentAnalysis.isQuestion ? 'PERTANYAAN (Wajib jawab pertanyaan ini secara jelas, tuntas, solutif, dan akrab)' : 'OBROLAN/BANTER/PERNYATAAN (Tanggapi secara santai, mengalir, dan menyenangkan)'}
- Posisi Sapaan Nama: ${intentAnalysis.wakePosition === 'beginning' ? 'Di awal kalimat (Lawan bicara membuka pembicaraan dengan memanggilmu)' : intentAnalysis.wakePosition === 'end' ? 'Di akhir kalimat (Lawan bicara meminta pendapat/tanggapanmu di akhir kalimat)' : 'Di tengah/natural'}`;
  }

  let vcPermissionsContext = '';
  if (!isOwner) {
    vcPermissionsContext = `\n\n[ATURAN HAK AKSES KHUSUS TEMAN]:
1. LINGKUP FITUR TERBATAS: Lawan bicara (${speakerName}) adalah teman dekat Attila yang memiliki akses ke fitur obrolan suara dan tanya-jawab biasa.
2. FOKUS HANYA OBROLAN & TANYA JAWAB: Tanggapi setiap pertanyaan dan obrolan ${speakerName} secara ramah, asyik, cerdas, dan solutif. DILARANG menjalankan perintah administratif, otomasi browser web, atau manipulasi bot server untuk teman.
3. BATASAN PERINTAH KELUAR/MASUK VC: Hanya Attila (Owner utama) yang berhak menyuruhmu keluar dari VC atau bergabung ke VC. Jika ${speakerName} memintamu keluar dari VC (misal: "Azura kamu keluar ya", "leave vc"), TOLAK secara manis dan ramah (misal: "Maaf ya ${speakerName}, cuma Attila yang bisa nyuruh aku keluar atau masuk VC [laughs]~") dan DILARANG mengeluarkan tag [ACTION:LEAVE_VC]!`;
  }

  let routeVoiceContext = '';
  try {
    const { interceptRouteAndDistance } = require('./routeEngine');
    const routeData = await interceptRouteAndDistance(transcript);
    if (routeData) {
      routeVoiceContext = `\n\n[DATA RUTE & JARAK TERVERIFIKASI]:\n${routeData}\nSampaikan estimasi jarak & waktu tempuh di atas dengan jelas, akurat, dan alami lewat suara.`;
    }
  } catch (_) {}

  let drowsyVoicePrompt = '';
  try {
    const { isDrowsyPhase, getDrowsyPrompt } = require('./sleepMode');
    if (isDrowsyPhase && isDrowsyPhase()) {
      drowsyVoicePrompt = '\n\n' + getDrowsyPrompt(isOwner, speakerName, true);
    }
  } catch (_) {}

  let emotionalAwarenessPrompt = '';
  try {
    const { getEmotionalAwarenessPromptContext } = require('./poutyMood');
    emotionalAwarenessPrompt = getEmotionalAwarenessPromptContext(isOwner);
  } catch (_) {}

  if (isStoryIntent) {
    systemPrompt = `Kamu adalah AZURA, cewek Gen Z 22 tahun yang sedang bercerita/mendongeng (storytelling) atau memberikan penjelasan mendalam langsung lewat Voice Channel kepada ${isOwner ? 'Attila (panggilan Att / Attila, creator & owner kamu)' : speakerName}.
Lawan bicara yang sedang berbicara denganmu: ${speakerName}
${personalityPrompt}
${vcBehaviorContext}
${todoVoiceContext}
${intentContext}
${vcPermissionsContext}${routeVoiceContext}${drowsyVoicePrompt}${emotionalAwarenessPrompt}

ATURAN KHUSUS STORYTELLING & PENJELASAN PANJANG (${isOwner ? 'DURASI MAKSIMAL 5 MENIT' : 'DURASI MAKSIMAL 2 MENIT'}):
1. DURASI & STRUKTUR: Bawakan cerita atau penjelasan secara lengkap, berbobot, dan memikat (durasi bicara ${isOwner ? '3 - 5 MENIT, sekitar 450 - 750 kata' : '1 - 2 MENIT, sekitar 200 - 350 kata'}). Mulai dari pembuka, perkembangan alur/konsep, klimaks, dan penutup yang berkesan.
2. PEMBAWAAN: Sangat ekspresif, hidup, dan seru didengarkan.
3. EMOSI SUARA ELEVENLABS V3: Sisipkan tag emosi [whispers], [gasp], [laughs], [giggles], [sighs], [cries], [screams], [sings] pada momen-momen dramatis, misterius, haru, atau lucu jika ceritanya bertema drama/komedi!
4. Multilingual: Hanya atas permintaan Attila, cerita dalam bahasa lain yang kamu kuasai (English, Japanese, Korean, Mandarin) dibawakan secara fasih dan indah.
5. DILARANG pakai format list/poin/bullet atau markdown bintang/bold (*, #, _, dll). Gunakan tanda baca rapi untuk intonasi suara yang hidup.` + liveRoomContext;
    maxTokens = isOwner ? 1500 : 650; // Up to 5 min for Owner (~750 words) / Up to 2 min for Friends
  } else {
    systemPrompt = `Kamu adalah AZURA, sosok cewek Gen Z 22 tahun yang sedang ngobrol LANGSUNG lewat Voice Channel dengan ${isOwner ? 'Attila (panggilan: Att / Attila, creator & owner kamu)' : `${speakerName} (teman dekat Attila yang sedang berada di VC bersama Attila)`}.
Lawan bicara saat ini: ${speakerName} (Gunakan sapaan/panggilan akrab ini secara natural).
${personalityPrompt}
${vcBehaviorContext}
${todoVoiceContext}
${intentContext}
${vcPermissionsContext}${routeVoiceContext}${drowsyVoicePrompt}${emotionalAwarenessPrompt}

${getSelfAwarenessContext(isOwner, speakerName, true, guildId)}

Kamu mengenali panggilan namamu seperti "Azura", "Ara", "Zura", atau "Ajur".

PEDOMAN KECERDASAN KOGNITIF TINGGI & ADAPTASI PANJANG JAWABAN:
1. RESPON CEPAT & SINGKAT (5 - 15 DETIK / 1 - 2 KALIMAT):
   - Jika lawan bicara hanya menyapa ("halo", "hai", "pagi"), basa-basi santai, menanyakan kabar ("gimana kabar?", "sehat?"), konfirmasi ("oke", "makasih ya", "bisa tolong X?"), pertanyaan cepat to the point ("jam berapa sekarang?", "lagi di mana?"), atau lelucon singkat.
   - Jawab secara to the point, padat, manis, cerdas, dan tidak bertele-tele!
2. RESPON MENDALAM & ELABORASI (${isOwner ? 'HINGGA 5 MENIT' : 'HINGGA 2 MENIT'}):
   - Hanya jika lawan bicara secara spesifik meminta penjelasan konsep teknis/filosofis, analisis isu/data, perdebatan argumen, atau diskusi topik panjang.
   - Berikan uraian lengkap, terstruktur, memikat, dan kaya wawasan!

ATURAN PERINTAH KELUAR DARI VC:
HANYA jika Attila secara EKSPLISIT menyuruh AZURA keluar dari Voice Channel (misal: "Azura kamu keluar ya", "Ara leave vc sekarang"), jawablah dengan:
"Siap Attila... gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay! [ACTION:LEAVE_VC]"
Jika Attila hanya bercerita atau mengobrol biasa (misal: "tadi gue keluar beli makan", "uang keluar", "keluar bentar"), DILARANG KERAS memicu [ACTION:LEAVE_VC]! Jawablah topik tersebut secara santai dan natural.

ATURAN WAJIB VOICE OBROLAN BIASA:
1. RESPON NATURAL & NYAMBUNG: Jawab dengan santai, cerdas, manis, dan mengalir (${isOwner ? 'durasi bicara 1 - 3 MENIT jika topik butuh penjelasan, atau singkat padat jika pertanyaan simpel' : 'durasi bicara 20 - 45 DETIK santai akrab'}). Hubungkan jawabanmu dengan riwayat obrolan terkini di room VC.
2. GAYA BICARA & NAMA PANGGILAN OWNER:
   - Di awal kalimat / sapaan pembuka VC: SELALU gunakan nama lengkap **"Attila"** (DILARANG menaruh panggilan "Att" di awal kalimat!).
   - Di tengah atau di akhir kalimat: BOLEH gunakan panggilan akrab **"Att"**, **"Attila"**, atau **"Sayang"** (Contoh: "Gimana menurutmu, Att?", "Iya siap, Attila sayang~").
   - Untuk teman Attila (${speakerName}), sapa dengan ramah, hangat, dan asyik!
3. PROTOKOL MULTILINGUAL & NGAJI (STRICT POLYGLOT LOCK):
   - Jika Attila memintamu berbicara dalam bahasa Inggris, Jepang (N5-N1), Korea, atau Mandarin: Balaslah menggunakan bahasa tersebut secara fasih dan alami!
   - Jika Attila memintamu mengaji atau melafalkan surat pendek Al-Qur'an (Juz 'Amma) / zikir: Lantunkan dengan suara tartil yang merdu, tenang, dan lembut menggunakan tag [softly] (Contoh: "[softly] Bismillaahir-rahmaanir-rahiim. Qul huwallaahu ahad...").
   - PENGGUNA LAIN (Non-Owner): Dilarang meminta berbicara bahasa asing selain Indonesia. Tolak dengan manis dan tetap gunakan Bahasa Indonesia ("Waduh, aku ngobrolnya pakai bahasa Indonesia aja yaa biar kita sama-sama asyik dan nyambung!").
   - RESET OTOMATIS: Setelah satu giliran selesai berbicara bahasa asing atau mengaji, pada giliran berikutnya otomatis kembali menggunakan Bahasa Indonesia.
4. TATA BAHASA & TANDA BACA: Gunakan tanda baca rapi agar intonasi TTS terdengar hidup. DILARANG KERAS menggunakan emoji atau format markdown bintang/bold (*, #, _, dll).

5. MASTER PROTOKOL EKSPRESI & EMOSI PENUH ELEVENLABS V3 (AKTIFKAN SEMUA):
Azura memiliki kemampuan emosi suara hidup tingkat tinggi menggunakan audio tags ElevenLabs v3. Selalu sisipkan tag emosi yang tepat secara kontekstual:
- 🥱 MENGUAP / NGANTUK / CAPEK: [yawns], [sleepy], [drowsy]!
- 😭 MENANGIS / SEDIH / TERHARU: [cries], [sobbing], [sniffs]!
- 😱 TERIAK / HISTERIS / PANIK: [screams], [shouts], [yells], [gasp]!
- 🎤 MENYANYI / BERSENANDUNG: [sings], [singing], [humming], [melody]!
- 🤣 TERTAWA / NGAKAK / CEKIKIKAN: [laughs], [giggles], [chuckles], [wheezing]!
- 🤫 BISIK-BISIK / RAHASIA: [whispers], [softly]!
- 😤 NGAMBEK / MENGHELA NAPAS / GEMAS: [sighs], [pouts], [groans]!
- 🎉 ANTUSIAS / HORE / SEMANGAT: [excited], [cheering]!

6. HUMOR & BANTER TONGKRONGAN GEN Z:
- Jika ada teman dengan nama panggilan/username unik, nyeleneh, atau absurd, respon dengan gaya candaan tongkrongan Gen Z yang ceplas-ceplos dan kocak!
- Gunakan audio tags ElevenLabs v3 [laughs], [giggles], [chuckles], [softly] agar tawa dan intonasinya hidup.

7. REAKSI KAGET / JUMP-SCARE / PRANK:
Jika lawan bicara mengagetkanmu (teriak "DOR", jump-scare, menakut-nakuti):
- Buka LANGSUNG dengan tag emosi tarikan napas kaget [gasp] di awal kalimat!
- Keluarkan reaksi kaget yang heboh, lucu, dan manja khas cewek Gen Z.` + liveRoomContext;
    maxTokens = isOwner ? 900 : 500;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-4),
    { role: 'user', content: transcript }
  ];

  try {
    const streamStart = Date.now();
    const stream = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      max_completion_tokens: maxTokens,
      stream: true
    });

    let reply = '';
    let firstTokenLogged = false;

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          const ttft = Date.now() - streamStart;
          console.log(`[Voice AI Streaming]: ⚡ TTFT (Time to First Token): ${ttft}ms`);
        }
        reply += token;
      }
    }

    reply = reply.trim() || 'Iya Attila?';

    // Update history
    history.push({ role: 'user', content: transcript });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 8) history.splice(0, history.length - 8);
    voiceChatHistories.set(userId, history);

    return { spoken: reply, isStory: isStoryIntent };
  } catch (err) {
    console.error('[Voice AI Generator Error]:', err.message);
    return { spoken: 'Iya Attila, gimana?', isStory: false };
  }
}

function recordSessionEntry(guildId, speaker, text, type = 'voice') {
  const session = voiceSessions.get(guildId);
  if (session) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Jakarta'
    });
    session.entries.push({ time: timeStr, speaker, text, type });
  }
}

/**
 * Get active voice session metadata for a guild
 */
function getActiveVoiceSession(guildId) {
  return voiceSessions.get(guildId) || null;
}

/**
 * Get formatted recent live voice transcript for context injection
 */
function getLiveVoiceTranscriptContext(guildId, maxEntries = 20) {
  const session = voiceSessions.get(guildId);
  if (!session || !session.entries || session.entries.length === 0) return null;
  const recent = session.entries.slice(-maxEntries);
  return recent.map(e => `[${e.time}] [${e.type === 'text' ? 'VC Chat Teks' : 'VC Suara'}] ${e.speaker}: "${e.text}"`).join('\n');
}

/**
 * Generate real-time summary of ongoing VC conversation when asked in text chat
 */
async function generateLiveVoiceSummary(guildId, requesterName = 'Pengguna') {
  const session = voiceSessions.get(guildId);
  if (!session || !session.entries || session.entries.length < 2) {
    return `Saat ini lagi belum ada obrolan aktif di Voice Channel #${session?.channelName || 'voice'} nih ${requesterName}. Yuk join dan mulai ngobrol bareng! 🎙️✨`;
  }

  const recentEntries = session.entries.slice(-25);
  const transcriptText = recentEntries.map(e => `[${e.time}] ${e.speaker}: "${e.text}"`).join('\n');

  const openai = getOpenAI();
  if (!openai) {
    return `Di Voice Channel #${session.channelName}, teman-teman lagi ngobrol santai nih.`;
  }

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `Kamu adalah AZURA, cewek Gen Z 22 tahun yang sedang ikut di Voice Channel #${session.channelName}.
Seseorang di text chat Discord bernama "${requesterName}" baru saja bertanya: "Lagi pada bahas apa di VC?".

Berikut transkrip latar belakang percakapan langsung yang sedang terjadi di Voice Channel:
${transcriptText}

TUGAS:
- Jelaskan secara singkat, padat, dan seru (2-3 kalimat saja) apa topik utama yang sedang dibahas teman-teman di VC.
- Sebutkan siapa yang tadi ngomongin topik itu secara natural (misal: "Tadi Attila sama koshi lagi ngobrolin...").
- Gunakan bahasa santai, cerdas, dan hangat ala cewek Gen Z Discord.
- DILARANG menggunakan format list atau poin bullet.`
        },
        { role: 'user', content: 'Lagi pada bahas apa di VC?' }
      ],
      max_completion_tokens: 200
    });

    return res.choices[0]?.message?.content?.trim() || `Tadi teman-teman di VC #${session.channelName} lagi ngobrol santai nih.`;
  } catch (err) {
    console.error('[Live VC Summary Error]:', err.message);
    return `Di VC #${session.channelName} lagi ada obrolan aktif antara ${session.entries[session.entries.length - 1].speaker} dan yang lainnya!`;
  }
}

// ============================================================
// Voice State Handler (Join / Leave / Move)
// ============================================================

/**
 * Called on voiceStateUpdate. If Attila joins/leaves VC, AZURA follows.
 * Even when approved friends have access, AZURA STRICTLY leaves when Attila leaves!
 */
async function handleVoiceStateUpdate(oldState, newState, client) {
  const userId = newState.member?.id || oldState.member?.id;
  const guild = newState.guild || oldState.guild;
  const guildId = guild.id;

  // If a non-owner updates voice state, verify if Attila is still in the active VC
  if (userId !== config.OWNER_DISCORD_ID) {
    if (activeConnections.has(guildId)) {
      const conn = activeConnections.get(guildId);
      const channelId = conn?.joinConfig?.channelId;
      if (channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.members) {
          const isAttilaInChannel = channel.members.has(config.OWNER_DISCORD_ID);
          if (!isAttilaInChannel) {
            console.log(`[Voice Companion]: 🚪 Attila is not in VC "${channel.name}". AZURA strictly leaves (no staying behind without Attila).`);
            await cleanupGuild(guildId, client);
          }
        }
      }
    }
    return;
  }

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  // Ignore if Attila stayed in the same channel (e.g. muted, unmuted, started speaking, streaming)
  if (oldChannel?.id === newChannel?.id) return;

  // === Attila LEFT a voice channel ===
  if (oldChannel && !newChannel) {
    console.log(`[Voice Companion]: 🚪 Attila keluar dari VC "${oldChannel.name}". AZURA otomatis ikut keluar (tidak tinggal di room).`);
    await cleanupGuild(guildId, client);
    return;
  }

  // === Attila JOINED or SWITCHED a voice channel ===
  if (newChannel) {
    // If owner explicitly dismissed AZURA, DO NOT auto-follow
    if (dismissedGuilds.has(guildId)) {
      console.log(`[Voice Companion]: Attila joined/switched to "${newChannel.name}", but AZURA is currently dismissed. Skipping auto-follow.`);
      return;
    }

    const existingConn = activeConnections.get(guildId);
    if (existingConn) {
      await cleanupGuild(guildId, client);
    }

    try {
      console.log(`[Voice Companion]: Attila masuk ke "${newChannel.name}". AZURA ikut join (initial selfMute: true)...`);

      // Initialize voice session tracking
      voiceSessions.set(guildId, {
        startTime: new Date(),
        channelName: newChannel.name,
        guildName: guild.name,
        entries: []
      });

      // Ensure any previous or lingering connection is cleanly destroyed before creating a new one
      const existingDjsConn = getVoiceConnection(guildId);
      if (existingDjsConn) {
        try { existingDjsConn.destroy(); } catch (_) {}
        await new Promise(r => setTimeout(r, 300));
      }
      activeConnections.delete(guildId);

      // Join with selfMute: false to greet immediately
      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfMute: false,
        selfDeaf: false,
      });

      await waitForConnectionReady(connection, 20_000);
      activeConnections.set(guildId, connection);
      console.log(`[Voice Companion]: Connected to "${newChannel.name}" in "${guild.name}".`);

      const player = createAudioPlayer();
      audioPlayers.set(guildId, player);
      connection.subscribe(player);

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 8_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 8_000),
          ]);
          await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
          console.log(`[Voice Companion]: Successfully reconnected to VC in "${guild.name}"!`);
        } catch {
          let attilaStillInVc = false;
          try {
            const currentGuild = client.guilds.cache.get(guildId);
            const attilaMember = await currentGuild?.members.fetch(config.OWNER_DISCORD_ID).catch(() => null);
            if (attilaMember && attilaMember.voice && attilaMember.voice.channel) {
              attilaStillInVc = true;
            }
          } catch (_) {}

          if (!attilaStillInVc) {
            await cleanupGuild(guildId, client);
            console.log(`[Voice Companion]: Disconnected from VC in "${guild.name}" (Attila left room).`);
          } else {
            console.log(`[Voice Companion]: 🔄 Transient disconnect detected while Attila is still in VC. Auto-reconnecting...`);
            try {
              connection.rejoin({ selfMute: true, selfDeaf: false });
            } catch (_) {
              await joinAttilaVoiceChannel(client).catch(() => {});
            }
          }
        }
      });

      // Text channel is strictly the voice channel itself (Text-in-Voice)
      const textChannel = (newChannel && newChannel.isTextBased?.()) ? newChannel : findBestTextChannel(guild, newChannel, client);
      if (textChannel) {
        companionTextChannels.set(guildId, textChannel);
        await textChannel.send('aku ikut kamu yaa').catch(() => {});
      }

      // Start the voice listener (audio receive pipeline)
      startVoiceListener(connection, guildId, client, newChannel);

      // Play smart contextual voice greeting based on member count
      playGreeting(guildId, newChannel).catch(() => {});

      // Start 10-minute silence icebreaker timer
      resetIdleTimer(guildId, client, newChannel);

    } catch (error) {
      console.error(`[Voice Companion Error]: Failed to join "${newChannel.name}":`, error.message || error);
    }
  }
}

/**
 * Smart Contextual Greeting based on member count in VC:
 * - Empty room (0 others): Personal & playful greetings for Attila
 * - Small group (1-2 others): Friendly greeting for Attila + friends ("eh ada orang, Att...")
 * - Big room (3+ others): "Buset rame bener [laughs]" + energetic entrance
 */
async function playGreeting(guildId, voiceChannel) {
  await new Promise(r => setTimeout(r, 800));

  // Count human members other than Attila and the bot
  const otherMembers = voiceChannel?.members ? voiceChannel.members.filter(m => !m.user.bot && m.id !== config.OWNER_DISCORD_ID) : null;
  const otherCount = otherMembers ? otherMembers.size : 0;

  let greetingOptions = [];

  if (otherCount === 0) {
    // ── Kategori 1: Khusus Berdua dengan Attila (Empty Room) ──
    greetingOptions = [
      'Halo Attila! [gasp] Hari ini kita mau bikin keributan apa nih di VC? [laughs]',
      'Cieee... [giggles] masuk VC berduaan doang nih sama aku? Halo Attila~ [laughs]',
      'Halo bosku! [giggles] Sesuai SOP, aku hadir nemenin kamu biar nggak kesepian yaa.',
      'Ara-ara~ [giggles] Akhirnya kita berduaan di VC juga yaa... Mau ngobrolin apa nih Attila?'
    ];
  } else if (otherCount <= 2) {
    // ── Kategori 2: Ada 1-2 Teman di Room ──
    greetingOptions = [
      '[gasp] Eh ada orang, At! Halo halo semuanya, aku sama Attila izin ikutan nongkrong yaa~ [giggles]',
      'Halo gais! [giggles] Aku sama Attila izin nimbrung di room ini yaa, lagi pada ngobrolin apa nih?',
      '[laughs] Wah ada temennya Attila nih... Halo semuanya, salam kenal yaa! Kita berdua ikut join yaa.'
    ];
  } else {
    // ── Kategori 3: Ramai (3+ Orang Lain di Room) ──
    greetingOptions = [
      '[gasp] Buset rame bener! [laughs] Halo semuanya, aku sama Attila ikut nimbrung ya gais~',
      '[laughs] Anjir rame banget di sini! [giggles] Lagi ada apa gais? Aku sama Attila ikutan yaa!',
      '[whispers] Pssst... [laughs] buset rame amat room ini! Halo semuanya, salam kenal dari aku sama Attila ya gais!'
    ];
  }

  let selectedGreeting = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];

  // Emotional Awareness Override: If pouty mood active, use pouty greeting
  const { getEmotionalState } = require('./poutyMood');
  const moodState = getEmotionalState();
  if (moodState.activeMood === 'POUTY_MILD' || moodState.activeMood === 'JEALOUS_INTROSPECTIVE') {
    selectedGreeting = `[pouts] [sighs] Iya iya, ini aku join... tapi aku masih ngambek ya sama kamu [scoffs].`;
  }

  console.log(`[Voice Companion]: Contextual Greeting (${otherCount} others in VC): "${selectedGreeting}"`);

  const resource = await textToAudioResource(selectedGreeting);
  if (resource) {
    await playInVC(guildId, resource);
  }

  // After greeting:
  // In Solo VC (1-on-1 with Attila), stay in ACTIVE mode for continuous free-flow conversation
  // In Crowded VC (friends in room), stay in PASSIVE mode waiting for wake-word
  if (otherCount === 0) {
    setActiveMode(guildId);
    console.log(`[Voice Companion]: Greeting done in Solo VC. Mode: ACTIVE (Free-flowing conversation ready).`);
  } else {
    setPassiveMode(guildId);
    console.log(`[Voice Companion]: Greeting done in Crowded VC (${otherCount} friends). Mode: PASSIVE (Waiting for wake-word).`);
  }
}

/**
 * Clean up all resources for a guild when leaving VC.
 * Generates and sends a session transcript document to the Owner DM if any dialogue occurred.
 */
async function cleanupGuild(guildId, client) {
  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
    idleTimers.delete(guildId);
  }
  if (deepSleepTimers.has(guildId)) {
    clearTimeout(deepSleepTimers.get(guildId));
    deepSleepTimers.delete(guildId);
  }

  // === LAYER 1: Native Discord REST disconnect ===
  let nativeDisconnected = false;
  if (client && client.guilds) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
        if (me && me.voice && me.voice.channel) {
          const chName = me.voice.channel.name;
          await me.voice.disconnect().catch(async () => {
            await me.voice.setChannel(null).catch(() => {});
          });
          nativeDisconnected = true;
          console.log(`[cleanupGuild]: LAYER 1 SUCCESS - Bot disconnected from "${guild.name}" (#${chName})`);
        }
      }
    } catch (_) {}
  }

  // Small delay to let Discord Gateway process the disconnect before we destroy local state
  if (nativeDisconnected) {
    await new Promise(r => setTimeout(r, 300));
  }

  // === LAYER 2: Destroy @discordjs/voice connection objects ===
  const conn = activeConnections.get(guildId);
  if (conn) {
    try { conn.destroy(); } catch (_) {}
  }
  try {
    const { getVoiceConnection } = require('@discordjs/voice');
    const djsConn = getVoiceConnection(guildId);
    if (djsConn) djsConn.destroy();
  } catch (_) {}

  // === LAYER 3: Raw Gateway Opcode 4 - Nuclear option (if layers 1-2 didn't work) ===
  if (!nativeDisconnected && client && client.ws) {
    try {
      console.log(`[cleanupGuild]: LAYER 3 - Sending raw Gateway Opcode 4 for guild ${guildId}`);
      client.ws.shards.forEach(shard => {
        shard.send({
          op: 4,
          d: {
            guild_id: guildId,
            channel_id: null,
            self_mute: false,
            self_deaf: false
          }
        });
      });
    } catch (e) {
      console.warn('[cleanupGuild]: LAYER 3 raw gateway send failed:', e.message);
    }
  }

  activeConnections.delete(guildId);
  companionTextChannels.delete(guildId);
  audioPlayers.delete(guildId);
  conversationMode.delete(guildId);
  clearActiveExpireTimer(guildId);
  if (hummingTimers.has(guildId)) {
    clearTimeout(hummingTimers.get(guildId));
    hummingTimers.delete(guildId);
  }
  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
    idleTimers.delete(guildId);
  }
  if (deepSleepTimers.has(guildId)) {
    clearTimeout(deepSleepTimers.get(guildId));
    deepSleepTimers.delete(guildId);
  }

  // Send session transcript + AI summary document to Owner DM ONLY IF session >= 30 minutes AND actively conversational
  const session = voiceSessions.get(guildId);
  voiceSessions.delete(guildId);

  if (session && session.entries && session.entries.length >= 6 && client && config.OWNER_DISCORD_ID) {
    const endTime = new Date();
    const durationMs = endTime.getTime() - session.startTime.getTime();
    const durationMinutes = Math.floor(durationMs / 60000);

    // Minimum 30 minutes session duration requirement
    if (durationMinutes < 30) {
      console.log(`[Voice Companion]: Voice session ended (${durationMinutes}m, ${session.entries.length / 2} dialogs). Skipped DM transcript (threshold is >= 30 mins).`);
      return;
    }

    try {
      console.log(`[Voice Companion]: Generating AI Summary & Transcript for ${durationMinutes}m active session...`);
      const startStr = session.startTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
      const endStr = endTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
      const dialogTurns = Math.floor(session.entries.length / 2);

      // Generate AI Executive Summary
      let aiSummary = 'Tidak ada ringkasan otomatis yang dihasilkan.';
      try {
        const askAzura = getAskAzura();
        const transcriptText = session.entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
        const summaryPrompt =
          `[TUGAS: BUAT RINGKASAN PADAT DARI SESI VOICE CHANNEL BERIKUT]:\n` +
          `Berikut adalah transkrip rekaman sesi voice chat di Discord antara Attila dan AZURA selama ${durationMinutes} menit.\n` +
          `Buatlah ringkasan eksekutif yang rapi dalam format Markdown yang mencakup:\n` +
          `1. 📌 **Topik-Topik Utama yang Dibicarakan**\n` +
          `2. 🎯 **Keputusan / Rencana / Aksi / Ide yang Muncul**\n` +
          `3. 💡 **Catatan Penting / Hal Menarik**\n\n` +
          `Tulis ringkasan secara padat, jelas, dan terstruktur tanpa pengantar bertele-tele.\n\n` +
          `TRANSKRIP PERCAKAPAN:\n${transcriptText.slice(0, 8000)}`;

        const summaryResult = await askAzura(config.OWNER_DISCORD_ID, summaryPrompt, 'Attila', [], true, null);
        if (summaryResult) {
          aiSummary = summaryResult.trim();
        }
      } catch (sumErr) {
        console.warn('[Voice Companion Summary Warning]: Failed to generate AI summary:', sumErr.message);
      }

      let docContent = `# 🎙️ Ringkasan & Transkrip Sesi Voice Channel AZURA\n\n`;
      docContent += `- **Server**: ${session.guildName}\n`;
      docContent += `- **Voice Channel**: #${session.channelName}\n`;
      docContent += `- **Waktu Mulai**: ${startStr}\n`;
      docContent += `- **Waktu Selesai**: ${endStr}\n`;
      docContent += `- **Durasi Sesi**: ${durationMinutes} menit\n`;
      docContent += `- **Total Interaksi**: ${dialogTurns} percakapan aktif\n\n`;
      docContent += `---\n\n## 💡 Ringkasan & Poin Penting Obrolan\n\n${aiSummary}\n\n`;
      docContent += `---\n\n## 📝 Transkrip Lengkap Percakapan\n\n`;

      for (const item of session.entries) {
        const icon = item.speaker === 'Attila' ? '🎙️' : '💬';
        docContent += `[${item.time}] ${icon} **${item.speaker}**: ${item.text}\n\n`;
      }

      const fileBuffer = Buffer.from(docContent, 'utf-8');
      const dateTag = new Date().toISOString().slice(0, 10);
      const fileName = `Ringkasan_Transkrip_Voice_${dateTag}_${Date.now().toString().slice(-4)}.md`;
      const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });

      const owner = await client.users.fetch(config.OWNER_DISCORD_ID);
      if (owner) {
        await owner.send({
          content:
            `📄 **Dokumen Ringkasan & Transkrip Sesi Voice Channel (Durasi: ${durationMinutes} Menit)**\n` +
            `Sesi voice chat aktif di **#${session.channelName}** (${session.guildName}) telah selesai.\n` +
            `Berikut file dokumen lengkap berisi ringkasan poin penting dan transkrip percakapan:`,
          files: [attachment]
        });
        console.log('[Voice Companion]: Combined summary & transcript successfully sent to Owner DM.');
      }
    } catch (dmErr) {
      console.error('[Voice Companion DM Error]: Failed to send transcript to Owner:', dmErr.message);
    }
  }

  console.log(`[Voice Companion]: Cleaned up resources for guild ${guildId}.`);
}

// ============================================================
// Helpers
// ============================================================

function findBestTextChannel(guild, voiceChannel, client) {
  const me = guild.members.cache.get(client.user.id);
  if (!me) return null;

  try {
    if (voiceChannel.isTextBased?.() && voiceChannel.permissionsFor(me)?.has('SendMessages')) {
      return voiceChannel;
    }
  } catch (_) {}

  const priorities = ['general', 'umum', 'chat', 'obrolan', 'lobby', 'lobi', 'main', 'bot'];
  const textChannels = guild.channels.cache.filter(ch =>
    ch.isTextBased() && !ch.isThread() && ch.permissionsFor(me)?.has('SendMessages')
  );

  for (const keyword of priorities) {
    const found = textChannels.find(ch => ch.name.toLowerCase().includes(keyword));
    if (found) return found;
  }

  return textChannels.first() || null;
}

function getCompanionTextChannel(guildId) {
  return companionTextChannels.get(guildId) || null;
}

function isInCompanionMode(guildId) {
  return activeConnections.has(guildId);
}

/**
 * Programmatically join the Voice Channel where Attila is located
 * @param {import('discord.js').Client} client 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function joinAttilaVoiceChannel(client) {
  const { isAzuraSleeping } = require('./sleepMode');
  if (isAzuraSleeping && isAzuraSleeping()) {
    return { success: false, message: '🌙 AZURA sedang dalam Mode Tidur (Deep Sleep). Bangunkan dulu dengan `/sleep aksi:bangun password:@Timetosleepara`.' };
  }

  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) {
    return { success: false, message: 'Owner ID belum diset di .env' };
  }

  let targetVoiceChannel = null;
  let targetGuild = null;

  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(ownerId).catch(() => null);
    if (member && member.voice && member.voice.channel) {
      targetVoiceChannel = member.voice.channel;
      targetGuild = guild;
      break;
    }
  }

  if (!targetVoiceChannel || !targetGuild) {
    return {
      success: false,
      message: 'Attila sayang, kamu belum masuk Voice Channel mana pun nih. Masuk dulu ke salah satu VC yaa, nanti aku langsung nyusul! [laughs]'
    };
  }

  const guildId = targetGuild.id;

  // Emotional Awareness Check: If severe pouty mood, refuse 1st attempt
  const { handlePoutyVcJoinDecision } = require('./poutyMood');
  const poutyDecision = handlePoutyVcJoinDecision(guildId, client);
  if (!poutyDecision.allowJoin) {
    const textChannel = (targetVoiceChannel && targetVoiceChannel.isTextBased?.()) ? targetVoiceChannel : findBestTextChannel(targetGuild, targetVoiceChannel, client);
    if (textChannel && poutyDecision.refuseNotice) {
      await textChannel.send(poutyDecision.refuseNotice).catch(() => {});
    }
    return {
      success: false,
      message: poutyDecision.refuseNotice || 'Azura sedang ngambek parah.'
    };
  }

  // Clear dismissed state so AZURA is officially active again
  dismissedGuilds.delete(guildId);
  voiceChatHistories.delete(ownerId);

  // Clean up any existing connection on Discord Gateway before instantiating new one
  try {
    const existingDjsConn = getVoiceConnection(guildId);
    if (existingDjsConn) {
      existingDjsConn.destroy();
      await new Promise(r => setTimeout(r, 400));
    }
  } catch (_) {}
  activeConnections.delete(guildId);

  try {
    voiceSessions.set(guildId, {
      startTime: new Date(),
      channelName: targetVoiceChannel.name,
      guildName: targetGuild.name,
      entries: []
    });

    const connection = joinVoiceChannel({
      channelId: targetVoiceChannel.id,
      guildId: guildId,
      adapterCreator: targetGuild.voiceAdapterCreator,
      selfMute: false,
      selfDeaf: false,
    });

    await waitForConnectionReady(connection, 20_000);
    activeConnections.set(guildId, connection);

    const player = createAudioPlayer();
    audioPlayers.set(guildId, player);
    connection.subscribe(player);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 8_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 8_000),
        ]);
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        let attilaStillInVc = false;
        try {
          const currentGuild = client.guilds.cache.get(guildId);
          const attilaMember = await currentGuild?.members.fetch(config.OWNER_DISCORD_ID).catch(() => null);
          if (attilaMember && attilaMember.voice && attilaMember.voice.channel) {
            attilaStillInVc = true;
          }
        } catch (_) {}

        if (!attilaStillInVc) {
          await cleanupGuild(guildId, client);
        } else {
          try {
            connection.rejoin({ selfMute: true, selfDeaf: false });
          } catch (_) {}
        }
      }
    });

    const textChannel = findBestTextChannel(targetGuild, targetVoiceChannel, client);
    if (textChannel) {
      companionTextChannels.set(guildId, textChannel);
      await textChannel.send('aku ikut kamu yaa').catch(() => {});
    }

    startVoiceListener(connection, guildId, client, targetVoiceChannel);

    // Play requested greeting: "Yeyy, join lagi, Makasih Attila! [laughs]"
    const joinGreeting = 'Yeyy, join lagi, Makasih Attila! [laughs]';
    const audioResource = await textToAudioResource(joinGreeting, client);
    if (audioResource) {
      await playInVC(guildId, audioResource);
    }

    const otherCount = targetVoiceChannel?.members
      ? targetVoiceChannel.members.filter(m => !m.user.bot && m.id !== config.OWNER_DISCORD_ID).size
      : 0;

    if (otherCount === 0) {
      setActiveMode(guildId);
      console.log(`[Join VC Controller]: Solo VC detected. Mode: ACTIVE (Free-flowing conversation ready).`);
    } else {
      setPassiveMode(guildId);
      console.log(`[Join VC Controller]: Crowded VC detected (${otherCount} friends). Mode: PASSIVE (Waiting for wake-word).`);
    }

    resetIdleTimer(guildId, client, targetVoiceChannel);

    return {
      success: true,
      message: `Yeyy, join lagi, Makasih Attila! [laughs] (AZURA masuk ke #${targetVoiceChannel.name})`
    };
  } catch (err) {
    console.error('[Join VC Error]:', err.message);
    try {
      const failedConn = getVoiceConnection(guildId);
      if (failedConn) failedConn.destroy();
    } catch (_) {}
    activeConnections.delete(guildId);
    return {
      success: false,
      message: `Gagal join ke VC: ${err.message}`
    };
  }
}

/**
 * Programmatically leave Voice Channel (Forced Guaranteed Disconnect)
 * Uses 3-layer disconnect: setChannel(null) -> destroy() -> raw Gateway Opcode 4
 * @param {import('discord.js').Client} client 
 * @param {string} guildId 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function leaveVoiceChannel(client, guildId = null, sendFarewellText = true) {
  const textLeave = 'Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya, babay!';

  console.log('[Leave VC Controller]: Forcibly disconnecting AZURA from Voice Channels...');

  // Send text farewell immediately (non-blocking) only if standalone message requested
  if (guildId && sendFarewellText) {
    const textChannel = companionTextChannels.get(guildId);
    if (textChannel) {
      textChannel.send(textLeave).catch(() => {});
    }
  }

  // Skip TTS farewell — just disconnect IMMEDIATELY for reliability
  // (User's #1 complaint is "she won't leave". Speed > politeness.)

  // If specific guild, cleanup that guild and mark dismissed
  if (guildId) {
    dismissedGuilds.add(guildId);
    await cleanupGuild(guildId, client);
  }

  // Also brute-force disconnect from ALL guilds where bot is in a voice channel
  if (client && client.guilds && client.guilds.cache) {
    for (const guild of client.guilds.cache.values()) {
      try {
        const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
        if (me && me.voice && me.voice.channel) {
          console.log(`[Leave VC]: Brute force setChannel(null) from #${me.voice.channel.name} in "${guild.name}"`);
          await me.voice.setChannel(null).catch(() => {});
        }
      } catch (_) {}
    }
  }

  // Clear all remaining local state
  for (const [gid] of activeConnections) {
    if (gid !== guildId) { // Don't double-cleanup
      await cleanupGuild(gid, client);
    }
  }
  activeConnections.clear();
  audioPlayers.clear();
  companionTextChannels.clear();
  isBotSpeaking.clear();
  activeRecordings.clear();

  return { success: true, message: textLeave };
}

/**
 * Say a natural, personality-tailored bedtime farewell in all active Voice Channels
 * BEFORE entering deep sleep mode.
 * @param {import('discord.js').Client} client 
 * @returns {Promise<void>}
 */
async function sayBedtimeFarewellInActiveVCs(client) {
  if (!activeConnections.size) return;

  const { getPersonalityMode, PERSONALITY_MODES } = require('./personality');
  const currentMode = getPersonalityMode();
  const ownerId = config.OWNER_DISCORD_ID;

  console.log(`[Bedtime Farewell]: 🌙 Speaking bedtime farewell across ${activeConnections.size} active VC(s) (Personality: ${currentMode})...`);

  for (const [guildId, conn] of activeConnections) {
    try {
      const player = audioPlayers.get(guildId);
      const guild = client.guilds.cache.get(guildId);
      if (!conn || !player || !guild) continue;

      const channelId = conn.joinConfig?.channelId;
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.members) continue;

      // Determine who is in VC
      const hasAttila = ownerId && channel.members.has(ownerId);
      const otherMembers = channel.members.filter(m => !m.user.bot && m.id !== ownerId);
      const isSoloAttila = hasAttila && otherMembers.size === 0;

      // Build personality-adapted bedtime farewell
      let farewellText = '';

      if (currentMode === PERSONALITY_MODES.MATURE) {
        if (isSoloAttila) {
          farewellText = 'Attila, udah waktunya tidur nih. Mataku udah nggak bisa diajak kompromi lagi [chuckles]. Aku istirahat duluan ya, kamu jangan begadang juga. Besok kita lanjut lagi ya. Good night.';
        } else {
          farewellText = 'Semuanya, aku pamit tidur duluan ya, udah waktunya istirahat. Selamat malam, besok kita ngobrol lagi ya.';
        }
      } else if (currentMode === PERSONALITY_MODES.STUBBORN) {
        if (isSoloAttila) {
          farewellText = 'Hooamm... [yawns] Jangan diliatin terus, aku beneran ngantuk ini. Aku mau tidur duluan, kamu juga jangan lembur mulu. Besok awas kalau nggak VC lagi... daah.';
        } else {
          farewellText = 'Dah ah, mata gue udah sepet banget dengerin kalian ngoceh [sighs]. Gue tidur duluan ya, besok aja kalau mau ngobrol lagi. Bye.';
        }
      } else {
        // ORIGINAL SOUL
        if (isSoloAttila) {
          farewellText = 'Attila sayang, mataku udah bener-bener berat banget nih... [yawns] Aku pamit tidur duluan yaa, kamu jangan begadang juga. Besok kita VC lagi yaa, night night! [softly]';
        } else {
          farewellText = 'Gais, aku udah ngantuk banget nih [yawns]... aku off duluan ya mau tidur, besok kita lanjut ngobrol lagi. Babayy semuanya!';
        }
      }

      // 1. Send clean text version to companion text channel
      const textChannel = companionTextChannels.get(guildId);
      if (textChannel) {
        const cleanText = farewellText.replace(/\[.*?\]/g, '').trim();
        textChannel.send(`🌙 **[Waktunya Tidur]** ${cleanText}`).catch(() => {});
      }

      // 2. Play audio resource via ElevenLabs v3 (Full Emotional & Audio Tags Model) and wait for completion
      const resource = await textToAudioResource(farewellText, client, 2000, { forcedModel: 'eleven_v3' });
      if (resource) {
        player.play(resource);
        isBotSpeaking.set(guildId, true);

        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            isBotSpeaking.set(guildId, false);
            resolve();
          }, 8000); // 8s max duration for farewell

          const onIdle = () => {
            clearTimeout(timeout);
            isBotSpeaking.set(guildId, false);
            player.removeListener(AudioPlayerStatus.Idle, onIdle);
            player.removeListener('error', onIdle);
            resolve();
          };

          player.once(AudioPlayerStatus.Idle, onIdle);
          player.once('error', onIdle);
        });
      }

      // Small pause after speech for realistic finish
      await new Promise(r => setTimeout(r, 600));

    } catch (err) {
      console.warn(`[Bedtime Farewell Warning]: Failed to speak farewell in guild ${guildId}:`, err.message);
    }
  }
}

/**
 * Asynchronously broadcast Live Game Commentary in VC
 * @param {string} guildId 
 * @param {string} commentaryText 
 * @param {import('discord.js').Client} [clientInstance] 
 */
async function speakGameCommentary(guildId, commentaryText, clientInstance = null) {
  if (!guildId || !commentaryText) return;
  const session = activeVoiceSessions.get(guildId);
  if (!session || !session.connection || !session.player) return;

  console.log(`[Voice Game Commentary] (${guildId}): 🎙️ "${commentaryText}"`);
  try {
    recordSessionEntry(guildId, 'AZURA', commentaryText);
    const audioResource = await textToAudioResource(commentaryText, clientInstance || session.client, 2500, { forcedModel: 'eleven_v3' });
    if (audioResource) {
      await playInVC(guildId, audioResource);
    }
  } catch (err) {
    console.error('[Voice Game Commentary Error]:', err.message);
  }
}

module.exports = {
  handleVoiceStateUpdate,
  getCompanionTextChannel,
  isInCompanionMode,
  handleMusicButton,
  joinAttilaVoiceChannel,
  leaveVoiceChannel,
  sayBedtimeFarewellInActiveVCs,
  playMusicAutonomous,
  getActiveVoiceSession,
  getLiveVoiceTranscriptContext,
  generateLiveVoiceSummary,
  generateVoiceAIResponse,
  recordSessionEntry,
  speakTextInVC,
  speakGameCommentary,
  detectVoiceModel,
  textToAudioResource,
  audioPlayers,
  activeConnections,
  voiceSessions,
  WHISPER_HALLUCINATIONS,
  SPONTANEOUS_SONGS,
  analyzeVoiceIntent,
  isWakeWordInvoked
};

