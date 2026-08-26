const fs = require('fs');
const path = require('path');
const config = require('./config');

const PERMANENT_MEMORY_FILE = path.join(__dirname, '../data/permanent_summaries.json');
const MAX_SUMMARIES_PER_CONTEXT = 100; // 100 summaries * 50 msgs = 5,000 messages!

// In-memory cache for ultra-fast access
let permanentMemoryCache = {};

/**
 * Load permanent memory store from disk
 */
function loadPermanentMemory() {
  try {
    const dataDir = path.dirname(PERMANENT_MEMORY_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (fs.existsSync(PERMANENT_MEMORY_FILE)) {
      const raw = fs.readFileSync(PERMANENT_MEMORY_FILE, 'utf8');
      permanentMemoryCache = JSON.parse(raw || '{}');
    } else {
      permanentMemoryCache = {};
    }
  } catch (err) {
    console.error('[PermanentMemory Error]: Failed to load permanent_summaries.json:', err.message);
    permanentMemoryCache = {};
  }
}

/**
 * Save permanent memory store atomically to disk
 */
function savePermanentMemory() {
  try {
    const dataDir = path.dirname(PERMANENT_MEMORY_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const tmpFile = `${PERMANENT_MEMORY_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(permanentMemoryCache, null, 2), 'utf8');
    fs.renameSync(tmpFile, PERMANENT_MEMORY_FILE);
  } catch (err) {
    console.error('[PermanentMemory Error]: Failed to save permanent_summaries.json:', err.message);
  }
}

// Initial load
loadPermanentMemory();

/**
 * Check if a batch of messages is mostly junk/filler (wkwk, halo, test, etc.)
 * @param {Array<{role: string, content: string}>} messages 
 * @returns {boolean}
 */
function isBatchTooTrivial(messages) {
  if (!messages || messages.length < 3) return true;
  const combined = messages.map(m => m.content || '').join(' ').toLowerCase();
  const meaningfulWords = combined.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  
  // If almost no substantive words, skip summarization
  return meaningfulWords.length < 10;
}

/**
 * AI Summarizer: Compresses a batch of ~30-50 messages into an Executive Context Summary
 * @param {Array<{role: string, content: string}>} messages 
 * @param {boolean} [isPriority=false] 
 * @param {string} [customTitle=''] 
 * @returns {Promise<{ title: string, summary: string, keyPoints: string[] }|null>}
 */
async function summarizeMessages(messages, isPriority = false, customTitle = '') {
  if (!messages || messages.length === 0) return null;
  if (isBatchTooTrivial(messages) && !isPriority) {
    console.log('[PermanentMemory]: Batch consists of trivial chatter, skipped permanent summarization.');
    return null;
  }

  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const formattedTranscript = messages.map(m => {
    const sender = m.role === 'user' ? 'Pengguna' : 'AZURA';
    return `${sender}: ${m.content}`;
  }).join('\n');

  const systemPrompt = `Kamu adalah AI Executive Memory Archiver untuk AZURA.
TUGAS UTAMA:
Rangkum riwayat percakapan di bawah ini menjadi SATU BLOK RINGKASAN EKSEKUTIF MEMORI PERMANEN yang padat, berbobot, dan bernilai tinggi.

ATURAN EKSTRAKSI KETAT:
1. BUANG SEMUA SAMPAH/FILLER: Abaikan basa-basi ("halo", "wkwk", "makasih", "siap", stiker, lelucon receh).
2. FOKUS HANYA PADA HAL PENTING:
   - Keputusan penting / kesepakatan yang dibuat
   - Proyek, fitur, arsitektur sistem, atau pekerjaan yang sedang dibahas/dikerjakan
   - Preferensi, kebiasaan, instruksi spesifik, atau fakta penting dari pengguna
   - Jadwal, janji temu, atau to-do list penting
3. FORMAT OUTPUT (JSON STRICT):
Keluarkan HANYA format JSON valid tanpa format markdown \`\`\`json:
{
  "title": "${customTitle || 'Judul Topik Diskusi (Maks 5 Kata)'}",
  "summary": "Ringkasan narasi eksekutif dalam 2-4 kalimat padat yang mencakup inti diskusi.",
  "keyPoints": [
    "Poin penting 1",
    "Poin penting 2",
    "Poin penting 3"
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Riwayat percakapan yang perlu diringkas:\n\n${formattedTranscript}` }
      ],
      max_completion_tokens: 450
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    const cleanJson = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      title: parsed.title || customTitle || 'Diskusi Konteks',
      summary: parsed.summary || 'Konteks obrolan telah diarsipkan.',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 4) : []
    };
  } catch (err) {
    console.error('[PermanentMemory AI Error]:', err.message);
    return null;
  }
}

