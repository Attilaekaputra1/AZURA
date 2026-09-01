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
 * Get optimized voice settings per ElevenLabs model (with dynamic dramatic acting & crying adaptation)
 * @param {string} modelId 
 * @param {string} [text='']
 * @param {object|null} [customSettings=null]
 * @returns {object}
 */
function getModelVoiceSettings(modelId, text = '', customSettings = null) {
  if (customSettings && typeof customSettings === 'object') {
    return {
      stability: customSettings.stability !== undefined ? customSettings.stability : 0.38,
      similarity_boost: customSettings.similarity_boost !== undefined ? customSettings.similarity_boost : 0.80,
      style: customSettings.style !== undefined ? customSettings.style : 0.35,
      use_speaker_boost: true
    };
  }

  const hasDramaticCrying = /\[(?:cries|wailing|sobbing|screams in tears|breaking down|hyperventilating|choked up|voice trembling|whimpering)\]/i.test(text);

  if (hasDramaticCrying) {
    return {
      stability: 0.22,       // Low stability produces authentic voice cracking, trembling, and sobbing bursts
      similarity_boost: 0.75,
      style: 0.55,           // High style parameter unlocks deep emotional range
      use_speaker_boost: true
    };
  }

  switch (modelId) {
    case ELEVENLABS_MODELS.FLASH:
      return {
        stability: 0.54,          // High stability for soothing, non-fatiguing long-form storytelling & dongeng
        similarity_boost: 0.85,   // Warm, crystal clear, immersive storytelling narration timbre
        style: 0.16,              // Gentle storytelling cadence without abrupt pitch peaks
        use_speaker_boost: true
      };
    case ELEVENLABS_MODELS.MULTILINGUAL_V2:
      return {
        stability: 0.60,
        similarity_boost: 0.80,
        style: 0.20,
        use_speaker_boost: true
      };
    case ELEVENLABS_MODELS.V3:
    default:
      return {
        stability: 0.38,          // Maximum emotional dynamics: laughter, giggles, gasps, whispers, crying
        similarity_boost: 0.82,   // Pure Kak Ceria cheerful Gen Z girl persona
        style: 0.35,              // Rich expressive tone
        use_speaker_boost: true
      };
  }
}

/**
 * Normalizes Indonesian phonetic pronunciation for ElevenLabs & TTS engines.
 * Fixes: "Att" -> "At" (ElevenLabs reads English "Att" as /ɛt/ "Et", while "At" is pronounced as Indonesian /at/)
 * @param {string} text 
 * @returns {string}
 */
function normalizePhonetics(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\bAtt\b/g, 'At')
    .replace(/\batt\b/g, 'at')
    .replace(/\bATT\b/g, 'At');
}

/**
 * Generate MP3 audio buffer from text using ElevenLabs API with Dynamic Model Routing, Quota Guard & Circuit Breaker
 * @param {string} text 
 * @param {string|null} voiceId 
 * @param {string|null} modelId ('eleven_v3' | 'eleven_flash_v2_5' | 'eleven_multilingual_v2')
 * @param {import('discord.js').Client|null} client
 * @param {object|null} [customSettings=null]
 * @returns {Promise<Buffer>}
 */
function generateElevenLabsTTS(text, voiceId = null, modelId = null, client = null, customSettings = null) {
  return new Promise((resolve, reject) => {
    const phoneticText = normalizePhonetics(text);
    const apiKey = config.ELEVENLABS_API_KEY || 'sk_992d84bd215d95a91a68b84ba8506d4e2ed0de8034f19e8c';
    if (!apiKey) {
      return reject(new Error('ELEVENLABS_API_KEY not configured'));
    }

    // Circuit Breaker: instant fallback if recent payment issue or quota exhaustion occurred
    if (isElevenLabsCircuitOpen()) {
      return reject(new Error(`ElevenLabs Circuit Open: ${circuitBreakerReason}`));
    }
    const selectedVoice = voiceId || config.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    
    // If text contains dramatic crying tags, automatically route to ElevenLabs V3
    const hasDramaticCrying = /\[(?:cries|wailing|sobbing|screams in tears|breaking down|hyperventilating|choked up|voice trembling|whimpering)\]/i.test(text);
    let selectedModel = hasDramaticCrying ? ELEVENLABS_MODELS.V3 : (modelId || config.ELEVENLABS_MODEL_ID || ELEVENLABS_MODELS.FLASH);
    
    if (!selectedModel || selectedModel === 'auto' || !Object.values(ELEVENLABS_MODELS).includes(selectedModel)) {
      selectedModel = hasDramaticCrying ? ELEVENLABS_MODELS.V3 : ELEVENLABS_MODELS.FLASH;
    }
    const voiceSettings = getModelVoiceSettings(selectedModel, text, customSettings);

    const postData = JSON.stringify({
      text: phoneticText,
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
    const phoneticText = normalizePhonetics(text);
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
      text: phoneticText,
      model_id: selectedModel,
      voice_settings: voiceSettings
    });

    const requestTimeout = Math.max(15000, Math.min(60000, text.length * 15));

    const isFlashOrMulti = (selectedModel === ELEVENLABS_MODELS.FLASH || selectedModel === ELEVENLABS_MODELS.MULTILINGUAL_V2);
    const streamQuery = isFlashOrMulti
      ? '?optimize_streaming_latency=4&output_format=mp3_44100_128'
      : '?output_format=mp3_44100_128';

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${selectedVoice}/stream${streamQuery}`,
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
  normalizePhonetics,
  ELEVENLABS_MODELS,
  DEFAULT_VOICE_ID
};
