const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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

// Active camera stream sessions: guildId -> { streamer, abortController, ffmpegProcess, isIntroPlaying, channelId }
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
 * Start Continuous Seamless Video Camera Streaming in Voice Channel
 * Using single-pipe FFmpeg concat for seamless Video 1 -> Video 2 transition
 * 
 * @param {string} guildId 
 * @param {string} channelId 
 * @param {any} textChannel 
 * @param {string} requesterName 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function startCameraStream(guildId, channelId, textChannel = null, requesterName = 'Attila') {
  // 1. Anti-Spam Guard: If stream is already currently starting, ignore duplicate calls
  if (startingCameraGuilds.has(guildId)) {
    console.log(`[Video Streamer]: ⏳ Camera is already currently initializing in guild ${guildId}. Debouncing duplicate command.`);
    return {
      success: true,
      message: '⏳ Kamera Azura sedang dalam proses dinyalakan...'
    };
  }

  // 2. State Check: If already actively streaming in the same channel, don't restart/cancel
  if (activeCameraSessions.has(guildId)) {
    const existingSession = activeCameraSessions.get(guildId);
    if (existingSession.channelId === channelId) {
      console.log(`[Video Streamer]: 🎥 Camera is already actively streaming in channel ${channelId}.`);
      return {
        success: true,
        message: '🎥 Kamera Azura sudah aktif dan sedang streaming di Voice Channel ini.'
      };
    }
    // Channel changed: Stop previous session first before switching
    await stopCameraStream(guildId);
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
      ffmpegProcess: null,
      guildId,
      channelId,
      textChannel,
      isIntroPlaying: false
    };

    activeCameraSessions.set(guildId, sessionData);

    // Launch continuous video stream pipeline
    executeContinuousPipeline(sessionData, introPath, loopPath, introExists, loopExists);

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
 * Continuous FFmpeg Video Stream Pipeline
 * Plays Video 1 -> instantly transitions to Video 2 in ONE single WebRTC stream!
 */
async function executeContinuousPipeline(session, introPath, loopPath, introExists, loopExists) {
  const { streamer, abortController, guildId } = session;

  try {
    const { playStream } = await import('@dank074/discord-video-stream');

    const bin = ffmpegPath || 'ffmpeg';
    let ffmpegArgs = [];

    if (introExists && loopExists) {
      session.isIntroPlaying = true;
      console.log(`[Video Streamer]: 🎬 [Seamless Concat] Playing Video 1 (Intro) -> Video 2 (Looping)...`);

      // Play audio of intro through bot AudioPlayer (Native Discord Opus)
      try {
        const { playDirectAudioFile } = require('./voiceCompanion');
        playDirectAudioFile(guildId, introPath);
      } catch (_) {}

      // Intro duration timer (~10s)
      setTimeout(() => {
        if (session && !abortController.signal.aborted) {
          session.isIntroPlaying = false;
          console.log(`[Video Streamer]: 🔄 [Loop Active] Video 1 finished. Video 2 looping smoothly. Azura TTS active.`);
        }
      }, 10500);

      // Single FFmpeg command concatenating intro (1x) + loop (infinite) with realtime filter locking 24fps
      ffmpegArgs = [
        '-i', introPath,
        '-stream_loop', '-1',
        '-i', loopPath,
        '-filter_complex', '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1[v0];[1:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0,setpts=N/(24*TB),realtime[outv]',
        '-map', '[outv]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-b:v', '3300k',
        '-maxrate', '3500k',
        '-bufsize', '1650k',
        '-g', '24',
        '-keyint_min', '24',
        '-bf', '0',
        '-f', 'nut',
        'pipe:1'
      ];
    } else {
      const targetVideo = loopExists ? loopPath : introPath;
      session.isIntroPlaying = false;
      console.log(`[Video Streamer]: 🎬 Playing video loop: ${path.basename(targetVideo)}`);

      ffmpegArgs = [
        '-stream_loop', '-1',
        '-i', targetVideo,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,setpts=N/(24*TB),realtime',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-b:v', '3300k',
        '-maxrate', '3500k',
        '-bufsize', '1650k',
        '-g', '24',
        '-keyint_min', '24',
        '-bf', '0',
        '-f', 'nut',
        'pipe:1'
      ];
    }

    const ffmpegProc = spawn(bin, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    session.ffmpegProcess = ffmpegProc;

    ffmpegProc.stderr.on('data', (d) => {
      // Optional debug: console.log('[FFmpeg Video]:', d.toString());
    });

    ffmpegProc.on('error', (err) => {
      if (!abortController.signal.aborted) {
        console.error('[Video Streamer FFmpeg Error]:', err.message);
      }
    });

    ffmpegProc.on('close', (code) => {
      if (!abortController.signal.aborted) {
        console.log(`[Video Streamer FFmpeg]: Process exited with code ${code}`);
      }
    });

    // Feed FFmpeg stdout pipe directly to playStream
    await playStream(ffmpegProc.stdout, streamer, {
      type: 'camera',
      format: 'nut'
    }, abortController.signal);

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

  // If session active, clean up session resources
  if (session) {
    session.isIntroPlaying = false;
    try {
      session.abortController?.abort();
    } catch (_) {}

    try {
      if (session.ffmpegProcess) {
        try { session.ffmpegProcess.kill('SIGTERM'); } catch (_) {}
      }

      if (session.streamer) {
        try { session.streamer.signalVideo?.(false); } catch (_) {}
        try { session.streamer.stopStream?.(); } catch (_) {}
        try { session.streamer.leaveVoice?.(); } catch (_) {}
      }
    } catch (err) {
      console.warn('[Video Streamer Warning]: Error during stream cleanup:', err.message);
    } finally {
      activeCameraSessions.delete(guildId);
    }
  }

  // Failsafe: Ensure helper account leaves the voice channel in this guild
  if (streamerClient && guildId) {
    try {
      const guild = streamerClient.guilds.cache.get(guildId);
      const me = guild?.members?.me;
      if (me && me.voice && me.voice.channel) {
        await me.voice.disconnect().catch(() => {});
        console.log(`[Video Streamer]: 🚪 Helper account auto-exited VC in guild ${guildId}.`);
      }
    } catch (_) {}
  }

  console.log(`[Video Streamer]: 🛑 Camera stream stopped & helper exited for guild ${guildId}.`);

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
  initStreamerClient,
  prewarmStreamerClient
};
