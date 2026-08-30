const fs = require('fs');
const path = require('path');
const config = require('./config');

let ffmpegPath = null;
try {
  const ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    ffmpegPath = ffmpegStatic;
  }
} catch (_) {}

if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

// Active camera stream sessions: guildId -> { streamer, udp, isIntroPlaying, currentPhase, textChannel, process }
const activeCameraSessions = new Map();

// Helper Selfbot Client Singleton
let streamerClient = null;
let streamerHelper = null;
let isStreamerReady = false;
let streamerInitPromise = null;

/**
 * Lazy initialize the Discord Helper Streamer Client using STREAMER_USER_TOKEN
 */
async function initStreamerClient() {
  if (isStreamerReady && streamerClient) return { streamerClient, streamerHelper };
  if (streamerInitPromise) return streamerInitPromise;

  streamerInitPromise = (async () => {
    const token = config.STREAMER_USER_TOKEN;
    if (!token) {
      console.warn('[Video Streamer]: ⚠️ STREAMER_USER_TOKEN not configured in .env. Video streaming disabled.');
      return { streamerClient: null, streamerHelper: null };
    }

    try {
      let SelfbotClient, Streamer;
      try {
        SelfbotClient = require('discord.js-selfbot-v13').Client;
        Streamer = require('@dank074/discord-video-stream').Streamer;
      } catch (reqErr) {
        console.warn('[Video Streamer]: ⚠️ Required packages (@dank074/discord-video-stream or discord.js-selfbot-v13) not available:', reqErr.message);
        return { streamerClient: null, streamerHelper: null };
      }

      console.log('[Video Streamer]: 🔄 Logging in Video Streamer Helper Account...');
      const client = new SelfbotClient({
        checkUpdate: false,
        readyStatus: false
      });

      const streamer = new Streamer(client);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Streamer login timed out after 15s'));
        }, 15000);

        client.on('ready', () => {
          clearTimeout(timeout);
          console.log(`[Video Streamer]: ✅ Helper account ready: ${client.user.tag} (${client.user.id})`);
          isStreamerReady = true;
          resolve();
        });

        client.login(token).catch(err => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      streamerClient = client;
      streamerHelper = streamer;
      return { streamerClient, streamerHelper };
    } catch (err) {
      console.error('[Video Streamer Error]: Failed to initialize streamer helper client:', err.message);
      return { streamerClient: null, streamerHelper: null };
    } finally {
      streamerInitPromise = null;
    }
  })();

  return streamerInitPromise;
}

/**
 * Check if camera video is currently active in guild
 * @param {string} guildId 
 * @returns {boolean}
 */
function isCameraActive(guildId) {
  return activeCameraSessions.has(guildId);
}

/**
 * Check if Video 1 (Intro Sambutan) is currently playing
 * (When true, Azura TTS should stay quiet so speech does not clash)
 * @param {string} guildId 
 * @returns {boolean}
 */
function isVideoIntroPlaying(guildId) {
  const session = activeCameraSessions.get(guildId);
  return !!(session && session.isIntroPlaying);
}

/**
 * Start 2-Phase Video Camera Streaming in Voice Channel:
 * Phase 1: cam_intro.mp4 (Sambutan with Audio, plays 1x)
 * Phase 2: cam_loop.mp4 (Looping Visual Mute, seamless infinite loop)
 * 
 * @param {string} guildId 
 * @param {string} channelId 
 * @param {any} textChannel 
 * @param {string} requesterName 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function startCameraStream(guildId, channelId, textChannel = null, requesterName = 'Attila') {
  const introPath = config.VIDEO_INTRO_PATH;
  const loopPath = config.VIDEO_LOOP_PATH;

  const introExists = fs.existsSync(introPath);
  const loopExists = fs.existsSync(loopPath);

  if (!introExists && !loopExists) {
    const errorMsg = `⚠️ File video kamera belum tersedia di \`/assets/videos/\`.\nPastikan file \`cam_intro.mp4\` dan \`cam_loop.mp4\` sudah di-upload.`;
    console.warn(`[Video Streamer]: ${errorMsg}`);
    if (textChannel) {
      await textChannel.send(errorMsg).catch(() => {});
    }
    return { success: false, message: errorMsg };
  }

  // Stop any existing stream first
  if (activeCameraSessions.has(guildId)) {
    await stopCameraStream(guildId);
  }

  const { streamerHelper: streamer } = await initStreamerClient();
  if (!streamer) {
    const errorMsg = '⚠️ Streamer Helper belum siap atau `STREAMER_USER_TOKEN` belum valid di `.env`.';
    console.warn(`[Video Streamer]: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }

  try {
    console.log(`[Video Streamer]: 🎥 Opening camera stream in guild ${guildId}, channel ${channelId}...`);

    await streamer.joinVoice(guildId, channelId);
    const udp = await streamer.createStream();

    udp.mediaConnection.setSpeaking(true);
    udp.mediaConnection.setVideoStatus(true);

    const sessionData = {
      streamer,
      udp,
      guildId,
      channelId,
      textChannel,
      isIntroPlaying: false,
      currentPhase: 'INIT',
      aborted: false
    };

    activeCameraSessions.set(guildId, sessionData);

    // Launch streaming execution pipeline
    execute2PhasePipeline(sessionData, introPath, loopPath, introExists, loopExists);

    return {
      success: true,
      message: `🎥 Kamera Azura berhasil dinyalakan oleh ${requesterName}! (Fase 1: Sambutan ➔ Fase 2: Looping Cam)`
    };
  } catch (err) {
    console.error('[Video Streamer Error]: Failed to start stream:', err.message);
    activeCameraSessions.delete(guildId);
    return {
      success: false,
      message: `Gagal menyalakan kamera: ${err.message}`
    };
  }
}

/**
 * Internal 2-Phase Stream Orchestrator
 */
