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
    req.setTimeout(18000, () => {
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

// ══════════════════════════════════════════════════════════════
// ── VERIFIED MEDIA PORTALS (GOOGLE NEWS ID & WORLD) ────────────
// ══════════════════════════════════════════════════════════════

// Verified Indonesian National Media (Dewan Pers / Google News Indonesia)
const INDONESIA_NEWS_DOMAINS = [
  'detik.com',
  'kompas.com',
  'tempo.co',
  'cnnindonesia.com',
  'antaranews.com',
  'kumparan.com',
  'liputan6.com',
  'tribunnews.com',
  'cnbcindonesia.com',
  'bisnis.com',
  'merdeka.com',
  'suara.com',
  'sindonews.com',
  'jawapos.com',
  'republika.co.id',
  'idntimes.com'
];

// Verified International Media (Google News World / Global)
const INTERNATIONAL_NEWS_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bloomberg.com',
  'aljazeera.com',
  'theguardian.com',
  'nytimes.com',
  'cnn.com',
  'ft.com',
  'washingtonpost.com',
  'theverge.com',
  'techcrunch.com'
];

/**
 * Detect whether query targets Indonesian National vs International news
 * @param {string} query 
 * @param {string} [rawPrompt]
 * @returns {'national' | 'international' | 'general'}
 */
function detectNewsScope(query, rawPrompt = '') {
  const combined = `${query || ''} ${rawPrompt || ''}`.toLowerCase();
  const isInternational = /\b(?:internasional|international|global|dunia|world|luar\s+negeri|amerika|us|usa|eropa|timur\s+tengah|rusia|ukraina|china|tiongkok|jepang|palestina|gaza|israel|iran|inggris|uk|prancis|jerman|korea)\b/i.test(combined);

  if (isInternational) return 'international';
  // Default all Indonesian news/topics to Indonesian National Portals (Dewan Pers / Google News ID)
  return 'national';
}

/**
 * Format friendly portal brand name from URL
 * @param {string} url 
 * @returns {string}
 */
function formatPortalBrand(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const brandMap = {
      'detik.com': 'Detikcom',
      'kompas.com': 'Kompas.com',
      'tempo.co': 'Tempo.co',
      'cnnindonesia.com': 'CNN Indonesia',
      'antaranews.com': 'Antara News',
      'kumparan.com': 'Kumparan',
      'liputan6.com': 'Liputan6',
      'tribunnews.com': 'Tribunnews',
      'cnbcindonesia.com': 'CNBC Indonesia',
      'bisnis.com': 'Bisnis.com',
      'merdeka.com': 'Merdeka.com',
      'suara.com': 'Suara.com',
      'sindonews.com': 'Sindonews',
      'jawapos.com': 'Jawa Pos',
      'republika.co.id': 'Republika',
      'idntimes.com': 'IDN Times',
      'reuters.com': 'Reuters',
      'apnews.com': 'AP News',
      'bbc.com': 'BBC News',
      'bloomberg.com': 'Bloomberg',
      'aljazeera.com': 'Al Jazeera',
      'theguardian.com': 'The Guardian',
      'nytimes.com': 'New York Times',
      'cnn.com': 'CNN World',
      'theverge.com': 'The Verge',
      'techcrunch.com': 'TechCrunch'
    };
    return brandMap[host] || host;
  } catch (_) {
    return 'Media Terpercaya';
  }
}

/**
 * Clean user prompt into an optimal search engine query, extracting reply context if needed
 * @param {string} prompt 
 * @returns {string}
 */
