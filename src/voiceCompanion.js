const {
  joinVoiceChannel, VoiceConnectionStatus, entersState,
  EndBehaviorType, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, StreamType
} = require('@discordjs/voice');
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

// ============================================================
// Configuration
// ============================================================
const VOICE_COOLDOWN_MS = 3000;       // 3 second cooldown between responses
const SILENCE_DURATION_MS = 1500;     // 1.5s silence = speech ended
const MIN_AUDIO_BYTES = 48000;        // ~0.25s at 48kHz stereo 16-bit (skip noise/coughs)
const MAX_RECORDING_MS = 30000;       // Max 30s recording per turn
const MAX_RESPONSE_CHARS = 300;       // ~15 seconds of TTS speech

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ============================================================
// Lazy Loaders (avoid circular deps & conditional requires)
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
      console.error('[Voice]: prism-media not installed. Run: npm install prism-media opusscript');
    }
  }
  return _prism;
}

// ============================================================
// Audio Utilities
// ============================================================

/**
 * Generate a WAV buffer from raw PCM s16le data.
 * @param {Buffer} pcmBuffer - Raw PCM samples (signed 16-bit little-endian)
 * @param {number} sampleRate
 * @param {number} channels
 * @param {number} bitsPerSample
 * @returns {Buffer} Complete WAV file in memory
 */
function pcmToWav(pcmBuffer, sampleRate = 48000, channels = 2, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Transcribe a WAV buffer using OpenAI Whisper API.
 * @param {Buffer} wavBuffer
 * @returns {Promise<string|null>}
 */
async function transcribeVoice(wavBuffer) {
  const openai = getOpenAI();
  if (!openai) return null;

  const tempPath = path.join(TEMP_DIR, `vc_stt_${Date.now()}.wav`);
  try {
    fs.writeFileSync(tempPath, wavBuffer);
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'id'
    });
    fs.unlink(tempPath, () => {});
    return result.text?.trim() || null;
  } catch (err) {
    console.error('[Voice STT Error]:', err.message);
    fs.unlink(tempPath, () => {});
    return null;
  }
}

/**
 * Generate TTS audio and wrap it as a Discord AudioResource.
 * Primary: Edge TTS (GadisNeural, free) — Fallback: OpenAI TTS-1 (shimmer)
 * @param {string} text
 * @returns {Promise<import('@discordjs/voice').AudioResource|null>}
 */
async function textToAudioResource(text) {
  const clean = text
    .slice(0, MAX_RESPONSE_CHARS)
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~`#]/g, '')
    .trim();
  if (!clean) return null;

  const tempPath = path.join(TEMP_DIR, `vc_tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`);

  // --- Primary: Microsoft Edge Neural TTS (free, fast) ---
  try {
    const { EdgeTTS } = require('node-edge-tts');
    const tts = new EdgeTTS({
      voice: 'id-ID-GadisNeural',
      lang: 'id-ID',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    await tts.ttsPromise(clean, tempPath);
    const buf = fs.readFileSync(tempPath);
    fs.unlink(tempPath, () => {});
    return createAudioResource(Readable.from(buf), { inputType: StreamType.Arbitrary });
  } catch (edgeErr) {
    console.warn('[Voice TTS]: EdgeTTS failed, trying OpenAI TTS:', edgeErr.message);
    fs.unlink(tempPath, () => {});
  }

  // --- Fallback: OpenAI TTS-1 ---
  try {
    const openai = getOpenAI();
    if (!openai) return null;
    const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'shimmer', input: clean });
    const buf = Buffer.from(await mp3.arrayBuffer());
    return createAudioResource(Readable.from(buf), { inputType: StreamType.Arbitrary });
  } catch (err) {
    console.error('[Voice TTS Fallback Error]:', err.message);
    return null;
  }
}

// ============================================================
// Voice Playback
// ============================================================

/**
 * Play an AudioResource in a guild's VC.
 * Automatically manages isBotSpeaking state.
 * @param {string} guildId
 * @param {import('@discordjs/voice').AudioResource} resource
 * @returns {Promise<void>} resolves when playback ends
 */
function playInVC(guildId, resource) {
  return new Promise((resolve) => {
    const player = audioPlayers.get(guildId);
    const conn = activeConnections.get(guildId);
    if (!player || !conn || !resource) return resolve();

    isBotSpeaking.add(guildId);
    player.play(resource);

    const cleanup = () => {
      isBotSpeaking.delete(guildId);
      resolve();
    };

    player.once(AudioPlayerStatus.Idle, cleanup);
    player.once('error', (err) => {
      console.error('[Voice Player Error]:', err.message);
      cleanup();
    });
  });
}

// ============================================================
// Voice Conversation Pipeline (Core)
// ============================================================

/**
 * Start listening to voice activity on a connection.
 * Only processes audio from the Owner (Attila).
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {string} guildId
 */
function startVoiceListener(connection, guildId) {
  const prism = getPrism();
  if (!prism) {
    console.warn('[Voice Listener]: Disabled — prism-media not available.');
    return;
  }

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    // === Gate 1: Owner only ===
    if (userId !== config.OWNER_DISCORD_ID) return;

    // === Gate 2: Not already recording this user ===
    if (activeRecordings.has(userId)) return;

    // === Gate 3: Bot is not speaking (prevent feedback loop) ===
    if (isBotSpeaking.has(guildId)) return;

    // === Gate 4: Cooldown ===
    const lastTime = voiceCooldowns.get(userId) || 0;
    if (Date.now() - lastTime < VOICE_COOLDOWN_MS) return;

    activeRecordings.add(userId);
    console.log('[Voice Listener]: Attila started speaking. Recording...');

    try {
      // Subscribe to Opus stream from this user
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_DURATION_MS
        }
      });

      // Decode Opus → PCM s16le (48 kHz, stereo — Discord native)
      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const pcmChunks = [];
      const pcmStream = opusStream.pipe(decoder);

      // Safety: max recording timeout
      const maxTimer = setTimeout(() => {
        console.log('[Voice Listener]: Max recording duration reached (30s). Stopping.');
        opusStream.destroy();
      }, MAX_RECORDING_MS);

      pcmStream.on('data', (chunk) => pcmChunks.push(chunk));

      pcmStream.on('end', () => {
        clearTimeout(maxTimer);
        activeRecordings.delete(userId);
        processVoiceSpeech(guildId, userId, pcmChunks).catch(err => {
          console.error('[Voice Pipeline Fatal]:', err.message);
        });
      });

      pcmStream.on('error', (err) => {
        clearTimeout(maxTimer);
        activeRecordings.delete(userId);
        console.error('[Voice Decoder Error]:', err.message);
      });

      opusStream.on('error', (err) => {
        clearTimeout(maxTimer);
        activeRecordings.delete(userId);
        console.error('[Voice Opus Error]:', err.message);
      });
    } catch (err) {
      activeRecordings.delete(userId);
      console.error('[Voice Subscribe Error]:', err.message);
    }
  });

  console.log(`[Voice Listener]: Active — listening for Attila's voice in guild ${guildId}`);
}

