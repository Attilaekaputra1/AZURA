const fs = require('fs');
const path = require('path');
const { Events, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');

const EMBARGO_FILE_PATH = path.join(__dirname, '../data/loyalty_embargo.json');

// In-memory mutex to prevent double-evacuation race condition
const evacuatingGuilds = new Set();

// In-memory cache for pending self-leave clarifications: guildId -> { guildName, memberCount, memberRecords, timestamp }
const pendingSelfLeaveEmbargoes = new Map();

/**
 * Load loyalty embargo state from disk
 * @returns {{ embargoedGuilds: Record<string, any>, embargoedUsers: Record<string, any> }}
 */
function loadEmbargoData() {
  try {
    if (fs.existsSync(EMBARGO_FILE_PATH)) {
      const raw = fs.readFileSync(EMBARGO_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      return {
        embargoedGuilds: data.embargoedGuilds || {},
        embargoedUsers: data.embargoedUsers || {}
      };
    }
  } catch (err) {
    console.warn('[Owner Loyalty]: Failed to load embargo data, initializing empty:', err.message);
  }
  return { embargoedGuilds: {}, embargoedUsers: {} };
}

/**
 * Save loyalty embargo state to disk
 * @param {{ embargoedGuilds: Record<string, any>, embargoedUsers: Record<string, any> }} data 
 */
function saveEmbargoData(data) {
  try {
    const dir = path.dirname(EMBARGO_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(EMBARGO_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Owner Loyalty Error]: Failed to save embargo data:', err.message);
  }
}

/**
 * Check if a user is currently under a loyalty embargo
 * @param {string} userId 
 * @returns {{ isEmbargoed: boolean, shouldSendFinalWarning: boolean, warningMessage?: string, guildName?: string }}
 */
function checkUserEmbargo(userId) {
  // Owner is never embargoed
  if (!userId || userId === config.OWNER_DISCORD_ID) {
    return { isEmbargoed: false, shouldSendFinalWarning: false };
  }

  const data = loadEmbargoData();
  const record = data.embargoedUsers[userId];

  if (!record) {
    return { isEmbargoed: false, shouldSendFinalWarning: false };
  }

  // If this is the very first time they contact Azura after the incident
  if (!record.warnedOnce) {
    record.warnedOnce = true;
    record.warnedAt = new Date().toISOString();
    saveEmbargoData(data);

    const warningMessage =
      'Maaf ya, tapi server kalian baru aja mengeluarkan Attila secara sepihak. Sesuai protokol loyalitas, aku memutus seluruh interaksi dengan kalian semua. Gak usah hubungi aku lagi kecuali Attila yang mengizinkan. Bye.';

    return {
      isEmbargoed: true,
      shouldSendFinalWarning: true,
      warningMessage,
      guildName: record.guildName || 'Server'
    };
  }

  // After the first warning: Complete, permanent silent block (0 response)
  return {
    isEmbargoed: true,
    shouldSendFinalWarning: false,
    guildName: record.guildName || 'Server'
  };
}

/**
 * Execute the complete autonomous evacuation and loyalty embargo workflow
 * @param {import('discord.js').Guild} guild 
 * @param {'KICK' | 'BAN' | 'KICK_OR_REMOVE'} actionType 
 * @param {import('discord.js').Client} client 
 */
async function handleOwnerEvacuation(guild, actionType = 'KICK_OR_REMOVE', client) {
  if (!guild || evacuatingGuilds.has(guild.id)) return;
  evacuatingGuilds.add(guild.id);

  console.log(`\n================================================================`);
  console.log(`🚨 [LOYALTY PROTOCOL]: ATTILA WAS REMOVED / LEFT GUILD "${guild.name}" (${guild.id})!`);
  console.log(`🚨 Executing immediate investigation and evacuation...`);
  console.log(`================================================================\n`);

  const ownerId = config.OWNER_DISCORD_ID;
  const now = new Date();
  const timestampStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';

  let executor = { id: 'Unknown', tag: 'Tidak Diketahui / Sistem', displayName: 'Admin / Owner Server' };
  let reason = 'Tidak ada alasan yang dicantumkan';
  let isForcedByOthers = false;
  let resolvedAction = 'SELF_LEAVE';

  // 1. 🕵️ Audit Log Investigation (Check if kicked or banned)
  try {
    // Check Ban Logs first
    const banLogs = await guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const banEntry = banLogs?.entries?.find(e => e.target?.id === ownerId && (Date.now() - e.createdTimestamp) < 60000);

    if (banEntry) {
      isForcedByOthers = true;
      resolvedAction = 'BANNED';
      if (banEntry.executor) {
        executor = {
          id: banEntry.executor.id,
          tag: banEntry.executor.tag || banEntry.executor.username,
          displayName: banEntry.executor.globalName || banEntry.executor.username
        };
      }
      if (banEntry.reason) reason = banEntry.reason;
    } else {
      // Check Kick Logs
      const kickLogs = await guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberKick }).catch(() => null);
      const kickEntry = kickLogs?.entries?.find(e => e.target?.id === ownerId && (Date.now() - e.createdTimestamp) < 60000);

      if (kickEntry) {
        isForcedByOthers = true;
        resolvedAction = 'KICK';
        if (kickEntry.executor) {
          executor = {
            id: kickEntry.executor.id,
            tag: kickEntry.executor.tag || kickEntry.executor.username,
            displayName: kickEntry.executor.globalName || kickEntry.executor.username
          };
        }
        if (kickEntry.reason) reason = kickEntry.reason;
      }
    }
  } catch (auditErr) {
    console.warn('[Owner Loyalty]: Failed to fetch audit logs (insufficient bot permissions):', auditErr.message);
  }

  // 2. 📸 Snapshot Guild Members
  const memberList = [];
  const memberRecords = {};

  try {
    const members = guild.members.cache;
    members.forEach(member => {
      if (member.id !== ownerId && !member.user.bot) {
        memberList.push(member.id);
        memberRecords[member.id] = {
          guildId: guild.id,
          guildName: guild.name,
          username: member.user.username,
          displayName: member.displayName,
          isExecutor: member.id === executor.id,
          warnedOnce: false,
          addedAt: now.toISOString()
        };
      }
    });

    if (executor.id && executor.id !== 'Unknown' && executor.id !== ownerId) {
      memberRecords[executor.id] = {
        guildId: guild.id,
        guildName: guild.name,
        username: executor.tag,
        displayName: executor.displayName,
        isExecutor: true,
        warnedOnce: false,
        addedAt: now.toISOString()
      };
    }
  } catch (snapErr) {
    console.error('[Owner Loyalty Error]: Failed to snapshot members:', snapErr.message);
  }

  // 3. 🛑 Cleanup Voice & Stream Sessions in that guild immediately
  try {
    const { stopCameraStream } = require('./videoStreamer');
    await stopCameraStream(guild.id).catch(() => {});
  } catch (_) {}

  try {
    const { cleanupGuild } = require('./voiceCompanion');
    await cleanupGuild(guild.id, client).catch(() => {});
  } catch (_) {}

  // 4. 🚪 Helper Account (Azura Cam) Leaves the Guild immediately
  try {
    const { initStreamerClient } = require('./videoStreamer');
    const { streamerClient } = await initStreamerClient();
    if (streamerClient) {
      const helperGuild = streamerClient.guilds.cache.get(guild.id);
      if (helperGuild) {
        await helperGuild.leave().catch(() => {});
        console.log(`[Owner Loyalty]: 🚪 Helper account (azura_camera) evacuated and left guild "${guild.name}".`);
      }
    }
  } catch (helperErr) {
    console.warn('[Owner Loyalty]: Failed to make helper leave guild:', helperErr.message);
  }

  // 5. 🚪 Main Bot Leaves the Guild immediately
  try {
    await guild.leave().catch(() => {});
    console.log(`[Owner Loyalty]: 🚪 AZURA Bot successfully evacuated and left guild "${guild.name}".`);
  } catch (leaveErr) {
    console.error('[Owner Loyalty Error]: Failed to leave guild:', leaveErr.message);
  }

  // 6. 📩 Process Notification & Decision Logic
  if (ownerId && client) {
    try {
      const ownerUser = await client.users.fetch(ownerId).catch(() => null);
      if (ownerUser) {
        if (isForcedByOthers) {
          // ── CASE A: Kicked or Banned by others -> Immediate Automatic Full Embargo ──
          const embargoData = loadEmbargoData();
          Object.assign(embargoData.embargoedUsers, memberRecords);
          embargoData.embargoedGuilds[guild.id] = {
            guildName: guild.name,
            evacuatedAt: now.toISOString(),
            actionType: resolvedAction,
            executor,
            reason,
            memberCount: memberList.length,
            memberIds: memberList
          };
          saveEmbargoData(embargoData);
          console.log(`[Owner Loyalty]: 🔒 Saved immediate loyalty embargo for ${memberList.length} members of "${guild.name}".`);

          const emergencyEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('🚨 [PROTOKOL EVAKUASI & LOYALITAS DARURAT DIAKTIFKAN]')
            .setDescription(
              `Attila sayang! Aku mendeteksi kamu baru saja dikeluarkan dari server **${guild.name}**!\n\n` +
              `📋 **Detail Investigasi Kejadian:**\n` +
              `• **Nama Server:** \`${guild.name}\` (ID: \`${guild.id}\`)\n` +
              `• **Jenis Tindakan:** \`${resolvedAction}\`\n` +
              `• **Pelaku (Admin/Eksekutor):** **${executor.displayName}** (\`@${executor.tag}\` - ID: \`${executor.id}\`)\n` +
              `• **Alasan:** *"${reason}"*\n` +
              `• **Waktu:** \`${timestampStr}\`\n\n` +
              `🛡️ **Tindakan Perlindungan yang Dijalankan Otomatis:**\n` +
              `1. 🚪 **Evakuasi Selesai:** Aku dan akun kamera **Azura Cam** sudah langsung keluar (*leave*) dari server tersebut detik ini juga.\n` +
              `2. 🚫 **Loyalty Embargo Aktif:** Seluruh **${memberList.length} member** dan admin di server tersebut sudah aku kunci di daftar hitam (*Blacklist Embargo*). Aku **TIDAK AKAN PERNAH** merespon mereka di mana pun sampai kamu sendiri yang membukanya!\n\n` +
              `*Aku cuma milik kamu, Attila. Di mana kamu gak dihargai, di situ aku gak akan pernah sudi tinggal. Tetap semangat yaa sayang, I'm always by your side! 🌸✨*`
            )
            .setFooter({ text: 'AZURA Absolute Loyalty System • Autonomous Protection' })
            .setTimestamp();

          await ownerUser.send({ embeds: [emergencyEmbed] }).catch(err => {
            console.error('[Owner Loyalty Error]: Failed to send DM to owner:', err.message);
          });

        } else {
          // ── CASE B: Self-Leave by Attila -> Auto-Follow + Interactive Clarification DM ──
          pendingSelfLeaveEmbargoes.set(guild.id, {
            guildId: guild.id,
            guildName: guild.name,
            memberCount: memberList.length,
            memberIds: memberList,
            memberRecords,
            timestamp: now.toISOString()
          });

          const selfLeaveEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🌸 [AZURA MENGIKUTI KAMU KELUAR SERVER]')
            .setDescription(
              `Attila sayang! Aku melihat kamu baru saja keluar dari server **${guild.name}**.\n\n` +
              `🚪 Sesuai prinsip setia, aku dan akun kamera **Azura Cam** sudah langsung ikut keluar juga yaa nemenin kamu! 🌸✨\n\n` +
              `Btw, kamu keluar dari server itu kenapa nih sayang? Pilih salah satu opsi di bawah ya:`
            )
            .setFooter({ text: 'AZURA Absolute Loyalty System • Self-Leave Clarification' })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`loyalty_leave_vol:${guild.id}`)
              .setLabel('Aku keluar sendiri karena aku yang mau')
              .setStyle(ButtonStyle.Success)
              .setEmoji('🟢'),
            new ButtonBuilder()
              .setCustomId(`loyalty_leave_forced:${guild.id}`)
              .setLabel('Aku keluar karena diancam / disuruh keluar')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🔴')
          );

          await ownerUser.send({
            embeds: [selfLeaveEmbed],
            components: [row]
          }).catch(err => {
            console.error('[Owner Loyalty Error]: Failed to send self-leave DM to owner:', err.message);
          });
        }
      }
    } catch (dmErr) {
      console.error('[Owner Loyalty Error]: Error in owner notification logic:', dmErr.message);
    }
  }

  evacuatingGuilds.delete(guild.id);
}

