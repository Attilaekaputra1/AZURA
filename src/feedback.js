/**
 * AZURA Advice & Report System (Confidential Feedback & Bug Reporting)
 * Features:
 * - End-to-End Encrypted To-Do List Database (data/feedback_todolist.enc)
 * - AI Strategic Consultation Engine (Multi-perspective Value, Risk, & Utility Analysis)
 * - Interactive Owner DM Control (Accept, Reject with Reason Modal, Mark Done)
 * - Automated Bi-directional Member Notifications in DM
 * - Realtime Web Roadmap & To-Do Dashboard
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { encryptPayload, decryptPayload } = require('./vault');

const FEEDBACK_FILE_PATH = path.join(__dirname, '../data/feedback_todolist.enc');

// In-memory cache of feedback tickets (ticketId -> TicketObject)
let feedbackStore = new Map();
let isStoreLoaded = false;

function loadFeedbackStore() {
  if (isStoreLoaded) return;
  try {
    const dataDir = path.dirname(FEEDBACK_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(FEEDBACK_FILE_PATH)) {
      const encryptedData = fs.readFileSync(FEEDBACK_FILE_PATH, 'utf8');
      const decrypted = decryptPayload(encryptedData);
      if (decrypted && typeof decrypted === 'object') {
        feedbackStore = new Map(Object.entries(decrypted));
        console.log(`[Feedback Store]: 🔒 Decrypted and loaded ${feedbackStore.size} feedback & bug tickets.`);
      }
    } else {
      feedbackStore = new Map();
      saveFeedbackStore();
    }
    isStoreLoaded = true;
  } catch (err) {
    console.error('[Feedback Store Load Error]:', err.message);
    feedbackStore = new Map();
    isStoreLoaded = true;
  }
}

function saveFeedbackStore() {
  try {
    const plainObj = Object.fromEntries(feedbackStore);
    const encryptedEnvelope = encryptPayload(plainObj);
    const tmpPath = `${FEEDBACK_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, encryptedEnvelope, 'utf8');
    fs.renameSync(tmpPath, FEEDBACK_FILE_PATH);
  } catch (err) {
    console.error('[Feedback Store Save Error]: Failed to save encrypted tickets:', err.message);
  }
}

/**
 * Generate a friendly short ticket ID e.g. #ADV-7B3 or #REP-9A1
 */
