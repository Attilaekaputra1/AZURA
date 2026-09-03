/**
 * AZURA Headless Browser & Live Visual Companion Engine
 * Powered by Playwright Chromium with ultra-lightweight memory management,
 * Chrome DevTools Protocol (CDP) 60fps Real-Time Screencast,
 * safety guardrails (Anti-Judol/NSFW), and direct VC / Text companion sync.
 */

const { chromium } = require('playwright-chromium');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { broadcastFrame, updateStreamMeta, STREAM_URL } = require('./livePortal');
const config = require('./config');

// Anti-Judol & Unsafe Domain Blacklist
const BLOCKED_DOMAINS = [
  'slot', 'judol', 'judi', 'togel', 'toto', 'casino', 'poker', 'domino', 'bet365',
  'sbobet', 'pragmatic', 'joker123', 'pgsoft', 'habanero', 'microgaming',
  'maxwin', 'gacor', 'rtp', 'scatter', 'jackpot', 'zeus', 'olympus', 'mahjong-ways',
  'porn', 'xnxx', 'xvideos', 'pornhub', 'redtube', 'onlyfans'
];

let globalBrowser = null;
const activeBrowserSessions = new Map(); // guildId -> { context, page, cdp, lastActive, timer, currentUrl, currentTitle }
const IDLE_BROWSER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes auto close

// Documentation Mode:
// false = Background Mode (Silent in Discord chat, live streaming 60fps only on http://203.175.10.163:7860/live)
// true = Active Documentation Mode (Posts visual cards with screenshot to Discord chat on every action)
let visualDocumentationEnabled = false;

function setVisualDocumentationMode(enabled) {
  visualDocumentationEnabled = !!enabled;
  console.log(`[Headless Browser]: 📸 Visual documentation in Discord channel set to: ${visualDocumentationEnabled ? 'ENABLED' : 'DISABLED (Background Mode)'}`);
  return visualDocumentationEnabled;
}

function isVisualDocumentationEnabled() {
  return visualDocumentationEnabled;
}

/**
 * Get or launch shared Chromium instance with low-resource flags
 */
async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }

  console.log('[Headless Browser]: 🚀 Launching lightweight Stealth Chromium engine...');
  globalBrowser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-zygote',
      '--mute-audio'
    ]
  });

  return globalBrowser;
}

/**
 * Reset or set idle session timer
 * @param {string} guildId 
 */
function resetSessionTimer(guildId) {
  const session = activeBrowserSessions.get(guildId);
  if (!session) return;

  if (session.timer) {
    clearTimeout(session.timer);
  }

  session.timer = setTimeout(async () => {
    console.log(`[Headless Browser]: ⏳ Inactivity timeout (5 mins) for guild ${guildId}. Closing browser tab...`);
    await closeBrowserSession(guildId);
  }, IDLE_BROWSER_TIMEOUT_MS);
}

/**
 * Get or create an active browser page session for a guild with live CDP Screencasting
 * @param {string} guildId 
 */
async function getOrCreateSession(guildId) {
  let session = activeBrowserSessions.get(guildId);
  if (session && !session.page.isClosed()) {
    resetSessionTimer(guildId);
    return session;
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    deviceScaleFactor: 1,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta'
  });

  const page = await context.newPage();

  // Stealth script: mask automation fingerprints & bypass bot checks
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
  });

  // Attach Chrome DevTools Protocol (CDP) for high-speed 60fps screencasting
  let cdp = null;
  try {
    cdp = await context.newCDPSession(page);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 1
    });

    cdp.on('Page.screencastFrame', async ({ data, sessionId: sid }) => {
      try {
        broadcastFrame(data);
        await cdp.send('Page.screencastFrameAck', { sessionId: sid });
      } catch (_) {}
    });
    console.log(`[Headless Browser]: 🎥 Real-time 60fps Screencast connected for guild ${guildId}`);
  } catch (err) {
    console.error('[Headless Browser CDP Error]:', err.message);
  }

  session = {
    context,
    page,
    cdp,
    lastActive: Date.now(),
    currentUrl: 'about:blank',
    currentTitle: 'Browser Standby'
  };

  activeBrowserSessions.set(guildId, session);
  resetSessionTimer(guildId);
  return session;
}

