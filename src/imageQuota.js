/**
 * Daily Server Image Generation Quota Manager (10 Generates / Day per Server)
 * First-Come, First-Served for all members.
 * Owner (Attila) is UNLIMITED.
 */

const config = require('./config');

// Store server daily usage: Map<guildId, { count: number, dateStr: string }>
const serverQuotas = new Map();

/**
 * Get current date string in Asia/Jakarta timezone (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayDateStr() {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
}

/**
 * Check if image generation is allowed for this server/user
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {{ allowed: boolean, count: number, remaining: number, limit: number, isOwner: boolean }}
 */
function checkServerQuota(guildId, userId) {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;
  if (isOwner) {
    return { allowed: true, count: 0, remaining: 999, limit: 10, isOwner: true };
  }

  if (!guildId) {
    // Direct Message (DM) — allowed
    return { allowed: true, count: 0, remaining: 999, limit: 10, isOwner: false };
  }

  const today = getTodayDateStr();
  let quota = serverQuotas.get(guildId);

  // Reset quota if it's a new day
  if (!quota || quota.dateStr !== today) {
    quota = { count: 0, dateStr: today };
    serverQuotas.set(guildId, quota);
  }

  const limit = 10;
  const remaining = Math.max(0, limit - quota.count);
  const allowed = quota.count < limit;

  return {
    allowed,
    count: quota.count,
    remaining,
    limit,
    isOwner: false
  };
}

/**
 * Increment daily image usage for a server
 * @param {string} guildId 
 * @param {string} userId 
 */
function incrementServerQuota(guildId, userId) {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;
  if (isOwner || !guildId) return;

  const today = getTodayDateStr();
  let quota = serverQuotas.get(guildId);

  if (!quota || quota.dateStr !== today) {
    quota = { count: 0, dateStr: today };
  }

  quota.count += 1;
  serverQuotas.set(guildId, quota);
  console.log(`[Image Quota]: Server ${guildId} usage: ${quota.count}/10 for date ${today}`);
}

module.exports = {
  checkServerQuota,
  incrementServerQuota
};