function generateTicketId(type) {
  const prefix = type === 'advice' ? 'ADV' : 'REP';
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${rand}`;
}

/**
 * Create and submit a new Advice / Report submission
 * @param {import('discord.js').Client} client 
 * @param {object} data
 */
async function submitFeedback(client, data) {
  loadFeedbackStore();

  if (!config.OWNER_DISCORD_ID) {
    return {
      success: false,
      message: '⚠️ ID Owner belum dikonfigurasi pada bot, tidak dapat meneruskan laporan.'
    };
  }

  const isAdvice = data.type === 'advice';
  const ticketId = generateTicketId(data.type);
  const nowIso = new Date().toISOString();

  const ticket = {
    ticketId,
    type: data.type,
    userId: data.userId,
    userName: data.userName,
    userTag: data.userTag || data.userName,
    content: data.content,
    guildName: data.guildName || null,
    channelName: data.channelName || null,
    imageUrl: data.imageUrl || null,
    status: 'PENDING', // PENDING | ACCEPTED | REJECTED | DONE
    createdAt: nowIso,
    decisionAt: null,
    rejectReason: null,
    completedAt: null
  };

  feedbackStore.set(ticketId, ticket);
  saveFeedbackStore();

  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
  const dateStr = now.toLocaleDateString('id-ID', options);
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  const locationStr = data.guildName
    ? `🏛️ **Server:** ${data.guildName} (#${data.channelName || 'general'})`
    : `📩 **Direct Message (DM Pribadi)**`;

  const embed = new EmbedBuilder()
    .setColor(isAdvice ? 0xFEE75C : 0xED4245)
    .setTitle(isAdvice ? `💡 [ADVICE #${ticketId}] Saran & Masukan Baru!` : `🐛 [REPORT #${ticketId}] Laporan Bug / Kendala Baru!`)
    .setDescription(
      `Halo Attila! Ada ${isAdvice ? 'saran/masukan rahasia' : 'laporan bug rahasia'} baru dari pengguna AZURA:\n\n` +
      `👤 **Pengirim:** **${data.userName}** (\`${data.userTag}\`)\n` +
      `🆔 **User ID:** \`${data.userId}\`\n` +
      `📍 **Lokasi Pengiriman:** ${locationStr}\n` +
      `⏰ **Waktu:** ${dateStr} pukul ${timeStr} WIB\n` +
      `📋 **Status:** \`PENDING (Menunggu Keputusan Attila)\`\n\n` +
      `📝 **Isi ${isAdvice ? 'Saran/Masukan' : 'Laporan Bug'}:**\n` +
      `>>> ${data.content}`
    )
    .setFooter({ text: `Ticket ID: ${ticketId} • Gunakan tombol di bawah untuk memutuskan` })
    .setTimestamp();

  if (data.imageUrl) {
    embed.setImage(data.imageUrl);
  }

  // Interactive Control Buttons for Attila
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb_discuss:${ticketId}`)
      .setLabel('🧠 Diskusi & Analisis AI')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`fb_accept:${ticketId}`)
      .setLabel('✅ Terima & Masuk To-Do')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`fb_reject:${ticketId}`)
      .setLabel('❌ Tolak Request')
      .setStyle(ButtonStyle.Danger)
  );

  try {
    const ownerUser = await client.users.fetch(config.OWNER_DISCORD_ID);
    if (!ownerUser) {
      return { success: false, message: 'Gagal menemukan akun Discord Owner.' };
    }

    await ownerUser.send({ embeds: [embed], components: [row] });
    console.log(`[Feedback System]: Ticket #${ticketId} (${data.type.toUpperCase()}) from ${data.userName} forwarded to Owner DM with interactive actions.`);

    const replyGreeting = isAdvice
      ? `🔒 **Saran Berhasil Terkirim!**\nMakasih banyak sarannya yaa **${data.userName}**! ✨ Masukan kamu (*Ticket #${ticketId}*) sudah langsung aku teruskan secara privat ke DM Attila. Nanti kamu akan dapat notifikasi DM langsung dari AZURA begitu Attila meninjau saran ini yaa! 💡💖`
      : `🔒 **Laporan Bug Terkirim!**\nMakasih laporannya yaa **${data.userName}**! 🛠️ Laporan bug kamu (*Ticket #${ticketId}*) sudah langsung masuk ke DM Attila. Kami akan memberitahu kamu lewat DM begitu ada update status pengerjaannya yaa! 🐛✨`;

    return {
      success: true,
      message: replyGreeting
    };
  } catch (err) {
    console.error('[Feedback System Error]: Failed to send DM to owner:', err.message);
    return {
      success: false,
      message: 'Waduh, gagal mengirimkan ke DM Owner. Pastikan Owner mengizinkan DM dari bot yaa!'
    };
  }
}

/**
 * AI Strategic Consultation on an Advice or Bug Report
 * Uses OpenAI + Web Search to critically evaluate value, risks, and benefits.
 * @param {string} ticketId 
 * @returns {Promise<string>}
 */
