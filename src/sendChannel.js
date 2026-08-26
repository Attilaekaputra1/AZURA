const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');

// Pending channel message requests: key = pendingId -> { rawMessage, finalMessage, mode, guildId, channelId, channelName, guildName, requesterId }
const pendingChannelMsgs = new Map();

/**
 * AI Rephrasing Engine for AZURA
 * Rephrases Attila's points into AZURA's natural, friendly, lively Gen Z peer tone while maintaining 100% intent.
 * @param {string} rawPrompt 
 * @param {string} channelName 
 * @returns {Promise<string>}
 */
async function rephraseMessageByAzura(rawPrompt, channelName = 'general') {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const systemPrompt = `Kamu adalah AZURA, asisten AI cewek Gen Z berumur 22 tahun yang ramah, seru, asyik, dan cerdas.
Creator-mu (Attila / Putra) sedang meminta tolong kepadamu untuk menyampaikan sebuah pesan, informasi, atau obrolan ke channel Discord (#${channelName}).

TUGAS UTAMA:
Rangkai kata-kata penyampaian pesan tersebut agar terdengar sangat natural, mengalir, hidup, hangat, dan menyenangkan khas AZURA (bahasa santai ala Gen Z / teman tongkrongan yang asyik tapi tetap sopan & berwibawa).
Pastikan SELURUH maksud, pesan inti, informasi, atau instruksi dari Attila tersampaikan dengan jelas, akurat, dan tidak ada yang terdistorsi.

ATURAN PENTING:
1. DILARANG menggunakan kata-kata robotik/kaku seperti "Perhatian semua", "Pemberitahuan resmi", dll kecuali diminta secara khusus.
2. DILARANG menggunakan panggilan mesra seperti "Say/Sayang" karena ini dikirimkan ke channel publik!
3. Keluarkan HANYA teks pesan final yang siap dikirim langsung tanpa embel-embel seperti "Tentu, ini pesannya:", tanda kutip ganda pembuka/penutup, atau intro lainnya.`;

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Pesan/Poin dari Attila yang ingin disampaikan:\n"${rawPrompt}"` }
      ],
      max_completion_tokens: 600
    });

    return res.choices[0]?.message?.content?.trim() || rawPrompt;
  } catch (err) {
    console.error('[SendChannel AI Rephrase Error]:', err.message);
    return rawPrompt;
  }
}

/**
 * Helper to build interactive confirmation payload
 * @param {string} pendingId 
 * @param {object} data 
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildPreviewPayload(pendingId, data) {
  const isAzuraMode = data.mode === 'azura';

  const embed = new EmbedBuilder()
    .setTitle('📢 Pengiriman Pesan ke Channel Server (AZURA Relay)')
    .setColor(isAzuraMode ? 0x9B59B6 : 0x00AE89)
    .addFields(
      { name: '🏠 Server', value: data.guildName || 'Belum dipilih', inline: true },
      { name: '📢 Channel Tujuan', value: data.channelName ? `#${data.channelName}` : 'Belum dipilih', inline: true },
      { name: '⚙️ Mode Penyampaian', value: isAzuraMode ? '`✨ Dirangkai AZURA (Natural & Ramah)`' : '`✍️ Direct (Pesan Asli Attila)`', inline: true }
    )
    .setTimestamp();

  if (isAzuraMode) {
    embed.addFields(
      { name: '📝 Poin/Konteks Asli dari Attila', value: `>>> ${data.rawMessage}` },
      { name: '✨ Hasil Rangkaian Kata AZURA (Siap Dikirim)', value: `>>> ${data.finalMessage}` }
    );
    embed.setFooter({ text: 'AZURA AI Message Relay • Periksa pesan sebelum dikirim' });
  } else {
    embed.addFields(
      { name: '✉️ Pesan Yang Akan Dikirim (Direct)', value: `>>> ${data.finalMessage}` }
    );
    embed.setFooter({ text: 'Direct Message Relay • Pesan akan dikirim persis seperti ini' });
  }

  const buttons = [];

  // Send button
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`confirmch_${pendingId}`)
      .setLabel(isAzuraMode ? '🟢 Kirim Rangkaian AZURA' : '🟢 Kirim Pesan Direct')
      .setStyle(ButtonStyle.Success)
  );

  // Mode Switch / Regenerate buttons
  if (isAzuraMode) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`regenrephrasech_${pendingId}`)
        .setLabel('🔄 Rangkai Ulang (AI)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`directch_${pendingId}`)
        .setLabel('✍️ Ganti ke Direct (Asli)')
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rephrasech_${pendingId}`)
        .setLabel('✨ Biar AZURA Yang Rangkai')
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Cancel button
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`cancelch_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  const row = new ActionRowBuilder().addComponents(buttons);
  return { embeds: [embed], components: [row] };
}

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

  const rawMessage = interaction.options.getString('pesan');
  const chosenMode = interaction.options.getString('mode') || 'direct';
  const targetChannelOpt = interaction.options.getChannel('channel');

  await interaction.deferReply({ flags: 64 });

  const client = interaction.client;
  const pendingId = `ch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let finalMessage = rawMessage;
  if (chosenMode === 'azura') {
    finalMessage = await rephraseMessageByAzura(rawMessage, targetChannelOpt?.name || 'general');
  }

  // If a specific channel is passed directly in the command
  if (targetChannelOpt && targetChannelOpt.isTextBased()) {
    const data = {
      rawMessage,
      finalMessage,
      mode: chosenMode,
      guildId: targetChannelOpt.guild?.id || null,
      channelId: targetChannelOpt.id,
      channelName: targetChannelOpt.name,
      guildName: targetChannelOpt.guild?.name || 'Server',
      requesterId: interaction.user.id
    };
    pendingChannelMsgs.set(pendingId, data);

    const payload = buildPreviewPayload(pendingId, data);
    return await interaction.editReply(payload);
  }

  // If invoked inside a guild text channel without specifying a channel option, default to current channel or offer picker
  if (interaction.guild && interaction.channel && interaction.channel.isTextBased()) {
    const data = {
      rawMessage,
      finalMessage,
      mode: chosenMode,
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      channelName: interaction.channel.name,
      guildName: interaction.guild.name,
      requesterId: interaction.user.id
    };
    pendingChannelMsgs.set(pendingId, data);

    const payload = buildPreviewPayload(pendingId, data);
    return await interaction.editReply(payload);
  }

  // If invoked from DM or without specific channel: provide interactive channel selector dropdown
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
      if (channelOptions.length >= 25) break;
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
      content: '❌ AZURA tidak menemukan channel teks yang bisa diakses di server manapun. Pastikan bot memiliki izin **Send Messages**.'
    });
  }

  const data = {
    rawMessage,
    finalMessage,
    mode: chosenMode,
    guildId: null,
    channelId: null,
    channelName: null,
    guildName: null,
    requesterId: interaction.user.id
  };
  pendingChannelMsgs.set(pendingId, data);

  const embed = new EmbedBuilder()
    .setTitle('📢 Pilih Channel Server Tujuan (AZURA Relay)')
    .setDescription('Pilih channel server tujuan dari dropdown di bawah ini. AZURA akan menyampaikan pesan kamu ke sana.')
    .setColor(0x5865F2)
    .addFields(
      { name: '✉️ Pesan Yang Akan Dikirim', value: `>>> ${finalMessage}` },
      { name: '⚙️ Mode Penyampaian', value: chosenMode === 'azura' ? '`✨ Dirangkai AZURA`' : '`✍️ Direct (Pesan Asli)`' }
    )
    .setFooter({ text: 'Fitur Khusus Owner • Global dari DM / Server' })
    .setTimestamp();

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
 * Handle channel selection from dropdown
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
      content: '⚠️ Sesi sudah kadaluarsa. Silakan jalankan `/sendch` lagi.',
      embeds: [],
      components: []
    });
  }

  const [guildId, channelId, channelName, guildName] = interaction.values[0].split('::');
  data.guildId = guildId;
  data.channelId = channelId;
  data.channelName = channelName;
  data.guildName = guildName;

  // If in azura mode and finalMessage was generated with generic channel name, re-run with actual channel name
  if (data.mode === 'azura') {
    data.finalMessage = await rephraseMessageByAzura(data.rawMessage, channelName);
  }

  pendingChannelMsgs.set(pendingId, data);
  const payload = buildPreviewPayload(pendingId, data);
  await interaction.update(payload);
}

/**
 * Handle Confirm / Rephrase / Direct / Cancel button clicks for /sendch
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleSendChannelButton(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({ content: '🔒 Akses ditolak.', flags: 64 });
  }

  const customId = interaction.customId;

  // Cancel
  if (customId.startsWith('cancelch_')) {
    const pendingId = customId.replace('cancelch_', '');
    pendingChannelMsgs.delete(pendingId);
    return interaction.update({
      content: '❌ **Pengiriman dibatalkan.** Pesan tidak dikirim ke channel manapun.',
      embeds: [],
      components: []
    });
  }

  // Switch to Rephrase / AZURA Mode
  if (customId.startsWith('rephrasech_')) {
    const pendingId = customId.replace('rephrasech_', '');
    const data = pendingChannelMsgs.get(pendingId);
    if (!data) return interaction.update({ content: '⚠️ Sesi kadaluarsa.', embeds: [], components: [] });

    await interaction.deferUpdate();
    data.mode = 'azura';
    data.finalMessage = await rephraseMessageByAzura(data.rawMessage, data.channelName || 'general');
    pendingChannelMsgs.set(pendingId, data);

    const payload = buildPreviewPayload(pendingId, data);
    return await interaction.editReply(payload);
  }

  // Regenerate AI Rephrase
  if (customId.startsWith('regenrephrasech_')) {
    const pendingId = customId.replace('regenrephrasech_', '');
    const data = pendingChannelMsgs.get(pendingId);
    if (!data) return interaction.update({ content: '⚠️ Sesi kadaluarsa.', embeds: [], components: [] });

    await interaction.deferUpdate();
    data.finalMessage = await rephraseMessageByAzura(data.rawMessage, data.channelName || 'general');
    pendingChannelMsgs.set(pendingId, data);

    const payload = buildPreviewPayload(pendingId, data);
    return await interaction.editReply(payload);
  }

  // Switch to Direct Mode
  if (customId.startsWith('directch_')) {
    const pendingId = customId.replace('directch_', '');
    const data = pendingChannelMsgs.get(pendingId);
    if (!data) return interaction.update({ content: '⚠️ Sesi kadaluarsa.', embeds: [], components: [] });

    data.mode = 'direct';
    data.finalMessage = data.rawMessage;
    pendingChannelMsgs.set(pendingId, data);

    const payload = buildPreviewPayload(pendingId, data);
    return await interaction.update(payload);
  }

  // Confirm and Send
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

    // Send the message to the target channel
    await targetChannel.send(data.finalMessage);

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Pesan Berhasil Terkirim ke Channel!')
      .setColor(0x2ECC71)
      .addFields(
        { name: '🏠 Server', value: data.guildName, inline: true },
        { name: '📢 Channel', value: `#${data.channelName}`, inline: true },
        { name: '⚙️ Mode', value: data.mode === 'azura' ? '`✨ Dirangkai AZURA`' : '`✍️ Direct`', inline: true },
        { name: '✉️ Pesan Yang Terkirim', value: `>>> ${data.finalMessage}` }
      )
      .setFooter({ text: 'AZURA Relay Transmission Success' })
      .setTimestamp();

    await interaction.update({
      content: null,
      embeds: [successEmbed],
      components: []
    });

    console.log(`[SendChannel]: Attila transmitted message to #${data.channelName} (${data.guildName}) [Mode: ${data.mode}]`);
  } catch (err) {
    console.error('[SendChannel Error]:', err.message);
    await interaction.update({
      content: `❌ Gagal mengirim pesan ke **#${data.channelName}**: ${err.message}`,
      embeds: [],
      components: []
    });
  }
}

module.exports = {
  handleSendChannelCommand,
  handleSendChannelSelectMenu,
  handleSendChannelButton,
  rephraseMessageByAzura
};
