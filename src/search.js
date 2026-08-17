const { processTavilyIntelligence, searchTavily, extractTavilyUrl } = require('./tavily');

/**
 * Web search wrapper for AZURA using Tavily AI Intelligence
 * @param {string} query 
 * @returns {Promise<string>}
 */
async function searchWeb(query) {
  const result = await processTavilyIntelligence(query);
  if (result) return result;

  // Fallback if triggered without specific keyword match
  return await searchTavily(query, 'general');
}

module.exports = {
  searchWeb,
  extractTavilyUrl,
  processTavilyIntelligence
};