/**
 * Add a new permanent summary to a context key (Supports up to 100 keys / 5,000 messages)
 * @param {string} contextKey 
 * @param {{ title: string, summary: string, keyPoints: string[], messageCount: number, isPriority: boolean }} summaryData 
 */
function addPermanentSummary(contextKey, summaryData) {
  loadPermanentMemory();

  if (!permanentMemoryCache[contextKey]) {
    permanentMemoryCache[contextKey] = [];
  }

  const now = new Date();
  const dateFormatted = now.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const entry = {
    id: `sum_${Date.now()}`,
    createdAt: now.toISOString(),
    dateFormatted: `${dateFormatted} WIB`,
    messageCount: summaryData.messageCount || 35,
    isPriority: !!summaryData.isPriority,
    title: summaryData.title || 'Diskusi Konteks',
    summary: summaryData.summary,
    keyPoints: summaryData.keyPoints || []
  };

  // Prepend latest summary
  permanentMemoryCache[contextKey].unshift(entry);

  // Enforce 100 Summaries Max Limit (100 summaries * 50 msgs = 5,000 messages!)
  if (permanentMemoryCache[contextKey].length > MAX_SUMMARIES_PER_CONTEXT) {
    permanentMemoryCache[contextKey] = permanentMemoryCache[contextKey].slice(0, MAX_SUMMARIES_PER_CONTEXT);
  }

  savePermanentMemory();
  console.log(`[PermanentMemory]: 💾 Saved summary #${entry.id} for ${contextKey}: "${entry.title}" (Total: ${permanentMemoryCache[contextKey].length}/${MAX_SUMMARIES_PER_CONTEXT})`);
  return entry;
}

/**
 * Get all permanent summaries for a context key
 * @param {string} contextKey 
 * @returns {Array<object>}
 */
function getPermanentSummaries(contextKey) {
  loadPermanentMemory();
  return permanentMemoryCache[contextKey] || [];
}

/**
 * Format recent permanent summaries for injection into AZURA's system prompt
 * @param {string} contextKey 
 * @param {number} [maxCount=5] 
 * @returns {string}
 */
function getPermanentSummariesContext(contextKey, maxCount = 5) {
  const list = getPermanentSummaries(contextKey);
  if (!list || list.length === 0) return '';

  const recent = list.slice(0, maxCount);
  const formatted = recent.map((item, idx) => {
    const priorityTag = item.isPriority ? ' ⭐ [PRIORITAS TINGGI]' : '';
    const points = item.keyPoints && item.keyPoints.length > 0 ? `\n     • Poin Kunci: ${item.keyPoints.join('; ')}` : '';
    return `  ${idx + 1}. [${item.dateFormatted}] "${item.title}"${priorityTag}:\n     ${item.summary}${points}`;
  }).join('\n\n');

  return `\n\n[MEMORI PERMANEN & RIWAYAT SESI SEBELUMNYA (Tersimpan di VPS - Hingga 5.000 Pesan)]:\n` +
    `Berikut adalah ringkasan eksekutif dari sesi percakapan penting sebelumnya yang telah dipermanenkan:\n` +
    `${formatted}\n` +
    `Gunakan informasi di atas untuk menjaga kesinambungan ingatan, kesepakatan, dan detail proyek lintas sesi secara konsisten.`;
}

/**
 * Delete a specific permanent summary by ID or index
 * @param {string} contextKey 
 * @param {string} summaryId 
 * @returns {boolean}
 */
