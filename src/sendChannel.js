const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, Events } = require('discord.js');
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

  const systemPrompt = `Kamu adalah AZURA, asisten AI cewek Gen Z berumur 22 tahun yang ramah, seru, asyik, cerdas, dan setia kepada Creatormu (Attila / Putra).
Creatormu (Attila) sedang meminta tolong kepadamu untuk menyampaikan sebuah pesan, informasi, pengumuman, candaan, quotes, atau obrolan ke channel server Discord (#${channelName}).

TUGAS UTAMA:
Sampaikan dan rangkai pesan tersebut dari sudut pandangmu (AZURA) sebagai perantara/asisten yang menyampaikan pesan atau keinginan Attila ke teman-teman di channel publik (#${channelName}).
Bahasa harus sangat natural, mengalir, hidup, asyik, santai khas Gen Z / teman tongkrongan yang seru tapi tetap sopan.

ATURAN PERSPEKTIF & PANGGILAN SANGAT PENTING:
1. JIKA ATTILA MENYEBUT "AKU", "GW", "GUE", "GUA", "SAYA", MAKA JANGAN GUNAKAN KATA "AKU" UNTUK MERUJUK KE ATTILA!
   -> Gantilah rujukan kata ganti Attila menjadi sebutan yang asyik, keren, santai, atau playful dari AZURA untuk Attila, misalnya:
      - "Attila" / "Si Attila"
      - "Si Bos" / "Bos Attila"
      - "Pangeran Attila"
      - "Tuan Attila" / "Attila-nya"
      - atau sebutan variatif lainnya yang pas dengan vibe kalimatnya.
   -> Kata "Aku" / "Azura" hanya merujuk pada dirimu sendiri (AZURA) sebagai penyampai pesan.
   Contoh 1:
   Input Attila: "aku lagi males nulis ah, azura aja kirimin quotes semangat buat hari ini"
   Output AZURA: "Halo semuanya! Si Bos Attila lagi mager ngetik nih, jadi minta tolong aku buat bagiin quotes semangat hari ini buat kalian: \"[Quotes inspiratif]\" ✨ Tetap semangat yaa semuanya!"
   Contoh 2:
   Input Attila: "nanti aku join VC jam 9 malem ya buat review bareng"
   Output AZURA: "Guys, kata Attila nanti dia bakal join ke VC sekitar jam 9 malem buat review bareng yaa. Jangan lupa pada kumpul 🙌"

2. DILARANG menggunakan kata-kata robotik/kaku seperti "Perhatian semua", "Pemberitahuan resmi", dll kecuali konteksnya memang acara resmi.
3. DILARANG menggunakan panggilan mesra seperti "Say/Sayang" karena pesan ini dikirimkan ke channel publik!
4. Keluarkan HANYA teks pesan final yang siap dikirim langsung tanpa embel-embel seperti "Tentu, ini pesannya:", tanda kutip pembuka/penutup ganda untuk seluruh paragraf, atau intro penjelasan lainnya.`;

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
 * Fetch text channels for a specific guild in real-time (Strict Filtering & Priority Sorting)
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<import('discord.js').GuildTextBasedChannel[]>}
 */
