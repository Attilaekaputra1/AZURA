/**
 * AZURA Headless Browser & Live Visual Companion Engine
 * Powered by Playwright Chromium with ultra-lightweight memory management,
 * Chrome DevTools Protocol (CDP) 60fps Real-Time Screencast,
 * safety guardrails (Anti-Judol/NSFW), and direct VC companion sync.
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

/**
 * Get or launch shared Chromium instance with low-resource flags
 */
async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }

  console.log('[Headless Browser]: 🚀 Launching lightweight Chromium engine...');
  globalBrowser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AZURA-Assistant/3.0',
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

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

    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId });
        broadcastFrame(data, {
          title: session?.currentTitle || 'AZURA Screen Companion',
          url: session?.currentUrl || 'about:blank',
          activeGuild: guildId
        });
      } catch (_) {}
    });
    console.log('[Headless Browser]: 📺 CDP Screencast 60fps stream initialized!');
  } catch (cdpErr) {
    console.warn('[Headless Browser Warning]: CDP Screencast setup error:', cdpErr.message);
  }

  session = {
    context,
    page,
    cdp,
    lastActive: Date.now(),
    currentUrl: 'about:blank',
    currentTitle: 'Browser Standby',
    timer: null
  };

  activeBrowserSessions.set(guildId, session);
  resetSessionTimer(guildId);
  return session;
}

/**
 * Check if URL is safe to open
 * @param {string} url 
 * @returns {boolean}
 */
function isSafeUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return !BLOCKED_DOMAINS.some(bad => lower.includes(bad));
}

/**
 * Format query or string into a valid web URL
 * @param {string} input 
 * @returns {string}
 */
function formatToUrl(input) {
  const clean = input.trim();
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
    const url = formatToUrl(targetInput);

    if (!isSafeUrl(url)) {
      return {
        success: false,
        error: 'Situs web tersebut diblokir oleh protokol keamanan AZURA (terdeteksi domain tidak aman/perjudian).'
      };
    }

    console.log(`[Headless Browser]: 🌐 Navigating guild ${guildId} to: ${url}`);
    const session = await getOrCreateSession(guildId);
    const { page } = session;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000); // Allow brief rendering

    const title = await page.title().catch(() => 'Halaman Web');
    session.currentUrl = url;
    session.currentTitle = title;

    updateStreamMeta({ title, url });

    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    return {
      success: true,
      title,
      url,
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
 * Scroll the current active webpage (smooth scrolling) and take updated visual screenshot
 * @param {string} guildId 
 * @param {'down'|'up'} direction 
 * @param {number} amount 
 */
async function scrollWebpage(guildId, direction = 'down', amount = 600) {
  const session = activeBrowserSessions.get(guildId);
  if (!session || session.page.isClosed()) {
    return { success: false, error: 'Tidak ada sesi browser yang sedang aktif. Buka halaman dulu yaa!' };
  }

  try {
    const { page } = session;
    const scrollOffset = direction === 'down' ? amount : -amount;
    await page.evaluate((offset) => {
      window.scrollBy({ top: offset, behavior: 'smooth' });
    }, scrollOffset);

    await page.waitForTimeout(600);
    const screenshot = await page.screenshot({ type: 'png' });
    resetSessionTimer(guildId);

    return {
      success: true,
      title: session.currentTitle,
      url: session.currentUrl,
      screenshot,
      direction
    };
  } catch (err) {
    console.error('[Headless Browser Scroll Error]:', err.message);
    return { success: false, error: `Gagal scroll halaman: ${err.message}` };
  }
}

/**
 * Close browser session for a specific guild
 * @param {string} guildId 
 */
async function closeBrowserSession(guildId) {
  const session = activeBrowserSessions.get(guildId);
  if (!session) return { success: false, message: 'Tidak ada browser yang aktif.' };

  try {
    if (session.timer) clearTimeout(session.timer);
    if (session.cdp) {
      await session.cdp.send('Page.stopScreencast').catch(() => {});
    }
    await session.context.close().catch(() => {});
    activeBrowserSessions.delete(guildId);
    console.log(`[Headless Browser]: 🔒 Closed browser session for guild ${guildId}. RAM released.`);
    return { success: true, message: 'Sesi browser berhasil ditutup & RAM dibebaskan.' };
  } catch (err) {
    console.error('[Headless Browser Close Error]:', err.message);
    activeBrowserSessions.delete(guildId);
    return { success: true, message: 'Sesi browser ditutup.' };
  }
}

/**
 * Send interactive Visual Snapshot card with 60fps Live Stream Button to Discord channel
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {string} title 
 * @param {string} url 
 * @param {Buffer} screenshotBuffer 
 * @param {string} [extraNotes] 
 */
async function sendVisualSnapshotCard(textChannel, title, url, screenshotBuffer, extraNotes = '') {
  if (!textChannel || !textChannel.send) return;

  const fileName = `azura_snapshot_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(screenshotBuffer, { name: fileName });

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`🌐 [AZURA Screen Companion] ${title.slice(0, 80)}`)
    .setURL(url && url.startsWith('http') ? url : 'https://www.google.com')
    .setDescription(
      `📺 **Layar Headless Browser Aktif di VC**\n` +
      `🔗 **URL:** \`${url ? url.slice(0, 100) : '-'}\`\n` +
      `${extraNotes ? `✨ ${extraNotes}\n` : ''}\n` +
      `*💡 Klik tombol di bawah untuk menonton live stream layar browser secara realtime (60fps)!*`
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

module.exports = {
  getBrowser,
  openWebpage,
  browseYouTube,
  scrollWebpage,
  closeBrowserSession,
  sendVisualSnapshotCard
};
