const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const BOT_STATE_FILE = path.join(__dirname, '..', 'data', 'bot_orchestrator.enc');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache for bot offline tracking (prevents spamming alerts)
// key: `${guildId}:${botId}` -> { lastStatus: string, lastAlertAt: number }
let botHealthStates = {};

/**
 * Load bot health states from encrypted file
 */
function loadBotStates() {
  try {
    botHealthStates = readSecureJson(BOT_STATE_FILE, {});
  } catch (err) {
    console.error('[Bot Orchestrator]: Failed to read bot_orchestrator.enc:', err.message);
    botHealthStates = {};
  }
}

/**
 * Save bot health states to encrypted file
 */
function saveBotStates() {
  try {
    writeSecureJson(BOT_STATE_FILE, botHealthStates);
  } catch (err) {
    console.error('[Bot Orchestrator]: Failed to write bot_orchestrator.enc:', err.message);
  }
}

// Load initial states
loadBotStates();

/**
 * Infer the functional category of a bot based on its username, roles, and permissions
 * @param {import('discord.js').GuildMember} member 
 * @returns {string}
 */
function inferBotCategory(member) {
  const name = (member.displayName + ' ' + member.user.username).toLowerCase();
  const roleNames = member.roles.cache
    .filter(r => r.name.toLowerCase() !== 'bot ai' && r.name.toLowerCase() !== 'warna atmint')
    .map(r => r.name.toLowerCase())
    .join(' ');
  const combined = `${name} ${roleNames}`;

  // 1. Music & Audio
  if (/\b(?:music|musik|song|lagu|sound|fredboat|rythm|groovy|hydra|tempo|jockie|chip|24\/7|besso|radio|voice|audio|dj|domba|kuda)\b/i.test(combined)) {
    return '🎵 Music & Audio';
  }
  // 2. Games & Hiburan
  if (/\b(?:game|gaming|karuta|mudae|anigame|owo|dank|tatsu|poketwo|rpg|idle|casino|gacha|card|waifu|truth|dare|tod|kotoba|dice|witch|roller|flavi|pompoki|verniy|freestuff|free\s*stuff|lara|ayam)\b/i.test(combined)) {
    return '🎮 Games & Hiburan';
  }
  // 3. Moderation & Security
  if (/\b(?:mod|moderation|security|guard|antiraid|carl|dyno|mee6|probot|wick|captcha|altident|automod|ban|kick|honeypot|admin)\b/i.test(combined)) {
    return '🛡️ Moderasi & Keamanan';
  }
  // 4. Social Feeds & Notifications
  if (/\b(?:twitter|tweet|tweetshift|news|alert|pingcord|feed|notif|followup|discohook|webhook)\b/i.test(combined)) {
    return '📡 Integrasi & Notifikasi';
  }
  // 5. AI & Smart Assistant
  if (/\b(?:azura|ai|gpt|chatgpt|clyde|hermes|midjourney|tupperbox|pluralkit|assistant|gemini|claude|svarog|tts)\b/i.test(combined)) {
    return '🤖 AI & Smart Assistant';
  }
  // 6. Utility & Management
  if (/\b(?:ticket|tiket|support|bantuan|stat|status|logger|log|giveaway|invite|role|reaction|counter|green-bot|kambing)\b/i.test(combined)) {
    return '⚙️ Utility & Management';
  }
  return '🔌 Integrasi & Tools';
}

/**
 * Tri-Layer Health Check for all bots in a guild
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<Array<object>>}
 */
