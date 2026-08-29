/**
 * Discord Sticker & Sentiment Parser Module for AZURA
 */

// Emoji & tag sentiment mappings
const CLOSING_KEYWORDS = [
  'thumbs', 'ok', 'good', 'like', 'heart', 'love', 'smile', 'happy',
  'laugh', 'wkwk', 'haha', 'pray', 'thanks', 'clap', 'wave', 'bye',
  'check', 'yes', 'siap', 'mantap', 'yoi'
];

const SAD_KEYWORDS = [
  'sad', 'cry', 'sob', 'pain', 'hurt', 'disappointed', 'sorry', 'mope', 'pout', 'broken'
];

const ANGRY_KEYWORDS = [
  'angry', 'rage', 'mad', 'fire', 'skull', 'dead', 'devil', 'punch', 'fight'
];

const QUESTION_KEYWORDS = [
  'think', 'confused', 'huh', 'what', 'question', 'wonder', 'curious', 'shrug'
];

/**
 * Extract sticker information and infer sentiment / intent
 * @param {import('discord.js').Message} message 
 * @returns {{ hasSticker: boolean, textPrompt: string, sentiment: string, isClosingReaction: boolean }}
 */
function parseMessageStickers(message) {
  if (!message.stickers || message.stickers.size === 0) {
    return {
      hasSticker: false,
      textPrompt: '',
      sentiment: 'neutral',
      isClosingReaction: false
    };
  }

  const stickersInfo = [];
  let isClosing = false;
  let detectedSentiment = 'neutral (netral)';

  for (const sticker of message.stickers.values()) {
    const name = sticker.name || 'Stiker';
    const tags = sticker.tags || '';
    const desc = sticker.description ? ` (${sticker.description})` : '';

    const combined = `${name} ${tags} ${desc}`.toLowerCase();

    if (CLOSING_KEYWORDS.some(kw => combined.includes(kw))) {
      isClosing = true;
      detectedSentiment = 'positif / penutup obrolan (closing reaction)';
    } else if (SAD_KEYWORDS.some(kw => combined.includes(kw))) {
      detectedSentiment = 'sedih / butuh empati (sad & emotional)';
    } else if (ANGRY_KEYWORDS.some(kw => combined.includes(kw))) {
      detectedSentiment = 'kesal / marah (frustrated & angry)';
    } else if (QUESTION_KEYWORDS.some(kw => combined.includes(kw))) {
      detectedSentiment = 'bingung / bertanya (curious & questioning)';
    }

    stickersInfo.push(`"${name}"${desc}${tags ? ` [Emoji Tag: ${tags}]` : ''}`);
  }

  const textPrompt = `[Pengguna Mengirim Stiker Discord: ${stickersInfo.join(', ')} | Analisis Sentimen Stiker: ${detectedSentiment}]`;

  return {
    hasSticker: true,
    textPrompt,
    sentiment: detectedSentiment,
    isClosingReaction: isClosing
  };
}

/**
 * Handle on-demand sticker sending requested by Owner
 * @param {import('discord.js').Message} message 
 * @param {string} prompt 
 * @returns {Promise<boolean>}
 */
async function handleOwnerStickerRequest(message, prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const isOwner = message.author.id === '704555848773959730' || message.author.id === 'owner';
  if (!isOwner) return false;

  const stickerPattern = /\b(?:tolong\s+)?(?:kirim|kasih|share|bagi|drop|post)\s*(?:kan\s+)?stiker(?:\s+(.+))?/i;
  const match = prompt.match(stickerPattern);
  if (!match) return false;

  const query = (match[1] || '').trim().toLowerCase();
  console.log(`[Sticker Handler]: 🏷️ Owner requested sticker -> Query: "${query}"`);

  // 1. Check if the Guild has custom stickers available
  if (message.guild && message.guild.stickers) {
    try {
      const guildStickers = await message.guild.stickers.fetch().catch(() => message.guild.stickers.cache);
      if (guildStickers && guildStickers.size > 0) {
        let matchingSticker = null;
        if (query) {
          matchingSticker = guildStickers.find(s => s.name.toLowerCase().includes(query) || (s.tags && s.tags.toLowerCase().includes(query)));
        }
        if (!matchingSticker) {
          matchingSticker = guildStickers.first();
        }

        if (matchingSticker) {
          await message.channel.send({ stickers: [matchingSticker.id] }).catch(() => {});
          return true;
        }
      }
    } catch (err) {
      console.warn('[Sticker Fetch Warning]:', err.message);
    }
  }

  // 2. If in DM or no custom guild stickers exist on the server yet:
  const isDM = !message.guild;
  if (isDM) {
    await message.reply('Siap Attila! Karena di DM belum ada slot stiker server, nanti kalau stiker khusus Azura buatanmu udah jadi, bisa kita daftarkan langsung yaa! ✨').catch(() => {});
    return true;
  } else {
    await message.reply('Siap Attila! Di server ini belum ada stiker khusus yang di-upload nih. Begitu stiker khusus Azura buatanmu selesai di-upload ke server, Azura bakal langsung kirim stikernya pas kamu minta! ✨').catch(() => {});
    return true;
  }
}

module.exports = {
  parseMessageStickers,
  handleOwnerStickerRequest
};