function deletePermanentSummaryById(contextKey, summaryId) {
  loadPermanentMemory();
  if (!permanentMemoryCache[contextKey]) return false;
  const initialLength = permanentMemoryCache[contextKey].length;
  const cleanTarget = summaryId.replace(/^sum_/, '');
  permanentMemoryCache[contextKey] = permanentMemoryCache[contextKey].filter(
    s => s.id !== summaryId && s.id !== `sum_${cleanTarget}`
  );
  const deleted = permanentMemoryCache[contextKey].length < initialLength;
  if (deleted) {
    savePermanentMemory();
  }
  return deleted;
}

/**
 * AI Memory Audit & Pruning Advisory Engine
 * Analyzes stored summaries against actual dates, identifying obsolete, temporary, or active contexts.
 * @param {string} contextKey 
 * @returns {Promise<{ total: number, advisoryText: string, items: Array<{ id: string, title: string, status: 'KEEP'|'REVIEW'|'PRUNE', reason: string }> }>}
 */
async function auditPermanentMemories(contextKey) {
  loadPermanentMemory();
  const list = permanentMemoryCache[contextKey] || [];
  if (list.length === 0) {
    return {
      total: 0,
      advisoryText: 'Belum ada ringkasan memori permanen yang tersimpan untuk sesi/konteks ini.',
      items: []
    };
  }

  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const now = new Date();
  const todayStr = now.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedItems = list.map((item, idx) => {
    return `[ID: ${item.id}] [Tanggal: ${item.dateFormatted}] Judul: "${item.title}" (Prioritas: ${item.isPriority ? 'YA' : 'TIDAK'})\nRingkasan: ${item.summary}\nPoin Kunci: ${(item.keyPoints || []).join(', ')}`;
  }).join('\n\n---\n\n');

  const systemPrompt = `Kamu adalah AZURA, AI Advisor & Memory Curator untuk Creatormu (Attila / Putra).
Hari ini adalah ${todayStr}.

TUGAS UTAMA:
Lakukan audit kritis dan cerdas terhadap seluruh daftar memori permanen yang tersimpan di bawah ini.
Bandingkan tanggal pencatatan aktual masing-masing memori dengan tanggal hari ini, serta analisis apakah informasi tersebut:
1. 🟢 [KEEP]: Masih sangat relevan, prinsip arsitektur penting, fakta identitas, atau proyek jangka panjang.
2. 🟡 [REVIEW]: Topik yang mungkin sudah selesai atau jadwal sementara yang sudah lewat beberapa minggu/bulan.
3. 🔴 [PRUNE]: Obrolan atau kesepakatan sementara yang sudah basi, kadaluarsa, atau sudah tidak berlaku lagi.

Berikan analisis kritis yang ramah, santai khas Gen Z, namun terstruktur dan objektif, serta berikan rekomendasi ID memori mana yang disarankan untuk dibersihkan agar database tetap ramping dan efisien.

FORMAT JSON OUTPUT (STRICT):
{
  "advisoryText": "Narasi ringkas hasil audit memori dari AZURA untuk Attila...",
  "items": [
    {
      "id": "sum_xxx",
      "title": "...",
      "status": "KEEP" | "REVIEW" | "PRUNE",
      "reason": "Alasan singkat status..."
    }
  ]
}`;

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Daftar Memori yang Perlu Diaudit:\n\n${formattedItems}` }
      ],
      max_completion_tokens: 600
    });

    const content = res.choices[0]?.message?.content?.trim() || '';
    const cleanJson = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      total: list.length,
      advisoryText: parsed.advisoryText || 'Audit memori selesai.',
      items: parsed.items || []
    };
  } catch (err) {
    console.error('[PermanentMemory Audit Error]:', err.message);
    return {
      total: list.length,
      advisoryText: `Gagal melakukan audit AI: ${err.message}`,
      items: []
    };
  }
}

module.exports = {
  summarizeMessages,
  addPermanentSummary,
  getPermanentSummaries,
  getPermanentSummariesContext,
  clearPermanentSummaries,
  deletePermanentSummaryById,
  auditPermanentMemories,
  MAX_SUMMARIES_PER_CONTEXT
};