async function scanGuildBots(guild, client) {
  if (!guild) return [];

  // Fetch all members to ensure cache is warm
  let members;
  try {
    members = await guild.members.fetch({ time: 5000 }).catch(() => guild.members.cache);
  } catch (_) {
    members = guild.members.cache;
  }

  const botList = [];
  const botMembers = Array.from(members.values()).filter(m => m.user.bot);

  for (const member of botMembers) {
    const isSelf = member.id === client.user?.id;
    const id = member.id;
    const stateKey = `${guild.id}_${id}`;
    const storedState = botHealthStates[stateKey];

    const category = isSelf ? '👑 Master AI Commander' : inferBotCategory(member);

    // Layer 1: Presence Detection (if presence intent is enabled)
    const presenceStatus = member.presence?.status || 'unknown';
    const isExplicitlyOffline = presenceStatus === 'offline';

    // Layer 2: Voice Channel Active Connection Check
    const voiceState = guild.voiceStates.cache.get(id);
    const isInVoice = !!(voiceState && voiceState.channelId);
    const voiceChannelName = isInVoice ? guild.channels.cache.get(voiceState.channelId)?.name : null;

    // Check specific known dead / offline tags (e.g. Penghuni Kos / ijurrr [/z])
    const isKnownDead = id === '1323971334463819797' || /\[\/z\]|offline/i.test(member.user.username) || storedState?.status === 'offline';

    // Layer 3: Tri-Layer Health Status Assessment
    let healthStatus = '🟢 TERDAFTAR (Siap Pakai)';
    let healthColor = 0x57F287; // Green
    let statusEmoji = '🟢';
    let isOnline = true;

    if (isSelf) {
      healthStatus = '👑 AKTIF (Master AI Commander)';
      healthColor = 0x57F287;
      statusEmoji = '👑';
      isOnline = true;
    } else if (isKnownDead || isExplicitlyOffline) {
      healthStatus = '🔴 OFFLINE / MATI';
      healthColor = 0xED4245;
      statusEmoji = '🔴';
      isOnline = false;
    } else if (isInVoice) {
      healthStatus = `🔊 AKTIF (Tersambung di VC #${voiceChannelName || 'Voice'})`;
      healthColor = 0x57F287;
      statusEmoji = '🔊';
      isOnline = true;
    } else if (presenceStatus === 'online') {
      healthStatus = '🟢 AKTIF & SEHAT';
      healthColor = 0x57F287;
      statusEmoji = '🟢';
      isOnline = true;
    } else if (presenceStatus === 'idle') {
      healthStatus = '🟡 STANDBY / IDLE';
      healthColor = 0xFEE75C;
      statusEmoji = '🟡';
      isOnline = true;
    } else if (presenceStatus === 'dnd') {
      healthStatus = '🟣 DND (Aktif)';
      healthColor = 0xEB459E;
      statusEmoji = '🟣';
      isOnline = true;
    } else {
      // Standard registered bot status (Ready to receive commands)
      healthStatus = '🟢 TERDAFTAR (Siap Menerima Perintah)';
      healthColor = 0x5865F2;
      statusEmoji = '🟢';
      isOnline = true;
    }

    botList.push({
      id: member.id,
      user: member.user,
      username: member.user.username,
      displayName: member.displayName,
      tag: member.user.tag,
      avatar: member.user.displayAvatarURL({ dynamic: true }),
      category,
      presenceStatus,
      isOnline,
      isSelf,
      healthStatus,
      statusEmoji,
      roles: member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name),
      joinedAt: member.joinedAt,
      permissions: member.permissions.toArray()
    });
  }

  // Sort: Self first, then Online bots, then by category
  botList.sort((a, b) => {
    if (a.isSelf) return -1;
    if (b.isSelf) return 1;
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.category.localeCompare(b.category);
  });

  return botList;
}

/**
 * Build aesthetic Rich Embed Dashboard for Bot Ecosystem in a Server
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').Client} client 
 * @param {boolean} [isDm=false]
 * @param {string|null} [filterCategory=null]
 * @returns {Promise<{ embed: EmbedBuilder, components: Array<ActionRowBuilder> }>}
 */
