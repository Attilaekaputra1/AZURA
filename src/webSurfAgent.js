/**
 * AZURA Web Surf Agent — Live Research, Autonomous Task Execution, & Interactive Screen Share
 * 
 * Capabilities:
 * 1. 📺 Live Web Surfing & Research with voice narration in Discord VC
 * 2. 🤖 Autonomous Task Execution: form filling, checkout, dashboard monitoring, PDF download
 * 3. 🛡️ Runs 100% on VPS headless Chromium — no VT-x, no emulator, no GPU needed
 * 
 * All visual output streams to http://203.175.10.163:7860/live in real-time 60fps.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getBrowser, getWebpageSummary, openWebpage, scrollWebpage, clickOnWebpage, typeIntoWebpage, closeBrowserSession, sendVisualSnapshotCard } = require('./headlessBrowser');
const { broadcastFrame, updateStreamMeta, STREAM_URL } = require('./livePortal');
const config = require('./config');

// ─── Active Research Sessions ───
const activeResearchSessions = new Map(); // guildId -> { topic, steps[], channel, userName, client }

/**
 * Smart Research Agent: Opens browser, searches, reads pages, and narrates findings live in VC
 * @param {string} guildId 
 * @param {string} researchQuery - Natural language research request
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<{ success: boolean, summary: string }>}
 */
