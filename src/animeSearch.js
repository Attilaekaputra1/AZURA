/**
 * AZURA MyAnimeList & Jikan API Search Subsystem
 * 
 * Features:
 * 1. Queries public official Jikan API (MyAnimeList v4) for anime titles, scores, synopsis, episodes, studios.
 * 2. Automatic fallback to Tavily targeted site:myanimelist.net search if Jikan API fails or returns no match.
 * 3. Formats structured, grounded markdown context for AZURA to answer accurately without guessing.
 */

const https = require('https');
const { searchWeb } = require('./tavily');

/**
 * Perform HTTPS GET request with JSON parsing and timeout
 * @param {string} url 
 * @param {number} timeoutMs 
 * @returns {Promise<any>}
 */
function fetchJson(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'AZURA-Discord-Bot/1.0 (Contact: attila@azura.ai)'
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 100)}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

/**
 * Search anime from MyAnimeList database via Jikan API v4
 * @param {string} query 
 * @returns {Promise<string>} Structured text context for LLM
 */
async function searchAnimeMyAnimeList(query) {
  if (!query || typeof query !== 'string') return '';
  const cleanQuery = query
    .replace(/\b(?:azura|ara|zura|ajur|ajura|anime|manga|myanimelist|mal|tolong|cariin|carikan|cek|info|tentang)\b/gi, '')
    .trim() || query.trim();

  console.log(`[MAL Engine]: Querying Jikan API v4 for anime: "${cleanQuery}"`);

  try {
    const jikanUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanQuery)}&limit=3`;
    const res = await fetchJson(jikanUrl, 6000);

    if (res && res.data && res.data.length > 0) {
      let formatted = `[DATA RESMI MYANIMELIST (JIKAN API V4) UNTUK: "${cleanQuery}"]:\n`;

      res.data.forEach((anime, idx) => {
        const title = anime.title || 'Unknown Title';
        const titleEng = anime.title_english ? ` (${anime.title_english})` : '';
        const titleJap = anime.title_japanese ? ` [${anime.title_japanese}]` : '';
        const type = anime.type || 'TV';
        const episodes = anime.episodes ? `${anime.episodes} Ep` : 'Unknown Episodes';
        const status = anime.status || 'Unknown Status';
        const score = anime.score ? `⭐ ${anime.score}/10` : 'No Score Yet';
        const studios = (anime.studios || []).map(s => s.name).join(', ') || 'Unknown Studio';
        const genres = (anime.genres || []).map(g => g.name).join(', ') || 'General';
        const synopsis = anime.synopsis ? anime.synopsis.replace(/\n+/g, ' ').slice(0, 300) + '...' : 'Tidak ada sinopsis.';
        const url = anime.url || '';

        formatted += `\n${idx + 1}. **${title}${titleEng}${titleJap}**\n`;
        formatted += `   • Tipe & Episode: ${type} • ${episodes} • Status: ${status}\n`;
        formatted += `   • Skor MAL: ${score} • Studio: ${studios} • Genre: ${genres}\n`;
        formatted += `   • Sinopsis Singkat: ${synopsis}\n`;
        formatted += `   • Link MAL: ${url}\n`;
      });

      return formatted;
    }
  } catch (jikanErr) {
    console.warn(`[MAL Engine Warning]: Jikan API lookup failed (${jikanErr.message}), falling back to targeted web search...`);
  }

  // Fallback: Targeted Tavily Web Search on MyAnimeList
  try {
    const targetedQuery = `${cleanQuery} site:myanimelist.net`;
    const webRes = await searchWeb(targetedQuery);
    if (webRes && webRes.trim().length > 0) {
      return `[HASIL PENCARIAN TERCATAT DI MYANIMELIST (WEB CRAWL)]:\n${webRes}`;
    }
  } catch (tavilyErr) {
    console.warn('[MAL Engine Warning]: Tavily fallback failed:', tavilyErr.message);
  }

  return `[STATUS MYANIMELIST]: Tidak ditemukan entri anime dengan judul "${cleanQuery}" di database resmi MyAnimeList. Jika judul ini adalah rumor, proyek fan, atau belum diumumkan resmi, sampaikan kepada user bahwa judul ini belum terdaftar di MAL.`;
}

module.exports = {
  searchAnimeMyAnimeList
};
