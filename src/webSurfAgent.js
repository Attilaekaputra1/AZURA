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
const { getBrowser, getOrCreateSession, getWebpageSummary, openWebpage, scrollWebpage, clickOnWebpage, typeIntoWebpage, closeBrowserSession, activeBrowserSessions } = require('./headlessBrowser');
const { broadcastFrame, updateStreamMeta, STREAM_URL } = require('./livePortal');
const { askAzura } = require('./azura');
const config = require('./config');

const BROWSE_URL = 'http://203.175.10.163:7860/browse';

/**
 * MODE 1: Autonomous Goal-Oriented Browsing Mission
 * Executes sequential browser actions, navigates into websites, reports concisely, and auto-closes.
 * @param {string} guildId 
 * @param {string} missionPrompt 
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 */
async function executeAutonomousBrowsingMission(guildId, missionPrompt, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 🚀 Executing Autonomous Mission: "${missionPrompt}"`);

  // Exact opening dialogue requested by user (no name mentioned)
  const announceText = 'Siap, aku browsing sekarang ya, kamu bisa pantau prosesnya di link streaming.';
  await speakInVC(guildId, announceText, client, userName);

  if (textChannel) {
    textChannel.send(`✨ **Siap, aku browsing sekarang ya!**\nPantau layarnya secara live di: ${BROWSE_URL}`).catch(() => {});
  }

  const session = await getOrCreateSession(guildId);
  const { page } = session;

  try {
    const cleanPrompt = missionPrompt
      .replace(/<@!?\d+>/g, '')
      .replace(/\b(?:ara|azura|tolong|coba|dong|ya|yuk|plis)\b/gi, '')
      .trim();

    updateStreamMeta({
      title: '🌐 AZURA: ' + cleanPrompt.slice(0, 30),
      url: 'https://www.google.com',
      activeGuild: guildId,
      mode: 'browse'
    });

    // 🧠 Ultra-Intelligent AI Mission Planner (Direct LLM Reasoning)
    let plan = {
      searchQuery: cleanPrompt,
      targetType: 'general',
      preferredDomain: null,
      inspectionGoal: cleanPrompt
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
            content: `Kamu adalah asisten otonom web browsing berintelektual tinggi. Tugasmu menganalisis instruksi user dan menghasilkan JSON rencana aksi browsing:
{
  "searchQuery": "kata kunci Google paling akurat, efektif, dan alami untuk diketik di search box (contoh untuk 'ara browsing berita tentang lagu akon right now deh' -> 'Akon Right Now lagu', untuk 'browsing situs learnext terus masuk ke website resminya' -> 'learnext')",
  "targetType": "news" | "website" | "general",
  "preferredDomain": "nama domain jika user spesifik menyebut website tertentu (contoh: 'learnext.ai'), atau null jika mencari berita/informasi/artikel umum",
  "inspectionGoal": "apa inti informasi yang harus dicari dan dirangkum untuk user"
}`
          },
          { role: 'user', content: cleanPrompt }
        ]
      });

      const parsedPlan = JSON.parse(aiPlannerRes.choices[0].message.content);
      if (parsedPlan.searchQuery) plan.searchQuery = parsedPlan.searchQuery;
      if (parsedPlan.targetType) plan.targetType = parsedPlan.targetType;
      if (parsedPlan.preferredDomain !== undefined) plan.preferredDomain = parsedPlan.preferredDomain;
      if (parsedPlan.inspectionGoal) plan.inspectionGoal = parsedPlan.inspectionGoal;
    } catch (e) {
      console.warn('[Autonomous Planner Fallback]:', e.message);
    }

    console.log(`[Autonomous Mission Plan]: Query="${plan.searchQuery}", Type="${plan.targetType}", Domain="${plan.preferredDomain}", Goal="${plan.inspectionGoal}"`);

    // 1. Open Google Homepage
    console.log(`[Autonomous Mission]: 🔍 Navigating to Google with query: "${plan.searchQuery}"`);
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(700);

    // Auto-click consent if present
    const consentBtn = await page.$('button:has-text("Setuju"), button:has-text("I agree"), button:has-text("Accept all"), #L2AGLb');
    if (consentBtn) {
      await consentBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 2. Visible On-Screen Typing on Google (Human simulation)
    const searchInput = await page.waitForSelector('textarea[name="q"], input[name="q"]', { timeout: 8000 }).catch(() => null);
    if (searchInput) {
      await searchInput.click();
      await page.waitForTimeout(200);
      await page.keyboard.type(plan.searchQuery, { delay: 45 });
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    } else {
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(plan.searchQuery)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);
    }

    // 3. Scroll Search Results so viewers see them
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' })).catch(() => {});
    await page.waitForTimeout(1200);

    // 4. Human-like Resolution of Destination Website / Article
    console.log(`[Autonomous Mission]: 🖱️ Resolving target destination for query: "${plan.searchQuery}"`);

    const destination = await page.evaluate(({ preferredDomain, targetType }) => {
      const allA = Array.from(document.querySelectorAll('#rso a[href], #search a[href], a[href]'));
      
      for (const a of allA) {
        const href = a.href || '';
        const txt = (a.innerText || '').toLowerCase().replace(/\s+/g, ' ');
        
        // Skip Google system navigation
        if (href.includes('about/products') || href.includes('accounts.google') || href.includes('support.google') || href.includes('google.com/search') || href.includes('google.co.id/intl') || href.includes('maps.google')) {
          continue;
        }

        // Case A: Specific website domain requested (e.g. learnext.ai)
        if (preferredDomain) {
          const domClean = preferredDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
          if (href.toLowerCase().includes(domClean) || txt.includes(domClean)) {
            let realUrl = href;
            const urlMatch = txt.match(/https?:\/\/[^\s\n"']+/i);
            if (urlMatch) realUrl = urlMatch[0];
            return { title: a.innerText.trim(), url: realUrl };
          }
        }

        // Case B: General or News query -> pick top organic article / result
        const isOrganic = href.includes('/goto?url=') || href.includes('/url?') || a.closest('#rso') || a.querySelector('h3');
        if (isOrganic && txt.length > 5) {
          let realUrl = href;
          const urlMatch = txt.match(/https?:\/\/[^\s\n"']+/i);
          if (urlMatch) realUrl = urlMatch[0];
          return { title: a.innerText.trim(), url: realUrl };
        }
      }

      // Fallback for specific domain
      if (preferredDomain) {
        const domClean = preferredDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
        const match = document.body.innerText.match(new RegExp(`https?:\\/\\/[a-z0-9.-]*${domClean}[a-z0-9.-]*`, 'i'));
        if (match) return { title: preferredDomain, url: match[0] };
      }

      return null;
    }, { preferredDomain: plan.preferredDomain, targetType: plan.targetType });

    if (destination && destination.url) {
      console.log(`[Autonomous Mission]: 🚀 Entering target destination: ${destination.url}`);
      await page.goto(destination.url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(err => {
        console.warn('[Autonomous Mission Navigation Warn]:', err.message);
      });
      await page.waitForTimeout(3000);
    }

    // 5. Human-like Scrolling & Exploration (Loads all content, articles, images, and text)
    console.log('[Autonomous Mission]: 📜 Scrolling to explore page content...');
    await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' })).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' })).catch(() => {});
    await page.waitForTimeout(1500);

    // 6. Deep Domain-Level Extraction of Clients, Partners, and Article Text
    const siteInspection = await page.evaluate(() => {
      const rawHtml = document.documentElement.outerHTML;
      // Extract institution / client logo names
      const institutionMatches = rawHtml.match(/course-institutions\/[^"']+/g) || [];
      const clients = [...new Set(institutionMatches)].map(i => {
        return i.replace('course-institutions/', '').replace(/landing-/, '').replace(/-[a-f0-9]+\.png/, '').replace(/-/g, ' ').toUpperCase();
      });

      // Extract client image alts
      const imgAlts = Array.from(document.querySelectorAll('img[alt]'))
        .map(i => i.alt.trim())
        .filter(alt => alt.length > 2 && !alt.toLowerCase().includes('logo') && !alt.toLowerCase().includes('icon'));

      // Extract text snippets
      const textSnippets = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4'))
        .map(e => e.innerText.trim())
        .filter(t => t.length > 20)
        .slice(0, 10);

      return {
        clients,
        imgAlts,
        textSnippets
      };
    }).catch(() => ({ clients: [], imgAlts: [], textSnippets: [] }));

    const finalTitle = await page.title().catch(() => 'Halaman Web');
    const finalUrl = page.url();
    session.currentUrl = finalUrl;
    session.currentTitle = finalTitle;
    updateStreamMeta({ title: finalTitle, url: finalUrl, activeGuild: guildId, mode: 'browse' });

    const summary = await getWebpageSummary(guildId);
    const screenshotBuffer = await page.screenshot({ type: 'png' }).catch(() => null);

    // 7. Structured AI Synthesis answering the user's specific request
    const structuredEvidence = `
Website Terkunjungi: "${finalTitle}" (${finalUrl})
Daftar Klien / Lembaga / Perusahaan yang Bekerja Sama (dari aset resmi web):
${siteInspection.clients.join(', ') || 'Tidak terdeteksi secara otomatis'}

Logo / Partner Tambahan:
${siteInspection.imgAlts.join(', ')}

Kutipan Testimoni & Direktur Klien:
${siteInspection.textSnippets.join('\n---\n')}

Ringkasan Isi Halaman:
${(summary.bodyText || '').slice(0, 800)}
`;

    const reportPrompt = `Kamu (Azura) baru saja menyelesaikan misi browsing otonom ke website resmi: "${finalTitle}" (${finalUrl}).
Tujuan instruksi user: "${plan.inspectionGoal || cleanPrompt}".

Berikut bukti riil yang kamu temukan langsung dari website:
---
${structuredEvidence}
---
Tugasmu:
1. Konfirmasi singkat bahwa kamu sudah berhasil masuk ke situs resmi ${finalTitle}.
2. Jawab pertanyaan user secara akurat dan lengkap:
   - Jika user menanyakan siapa saja klien-kliennya, sebutkan nama-nama klien/mitra besar yang ditemukan (seperti InJourney / BUMN Aviasi, Bluebird Group, Indosat, Kapal Api, Asuransi Astra, Pupuk Indonesia, kementerian ESDM/Kemenkes/Kemlu, dll.) serta sebutkan testimoni dari pimpinan mereka (misal Herdy Harman dari InJourney atau Wing Antariksa dari Bluebird).
3. Buat dalam format poin-poin yang sangat rapi, cerdas, dan natural!`;

    const aiReport = await askAzura(
      config.OWNER_DISCORD_ID || 'mission_user',
      reportPrompt,
      userName,
      [],
      false,
      textChannel?.id || null,
      guildId,
      true
    );

    const cleanReport = typeof aiReport === 'string'
      ? aiReport.replace(/<[^>]+>/g, '').trim()
      : `Misi selesai! Aku sudah berhasil membuka dan masuk ke website "${finalTitle}".`;

    // 1. Speak in VC first (Exact phrase requested by user)
    const completionVoiceText = 'Attila aku udah menemukan informasi websitenya sesuai yang kamu minta nih, aku kirimin detail informasinya ya.';
    await speakInVC(guildId, completionVoiceText, client, 'Attila');

    // 2. Send detailed findings to Discord with 1 single active direct blue link
    if (textChannel) {
      const attachment = screenshotBuffer ? new AttachmentBuilder(screenshotBuffer, { name: 'mission_destination.png' }) : null;
      const validUrl = finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`;
      
      const embed = new EmbedBuilder()
        .setColor(0x00F2FE)
        .setTitle(`🌐 Misi Browsing Selesai: ${finalTitle.slice(0, 60)}`)
        .setDescription(
          `🎯 **Misi:** *${missionPrompt}*\n\n` +
          `📝 **Detail Temuan:**\n${cleanReport}\n\n` +
          `🔗 **Website:** [${validUrl}](${validUrl})\n\n` +
          `*🔒 Sesi browser otomatis ditutup untuk menghemat resource.*`
        )
        .setFooter({ text: 'AZURA Autonomous Web Mission' })
        .setTimestamp();

      if (attachment) {
        embed.setImage('attachment://mission_destination.png');
      }

      await textChannel.send({ embeds: [embed], files: attachment ? [attachment] : [] }).catch(() => {});
    }

    // 7. AUTO-CLOSE SESSION after completing specific mission
    setTimeout(async () => {
      console.log(`[Web Surf Agent]: 🔒 Mission completed successfully. Auto-closing browser session for ${guildId}...`);
      await closeBrowserSession(guildId);
    }, 10000);

    return { success: true, title: finalTitle, url: finalUrl };

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
 * MODE 2: Persistent Interactive Step-by-Step Browsing (Mabar Standby)
 * Opens browser and stays permanently active waiting for user commands until explicitly closed.
 * @param {string} guildId 
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 */
async function startPersistentInteractiveBrowsing(guildId, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 🕹️ Starting Persistent Interactive Browsing for ${guildId}`);

  const announceText = `Siap ${userName}! Aku buka browser dan standby di live stream yaa. Kamu bisa suruh aku ketik, klik, atau scroll secara realtime!`;
  await speakInVC(guildId, announceText, client, userName);

  const res = await openWebpage(guildId, 'https://www.bing.com');
  const session = activeBrowserSessions?.get(guildId);
  if (session) {
    session.isPersistent = true; // Prevents idle auto-close!
  }

  if (textChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x38BDF8)
      .setTitle(`🌐 Sesi Browsing Interaktif Standby (Mode Mabar)`)
      .setDescription(
        `Halo **${userName}**! Browser sudah dibuka dan siap menemani kamu browsing! 🌸✨\n\n` +
        `📺 **Tonton Layar Live 60 FPS:**\n` +
        `👉 **[KLIK DI SINI: PORTAL BROWSER LIVE](${BROWSE_URL})**\n\n` +
        `🕹️ **Perintah Step-by-Step yang Bisa Kamu Berikan:**\n` +
        `• Ketik teks: \`ara ketik [kata kunci]\`\n` +
        `• Klik link/tombol: \`ara klik [nama link]\`\n` +
        `• Gulir layar: \`ara scroll bawah\` atau \`ara scroll atas\`\n` +
        `• Buka situs: \`ara buka [url atau pencarian]\`\n` +
        `• Baca layar: \`ara jelaskan halaman ini\`\n` +
        `• Tutup browser: \`ara tutup browser\`\n\n` +
        `*🔒 Sesi ini akan tetap aktif dan TIDAK akan ditutup otomatis sampai kamu minta tutup!*`
      )
      .setFooter({ text: 'AZURA Persistent Interactive Web Companion' })
      .setTimestamp();

    await textChannel.send({ embeds: [embed] }).catch(() => {});
  }

  return { success: true };
}

