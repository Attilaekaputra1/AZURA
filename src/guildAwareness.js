/**
 * AZURA Guild Awareness & On-Demand Cross-Channel Context Engine
 * 
 * Provides:
 * 1. Guild Topology Scanning: Maps categories, text channels, voice channels, and forums in a compact format.
 * 2. Channel Reference Detection: Detects when a user refers to or mentions another channel in their prompt.
 * 3. On-Demand Cross-Channel Ingestion: Fetches recent conversation history from the referenced channel on demand.
 */

const { ChannelType } = require('discord.js');

// Short-term cache for guild channel topology to minimize Discord API overhead
const topologyCache = new Map(); // guildId -> { text: string, timestamp: number }
const TOPOLOGY_CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Scan and return a compact topology representation of the Discord Guild.
 * @param {import('discord.js').Guild} guild 
 * @returns {string}
 */
function getGuildTopologyContext(guild) {
  if (!guild || !guild.channels) return '';

  const now = Date.now();
  const cached = topologyCache.get(guild.id);
  if (cached && (now - cached.timestamp) < TOPOLOGY_CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const channels = guild.channels.cache;
    if (!channels || channels.size === 0) return '';

    const categories = new Map(); // categoryName -> Array<string>
    const uncategorized = [];

    // Group channels by category
    channels.forEach(ch => {
      // Skip categories themselves
      if (ch.type === ChannelType.GuildCategory) return;

      let typeIcon = '💬';
      if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
        typeIcon = '🔊';
      } else if (ch.type === ChannelType.GuildForum) {
        typeIcon = '📑';
      } else if (ch.type === ChannelType.GuildAnnouncement) {
        typeIcon = '📢';
      }

      const entry = `${typeIcon} #${ch.name}`;

      if (ch.parent) {
        const catName = ch.parent.name.toUpperCase();
        if (!categories.has(catName)) {
          categories.set(catName, []);
        }
        categories.get(catName).push(entry);
      } else {
        uncategorized.push(entry);
      }
    });

    let lines = [`[PETA CHANNEL & STRUKTUR SERVER "${guild.name.toUpperCase()}"]:`];
    
    if (uncategorized.length > 0) {
      lines.push(`• Channel Utama: ${uncategorized.slice(0, 8).join(', ')}`);
    }

    for (const [catName, chList] of categories.entries()) {
      lines.push(`• Kategori [${catName}]: ${chList.slice(0, 8).join(', ')}`);
    }

    lines.push(`(Gunakan informasi di atas jika user bertanya tentang struktur server, channel yang tersedia, atau topik server).`);

    const result = '\n\n' + lines.join('\n');
    topologyCache.set(guild.id, { text: result, timestamp: now });
    return result;
  } catch (err) {
    console.warn('[GuildAwareness Warning]: Failed to build topology context:', err.message);
    return '';
  }
}

/**
 * Detect if the user prompt mentions or refers to a specific channel in the guild.
 * @param {string} prompt 
 * @param {import('discord.js').Guild} guild 
 * @param {string} [currentChannelId=null]
 * @returns {{ channel: import('discord.js').GuildBasedChannel, channelName: string }|null}
 */
