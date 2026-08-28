const { REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const os = require('os');
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
const { verifyMasterPassword, createAuthSession, isAuthSessionActive, isSacredData } = require('./security');

/**
 * Check if the user has an active 15-min security session or provided a valid Master Password.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 * @param {string|null} [passwordInput] 
 * @returns {{ authorized: boolean, justUnlocked?: boolean, embed?: EmbedBuilder }}
 */
function checkMasterAuth(interaction, passwordInput = null) {
  const userId = interaction.user.id;
  if (isAuthSessionActive(userId)) {
    return { authorized: true };
  }
  if (passwordInput && verifyMasterPassword(passwordInput)) {
    createAuthSession(userId);
    return { authorized: true, justUnlocked: true };
  }

  return {
    authorized: false,
    embed: new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🔒 [AUTENTIKASI KEAMANAN TINGKAT TINGGI]')
      .setDescription(
        `Halo **${interaction.user.username}**!\n\n` +
        `Fitur ini mengelola **data sensitif/krusial** dan dilindungi oleh sistem enkripsi & autentikasi berlapis.\n\n` +
        `🔑 **Cara Membuka Akses (Sesi Aman 15 Menit):**\n` +
        `Sertakan parameter \`password:<Master Password>\` saat menjalankan perintah.\n\n` +
        `*💡 Setelah berhasil terverifikasi, kamu akan mendapatkan **Sesi Aman 15 Menit** sehingga tidak perlu memasukkan password lagi selama sesi aktif.*`
      )
      .setFooter({ text: 'AZURA Multi-Layer Security • AES-256-GCM' })
      .setTimestamp()
  };
}

// Definition of slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Tampilkan panduan interaktif seluruh fitur & perintah AZURA'),

  new SlashCommandBuilder()
    .setName('scheduled')
    .setDescription('Lihat & kelola antrean DM yang sedang dijadwalkan (Khusus Owner - Hanya di DM)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('password').setDescription('Master Security Password (Opsional jika sesi 15m aktif)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Mereset riwayat percakapan kamu dengan AZURA (Hanya di DM Pribadi)'),

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
    .setDescription('Melihat, mengaudit relevansi, atau mengelola memori jangka panjang AZURA')
    .addStringOption(option =>
      option.setName('aksi')
        .setDescription('Pilih aksi memori')
        .setRequired(false)
        .addChoices(
          { name: '📋 Lihat Fakta & Arsip Ringkasan', value: 'lihat' },
          { name: '🧠 Audit AI & Rekomendasi Pembersihan', value: 'audit' },
          { name: '🗑️ Hapus Semua Memori', value: 'hapus' }
        ))
    .addStringOption(option =>
      option.setName('fakta')
        .setDescription('Tulis fakta baru yang ingin dicatat AZURA (Opsional)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID ringkasan yang ingin dihapus spesifik (Contoh: sum_1787729179639)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('password')
        .setDescription('Master Security Password (untuk aksi audit/hapus jika sesi 15m belum aktif)')
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('Pilih user Discord yang ingin dijadikan Owner baru (Kosongkan untuk diri sendiri)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('senddm')
    .setDescription('Kirim Direct Message (DM) ke member server (Khusus Owner)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    .setDescription('Kirim pesan ke channel server melalui AZURA (Khusus Owner - Global / DM / Server)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('pesan')
        .setDescription('Isi pesan atau poin/instruksi yang ingin disampaikan ke channel')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Pilih mode penyampaian pesan (Direct atau Rangkaian Kata AZURA)')
        .setRequired(false)
        .addChoices(
          { name: '✍️ Direct (Pesan asli persis dari Attila)', value: 'direct' },
          { name: '✨ Dirangkai AZURA (AZURA rangkai kata-kata ramah & natural)', value: 'azura' }
        )),

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
        )),

  new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Luncurkan sesi YouTube Watch Together atau Game sinkron di Voice Channel (Hanya di Server)')
    .addStringOption(option =>
      option.setName('jenis')
        .setDescription('Pilih jenis aktivitas')
        .setRequired(true)
        .addChoices(
          { name: '📺 YouTube Watch Together (Nonton Bareng)', value: 'youtube' },
          { name: '♟️ Chess in the Park (Catur)', value: 'chess' },
          { name: '🎨 Sketch Heads (Tebak Gambar ala Gartic)', value: 'sketch' },
          { name: '🃏 Poker Night', value: 'poker' },
          { name: '🔤 Letter League (Scrabble)', value: 'letterleague' }
        )),

  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Kirim Saran (Advice) atau Laporan Bug (Report) langsung ke Creator AZURA')
    .addStringOption(option =>
      option.setName('kategori')
        .setDescription('Pilih kategori (Saran / Laporan Bug)')
        .setRequired(true)
        .addChoices(
          { name: '💡 Advice (Saran & Masukan Pengembangan)', value: 'advice' },
          { name: '🐛 Report (Laporan Bug & Kendala Teknis)', value: 'report' }
        ))
    .addStringOption(option =>
      option.setName('pesan')
        .setDescription('Isi saran atau deskripsi kendala yang ingin kamu laporkan')
        .setRequired(true))
    .addAttachmentOption(option =>
      option.setName('lampiran')
        .setDescription('Tangkapan layar / screenshot kendala (Opsional)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('vault')
    .setDescription('Kelola & lihat Database Pengguna Terenkripsi AES-256-GCM (Khusus Owner)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('Lihat statistik & rekap pengguna aktif di database terenkripsi')
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password (opsional jika sesi aktif)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Lihat daftar lengkap seluruh pengguna terdaftar beserta UID dan status kunci nama')
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password (opsional jika sesi aktif)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('setname')
        .setDescription('Tetapkan atau ubah nama panggilan pengguna secara resmi & terkunci')
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('User ID, @User, atau username pengguna')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('nama')
            .setDescription('Nama panggilan/nama asli resmi yang ingin ditetapkan')
            .setRequired(true))
        .addBooleanOption(opt =>
          opt.setName('kunci')
            .setDescription('Kunci nama agar tidak bisa diubah oleh pengguna (Default: True)')
            .setRequired(false))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('unlock')
        .setDescription('Buka kunci nama panggilan pengguna agar bisa mendaftar ulang')
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('User ID atau username pengguna')
            .setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Hentikan & blokir seluruh akses respons pengguna (Blacklist Total)')
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('User ID, @User, atau username pengguna yang ingin diblokir')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('alasan')
            .setDescription('Alasan pemblokiran (misal: Pemalsuan nama, spam, abuse)')
            .setRequired(false))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Buka kembali blokir akses pengguna (Hapus dari Blacklist)')
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('User ID atau username pengguna yang ingin dibuka blokirnya')
            .setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('blacklist')
        .setDescription('Lihat daftar seluruh pengguna yang sedang diblokir / diblacklist')
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('Dekripsi dan lihat data profil lengkap pengguna tertentu')
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('User ID atau username pengguna yang ingin dilihat')
            .setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('export')
        .setDescription('Ekspor seluruh database pengguna terenkripsi ke DM Owner')
        .addStringOption(opt =>
          opt.setName('format')
            .setDescription('Pilih format dokumen (JSON / CSV)')
            .setRequired(false)
            .addChoices(
              { name: '📄 JSON Format', value: 'json' },
              { name: '📊 CSV Spreadsheet Format', value: 'csv' }
            ))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false))),

  new SlashCommandBuilder()
    .setName('roadmap')
    .setDescription('📋 Papan Roadmap & Tiket Pengembangan Saran/Bug AZURA (Owner Only)')
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Lihat daftar antrean tugas pengembangan, saran, dan perbaikan bug')
        .addStringOption(opt =>
          opt.setName('status')
            .setDescription('Filter status tugas')
            .setRequired(false)
            .addChoices(
              { name: '📌 In Progress (To-Do)', value: 'ACCEPTED' },
              { name: '⏳ Pending Review', value: 'PENDING' },
              { name: '🎉 Selesai (Completed)', value: 'DONE' },
              { name: '❌ Ditolak (Rejected)', value: 'REJECTED' },
              { name: '🌐 Semua Status', value: 'ALL' }
            ))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('done')
        .setDescription('Tandai tugas selesai dieksekusi & otomatis kirim notifikasi kabar gembira ke user')
        .addStringOption(opt =>
          opt.setName('ticket')
            .setDescription('Ticket ID tugas (misal: ADV-7B3 atau REP-9A1)')
            .setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('discuss')
        .setDescription('Minta analisis strategis & pertimbangan kritis AI untuk sebuah saran/bug')
        .addStringOption(opt =>
          opt.setName('ticket')
            .setDescription('Ticket ID tugas (misal: ADV-7B3 atau REP-9A1)')
            .setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false))),

  new SlashCommandBuilder()
    .setName('personality')
    .setDescription('Ubah mode kepribadian AZURA (Khusus Owner Attila)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Pilih mode kepribadian AZURA')
        .setRequired(true)
        .addChoices(
          { name: '✨ Original Soul (Cerdas, Ramah, Gen Z 22th)', value: 'original' },
          { name: '👑 Wanita Dewasa & Independen (Elegan, Berwibawa)', value: 'mature' },
          { name: '😼 Keras Kepala & Jual Mahal (Fun Mode)', value: 'stubborn' }
        )),

  new SlashCommandBuilder()
    .setName('behavior')
    .setDescription('Kelola atau hapus data rekaman sifat & behavior publik kamu dari memori AZURA')
    .addStringOption(option =>
      option.setName('aksi')
        .setDescription('Pilih aksi kelola behavior')
        .setRequired(true)
        .addChoices(
          { name: '🔍 Lihat Rekaman Sifat Saya', value: 'lihat_saya' },
          { name: '🗑️ Hapus Rekaman Sifat Saya (Lupakan Sifat Publik)', value: 'hapus_saya' },
          { name: '📊 [Admin] Lihat Semua Behavior & Kapasitas Slot (Maks 20)', value: 'list' },
          { name: '❌ [Admin] Hapus Behavior Pengguna Tertentu', value: 'hapus' }
        ))
    .addStringOption(option =>
      option.setName('target')
        .setDescription('User ID / @User target (Khusus Admin untuk aksi hapus)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('todo')
    .setDescription('Kelola agenda dan to-do list tugas kamu via Web Dashboard AZURA')
    .addStringOption(option =>
      option.setName('aksi')
        .setDescription('Pilih aksi to-do list')
        .setRequired(true)
        .addChoices(
          { name: '🌐 Buka Web Dashboard To-Do List', value: 'web' },
          { name: '📋 Rekap Agenda Tugas & Progres', value: 'rekap' },
          { name: '➕ Tambah Tugas Baru', value: 'tambah' },
          { name: '✅ Tandai Tugas Selesai', value: 'selesai' },
          { name: '🗑️ Hapus Tugas', value: 'hapus' }
        ))
    .addStringOption(option =>
      option.setName('judul')
        .setDescription('Judul tugas (untuk aksi tambah)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID Tugas (contoh: TASK-101) untuk aksi selesai/hapus')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('kategori')
        .setDescription('Kategori tugas (Dev, Work, Urgent, Personal, General)')
        .setRequired(false)
        .addChoices(
          { name: '💻 Dev / Coding', value: 'Dev' },
          { name: '💼 Work / Proyek', value: 'Work' },
          { name: '🚨 Urgent / Mendesak', value: 'Urgent' },
          { name: '🧘 Personal', value: 'Personal' },
          { name: '📝 General / Umum', value: 'General' }
        )),

  new SlashCommandBuilder()
    .setName('friend')
    .setDescription('Kelola whitelist akses eksklusif & kuota teman (Khusus Attila / Owner)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Beri akses eksklusif beta testing voice & kirim DM sambutan estetik')
        .addStringOption(opt => opt.setName('target').setDescription('Discord User ID teman (contoh: 1086593461454655588)').setRequired(true))
        .addStringOption(opt => opt.setName('nama').setDescription('Nama panggilan akrab (opsional)').setRequired(false))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Cabut izin akses teman')
        .addStringOption(opt => opt.setName('target').setDescription('Discord User ID teman').setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Lihat daftar seluruh teman yang di-ACC & sisa kuota hari ini')
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Reset kuota suara harian teman menjadi 0/120s secara manual')
        .addStringOption(opt => opt.setName('target').setDescription('Discord User ID teman').setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Master Security Password').setRequired(false)))
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
    // 1. Register global slash commands
    await rest.put(
      Routes.applicationCommands(config.DISCORD_CLIENT_ID),
      { body: commandBody }
    );
    console.log(`[AZURA]: Global Slash commands (${commandBody.length} perintah) berhasil terdaftar!`);

    // 2. Clean up legacy guild-specific commands to prevent duplicate command UI in servers
    if (client && client.guilds && client.guilds.cache.size > 0) {
      for (const guildId of client.guilds.cache.keys()) {
        await rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
          { body: [] }
        ).catch(() => {});
      }
    }
  } catch (error) {
    console.error('[AZURA Error]: Gagal mendaftarkan slash commands:', error.message || error);
    if (error.rawError) {
      console.error('[AZURA Error Details]:', JSON.stringify(error.rawError, null, 2));
    }
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
    const helpEmbed = new EmbedBuilder()
      .setTitle('✨ AZURA Assistant - Pusat Panduan & Fitur')
      .setDescription('Selamat datang di panduan **AZURA (v3.0)**! Pilih kategori fitur dari menu dropdown di bawah ini untuk melihat daftar perintah lengkap:')
      .setColor(0x9B59B6) // Gen Z Purple
      .setTimestamp();

    helpEmbed.addFields(
      { name: '💬 Obrolan, AI & Image', value: 'Chat santai cerdas • Multimodal Vision 📸 • Voice Note 🎙️ • `/image` (Portrait/Landscape/Square)' },
      { name: '🎮 Aktivitas VC & Musik', value: '`/activity` (YouTube Watch Together 📺, Catur ♟️, Letter League 🔤) • Direct Music Streaming 🎵' },
      { name: '💡 Advice & Lapor Bug', value: '`/report` (Kirim saran & masukan atau lapor kendala teknis secara rahasia ke Creator 🔒)' },
      { name: '🌐 Pencarian Live & Utility', value: '`/search` (Tavily AI Engine) • `/crypto` (Harga koin/USD) • `/anime` (Info Anime)' },
      { name: '⏰ Produktivitas & Memori', value: '`/remindme` • `/memory` • `/vn` • `/status` • `/reset`' }
    );

    const options = [
      { label: '💬 Obrolan & AI Engine', value: 'cat_ai', description: 'Vision, Whisper Voice Note, & /image' },
      { label: '🎮 Aktivitas VC & Musik', value: 'cat_activity', description: 'YouTube Nobar, Catur, Game VC & Music Streaming' },
      { label: '💡 Advice & Lapor Bug', value: 'cat_feedback', description: '/report (Saran & Bug Report Rahasia ke Creator)' },
      { label: '🌐 Pencarian Live & Utility', value: 'cat_search', description: 'Tavily Search, Crypto/USD, & Anime Info' },
      { label: '⏰ Produktivitas & Pengingat', value: 'cat_prod', description: 'Reminder, Memory Management, Status, & Reset' }
    ];

    const menu = new StringSelectMenuBuilder()
      .setCustomId('help_category_select')
      .setPlaceholder('Pilih Kategori Fitur Lengkap...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({
      embeds: [helpEmbed],
      components: [row],
      flags: 64
    });

  } else if (commandName === 'scheduled') {
    if (interaction.guild) {
      return interaction.reply({
        content: '⚠️ Perintah `/scheduled` hanya dapat digunakan di **Direct Message (DM Pribadi)**.',
        flags: 64
      });
    }
    await handleListScheduledCommand(interaction);

  } else if (commandName === 'reset') {
    if (interaction.guild) {
      return interaction.reply({
        content: '⚠️ Perintah `/reset` hanya dapat digunakan di **Direct Message (DM Pribadi)** untuk membersihkan riwayat obrolan privat kamu.',
        flags: 64
      });
    }
    budgetGuard.resetContext(`user_${user.id}`);
    budgetGuard.resetContext(user.id);
    await interaction.reply({
      content: '🧹 **Memori percakapan sesi DM kamu sudah dibersihkan!** Mari mulai obrolan baru.',
      flags: 64
    });

  } else if (commandName === 'status') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    await interaction.deferReply({ flags: 64 });

    const wsPing = Math.round(interaction.client.ws.ping);
    const roundTripLatency = Date.now() - interaction.createdTimestamp;

    // Real-time Uptime calculation
    const uptimeSec = Math.floor(process.uptime());
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    const uptimeStr = `${days > 0 ? days + ' hari ' : ''}${hours} jam ${mins} menit ${secs} detik`;

    // Real-time Memory Usage
    const memUsage = process.memoryUsage();
    const nodeRamMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
    const nodeRssMB = (memUsage.rss / 1024 / 1024).toFixed(1);
    const totalSysMemGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeSysMemGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedSysMemGB = (totalSysMemGB - freeSysMemGB).toFixed(2);
    const sysMemPercent = ((1 - (os.freemem() / os.totalmem())) * 100).toFixed(1);

    // Direct Live API Integration with ElevenLabs
    const { fetchLiveElevenLabsQuota } = require('./voiceQuota');
    const liveVoice = await fetchLiveElevenLabsQuota();

    // Real-time Encrypted User Vault
    let vaultStats = { totalUsers: 0, totalMessages: 0 };
    try {
      const { getVaultStats } = require('./vault');
      vaultStats = getVaultStats();
    } catch (_) {}

    const totalGuilds = interaction.client.guilds.cache.size;
    const totalChannels = interaction.client.channels.cache.size;

    const now = new Date();
    const timeFormatted = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
    const dateFormatted = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' });

    const statusEmbed = new EmbedBuilder()
      .setColor(0x00FFB2) // Cyber Neon Cyan Green
      .setTitle('⚡ Status Sistem & Telemetri AZURA (Real-Time)')
      .setDescription(`Status kesehatan, performa, dan telemetri sistem diperiksa secara **langsung (*live*)** pada **${dateFormatted}** pukul **${timeFormatted} WIB**.`)
      .addFields(
        {
          name: '🏓 Latensi Jaringan (Real-Time)',
          value: `• **Discord Gateway WS**: \`${wsPing >= 0 ? wsPing : 15} ms\`\n• **API Round-Trip**: \`${roundTripLatency} ms\``,
          inline: true
        },
        {
          name: '⏱️ Uptime Bot',
          value: `• **Durasi Aktif**: \`${uptimeStr}\`\n• **Node.js**: \`${process.version}\` (\`Online 🟢\`)`,
          inline: true
        },
        {
          name: '🖥️ Penggunaan Memori (Host VPS & Process)',
          value: `• **Bot Process RAM**: \`${nodeRamMB} MB\` (Heap) / \`${nodeRssMB} MB\` (RSS)\n• **Host VPS RAM**: \`${usedSysMemGB} GB / ${totalSysMemGB} GB\` (\`${sysMemPercent}%\` terpakai)\n• **OS Platform**: \`${os.platform()} (${os.arch()})\``,
          inline: false
        },
        {
          name: '🧠 AI & Voice Engine',
          value: isOwner
            ? `• **Brain Core LLM**: \`${config.OPENAI_MODEL}\` (OpenAI)\n• **Vision & Image Engine**: \`${config.IMAGE_MODEL}\`\n• **ElevenLabs v3 (Live API)**: \`${liveVoice.character_count.toLocaleString('id-ID')} / ${liveVoice.character_limit.toLocaleString('id-ID')} chars\` (\`${liveVoice.percent}%\` terpakai)\n• **Tier / Status**: \`${liveVoice.tier.toUpperCase()}\` (\`${liveVoice.status}\`)\n• **Reset Kuota Berikutnya**: \`${liveVoice.next_reset}\``
            : `• **Brain Core LLM**: \`${config.OPENAI_MODEL}\`\n• **Vision & Image**: \`${config.IMAGE_MODEL}\`\n• **Voice Companion**: \`ElevenLabs v3 (Kak Ceria)\` (\`Active 🟢\`)`,
          inline: false
        }
      );

    if (isOwner) {
      let dailyDigestText = '';
      try {
        const { getOrCreateTodayStats } = require('./digest');
        const todayMetrics = getOrCreateTodayStats();
        dailyDigestText = `\n• **Aktivitas Hari Ini (Daily Digest)**: \`${todayMetrics.serverMessages || 0} pesan server\`, \`${todayMetrics.serverMentions || 0} mention bot\`, \`${todayMetrics.ownerMentions || 0} mention owner\` (\`${todayMetrics.ownerForwards || 0} di-forward\`), \`${todayMetrics.dmMessages || 0} DM\``;
      } catch (_) {}

      statusEmbed.addFields({
        name: '🔒 Database & Jaringan Discord (Khusus Owner)',
        value: `• **Zero-Knowledge Vault**: \`${vaultStats.totalUsers} pengguna terdaftar\` (\`${vaultStats.totalMessages} interaksi terenkripsi\`)\n• **Status Enkripsi**: \`AES-256-GCM (Authenticated)\`\n• **Koneksi Discord**: \`${totalGuilds} Server\` • \`${totalChannels} Channel\`${dailyDigestText}`,
        inline: false
      });
    } else {
      statusEmbed.addFields({
        name: '🌐 Jaringan Discord',
        value: `• **Status Server**: Terhubung ke \`${totalGuilds} Server\` • \`${totalChannels} Channel\``,
        inline: false
      });
    }

    statusEmbed.setFooter({ text: 'AZURA Real-Time Telemetry Engine • Live Verified' }).setTimestamp();
    await interaction.editReply({ embeds: [statusEmbed] });

  } else if (commandName === 'remindme') {
    const waktuStr = interaction.options.getString('waktu');
    const pesan = interaction.options.getString('pesan');
    const delayMs = parseTime(waktuStr);

    if (!delayMs) {
      return interaction.reply({
        content: '⚠️ Format waktu salah! Contoh yang benar: `5m` (5 menit), `1h` (1 jam), `30s` (30 detik).',
        flags: 64
      });
    }

    if (delayMs > 30 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        content: '⚠️ Waktu pengingat maksimal adalah 30 hari ke depan ya!',
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
    const passwordInput = interaction.options.getString('password');

    const safetyBanner = `⚠️ **[PERINGATAN KEAMANAN & PRIVASI MEMORI]**\n` +
      `*Dilarang keras memasukkan informasi penting atau krusial (seperti kata sandi, PIN ATM, nomor rekening, NIK/KTP, data rahasia). Hanya cantumkan informasi ringan seputar hobi, preferensi, atau obrolan santai.*`;

    // 1. Handling New Fact Insertion with Sacred Data Protection
    if (faktaBaru) {
      if (isSacredData(faktaBaru)) {
        const warnEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('⛔ [PERINGATAN KEAMANAN: DATA SENSITIF TERDETEKSI]')
          .setDescription(
            `Fakta yang kamu masukkan **DITOLAK** karena mengandung indikasi informasi penting/krusial (kata sandi, PIN, NIK, kartu kredit, token API, atau data rahasia).\n\n` +
            `${safetyBanner}`
          )
          .setFooter({ text: 'AZURA High-Security Guard • Privacy Shield' })
          .setTimestamp();
        return interaction.reply({ embeds: [warnEmbed], flags: 64 });
      }

      const res = addFact(user.id, faktaBaru);
      if (res && res.success) {
        const successEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🧠 Fakta Baru Berhasil Dicatat!')
          .setDescription(
            `AZURA bakal selalu ingat bahwa:\n👉 **"${faktaBaru}"**\n\n` +
            `${safetyBanner}`
          )
          .setFooter({ text: 'AZURA Memory Engine' })
          .setTimestamp();
        return interaction.reply({ embeds: [successEmbed], flags: 64 });
      } else if (res && res.blocked) {
        return interaction.reply({
          content: `⛔ **Ditolak:** Fakta mengandung data rahasia atau kredensial sensitif.\n\n${safetyBanner}`,
          flags: 64
        });
      } else {
        return interaction.reply({
          content: `Fakta ini sudah tersimpan sebelumnya atau tidak valid.\n\n${safetyBanner}`,
          flags: 64
        });
      }
    }

    const contextKey = interaction.guild
      ? `channel_${interaction.channelId}_user_${user.id}`
      : `user_${user.id}`;

    const { getPermanentSummaries, MAX_SUMMARIES_PER_CONTEXT, deletePermanentSummaryById, auditPermanentMemories } = require('./permanentMemory');
    const deleteId = interaction.options.getString('id');

    // 2. Delete specific summary by ID (Protected)
    if (deleteId) {
      const auth = checkMasterAuth(interaction, passwordInput);
      if (!auth.authorized) {
        return interaction.reply({ embeds: [auth.embed], flags: 64 });
      }

      const isDeleted = deletePermanentSummaryById(contextKey, deleteId);
      if (isDeleted) {
        return interaction.reply({
          content: `🗑️ **[HAPUS BERHASIL]** Ringkasan memori dengan ID \`${deleteId}\` telah berhasil dihapus dari penyimpanan terenkripsi VPS!\n\n${safetyBanner}`,
          flags: 64
        });
      } else {
        return interaction.reply({
          content: `❌ Ringkasan memori dengan ID \`${deleteId}\` tidak ditemukan di sesi ini. Gunakan \`/memory aksi:lihat\` untuk melihat daftar ID aktif.`,
          flags: 64
        });
      }
    }

    // 3. Full clear (Protected)
    if (aksi === 'hapus') {
      const auth = checkMasterAuth(interaction, passwordInput);
      if (!auth.authorized) {
        return interaction.reply({ embeds: [auth.embed], flags: 64 });
      }

      clearUserMemory(user.id);
      try {
        const { clearPermanentSummaries } = require('./permanentMemory');
        clearPermanentSummaries(contextKey);
      } catch (_) {}
      return interaction.reply({
        content: `🗑️ **Semua memori jangka panjang & ringkasan permanen tentang kamu sudah dibersihkan secara aman!**\n\n${safetyBanner}`,
        flags: 64
      });
    }

    // 4. AI Memory Audit & Pruning Advisory (Protected)
    if (aksi === 'audit') {
      const auth = checkMasterAuth(interaction, passwordInput);
      if (!auth.authorized) {
        return interaction.reply({ embeds: [auth.embed], flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });
      const auditResult = await auditPermanentMemories(contextKey);

      if (auditResult.total === 0) {
        return interaction.editReply({
          content: `🧠 Belum ada ringkasan memori permanen yang tersimpan untuk diaudit di sesi ini.\n\n${safetyBanner}`
        });
      }

      let itemsStr = '';
      const pruneIds = [];

      if (auditResult.items && auditResult.items.length > 0) {
        itemsStr = '\n\n' + auditResult.items.map(item => {
          let badge = '🟢 `[TETAP RELEVAN]`';
          if (item.status === 'REVIEW') badge = '🟡 `[PERLU DIKONFIRMASI]`';
          if (item.status === 'PRUNE') {
            badge = '🔴 `[REKOMENDASI HAPUS]`';
            pruneIds.push(item.id);
          }
          return `${badge} **${item.title}** (\`${item.id}\`)\n   📝 *${item.reason}*`;
        }).join('\n\n');
      }

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🧠 AZURA AI Memory Audit & Rekomendasi Pembersihan`)
        .setDescription(
          `${safetyBanner}\n\n` +
          `**Analisis Kritis AZURA:**\n${auditResult.advisoryText}` +
          itemsStr
        )
        .setFooter({ text: 'Audit memori berbasis perbandingan tanggal aktual & relevansi topik' })
        .setTimestamp();

      const row = new ActionRowBuilder();
      if (pruneIds.length > 0) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`mem_prune_auto:${contextKey}:${pruneIds.join(',')}`)
            .setLabel(`🗑️ Bersihkan Otomatis (${pruneIds.length} Usang)`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('mem_prune_cancel')
            .setLabel('✨ Pertahankan Semua')
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [embed], components: [row] });
      } else {
        return interaction.editReply({ embeds: [embed] });
      }
    }

    // 5. Default: View Facts & Permanent Summaries (With Safety Warning Banner)
    const facts = getUserFacts(user.id);
    const summaries = getPermanentSummaries(contextKey);

    const factsList = facts.length > 0
      ? facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
      : '*(Belum ada fakta khusus yang tersimpan)*';

    const summariesList = summaries.length > 0
      ? summaries.slice(0, 5).map((s, i) => {
          const pTag = s.isPriority ? ' ⭐ `[Prioritas]`' : '';
          return `**${i + 1}. ${s.title}** (\`${s.id}\` - ${s.dateFormatted})${pTag}\n📝 *${s.summary}*`;
        }).join('\n\n')
      : '*(Belum ada ringkasan sesi yang dipermanenkan)*';

    const embed = new EmbedBuilder()
      .setColor(0x00FFB2)
      .setTitle(`🧠 Sistem Memori & Arsip Terenkripsi AZURA`)
      .setDescription(
        `${safetyBanner}\n\n` +
        `AZURA menyimpan memori hierarkis (Fakta Kunci + Ringkasan Eksekutif Permanen hingga **5.000 Pesan**):`
      )
      .addFields(
        {
          name: `📌 Fakta & Kebiasaan Kunci (${facts.length}/20)`,
          value: factsList,
          inline: false
        },
        {
          name: `💾 Arsip Sesi Percakapan Permanen (${summaries.length}/${MAX_SUMMARIES_PER_CONTEXT} Summary Keys)`,
          value: summariesList,
          inline: false
        }
      )
      .setFooter({ text: 'Gunakan /memory aksi:audit untuk konsultasi relevansi memori dengan AZURA' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 64 });

  } else if (commandName === 'search') {
    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      const { searchTavilyCard } = require('./tavily');
      const cardResult = await searchTavilyCard(query, 'general', user.username);
      if (typeof cardResult === 'object' && cardResult.embeds) {
        await interaction.editReply(cardResult);
      } else {
        const safeDesc = String(cardResult || '');
        const infoEmbed = new EmbedBuilder()
          .setColor(0x2B82EA)
          .setTitle(`🔍 Hasil Pencarian: ${query}`)
          .setDescription(safeDesc.length > 3950 ? safeDesc.slice(0, 3950) + '...' : safeDesc)
          .setFooter({ text: 'AZURA Live Web Intelligence' })
          .setTimestamp();
        await interaction.editReply({ embeds: [infoEmbed] });
      }
    } catch (error) {
      await interaction.editReply('Gagal melakukan pencarian web. Coba lagi beberapa saat lagi ya!');
    }

  } else if (commandName === 'agent') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    if (!isOwner) {
      return interaction.reply({
        content: '🔒 **Akses Ditolak!** Fitur Autonomous Agent ini khusus untuk Owner (Attila).',
        flags: 64
      });
    }

    const task = interaction.options.getString('tugas');
    await interaction.deferReply({ flags: 64 });

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

  } else if (commandName === 'activity') {
    if (!interaction.guild) {
      return interaction.reply({
        content: '⚠️ Perintah `/activity` hanya dapat digunakan di dalam **Server (Voice Channel)** untuk aktivitas bersama member.',
        flags: 64
      });
    }
    const { launchVoiceActivity } = require('./activities');
    const actType = interaction.options.getString('jenis') || 'youtube';
    const voiceChannel = interaction.member?.voice?.channel;
    const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

    if (!voiceChannel) {
      return interaction.reply({
        content: '⚠️ Kamu harus bergabung ke dalam Voice Channel terlebih dahulu untuk meluncurkan aktivitas ini yaa!',
        flags: 64
      });
    }

    const res = await launchVoiceActivity(voiceChannel, actType, userName);
    if (res.success) {
      await interaction.reply({ embeds: res.embeds, components: res.components });
    } else {
      await interaction.reply({ content: res.message, flags: 64 });
    }

  } else if (commandName === 'report' || commandName === 'feedback') {
    const { handleFeedbackSlash } = require('./feedback');
    await handleFeedbackSlash(interaction);

  } else if (commandName === 'vault') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    if (!isOwner) {
      return interaction.reply({
        content: '🔒 **Akses Ditolak!** Fitur Encrypted Database Vault ini bersifat *Zero-Knowledge* dan hanya dapat didekripsi oleh Owner utama (Attila).',
        flags: 64
      });
    }

    const passwordInput = interaction.options.getString('password');
    const auth = checkMasterAuth(interaction, passwordInput);
    if (!auth.authorized) {
      return interaction.reply({ embeds: [auth.embed], flags: 64 });
    }

    const { getVaultStats, getUserRecord, exportVaultData } = require('./vault');
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'stats') {
      const stats = getVaultStats();
      const topList = stats.topUsers.map((u, i) => {
        const aliasStr = u.knownRealName ? `\n   📛 **Nama Asli/Panggilan:** \`${u.knownRealName}\`` : '';
        const voiceStr = u.totalVoiceTurns ? ` (${u.totalMessages} teks, ${u.totalVoiceTurns} voice)` : '';
        const dmScope = u.usedInDm ? ` | 📩 \`${u.dmMessages} DM\`` : '';
        const banTag = u.isBanned ? ' ⛔ `[BANNED]`' : '';
        const firstDate = u.firstSeen ? new Date(u.firstSeen).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        return `${i + 1}. **${u.displayName}** (\`@${u.username}\`)${banTag} • \`${u.totalInteractions} interaksi lifetime\`${voiceStr}${dmScope}${aliasStr}\n   🎖️ **Tingkat Keakraban:** ${u.relationshipTier}\n   📅 **Pertama Kali Chat:** \`${firstDate}\``;
      }).join('\n\n') || '(Belum ada pengguna aktif)';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔒 AZURA Zero-Knowledge Encrypted Vault')
        .setDescription(
          `🛡️ **Status Enkripsi:** \`AES-256-GCM (Authenticated)\`\n` +
          `👥 **Total Pengguna Terdaftar:** \`${stats.totalUsers}\` user\n` +
          `💬 **Total Interaksi Lifetime:** \`${stats.totalInteractions}\` interaksi (\`${stats.totalMessages}\` teks, \`${stats.totalVoiceTurns || 0}\` voice)\n` +
          `🌐 **Pesan di Server:** \`${stats.totalServerMessages || 0}\` pesan\n` +
          `📩 **Pesan di DM Pribadi:** \`${stats.totalDmMessages || 0}\` pesan (\`${stats.usersWithDm || 0}\` pengguna pernah DM)\n` +
          `🚫 **Pengguna Diblokir/Blacklist:** \`${stats.totalBanned || 0}\` user\n` +
          `⚡ **Pengguna Aktif 24 Jam Terakhir:** \`${stats.activeToday}\` user\n\n` +
          `🏆 **Top Pengguna Lifetime Paling Aktif (Akumulasi Sejak Update):**\n${topList}`
        )
        .setFooter({ text: 'Data diakumulasikan secara aman & terenkripsi di data/user_vault.enc' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (subcommand === 'list') {
      const { getAllUsersList } = require('./vault');
      const list = getAllUsersList();
      if (!list.length) {
        return interaction.reply({ content: 'Belum ada pengguna terdaftar di vault.', flags: 64 });
      }

      const formatted = list.map((u, i) => {
        const lockIcon = u.isNameLocked ? '🔒' : '🔓';
        const banIcon = u.isBanned ? '⛔ `[DIBLOKIR]`' : '';
        const nameStr = u.knownRealName ? `**${u.knownRealName}**` : '*(Belum diset)*';
        const pendingStr = u.pendingNameChange ? ` ⏳ (Minta: "${u.pendingNameChange.requestedName}")` : '';
        const dmBadge = u.usedInDm ? `📩 \`${u.dmMessages} DM\`` : '📩 `Belum Pernah DM`';
        const srvBadge = u.usedInServer ? `🌐 \`${u.serverMessages} Server\`` : '🌐 `Hanya DM`';
        return `${i + 1}. **${u.displayName}** (\`@${u.username}\`) ${banIcon}\n   🔢 **UID:** \`${u.userId}\`\n   🏷️ **Nama:** ${nameStr} ${lockIcon}${pendingStr}\n   📊 **Scope:** ${srvBadge} | ${dmBadge} (${u.totalVoiceTurns} voice)\n   🎖️ **Tier:** ${u.relationshipTier}`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🔒 Direktori Identitas Pengguna AZURA (${list.length} Pengguna)`)
        .setDescription(formatted.length > 4000 ? formatted.slice(0, 4000) + '...' : formatted)
        .setFooter({ text: 'Gunakan /vault setname target:<uid> nama:<nama> untuk menetapkan nama resmi' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (subcommand === 'setname') {
      const targetQuery = interaction.options.getString('target');
      const newName = interaction.options.getString('nama');
      const isLock = interaction.options.getBoolean('kunci') ?? true;
      const { setUserNameByOwner } = require('./vault');

      const res = setUserNameByOwner(targetQuery, newName, isLock);
      if (!res) {
        return interaction.reply({
          content: `❌ Tidak ditemukan pengguna di vault untuk target: \`${targetQuery}\`. Pastikan target sudah pernah berinteraksi dengan AZURA minimal 1x.`,
          flags: 64
        });
      }

      // Try notifying target user via DM
      try {
        const targetUser = await interaction.client.users.fetch(res.userId);
        if (targetUser) {
          await targetUser.send(`✨ **[Pembaruan Identitas AZURA]**\nNama panggilanmu telah resmi ditetapkan oleh Attila sebagai **${res.newName}** ${res.isLocked ? '🔒 (Terkunci)' : '🔓'}.`).catch(() => {});
        }
      } catch (_) {}

      return interaction.reply({
        content: `✅ Berhasil menetapkan nama panggilan untuk <@${res.userId}> (\`@${res.username}\`):\n` +
                 `📛 **Nama Resmi:** **${res.newName}**\n` +
                 `🔒 **Status Kunci:** ${res.isLocked ? '\`TERKUNCI 🔒\`' : '\`TERBUKA 🔓\`'}\n` +
                 `🔢 **UID:** \`${res.userId}\``,
        flags: 64
      });

    } else if (subcommand === 'unlock') {
      const targetQuery = interaction.options.getString('target');
      const { unlockUserNameByOwner } = require('./vault');
      const res = unlockUserNameByOwner(targetQuery);
      if (!res) {
        return interaction.reply({
          content: `❌ Tidak ditemukan pengguna untuk target: \`${targetQuery}\``,
          flags: 64
        });
      }
      return interaction.reply({
        content: `🔓 Kunci nama panggilan untuk <@${res.userId}> (\`@${res.username}\`) telah **DIBUKA**. Pengguna kini bisa mendaftarkan nama baru lewat chat.`,
        flags: 64
      });

    } else if (subcommand === 'ban') {
      const targetQuery = interaction.options.getString('target');
      const reason = interaction.options.getString('alasan') || 'Pelanggaran ketentuan penggunaan AZURA';
      const { banUser } = require('./vault');
      const res = banUser(targetQuery, reason, interaction.user.tag);

      // Try notifying target user via DM
      try {
        const targetUser = await interaction.client.users.fetch(res.userId);
        if (targetUser) {
          await targetUser.send(`🚫 **[Pemberitahuan Keamanan AZURA]**\nAkses kamu ke seluruh layanan AZURA telah **dihentikan secara permanen (Diblokir Total)**.\nAlasan: *${reason}*`).catch(() => {});
        }
      } catch (_) {}

      return interaction.reply({
        content: `🚫 **[BLACKLIST BERHASIL]** Pengguna <@${res.userId}> (\`@${res.username}\`) telah **DIBLOKIR TOTAL** dari seluruh respon AZURA (Server & DM)!\n📝 **Alasan:** ${res.reason}\n🔢 **UID:** \`${res.userId}\``,
        flags: 64
      });

    } else if (subcommand === 'unban') {
      const targetQuery = interaction.options.getString('target');
      const { unbanUser } = require('./vault');
      const res = unbanUser(targetQuery);
      if (!res.success) {
        return interaction.reply({ content: `❌ ${res.message}`, flags: 64 });
      }

      return interaction.reply({
        content: `✅ **[UNBAN BERHASIL]** Blokir akses untuk <@${res.userId}> (\`@${res.username}\`) telah dicabut. Pengguna kini dapat berinteraksi kembali dengan AZURA.`,
        flags: 64
      });

    } else if (subcommand === 'blacklist') {
      const { getBlacklist } = require('./vault');
      const bl = getBlacklist();
      if (!bl.length) {
        return interaction.reply({ content: '✅ Tidak ada pengguna yang sedang diblokir/diblacklist saat ini.', flags: 64 });
      }

      const listStr = bl.map((b, i) => {
        const banDate = b.bannedAt ? new Date(b.bannedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        return `${i + 1}. **${b.displayName}** (\`@${b.username}\`)\n   🔢 **UID:** \`${b.userId}\`\n   📝 **Alasan:** *${b.reason}*\n   👮 **Oleh:** \`${b.bannedBy}\` (${banDate} WIB)`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle(`🚫 Daftar Pengguna Diblacklist (${bl.length} Pengguna)`)
        .setDescription(listStr)
        .setFooter({ text: 'Gunakan /vault unban target:<uid> untuk membuka blokir' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (subcommand === 'view') {
      const targetQuery = interaction.options.getString('target');
      const record = getUserRecord(targetQuery);
      if (!record) {
        return interaction.reply({
          content: `❌ Tidak ditemukan data profil terenkripsi untuk target: \`${targetQuery}\``,
          flags: 64
        });
      }

      const firstDate = record.firstSeen ? new Date(record.firstSeen).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
      const lastDate = record.lastSeen ? new Date(record.lastSeen).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

      const embed = new EmbedBuilder()
        .setColor(record.isBanned ? 0xE74C3C : 0x2ECC71)
        .setTitle(`👤 Profil Pengguna Lifetime: ${record.displayName} (@${record.username})`)
        .setDescription(
          `🆔 **User ID:** \`${record.userId}\`\n` +
          `👤 **Display Name:** **${record.displayName}**\n` +
          `🏷️ **Username:** \`@${record.username}\`\n` +
          `📛 **Nama Resmi/Panggilan:** **${record.knownRealName ? `\`${record.knownRealName}\` ${record.isNameLocked ? '🔒 (Terkunci)' : '🔓'}` : '*(Belum diset)*'}**\n` +
          `🎖️ **Tingkat Keakraban:** ${record.relationshipTier || '🌱 Member Baru'}\n` +
          `📊 **Total Interaksi Lifetime:** \`${record.totalInteractions}\` interaksi (\`${record.totalMessages || 0}\` teks, \`${record.totalVoiceTurns || 0}\` voice)\n` +
          `🌐 **Aktivitas Server:** \`${record.serverMessages || 0} pesan\` (${record.activeServers?.length ? record.activeServers.join(', ') : 'Belum ada'})\n` +
          `📩 **Aktivitas DM Pribadi:** ${record.usedInDm ? `\`✅ Pernah DM (${record.dmMessages || 0} pesan)\`` : '\`❌ Belum Pernah DM\`'}\n` +
          `🚫 **Status Keamanan:** ${record.isBanned ? `\`⛔ DIBLOKIR TOTAL\`\n   📝 *Alasan: ${record.banReason}*` : '\`✅ Normal / Aktif\`'}\n` +
          `🍪 **Session Cookie:** \`${record.sessionCookie || '-'}\`\n` +
          `📅 **Pertama Kali Chat:** \`${firstDate}\`\n` +
          `⏰ **Terakhir Kali Aktif:** \`${lastDate}\` WIB`
        )
        .setFooter({ text: 'Didekripsi secara aman dengan kunci master AES-256-GCM' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (subcommand === 'export') {
      const format = interaction.options.getString('format') || 'json';
      const exportedContent = exportVaultData(format);
      const fileName = `azura_user_vault_${Date.now()}.${format}`;
      const buffer = Buffer.from(exportedContent, 'utf-8');

      try {
        await user.send({
          content: `🔒 **Ekspor Database Pengguna AZURA (${format.toUpperCase()})**\nBerikut adalah rekapitulasi data database pengguna yang telah didekripsi secara aman.`,
          files: [{ attachment: buffer, name: fileName }]
        });
        return interaction.reply({
          content: `✅ File ekspor database pengguna (\`${fileName}\`) berhasil dikirimkan langsung ke **DM kamu**! 📩`,
          flags: 64
        });
      } catch (dmErr) {
        return interaction.reply({
          content: `❌ Gagal mengirim file ke DM: ${dmErr.message}. Pastikan kamu membuka izin DM untuk bot yaa!`,
          flags: 64
        });
      }
    }

  } else if (commandName === 'friend') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    if (!isOwner) {
      return interaction.reply({
        content: '🔒 **Akses Ditolak!** Perintah \`/friend\` khusus untuk Owner utama (Attila) guna mengelola akses eksklusif Voice Companion.',
        flags: 64
      });
    }

    const passwordInput = interaction.options.getString('password');
    const auth = checkMasterAuth(interaction, passwordInput);
    if (!auth.authorized) {
      return interaction.reply({ embeds: [auth.embed], flags: 64 });
    }

    const {
      approveFriend,
      revokeFriend,
      resetFriendVoiceQuota,
      getApprovedFriendsList,
      MAX_DAILY_VOICE_SECONDS
    } = require('./accessControl');

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const rawTarget = interaction.options.getString('target');
      const targetId = (rawTarget || '').replace(/[^0-9]/g, '');

      if (!targetId || targetId.length < 16) {
        return interaction.reply({
          content: `❌ **Format User ID Tidak Valid!** Masukkan Discord User ID berupa 17-19 digit angka (contoh: \`1086593461454655588\`).`,
          flags: 64
        });
      }

      await interaction.deferReply({ flags: 64 });

      try {
        let fetchedUser = null;
        try {
          fetchedUser = await interaction.client.users.fetch(targetId);
        } catch (_) {}

        const username = fetchedUser ? fetchedUser.username : `User_${targetId}`;
        const displayName = fetchedUser ? (fetchedUser.displayName || fetchedUser.username) : username;
        const customName = interaction.options.getString('nama') || displayName;

        const record = await approveFriend(
          targetId,
          username,
          displayName,
          customName,
          user.username || 'Attila',
          interaction.client
        );

        const embed = new EmbedBuilder()
          .setColor(0x57F287) // Green success
          .setTitle('✨ [AKSES TEMAN BERHASIL DIBERIKAN]')
          .setDescription(
            `Pengguna <@${targetId}> (\`UID: ${targetId}\` | \`@${username}\`) telah resmi di-ACC sebagai **Approved Friend**! 🎉\n\n` +
            `• 🏷️ **Nama Panggilan Resmi**: **${record.customNickname}**\n` +
            `• 🎙️ **Batas Kuota Voice**: \`${MAX_DAILY_VOICE_SECONDS} detik (2 menit output bicara AZURA) per 24 jam realtime\`\n` +
            `• 👑 **Aturan Khusus**: Hanya aktif saat **Attila** berada di Voice Channel yang sama.\n` +
            `• 📩 **Onboarding DM**: ${fetchedUser ? `Azura telah otomatis mengirimkan DM sambutan estetik ke <@${targetId}>!` : `*(User ID valid terdaftar, DM terkirim otomatis saat online)*`}`
          )
          .setFooter({ text: 'AZURA Approved Friends Engine' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply(`❌ Gagal menambahkan teman: ${err.message}`);
      }

    } else if (subcommand === 'remove') {
      const rawTarget = interaction.options.getString('target');
      const targetId = (rawTarget || '').replace(/[^0-9]/g, '');
      const success = revokeFriend(targetId);

      if (success) {
        return interaction.reply({
          content: `✅ Berhasil mencabut izin akses teman untuk <@${targetId}> (\`UID: ${targetId}\`). Pengguna kini kembali menjadi tamu biasa.`,
          flags: 64
        });
      } else {
        return interaction.reply({
          content: `⚠️ Pengguna dengan User ID \`${targetId}\` tidak ditemukan dalam daftar Approved Friends saat ini.`,
          flags: 64
        });
      }

    } else if (subcommand === 'list') {
      const list = getApprovedFriendsList();
      if (!list.length) {
        return interaction.reply({
          content: '📋 Belum ada teman yang didaftarkan ke daftar Approved Friends. Gunakan `/friend add target:<User ID> nama:<Panggilan>` untuk menambahkan!',
          flags: 64
        });
      }

      const formatted = list.map((f, i) => {
        const statusBadge = f.isExhausted ? '⛔ `[KUOTA HABIS HARI INI]`' : '✅ `[AKTIF]`';
        const dateStr = f.approvedAt ? new Date(f.approvedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        return `${i + 1}. **${f.customNickname}** (<@${f.userId}> | \`${f.userId}\`) ${statusBadge}\n` +
               `   • ⏱️ **Penggunaan Hari Ini (Bicara AZURA)**: \`${f.usedSeconds}s / ${MAX_DAILY_VOICE_SECONDS}s\` (Sisa: \`${f.remainingSeconds}s\`)\n` +
               `   • ⏳ **Status Reset 24h**: \`${f.timeLeftStr}\`\n` +
               `   • 📊 **Total Voice All-Time**: \`${f.totalSecondsAllTime}s\` | 📅 Di-ACC: \`${dateStr}\``;
      }).join('\n\n');

      const rawDesc = `Daftar teman yang di-ACC oleh Attila untuk interaksi Voice Channel (Batas: 2 Menit output AZURA / 24 Jam realtime):\n\n` + formatted;
      const embed = new EmbedBuilder()
        .setColor(0x8A2BE2)
        .setTitle(`⭐ Direktori Approved Friends AZURA (${list.length} Teman)`)
        .setDescription(rawDesc.length > 3950 ? rawDesc.slice(0, 3950) + '...' : rawDesc)
        .setFooter({ text: 'Gunakan /friend add untuk menambah atau /friend remove untuk mencabut' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (subcommand === 'reset') {
      const rawTarget = interaction.options.getString('target');
      const targetId = (rawTarget || '').replace(/[^0-9]/g, '');
      const res = resetFriendVoiceQuota(targetId);

      if (res) {
        return interaction.reply({
          content: `🔄 **[RESET KUOTA BERHASIL]** Kuota harian voice untuk <@${targetId}> (\`${res.customNickname}\`) telah direset menjadi **0s / 120s**!`,
          flags: 64
        });
      } else {
        return interaction.reply({
          content: `⚠️ Pengguna dengan User ID \`${targetId}\` tidak terdaftar di whitelist Approved Friends.`,
          flags: 64
        });
      }
    }

  } else if (commandName === 'roadmap') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    if (!isOwner) {
      return interaction.reply({
        content: '🔒 **Akses Ditolak!** Fitur To-Do List & Manajemen Roadmap ini khusus untuk Owner (Attila).',
        flags: 64
      });
    }

    const passwordInput = interaction.options.getString('password');
    const auth = checkMasterAuth(interaction, passwordInput);
    if (!auth.authorized) {
      return interaction.reply({ embeds: [auth.embed], flags: 64 });
    }

    const { getTodoList, handleFeedbackDone, consultAiOnFeedback } = require('./feedback');
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const statusFilter = interaction.options.getString('status') || 'ACCEPTED';
      const items = getTodoList(statusFilter);

      if (!items.length) {
        return interaction.reply({
          content: `📋 Tidak ada item dalam daftar To-Do untuk status: \`${statusFilter}\`.\n🌐 Akses Live Web Dashboard: http://${process.env.VPS_IP || '203.175.10.163'}:7860/todo`,
          flags: 64
        });
      }

      const formatted = items.map((t, i) => {
        const isAdv = t.type === 'advice';
        const typeIcon = isAdv ? '💡 [Advice]' : '🐛 [Bug Report]';
        let statusBadge = '⏳ `PENDING`';
        if (t.status === 'ACCEPTED') statusBadge = '📌 `IN PROGRESS`';
        if (t.status === 'DONE') statusBadge = '🎉 `DONE`';
        if (t.status === 'REJECTED') statusBadge = '❌ `REJECTED`';

        const createdDate = new Date(t.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        return `${i + 1}. **#${t.ticketId}** ${typeIcon} • ${statusBadge}\n   👤 **Dari:** **${t.userName}** (\`${t.userTag}\`) [${createdDate}]\n   📝 **Pesan:** *"${t.content.slice(0, 150)}${t.content.length > 150 ? '...' : ''}"*`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📋 AZURA Roadmap & To-Do List (${items.length} Item - ${statusFilter})`)
        .setDescription(formatted.length > 4000 ? formatted.slice(0, 4000) + '...' : formatted)
        .setFooter({ text: `🌐 Web Dashboard: http://${process.env.VPS_IP || '203.175.10.163'}:7860/todo` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (subcommand === 'done') {
      const ticketId = interaction.options.getString('ticket').toUpperCase().replace('#', '');
      return await handleFeedbackDone(interaction, ticketId);

    } else if (subcommand === 'discuss') {
      const ticketId = interaction.options.getString('ticket').toUpperCase().replace('#', '');
      await interaction.deferReply({ flags: 64 });
      const analysis = await consultAiOnFeedback(ticketId);

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🧠 Analisis Kritis & Strategis AI • Ticket #${ticketId}`)
        .setDescription(analysis.length > 4000 ? analysis.slice(0, 4000) + '...' : analysis)
        .setFooter({ text: 'AZURA Strategic AI Advisory Engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

  } else if (commandName === 'personality') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    if (!isOwner) {
      return interaction.reply({
        content: '🔒 **Akses Ditolak!** Kepribadian dan jiwa AZURA terkunci (*Soul Locked*) dan hanya dapat diubah oleh Owner utama (Attila).',
        flags: 64
      });
    }

    const { setPersonalityMode } = require('./personality');
    const targetMode = interaction.options.getString('mode');
    const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
    const res = setPersonalityMode(targetMode, userName);

    let emoji = '✨';
    if (res.mode === 'mature') emoji = '👑';
    if (res.mode === 'stubborn') emoji = '😼';

    const embed = new EmbedBuilder()
      .setColor(res.mode === 'stubborn' ? 0xE67E22 : (res.mode === 'mature' ? 0x9B59B6 : 0x00FFB2))
      .setTitle(`${emoji} Mode Kepribadian AZURA Berhasil Diubah`)
      .setDescription(
        `🎭 **Mode Aktif:** **${res.title}** (\`${res.mode}\`)\n` +
        `📝 **Karakter:** *${res.description}*\n\n` +
        `🔒 *Mode ini tersimpan permanen di database VPS dan hanya berlaku atas instruksi Attila.*`
      )
      .setFooter({ text: 'Soul Lock Engine • Attila Exclusive Authority' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });

  } else if (commandName === 'behavior') {
    const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;
    const action = interaction.options.getString('aksi');
    const { getUserBehavior, getAllBehaviors, deleteUserBehavior, MAX_BEHAVIOR_USERS } = require('./behavior');

    if (action === 'lihat_saya') {
      const myBehavior = getUserBehavior(user.id);
      if (!myBehavior || (!myBehavior.positiveTraits?.length && myBehavior.interactionCount === 0)) {
        return interaction.reply({
          content: 'ℹ️ **Belum Ada Rekaman Behavior:** AZURA belum mencatat sifat atau kebiasaan publik khusus tentang kamu.',
          flags: 64
        });
      }

      const traits = myBehavior.positiveTraits?.length ? myBehavior.positiveTraits.join(', ') : 'Ramah & Santai';
      const embed = new EmbedBuilder()
        .setColor(0x00FFB2)
        .setTitle(`🎭 Rekaman Sifat & Behavior Publik: ${myBehavior.nickname}`)
        .setDescription(
          `👤 **Panggilan Terdaftar:** **${myBehavior.nickname}** (@${myBehavior.username})\n` +
          `✨ **Vibe & Karakter Positif:** ${traits}\n` +
          `📝 **Kesan AZURA:** *"${myBehavior.personalitySummary}"*\n` +
          `📊 **Total Interaksi Terpantau:** \`${myBehavior.interactionCount || 1} kali\`\n\n` +
          `🔒 *Catatan: Data ini hanya mencatat kebiasaan positif dan bisa kamu hapus kapan saja menggunakan \`/behavior aksi:hapus_saya\`.*`
        )
        .setFooter({ text: 'AZURA Social Intelligence & Privacy Guard' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (action === 'hapus_saya') {
      const deleted = deleteUserBehavior(user.id);
      return interaction.reply({
        content: deleted
          ? '🗑️ **Berhasil Dihapus!** Seluruh rekaman sifat, kebiasaan, dan behavior publik kamu telah **dihapus bersih** dari memori AZURA. AZURA tidak akan lagi mengakses atau menyinggung aspek tersebut di server/VC publik.'
          : 'ℹ️ Tidak ada data rekaman behavior kamu yang tersimpan di memori AZURA.',
        flags: 64
      });

    } else if (action === 'list') {
      if (!isOwner) {
        return interaction.reply({
          content: '🔒 **Akses Ditolak!** Daftar ringkasan seluruh behavior server hanya bisa diakses oleh Owner (Attila).',
          flags: 64
        });
      }

      const all = getAllBehaviors();
      const count = all.length;
      const isWarning = count >= 15;

      const embed = new EmbedBuilder()
        .setColor(isWarning ? 0xE67E22 : 0x2ECC71)
        .setTitle(`📊 Database Behavior & Karakter Pengguna (${count}/${MAX_BEHAVIOR_USERS} Slot)`)
        .setDescription(
          `${isWarning ? `⚠️ **Peringatan Kapasitas:** Slot behavior sudah terisi **${count}/20 pengguna** (${((count/MAX_BEHAVIOR_USERS)*100).toFixed(0)}%)!\n\n` : ''}` +
          (all.length === 0
            ? '*(Belum ada data behavior pengguna yang tercatat)*'
            : all.map((u, i) => `**${i + 1}. ${u.nickname}** (\`@${u.username}\`)\n   • Sifat: ${u.positiveTraits?.join(', ') || 'Ramah'}\n   • Kesan: *${u.personalitySummary}*`).join('\n\n'))
        )
        .setFooter({ text: `Kapasitas Maksimal: ${MAX_BEHAVIOR_USERS} Pengguna • AZURA Social Intelligence` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });

    } else if (action === 'hapus') {
      if (!isOwner) {
        return interaction.reply({
          content: '🔒 **Akses Ditolak!** Penghapusan behavior pengguna lain hanya bisa dilakukan oleh Owner (Attila).',
          flags: 64
        });
      }

      const target = interaction.options.getString('target');
      if (!target) {
        return interaction.reply({
          content: '❌ Harap sebutkan User ID atau @User target yang ingin dihapus datanya.',
          flags: 64
        });
      }

      const cleanUid = target.replace(/<@!?(\d+)>/, '$1').trim();
      const { getUserRecord } = require('./vault');
      const rec = getUserRecord(cleanUid);
      const targetUid = rec?.userId || cleanUid;

      const deleted = deleteUserBehavior(targetUid);
      return interaction.reply({
        content: deleted
          ? `✅ Data behavior untuk pengguna **${rec?.displayName || targetUid}** berhasil dihapus dari database!`
          : `❌ Tidak ditemukan rekaman behavior untuk target \`${target}\`.`,
        flags: 64
      });
    }

  } else if (commandName === 'todo') {
    const action = interaction.options.getString('aksi');
    const { createTodo, toggleTodoStatus, deleteTodo, generateTodoRecapText, TODO_DASHBOARD_URL } = require('./todo');
    const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

    if (action === 'web') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 Buka Web Dashboard To-Do List')
          .setStyle(ButtonStyle.Link)
          .setURL(TODO_DASHBOARD_URL)
          .setEmoji('📋')
      );

      const embed = new EmbedBuilder()
        .setColor(0x00FFB2)
        .setTitle('✨ AZURA To-Do & Task Management Web Hub')
        .setDescription(
          `Halo **${userName}**! 👋\n\n` +
          `Untuk pengalaman manajemen tugas yang rapi, tertata, dan tidak sesak di chat Discord, kamu bisa mengakses **Web Dashboard To-Do List** langsung melalui link di bawah ini:\n\n` +
          `👉 **[Klik Disini untuk Buka Dashboard To-Do List](${TODO_DASHBOARD_URL})**\n\n` +
          `✨ *Fitur Web Dashboard: Filter Kategori, Indikator Prioritas, Progres Bar, Toggle Checkbox Cepat, dan Tambah Tugas Instan!*`
        )
        .setFooter({ text: 'AZURA Productivity & Task Engine' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], components: [row] });

    } else if (action === 'rekap') {
      const recapData = generateTodoRecapText(userName);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 Kelola Lengkap di Web Dashboard')
          .setStyle(ButtonStyle.Link)
          .setURL(TODO_DASHBOARD_URL)
          .setEmoji('✨')
      );

      const embed = new EmbedBuilder()
        .setColor(0x00FFB2)
        .setTitle(`📋 Rekap To-Do List & Agenda Tugas ${userName}`)
        .setDescription(
          `📊 **Progres Penyelesaian:** \`${recapData.progressPct}%\` (${recapData.completed}/${recapData.total} Selesai)\n` +
          `⏳ **Pending:** \`${recapData.pending}\` • ✅ **Selesai:** \`${recapData.completed}\`\n\n` +
          `🌐 *Layout chat Discord terlalu sempit untuk rincian panjang. Buka Web Dashboard untuk tampilan visual lega & estetik:*`
        )
        .setFooter({ text: 'AZURA Task Engine • Live VPS Synchronized' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], components: [row] });

    } else if (action === 'tambah') {
      const title = interaction.options.getString('judul');
      if (!title) {
        return interaction.reply({ content: '❌ Harap sebutkan judul tugas yang ingin ditambahkan!', flags: 64 });
      }
      const category = interaction.options.getString('kategori') || 'General';
      const task = createTodo(title, category, 'Medium', null, '', interaction.user.id, userName);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 Lihat di Web Dashboard')
          .setStyle(ButtonStyle.Link)
          .setURL(TODO_DASHBOARD_URL)
      );

      return interaction.reply({
        content: `✅ **Tugas Berhasil Ditambahkan!** (\`${task.id}\`)\n📌 **Judul:** ${task.title}\n🏷️ **Kategori:** \`${task.category}\` • Prioritas: \`${task.priority}\``,
        components: [row]
      });

    } else if (action === 'selesai') {
      const id = interaction.options.getString('id');
      if (!id) {
        return interaction.reply({ content: '❌ Harap masukkan ID Tugas (contoh: `TASK-101`) yang ingin ditandai selesai!', flags: 64 });
      }
      const task = toggleTodoStatus(id);
      if (!task) {
        return interaction.reply({ content: `❌ Tugas dengan ID \`${id}\` tidak ditemukan.`, flags: 64 });
      }
      return interaction.reply({
        content: `✅ Tugas **${task.title}** (\`${task.id}\`) sekarang berstatus: **${task.status.toUpperCase()}**!`
      });

    } else if (action === 'hapus') {
      const id = interaction.options.getString('id');
      if (!id) {
        return interaction.reply({ content: '❌ Harap masukkan ID Tugas yang ingin dihapus!', flags: 64 });
      }
      const deleted = deleteTodo(id);
      return interaction.reply({
        content: deleted
          ? `🗑️ Tugas dengan ID \`${id}\` berhasil dihapus!`
          : `❌ Tugas dengan ID \`${id}\` tidak ditemukan.`
      });
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
  } else if (value === 'cat_activity') {
    embed
      .setTitle('🎮 Aktivitas Voice Channel & Pemutaran Musik')
      .setDescription('AZURA mendukung sesi kebersamaan dan hiburan di Voice Channel:')
      .addFields(
        { name: '📺 /activity jenis:youtube', value: 'Luncurkan sesi **YouTube Watch Together (Nobar)** tersinkronisasi langsung di Voice Channel.' },
        { name: '♟️ /activity jenis:chess', value: 'Mainkan game **Chess in the Park (Catur)** bersama teman di Voice Channel.' },
        { name: '🎨 /activity jenis:sketch', value: 'Game tebak gambar interaktif **Sketch Heads** (ala Gartic) di Voice Channel.' },
        { name: '🔤 /activity jenis:letterleague', value: 'Game susun kata resmi Discord **Letter League (Wordle-style)** di Voice Channel.' },
        { name: '🎵 Pemutaran Lagu Langsung di VC', value: 'Cukup ketik di chat *"Ara setel lagu [judul]"* atau *"putar musik [judul]"*, AZURA langsung memutar audionya ke Voice Channel!' }
      );
  } else if (value === 'cat_feedback') {
    embed
      .setTitle('💡 Advice & Report System (Rahasia & Ephemeral)')
      .setDescription('Sampaikan ide atau laporkan kendala teknis langsung ke Creator:')
      .addFields(
        { name: '💡 /report kategori:Advice pesan:<...>', value: 'Kirim saran dan masukan pengembangan AZURA secara privat ke DM Creator (Attila).' },
        { name: '🐛 /report kategori:Report pesan:<...>', value: 'Laporkan bug, error, atau kendala teknis secara rahasia (bisa melampirkan screenshot).' },
        { name: '🔒 Jaminan Kerahasiaan Penuh', value: 'Semua masukan/laporan bersifat rahasia, terenkripsi, dan balasan AZURA hanya bisa dilihat oleh kamu (*Ephemeral*).' }
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
        { name: '🔄 /reset (Khusus di DM)', value: 'Mereset riwayat percakapan sesi DM kamu dengan AZURA.' }
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
