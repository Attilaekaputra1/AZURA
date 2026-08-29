/**
 * AZURA VOICE NOTE (VN) SUBSYSTEM
 * 
 * Features:
 * 1. Kak Ceria Voice Generation (ElevenLabs v3 Custom Voice).
 * 2. Strict Exact-Text Reading (No extra hallucinated words or conversational filler).
 * 3. Dual Mode: Slash Command (/vn) & Natural Chat Triggers ("Azura tolong vn '...'").
 * 4. Quotes Priority ("...") vs Trailing Text Extraction.
 * 5. Tiered Quota Guard (Owner: 700 chars | Members: 300 chars) with Smart Sentence Truncation & Gen Z Protests.
 */

const { AttachmentBuilder } = require('discord.js');
const { generateVoiceNote } = require('./tts');

const OWNER_MAX_CHARS = 700;
const MEMBER_MAX_CHARS = 300;

const GEN_Z_PROTESTS = [
  (len, max) => `Aduh panjang bangeett teksnya kak! 😭 Napas gw putus ntar kalau bacain ${len} karakter wkwk. Kuota maksimal ${max} karakter yaa, coba ringkas dikit lagi biar suaranya cakep! ✨`,
  (len, max) => `Waduhh mau bikin podcast apa gimana nih panjang bener (${len} karakter)? 😂 Maksimal ${max} karakter aja yaa kak, dipotong dikit dulu yuk biar pas di VN! 🌸`,
  (len, max) => `Kebanyakan teksnya nih bestie! 😭 Tenggorokan aku bisa serak kalau bacain ${len} karakter sekaligus wkwk. Coba pangkas jadi di bawah ${max} karakter yaa! 💅✨`,
  (len, max) => `Eits, kepanjangan kak! (${len}/${max} karakter). Tolong ringkas kalimatnya yaa biar VN-nya padat, jelas, dan enak didenger! 🎙️🎧`
];

/**
 * Parse natural message to detect Voice Note (VN) requests and extract exact target text
 * @param {string} prompt 
 * @param {boolean} isOwner 
 * @returns {object|null}
 */
function parseVoiceNoteRequest(prompt, isOwner = false) {
  if (!prompt || typeof prompt !== 'string') return null;
  const raw = prompt.trim();

  // Check if prompt contains VN intent trigger keywords
  const vnTriggerRegex = /\b(?:azura|ara|zura|ajur|ajura)?\s*(?:tolong\s+|coba\s+|minta\s+|tolongin\s+)?(?:kirim\s+|buatkan\s+|bikin(?:kan)?\s+|ngomong\s+|baca(?:kan)?\s+)?(?:vn|voice\s*note|pesan\s*suara|voicenote)\b/i;
  
  if (!vnTriggerRegex.test(raw)) {
    return null;
  }

  let extractedText = '';

  // 1. Priority 1: Check for Quoted Text ("...", '...', “...”, ‘...’)
  const quoteMatch = raw.match(/["'“”‘]([^"'“”‘]+)["'“”‘]/);
  if (quoteMatch && quoteMatch[1] && quoteMatch[1].trim().length > 0) {
    extractedText = quoteMatch[1].trim();
  } else {
    // 2. Priority 2: Extract text after "vn" / "voice note" / "pesan suara"
    const afterKeywordMatch = raw.match(/\b(?:vn|voice\s*note|pesan\s*suara|voicenote)\s+(?:in\s+)?(?:dong|ya|plis|please|ke\s+sini)?\s*:?\s*(.+)/i);
    if (afterKeywordMatch && afterKeywordMatch[1]) {
      extractedText = afterKeywordMatch[1].trim();

      // Strip outer conversational wrap if present
      extractedText = extractedText
        .replace(/^(?:kata-kata|kata|kalimat|teks|ucapan)\s*:?\s*/i, '')
        .replace(/\b(?:dong|ya|plis|please|azura|ara|zura)\b\s*$/i, '')
        .trim();
    }
  }

  if (!extractedText || extractedText.length === 0) {
    return {
      status: 'EMPTY',
      protestMessage: 'Mau aku bacain apa nih di VN? Tulis teksnya yaa, contoh: `Azura tolong vn "Aku cinta kamu"` atau `/vn teks:Halo gais` ✨'
    };
  }

  const maxChars = isOwner ? OWNER_MAX_CHARS : MEMBER_MAX_CHARS;
  const charLength = extractedText.length;

  // Case A: Within Quota
  if (charLength <= maxChars) {
    return {
      status: 'OK',
      textToSpeak: extractedText,
      originalText: extractedText,
      isOwner,
      charLength,
      maxChars
    };
  }

  // Case B: Over Quota -> Attempt Smart Sentence Truncation at Period / Punctuation
  const slice = extractedText.slice(0, maxChars);
  const lastPunctuation = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('!\n'),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('?\n'),
    slice.lastIndexOf('.') === slice.length - 1 ? slice.length - 1 : -1,
    slice.lastIndexOf('!') === slice.length - 1 ? slice.length - 1 : -1,
    slice.lastIndexOf('?') === slice.length - 1 ? slice.length - 1 : -1
  );

  // If a clean sentence ends within 60%-100% of max quota, cleanly truncate
  if (lastPunctuation >= Math.floor(maxChars * 0.6)) {
    const cleanTruncated = slice.slice(0, lastPunctuation + 1).trim();
    return {
      status: 'TRUNCATED',
      textToSpeak: cleanTruncated,
      originalText: extractedText,
      isOwner,
      charLength,
      maxChars,
      notice: `✂️ *Teks agak kepanjangan (${charLength}/${maxChars} karakter), jadi aku bacain sampai kalimat lengkap batas kuota yaa!*`
    };
  }

  // Case C: Too Far Over Quota -> Gen Z Complaint
  const randomProtest = GEN_Z_PROTESTS[Math.floor(Math.random() * GEN_Z_PROTESTS.length)](charLength, maxChars);
  return {
    status: 'TOO_LONG',
    protestMessage: randomProtest,
    charLength,
    maxChars
  };
}

/**
 * Execute Voice Note generation and package Discord attachment
 * @param {string} textToSpeak 
 * @param {string} userId 
 * @param {string} userName 
 * @param {boolean} isOwner 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<object>}
 */
async function executeVoiceNote(textToSpeak, userId, userName = 'Pengguna', isOwner = false, client = null) {
  try {
    const attachment = await generateVoiceNote(textToSpeak, client);
    const caption = `🎙️ **[Voice Note AZURA • Suara Kak Ceria]**\n*\"${textToSpeak}\"*`;

    return {
      success: true,
      attachment,
      caption,
      textToSpeak
    };
  } catch (err) {
    console.error('[Voice Note Engine Error]:', err.message);
    return {
      success: false,
      error: err.message || 'Gagal merender audio Voice Note'
    };
  }
}

module.exports = {
  parseVoiceNoteRequest,
  executeVoiceNote,
  OWNER_MAX_CHARS,
  MEMBER_MAX_CHARS,
  GEN_Z_PROTESTS
};