async function performLiveResearch(guildId, researchQuery, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 🔍 Starting live research for "${researchQuery}" (Guild: ${guildId})`);

  const session = {
    topic: researchQuery,
    steps: [],
    channel: textChannel,
    userName,
    client,
    startedAt: Date.now()
  };
  activeResearchSessions.set(guildId, session);

  try {
    // Step 1: Announce in VC
    const announceText = `Siap ${userName}! Aku mulai riset tentang "${researchQuery}" di browser sekarang ya. Kamu bisa pantau layarnya secara live di portal web!`;
    await speakInVC(guildId, announceText, client, userName);

    // Step 2: Open search engine with the query
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(researchQuery)}`;
    const searchResult = await openWebpage(guildId, searchUrl);

    if (!searchResult.success) {
      const errMsg = `Maaf ${userName}, gagal membuka halaman pencarian: ${searchResult.error}`;
      await speakInVC(guildId, errMsg, client, userName);
      return { success: false, summary: errMsg };
    }

    session.steps.push({ action: 'search', url: searchUrl, title: searchResult.title });

    // Step 3: Wait for results to render
    await new Promise(r => setTimeout(r, 1500));

    // Step 4: Read search results page
    const pageSummary = await getWebpageSummary(guildId);
    let findings = '';
    if (pageSummary.success) {
      findings = pageSummary.bodyText || pageSummary.headings || '';
    }

    // Step 5: Try to click on the first relevant result for deeper reading
    const deepResult = await clickOnWebpage(guildId, researchQuery.split(' ')[0]);
    await new Promise(r => setTimeout(r, 2000));

    const deepSummary = await getWebpageSummary(guildId);
    let deepFindings = '';
    if (deepSummary.success) {
      deepFindings = deepSummary.bodyText || deepSummary.headings || '';
      session.steps.push({ action: 'deep_read', url: deepSummary.url, title: deepSummary.title });
    }

    // Step 6: Compose intelligent summary using Azura's brain
    const combinedContent = `${findings}\n\n${deepFindings}`.slice(0, 3000);
    const { askAzura } = require('./azura');
    const aiSummary = await askAzura(
      config.OWNER_DISCORD_ID || 'research_user',
      `Kamu baru saja melakukan riset di browser tentang: "${researchQuery}".
Berikut isi konten yang kamu temukan di halaman web:
---
${combinedContent}
---
Buatlah ringkasan temuan riset ini untuk ${userName} secara natural, informatif, dan ringkas.
Sertakan poin-poin penting, harga jika ada, dan rekomendasi kalau relevan.
Jawab sebagai Azura yang cerdas dan helpful, jangan terlalu panjang — max 3-4 paragraf.`,
      userName,
      [],
      false,
      textChannel?.id || null,
      guildId,
      true
    );

    const cleanSummary = typeof aiSummary === 'string'
      ? aiSummary.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/[*_~`#>]/g, '').trim()
      : (aiSummary?.content || 'Maaf, aku tidak berhasil merangkum temuannya.');

    // Step 7: Narrate findings in Discord VC
    const narrationText = cleanSummary.length > 600 ? cleanSummary.slice(0, 600) : cleanSummary;
    await speakInVC(guildId, narrationText, client, userName);

    // Step 8: Post recap card in text channel
    if (textChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`🔍 Hasil Riset: "${researchQuery}"`)
        .setDescription(cleanSummary.slice(0, 2000))
        .addFields(
          { name: '📊 Sumber Ditelusuri', value: `\`${session.steps.length} halaman web\``, inline: true },
          { name: '⏱️ Durasi Riset', value: `\`${Math.round((Date.now() - session.startedAt) / 1000)} detik\``, inline: true },
          { name: '📺 Live Stream', value: `[Tonton Live](${STREAM_URL})`, inline: true }
        )
        .setFooter({ text: `AZURA Web Surf Agent • Riset untuk ${userName}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('📺 Lihat Layar Browser Live')
          .setStyle(ButtonStyle.Link)
          .setURL(STREAM_URL)
      );

      await textChannel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }

    activeResearchSessions.delete(guildId);
    return { success: true, summary: cleanSummary };

  } catch (err) {
    console.error('[Web Surf Agent Research Error]:', err.message);
    activeResearchSessions.delete(guildId);
    const errMsg = `Terjadi kendala saat riset: ${err.message}`;
    await speakInVC(guildId, errMsg, client, userName);
    return { success: false, summary: errMsg };
  }
}

/**
 * Autonomous Task Execution: Fill forms, login, download reports, monitor dashboards
 * @param {string} guildId 
 * @param {string} taskDescription - Natural language task instruction
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<{ success: boolean, report: string }>}
 */
async function executeAutonomousWebTask(guildId, taskDescription, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 🤖 Autonomous task: "${taskDescription}" (Guild: ${guildId})`);

  try {
    // Step 1: Announce in VC
    const announceText = `Oke ${userName}, aku mulai mengerjakan tugas "${taskDescription}" di browser secara otomatis. Kamu bisa pantau progresnya di portal live!`;
    await speakInVC(guildId, announceText, client, userName);

    // Step 2: Ask AI brain to decompose the task into browser action steps
    const { askAzura } = require('./azura');
    const planResponse = await askAzura(
      config.OWNER_DISCORD_ID || 'task_user',
      `Kamu adalah Azura, AI browser automation agent. User "${userName}" meminta kamu melakukan tugas berikut di browser:
"${taskDescription}"

Buat daftar langkah-langkah browser automation yang perlu dilakukan, dalam format JSON array:
[
  {"action": "navigate", "url": "https://..."},
  {"action": "type", "selector": "input[name='search']", "value": "text to type"},
  {"action": "click", "target": "Submit"},
  {"action": "scroll", "direction": "down"},
  {"action": "wait", "ms": 2000},
  {"action": "screenshot"},
  {"action": "read_page"}
]

HANYA kembalikan JSON array saja tanpa penjelasan lain. Jika tugas tidak bisa dilakukan secara aman (misalnya butuh password/data sensitif yang tidak tersedia), kembalikan:
[{"action": "report", "message": "Penjelasan kenapa tidak bisa dilakukan"}]`,
      userName,
      [],
      false,
      textChannel?.id || null,
      guildId,
      true
    );

    let steps = [];
    const rawPlan = typeof planResponse === 'string' ? planResponse : (planResponse?.content || '[]');

    // Extract JSON from AI response
    const jsonMatch = rawPlan.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        steps = JSON.parse(jsonMatch[0]);
      } catch (_) {
        steps = [{ action: 'report', message: 'Gagal memproses rencana tugas otomatis.' }];
      }
    }

    if (!steps.length) {
      steps = [{ action: 'report', message: 'Tidak ada langkah yang bisa dieksekusi untuk tugas ini.' }];
    }

    // Step 3: Execute each browser action step
    const executionLog = [];
    for (const step of steps) {
      try {
        switch (step.action) {
          case 'navigate': {
            const res = await openWebpage(guildId, step.url);
            executionLog.push(`🌐 Buka: ${step.url} → ${res.success ? 'OK' : res.error}`);
            await new Promise(r => setTimeout(r, 1500));
            break;
          }
          case 'type': {
            const res = await typeIntoWebpage(guildId, step.value || step.text || '');
            executionLog.push(`⌨️ Ketik: "${step.value}" → ${res.success ? 'OK' : res.error}`);
            await new Promise(r => setTimeout(r, 1000));
            break;
          }
          case 'click': {
            const res = await clickOnWebpage(guildId, step.target || step.selector || '');
            executionLog.push(`🖱️ Klik: "${step.target}" → ${res.success ? 'OK' : res.error}`);
            await new Promise(r => setTimeout(r, 1500));
            break;
          }
          case 'scroll': {
            const res = await scrollWebpage(guildId, step.direction || 'down');
            executionLog.push(`📜 Scroll: ${step.direction || 'down'} → ${res.success ? 'OK' : res.error}`);
            await new Promise(r => setTimeout(r, 800));
            break;
          }
          case 'wait': {
            await new Promise(r => setTimeout(r, step.ms || 2000));
            executionLog.push(`⏳ Tunggu: ${step.ms || 2000}ms`);
            break;
          }
          case 'screenshot': {
            executionLog.push('📸 Screenshot diambil (visible on live stream)');
            break;
          }
          case 'read_page': {
            const summary = await getWebpageSummary(guildId);
            if (summary.success) {
              executionLog.push(`📖 Baca: "${summary.title}" — ${(summary.bodyText || '').slice(0, 100)}...`);
            }
            break;
          }
          case 'report': {
            executionLog.push(`📋 Laporan: ${step.message}`);
            break;
          }
          default:
            executionLog.push(`❓ Langkah tidak dikenal: ${step.action}`);
        }
      } catch (stepErr) {
        executionLog.push(`❌ Error pada langkah "${step.action}": ${stepErr.message}`);
      }
    }

    // Step 4: Generate final report
    const reportText = executionLog.join('\n');
    const shortReport = reportText.length > 500 ? reportText.slice(0, 500) + '...' : reportText;

    // Step 5: Narrate completion in VC
    const completionVoice = `Tugas "${taskDescription}" sudah selesai aku kerjakan ${userName}! Total ${executionLog.length} langkah browser dieksekusi.`;
    await speakInVC(guildId, completionVoice, client, userName);

    // Step 6: Post report card to Discord text channel
    if (textChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`🤖 Laporan Tugas Otomatis Selesai`)
        .setDescription(
          `**Tugas:** ${taskDescription}\n` +
          `**Oleh:** Azura untuk ${userName}\n\n` +
          `**Eksekusi Log:**\n\`\`\`\n${shortReport}\n\`\`\``
        )
        .addFields(
          { name: '📊 Total Langkah', value: `\`${executionLog.length}\``, inline: true },
          { name: '📺 Live Stream', value: `[Tonton](${STREAM_URL})`, inline: true }
        )
        .setFooter({ text: 'AZURA Autonomous Task Agent' })
        .setTimestamp();

      await textChannel.send({ embeds: [embed] }).catch(() => {});
    }

    return { success: true, report: reportText };

  } catch (err) {
    console.error('[Web Surf Agent Task Error]:', err.message);
    const errMsg = `Terjadi kendala saat mengerjakan tugas: ${err.message}`;
    await speakInVC(guildId, errMsg, client, userName);
    return { success: false, report: errMsg };
  }
}

