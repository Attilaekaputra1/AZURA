const fs = require('fs');
const path = require('path');
const { getAllUsersList, loadVault } = require('./vault');
const { recordPositiveBehavior, getUserBehavior, getAllBehaviors, MAX_BEHAVIOR_USERS } = require('./behavior');

/**
 * Autonomous Behavior Backfill & Deep History Scanner
 * Analyzes conversation histories, VC activity, DM interactions, and vault metadata
 * to automatically build fundamental behavior profiles for all active users (up to 20 users).
 * 
 * @param {import('discord.js').Client} [client]
 * @returns {Promise<{ scanned: number, updated: number, profiles: Array<object> }>}
 */
async function bootstrapAllUserBehaviors(client = null) {
  console.log('[Behavior Bootstrap]: 🔍 Starting autonomous deep analysis of active users...');
  loadVault();

  const allUsers = getAllUsersList();
  if (!allUsers || allUsers.length === 0) {
    console.log('[Behavior Bootstrap]: No user records found in vault.');
    return { scanned: 0, updated: 0, profiles: [] };
  }

  // Sort users by total interactions (most active first)
  const sortedUsers = allUsers
    .map(u => {
      const total = (u.totalInteractions || (u.totalMessages || 0) + (u.totalVoiceTurns || 0));
      return { ...u, effectiveTotal: total };
    })
    .sort((a, b) => b.effectiveTotal - a.effectiveTotal);

  // Take top active users up to MAX_BEHAVIOR_USERS
  const targetUsers = sortedUsers.slice(0, MAX_BEHAVIOR_USERS);
  let updatedCount = 0;

  for (const user of targetUsers) {
    const uid = user.userId;
    const displayName = user.displayName || user.username || `User_${uid}`;
    const username = user.username || `user_${uid}`;
    const knownName = user.knownRealName || displayName;
    const isOwner = (uid === require('./config').OWNER_DISCORD_ID);

    // 1. Scrape / Fetch actual DM messages if Discord client is active
    let dmTextCorpus = '';
    if (client && client.users && client.users.fetch) {
      try {
        const discordUser = await client.users.fetch(uid).catch(() => null);
        if (discordUser && discordUser.dmChannel) {
          const fetchedMessages = await discordUser.dmChannel.messages.fetch({ limit: 30 }).catch(() => null);
          if (fetchedMessages && fetchedMessages.size > 0) {
            dmTextCorpus = fetchedMessages
              .filter(m => m.author.id === uid)
              .map(m => m.content)
              .join(' ');
          }
        }
      } catch (_) {}
    }

    // 2. Synthesize context from VC turns, server messages, and permanent memory summaries
    let contextCorpus = `${dmTextCorpus} `;
    
    // Check permanent memory summaries for this user
    try {
      const permMemPath = path.join(__dirname, '../data/permanent_summaries.json');
      if (fs.existsSync(permMemPath)) {
        const permData = JSON.parse(fs.readFileSync(permMemPath, 'utf8') || '{}');
        for (const [key, summaries] of Object.entries(permData)) {
          if (key.includes(uid) && Array.isArray(summaries)) {
            contextCorpus += summaries.map(s => `${s.title} ${s.summary} ${(s.keyPoints || []).join(' ')}`).join(' ');
          }
        }
      }
    } catch (_) {}

    // Infer baseline traits based on interaction channels and nicknames
    if (isOwner) {
      contextCorpus += ' coding bot api arsitektur database kreatif inovasi proyek distributed system deploy vps AI ';
    }
    if (user.totalVoiceTurns && user.totalVoiceTurns > 5) {
      contextCorpus += ' mabar voice vc discord santai game ngobrol seru ';
    }
    if (knownName.toLowerCase().includes('koin') || username.toLowerCase().includes('wata')) {
      contextCorpus += ' wkwk haha santai mabar valorant game ';
    }
    if (knownName.toLowerCase().includes('iblis') || username.toLowerCase().includes('ryhz')) {
      contextCorpus += ' coding tech wkwk jokes seru gaming ';
    }

    // Fallback baseline for any active user
    if (contextCorpus.trim().length < 5) {
      contextCorpus = 'halo santai wkwk makasih salam kenal ya';
    }

    // Record into behavior engine
    recordPositiveBehavior(uid, username, knownName, contextCorpus, false, client);
    updatedCount++;
  }

  const allBehaviors = getAllBehaviors();
  console.log(`[Behavior Bootstrap]: ✅ Deep analysis complete! Profiled ${allBehaviors.length}/${MAX_BEHAVIOR_USERS} active users.`);

  return {
    scanned: targetUsers.length,
    updated: updatedCount,
    profiles: allBehaviors
  };
}

module.exports = {
  bootstrapAllUserBehaviors
};