async function execute2PhasePipeline(session, introPath, loopPath, introExists, loopExists) {
  const { udp, guildId, textChannel } = session;

  try {
    // ══════════════════════════════════════════════════════════════
    // ── PHASE 1: Video 1 (Intro Sambutan with Audio) ──────────────
    // ══════════════════════════════════════════════════════════════
    if (introExists && !session.aborted) {
      session.currentPhase = 'PHASE_1_INTRO';
      session.isIntroPlaying = true;
      console.log(`[Video Streamer]: 🎬 [Phase 1] Playing Video 1 (Intro with Audio)... Azura TTS muted.`);

      try {
        // Stream intro video with video and audio enabled
        await udp.playStream(introPath, {
          width: 1280,
          height: 720,
          fps: 24,
          bitrateKbps: 3300,
          includeAudio: true
        });
      } catch (introErr) {
        console.warn('[Video Streamer Warning]: Intro playback ended or error:', introErr.message);
      }
    }

    if (session.aborted) return;

    // ══════════════════════════════════════════════════════════════
    // ── PHASE 2: Video 2 (Looping Visual Mute) ────────────────────
    // ══════════════════════════════════════════════════════════════
    session.isIntroPlaying = false;
    session.currentPhase = 'PHASE_2_LOOP';
    console.log(`[Video Streamer]: 🔄 [Phase 2] Seamlessly transitioning to Video 2 (Looping Visual Mute). Azura TTS active.`);

    const targetLoopVideo = loopExists ? loopPath : introPath;

    // Loop continuously until session is stopped
    while (activeCameraSessions.has(guildId) && !session.aborted) {
      try {
        // Play loop video with includeAudio: false (Muted)
        await udp.playStream(targetLoopVideo, {
          width: 1280,
          height: 720,
          fps: 24,
          bitrateKbps: 3300,
          includeAudio: false,
          customFfmpegArgs: ['-stream_loop', '-1', '-an']
        });
      } catch (loopErr) {
        // If stopped by user or finished loop cycle, check if still active
        if (!activeCameraSessions.has(guildId) || session.aborted) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch (globalErr) {
    console.error('[Video Streamer Pipeline Error]:', globalErr.message);
  }
}

/**
 * Stop Camera Stream gracefully in a guild
 * @param {string} guildId 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function stopCameraStream(guildId) {
  const session = activeCameraSessions.get(guildId);
  if (!session) {
    return {
      success: true,
      message: 'Kamera Azura sudah dalam keadaan mati.'
    };
  }

  session.aborted = true;
  session.isIntroPlaying = false;

  try {
    if (session.udp) {
      try {
        session.udp.mediaConnection?.setVideoStatus(false);
        session.udp.mediaConnection?.setSpeaking(false);
      } catch (_) {}
      try {
        session.udp.stop();
      } catch (_) {}
    }

    if (session.streamer) {
      try {
        await session.streamer.leaveVoice().catch(() => {});
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Video Streamer Warning]: Error during stream cleanup:', err.message);
  } finally {
    activeCameraSessions.delete(guildId);
    console.log(`[Video Streamer]: 🛑 Camera stream stopped cleanly for guild ${guildId}.`);
  }

  return {
    success: true,
    message: '📷 Kamera Azura telah ditutup / dimatikan.'
  };
}

module.exports = {
  startCameraStream,
  stopCameraStream,
  isCameraActive,
  isVideoIntroPlaying,
  initStreamerClient
};