function cleanSearchQuery(prompt) {
  if (!prompt || typeof prompt !== 'string') return '';

  let raw = prompt.trim();
  let extractedReply = '';

  // 1. Extract referenced / replied message text if present: [Konteks Membalas Pesan @User]: "..."
  const replyMatch = raw.match(/\[Konteks\s+(?:Membalas\s+Pesan\s+)?@[^\]]+\]:\s*"([^"]+)"/i);
  if (replyMatch) {
    extractedReply = replyMatch[1].trim();
    raw = raw.replace(/\[Konteks\s+[^\]]+\]:\s*"[^"]*"\s*/gi, '').trim();
  }

  // 2. Strip any other system context wrappers
  raw = raw
    .replace(/\[Konteks\s+[^\]]+\]\s*/gi, '')
    .replace(/\[Isi\s+Lampiran\s+[^\]]+\]:\s*```[\s\S]*?```/gi, '')
    .replace(/\[Transkrip\s+Suara\]:\s*"[^"]*"/gi, '')
    .replace(/<@!?[0-9]+>/g, '')
    .replace(/^@?(?:azura|ara|zura|ajur|ajura|asura)\b[,:\s]*/gi, '')
    .trim();

  // 3. Determine if current text is just a bot invocation / conversational filler
  const isFiller = /^(?:azura|ara|zura|ajur|ajura|asura|tolong|coba|dong|plis|please|cek|lihat|ya|yuk|apa\s+ini|ini\s+apa)*$/i.test(raw);

  let targetQuery = '';
  if (extractedReply && (isFiller || !raw)) {
    targetQuery = extractedReply;
  } else if (extractedReply && raw) {
    targetQuery = `${extractedReply} ${raw}`;
  } else {
    targetQuery = raw;
  }

  // 4. Strip search command verbs and conversational prefixes
  let clean = targetQuery
    .replace(/^(?:azura|ara|zura|ajur|ajura|asura)?\s*(?:tolong|coba|dong|plis|please|bisa\s+gak|mau\s+nanya)?\s*(?:cariin|carikan|cari|search|googling|info|berita|kabar|apa\s+itu|siapa\s+itu|gimana|bagaimana|cek\s+info|cek|lihat)\s+(?:tentang|soal|terbaru|terkini|mengenai|kondisi|update)?\s*/i, '')
    .replace(/\s+(?:dong|ya|yuk|plis|please|deh|kan)$/i, '')
    .replace(/[?!.]+$/, '')
    .trim();

  return clean || targetQuery.trim() || prompt.trim();
}

/**
 * Ensure summary is in fluent, natural Bahasa Indonesia (Google News style)
 * @param {string} text 
 * @param {string} query 
 * @param {Array<object>} results 
 * @returns {Promise<string>}
 */
async function ensureIndonesianSummary(text, query, results = []) {
  if (!text && (!results || results.length === 0)) return '';

  // Check if text has English words
  const englishMatches = (text || '').match(/\b(?:the|is|are|was|were|has|have|had|in|on|at|by|with|from|to|for|of|and|but|that|this|which|today|news|report|includes|updates|demonstration|government|plant|owned|tests)\b/gi) || [];
  const isEnglish = englishMatches.length >= 2;

  if (!isEnglish && text && text.trim().length > 35) {
    return text.trim();
  }

  // Fast synthesis & translation via OpenAI gpt-5.6-luna
  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    const contextContent = (text ? `Rangkuman Mentah: ${text}\n\n` : '') + (results || []).slice(0, 3).map((r, i) => `Sumber ${i + 1} (${r.title}): ${r.content}`).join('\n');

    const comp = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-5.6-luna',
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah jurnalis berita AZURA. Rangkum inti berita berikut ke dalam 2-3 kalimat Bahasa Indonesia yang sangat fasih, aktual, informatif, dan mudah dipahami. WAJIB 100% BAHASA INDONESIA, DILARANG KERAS menggunakan bahasa Inggris.'
        },
        {
          role: 'user',
          content: `Topik: "${query}"\n\nData Berita:\n${contextContent.slice(0, 1500)}`
        }
      ],
      max_completion_tokens: 200
    });

    const translated = comp.choices[0]?.message?.content?.trim();
    if (translated) return translated;
  } catch (err) {
    console.error('[ensureIndonesianSummary Error]:', err.message);
  }

  return text || '';
}

