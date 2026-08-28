const https = require('https');
const config = require('./config');
const { canUseElevenLabs, recordVoiceUsage } = require('./voiceQuota');

const DEFAULT_VOICE_ID = 'd15jrIAARvF899pDoC6T'; // Kak Ceria (Indonesian cheerful female)

let circuitBreakerUntil = 0;
let circuitBreakerReason = '';

function isElevenLabsCircuitOpen() {
  return Date.now() < circuitBreakerUntil;
}

function openCircuitBreaker(reason, durationMs = 30 * 60 * 1000) {
  circuitBreakerUntil = Date.now() + durationMs;
  circuitBreakerReason = reason;
  console.warn(`[ElevenLabs Circuit Breaker]: ⚡ Circuit OPEN for ${Math.round(durationMs / 60000)} mins. Instant-fallback active. Reason: ${reason}`);
}

const ELEVENLABS_MODELS = {
  V3: 'eleven_v3',
  FLASH: 'eleven_flash_v2_5',
  MULTILINGUAL_V2: 'eleven_multilingual_v2'
};

/**
 * Get optimized voice settings per ElevenLabs model
 * @param {string} modelId 
 * @returns {object}
 */
function getModelVoiceSettings(modelId) {
  switch (modelId) {
    case ELEVENLABS_MODELS.FLASH:
      return {
        stability: 0.50,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      };
    case ELEVENLABS_MODELS.MULTILINGUAL_V2:
      return {
        stability: 0.65,
        similarity_boost: 0.80,
        style: 0.15,
        use_speaker_boost: true
      };
    case ELEVENLABS_MODELS.V3:
    default:
      return {
        stability: 0.38,
        similarity_boost: 0.80,
        style: 0.35,
        use_speaker_boost: true
      };
  }
}

/**
 * Generate MP3 audio buffer from text using ElevenLabs API with Dynamic Model Routing, Quota Guard & Circuit Breaker
 * @param {string} text 
 * @param {string|null} voiceId 
 * @param {string|null} modelId ('eleven_v3' | 'eleven_flash_v2_5' | 'eleven_multilingual_v2')
 * @param {import('discord.js').Client|null} client
 * @returns {Promise<Buffer>}
 */
function generateElevenLabsTTS(text, voiceId = null, modelId = null, client = null) {
  return new Promise((resolve, reject) => {
    const apiKey = config.ELEVENLABS_API_KEY || 'sk_992d84bd215d95a91a68b84ba8506d4e2ed0de8034f19e8c';
    if (!apiKey) {
      return reject(new Error('ELEVENLABS_API_KEY not configured'));
    }

    // Circuit Breaker: instant fallback if recent payment issue or quota exhaustion occurred
    if (isElevenLabsCircuitOpen()) {
      return reject(new Error(`ElevenLabs Circuit Open: ${circuitBreakerReason}`));
    }
    const selectedVoice = voiceId || config.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    let selectedModel = modelId || config.ELEVENLABS_MODEL_ID || ELEVENLABS_MODELS.FLASH;
    if (!selectedModel || selectedModel === 'auto' || !Object.values(ELEVENLABS_MODELS).includes(selectedModel)) {
      selectedModel = ELEVENLABS_MODELS.FLASH;
    }
    const voiceSettings = getModelVoiceSettings(selectedModel);

    const postData = JSON.stringify({
      text: text,
      model_id: selectedModel,
      voice_settings: voiceSettings
    });

    // Dynamic timeout: 15s for short talk, up to 60s for long storytelling (~5 min)
    const requestTimeout = Math.max(15000, Math.min(60000, text.length * 15));

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
      timeout: requestTimeout
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => errBody += chunk);
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 402 || res.statusCode === 429) {
            openCircuitBreaker(`ElevenLabs error ${res.statusCode}: ${errBody.slice(0, 100)}`, 30 * 60 * 1000);
          }
          reject(new Error(`ElevenLabs API returned ${res.statusCode} (model: ${selectedModel}): ${errBody}`));
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
      reject(new Error(`ElevenLabs API request timed out after ${Math.round(requestTimeout / 1000)}s`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Stream MP3 audio in real-time from ElevenLabs using Low-Latency Streaming endpoint (optimize_streaming_latency=4)
 * Returns a readable stream ready for immediate playback in Discord AudioPlayer.
 * @param {string} text 
 * @param {string|null} voiceId 
 * @param {string|null} modelId 
 * @param {import('discord.js').Client|null} client 
 * @returns {Promise<import('stream').Readable>}
 */
function streamElevenLabsTTS(text, voiceId = null, modelId = null, client = null) {
  return new Promise((resolve, reject) => {
    const apiKey = config.ELEVENLABS_API_KEY || 'sk_992d84bd215d95a91a68b84ba8506d4e2ed0de8034f19e8c';
    if (!apiKey) {
      return reject(new Error('ELEVENLABS_API_KEY not configured'));
    }

    if (isElevenLabsCircuitOpen()) {
      return reject(new Error(`ElevenLabs Circuit Open: ${circuitBreakerReason}`));
    }

    const selectedVoice = voiceId || config.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    let selectedModel = modelId || config.ELEVENLABS_MODEL_ID || ELEVENLABS_MODELS.FLASH;
    if (!selectedModel || selectedModel === 'auto' || !Object.values(ELEVENLABS_MODELS).includes(selectedModel)) {
      selectedModel = ELEVENLABS_MODELS.FLASH;
    }
    const voiceSettings = getModelVoiceSettings(selectedModel);

    const postData = JSON.stringify({
      text: text,
      model_id: selectedModel,
      voice_settings: voiceSettings
    });

    const requestTimeout = Math.max(15000, Math.min(60000, text.length * 15));

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${selectedVoice}/stream?optimize_streaming_latency=4&output_format=mp3_44100_128`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: requestTimeout
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => errBody += chunk);
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 402 || res.statusCode === 429) {
            openCircuitBreaker(`ElevenLabs error ${res.statusCode}: ${errBody.slice(0, 100)}`, 30 * 60 * 1000);
          }
          reject(new Error(`ElevenLabs Stream returned ${res.statusCode} (${selectedModel}): ${errBody}`));
        });
        return;
      }

      // Record usage
      recordVoiceUsage(text.length, client).catch(() => {});
      resolve(res);
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ElevenLabs Stream timed out after ${Math.round(requestTimeout / 1000)}s`));
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  generateElevenLabsTTS,
  streamElevenLabsTTS,
  getModelVoiceSettings,
  ELEVENLABS_MODELS,
  DEFAULT_VOICE_ID
};
