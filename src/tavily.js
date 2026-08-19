const https = require('https');
const config = require('./config');

const TAVILY_API_KEY = config.TAVILY_API_KEY || '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';

// Anti-Judol / Anti-Gambling domain & keyword blacklists
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
  'anti rungkad', 'pasti profit', 'cuan slot', 'modal receh'
];

function filterSafeResults(results) {
  if (!results || !Array.isArray(results)) return [];
  return results.filter(r => {
    const url = (r.url || '').toLowerCase();
    const title = (r.title || '').toLowerCase();
    const content = (r.content || '').toLowerCase();
    const combined = `${url} ${title} ${content}`;
    const hasBadDomain = GAMBLING_DOMAINS.some(d => url.includes(d));
    if (hasBadDomain) {
      console.log(`[Tavily Safety Filter]: BLOCKED gambling domain: ${r.url}`);
      return false;
    }
    const hasBadKeyword = GAMBLING_KEYWORDS.some(kw => combined.includes(kw));
    if (hasBadKeyword) {
      console.log(`[Tavily Safety Filter]: BLOCKED gambling content: ${r.title}`);
      return false;
    }
    return true;
  });
}

function containsGamblingContent(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GAMBLING_KEYWORDS.some(kw => lower.includes(kw));
}

function tavilyApiCall(endpoint, payload) {
  return new Promise((resolve, reject) => {
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
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Waktu respon Tavily API habis.'));
    });
    req.write(postData);
    req.end();
  });
}

async function searchTavily(query, topicMode = 'general') {
  try {
    const response = await tavilyApiCall('/search', {
      query: query,
      topic: topicMode,
      search_depth: 'advanced',
      include_answer: true,
      max_results: 5
    });
    let resultStr = '';
    if (response.answer && !containsGamblingContent(response.answer)) {
      resultStr += `💡 **Tavily AI Executive Summary:**\n${response.answer}\n\n`;
    }
    const safeResults = filterSafeResults(response.results);
    if (safeResults.length > 0) {
      const formattedResults = safeResults.map((r, idx) => {
        const date = r.published_date ? ` (Dipublikasikan: ${r.published_date})` : '';
        const score = r.score ? ` (Relevansi: ${(r.score * 100).toFixed(0)}%)` : '';
        return `${idx + 1}. **${r.title}**${date}${score}\n   🔗 Link: ${r.url}\n   📝 Ringkasan: ${r.content}`;
      }).join('\n\n--------------------\n\n');
      resultStr += `🌐 **Hasil Pencarian Web Terverifikasi (Tavily Advanced Engine):**\n\n${formattedResults}`;
    }
    return resultStr || 'Tidak ditemukan informasi spesifik dari web.';
  } catch (err) {
    console.error('[Tavily Search Error]:', err.message);
    return 'Gagal melakukan pencarian web Tavily: ' + err.message;
  }
}

async function extractTavilyUrl(url) {
  try {
    const lowerUrl = url.toLowerCase();
    if (GAMBLING_DOMAINS.some(d => lowerUrl.includes(d))) {
      console.log(`[Tavily Safety Filter]: BLOCKED extraction of gambling URL: ${url}`);
      return 'URL tersebut terdeteksi sebagai situs yang tidak aman dan diblokir oleh sistem keamanan AZURA.';
    }
    console.log(`[Tavily Extract]: Reading URL: ${url}`);
    const response = await tavilyApiCall('/extract', { urls: [url] });
    if (response.results && response.results.length > 0) {
      const item = response.results[0];
      const title = item.title || 'Artikel Web';
      const content = item.raw_content ? item.raw_content.slice(0, 3000) : 'Gagal mengambil isi teks.';
      if (containsGamblingContent(content) || containsGamblingContent(title)) {
        console.log(`[Tavily Safety Filter]: BLOCKED gambling content in extracted article: ${title}`);
        return 'Konten artikel tersebut terdeteksi mengandung unsur perjudian online dan diblokir oleh sistem keamanan AZURA.';
      }
      return `📄 **Isi Artikel Web yang Diekstrak (Tavily Extract API):**\nJudul: ${title}\nURL: ${url}\n\nKonten Teks:\n${content}`;
    }
    return 'Gagal mengekstrak isi artikel dari URL tersebut.';
  } catch (err) {
    console.error('[Tavily Extract Error]:', err.message);
    return 'Gagal mengekstrak URL: ' + err.message;
  }
}

async function processTavilyIntelligence(prompt) {
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const extractedUrl = urlMatch[0];
    return await extractTavilyUrl(extractedUrl);
  }
  const lower = prompt.toLowerCase();
  const newsKeywords = ['berita', 'news', 'terbaru', 'terkini', 'hari ini', 'update', 'politik', 'tren', 'kejadian'];
  const generalSearchKeywords = ['cuaca', 'weather', 'harga', 'price', 'kurs', 'search', 'cari', 'cariin', 'googling', 'cek info', 'siapa itu', 'apa itu', 'kapan'];
  const isNews = newsKeywords.some(kw => lower.includes(kw));
  const isGeneral = generalSearchKeywords.some(kw => lower.includes(kw));
  if (isNews) {
    console.log(`[Tavily Engine]: Executing News Search (topic: news, depth: advanced)...`);
    return await searchTavily(prompt, 'news');
  }
  if (isGeneral) {
    console.log(`[Tavily Engine]: Executing General Search (topic: general, depth: advanced)...`);
    return await searchTavily(prompt, 'general');
  }
  return null;
}

module.exports = {
  searchTavily,
  extractTavilyUrl,
  processTavilyIntelligence
};
