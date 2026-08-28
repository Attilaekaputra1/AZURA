const https = require('https');
const http = require('http');
const config = require('./config');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Generic HTTP GET helper returning JSON or Text
 * @param {string} url 
 * @param {object} headers 
 * @returns {Promise<any>}
 */
function fetchHttp(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const reqHeaders = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      ...headers
    };

    const req = client.get(url, { headers: reqHeaders }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const origin = new URL(url).origin;
          redirectUrl = origin + redirectUrl;
        }
        return fetchHttp(redirectUrl, headers).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (_) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Social Media HTTP Request Timeout (12s)'));
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ── 1. TIKTOK METADATA & VIDEO SCRAPER ────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Scrape TikTok Video or Profile information via TikWM Public API
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
async function scrapeTikTok(url) {
  try {
    console.log(`[Social Media Engine]: 🎵 Fetching TikTok data for: ${url}`);
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const res = await fetchHttp(apiUrl);

    if (res && res.code === 0 && res.data) {
      const d = res.data;
      const author = d.author || {};
      const stats = {
        views: (d.play_count || 0).toLocaleString('id-ID'),
        likes: (d.digg_count || 0).toLocaleString('id-ID'),
        comments: (d.comment_count || 0).toLocaleString('id-ID'),
        shares: (d.share_count || 0).toLocaleString('id-ID')
      };

      const dateStr = d.create_time ? new Date(d.create_time * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';

      return `🎵 **Data Video TikTok (TikWM Engine):**\n` +
        `👤 **Kreator:** ${author.nickname || 'Unknown'} (@${author.unique_id || 'unknown'})\n` +
        `📝 **Caption:** "${d.title || '(Tanpa caption)'}"\n` +
        `📊 **Statistik:** 👁️ \`${stats.views} Views\` | ❤️ \`${stats.likes} Likes\` | 💬 \`${stats.comments} Komentar\` | 🔁 \`${stats.shares} Share\`\n` +
        `🎶 **Audio/Musik:** ${d.music_info?.title || 'Original Sound'} (${d.music_info?.author || author.nickname})\n` +
        `📅 **Tanggal Upload:** ${dateStr}\n` +
        `🔗 **Link Video:** ${url}`;
    }

    // Fallback via oEmbed
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const oembed = await fetchHttp(oembedUrl);
    if (oembed && oembed.title) {
      return `🎵 **Data TikTok (Official oEmbed):**\n` +
        `👤 **Kreator:** ${oembed.author_name} (@${oembed.author_unique_id})\n` +
        `📝 **Judul/Caption:** "${oembed.title}"\n` +
        `🔗 **Link:** ${url}`;
    }
  } catch (err) {
    console.warn('[Social Media Engine]: TikTok scrape warning:', err.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// ── 2. YOUTUBE METADATA & CHANNEL SCRAPER ─────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Scrape YouTube Video or Shorts metadata via oEmbed & Web metadata
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
async function scrapeYouTube(url) {
  try {
    console.log(`[Social Media Engine]: 🎥 Fetching YouTube data for: ${url}`);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const oembed = await fetchHttp(oembedUrl);

    if (oembed && oembed.title) {
      return `🎥 **Data YouTube (Google oEmbed):**\n` +
        `📌 **Judul Video:** ${oembed.title}\n` +
        `👤 **Channel:** [${oembed.author_name}](${oembed.author_url})\n` +
        `📺 **Tipe Konten:** ${oembed.type || 'video'}\n` +
        `🔗 **URL:** ${url}`;
    }
  } catch (err) {
    console.warn('[Social Media Engine]: YouTube scrape warning:', err.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// ── 3. TWITTER / X SYNDICATION API SCRAPER ────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Scrape Twitter/X Tweet via Official Syndication API
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
async function scrapeTwitter(url) {
  try {
    console.log(`[Social Media Engine]: 🐦 Fetching Twitter/X data for: ${url}`);
    const tweetIdMatch = url.match(/status\/([0-9]+)/i);
    if (!tweetIdMatch) {
      // Profile link
      return null;
    }

    const tweetId = tweetIdMatch[1];
    const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=id`;
    const tweetData = await fetchHttp(syndicationUrl);

    if (tweetData && tweetData.text) {
      const user = tweetData.user || {};
      const likes = (tweetData.favorite_count || 0).toLocaleString('id-ID');
      const retweets = (tweetData.retweet_count || 0).toLocaleString('id-ID');
      const replies = (tweetData.reply_count || 0).toLocaleString('id-ID');
      const dateStr = tweetData.created_at ? new Date(tweetData.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

      const verifiedBadge = user.verified ? ' ☑️ (Verified)' : '';

      return `🐦 **Data Postingan Twitter / X (Syndication Engine):**\n` +
        `👤 **Akun:** **${user.name}** (@${user.screen_name})${verifiedBadge}\n` +
        `📝 **Isi Tweet:**\n"${tweetData.text}"\n\n` +
        `📊 **Statistik:** ❤️ \`${likes} Likes\` | 🔁 \`${retweets} Retweets\` | 💬 \`${replies} Replies\`\n` +
        `📅 **Waktu Posting:** ${dateStr} WIB\n` +
        `🔗 **Link Tweet:** ${url}`;
    }
    // Fallback: Official Twitter / X oEmbed
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&lang=id`;
    const oembed = await fetchHttp(oembedUrl);
    if (oembed && (oembed.html || oembed.author_name)) {
      const cleanHtml = (oembed.html || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
      return `🐦 **Data Postingan Twitter / X (Official oEmbed):**\n` +
        `👤 **Author:** [${oembed.author_name}](${oembed.author_url})\n` +
        `📝 **Isi Tweet:**\n"${cleanHtml.slice(0, 500)}"\n\n` +
        `🔗 **Link:** ${url}`;
    }
  } catch (err) {
    console.warn('[Social Media Engine]: Twitter scrape warning:', err.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// ── 4. REDDIT OFFICIAL PUBLIC JSON SCRAPER ────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Scrape Reddit Post or Subreddit thread via Official JSON API
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
async function scrapeReddit(url) {
  try {
    console.log(`[Social Media Engine]: 🤖 Fetching Reddit data for: ${url}`);
    let cleanUrl = url.split('?')[0].replace(/\/$/, '');
    if (!cleanUrl.endsWith('.json')) {
      cleanUrl += '.json';
    }

    const redditData = await fetchHttp(cleanUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    });

    if (Array.isArray(redditData) && redditData.length > 0) {
      const postListing = redditData[0]?.data?.children?.[0]?.data;
      if (postListing) {
        const title = postListing.title || '(Tanpa judul)';
        const author = postListing.author || 'anonymous';
        const subreddit = postListing.subreddit_name_prefixed || 'r/reddit';
        const upvotes = (postListing.score || 0).toLocaleString('id-ID');
        const numComments = (postListing.num_comments || 0).toLocaleString('id-ID');
        const selftext = postListing.selftext ? postListing.selftext.slice(0, 600) : '';

        // Extract Top 2 Comments
        let topCommentsStr = '';
        if (redditData[1]?.data?.children?.length > 0) {
          const comments = redditData[1].data.children
            .filter(c => c.data && c.data.body && c.data.author !== 'AutoModerator')
            .slice(0, 2)
            .map((c, i) => `  ${i + 1}. **u/${c.data.author}** (🔼 ${c.data.score}): "${c.data.body.slice(0, 180)}..."`);

          if (comments.length > 0) {
            topCommentsStr = `\n💬 **Komentar Teratas Komunitas:**\n${comments.join('\n')}`;
          }
        }

        return `🤖 **Data Thread Reddit (Official JSON API):**\n` +
          `📌 **Subreddit:** \`${subreddit}\` | 👤 **Author:** \`u/${author}\`\n` +
          `📝 **Judul Postingan:** **${title}**\n` +
          (selftext ? `📖 **Isi Postingan:**\n${selftext}...\n\n` : '\n') +
          `📊 **Metrik Komunitas:** 🔼 \`${upvotes} Upvotes\` | 💬 \`${numComments} Komentar\`\n` +
          topCommentsStr + `\n🔗 **Link Thread:** ${url}`;
      }
    }
  } catch (err) {
    console.warn('[Social Media Engine]: Reddit scrape warning:', err.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// ── 5. INSTAGRAM METADATA & PROFILE RESEARCHER ────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Research Instagram user profile or post
 * @param {string} queryOrUrl 
 * @returns {Promise<string|null>}
 */
async function scrapeInstagram(queryOrUrl) {
  try {
    const { tavilyApiCall, filterSafeResults } = require('./tavily');

    let handle = queryOrUrl;
    const urlMatch = queryOrUrl.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/i);
    if (urlMatch) {
      handle = urlMatch[1];
    } else {
      handle = handle.replace(/[^a-zA-Z0-9_.-]/g, '');
    }

    if (!handle || handle.length < 2) return null;
    const cleanHandle = handle.toLowerCase();
    console.log(`[Social Media Engine]: 📷 Researching Instagram profile: @${cleanHandle}`);

    const res = await tavilyApiCall('/search', {
      query: `instagram "${cleanHandle}"`,
      include_domains: ['instagram.com'],
      search_depth: 'advanced',
      include_answer: true,
      max_results: 5
    });

    const safeResults = typeof filterSafeResults === 'function' ? filterSafeResults(res.results) : (res.results || []);

    // 1. STRICT PROFILE URL VERIFICATION: Check if any result is the exact profile page (NOT a random reel, post, or another user)
    const exactProfile = safeResults.find(r => {
      try {
        const u = new URL(r.url);
        const pathname = u.pathname.toLowerCase().replace(/\/$/, '');
        // Must match /username and not be /reel/xxx or /p/xxx
        return pathname === `/${cleanHandle}` && !pathname.startsWith('/reel') && !pathname.startsWith('/p');
      } catch (_) {
        return false;
      }
    });

    if (exactProfile) {
      const title = exactProfile.title || `Profil Instagram @${cleanHandle}`;
      const snippet = exactProfile.content || 'Profil Publik Terverifikasi';

      return `📷 **Data Profil Instagram (Official Social Intelligence):**\n` +
        `👤 **Username:** @${cleanHandle}\n` +
        `📌 **Akun:** ${title}\n` +
        `📝 **Bio & Statistik:**\n${snippet}\n\n` +
        `🔗 **Link Profil:** https://www.instagram.com/${cleanHandle}/`;
    }

    // 2. PRIVATE / UNINDEXED ACCOUNT HANDLING:
    // If no exact public profile page was found, the account is private or has no public Google/web index.
    return `📷 **Data Profil Instagram (Official Social Intelligence):**\n` +
      `👤 **Username:** @${cleanHandle}\n` +
      `🔒 **Status Akun:** **Akun Privat (Private Account)** / Tidak Terindeks Publik\n` +
      `📝 **Keterangan:** Akun @${cleanHandle} terdaftar di Instagram, namun bio dan postingannya tidak dapat ditampilkan karena akun berstatus privat atau dilindungi pengaturan privasi pengguna.\n\n` +
      `🔗 **Link Profil:** https://www.instagram.com/${cleanHandle}/`;
  } catch (err) {
    console.warn('[Social Media Engine]: Instagram scrape warning:', err.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// ── MASTER ROUTER: SOCIAL MEDIA INTELLIGENCE ──────────────────
// ══════════════════════════════════════════════════════════════

/**
 * Detects and executes targeted social media scrapers
 * @param {string} input 
 * @returns {Promise<string|null>}
 */
async function handleSocialMediaIntelligence(input) {
  if (!input || typeof input !== 'string') return null;

  const urlMatch = input.match(/https?:\/\/[^\s]+/i);
  const rawUrl = urlMatch ? urlMatch[0].trim().replace(/[.,!?;:)>\]"']+$/, '') : '';

  // 1. TikTok
  if (rawUrl && /tiktok\.com/i.test(rawUrl)) {
    return await scrapeTikTok(rawUrl);
  }

  // 2. YouTube
  if (rawUrl && /(?:youtube\.com|youtu\.be)/i.test(rawUrl)) {
    return await scrapeYouTube(rawUrl);
  }

  // 3. Twitter / X
  if (rawUrl && /(?:twitter\.com|x\.com)/i.test(rawUrl)) {
    return await scrapeTwitter(rawUrl);
  }

  // 4. Reddit
  if (rawUrl && /reddit\.com/i.test(rawUrl)) {
    return await scrapeReddit(rawUrl);
  }

  // 5. Instagram URL or Direct Handle Query (e.g. "cari instagram @dioreciii", "cek ig @username")
  if (rawUrl && /instagram\.com/i.test(rawUrl)) {
    return await scrapeInstagram(rawUrl);
  }

  const igHandleMatch = input.match(/\b(?:instagram|ig)\s+@?([a-zA-Z0-9_.-]{3,30})\b/i) || input.match(/@([a-zA-Z0-9_.-]{3,30})\b/i);
  if (/\b(?:instagram|ig|stalk|profil|sosmed)\b/i.test(input) && igHandleMatch) {
    return await scrapeInstagram(igHandleMatch[1]);
  }

  return null;
}

module.exports = {
  handleSocialMediaIntelligence,
  scrapeTikTok,
  scrapeYouTube,
  scrapeTwitter,
  scrapeReddit,
  scrapeInstagram
};
