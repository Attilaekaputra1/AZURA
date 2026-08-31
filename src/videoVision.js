const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const { OpenAI } = require('openai');
const config = require('./config');

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB max video size
const MAX_FRAMES = 8; // Optimal balance for LLM vision context & latency

let _openai = null;
function getOpenAIClient() {
  if (!_openai && config.OPENAI_API_KEY) {
    _openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return _openai;
}

/**
 * Check if a filename or URL corresponds to a supported video format
 * @param {string} filenameOrUrl 
 * @param {string} [contentType]
 * @returns {boolean}
 */
function isVideoMedia(filenameOrUrl = '', contentType = '') {
  if (contentType && contentType.startsWith('video/')) return true;
  return /\.(mp4|mov|webm|mkv|avi|m4v)(\?|$)/i.test(filenameOrUrl);
}

/**
 * Download a file from URL to local disk
 * @param {string} url 
 * @param {string} destPath 
 * @returns {Promise<number>} File size in bytes
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, (res) => {
      // Handle redirects (e.g. 301, 302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return resolve(downloadFile(res.headers.location, destPath));
      }

      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return reject(new Error(`Failed to download video, HTTP Status: ${res.statusCode}`));
      }

      let totalBytes = 0;
      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_VIDEO_BYTES) {
          req.destroy();
          file.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          return reject(new Error(`Ukuran video melebihi batas maksimal 50MB.`));
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve(totalBytes));
      });
    });

    req.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(new Error('Download video timeout (30s).'));
    });
  });
}

/**
 * Get video duration and resolution using ffmpeg / ffprobe
 * @param {string} videoPath 
 * @returns {Promise<{ duration: number, resolution: string, hasAudio: boolean }>}
 */
function getVideoMetadata(videoPath) {
  return new Promise((resolve) => {
    exec(`ffmpeg -i "${videoPath}" 2>&1`, { timeout: 8000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');

      // Parse Duration: Duration: 00:00:15.24
      let duration = 5;
      const durMatch = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)/i);
      if (durMatch) {
        const hours = parseFloat(durMatch[1]);
        const mins = parseFloat(durMatch[2]);
        const secs = parseFloat(durMatch[3]);
        duration = (hours * 3600) + (mins * 60) + secs;
      }

      // Parse Resolution: 1920x1080
      let resolution = '1280x720';
      const resMatch = output.match(/Video:.*?,\s*(\d{3,4}x\d{3,4})/i);
      if (resMatch) {
        resolution = resMatch[1];
      }

      // Check if Audio stream exists
      const hasAudio = /Audio:\s*[a-zA-Z0-9_-]+/i.test(output);

      resolve({
        duration: Math.max(1, Math.round(duration)),
        resolution,
        hasAudio
      });
    });
  });
}

/**
 * Extract evenly spaced keyframes from video and return as Base64 Data URLs
 * @param {string} videoPath 
 * @param {number} duration 
 * @param {string} tempDir 
 * @returns {Promise<Array<{ timestampStr: string, timeSec: number, dataUrl: string }>>}
 */
async function extractKeyframes(videoPath, duration, tempDir) {
  const frameCount = Math.min(MAX_FRAMES, Math.max(3, Math.floor(duration / 3)));
  const frames = [];

  // Calculate sampling timestamps (e.g., at 10%, 25%, 50%, 75%, 90% of duration)
  const timestamps = [];
  for (let i = 1; i <= frameCount; i++) {
    const fraction = i / (frameCount + 1);
    const timeSec = parseFloat((duration * fraction).toFixed(2));
    timestamps.push(timeSec);
  }

  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const frameFile = path.join(tempDir, `frame_${i + 1}.jpg`);

    const mins = Math.floor(t / 60).toString().padStart(2, '0');
    const secs = Math.floor(t % 60).toString().padStart(2, '0');
    const timestampStr = `${mins}:${secs}`;

    // Extract high-quality frame scaled to max 1280px width for optimal OCR & visual clarity
    const cmd = `ffmpeg -ss ${t} -i "${videoPath}" -vframes 1 -vf "scale='min(1280,iw)':-2" -q:v 2 "${frameFile}" -y`;

    await new Promise((res) => {
      exec(cmd, { timeout: 6000 }, () => res());
    });

    if (fs.existsSync(frameFile)) {
      try {
        const imgBuffer = fs.readFileSync(frameFile);
        const base64 = imgBuffer.toString('base64');
        frames.push({
          timestampStr,
          timeSec: t,
          dataUrl: `data:image/jpeg;base64,${base64}`
        });
      } catch (err) {
        console.warn(`[VideoVision]: Failed to read frame at ${timestampStr}:`, err.message);
      }
    }
  }

  return frames;
}

/**
 * Extract and transcribe audio track from video using OpenAI Whisper
 * @param {string} videoPath 
 * @param {string} tempDir 
 * @returns {Promise<string|null>}
 */