async function consultAiOnFeedback(ticketId) {
  loadFeedbackStore();
  const ticket = feedbackStore.get(ticketId);
  if (!ticket) return 'Ticket tidak ditemukan di database.';

  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const isAdvice = ticket.type === 'advice';

  let webResearch = '';
  try {
    const { searchTavily } = require('./tavily');
    if (ticket.content && ticket.content.length > 5) {
      const searchRes = await searchTavily(ticket.content, 'general').catch(() => null);
      if (searchRes && !searchRes.includes('Gagal') && !searchRes.includes('Tidak ditemukan')) {
        webResearch = `\n\n🌐 **Data Riset Web Terkini (Tavily AI Engine):**\n${searchRes.slice(0, 1200)}`;
      }
    }
  } catch (_) {}

  const systemPrompt = `Kamu adalah AZURA, Asisten AI Cerdas & Strategis tingkat tinggi yang sedang berdiskusi secara privat dengan Creator-mu (Attila).
Attila sedang mempertimbangkan apakah akan MENERIMA atau MENOLAK ${isAdvice ? 'sebuah saran/masukan (Advice)' : 'laporan bug/masalah (Bug Report)'} dari pengguna server.

TUGASMU:
Lakukan analisis kritis, tajam, objektif, dan komprehensif berdasarkan 4 pilar berikut:
1. 💡 **Ringkasan Inti Permintaan**: Jelaskan esensi dari permintaan user secara to-the-point.
2. ⚖️ **Analisis Kemanfaatan (Benefit vs Effort)**:
   - Apakah ini menguntungkan seluruh pengguna, server, dan ekosistem AZURA?
   - Ataukah ini hanya permintaan egois/spesifik untuk satu orang saja?
3. 🛡️ **Analisis Risiko & Efisiensi Sistem**:
   - Apakah ada potensi celah keamanan (security vulnerability), pemborosan token API/bandwidth server, penurunan latency, atau bentrok dengan arsitektur yang sudah ada?
4. 🎯 **Rekomendasi Strategis AZURA**:
   - Berikan rekomendasi tegas: **TERIMA & EKSEKUSI**, **TOLAK**, atau **TERIMA DENGAN MODIFIKASI**.
   - Berikan poin-poin alasan rasional dan langkah aksi terbaik untuk Attila.

Gaya bahasa: Santai, cerdas, tajam, profesional, hangat khas partner diskusi Attila. Gunakan bullet points yang rapi dan formatting Discord yang indah.`;

  const userPrompt = `Detail ${isAdvice ? 'Saran' : 'Laporan Bug'} (Ticket #${ticket.ticketId}):
- Pengirim: ${ticket.userName} (@${ticket.userTag})
- UID: ${ticket.userId}
- Lokasi: ${ticket.guildName || 'DM'}
- Isi Pesan:
"${ticket.content}"${webResearch}

Berikan analisis strategis dan rekomendasimu untuk Attila sekarang:`;

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 1500
    });

    const output = res.choices[0]?.message?.content?.trim();
    if (output) return output;

    // Fallback if empty
    const retry = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });
    return retry.choices[0]?.message?.content?.trim() || 'Gagal menghasilkan analisis AI.';
  } catch (err) {
    console.error('[AI Consultation Error]:', err.message);
    return `Gagal melakukan analisis AI: ${err.message}`;
  }
}

/**
 * Handle Owner Accept Action
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @param {string} ticketId 
 */
