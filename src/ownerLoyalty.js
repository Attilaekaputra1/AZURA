const fs = require('fs');
const path = require('path');
const { Events, AuditLogEvent, EmbedBuilder } = require('discord.js');
const config = require('./config');

const EMBARGO_FILE_PATH = path.join(__dirname, '../data/loyalty_embargo.json');

// In-memory mutex to prevent double-evacuation race condition
const evacuatingGuilds = new Set();

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
  console.log(`🚨 [LOYALTY PROTOCOL]: ATTILA WAS REMOVED FROM GUILD "${guild.name}" (${guild.id})!`);
  console.log(`🚨 Executing immediate investigation, member embargo snapshot, and evacuation...`);
  console.log(`================================================================\n`);

  const ownerId = config.OWNER_DISCORD_ID;
  const now = new Date();
  const timestampStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';

  let executor = { id: 'Unknown', tag: 'Tidak Diketahui / Sistem', displayName: 'Admin / Owner Server' };
  let reason = 'Tidak ada alasan yang dicantumkan';
  let resolvedAction = actionType;

  // 1. 🕵️ Audit Log Investigation
  try {
    // Check Ban Logs first
    const banLogs = await guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const banEntry = banLogs?.entries?.find(e => e.target?.id === ownerId && (Date.now() - e.createdTimestamp) < 60000);

    if (banEntry) {
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

  // 2. 📸 Snapshot Members & Save Loyalty Embargo
  const embargoData = loadEmbargoData();
  const memberList = [];

  try {
    const members = guild.members.cache;
    members.forEach(member => {
      if (member.id !== ownerId && !member.user.bot) {
        memberList.push(member.id);
        embargoData.embargoedUsers[member.id] = {
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

    // Also explicitly ensure executor is in the embargo list
    if (executor.id && executor.id !== 'Unknown' && executor.id !== ownerId) {
      embargoData.embargoedUsers[executor.id] = {
        guildId: guild.id,
        guildName: guild.name,
        username: executor.tag,
        displayName: executor.displayName,
        isExecutor: true,
        warnedOnce: false,
        addedAt: now.toISOString()
      };
    }

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
    console.log(`[Owner Loyalty]: 🔒 Saved loyalty embargo for ${memberList.length} members of "${guild.name}".`);
  } catch (snapErr) {
    console.error('[Owner Loyalty Error]: Failed to snapshot members:', snapErr.message);
  }

  // 3. 📩 Send Emergency Report to Attila DM
  if (ownerId && client) {
    try {
      const ownerUser = await client.users.fetch(ownerId).catch(() => null);
      if (ownerUser) {
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
      }
    } catch (dmErr) {
      console.error('[Owner Loyalty Error]: Error in owner DM notification:', dmErr.message);
    }
  }

  // 4. 🛑 Cleanup Voice & Stream Sessions
  try {
    const { stopCameraStream } = require('./videoStreamer');
    await stopCameraStream(guild.id).catch(() => {});
  } catch (_) {}

  try {
    const { cleanupGuild } = require('./voiceCompanion');
    await cleanupGuild(guild.id, client).catch(() => {});
  } catch (_) {}

  // 5. 🚪 Helper Account (Azura Cam) Leaves the Guild
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

  // 6. 🚪 Main Bot Leaves the Guild
  try {
    await guild.leave().catch(() => {});
    console.log(`[Owner Loyalty]: 🚪 AZURA Bot successfully evacuated and left guild "${guild.name}".`);
  } catch (leaveErr) {
    console.error('[Owner Loyalty Error]: Failed to leave guild:', leaveErr.message);
  } finally {
    evacuatingGuilds.delete(guild.id);
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

  // 1. Listener: Member Remove (Kick, Self-Leave, or Prune)
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
  checkUserEmbargo,
  unblockEmbargoTarget,
  getEmbargoSummary,
  loadEmbargoData,
  saveEmbargoData
};