/**
 * Safely close browser session for a guild
 * @param {string} guildId 
 */
async function closeBrowserSession(guildId) {
  const session = activeBrowserSessions.get(guildId);
  if (!session) return { success: true, message: 'Tidak ada sesi browser yang aktif.' };

  try {
    if (session.timer) clearTimeout(session.timer);
    if (session.cdp) {
      await session.cdp.send('Page.stopScreencast').catch(() => {});
      await session.cdp.detach().catch(() => {});
    }
    await session.page.close().catch(() => {});
    await session.context.close().catch(() => {});
  } catch (err) {
    console.error('[Headless Browser Close Error]:', err.message);
  } finally {
    activeBrowserSessions.delete(guildId);
    updateStreamMeta({ title: 'AZURA Companion Standby', url: 'about:blank', activeGuild: null });
    console.log(`[Headless Browser]: 🔒 Closed browser session for guild ${guildId}`);
  }

  return { success: true, message: 'Sesi browser berhasil ditutup dan memori dibebaskan.' };
}

/**
 * Check if URL is safe
 * @param {string} url 
 * @returns {boolean}
 */
function isSafeUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return !BLOCKED_DOMAINS.some(bad => lower.includes(bad));
}

/**
 * Format string query into a valid URL
 * @param {string} input 
 * @returns {string}
 */
function formatToUrl(input) {
  let clean = input.trim();
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/.*)?$/i.test(clean)) return `https://${clean}`;
  return `https://www.google.com/search?q=${encodeURIComponent(clean)}`;
}

/**
 * Navigate to a URL and take a real-time visual snapshot
 * @param {string} guildId 
 * @param {string} targetInput 
 * @returns {Promise<{ success: boolean, title: string, url: string, screenshot: Buffer, error?: string }>}
 */
