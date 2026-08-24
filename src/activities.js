/**
 * AZURA Discord Voice Activities & YouTube Watch Together Launcher
 * Generates official embedded Discord application activity invites for voice channels.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Verified Official Discord Embedded Application Activity IDs
const DISCORD_ACTIVITIES = {
  youtube: {
    id: '880218394199220334', // Official Discord Watch Together
    name: 'YouTube Watch Together',
    emoji: '📺',
    color: 0xFF0000,
    description: 'Nonton bareng video YouTube tersinkronisasi dalam resolusi Full HD dengan kontrol playlist bersama!'
  },
  wordle: {
    id: '879863686565621790', // Official Discord Letter League (Wordle / Scrabble Style)
    name: 'Wordle / Letter League Activity',
    emoji: '🟩',
    color: 0x57F287,
    description: 'Main game susun kata & tebak kata Wordle resmi Discord langsung di Voice Channel bersama teman!'
  },
  spellcast: {
    id: '852509694341283871', // Official SpellCast
    name: 'SpellCast Word Game',
    emoji: '🔮',
    color: 0x9B59B6,
    description: 'Game susun kata sihir kompetitif 4-player resmi Discord di Voice Channel.'
  },
  chess: {
    id: '832012774040141894', // Official Chess in the Park
    name: 'Chess in the Park',
    emoji: '♟️',
    color: 0x2B2D31,
    description: 'Main catur klasik langsung di Voice Channel bareng teman-teman server.'
  },
  sketch: {
    id: '902271654783242291', // Official Sketch Heads
    name: 'Sketch Heads',
    emoji: '🎨',
    color: 0x5865F2,
    description: 'Tebak gambar seru ala Gartic / Pictionary bersama member Voice Channel!'
  },
  poker: {
    id: '755827207812677713', // Official Poker Night
    name: 'Poker Night',
    emoji: '🃏',
    color: 0x57F287,
    description: 'Permainan kartu Texas Hold’em poker multiplayer santai di VC.'
  },
  puttparty: {
    id: '945737671538946068', // Official Putt Party
    name: 'Putt Party (Mini Golf)',
    emoji: '⛳',
    color: 0x2ECC71,
    description: 'Game mini golf seru multiplayer langsung di Voice Channel!'
  }
};

/**
 * Launch an embedded Discord activity in a voice channel
 * @param {import('discord.js').VoiceBasedChannel} voiceChannel 
 * @param {string} activityKey 
 * @param {string} requesterName 
 * @returns {Promise<{ success: boolean, message?: string, embeds?: EmbedBuilder[], components?: ActionRowBuilder[] }>}
 */
async function launchVoiceActivity(voiceChannel, activityKey = 'youtube', requesterName = 'Pengguna') {
  if (!voiceChannel || !voiceChannel.isVoiceBased()) {
    return {
      success: false,
      message: '⚠️ Kamu harus berada di dalam Voice Channel terlebih dahulu untuk meluncurkan aktivitas ini yaa!'
    };
  }

  const key = activityKey.toLowerCase().trim();
  const activity = DISCORD_ACTIVITIES[key] || (key.includes('word') ? DISCORD_ACTIVITIES.wordle : DISCORD_ACTIVITIES.youtube);

  try {
    const invite = await voiceChannel.createInvite({
      targetApplication: activity.id,
      targetType: 2, // InviteTargetType.EmbeddedApplication
      maxAge: 86400,
      maxUses: 0
    });

    const inviteUrl = `https://discord.com/invite/${invite.code}`;

    const embed = new EmbedBuilder()
      .setColor(activity.color)
      .setTitle(`${activity.emoji} ${activity.name} — Voice Channel Activity`)
      .setDescription(
        `**${requesterName}** telah meluncurkan sesi **${activity.name}** di **#${voiceChannel.name}**!\n\n` +
        `📝 ${activity.description}\n\n` +
        `*Klik tombol di bawah ini untuk langsung bergabung ke player/game di Voice Channel.*`
      )
      .setFooter({ text: 'Official Discord Embedded Voice Activity • Zero Latency Full HD' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(`▶️ Buka ${activity.name} di VC`)
        .setStyle(ButtonStyle.Link)
        .setURL(inviteUrl)
    );

    return {
      success: true,
      embeds: [embed],
      components: [row]
    };
  } catch (err) {
    console.error(`[Activity Launcher Error] Failed to create activity ${key}:`, err.message);
    return {
      success: false,
      message: `Waduh, gagal meluncurkan sesi ${activity.name}. Pastikan bot memiliki izin *Create Invite* di Voice Channel #${voiceChannel.name} yaa!`
    };
  }
}

/**
 * Check if a text prompt is requesting a voice activity or YouTube Together
 * @param {string} prompt 
 * @returns {boolean}
 */
function isActivityRequest(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  
  // Explicit VC Activity queries
  const isVcWordle = /\b(?:wordle|letter\s*league|spellcast|tebak\s*kata)\b.*\b(?:vc|voice|channel)\b/i.test(lower) ||
                     /\b(?:buka|main|start|setel)\s+(?:wordle|letter\s*league|spellcast)\s+(?:di\s+)?(?:vc|voice)/i.test(lower);
  
  const isVcYoutube = /\b(?:youtube|watch\s*together|nobar|yt)\b.*\b(?:together|vc|voice|channel)\b/i.test(lower) ||
                      /\b(?:setel|buka|puter|play|mulai)\s+(?:youtube|watch\s*together|nobar)\s*(?:di\s+)?(?:vc|voice)?/i.test(lower);

  const isGeneralVcGame = /\b(?:main|buka|launch|start)\s+(?:catur|chess|sketch|gartic|poker|golf|game|activity|aktivitas)\s+(?:di\s+)?(?:vc|voice)/i.test(lower);

  return isVcWordle || isVcYoutube || isGeneralVcGame;
}

/**
 * Extract activity type from prompt
 * @param {string} prompt 
 * @returns {string}
 */
function parseActivityType(prompt) {
  const lower = (prompt || '').toLowerCase();
  if (lower.includes('wordle') || lower.includes('letter') || lower.includes('spellcast') || lower.includes('tebak kata')) return 'wordle';
  if (lower.includes('chess') || lower.includes('catur')) return 'chess';
  if (lower.includes('sketch') || lower.includes('gambar') || lower.includes('gartic')) return 'sketch';
  if (lower.includes('poker')) return 'poker';
  if (lower.includes('golf') || lower.includes('putt')) return 'puttparty';
  return 'youtube';
}

module.exports = {
  launchVoiceActivity,
  isActivityRequest,
  parseActivityType,
  DISCORD_ACTIVITIES
};