// ══════════════════════════════════════════════════════════════
// ── CORE SEARCH & RESEARCH METHODS ────────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Perform live Tavily web search with multi-pass fallback and Google News style portals
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

    const isTodayQuery = /\b(?:hari\s+ini|today|sekarang|tadi|pagi\s+ini|siang\s+ini|sore\s+ini|malam\s+ini)\b/i.test(query);
    const isNews = topicMode === 'news' || isTodayQuery || /\b(?:terkini|terbaru|update|minggu\s+ini|bulan\s+ini|2026)\b/i.test(query);
    const scope = detectNewsScope(cleanQ);

    // Pass 1: Advanced search with strict temporal freshness & verified media portals
    const payload = {
      query: cleanQ,
      topic: isNews ? 'news' : topicMode,
      search_depth: 'advanced',
      include_answer: true,
      max_results: 4
    };
    if (isTodayQuery) {
      payload.days = 1; // Strict 24-hour / Today only
    } else if (isNews) {
      payload.days = 3; // Strict 3-day max
    }

    if (isNews) {
      if (scope === 'national') {
        payload.include_domains = INDONESIA_NEWS_DOMAINS;
      } else if (scope === 'international') {
        payload.include_domains = INTERNATIONAL_NEWS_DOMAINS;
      }
    }

    let response = await tavilyApiCall('/search', payload);
    let safeResults = filterSafeResults(response.results);

    // Pass 2 Fallback: If 0 safe results with domain filter, retry broader news or general
    if ((!safeResults || safeResults.length === 0) && isNews) {
      console.log(`[Tavily Search]: Pass 2 - Retrying query without domain restriction for "${cleanQ}"...`);
      const fallbackPayload = {
        query: cleanQ,
        topic: 'news',
        search_depth: 'advanced',
        include_answer: true,
        days: isTodayQuery ? 1 : 3,
        max_results: 4
      };
      response = await tavilyApiCall('/search', fallbackPayload);
      safeResults = filterSafeResults(response.results);
    }

    // Pass 3 Fallback: General topic
    if (!safeResults || safeResults.length === 0) {
      response = await tavilyApiCall('/search', {
        query: cleanQ,
        topic: 'general',
        search_depth: 'advanced',
        include_answer: true,
        max_results: 4
      });
      safeResults = filterSafeResults(response.results);
    }

    // Ensure fluent Indonesian summary
    let indonesianSummary = await ensureIndonesianSummary(response.answer, cleanQ, safeResults);
    if (isHarmfulContent(indonesianSummary)) indonesianSummary = '';

    let resultStr = '';
    if (indonesianSummary) {
      resultStr += `💡 **Rangkuman Eksekutif Terkini (Bahasa Indonesia):**\n${indonesianSummary}\n\n`;
    }

    if (safeResults.length > 0) {
      const top3 = safeResults.slice(0, 3);
      const formattedResults = top3.map((r, idx) => {
        const brand = formatPortalBrand(r.url);
        const date = r.published_date ? ` • 📅 ${r.published_date.slice(0, 10)}` : '';
        const cleanSnippet = (r.content || '').replace(/\s+/g, ' ').slice(0, 200);
        return `**${idx + 1}. 📌 [${r.title}](${r.url})** (*${brand}*${date})\n   📝 *${cleanSnippet}...*`;
      }).join('\n\n');

      const portalHeader = scope === 'national'
        ? '🇮🇩 **Sumber Media Nasional Terverifikasi (Dewan Pers / Google News ID):**'
        : (scope === 'international' ? '🌍 **Sumber Media Internasional Terverifikasi (Google News World):**' : '🌐 **Sumber Web Terverifikasi:**');

      resultStr += `${portalHeader}\n\n${formattedResults}`;
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
 * @param {string} rawUrl 
 * @returns {Promise<string>}
 */
async function extractTavilyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return 'URL tidak valid.';
  const url = rawUrl.trim().replace(/[.,!?;:)>\]"']+$/, '');
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

      const cleanContent = raw ? raw.slice(0, 3000) : 'Tidak ada konten teks yang dapat diekstrak.';
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
 * Generate an aesthetic, modern Discord Embed Card with Google News media portal buttons
 * @param {string} query 
 * @param {string} [topicMode] 
 * @param {string} [userName] 
 * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder[] } | string>}
 */