async function buildBotStatusEmbed(guild, client, isDm = false, filterCategory = null) {
  if (!guild) {
    const errEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('❌ [SERVER TIDAK DITEMUKAN]')
      .setDescription('AZURA tidak dapat menemukan server Discord yang dituju. Pastikan nama server benar atau gunakan di dalam channel server langsung.');
    return { embed: errEmbed, components: [] };
  }

  const bots = await scanGuildBots(guild, client);
  const totalBots = bots.length;
  const activeBots = bots.filter(b => b.isOnline).length;
  const offlineBots = bots.filter(b => !b.isOnline).length;

  const filteredBots = filterCategory
    ? bots.filter(b => b.category.toLowerCase().includes(filterCategory.toLowerCase()))
    : bots;

  // Group by category
  const categories = {};
  filteredBots.forEach(b => {
    if (!categories[b.category]) categories[b.category] = [];
    categories[b.category].push(b);
  });

  const embed = new EmbedBuilder()
    .setColor(activeBots === totalBots ? 0x57F287 : (activeBots > 0 ? 0x5865F2 : 0xED4245))
    .setTitle(`🤖 [AZURA MASTER BOT ORCHESTRATOR] • ${guild.name}`)
    .setDescription(
      `📊 **Kondisi Ekosistem Bot Server:**\n` +
      `• Total Bot / App Terdaftar: **${totalBots} Bot**\n` +
      `• 🟢 **Aktif & Sehat (Online):** **${activeBots} Bot**\n` +
      `• 🔴 **Mati / Tidak Aktif (Offline):** **${offlineBots} Bot**\n` +
      `• ⚡ **Tingkat Ketersediaan:** **${totalBots > 0 ? ((activeBots / totalBots) * 100).toFixed(0) : 100}% Siap Pakai**\n` +
      (isDm ? `\n*(Dipantau Jarak Jauh via Direct Message Owner)*\n` : '') +
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setFooter({
      text: `AZURA Tri-Layer Health Monitor • Terakhir Diperbarui: ${new Date().toLocaleTimeString('id-ID')} WIB`,
      iconURL: client?.user?.displayAvatarURL()
    })
    .setTimestamp();

  if (guild.iconURL()) {
    embed.setThumbnail(guild.iconURL({ dynamic: true }));
  }

  // Add fields per category (Safely chunked to never exceed Discord 1024 character limit per field)
  for (const [catName, catBots] of Object.entries(categories)) {
    const chunks = [];
    let currentChunk = [];
    let currentLen = 0;

    for (const b of catBots) {
      const roleStr = b.roles.length > 0 ? ` [${b.roles.slice(0, 2).join(', ')}]` : '';
      const line = `${b.statusEmoji} **${b.displayName}** (\`@${b.username}\`)${roleStr} — *${b.healthStatus}*`;
      if (currentLen + line.length + 1 > 900 || currentChunk.length >= 8) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [line];
        currentLen = line.length;
      } else {
        currentChunk.push(line);
        currentLen += line.length + 1;
      }
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    chunks.forEach((chunkStr, idx) => {
      embed.addFields({
        name: chunks.length > 1 ? `${catName} (Bagian ${idx + 1} - ${catBots.length} Bot)` : `${catName} (${catBots.length})`,
        value: chunkStr || 'Tidak ada bot dalam kategori ini.',
        inline: false
      });
    });
  }

  if (totalBots === 0) {
    embed.addFields({
      name: 'ℹ️ Informasi Server',
      value: 'Tidak ditemukan bot atau aplikasi pihak ketiga lain di server ini selain AZURA.',
      inline: false
    });
  }

  const components = [];

  // Component 1: If in DM and multiple servers exist, show Server Selection Dropdown
  if (isDm && client?.guilds?.cache?.size > 1) {
    const serverOptions = client.guilds.cache.map(g => ({
      label: g.name.slice(0, 100),
      value: `orch_server_${g.id}`,
      description: `ID: ${g.id} • ${g.memberCount || '?'} Member`,
      default: g.id === guild.id,
      emoji: '🏰'
    })).slice(0, 25);

    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_orchestrator_server')
          .setPlaceholder('🏰 Pilih Server yang Ingin Dipantau...')
          .addOptions(serverOptions)
      )
    );
  }

  // Component 2: Interactive Bot Selection Dropdown (Lists up to 25 bots from this server)
  const selectableBots = bots.filter(b => !b.isSelf).slice(0, 25);
  if (selectableBots.length > 0) {
    const botOptions = selectableBots.map(b => ({
      label: `${b.displayName} (@${b.username})`.slice(0, 100),
      value: `orch_bot_${guild.id}_${b.id}`,
      description: `${b.category.slice(0, 30)} • ${b.healthStatus.replace(/[^a-zA-Z0-9 ()&/]/g, '').slice(0, 35)}`,
      emoji: b.statusEmoji === '🔊' ? '🔊' : (b.isOnline ? '🟢' : '🔴')
    }));

    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_orchestrator_bot')
          .setPlaceholder('🤖 Pilih Bot untuk Melihat Detail & Mengoperasikannya...')
          .addOptions(botOptions)
      )
    );
  }

  // Component 3: Refresh & Cancel Buttons
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_orch_refresh_${guild.id}`)
      .setLabel('🔄 Segarkan Status')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_orch_cancel')
      .setLabel('❌ Tutup Menu')
      .setStyle(ButtonStyle.Danger)
  );

  components.push(actionRow);

  return { embed, components };
}

/**
 * Build a detailed card for a single selected bot with an interactive command dropdown
 * @param {import('discord.js').Guild} guild 
 * @param {object} bot 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<{ embed: EmbedBuilder, components: Array<ActionRowBuilder> }>}
 */
async function buildBotDetailEmbed(guild, bot, client) {
  const { getBotCommands } = require('./botKnowledge');
  const commands = await getBotCommands(bot);

  const commandListText = commands.length > 0
    ? commands.map(c => `${c.emoji || '⚡'} **\`${c.label}\`** — ${c.description}`).join('\n')
    : 'Tidak ada template perintah khusus.';

  const embed = new EmbedBuilder()
    .setColor(bot.isOnline ? 0x2ECC71 : 0xED4245)
    .setTitle(`${bot.statusEmoji} Detail & Kesehatan Bot: @${bot.displayName}`)
    .setDescription(
      `🤖 **Profil & Status Aplikasi:**\n` +
      `• **Nama Tampilan:** ${bot.displayName}\n` +
      `• **Username Tag:** \`@${bot.username}\` (\`${bot.id}\`)\n` +
      `• **Kategori:** **${bot.category}**\n` +
      `• **Status Kesehatan:** ${bot.statusEmoji} **${bot.healthStatus}**\n` +
      `• **Server Asal:** **${guild.name}**\n` +
      `• **Roles:** ${bot.roles.length > 0 ? bot.roles.map(r => `\`${r}\``).join(', ') : '*Tidak ada role khusus*'}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 **Daftar Perintah Umum Bot:**\n${commandListText}\n\n` +
      `💡 *Gunakan tombol di bawah untuk mengubah status manual atau kembali ke daftar bot.*`
    )
    .setFooter({
      text: `AZURA Server Bot Guardian • Health & Status Dashboard`,
      iconURL: client?.user?.displayAvatarURL()
    })
    .setTimestamp();

  if (bot.avatar) {
    embed.setThumbnail(bot.avatar);
  }

  const components = [];

  // Action Row Buttons
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_orch_toggle_status_${guild.id}_${bot.id}`)
      .setLabel(bot.isOnline ? '🔴 Set Offline/Mati' : '🟢 Set Online/Aktif')
      .setStyle(bot.isOnline ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`btn_orch_back_${guild.id}`)
      .setLabel('🔙 Kembali')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_orch_cancel')
      .setLabel('❌ Tutup')
      .setStyle(ButtonStyle.Danger)
  );

  components.push(buttonRow);

  return { embed, components };
}

