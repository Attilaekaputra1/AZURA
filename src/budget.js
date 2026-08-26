const config = require('./config');

// User Cooldown tracker: Map<userId, timestamp>
const userCooldowns = new Map();

// Short-term conversation history per user: Map<userId, Array<{role: string, content: string}>>
const conversationContexts = new Map();

/**
 * Estimate token count from text (1 token ~= 3.5 chars)
 * @param {string} text 
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

// Simple Cost Guard System
const budgetGuard = {
  /**
   * Check if a user is on cooldown (< 0.5s)
   * @param {string} userId 
   * @returns {{ isLimited: boolean, remainingMs: number }}
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const lastTime = userCooldowns.get(userId) || 0;
    const diff = now - lastTime;

    if (diff < config.RATE_LIMIT_COOLDOWN_MS) {
      return {
        isLimited: true,
        remainingMs: config.RATE_LIMIT_COOLDOWN_MS - diff
      };
    }

    // Update cooldown
    userCooldowns.set(userId, now);
    return { isLimited: false, remainingMs: 0 };
  },

  /**
   * Get short-term context for a user
   * @param {string} userId 
   * @returns {Array<{role: string, content: string}>}
   */
  getContext(userId) {
    return conversationContexts.get(userId) || [];
  },

  /**
   * Append message to sliding window context with Token Memory Buffer
   * @param {string} userId 
   * @param {'user'|'assistant'} role 
   * @param {string} content 
   * @param {number} [customMaxTokens] 
   */
  addMessageToContext(userId, role, content, customMaxTokens = null) {
    let history = conversationContexts.get(userId) || [];
    history.push({ role, content });

    // Enforce sliding window limit (MAX_CONTEXT_MESSAGES) & Trigger Permanent Memory Summarization
    if (history.length >= config.MAX_CONTEXT_MESSAGES) {
      const messagesToArchive = history.slice(0, Math.max(10, history.length - 20));
      history = history.slice(-20); // Keep last 20 messages active

      // Asynchronously distill and archive older messages to Permanent VPS Storage
      setTimeout(async () => {
        try {
          const { summarizeMessages, addPermanentSummary } = require('./permanentMemory');
          const summaryResult = await summarizeMessages(messagesToArchive, false);
          if (summaryResult) {
            addPermanentSummary(userId, {
              title: summaryResult.title,
              summary: summaryResult.summary,
              keyPoints: summaryResult.keyPoints,
              messageCount: messagesToArchive.length,
              isPriority: false
            });
          }
        } catch (err) {
          console.error('[PermanentMemory Auto-Summarize Error]:', err.message);
        }
      }, 500);
    }

    // Enforce Token Memory Buffer limit (1/3 for regular member DM, full for server & owner)
    const maxTokens = customMaxTokens || config.MAX_CONTEXT_TOKENS || 100000;
    let totalTokens = history.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

    while (history.length > 2 && totalTokens > maxTokens) {
      const removed = history.shift();
      totalTokens -= estimateTokens(removed?.content);
    }

    conversationContexts.set(userId, history);
  },

  /**
   * Reset context for a user (/reset command)
   * @param {string} userId 
   */
  resetContext(userId) {
    conversationContexts.delete(userId);
  }
};

module.exports = budgetGuard;
