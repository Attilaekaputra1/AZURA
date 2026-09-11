/**
 * AZURA Remote VC Dispatch Engine
 * 
 * Allows Attila (Owner) to remotely dispatch AZURA into any Voice Channel
 * across all servers, without Attila needing to be in a VC himself.
 * 
 * Features:
 * - /joinvc slash command with interactive multi-server VC picker dropdown
 * - DM text command: "kirim azura ke vc", "dispatch azura vc", etc.
 * - Multi-guild support (like /sendch)
 * - After join: randomized TTS greeting + standby voice companion mode (PASSIVE)
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const config = require('./config');

// Pending VC join requests: pendingId -> { guildId, channelId, channelName, guildName, requesterId }
const pendingVcJoins = new Map();

/**
 * Fetch accessible Voice Channels for a specific guild
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<import('discord.js').VoiceBasedChannel[]>}
 */
async function fetchAccessibleVoiceChannels(guild, client) {
  try {
    const me = guild.members.cache.get(client.user.id) || await guild.members.fetch(client.user.id).catch(() => null);
    if (!me) return [];

    const fetched = await guild.channels.fetch().catch(() => guild.channels.cache);
    const voiceChannels = [];

    for (const ch of fetched.values()) {
      if (!ch) continue;
      // GuildVoice (2) or GuildStageVoice (13)
      if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) continue;

      // Check bot permissions
      const perms = ch.permissionsFor(me);
      if (perms && perms.has('Connect') && perms.has('Speak') && perms.has('ViewChannel')) {
        voiceChannels.push(ch);
      }
    }

    // Sort by position
    voiceChannels.sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0));

    return voiceChannels;
  } catch (err) {
    console.error(`[Remote VC Dispatch]: Error fetching voice channels for ${guild?.name}:`, err.message);
    return [];
  }
}

/**
 * Build Voice Channel Picker Payload (dropdown)
 * @param {string} pendingId 
 * @param {import('discord.js').Client} client 
 * @param {string|null} specificGuildId 
 * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }>}
 */
async function buildVcPickerPayload(pendingId, client, specificGuildId = null) {
  const guilds = Array.from(client.guilds.cache.values());

  // If specific guild is chosen or only 1 guild exists
  if (specificGuildId || guilds.length === 1) {
    const targetGuild = client.guilds.cache.get(specificGuildId || guilds[0].id);
    if (!targetGuild) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Server Tidak Ditemukan')
        .setColor(0xED4245);
      return { embeds: [embed], components: [] };
    }

    const channels = await fetchAccessibleVoiceChannels(targetGuild, client);

    if (channels.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`❌ Tidak Ada Voice Channel di ${targetGuild.name}`)
        .setDescription('AZURA tidak menemukan Voice Channel yang dapat dimasuki di server ini.')
        .setColor(0xED4245);
      return { embeds: [embed], components: [] };
    }

    const channelOptions = channels.slice(0, 25).map(ch => {
      const memberCount = ch.members ? ch.members.filter(m => !m.user.bot).size : 0;
      const memberInfo = memberCount > 0 ? `${memberCount} orang di sini` : 'Kosong';
      return {
        label: `🔊 ${ch.name}`.slice(0, 25),
        description: `${targetGuild.name} • ${memberInfo}`.slice(0, 50),
        value: `${targetGuild.id}::${ch.id}::${ch.name}::${targetGuild.name}`.slice(0, 100)
      };
    });

    const embed = new EmbedBuilder()
      .setTitle(`🔊 Pilih Voice Channel di ${targetGuild.name}`)
      .setDescription(`Ditemukan **${channels.length} Voice Channel**. Pilih VC tujuan dari dropdown di bawah:`)
      .setColor(0x5865F2)
      .setFooter({ text: 'AZURA Remote VC Dispatch • Pilih channel untuk join' })
      .setTimestamp();

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`selectvc_${pendingId}`)
      .setPlaceholder(`Pilih Voice Channel di ${targetGuild.name}...`)
      .addOptions(channelOptions);

    const row = new ActionRowBuilder().addComponents(menu);

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancelvc_${pendingId}`)
        .setLabel('❌ Batal')
        .setStyle(ButtonStyle.Danger)
    );

    if (guilds.length > 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`pickvcguild_${pendingId}`)
          .setLabel('🏛️ Pilih Server Lain')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    return { embeds: [embed], components: [row, navRow] };
  }

  // Multi-guild: Show server picker first
  const guildOptions = guilds.slice(0, 25).map(g => ({
    label: g.name.slice(0, 25),
    description: `${g.memberCount || '?'} members`.slice(0, 50),
    value: g.id
  }));

  const embed = new EmbedBuilder()
    .setTitle('🏛️ Pilih Server Tujuan')
    .setDescription('AZURA terhubung ke beberapa server. Pilih server dulu, baru pilih Voice Channel-nya.')
    .setColor(0x5865F2)
    .setFooter({ text: 'AZURA Remote VC Dispatch' })
    .setTimestamp();

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`selectvcguild_${pendingId}`)
    .setPlaceholder('Pilih server...')
    .addOptions(guildOptions);

  const row = new ActionRowBuilder().addComponents(menu);
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cancelvc_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row, navRow] };
}

/**
 * Handle /joinvc slash command — dispatch AZURA to a Voice Channel remotely
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function handleJoinVcCommand(interaction) {
  const isOwner = config.OWNER_DISCORD_ID && interaction.user.id === config.OWNER_DISCORD_ID;
  if (!isOwner) {
    return interaction.reply({ content: '⛔ Perintah ini eksklusif hanya untuk Attila (Owner).', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const pendingId = `vcjoin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  pendingVcJoins.set(pendingId, {
    requesterId: interaction.user.id,
    guildId: null,
    channelId: null,
    channelName: null,
    guildName: null
  });

  // Auto-expire pending after 5 minutes
  setTimeout(() => pendingVcJoins.delete(pendingId), 5 * 60 * 1000);

  const payload = await buildVcPickerPayload(pendingId, interaction.client);
  return interaction.editReply(payload);
}

