const { AttachmentBuilder } = require('discord.js');
const { EdgeTTS } = require('node-edge-tts');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { generateElevenLabsTTS } = require('./elevenlabs');

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});

// Ensure temp directory exists for generated mp3 files
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Detect language of text
 * @param {string} text 
 * @returns {'ja' | 'zh' | 'id'}
 */
function detectLanguage(text) {
  const lower = text.toLowerCase();

  // Japanese check: Hiragana, Katakana, or Romaji keywords
  const hasKana = /[\u3040-\u30ff]/.test(text);
  const jpKeywords = ['arigatou', 'konnichiwa', 'ohayo', 'daisuki', 'otsukaresama', 'gomennasai', 'senpai', 'kawaii', 'sayonara', 'sugoi', 'moshi moshi', 'japan', 'jepang'];
  if (hasKana || jpKeywords.some(kw => lower.includes(kw))) {
    return 'ja';
  }

  // Chinese check: Hanzi characters or Chinese Pinyin keywords
  const hasHanzi = /[\u4e00-\u9faf]/.test(text);
  const cnKeywords = ['ni hao', 'xiexie', 'zaijian', 'mandarin', 'china', 'tionghoa', 'basa china'];
  if (hasHanzi || cnKeywords.some(kw => lower.includes(kw))) {
    return 'zh';
  }

  return 'id';
}

/**
 * Generate Voice Note (MP3) using ElevenLabs v3 with fallbacks & Quota Guard
 * @param {string} text 
 * @param {import('discord.js').Client} client
 * @returns {Promise<AttachmentBuilder>}
 */
async function generateVoiceNote(text, client = null) {
  const cleanText = text
    .slice(0, 400)
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\bAtt\b/g, 'At')
    .replace(/\batt\b/g, 'at')
    .replace(/\bATT\b/g, 'At')
    .trim();

  // 1. Primary: ElevenLabs v3 Flagship (Kak Ceria / Custom Voice)
  if (config.ELEVENLABS_API_KEY) {
    try {
      console.log('[AZURA TTS]: Generating voice via ElevenLabs v3 (Kak Ceria)...');
      const audioBuffer = await generateElevenLabsTTS(cleanText, null, client);
      return new AttachmentBuilder(audioBuffer, { name: 'azura_voice.mp3' });
    } catch (err) {
      console.warn('[AZURA TTS Warning]: ElevenLabs v3 failed or quota reached, falling back to OpenAI TTS (nova):', err.message);
    }
  }

  // Strip audio tags for fallback engines (OpenAI / Edge) so they don't read tags literally
  const cleanFallback = cleanText.replace(/\[(?:laughs|giggles|sighs|whispers|gasp|chuckles)\]/gi, '').trim();

  // 2. Fallback 1: OpenAI TTS-1 with nova voice (natural 20s female)
  if (config.OPENAI_API_KEY) {
    try {
      console.log('[AZURA TTS]: Generating voice via OpenAI TTS (nova)...');
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: cleanFallback
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      return new AttachmentBuilder(buffer, { name: 'azura_voice.mp3' });
    } catch (openAiErr) {
      console.warn('[AZURA TTS Warning]: OpenAI TTS failed, falling back to Edge TTS:', openAiErr.message);
    }
  }

  // 3. Fallback 2: Microsoft Edge Neural TTS (Free)
  const langMode = detectLanguage(cleanText);
  let selectedVoice = 'id-ID-GadisNeural';
  let selectedLang = 'id-ID';

  if (langMode === 'ja') {
    selectedVoice = 'ja-JP-NanamiNeural';
    selectedLang = 'ja-JP';
  } else if (langMode === 'zh') {
    selectedVoice = 'zh-CN-XiaoxiaoNeural';
    selectedLang = 'zh-CN';
  }

  const tempPath = path.join(TEMP_DIR, `azura_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  try {
    const edgeTts = new EdgeTTS({
      voice: selectedVoice,
      lang: selectedLang,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    await edgeTts.ttsPromise(cleanText, tempPath);
    const buffer = fs.readFileSync(tempPath);
    fs.unlink(tempPath, () => {});
    return new AttachmentBuilder(buffer, { name: 'azura_voice.mp3' });
  } catch (edgeError) {
    if (fs.existsSync(tempPath)) fs.unlink(tempPath, () => {});
    throw edgeError;
  }
}

module.exports = {
  generateVoiceNote
};
