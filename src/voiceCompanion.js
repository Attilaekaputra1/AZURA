const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const config = require('./config');

// Track active voice connections per guild: guildId -> VoiceConnection
const activeConnections = new Map();

// Track which text channel to use for chat replies per guild: guildId -> TextChannel
const companionTextChannels = new Map();

/**
 * Called when a user's voice state changes (join/move/leave).
 * If it's Attila, AZURA follows him in or out.
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
    const conn = activeConnections.get(guildId);
    if (conn) {
      console.log(`[Voice Companion]: Attila meninggalkan voice channel. AZURA ikut keluar.`);
      try {
        conn.destroy();
      } catch (_) {}
      activeConnections.delete(guildId);
      companionTextChannels.delete(guildId);
    }
  }

  // === Attila JOINED a new voice channel ===
  if (newChannel) {
    // Don't rejoin if already in the same channel
    const existingConn = activeConnections.get(guildId);
    if (existingConn) {
      // If Attila moved channels, destroy old connection first
      try { existingConn.destroy(); } catch (_) {}
      activeConnections.delete(guildId);
    }

    // Try to join the voice channel
    try {
      console.log(`[Voice Companion]: Attila masuk ke "${newChannel.name}". AZURA ikut join...`);

      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfMute: true,     // Bot muted (tidak berbicara)
        selfDeaf: true,     // Bot deafened (tidak mendengar audio)
      });

      // Wait for connection to be Ready
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      activeConnections.set(guildId, connection);
      console.log(`[Voice Companion]: AZURA berhasil join voice channel "${newChannel.name}" di guild "${guild.name}".`);

      // Auto-disconnect handler if bot is forcefully removed from VC
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          // Try to reconnect once
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          activeConnections.delete(guildId);
          companionTextChannels.delete(guildId);
          console.log(`[Voice Companion]: AZURA dikeluarkan dari VC di guild "${guild.name}".`);
        }
      });

      // Find the best text channel to respond in:
      // Priority: Voice channel's built-in text > general > first accessible text channel
      const textChannel = findBestTextChannel(guild, newChannel, client);
      if (textChannel) {
        companionTextChannels.set(guildId, textChannel);
        await textChannel.send(`aku ikut kamu yaa`).catch(() => {});
      }

    } catch (error) {
      console.error(`[Voice Companion Error]: Gagal join VC "${newChannel.name}":`, error.message || error);
      // Silently fail — might not have permission
    }
  }
}

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

  // Priority 1: Try the voice channel itself — Discord supports text-in-voice natively.
  // VoiceChannel.isTextBased() returns true in discord.js v14 for voice channels.
  try {
    if (voiceChannel.isTextBased?.() && voiceChannel.permissionsFor(me)?.has('SendMessages')) {
      return voiceChannel;
    }
  } catch (_) {}

  // Priority 2: Look for common named channels
  const priorities = ['general', 'umum', 'chat', 'obrolan', 'lobby', 'lobi', 'main', 'bot'];
  const textChannels = guild.channels.cache.filter(ch =>
    ch.isTextBased() && !ch.isThread() && ch.permissionsFor(me)?.has('SendMessages')
  );

  for (const keyword of priorities) {
    const found = textChannels.find(ch => ch.name.toLowerCase().includes(keyword));
    if (found) return found;
  }

  // Fallback: first available text channel
  return textChannels.first() || null;
}

/**
 * Get the tracked companion text channel for a guild, used by messageCreate handler
 * to know where AZURA should reply when in companion mode.
 */
function getCompanionTextChannel(guildId) {
  return companionTextChannels.get(guildId) || null;
}

/**
 * Check if AZURA is currently in companion mode in a guild
 */
function isInCompanionMode(guildId) {
  return activeConnections.has(guildId);
}

module.exports = {
  handleVoiceStateUpdate,
  getCompanionTextChannel,
  isInCompanionMode
};
