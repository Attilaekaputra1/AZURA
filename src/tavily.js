const https = require('https');

const TAVILY_API_KEY = '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';

/**
 * Execute HTTP POST request to Tavily API
 * @param {string} endpoint 
 * @param {object} payload 
 * @returns {Promise<any>}
 */
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

/**
 * Smart Tavily Search API (Supports News & General topics with Advanced Depth & AI Answer)
 * @param {string} query 
 * @param {'news' | 'general'} topicMode 
 * @returns {Promise<string>}
 */
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

    // If Tavily AI Answer is generated, include it first
    if (response.answer) {
      resultStr += `💡 **Tavily AI Executive Summary:**\n${response.answer}\n\n`;
    }

    if (response.results && response.results.length > 0) {
      const formattedResults = response.results.map((r, idx) => {
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

/**
 * Extract full article text from a specific URL using Tavily Extract API
 * @param {string} url 
 * @returns {Promise<string>}
 */
async function extractTavilyUrl(url) {
  try {
    console.log(`[Tavily Extract]: Reading URL: ${url}`);
    const response = await tavilyApiCall('/extract', {
      urls: [url]
    });

    if (response.results && response.results.length > 0) {
      const item = response.results[0];
      const title = item.title || 'Artikel Web';
      const content = item.raw_content ? item.raw_content.slice(0, 3000) : 'Gagal mengambil isi teks.';
      
      return `📄 **Isi Artikel Web yang Diekstrak (Tavily Extract API):**\nJudul: ${title}\nURL: ${url}\n\nKonten Teks:\n${content}`;
    }

    return 'Gagal mengekstrak isi artikel dari URL tersebut.';
  } catch (err) {
    console.error('[Tavily Extract Error]:', err.message);
    return 'Gagal mengekstrak URL: ' + err.message;
  }
}

/**
 * Smart Router: Detects if prompt contains a URL to extract OR search keywords
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function processTavilyIntelligence(prompt) {
  // Check for URL inside prompt
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const extractedUrl = urlMatch[0];
    return await extractTavilyUrl(extractedUrl);
  }

  // Check for news vs general search keywords
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
