const { REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const config = require('./config');
const budgetGuard = require('./budget');
const { addReminder } = require('./reminder');
const { askAzura } = require('./azura');
const { generateVoiceNote } = require('./tts');
const { getUserFacts, clearUserMemory, addFact } = require('./memory');
const { getCryptoPrice, getExchangeRate } = require('./finance');
const { getTopAnime, searchAnime, getAnimeRecommendations } = require('./media');
const { handleSendDmCommand, handleListScheduledCommand } = require('./ownerDm');
const { handleSendChannelCommand } = require('./sendChannel');
const { generateAiImage, buildImageEmbed, checkImageQuota, recordImageGeneration } = require('./imageGen');

// Definition of slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Tampilkan panduan interaktif seluruh fitur & perintah AZURA'),

  new SlashCommandBuilder()
    .setName('scheduled')
    .setDescription('Lihat & kelola antrean DM yang sedang dijadwalkan (Khusus Owner)'),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Mereset riwayat percakapan kamu dengan AZURA'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Melihat status sistem dan performa AZURA'),

  new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Minta AZURA mengingatkan kamu setelah waktu tertentu')
    .addStringOption(option =>
      option.setName('waktu')
        .setDescription('Berapa lama? Contoh: 5m (5 menit), 1h (1 jam), 30s (30 detik)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('pesan')
        .setDescription('Pesan pengingat')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('vn')
    .setDescription('Minta AZURA membalas dengan Voice Note (pesan suara)')
    .addStringOption(option =>
      option.setName('teks')
        .setDescription('Teks yang ingin diucapkan AZURA')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Melihat atau mengelola memori jangka panjang AZURA tentang kamu')
    .addStringOption(option =>
      option.setName('aksi')
        .setDescription('Pilih aksi (lihat / hapus / catat)')
        .setRequired(false)
        .addChoices(
          { name: 'Lihat Fakta Tersimpan', value: 'lihat' },
          { name: 'Hapus Semua Memori', value: 'hapus' }
        ))
    .addStringOption(option =>
      option.setName('fakta')
        .setDescription('Tulis fakta baru yang ingin dicatat AZURA (Opsional)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Lakukan pencarian berita & web live dengan Tavily AI Engine')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Apa yang ingin kamu cari di internet?')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('agent')
    .setDescription('Jalankan tugas otonom, riset teknis, atau automasi dengan Hermes Agent (Khusus Owner)')
    .addStringOption(option =>
      option.setName('tugas')
        .setDescription('Instruksi atau tugas yang ingin dijalankan oleh Hermes Agent')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Cek harga kripto / kurs USD real-time (CoinGecko & ExchangeRate-API)')
    .addStringOption(option =>
      option.setName('koin')
        .setDescription('Nama koin (contoh: btc, eth, sol, bnb) atau ketik "usd" untuk kurs dollar')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Cari anime atau minta rekomendasi berdasarkan genre (MyAnimeList / Jikan API)')
    .addStringOption(option =>
      option.setName('judul')
        .setDescription('Cari anime spesifik berdasarkan judul (contoh: Naruto, One Piece)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('rekomendasi')
        .setDescription('Minta rekomendasi berdasarkan genre/tema (contoh: romance, isekai, action, comedy, fantasy)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('setowner')
    .setDescription('Daftarkan/ubah Owner utama AZURA (Khusus Owner)')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('Pilih user Discord yang ingin dijadikan Owner baru (Kosongkan untuk diri sendiri)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('senddm')
    .setDescription('Kirim Direct Message (DM) ke member server (Khusus Owner)')
    .addStringOption(option =>
      option.setName('target')
        .setDescription('Display Name / Username / Nickname / ID member yang ingin dikirimi DM')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('pesan')
        .setDescription('Isi pesan yang ingin disampaikan ke member tersebut')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('sendch')
    .setDescription('Kirim pesan ke channel server melalui AZURA (Khusus Owner)')
    .addStringOption(option =>
      option.setName('pesan')
        .setDescription('Isi pesan yang ingin dikirim ke channel server')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('image')
    .setDescription('Generate gambar AI dengan OpenAI (Portrait, Landscape, Square)')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Deskripsi gambar yang ingin dibuat (Contoh: cyber city night, anime girl)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('orientasi')
        .setDescription('Pilih format/orientasi gambar (Default: Square)')
        .setRequired(false)
        .addChoices(
          { name: '📱 Portrait (9:16 Vertikal - Wallpaper HP / Story)', value: 'portrait' },
          { name: '🖥️ Landscape (16:9 Horizontal - Wallpaper PC / Banner)', value: 'landscape' },
          { name: '⏹️ Square (1:1 Kotak - Standar)', value: 'square' }
        ))
    .addStringOption(option =>
      option.setName('kualitas')
        .setDescription('Pilih kualitas gambar (Default: Standard)')
        .setRequired(false)
        .addChoices(
          { name: '⚡ Standard (Cepat & Hemat)', value: 'standard' },
          { name: '✨ HD (High Definition - Lebih Detail)', value: 'hd' }
        ))
    .addStringOption(option =>
      option.setName('gaya')
        .setDescription('Pilih gaya visual (Default: Vivid)')
        .setRequired(false)
        .addChoices(
          { name: '🌟 Vivid (Warna Tajam & Dramatis)', value: 'vivid' },
          { name: '🌿 Natural (Realistis & Natural)', value: 'natural' }
        ))
];

const fs = require('fs');
const path = require('path');

function saveOwnerIdToEnv(ownerId) {
  const envPath = path.join(__dirname, '../.env');
  try {
    let content = fs.readFileSync(envPath, 'utf-8');
    if (content.includes('OWNER_DISCORD_ID=')) {
      content = content.replace(/OWNER_DISCORD_ID=.*/g, `OWNER_DISCORD_ID=${ownerId}`);
    } else {
      content += `\nOWNER_DISCORD_ID=${ownerId}\n`;
    }
    fs.writeFileSync(envPath, content, 'utf-8');
    config.OWNER_DISCORD_ID = ownerId;
    return true;
  } catch (err) {
    console.error('[Config Error]: Gagal menyimpan OWNER_DISCORD_ID ke .env:', err.message);
    return false;
  }
}

/**
 * Helper to parse time strings like "5m", "1h", "30s"
 * @param {string} timeStr 
 * @returns {number|null} Milliseconds or null if invalid
 */
function parseTime(timeStr) {
  const match = timeStr.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 0);
}

/**
 * Register slash commands with Discord API
 * @param {import('discord.js').Client} [client]
 */
async function registerSlashCommands(client) {
  if (!config.DISCORD_TOKEN || !config.DISCORD_CLIENT_ID) {
    console.warn('[AZURA Warning]: Discord credentials belum lengkap. Perintah slash dilewati.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const commandBody = commands.map(c => c.toJSON());

  try {
    // Register global slash commands
    await rest.put(
      Routes.applicationCommands(config.DISCORD_CLIENT_ID),
      { body: commandBody }
    );

    // Clear guild-level duplicate commands so commands don't show up twice/thrice in Discord UI
    if (client && client.guilds && client.guilds.cache.size > 0) {
      for (const guildId of client.guilds.cache.keys()) {
        await rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
          { body: [] }
        ).catch(() => {});
      }
      console.log('[AZURA]: Duplicate guild commands successfully cleaned up!');
    }

    console.log('[AZURA]: Global Slash commands berhasil terdaftar!');
  } catch (error) {
    console.error('[AZURA Error]: Gagal mendaftarkan slash commands:', error.message || error);
  }
}

/**
 * Handle incoming slash command interactions
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 * @param {number} startTime
 */
async function handleSlashCommand(interaction, startTime) {
  const { commandName, user } = interaction;

  if (commandName === 'help') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;

    const helpEmbed = new EmbedBuilder()
      .setTitle('✨ AZURA Assistant - Pusat Panduan & Fitur')
      .setDescription('Selamat datang di panduan **AZURA (v3.0)**! Pilih kategori fitur dari menu dropdown di bawah ini untuk melihat daftar perintah lengkap:')
      .setColor(0x9B59B6) // Gen Z Purple
      .setTimestamp();

    helpEmbed.addFields(
      { name: '💬 Obrolan, AI & Kreatif', value: 'Chat biasa • Vision (Foto) • Voice Note • `/image` (Portrait & Landscape)' }
    );

    if (isOwner) {
      helpEmbed.addFields({
        name: '👑 Fitur Khusus Owner (Attila)',
        value: '`/agent` • `/senddm` • `/scheduled` • `/setowner` • Standby 2-Min Assistant'
      });
    }

    helpEmbed.addFields(
      { name: '🌐 Pencarian Live & Data', value: '`/search` • `/crypto` • `/anime` • Tavily Engine' },
      { name: '⏰ Memori & Produktivitas', value: '`/memory` • `/remindme` • `/vn` • `/reset` • `/status`' }
    );

    const options = [
      { label: '💬 Obrolan & AI Engine', value: 'cat_ai', description: 'Vision, Voice Note, & Memori' }
    ];

    if (isOwner) {
      options.push({ label: '👑 Fitur Khusus Owner', value: 'cat_owner', description: '/agent, /senddm, /scheduled, & Auto-Reply' });
    }

    options.push(
      { label: '🌐 Pencarian Live & Utility', value: 'cat_search', description: 'Tavily Search, Crypto/USD, & Anime Info' },
      { label: '⏰ Produktivitas & Pengingat', value: 'cat_prod', description: 'Reminder, Memory Management, & Status' }
    );

    const menu = new StringSelectMenuBuilder()
      .setCustomId('help_category_select')
      .setPlaceholder('Pilih Kategori Fitur...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({
      embeds: [helpEmbed],
      components: [row],
      flags: 64
    });

  } else if (commandName === 'scheduled') {
    await handleListScheduledCommand(interaction);

  } else if (commandName === 'reset') {
    budgetGuard.resetContext(user.id);
    await interaction.reply({
      content: '🧹 **Memori percakapan sesi ini sudah dibersihkan!** Mari mulai obrolan baru.',
      flags: 64
    });

  } else if (commandName === 'status') {
    const latency = Date.now() - startTime;
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    const uptimeStr = `${hours}j ${mins}m ${secs}s`;

    const statusMessage = `
⚡ **AZURA Status System**

• **Status Bot**: 🟢 Online & Siap
• **AI Engine**: \`OpenAI (${config.OPENAI_MODEL})\` & \`Hermes Agent (VPS)\`
• **Latency**: \`${latency} ms\`
• **Uptime**: \`${uptimeStr}\`
• **Target Budget**: \`$${config.MONTHLY_BUDGET_TARGET} / bulan\`
• **Max Context Limit**: \`${config.MAX_CONTEXT_MESSAGES} pesan\`
• **Features**: Vision 📸 | VoiceNote 🎙️ | Whisper STT 🎧 | Tavily AI Search 🌐 | Hermes Agent ⚡ | Img2Img 🎨 | Autonomous Catalyst 🔥 | Long-Term Memory 🧠 | Crypto & Kurs 🪙 | Anime Engine 🎬 | DM Scheduler ⏰ | Daily Digest 📊
    `.trim();

    await interaction.reply({
      content: statusMessage,
      flags: 64
    });

  } else if (commandName === 'remindme') {
    const waktuStr = interaction.options.getString('waktu');
    const pesan = interaction.options.getString('pesan');

    const delayMs = parseTime(waktuStr);
    if (!delayMs) {
      return interaction.reply({
        content: 'Format waktu salah! Gunakan contoh: `5m` (5 menit), `1h` (1 jam), atau `30s` (30 detik).',
        flags: 64
      });
    }

    addReminder(user.id, interaction.channelId, pesan, delayMs);
    await interaction.reply({
      content: `⏰ **Sip, dicatat!** AZURA bakal ingetin kamu tentang **"${pesan}"** dalam waktu \`${waktuStr}\`.`,
      flags: 64
    });

  } else if (commandName === 'vn') {
    const teks = interaction.options.getString('teks');
    await interaction.deferReply();

    try {
      const audioBuffer = await generateVoiceNote(teks);
      await interaction.editReply({
        content: `🎙️ **Voice Note dari AZURA:**`,
        files: [{
          attachment: audioBuffer,
          name: 'azura_voice.mp3'
        }]
      });
    } catch (error) {
      console.error('[VN Error]:', error);
      await interaction.editReply('gagal bikin voice note. coba lagi nanti ya!');
    }

  } else if (commandName === 'memory') {
    const aksi = interaction.options.getString('aksi');
    const faktaBaru = interaction.options.getString('fakta');

    if (faktaBaru) {
      const added = addFact(user.id, faktaBaru);
      if (added) {
        return interaction.reply({
          content: `🧠 **Sip, fakta baru dicatat!** AZURA bakal selalu ingat bahwa: "${faktaBaru}"`,
          flags: 64
        });
      } else {
        return interaction.reply({
          content: 'Fakta ini sudah tersimpan atau tidak valid.',
          flags: 64
        });
      }
    }

    if (aksi === 'hapus') {
      clearUserMemory(user.id);
      return interaction.reply({
        content: '🗑️ **Semua memori jangka panjang tentang kamu sudah dihapus!**',
        flags: 64
      });
    }

    const facts = getUserFacts(user.id);
    if (facts.length === 0) {
      await interaction.reply({
        content: '🧠 **AZURA belum memiliki catatan fakta khusus tentang kamu.**\n\nKamu bisa ketik "ingat ya..." di chat atau gunakan `/memory fakta:...` untuk mencatat!',
        flags: 64
      });
    } else {
      const factsList = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
      await interaction.reply({
        content: `🧠 **Fakta Jangka Panjang yang Diingat AZURA Tentang Kamu:**\n\n${factsList}`,
        flags: 64
      });
    }

  } else if (commandName === 'search') {
    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      const { searchTavilyCard } = require('./tavily');
      const cardResult = await searchTavilyCard(query, 'news', user.username);
      if (typeof cardResult === 'object' && cardResult.embeds) {
        await interaction.editReply(cardResult);
      } else {
        await interaction.editReply(cardResult);
      }
    } catch (error) {
      await interaction.editReply('gagal melakukan pencarian web. coba lagi nanti ya!');
    }

  } else if (commandName === 'agent') {
    const task = interaction.options.getString('tugas');
    await interaction.deferReply();

    try {
      const { executeHermesTask } = require('./hermes');
      const result = await executeHermesTask(task, user.id, user.username);
      await interaction.editReply(result.payload);
    } catch (error) {
      await interaction.editReply('gagal menjalankan tugas agent. coba lagi nanti ya!');
    }

  } else if (commandName === 'crypto') {
    const coin = interaction.options.getString('koin');
    await interaction.deferReply();

    try {
      let result;
      if (coin.toLowerCase() === 'usd' || coin.toLowerCase() === 'kurs') {
        result = await getExchangeRate();
      } else {
        result = await getCryptoPrice(coin);
      }
      await interaction.editReply(result);
    } catch (error) {
      await interaction.editReply('gagal mengambil data harga/kurs. coba lagi nanti ya!');
    }

  } else if (commandName === 'anime') {
    // Immediately defer reply to satisfy Discord's 3-second response window
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply().catch(() => {});
    }

    const judul = interaction.options.getString('judul');
    const rekomendasi = interaction.options.getString('rekomendasi');

    try {
      let result;
      if (rekomendasi) {
        result = await getAnimeRecommendations(rekomendasi);
      } else if (judul) {
        result = await searchAnime(judul);
      } else {
        result = await getAnimeRecommendations('trending');
      }

      await interaction.editReply(result).catch(async () => {
        await interaction.followUp({ content: result }).catch(() => {});
      });
    } catch (error) {
      console.error('[Anime Command Error]:', error.message || error);
      const errMsg = 'gagal mengambil data rekomendasi anime. coba lagi nanti ya!';
      await interaction.editReply(errMsg).catch(() => {});
    }

  } else if (commandName === 'setowner') {
    // Lock check: If owner is already configured and caller is not the owner, reject!
    if (config.OWNER_DISCORD_ID && config.OWNER_DISCORD_ID !== user.id) {
      return interaction.reply({
        content: `🔒 **Akses Ditolak!** Perintah \`/setowner\` terkunci khusus untuk Owner utama (<@${config.OWNER_DISCORD_ID}>). Pengguna lain tidak diizinkan mengubah status Owner.`,
        flags: 64
      });
    }

    const targetUser = interaction.options.getUser('target') || user;
    const success = saveOwnerIdToEnv(targetUser.id);
    if (success) {
      await interaction.reply({
        content: `👑 **Sukses Mengubah Owner Utama!**\n\n• **Owner Baru**: <@${targetUser.id}> (${targetUser.tag})\n• **User ID**: \`${targetUser.id}\`\n\nSekarang panggilan **"Say"** dan fitur **Auto-Reply 2 Menit (Standby Assistant)** resmi diaktifkan khusus untuk <@${targetUser.id}>! 👌`,
        flags: 64
      });
    } else {
      await interaction.reply({
        content: 'Gagal menyimpan ID kamu ke konfigurasi sistem. Coba lagi nanti ya!',
        flags: 64
      });
    }

  } else if (commandName === 'senddm') {
    await handleSendDmCommand(interaction);

  } else if (commandName === 'sendch') {
    await handleSendChannelCommand(interaction);

  } else if (commandName === 'image') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    const quota = checkImageQuota(interaction.guildId, user.id, isOwner);

    if (!quota.allowed) {
      return interaction.reply({
        content: quota.reason,
        flags: 64
      });
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply().catch(() => {});
    }

    const promptText = interaction.options.getString('prompt');
    const orientasi = interaction.options.getString('orientasi') || 'square';
    const kualitas = interaction.options.getString('kualitas') || 'standard';
    const gaya = interaction.options.getString('gaya') || 'vivid';
    const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

    try {
      const result = await generateAiImage(promptText, orientasi, kualitas, gaya);
      const quotaInfo = recordImageGeneration(interaction.guildId, user.id, isOwner);
      const payload = buildImageEmbed(promptText, userName, result, quotaInfo);
      await interaction.editReply(payload);
    } catch (error) {
      console.error('[Image Command Error]:', error.message || error);
      await interaction.editReply({
        content: `❌ Gagal menghasilkan gambar AI: ${error.message || 'Terjadi kendala teknis'}`
      }).catch(() => {});
    }
  }
}

/**
 * Handle help category select menu selection
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 */
async function handleHelpSelectMenu(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'help_category_select') return;

  const isOwner = config.OWNER_DISCORD_ID && interaction.user.id === config.OWNER_DISCORD_ID;
  const value = interaction.values[0];
  let embed = new EmbedBuilder().setColor(0x9B59B6);

  if (value === 'cat_ai') {
    embed
      .setTitle('💬 Fitur Obrolan, AI & Image Generation')
      .setDescription('AZURA dilengkapi dengan kemampuan AI generatif canggih:')
      .addFields(
        { name: '🎨 /image prompt:<...> [orientasi]', value: 'Generate gambar AI resolusi tinggi dalam format **Portrait (9:16)**, **Landscape (16:9)**, atau **Square (1:1)** dengan OpenAI Engine.' },
        { name: '📸 Multimodal Vision', value: 'Kirimkan gambar/foto di chat/DM, AZURA akan menganalisis dan menanggapi isi gambar tersebut.' },
        { name: '🎙️ Voice Message STT (Whisper)', value: 'Kirimkan pesan suara/voice note di Discord, AZURA akan mendengarkan & membalas pesan kamu!' }
      );
  } else if (value === 'cat_owner') {
    if (!isOwner) {
      return interaction.reply({ content: '🔒 Akses ditolak. Kategori ini khusus untuk Owner utama.', flags: 64 });
    }
    embed
      .setTitle('👑 Fitur Khusus Owner (Attila)')
      .setDescription('Fitur kontrol eksklusif yang hanya bisa diakses oleh Owner utama:')
      .addFields(
        { name: '📩 /senddm', value: 'Kirim DM ke member server berdasarkan nama/username dengan 3 opsi: Kirim Sekarang, Jadwalkan untuk Nanti, Batal.' },
        { name: '⏰ /scheduled', value: 'Lihat daftar antrean DM yang sedang dijadwalkan & hapus/batalkan antrean kapan saja.' },
        { name: '👑 /setowner', value: 'Daftarkan atau alihkan status Owner utama AZURA.' },
        { name: '⏳ Standby Assistant 2-Menit', value: 'Jika Attila di-tag di server dan tidak membalas dalam 2 menit, AZURA otomatis membalas atau me-forward pesan ke DM Attila.' }
      );
  } else if (value === 'cat_search') {
    embed
      .setTitle('🌐 Fitur Pencarian Live & Utility')
      .setDescription('Akses data real-time dari internet & media:')
      .addFields(
        { name: '🔍 /search <query>', value: 'Cari berita, cuaca, atau info terkini dari internet menggunakan Tavily AI Engine.' },
        { name: '🪙 /crypto <koin/usd>', value: 'Cek harga kripto (BTC, ETH, SOL) atau kurs USD ke IDR real-time.' },
        { name: '🎬 /anime <judul/rekomendasi>', value: 'Cari detail anime atau rekomendasi anime terpopuler di MyAnimeList.' }
      );
  } else if (value === 'cat_prod') {
    embed
      .setTitle('⏰ Produktivitas & Pengingat')
      .setDescription('Kelola pengingat dan memori pribadi kamu:')
      .addFields(
        { name: '⏰ /remindme waktu:<5m/1h> pesan:<...>', value: 'Minta AZURA mengingatkan kamu setelah durasi waktu tertentu.' },
        { name: '🧠 /memory', value: 'Lihat atau kelola fakta jangka panjang tentang kamu yang disimpan AZURA.' },
        { name: '🎙️ /vn teks:<...>', value: 'Minta AZURA merespon dalam bentuk Voice Note (suara).' },
        { name: '⚡ /status', value: 'Cek status bot, latency, uptime, dan AI engine.' },
        { name: '🔄 /reset', value: 'Mereset riwayat percakapan dengan AZURA.' }
      );
  }

  await interaction.update({
    embeds: [embed]
  });
}

module.exports = {
  registerSlashCommands,
  handleSlashCommand,
  handleHelpSelectMenu
};
