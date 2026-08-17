const config = require('./config');
const { askAzura } = require('./azura');

// Store active pending mentions: key = messageId -> { timer, channelId, authorId, authorName, text }
const pendingMentions = new Map();

/**
 * Forward specific mention prompt directly to Attila's private DM
 * @param {import('discord.js').Message} message 
 * @param {string} authorName 
 * @param {string} rawPrompt 
 */
async function forwardToOwnerDM(message, authorName, rawPrompt) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return;

  try {
    const ownerUser = await message.client.users.fetch(ownerId).catch(() => null);
    if (ownerUser) {
      const channelName = message.channel.name ? `#${message.channel.name}` : 'Channel Server';
      const guildName = message.guild?.name || 'Server';
      const msgUrl = message.url || '';

      const dmContent = `📩 **[AUTO-FORWARD ASSISTANT] Pesan Spesifik untuk Attila!**\n\n` +
                        `• **Pengirim**: **${authorName}** (<@${message.author.id}>)\n` +
                        `• **Lokasi**: ${guildName} (${channelName})\n` +
                        `• **Pesan / Pertanyaan**: "${rawPrompt || '(Tag tanpa teks)'}"\n` +
                        (msgUrl ? `🔗 **Link Pesan**: ${msgUrl}` : '');

      await ownerUser.send(dmContent);
      console.log(`[AutoReply]: Forwarded mention from ${authorName} directly to Attila's DM.`);
    }
  } catch (err) {
    console.error('[AutoReply DM Forward Error]:', err.message || err);
  }
}

/**
 * Handle incoming message for owner (Attila) mention tracking
 * @param {import('discord.js').Message} message 
 */
function handleOwnerMentionTracking(message) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return; // Feature active only if OWNER_DISCORD_ID is configured

  // 1. If Attila (Owner) sends a message in the channel, clear all pending timers for this channel
  if (message.author.id === ownerId) {
    for (const [msgId, item] of pendingMentions.entries()) {
      if (item.channelId === message.channel.id) {
        clearTimeout(item.timer);
        pendingMentions.delete(msgId);
        console.log(`[AutoReply]: Attila replied in channel #${message.channel.name || message.channel.id}. Cancelled 2-min countdown for msg ${msgId}.`);
      }
    }
    return;
  }

  // 2. Ignore bot messages, non-server messages, or @everyone/@here mass mentions
  if (message.author.bot || !message.guild || message.mentions.everyone) return;

  // 3. Check if message mentions Attila (Owner)
  const isOwnerMentioned = message.mentions.users.has(ownerId);
  if (!isOwnerMentioned) return;

  console.log(`[AutoReply]: Attila mentioned by ${message.author.tag} in #${message.channel.name}. Starting 2-min countdown...`);

  const rawPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
  const authorName = message.member?.displayName || message.author.displayName || message.author.username;

  // 4. Start 2-minute (120,000 ms) countdown
  const timer = setTimeout(async () => {
    pendingMentions.delete(message.id);
    console.log(`[AutoReply]: 2 minutes elapsed without Attila's reply for msg ${message.id}. AZURA evaluating...`);

    try {
      await message.channel.sendTyping();

      let promptContext;
      if (!rawPrompt) {
        // Case A: Tagged Attila without any text/message
        await forwardToOwnerDM(message, authorName, rawPrompt);
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) di server 2 menit lalu TANPA pesan/pertanyaan tambahan. Karena Attila belum sempat merespon dalam 2 menit, katakan secara santai, rapi, dan Gen Z sewajarnya dengan maksud: "Attila lagi sibuk nih, sementara sama aku dulu yaa. Ada yang bisa aku bantu? Atau ada pesan yang mau diteruskan ke Attila? Let me know yaa".`;
      } else {
        // Case B: Tagged Attila with specific prompt/question
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) 2 menit lalu di server dengan pesan/pertanyaan: "${rawPrompt}". Attila belum merespon dalam 2 menit ini.

EVALUASI CERDAS & ATURAN DUAL-PATH:
1. PAHAMI MENDALAM isi pesan "${rawPrompt}".
2. JIKA PERTANYAAN INI ADALAH INFORMASI UMUM / TEKNIS / DATA (misal berita, harga kripto, kurs, fakta umum, anime, terjemahan) dan KAMU TAHU JAWABANNYA / BISA DICARI VIA TAVILY WEB SEARCH:
   - Jawablah pertanyaan tersebut secara lengkap, cerdas, akurat, dan solutif di server.
   - Sampaikan santai bahwa Attila lagi away/belum sempet buka chat, tapi kebetulan kamu punya datanya untuk membantu mereka duluan.

3. JIKA PERTANYAAN INI SPESIFIK / PRIBADI UNTUK ATTILA (misal kesepakatan harga, janji temu pribadi, proyek internal Attila, atau hal yang TIDAK KAMU KETAHUI / TIDAK ADA DATANYA):
   - Gunakan format khusus "[FORWARD_TO_DM]" di awal responsmu agar sistem mengetahui bahwa pesan ini wajib dikey-in ke DM Attila.
   - Beritahukan dengan ramah & santai bahwa pertanyaan spesifik ini sudah kamu copy-paste & terfoward langsung ke DM pribadi Attila, dan minta ${authorName} untuk MOHON MENUNGGU sebentar.`;
      }

      const response = await askAzura(message.author.id, promptContext, authorName, [], false, message.channel.id);

      // Check if response indicates forwarding to DM is required
      if (response.includes('[FORWARD_TO_DM]') || rawPrompt.length > 0) {
        await forwardToOwnerDM(message, authorName, rawPrompt);
      }

      // Clean out tag marker if present in final text
      const cleanResponse = response.replace(/\[FORWARD_TO_DM\]/g, '').trim();
      await message.reply(cleanResponse);
    } catch (err) {
      console.error('[AutoReply Error]:', err.message || err);
    }
  }, 120000); // 2 minutes (120,000 ms)

  pendingMentions.set(message.id, {
    timer,
    channelId: message.channel.id,
    authorId: message.author.id,
    authorName,
    text: rawPrompt
  });
}

module.exports = {
  handleOwnerMentionTracking
};