/**
 * Dashboard Monitoring: Navigate to a dashboard URL, take a screenshot, read metrics, report to Discord
 * @param {string} guildId 
 * @param {string} dashboardUrl 
 * @param {string} userName 
 * @param {import('discord.js').TextChannel} textChannel 
 * @param {import('discord.js').Client} client 
 */
async function monitorDashboard(guildId, dashboardUrl, userName, textChannel, client) {
  console.log(`[Web Surf Agent]: 📊 Dashboard monitoring: ${dashboardUrl}`);

  try {
    const announceText = `Oke ${userName}, aku buka dashboard-nya sekarang dan laporkan isinya ya!`;
    await speakInVC(guildId, announceText, client, userName);

    const navResult = await openWebpage(guildId, dashboardUrl);
    if (!navResult.success) {
      const errMsg = `Gagal membuka dashboard: ${navResult.error}`;
      await speakInVC(guildId, errMsg, client, userName);
      return { success: false, report: errMsg };
    }

    // Wait for dashboard to fully render
    await new Promise(r => setTimeout(r, 3000));

    // Read page content
    const summary = await getWebpageSummary(guildId);
    let reportContent = 'Tidak ada data yang terbaca dari dashboard.';
    if (summary.success) {
      reportContent = `${summary.title}\n${summary.headings}\n${summary.bodyText}`.slice(0, 2000);
    }

    // Generate AI analysis of dashboard data
    const { askAzura } = require('./azura');
    const aiAnalysis = await askAzura(
      config.OWNER_DISCORD_ID || 'dashboard_user',
      `Kamu baru saja membuka dashboard web "${dashboardUrl}" dan menemukan data berikut:
---
${reportContent}
---
Buatlah ringkasan metrik dan informasi penting dari dashboard ini untuk ${userName}. 
Jelaskan angka-angka kunci, status, dan insight yang bisa diambil secara ringkas dan jelas.`,
      userName,
      [],
      false,
      textChannel?.id || null,
      guildId,
      true
    );

    const cleanAnalysis = typeof aiAnalysis === 'string'
      ? aiAnalysis.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/[*_~`#>]/g, '').trim()
      : (aiAnalysis?.content || reportContent);

    // Narrate findings
    const narration = cleanAnalysis.length > 500 ? cleanAnalysis.slice(0, 500) : cleanAnalysis;
    await speakInVC(guildId, narration, client, userName);

    // Post to Discord
    if (textChannel && navResult.screenshot) {
      const attachment = new AttachmentBuilder(navResult.screenshot, { name: 'dashboard_snapshot.png' });
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`📊 Laporan Dashboard Monitoring`)
        .setDescription(cleanAnalysis.slice(0, 2000))
        .setImage('attachment://dashboard_snapshot.png')
        .addFields(
          { name: '🔗 URL', value: `\`${dashboardUrl}\``, inline: false },
          { name: '📺 Live Stream', value: `[Tonton](${STREAM_URL})`, inline: true }
        )
        .setFooter({ text: `AZURA Dashboard Monitor • Untuk ${userName}` })
        .setTimestamp();

      await textChannel.send({ embeds: [embed], files: [attachment] }).catch(() => {});
    }

    return { success: true, report: cleanAnalysis };

  } catch (err) {
    console.error('[Web Surf Agent Dashboard Error]:', err.message);
    return { success: false, report: err.message };
  }
}

