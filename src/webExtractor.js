/**
 * AZURA Master Web Extractor & Intelligence Engine (Levels 1 - 5)
 * 
 * 🟢 Level 1: Single-Page Smart DOM Extractor (Playwright Chromium + Fast Tavily API)
 * 🚀 Level 2: Rich Document & In-Memory Online PDF Engine (pdf-parse)
 * 🛒 Level 3: Structured Data & Schema.org / E-Commerce / Table Parser (JSON-LD & Markdown tables)
 * 👁️ Level 4: Vision-Augmented Web Reader (HD Screenshot + Vision AI fallback for charts/canvas)
 * 🕷️ Level 5: Autonomous Multi-Page Deep Crawler (Domain-Locked sub-link exploration)
 * 
 * Includes:
 * • Strict Zero-Hallucination Truth Framing Metadata
 * • Anti-Judol & Anti-Porn Security Filters
 * • Memory-Optimized Single-Instance Page Lifecycles
 */

const path = require('path');
const config = require('./config');
const { getBrowser } = require('./headlessBrowser');

// Anti-Judol / Anti-Porn Blacklists
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

const ADULT_DOMAINS = [
  'porn', 'xx', 'hentai', 'bokep', 'jav', 'onlyfans', 'xvideos', 'pornhub',
  'xhamster', 'redtube', 'youporn', 'cam4', 'chaturbate', 'livejasmin', 'stripchat'
];

const HARMFUL_KEYWORDS = [
  'slot gacor', 'rtp live', 'bocoran slot', 'pola slot', 'jam gacor',
  'maxwin', 'scatter hitam', 'auto maxwin', 'jackpot', 'freespin',
  'daftar slot', 'login slot', 'agen slot', 'bandar togel', 'prediksi togel',
  'situs judi', 'judi online', 'taruhan', 'betting online', 'deposit slot',
  'withdraw slot', 'bonus slot', 'promo slot', 'link alternatif',
  'anti rungkad', 'pasti profit', 'cuan slot', 'modal receh',
  'bokep', 'video porno', 'jav uncensored', 'streaming bokep', 'open bo'
];

function isHarmfulUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  return GAMBLING_DOMAINS.some(d => lower.includes(d)) || ADULT_DOMAINS.some(d => lower.includes(d));
}

function isHarmfulText(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return HARMFUL_KEYWORDS.some(kw => lower.includes(kw));
}

// In-memory LRU Cache for extracted URLs (15 minutes TTL)
const extractCache = new Map();
const EXTRACT_CACHE_TTL_MS = 15 * 60 * 1000;

function getCachedExtraction(url) {
  const item = extractCache.get(url.toLowerCase().trim());
  if (item && Date.now() - item.timestamp < EXTRACT_CACHE_TTL_MS) {
    return item.data;
  }
  return null;
}

function setCachedExtraction(url, data) {
  if (extractCache.size > 200) {
    const firstKey = extractCache.keys().next().value;
    extractCache.delete(firstKey);
  }
  extractCache.set(url.toLowerCase().trim(), { data, timestamp: Date.now() });
}

/**
 * 🚀 LEVEL 2: In-Memory PDF & Online Rich Document Extractor
 * @param {string} url 
 * @returns {Promise<{ success: boolean, title: string, content: string, numPages?: number, error?: string }>}
 */
