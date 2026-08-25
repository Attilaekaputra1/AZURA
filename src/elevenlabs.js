const https = require('https');
const config = require('./config');
const { canUseElevenLabs, recordVoiceUsage } = require('./voiceQuota');

const DEFAULT_VOICE_ID = 'd15jrIAARvF899pDoC6T'; // Kak Ceria (Indonesian cheerful female)

/**
 * Generate MP3 audio buffer from text using ElevenLabs v3 API with Quota Guard
 * @param {string} text 
 * @param {string} voiceId 
 * @param {import('discord.js').Client} client
 * @returns {Promise<Buffer>}
 */
function generateElevenLabsTTS(text, voiceId = null, client = null) {
  return new Promise((resolve, reject) => {
    const apiKey = config.ELEVENLABS_API_KEY || 'sk_a4c26e321b7abf0f20320d5ddd09e51a06bca2369ca5e328';
    if (!apiKey) {
      return reject(new Error('ELEVENLABS_API_KEY not configured'));
    }

    // Quota Guard: check if monthly limit (40k chars) is exceeded
    if (!canUseElevenLabs(text.length)) {
      return reject(new Error('Batas kuota bulanan ElevenLabs (40.000 karakter) telah tercapai. Mengaktifkan fallback otomatis ke OpenAI TTS Nova.'));
    }

    const selectedVoice = voiceId || config.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    const postData = JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.85,
        style: 0.25,
        use_speaker_boost: true
      }
    });

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${selectedVoice}`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 12000
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => errBody += chunk);
        res.on('end', () => {
          reject(new Error(`ElevenLabs API returned ${res.statusCode}: ${errBody}`));
        });
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        // Record usage upon successful generation
        recordVoiceUsage(text.length, client).catch(() => {});
        resolve(Buffer.concat(chunks));
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ElevenLabs API request timed out'));
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  generateElevenLabsTTS,
  DEFAULT_VOICE_ID
};
