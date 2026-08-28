const https = require('https');
const { OpenAI } = require('openai');
const config = require('./config');

// Common anime title aliases and typo normalization
const TITLE_ALIASES = {
  'kimi no nawa': 'Kimi no Na wa', 'kiminonawa': 'Kimi no Na wa', 'your name': 'Kimi no Na wa',
  'tenki no ko': 'Tenki no Ko', 'weathering with you': 'Tenki no Ko',
  'koe no katachi': 'Koe no Katachi', 'a silent voice': 'Koe no Katachi',
  'boku no hero': 'Boku no Hero Academia', 'mha': 'Boku no Hero Academia',
  'my hero academia': 'Boku no Hero Academia', 'bnha': 'Boku no Hero Academia',
  'kimetsu': 'Kimetsu no Yaiba', 'demon slayer': 'Kimetsu no Yaiba',
  'shingeki': 'Shingeki no Kyojin', 'attack on titan': 'Shingeki no Kyojin',
  'aot': 'Shingeki no Kyojin', 'snk': 'Shingeki no Kyojin',
  'jujutsu': 'Jujutsu Kaisen', 'jjk': 'Jujutsu Kaisen',
  'sao': 'Sword Art Online', 'fmab': 'Fullmetal Alchemist: Brotherhood',
  'fullmetal': 'Fullmetal Alchemist: Brotherhood',
  'opm': 'One Punch Man', 'one punch': 'One Punch Man',
  'hxh': 'Hunter x Hunter', 'hunter hunter': 'Hunter x Hunter',
  're zero': 'Re:Zero kara Hajimeru Isekai Seikatsu', 're:zero': 'Re:Zero kara Hajimeru Isekai Seikatsu',
  'rezero': 'Re:Zero kara Hajimeru Isekai Seikatsu',
  'chainsaw man': 'Chainsaw Man', 'csm': 'Chainsaw Man',
  'spy x family': 'Spy x Family', 'spyfamily': 'Spy x Family',
  'bocchi': 'Bocchi the Rock!', 'bocchi the rock': 'Bocchi the Rock!',
  'oshi no ko': 'Oshi no Ko',
  'frieren': 'Sousou no Frieren', 'sousou no frieren': 'Sousou no Frieren',
  'blue lock': 'Blue Lock', 'bluelock': 'Blue Lock',
  'solo leveling': 'Solo Leveling',
  'dungeon meshi': 'Dungeon Meshi', 'delicious in dungeon': 'Dungeon Meshi',
  'dandadan': 'Dandadan',
  'vinland saga': 'Vinland Saga',
  'violet evergarden': 'Violet Evergarden',
};

// Jikan API v4 Genre ID Mapping
const GENRE_MAP = {
  'action': 1, 'adventure': 2, 'petualangan': 2,
  'comedy': 4, 'komedi': 4, 'lucu': 4,
  'mystery': 7, 'misteri': 7,
  'drama': 8, 'sedih': 8,
  'fantasy': 10, 'fantasi': 10,
  'horror': 14, 'horor': 14, 'seram': 14,
  'romance': 22, 'romantis': 22, 'cinta': 22,
  'sci-fi': 24, 'scifi': 24,
  'slice of life': 36, 'kehidupan': 36,
  'sports': 30, 'sport': 30, 'olahraga': 30,
  'supernatural': 37,
  'thriller': 41,
  'isekai': 62,
  'mecha': 18,
  'school': 23, 'sekolah': 23,
  'psychological': 40, 'psikologis': 40,
};

function normalizeQuery(rawQuery) {
  if (!rawQuery) return '';
  const clean = rawQuery.toLowerCase().trim().replace(/['\".,!?]/g, '');
  if (TITLE_ALIASES[clean]) return TITLE_ALIASES[clean];
  for (const [key, val] of Object.entries(TITLE_ALIASES)) {
    if (clean.includes(key)) return val;
  }
  return rawQuery;
}

function fetchJikanFast(path) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.jikan.moe',
      path: path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AZURA-Discord-Bot/3.0',
        'Accept': 'application/json'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, function() {
      this.destroy();
      resolve(null);
    });
  });
}