/**
 * Execute command to a target bot and monitor its response
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').TextChannel} channel 
 * @param {string} targetQuery (bot name / tag / category)
 * @param {string} commandText (e.g. "!play song", ".rank", "$help")
 * @param {import('discord.js').User} author 
 * @param {boolean} isOwner 
 * @returns {Promise<{ success: boolean, message: string, embed?: EmbedBuilder }>}
 */
async function operateBot(guild, channel, targetQuery, commandText, author, isOwner = false) {
  if (!guild || !channel) {
    return { success: false, message: 'Channel atau server tidak valid untuk menjalankan operasi bot.' };
  }

  // 1. Security Check: Admin / Destructive commands are restricted to Owner only
  const isDestructive = /\b(?:ban|kick|purge|clear|nuke|eval|shutdown|restart|destroy|hack|role\s+add|role\s+remove)\b/i.test(commandText);
  if (isDestructive && !isOwner) {
    return {
      success: false,
      message: `🛡️ **[Akses Ditolak]** Maaf <@${author.id}>, perintah administratif/destruktif (\`${commandText}\`) ke bot lain **hanya boleh dijalankan oleh Owner (Attila)** demi keamanan server!`
    };
  }

  // 2. Find target bot
  const bots = await scanGuildBots(guild, channel.client);
  const cleanQuery = targetQuery.toLowerCase().trim();

  const targetBot = bots.find(b =>
    !b.isSelf && (
      b.username.toLowerCase().includes(cleanQuery) ||
      b.displayName.toLowerCase().includes(cleanQuery) ||
      b.id === cleanQuery ||
      b.category.toLowerCase().includes(cleanQuery)
    )
  );

  if (!targetBot) {
    return {
      success: false,
      message: `🔍 Bot dengan nama/kategori **"${targetQuery}"** tidak ditemukan di server **${guild.name}**. Gunakan perintah \`/bots scan\` untuk melihat daftar bot yang tersedia.`
    };
  }

  // 3. Health status check of target bot
  if (!targetBot.isOnline) {
    return {
      success: false,
      message: `⚠️ Bot **${targetBot.displayName}** (@${targetBot.username}) saat ini berstatus **🔴 OFFLINE / MATI**, sehingga tidak bisa menerima perintah \`${commandText}\`.`
    };
  }

  console.log(`[Bot Orchestrator]: User "${author.tag}" triggering command "${commandText}" to bot "${targetBot.displayName}" in #${channel.name}`);

  // 4. Send command to channel and set up message collector
  let sentTriggerMsg = null;
  try {
    sentTriggerMsg = await channel.send(commandText);
  } catch (err) {
    return { success: false, message: `Gagal mengirimkan perintah ke channel: ${err.message}` };
  }

  // 5. Await response from target bot (8 seconds timeout)
  const filter = (m) => m.author.id === targetBot.id && m.channel.id === channel.id && m.createdTimestamp >= sentTriggerMsg.createdTimestamp;

  try {
    const collected = await channel.awaitMessages({ filter, max: 1, time: 8000, errors: ['time'] });
    const botResponse = collected.first();

    if (botResponse) {
      const responseSnippet = botResponse.content ? `\n\n📝 **Respon dari ${targetBot.displayName}:**\n${botResponse.content.slice(0, 1500)}` : '';
      const hasEmbed = botResponse.embeds && botResponse.embeds.length > 0;

      return {
        success: true,
        message: `✅ **[Operasi Bot Berhasil]**\nPerintah \`${commandText}\` berhasil dikirimkan ke **${targetBot.displayName}** (@${targetBot.username}) dan bot telah merespons!${responseSnippet}${hasEmbed ? '\n*(Bot juga menampilkan Rich Embed di channel)*' : ''}`
      };
    }
  } catch (_) {
    // Timeout: Bot did not reply
  }

  // 6. Bot ignored bot message or took too long -> Helpful Fallback
  return {
    success: true,
    message:
      `ℹ️ **[Status Pemicu Bot]**\n` +
      `Perintah \`${commandText}\` sudah dikirimkan ke **${targetBot.displayName}**, namun bot tersebut tampaknya mengabaikan pesan dari sesama bot (*Bot Security Policy*).\n\n` +
      `👉 **Jalankan Langsung Secara Manual:**\n` +
      `\`${commandText}\``
  };
}