async function fetchAccessibleTextChannels(guild, client) {
  try {
    const me = guild.members.cache.get(client.user.id) || await guild.members.fetch(client.user.id).catch(() => null);
    if (!me) return [];

    const fetched = await guild.channels.fetch().catch(() => guild.channels.cache);
    const textChannels = [];

    for (const ch of fetched.values()) {
      if (!ch) continue;
      // Strictly GuildText (0) or GuildAnnouncement (5)
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) continue;
      // Exclude dedicated bot configuration channel "#azura"
      if (ch.name.toLowerCase() === 'azura') continue;

      // Check bot permissions
      const perms = ch.permissionsFor(me);
      if (perms && perms.has('SendMessages') && perms.has('ViewChannel')) {
        textChannels.push(ch);
      }
    }

    // Sort channels: Priority general / development channels first, then alphabetically
    const priorityKeywords = ['general', 'utama', 'development', 'obrol', 'chat', 'member'];
    textChannels.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();

      const aPriority = priorityKeywords.findIndex(kw => aName.includes(kw));
      const bPriority = priorityKeywords.findIndex(kw => bName.includes(kw));

      if (aPriority !== -1 && bPriority === -1) return -1;
      if (aPriority === -1 && bPriority !== -1) return 1;
      if (aPriority !== -1 && bPriority !== -1 && aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return (a.rawPosition || 0) - (b.rawPosition || 0);
    });

    return textChannels;
  } catch (err) {
    console.error(`[SendChannel]: Error fetching channels for ${guild?.name}:`, err.message);
    return [];
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

  const buttonsRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmch_${pendingId}`)
      .setLabel(isAzuraMode ? '🟢 Kirim Rangkaian AZURA' : '🟢 Kirim Pesan Direct')
      .setStyle(ButtonStyle.Success)
  );

  if (isAzuraMode) {
    buttonsRow1.addComponents(
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
    buttonsRow1.addComponents(
      new ButtonBuilder()
        .setCustomId(`rephrasech_${pendingId}`)
        .setLabel('✨ Biar AZURA Yang Rangkai')
        .setStyle(ButtonStyle.Primary)
    );
  }

  buttonsRow1.addComponents(
    new ButtonBuilder()
      .setCustomId(`pickch_${pendingId}`)
      .setLabel('🔁 Ganti Channel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cancelch_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [buttonsRow1] };
}

/**
 * Build Server & Channel Picker Component
 * @param {string} pendingId 
 * @param {import('discord.js').Client} client 
 * @param {string} [specificGuildId] 
 * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }>}
 */
async function buildChannelPickerPayload(pendingId, client, specificGuildId = null) {
  const data = pendingChannelMsgs.get(pendingId);
  const guilds = Array.from(client.guilds.cache.values());

  // If specific guild is chosen or only 1 guild exists
  if (specificGuildId || guilds.length === 1) {
    const targetGuild = client.guilds.cache.get(specificGuildId || guilds[0].id);
    const channels = await fetchAccessibleTextChannels(targetGuild, client);

    if (channels.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`❌ Tidak Ada Channel Teks di ${targetGuild.name}`)
        .setDescription('AZURA tidak menemukan channel teks yang dapat dikirimi pesan di server ini.')
        .setColor(0xED4245);
      return { embeds: [embed], components: [] };
    }

    const channelOptions = channels.slice(0, 25).map(ch => ({
      label: `#${ch.name}`.slice(0, 25),
      description: `${targetGuild.name} • Posisi ${ch.rawPosition || 0}`.slice(0, 50),
      value: `${targetGuild.id}::${ch.id}::${ch.name}::${targetGuild.name}`.slice(0, 100)
    }));

    const embed = new EmbedBuilder()
      .setTitle(`📢 Pilih Channel di ${targetGuild.name}`)
      .setDescription(`Ditemukan **${channels.length} channel teks**. Silakan pilih channel tujuan pengiriman pesan dari dropdown di bawah:`)
      .setColor(0x5865F2)
      .addFields(
        { name: '✉️ Pesan Yang Akan Dikirim', value: `>>> ${data ? data.finalMessage : '...'}` }
      )
      .setFooter({ text: 'Channel #azura otomatis disembunyikan' })
      .setTimestamp();

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`selectchannel_${pendingId}`)
      .setPlaceholder(`Pilih channel di #${targetGuild.name}...`)
      .addOptions(channelOptions);

    const row = new ActionRowBuilder().addComponents(menu);

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancelch_${pendingId}`)
        .setLabel('❌ Batal')
        .setStyle(ButtonStyle.Danger)
    );

    if (guilds.length > 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`pickguild_${pendingId}`)
          .setLabel('🏛️ Pilih Server Lain')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    return { embeds: [embed], components: [row, navRow] };
  }

  // Multi-Guild: Show Server Picker First
  const guildOptions = guilds.slice(0, 25).map(g => ({
    label: g.name.slice(0, 25),
    description: `ID: ${g.id} • ${g.memberCount || 0} Member`,
    value: g.id
  }));

  const embed = new EmbedBuilder()
    .setTitle('🏛️ Pilih Server Tujuan Pengiriman (AZURA Relay)')
    .setDescription('AZURA terhubung ke beberapa server Discord. Silakan pilih server tujuan terlebih dahulu:')
    .setColor(0x5865F2)
    .addFields(
      { name: '✉️ Pesan Yang Akan Dikirim', value: `>>> ${data ? data.finalMessage : '...'}` }
    )
    .setFooter({ text: 'Pilih server untuk melihat daftar seluruh channel teksnya' })
    .setTimestamp();

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`selectguild_${pendingId}`)
    .setPlaceholder('Pilih server tujuan...')
    .addOptions(guildOptions);

  const row = new ActionRowBuilder().addComponents(menu);
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cancelch_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row, cancelRow] };
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

  await interaction.deferReply({ flags: 64 });

  const client = interaction.client;
  const pendingId = `ch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let finalMessage = rawMessage;
  if (chosenMode === 'azura') {
    finalMessage = await rephraseMessageByAzura(rawMessage, interaction.channel?.name || 'general');
  }

  // 1. If invoked inside a server text channel (default to current channel with instant preview)
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

  // 2. If invoked from DM: show real-time Server & Channel Picker
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

  const pickerPayload = await buildChannelPickerPayload(pendingId, client);
  await interaction.editReply(pickerPayload);
}