function truncateForDiscord(text) {
  if (!text) return 'Tidak ada data anime.';
  if (text.length <= 1900) return text;
  return text.slice(0, 1900) + '\n\n*(Hasil dipotong agar muat di batas karakter Discord)*';
}

/**
 * AI Fallback: Generate curated top anime info/recommendations via OpenAI
 */
async function getAiAnimeFallback(queryOrGenre, isSearch = false) {
  try {
    console.log(`[Anime Engine]: Fetching AI fallback data for "${queryOrGenre}"...`);
    const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    
    let prompt = '';
    if (isSearch) {
      prompt = `Berikan informasi detail anime "${queryOrGenre}" dari MyAnimeList secara akurat dan lengkap. Format persis seperti ini:\n\n📺 **[Judul Anime]** ([Judul Jepang])\n• ⭐ **[Score, contoh 9.14]/10** | Rank: \`#[Rank]\`\n• \`[Format TV/Movie]\` | [Jumlah] Episode | [Status: Finished Airing/Currently Airing]\n• Musim: \`[Season Tahun]\` | Studio: \`[Nama Studio]\`\n• Genre: \`[Genre 1, Genre 2, Genre 3]\`\n• **Sinopsis**: [Sinopsis ringkas dan menarik 2-3 kalimat]\n🔗 **MyAnimeList**: https://myanimelist.net/anime`;
    } else {
      prompt = `Berikan 5 rekomendasi anime terbaik untuk genre/tema "${queryOrGenre}" dari MyAnimeList. Format persis seperti ini per anime (list 1-5 tanpa kata pengantar):\n\n**#1. [Judul Anime]** ([Judul Jepang])\n• ⭐ **[Score]/10** | **Format**: \`[TV/Movie]\` ([Jumlah] eps)\n• **Studio**: \`[Studio]\` | **Genre**: \`[Genre]\`\n• **Sinopsis**: [Sinopsis singkat 2 kalimat]\n🔗 **MyAnimeList**: https://myanimelist.net`;
    }

    const completion = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (text) {
      const header = isSearch
        ? `🌸 **HASIL PENCARIAN ANIME: "${queryOrGenre.toUpperCase()}" (AZURA AI Engine):**\n\n`
        : `🎬 **TOP 5 REKOMENDASI ANIME — ${queryOrGenre.toUpperCase()} (AZURA AI Engine):**\n\n`;
      return truncateForDiscord(header + text);
    }
  } catch (err) {
    console.error('[Anime AI Fallback Error]:', err.message);
  }

  return `Pencarian anime "${queryOrGenre}" belum dapat dimuat saat ini. Coba lagi atau gunakan keyword genre: **romance, action, isekai, comedy, horror, fantasy, drama, thriller, mystery, supernatural, mecha, school, sports**`;
}

/**
 * Get Anime Recommendations — Jikan first, AI fallback
 * @param {string} genreOrKeyword
 */
