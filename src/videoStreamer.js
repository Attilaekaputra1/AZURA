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

// Active camera stream sessions: guildId -> { streamer, abortController, isIntroPlaying, currentPhase, textChannel }
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
  if (isStreamerReady && streamerClient && streamerHelper) {
    return { streamerClient, streamerHelper };
  }
  if (streamerInitPromise) return streamerInitPromise;

  streamerInitPromise = (async () => {
    const token = config.STREAMER_USER_TOKEN;
    if (!token) {
      console.warn('[Video Streamer]: ⚠️ STREAMER_USER_TOKEN not configured in .env.');
      return { streamerClient: null, streamerHelper: null };
    }

    try {
      let SelfbotClient, Streamer;
      try {
        const selfbotModule = require('discord.js-selfbot-v13');
        SelfbotClient = selfbotModule.Client || selfbotModule.default?.Client || selfbotModule;
        const videoStreamModule = await import('@dank074/discord-video-stream');
        Streamer = videoStreamModule.Streamer;
      } catch (reqErr) {
        console.warn('[Video Streamer]: ⚠️ Failed to load video streamer dependencies:', reqErr.message);
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
          reject(new Error('Streamer login timed out after 20s'));
        }, 20000);

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
 * @param {string} guildId 
 * @returns {boolean}
 */
function isVideoIntroPlaying(guildId) {
  const session = activeCameraSessions.get(guildId);
  return !!(session && session.isIntroPlaying);
}

/**
 * Start 2-Phase Video Camera Streaming in Voice Channel
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
    const errorMsg = `⚠️ File video kamera belum ditemukan di \`/assets/videos/\`.\nPastikan file \`cam_intro.mp4\` dan \`cam_loop.mp4\` sudah di-upload.`;
    console.warn(`[Video Streamer]: ${errorMsg}`);
    if (textChannel) {
      await textChannel.send(errorMsg).catch(() => {});
    }
    return { success: false, message: errorMsg };
  }

  // Stop any existing stream in this guild first
  if (activeCameraSessions.has(guildId)) {
    await stopCameraStream(guildId);
  }

  const { streamerHelper: streamer } = await initStreamerClient();
  if (!streamer) {
    const errorMsg = '⚠️ Streamer Helper belum siap atau `STREAMER_USER_TOKEN` tidak valid.';
    console.warn(`[Video Streamer]: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }

  try {
    console.log(`[Video Streamer]: 🎥 Opening camera stream in guild ${guildId}, channel ${channelId}...`);

    await streamer.joinVoice(guildId, channelId);

    const abortController = new AbortController();
    const sessionData = {
      streamer,
      abortController,
      guildId,
      channelId,
      textChannel,
      isIntroPlaying: false,
      currentPhase: 'INIT'
    };

    activeCameraSessions.set(guildId, sessionData);

    // Run 2-phase pipeline in background
    execute2PhasePipeline(sessionData, introPath, loopPath, introExists, loopExists).catch(err => {
      console.error('[Video Streamer Pipeline Error]:', err.message);
    });

    return {
      success: true,
      message: `🎥 Kamera Azura berhasil dinyalakan oleh **${requesterName}**! (Fase 1: Sambutan ➔ Fase 2: Looping Cam)`
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
 * 2-Phase Stream Orchestrator using @dank074/discord-video-stream v6 API
 */
async function execute2PhasePipeline(session, introPath, loopPath, introExists, loopExists) {
  const { streamer, abortController, guildId } = session;

  try {
    const { prepareStream, playStream } = await import('@dank074/discord-video-stream');

    // ── PHASE 1: Video 1 (Intro Sambutan with Synchronized Audio) ──
    if (introExists && !abortController.signal.aborted) {
      session.currentPhase = 'PHASE_1_INTRO';
      session.isIntroPlaying = true;
      console.log(`[Video Streamer]: 🎬 [Phase 1] Playing Video 1 (Intro Visual + Audio)... Azura TTS muted.`);

      // Play audio track directly in VC via Azura AudioPlayer (100% native Discord Opus)
      try {
        const { playDirectAudioFile } = require('./voiceCompanion');
        playDirectAudioFile(guildId, introPath);
      } catch (audioErr) {
        console.warn('[Video Streamer]: Direct audio play notice:', audioErr.message);
      }

      try {
        const { output } = prepareStream(introPath, {
          width: 1280,
          height: 720,
          frameRate: 24,
          bitrateVideo: 2500,
          includeAudio: false
        }, abortController.signal);

        await playStream(output, streamer, {
          type: 'camera'
        }, abortController.signal);
      } catch (introErr) {
        if (!abortController.signal.aborted) {
          console.warn('[Video Streamer Warning]: Intro playback completed/transitioned:', introErr.message);
        }
      }
    }

    if (abortController.signal.aborted) return;

    // ── PHASE 2: Video 2 (Looping Visual Mute) ──
    session.isIntroPlaying = false;
    session.currentPhase = 'PHASE_2_LOOP';
    console.log(`[Video Streamer]: 🔄 [Phase 2] Seamlessly transitioning to Video 2 (Looping Visual Mute). Azura TTS active.`);

    const targetLoopVideo = loopExists ? loopPath : introPath;

    while (activeCameraSessions.has(guildId) && !abortController.signal.aborted) {
      try {
        const { output } = prepareStream(targetLoopVideo, {
          width: 1280,
          height: 720,
          frameRate: 24,
          bitrateVideo: 2500,
          includeAudio: false,
          customInputOptions: ['-stream_loop', '-1']
        }, abortController.signal);

        await playStream(output, streamer, {
          type: 'camera'
        }, abortController.signal);
      } catch (loopErr) {
        if (abortController.signal.aborted || !activeCameraSessions.has(guildId)) break;
        await new Promise(r => setTimeout(r, 600));
      }
    }
  } catch (globalErr) {
    if (!abortController.signal.aborted) {
      console.error('[Video Streamer Pipeline Error]:', globalErr.message);
    }
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

  session.isIntroPlaying = false;
  try {
    session.abortController?.abort();
  } catch (_) {}

  try {
    if (session.streamer) {
      try {
        session.streamer.signalVideo?.(false);
        session.streamer.stopStream?.();
      } catch (_) {}
      try {
        session.streamer.leaveVoice?.();
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

function isCameraStarting(guildId) {
  return false;
}

function prewarmStreamerClient() {
  initStreamerClient().catch(() => {});
}

module.exports = {
  startCameraStream,
  stopCameraStream,
  isCameraActive,
  isCameraStarting,
  isVideoIntroPlaying,
  prewarmStreamerClient,
  initStreamerClient
};
