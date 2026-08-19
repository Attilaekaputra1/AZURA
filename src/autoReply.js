const config = require('./config');
const { askAzura } = require('./azura');

// Store active pending mentions: key = messageId -> { timer, channelId, authorId, authorName, text }
const pendingMentions = new Map();

// End-of-chat patterns — messages that indicate the conversation is ending and should NOT trigger auto-reply
const END_OF_CHAT_PATTERNS = [
  // Indonesian acknowledgements & closings
  /^(ok(e|ay|k|ee|eee)?|oke(e)?|okey|okk+|iya|iaa|yaa?|yoi|yow|yup|yep|yap|siap|sip(p)?|sippp?|bet|mantap|mantab|mantep|gas|letsgo|let'?s go)[\s.!]*$/i,
  /^(makasih|thanks|thx|tengkyu|thankyou|thank you|tq|ty|trims|terima\s?kasih|mksh|nuhun|matur\s?nuwun)[\s.!]*$/i,
  /^(woke|wokee|wkwk+|haha+|hehe+|hihi+|kwkw+|xixi+|lol+|lmao|wkk+)[\s.!]*$/i,
  /^(bye|bai|babay|dadah|dadaa|bye-?bye|see ya|sampai jumpa)[\s.!]*$/i,
  /^(aamiin|amin|aminn+)[\s.!]*$/i,
  /^(noted|ntt|ntd)[\s.!]*$/i,
  /^(good|nice|keren|cakep|bagus|gg|gj|good job|mantul|jos|josss?)[\s.!]*$/i,
  /^(gpp|gapapa|ga\s?pa\s?pa|nggak\s?apa|nda\s?apa|santai|santuy|slow|take care)[\s.!]*$/i,
  /^(ntar|nanti|besok|later|soon)[\s.!]*$/i,

  // Pure emoji messages (1-5 emojis with optional spaces)
  /^[\s]*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u200d|\uFE0F|[\s]){1,10}[\s]*$/u,

  // Pure Discord emoji (<:name:id> or <a:name:id>)
  /^[\s]*(<a?:\w+:\d+>[\s]*){1,5}[\s]*$/,

  // Thumbs up, clap, handshake, etc (unicode)
  /^[👍👌🤝👏✅🔥💯🙏❤️💪😊😁😂🤣😅😎🫡🫰💀☠️]+$/u,

  // Very short responses (1-2 chars that aren't questions)
  /^[a-zA-Z0-9]{1,2}[.!]*$/,

  // Sticker-only messages (no text content)
  /^[\s]*$/
];

const { parseMessageStickers } = require('./stickers');

/**
 * Check if a message text or sticker is an "end of chat" / closing / acknowledgement
 * that does NOT need an auto-reply from AZURA
 * @param {string} text 
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function isEndOfChat(text, message) {
  // If message has stickers, check sticker sentiment & closing reaction flag
  if (message.stickers?.size > 0) {
    const stickerParsed = parseMessageStickers(message);
    if (stickerParsed.isClosingReaction) return true; // Skip closing/reaction stickers
  }

  // Attachment-only messages with no text (e.g., just sending an image/GIF reaction)
  if ((!text || text.trim() === '') && message.attachments?.size > 0 && (!message.stickers || message.stickers.size === 0)) return true;

  const cleaned = text.trim();
  if (!cleaned && (!message.stickers || message.stickers.size === 0)) return true; // Empty message

  // Check against all end-of-chat patterns
  return END_OF_CHAT_PATTERNS.some(pattern => pattern.test(cleaned));
}

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
 * Report to Attila's DM that AZURA has auto-replied on his behalf
 * @param {import('discord.js').Message} message 
 * @param {string} authorName 
 * @param {string} rawPrompt 
 * @param {string} azuraResponse 
 */
