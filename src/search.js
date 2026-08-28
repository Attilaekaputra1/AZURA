const { processTavilyIntelligence, searchTavily, extractTavilyUrl } = require('./tavily');
const { handleSocialMediaIntelligence } = require('./socialMedia');

/**
 * Universal search & research wrapper for AZURA:
 * 1. Social Media Engine (Instagram, TikTok, YouTube, Twitter/X, Reddit)
 * 2. Tavily News & Academic / Web Intelligence (Google News ID & World, Research Depth)
 * @param {string} query 
 * @returns {Promise<string>}
 */
async function searchWeb(query) {
  // 1. Check for Social Media Intelligence first
  try {
    const socialResult = await handleSocialMediaIntelligence(query);
    if (socialResult) return socialResult;
  } catch (err) {
    console.warn('[Social Search Warning]:', err.message);
  }

  // 2. Route to Tavily Web & News Intelligence
  const result = await processTavilyIntelligence(query);
  if (result) return result;

  // 3. Fallback if triggered without specific keyword match
  return await searchTavily(query, 'general');
}

module.exports = {
  searchWeb,
  extractTavilyUrl,
  processTavilyIntelligence,
  handleSocialMediaIntelligence
};
