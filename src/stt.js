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

    return transcription.text?.trim() || null;
  } catch (err) {
    console.error('[Whisper STT Error]:', err.message || err);
    return null;
  }
}

module.exports = {
  transcribeAudioAttachment
};