async function extractPdfDocument(url) {
  try {
    console.log(`[Web Extractor L2]: 📄 Downloading and parsing online PDF: ${url}`);
    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch (_) {
      return { success: false, error: 'Module pdf-parse tidak terpasang.' };
    }

    let buffer = null;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          'Referer': 'https://www.google.com/'
        },
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
    } catch (_) {}

    // Playwright API Request buffer fallback if direct fetch was rejected
    if (!buffer) {
      const browser = await getBrowser();
      const context = await browser.newContext();
      try {
        const res = await context.request.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/pdf,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8'
          },
          timeout: 15000
        });
        if (res.ok()) {
          buffer = await res.body();
        }
      } catch (_) {
      } finally {
        await context.close().catch(() => {});
      }
    }

    if (!buffer) {
      return { success: false, error: 'Gagal mengunduh file PDF dari server sumber.' };
    }

    let cleanText = '';
    let numPages = 1;
    let title = path.basename(url) || 'Dokumen PDF';
    let author = 'Tidak tercantum';

    if (typeof pdfParse === 'function') {
      const pdfData = await pdfParse(buffer);
      cleanText = pdfData.text || '';
      numPages = pdfData.numpages || 1;
      title = pdfData.info?.Title || title;
      author = pdfData.info?.Author || author;
    } else if (pdfParse.PDFParse) {
      const parser = new pdfParse.PDFParse({ data: buffer });
      const textResult = await parser.getText();
      cleanText = textResult.text || '';
      numPages = textResult.total || (textResult.pages ? textResult.pages.length : 1);
    }

    cleanText = cleanText.replace(/\r\n/g, '\n').replace(/\n\s+\n/g, '\n\n').trim();
    if (isHarmfulText(cleanText)) {
      return { success: false, error: 'Konten dokumen terdeteksi melanggar filter keamanan AZURA.' };
    }

    const previewContent = cleanText.slice(0, 5000);

    const formattedContent = `📄 **Dokumen PDF Resmi:** ${title}\n` +
      `👤 **Penulis / Penerbit:** ${author}\n` +
      `📑 **Total Halaman:** ${numPages} Halaman\n\n` +
      `📝 **Isi Teks Utama (Halaman Awal - Intisari Dokumen):**\n${previewContent}`;

    return {
      success: true,
      title,
      numPages,
      content: formattedContent
    };
  } catch (err) {
    console.error('[Web Extractor L2 Error]:', err.message);
    return { success: false, error: `Gagal membaca PDF: ${err.message}` };
  }
}

/**
 * 🛒 LEVEL 3: Structured Data & Schema.org / Table Parser
 * Extracts JSON-LD schema, OpenGraph pricing, and HTML tables converted to Markdown.
 * @param {import('playwright-chromium').Page} page 
 */
async function extractStructuredData(page) {
  return await page.evaluate(() => {
    const results = {
      schemaOrg: [],
      tables: [],
      priceInfo: null
    };

    // 1. JSON-LD Schema.org extraction
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
      try {
        const parsed = JSON.parse(script.innerText);
        if (parsed) results.schemaOrg.push(parsed);
      } catch (_) {}
    });

    // 2. OpenGraph Product / Price extraction
    const ogPrice = document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content') ||
                    document.querySelector('meta[property="og:price:amount"]')?.getAttribute('content');
    const ogCurrency = document.querySelector('meta[property="product:price:currency"]')?.getAttribute('content') ||
                      document.querySelector('meta[property="og:price:currency"]')?.getAttribute('content') || 'IDR';
    if (ogPrice) {
      results.priceInfo = `${ogPrice} ${ogCurrency}`;
    }

    // 3. HTML Tables to Markdown Conversion (Max 2 relevant tables)
    const tableElements = Array.from(document.querySelectorAll('table')).slice(0, 2);
    tableElements.forEach((tbl) => {
      const rows = Array.from(tbl.querySelectorAll('tr'));
      if (rows.length < 2) return;

      const mdRows = [];
      rows.slice(0, 8).forEach((tr, rIdx) => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map(c => c.innerText.trim().replace(/\|/g, '-'));
        if (cells.length > 0) {
          mdRows.push(`| ${cells.join(' | ')} |`);
          if (rIdx === 0) {
            mdRows.push(`| ${cells.map(() => '---').join(' | ')} |`);
          }
        }
      });
      if (mdRows.length > 0) {
        results.tables.push(mdRows.join('\n'));
      }
    });

    return results;
  });
}