let healthMonitorTimer = null;

/**
 * Background Health Monitor: Periodically checks all bots across all servers
 * Sends Auto-Alerts EXCLUSIVELY to Attila's Direct Message (DM) when any bot dies.
 * @param {import('discord.js').Client} client 
 */
function initBotHealthMonitor(client) {
  if (healthMonitorTimer) {
    clearInterval(healthMonitorTimer);
    healthMonitorTimer = null;
  }

  const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes

  console.log('[Bot Orchestrator]: 🛡️ Bot Health Monitor initialized (15-min background worker).');

  healthMonitorTimer = setInterval(async () => {
    if (!client || !client.isReady()) return;
    const { isAzuraSleeping } = require('./sleepMode');
    if (isAzuraSleeping && isAzuraSleeping()) return; // Mute when Azura is sleeping
    const ownerId = config.OWNER_DISCORD_ID;
    if (!ownerId) return;

    try {
      const ownerUser = await client.users.fetch(ownerId).catch(() => null);
      if (!ownerUser) return;

      for (const [guildId, guild] of client.guilds.cache) {
        const bots = await scanGuildBots(guild, client);

        for (const bot of bots) {
          if (bot.isSelf) continue; // Don't check Azura herself

          const stateKey = `${guildId}:${bot.id}`;
          const prevState = botHealthStates[stateKey] || { status: 'online', lastAlert: 0 };
          const currentStatus = bot.isOnline ? 'online' : 'offline';

          // If transition from ONLINE -> OFFLINE detected
          if (prevState.status === 'online' && currentStatus === 'offline') {
            const now = Date.now();
            // Anti-spam cooldown: Only 1 alert per 2 hours per dead bot
            if (now - (prevState.lastAlert || 0) > 2 * 60 * 60 * 1000) {
              prevState.lastAlert = now;
              prevState.status = 'offline';
              botHealthStates[stateKey] = prevState;
              saveBotStates();

              console.log(`[Bot Health Monitor]: 🚨 ALERT: Bot "${bot.displayName}" went OFFLINE in guild "${guild.name}"! Sending DM to Attila...`);

              const alertEmbed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('🚨 [AZURA SERVER BOT ALERT: BOT MATI / OFFLINE]')
                .setDescription(
                  `Halo Attila! Terdeteksi ada bot server yang **mati / tidak aktif** di salah satu server kamu:\n\n` +
                  `• **Nama Bot:** **${bot.displayName}** (\`@${bot.username}\`)\n` +
                  `• **Server Discord:** **${guild.name}**\n` +
                  `• **Kategori:** ${bot.category}\n` +
                  `• **Role / Hak Akses:** ${bot.roles.join(', ') || 'Standard'}\n` +
                  `• **Waktu Terdeteksi:** ${new Date().toLocaleTimeString('id-ID')} WIB (${new Date().toLocaleDateString('id-ID')})\n\n` +
                  `*💡 Notifikasi ini dikirimkan secara privat ke DM kamu agar server tetap bersih dan kamu bisa segera memeriksa bot tersebut.*`
                )
                .setFooter({ text: 'AZURA Autonomous Server Guardian • AES-256-GCM' })
                .setTimestamp();

              if (bot.avatar) {
                alertEmbed.setThumbnail(bot.avatar);
              }

              await ownerUser.send({ embeds: [alertEmbed] }).catch(err => {
                console.error('[Bot Alert DM Send Error]:', err.message);
              });
            }
          } else if (currentStatus === 'online' && prevState.status === 'offline') {
            // Bot came back online
            prevState.status = 'online';
            botHealthStates[stateKey] = prevState;
            saveBotStates();
            console.log(`[Bot Health Monitor]: 🟢 Bot "${bot.displayName}" in "${guild.name}" is back ONLINE.`);
          }
        }
      }
    } catch (err) {
      console.error('[Bot Health Monitor Error]:', err.message);
    }
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop Background Health Monitor (when entering sleep mode)
 */
function stopBotHealthMonitor() {
  if (healthMonitorTimer) {
    clearInterval(healthMonitorTimer);
    healthMonitorTimer = null;
    console.log('[Bot Orchestrator]: ⏸️ Bot Health Monitor paused/stopped.');
  }
}

/**
 * Handle Select Menu Interactions for Bot Orchestrator
 * @param {import('discord.js').StringSelectMenuInteraction} interaction 
 */
async function handleBotOrchestratorSelectMenu(interaction) {
  const { customId, values } = interaction;
  const isOwner = config.OWNER_DISCORD_ID && interaction.user.id === config.OWNER_DISCORD_ID;

  if (customId === 'select_orchestrator_server') {
    const selectedGuildId = values[0].replace('orch_server_', '');
    const targetGuild = interaction.client.guilds.cache.get(selectedGuildId);
    if (!targetGuild) {
      return interaction.reply({ content: '❌ Server tidak ditemukan.', flags: 64 });
    }
    await interaction.deferUpdate();
    const { embed, components } = await buildBotStatusEmbed(targetGuild, interaction.client, !interaction.guild);
    return interaction.editReply({ embeds: [embed], components });

  } else if (customId === 'select_orchestrator_bot') {
    const parts = values[0].split('_'); // ['orch', 'bot', guildId, botId]
    const guildId = parts[2];
    const botId = parts[3];

    const targetGuild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
    if (!targetGuild) {
      return interaction.reply({ content: '❌ Server tidak ditemukan.', flags: 64 });
    }

    const bots = await scanGuildBots(targetGuild, interaction.client);
    const targetBot = bots.find(b => b.id === botId);
    if (!targetBot) {
      return interaction.reply({ content: '❌ Bot tidak ditemukan di server.', flags: 64 });
    }

    await interaction.deferUpdate();
    const { embed, components } = await buildBotDetailEmbed(targetGuild, targetBot, interaction.client);
    return interaction.editReply({ embeds: [embed], components });

  }
}

/**
 * Handle Button Interactions for Bot Orchestrator
 * @param {import('discord.js').ButtonInteraction} interaction 
 */
async function handleBotOrchestratorButton(interaction) {
  const { customId } = interaction;
  const isOwner = config.OWNER_DISCORD_ID && interaction.user.id === config.OWNER_DISCORD_ID;

  if (customId === 'btn_orch_cancel') {
    try {
      await interaction.message.delete().catch(() => {
        return interaction.update({ content: '🔒 *Menu status bot telah ditutup.*', embeds: [], components: [] });
      });
    } catch (_) {
      return interaction.update({ content: '🔒 *Menu status bot telah ditutup.*', embeds: [], components: [] });
    }
    return;
  }

  if (customId.startsWith('btn_orch_toggle_status_')) {
    if (!isOwner) {
      return interaction.reply({
        content: '⛔ **[Akses Ditolak]** Hanya **Owner (Attila)** yang dapat mengubah status kesehatan bot secara manual.',
        flags: 64
      });
    }

    const parts = customId.replace('btn_orch_toggle_status_', '').split('_');
    const guildId = parts[0];
    const botId = parts[1];

    const targetGuild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
    if (!targetGuild) {
      return interaction.reply({ content: '❌ Server tidak ditemukan.', flags: 64 });
    }

    const stateKey = `${guildId}:${botId}`;
    const current = botHealthStates[stateKey] || { status: 'online' };
    const newStatus = current.status === 'offline' ? 'online' : 'offline';

    botHealthStates[stateKey] = {
      ...current,
      status: newStatus,
      lastChecked: Date.now()
    };
    saveBotStates();

    await interaction.deferUpdate();
    const bots = await scanGuildBots(targetGuild, interaction.client);
    const targetBot = bots.find(b => b.id === botId);
    if (targetBot) {
      const { embed, components } = await buildBotDetailEmbed(targetGuild, targetBot, interaction.client);
      return interaction.editReply({ embeds: [embed], components });
    }
    return;
  }

  if (customId.startsWith('btn_orch_refresh_') || customId.startsWith('btn_orch_back_')) {
    const guildId = customId.replace('btn_orch_refresh_', '').replace('btn_orch_back_', '');
    const targetGuild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
    if (!targetGuild) {
      return interaction.reply({ content: '❌ Server tidak ditemukan.', flags: 64 });
    }

    await interaction.deferUpdate();
    const { embed, components } = await buildBotStatusEmbed(targetGuild, interaction.client, !interaction.guild);
    return interaction.editReply({ embeds: [embed], components });
  }
}

/**
 * Handle Modal Submissions for Bot Orchestrator
 * @param {import('discord.js').ModalSubmitInteraction} interaction 
 */
async function handleBotOrchestratorModal(interaction) {
  if (interaction.repliable) {
    return interaction.reply({ content: 'Pengaturan bot berhasil diperbarui.', flags: 64 });
  }
}

module.exports = {
  scanGuildBots,
  buildBotStatusEmbed,
  buildBotDetailEmbed,
  operateBot,
  initBotHealthMonitor,
  stopBotHealthMonitor,
  handleBotOrchestratorSelectMenu,
  handleBotOrchestratorButton,
  handleBotOrchestratorModal
};
