/**
 * AZURA Web Surf Agent — Dual-Mode Autonomous & Interactive Web Companion
 * 
 * Mode 1: 🎯 Autonomous Goal-Oriented Mission (Action-based based on first prompt)
 *   - Example: "ara browsing situs learnext terus masuk ke website resminya"
 *   - Azura decomposes instructions, types on screen, clicks into official sites, scrolls,
 *     reports concise summary, and auto-closes session upon completion!
 * 
 * Mode 2: 🕹️ Persistent Step-by-Step Browsing (Mabar / Interactive Standby)
 *   - Example: "ara, aku mau browsing-browsing nih, bantuin dong"
 *   - Stays persistently open without auto-closing until user says "ara tutup browser"!
 *   - Accepts real-time commands: "ketik ...", "klik ...", "scroll bawah", "jelaskan layar".
 * 
 * All visual output streams live 60fps to http://203.175.10.163:7860/browse.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBrowser, getOrCreateSession, getWebpageSummary, openWebpage, scrollWebpage, clickOnWebpage, typeIntoWebpage, closeBrowserSession, resetSessionTimer, activeBrowserSessions } = require('./headlessBrowser');
const { broadcastFrame, updateStreamMeta, broadcastAzuraReply, STREAM_URL } = require('./livePortal');
const { askAzura } = require('./azura');
const config = require('./config');

const BROWSE_URL = 'http://203.175.10.163:7860/browse';

/**
 * MODE 1: Autonomous Goal-Oriented Browsing Mission
 * Executes sequential browser actions, navigates into websites, reports concisely, and keeps session open for chained commands.
 * @param {string} guildId 
 * @param {string} missionPrompt 
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 */
async function executeAutonomousBrowsingMission(guildId, missionPrompt, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 🚀 Processing Browsing Request: "${missionPrompt}"`);

  // 1. Explicit Session Termination Check
  const isCloseCmd = /\b(?:tutup|close|akhiri|selesai|exit|keluar|reset)\s*(?:browser|sesi|browsing)?\b/i.test(missionPrompt.trim());
  if (isCloseCmd) {
    console.log(`[Web Surf Agent]: 🔒 User requested to close browser session for ${guildId}`);
    await closeBrowserSession(guildId);
    const closeMsg = 'Siap, sesi browser telah ditutup dan memori dibebaskan ya.';
    await speakInVC(guildId, closeMsg, client, userName);
    if (textChannel) {
      textChannel.send('🔒 **Sesi browser telah ditutup.** Browser berhasil dibersihkan!').catch(() => {});
    }
    if (typeof broadcastAzuraReply === 'function') {
      broadcastAzuraReply('🔒 Sesi browser telah ditutup dan memori dibebaskan.');
    }
    return { success: true, title: 'Sesi Ditutup', url: 'about:blank' };
  }

  const session = await getOrCreateSession(guildId);
  const { page } = session;

  const currentUrl = page.url() || '';
  const currentTitle = await page.title().catch(() => '');
  const isOnActivePage = currentUrl && !currentUrl.includes('about:blank') && currentUrl !== 'https://www.google.com/' && !currentUrl.includes('google.com/search') && !currentUrl.includes('search.yahoo.com');

  if (!isOnActivePage) {
    const announceText = 'Siap, aku browsing sekarang ya, kamu bisa pantau prosesnya di link streaming.';
    await speakInVC(guildId, announceText, client, userName);
    if (textChannel) {
      textChannel.send(`✨ **Siap, aku browsing sekarang ya!**\nPantau layarnya secara live di: ${BROWSE_URL}`).catch(() => {});
    }
  } else {
    console.log(`[Web Surf Agent]: ⚡ Continuing chained action on active page: "${currentTitle}" (${currentUrl})`);
    if (textChannel) {
      textChannel.send(`⚡ **Melanjutkan aksi di halaman aktif:** \`${currentTitle || currentUrl}\``).catch(() => {});
    }
  }

  try {
    const cleanPrompt = missionPrompt
      .replace(/<@!?\d+>/g, '')
      .replace(/\b(?:ara|azura|tolong|coba|dong|ya|yuk|plis)\b/gi, '')
      .trim();

    updateStreamMeta({
      title: '🌐 AZURA: ' + cleanPrompt.slice(0, 30),
      url: currentUrl || 'https://www.google.com',
      activeGuild: guildId,
      mode: 'browse'
    });

    // 🧠 Autonomous Multi-Step Action Chain Planner (Direct LLM Reasoning with Page Continuity)
    let plan = {
      goal: cleanPrompt,
      category: 'general',
      steps: []
    };

    try {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
      const aiPlannerRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Kamu adalah arsitek eksekusi web browsing otonom berintelektual tinggi yang selalu merespon dalam format JSON.
Tugasmu menganalisis instruksi user dan menyusun RANTAI AKSI OTONOM (Action Chain) berurutan (MAKSIMAL 8 LANGKAH) dalam bentuk format JSON yang akan dieksekusi secara nyata di browser headless.

INFORMASI STATE BROWSER SAAT INI:
- Halaman aktif saat ini: "${currentTitle}" (${currentUrl})
- Status: ${isOnActivePage ? 'Browser SUDAH TERBUKA dan sedang aktif di halaman ini!' : 'Browser baru dibuka/kosong'}

ATURAN RANTAI AKSI BERKELANJUTAN (SANGAT PENTING):
1. Jika browser SUDAH berada di halaman aktif (misal "${currentTitle}" / "${currentUrl}") dan instruksi user adalah AKSI LANJUTAN (misal: "ketik ...", "klik tombol ...", "tanya lagi ...", "scroll ...", "coba pakai ..."):
   -> JANGAN PERNAH memulai ulang dari Google atau menavigasi ulang! JANGAN tambahkan aksi navigate atau search!
   -> Langsung lakukan aksi interaksi (click, type, press_key, wait, scroll) DI HALAMAN AKTIF SAAT INI!
2. Hanya gunakan aksi "navigate" atau "search" jika:
   - User secara eksplisit meminta membuka situs/URL lain (contoh: "buka youtube", "cari di google ...", "pindah ke situs X")
   - Atau halaman saat ini masih kosong / belum membuka website apa pun.

Pilihan aksi yang didukung:
1. "navigate": { "action": "navigate", "url": "https://...", "description": "..." }
2. "click": { "action": "click", "selector": "#id, button, a, [data-testid=...]", "text": "opsional teks tombol", "description": "..." }
3. "type": { "action": "type", "selector": "#id, input, textarea, div[contenteditable=true]", "text": "teks yang diketik", "description": "..." }
4. "press_key": { "action": "press_key", "key": "Enter" | "Tab" | "Escape", "description": "..." }
5. "scroll": { "action": "scroll", "amount": 400, "description": "..." }
6. "wait": { "action": "wait", "durationMs": 3000, "description": "..." }
7. "search": { "action": "search", "query": "kata kunci pencarian", "description": "..." }

Contoh Kasus A (Aksi Lanjutan di Halaman Terbuka, misal di ChatGPT):
User: "ketik 'Nama aku azura, salam kenal, nama kamu siapa?'"
-> Steps:
[
  { "action": "click", "selector": "#prompt-textarea, textarea, div[contenteditable='true']", "description": "Klik kolom input chat" },
  { "action": "type", "selector": "#prompt-textarea, textarea, div[contenteditable='true']", "text": "Nama aku azura, salam kenal, nama kamu siapa?", "description": "Ketik pesan sapaan" },
  { "action": "click", "selector": "button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Kirim']", "description": "Klik tombol kirim pesan" },
  { "action": "press_key", "key": "Enter", "description": "Kirim pesan dengan Enter" },
  { "action": "wait", "durationMs": 7000, "description": "Menunggu respon balasan ChatGPT" },
  { "action": "scroll", "amount": 350, "description": "Scroll membaca balasan" }
]

Contoh Kasus B (Membuka Situs Baru dari Awal):
User: "buka chat gpt"
-> Steps:
[
  { "action": "navigate", "url": "https://chatgpt.com", "description": "Membuka situs ChatGPT" },
  { "action": "wait", "durationMs": 3000, "description": "Menunggu tampilan ChatGPT termuat" }
]

Contoh Kasus C (Mencari di Mesin Pencari):
User: "browsing lagu montagem coma"
-> Steps:
[
  { "action": "search", "query": "lagu montagem coma", "description": "Cari lagu montagem coma" },
  { "action": "scroll", "amount": 350, "description": "Lihat hasil teratas" }
]

Format Keluaran JSON WAJIB:
{
  "goal": "penjelasan singkat tujuan misi",
  "category": "ai_chat" | "music" | "news" | "form" | "commercial" | "general",
  "steps": [
    // Array aksi berurutan, MAKSIMAL 8 LANGKAH!
  ]
}`
          },
          { role: 'user', content: cleanPrompt }
        ]
      });

      const parsedPlan = JSON.parse(aiPlannerRes.choices[0].message.content);
      if (parsedPlan.goal) plan.goal = parsedPlan.goal;
      if (parsedPlan.category) plan.category = parsedPlan.category;
      if (Array.isArray(parsedPlan.steps) && parsedPlan.steps.length > 0) {
        plan.steps = parsedPlan.steps.slice(0, 8); // Enforce maximum 8 actions
      }
    } catch (e) {
      console.warn('[Autonomous Planner Fallback]:', e.message);
    }

    // Default fallback step if planner failed
    if (plan.steps.length === 0) {
      plan.steps = [
        { action: 'search', query: cleanPrompt, description: `Mencari ${cleanPrompt}` },
        { action: 'scroll', amount: 400, description: 'Melihat halaman web' }
      ];
    }

    const maxSteps = Math.min(plan.steps.length, 8);
    console.log(`[Autonomous Mission]: ⛓️ Executing Action Chain of ${maxSteps} steps for goal: "${plan.goal}"`);

    // ⚡ Execute Action Chain Step-by-Step
    for (let i = 0; i < maxSteps; i++) {
      const step = plan.steps[i];
      console.log(`[Action Chain Step ${i + 1}/${maxSteps}]: ⚡ ${step.action} - ${step.description || ''}`);

      updateStreamMeta({
        title: `🌐 [Aksi ${i + 1}/${maxSteps}] ${step.description || step.action}`,
        url: page.url(),
        activeGuild: guildId,
        mode: 'browse'
      });

      if (typeof broadcastAzuraReply === 'function') {
        broadcastAzuraReply(`[Aksi ${i + 1}/${maxSteps}] ${step.description || step.action}`);
      }

      try {
        if (step.action === 'navigate') {
          let targetUrl = step.url || 'https://www.google.com';
          if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;
          console.log(`[Action Chain Navigate]: Opening ${targetUrl}...`);
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          await page.waitForTimeout(2000);
        } else if (step.action === 'search') {
          const searchQuery = step.query || plan.goal;
          console.log(`[Action Chain Search]: Searching for "${searchQuery}"...`);
          await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(2000);

          // Click top organic result strictly
          const organicLink = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('#web ol > li, .algo, #rso div.g, #search div.g'));
            const blacklisted = ['yahoo.com', 'google.com', 'bing.com'];
            for (const it of items) {
              const a = it.querySelector('h3 a, .compTitle a, a[href*="http"]');
              if (a) {
                const href = a.href || '';
                if (!blacklisted.some(b => href.includes(b)) && href.startsWith('http')) {
                  return href;
                }
              }
            }
            return null;
          });

          if (organicLink) {
            console.log(`[Action Chain Search]: Entering top organic result: ${organicLink}`);
            await page.goto(organicLink, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(2500);
          }
        } else if (step.action === 'click') {
          let clicked = false;
          if (step.selector) {
            const el = await page.$(step.selector).catch(() => null);
            if (el) {
              await el.click({ timeout: 4000, force: true }).catch(() => {});
              clicked = true;
            }
          }
          if (!clicked && step.text) {
            const btn = await page.$(`button:has-text("${step.text}"), a:has-text("${step.text}"), [aria-label*="${step.text}"]`).catch(() => null);
            if (btn) {
              await btn.click({ timeout: 4000, force: true }).catch(() => {});
            }
          }
          await page.waitForTimeout(1000);
        } else if (step.action === 'type') {
          if (step.selector) {
            const el = await page.$(step.selector).catch(() => null);
            if (el) {
              await el.click({ timeout: 4000, force: true }).catch(() => {});
              await page.waitForTimeout(300);
            }
          }
          await page.keyboard.type(step.text || '', { delay: 40 });
          await page.waitForTimeout(500);
        } else if (step.action === 'press_key') {
          await page.keyboard.press(step.key || 'Enter');
          await page.waitForTimeout(1000);
        } else if (step.action === 'scroll') {
          const amt = step.amount || 400;
          await page.evaluate((top) => window.scrollBy({ top, behavior: 'smooth' }), amt).catch(() => {});
          await page.waitForTimeout(1500);
        } else if (step.action === 'wait') {
          await page.waitForTimeout(Math.min(step.durationMs || 3000, 10000));
        }
      } catch (stepErr) {
        console.warn(`[Action Chain Step ${i + 1} Warn]:`, stepErr.message);
      }
    }

    // 2. Deep Domain-Level Extraction of Content, AI Chat Responses, and Article Text
    const siteInspection = await page.evaluate(() => {
      // Check for AI / assistant responses (ChatGPT, Claude, Gemini, etc.)
      const chatReplies = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], div.markdown, [class*="agent-turn"], [class*="message-assistant"], .response, article'))
        .map(el => el.innerText.trim())
        .filter(t => t.length > 5 && !t.includes('Search your chat history') && !t.includes('Log in to save conversations'));

      const institutionMatches = document.documentElement.outerHTML.match(/course-institutions\/[^"']+/g) || [];
      const clients = [...new Set(institutionMatches)].map(i => {
        return i.replace('course-institutions/', '').replace(/landing-/, '').replace(/-[a-f0-9]+\.png/, '').replace(/-/g, ' ').toUpperCase();
      });

      const imgAlts = Array.from(document.querySelectorAll('img[alt]'))
        .map(i => i.alt.trim())
        .filter(alt => alt.length > 2 && !alt.toLowerCase().includes('logo') && !alt.toLowerCase().includes('icon'));

      const textSnippets = Array.from(document.querySelectorAll('h1, h2, h3, p, span'))
        .map(e => e.innerText.trim())
        .filter(t => t.length > 25 && !t.includes('function(') && !t.includes('{'))
        .slice(0, 15);

      return {
        chatReplies,
        clients,
        imgAlts,
        textSnippets
      };
    }).catch(() => ({ chatReplies: [], clients: [], imgAlts: [], textSnippets: [] }));

    const finalTitle = await page.title().catch(() => 'Halaman Web');
    const finalUrl = page.url();
    session.currentUrl = finalUrl;
    session.currentTitle = finalTitle;
    updateStreamMeta({ title: finalTitle, url: finalUrl, activeGuild: guildId, mode: 'browse' });

    const summary = await getWebpageSummary(guildId);
    const screenshotBuffer = await page.screenshot({ type: 'png' }).catch(() => null);

    // 4. Fast & Intelligent Step Conclusion Generation (Under 1s with gpt-4o-mini)
    let conclusion = '';
    try {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
      const conclusionRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Kamu adalah Azura, asisten web companion yang cerdas, tanggap, dan ramah.
Pengguna memberikan perintah/instruksi: "${missionPrompt}".
Situs yang sedang kamu operasikan: "${finalTitle}" (${finalUrl}).

Data & Kejadian Nyata di Layar:
${siteInspection.chatReplies.length > 0 ? `Respon/Balasan langsung di situs:\n${siteInspection.chatReplies.slice(0, 4).join('\n---\n')}\n` : ''}
Kutipan teks di halaman:
${siteInspection.textSnippets.slice(0, 6).join('\n')}
Ringkasan isi halaman:
${(summary.bodyText || '').slice(0, 800)}

TUGASMU:
Buat KESIMPULAN HASIL AKSI (Conclusion) yang jelas, padat (2-4 kalimat), dan natural khas Azura.
- Jelaskan aksi apa yang sudah kamu lakukan di situs tersebut (misal: "Aku sudah membuka ChatGPT dan mengetikkan pesan sapaan kamu...").
- Sebutkan apa respon/balasan atau informasi penting yang muncul di layar setelah aksi tersebut.
- Jangan mengulang perintah user plek-ketiplek; sampaikan kesimpulannya secara cerdas!`
          }
        ]
      });
      conclusion = conclusionRes.choices[0].message.content.trim();
    } catch (conclErr) {
      console.warn('[Conclusion Generation Fallback]:', conclErr.message);
      conclusion = siteInspection.chatReplies.length > 0
        ? `Aku sudah mengeksekusi aksimu di ${finalTitle}. Balasan di layar: "${siteInspection.chatReplies[0].slice(0, 150)}..."`
        : `Aku sudah menyelesaikan aksimu di ${finalTitle}. Halaman saat ini menampilkan informasi terkait ${cleanPrompt}.`;
    }

    // Broadcast conclusion to web live portal stream
    if (typeof broadcastAzuraReply === 'function') {
      broadcastAzuraReply(`💬 ${conclusion}`);
    }

    // 4. Resolve Discord text channel (for both Discord and Web Portal commands)
    let targetDiscordChannel = textChannel;
    let discordClient = client;
    if (!discordClient) {
      try {
        discordClient = require('./index');
      } catch (_) {}
    }

    if (!targetDiscordChannel && discordClient) {
      try {
        const { getCompanionTextChannel } = require('./voiceCompanion');
        if (guildId && guildId !== 'global') {
          targetDiscordChannel = getCompanionTextChannel(guildId);
        }
        if (!targetDiscordChannel) {
          const { activeConnections } = require('./voiceCompanion');
          for (const [gid] of activeConnections.entries()) {
            const ch = getCompanionTextChannel(gid);
            if (ch) {
              targetDiscordChannel = ch;
              break;
            }
          }
        }
        if (!targetDiscordChannel && discordClient.channels && discordClient.channels.cache) {
          targetDiscordChannel = discordClient.channels.cache.get('1539307727690407986') ||
                                 discordClient.channels.cache.find(c => c.isTextBased && c.isTextBased() && c.name && /general|chat|utama/i.test(c.name));
        }
      } catch (_) {}
    }

    // Send visual card and conclusion to Discord
    if (targetDiscordChannel) {
      const attachment = screenshotBuffer ? new AttachmentBuilder(screenshotBuffer, { name: 'mission_destination.png' }) : null;
      const validUrl = finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`;
      
      let cleanDirectUrl = validUrl;
      let shortLabel = 'Buka Halaman';

      try {
        const parsed = new URL(validUrl);
        shortLabel = parsed.hostname.replace(/^www\./, '');
        if (parsed.pathname && parsed.pathname !== '/') {
          const pathSnippet = parsed.pathname.length > 25 ? parsed.pathname.slice(0, 25) + '...' : parsed.pathname;
          shortLabel += pathSnippet;
        }
      } catch (_) {
        shortLabel = finalTitle.slice(0, 30);
      }

      const embed = new EmbedBuilder()
        .setColor(0x00F2FE)
        .setTitle(`🌐 ${finalTitle.slice(0, 60)}`)
        .setDescription(
          `🎯 **Perintah:** *${missionPrompt}*\n\n` +
          `📝 **Kesimpulan:**\n${conclusion}\n\n` +
          `🔗 **Website:** [👉 ${shortLabel}](${cleanDirectUrl})\n\n` +
          `*💡 Sesi browser tetap aktif. Kamu bisa lanjut memberi perintah berikutnya seperti "ketik ...", "klik ...", atau "tutup browser".*`
        )
        .setFooter({ text: 'AZURA Web Companion' })
        .setTimestamp();

      if (attachment) {
        embed.setImage('attachment://mission_destination.png');
      }

      await targetDiscordChannel.send({ embeds: [embed], files: attachment ? [attachment] : [] }).catch(() => {});
    }

    // 5. Short, cost-efficient closing announcement in VC (Fixed short sentence, saves ElevenLabs quota)
    const completionVoiceText = 'Attila aku udah menemukan informasi websitenya sesuai yang kamu minta nih, aku kirimin detail informasinya ya.';
    await speakInVC(guildId, completionVoiceText, discordClient, userName);

    // 🟢 KEEP SESSION OPEN FOR CHAINED COMMANDS (DO NOT AUTO-CLOSE!)
    console.log(`[Web Surf Agent]: 🟢 Browser session kept active on "${finalTitle}" for continued actions.`);
    resetSessionTimer(guildId);

    return { success: true, title: finalTitle, url: finalUrl, conclusion };

  } catch (err) {
    console.error('[Autonomous Mission Error]:', err.message);
    const errMsg = `Misi browsing gagal: ${err.message}`;
    await speakInVC(guildId, errMsg, client, userName);
    if (textChannel) textChannel.send(`❌ ${errMsg}`).catch(() => {});
    setTimeout(() => closeBrowserSession(guildId), 5000);
    return { success: false, error: err.message };
  }
}

/**
 * MODE 2: Persistent Manual Standby Browsing ("ara buka browser")
 * Opens browser and stays permanently active waiting for manual commands until explicitly closed.
 * @param {string} guildId 
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 */
async function startPersistentInteractiveBrowsing(guildId, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 🕹️ Starting Persistent Manual Browsing for ${guildId}`);

  // Exact opening dialogue requested by user:
  const announceText = 'Siap Attila, aku bukain browser nya sekarang ya.';
  await speakInVC(guildId, announceText, client, userName || 'Attila');

  if (textChannel) {
    textChannel.send(`✨ **Siap Attila, aku bukain browser nya sekarang ya.**\nPantau layarnya secara live di: ${BROWSE_URL}`).catch(() => {});
  }

  const res = await openWebpage(guildId, 'https://www.google.com');
  const session = activeBrowserSessions?.get(guildId);
  if (session) {
    session.isPersistent = true;
    session.mode = 'manual'; // Manual mode: silent typing/clicking, no auto-reports
  }

  return { success: true };
}