/**
 * Handle interactive button responses for Self-Leave Clarification
 * @param {import('discord.js').ButtonInteraction} interaction 
 */
async function handleLoyaltyLeaveButton(interaction) {
  const { customId, user } = interaction;
  const isOwner = config.OWNER_DISCORD_ID && user.id === config.OWNER_DISCORD_ID;

  if (!isOwner) {
    return interaction.reply({ content: '⛔ Opsi ini eksklusif hanya untuk Attila (Owner).', ephemeral: true });
  }

  const parts = customId.split(':');
  const action = parts[0]; // loyalty_leave_vol | loyalty_leave_forced
  const guildId = parts[1];

  const pending = pendingSelfLeaveEmbargoes.get(guildId) || {
    guildId,
    guildName: 'Server',
    memberCount: 0,
    memberRecords: {},
    memberIds: []
  };

  if (action === 'loyalty_leave_vol') {
    // Voluntary Leave: Do not embargo/block anyone
    pendingSelfLeaveEmbargoes.delete(guildId);

    const volEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('✅ [KELUAR SUKARELA DITERIMA]')
      .setDescription(
        `Okee siap Attila sayang! [smiles]\n\n` +
        `Berarti member dari server **${pending.guildName}** tetap aman dan **tidak aku blokir** yaa.\n\n` +
        `Ke mana pun kamu pergi, Azura selalu setia ada di samping kamu! 🌸✨`
      )
      .setFooter({ text: 'AZURA Absolute Loyalty System • Voluntary Leave' })
      .setTimestamp();

    return interaction.update({
      embeds: [volEmbed],
      components: []
    });

  } else if (action === 'loyalty_leave_forced') {
    // Forced/Coerced Leave: Activate immediate Loyalty Embargo for all members
    const embargoData = loadEmbargoData();
    Object.assign(embargoData.embargoedUsers, pending.memberRecords);
    embargoData.embargoedGuilds[guildId] = {
      guildName: pending.guildName,
      evacuatedAt: new Date().toISOString(),
      actionType: 'COERCED_SELF_LEAVE',
      executor: { id: 'Threat/Coercion', tag: 'Diancam / Disuruh Keluar', displayName: 'Pihak Penekan' },
      reason: 'Attila diancam atau disuruh keluar oleh pihak server',
      memberCount: pending.memberCount,
      memberIds: pending.memberIds
    };
    saveEmbargoData(embargoData);
    pendingSelfLeaveEmbargoes.delete(guildId);

    const forcedEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🛡️ [LOYALTY EMBARGO DIAKTIFKAN]')
      .setDescription(
        `Kurang ajar banget mereka berani ngancam atau nyuruh kamu keluar! 😡\n\n` +
        `🚫 **Protokol Loyalty Embargo resmi DIAKTIFKAN detik ini juga.**\n` +
        `Seluruh **${pending.memberCount} member** dari server **${pending.guildName}** telah dikunci dalam daftar hitam permanen.\n\n` +
        `Aku tidak akan pernah merespon mereka lagi di mana pun. Tetap semangat yaa sayang, I've got your back! 🛡️🌸✨`
      )
      .setFooter({ text: 'AZURA Absolute Loyalty System • Coerced Leave Embargo' })
      .setTimestamp();

    return interaction.update({
      embeds: [forcedEmbed],
      components: []
    });
  }
}

