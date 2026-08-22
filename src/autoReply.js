const config = require('./config');
const { askAzura } = require('./azura');
const { parseMessageStickers } = require('./stickers');

// Store active pending mentions: key = messageId -> { timer, channelId, authorId, authorName, text, timestamp, message }
const pendingMentions = new Map();

// End-of-chat patterns — messages that indicate the conversation is ending and should NOT trigger auto-reply
const END_OF_CHAT_PATTERNS = [
  /^(ok(e|ay|k|ee|eee)?|oke(e)?|okey|okk+|iya|iaa|yaa?|yoi|yow|yup|yep|yap|siap|sip(p)?|sippp?|bet|mantap|mantab|mantep|gas|letsgo|let'?s go)[\s.!]*$/i,
  /^(makasih|thanks|thx|tengkyu|thankyou|thank you|tq|ty|trims|terima\s?kasih|mksh|nuhun|matur\s?nuwun)[\s.!]*$/i,
  /^(woke|wokee|wkwk+|haha+|hehe+|hihi+|kwkw+|xixi+|lol+|lmao|wkk+)[\s.!]*$/i,
  /^(bye|bai|babay|dadah|dadaa|bye-?bye|see ya|sampai jumpa)[\s.!]*$/i,
  /^(aamiin|amin|aminn+)[\s.!]*$/i,
  /^(noted|ntt|ntd)[\s.!]*$/i,
  /^(good|nice|keren|cakep|bagus|gg|gj|good job|mantul|jos|josss?)[\s.!]*$/i,
  /^(gpp|gapapa|ga\s?pa\s?pa|nggak\s?apa|nda\s?apa|santai|santuy|slow|take care)[\s.!]*$/i,
  /^(ntar|nanti|besok|later|soon)[\s.!]*$/i,
  /^[\s]*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u200d|\uFE0F|[\s]){1,10}[\s]*$/u,
  /^[\s]*(<a?:\w+:\d+>[\s]*){1,5}[\s]*$/,
  /^[👍👌🤝👏✅🔥💯🙏❤️💪😊😁😂🤣😅😎🫡🫰💀☠️]+$/u,
  /^[a-zA-Z0-9]{1,2}[.!]*$/,
  /^[\s]*$/
];

/**
 * Check if a message text or sticker is an "end of chat" / closing / acknowledgement
 * @param {string} text 
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function isEndOfChat(text, message) {
  if (message.stickers?.size > 0) {
    const stickerParsed = parseMessageStickers(message);
    if (stickerParsed.isClosingReaction) return true;
  }

  if ((!text || text.trim() === '') && message.attachments?.size > 0 && (!message.stickers || message.stickers.size === 0)) return true;

  const cleaned = text.trim();
  if (!cleaned && (!message.stickers || message.stickers.size === 0)) return true;

  return END_OF_CHAT_PATTERNS.some(pattern => pattern.test(cleaned));
}

/**
 * Forward sender's message directly to Attila's DM (sender message ONLY, no bot reply clutter)
 * @param {import('discord.js').Message} message 
 * @param {string} authorName 
 * @param {string} rawPrompt 
 */
async function notifyOwnerPendingMessage(message, authorName, rawPrompt) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return;

  try {
    const ownerUser = await message.client.users.fetch(ownerId).catch(() => null);
    if (ownerUser) {
      const channelName = message.channel.name ? `#${message.channel.name}` : 'Channel Server';
      const guildName = message.guild?.name || 'Server';
      const msgUrl = message.url || '';

      const dmContent =
        `📩 **[PESAN BELUM DIBALAS - 5 MENIT]**\n\n` +
        `Ada pesan yang ditujukan untuk kamu dan belum sempat kamu balas nih, Attila:\n` +
        `• **Pengirim**: **${authorName}** (<@${message.author.id}>)\n` +
        `• **Lokasi**: ${guildName} (${channelName})\n` +
        `• **Isi Pesan**: "${rawPrompt || '(Tag tanpa teks)'}"\n` +
        (msgUrl ? `🔗 **Link Pesan**: ${msgUrl}` : '');

      await ownerUser.send(dmContent);
      console.log(`[AutoReply]: Forwarded sender message from ${authorName} to Attila's DM.`);
    }
  } catch (err) {
    console.error('[AutoReply DM Notification Error]:', err.message || err);
  }
}