async function handleFeedbackAccept(interaction, ticketId) {
  loadFeedbackStore();
  const ticket = feedbackStore.get(ticketId);
  if (!ticket) {
    return interaction.reply({ content: `❌ Ticket #${ticketId} tidak ditemukan.`, flags: 64 });
  }

  ticket.status = 'ACCEPTED';
  ticket.decisionAt = new Date().toISOString();
  saveFeedbackStore();

  const isAdvice = ticket.type === 'advice';

  // 1. Notify submitter user in DM
  try {
    const targetUser = await interaction.client.users.fetch(ticket.userId);
    if (targetUser) {
      const userEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`✨ [KONFIRMASI AZURA] ${isAdvice ? 'Saran Masukan' : 'Laporan Bug'} Kamu Telah Diterima!`)
        .setDescription(
          `Halo **${ticket.userName}**! 👋\n\n` +
          `${isAdvice ? 'Saran masukan' : 'Laporan bug/kendala'} yang kamu kirimkan sebelumnya (*Ticket #${ticket.ticketId}*):\n` +
          `>>> *"${ticket.content}"*\n\n` +
          `✅ **Status:** **TELAH DITINJAU & DITERIMA OLEH ATTILA!** 🚀\n` +
          `Permintaan kamu sekarang sudah resmi masuk ke antrean **To-Do List Pengembangan AZURA**.\n\n` +
          `Kami akan mengirimkan notifikasi lagi begitu fitur ini selesai dieksekusi agar kamu bisa mulai mencoba/testing kembali. Terima kasih banyak atas kontribusimu! 💖`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [userEmbed] }).catch(() => {});
    }
  } catch (userErr) {
    console.warn(`[Feedback Accept]: Failed to notify user ${ticket.userId}:`, userErr.message);
  }

  // 2. Update Attila's DM Message with [Centang / Selesai] Button
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb_done:${ticketId}`)
      .setLabel('✔️ Selesai & Centang (Done)')
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle(`✅ [DITERIMA & MASUK TO-DO LIST] Ticket #${ticket.ticketId}`)
    .setDescription(
      `Permintaan ${isAdvice ? 'saran' : 'laporan bug'} dari **${ticket.userName}** (\`${ticket.userTag}\`) telah **DITERIMA** dan masuk ke antrean To-Do List!\n\n` +
      `📝 **Isi Request:**\n>>> ${ticket.content}\n\n` +
      `📬 **Notifikasi Pengguna:** Notifikasi DM konfirmasi telah berhasil dikirimkan ke <@${ticket.userId}>.\n` +
      `💡 *Klik tombol di bawah jika kamu sudah selesai mengeksekusi fitur/perbaikan ini.*`
    )
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Handle Owner Reject Action (Opens Reason Modal)
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @param {string} ticketId 
 */
async function showFeedbackRejectModal(interaction, ticketId) {
  loadFeedbackStore();
  const ticket = feedbackStore.get(ticketId);
  if (!ticket) {
    return interaction.reply({ content: `❌ Ticket #${ticketId} tidak ditemukan.`, flags: 64 });
  }

  const isAdvice = ticket.type === 'advice';
  const modal = new ModalBuilder()
    .setCustomId(`modal_fb_reject:${ticketId}`)
    .setTitle(`Tolak ${isAdvice ? 'Saran' : 'Laporan'} #${ticketId}`);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reject_reason')
    .setLabel('Alasan Penolakan untuk Dikirim ke User')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Jelaskan alasan mengapa request ini belum dapat diterima...')
    .setMinLength(5)
    .setMaxLength(1000)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

/**
 * Process Modal Submission for Feedback Rejection
 * @param {import('discord.js').ModalSubmitInteraction} interaction 
 * @param {string} ticketId 
 */
async function handleFeedbackRejectModalSubmit(interaction, ticketId) {
  loadFeedbackStore();
  const ticket = feedbackStore.get(ticketId);
  if (!ticket) {
    return interaction.reply({ content: `❌ Ticket #${ticketId} tidak ditemukan.`, flags: 64 });
  }

  const reason = interaction.fields.getTextInputValue('reject_reason').trim();
  ticket.status = 'REJECTED';
  ticket.rejectReason = reason;
  ticket.decisionAt = new Date().toISOString();
  saveFeedbackStore();

  const isAdvice = ticket.type === 'advice';

  // 1. Notify submitter user in DM with Reason
  try {
    const targetUser = await interaction.client.users.fetch(ticket.userId);
    if (targetUser) {
      const userEmbed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle(`ℹ️ [PEMBERITAHUAN AZURA] ${isAdvice ? 'Saran Masukan' : 'Laporan Bug'} Kamu`)
        .setDescription(
          `Halo **${ticket.userName}**! 👋\n\n` +
          `Terima kasih banyak sudah mengirimkan ${isAdvice ? 'saran/masukan' : 'laporan bug'} sebelumnya (*Ticket #${ticket.ticketId}*):\n` +
          `>>> *"${ticket.content}"*\n\n` +
          `Dengan berat hati, kami ingin memberitahukan bahwa request ini **belum dapat diterima / dieksekusi** oleh Attila saat ini.\n\n` +
          `📝 **Alasan Penolakan dari Attila:**\n` +
          `>>> ${reason}\n\n` +
          `Meskipun begitu, kami sangat mengapresiasi waktu dan ide yang sudah kamu bagikan untuk pengembangan AZURA! 🙏✨`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [userEmbed] }).catch(() => {});
    }
  } catch (userErr) {
    console.warn(`[Feedback Reject]: Failed to notify user ${ticket.userId}:`, userErr.message);
  }

  // 2. Update Attila's DM View
  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle(`❌ [DITOLAK] Ticket #${ticket.ticketId}`)
    .setDescription(
      `Permintaan ${isAdvice ? 'saran' : 'laporan bug'} dari **${ticket.userName}** (\`${ticket.userTag}\`) telah **DITOLAK**.\n\n` +
      `📝 **Isi Request:**\n>>> ${ticket.content}\n\n` +
      `📋 **Alasan Penolakan:**\n>>> ${reason}\n\n` +
      `📬 **Notifikasi Pengguna:** Pesan penolakan beserta alasan telah berhasil dikirimkan ke DM <@${ticket.userId}>.`
    )
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: [] });
}