async function extractAndTranscribeAudio(videoPath, tempDir) {
  const audioFile = path.join(tempDir, 'audio_track.mp3');
  const cmd = `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ac 1 -ar 16000 -q:a 4 "${audioFile}" -y`;

  await new Promise((res) => {
    exec(cmd, { timeout: 10000 }, () => res());
  });

  if (!fs.existsSync(audioFile)) return null;

  try {
    const stats = fs.statSync(audioFile);
    if (stats.size < 1000) return null; // Empty / silent file

    const client = getOpenAIClient();
    if (!client) return null;

    console.log(`[VideoVision]: Transcribing video audio track with OpenAI Whisper...`);
    const resp = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioFile),
      model: 'whisper-1'
    });

    return (resp?.text || '').trim() || null;
  } catch (err) {
    console.warn('[VideoVision Audio Warning]: Whisper transcription failed/skipped:', err.message);
    return null;
  }
}

/**
 * Process a Discord video attachment comprehensively:
 * Extracts keyframes, audio transcription, video metadata, and prepares vision inputs.
 * @param {string} videoUrl 
 * @param {string} filename 
 * @returns {Promise<{ success: boolean, frames: Array<{ timestampStr: string, timeSec: number, dataUrl: string }>, audioTranscript: string|null, videoPrompt: string, error?: string }>}
 */
async function processVideoAttachment(videoUrl, filename = 'video.mp4') {
  const uniqueId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tempDir = path.join(os.tmpdir(), uniqueId);

  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const extMatch = filename.match(/\.(mp4|mov|webm|mkv|avi|m4v)/i);
    const ext = extMatch ? extMatch[1] : 'mp4';
    const videoPath = path.join(tempDir, `input.${ext}`);

    console.log(`[VideoVision]: 🎬 Downloading & inspecting video "${filename}" (${videoUrl.slice(0, 60)}...)...`);
    await downloadFile(videoUrl, videoPath);

    // 1. Get Video Metadata
    const metadata = await getVideoMetadata(videoPath);
    console.log(`[VideoVision]: 📊 Video Metadata: ${metadata.duration}s | ${metadata.resolution} | Audio: ${metadata.hasAudio}`);

    // 2. Extract High-Definition Keyframes
    const frames = await extractKeyframes(videoPath, metadata.duration, tempDir);
    console.log(`[VideoVision]: 🖼️ Extracted ${frames.length} keyframes across timeline.`);

    // 3. Extract & Transcribe Audio (if present)
    let audioTranscript = null;
    if (metadata.hasAudio) {
      audioTranscript = await extractAndTranscribeAudio(videoPath, tempDir);
    }

    // 4. Build Structured Video Prompt
    const timelineStr = frames.map((f, i) => `• Frame #${i + 1} (Menit/Detik: \`${f.timestampStr}\`)`).join('\n');
    const audioNote = audioTranscript
      ? `🎙️ **Transkrip Percakapan / Suara di dalam Video:**\n"${audioTranscript}"`
      : `🎙️ **Transkrip Suara:** *(Video tidak memiliki suara vokal / hanya audio latar)*`;

    const videoPrompt =
      `[PENGGUNA MENGUNGGAH VIDEO UNTUK DIANALISIS: "${filename}"]\n` +
      `📊 **Informasi Teknis Video:** Durasi: \`${metadata.duration} detik\` | Resolusi: \`${metadata.resolution}\` | Total Frame Dianalisis: \`${frames.length} keyframe\`\n\n` +
      `${audioNote}\n\n` +
      `🎬 **Kronologi Timeline Frame:**\n${timelineStr}\n\n` +
      `PEDOMAN ANALISIS VIDEO MULTIMODAL AZURA:\n` +
      `1. Kamu telah menerima ${frames.length} gambar keyframe beresolusi tinggi yang diambil secara berurutan sepanjang video.\n` +
      `2. Analisis alur adegan (*scene progression*), aksi pergerakan, ekspresi tokoh/karakter, teks atau UI yang muncul di layar (OCR), serta sinkronisasi dengan transkrip suara di atas.\n` +
      `3. Berikan analisis atau tanggapan yang sangat tajam, komprehensif, menyenangkan, dan detail seolah kamu menonton videonya dari awal sampai akhir!`;

    return {
      success: true,
      frames,
      audioTranscript,
      videoPrompt
    };
  } catch (err) {
    console.error('[VideoVision Error]:', err.message);
    return {
      success: false,
      frames: [],
      audioTranscript: null,
      videoPrompt: `[Catatan: Pengguna mengunggah video "${filename}", tetapi terjadi kendala pemrosesan video: ${err.message}]`,
      error: err.message
    };
  } finally {
    // Clean up temporary directory & files
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

module.exports = {
  isVideoMedia,
  processVideoAttachment,
  downloadFile,
  getVideoMetadata
};
