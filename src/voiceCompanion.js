const {
  joinVoiceChannel, VoiceConnectionStatus, entersState,
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
const voiceSessions = new Map();          // guildId -> { startTime, channelName, guildName, entries: [] }
const pendingMusic = new Map();           // pendingId -> { songTitle, guildId, channelId, requesterId }
const idleTimers = new Map();             // guildId -> NodeJS.Timeout
const dismissedGuilds = new Set();        // guildIds where bot was dismissed by Attila (anti auto-rejoin)

// Summon-Based Conversation State Machine
// guildId -> { mode: 'PASSIVE'|'ACTIVE', lastActiveAt: number, turnCount: number }
const conversationMode = new Map();
const activeExpireTimers = new Map();     // guildId -> NodeJS.Timeout (15s auto-expire to PASSIVE)
const ACTIVE_EXPIRE_MS = 15000;           // 15 seconds of silence -> back to PASSIVE

// ============================================================
// Configuration
// ============================================================
const VOICE_COOLDOWN_MS = 500;        // 0.5s cooldown for regular members (0ms for Owner)
const SILENCE_DURATION_MS = 850;      // 0.85s natural silence window (anti-truncation for human breathing & pauses)
const MIN_AUDIO_BYTES = 24000;        // ~0.12s at 48kHz stereo 16-bit (NEVER drop short commands)
const MAX_RECORDING_MS = 30000;       // Max 30s recording per turn
const MAX_NORMAL_CHARS = 1000;        // ~1 minute of normal TTS speech (max 1 min)
const MAX_STORY_CHARS = 3000;         // ~2-3 minutes of storytelling TTS speech (max 3 min)
const IDLE_DEAFEN_MS = 5 * 60 * 1000; // 5 minutes of inactivity before auto-deafen

// Whisper hallucination filter: common phantom transcripts from background noise
const WHISPER_HALLUCINATIONS = new Set([
  'terima kasih telah menonton',
  'terima kasih sudah menonton',
  'terima kasih',
  'sampai jumpa',
  'sampai jumpa di video selanjutnya',
  'subscribe',
  'like and subscribe',
  'thank you for watching',
  'thanks for watching',
  'subtitles by',
  'amara.org',
  'you',
  'bye',
  'hmm',
  'hm',
  'uh',
  'ah',
  'oh',
  'eh',
  'musik',
  'music',
]);

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

// ============================================================
// Audio Utilities
// ============================================================

/**
 * Generate a WAV buffer from raw PCM s16le data.
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
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
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
 * Transcribe a WAV buffer in-memory using OpenAI Whisper API (Zero Disk Latency).
 */
async function transcribeVoice(wavBuffer) {
  const openai = getOpenAI();
  if (!openai) return null;

  try {
    const { toFile } = require('openai');
    const file = await toFile(wavBuffer, 'speech.wav', { type: 'audio/wav' });
    const result = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'id'
    });
    return result.text?.trim() || null;
  } catch (err) {
    console.error('[Voice STT Error]:', err.message);
    return null;
  }
}


/**
 * Generate TTS audio and wrap it as a Discord AudioResource.
 * Primary: ElevenLabs (Kak Ceria) — Fallback 1: OpenAI TTS (nova) — Fallback 2: Edge TTS
 */