async function openWebpage(guildId, targetInput) {
  try {
    const isDirect = /^https?:\/\//i.test(targetInput.trim()) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/.*)?$/i.test(targetInput.trim());
    const session = await getOrCreateSession(guildId);
    const { page } = session;

    let targetUrl = '';
    let pageTitle = 'Halaman Web';

    if (isDirect) {
      targetUrl = targetInput.trim().startsWith('http') ? targetInput.trim() : `https://${targetInput.trim()}`;
      if (!isSafeUrl(targetUrl)) {
        return { success: false, error: 'Situs web tersebut diblokir oleh protokol keamanan AZURA.' };
      }
      console.log(`[Headless Browser]: 🌐 Direct navigate guild ${guildId} to: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1200);
    } else {
      // Human-like search with real-time on-screen typing (bypasses bot detection)
      // Human-like search with real-time on-screen typing (Yahoo: 100% captcha-free on VPS)
      console.log(`[Headless Browser]: 🔍 Performing human-like search on Yahoo for: "${targetInput}"`);
      await page.goto('https://search.yahoo.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(700);

      // Focus search input
      const searchInput = await page.waitForSelector('input[name="p"], #yschsp, input[type="text"]', { timeout: 8000 }).catch(() => null);
      if (searchInput) {
        await searchInput.click();
        await page.waitForTimeout(200);
        // Type visibly on stream key-by-key
        await page.keyboard.type(targetInput.trim(), { delay: 45 });
        await page.waitForTimeout(300);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        // Smooth scroll to show results
        await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' })).catch(() => {});
        await page.waitForTimeout(1000);
      } else {
        await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(targetInput.trim())}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2500);
      }
      targetUrl = page.url();
    }

    // Auto-detect and attempt click on captcha / Cloudflare checkbox
    try {
      const captchaEl = await page.$('iframe[src*="recaptcha"], iframe[src*="turnstile"], #turnstile-wrapper, .cf-turnstile, input[type="checkbox"][name*="robot"]');
      if (captchaEl) {
        const box = await captchaEl.boundingBox();
        if (box) {
          console.log('[Headless Browser]: 🛡️ Attempting auto-click on verification checkbox...');
          await page.mouse.click(box.x + 25, box.y + box.height / 2);
          await page.waitForTimeout(2000);
        }
      }
    } catch (_) {}

    pageTitle = await page.title().catch(() => 'Halaman Web');
    session.currentUrl = targetUrl;
    session.currentTitle = pageTitle;

    updateStreamMeta({ title: pageTitle, url: targetUrl, activeGuild: guildId, mode: 'browse' });

    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    return {
      success: true,
      title: pageTitle,
      url: targetUrl,
      screenshot
    };
  } catch (err) {
    console.error('[Headless Browser Error]:', err.message);
    return {
      success: false,
      error: `Gagal membuka halaman web: ${err.message}`
    };
  }
}

/**
 * Search YouTube or play YouTube video with visual preview + direct VC audio streaming
 * @param {string} guildId 
 * @param {string} query 
 * @param {import('discord.js').Client} client 
 * @param {import('discord.js').VoiceChannel} voiceChannel 
 * @param {import('discord.js').TextChannel} textChannel 
 */
async function browseYouTube(guildId, query, client, voiceChannel, textChannel) {
  try {
    const isDirectUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(query);
    const searchUrl = isDirectUrl ? query : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    console.log(`[Headless Browser]: 🎥 Browsing YouTube: "${query}"...`);
    const session = await getOrCreateSession(guildId);
    const { page } = session;

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);

    const title = await page.title().catch(() => `YouTube - ${query}`);
    session.currentUrl = searchUrl;
    session.currentTitle = title;

    updateStreamMeta({ title, url: searchUrl });

    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    // Also trigger direct music audio streamer in VC if audio players exist
    let audioStreaming = false;
    try {
      const { audioPlayers } = require('./voiceCompanion');
      const player = audioPlayers.get(guildId);
      if (player && textChannel) {
        const { streamMusicDirect } = require('./musicStreamer');
        streamMusicDirect(guildId, query, player, textChannel, 'Attila').catch(() => {});
        audioStreaming = true;
      }
    } catch (_) {}

    return {
      success: true,
      title,
      url: searchUrl,
      screenshot,
      audioStreaming
    };
  } catch (err) {
    console.error('[Headless Browser YouTube Error]:', err.message);
    return {
      success: false,
      error: `Gagal memuat YouTube: ${err.message}`
    };
  }
}

/**
 * Scroll webpage in active session
 * @param {string} guildId 
 * @param {'down'|'up'} direction 
 */
async function scrollWebpage(guildId, direction = 'down') {
  const session = activeBrowserSessions.get(guildId);
  if (!session || session.page.isClosed()) {
    return { success: false, error: 'Tidak ada browser yang aktif.' };
  }

  try {
    const { page } = session;
    const scrollAmount = direction === 'down' ? 500 : -500;
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), scrollAmount);
    await page.waitForTimeout(800);

    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    return {
      success: true,
      title: session.currentTitle,
      url: session.currentUrl,
      screenshot
    };
  } catch (err) {
    console.error('[Headless Browser Scroll Error]:', err.message);
    return { success: false, error: `Gagal scroll halaman: ${err.message}` };
  }
}

/**
 * Type text into the first active text input / search box
 * @param {string} guildId 
 * @param {string} textToType 
 */
async function typeIntoWebpage(guildId, textToType) {
  const session = activeBrowserSessions.get(guildId);
  if (!session || session.page.isClosed()) {
    return { success: false, error: 'Tidak ada browser yang aktif. Buka halaman dulu yaa!' };
  }

  try {
    const { page } = session;
    const focused = await page.evaluate((val) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        activeEl.value = val;
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      const firstInput = document.querySelector('input[type="text"], input[type="search"], input:not([type]), textarea');
      if (firstInput) {
        firstInput.focus();
        firstInput.value = val;
        firstInput.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    }, textToType);

    if (focused) {
      await page.keyboard.press('Enter').catch(() => {});
    } else {
      await page.keyboard.type(textToType, { delay: 50 });
      await page.keyboard.press('Enter').catch(() => {});
    }

    await page.waitForTimeout(1500);
    const title = await page.title().catch(() => session.currentTitle);
    const url = page.url();
    session.currentUrl = url;
    session.currentTitle = title;
    updateStreamMeta({ title, url });

    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    return {
      success: true,
      title,
      url,
      screenshot,
      typedText: textToType
    };
  } catch (err) {
    console.error('[Headless Browser Type Error]:', err.message);
    return { success: false, error: `Gagal mengetik: ${err.message}` };
  }
}

/**
 * Click on an element by text or selector (buttons, links, options, simple captcha buttons)
 * @param {string} guildId 
 * @param {string} targetTextOrSelector 
 */
async function clickOnWebpage(guildId, targetTextOrSelector) {
  const session = activeBrowserSessions.get(guildId);
  if (!session || session.page.isClosed()) {
    return { success: false, error: 'Tidak ada browser yang aktif. Buka halaman dulu yaa!' };
  }

  try {
    const { page } = session;
    const target = targetTextOrSelector.trim();

    const clicked = await page.evaluate((text) => {
      const lower = text.toLowerCase();
      const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], span, div, li, select, option'));
      for (const el of elements) {
        const content = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
        if (content && (content === lower || content.includes(lower))) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
          return true;
        }
      }
      return false;
    }, target);

    if (!clicked) {
      await page.click(target, { timeout: 3000 }).catch(() => {});
    }

    await page.waitForTimeout(1200);
    const title = await page.title().catch(() => session.currentTitle);
    const url = page.url();
    session.currentUrl = url;
    session.currentTitle = title;
    updateStreamMeta({ title, url });

    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    return {
      success: true,
      title,
      url,
      screenshot,
      target
    };
  } catch (err) {
    console.error('[Headless Browser Click Error]:', err.message);
    return { success: false, error: `Gagal mengklik/memilih "${targetTextOrSelector}": ${err.message}` };
  }
}

/**
 * Get readable textual content and visual description of current active webpage
 * @param {string} guildId 
 */
async function getWebpageSummary(guildId) {
  const session = activeBrowserSessions.get(guildId);
  if (!session || session.page.isClosed()) {
    return { success: false, error: 'Tidak ada browser yang aktif.' };
  }

  try {
    const { page } = session;
    const pageData = await page.evaluate(() => {
      const title = document.title;
      const h1s = Array.from(document.querySelectorAll('h1, h2')).map(h => h.innerText.trim()).filter(Boolean).slice(0, 5);
      const paragraphs = Array.from(document.querySelectorAll('p, article, [role="main"]')).map(p => p.innerText.trim()).filter(p => p.length > 20).slice(0, 5);
      return {
        title,
        headings: h1s.join('; '),
        bodySummary: paragraphs.join('\n')
      };
    });

    return {
      success: true,
      title: session.currentTitle || pageData.title,
      url: session.currentUrl,
      headings: pageData.headings,
      bodyText: pageData.bodySummary.slice(0, 1500)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Take live screenshot on demand
 * @param {string} guildId 
 */
async function takeScreenshotOnDemand(guildId) {
  const session = activeBrowserSessions.get(guildId);
  if (!session || session.page.isClosed()) {
    return { success: false, error: 'Tidak ada browser yang sedang aktif di guild ini.' };
  }
  try {
    const screenshot = await session.page.screenshot({ type: 'png' });
    return {
      success: true,
      title: session.currentTitle || 'Layar Browser',
      url: session.currentUrl || 'about:blank',
      screenshot
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Send interactive Visual Snapshot card with 60fps Live Stream Button to Discord channel
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {string} title 
 * @param {string} url 
 * @param {Buffer} screenshotBuffer 
 * @param {string} [extraNotes] 
 * @param {boolean} [forceSend=false] 
 */
async function sendVisualSnapshotCard(textChannel, title, url, screenshotBuffer, extraNotes = '', forceSend = false) {
  // If documentation mode is disabled and not explicitly requested, run silently in background
  if (!visualDocumentationEnabled && !forceSend) {
    return null;
  }
  if (!textChannel || !textChannel.send) return null;

  const fileName = `azura_snapshot_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(screenshotBuffer, { name: fileName });

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`🌐 [AZURA Screen Companion] ${title.slice(0, 80)}`)
    .setURL(url && url.startsWith('http') ? url : 'https://www.google.com')
    .setDescription(
      `📺 **Layar Headless Browser Aktif**\n` +
      `🔗 **URL:** \`${url ? url.slice(0, 100) : '-'}\`\n` +
      `${extraNotes ? `✨ ${extraNotes}\n` : ''}\n` +
      `*💡 Tonton live stream 60fps di portal web tanpa lagging!*`
    )
    .setImage(`attachment://${fileName}`)
    .setFooter({ text: 'Playwright Chromium • Ultra Low Latency Live Stream' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('📺 Tonton Layar AZURA (Live 60fps)')
      .setStyle(ButtonStyle.Link)
      .setURL(STREAM_URL)
  );

  return await textChannel.send({ embeds: [embed], files: [attachment], components: [row] }).catch((err) => {
    console.error('[Send Visual Snapshot Error]:', err.message);
  });
}

/**
 * Process text-based browser command triggers from chat messages
 * @param {import('discord.js').Message} message 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<boolean>} Whether message was handled as browser command
 */
async function handleTextBrowserCommands(message, client) {
  if (!message.content) return false;
  const isOwner = message.author.id === config.OWNER_DISCORD_ID;
  if (!isOwner) return false;

  // Headless browsing commands only work when Azura is in a Voice Channel
  const botMember = message.guild?.members?.me;
  const isInVC = botMember?.voice?.channel != null;
  if (!isInVC) return false;

  const content = message.content.trim();
  const lower = content.toLowerCase();
  const guildId = message.guild?.id || 'default_guild';
  const textChannel = message.channel;

  // 1. Toggle Documentation Mode (Aktifkan / Matikan dokumentasi ke Discord chat)
  const docToggleMatch = lower.match(/\b(?:atur|set|ubah)?\s*(?:mode\s+)?dokumentasi\s+browser\s*(?:ke\s+)?(aktif|nyala|on|mati|off|background|latar\s+belakang)\b/i);
  if (docToggleMatch) {
    const state = docToggleMatch[1].toLowerCase();
    const isEnable = /aktif|nyala|on/.test(state);
    setVisualDocumentationMode(isEnable);
    if (isEnable) {
      await message.reply('📸 **[Dokumentasi Visual Chat: AKTIF]**\nSetiap navigasi browser kini akan mengirimkan kartu screenshot ke channel chat Discord.');
    } else {
      await message.reply('🔇 **[Dokumentasi Visual Chat: NONAKTIF (Mode Latar Belakang)]**\nBrowser kini berjalan senyap di background tanpa spam screenshot di chat. Layar tetap disiarkan live 60fps di: 👉 ' + STREAM_URL);
    }
    return true;
  }

  // 2. Explicit Screenshot On-Demand
  if (/\b(?:screenshot|ss|tangkapan\s+layar|foto\s+layar|kirim\s+layar|tampilkan\s+layar)\s*(?:browser|web|halaman|layarnya)?\b/i.test(lower)) {
    const snap = await takeScreenshotOnDemand(guildId);
    if (snap.success) {
      await sendVisualSnapshotCard(textChannel, snap.title, snap.url, snap.screenshot, 'Tangkapan layar browser terbaru atas permintaanmu.', true);
    } else {
      await message.reply(`⚠️ ${snap.error}`);
    }
    return true;
  }

  // 3. Open Chrome / Standby
  if (/\b(?:buka|bukain|jalankan)\s+(?:chrome|browser|google\s+chrome)\b/i.test(lower) && !/situs|web|link|url|youtube/i.test(lower)) {
    const res = await openWebpage(guildId, 'https://www.google.com');
    if (res.success) {
      await message.reply('🌐 **[AZURA Browser]** Google Chrome sudah dibuka di latar belakang. Live stream aktif di: 👉 ' + STREAM_URL);
      await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, 'Browser siap menerima perintah navigasi.');
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 4. Open Website / URL
  const openUrlMatch = content.match(/\b(?:buka|kunjungi|browsing|buka\s+situs|buka\s+web)\s+(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/i);
  if (openUrlMatch && openUrlMatch[1]) {
    const targetUrl = openUrlMatch[1];
    const res = await openWebpage(guildId, targetUrl);
    if (res.success) {
      await message.reply(`🌐 **[AZURA Browser]** Membuka halaman: **${res.title}** (\`${res.url}\`)\nLive stream: 👉 ${STREAM_URL}`);
      await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, `Halaman ${targetUrl} berhasil dimuat.`);
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 5. YouTube Browse
  const ytMatch = content.match(/\b(?:buka|putar|tonton)\s+youtube\s*(?:cari|video)?\s*(.+)/i);
  if (ytMatch && ytMatch[1]) {
    const query = ytMatch[1].trim();
    const voiceChannel = message.member?.voice?.channel;
    const res = await browseYouTube(guildId, query, client, voiceChannel, textChannel);
    if (res.success) {
      await message.reply(`🎥 **[AZURA Browser]** YouTube: **${res.title}** dimuat.\nLive stream: 👉 ${STREAM_URL}`);
      await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, 'Video YouTube dimuat.');
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 6. Type into Webpage
  const typeMatch = content.match(/\b(?:ketik|isi\s+form|masukkan\s+teks)\s+(.+)/i);
  if (typeMatch && typeMatch[1] && /\b(?:di\s+browser|di\s+web|di\s+layar)\b/i.test(lower)) {
    const cleanText = typeMatch[1].replace(/\b(?:di\s+browser|di\s+web|di\s+layar)\b/gi, '').trim();
    const res = await typeIntoWebpage(guildId, cleanText);
    if (res.success) {
      await message.reply(`⌨️ **[AZURA Browser]** Berhasil mengetik: \`${cleanText}\``);
      await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, `Berhasil mengetik: ${cleanText}`);
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 7. Click on Webpage
  const clickMatch = content.match(/\b(?:klik|tekan|pilih)\s+(?:tombol\s+|link\s+)?(.+)/i);
  if (clickMatch && clickMatch[1] && /\b(?:di\s+browser|di\s+web|di\s+layar)\b/i.test(lower)) {
    const cleanTarget = clickMatch[1].replace(/\b(?:di\s+browser|di\s+web|di\s+layar)\b/gi, '').trim();
    const res = await clickOnWebpage(guildId, cleanTarget);
    if (res.success) {
      await message.reply(`🖱️ **[AZURA Browser]** Berhasil mengklik: \`${cleanTarget}\``);
      await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, `Berhasil mengklik: ${cleanTarget}`);
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 8. Scroll Webpage
  if (/\b(?:scroll|gulir)\s*(?:ke\s+)?(?:bawah|atas|down|up)\b/i.test(lower)) {
    const isUp = /\b(?:atas|up)\b/i.test(lower);
    const dir = isUp ? 'up' : 'down';
    const res = await scrollWebpage(guildId, dir);
    if (res.success) {
      await message.reply(`📜 **[AZURA Browser]** Halaman digulir ke ${dir === 'down' ? 'bawah ⬇️' : 'atas ⬆️'}.`);
      await sendVisualSnapshotCard(textChannel, res.title, res.url, res.screenshot, `Halaman digulir ke ${dir}.`);
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 9. Read / Summarize Webpage
  if (/\b(?:jelaskan|baca|bacakan|ringkas)\s+(?:tampilan|isi|halaman|layar)\s*(?:web|browser|ini)?\b/i.test(lower)) {
    const res = await getWebpageSummary(guildId);
    if (res.success) {
      await message.reply(`👁️ **[Ringkasan Halaman Web: ${res.title}]**\n\n${res.bodyText || res.headings || 'Tidak ada teks artikel yang terdeteksi.'}`);
    } else {
      await message.reply(`❌ ${res.error}`);
    }
    return true;
  }

  // 10. Close Browser
  if (/\b(?:tutup|close|stop|matikan)\s+(?:chrome|browser|web|tab)\b/i.test(lower)) {
    const res = await closeBrowserSession(guildId);
    await message.reply(`🔒 **[AZURA Browser]** ${res.message}`);
    return true;
  }

  return false;
}

/**
 * Autonomous Headless Web Scraper (Playwright Chromium)
 * Capable of rendering full client-side JavaScript, Single Page Apps (SPA/React/Next/PlayNC),
 * extracting clean markdown text, headings, meta descriptions, and structured DOM data.
 * @param {string} targetUrl 
 * @param {number} [timeoutMs=20000] 
 * @returns {Promise<{ success: boolean, title: string, url: string, content: string, error?: string }>}
 */
async function scrapeWebWithBrowser(targetUrl, timeoutMs = 20000) {
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

    // Abort heavy media assets for 5x faster scraping
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3,wav}', route => route.abort());

    console.log(`[Headless Scraper]: 🌐 Navigating to ${targetUrl} via Playwright Chromium...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Wait slightly for dynamic React / SPA / Next.js hydration
    await page.waitForTimeout(2200);

    const title = await page.title().catch(() => 'Halaman Web');
    const finalUrl = page.url();

    const extracted = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      const toRemove = clone.querySelectorAll('script, style, noscript, iframe, svg, [role="dialog"], [aria-hidden="true"]');
      toRemove.forEach(el => el.remove());

      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                       document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      const headings = Array.from(clone.querySelectorAll('h1, h2, h3, h4'))
        .map(h => h.innerText.trim())
        .filter(Boolean)
        .slice(0, 10);

      const rawText = clone.innerText || clone.textContent || '';
      const cleanLines = rawText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      const uniqueLines = [];
      for (const line of cleanLines) {
        if (uniqueLines.length === 0 || uniqueLines[uniqueLines.length - 1] !== line) {
          uniqueLines.push(line);
        }
      }

      return {
        metaDesc,
        headings: headings.join(' | '),
        bodyText: uniqueLines.join('\n')
      };
    });

    const fullContent = [
      extracted.metaDesc ? `📌 **Deskripsi Situs:** ${extracted.metaDesc}` : '',
      extracted.headings ? `🏷️ **Topik & Navigasi Utama:** ${extracted.headings}` : '',
      `📝 **Isi Konten Halaman Terbaca:**\n${extracted.bodyText}`
    ].filter(Boolean).join('\n\n');

    return {
      success: true,
      title,
      url: finalUrl,
      content: fullContent.slice(0, 4500)
    };
  } catch (err) {
    console.error('[Headless Scraper Error]:', err.message);
    return {
      success: false,
      title: 'Gagal Ekstrak',
      url: targetUrl,
      error: err.message
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = {
  getBrowser,
  getOrCreateSession,
  activeBrowserSessions,
  openWebpage,
  browseYouTube,
  scrollWebpage,
  typeIntoWebpage,
  clickOnWebpage,
  getWebpageSummary,
  takeScreenshotOnDemand,
  closeBrowserSession,
  sendVisualSnapshotCard,
  setVisualDocumentationMode,
  isVisualDocumentationEnabled,
  handleTextBrowserCommands,
  scrapeWebWithBrowser
};
