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

// Active camera stream sessions: guildId -> { streamer, abortController, channelId, isIntroPlaying }
const activeCameraSessions = new Map();
// Guilds currently in the middle of launching a camera stream (Anti-Spam State Lock)
const startingCameraGuilds = new Set();

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
 * Pre-warm the helper streamer client at application startup
 */
function prewarmStreamerClient() {
  console.log('[Video Streamer]: 🚀 Pre-warming Azura Cam streamer helper client...');
  initStreamerClient().catch(err => {
    console.warn('[Video Streamer Warning]: Pre-warm warning:', err.message);
  });
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
 * Check if camera stream is currently initializing (Anti-Spam Lock)
 * @param {string} guildId 
 * @returns {boolean}
 */
function isCameraStarting(guildId) {
  return startingCameraGuilds.has(guildId);
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
  if (startingCameraGuilds.has(guildId)) {
    console.log(`[Video Streamer]: ⏳ Camera is already currently initializing in guild ${guildId}.`);
    return {
      success: true,
      message: '⏳ Kamera Azura sedang dalam proses dinyalakan...'
    };
  }

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
    const existing = activeCameraSessions.get(guildId);
    if (existing && existing.channelId === channelId) {
      return {
        success: true,
        message: '🎥 Kamera Azura sudah aktif dan sedang streaming di Voice Channel ini.'
      };
    }
    await stopCameraStream(guildId);
  }

  startingCameraGuilds.add(guildId);

  try {
    const { streamerHelper: streamer } = await initStreamerClient();
    if (!streamer) {
      const errorMsg = '⚠️ Streamer Helper belum siap atau `STREAMER_USER_TOKEN` tidak valid.';
      console.warn(`[Video Streamer]: ${errorMsg}`);
      return { success: false, message: errorMsg };
    }

    console.log(`[Video Streamer]: 🎥 Opening camera stream in guild ${guildId}, channel ${channelId}...`);

    await streamer.joinVoice(guildId, channelId);

    const abortController = new AbortController();
    const sessionData = {
      streamer,
      abortController,
      guildId,
      channelId,
      textChannel,
      isIntroPlaying: false
    };

    activeCameraSessions.set(guildId, sessionData);

    // Run continuous seamless stream (Video 1 Intro -> Video 2 Loop)
    executeContinuousPipeline(sessionData, introPath, loopPath, introExists, loopExists).catch(err => {
      console.error('[Video Streamer Pipeline Error]:', err.message);
    });

    return {
      success: true,
      message: `🎥 Kamera Azura berhasil dinyalakan oleh **${requesterName}**! (Video 1: Sambutan ➔ Video 2: Looping Cam)`
    };
  } catch (err) {
    console.error('[Video Streamer Error]: Failed to start stream:', err.message);
    activeCameraSessions.delete(guildId);
    return {
      success: false,
      message: `Gagal menyalakan kamera: ${err.message}`
    };
  } finally {
    startingCameraGuilds.delete(guildId);
  }
}

/**
 * Continuous Camera Stream Orchestrator
 * Seamlessly plays Video 1 (Intro + Native Audio) -> Video 2 (Infinite Looping Cam)
 */
async function executeContinuousPipeline(session, introPath, loopPath, introExists, loopExists) {
  const { streamer, abortController, guildId } = session;

  try {
    const { prepareStream, playStream } = await import('@dank074/discord-video-stream');

    if (introExists && loopExists) {
      session.isIntroPlaying = true;
      console.log(`[Video Streamer]: 🎬 [Seamless Concat] Video 1 (Intro Sambutan) ➔ Video 2 (Looping Cam)...`);

      // Play audio of intro through bot AudioPlayer (Native Discord Opus)
      try {
        const { playDirectAudioFile } = require('./voiceCompanion');
        playDirectAudioFile(guildId, introPath);
      } catch (_) {}

      // Intro duration timer (~10s)
      setTimeout(() => {
        if (session && !abortController.signal.aborted) {
          session.isIntroPlaying = false;
          console.log(`[Video Streamer]: 🔄 [Loop Active] Video 1 finished. Video 2 looping smoothly.`);
        }
      }, 10500);

      const ffmpeg = require('fluent-ffmpeg');
      const { PassThrough } = require('stream');
      const outStream = new PassThrough();

      const cmd = ffmpeg()
        .input(introPath)
        .input(loopPath)
        .inputOptions(['-stream_loop -1'])
        .complexFilter([
          '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1[v0]',
          '[1:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1[v1]',
          '[v0][v1]concat=n=2:v=1:a=0,setpts=N/(24*TB),realtime[outv]'
        ])
        .outputOptions([
          '-map [outv]',
          '-c:v libx264',
          '-preset ultrafast',
          '-tune zerolatency',
          '-profile:v baseline',
          '-level 3.1',
          '-x264-params repeat-headers=1:keyint=24:min-keyint=24:scenecut=0:bframes=0',
          '-pix_fmt yuv420p',
          '-b:v 2000k',
          '-maxrate 2200k',
          '-bufsize 1100k',
          '-f nut'
        ])
        .output(outStream);

      session.ffmpegProcess = cmd;

      abortController.signal.addEventListener('abort', () => {
        try { cmd.kill('SIGTERM'); } catch (_) {}
      });

      cmd.on('error', (err) => {
        if (!abortController.signal.aborted) {
          console.warn('[Video Streamer FFmpeg]:', err.message);
        }
      });

      cmd.run();

      await playStream(outStream, streamer, {
        type: 'camera',
        format: 'nut',
        width: 1280,
        height: 720,
        frameRate: 24
      }, abortController.signal);

    } else {
      const targetVideo = loopExists ? loopPath : introPath;
      session.isIntroPlaying = false;
      console.log(`[Video Streamer]: 🎬 Streaming video: ${path.basename(targetVideo)}...`);

      const { output } = prepareStream(targetVideo, {
        width: 1280,
        height: 720,
        frameRate: 24,
        bitrateVideo: 2000,
        includeAudio: false,
        customInputOptions: ['-stream_loop', '-1']
      }, abortController.signal);

      await playStream(output, streamer, {
        type: 'camera',
        width: 1280,
        height: 720,
        frameRate: 24
      }, abortController.signal);
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

module.exports = {
  startCameraStream,
  stopCameraStream,
  isCameraActive,
  isCameraStarting,
  isVideoIntroPlaying,
  prewarmStreamerClient,
  initStreamerClient
};
