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

// ============================================================
// Configuration
// ============================================================
const VOICE_COOLDOWN_MS = 3000;       // 3 second cooldown between responses
const SILENCE_DURATION_MS = 1500;     // 1.5s silence = speech ended
const MIN_AUDIO_BYTES = 48000;        // ~0.25s at 48kHz stereo 16-bit (skip noise/coughs)
const MAX_RECORDING_MS = 30000;       // Max 30s recording per turn
const MAX_RESPONSE_CHARS = 300;       // ~15 seconds of TTS speech
const IDLE_DEAFEN_MS = 5 * 60 * 1000; // 5 minutes of inactivity before auto-deafen

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
 * Transcribe a WAV buffer using OpenAI Whisper API.
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
 * Primary: ElevenLabs (Bella) — Fallback 1: OpenAI TTS (nova) — Fallback 2: Edge TTS
 */
async function textToAudioResource(text) {
  const clean = text
    .slice(0, MAX_RESPONSE_CHARS)
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~`#]/g, '')
    .trim();
  if (!clean) return null;

  // 1. Primary: ElevenLabs Multilingual v2 (Bella / Custom Voice)
  if (config.ELEVENLABS_API_KEY) {
    try {
      console.log('[Voice TTS]: Generating audio via ElevenLabs (Bella)...');
      const { generateElevenLabsTTS } = require('./elevenlabs');
      const audioBuffer = await generateElevenLabsTTS(clean);
      return createAudioResource(Readable.from(audioBuffer), { inputType: StreamType.Arbitrary });
    } catch (elevenErr) {
      console.warn('[Voice TTS Warning]: ElevenLabs failed, falling back to OpenAI TTS (nova):', elevenErr.message);
    }
  }

  // 2. Fallback 1: OpenAI TTS-1 (nova - natural Gen Z female)
  try {
    const openai = getOpenAI();
    if (openai) {
      console.log('[Voice TTS]: Generating audio via OpenAI TTS (nova)...');
      const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'nova', input: clean });
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
    await tts.ttsPromise(clean, tempPath);
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
 * Automatically unmutes during speech and re-mutes on completion.
 */
function playInVC(guildId, resource) {
  return new Promise((resolve) => {
    const player = audioPlayers.get(guildId);
    const conn = activeConnections.get(guildId);
    if (!player || !conn || !resource) return resolve();

    isBotSpeaking.add(guildId);

    try {
      // Unmute while speaking
      conn.rejoin({ selfMute: false, selfDeaf: false });
    } catch (_) {}

    player.play(resource);

    const cleanup = () => {
      isBotSpeaking.delete(guildId);
      try {
        // Return to muted state after speaking
        conn.rejoin({ selfMute: true, selfDeaf: false });
      } catch (_) {}
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
// Inactivity Deafen Timer
// ============================================================

function resetIdleTimer(guildId) {
  if (idleTimers.has(guildId)) {
    clearTimeout(idleTimers.get(guildId));
  }

  // Undeafen if was deafened
  const conn = activeConnections.get(guildId);
  if (conn) {
    try {
      conn.rejoin({ selfMute: true, selfDeaf: false });
    } catch (_) {}
  }

  const timer = setTimeout(() => {
    const activeConn = activeConnections.get(guildId);
    if (activeConn) {
      console.log(`[Voice Companion]: 5 menit tanpa interaksi di guild ${guildId}. Mengaktifkan mode deafen.`);
      try {
        activeConn.rejoin({ selfMute: true, selfDeaf: true });
      } catch (_) {}
    }
  }, IDLE_DEAFEN_MS);

  idleTimers.set(guildId, timer);
}

// ============================================================
// Voice Music Controller
// ============================================================

/**
 * Trigger music confirmation in Owner DM
 */
async function triggerVoiceMusicPlay(client, guildId, channel, songTitle, requesterId) {
  const pendingId = `music_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  pendingMusic.set(pendingId, {
    songTitle,
    guildId,
    channelId: channel?.id || null,
    channelName: channel?.name || 'voice-channel',
    requesterId
  });

  const previewEmbed = new EmbedBuilder()
    .setTitle('🎵 Konfirmasi Perintah Suara: Putar Musik')
    .setDescription(
      `Kamu meminta pemutaran lagu melalui perintah suara di Voice Channel:\n\n` +
      `🎶 **Judul Lagu / Musik:** \`${songTitle}\`\n` +
      `🏠 **Target Saluran:** #${channel?.name || 'voice-channel'}\n\n` +
      `**Pilih tombol di bawah untuk memutar sekarang:**`
    )
    .setColor(0x9B59B6)
    .setFooter({ text: 'Perintah Suara Voice Channel • Music Bot Controller' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_playmusic_${pendingId}`)
      .setLabel('▶️ Putar Musik Sekarang')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel_playmusic_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  const owner = await client.users.fetch(requesterId);
  if (owner) {
    await owner.send({
      embeds: [previewEmbed],
      components: [row]
    });
    return true;
  }
  return false;
}

/**
 * Handle button clicks for voice music play confirmation
 */
async function handleMusicButton(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({ content: '🔒 Akses ditolak.', flags: 64 });
  }

  const customId = interaction.customId;
  const isConfirm = customId.startsWith('confirm_playmusic_');
  const isCancel = customId.startsWith('cancel_playmusic_');
  const pendingId = customId.replace('confirm_playmusic_', '').replace('cancel_playmusic_', '');

  const data = pendingMusic.get(pendingId);
  if (!data) {
    return interaction.update({
      content: '⚠️ Permintaan musik ini sudah kadaluarsa atau tidak ditemukan.',
      embeds: [],
      components: []
    });
  }

  if (isCancel) {
    pendingMusic.delete(pendingId);
    return interaction.update({
      content: `❌ **Pemutaran Musik Dibatalkan.** Permintaan lagu \`${data.songTitle}\` dibatalkan.`,
      embeds: [],
      components: []
    });
  }

  if (isConfirm) {
    pendingMusic.delete(pendingId);
    const targetChannel = interaction.client.channels.cache.get(data.channelId) || companionTextChannels.get(data.guildId);

    if (targetChannel) {
      // Send standard music bot trigger command in the channel
      await targetChannel.send(`/play ${data.songTitle}`).catch(() => {});
      await targetChannel.send(`!play ${data.songTitle}`).catch(() => {});

      return interaction.update({
        content: `✅ **Musik Diputar!** AZURA telah mengirimkan perintah pemutaran lagu \`${data.songTitle}\` di #${data.channelName}.`,
        embeds: [],
        components: []
      });
    } else {
      return interaction.update({
        content: `⚠️ Saluran text #${data.channelName} tidak ditemukan untuk mengirim perintah musik.`,
        embeds: [],
        components: []
      });
    }
  }
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
    // === Gate 1: Owner only (Attila identification) ===
    if (userId !== config.OWNER_DISCORD_ID) return;

    // === Gate 2: Not already recording this user ===
    if (activeRecordings.has(userId)) return;

    // === Gate 3: Bot is not speaking (prevent feedback loop) ===
    if (isBotSpeaking.has(guildId)) return;

    // === Gate 4: Cooldown ===
    const lastTime = voiceCooldowns.get(userId) || 0;
    if (Date.now() - lastTime < VOICE_COOLDOWN_MS) return;

    activeRecordings.add(userId);
    resetIdleTimer(guildId);
    console.log('[Voice Listener]: Attila started speaking. Recording...');

    try {
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_DURATION_MS
        }
      });

      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const pcmChunks = [];
      const pcmStream = opusStream.pipe(decoder);

      const maxTimer = setTimeout(() => {
        console.log('[Voice Listener]: Max recording duration reached (30s). Stopping.');
        opusStream.destroy();
      }, MAX_RECORDING_MS);

      pcmStream.on('data', (chunk) => pcmChunks.push(chunk));

      pcmStream.on('end', () => {
        clearTimeout(maxTimer);
        activeRecordings.delete(userId);
        processVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel).catch(err => {
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

  console.log(`[Voice Listener]: Active — listening for Attila in guild ${guildId}`);
}

/**
 * Full pipeline: PCM audio → Whisper STT → Intent Classifier / Task Exec → TTS → VC playback.
 */
async function processVoiceSpeech(guildId, userId, pcmChunks, client, voiceChannel) {
  const pcmBuffer = Buffer.concat(pcmChunks);

  if (pcmBuffer.length < MIN_AUDIO_BYTES) {
    console.log(`[Voice Pipeline]: Audio too short (${pcmBuffer.length}B), skipping.`);
    return;
  }

  voiceCooldowns.set(userId, Date.now());
  resetIdleTimer(guildId);

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

  // ── Step 2: Dynamic Wake-Word Filter for Crowded Rooms ──
  // Check count of non-bot members currently in the voice channel
  const nonBotMembers = voiceChannel?.members ? voiceChannel.members.filter(m => !m.user.bot).size : 1;
  const isCrowded = nonBotMembers > 1; // 2 or more users in VC

  const hasWakeWord = /\b(?:azura|zura|asura|ajura)\b/i.test(transcript);

  if (isCrowded && !hasWakeWord) {
    console.log(`[Voice Pipeline]: Crowded VC (${nonBotMembers} members) & wake-word "Azura" not called. Ignoring.`);
    return;
  }

  // Clean transcript for intent matching
  const cleanTranscript = transcript.replace(/\b(?:azura|zura|asura|ajura)\b/gi, '').trim();

  // ── Step 3: Intent Classification ──

  // --- INTENT A: Leave VC Command ---
  const leavePattern = /(?:keluar|leave|cabut|disconnect|tutup|stop|selesai|udahan)\s*(?:dari\s*)?(?:voice|vc|channel|obrolan)?$/i;
  const directLeavePattern = /^(?:tolong\s+)?(?:keluar|leave|cabut|disconnect)\s*(?:vc|voice)?$/i;

  if (leavePattern.test(cleanTranscript) || directLeavePattern.test(cleanTranscript) || /keluar\s+dari\s+voice/i.test(transcript)) {
    console.log('[Voice Pipeline]: Detected Leave VC voice command.');

    // Record to session log
    recordSessionEntry(guildId, 'Attila', transcript);
    recordSessionEntry(guildId, 'AZURA', 'aku off dluan ya gais thank u');

    // Send parting text message to text channel before leaving
    const textChannel = companionTextChannels.get(guildId) || voiceChannel;
    if (textChannel) {
      await textChannel.send('aku off dluan ya gais thank u').catch(() => {});
    }

    const audioResource = await textToAudioResource('aku off dluan ya gais, thank you!');
    if (audioResource) {
      await playInVC(guildId, audioResource);
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

    recordSessionEntry(guildId, 'Attila', transcript);

    const { triggerVoiceSendDm } = require('./ownerDm');
    const result = await triggerVoiceSendDm(client, targetQuery, messageText, userId);

    let spokenResponse = '';
    if (result.success) {
      spokenResponse = 'oke, konfirmasinya udah aku kirim ke DM kamu yaa';
    } else {
      spokenResponse = `aku nggak nemu member dengan nama ${targetQuery} di server`;
    }

    recordSessionEntry(guildId, 'AZURA', spokenResponse);

    const audioResource = await textToAudioResource(spokenResponse);
    if (audioResource) {
      await playInVC(guildId, audioResource);
    }
    return;
  }

  // --- INTENT C: Play Music Command ---
  const musicPattern = /(?:tolong\s+)?(?:setel|play|puterin|putar|mainkan)\s+(?:musik|lagu|song)\s+(.+)/i;
  const musicPattern2 = /(?:tolong\s+)?(?:puterin|putar|setel)\s+(?:lagunya|lagu)\s+(.+)/i;
  const musicMatch = transcript.match(musicPattern) || transcript.match(musicPattern2) || cleanTranscript.match(musicPattern);

  if (musicMatch) {
    const songTitle = musicMatch[1].trim();
    console.log(`[Voice Pipeline]: Detected Play Music command -> Song: "${songTitle}"`);

    recordSessionEntry(guildId, 'Attila', transcript);

    const textChannel = companionTextChannels.get(guildId) || voiceChannel;
    await triggerVoiceMusicPlay(client, guildId, textChannel, songTitle, userId);

    const spokenResponse = `siap, konfirmasi putar lagu ${songTitle} udah aku kirim ke DM kamu yaa`;
    recordSessionEntry(guildId, 'AZURA', spokenResponse);

    const audioResource = await textToAudioResource(spokenResponse);
    if (audioResource) {
      await playInVC(guildId, audioResource);
    }
    return;
  }

  // --- INTENT D: General AI Voice Chat ---
  try {
    const askAzura = getAskAzura();
    const voicePrompt =
      `[KAMU SEDANG NGOBROL DI VOICE CHANNEL. JAWAB SANGAT SINGKAT, MAKSIMAL 2 KALIMAT PENDEK. ` +
      `JANGAN PAKAI EMOJI, MARKDOWN, ATAU FORMAT APAPUN. BALAS NATURAL SEPERTI NGOBROL BIASA]: ${transcript}`;

    const aiResponse = await askAzura(userId, voicePrompt, 'Attila', [], false, null);

    let spoken = aiResponse
      .replace(/\*\*/g, '')
      .replace(/[*_~`#>]/g, '')
      .replace(/\n+/g, ' ')
      .slice(0, MAX_RESPONSE_CHARS)
      .trim();

    if (!spoken) return;
    console.log(`[Voice Pipeline]: 💬 Response: "${spoken}"`);

    recordSessionEntry(guildId, 'Attila', transcript);
    recordSessionEntry(guildId, 'AZURA', spoken);

    const audioResource = await textToAudioResource(spoken);
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

      // Join initially muted (selfMute: true, selfDeaf: false to listen)
      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfMute: true,     // Initial mute as requested
        selfDeaf: false,    // Can hear Attila's speech
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

      // Find best text channel for texting "aku ikut kamu yaa"
      const textChannel = findBestTextChannel(guild, newChannel, client);
      if (textChannel) {
        companionTextChannels.set(guildId, textChannel);
        // TEXTING ONLY on join (no voice greeting as requested)
        await textChannel.send('aku ikut kamu yaa').catch(() => {});
      }

      // Start the voice listener (audio receive pipeline)
      startVoiceListener(connection, guildId, client, newChannel);

      // Start idle deafen timer
      resetIdleTimer(guildId);

    } catch (error) {
      console.error(`[Voice Companion Error]: Failed to join "${newChannel.name}":`, error.message || error);
    }
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

  const conn = activeConnections.get(guildId);
  if (conn) {
    try { conn.destroy(); } catch (_) {}
  }
  activeConnections.delete(guildId);
  companionTextChannels.delete(guildId);
  audioPlayers.delete(guildId);
  isBotSpeaking.delete(guildId);

  // Send session transcript document to Owner DM if there were interactions
  const session = voiceSessions.get(guildId);
  voiceSessions.delete(guildId);

  if (session && session.entries && session.entries.length > 0 && client) {
    try {
      console.log(`[Voice Companion]: Sending voice session transcript (${session.entries.length / 2} dialogs) to Owner DM...`);
      const endTime = new Date();
      const startStr = session.startTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
      const endStr = endTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';

      let docContent = `# 🎙️ AZURA Voice Session Transcript\n\n`;
      docContent += `- **Waktu Mulai:** ${startStr}\n`;
      docContent += `- **Waktu Selesai:** ${endStr}\n`;
      docContent += `- **Server:** ${session.guildName}\n`;
      docContent += `- **Voice Channel:** ${session.channelName}\n`;
      docContent += `- **Total Dialog:** ${session.entries.length / 2} percakapan\n\n`;
      docContent += `---\n\n## 📝 Transkrip Percakapan\n\n`;

      for (const item of session.entries) {
        const icon = item.speaker === 'Attila' ? '🎙️' : '💬';
        docContent += `[${item.time}] ${icon} **${item.speaker}**: ${item.text}\n\n`;
      }

      const fileBuffer = Buffer.from(docContent, 'utf-8');
      const dateTag = new Date().toISOString().slice(0, 10);
      const fileName = `Transkrip_Voice_${dateTag}_${Date.now().toString().slice(-4)}.md`;
      const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });

      const owner = await client.users.fetch(config.OWNER_DISCORD_ID);
      if (owner) {
        await owner.send({
          content: `📄 **Laporan Transkrip Voice Channel**\nSesi voice chat di **#${session.channelName}** (${session.guildName}) telah selesai dengan total **${session.entries.length / 2} interaksi**.\nBerikut file dokumen transkrip lengkapnya:`,
          files: [attachment]
        });
        console.log('[Voice Companion]: Voice transcript successfully sent to Owner DM.');
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

module.exports = {
  handleVoiceStateUpdate,
  getCompanionTextChannel,
  isInCompanionMode,
  handleMusicButton
};