async function getAnimeRecommendations(genreOrKeyword = 'trending') {
  const cleanKey = (genreOrKeyword || '').toLowerCase().trim();
  const genreId = GENRE_MAP[cleanKey];

  let data = null;

  if (genreId) {
    console.log(`[Anime]: Jikan genre search "${cleanKey}" (ID: ${genreId})`);
    const json = await fetchJikanFast(`/v4/anime?genres=${genreId}&order_by=score&sort=desc&limit=5&sfw=true`);
    if (json?.data?.length > 0) data = json.data;
  } else if (cleanKey && cleanKey !== 'trending' && cleanKey !== 'top') {
    for (const [gName, gId] of Object.entries(GENRE_MAP)) {
      if (cleanKey.includes(gName) || gName.includes(cleanKey)) {
        const json = await fetchJikanFast(`/v4/anime?genres=${gId}&order_by=score&sort=desc&limit=5&sfw=true`);
        if (json?.data?.length > 0) { data = json.data; break; }
      }
    }
    if (!data) {
      const normalized = normalizeQuery(cleanKey);
      const json = await fetchJikanFast(`/v4/anime?q=${encodeURIComponent(normalized)}&order_by=score&sort=desc&limit=5&sfw=true`);
      if (json?.data?.length > 0) data = json.data;
    }
  }

  if (!data) {
    const json = await fetchJikanFast(`/v4/top/anime?limit=5&sfw=true`);
    if (json?.data?.length > 0) data = json.data;
  }

  if (data?.length > 0) {
    const list = data.slice(0, 5).map((item, idx) => {
      const score = item.score ? `⭐ ${item.score}/10` : '⭐ N/A';
      const eps = item.episodes ? `${item.episodes} eps` : 'TBA';
      const type = item.type || 'TV';
      const genres = item.genres?.map(g => g.name).join(', ') || '-';
      const studios = item.studios?.map(s => s.name).join(', ') || '-';
      const synopsis = item.synopsis?.slice(0, 160).replace(/\n/g, ' ') + '...' || '-';
      const jpTitle = item.title_japanese ? ` (${item.title_japanese})` : '';
      return `**#${idx + 1}. ${item.title}**${jpTitle}\n• ${score} | \`${type}\` (${eps})\n• Studio: \`${studios}\` | Genre: \`${genres}\`\n• ${synopsis}\n🔗 ${item.url}`;
    }).join('\n\n──────────────\n\n');

    const header = genreId
      ? `🎬 **TOP 5 ANIME — ${cleanKey.toUpperCase()} (MyAnimeList):**`
      : cleanKey && cleanKey !== 'trending'
        ? `🎬 **REKOMENDASI ANIME "${genreOrKeyword.toUpperCase()}" (MyAnimeList):**`
        : `🎬 **TOP 5 ANIME TRENDING (MyAnimeList):**`;

    return truncateForDiscord(`${header}\n\n${list}`);
  }

  // Fallback to AI Recommendation Engine
  return await getAiAnimeFallback(genreOrKeyword, false);
}

/**
 * Search Anime by Title — Jikan first, AI fallback
 * @param {string} query
 */
async function searchAnime(query) {
  const normalized = normalizeQuery(query);
  console.log(`[Anime]: Title search "${query}" → normalized: "${normalized}"`);

  const queries = [...new Set([normalized, query, query.split(' ')[0]])];

  for (const q of queries) {
    const json = await fetchJikanFast(`/v4/anime?q=${encodeURIComponent(q)}&limit=3&order_by=score&sort=desc&sfw=true`);
    if (json?.data?.length > 0) {
      const list = json.data.map((item) => {
        const score = item.score ? `⭐ ${item.score}/10` : '⭐ N/A';
        const scoredBy = item.scored_by ? ` (${item.scored_by.toLocaleString('id-ID')} users)` : '';
        const eps = item.episodes ? `${item.episodes} Episode` : 'TBA Episode';
        const type = item.type || 'TV';
        const status = item.status || 'Finished Airing';
        const season = item.season && item.year ? `${item.season.toUpperCase()} ${item.year}` : 'N/A';
        const genres = item.genres?.map(g => g.name).join(', ') || '-';
        const studios = item.studios?.map(s => s.name).join(', ') || '-';
        const rank = item.rank ? `#${item.rank}` : 'Unranked';
        const synopsis = item.synopsis?.slice(0, 200).replace(/\n/g, ' ') + '...' || '-';
        const jpTitle = item.title_japanese ? ` (${item.title_japanese})` : '';
        return `📺 **${item.title}**${jpTitle}\n• ${score}${scoredBy} | Rank: \`${rank}\`\n• \`${type}\` | ${eps} | ${status}\n• Musim: \`${season}\` | Studio: \`${studios}\`\n• Genre: \`${genres}\`\n• ${synopsis}\n🔗 ${item.url}`;
      }).join('\n\n──────────────\n\n');

      return truncateForDiscord(`🌸 **HASIL PENCARIAN: "${query}" (MyAnimeList):**\n\n${list}`);
    }
  }

  // Fallback to AI search
  return await getAiAnimeFallback(query, true);
}

module.exports = {
  getTopAnime: () => getAnimeRecommendations('trending'),
  getAnimeRecommendations,
  searchAnime,
  normalizeQuery,
};
