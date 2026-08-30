const play = require('play-dl');
const fs = require('fs');
let ffmpegPath = null;
try {
  const ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    ffmpegPath = ffmpegStatic;
  }
} catch (_) {}

if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
  console.log('[Music Streamer]: Using ffmpeg-static at', ffmpegPath);
} else {
  console.log('[Music Streamer]: Using system FFmpeg from PATH.');
}
const { createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

let isInitialized = false;
async function initPlayDl(forceRefresh = false) {
  if (isInitialized && !forceRefresh) return true;
  try {
    const clientId = await play.getFreeClientID();
    if (clientId) {
      await play.setToken({ soundcloud: { client_id: clientId } });
      isInitialized = true;
      console.log('[Music Streamer]: SoundCloud Free Client ID initialized successfully.');
      return true;
    }
  } catch (e) {
    console.warn('[Music Streamer]: Failed to init SoundCloud client ID:', e.message);
  }
  return false;
}

// Map of active guild music state: guildId -> { currentTrack, textChannel, player, isPlaying }
const guildMusicSessions = new Map();

/**
 * Search and stream a song directly into the Voice Channel AudioPlayer.
 * Seamlessly stops/swaps any currently playing track.
 * @param {string} guildId 
 * @param {string} query 
 * @param {import('@discordjs/voice').AudioPlayer} player 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {string} requesterName 
 * @returns {Promise<{ success: boolean, track?: any, message: string }>}
 */
async function streamMusicDirect(guildId, query, player, textChannel, requesterName = 'Attila') {
  await initPlayDl();

  try {
    const cleanQuery = query.replace(/[.,!?;:"'()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`[Music Streamer]: 🔍 Searching for "${cleanQuery}"...`);
    let results = [];
    try {
      results = await play.search(cleanQuery, { source: { soundcloud: 'tracks' }, limit: 1 });
    } catch (searchErr) {
      console.warn('[Music Streamer]: Search error, retrying with refreshed token...', searchErr.message);
      await initPlayDl(true);
      results = await play.search(cleanQuery, { source: { soundcloud: 'tracks' }, limit: 1 }).catch(() => []);
    }

    if (!results || results.length === 0) {
      console.warn(`[Music Streamer]: No track found for "${cleanQuery}"`);
      if (textChannel) {
        textChannel.send(`Maaf ${requesterName}, aku nggak nemu lagu **${cleanQuery}** di database musik. Coba sebut judul lain ya! 🎶`).catch(() => {});
      }
      return { success: false, message: `Maaf, aku nggak nemu lagu dengan judul "${cleanQuery}". Coba judul lain ya!` };
    }

    const track = results[0];
    console.log(`[Music Streamer]: 🎵 Found track: "${track.name}" (${track.url})`);

    // Stop any existing song stream before playing the new one
    const existing = guildMusicSessions.get(guildId);
    if (existing && existing.player) {
      console.log(`[Music Streamer]: 🔄 Stopping previous track to switch to "${track.name}"...`);
      try {
        existing.player.stop();
      } catch (_) {}
    }

    const stream = await play.stream(track.url);
    console.log(`[Music Streamer]: Audio stream extracted successfully (type: ${stream.type}). Creating AudioResource...`);

    const audioResource = createAudioResource(stream.stream, { inputType: stream.type });
    audioResource.playStream.on('error', (err) => {
      console.error('[Music Stream Resource Error]:', err.message);
    });

    // Ensure bot is unmuted in Voice Channel
    try {
      const { activeConnections } = require('./voiceCompanion');
      const conn = activeConnections.get(guildId);
      if (conn) conn.rejoin({ selfMute: false, selfDeaf: false });
    } catch (_) {}

    // Play on the AudioPlayer
    player.play(audioResource);
    console.log(`[Music Streamer]: ▶️ AudioPlayer started playing "${track.name}" in guild ${guildId}`);

    guildMusicSessions.set(guildId, {
      currentTrack: track,
      isPlaying: true,
      textChannel,
      player
    });

    const durationStr = track.durationInSec
      ? `${Math.floor(track.durationInSec / 60)}:${String(track.durationInSec % 60).padStart(2, '0')}`
      : '03:30';

    const embed = new EmbedBuilder()
      .setTitle('🎶 Sedang Memutar Musik di Voice Channel')
      .setDescription(
        `🎧 **Judul Lagu:** [${track.name}](${track.url})\n` +
        `⏱️ **Durasi:** \`${durationStr}\`\n` +
        `👤 **Diminta oleh:** **${requesterName}**\n\n` +
        `*Audio sedang di-stream langsung ke dalam Voice Channel.*`
      )
      .setColor(0x1DB954)
      .setThumbnail(track.thumbnail || null)
      .setFooter({ text: 'AZURA Direct Voice Music Streaming • High Quality Audio' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`music_pause_${guildId}`)
        .setLabel('⏸️ Pause / Resume')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`music_stop_${guildId}`)
        .setLabel('⏹️ Stop Musik')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setLabel('🔗 Buka Lagu')
        .setStyle(ButtonStyle.Link)
        .setURL(track.url)
    );

    if (textChannel) {
      await textChannel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }

    return {
      success: true,
      track: {
        title: track.name,
        duration: durationStr,
        url: track.url
      },
      message: `Siap ${requesterName} sayang! Lagi aku puterin lagu **${track.name}** langsung di Voice Channel nih, selamat mendengarkan yaa! 🎶✨`
    };
  } catch (err) {
    console.error('[Music Streamer Error]:', err.message || err);
    return { success: false, message: `Gagal memutar lagu: ${err.message}` };
  }
}

function pauseMusic(guildId) {
  const session = guildMusicSessions.get(guildId);
  const { audioPlayers } = require('./voiceCompanion');
  const player = session?.player || audioPlayers.get(guildId);

  if (!session || !player) return { success: false, message: 'Tidak ada musik yang sedang diputar di Voice Channel.' };

  if (player.state.status === AudioPlayerStatus.Paused) {
    return { success: true, message: '⏸️ Musik sudah dalam keadaan dijeda (paused).' };
  }

  try {
    player.pause(true);
    session.isPlaying = false;
    console.log(`[Music Streamer]: ⏸️ Music paused in guild ${guildId}`);
    return { success: true, message: `⏸️ Musik **${session.currentTrack?.name || 'lagu'}** sudah dijeda (pause).` };
  } catch (err) {
    console.error('[Music Streamer Pause Error]:', err.message);
    return { success: false, message: `Gagal menjeda musik: ${err.message}` };
  }
}

async function resumeMusic(guildId) {
  const session = guildMusicSessions.get(guildId);
  const { audioPlayers } = require('./voiceCompanion');
  const player = session?.player || audioPlayers.get(guildId);

  if (!session || !session.currentTrack || !player) {
    return { success: false, message: 'Tidak ada lagu yang sedang dijeda untuk dilanjutkan.' };
  }

  // 1. If player is currently paused, unpause it
  if (player.state.status === AudioPlayerStatus.Paused) {
    const unpaused = player.unpause();
    session.isPlaying = true;
    console.log(`[Music Streamer]: ▶️ Music unpaused in guild ${guildId} (res=${unpaused})`);
    return { success: true, message: `▶️ Musik **${session.currentTrack.name || 'lagu'}** dilanjutkan kembali!` };
  }

  // 2. If player is Idle or stream was evicted by voice TTS, re-stream seamlessly!
  try {
    console.log(`[Music Streamer]: 🔄 Re-streaming "${session.currentTrack.name}" to resume playback...`);
    await initPlayDl();
    const stream = await play.stream(session.currentTrack.url);
    const audioResource = createAudioResource(stream.stream, { inputType: stream.type });
    player.play(audioResource);
    session.isPlaying = true;
    session.player = player;
    console.log(`[Music Streamer]: ▶️ Successfully resumed and re-streamed "${session.currentTrack.name}"`);
    return { success: true, message: `▶️ Melanjutkan pemutaran musik **${session.currentTrack.name || 'lagu'}**!` };
  } catch (err) {
    console.error('[Music Streamer Resume Error]:', err.message);
    return { success: false, message: `Gagal melanjutkan musik: ${err.message}` };
  }
}

async function pauseOrResumeMusic(guildId) {
  const session = guildMusicSessions.get(guildId);
  const { audioPlayers } = require('./voiceCompanion');
  const player = session?.player || audioPlayers.get(guildId);

  if (!session || !player) return { success: false, message: 'Tidak ada musik yang sedang diputar di Voice Channel.' };

  if (player.state.status === AudioPlayerStatus.Paused || !session.isPlaying) {
    return await resumeMusic(guildId);
  } else {
    return pauseMusic(guildId);
  }
}

function stopMusic(guildId) {
  const session = guildMusicSessions.get(guildId);
  if (!session || !session.player) return { success: false, message: 'Tidak ada musik yang sedang diputar di Voice Channel.' };

  session.player.stop();
  guildMusicSessions.delete(guildId);

  // Auto-mute bot after music is stopped
  try {
    const { activeConnections } = require('./voiceCompanion');
    const conn = activeConnections.get(guildId);
    if (conn) conn.rejoin({ selfMute: true, selfDeaf: false });
  } catch (_) {}

  return { success: true, message: '⏹️ Musik dihentikan.' };
}

module.exports = {
  streamMusicDirect,
  pauseMusic,
  resumeMusic,
  pauseOrResumeMusic,
  stopMusic,
  guildMusicSessions
};
