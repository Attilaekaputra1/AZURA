const { OpenAI } = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');

/**
 * Download an audio attachment URL and transcribe it using OpenAI Whisper API
 * @param {string} audioUrl 
 * @returns {Promise<string|null>} Transcribed text or null
 */
async function transcribeAudioAttachment(audioUrl) {
  if (!config.OPENAI_API_KEY) return null;

  const tempFilePath = path.join(os.tmpdir(), `azura_audio_${Date.now()}.ogg`);

  try {
    // Download audio file stream
    const response = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'arraybuffer'
    });

    fs.writeFileSync(tempFilePath, Buffer.from(response.data));

    const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      language: 'id' // Auto-detect or Indonesian bias
    });

    // Cleanup temp file
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return transcription.text?.trim() || null;
  } catch (err) {
    console.error('[Whisper STT Error]:', err.message || err);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return null;
  }
}

module.exports = {
  transcribeAudioAttachment
};
