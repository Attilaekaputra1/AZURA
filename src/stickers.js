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

module.exports = {
  parseMessageStickers
};