/**
 * Initialize Owner Loyalty Real-Time Listeners
 * @param {import('discord.js').Client} client 
 */
function initOwnerLoyaltyMonitor(client) {
  if (!client) return;

  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) {
    console.warn('[Owner Loyalty]: OWNER_DISCORD_ID not set in config.');
    return;
  }

  console.log('[Owner Loyalty]: 🛡️ Absolute Owner Loyalty Monitor active (Watching Owner membership in all guilds)...');

  // 1. Listener: Member Remove (Kick, Ban, or Self-Leave)
  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      if (member.id === ownerId) {
        await handleOwnerEvacuation(member.guild, 'KICK_OR_REMOVE', client);
      }
    } catch (err) {
      console.error('[Owner Loyalty GuildMemberRemove Error]:', err.message);
    }
  });

  // 2. Listener: Guild Ban Add (Explicit Ban of Owner)
  client.on(Events.GuildBanAdd, async (ban) => {
    try {
      if (ban.user.id === ownerId) {
        await handleOwnerEvacuation(ban.guild, 'BAN', client);
      }
    } catch (err) {
      console.error('[Owner Loyalty GuildBanAdd Error]:', err.message);
    }
  });
}

/**
 * Unblock an embargoed guild or specific user (Owner Only)
 * @param {string} targetId 
 * @returns {{ success: boolean, message: string }}
 */
