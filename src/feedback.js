/**
 * AZURA Advice & Report System (Confidential Feedback & Bug Reporting)
 * Allows any member/user (in server or DM) to send Advice or Bug Reports directly to the Owner (Attila).
 * Completely PRIVATE & EPHEMERAL — no public leaks or exposed messages.
 */

const { EmbedBuilder } = require('discord.js');
const config = require('./config');

/**
 * Forwards an Advice or Report submission directly to Owner's DM
 * @param {import('discord.js').Client} client 
 * @param {object} data
 * @param {string} data.userId
 * @param {string} data.userName
 * @param {string} data.userTag
 * @param {'advice'|'report'} data.type
 * @param {string} data.content
 * @param {string} [data.guildName]
 * @param {string} [data.channelName]
 * @param {string} [data.imageUrl]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function submitFeedback(client, data) {
  if (!config.OWNER_DISCORD_ID) {
    return {
      success: false,
      message: '⚠️ ID Owner belum dikonfigurasi pada bot, tidak dapat meneruskan laporan.'
    };
  }

  const isAdvice = data.type === 'advice';
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
  const dateStr = now.toLocaleDateString('id-ID', options);
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  const locationStr = data.guildName
    ? `🏛️ **Server:** ${data.guildName} (#${data.channelName || 'general'})`
    : `📩 **Direct Message (DM Pribadi)**`;

  const embed = new EmbedBuilder()
    .setColor(isAdvice ? 0xFEE75C : 0xED4245)
    .setTitle(isAdvice ? '💡 [CONFIDENTIAL] Saran & Masukan Baru Masuk (Advice)!' : '🐛 [CONFIDENTIAL] Laporan Bug / Kendala Baru Masuk (Report)!')
    .setDescription(
      `Halo Attila! Ada ${isAdvice ? 'saran/masukan rahasia' : 'laporan bug rahasia'} baru dari pengguna AZURA:\n\n` +
      `👤 **Pengirim:** **${data.userName}** (\`${data.userTag || data.userName}\`)\n` +
      `🆔 **User ID:** \`${data.userId}\`\n` +
      `📍 **Lokasi Pengiriman:** ${locationStr}\n` +
      `⏰ **Waktu:** ${dateStr} pukul ${timeStr} WIB\n\n` +
      `📝 **Isi ${isAdvice ? 'Saran/Masukan' : 'Laporan Bug'}:**\n` +
      `>>> ${data.content}`
    )
    .setFooter({ text: 'AZURA Confidential Feedback System • Diteruskan langsung ke Owner' })
    .setTimestamp();

  if (data.imageUrl) {
    embed.setImage(data.imageUrl);
  }

  try {
    const ownerUser = await client.users.fetch(config.OWNER_DISCORD_ID);
    if (!ownerUser) {
      return { success: false, message: 'Gagal menemukan akun Discord Owner.' };
    }

    await ownerUser.send({ embeds: [embed] });
    console.log(`[Feedback System]: Confidential ${data.type.toUpperCase()} from ${data.userName} (${data.userId}) forwarded to Owner DM.`);

    const replyGreeting = isAdvice
      ? `🔒 **Pesan Rahasia Terkirim!**\nMakasih banyak sarannya yaa **${data.userName}**! ✨ Masukan kamu sudah langsung aku teruskan secara privat ke DM Attila (Creator AZURA). Pesan ini bersifat rahasia dan hanya kamu yang bisa melihat balasan ini. 💡💖`
      : `🔒 **Laporan Rahasia Terkirim!**\nMakasih laporannya yaa **${data.userName}**! 🛠️ Laporan bug/kendala kamu sudah langsung aku sampaikan secara privat ke DM Attila (Creator AZURA) agar segera ditinjau dan diperbaiki. Pesan ini bersifat rahasia dan hanya kamu yang bisa melihat balasan ini. 🐛✨`;

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
 * Handle Slash Command interaction for /report or /advice
 * Strictly EPHEMERAL (flags: 64) — Only the calling user can see the message.
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

  // Always reply with flags: 64 (EPHEMERAL / ONLY USER CAN SEE)
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

  // Report Bug Trigger: "lapor bug: ...", "report bug: ...", "ada bug: ...", "lapor kendala: ..."
  const bugMatch = prompt.match(/(?:lapor\s+bug|report\s+bug|lapor\s+kendala|lapor\s+error|lapor\s+masalah|ada\s+bug|ada\s+error)\s*[:,]?\s*(.+)/i);
  if (bugMatch && bugMatch[1]) {
    return {
      isFeedback: true,
      type: 'report',
      content: bugMatch[1].trim()
    };
  }

  // Advice / Suggestion Trigger: "saran buat azura: ...", "kasih saran: ...", "masukan buat creator: ...", "advice: ..."
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
  parseNaturalFeedback
};