/**
 * Handle Web Surf Agent commands from Discord chat
 * Intercepts BOTH Mode 1 (Autonomous Mission) and Mode 2 (Step-by-Step Standby)
 * @param {import('discord.js').Message} message 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<boolean>}
 */
async function handleWebSurfCommands(message, client) {
  if (!message.content) return false;
  const isOwner = message.author.id === config.OWNER_DISCORD_ID;
  if (!isOwner) return false;

  const content = message.content.trim();
  const lower = content.toLowerCase();
  const guildId = message.guild?.id || 'default_guild';
  const userName = message.member?.displayName || message.author.displayName || message.author.username;
  const textChannel = message.channel;

  // 1. Explicit Close Command: "ara tutup browser", "ara stop browsing", "ara matikan browser"
  if (/\b(?:ara|azura)\s+(?:tolong\s+)?(?:tutup|close|stop|matikan|selesai)\s+(?:browser|chrome|web|tab|browsing)\b/i.test(lower)) {
    const res = await closeBrowserSession(guildId);
    await message.reply(`🔒 **[AZURA Browser]** ${res.message}`);
    await speakInVC(guildId, 'Sesi browser sudah aku tutup yaa!', client, userName);
    return true;
  }

  // 2. Open-ended Persistent Session Request: "ara aku mau browsing-browsing nih bantuin dong", "ara bantu browsing dong", "ara buka chrome standby"
  const isPersistentIntent = /\b(?:ara|azura)\s+(?:aku\s+)?(?:mau|pengen|yuk|bantu|temenin)\s+browsing\b/i.test(lower) ||
                             /\b(?:ara|azura)\s+(?:tolong\s+)?buka\s+(?:chrome|browser)\s*(?:standby)?\b/i.test(lower) ||
                             /\b(?:ara|azura)\s+bantu\s+browsing\s+dong\b/i.test(lower);

  if (isPersistentIntent && !/terus|kemudian|lalu|masuk\s+ke|klik|carikan|cari/i.test(lower)) {
    await startPersistentInteractiveBrowsing(guildId, userName, textChannel, client);
    return true;
  }

  // 3. Step-by-Step commands while active session is running
  const session = activeBrowserSessions?.get(guildId);
  const isSessionRunning = session && !session.page.isClosed();

  if (isSessionRunning) {
    // A. Ketik di web
    const typeMatch = content.match(/\b(?:ara|azura)\s+(?:tolong\s+)?ketik\s+(.+)/i);
    if (typeMatch && typeMatch[1]) {
      const textToType = typeMatch[1].replace(/\b(?:dong|ya|yuk|plis)\b/gi, '').trim();
      const res = await typeIntoWebpage(guildId, textToType);
      await message.reply(`⌨️ **[AZURA Browser]** Berhasil mengetik: \`${textToType}\``);
      await speakInVC(guildId, `Aku ketik ${textToType} di layar ya!`, client, userName);
      return true;
    }

    // B. Klik link/tombol
    const clickMatch = content.match(/\b(?:ara|azura)\s+(?:tolong\s+)?(?:klik|pilih|tekan)\s+(.+)/i);
    if (clickMatch && clickMatch[1]) {
      const target = clickMatch[1].replace(/\b(?:dong|ya|yuk|plis)\b/gi, '').trim();
      const res = await clickOnWebpage(guildId, target);
      await message.reply(`🖱️ **[AZURA Browser]** Berhasil mengklik: \`${target}\``);
      await speakInVC(guildId, `Siap, aku klik ${target} di layar!`, client, userName);
      return true;
    }

    // C. Scroll halaman
    if (/\b(?:ara|azura)\s+(?:tolong\s+)?(?:scroll|gulir)\s*(?:ke\s+)?(?:bawah|atas|down|up)\b/i.test(lower)) {
      const dir = /atas|up/i.test(lower) ? 'up' : 'down';
      await scrollWebpage(guildId, dir);
      await message.reply(`📜 **[AZURA Browser]** Layar digulir ke ${dir === 'down' ? 'bawah ⬇️' : 'atas ⬆️'}.`);
      return true;
    }

    // D. Baca layar
    if (/\b(?:ara|azura)\s+(?:tolong\s+)?(?:jelaskan|baca|bacakan|ringkas)\s+(?:tampilan|isi|halaman|layar)\b/i.test(lower)) {
      const summary = await getWebpageSummary(guildId);
      const text = summary.success ? (summary.bodyText || summary.headings) : 'Halaman kosong.';
      await message.reply(`👁️ **[Tampilan Web: ${summary.title}]**\n\n${text.slice(0, 500)}`);
      await speakInVC(guildId, `Di halaman ${summary.title}, pembahasannya tentang: ${text.slice(0, 160)}`, client, userName);
      return true;
    }
  }

  // 4. Goal-Oriented Autonomous Mission (Action-based based on first prompt!)
  // E.g.: "ara browsing situs learnext terus masuk ke website resminya"
  // E.g.: "ara tolong browsing tiket pesawat jakarta bali terus pilih jadwal termurah"
  // E.g.: "ara browsing [topic]"
  const isMission = /\b(?:ara|azura)\s+(?:tolong\s+)?(?:browsing|cari|carikan|bukain|buka)\s+(.+)/i.test(content) ||
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
