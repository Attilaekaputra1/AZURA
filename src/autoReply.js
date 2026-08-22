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

      const truncatedPrompt = rawPrompt && rawPrompt.length > 1500 ? rawPrompt.substring(0, 1500) + '...' : (rawPrompt || '(Tag tanpa teks)');

      const dmContent = `📩 **[AUTO-FORWARD ASSISTANT] Pesan Spesifik untuk Attila!**\n\n` +
                        `• **Pengirim**: **${authorName}** (<@${message.author.id}>)\n` +
                        `• **Lokasi**: ${guildName} (${channelName})\n` +
                        `• **Pesan / Pertanyaan**: "${truncatedPrompt}"\n` +
                        (msgUrl ? `🔗 **Link Pesan**: ${msgUrl}` : '');

      await ownerUser.send(dmContent);
      console.log(`[AutoReply]: Forwarded mention from ${authorName} directly to Attila's DM.`);
    }
  } catch (err) {
    console.error('[AutoReply DM Forward Error]:', err.message || err);
  }
}

/**
 * Check if a text is an obvious conversation closer / polite acknowledgment
 * @param {string} text 
 * @returns {boolean}
 */
function isQuickConversationCloser(text) {
  if (!text) return false;
  // If it contains a question mark or is longer than 50 chars, let AI evaluate
  if (text.includes('?') || text.length > 50) return false;

  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const closerRegex = /^(?:makasih|makasi|makasihh|tengkyu|thank you|thanks|thank u|thx|ty|tq|matur nuwun|nuhun|terima kasih|sip|siap|oke|okee|ok|noted|mantap|mantabb|gg|nice|cool|wkwk|wkwkwk|wkwkwkk|haha|hahaha|hehe|hehehe|lol|lmao|awokawok|otw|gas|gaskeun|gass|duluan|duluan ya|bye|byee|dadah|good night|gn|gapapa|gpp|aman|santai|santuy|yoi|yoii|yoi bang|siap bang|oke bang|sip bang|noted bang|makasih bang|makasih mas|siap mas|oke mas|noted mas|aman bang|gpp bang|santai bang)$/i;

  return closerRegex.test(clean);
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
        console.log(`[AutoReply]: Attila replied in channel #${message.channel.name || message.channel.id}. Cancelled countdown for msg ${msgId}.`);
      }
    }
    return;
  }

  // 2. Ignore bot messages, non-server messages, or @everyone/@here mass mentions
  if (message.author.bot || !message.guild || message.mentions.everyone) return;

  // 3. Check if message mentions Attila (Owner)
  const isOwnerMentioned = message.mentions.users.has(ownerId);
  if (!isOwnerMentioned) return;

  const delayMs = config.STANDBY_DELAY_MS || 300000; // Default 5 menit (300,000 ms)
  const delayMinutes = Math.round(delayMs / 60000);

  const rawPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
  const authorName = message.member?.displayName || message.author.displayName || message.author.username;

  // Check if message is an obvious conversation closer / greeting acknowledgment that needs no reply
  if (rawPrompt && isQuickConversationCloser(rawPrompt)) {
    console.log(`[AutoReply]: Message from ${authorName} ("${rawPrompt}") identified as quick conversation closer. Standby timer skipped.`);
    return;
  }

  console.log(`[AutoReply]: Attila mentioned by ${message.author.tag} in #${message.channel.name}. Starting ${delayMinutes}-min countdown...`);

  // 4. Start countdown timer (Default 5 minutes)
  const timer = setTimeout(async () => {
    pendingMentions.delete(message.id);
    console.log(`[AutoReply]: ${delayMinutes} minutes elapsed without Attila's reply for msg ${message.id}. AZURA evaluating...`);

    try {
      await message.channel.sendTyping();

      let promptContext;
      if (!rawPrompt) {
        // Case A: Tagged Attila without any text/message
        await forwardToOwnerDM(message, authorName, rawPrompt);
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) di server ${delayMinutes} menit lalu TANPA pesan/pertanyaan tambahan. Karena Attila belum sempat merespon dalam ${delayMinutes} menit, katakan secara santai, rapi, dan Gen Z sewajarnya dengan maksud: "Attila lagi sibuk nih, sementara sama aku dulu yaa. Ada yang bisa aku bantu? Atau ada pesan yang mau diteruskan ke Attila? Let me know yaa".`;
      } else {
        // Case B: Tagged Attila with specific prompt/question
        promptContext = `Lawan bicaramu (${authorName}) telah nge-tag Attila (Owner kamu) ${delayMinutes} menit lalu di server dengan pesan/pertanyaan: "${rawPrompt}". Attila belum merespon dalam ${delayMinutes} menit ini.

EVALUASI INTENT CERDAS (SANGAT KRITIS):
1. JIKA PESAN INI HANYA PENUTUP PERCAKAPAN, ungkapan terima kasih ("makasih bang", "sip", "ok noted"), tawa ("wkwk", "haha"), salam pamit ("duluan ya", "bye"), atau pernyataan pasif yang TIDAK memerlukan balasan:
   -> JAWAB DENGAN SATU FRASA KHUSUS: "[NO_REPLY_NEEDED]". Jangan tambahkan kata lain! Sistem akan otomatis diam dan tidak membalas.

2. JIKA PESAN INI ADALAH INFORMASI UMUM / TEKNIS / DATA / PERTANYAAN TERBUKA yang kamu tahu jawabannya atau bisa dicari di web:
   -> Jawablah pertanyaan tersebut secara cerdas, akurat, dan solutif di server. Sampaikan santai bahwa Attila lagi away/belum sempat baca, tapi kebetulan kamu ada datanya untuk membantu duluan.

3. JIKA PESAN INI ADALAH PERTANYAAN PRIBADI / KHUSUS UNTUK ATTILA (janji temu, kesepakatan harga, proyek internal Attila, atau hal yang tidak kamu ketahui):
   -> Gunakan format khusus "[FORWARD_TO_DM]" di awal responsmu. Sampaikan dengan ramah bahwa pesan sudah dicatat & diteruskan langsung ke DM pribadi Attila, dan minta ${authorName} untuk menunggu sebentar.`;
      }

      const guildId = message.guild?.id || null;
      const response = await askAzura(message.author.id, promptContext, authorName, [], false, message.channel.id, guildId, false);

      // Gate: Check if evaluated as no reply needed
      if (typeof response === 'string' && response.includes('[NO_REPLY_NEEDED]')) {
        console.log(`[AutoReply]: AZURA evaluated msg ${message.id} as [NO_REPLY_NEEDED]. Silently skipped.`);
        return;
      }

      // Check if response indicates forwarding to DM is required
      if (typeof response === 'string' && (response.includes('[FORWARD_TO_DM]') || rawPrompt.length > 0)) {
        await forwardToOwnerDM(message, authorName, rawPrompt);
      }

      // Handle object responses (e.g., image embeds)
      if (typeof response === 'object') {
        await message.reply(response);
      } else {
        // Clean out tag marker if present in final text
        let cleanResponse = response.replace(/\[FORWARD_TO_DM\]/g, '').replace(/\[NO_REPLY_NEEDED\]/g, '').trim();

        if (!cleanResponse) return;

        // Enforce Discord's 2000 character limit
        if (cleanResponse.length > 1900) {
          cleanResponse = cleanResponse.substring(0, 1900) + '...';
        }

        await message.reply(cleanResponse).catch(async () => {
          await message.channel.send(`<@${message.author.id}> ${cleanResponse}`).catch(() => {});
        });
      }
    } catch (err) {
      console.error('[AutoReply Error]:', err.message || err);
    }
  }, delayMs);

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