/**
 * Handle Owner Mark Done Action (Centang Selesai)
 * @param {import('discord.js').ButtonInteraction|import('discord.js').ChatInputCommandInteraction} interaction 
 * @param {string} ticketId 
 */
async function handleFeedbackDone(interaction, ticketId) {
  loadFeedbackStore();
  const ticket = feedbackStore.get(ticketId);
  if (!ticket) {
    const replyPayload = { content: `❌ Ticket #${ticketId} tidak ditemukan.`, flags: 64 };
    return interaction.replied ? interaction.followUp(replyPayload) : interaction.reply(replyPayload);
  }

  ticket.status = 'DONE';
  ticket.completedAt = new Date().toISOString();
  saveFeedbackStore();

  const isAdvice = ticket.type === 'advice';

  // 1. Notify submitter user in DM that task is COMPLETED & READY FOR RE-TESTING
  try {
    const targetUser = await interaction.client.users.fetch(ticket.userId);
    if (targetUser) {
      const userEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`🎉 [KABAR GEMBIRA DARI AZURA!] ${isAdvice ? 'Saran Kamu Sudah Diterapkan!' : 'Bug Telah Diperbaiki!'}`)
        .setDescription(
          `Halo **${ticket.userName}**! 🚀✨\n\n` +
          `${isAdvice ? 'Saran/masukan' : 'Laporan bug/kendala'} yang kamu kirimkan sebelumnya (*Ticket #${ticket.ticketId}*):\n` +
          `>>> *"${ticket.content}"*\n\n` +
          `🎉 **STATUS: TELAH SELESAI DIEKSEKUSI & DITERAPKAN OLEH ATTILA!**\n\n` +
          `Kamu sudah bisa mulai mencoba, menggunakan, atau testing fiturnya sekarang yaa! Jika masih menemukan kendala, jangan ragu untuk melapor kembali.\n\n` +
          `Terima kasih banyak atas kontribusi luar biasamu untuk kemajuan AZURA! 🙌💖`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [userEmbed] }).catch(() => {});
    }
  } catch (userErr) {
    console.warn(`[Feedback Done]: Failed to notify user ${ticket.userId}:`, userErr.message);
  }

  // 2. Update Message
  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`🎉 [SELESAI & DILAPORKAN KE USER] Ticket #${ticket.ticketId}`)
    .setDescription(
      `Permintaan ${isAdvice ? 'saran' : 'laporan bug'} dari **${ticket.userName}** (\`${ticket.userTag}\`) telah **SELESAI DIEKSEKUSI**! 🎉\n\n` +
      `📝 **Isi Request:**\n>>> ${ticket.content}\n\n` +
      `📬 **Notifikasi Pengguna:** Notifikasi penyelesaian & ajakan re-testing telah dikirim ke DM <@${ticket.userId}>.`
    )
    .setTimestamp();

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed], flags: 64 });
  }
}

