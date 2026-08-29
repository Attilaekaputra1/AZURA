const { OpenAI, toFile } = require('openai');
const axios = require('axios');
const config = require('./config');

let _groq = null;
function getGroq() {
  if (!_groq && config.GROQ_API_KEY) {
    _groq = new OpenAI({
      apiKey: config.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: 10000,
      maxRetries: 1
    });
  }
  return _groq;
}

let _openai = null;
function getOpenAI() {
  if (!_openai && config.OPENAI_API_KEY) {
    _openai = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: 20000,
      maxRetries: 2
    });
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
 * Download an audio attachment URL and transcribe it in-memory using Fast Groq Whisper (Primary)
 * with automatic fallback to OpenAI Whisper (Fallback).
 * @param {string} audioUrl 
 * @returns {Promise<string|null>} Transcribed text or null
 */
async function transcribeAudioAttachment(audioUrl) {
  try {
    // Download audio file directly into memory buffer
    const response = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'arraybuffer'
    });

    const audioBuffer = Buffer.from(response.data);

    // ── PASS 1: Turbo Fast-Track via Groq LPU (whisper-large-v3) ──
    const groq = getGroq();
    if (groq) {
      try {
        const file = await toFile(audioBuffer, 'voice_note.ogg', { type: 'audio/ogg' });
        const transcription = await groq.audio.transcriptions.create({
          file,
          model: 'whisper-large-v3',
          language: 'id',
          prompt: 'Azura, Ara, Zura, Attila, Putra'
        });
        const resultText = transcription.text?.trim() || null;
        if (resultText && !isHallucination(resultText)) {
          return resultText;
        }
      } catch (groqErr) {
        console.warn('[Groq Attachment STT Warning]: Groq failed, falling back to OpenAI Whisper...', groqErr.message);
      }
    }

    // ── PASS 2: Rock-Solid Fallback via OpenAI Whisper-1 ──
    const openai = getOpenAI();
    if (!openai) return null;

    const fallbackFile = await toFile(audioBuffer, 'voice_note.ogg', { type: 'audio/ogg' });
    const transcription = await openai.audio.transcriptions.create({
      file: fallbackFile,
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
