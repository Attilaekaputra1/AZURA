/**
 * AZURA Voice Audio Pipeline Subsystem
 * Handles PCM/WAV conversion, strict Pre-STT hardware RMS/Peak energy gating,
 * OpenAI Whisper transcription, and zero-tolerance phantom hallucination filters.
 */

const { OpenAI, toFile } = require('openai');
const config = require('./config');

const MIN_AUDIO_BYTES = 24000; // ~0.12s at 48kHz stereo 16-bit
const MAX_RECORDING_MS = 30000; // Max 30s recording per turn

// Common phantom transcripts from background noise, wind, breathing, or YouTube subtitles
const WHISPER_HALLUCINATIONS = new Set([
  'terima kasih telah menonton',
  'terima kasih sudah menonton',
  'terima kasih',
  'terimakasih',
  'terima kasih banyak',
  'sampai jumpa',
  'sampai jumpa di video selanjutnya',
  'sampai jumpa lagi',
  'subscribe',
  'like and subscribe',
  'jangan lupa subscribe',
  'thank you for watching',
  'thanks for watching',
  'thank you',
  'thanks',
  'subtitles by',
  'subtitles by the amara.org community',
  'subtitles by the amara org community',
  'amara.org',
  'amara org',
  'translated by',
  'transcribed by',
  'you',
  'bye',
  'bye bye',
  'goodbye',
  'hmm',
  'hm',
  'uh',
  'ah',
  'oh',
  'eh',
  'krik',
  'krik krik',
  'musik',
  'music',
  'audio',
  'suara angin',
  'suara musik',
  'suara nafas',
  'he-he',
  'ha-ha',
  'halo',
  'hai',
  'kamu',
  'aku',
  'itu'
]);

const WHISPER_HALLUCINATION_PATTERNS = [
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

function isWhisperHallucination(transcript) {
  if (!transcript || typeof transcript !== 'string') return true;
  const clean = transcript.toLowerCase().replace(/[.,!?;:'"()\[\]]+/g, ' ').trim();
  if (clean.length < 2) return true;
  if (WHISPER_HALLUCINATIONS.has(clean)) return true;
  return WHISPER_HALLUCINATION_PATTERNS.some(pattern => pattern.test(clean));
}

/**
 * Convert raw PCM Buffer to valid WAV Buffer
 */
function pcmToWav(pcmBuffer, sampleRate = 48000, channels = 2, bitDepth = 16) {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitDepth, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([wavHeader, pcmBuffer]);
}

/**
 * Calculate RMS energy and Peak Amplitude of PCM buffer
 */
function calculateRmsAndPeak(pcmBuffer) {
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i]);
    if (absVal > peak) peak = absVal;
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return { rms, peak };
}

let openaiInstance = null;
function getOpenAI() {
  if (!openaiInstance && config.OPENAI_API_KEY) {
    openaiInstance = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return openaiInstance;
}

/**
 * Transcribe WAV audio buffer using OpenAI Whisper
 */
async function transcribeVoice(wavBuffer) {
  const openai = getOpenAI();
  if (!openai) return null;

  try {
    const file = await toFile(wavBuffer, 'voice_input.wav', { type: 'audio/wav' });
    const response = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'id',
      prompt: 'Azura, Ara, Zura, Attila, Putra, halo, apa kabar'
    });
    return response.text ? response.text.trim() : null;
  } catch (err) {
    console.error('[Whisper Pipeline Error]:', err.message);
    return null;
  }
}

module.exports = {
  MIN_AUDIO_BYTES,
  MAX_RECORDING_MS,
  WHISPER_HALLUCINATIONS,
  WHISPER_HALLUCINATION_PATTERNS,
  isWhisperHallucination,
  pcmToWav,
  calculateRmsAndPeak,
  transcribeVoice
};
