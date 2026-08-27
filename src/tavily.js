const https = require('https');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');

const TAVILY_API_KEY = config.TAVILY_API_KEY || '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';

// ══════════════════════════════════════════════════════════════
// ── STRICT MULTI-LAYER SAFETY & CONTENT FILTERS ──────────────
// ══════════════════════════════════════════════════════════════

// 1. Anti-Judol / Anti-Gambling Domains & Keywords
const GAMBLING_DOMAINS = [
  'slot', 'judol', 'judi', 'togel', 'toto', 'casino', 'poker', 'domino', 'bet365',
  'sbobet', 'pragmatic', 'joker123', 'pg-soft', 'habanero', 'microgaming', 'spadegaming',
  'livecasino', 'maxwin', 'gacor', 'rtp', 'scatter', 'jackpot', 'jp-', '-jp',
  'mpo', 'depo', 'pulsa', 'dana-slot', 'ovo-slot', 'gopay-slot', 'linkaja-slot',
  'daftar-slot', 'login-slot', 'situs-slot', 'agen-slot', 'bandar-slot',
  'slot88', 'slot777', 'slot138', 'slot303', 'slot212', 'slot367',
  'olxtoto', 'indotogel', 'togelup', 'angkanet', 'data-hk', 'data-sgp',
  'zeus', 'bonanza', 'starlight', 'gates-of', 'wild-west', 'sweet-bonanza',
  'kakek-zeus', 'princess', 'mahjong-ways', 'lucky-neko'
];

const GAMBLING_KEYWORDS = [
  'slot gacor', 'rtp live', 'bocoran slot', 'pola slot', 'jam gacor',
  'maxwin', 'scatter hitam', 'auto maxwin', 'jackpot', 'freespin',
  'daftar slot', 'login slot', 'agen slot', 'bandar togel', 'prediksi togel',
  'situs judi', 'judi online', 'taruhan', 'betting online', 'deposit slot',
  'withdraw slot', 'bonus slot', 'promo slot', 'link alternatif',
  'anti rungkad', 'pasti profit', 'cuan slot', 'modal receh',
  // Asian / Chinese SEO Black-Hat Gambling Injection keywords
  '彩票', '中彩', '中奖', '博彩', '百家乐', '开奖', '投注', '娱乐城', '六合彩', '老虎机', '天天中', '威尼斯人', '实名', '棋牌', '皇冠', '外围'
];

// 2. Anti-Adult / Anti-NSFW Domains & Keywords
const ADULT_DOMAINS = [
  'pornhub', 'xvideos', 'xnxx', 'onlyfans', 'redtube', 'youporn', 'brazzers',
  'chaturbate', 'stripchat', 'rule34', 'hentai', 'jav', 'doujin', 'xhamster',
  'spankbang', 'beeg', 'tnaflix', 'tube8', 'eporner', 'cam4'
];

const ADULT_KEYWORDS = [
  'video bokep', 'nonton bokep', 'bokep indo', 'video porno', 'film dewasa',
  'cerita dewasa', 'live sex', 'open bo', 'vcs bugil', 'jual konten dewasa',
  'link bokep', 'download bokep', 'video colmek', 'video desah', 'bokep viral'
];

// 3. Anti-Malware / Anti-Scam / Fraud
const MALWARE_KEYWORDS = [
  'free robux generator', 'hack akun ig', 'hack akun fb', 'download cheat gratis',
  'phishing link', 'ddos booter tool', 'keylogger free download', 'trojan builder'
];

// 4. Sacred & Sensitive Data Blacklist
const SACRED_DATA_PATTERNS = [
  /\b(?:password|passwd|pin\s+atm|cvv|nomor\s+kartu\s+kredit|seed\s+phrase|recovery\s+phrase|private\s+key|secret\s+key|api_key|token\s+jwt|id_rsa)\b/i,
  /\b(?:database\s+leak|leaked\s+credentials|dump\s+password|hack\s+akun|doxxing|ktp\s+asli|nik\s+pribadi|kartu\s+keluarga)\b/i
];

