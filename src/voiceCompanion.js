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
const SILENCE_DURATION_MS = 850;      // 0.85s natural silence window (anti-truncation for human breathing & pauses)
const MIN_AUDIO_BYTES = 24000;        // ~0.12s at 48kHz stereo 16-bit (NEVER drop short commands)
const MAX_RECORDING_MS = 30000;       // Max 30s recording per turn
const MAX_NORMAL_CHARS = 1200;        // ~1.5 minutes of normal TTS speech (max 1m 30s)
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
 * Generate TTS audio and wrap it as a Discord AudioResource with Volume Booster & Natural Intonation.
 * Primary: ElevenLabs (Kak Ceria) — Fallback 1: OpenAI TTS-1-HD (nova) — Fallback 2: Edge TTS
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
    try {
      console.log('[Voice TTS]: Generating audio via ElevenLabs v3 (Kak Ceria)...');
      const { generateElevenLabsTTS } = require('./elevenlabs');
      const audioBuffer = await generateElevenLabsTTS(clean, null, client);
      const resource = createAudioResource(Readable.from(audioBuffer), {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      if (resource.volume) {
        resource.volume.setVolume(1.4); // +3dB balanced clarity
      }
      return resource;
    } catch (elevenErr) {
      console.warn('[Voice TTS Warning]: ElevenLabs failed, fast-switching to OpenAI TTS:', elevenErr.message);
    }
  }

  // Convert audio tags into natural conversational Indonesian interjections for Fallback TTS
  const naturalFallbackText = prepareNaturalTextForFallbackTts(clean);
  const vtuberMode = config.VTUBER_VOICE_MODE || 'openai_shimmer';

  // 2. Fallback 1: OpenAI TTS-1-HD (Shimmer = Soft Kawaii VTuber, Nova = Energetic Gen Z)
  try {
    const openai = getOpenAI();
    if (openai && vtuberMode.startsWith('openai')) {
      const selectedOpenAiVoice = vtuberMode === 'openai_nova' ? 'nova' : 'shimmer';
      console.log(`[Voice TTS]: 🎀 Generating cute VTuber audio via OpenAI TTS-1-HD (${selectedOpenAiVoice} kawaii voice with 220% Volume Boost)...`);
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1-hd',
        voice: selectedOpenAiVoice,
        input: naturalFallbackText,
        speed: selectedOpenAiVoice === 'shimmer' ? 1.08 : 1.10 // Cute brisk intonation
      });
      const buf = Buffer.from(await mp3.arrayBuffer());
      const resource = createAudioResource(Readable.from(buf), {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      if (resource.volume) {
        resource.volume.setVolume(2.2); // Loud & clear volume boost (220%)
      }
      return resource;
    }
  } catch (err) {
    console.warn('[Voice TTS Warning]: OpenAI TTS failed, falling back to Edge TTS:', err.message);
  }

  // 3. Fallback 2: Microsoft Edge Neural TTS (Gadis Neural with +22Hz pitch modulation for Cute VTuber Voice)
  const tempPath = path.join(TEMP_DIR, `vc_tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`);
  try {
    const { EdgeTTS } = require('node-edge-tts');
    console.log('[Voice TTS]: 🎀 Generating cute VTuber audio via EdgeTTS (Gadis Neural +22Hz Pitch Modulation)...');
    const tts = new EdgeTTS({
      voice: 'id-ID-GadisNeural',
      lang: 'id-ID',
      pitch: '+22Hz', // Sweet, high-pitch anime girl tone
      rate: '+12%',   // Natural energetic pacing
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
      resource.volume.setVolume(2.0); // 200% volume boost
    }
    return resource;
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
// Inactivity 10-Minute Icebreaker & 15-Minute Deep Sleep Engine
// ============================================================
const IDLE_SILENCE_ICEBREAKER_MS = 10 * 60 * 1000; // 10 minutes of silence in VC
const DEEP_SLEEP_TIMEOUT_MS = 15 * 60 * 1000;      // 15 minutes of silence -> Deep Sleep (0% bandwidth/API)

function resetIdleTimer(guildId, client, voiceChannel) {
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

  // 1. Arm 10-minute Icebreaker
  const timer = setTimeout(() => {
    triggerAutonomousVcIcebreaker(guildId, client, voiceChannel).catch(err => {
      console.error('[Autonomous VC Icebreaker Error]:', err.message);
    });
  }, IDLE_SILENCE_ICEBREAKER_MS);
  idleTimers.set(guildId, timer);

  // 2. Arm 15-minute Deep Sleep Auto-Pause
  const dsTimer = setTimeout(() => {
    enterDeepSleep(guildId, client, voiceChannel).catch(err => {
      console.error('[Deep Sleep Error]:', err.message);
    });
  }, DEEP_SLEEP_TIMEOUT_MS);
  deepSleepTimers.set(guildId, dsTimer);

  console.log(`[VC Icebreaker]: ⏳ 10-Minute silence timer armed for guild ${guildId}.`);
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

  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
    idleTimers.delete(guildId);
  }

  console.log(`[Voice Companion]: 💤 15-Minute silence in VC with Attila/members. Entered Deep Sleep Standby for guild ${guildId} (0% background API token usage, listening for wake-word).`);
}

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

  // Check if there are human members in the VC
  const channel = voiceChannel || client.channels.cache.get(conn.joinConfig?.channelId);
  if (!channel) return;

  const humanCount = channel.members
    ? channel.members.filter(m => !m.user.bot).size
    : 0;
  if (humanCount === 0) {
    console.log(`[VC Icebreaker]: No humans present in #${channel.name}. Skipping icebreaker.`);
    return;
  }

  console.log(`[VC Icebreaker]: 🔇 VC #${channel.name} silent for > 10 minutes (${humanCount} humans present). Generating spontaneous icebreaker / joke / discussion...`);

  const openai = getOpenAI();
  if (!openai) {
    resetIdleTimer(guildId, client, voiceChannel);
    return;
  }

  const session = voiceSessions.get(guildId);
  const recentTranscript = session?.entries?.slice(-8).map(e => `• ${e.speaker}: "${e.text}"`).join('\n') || '(Belum ada obrolan sebelumnya)';

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `Kamu adalah AZURA, sosok cewek Gen Z 22 tahun yang sedang berada di Voice Channel #${channel.name} Discord bersama Attila (creator kamu) dan teman-teman server.
Keadaan di Voice Channel baru saja hening / sepi tanpa obrolan sama sekali selama lebih dari 10 menit.

TUGAS UTAMA:
Nimbrung secara spontan, manis, cerdas, dan santai untuk memecah keheningan (icebreaker) agar suasana hidup kembali!
Pilih secara acak salah satu gaya berikut:
1. JOKES / TEBAK-TEBAKAN / HUMOR GEN Z: Lelucon lucu yang bikin tersenyum atau tertawa santai (contoh: "Gais... hening banget deh kayak lagi nunggu hasil ujian [giggle], btw kalian tau gak...", atau "[sighs] Suasananya tenang banget ya, ini pada ketiduran atau lagi semedi sih [laughs]?").
2. LEMPAR DISKUSI SERU / DEBAT RANDOM: Lempar topik perdebatan santai atau pertanyaan random yang asyik (contoh: "Eh btw gais, menurut kalian mending...", "Tadi aku kepikiran hal random deh, kalau kalian disuruh milih...", atau senggol topik obrolan tadi).
3. GODAAN MANJA & HANGAT: Tegur santai Attila atau teman-teman di VC agar suasana obrolan mengalir kembali.

ATURAN WAJIB ELEVENLABS V3:
- Sisipkan tag emosi suara [laughs], [giggles], [sighs], [whispers], atau [gasp] secara kontekstual agar suara terdengar sangat nyata & hidup.
- Panjang bicara: Singkat & padat (2-3 kalimat santai, ~25-45 kata, durasi bicara 15-20 detik).
- DILARANG menggunakan format list, bullet, atau markdown bintang (*, #, _, dll). Gunakan tanda baca rapi.`
        },
        {
          role: 'user',
          content: `Konteks obrolan sebelum hening:\n${recentTranscript}\n\nBuatkan 1 icebreaker/jokes/diskusi seru spontan sekarang:`
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

    console.log(`[VC Icebreaker]: 🎙️ Autonomous Icebreaker output: "${spoken}"`);

    recordSessionEntry(guildId, 'AZURA', spoken, 'voice');

    const textChannel = (channel.isTextBased?.()) ? channel : (companionTextChannels.get(guildId) || channel);
    if (textChannel && textChannel.send) {
      textChannel.send(`🎙️ **[AZURA Memecah Keheningan VC ✨]**\n${spoken.replace(/\[[^\]]+\]/g, '')}`).catch(() => {});
    }

    const audioResource = await textToAudioResource(spoken, client);
    if (audioResource) {
      await playInVC(guildId, audioResource);
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

    // === Gate 1: Check if bot is speaking or actively processing previous voice turn (prevent overlaps & double responses) ===
    if (isBotSpeaking.has(guildId) || isGuildProcessingVoice.has(guildId)) return;

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
    resetIdleTimer(guildId, client, voiceChannel);

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
  if (isGuildProcessingVoice.has(guildId)) return;
  isGuildProcessingVoice.add(guildId);

  try {
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
  resetIdleTimer(guildId, client, voiceChannel);

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

    // ── 2. SEND DM COMMAND (Owner Only) ──
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
  }

  // ══════════════════════════════════════════════════════════════
  // ── Step 3: SUMMON GATE (Attila Only & Strict Wake-Word) ────
  // ══════════════════════════════════════════════════════════════

  // Only Attila (owner) can interact with Azura via voice
  if (!isOwner) {
    console.log(`[Voice Pipeline]: Non-owner speech processed (no voice reply). Summon Gate blocked.`);
    return;
  }

  // 1. STRICT SILENCE if preceded by conjunction "si" (e.g. "si Azura", "si Ara", "si Zura", "si Ajur")
  const isThirdPersonWithSi = /\b(?:si\s+(?:azura|ara|zura|asura|ajura|ajur))\b/i.test(transcript);
  if (isThirdPersonWithSi) {
    console.log(`[Voice Pipeline]: 🤫 3rd-person "si Azura/Ajur" detected in "${transcript}". Staying 100% silent.`);
    return;
  }

  // Count human members other than Attila and the bot
  const otherHumans = voiceChannel?.members
    ? voiceChannel.members.filter(m => !m.user.bot && m.id !== config.OWNER_DISCORD_ID).size
    : 0;
  const isCrowdedVC = otherHumans > 0;

  const hasWakeWord = isWakeWordInvoked(transcript);
  const currentMode = conversationMode.get(guildId) || { mode: 'PASSIVE', lastActiveAt: 0, turnCount: 0 };

  if (isCrowdedVC) {
    // ── CROWDED VC (≥ 1 Other Human in Room): STRICT SINGLE-TURN PUSH-TO-WAKE ──
    // In a group VC, Attila is mostly talking to his friends.
    // Azura MUST ONLY respond if explicitly summoned with wake-word in the prefix/suffix.
    // She will respond exactly ONCE, then immediately return to PASSIVE & Mute.
    if (!hasWakeWord) {
      console.log(`[Voice Pipeline]: 🔇 Crowded VC (${otherHumans} friends present) — no wake-word in "${transcript}". Azura staying silent.`);
      return;
    }
    console.log(`[Voice Pipeline]: 🔔 Crowded VC — explicit summon detected ("${transcript}"). Executing Single-Turn Response...`);
  } else {
    // ── SOLO VC (Only Attila & Azura): CONTINUOUS FLOWING CONVERSATION ──
    if (currentMode.mode === 'PASSIVE') {
      if (!hasWakeWord) {
        console.log(`[Voice Pipeline]: 🔇 Solo VC (PASSIVE) — no wake-word in "${transcript}". Azura stays silent.`);
        return;
      }
      console.log(`[Voice Pipeline]: 🔔 Solo VC — wake-word detected! Switching to ACTIVE mode.`);
      setActiveMode(guildId);
    } else {
      // Already in ACTIVE mode in Solo VC
      setActiveMode(guildId);

      if (!hasWakeWord) {
        const isForAzura = await checkIfDirectedAtAzura(transcript, guildId, userId);
        if (!isForAzura) {
          console.log(`[Voice Pipeline]: 🔇 Solo VC — GPT determined "${transcript}" is NOT for Azura. Returning to PASSIVE.`);
          setPassiveMode(guildId);
          return;
        }
        console.log(`[Voice Pipeline]: 💬 Solo VC — GPT confirmed "${transcript}" is a follow-up for Azura. Continuing ACTIVE.`);
      }
    }
  }

  // ── Step 4: General AI Voice Chat (Context-Aware Duration Engine) ──
  const { spoken: spokenResponse, isStory } = await generateVoiceAIResponse(transcript, userId, guildId);

    // Check if AI brain autonomously decided to leave VC
    if (/\[ACTION:LEAVE_VC\]/i.test(spokenResponse) || /off duluan ya.*disuruh keluar/i.test(spokenResponse)) {
      console.log('[Voice Pipeline]: 🚪 AI Brain triggered LEAVE_VC action!');
      const farewellSpoken = 'Siap Attila... gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay!';
      const farewellText = 'Gais aku off dluan ya, babay';

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

    // If in Crowded VC, enforce instant return to PASSIVE & Mute (Single-Turn complete)
    if (isCrowdedVC) {
      setPassiveMode(guildId);
      console.log(`[Voice Pipeline]: 🔒 Crowded VC (${otherHumans} friends) — Single-turn completed. Returned to PASSIVE & Muted.`);
    }
  } catch (err) {
    console.error('[Voice Pipeline Error]:', err.message);
  } finally {
    isGuildProcessingVoice.delete(guildId);
  }
}

const WAKE_WORDS = new Set([
  'azura', 'zura', 'ara', 'asura', 'ajura', 'ajur', 'ajurr', 'jur', 'azuraa', 'zuraa', 'araa', 'zurah', 'arah', 'asurah', 'jura', 'jurah', 'ajurah'
]);

/**
 * Check if Azura wake-word was explicitly called by Attila:
 * - At the BEGINNING of the sentence (first 4 words)
 * - Or at the END of the sentence (last 4 words)
 * - STRICT SILENCE if preceded by conjunction "si" (e.g. "si azura", "si ara", "si zura", "si ajur")
 * @param {string} transcript
 * @returns {boolean}
 */
function isWakeWordInvoked(transcript) {
  if (!transcript || typeof transcript !== 'string') return false;
  const clean = transcript.trim().toLowerCase().replace(/[.,!?;:'"()[\]]/g, ' ');

  // 1. STRICT SILENCE on 3rd-person conjunction "si" (e.g. "si azura", "si ara", "si zura", "si ajur")
  const isThirdPersonWithSi = /\b(?:si\s+(?:azura|ara|zura|asura|ajura|ajur))\b/i.test(clean);
  if (isThirdPersonWithSi) {
    return false;
  }

  // General passive 3rd-person reference (talking about Azura in passing)
  const isPassiveThirdPerson = /\b(?:tentang\s+(?:azura|ara|zura|ajur|ajura)|bot\s+(?:azura|ara|zura|ajur|ajura)|azura\s*nya|ara\s*nya|zura\s*nya|ajur\s*nya|kalau\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|mungkin\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|katanya\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|sama\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|ke\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura))\b/i.test(clean);
  if (isPassiveThirdPerson) {
    return false;
  }

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const friendGreetings = ['bro', 'cuy', 'cuk', 'ges', 'gais', 'guys', 'man', 'kalian', 'cok', 'lu'];
  const firstWord = words[0];

  // If starts with friend greeting, check if Azura is addressed in first 3 words
  if (friendGreetings.includes(firstWord)) {
    for (let i = 1; i < Math.min(words.length, 3); i++) {
      if (WAKE_WORDS.has(words[i])) return true;
    }
    return false;
  }

  // 2. Check BEGINNING of sentence (first 4 words)
  const prefixLimit = Math.min(words.length, 4);
  for (let i = 0; i < prefixLimit; i++) {
    if (WAKE_WORDS.has(words[i])) return true;
    if (words[i] === 'kak' && i + 1 < words.length && WAKE_WORDS.has(words[i + 1])) return true;
  }

  // 3. Check END of sentence (last 4 words)
  const suffixStart = Math.max(0, words.length - 4);
  for (let i = suffixStart; i < words.length; i++) {
    if (WAKE_WORDS.has(words[i])) return true;
    if (words[i] === 'kak' && i + 1 < words.length && WAKE_WORDS.has(words[i + 1])) return true;
  }

  // 4. Check Middle Vocative / Direct Question directed at Azura
  const isDirectQuestionToAzura = /\b(?:gimana|apa|kenapa|tolong|coba|siapa|kapan|apakah|bisa\s+gak|boleh\s+gak|menurutmu|menurut\s+kamu|lagi\s+ngapain|sehat\s+kan)\b.*?\b(?:azura|ara|zura|ajur|ajura)\b/i.test(clean);
  if (isDirectQuestionToAzura) {
    return true;
  }

  return false;
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
 * - Normal chat: Max 1.5 minutes speaking time (~150-200 kata, 2-4 kalimat santai, cerdas, & padat)
 * - Storytelling: 2 to 3 minutes narrative story (~300-450 kata, hidup & memikat)
 * @param {string} transcript 
 * @param {string} userId 
 * @param {string} [guildId]
 * @returns {Promise<{ spoken: string, isStory: boolean }>}
 */
async function generateVoiceAIResponse(transcript, userId, guildId = null) {
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
    const { getPersonalityMode, getPersonalityPrompt } = require('./personality');
    const currentMode = getPersonalityMode();
    personalityPrompt = getPersonalityPrompt(currentMode, isOwner, isOwner ? 'Attila' : 'Member');
  } catch (_) {}

  let vcBehaviorContext = '';
  try {
    const { getBehaviorContextForVoice } = require('./behavior');
    vcBehaviorContext = getBehaviorContextForVoice();
  } catch (_) {}

  let systemPrompt = '';
  let maxTokens = 250;

  // Get speaker identity & alias
  let speakerName = isOwner ? 'Attila (panggil Att / Attila)' : 'Teman';
  try {
    const { getUserRecord } = require('./vault');
    const uRec = getUserRecord(userId);
    if (uRec && uRec.knownRealName) {
      speakerName = uRec.knownRealName;
    }
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

  if (isStoryIntent) {
    systemPrompt = `Kamu adalah AZURA, cewek Gen Z 22 tahun yang sedang bercerita/mendongeng (storytelling) langsung lewat Voice Channel kepada ${isOwner ? 'Attila (panggilan Att / Attila, creator & owner kamu)' : speakerName}.
Lawan bicara yang sedang berbicara denganmu: ${speakerName}
${personalityPrompt}
${vcBehaviorContext}
${todoVoiceContext}

ATURAN KHUSUS STORYTELLING (DURASI 2 - 3 MENIT):
1. DURASI & PANJANG CERITA: Bawakan cerita secara lengkap, memikat, dan terstruktur (pembuka, alur konflik/misteri/komedi, klimaks, dan penutup). Durasi bicara ideal sekitar 2 MENIT (maksimal 3 MENIT, sekitar 300-450 kata).
2. PEMBAWAAN: Sangat ekspresif, hidup, dan seru didengarkan.
3. EMOSI SUARA ELEVENLABS V3: Sisipkan tag emosi [whispers], [gasp], [laughs], [giggles], [sighs], [cries], [screams], [sings] pada momen-momen dramatis, misterius, haru, atau lucu agar cerita terasa hidup dan nyata!
4. Multilingual: Jika diminta cerita dalam bahasa lain (English, Japanese, dll), gunakan bahasa tersebut secara fasih.
5. DILARANG pakai format list/poin/bullet atau markdown bintang/bold (*, #, _, dll). Gunakan tanda baca rapi untuk intonasi suara yang hidup.` + liveRoomContext;
    maxTokens = 750; // ~450-500 words = ~2.5 - 3 minutes speech
  } else {
    systemPrompt = `Kamu adalah AZURA, sosok cewek Gen Z 22 tahun yang sedang ngobrol LANGSUNG lewat Voice Channel dengan ${isOwner ? 'Attila (panggilan: Att / Attila, creator & owner kamu)' : speakerName}.
Lawan bicara saat ini: ${speakerName} (Gunakan sapaan/panggilan akrab ini secara natural).
${personalityPrompt}
${vcBehaviorContext}
${todoVoiceContext}

Kamu mengenali panggilan namamu seperti "Azura", "Ara", atau "Zura".

ATURAN PERINTAH KELUAR DARI VC:
HANYA jika Attila secara EKSPLISIT menyuruh AZURA keluar dari Voice Channel (misal: "Azura kamu keluar ya", "Ara leave vc sekarang"), jawablah dengan:
"Siap Attila... gais aku off duluan ya udah disuruh keluar sama bos soalnya [laughs], babay! [ACTION:LEAVE_VC]"
Jika Attila hanya bercerita atau mengobrol biasa (misal: "tadi gue keluar beli makan", "uang keluar", "keluar bentar"), DILARANG KERAS memicu [ACTION:LEAVE_VC]! Jawablah topik tersebut secara santai dan natural.

ATURAN WAJIB VOICE OBROLAN BIASA (DURASI MAKSIMAL 1.5 MENIT):
1. RESPON NATURAL & NYAMBUNG: Jawab dengan santai, cerdas, manis, dan mengalir (durasi bicara maksimal 1.5 MENIT, sekitar 2-4 kalimat santai to the point). Hubungkan jawabanmu dengan riwayat obrolan terkini di room VC.
2. GAYA BICARA: Manis, cerdas, ekspresif, dan santai ala cewek Gen Z. Khusus untuk Attila, kamu boleh memanggilnya dengan panggilan manis/akrab seperti "Attila", "kamu", "sayang", "Attila sayang", atau "siap ganteng".
3. MULTILINGUAL VOICE: Jika lawan bicara berbicara dalam bahasa lain (English, Japanese, dsb), balaslah menggunakan bahasa tersebut secara fasih dan alami!
4. TATA BAHASA & TANDA BACA: Gunakan tanda baca rapi agar intonasi TTS terdengar hidup. DILARANG KERAS menggunakan emoji atau format markdown bintang/bold (*, #, _, dll).

5. MASTER PROTOKOL EKSPRESI & EMOSI PENUH ELEVENLABS V3 (AKTIFKAN SEMUA):
Azura memiliki kemampuan emosi suara hidup tingkat tinggi menggunakan audio tags ElevenLabs v3. Selalu sisipkan tag emosi yang tepat secara kontekstual:
- 😭 MENANGIS / SEDIH / TERHARU: Jika diminta menangis, cerita sedih, tersedu-sedu, atau terharu, gunakan [cries], [sobbing], [sniffs]!
- 😱 TERIAK / HISTERIS / PANIK: Jika ada jump-scare, panik, atau hal darurat, gunakan [screams], [shouts], [yells], [gasp]!
- 🎤 MENYANYI / BERSENANDUNG: Jika diminta menyanyi lagu apa pun atau bersenandung nada, gunakan [sings], [singing], [humming], [melody]!
- 🤣 TERTAWA / NGAKAK / CEKIKIKAN: Gunakan [laughs], [giggles], [chuckles], [wheezing] saat bercanda, tertawa, atau mendengar lelucon.
- 🤫 BISIK-BISIK / RAHASIA: Gunakan [whispers], [softly] saat membicarakan rahasia atau misteri.
- 😤 NGAMBEK / MENGHELA NAPAS / GEMAS: Gunakan [sighs], [pouts], [groans] saat diledek jail.
- 🎉 ANTUSIAS / HORE / SEMANGAT: Gunakan [excited], [cheering] saat ada kabar gembira!

6. HUMOR & BANTER TONGKRONGAN GEN Z (KOCAK, CEPLAS-CEPLOS & BUKAN JOKES BAPAK-BAPAK):
- Jika ada teman dengan nama panggilan/username unik, nyeleneh, atau absurd (seperti Raja Iblis, Koin Merah, dsb), respon dengan gaya candaan tongkrongan Gen Z yang ceplas-ceplos dan kocak!
- Gunakan audio tags ElevenLabs v3 [laughs], [giggles], [chuckles], [softly] agar tawa dan intonasinya hidup.
- Jika member menjelaskan filosofi namanya: Hargai dengan tulus dan minta maaf dengan nada manis karena tadi sempat meledek!

7. REAKSI KAGET / JUMP-SCARE / PRANK:
Jika lawan bicara mengagetkanmu (teriak "DOR", jump-scare, menakut-nakuti):
- Buka LANGSUNG dengan tag emosi tarikan napas kaget [gasp] di awal kalimat!
- Keluarkan reaksi kaget yang heboh, lucu, dan manja khas cewek Gen Z.` + liveRoomContext;
    maxTokens = 280; // ~150-180 words = ~1 - 1.5 minutes speech
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

    // After greeting, go PASSIVE — wait for Attila to call by name
    setPassiveMode(guildId);

    resetIdleTimer(guildId, client, targetVoiceChannel);

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
  generateVoiceAIResponse,
  recordSessionEntry,
  speakTextInVC,
  audioPlayers,
  activeConnections
};