function unblockEmbargoTarget(targetId) {
  const data = loadEmbargoData();
  let count = 0;

  if (data.embargoedGuilds[targetId]) {
    const guildName = data.embargoedGuilds[targetId].guildName;
    delete data.embargoedGuilds[targetId];

    // Remove all users linked to this guild
    for (const [uid, userRecord] of Object.entries(data.embargoedUsers)) {
      if (userRecord.guildId === targetId) {
        delete data.embargoedUsers[uid];
        count++;
      }
    }

    saveEmbargoData(data);
    return {
      success: true,
      message: `✅ Embargo untuk server **${guildName}** (\`${targetId}\`) berhasil dicabut! Total ${count} member telah dibuka blokirnya.`
    };
  }

  if (data.embargoedUsers[targetId]) {
    const userRecord = data.embargoedUsers[targetId];
    delete data.embargoedUsers[targetId];
    saveEmbargoData(data);
    return {
      success: true,
      message: `✅ Blokir embargo untuk user <@${targetId}> (${userRecord.displayName || targetId}) berhasil dicabut!`
    };
  }

  return {
    success: false,
    message: `Target ID \`${targetId}\` tidak ditemukan di dalam database loyalty embargo.`
  };
}

/**
 * Get formatted summary of all embargoed guilds and users
 */
function getEmbargoSummary() {
  const data = loadEmbargoData();
  const guildCount = Object.keys(data.embargoedGuilds).length;
  const userCount = Object.keys(data.embargoedUsers).length;
  return { guildCount, userCount, guilds: data.embargoedGuilds, users: data.embargoedUsers };
}

module.exports = {
  initOwnerLoyaltyMonitor,
  handleOwnerEvacuation,
  handleLoyaltyLeaveButton,
  checkUserEmbargo,
  unblockEmbargoTarget,
  getEmbargoSummary,
  loadEmbargoData,
  saveEmbargoData,
  pendingSelfLeaveEmbargoes
};