/**
 * Handle incoming message for owner (Attila) mention & reply tracking
 * @param {import('discord.js').Message} message 
 */
function handleOwnerMentionTracking(message) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return;

  // 1. If Attila (Owner) sends a message, ONLY cancel the timer for the SPECIFIC message he replied to or mentioned
  if (message.author.id === ownerId) {
    if (message.reference && message.reference.messageId) {
      const repliedMsgId = message.reference.messageId;
      if (pendingMentions.has(repliedMsgId)) {
        const item = pendingMentions.get(repliedMsgId);
        clearTimeout(item.timer);
        pendingMentions.delete(repliedMsgId);
        console.log(`[AutoReply]: Attila replied specifically to msg ${repliedMsgId}. Cancelled countdown.`);
      }
    }

    // If Attila mentions or replies to a specific user, cancel that user's pending mention in this channel
    if (message.mentions.users.size > 0) {
      for (const mentionedUserId of message.mentions.users.keys()) {
        for (const [msgId, item] of pendingMentions.entries()) {
          if (item.channelId === message.channel.id && item.authorId === mentionedUserId) {
            clearTimeout(item.timer);
            pendingMentions.delete(msgId);
            console.log(`[AutoReply]: Attila replied to ${item.authorName} in #${message.channel.name}. Cancelled countdown for msg ${msgId}.`);
          }
        }
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

  // 4. END-OF-CHAT FILTER
  if (isEndOfChat(rawPrompt, message)) {
    console.log(`[AutoReply]: Skipped end-of-chat message from ${authorName}: "${rawPrompt.slice(0, 50)}"`);
    return;
  }

  console.log(`[AutoReply]: Attila ${isReplyToOwner ? 'replied-to' : 'mentioned'} by ${message.author.tag} in #${message.channel.name}. Starting 5-min countdown...`);

  // 5. Start 5-minute (300,000 ms) countdown per message
  const timer = setTimeout(async () => {
    pendingMentions.delete(message.id);
    console.log(`[AutoReply]: 5 minutes elapsed without Attila's reply for msg ${message.id} from ${authorName}. AZURA auto-handling...`);

    try {
      await message.channel.sendTyping();

      // Forward ONLY the sender's message to Attila's DM
      await notifyOwnerPendingMessage(message, authorName, rawPrompt);

      let promptContext;
      if (!rawPrompt) {
        // Tagged Attila with no text
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila di server 5 menit lalu tanpa teks. Katakan sangat singkat (1 kalimat): "Attila lagi sibuk kyknya, ada pesan yang mau aku bantu sampaikan ke Attila? Ditunggu yaa ✨"`;
      } else {
        promptContext =
          `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) 5 menit lalu dengan pesan: "${rawPrompt}". Attila belum sempat membalas dalam 5 menit ini.\n\n` +
          `EVALUASI PERTANYAAN:\n` +
          `1. JIKA PERTANYAAN GENERAL / UMUM (bisa dijawab dengan pengetahuan umum, fakta, atau data): Jawablah pertanyaan itu secara singkat, to the point, dan solutif (1-2 kalimat) sambil sebut Attila lagi away.\n` +
          `2. JIKA PERTANYAAN SPESIFIK / PRIBADI UNTUK ATTILA (janji temu pribadi, proyek Attila, dll): Jawablah sangat singkat dan santai seperti: "Attila lagi sibuk kyknya, pesan kamu udah aku bantu forward ke Attila yaa, ditunggu bentar yaa ✨". JANGAN jawab panjang-panjang.`;
      }

      const response = await askAzura(message.author.id, promptContext, authorName, [], false, message.channel.id);
      if (response) {
        await message.reply(response.trim());
      }
    } catch (err) {
      console.error('[AutoReply Error]:', err.message || err);
    }
  }, 300000); // 5 minutes

  pendingMentions.set(message.id, {
    timer,
    channelId: message.channel.id,
    authorId: message.author.id,
    authorName,
    text: rawPrompt,
    timestamp: Date.now()
  });
}

module.exports = {
  handleOwnerMentionTracking
};