/**
 * Handle Web Surf Agent commands from Discord chat
 * Intercepts BOTH Mode 1 (Autonomous Mission) and Mode 2 (Step-by-Step Standby)
async function handleWebSurfCommands(message, client) {
  if (!message.guild) return false;

  const content = message.content.trim();
  const lower = content.toLowerCase();
  const guildId = message.guild.id;
  const userName = message.author.displayName || message.author.username;
  const textChannel = message.channel;

  // Ignore camera commands completely (handled by videoStreamer)
  if (/\b(?:kamera|cam|camera|webcam)\b/i.test(lower)) {
    return false;
  }

  // 1. Direct status query: "status browsing", "status browser"
  if (/^(?:status|cek)\s+(?:browser|browsing)$/i.test(lower)) {
    const status = getBrowserSessionStatus(guildId);
    if (!status.active) {
      await message.reply('ℹ️ Tidak ada sesi browsing aktif di server ini.');
    } else {
      await message.reply(`🌐 **[AZURA Browser Active]**\n• URL: \`${status.url}\`\n• Judul: **${status.title}**\n• Monitor Live: ${BROWSE_URL}`);
    }
    return true;
  }

  // 2. Manual Standby Session Trigger ("ara buka browser", "ara bukain browser")
  // User wants to open browser, stay standby, and command manually without auto-close!
  const isManualStandby = /\b(?:ara|azura)\s+(?:tolong\s+)?(?:buka|bukain)\s+(?:browser|chrome|web)\s*(?:standby)?$/i.test(lower) ||
                          /\b(?:ara|azura)\s+(?:aku\s+)?(?:mau|pengen|yuk|bantu|temenin)\s+browsing\b/i.test(lower) ||
                          /^buka\s+browser\s*(?:standby)?$/i.test(lower);

  if (isManualStandby) {
    await startPersistentInteractiveBrowsing(guildId, userName, textChannel, client);
    return true;
  }

  // 3. Step-by-Step chained commands while active session is running
  const session = activeBrowserSessions?.get(guildId);
  const isSessionRunning = session && session.page && !session.page.isClosed();

  if (isSessionRunning) {
    // A. Close session
    if (/\b(?:tutup|close|stop|akhiri|keluar|reset)\s*(?:browser|sesi|browsing)?\b/i.test(lower)) {
      const res = await closeBrowserSession(guildId);
      await message.reply(`🔒 **[AZURA Browser]** ${res.message}`);
      await speakInVC(guildId, 'Sesi browser sudah aku tutup yaa!', client, userName);
      return true;
    }

    // B. Chained actions (ketik, klik, tanya, scroll, dll.)
    // Seamlessly execute on current active page without restarting from Google!
    const isChainedAction = /^(?:ara\s+|azura\s+)?(?:tolong\s+)?(?:ketik|klik|tekan|pilih|tanya|coba|scroll|gulir|baca|jelaskan)\b/i.test(lower) ||
                            /^(?:ketik|klik|scroll|tutup)\b/i.test(lower);

    if (isChainedAction) {
      await executeAutonomousBrowsingMission(guildId, content, userName, textChannel, client);
      return true;
    }
  }

  // 4. Goal-Oriented Autonomous Mission (Action-based based on first prompt!)
  // E.g.: "ara browsing situs learnext terus masuk ke website resminya"
  // E.g.: "ara tolong browsing tiket pesawat jakarta bali terus pilih jadwal termurah"
  // E.g.: "ara browsing [topic]"
  const isMission = /\b(?:ara|azura)\s+(?:tolong\s+)?(?:browsing|carikan\s+(?:di\s+web\s+)?|cariin\s+(?:di\s+web\s+)?|buka\s+(?:situs|web|website|halaman|link))\s+(.+)/i.test(content) ||
                    /\b(?:browsing|masuk\s+ke\s+website|kunjungi\s+situs)\b/i.test(lower);

  if (isMission) {
    await executeAutonomousBrowsingMission(guildId, content, userName, textChannel, client);
    return true;
  }

  return false;
}

/**
 * Helper: Speak text in Discord Voice Channel with minimal overhead
 * @param {string} guildId 
 * @param {string} text 
 * @param {import('discord.js').Client} client 
 * @param {string} userName 
 */
async function speakInVC(guildId, text, client, userName) {
  try {
    const { speakInAllActiveVCs, speakTextInVC } = require('./voiceCompanion');
    if (guildId && guildId !== 'global' && guildId !== 'default_guild') {
      await speakTextInVC(guildId, text, client, userName).catch(() => {});
    } else {
      await speakInAllActiveVCs(text, client).catch(() => {});
    }
  } catch (_) {}
}

module.exports = {
  executeAutonomousBrowsingMission,
  startPersistentInteractiveBrowsing,
  handleWebSurfCommands
};
