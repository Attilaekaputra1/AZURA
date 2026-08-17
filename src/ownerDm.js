const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SCHEDULED_DMS_FILE = path.join(__dirname, '..', 'data', 'scheduled_dms.json');
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(SCHEDULED_DMS_FILE)) {
  fs.writeFileSync(SCHEDULED_DMS_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Store pending DM requests in memory: key = pendingId -> { targetUser, targetMember, guildName, messageText, requesterId }
const pendingDms = new Map();

/**
 * Load scheduled DMs from disk
 * @returns {Array<{ id: string, targetUserId: string, targetUsername: string, displayName: string, guildName: string, messageText: string, requesterId: string, targetTime: number, createdAt: string }>}
 */
function loadScheduledDms() {
  try {
    const raw = fs.readFileSync(SCHEDULED_DMS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('[OwnerDM Error]: Failed to read scheduled_dms.json:', err.message);
    return [];
  }
}

/**
 * Save scheduled DMs to disk
 * @param {Array<any>} list 
 */
function saveScheduledDms(list) {
  try {
    fs.writeFileSync(SCHEDULED_DMS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[OwnerDM Error]: Failed to write scheduled_dms.json:', err.message);
  }
}

/**
 * Search members across all connected Discord guilds by query (displayName / username / id)
 * @param {import('discord.js').Client} client 
 * @param {string} query 
 * @returns {Promise<Array<{ member: import('discord.js').GuildMember, guild: import('discord.js').Guild }>>}
 */
async function searchServerMembers(client, query) {
  const cleanQuery = query.toLowerCase().replace(/^@/, '').trim();
  const results = [];
  const seenUserIds = new Set();

  for (const guild of client.guilds.cache.values()) {
    try {
      const members = await guild.members.fetch({ query: cleanQuery, limit: 10 }).catch(() => null) || guild.members.cache;
      for (const member of members.values()) {
        if (member.user.bot) continue;
        if (seenUserIds.has(member.user.id)) continue;

        const displayName = (member.displayName || '').toLowerCase();
        const username = (member.user.username || '').toLowerCase();
        const globalName = (member.user.globalName || '').toLowerCase();
        const userId = member.user.id;

        if (
          userId === cleanQuery ||
          displayName.includes(cleanQuery) ||
          username.includes(cleanQuery) ||
          globalName.includes(cleanQuery)
        ) {
          seenUserIds.add(member.user.id);
          results.push({ member, guild });
        }
      }
    } catch (err) {
      console.error(`[OwnerDM Search Error] Guild ${guild.name}:`, err.message);
    }
  }

  return results;
}

/**
 * Handle /senddm slash command execution
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function handleSendDmCommand(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;

  // Strict Owner Permission Check
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({
      content: '🔒 **Akses Ditolak!** Fitur perintah DM ini khusus dan hanya bisa digunakan oleh Owner utama (Attila).',
      flags: 64
    });
  }

  const targetQuery = interaction.options.getString('target');
  const messageText = interaction.options.getString('pesan');

  await interaction.deferReply({ flags: 64 });

  const matches = await searchServerMembers(interaction.client, targetQuery);

  if (matches.length === 0) {
    return interaction.editReply({
      content: `❌ **Member Tidak Ditemukan!** Tidak ada member dengan display name/username/ID \`${targetQuery}\` di server tempat AZURA berada.`
    });
  }

  const selected = matches[0];
  const { member: targetMember, guild } = selected;
  const targetUser = targetMember.user;

  // Generate unique pending ID
  const pendingId = `dm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Store in pending map
  pendingDms.set(pendingId, {
    targetUser,
    targetMember,
    guildName: guild.name,
    messageText,
    requesterId: interaction.user.id
  });

  // Build Profile Preview Embed
  const avatarUrl = targetUser.displayAvatarURL({ dynamic: true, size: 256 });
  const joinedDate = targetMember.joinedAt ? targetMember.joinedAt.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Tidak diketahui';
  const createdDate = targetUser.createdAt ? targetUser.createdAt.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Tidak diketahui';

  const previewEmbed = new EmbedBuilder()
    .setTitle('📋 Konfirmasi Pengiriman DM Ke Member')
    .setDescription('Berikut adalah profil pengguna yang ditemukan di server. **Pilih salah satu dari 3 opsi di bawah ini:**')
    .setThumbnail(avatarUrl)
    .setColor(0x00AE89) // Emerald Green
    .addFields(
      { name: '👤 Display Name', value: `**${targetMember.displayName}**`, inline: true },
      { name: '🏷️ Username', value: `@${targetUser.username}`, inline: true },
      { name: '🆔 User ID', value: `\`${targetUser.id}\``, inline: true },
      { name: '🏠 Server', value: guild.name, inline: true },
      { name: '📅 Bergabung Server', value: joinedDate, inline: true },
      { name: '🎂 Akun Dibuat', value: createdDate, inline: true },
      { name: '✉️ Pesan Yang Akan Dikirim', value: `>>> ${messageText}` }
    )
    .setFooter({ text: 'Fitur Khusus Owner • Pilih opsi pengiriman di bawah' })
    .setTimestamp();

  // If multiple candidates found, show alert in description
  if (matches.length > 1) {
    const alternatives = matches.slice(1, 4).map(m => `• **${m.member.displayName}** (@${m.member.user.username})`).join('\n');
    previewEmbed.addFields({
      name: '⚠️ Kandidat Lain yang Mirip',
      value: alternatives
    });
  }

  // Build 3 Action Buttons (1. Kirim DM Sekarang | 2. Jadwalkan untuk Nanti | 3. Batal)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_senddm_${pendingId}`)
      .setLabel('🟢 Kirim DM Sekarang')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`schedule_senddm_${pendingId}`)
      .setLabel('⏰ Jadwalkan untuk Nanti')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cancel_senddm_${pendingId}`)
      .setLabel('❌ Batal')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({
    embeds: [previewEmbed],
    components: [row]
  });
}

/**
 * Handle button clicks for /senddm confirmation (Confirm / Schedule / Cancel)
 * @param {import('discord.js').ButtonInteraction} interaction 
 */
async function handleSendDmButton(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;

  // Strict Owner Permission Check
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({
      content: '🔒 Akses ditolak. Tombol ini khusus untuk Owner utama.',
      flags: 64
    });
  }

  const customId = interaction.customId;

  // Handle cancel scheduled DM button from /scheduled command list
  if (customId.startsWith('cancelsched_')) {
    const itemId = customId.replace('cancelsched_', '');
    let list = loadScheduledDms();
    const targetItem = list.find(item => item.id === itemId);
    if (!targetItem) {
      return interaction.update({ content: '⚠️ Antrean DM ini sudah tidak ditemukan atau sudah terkirim.', embeds: [], components: [] });
    }
    list = list.filter(item => item.id !== itemId);
    saveScheduledDms(list);
    return interaction.update({
      content: `✅ **Jadwal DM Dibatalkan!** Antrean DM ke **${targetItem.displayName}** (@${targetItem.targetUsername}) telah dihapus dari sistem.`,
      embeds: [],
      components: []
    });
  }

  const isConfirm = customId.startsWith('confirm_senddm_');
  const isSchedule = customId.startsWith('schedule_senddm_');
  const isCancel = customId.startsWith('cancel_senddm_');

  if (!isConfirm && !isSchedule && !isCancel) return;

  const pendingId = customId.replace('confirm_senddm_', '').replace('schedule_senddm_', '').replace('cancel_senddm_', '');
  const data = pendingDms.get(pendingId);

  if (!data) {
    return interaction.update({
      content: '⚠️ Permintaan konfirmasi ini sudah kadaluarsa atau tidak ditemukan.',
      embeds: [],
      components: []
    });
  }

  // Opsi 3: Batal
  if (isCancel) {
    pendingDms.delete(pendingId);
    return interaction.update({
      content: `❌ **Pengiriman DM Dibatalkan.** Pesan tidak dikirimkan ke @${data.targetUser.username}.`,
      embeds: [],
      components: []
    });
  }

  // Opsi 2: Jadwalkan untuk Nanti (Show Time Select Menu)
  if (isSchedule) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`selecttime_senddm_${pendingId}`)
      .setPlaceholder('Pilih waktu penjadwalan DM...')
      .addOptions([
        { label: '10 Menit Lagi', value: '10m', description: 'Kirim DM otomatis 10 menit dari sekarang' },
        { label: '30 Menit Lagi', value: '30m', description: 'Kirim DM otomatis 30 menit dari sekarang' },
        { label: '1 Jam Lagi', value: '1h', description: 'Kirim DM otomatis 1 jam dari sekarang' },
        { label: '3 Jam Lagi', value: '3h', description: 'Kirim DM otomatis 3 jam dari sekarang' },
        { label: '6 Jam Lagi', value: '6h', description: 'Kirim DM otomatis 6 jam dari sekarang' },
        { label: '12 Jam Lagi', value: '12h', description: 'Kirim DM otomatis 12 jam dari sekarang' },
        { label: '24 Jam Lagi (Besok)', value: '24h', description: 'Kirim DM otomatis 24 jam dari sekarang' }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.update({
      content: `⏰ **Pilih Penjadwalan DM untuk ${data.targetMember.displayName} (@${data.targetUser.username}):**`,
      embeds: [],
      components: [row]
    });
  }

  // Opsi 1: Kirim DM Sekarang
  pendingDms.delete(pendingId);

  try {
    const displayName = data.targetMember.displayName || data.targetUser.username;
    const guildName = data.guildName || 'Server';

    const formattedContent = `Halo **${displayName}** (@${data.targetUser.username}), kamu dapat kiriman pesan dari Attila nih dari server **${guildName}**. Berikut pesannya buat kamu:\n\n>>> ${data.messageText}`;
    await data.targetUser.send(formattedContent);

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ DM Berhasil Terkirim!')
      .setThumbnail(data.targetUser.displayAvatarURL({ dynamic: true }))
      .setColor(0x2ECC71) // Green
      .addFields(
        { name: '👤 Penerima', value: `**${data.targetMember.displayName}** (@${data.targetUser.username})`, inline: true },
        { name: '🏠 Server', value: data.guildName, inline: true },
        { name: '✉️ Pesan Terkirim', value: `>>> ${data.messageText}` }
      )
      .setTimestamp();

    await interaction.update({
      content: null,
      embeds: [successEmbed],
      components: []
    });

    console.log(`[OwnerDM Success]: Sent DM immediately to ${data.targetUser.tag} requested by Attila.`);
  } catch (err) {
    console.error(`[OwnerDM Send Failure]:`, err.message);

    await interaction.update({
      content: `❌ **Gagal Mengirim DM!** Pengguna @${data.targetUser.username} mungkin mematikan DM dari member server (Direct Messages Disabled).`,
      embeds: [],
      components: []
    });
  }
}

/**
 * Handle schedule select menu selection for DM
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 */
async function handleSendDmSelectMenu(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({ content: '🔒 Akses ditolak.', flags: 64 });
  }

  if (!interaction.customId.startsWith('selecttime_senddm_')) return;

  const pendingId = interaction.customId.replace('selecttime_senddm_', '');
  const data = pendingDms.get(pendingId);

  if (!data) {
    return interaction.update({
      content: '⚠️ Permintaan penjadwalan ini sudah kadaluarsa.',
      components: []
    });
  }

  pendingDms.delete(pendingId);

  const selectedValue = interaction.values[0]; // e.g. "10m", "1h", "24h"
  const multipliers = { '10m': 600000, '30m': 1800000, '1h': 3600000, '3h': 10800000, '6h': 21600000, '12h': 43200000, '24h': 86400000 };
  const delayMs = multipliers[selectedValue] || 3600000;
  const targetTime = Date.now() + delayMs;

  const readableLabels = {
    '10m': '10 Menit',
    '30m': '30 Menit',
    '1h': '1 Jam',
    '3h': '3 Jam',
    '6h': '6 Jam',
    '12h': '12 Jam',
    '24h': '24 Jam (Besok)'
  };

  const timeLabel = readableLabels[selectedValue] || selectedValue;

  // Save to persistent scheduled list
  const list = loadScheduledDms();
  list.push({
    id: pendingId,
    targetUserId: data.targetUser.id,
    targetUsername: data.targetUser.username,
    displayName: data.targetMember.displayName,
    guildName: data.guildName,
    messageText: data.messageText,
    requesterId: interaction.user.id,
    targetTime: targetTime,
    createdAt: new Date().toISOString()
  });
  saveScheduledDms(list);

  const scheduledEmbed = new EmbedBuilder()
    .setTitle('⏰ DM Berhasil Dijadwalkan!')
    .setThumbnail(data.targetUser.displayAvatarURL({ dynamic: true }))
    .setColor(0x3498DB) // Blue
    .addFields(
      { name: '👤 Penerima', value: `**${data.targetMember.displayName}** (@${data.targetUser.username})`, inline: true },
      { name: '⏳ Dikirim Dalam', value: `**${timeLabel}**`, inline: true },
      { name: '🏠 Server', value: data.guildName, inline: true },
      { name: '✉️ Pesan Yang Dijadwalkan', value: `>>> ${data.messageText}` }
    )
    .setFooter({ text: 'AZURA akan otomatis mengirimkan DM ini sesuai jadwal & memberi tahu kamu di DM!' })
    .setTimestamp();

  await interaction.update({
    content: null,
    embeds: [scheduledEmbed],
    components: []
  });

  console.log(`[OwnerDM Scheduled]: Scheduled DM for ${data.targetUser.username} in ${timeLabel}.`);
}

/**
 * Handle /scheduled slash command (Lists all pending scheduled DMs for Owner)
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function handleListScheduledCommand(interaction) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({
      content: '🔒 **Akses Ditolak!** Perintah ini khusus untuk Owner utama (Attila).',
      flags: 64
    });
  }

  const list = loadScheduledDms();

  if (list.length === 0) {
    return interaction.reply({
      content: '📂 **Tidak Ada Antrean DM Terjadwal.** Saat ini belum ada DM yang dijadwalkan.',
      flags: 64
    });
  }

  const now = Date.now();
  const embed = new EmbedBuilder()
    .setTitle('⏰ Daftar Antrean DM Terjadwal')
    .setDescription(`Berikut adalah **${list.length} DM** yang saat ini mengantre untuk dikirimkan secara otomatis:`)
    .setColor(0x3498DB)
    .setTimestamp();

  const components = [];

  list.forEach((item, index) => {
    const diffSec = Math.max(0, Math.round((item.targetTime - now) / 1000));
    const mins = Math.floor(diffSec / 60);
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    const timeRemainingStr = hours > 0 ? `${hours} jam ${remMins} menit` : `${mins} menit`;

    embed.addFields({
      name: `#${index + 1}. To: ${item.displayName} (@${item.targetUsername})`,
      value: `• **Server**: ${item.guildName}\n• **Sisa Waktu**: \`${timeRemainingStr}\` lagi\n• **Pesan**: "${item.messageText}"`
    });

    // Create cancel button for each scheduled item (up to 5 components per row max)
    if (components.length < 5) {
      components.push(
        new ButtonBuilder()
          .setCustomId(`cancelsched_${item.id}`)
          .setLabel(`Hapus #${index + 1} (@${item.targetUsername})`)
          .setStyle(ButtonStyle.Danger)
      );
    }
  });

  const row = components.length > 0 ? new ActionRowBuilder().addComponents(components) : null;

  await interaction.reply({
    embeds: [embed],
    components: row ? [row] : [],
    flags: 64
  });
}

/**
 * Background loop: Check and dispatch due scheduled DMs (Runs every 15s)
 * @param {import('discord.js').Client} client 
 */
async function checkScheduledDms(client) {
  const list = loadScheduledDms();
  if (list.length === 0) return;

  const now = Date.now();
  const dueItems = list.filter(item => item.targetTime <= now);

  if (dueItems.length === 0) return;

  const remainingItems = list.filter(item => item.targetTime > now);
  saveScheduledDms(remainingItems);

  for (const item of dueItems) {
    try {
      const targetUser = await client.users.fetch(item.targetUserId).catch(() => null);
      if (targetUser) {
        const formattedContent = `Halo **${item.displayName}** (@${item.targetUsername}), kamu dapat kiriman pesan dari Attila nih dari server **${item.guildName}**. Berikut pesannya buat kamu:\n\n>>> ${item.messageText}`;
        await targetUser.send(formattedContent);
        console.log(`[OwnerDM Dispatch Success]: Delivered scheduled DM to ${item.targetUsername}`);

        // Notify Attila in DM
        const ownerId = config.OWNER_DISCORD_ID;
        if (ownerId) {
          const ownerUser = await client.users.fetch(ownerId).catch(() => null);
          if (ownerUser) {
            await ownerUser.send(`⏰ **[JADWAL TERKIRIM]** DM ke **${item.displayName}** (@${item.targetUsername}) yang kamu jadwalkan telah **berhasil terkirim**!\n\n✉️ **Pesan**: "${item.messageText}"`);
          }
        }
      }
    } catch (err) {
      console.error(`[OwnerDM Dispatch Error] User ${item.targetUsername}:`, err.message);
    }
  }
}

module.exports = {
  searchServerMembers,
  handleSendDmCommand,
  handleSendDmButton,
  handleSendDmSelectMenu,
  handleListScheduledCommand,
  checkScheduledDms
};
