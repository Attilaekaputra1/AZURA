const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');

// Pending channel message requests: key = pendingId -> { guildId, channelId, channelName, guildName, messageText, requesterId }
const pendingChannelMsgs = new Map();

/**
 * Handle /sendch slash command — send a message to a server channel on behalf of Attila
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSendChannelCommand(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;

  // Strict Owner Permission Check
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({
      content: '🔒 **Akses Ditolak!** Fitur ini khusus untuk Owner utama (Attila).',
      flags: 64
    });
  }

  const messageText = interaction.options.getString('pesan');

  await interaction.deferReply({ flags: 64 });

  const client = interaction.client;

  // Collect all accessible text channels across all guilds AZURA is in
  const channelOptions = [];

  for (const guild of client.guilds.cache.values()) {
    const me = guild.members.cache.get(client.user.id);
    if (!me) continue;

    const textChannels = guild.channels.cache.filter(ch =>
      ch.isTextBased() &&
      !ch.isThread() &&
      !ch.isVoiceBased() &&
      ch.permissionsFor(me)?.has('SendMessages')
    );

    for (const ch of textChannels.values()) {
      if (channelOptions.length >= 25) break; // Discord select menu max 25 options
      channelOptions.push({
        label: `#${ch.name}`.slice(0, 25),
        description: guild.name.slice(0, 50),
        value: `${guild.id}::${ch.id}::${ch.name}::${guild.name}`.slice(0, 100)
      });
    }

    if (channelOptions.length >= 25) break;
  }

  if (channelOptions.length === 0) {
    return interaction.editReply({
      content: '❌ AZURA tidak menemukan channel teks yang bisa diakses di server manapun. Pastikan bot punya izin **Send Messages**.'
    });
  }

  // Generate unique pending ID
  const pendingId = `ch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  pendingChannelMsgs.set(pendingId, { messageText, requesterId: interaction.user.id });

  // Build embed preview
  const embed = new EmbedBuilder()
    .setTitle('📢 Kirim Pesan ke Channel Server')
    .setDescription('Pilih **channel tujuan** dari dropdown di bawah ini. AZURA akan meneruskan pesan kamu ke sana.')
    .setColor(0x5865F2) // Discord Blurple
    .addFields(
      { name: '✉️ Pesan Yang Akan Dikirim', value: `>>> ${messageText}` }
    )
    .setFooter({ text: 'Fitur Khusus Owner • Pilih channel tujuan' })
    .setTimestamp();

  // Build channel select menu
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`selectchannel_${pendingId}`)
    .setPlaceholder('Pilih channel tujuan pengiriman...')
    .addOptions(channelOptions);

  const row = new ActionRowBuilder().addComponents(menu);

  await interaction.editReply({
    embeds: [embed],
    components: [row]
  });
}

/**
 * Handle channel selection from the select menu (select channel -> confirm buttons)
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
async function handleSendChannelSelectMenu(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({ content: '🔒 Akses ditolak.', flags: 64 });
  }

  if (!interaction.customId.startsWith('selectchannel_')) return;

  const pendingId = interaction.customId.replace('selectchannel_', '');
  const data = pendingChannelMsgs.get(pendingId);

  if (!data) {
    return interaction.update({
      content: '⚠️ Sesi sudah kadaluarsa. Coba jalankan `/sendch` lagi.',
      embeds: [],
      components: []
    });
  }

  // Parse the selected value: "guildId::channelId::channelName::guildName"
  const [guildId, channelId, channelName, guildName] = interaction.values[0].split('::');

  // Update pending data with channel info
  pendingChannelMsgs.set(pendingId, { ...data, guildId, channelId, channelName, guildName });

  // Show confirmation embed with Send / Cancel buttons
  const confirmEmbed = new EmbedBuilder()
    .setTitle('✅ Konfirmasi Pengiriman Pesan ke Channel')
    .setColor(0x00AE89)
    .addFields(
      { name: '🏠 Server', value: guildName, inline: true },
      { name: '📢 Channel Tujuan', value: `#${channelName}`, inline: true },
      { name: '✉️ Pesan Yang Akan Dikirim', value: `>>> ${data.messageText}` }
    )
    .setFooter({ text: 'Tekan Kirim untuk mengirim, atau Batal untuk membatalkan' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmch_${pendingId}`)
      .setLabel('🟢 Kirim Sekarang')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancelch_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({
    embeds: [confirmEmbed],
    components: [row]
  });
}

/**
 * Handle Confirm / Cancel button clicks for /sendch
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleSendChannelButton(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({ content: '🔒 Akses ditolak.', flags: 64 });
  }

  const customId = interaction.customId;

  if (customId.startsWith('cancelch_')) {
    const pendingId = customId.replace('cancelch_', '');
    pendingChannelMsgs.delete(pendingId);
    return interaction.update({
      content: '❌ **Pengiriman dibatalkan.** Pesan tidak dikirim ke channel manapun.',
      embeds: [],
      components: []
    });
  }

  if (!customId.startsWith('confirmch_')) return;

  const pendingId = customId.replace('confirmch_', '');
  const data = pendingChannelMsgs.get(pendingId);

  if (!data || !data.channelId) {
    return interaction.update({
      content: '⚠️ Data pengiriman tidak ditemukan atau sudah kadaluarsa.',
      embeds: [],
      components: []
    });
  }

  pendingChannelMsgs.delete(pendingId);

  try {
    const targetChannel = await interaction.client.channels.fetch(data.channelId).catch(() => null);

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.update({
        content: `❌ Channel **#${data.channelName}** tidak ditemukan atau tidak bisa diakses.`,
        embeds: [],
        components: []
      });
    }

    // Send the message to the channel
    await targetChannel.send(data.messageText);

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Pesan Berhasil Terkirim ke Channel!')
      .setColor(0x2ECC71)
      .addFields(
        { name: '🏠 Server', value: data.guildName, inline: true },
        { name: '📢 Channel', value: `#${data.channelName}`, inline: true },
        { name: '✉️ Pesan Terkirim', value: `>>> ${data.messageText}` }
      )
      .setTimestamp();

    await interaction.update({
      content: null,
      embeds: [successEmbed],
      components: []
    });

    console.log(`[SendChannel]: Attila sent message to #${data.channelName} in ${data.guildName}`);
  } catch (err) {
    console.error('[SendChannel Error]:', err.message);
    await interaction.update({
      content: `❌ Gagal mengirim pesan ke **#${data.channelName}**. Cek izin bot di channel tersebut.`,
      embeds: [],
      components: []
    });
  }
}

module.exports = {
  handleSendChannelCommand,
  handleSendChannelSelectMenu,
  handleSendChannelButton
};
