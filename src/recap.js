/**
 * Channel & Chat Recap Module for AZURA
 * Analyzes and summarizes Discord text conversations strictly for the SAME DAY (Hari Ini).
 */

const { askAzura } = require('./azura');

// Keywords indicating recap / summarization intent in natural text chat
const RECAP_PATTERNS = [
  /\b(?:recap|rekap|rangkum|ringkas|ringkasan|rekapitulasi)\s*(?:obrolan|chat|pesan|isi|topik)?\s*(?:di\s*)?(?:channel|sini|room|server|hari\s*ini)?\b/i,
  /\b(?:tadi\s+anak-anak|tadi\s+member|tadi\s+pada)\s+(?:lagi\s+)?(?:ngobrolin|bahas|ngomongin|heboh)\s+apa\b/i,
  /\b(?:ketinggalan\s+chat|apa\s+yang\s+terjadi\s+hari\s+ini|update\s+obrolan\s+hari\s+ini)\b/i
];

function isRecapRequest(prompt) {
  if (!prompt) return false;
  return RECAP_PATTERNS.some(p => p.test(prompt));
}

/**
 * Summarize messages in a Discord channel strictly from TODAY (Same Day)
 * @param {import('discord.js').TextChannel} channel 
 * @param {string} requesterName 
 * @param {string} requesterId 
 * @returns {Promise<string|null>}
 */
async function processChannelRecap(channel, requesterName = 'Pengguna', requesterId = '') {
  try {
    // 1. Fetch recent messages (up to 70 messages)
    const fetched = await channel.messages.fetch({ limit: 70 });
    if (!fetched || fetched.size === 0) {
      return 'Hari ini belum ada obrolan sama sekali di channel ini, masih sepi nih~';
    }

    // 2. Filter strictly for SAME DAY messages (since 00:00:00 WIB today)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todayMessages = fetched
      .filter(m => m.createdTimestamp >= startOfDay && !m.author.bot && m.content.trim().length > 0)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp); // Chronological order

    if (todayMessages.size === 0) {
      return 'Di channel ini belum ada obrolan baru untuk hari ini yaa gais (sejak jam 00:00 WIB tadi). Obrolan sebelumnya sudah beda hari ✨';
    }

    // 3. Compile dialogue text
    const dialogueLines = [];
    for (const msg of todayMessages.values()) {
      const timeStr = msg.createdAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
      const sender = msg.member?.displayName || msg.author.displayName || msg.author.username;
      const cleanText = msg.content.replace(/<@!?\d+>/g, '').trim();
      if (cleanText) {
        dialogueLines.push(`[${timeStr}] ${sender}: ${cleanText}`);
      }
    }

    if (dialogueLines.length === 0) {
      return 'Hari ini belum ada teks obrolan yang cukup untuk dirangkum di channel ini yaa.';
    }

    const transcriptText = dialogueLines.slice(-50).join('\n');

    // 4. Request summary from gpt-5.6-luna
    const recapPrompt =
      `[TUGAS: BUAT RECAP / RINGKASAN OBROLAN CHANNEL HARI INI]:\n` +
      `Berikut adalah riwayat chat para member Discord di channel #${channel.name} KHUSUS HARI INI (Total: ${dialogueLines.length} pesan):\n\n` +
      `${transcriptText}\n\n` +
      `[INSTRUKSI]: Buat ringkasan rekap yang santai, estetik, dan enak dibaca ala cewek Gen Z 22 tahun. ` +
      `Sebutkan siapa saja yang ngobrol, apa topik seru yang lagi dibahas hari ini, dan kesimpulannya. Gunakan format poin-poin rapi dengan emoji penanda.`;

    const summaryResult = await askAzura(requesterId || 'system', recapPrompt, requesterName, [], false, channel.id);
    return summaryResult;

  } catch (err) {
    console.error('[Channel Recap Error]:', err.message);
    return 'Waduh, ada kendala pas aku coba baca riwayat chat hari ini. Coba lagi sebentar ya!';
  }
}

module.exports = {
  isRecapRequest,
  processChannelRecap
};
