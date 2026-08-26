const config = require('./config');
const { getUserRecord } = require('./vault');

/**
 * Resolve Discord mentions in text into disambiguated user profiles linked with User IDs & Vault Nicknames.
 * @param {string} text 
 * @param {import('discord.js').Client} client 
 * @param {import('discord.js').Guild} [guild] 
 * @returns {Promise<{ resolvedText: string, mentionedUsers: Array<object>, mentionContextPrompt: string }>}
 */
async function resolveUserMentions(text, client, guild = null) {
  if (!text) return { resolvedText: '', mentionedUsers: [], mentionContextPrompt: '' };

  const mentionRegex = /<@!?(\d+)>/g;
  const matches = [...text.matchAll(mentionRegex)];
  if (matches.length === 0) {
    return { resolvedText: text, mentionedUsers: [], mentionContextPrompt: '' };
  }

  const mentionedUsers = [];
  let resolvedText = text;

  for (const match of matches) {
    const fullTag = match[0];
    const targetUid = match[1];

    // If it's AZURA herself, replace with @AZURA
    if (client.user && targetUid === client.user.id) {
      resolvedText = resolvedText.replace(fullTag, '@AZURA');
      continue;
    }

    // 1. Fetch user from Discord cache or API
    let discordUser = client.users?.cache?.get(targetUid);
    if (!discordUser && client.users?.fetch) {
      discordUser = await client.users.fetch(targetUid).catch(() => null);
    }

    let member = null;
    if (guild) {
      member = guild.members?.cache?.get(targetUid) || (guild.members?.fetch ? await guild.members.fetch(targetUid).catch(() => null) : null);
    }

    const username = discordUser?.username || member?.user?.username || `user_${targetUid}`;
    const displayName = member?.displayName || discordUser?.displayName || discordUser?.globalName || username;

    // 2. Fetch Vault record (Encrypted AES-256-GCM storage)
    const vaultRecord = getUserRecord(targetUid);
    const isOwner = (targetUid === config.OWNER_DISCORD_ID);
    const knownRealName = vaultRecord?.knownRealName || (isOwner ? 'Putra' : null);
    const relTier = isOwner
      ? '👑 Creator & Owner Utama AZURA'
      : (vaultRecord?.relationshipTier || '🌱 Member');

    const userInfo = {
      userId: targetUid,
      username,
      displayName,
      knownRealName,
      isOwner,
      relationshipTier: relTier
    };
    mentionedUsers.push(userInfo);

    // Replace the raw <@targetUid> with a rich, explicit identity tag
    const aliasInfo = knownRealName ? ` (Nama Panggilan: ${knownRealName})` : '';
    const ownerInfo = isOwner ? ' [Creator & Owner AZURA]' : '';
    const replacement = `@${displayName}${aliasInfo}${ownerInfo}`;

    resolvedText = resolvedText.replace(fullTag, replacement);
  }

  let mentionContextPrompt = '';
  if (mentionedUsers.length > 0) {
    const lines = mentionedUsers.map((u, i) => {
      const aliasStr = u.knownRealName ? `\n  - Nama Panggilan Resmi di Database: "${u.knownRealName}"` : '\n  - Nama Panggilan Resmi: Belum terdaftar';
      const roleStr = u.isOwner ? '\n  - Peran/Status: 👑 Creator & Owner Utama AZURA (Nama asli: Putra / Attila)' : `\n  - Tingkat Keakraban: ${u.relationshipTier}`;
      return `[PENGGUNA YANG DISEBUT/DITAG #${i + 1}]:\n  - User ID Discord: \`${u.userId}\` (UNIK)\n  - Display Name: "${u.displayName}"\n  - Username: @${u.username}${aliasStr}${roleStr}`;
    }).join('\n\n');

    mentionContextPrompt = `\n\n[INFORMASI PENGGUNA YANG DITAG / DISEBUT DALAM PESAN]:\n` +
      `Lawan bicara sedang menandai/menanyakan tentang pengguna berikut di Discord:\n` +
      `${lines}\n` +
      `ATURAN IDENTIFIKASI MENTION SANGAT PENTING:\n` +
      `1. Hubungkan pertanyaan user secara langsung dengan identitas orang yang ditag di atas berdasarkan User ID Discord uniknya.\n` +
      `2. Jika user bertanya "siapa @Attila", "nama asli @Attila", atau menanyakan tentang sosok yang ditag, jelaskan profil orang yang ditag tersebut dengan tepat (misal: Attila adalah Creator/Owner utama AZURA, nama aslinya Putra).\n` +
      `3. JANGAN PERNAH tertukar mengira user menanyakan dirimu sendiri (AZURA) atau menanyakan nama si penanya, jika dia jelas-jelas menandai/menanyakan orang lain!\n` +
      `4. ATURAN PRIVASI USER ID (SANGAT KETAT): Gunakan User ID hanya untuk identifikasi internalmu di balik layar. DILARANG KERAS membeberkan atau menyebutkan deretan angka User ID (misal: 759050138353664020) di balasan chat kepada user! Cukup sebutkan nama panggilan resmi, nama aslinya, atau username-nya saja!`;
  }

  return { resolvedText, mentionedUsers, mentionContextPrompt };
}

module.exports = {
  resolveUserMentions
};