/**
 * Full pipeline: PCM audio → Whisper STT → AI response → TTS → VC playback.
 * @param {string} guildId
 * @param {string} userId
 * @param {Buffer[]} pcmChunks
 */
async function processVoiceSpeech(guildId, userId, pcmChunks) {
  const pcmBuffer = Buffer.concat(pcmChunks);

  // Skip very short audio (noise, cough, mic bumps)
  if (pcmBuffer.length < MIN_AUDIO_BYTES) {
    console.log(`[Voice Pipeline]: Audio too short (${pcmBuffer.length}B), skipping.`);
    return;
  }

  // Set cooldown immediately to prevent rapid-fire
  voiceCooldowns.set(userId, Date.now());

  const sizeKB = (pcmBuffer.length / 1024).toFixed(0);
  const durationSec = (pcmBuffer.length / (48000 * 2 * 2)).toFixed(1);
  console.log(`[Voice Pipeline]: Captured ${sizeKB}KB (${durationSec}s). Transcribing...`);

  // ── Step 1: PCM → WAV → Whisper ──
  const wavBuffer = pcmToWav(pcmBuffer, 48000, 2, 16);
  const transcript = await transcribeVoice(wavBuffer);

  if (!transcript || transcript.length < 2) {
    console.log('[Voice Pipeline]: Empty/invalid transcript, skipping.');
    return;
  }

  console.log(`[Voice Pipeline]: 📝 Transcript: "${transcript}"`);

  // ── Step 2: AI Response (voice mode = short, no markdown) ──
  try {
    const askAzura = getAskAzura();
    const voicePrompt =
      `[KAMU SEDANG NGOBROL DI VOICE CHANNEL. JAWAB SANGAT SINGKAT, MAKSIMAL 2 KALIMAT PENDEK. ` +
      `JANGAN PAKAI EMOJI, MARKDOWN, ATAU FORMAT APAPUN. BALAS NATURAL SEPERTI NGOBROL BIASA]: ${transcript}`;

    const aiResponse = await askAzura(userId, voicePrompt, 'Attila', [], false, null);

    // Clean markdown artifacts & truncate for voice
    let spoken = aiResponse
      .replace(/\*\*/g, '')
      .replace(/[*_~`#>]/g, '')
      .replace(/\n+/g, ' ')
      .slice(0, MAX_RESPONSE_CHARS)
      .trim();

    if (!spoken) return;
    console.log(`[Voice Pipeline]: 💬 Response: "${spoken}"`);

    // ── Step 3: TTS → AudioResource ──
    const audioResource = await textToAudioResource(spoken);
    if (!audioResource) {
      console.error('[Voice Pipeline]: TTS generation failed.');
      return;
    }

    // ── Step 4: Play in VC ──
    console.log('[Voice Pipeline]: 🔊 Playing in VC...');
    await playInVC(guildId, audioResource);
    console.log('[Voice Pipeline]: ✅ Done.');

    // ── Step 5: Log transcript to companion text channel ──
    const textCh = companionTextChannels.get(guildId);
    if (textCh) {
      textCh.send(`🎙️ **Attila** *(voice)*: "${transcript}"\n💬 **AZURA**: ${spoken}`).catch(() => {});
    }
  } catch (err) {
    console.error('[Voice Pipeline Error]:', err.message);
  }
}

// ============================================================
// Voice State Handler (Join / Leave / Move)
// ============================================================

/**
 * Called on voiceStateUpdate. If Attila joins/leaves VC, AZURA follows.
 * Now with full audio pipeline (selfMute: false, selfDeaf: false).
 */
async function handleVoiceStateUpdate(oldState, newState, client) {
  const userId = newState.member?.id || oldState.member?.id;

  // Only track the owner (Attila)
  if (userId !== config.OWNER_DISCORD_ID) return;

  const guild = newState.guild || oldState.guild;
  const guildId = guild.id;

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  // === Attila LEFT a voice channel (or switched away) ===
  if (oldChannel && (!newChannel || oldChannel.id !== newChannel?.id)) {
    cleanupGuild(guildId);
  }

  // === Attila JOINED a new voice channel ===
  if (newChannel) {
    // If already connected, destroy old connection first (channel switch)
    const existingConn = activeConnections.get(guildId);
    if (existingConn) {
      try { existingConn.destroy(); } catch (_) {}
      activeConnections.delete(guildId);
      audioPlayers.delete(guildId);
    }

    try {
      console.log(`[Voice Companion]: Attila masuk ke "${newChannel.name}". AZURA ikut join (voice mode)...`);

      // Join with hearing & speaking enabled for live voice conversation
      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfMute: false,    // Can speak
        selfDeaf: false,    // Can hear
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      activeConnections.set(guildId, connection);
      console.log(`[Voice Companion]: Connected to "${newChannel.name}" in "${guild.name}".`);

      // Create AudioPlayer for this guild and subscribe to connection
      const player = createAudioPlayer();
      audioPlayers.set(guildId, player);
      connection.subscribe(player);

      // Handle disconnection / forced removal
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          cleanupGuild(guildId);
          console.log(`[Voice Companion]: Disconnected from VC in "${guild.name}".`);
        }
      });

      // Find best text channel for logging transcripts
      const textChannel = findBestTextChannel(guild, newChannel, client);
      if (textChannel) {
        companionTextChannels.set(guildId, textChannel);
      }

      // Start the voice listener (audio receive pipeline)
      startVoiceListener(connection, guildId);

      // Play a greeting in VC (async, non-blocking)
      playGreeting(guildId).catch(() => {});

    } catch (error) {
      console.error(`[Voice Companion Error]: Failed to join "${newChannel.name}":`, error.message || error);
    }
  }
}

/**
 * Play a short greeting when AZURA joins the VC.
 */
async function playGreeting(guildId) {
  // Small delay to let connection stabilize
  await new Promise(r => setTimeout(r, 1000));

  const resource = await textToAudioResource('haii, aku di sini yaa!');
  if (resource) {
    await playInVC(guildId, resource);
    console.log('[Voice Companion]: Greeting played.');
  }
}

/**
 * Clean up all resources for a guild when leaving VC.
 */
function cleanupGuild(guildId) {
  const conn = activeConnections.get(guildId);
  if (conn) {
    try { conn.destroy(); } catch (_) {}
  }
  activeConnections.delete(guildId);
  companionTextChannels.delete(guildId);
  audioPlayers.delete(guildId);
  isBotSpeaking.delete(guildId);
  console.log(`[Voice Companion]: Cleaned up resources for guild ${guildId}.`);
}

// ============================================================
// Helpers (unchanged from original)
// ============================================================

/**
 * Find the best text channel to send companion messages in.
 * Priority:
 *   1. The voice channel itself (Discord built-in text-in-voice)
 *   2. A keyword-matched text channel (general, umum, chat, etc.)
 *   3. First accessible text channel in guild
 */
function findBestTextChannel(guild, voiceChannel, client) {
  const me = guild.members.cache.get(client.user.id);
  if (!me) return null;

  // Priority 1: Voice channel's built-in text
  try {
    if (voiceChannel.isTextBased?.() && voiceChannel.permissionsFor(me)?.has('SendMessages')) {
      return voiceChannel;
    }
  } catch (_) {}

  // Priority 2: Common named channels
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

/**
 * Get the tracked companion text channel for a guild.
 */
function getCompanionTextChannel(guildId) {
  return companionTextChannels.get(guildId) || null;
}

/**
 * Check if AZURA is currently in companion mode in a guild.
 */
function isInCompanionMode(guildId) {
  return activeConnections.has(guildId);
}

module.exports = {
  handleVoiceStateUpdate,
  getCompanionTextChannel,
  isInCompanionMode
};