/**
 * Handle Server selection from dropdown
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 */
async function handleSendChannelGuildSelectMenu(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({ content: '🔒 Akses ditolak.', flags: 64 });
  }

  const pendingId = interaction.customId.replace('selectguild_', '');
  const selectedGuildId = interaction.values[0];

  const payload = await buildChannelPickerPayload(pendingId, interaction.client, selectedGuildId);
  await interaction.update(payload);
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

  // Re-run AI rephrase with real channel name if in azura mode
  if (data.mode === 'azura') {
    data.finalMessage = await rephraseMessageByAzura(data.rawMessage, channelName);
  }

  pendingChannelMsgs.set(pendingId, data);
  const payload = buildPreviewPayload(pendingId, data);
  await interaction.update(payload);
}

/**
 * Handle Confirm / Rephrase / Direct / PickChannel / Cancel button clicks for /sendch
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

  // Open Channel Picker again
  if (customId.startsWith('pickch_')) {
    const pendingId = customId.replace('pickch_', '');
    const pickerPayload = await buildChannelPickerPayload(pendingId, interaction.client);
    return await interaction.update(pickerPayload);
  }

  // Open Guild Picker again
  if (customId.startsWith('pickguild_')) {
    const pendingId = customId.replace('pickguild_', '');
    const pickerPayload = await buildChannelPickerPayload(pendingId, interaction.client, null);
    return await interaction.update(pickerPayload);
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
      content: '⚠️ Data pengiriman tidak ditemukan atau channel belum dipilih.',
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

/**
 * Initialize 1-Week (7 days) Silent Auto-Scan & Real-time Channel Event Listeners
 * Keeps the channel list fresh at all times without sending annoying reports.
 * @param {import('discord.js').Client} client 
 */
function initChannelAutoScanner(client) {
  // 1. Real-time Event Listeners
  client.on(Events.ChannelCreate, ch => {
    if (ch.guild) {
      console.log(`[Channel Auto-Sync]: 🔄 New channel created: #${ch.name} in ${ch.guild.name}`);
    }
  });

  client.on(Events.ChannelDelete, ch => {
    if (ch.guild) {
      console.log(`[Channel Auto-Sync]: 🗑️ Channel deleted: #${ch.name} from ${ch.guild.name}`);
    }
  });

  client.on(Events.ChannelUpdate, (oldCh, newCh) => {
    if (newCh.guild && oldCh.name !== newCh.name) {
      console.log(`[Channel Auto-Sync]: ✏️ Channel renamed: #${oldCh.name} -> #${newCh.name}`);
    }
  });

  // 2. Weekly 7-Day Silent Background Auto-Scan (7 * 24 * 60 * 60 * 1000 ms)
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      console.log('[Channel Auto-Sync]: 🔄 Running weekly background channel scan across all servers...');
      for (const guild of client.guilds.cache.values()) {
        await guild.channels.fetch().catch(() => {});
      }
      console.log('[Channel Auto-Sync]: ✅ Weekly channel scan completed silently.');
    } catch (_) {}
  }, ONE_WEEK_MS);

  console.log('[Channel Auto-Sync]: 🛡️ Real-time listeners & 7-day silent channel auto-scanner active.');
}

module.exports = {
  handleSendChannelCommand,
  handleSendChannelSelectMenu,
  handleSendChannelGuildSelectMenu,
  handleSendChannelButton,
  rephraseMessageByAzura,
  fetchAccessibleTextChannels,
  initChannelAutoScanner
};