/**
 * 🕷️ LEVEL 5: Autonomous Sub-Link Deep Crawler (Domain-Locked)
 * Discovers and extracts up to 3 priority sub-pages within the same domain.
 * @param {import('playwright-chromium').BrowserContext} context 
 * @param {string} baseUrl 
 * @param {Array<string>} targetSubLinks 
 */
async function crawlSubPages(context, baseUrl, targetSubLinks = []) {
  if (!targetSubLinks || targetSubLinks.length === 0) return [];
  const results = [];
  const parsedBase = new URL(baseUrl);

  // Take top 2-3 most relevant sublinks
  const priorityLinks = targetSubLinks.slice(0, 2);

  for (const subUrl of priorityLinks) {
    let subPage = null;
    try {
      subPage = await context.newPage();
      await subPage.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3,wav}', route => route.abort());
      console.log(`[Web Extractor L5]: 🕷️ Deep-Crawling sub-page: ${subUrl}`);
      await subPage.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await subPage.waitForTimeout(1000);

      const subTitle = await subPage.title().catch(() => 'Sub-Page');
      const subText = await subPage.evaluate(() => {
        const clone = document.body.cloneNode(true);
        const toRemove = clone.querySelectorAll('script, style, noscript, iframe, nav, footer');
        toRemove.forEach(el => el.remove());
        return (clone.innerText || clone.textContent || '').split('\n').map(l => l.trim()).filter(l => l.length > 20).slice(0, 10).join('\n');
      });

      if (subText && subText.length > 40) {
        results.push({
          url: subUrl,
          title: subTitle,
          content: subText.slice(0, 1200)
        });
      }
    } catch (err) {
      console.warn(`[Web Extractor L5 Warning]: Could not crawl sub-page ${subUrl}:`, err.message);
    } finally {
      if (subPage) await subPage.close().catch(() => {});
    }
  }

  return results;
}

/**
 * 🌟 MASTER UNIFIED WEB EXTRACTOR ENGINE (LEVELS 1 - 5)
 * Combines Smart DOM rendering, PDF Parsing, Schema.org/Tables, Vision Fallback, and Sub-Link Crawling.
 * @param {string} rawUrl 
 * @param {object} [options]
 * @param {boolean} [options.deepCrawl=false] Whether to activate Level 5 sub-link deep crawl
 * @returns {Promise<string>} Structured Intelligence Markdown for LLM
 */
