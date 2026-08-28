const { OpenAI, toFile } = require('openai');
const axios = require('axios');
const config = require('./config');

let _openai = null;
function getOpenAI() {
  if (!_openai && config.OPENAI_API_KEY) {
    _openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return _openai;
}

// Subtitle & YouTube phantom hallucination filter
const HALLUCINATION_PATTERNS = [
  /terima\s+kasih\s+(?:telah|sudah|banyak\s+telah|banyak\s+sudah)?\s*(?:menonton|menyaksikan)/i,
  /menonton\s+video\s+ini/i,
  /jangan\s+lupa\s+(?:like|comment|share|subscribe)/i,
  /subtitles?\s+(?:by|oleh)/i,
  /amara\.org/i,
  /transcribed?\s+by/i,
  /translated?\s+by/i,
  /sampai\s+jumpa\s+(?:lagi|di\s+video)/i,
  /video\s+selanjutnya/i
];

function isHallucination(text) {
  if (!text || typeof text !== 'string') return true;
  const clean = text.toLowerCase().replace(/[.,!?;:'"()\[\]]+/g, ' ').trim();
  if (clean.length < 2) return true;
  return HALLUCINATION_PATTERNS.some(pat => pat.test(clean));
}

/**
 * Download an audio attachment URL and transcribe it in-memory using OpenAI Whisper API
 * @param {string} audioUrl 
 * @returns {Promise<string|null>} Transcribed text or null
 */
async function transcribeAudioAttachment(audioUrl) {
  const openai = getOpenAI();
  if (!openai) return null;

  try {
    // Download audio file directly into memory buffer
    const response = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'arraybuffer'
    });

    const audioBuffer = Buffer.from(response.data);
    const file = await toFile(audioBuffer, 'voice_note.ogg', { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'id'
    });

    const resultText = transcription.text?.trim() || null;
    if (!resultText || isHallucination(resultText)) {
      return null;
    }

    return resultText;
  } catch (err) {
    console.error('[Whisper STT Error]:', err.message || err);
    return null;
  }
}

module.exports = {
  transcribeAudioAttachment,
  isHallucination
};
