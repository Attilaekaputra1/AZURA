const https = require('https');

// Common anime title aliases and typo normalization map
const TITLE_ALIASES = {
  'kimi no nawa': 'Kimi no Na wa',
  'kiminonawa': 'Kimi no Na wa',
  'your name': 'Kimi no Na wa',
  'tenki no ko': 'Tenki no Ko',
  'weathering with you': 'Tenki no Ko',
  'koe no katachi': 'Koe no Katachi',
  'a silent voice': 'Koe no Katachi',
  'boku no hero': 'Boku no Hero Academia',
  'hero academia': 'Boku no Hero Academia',
  'my hero academia': 'Boku no Hero Academia',
  'kimetsu': 'Kimetsu no Yaiba',
  'demon slayer': 'Kimetsu no Yaiba',
  'shingeki': 'Shingeki no Kyojin',
  'attack on titan': 'Shingeki no Kyojin',
  'aot': 'Shingeki no Kyojin',
  'jujutsu': 'Jujutsu Kaisen',
  'jjk': 'Jujutsu Kaisen',
  'sao': 'Sword Art Online',
  'fmab': 'Fullmetal Alchemist: Brotherhood',
  'opm': 'One Punch Man',
  'tokyo ghoul': 'Tokyo Ghoul'
};

// Jikan API v4 Genre ID Mapping
const GENRE_MAP = {
  'action': 1,
  'adventure': 2,
  'comedy': 4,
  'komedi': 4,
  'mystery': 7,
  'misteri': 7,
  'drama': 8,
  'fantasy': 10,
  'fantasi': 10,
  'horror': 14,
  'horor': 14,
  'romance': 22,
  'romantis': 22,
  'sci-fi': 24,
  'scifi': 24,
  'slice of life': 36,
  'sports': 30,
  'olahraga': 30,
  'supernatural': 37,
  'thriller': 41,
  'isekai': 62
};

/**
 * Normalize and expand query for fuzzy anime title matching
 * @param {string} rawQuery 
 * @returns {string}
 */
function normalizeQuery(rawQuery) {
  const clean = rawQuery.toLowerCase().trim().replace(/['".,]/g, '');
  return TITLE_ALIASES[clean] || rawQuery;
}

/**
 * Fetch HTTP helper for Jikan API
 * @param {string} path 
 * @returns {Promise<any>}
 */
function fetchJikan(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.jikan.moe',
      path: path,
      headers: { 'User-Agent': 'AZURA-Discord-Bot/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null)).setTimeout(6000, function() {
      this.destroy();
      resolve(null);
    });
  });
}

/**
 * Fetch Top / Trending Anime or Genre-based Anime from Jikan API (MyAnimeList)
 * @param {string} genreOrKeyword 
 * @returns {Promise<string>}
 */
async function getAnimeRecommendations(genreOrKeyword = 'trending') {
  const cleanKey = (genreOrKeyword || '').toLowerCase().trim();

  let path = '/v4/top/anime?limit=5';
  const genreId = GENRE_MAP[cleanKey];

  if (genreId) {
    path = `/v4/anime?genres=${genreId}&order_by=score&sort=desc&limit=5`;
  } else if (cleanKey && cleanKey !== 'trending' && cleanKey !== 'top') {
    const searchTarget = normalizeQuery(cleanKey);
    const encoded = encodeURIComponent(searchTarget);
    path = `/v4/anime?q=${encoded}&order_by=score&sort=desc&limit=5`;
  }

  const json = await fetchJikan(path);

  if (json && json.data && json.data.length > 0) {
    const list = json.data.slice(0, 5).map((item, idx) => {
      const japTitle = item.title_japanese ? ` (${item.title_japanese})` : '';
      const score = item.score ? `⭐ **${item.score}** / 10` : '⭐ N/A';
      const episodes = item.episodes ? `${item.episodes} eps` : 'TBA';
      const type = item.type || 'TV';
      const genres = item.genres ? item.genres.map(g => g.name).join(', ') : 'Anime';
      const studios = item.studios ? item.studios.map(s => s.name).join(', ') : 'Studio';
      const synopsis = item.synopsis ? item.synopsis.slice(0, 200).replace(/\n/g, ' ') + '...' : 'Tidak ada sinopsis.';

      return `**#${idx + 1} ${item.title}**${japTitle}\n` +
             `• **Score**: ${score} | **Format**: \`${type}\` (${episodes})\n` +
             `• **Studio**: \`${studios}\` | **Genre**: \`${genres}\`\n` +
             `• **Sinopsis**: ${synopsis}\n` +
             `🔗 **MAL Link**: ${item.url}`;
    }).join('\n\n───────────────\n\n');

    const titleHeader = (cleanKey && cleanKey !== 'trending' && cleanKey !== 'top')
      ? `🎬 **TOP 5 REKOMENDASI ANIME TERBAIK [GENRE / TEMA: ${cleanKey.toUpperCase()}] (MyAnimeList):**`
      : `🎬 **TOP 5 REKOMENDASI ANIME TERPOPULER & TRENDING (MyAnimeList):**`;

    return `${titleHeader}\n\n${list}`;
  }

  return `Gagal menemukan rekomendasi anime untuk kata kunci "${genreOrKeyword}". Coba kata kunci genre seperti: romance, action, isekai, comedy, horror, fantasy!`;
}