async function reportAutoReplyToOwner(message, authorName, rawPrompt, azuraResponse) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return;

  try {
    const ownerUser = await message.client.users.fetch(ownerId).catch(() => null);
    if (ownerUser) {
      const channelName = message.channel.name ? `#${message.channel.name}` : 'Channel Server';
      const guildName = message.guild?.name || 'Server';
      const msgUrl = message.url || '';

      const reportContent = `🤖 **[AUTO-REPLY REPORT]** AZURA telah membalas atas nama Attila\n\n` +
                            `• **Pengirim**: **${authorName}** (<@${message.author.id}>)\n` +
                            `• **Lokasi**: ${guildName} (${channelName})\n` +
                            `• **Pesan Asli**: "${rawPrompt || '(Tag tanpa teks)'}"\n` +
                            `• **Balasan AZURA**: "${azuraResponse.slice(0, 300)}${azuraResponse.length > 300 ? '...' : ''}"\n` +
                            (msgUrl ? `🔗 **Link Pesan**: ${msgUrl}` : '');

      await ownerUser.send(reportContent);
    }
  } catch (err) {
    console.error('[AutoReply Report Error]:', err.message || err);
  }
}

/**
 * Handle incoming message for owner (Attila) mention & reply tracking
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
        console.log(`[AutoReply]: Attila replied in channel #${message.channel.name || message.channel.id}. Cancelled 5-min countdown for msg ${msgId}.`);
      }
    }
    return;
  }

  // 2. Ignore bot messages, non-server messages, or @everyone/@here mass mentions
  if (message.author.bot || !message.guild || message.mentions.everyone) return;

  // 3. Check if message mentions Attila (Owner) OR is a reply to Attila's message
  const isOwnerMentioned = message.mentions.users.has(ownerId);
  const isReplyToOwner = message.reference && message.channel.messages?.cache?.get(message.reference.messageId)?.author?.id === ownerId;

  if (!isOwnerMentioned && !isReplyToOwner) return;

  const rawPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
  const authorName = message.member?.displayName || message.author.displayName || message.author.username;

  // 4. END-OF-CHAT FILTER: If the message is clearly an end-of-chat / acknowledgement, skip auto-reply entirely
  if (isEndOfChat(rawPrompt, message)) {
    console.log(`[AutoReply]: Skipped end-of-chat message from ${authorName}: "${rawPrompt.slice(0, 50)}"`);
    return;
  }

  console.log(`[AutoReply]: Attila ${isReplyToOwner ? 'replied-to' : 'mentioned'} by ${message.author.tag} in #${message.channel.name}. Starting 5-min countdown...`);

  // 5. Start 5-minute (300,000 ms) countdown
  const timer = setTimeout(async () => {
    pendingMentions.delete(message.id);
    console.log(`[AutoReply]: 5 minutes elapsed without Attila's reply for msg ${message.id}. AZURA evaluating...`);

    try {
      await message.channel.sendTyping();

      let promptContext;
      if (!rawPrompt) {
        // Case A: Tagged Attila without any text/message
        await forwardToOwnerDM(message, authorName, rawPrompt);
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) di server 5 menit lalu TANPA pesan/pertanyaan tambahan. Karena Attila belum sempat merespon dalam 5 menit, katakan secara santai, rapi, dan Gen Z sewajarnya dengan maksud: "Attila lagi sibuk nih, sementara sama aku dulu yaa. Ada yang bisa aku bantu? Atau ada pesan yang mau diteruskan ke Attila? Let me know yaa".`;
      } else {
        // Case B: Tagged Attila with specific prompt/question
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) 5 menit lalu di server dengan pesan/pertanyaan: "${rawPrompt}". Attila belum merespon dalam 5 menit ini.

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

      // Report to Attila's DM that AZURA has auto-replied
      await reportAutoReplyToOwner(message, authorName, rawPrompt, cleanResponse);
    } catch (err) {
      console.error('[AutoReply Error]:', err.message || err);
    }
  }, 300000); // 5 minutes (300,000 ms)

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