function isSacredData(queryOrUrl) {
  if (!queryOrUrl) return false;
  const lower = queryOrUrl.toLowerCase();
  return SACRED_DATA_PATTERNS.some(pattern => pattern.test(lower));
}

function cleanSpamFromText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u4e00-\u9fff]{2,}/g, '') // Strip CJK SEO spam
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip non-printable chars
    .replace(/\s+/g, ' ')
    .trim();
}

function isHarmfulContent(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  if (GAMBLING_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (ADULT_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (MALWARE_KEYWORDS.some(kw => lower.includes(kw))) return true;
  return false;
}

function filterSafeResults(results) {
  if (!results || !Array.isArray(results)) return [];
  return results.filter(r => {
    const url = (r.url || '').toLowerCase();
    const title = (r.title || '').toLowerCase();
    const content = (r.content || '').toLowerCase();
    const combined = `${url} ${title} ${content}`;

    if (GAMBLING_DOMAINS.some(d => url.includes(d))) return false;
    if (ADULT_DOMAINS.some(d => url.includes(d))) return false;
    if (isHarmfulContent(combined)) return false;
    return true;
  }).map(r => ({
    ...r,
    title: cleanSpamFromText(r.title),
    content: cleanSpamFromText(r.content)
  }));
}

// ══════════════════════════════════════════════════════════════
// ── HTTP API CALLER & CACHE ENGINE ────────────────────────────
// ══════════════════════════════════════════════════════════════

function tavilyApiCall(endpoint, payload) {
  return new Promise((resolve, reject) => {
    if (!TAVILY_API_KEY) {
      return reject(new Error('TAVILY_API_KEY belum dikonfigurasi di file .env'));
    }
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.tavily.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error('Gagal mengurai respon Tavily API.'));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Waktu respon Tavily API habis.'));
    });
    req.write(postData);
    req.end();
  });
}

// 10-Minute High-Speed In-Memory Cache
const tavilyMemoryCache = new Map();
const TAVILY_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

