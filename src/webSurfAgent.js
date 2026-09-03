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
  console.log(`[Web Surf Agent]: 🚀 Executing Autonomous Mission: "${missionPrompt}" for ${userName}`);

  const announceText = `Siap ${userName}! Aku jalankan misi di browser: "${missionPrompt}". Pantau layarnya di live stream ya!`;
  await speakInVC(guildId, announceText, client, userName);

  const session = await getOrCreateSession(guildId);
  const { page } = session;

  try {
    const cleanPrompt = missionPrompt
      .replace(/<@!?\d+>/g, '')
      .replace(/\b(?:ara|azura|tolong|coba|dong|ya|yuk|plis)\b/gi, '')
      .trim();

    updateStreamMeta({
      title: '🌐 AZURA: ' + cleanPrompt.slice(0, 30),
      url: 'https://www.bing.com',
      activeGuild: guildId,
      mode: 'browse'
    });

    // Smart heuristic baseline: extracts the core target (e.g. "learnext")
    const targetBrand = cleanPrompt
      .replace(/\b(?:browsing|buka|situs|web|website|resminya|resmi|terus|lalu|kemudian|masuk\s+ke|dan|tolong|cari|carikan)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let plan = {
      searchQuery: targetBrand ? `${targetBrand} official website` : cleanPrompt,
      clickKeyword: targetBrand.split(' ')[0] || cleanPrompt.split(' ')[0] || ''
    };

    // AI Action Decomposition refinement

    try {
      const rawPlan = await askAzura(
        config.OWNER_DISCORD_ID || 'planner_user',
        plannerPrompt,
        userName,
        [],
        false,
        textChannel?.id || null,
        guildId,
        true
      );
      const planText = typeof rawPlan === 'string' ? rawPlan : (rawPlan?.content || '');
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.searchQuery) plan.searchQuery = parsed.searchQuery;
        if (parsed.clickKeyword) plan.clickKeyword = parsed.clickKeyword;
      }
    } catch (_) {}

    // 1. Open Search Engine (Yahoo: zero-captcha, reliable on datacenter IPs)
    console.log(`[Autonomous Mission]: 🔍 Navigating to Yahoo search with query: "${plan.searchQuery}"`);
    await page.goto('https://search.yahoo.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);

    // 2. Visible On-Screen Typing (Human-like)
    const searchInput = await page.waitForSelector('input[name="p"], #yschsp, input[type="text"]', { timeout: 8000 }).catch(() => null);
    if (searchInput) {
      await searchInput.click();
      await page.waitForTimeout(200);
      await page.keyboard.type(plan.searchQuery, { delay: 45 });
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    } else {
      await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(plan.searchQuery)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);
    }

    // 3. Scroll Search Results
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' })).catch(() => {});
    await page.waitForTimeout(1200);

    // 4. Click Destination Official Website Link
    const kw = (plan.clickKeyword || plan.searchQuery.split(' ')[0] || '').toLowerCase();
    console.log(`[Autonomous Mission]: 🖱️ Locating official website link matching: "${kw}"`);

    const linkTarget = await page.evaluate((targetKw) => {
      const all = Array.from(document.querySelectorAll('a'));
      for (const a of all) {
        const href = (a.href || '').toLowerCase();
        const txt = (a.innerText || '').toLowerCase();
        if (href.includes('yahoo.com') || href.includes('search.yahoo') || href.includes('javascript') || !href.startsWith('http')) continue;
        if (!targetKw || txt.includes(targetKw) || href.includes(targetKw)) {
          return { text: a.innerText.trim() || href, href: a.href };
        }
      }
      for (const a of all) {
        const href = (a.href || '').toLowerCase();
        if (!href.includes('yahoo.com') && href.startsWith('http')) {
          return { text: a.innerText.trim() || href, href: a.href };
        }
      }
      return null;
    }, kw);

    if (linkTarget && linkTarget.href) {
      console.log(`[Autonomous Mission]: ✅ Entering official website: "${linkTarget.text}" (${linkTarget.href})`);
      await page.goto(linkTarget.href, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(3000);
      // Smooth scroll the official website so viewers see the actual page content
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' })).catch(() => {});
      await page.waitForTimeout(1500);
    }

    // 5. Final State & Screenshot
    const finalTitle = await page.title().catch(() => 'Halaman Web');
    const finalUrl = page.url();
    session.currentUrl = finalUrl;
    session.currentTitle = finalTitle;
    updateStreamMeta({ title: finalTitle, url: finalUrl, activeGuild: guildId, mode: 'browse' });

    const summary = await getWebpageSummary(guildId);
    const screenshotBuffer = await page.screenshot({ type: 'png' }).catch(() => null);

    // 6. Crisp AI Report (1-2 sentences)
    const reportPrompt = `Kamu (Azura) baru saja menyelesaikan misi browsing otonom: "${missionPrompt}".
Saat ini kamu sudah berhasil membuka dan masuk ke website: "${finalTitle}" (${finalUrl}).
Konten halaman: ${(summary.bodyText || '').slice(0, 500)}
Berikan laporan singkat (maksimal 2 kalimat saja) untuk ${userName} bahwa kamu sudah berhasil masuk dan jelaskan intinya secara ceria!`;

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
      ? aiReport.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/[*_~`#>]/g, '').trim()
      : `Misi selesai! Aku sudah berhasil membuka dan masuk ke website "${finalTitle}".`;

    // Speak in VC (if connected)
    await speakInVC(guildId, cleanReport.slice(0, 180), client, userName);

    // Send Discord embed with screenshot
    if (textChannel) {
      const attachment = screenshotBuffer ? new AttachmentBuilder(screenshotBuffer, { name: 'mission_destination.png' }) : null;
      const embed = new EmbedBuilder()
        .setColor(0x00F2FE)
        .setTitle(`🌐 Misi Browsing Selesai: "${finalTitle.slice(0, 60)}"`)
        .setURL(finalUrl.startsWith('http') ? finalUrl : 'https://www.bing.com')
        .setDescription(
          `🎯 **Misi:** *${missionPrompt}*\n\n` +
          `📝 **Laporan Singkat:**\n${cleanReport}\n\n` +
          `🔗 **URL Website:** \`${finalUrl.slice(0, 100)}\`\n\n` +
          `*🔒 Karena misi spesifik sudah selesai, sesi browser otomatis ditutup untuk menghemat resource.*`
        )
        .setFooter({ text: `AZURA Autonomous Web Mission • ${userName}` })
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
    await message.reply(`🌐 **[AZURA Autonomous Mission]** Memulai misi browsing: *"${content}"*...\nPantau langsung di: 👉 ${BROWSE_URL}`);
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