/**
 * Get To-Do List filtered by status
 * @param {'ACCEPTED'|'PENDING'|'DONE'|'REJECTED'|'ALL'} [status='ACCEPTED']
 */
function getTodoList(status = 'ACCEPTED') {
  loadFeedbackStore();
  const all = Array.from(feedbackStore.values());
  if (status === 'ALL') return all;
  return all.filter(t => t.status === status);
}

/**
 * Generate Realtime Glassmorphism Web Roadmap / To-Do Dashboard HTML
 */
function getTodoListHtml() {
  loadFeedbackStore();
  const all = Array.from(feedbackStore.values());
  const pending = all.filter(t => t.status === 'PENDING');
  const accepted = all.filter(t => t.status === 'ACCEPTED');
  const done = all.filter(t => t.status === 'DONE');
  const rejected = all.filter(t => t.status === 'REJECTED');

  const renderCard = (t) => {
    const isAdv = t.type === 'advice';
    const typeBadge = isAdv ? '<span class="badge badge-adv">💡 Advice</span>' : '<span class="badge badge-rep">🐛 Bug Report</span>';
    const date = new Date(t.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const reasonHtml = t.rejectReason ? `<div class="reject-box"><strong>Alasan:</strong> ${t.rejectReason}</div>` : '';
    return `
      <div class="task-card">
        <div class="card-header">
          <span class="ticket-id">#${t.ticketId}</span>
          ${typeBadge}
        </div>
        <p class="card-content">${t.content}</p>
        <div class="card-footer">
          <span class="author">👤 ${t.userName}</span>
          <span class="date">📅 ${date}</span>
        </div>
        ${reasonHtml}
      </div>
    `;
  };

  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AZURA • Realtime Roadmap & To-Do List</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(22, 27, 46, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #5865F2;
      --accent-glow: rgba(88, 101, 242, 0.3);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
      --info: #38bdf8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 40px 20px; min-height: 100vh; background-image: radial-gradient(circle at 10% 20%, rgba(88, 101, 242, 0.15) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(236, 72, 153, 0.12) 0%, transparent 40%); }
    .container { max-width: 1300px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 40px; }
    .header h1 { font-size: 2.4rem; font-weight: 800; background: linear-gradient(135deg, #fff 0%, #cbd5e1 50%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header p { color: var(--text-muted); margin-top: 8px; font-size: 1.05rem; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 35px; }
    .stat-box { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 20px; text-align: center; backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .stat-number { font-size: 2rem; font-weight: 800; }
    .stat-label { color: var(--text-muted); font-size: 0.9rem; font-weight: 600; text-transform: uppercase; margin-top: 4px; }
    .board-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; align-items: start; }
    .column { background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border); border-radius: 20px; padding: 20px; backdrop-filter: blur(16px); }
    .col-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    .col-title { font-size: 1.15rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .col-count { background: rgba(255, 255, 255, 0.1); padding: 4px 10px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; }
    .task-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); transition: all 0.2s ease; }
    .task-card:hover { transform: translateY(-3px); border-color: rgba(255, 255, 255, 0.2); }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .ticket-id { font-size: 0.85rem; font-weight: 700; color: #818cf8; font-family: monospace; }
    .badge { font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 8px; }
    .badge-adv { background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); }
    .badge-rep { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .card-content { font-size: 0.95rem; line-height: 1.5; color: #e2e8f0; margin-bottom: 14px; word-break: break-word; }
    .card-footer { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; }
    .reject-box { margin-top: 10px; padding: 8px 12px; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger); border-radius: 6px; font-size: 0.85rem; color: #fca5a5; }
    .empty-col { text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 0.9rem; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 AZURA Development Roadmap & To-Do List</h1>
      <p>Papan status realtime untuk saran pengguna, perbaikan bug, dan rencana fitur.</p>
    </div>

    <div class="stats-row">
      <div class="stat-box"><div class="stat-number" style="color: var(--warning);">${pending.length}</div><div class="stat-label">Pending Review</div></div>
      <div class="stat-box"><div class="stat-number" style="color: var(--info);">${accepted.length}</div><div class="stat-label">In Progress (To-Do)</div></div>
      <div class="stat-box"><div class="stat-number" style="color: var(--success);">${done.length}</div><div class="stat-label">Completed & Live</div></div>
      <div class="stat-box"><div class="stat-number" style="color: var(--danger);">${rejected.length}</div><div class="stat-label">Rejected</div></div>
    </div>

    <div class="board-grid">
      <!-- In Progress / To-Do Column -->
      <div class="column">
        <div class="col-header">
          <div class="col-title" style="color: var(--info);">📌 Dalam Pengerjaan (To-Do)</div>
          <span class="col-count">${accepted.length}</span>
        </div>
        ${accepted.length ? accepted.map(renderCard).join('') : '<div class="empty-col">Belum ada tugas aktif</div>'}
      </div>

      <!-- Completed Column -->
      <div class="column">
        <div class="col-header">
          <div class="col-title" style="color: var(--success);">🎉 Selesai & Diterapkan</div>
          <span class="col-count">${done.length}</span>
        </div>
        ${done.length ? done.map(renderCard).join('') : '<div class="empty-col">Belum ada tugas selesai</div>'}
      </div>

      <!-- Pending Column -->
      <div class="column">
        <div class="col-header">
          <div class="col-title" style="color: var(--warning);">⏳ Menunggu Review Attila</div>
          <span class="col-count">${pending.length}</span>
        </div>
        ${pending.length ? pending.map(renderCard).join('') : '<div class="empty-col">Tidak ada antrean review</div>'}
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Handle Slash Command interaction for /report or /advice
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function handleFeedbackSlash(interaction) {
  const kategori = interaction.options.getString('kategori') || 'advice';
  const pesan = interaction.options.getString('pesan');
  const attachment = interaction.options.getAttachment('lampiran');

  const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
  const userTag = interaction.user.tag;
  const userId = interaction.user.id;
  const guildName = interaction.guild?.name || null;
  const channelName = interaction.channel?.name || null;
  const imageUrl = attachment?.url || null;

  const result = await submitFeedback(interaction.client, {
    userId,
    userName,
    userTag,
    type: kategori,
    content: pesan,
    guildName,
    channelName,
    imageUrl
  });

  await interaction.reply({
    content: result.message,
    flags: 64
  });
}

/**
 * Check if a text message is an explicit feedback/report command in chat
 * @param {string} prompt 
 * @returns {{ isFeedback: boolean, type?: 'advice'|'report', content?: string }}
 */
function parseNaturalFeedback(prompt) {
  if (!prompt) return { isFeedback: false };

  const bugMatch = prompt.match(/(?:lapor\s+bug|report\s+bug|lapor\s+kendala|lapor\s+error|lapor\s+masalah|ada\s+bug|ada\s+error)\s*[:,]?\s*(.+)/i);
  if (bugMatch && bugMatch[1]) {
    return {
      isFeedback: true,
      type: 'report',
      content: bugMatch[1].trim()
    };
  }

  const adviceMatch = prompt.match(/(?:kasih\s+saran|kirim\s+saran|saran\s+buat\s+creator|saran\s+buat\s+azura|masukan\s+buat\s+creator|masukan\s+buat\s+azura|advice)\s*[:,]?\s*(.+)/i);
  if (adviceMatch && adviceMatch[1]) {
    return {
      isFeedback: true,
      type: 'advice',
      content: adviceMatch[1].trim()
    };
  }

  return { isFeedback: false };
}

module.exports = {
  submitFeedback,
  handleFeedbackSlash,
  parseNaturalFeedback,
  consultAiOnFeedback,
  handleFeedbackAccept,
  showFeedbackRejectModal,
  handleFeedbackRejectModalSubmit,
  handleFeedbackDone,
  getTodoList,
  getTodoListHtml
};