function getCachedTavily(key) {
  const entry = tavilyMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TAVILY_CACHE_TTL_MS) {
    tavilyMemoryCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedTavily(key, data) {
  if (!data) return;
  if (tavilyMemoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = tavilyMemoryCache.keys().next().value;
    tavilyMemoryCache.delete(oldestKey);
  }
  tavilyMemoryCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Clean user prompt into an optimal search engine query
 * @param {string} prompt 
 * @returns {string}
 */
function cleanSearchQuery(prompt) {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt
    .replace(/^(?:azura|ara|zura|ajur)?\s*(?:tolong|coba|dong|plis|please)?\s*(?:cariin|carikan|cari|search|googling|info|berita|kabar|apa\s+itu|siapa\s+itu|gimana|bagaimana)\s+(?:tentang|soal|terbaru|terkini|mengenai)?\s*/i, '')
    .replace(/[?!.]+$/, '')
    .trim() || prompt.trim();
}

// ══════════════════════════════════════════════════════════════
// ── CORE SEARCH & RESEARCH METHODS ────────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Perform live Tavily web search with multi-pass fallback
 * @param {string} query 
 * @param {string} [topicMode] 
 * @returns {Promise<string>}
 */
async function searchTavily(query, topicMode = 'general') {
  const cleanQ = cleanSearchQuery(query);
  const cacheKey = `search:${topicMode}:${cleanQ.toLowerCase()}`;
  const cached = getCachedTavily(cacheKey);
  if (cached) return cached;

  try {
    try {
      const { recordDailyMetric } = require('./digest');
      recordDailyMetric('webSearches', 1);
    } catch (_) {}

    // Pass 1: Advanced search
    let response = await tavilyApiCall('/search', {
      query: cleanQ,
      topic: topicMode,
      search_depth: 'advanced',
      include_answer: true,
      max_results: 4
    });

    let safeResults = filterSafeResults(response.results);

    // Pass 2 Fallback: If 0 safe results in news mode, retry general
    if ((!safeResults || safeResults.length === 0) && topicMode === 'news') {
      console.log(`[Tavily Search]: Pass 2 - Retrying query with general topic for "${cleanQ}"...`);
      response = await tavilyApiCall('/search', {
        query: cleanQ,
        topic: 'general',
        search_depth: 'advanced',
        include_answer: true,
        max_results: 4
      });
      safeResults = filterSafeResults(response.results);
    }

    let resultStr = '';
    if (response.answer && !isHarmfulContent(response.answer)) {
      resultStr += `💡 **Rangkuman Eksekutif Terkini (Bahasa Indonesia):**\n${response.answer}\n\n`;
    }

    if (safeResults.length > 0) {
      const top3 = safeResults.slice(0, 3);
      const formattedResults = top3.map((r, idx) => {
        const date = r.published_date ? ` • 📅 ${r.published_date.slice(0, 10)}` : '';
        const cleanSnippet = (r.content || '').replace(/\s+/g, ' ').slice(0, 200);
        return `**${idx + 1}. 📌 [${r.title}](${r.url})**${date}\n   📝 *${cleanSnippet}...*`;
      }).join('\n\n');

      resultStr += `🌐 **Sumber Web Terverifikasi:**\n\n${formattedResults}`;
    }

    const finalResult = resultStr || `Tidak ditemukan informasi terverifikasi di internet untuk query "${cleanQ}".`;
    setCachedTavily(cacheKey, finalResult);
    return finalResult;
  } catch (err) {
    console.error('[Tavily Search Error]:', err.message);
    return `Gagal melakukan pencarian web Tavily: ${err.message}`;
  }
}

/**
 * Extract content from a direct URL
 * @param {string} url 
 * @returns {Promise<string>}
 */
async function extractTavilyUrl(url) {
  const cleanUrl = url.toLowerCase().trim();
  const cacheKey = `url:${cleanUrl}`;
  const cached = getCachedTavily(cacheKey);
  if (cached) return cached;

  try {
    if (GAMBLING_DOMAINS.some(d => cleanUrl.includes(d)) || ADULT_DOMAINS.some(d => cleanUrl.includes(d))) {
      return 'URL tersebut terdeteksi sebagai situs yang berpotensi bahaya atau melanggar filter keamanan AZURA.';
    }

    console.log(`[Tavily Extract]: Reading URL: ${url}`);
    const response = await tavilyApiCall('/extract', { urls: [url] });
    if (response.results && response.results.length > 0) {
      const item = response.results[0];
      const title = item.title || 'Dokumen Web';
      const raw = item.raw_content ? cleanSpamFromText(item.raw_content) : '';
      if (isHarmfulContent(raw) || isHarmfulContent(title)) {
        return 'Konten halaman web tersebut diblokir oleh sistem keamanan AZURA.';
      }

      const cleanContent = raw ? raw.slice(0, 1500) : 'Tidak ada konten teks yang dapat diekstrak.';
      const extractedText = `📄 **Ekstraksi Artikel Web (Tavily Intelligence):**\n` +
        `📌 **Judul:** ${title}\n` +
        `🔗 **URL:** ${url}\n\n` +
        `📝 **Rangkuman Konten Utama:**\n${cleanContent}`;
      setCachedTavily(cacheKey, extractedText);
      return extractedText;
    }
    return 'Gagal mengekstrak isi artikel dari URL tersebut.';
  } catch (err) {
    console.error('[Tavily Extract Error]:', err.message);
    return 'Gagal mengekstrak URL: ' + err.message;
  }
}

/**
 * Generate an aesthetic, modern Discord Embed Card with interactive Link Buttons
 * @param {string} query 
 * @param {string} [topicMode] 
 * @param {string} [userName] 
 * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder[] } | string>}
 */
async function searchTavilyCard(query, topicMode = 'news', userName = 'Pengguna') {
  try {
    const cleanQ = cleanSearchQuery(query);
    console.log(`[Tavily Card]: Generating aesthetic search card for "${cleanQ}"...`);

    let response = await tavilyApiCall('/search', {
      query: cleanQ,
      topic: topicMode,
      search_depth: 'advanced',
      include_answer: true,
      include_images: true,
      max_results: 3
    });

    let safeResults = filterSafeResults(response.results);

    // Fallback pass if 0 results
    if ((!safeResults || safeResults.length === 0) && topicMode === 'news') {
      response = await tavilyApiCall('/search', {
        query: cleanQ,
        topic: 'general',
        search_depth: 'advanced',
        include_answer: true,
        include_images: true,
        max_results: 3
      });
      safeResults = filterSafeResults(response.results);
    }

    if (!safeResults || safeResults.length === 0) {
      return `Maaf ${userName}, aku belum menemukan data atau berita terverifikasi terkait **"${cleanQ}"** di internet saat ini.`;
    }

    // Thumbnail selection
    let thumbnailImage = null;
    if (response.images && Array.isArray(response.images)) {
      for (const imgUrl of response.images) {
        if (typeof imgUrl === 'string' && imgUrl.startsWith('http') && !GAMBLING_DOMAINS.some(d => imgUrl.toLowerCase().includes(d)) && !ADULT_DOMAINS.some(d => imgUrl.toLowerCase().includes(d))) {
          thumbnailImage = imgUrl;
          break;
        }
      }
    }
    if (!thumbnailImage && safeResults) {
      for (const r of safeResults) {
        if (r.image && typeof r.image === 'string' && r.image.startsWith('http')) {
          thumbnailImage = r.image;
          break;
        }
      }
    }
    if (!thumbnailImage) {
      thumbnailImage = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&auto=format&fit=crop&q=60';
    }

    // Summary Text (Bahasa Indonesia)
    let summaryText = response.answer || '';
    if (isHarmfulContent(summaryText)) summaryText = '';
    if (summaryText.length > 350) {
      summaryText = summaryText.slice(0, 350) + '...';
    }

    const embed = new EmbedBuilder()
      .setColor(0x2B82EA) // Royal Azure Blue
      .setTitle(`📰 Riset & Berita Terkini: ${cleanQ.slice(0, 75)}`)
      .setDescription(
        summaryText
          ? `💡 **Ringkasan Inti (Bahasa Indonesia):**\n${summaryText}`
          : `Berikut hasil penelusuran fakta dan berita terverifikasi dari internet:`
      )
      .setFooter({ text: 'AZURA Live Intelligence • Real-Time Web 2026' })
      .setTimestamp();

    if (thumbnailImage) {
      embed.setThumbnail(thumbnailImage);
    }

    // Add Top 3 Sources
    safeResults.slice(0, 3).forEach((r, idx) => {
      const title = r.title || `Sumber #${idx + 1}`;
      const snippet = (r.content || '').replace(/\s+/g, ' ').slice(0, 160);
      const dateStr = r.published_date ? ` • 📅 \`${r.published_date.slice(0, 10)}\`` : '';

      embed.addFields({
        name: `📌 ${idx + 1}. ${title.slice(0, 85)}`,
        value: `${snippet}...${dateStr}`,
        inline: false
      });
    });

    // Action Row Buttons (Source Links)
    const row = new ActionRowBuilder();
    safeResults.slice(0, 3).forEach((r, idx) => {
      if (r.url && r.url.startsWith('http')) {
        let label = `Sumber ${idx + 1}`;
        try {
          const domain = new URL(r.url).hostname.replace('www.', '');
          label = domain.slice(0, 20);
        } catch (_) {}

        row.addComponents(
          new ButtonBuilder()
            .setLabel(`🔗 ${label}`)
            .setStyle(ButtonStyle.Link)
            .setURL(r.url)
        );
      }
    });

    const components = row.components.length > 0 ? [row] : [];
    return { embeds: [embed], components };
  } catch (err) {
    console.error('[Tavily Card Error]:', err.message);
    return `Gagal mengambil data pencarian: ${err.message}`;
  }
}

/**
 * Deep Data Scraper for complex research / table data
 * @param {string} targetInput 
 * @param {string} [dataGoal] 
 * @returns {Promise<{ success: boolean, data: string, sources?: Array<{ title: string, url: string }>, isBlocked?: boolean }>}
 */
async function scrapeWebData(targetInput, dataGoal = 'general') {
  if (isSacredData(targetInput)) {
    return {
      success: false,
      isBlocked: true,
      data: 'Permintaan scraping dibatalkan: Target mengandung pola data rahasia/sensitif terlindungi yang dilarang oleh protokol keamanan AZURA.'
    };
  }

  const urlMatch = targetInput.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const targetUrl = urlMatch[0];
    try {
      const res = await tavilyApiCall('/extract', { urls: [targetUrl] });
      if (res.results && res.results.length > 0) {
        const item = res.results[0];
        const content = item.raw_content ? cleanSpamFromText(item.raw_content).slice(0, 6000) : 'Tidak ada konten teks yang dapat diekstrak.';
        return {
          success: true,
          data: `📊 **Hasil Web Scraping Langsung (Tavily Deep Extract):**\n` +
            `🔗 **URL:** ${targetUrl}\n` +
            `📌 **Judul:** ${item.title || 'Dokumen Web'}\n\n` +
            `📝 **Konten & Data Terstruktur:**\n${content}`,
          sources: [{ title: item.title || 'Sumber Web', url: targetUrl }]
        };
      }
    } catch (err) {
      console.warn('[Tavily Scrape Extract Error]:', err.message);
    }
  }

  try {
    const cleanQ = cleanSearchQuery(targetInput);
    const searchRes = await tavilyApiCall('/search', {
      query: cleanQ,
      search_depth: 'advanced',
      include_raw_content: true,
      include_answer: true,
      max_results: 4
    });

    const safeResults = filterSafeResults(searchRes.results);
    if (!safeResults || safeResults.length === 0) {
      return {
        success: false,
        data: `Tidak ditemukan data web yang relevan untuk query: "${cleanQ}".`
      };
    }

    let structuredOutput = '';
    if (searchRes.answer) {
      structuredOutput += `🧠 **Analisis & Ekstraksi Data Inti (Bahasa Indonesia):**\n${searchRes.answer}\n\n`;
    }

    structuredOutput += `📊 **Rangkuman dari ${safeResults.length} Sumber Terverifikasi:**\n\n`;
    safeResults.forEach((r, i) => {
      const title = r.title || `Data #${i + 1}`;
      const snippet = r.raw_content ? cleanSpamFromText(r.raw_content).slice(0, 1000) : r.content;
      structuredOutput += `### [${i + 1}] ${title}\n🔗 ${r.url}\n${snippet}\n\n`;
    });

    const sources = safeResults.map(r => ({ title: r.title, url: r.url }));
    return {
      success: true,
      data: structuredOutput,
      sources
    };
  } catch (err) {
    console.error('[Tavily Scrape Error]:', err.message);
    return {
      success: false,
      data: `Gagal melakukan scraping data: ${err.message}`
    };
  }
}

async function processTavilyIntelligence(prompt) {
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    return await extractTavilyUrl(urlMatch[0]);
  }

  const lower = prompt.toLowerCase();
  const newsKeywords = ['berita', 'news', 'terkini', 'politik', 'tren', 'kejadian', 'viral', 'kasus', 'peristiwa', 'isu', 'hari ini'];
  const isNews = newsKeywords.some(kw => lower.includes(kw));
  return await searchTavily(prompt, isNews ? 'news' : 'general');
}

module.exports = {
  tavilyApiCall,
  searchTavily,
  searchTavilyCard,
  extractTavilyUrl,
  scrapeWebData,
  isSacredData,
  cleanSearchQuery,
  processTavilyIntelligence
};