/**
 * Handle text-based web surf agent commands from Discord chat
 * @param {import('discord.js').Message} message 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<boolean>}
 */
async function handleWebSurfCommands(message, client) {
  if (!message.content) return false;
  const isOwner = message.author.id === config.OWNER_DISCORD_ID;
  if (!isOwner) return false;

  const content = message.content.trim();
  const lower = content.toLowerCase()
    .replace(/<@!?\d+>/g, '')
    .replace(/[.,!?;:'"()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const guildId = message.guild?.id || 'default_guild';
  const userName = message.member?.displayName || message.author.displayName || message.author.username;
  const textChannel = message.channel;

  // 1. Live Research: "ara carikan tiket pesawat termurah", "ara riset berita X", "ara tolong cari info tentang Y"
  const researchMatch = content.match(/\b(?:ara|azura)\s+(?:tolong\s+)?(?:carikan|cari(?:n|kan)?|riset|telusuri|investigasi|research|analisis)\s+(.+)/i);
  if (researchMatch && researchMatch[1]) {
    const query = researchMatch[1]
      .replace(/\b(?:dong|ya|yuk|plis|please|di\s+web|di\s+internet|di\s+browser)?\b/gi, '')
      .trim();
    if (query.length > 3) {
      await message.reply(`🔍 **[AZURA Web Research]** Memulai riset: **"${query}"**...\nPantau live di: 👉 ${STREAM_URL}`);
      await performLiveResearch(guildId, query, userName, textChannel, client);
      return true;
    }
  }

  // 2. Autonomous Task: "ara tolong isi form di web X", "ara booking tiket di Y", "ara checkout barang di Z"
  const taskMatch = content.match(/\b(?:ara|azura)\s+(?:tolong\s+)?(?:isi\s+form|booking|pesan|checkout|order|daftar|login|masuk\s+ke|unduh\s+laporan|download\s+report|monitor|pantau)\s+(.+)/i);
  if (taskMatch && taskMatch[1]) {
    const task = taskMatch[1]
      .replace(/\b(?:dong|ya|yuk|plis|please)?\b/gi, '')
      .trim();
    if (task.length > 3) {
      await message.reply(`🤖 **[AZURA Task Agent]** Memulai tugas otomatis: **"${task}"**...\nPantau live di: 👉 ${STREAM_URL}`);
      await executeAutonomousWebTask(guildId, task, userName, textChannel, client);
      return true;
    }
  }

  // 3. Dashboard Monitoring: "ara cek dashboard X", "ara buka monitor Y", "ara pantau analitik Z"
  const dashMatch = content.match(/\b(?:ara|azura)\s+(?:tolong\s+)?(?:cek|buka|pantau|monitor)\s+(?:dashboard|analitik|analytics|statistik)\s+(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/i);
  if (dashMatch && dashMatch[1]) {
    const dashUrl = dashMatch[1].startsWith('http') ? dashMatch[1] : `https://${dashMatch[1]}`;
    await message.reply(`📊 **[AZURA Dashboard Monitor]** Membuka dashboard: \`${dashUrl}\`...\nPantau live di: 👉 ${STREAM_URL}`);
    await monitorDashboard(guildId, dashUrl, userName, textChannel, client);
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
  performLiveResearch,
  executeAutonomousWebTask,
  monitorDashboard,
  handleWebSurfCommands
};