async function searchTavilyCard(query, topicMode = 'news', userName = 'Pengguna') {
  try {
    const cleanQ = cleanSearchQuery(query);
    console.log(`[Tavily Card]: Generating aesthetic search card for "${cleanQ}"...`);

    const isTodayQuery = /\b(?:hari\s+ini|today|sekarang|tadi|pagi\s+ini|siang\s+ini|sore\s+ini|malam\s+ini)\b/i.test(query);
    const isNews = topicMode === 'news' || isTodayQuery || /\b(?:terkini|terbaru|update|minggu\s+ini|bulan\s+ini|2026)\b/i.test(query);
    const scope = detectNewsScope(cleanQ);

    const payload = {
      query: cleanQ,
      topic: isNews ? 'news' : topicMode,
      search_depth: 'advanced',
      include_answer: true,
      include_images: true,
      max_results: 3
    };
    if (isTodayQuery) {
      payload.days = 1; // Strict Today only
    } else if (isNews) {
      payload.days = 3; // Strict 3 days max
    }

    if (isNews) {
      if (scope === 'national') {
        payload.include_domains = INDONESIA_NEWS_DOMAINS;
      } else if (scope === 'international') {
        payload.include_domains = INTERNATIONAL_NEWS_DOMAINS;
      }
    }

    let response = await tavilyApiCall('/search', payload);
    let safeResults = filterSafeResults(response.results);

    // Fallback pass if 0 results
    if ((!safeResults || safeResults.length === 0) && isNews) {
      response = await tavilyApiCall('/search', {
        query: cleanQ,
        topic: 'news',
        search_depth: 'advanced',
        include_answer: true,
        include_images: true,
        days: isTodayQuery ? 1 : 3,
        max_results: 3
      });
      safeResults = filterSafeResults(response.results);
    }

    if (!safeResults || safeResults.length === 0) {
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

    // Guaranteed Fluent Bahasa Indonesia Summary
    let summaryText = await ensureIndonesianSummary(response.answer, cleanQ, safeResults);
    if (isHarmfulContent(summaryText)) summaryText = '';
    if (summaryText.length > 350) {
      summaryText = summaryText.slice(0, 350) + '...';
    }

    const portalBadge = scope === 'national'
      ? '🇮🇩 Media Nasional'
      : (scope === 'international' ? '🌍 Media Internasional' : '🌐 Web Intelligence');

    const embed = new EmbedBuilder()
      .setColor(0x2B82EA) // Royal Azure Blue
      .setTitle(`📰 ${portalBadge}: ${cleanQ.slice(0, 70)}`)
      .setDescription(
        summaryText
          ? `💡 **Ringkasan Inti Berita (Bahasa Indonesia):**\n${summaryText}`
          : `Berikut hasil penelusuran portal berita resmi terverifikasi dari internet:`
      )
      .setFooter({ text: 'AZURA News Intelligence • Google News Certified • Real-Time Web 2026' })
      .setTimestamp();

    if (thumbnailImage) {
      embed.setThumbnail(thumbnailImage);
    }

    // Add Top 3 Sources with Brand Badges
    safeResults.slice(0, 3).forEach((r, idx) => {
      const brand = formatPortalBrand(r.url);
      const title = r.title || `Sumber #${idx + 1}`;
      const snippet = (r.content || '').replace(/\s+/g, ' ').slice(0, 160);
      const dateStr = r.published_date ? ` • 📅 \`${r.published_date.slice(0, 10)}\`` : '';

      embed.addFields({
        name: `📌 ${idx + 1}. [${brand}] ${title.slice(0, 75)}`,
        value: `${snippet}...${dateStr}`,
        inline: false
      });
    });

    // Action Row Buttons with Official Portal Names
    const row = new ActionRowBuilder();
    safeResults.slice(0, 3).forEach((r) => {
      if (r.url && r.url.startsWith('http')) {
        const brand = formatPortalBrand(r.url);
        row.addComponents(
          new ButtonBuilder()
            .setLabel(`🔗 ${brand}`)
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
  processTavilyIntelligence,
  filterSafeResults,
  ensureIndonesianSummary,
  detectNewsScope
};