function detectChannelReference(prompt, guild, currentChannelId = null) {
  if (!prompt || typeof prompt !== 'string' || !guild || !guild.channels) return null;

  const lowerPrompt = prompt.toLowerCase();

  // 1. Direct Discord Channel Mention (<#channel_id>)
  const mentionMatch = prompt.match(/<#([a-zA-Z0-9_-]+)>/);
  if (mentionMatch) {
    const targetId = mentionMatch[1];
    if (targetId !== currentChannelId) {
      const ch = guild.channels.cache.get(targetId);
      if (ch && (ch.isTextBased?.() || ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) {
        return { channel: ch, channelName: ch.name };
      }
    }
  }

  // 2. Named channel mention (#channel-name or "channel project", "di general", "obrolan project")
  const channels = guild.channels.cache;
  for (const ch of channels.values()) {
    // Only search text-based channels
    if (!ch.isTextBased?.() && ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) continue;
    if (ch.id === currentChannelId) continue;

    const cleanName = ch.name.toLowerCase().replace(/[-_]+/g, ' ');
    const rawName = ch.name.toLowerCase();

    // Check patterns: "#general", "channel general", "di general", "obrolan general", "chat general"
    const patterns = [
      new RegExp(`(?:#|channel\\s+|di\\s+channel\\s+|di\\s+|obrolan\\s+|chat\\s+)${rawName}\\b`, 'i'),
      new RegExp(`(?:#|channel\\s+|di\\s+channel\\s+|di\\s+|obrolan\\s+|chat\\s+)${cleanName}\\b`, 'i'),
      new RegExp(`\\b${rawName}\\b`, 'i')
    ];

    // Only match if explicit context keywords are present to prevent accidental matches with short common words
    const hasChannelContext = /\b(?:channel|di|obrolan|chat|topik|bahas|tadi|kemarin|sebelah)\b/i.test(lowerPrompt);

    if (patterns[0].test(prompt) || patterns[1].test(prompt) || (hasChannelContext && patterns[2].test(prompt))) {
      return { channel: ch, channelName: ch.name };
    }
  }

  return null;
}

/**
 * Format relative time in Indonesian
 * @param {Date} date 
 * @returns {string}
 */
function getRelativeTimeStr(date) {
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'baru saja';
  if (diffMins < 60) return `${diffMins} menit lalu`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} hari lalu`;
}

/**
 * Fetch and format recent messages from a referenced channel on-demand.
 * @param {import('discord.js').TextBasedChannel} channel 
 * @param {number} [limit=12] 
 * @returns {Promise<string>}
 */
async function fetchCrossChannelContext(channel, limit = 12) {
  if (!channel || !channel.messages || typeof channel.messages.fetch !== 'function') return '';

  try {
    const fetched = await channel.messages.fetch({ limit });
    if (!fetched || fetched.size === 0) {
      return `\n\n[DATA OBROLAN DI CHANNEL #${channel.name.toUpperCase()}]:\nChannel #${channel.name} saat ini masih kosong / belum ada pesan baru. Jelaskan secara ramah bahwa channel tersebut masih sepi.`;
    }

    // Chronological order (oldest to newest)
    const sorted = Array.from(fetched.values()).reverse();
    const validMessages = sorted.filter(m => !m.system && m.content && m.content.trim().length > 0);

    if (validMessages.length === 0) {
      return `\n\n[DATA OBROLAN DI CHANNEL #${channel.name.toUpperCase()}]:\nBelum ada pesan teks terbaru di channel #${channel.name}. Jelaskan dengan santai bahwa belum ada obrolan baru di sana.`;
    }

    const latestMsg = validMessages[validMessages.length - 1];
    const latestTime = getRelativeTimeStr(latestMsg.createdAt);

    const formatted = validMessages.slice(-10).map(m => {
      const author = m.member?.displayName || m.author?.globalName || m.author?.username || 'User';
      const timeStr = getRelativeTimeStr(m.createdAt);
      const cleanContent = m.content.replace(/\n+/g, ' ').slice(0, 200);
      return `• [${author} (${timeStr})]: "${cleanContent}"`;
    });

    return `\n\n[REKAMAN OBROLAN TERAKHIR DI CHANNEL #${channel.name.toUpperCase()}]:\n` +
      `Status: Pesan terakhir dikirim ${latestTime}.\n` +
      `Daftar Pesan:\n` +
      formatted.join('\n') +
      `\n\nPANDUAN MERESPONS OBROLAN CHANNEL #${channel.name.toUpperCase()}:\n` +
      `1. RANGKUM INTI TOPIK: Jelaskan inti bahasan obrolan di channel #${channel.name} di atas secara ringkas, akurat, dan mengalir (1 - 3 kalimat santai).\n` +
      `2. JIKA SUDAH LAMA: Jika waktu pesan terakhir tertulis berjam-jam/berhari-hari lalu, sampaikan bahwa channel tersebut lagi sepi dan sebutkan topik terakhir yang sempat diobrolin.\n` +
      `3. JANGAN membaca format teks mentah / bullet point secara kaku; sampaikan secara alami seolah kamu baru saja menengok obrolan di channel tersebut!`;
  } catch (err) {
    console.warn(`[GuildAwareness Warning]: Failed to fetch cross-channel messages for #${channel?.name}:`, err.message);
    return '';
  }
}

/**
 * Invalidate topology cache (e.g. on channelCreate/channelDelete/channelUpdate)
 * @param {string} guildId 
 */
function invalidateTopologyCache(guildId) {
  if (guildId) {
    topologyCache.delete(guildId);
  }
}

module.exports = {
  getGuildTopologyContext,
  detectChannelReference,
  fetchCrossChannelContext,
  invalidateTopologyCache
};