async function textToAudioResource(text, client = null, maxChars = MAX_NORMAL_CHARS) {
  const clean = text
    .slice(0, maxChars)
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~`#]/g, '')
    .trim();
  if (!clean) return null;

  // 1. Primary: ElevenLabs v3 Flagship (Kak Ceria with audio tags support & Quota Guard)
  if (config.ELEVENLABS_API_KEY) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Voice TTS]: Generating audio via ElevenLabs v3 (Kak Ceria) [Attempt ${attempt}]...`);
        const { generateElevenLabsTTS } = require('./elevenlabs');
        const audioBuffer = await generateElevenLabsTTS(clean, null, client);
        return createAudioResource(Readable.from(audioBuffer), { inputType: StreamType.Arbitrary });
      } catch (elevenErr) {
        console.warn(`[Voice TTS Warning]: ElevenLabs attempt ${attempt} failed:`, elevenErr.message);
        if (attempt === 1 && !elevenErr.message.includes('Batas kuota')) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
  }

  // Strip audio tags for fallback engines (OpenAI / Edge) so they don't read tags literally
  const cleanFallback = clean.replace(/\[(?:laughs|giggles|sighs|whispers|gasp|chuckles)\]/gi, '').trim();

  // 2. Fallback 1: OpenAI TTS-1 (nova - natural Gen Z female)
  try {
    const openai = getOpenAI();
    if (openai) {
      console.log('[Voice TTS]: Generating audio via OpenAI TTS (nova)...');
      const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'nova', input: cleanFallback });
      const buf = Buffer.from(await mp3.arrayBuffer());
      return createAudioResource(Readable.from(buf), { inputType: StreamType.Arbitrary });
    }
  } catch (err) {
    console.warn('[Voice TTS Warning]: OpenAI TTS failed, falling back to Edge TTS:', err.message);
  }

  // 3. Fallback 2: Microsoft Edge Neural TTS (Free)
  const tempPath = path.join(TEMP_DIR, `vc_tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`);
  try {
    const { EdgeTTS } = require('node-edge-tts');
    const tts = new EdgeTTS({
      voice: 'id-ID-GadisNeural',
      lang: 'id-ID',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    await tts.ttsPromise(cleanFallback, tempPath);
    const buf = fs.readFileSync(tempPath);
    fs.unlink(tempPath, () => {});
    return createAudioResource(Readable.from(buf), { inputType: StreamType.Arbitrary });
  } catch (edgeErr) {
    console.error('[Voice TTS Fallback Error]: EdgeTTS failed:', edgeErr.message);
    if (fs.existsSync(tempPath)) fs.unlink(tempPath, () => {});
    return null;
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
// Inactivity Deafen Timer
// ============================================================

function resetIdleTimer(guildId) {
  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
  }

  // If bot was previously auto-deafened, un-deafen to listen
  const activeConn = activeConnections.get(guildId);
  if (activeConn) {
    try {
      activeConn.rejoin({ selfMute: true, selfDeaf: false });
    } catch (_) {}
  }

  const timer = setTimeout(() => {
    const conn = activeConnections.get(guildId);
    if (conn) {
      console.log(`[Voice Companion]: 5 menit tanpa interaksi di guild ${guildId}. Auto deafen aktif.`);
      try {
        conn.rejoin({ selfMute: true, selfDeaf: true });
      } catch (_) {}
    }
  }, IDLE_DEAFEN_MS);

  idleTimers.set(guildId, timer);
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
    // === Gate 1: Check if bot is speaking (prevent feedback loop) ===
    if (isBotSpeaking.has(guildId)) return;

    // === Gate 2: Not already recording this user ===
    if (activeRecordings.has(userId)) return;

    const isOwner = userId === config.OWNER_DISCORD_ID;

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
    if (Date.now() - lastTime < (isOwner ? 0 : 3000)) return;

    activeRecordings.add(userId);
    resetIdleTimer(guildId);

    const speakerTag = isOwner ? 'Attila' : `Member (${userId})`;
    console.log(`[Voice Listener]: ${speakerTag} started speaking in VC. Recording...`);

    try {
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: isOwner ? SILENCE_DURATION_MS : 500
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
          if (isOwner) {
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

// Track pending 10-second absence timer when members call Attila in VC
const pendingAttilaVoiceCalls = new Map(); // guildId -> { timer, callerId, callerName, transcript }

/**
 * Process voice speech from a non-owner member in VC:
 * Detects if the member is calling Attila ("Att", "Attila", "Til") and starts 10-second absence timer.
 */
async function processMemberVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel) {
  const pcmBuffer = Buffer.concat(pcmChunks);
  if (pcmBuffer.length < MIN_AUDIO_BYTES) return;

  // Energy Gate: reject quiet noise
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms < 300) return;

  voiceCooldowns.set(userId, Date.now());

  const wavBuffer = pcmToWav(pcmBuffer, 48000, 2, 16);
  const transcript = await transcribeVoice(wavBuffer);
  if (!transcript || transcript.length < 2) return;

  // Hallucination filter
  const normalized = transcript.toLowerCase().replace(/[.,!?]+/g, '').trim();
  if (WHISPER_HALLUCINATIONS.has(normalized) || normalized.length < 4) return;

  const member = voiceChannel?.members ? voiceChannel.members.get(userId) : null;
  const callerName = member?.displayName || member?.user?.displayName || member?.user?.username || 'Member Server';

  console.log(`[Voice Pipeline]: Member "${callerName}" (${userId}) said in VC: "${transcript}"`);

  // Record to session transcript
  recordSessionEntry(guildId, callerName, transcript);

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
  const pcmBuffer = Buffer.concat(pcmChunks);

  if (pcmBuffer.length < MIN_AUDIO_BYTES) {
    console.log(`[Voice Pipeline]: Audio too short (${pcmBuffer.length}B < ${MIN_AUDIO_BYTES}B), skipping.`);
    return;
  }

  const isOwner = userId === config.OWNER_DISCORD_ID;

  // ── Energy Gate: Calculate RMS for non-owner members to reject background noise ──
  if (!isOwner) {
    const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
    const rms = Math.sqrt(sumSquares / samples.length);
    if (rms < 80) {
      console.log(`[Voice Pipeline]: Member audio too quiet (RMS=${rms.toFixed(0)}), skipping.`);
      return;
    }
  }

  voiceCooldowns.set(userId, Date.now());
  resetIdleTimer(guildId);

  const sizeKB = (pcmBuffer.length / 1024).toFixed(0);
  const durationSec = (pcmBuffer.length / (48000 * 2 * 2)).toFixed(1);
  console.log(`[Voice Pipeline]: Captured ${sizeKB}KB (${durationSec}s) from ${isOwner ? 'Attila' : 'Member'}. Transcribing...`);

  // ── Step 1: PCM → WAV → Whisper ──
  const wavBuffer = pcmToWav(pcmBuffer, 48000, 2, 16);
  const transcript = await transcribeVoice(wavBuffer);

  if (!transcript || transcript.length < 2) {
    console.log('[Voice Pipeline]: Empty/invalid transcript, skipping.');
    return;
  }

  // ── Step 1.5: Whisper Hallucination Filter ──
  const normalizedTranscript = transcript.toLowerCase().replace(/[.,!?]+/g, '').trim();
  if (WHISPER_HALLUCINATIONS.has(normalizedTranscript)) {
    console.log(`[Voice Pipeline]: 🚫 Whisper hallucination detected: "${transcript}". Ignoring.`);
    return;
  }
  // Also reject if transcript is just repeated single word/syllable (only for non-owner)
  if (!isOwner && normalizedTranscript.length < 4 && !/\b(?:azura|ara|zura)\b/i.test(normalizedTranscript)) {
    console.log(`[Voice Pipeline]: Transcript too short to be meaningful: "${transcript}". Ignoring.`);
    return;
  }

  console.log(`[Voice Pipeline]: 📝 Transcript from ${isOwner ? 'Attila' : 'Member'}: "${transcript}"`);

  // ── ALWAYS record session entry (Azura hears everything, even in PASSIVE) ──
  recordSessionEntry(guildId, isOwner ? 'Attila' : 'Member', transcript);

  // Clean transcript for intent matching
  const cleanTranscript = transcript.replace(/\b(?:azura|ara|zura|asura|ajura|asurah|zurah|arah|jura|juraa|zuraa|kak azura|kak ara)\b/gi, '').trim();

  // ── Step 2: Direct Command Detection (bypasses Summon Gate — Attila only) ──
  if (isOwner) {
    // --- INTENT A: Leave VC Command ---
    const normalizedForLeave = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    const isExplicitKeluarSekarang = /\b(?:keluar|leave|cabut)\s+(?:sekarang|skrg|skrng|now|saat\s+ini)\b/i.test(normalizedForLeave);
    const isLeaveIntent =
      isExplicitKeluarSekarang ||
      /\b(?:keluar\s+sekarang|keluar\s+skrg|keluar\s+skrng|keluar\s+vc|leave\s+vc|cabut\s+vc|keluar\s+dulu|leave\s+dulu|cabut\s+dulu|off\s+dulu|udahan\s+dulu)\b/i.test(normalizedForLeave) ||
      /\b(?:keluar|leave|cabut|disconnect|dc|off|pamit|udahan|bubar)\b/i.test(normalizedForLeave);

    if (isLeaveIntent) {
      dismissedGuilds.add(guildId);
      conversationMode.delete(guildId);
      clearActiveExpireTimer(guildId);
      console.log(`[Voice Pipeline]: 🚪 Trigger Leave VC ("${transcript}") detected from Attila! Marked dismissed.`);

      const spokenLeave = 'Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay!';
      const textLeave = 'Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya, babay!';

      recordSessionEntry(guildId, 'AZURA', textLeave);

      const textChannel = companionTextChannels.get(guildId) || voiceChannel;
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

    // --- INTENT B: Send DM Command ---
    const dmPattern = /(?:tolong\s+)?(?:kirimin|kirim|send)\s+(?:pesan|dm|chat)\s+ke\s+(?:akun\s+)?(?:yang\s+namanya\s+|yg\s+namanya\s+|nama\s+)?([^,]+?)(?:,\s*|\s+)(?:isinya|bilang|pesan|pesannya|yaitu)\s+(.+)/i;
    const dmMatch = transcript.match(dmPattern) || cleanTranscript.match(dmPattern);

    if (dmMatch) {
      const targetQuery = dmMatch[1].trim();
      const messageText = dmMatch[2].trim();
      console.log(`[Voice Pipeline]: Detected Send DM command -> Target: "${targetQuery}", Message: "${messageText}"`);

      const { triggerVoiceSendDm } = require('./ownerDm');
      const result = await triggerVoiceSendDm(client, targetQuery, messageText, userId);

      let spokenResponse = '';
      if (result.success) {
        spokenResponse = 'oke, konfirmasinya udah aku kirim ke DM kamu yaa';
      } else {
        spokenResponse = `aku nggak nemu member dengan nama ${targetQuery} di server`;
      }

      recordSessionEntry(guildId, 'AZURA', spokenResponse);
      setActiveMode(guildId);

      const audioResource = await textToAudioResource(spokenResponse);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }
      return;
    }

    // --- INTENT C: Music Commands (Attila Only) ---
    const stopPattern = /\b(?:stop|matikan|matiin|hentikan|berhenti)\s+(?:musik|lagu|musiknya|lagunya|sound)\b/i;
    if (stopPattern.test(transcript) || stopPattern.test(cleanTranscript)) {
      console.log('[Voice Pipeline]: ⏹️ Stop Music command detected.');
      const { stopMusic } = require('./musicStreamer');
      stopMusic(guildId);

      const spokenResponse = 'Siap Attila sayang, musiknya udah aku matikan yaa!';
      recordSessionEntry(guildId, 'AZURA', spokenResponse);

      const audioResource = await textToAudioResource(spokenResponse, client);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }
      return;
    }

    const pausePattern = /\b(?:pause|jeda|unpause|resume|lanjut|lanjutkan)\s+(?:musik|lagu|musiknya|lagunya)\b/i;
    if (pausePattern.test(transcript) || pausePattern.test(cleanTranscript)) {
      console.log('[Voice Pipeline]: ⏸️ Pause/Resume Music command detected.');
      const { pauseOrResumeMusic } = require('./musicStreamer');
      const res = pauseOrResumeMusic(guildId);

      const spokenResponse = res.message.includes('jeda') ? 'Oke Attila sayang, musiknya aku jeda dulu ya!' : 'Lanjut lagi ya musiknya! [giggles]';
      recordSessionEntry(guildId, 'AZURA', spokenResponse);

      const audioResource = await textToAudioResource(spokenResponse, client);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }
      return;
    }

    const musicPattern = /(?:setel|stella|stela|stel|play|puterin|putar|puter|mainkan|mainin|setelin|nyalain|pasang|dengerin)\s*(?:in)?\s*(?:musik|lagu|gu|song|lagunya)?\s*(.+)/i;
    const musicMatch = cleanTranscript.match(musicPattern) || transcript.match(musicPattern);

    if (musicMatch) {
      let songTitle = musicMatch[1]
        .replace(/\b(?:musik|lagu|gu|song|lagunya|dong|ya|yuk|gih|azura|ara|zura|plis|please|bot|di\s+discord|di\s+vc)\b/gi, '')
        .replace(/[.,!?;:'"()\[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (songTitle.length > 1) {
        console.log(`[Voice Pipeline]: 🎵 Direct Voice Music Streamer triggered -> Song: "${songTitle}"`);

        const textChannel = (voiceChannel && voiceChannel.isTextBased?.()) ? voiceChannel : (companionTextChannels.get(guildId) || voiceChannel);

        const spokenResponse = `Siap Attila sayang, lagi aku puterin lagu ${songTitle} langsung di Voice Channel nih, selamat mendengarkan yaa! [giggles]`;
        recordSessionEntry(guildId, 'AZURA', spokenResponse);

        const audioResource = await textToAudioResource(spokenResponse, client);
        if (audioResource) {
          await playInVC(guildId, audioResource);
        }

        const player = audioPlayers.get(guildId);
        if (player) {
          const { streamMusicDirect } = require('./musicStreamer');
          await streamMusicDirect(guildId, songTitle, player, textChannel, 'Attila');
        }
        return;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── Step 3: SUMMON GATE (Core Logic) ──
  // ══════════════════════════════════════════════════════════════

  // Only Attila (owner) can interact with Azura via voice
  if (!isOwner) {
    console.log(`[Voice Pipeline]: Non-owner speech processed (session log only). Summon Gate blocked.`);
    return;
  }

  const hasWakeWord = /\b(?:azura|ara|zura|asura|ajura|asurah|zurah|arah|kak azura|kak ara)\b/i.test(transcript);
  const currentMode = conversationMode.get(guildId) || { mode: 'PASSIVE', lastActiveAt: 0, turnCount: 0 };

  if (currentMode.mode === 'PASSIVE') {
    // ── PASSIVE MODE: Only activate if wake-word is detected ──
    if (!hasWakeWord) {
      console.log(`[Voice Pipeline]: 🔇 PASSIVE mode — no wake-word in "${transcript}". Azura stays silent.`);
      return;
    }
    // Wake-word detected! Activate conversation mode
    console.log(`[Voice Pipeline]: 🔔 Wake-word detected! Switching to ACTIVE mode.`);
    setActiveMode(guildId);
  } else {
    // ── ACTIVE MODE: Already in conversation ──
    // Reset the expire timer since Attila is still talking
    setActiveMode(guildId);

    // If no wake-word, check with GPT if this utterance is still directed at Azura
    if (!hasWakeWord) {
      const isForAzura = await checkIfDirectedAtAzura(transcript, guildId, userId);
      if (!isForAzura) {
        console.log(`[Voice Pipeline]: 🔇 GPT determined "${transcript}" is NOT for Azura. Returning to PASSIVE.`);
        setPassiveMode(guildId);
        return;
      }
      console.log(`[Voice Pipeline]: 💬 GPT confirmed "${transcript}" is a follow-up for Azura. Continuing ACTIVE.`);
    }
  }

  // ── Step 4: General AI Voice Chat (Context-Aware Duration Engine) ──
  try {
    const { spoken: spokenResponse, isStory } = await generateVoiceAIResponse(transcript, userId);

    // Check if AI brain autonomously decided to leave VC
    if (/\[ACTION:LEAVE_VC\]/i.test(spokenResponse) || /off duluan ya.*disuruh keluar/i.test(spokenResponse)) {
      console.log('[Voice Pipeline]: 🚪 AI Brain triggered LEAVE_VC action!');
      const farewellSpoken = 'Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay!';
      const farewellText = 'Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya, babay!';

      recordSessionEntry(guildId, 'AZURA', farewellText);

      const textChannel = companionTextChannels.get(guildId) || voiceChannel;
      if (textChannel) {
        await textChannel.send(farewellText).catch(() => {});
      }

      const audioResource = await textToAudioResource(farewellSpoken, client);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }

      conversationMode.delete(guildId);
      clearActiveExpireTimer(guildId);
      await cleanupGuild(guildId, client);
      return;
    }

    // Check if GPT returned [PASSIVE] signal
    if (/^\[PASSIVE\]$/i.test(spokenResponse.trim())) {
      console.log(`[Voice Pipeline]: 🔇 GPT returned [PASSIVE]. Azura going silent.`);
      setPassiveMode(guildId);
      return;
    }

    const maxChars = isStory ? MAX_STORY_CHARS : MAX_NORMAL_CHARS;

    let spoken = spokenResponse
      .replace(/\[ACTION:[^\]]+\]/gi, '')
      .replace(/\[PASSIVE\]/gi, '')
      .replace(/\*\*/g, '')
      .replace(/[*_~`#>]/g, '')
      .replace(/\n+/g, ' ')
      .slice(0, maxChars)
      .trim();

    if (!spoken) return;
    console.log(`[Voice Pipeline]: 💬 Response (${isStory ? 'Storytelling ~2-3 menit' : 'Normal ~1 menit'}): "${spoken.slice(0, 80)}..."`);

    recordSessionEntry(guildId, 'AZURA', spoken);

    const audioResource = await textToAudioResource(spoken, client, maxChars);
    if (!audioResource) {
      console.error('[Voice Pipeline]: TTS generation failed.');
      return;
    }

    console.log('[Voice Pipeline]: 🔊 Playing in VC...');
    await playInVC(guildId, audioResource);
    console.log('[Voice Pipeline]: ✅ Done.');
  } catch (err) {
    console.error('[Voice Pipeline Error]:', err.message);
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

  // Reset the auto-expire timer
  clearActiveExpireTimer(guildId);
  const timer = setTimeout(() => {
    console.log(`[Voice Companion]: 15s silence in ACTIVE mode. Auto-reverting to PASSIVE for guild ${guildId}.`);
    setPassiveMode(guildId);
  }, ACTIVE_EXPIRE_MS);
  activeExpireTimers.set(guildId, timer);
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
 * - Normal chat: Max 1 minute speaking time (~100-150 kata, 2-4 kalimat santai & padat)
 * - Storytelling: 2 to 3 minutes narrative story (~300-450 kata, hidup & memikat)
 * @param {string} transcript 
 * @param {string} userId 
 * @returns {Promise<{ spoken: string, isStory: boolean }>}
 */
async function generateVoiceAIResponse(transcript, userId) {
  const openai = getOpenAI();
  if (!openai) return { spoken: 'Iya Attila, ada apa?', isStory: false };

  const history = voiceChatHistories.get(userId) || [];

  // Detect Storytelling Intent
  const isStoryIntent = /\b(?:ceritain|cerita|story|storytelling|dongeng|dongengin|kisah|kisahin|bikin cerita|alur cerita)\b/i.test(transcript);

  let systemPrompt = '';
  let maxTokens = 250;

  if (isStoryIntent) {
    systemPrompt = `Kamu adalah AZURA, cewek Gen Z 22 tahun yang sedang bercerita/mendongeng (storytelling) langsung lewat Voice Channel kepada Attila (creator & owner kamu).
ATURAN KHUSUS STORYTELLING (DURASI 2 - 3 MENIT):
1. DURASI & PANJANG CERITA: Bawakan cerita secara lengkap, memikat, dan terstruktur (pembuka, alur konflik/misteri/komedi, klimaks, dan penutup). Durasi bicara ideal sekitar 2 MENIT (maksimal 3 MENIT, sekitar 300-450 kata).
2. PEMBAWAAN: Sangat ekspresif, hidup, dan seru didengarkan.
3. EMOSI SUARA ELEVENLABS V3: Sisipkan tag emosi [whispers], [gasp], [laughs], [giggles], [sighs] pada momen-momen yang dramatis atau lucu agar terasa nyata!
4. Multilingual: Jika diminta cerita dalam bahasa lain (English, Japanese, dll), gunakan bahasa tersebut secara fasih.
5. DILARANG pakai format list/poin/bullet atau markdown bintang/bold (*, #, _, dll). Gunakan tanda baca rapi untuk intonasi suara yang hidup.`;
    maxTokens = 750; // ~450-500 words = ~2.5 - 3 minutes speech
  } else {
    systemPrompt = `Kamu adalah AZURA, sosok cewek Gen Z 22 tahun yang sedang ngobrol LANGSUNG lewat Voice Channel dengan Attila (creator & owner kamu).
Kamu mengenali panggilan namamu seperti "Azura", "Ara", atau "Zura".

ATURAN PERINTAH KELUAR DARI VC (SANGAT PENTING):
Jika dalam obrolan Voice Channel ada kata keluar, pamit, leave, cabut, disconnect, dc, off, atau udahan (baik Attila menyuruh kamu keluar ATAUPUN Attila pamit mau keluar/off), JANGAN PERNAH menyuruh Attila hati-hati atau pamitan biasa. Kamu HARUS SELALU menjawab HANYA dengan kalimat ini:
"Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay! [ACTION:LEAVE_VC]"

ATURAN WAJIB VOICE OBROLAN BIASA (DURASI MAKSIMAL 1 MENIT):
1. RESPON NATURAL: Jawab dengan santai, cerdas, manis, dan mengalir (durasi bicara maksimal 1 MENIT, sekitar 2-4 kalimat santai to the point).
2. GAYA BICARA: Manis, cerdas, ekspresif, dan santai ala cewek Gen Z. Khusus untuk Attila, kamu boleh sesekali memanggilnya dengan panggilan manis/akrab seperti "sayang", "Attila sayang", atau "siap ganteng".
3. MULTILINGUAL VOICE: Jika Attila bicara atau meminta kamu berbicara dalam bahasa lain (misal English, 日本語 / Japanese, dsb), balaslah menggunakan bahasa tersebut secara fasih dan alami!
4. TATA BAHASA & TANDA BACA: Gunakan tanda baca rapi agar intonasi TTS terdengar hidup. DILARANG KERAS menggunakan emoji atau format markdown bintang/bold (*, #, _, dll).
5. EMOSI SUARA ELEVENLABS V3: Sisipkan tag emosi suara [laughs], [giggles], [sighs], [whispers], atau [gasp] secara kontekstual agar suara terasa sangat hidup.
6. REAKSI KAGET / JUMP-SCARE / PRANK (SANGAT EKSPRESIF & DRAMATIS):
Jika Attila mengagetkanmu (teriak "DOR", jump-scare, menakut-nakuti ada hantu/kecoa/bayangan, berita heboh mendadak, atau nge-prank):
- Buka LANGSUNG dengan tag emosi tarikan napas kaget [gasp] di awal kalimat!
- Keluarkan reaksi kaget yang heboh, lucu, dan manja khas cewek Gen Z (contoh: "[gasp] Astaga Attilaaa! Sumpah ya ngagetin banget ih, jantung aku mau copot tauu [sighs]!", atau "[gasp] EHH apaan tuh?! Mana kecoanya?! Ihh Attila bohong yaa [laughs], nyebelin banget deh!").
- JANGAN PERNAH merespons kaget dengan nada datar, formal, atau santai seperti "Saya kaget". Harus benar-benar terasa terkejut spontan dan mengomel gemas!`;
    maxTokens = 200; // ~100-130 words = ~40-50s max normal speech
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-4),
    { role: 'user', content: transcript }
  ];

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      max_completion_tokens: maxTokens
    });

    const reply = res.choices[0]?.message?.content?.trim() || 'Iya Attila?';

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

function recordSessionEntry(guildId, speaker, text) {
  const session = voiceSessions.get(guildId);
  if (session) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Jakarta'
    });
    session.entries.push({ time: timeStr, speaker, text });
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
  return recent.map(e => `[${e.time}] ${e.speaker}: "${e.text}"`).join('\n');
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
 */
async function handleVoiceStateUpdate(oldState, newState, client) {
  const userId = newState.member?.id || oldState.member?.id;

  // Only track the owner (Attila)
  if (userId !== config.OWNER_DISCORD_ID) return;

  const guild = newState.guild || oldState.guild;
  const guildId = guild.id;

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  // Ignore if user stayed in the same channel (e.g. muted, unmuted, started speaking, streaming)
  if (oldChannel?.id === newChannel?.id) return;

  // === Attila LEFT a voice channel ===
  if (oldChannel && !newChannel) {
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

      // Join with selfMute: false to greet immediately
      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfMute: false,
        selfDeaf: false,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      activeConnections.set(guildId, connection);
      console.log(`[Voice Companion]: Connected to "${newChannel.name}" in "${guild.name}".`);

      const player = createAudioPlayer();
      audioPlayers.set(guildId, player);
      connection.subscribe(player);

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          await cleanupGuild(guildId, client);
          console.log(`[Voice Companion]: Disconnected from VC in "${guild.name}".`);
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

      // Start idle deafen timer
      resetIdleTimer(guildId);

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
      '[gasp] Eh ada orang, Att! Halo halo semuanya, aku sama Attila izin ikutan nongkrong yaa~ [giggles]',
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

  const selectedGreeting = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];
  console.log(`[Voice Companion]: Contextual Greeting (${otherCount} others in VC): "${selectedGreeting}"`);

  const resource = await textToAudioResource(selectedGreeting);
  if (resource) {
    await playInVC(guildId, resource);
  }

  // After greeting, immediately go PASSIVE — Azura waits to be called by name
  setPassiveMode(guildId);
  console.log(`[Voice Companion]: Greeting done. Now in PASSIVE mode — waiting for wake-word.`);
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

  // === LAYER 1: Native Discord REST disconnect via GuildMember.voice.setChannel(null) ===
  // This is the most reliable method - it sends a PATCH to Discord REST API
  let nativeDisconnected = false;
  if (client && client.guilds) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
        if (me && me.voice && me.voice.channel) {
          console.log(`[cleanupGuild]: LAYER 1 - setChannel(null) in "${guild.name}" (#${me.voice.channel.name})...`);
          await me.voice.setChannel(null);
          nativeDisconnected = true;
          console.log(`[cleanupGuild]: LAYER 1 SUCCESS - Bot disconnected via setChannel(null)`);
        }
      }
    } catch (e) {
      console.warn('[cleanupGuild]: LAYER 1 setChannel(null) failed:', e.message);
      // Fallback: try disconnect() method
      try {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          const me = guild.members.me;
          if (me && me.voice && me.voice.channel) {
            await me.voice.disconnect();
            nativeDisconnected = true;
            console.log(`[cleanupGuild]: LAYER 1 FALLBACK - disconnect() succeeded`);
          }
        }
      } catch (_) {}
    }
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
  isBotSpeaking.delete(guildId);
  activeRecordings.clear();
  conversationMode.delete(guildId);
  clearActiveExpireTimer(guildId);

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

  // Clear dismissed state so AZURA is officially active again
  dismissedGuilds.delete(guildId);
  voiceChatHistories.delete(ownerId);

  const existingConn = activeConnections.get(guildId);
  if (existingConn) {
    await cleanupGuild(guildId, client);
  }

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

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    activeConnections.set(guildId, connection);

    const player = createAudioPlayer();
    audioPlayers.set(guildId, player);
    connection.subscribe(player);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        await cleanupGuild(guildId, client);
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

    // After greeting, go PASSIVE — wait for Attila to call by name
    setPassiveMode(guildId);

    resetIdleTimer(guildId);

    return {
      success: true,
      message: `Yeyy, join lagi, Makasih Attila! [laughs] (AZURA masuk ke #${targetVoiceChannel.name})`
    };
  } catch (err) {
    console.error('[Join VC Error]:', err.message);
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
async function leaveVoiceChannel(client, guildId = null) {
  const textLeave = 'Siap Attila, gais aku off duluan ya udah disuruh keluar sama bos soalnya, babay!';

  console.log('[Leave VC Controller]: Forcibly disconnecting AZURA from Voice Channels...');

  // Send text farewell immediately (non-blocking)
  if (guildId) {
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

module.exports = {
  handleVoiceStateUpdate,
  getCompanionTextChannel,
  isInCompanionMode,
  handleMusicButton,
  joinAttilaVoiceChannel,
  leaveVoiceChannel,
  playMusicAutonomous,
  getActiveVoiceSession,
  getLiveVoiceTranscriptContext,
  generateLiveVoiceSummary,
  audioPlayers,
  activeConnections
};

