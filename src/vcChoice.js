const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getMemberDailyVcQuota, consumeMemberDailyVcQuota } = require('./voiceQuota');
const { speakTextInVC, activeConnections, recordSessionEntry } = require('./voiceCompanion');
const config = require('./config');

// In-memory cache for pending VC response choices
// requestId -> { userId, userName, guildId, channelId, prompt, response, createdAt, isOwner }
const vcChoiceCache = new Map();

// Auto-cleanup expired choice requests (> 2 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of vcChoiceCache) {
    if (now - item.createdAt > 120000) {
      vcChoiceCache.delete(id);
    }
  }
}, 30000);

/**
 * Send interactive Choice Buttons for VC Text Chat messages (Chat vs VC Voice)
 * @param {import('discord.js').Message} message 
 * @param {string} response 
 * @param {string} userName 
 * @param {boolean} isOwner 
 */
async function sendVcResponseChoice(message, response, userName, isOwner) {
  const requestId = `vc_opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const guildId = message.guild?.id;

  if (guildId) {
    recordSessionEntry(guildId, userName, message.content, 'text');
  }

  vcChoiceCache.set(requestId, {
    userId: message.author.id,
    userName,
    guildId,
    channelId: message.channel.id,
    prompt: message.content,
    response,
    createdAt: Date.now(),
    isOwner
  });

  const quota = getMemberDailyVcQuota(message.author.id);
  const quotaText = isOwner ? '👑 Akses Khusus Owner' : `Sisa kuota suara hari ini: ${quota.remaining}/3`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vc_opt_voice:${requestId}`)
      .setLabel('🎙️ Balas Suara di VC')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vc_opt_text:${requestId}`)
      .setLabel('💬 Balas Teks di Chat')
      .setStyle(ButtonStyle.Secondary)
  );

  const promptSnippet = message.content.length > 60 ? message.content.slice(0, 60) + '...' : message.content;

  const promptMsg = await message.reply({
    content: `✨ **Halo <@${message.author.id}>, mau AZURA respon lewat apa?**\n📝 *"${promptSnippet}"*\n📊 *(${quotaText})*`,
    components: [row]
  });

  // Auto-expire to text response after 45 seconds if no button clicked
  setTimeout(async () => {
    if (vcChoiceCache.has(requestId)) {
      vcChoiceCache.delete(requestId);
      try {
        await promptMsg.edit({
          content: `💬 **[Respon Teks Chat AZURA untuk @${userName}]**\n\n${response}`,
          components: []
        });
      } catch (_) {}
    }
  }, 45000);
}

/**
 * Handle Button Interaction for VC Response Choice
 * @param {import('discord.js').ButtonInteraction} interaction 
 */
async function handleVcChoiceButton(interaction) {
  const [action, requestId] = interaction.customId.split(':');
  const data = vcChoiceCache.get(requestId);

  if (!data) {
    return interaction.reply({
      content: '⏳ Sesi pilihan ini sudah kadaluarsa atau sudah dijawab.',
      flags: 64
    });
  }

  // Only the original author or Attila can click
  if (interaction.user.id !== data.userId && interaction.user.id !== config.OWNER_DISCORD_ID) {
    return interaction.reply({
      content: '🔒 Tombol ini khusus untuk yang mengajukan pertanyaan yaa!',
      flags: 64
    });
  }

  // Remove from cache once chosen
  vcChoiceCache.delete(requestId);

  const isOwner = interaction.user.id === config.OWNER_DISCORD_ID;

  if (action === 'vc_opt_text') {
    // Member or Owner chose Chat/Text response
    console.log(`[VC Choice]: ${data.userName} chose Text Chat response.`);
    if (data.guildId) {
      recordSessionEntry(data.guildId, 'AZURA', data.response, 'text');
    }
    return interaction.update({
      content: `💬 **[Respon Teks Chat AZURA untuk @${data.userName}]**\n\n${data.response}`,
      components: []
    });
  }

  if (action === 'vc_opt_voice') {
    // Member or Owner chose Voice in VC
    const activeConn = data.guildId ? activeConnections.get(data.guildId) : null;
    const vcChannelId = activeConn?.joinConfig?.channelId;
    const vcChannel = interaction.client.channels.cache.get(vcChannelId);
    const isAttilaInVC = vcChannel?.members?.has(config.OWNER_DISCORD_ID);

    if (!isOwner && !isAttilaInVC) {
      return interaction.update({
        content: `Halo **${data.userName}**! Aku cuma bisa bersuara di Voice Channel kalau ada Attila di VC yaa! ✨\n\n💬 **[Respon Teks]:**\n${data.response}`,
        components: []
      });
    }

    const quota = getMemberDailyVcQuota(data.userId);
    if (!isOwner && !quota.allowed) {
      return interaction.update({
        content: `Hai **${data.userName}**! Kuota balas suara di VC kamu untuk hari ini (3/3) sudah habis yaa. Aku balas lewat chat di sini yaa! ✨\n\n💬 **[Respon Teks]:**\n${data.response}`,
        components: []
      });
    }

    if (!isOwner) {
      consumeMemberDailyVcQuota(data.userId);
    }

    const remainingAfter = isOwner ? '👑 Unlimited (Mode Uji Coba Owner)' : `${Math.max(0, quota.remaining - 1)}/3`;
    console.log(`[VC Choice]: ${data.userName} chose Voice in VC. (Quota remaining: ${remainingAfter})`);

    await interaction.update({
      content: `🎙️ **[AZURA Membalas @${data.userName} via Suara di Voice Channel]** *(Sisa kuota: ${remainingAfter})*\n\n${data.response}`,
      components: []
    });

    // Speak in VC
    await speakTextInVC(data.guildId, data.response, interaction.client, data.userName);
  }
}

module.exports = {
  sendVcResponseChoice,
  handleVcChoiceButton
};
