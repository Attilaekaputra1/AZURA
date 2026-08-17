const { AttachmentBuilder } = require('discord.js');
const { EdgeTTS } = require('node-edge-tts');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('./config');

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
 * Generate Voice Note (MP3) using Free Microsoft Edge Neural Cloud API (Dynamic ID / JP / ZH Voice)
 * @param {string} text 
 * @returns {Promise<AttachmentBuilder>}
 */
async function generateVoiceNote(text) {
  // Truncate text to max 400 chars for fast response
  const cleanText = text.slice(0, 400).replace(/<[^>]+>/g, '').trim();
  const tempPath = path.join(TEMP_DIR, `azura_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);

  // Detect language for voice selection
  const langMode = detectLanguage(cleanText);

  let selectedVoice = 'id-ID-GadisNeural';
  let selectedLang = 'id-ID';

  if (langMode === 'ja') {
    selectedVoice = 'ja-JP-NanamiNeural';
    selectedLang = 'ja-JP';
  } else if (langMode === 'zh') {
    selectedVoice = 'zh-CN-XiaoxiaoNeural'; // Warm, soft & natural Chinese female voice
    selectedLang = 'zh-CN';
  }

  try {
    console.log(`[AZURA TTS]: Generating voice via Microsoft Edge Cloud (${selectedVoice})...`);
    const edgeTts = new EdgeTTS({
      voice: selectedVoice,
      lang: selectedLang,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });

    await edgeTts.ttsPromise(cleanText, tempPath);

    const buffer = fs.readFileSync(tempPath);

    // Clean up temp file silently
    fs.unlink(tempPath, () => {});

    const attachment = new AttachmentBuilder(buffer, { name: 'azura_voice.mp3' });
    return attachment;

  } catch (edgeError) {
    console.warn('[AZURA TTS Warning]: EdgeTTS error/timeout, falling back to OpenAI TTS:', edgeError.message || edgeError);

    // Clean up temp file if exists
    if (fs.existsSync(tempPath)) fs.unlink(tempPath, () => {});

    // Fallback: OpenAI TTS-1 API
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'shimmer',
      input: cleanText
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    return new AttachmentBuilder(buffer, { name: 'azura_voice.mp3' });
  }
}

module.exports = {
  generateVoiceNote
};