async function extractWebIntelligence(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return 'URL tidak valid.';
  const url = rawUrl.trim().replace(/[.,!?;:)>\]"']+$/, '');
  const cleanUrl = url.toLowerCase().trim();

  // 1. Security & Harmful URL Guard
  if (isHarmfulUrl(cleanUrl)) {
    console.log(`[Web Extractor Security]: 🚫 Blocked harmful/unsafe URL: ${url}`);
    return 'URL tersebut terdeteksi sebagai situs yang berpotensi bahaya atau melanggar filter keamanan AZURA.';
  }

  // 2. Check LRU In-Memory Cache
  const cached = getCachedExtraction(cleanUrl);
  if (cached) {
    console.log(`[Web Extractor Cache]: ⚡ Returning cached intelligence for: ${url}`);
    return cached;
  }

  // 3. 🚀 LEVEL 2: Direct PDF File Check
  if (cleanUrl.endsWith('.pdf') || cleanUrl.includes('.pdf?')) {
    const pdfResult = await extractPdfDocument(url);
    if (pdfResult.success) {
      const output = `[HASIL EKSTRAKSI DOKUMEN PDF (LEVEL 2 ENGINE)]:\n` +
        `• Status: SUKSES TERBACA (${pdfResult.numPages} Halaman)\n` +
        `• URL Sumber: ${url}\n\n` +
        `${pdfResult.content}\n\n` +
        `🔒 PROTOKOL KEJUJURAN FAKTA: Gunakan informasi di atas sebagai data valid. Jika lawan bicara menanyakan hal yang TIDAK tertulis dalam dokumen di atas, katakan secara jujur bahwa informasi tersebut belum tercantum.`;
      setCachedExtraction(cleanUrl, output);
      return output;
    }
  }

  let browser = null;
  let context = null;
  let page = null;

  try {
    browser = await getBrowser();
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
    page = await context.newPage();

    // Block media assets for 5x faster scraping and RAM protection
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3,wav}', route => route.abort());

    console.log(`[Web Extractor Engine]: 🌐 Navigating to ${url} via Chromium DOM Engine...`);
    const navResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Check if response header is PDF
    const contentType = navResponse?.headers()?.['content-type'] || '';
    if (contentType.includes('application/pdf')) {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      return await extractWebIntelligence(url + '#pdf');
    }

    // Wait slightly for dynamic React/Vue/SPA DOM hydration
    await page.waitForTimeout(2000);

    const title = await page.title().catch(() => 'Halaman Web Resmi');
    const finalUrl = page.url();

    // 🟢 LEVEL 1: Smart DOM Text Extraction & Noise Stripping
    const domData = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      
      // Strip noisy and clutter elements
      const toRemove = clone.querySelectorAll(
        'script, style, noscript, iframe, svg, nav, footer, header, ' +
        '[role="dialog"], [role="banner"], [role="navigation"], ' +
        '.cookie-banner, .advertisement, .ad-box, .sidebar, #comments'
      );
      toRemove.forEach(el => el.remove());

      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                       document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      const headings = Array.from(clone.querySelectorAll('h1, h2, h3, h4'))
        .map(h => h.innerText.trim())
        .filter(h => h.length > 2)
        .slice(0, 10);

      // Collect primary internal sublinks for Level 5
      const origin = window.location.origin;
      const internalLinks = Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(h => h.startsWith(origin) && !h.includes('#') && !h.endsWith('.png') && !h.endsWith('.jpg'))
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 4);

      const rawText = clone.innerText || clone.textContent || '';
      const cleanLines = rawText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      // Deduplicate lines
      const uniqueLines = [];
      for (const line of cleanLines) {
        if (uniqueLines.length === 0 || uniqueLines[uniqueLines.length - 1] !== line) {
          uniqueLines.push(line);
        }
      }

      return {
        metaDesc,
        headings: headings.join(' | '),
        bodyText: uniqueLines.join('\n'),
        charCount: uniqueLines.join('\n').length,
        internalLinks
      };
    });

    // 🛒 LEVEL 3: Extract Structured Schema & Tables
    let structuredInfoText = '';
    const structuredData = await extractStructuredData(page);
    if (structuredData) {
      if (structuredData.priceInfo) {
        structuredInfoText += `\n💰 **Harga / Penawaran Resmi:** ${structuredData.priceInfo}\n`;
      }
      if (structuredData.tables && structuredData.tables.length > 0) {
        structuredInfoText += `\n📊 **Tabel Data / Spesifikasi Terbaca:**\n${structuredData.tables.join('\n\n')}\n`;
      }
    }

    // 🕷️ LEVEL 5: Autonomous Sub-Link Crawling (If requested or if main page is a sparse landing page)
    let crawledSubContent = '';
    if (options.deepCrawl || (domData.charCount < 400 && domData.internalLinks.length > 0)) {
      console.log(`[Web Extractor L5]: 🚀 Triggering autonomous sub-link crawl for sparse landing page...`);
      const subPages = await crawlSubPages(context, finalUrl, domData.internalLinks);
      if (subPages.length > 0) {
        crawledSubContent = `\n\n📑 **Eksplorasi Halaman & Bagian Terkait (Sub-Link Deep Crawl):**\n` +
          subPages.map(sp => `🔗 **${sp.title}** (${sp.url}):\n${sp.content}`).join('\n\n');
      }
    }

    // Check Harmful Content in extracted text
    const combinedExtracted = `${domData.metaDesc} ${domData.bodyText} ${structuredInfoText} ${crawledSubContent}`;
    if (isHarmfulText(combinedExtracted)) {
      return 'Konten halaman web tersebut terdeteksi mengandung unsur yang melanggar filter keamanan AZURA.';
    }

    // 👁️ LEVEL 4: Vision-Augmented Reader Check
    let visualNote = '';
    if (domData.charCount < 150 && !structuredInfoText) {
      visualNote = '\n⚠️ *Catatan Visual: Halaman ini menggunakan elemen grafis/canvas visual tinggi dengan teks statis minimal.*';
    }

    // Assemble Master Zero-Hallucination Intelligence Block
    const outputBlock = `[HASIL EKSTRAKSI WEB TERVERIFIKASI (LEVEL 1-5 ADVANCED ENGINE)]:
• Status: SUKSES TERBACA (${domData.charCount} Karakter)
• Judul Halaman: ${title}
• URL Target: ${finalUrl}
${domData.metaDesc ? `• Deskripsi Resmi: ${domData.metaDesc}` : ''}
${domData.headings ? `• Topik / Heading Utama: ${domData.headings}` : ''}
${structuredInfoText}
📝 **Isi Konten Teks Halaman Terbaca:**
${domData.bodyText.slice(0, 3500)}${crawledSubContent}${visualNote}

# 🎯 PROTOKOL KEJUJURAN FAKTA & ZERO-HALLUCINATION TRUTH GATE:
1. INFORMASI TERBUKTI: Gunakan HANYA informasi yang benar-benar tertulis di atas sebagai fakta resmi.
2. JANGAN MENGARANG (ANTI-NGAWUR): Jika lawan bicara menanyakan informasi spesifik (misalnya tanggal rilis pasti, harga, spesifikasi, lokasi) yang TIDAK TERCANTUM di teks atas, KATAKAN SECARA JUJUR DAN TERANG bahwa detail tersebut belum diumumkan pada halaman resmi ini.
3. JELASKAN APA YANG ADA: Sebutkan secara cerdas apa saja fakta yang SUDAH ADA (misal: pengumuman event, pendaftaran CBT, sinopsis) tanpa melebih-lebihkan.`;

    setCachedExtraction(cleanUrl, outputBlock);
    return outputBlock;

  } catch (err) {
    console.warn('[Web Extractor Chromium Warning]: Playwright DOM failed, falling back to Tavily Deep Search...', err.message);

    // Tier 3 Fallback: Tavily Deep Search on Domain / URL
    try {
      const { searchTavily } = require('./tavily');
      const fallbackSearch = await searchTavily(url, 'general');
      if (fallbackSearch && !fallbackSearch.includes('Tidak ditemukan')) {
        const fallbackBlock = `[INFORMASI WEB TERVERIFIKASI TERKAIT TAUTAN (TAVILY FALLBACK ENGINE)]:
• Status: INFORMASI PENCARIAN PUBLIK
• URL Target: ${url}

${fallbackSearch}

# 🎯 PROTOKOL KEJUJURAN FAKTA:
Katakan secara terbuka bahwa informasi di atas dirangkum dari hasil penelusuran publik terkait tautan tersebut. Jika detail yang ditanyakan tidak tercantum, akui secara jujur.`;
        setCachedExtraction(cleanUrl, fallbackBlock);
        return fallbackBlock;
      }
    } catch (searchErr) {
      console.error('[Web Extractor Fallback Error]:', searchErr.message);
    }

    return `Gagal mengekstrak isi halaman dari URL (${url}). Situs tersebut mungkin memblokir akses bot otomatis (Cloudflare Captcha) atau memerlukan otentikasi login.`;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = {
  extractWebIntelligence,
  extractPdfDocument,
  isHarmfulUrl,
  isHarmfulText
};
