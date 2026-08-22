const https = require('https');
const config = require('./config');

const DEFAULT_VOICE_ID = 'd15jrIAARvF899pDoC6T'; // Kak Ceria (Indonesian cheerful female)

/**
 * Generate MP3 audio buffer from text using ElevenLabs Multilingual v2 API
 * @param {string} text 
 * @param {string} voiceId 
 * @returns {Promise<Buffer>}
 */
function generateElevenLabsTTS(text, voiceId = null) {
  return new Promise((resolve, reject) => {
    const apiKey = config.ELEVENLABS_API_KEY || 'sk_a4c26e321b7abf0f20320d5ddd09e51a06bca2369ca5e328';
    if (!apiKey) {
      return reject(new Error('ELEVENLABS_API_KEY not configured'));
    }

    const selectedVoice = voiceId || config.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    const postData = JSON.stringify({
      text: text,
      model_id: 'eleven_v3',
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.85,
        style: 0.15,
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