/**
 * Handle Guild Select Menu for VC Dispatch (multi-server)
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 */
async function handleVcGuildSelectMenu(interaction) {
  const pendingId = interaction.customId.replace('selectvcguild_', '');
  const data = pendingVcJoins.get(pendingId);
  if (!data) {
    return interaction.update({ content: '⚠️ Sesi sudah kadaluarsa. Silakan jalankan `/joinvc` lagi.', embeds: [], components: [] });
  }

  const selectedGuildId = interaction.values[0];
  data.guildId = selectedGuildId;
  pendingVcJoins.set(pendingId, data);

  const payload = await buildVcPickerPayload(pendingId, interaction.client, selectedGuildId);
  return interaction.update(payload);
}

/**
 * Handle Voice Channel Select Menu — execute the join
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 */
async function handleVcSelectMenu(interaction) {
  const pendingId = interaction.customId.replace('selectvc_', '');
  const data = pendingVcJoins.get(pendingId);
  if (!data) {
    return interaction.update({ content: '⚠️ Sesi sudah kadaluarsa. Silakan jalankan `/joinvc` lagi.', embeds: [], components: [] });
  }

  const raw = interaction.values[0];
  const parts = raw.split('::');
  if (parts.length < 4) {
    return interaction.update({ content: '❌ Data channel tidak valid.', embeds: [], components: [] });
  }

  const [guildId, channelId, channelName, guildName] = parts;

  // Clean up pending
  pendingVcJoins.delete(pendingId);

  // Show loading state
  const loadingEmbed = new EmbedBuilder()
    .setTitle('🔄 Mengirim AZURA ke Voice Channel...')
    .setDescription(`Sedang menghubungkan ke 🔊 **#${channelName}** di **${guildName}**...`)
    .setColor(0xFEE75C)
    .setTimestamp();

  await interaction.update({ embeds: [loadingEmbed], components: [] });

  // Execute the join
  const { joinSpecificVoiceChannel } = require('./voiceCompanion');
  const result = await joinSpecificVoiceChannel(interaction.client, guildId, channelId);

  const resultEmbed = new EmbedBuilder()
    .setTitle(result.success ? '✅ AZURA Berhasil Masuk VC!' : '❌ Gagal Masuk VC')
    .setDescription(result.message)
    .setColor(result.success ? 0x2ECC71 : 0xED4245)
    .setFooter({ text: 'AZURA Remote VC Dispatch' })
    .setTimestamp();

  if (result.success) {
    resultEmbed.addFields(
      { name: '🏠 Server', value: guildName, inline: true },
      { name: '🔊 Voice Channel', value: `#${channelName}`, inline: true },
      { name: '📡 Mode', value: '`PASSIVE` (wake-word required)', inline: true }
    );
  }

  await interaction.editReply({ embeds: [resultEmbed], components: [] });
  console.log(`[Remote VC Dispatch]: ${result.success ? '✅' : '❌'} Attila dispatched AZURA to #${channelName} in "${guildName}": ${result.message}`);
}

/**
 * Handle Button interactions for VC Dispatch (Cancel, Pick Guild)
 * @param {import('discord.js').ButtonInteraction} interaction 
 */
async function handleVcDispatchButton(interaction) {
  const customId = interaction.customId;

  // Cancel
  if (customId.startsWith('cancelvc_')) {
    const pendingId = customId.replace('cancelvc_', '');
    pendingVcJoins.delete(pendingId);

    const embed = new EmbedBuilder()
      .setTitle('❌ Remote VC Dispatch Dibatalkan')
      .setColor(0x95A5A6)
      .setTimestamp();

    return interaction.update({ embeds: [embed], components: [] });
  }

  // Pick another guild
  if (customId.startsWith('pickvcguild_')) {
    const pendingId = customId.replace('pickvcguild_', '');
    const data = pendingVcJoins.get(pendingId);
    if (!data) {
      return interaction.update({ content: '⚠️ Sesi sudah kadaluarsa.', embeds: [], components: [] });
    }

    const payload = await buildVcPickerPayload(pendingId, interaction.client);
    return interaction.update(payload);
  }
}

/**
 * Handle Remote VC Dispatch from DM text command
 * Triggered when Attila sends: "kirim azura ke vc", "dispatch azura vc", etc.
 * @param {import('discord.js').Message} message 
 * @param {import('discord.js').Client} client 
 */
async function handleRemoteVcFromDm(message, client) {
  const pendingId = `vcjoin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  pendingVcJoins.set(pendingId, {
    requesterId: message.author.id,
    guildId: null,
    channelId: null,
    channelName: null,
    guildName: null
  });

  // Auto-expire pending after 5 minutes
  setTimeout(() => pendingVcJoins.delete(pendingId), 5 * 60 * 1000);

  const payload = await buildVcPickerPayload(pendingId, client);
  return message.reply(payload);
}

module.exports = {
  handleJoinVcCommand,
  handleVcGuildSelectMenu,
  handleVcSelectMenu,
  handleVcDispatchButton,
  handleRemoteVcFromDm,
  fetchAccessibleVoiceChannels
};