/**
 * Smart Search Anime with Multi-Stage Fuzzy Fallbacks
 * @param {string} query 
 * @returns {Promise<string>}
 */
async function searchAnime(query) {
  const targetQuery = normalizeQuery(query);

  // Attempt 1: Direct normalized search
  let json = await fetchJikan(`/v4/anime?q=${encodeURIComponent(targetQuery)}&limit=3`);

  // Attempt 2: If no result, try raw query
  if (!json || !json.data || json.data.length === 0) {
    if (targetQuery !== query) {
      json = await fetchJikan(`/v4/anime?q=${encodeURIComponent(query)}&limit=3`);
    }
  }

  // Attempt 3: If still no result, try splitting words and searching primary keyword
  if (!json || !json.data || json.data.length === 0) {
    const words = query.trim().split(/\s+/);
    if (words.length > 1) {
      const primaryWord = words[0];
      json = await fetchJikan(`/v4/anime?q=${encodeURIComponent(primaryWord)}&limit=3`);
    }
  }

  if (json && json.data && json.data.length > 0) {
    const list = json.data.map((item, idx) => {
      const japTitle = item.title_japanese ? ` (${item.title_japanese})` : '';
      const score = item.score ? `⭐ **${item.score}** / 10` : '⭐ N/A';
      const scoredBy = item.scored_by ? ` (${item.scored_by.toLocaleString('id-ID')} users)` : '';
      const episodes = item.episodes ? `${item.episodes} Episode` : 'TBA Episode';
      const type = item.type || 'TV / Movie';
      const duration = item.duration || '24 min';
      const status = item.status || 'Finished Airing';
      const season = item.season && item.year ? `${item.season.toUpperCase()} ${item.year}` : 'N/A';
      const genres = item.genres ? item.genres.map(g => g.name).join(', ') : 'Anime';
      const studios = item.studios ? item.studios.map(s => s.name).join(', ') : 'Unknown Studio';
      const rank = item.rank ? `#${item.rank}` : 'Unranked';
      const synopsis = item.synopsis ? item.synopsis.slice(0, 300).replace(/\n/g, ' ') + '...' : 'Tidak ada sinopsis.';

      return `📺 **${item.title}**${japTitle}\n` +
             `• **Score**: ${score}${scoredBy} | **Rank**: \`${rank}\`\n` +
             `• **Format**: \`${type}\` (${duration}) | **Episode**: \`${episodes}\`\n` +
             `• **Status**: \`${status}\` | **Musim**: \`${season}\`\n` +
             `• **Studio**: \`${studios}\` | **Genre**: \`${genres}\`\n` +
             `• **Sinopsis**: ${synopsis}\n` +
             `🔗 **MyAnimeList Link**: ${item.url}`;
    }).join('\n\n───────────────\n\n');

    return `🌸 **HASIL PENCARIAN ANIME (MyAnimeList):**\n\n${list}`;
  }

  return `Tidak ditemukan anime dengan kata kunci "${query}". Coba periksa ejaan judul atau gunakan nama bahasa Inggrisnya!`;
}

/**
 * Smart Media & Anime Intelligence Router
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function processMediaIntelligence(prompt) {
  const lower = prompt.toLowerCase().trim();

  // Pure generic recommendation trigger without specific detail ("rekomendasiin anime dong", "butuh rekomendasi anime")
  if (
    lower === 'rekomendasi anime' ||
    lower === 'minta rekomendasi anime' ||
    lower === 'rekomendasiin anime' ||
    lower === 'rekomendasi anime dong'
  ) {
    return 'Kamu lagi pengen tontonan anime yang kayak gimana nih? 😊\n' +
           'Misalkan: *Romance sekolah yang manis*, *Action studio MAPPA*, *Isekai overpower*, atau *Misteri thriller plot twist*? Coba kasih tahu mood kamu!';
  }

  // Recommendation Trigger with keyword: "rekomendasi anime romance", "rekomendasi anime isekai", "rekomendasi anime action"
  const recMatch = lower.match(/rekomendasi\s*anime\s*(.*)/i) || lower.match(/anime\s*(?:terbaik|trending|terpopuler)\s*(.*)/i);
  if (recMatch) {
    const keyword = recMatch[1].trim();
    console.log(`[Media Engine]: Fetching Anime Recommendations for keyword: "${keyword || 'trending'}"`);
    return await getAnimeRecommendations(keyword || 'trending');
  }

  // Anime Search Trigger: "sinopsis anime naruto", "info anime kimi no nawa", "cari anime ..."
  const searchMatch = lower.match(/(?:sinopsis|info|cari)\s*anime\s*(.+)/i);
  if (searchMatch && searchMatch[1]) {
    const q = searchMatch[1].trim();
    console.log(`[Media Engine]: Searching Anime for: "${q}"`);
    return await searchAnime(q);
  }

  return null;
}

module.exports = {
  getTopAnime: () => getAnimeRecommendations('trending'),
  getAnimeRecommendations,
  searchAnime,
  processMediaIntelligence
};
