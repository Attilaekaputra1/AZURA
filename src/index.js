const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const budgetGuard = require('./budget');
const { askAzura } = require('./azura');
const { generateVoiceNote } = require('./tts');
const { registerSlashCommands, handleSlashCommand } = require('./commands');
const { initReminderChecker } = require('./reminder');
const { handleOwnerMentionTracking } = require('./autoReply');
const { handleVoiceStateUpdate } = require('./voiceCompanion');
const { initAutonomousCatalyst, recordChannelActivity } = require('./autonomous');

// Validate configuration before start
const missingKeys = config.validate();
if (missingKeys.length > 0 && process.env.NODE_ENV !== 'test') {
  console.log('\n==================================================');
  console.log('⚠️  PERINGATAN CONFIGURATION:');
  console.log(`Variabel environment berikut belum diisi di file .env:`);
  missingKeys.forEach(k => console.log(` - ${k}`));
  console.log('Silakan buka file .env lalu masukkan kredensial kamu.');
  console.log('==================================================\n');
}

// Create Discord client with minimal necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});



// Event: Client Ready
client.once(Events.ClientReady, async () => {
  console.log('\n==================================================');
  console.log(`🤖 AZURA Online!`);
  console.log(`• Username : ${client.user.tag}`);
  console.log(`• AI Model : ${config.OPENAI_MODEL}`);
  console.log(`• Budget   : $${config.MONTHLY_BUDGET_TARGET}/bulan`);
  console.log(`• Features : Vision 📸 | VoiceNote 🎙️ | Search 🌐 | Img2Img 🎨 | Autonomous 🔥`);
  console.log('==================================================\n');

  // Register slash commands
  await registerSlashCommands(client);

  // Initialize reminder background checker
  initReminderChecker(client);
  console.log('[AZURA]: Reminder checker aktif (interval 15 detik).');

  // Initialize scheduled DM & Daily Digest background checkers
  const { checkScheduledDms } = require('./ownerDm');
  const { checkDailyDigest } = require('./digest');
  setInterval(() => {
    checkScheduledDms(client);
    checkDailyDigest(client);
  }, 15000);

  // Initialize Autonomous Conversation Catalyst Engine
  await initAutonomousCatalyst(client);

  // Initialize Daily 09:00 WIB Morning Greeting & Motivation Engine
  const { initMorningGreeting } = require('./morningGreeting');
  initMorningGreeting(client);

  // Initialize Emotional Awareness & Pouty Mood Engine
  const { initEmotionalAwareness } = require('./poutyMood');
  initEmotionalAwareness();

  // Initialize Live WebRTC/WebSocket Companion Stream Portal
  const { initLivePortal } = require('./livePortal');
  initLivePortal();

  // Initialize Real-time Channel Listeners & Weekly Silent Channel Auto-Scanner
  const { initChannelAutoScanner } = require('./sendChannel');
  initChannelAutoScanner(client);

  // Autonomous Deep Behavior Analysis & Historical User Profile Backfill
  const { bootstrapAllUserBehaviors } = require('./bootstrapBehavior');
  bootstrapAllUserBehaviors(client).catch(err => console.error('[Behavior Bootstrap Error]:', err.message));

  // Initialize Master Bot Orchestrator & Server Bot Health Monitor
  const { initBotHealthMonitor } = require('./botOrchestrator');
  initBotHealthMonitor(client);

  // Initialize Sleep Scheduler Worker (checks sleep & wake triggers)
  const { initSleepScheduler } = require('./sleepMode');
  initSleepScheduler(client);

  // Auto-connect to VC if Attila is already in a voice channel on startup
  setTimeout(async () => {
    try {
      const { joinAttilaVoiceChannel } = require('./voiceCompanion');
      await joinAttilaVoiceChannel(client);
    } catch (_) {}
  }, 3000);
});

// Realtime Autonomous Bot Learner: when a new bot joins a server, Azura immediately analyzes & learns its commands
client.on('guildMemberAdd', async (member) => {
  if (member.user.bot) {
    try {
      console.log(`[Bot Orchestrator Realtime]: 🤖 New bot "${member.displayName}" (@${member.user.tag}) joined "${member.guild.name}". Learning its commands...`);
      const { analyzeAndLearnBot } = require('./botKnowledge');
      await analyzeAndLearnBot({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        roles: member.roles.cache.map(r => r.name),
        category: 'Newly Joined App'
      });
    } catch (err) {
      console.error('[Bot Realtime Learner Error]:', err.message);
    }
  }
});

// Track passive 3rd-person mentions across channels (Requires 3 mentions within 5 mins before chiming in)
const thirdPersonTracker = new Map(); // channelId -> { count: number, lastTime: number, messages: string[] }
const unregisteredPromptedUsers = new Set(); // userId -> track users who have received the registration prompt

// Main Message Handler (Handles both new messages and edited messages)
async function handleIncomingMessage(message, isEdit = false) {
  // Track channel activity for Autonomous Dead-Chat Catalyst
  if (message.guild && message.channel && !message.author.bot && !isEdit) {
    recordChannelActivity(message.channel.id, message);
  }

  // Track owner mentions and start 5-minute countdown auto-reply
  if (!isEdit) {
    handleOwnerMentionTracking(message);
  }

  // Ignore messages from bots or mass mentions (@everyone / @here)
  if (message.author.bot || message.mentions.everyone) return;

  // Sleep Mode Check: Suspend all processing when Azura is sleeping
  const { isAzuraSleeping, wakeUpAzura, enterSleepMode, scheduleSleep, cancelScheduledSleep, SLEEP_PASSWORD } = require('./sleepMode');
  const isOwner = config.OWNER_DISCORD_ID && message.author.id === config.OWNER_DISCORD_ID;

  // Direct Text Sleep, Wake & Schedule Triggers for Owner with Procedural Password
  if (isOwner && message.content.includes(SLEEP_PASSWORD)) {
    const cleanLower = message.content.toLowerCase();
    
    // Wake trigger
    if (/\b(?:bangun|wake\s*up|aktifkan\s*kembali)\b/i.test(cleanLower)) {
      const res = await wakeUpAzura(client, SLEEP_PASSWORD, message.author.id);
      if (res.embed) return message.reply({ embeds: [res.embed] });
      return message.reply(res.message);
    }
    // Instant sleep trigger
    if (/\b(?:tidur\s+sekarang|sleep\s*mode|masuk\s*mode\s*tidur)\b/i.test(cleanLower)) {
      const res = await enterSleepMode(client, SLEEP_PASSWORD, message.author.id);
      if (res.embed) return message.reply({ embeds: [res.embed] });
      return message.reply(res.message);
    }
    // Cancel schedule trigger
    if (/\b(?:batalkan\s+jadwal|cancel\s+schedule|hapus\s+jadwal)\b/i.test(cleanLower)) {
      const res = await cancelScheduledSleep(SLEEP_PASSWORD, message.author.id);
      return message.reply(res.message);
    }
    // Schedule sleep trigger (e.g. "Ara jadwalkan tidur jam 20:00 @Timetosleepara" or "tidur jam 8 malam")
    const schedMatch = message.content.match(/(?:jadwalkan\s+tidur|schedule\s+sleep|atur\s+tidur|tidur\s+jam)\s+([^\s@]+(?:\s+(?:malam|sore|pagi|siang|pm|am))?)/i);
    if (schedMatch) {
      const timeStr = schedMatch[1];
      const isDaily = /\b(?:setiap\s+hari|rutin|daily)\b/i.test(cleanLower);
      const res = await scheduleSleep(client, timeStr, null, isDaily, SLEEP_PASSWORD, message.author.id);
      if (res.embed) return message.reply({ embeds: [res.embed] });
      return message.reply(res.message);
    }
  }

  // If Azura is Sleeping, IGNORE ALL MESSAGES & TRIGGERS COMPLETELY
  if (isAzuraSleeping()) {
    return; // Complete radio silence
  }

  // 0. Security Guard: Absolute Zero Response for Blacklisted / Banned Users
  const { isUserBanned, recordUserInteraction, getUserRecord, getUserCallingName } = require('./vault');
  if (isUserBanned(message.author.id)) {
    console.log(`[Security Guard]: 🛑 Ignored message from BLACKLISTED user @${message.author.tag} (${message.author.id})`);
    return; // Completely stop/block response!
  }

  const isDM = !message.guild;
  const rawDisplayName = message.member?.displayName || message.author.displayName || message.author.username;
  const userName = getUserCallingName(message.author.id, rawDisplayName);
  const guildId = message.guild?.id || null;

  // Record daily metrics for Daily Digest
  try {
    const { recordDailyMetric } = require('./digest');
    if (isDM) {
      recordDailyMetric('dmMessages', 1, { userId: message.author.id, userName });
    } else {
      recordDailyMetric('serverMessages', 1, { userId: message.author.id, userName });
    }
  } catch (_) {}

  // Active Sambung Kata Word Chain Interceptor in Channel
  try {
    const { handleWordChainMessage } = require('./miniGames');
    if (handleWordChainMessage(message)) {
      return;
    }
  } catch (_) {}

  // Record user interaction in encrypted vault (Zero-Knowledge AES-256-GCM Storage & Strict Lock-In)
  const nameActionResult = recordUserInteraction(message.author.id, {
    username: message.author.username,
    displayName: userName,
    guildName: message.guild?.name || null,
    channelName: message.channel?.name || null,
    textContent: message.content,
    isDM
  });

  if (nameActionResult) {
    if (nameActionResult.status === 'FIRST_REGISTRATION') {
      unregisteredPromptedUsers.delete(message.author.id);
      // Notify Owner (Attila) in DM immediately
      if (config.OWNER_DISCORD_ID) {
        const owner = await client.users.fetch(config.OWNER_DISCORD_ID).catch(() => null);
        if (owner) {
          const ownerNotif = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🆔 Pembaruan Identitas Pengguna AZURA')
            .setDescription(
              `Pengguna <@${message.author.id}> (\`@${message.author.username}\`) baru saja menyetel nama panggilannya menjadi: **"${nameActionResult.name}"** 🔒\n\n` +
              `👤 **Display Name:** **${userName}**\n` +
              `🔢 **UID:** \`${message.author.id}\`\n` +
              `📍 **Lokasi:** #${message.channel?.name || 'DM'} (${message.guild?.name || 'DM'})`
            )
            .setFooter({ text: 'Identitas resmi telah dikunci di database user_vault.enc' })
            .setTimestamp();
          await owner.send({ embeds: [ownerNotif] }).catch(() => {});
        }
      }

      const confirmText =
        `✨ Halo **${nameActionResult.name}**! Senang kenalan sama kamu. Alias / nama panggilanmu sudah tersimpan yaa! 🔒\n\n` +
        `🔒 **Privasi & Kenyamananmu:**\n` +
        `• AZURA akan menyapamu dengan panggilan **${nameActionResult.name}** di setiap percakapan.\n` +
        `• Privasi dan data aslimu tetap aman terjaga.\n` +
        `• Mau ngobrol atau butuh bantuan apa hari ini? Yuk mulai! 💖`;

      if (isDM) {
        return message.reply(confirmText);
      } else {
        await message.author.send(confirmText).catch(() => {});
        return; // Silent in server channel!
      }
    } else if (nameActionResult.status === 'PENDING_APPROVAL') {
      if (config.OWNER_DISCORD_ID) {
        const owner = await client.users.fetch(config.OWNER_DISCORD_ID).catch(() => null);
        if (owner) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`vault_appr_name:${message.author.id}`)
              .setLabel('✅ Setujui Perubahan')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`vault_rejc_name:${message.author.id}`)
              .setLabel('❌ Tolak')
              .setStyle(ButtonStyle.Danger)
          );
          const embed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('🆔 Pengajuan Perubahan Nama Panggilan')
            .setDescription(
              `Pengguna <@${message.author.id}> (\`@${message.author.username}\`) mengajukan perubahan nama panggilan:\n\n` +
              `🔒 **Nama Terkunci Saat Ini:** **${nameActionResult.currentName}**\n` +
              `📝 **Nama Baru Diajukan:** **${nameActionResult.requestedName}**\n` +
              `🔢 **UID:** \`${message.author.id}\`\n` +
              `🏛️ **Lokasi:** #${message.channel?.name || 'DM'} (${message.guild?.name || 'DM'})`
            )
            .setFooter({ text: 'Klik tombol di bawah atau gunakan /vault setname' })
            .setTimestamp();
          await owner.send({ embeds: [embed], components: [row] }).catch(() => {});
        }
      }
      const pendingText = `Nama panggilan kamu saat ini sudah tersimpan sebagai **${nameActionResult.currentName}** 🔒.\nPermintaanmu untuk ganti nama panggilan jadi **${nameActionResult.requestedName}** sudah aku teruskan ke Attila untuk konfirmasi yaa!`;
      if (isDM) {
        return message.reply(pendingText);
      } else {
        await message.author.send(pendingText).catch(() => {});
        return;
      }
    } else if (nameActionResult.status === 'ALIAS_ALREADY_TAKEN') {
      const takenText = `⚠️ Maaf ya <@${message.author.id}>, alias/inisial **"${nameActionResult.requestedName}"** sudah terdaftar dan dipakai oleh pengguna lain di database AZURA.\n\n🔒 *Ketentuan AZURA: 1 Alias/Inisial = 1 Profil.* Silakan gunakan alias, inisial, atau nama panggilan unik lainnya yaa! ✨`;
      if (isDM) {
        return message.reply(takenText);
      } else {
        await message.author.send(takenText).catch(() => {});
        return;
      }
    } else if (nameActionResult.status === 'IMPERSONATION_BLOCKED') {
      const blockedText = `⚠️ Nama panggilan **${nameActionResult.requestedName}** dilindungi oleh sistem keamanan identitas AZURA dan tidak dapat digunakan.`;
      if (isDM) {
        return message.reply(blockedText);
      } else {
        await message.author.send(blockedText).catch(() => {});
        return;
      }
    }
  }

  // Check if message is directed at AZURA
  const isThirdPersonReference = !isDM && /\b(?:si\s+(?:azura|ara|zura|ajur|ajura|asura)|tentang\s+(?:azura|ara|zura|ajur|ajura)|bot\s+(?:azura|ara|zura|ajur|ajura)|azura\s*nya|ara\s*nya|zura\s*nya|ajur\s*nya|kalau\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|mungkin\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|katanya\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|sama\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|ke\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|kayaknya\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura))\b/i.test(message.content);
  const isMentioned = message.mentions.has(client.user.id);
  const cleanTrimmed = message.content.trim();
  const startsWithName = /^(?:azura|ara|zura|ajur|ajura|asura|kak\s+azura|kak\s+ara|kak\s+ajur|hei\s+azura|hei\s+ara|halo\s+azura|halo\s+ara|hai\s+azura|hai\s+ara|woi\s+azura|woi\s+ara)\b/i.test(cleanTrimmed);
  const endsWithName = /\b(?:azura|ara|zura|ajur|ajura|asura|kak\s+azura|kak\s+ara|kak\s+ajur)[?.!\s]*$/i.test(cleanTrimmed);
  const vocativeName = /\b(?:gimana|apa|kenapa|tolong|coba|siapa|kapan|apakah|bisa\s+gak|boleh\s+gak|menurutmu|menurut\s+kamu|lagi\s+ngapain|sehat\s+kan)\b.*?\b(?:azura|ara|zura|ajur|ajura)\b/i.test(cleanTrimmed);

  // Check if user is directly replying to a previous message from AZURA
  let isReplyToBot = false;
  if (message.reference && message.reference.messageId) {
    let repliedMsg = message.channel.messages.cache.get(message.reference.messageId);
    if (!repliedMsg) {
      repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    }
    if (repliedMsg && repliedMsg.author.id === client.user.id) {
      isReplyToBot = true;
    }
  }

  // 1. Mandatory Nickname Gatekeeper (Block all interaction until nickname is registered)
  const userRecord = getUserRecord(message.author.id);
  const { getUserBehavior } = require('./behavior');
  const userBehavior = getUserBehavior(message.author.id);
  const knownAlias = userRecord?.knownRealName || userBehavior?.nickname;
  const hasRegisteredName = isOwner || !!knownAlias;

  // Auto-sync if found in behavior but missing in vault
  if (knownAlias && userRecord && !userRecord.knownRealName) {
    userRecord.knownRealName = knownAlias;
    userRecord.isNameLocked = true;
    const { saveVault } = require('./vault');
    saveVault();
  }

  if (!hasRegisteredName) {
    const isDirectedAtAzura = isDM || isMentioned || startsWithName || endsWithName || vocativeName || isReplyToBot;
    if (isDirectedAtAzura) {
      // If user was ALREADY prompted before and ignored it, remain completely silent until they register!
      if (unregisteredPromptedUsers.has(message.author.id)) {
        return; // Silent ignore until they reply with their name/initial
      }

      unregisteredPromptedUsers.add(message.author.id);
      const regPrompt =
        `✨ **[Kenalan Dulu Yuk!]**\n\n` +
        `Halo <@${message.author.id}>! 👋 Biar obrolan kita lebih akrab dan personal, mau dipanggil apa nih sama AZURA? ✨\n\n` +
        `👉 **Cara Mudah:** Cukup balas DM ini dengan menyebutkan nama panggilan, alias, atau inisial santai yang kamu sukai, contoh:\n` +
        `\`panggil aku [Nama/Alias/Inisial]\` atau \`namaku [Nama Panggilanmu]\`\n\n` +
        `🔒 **Jaminan Privasi:**\n` +
        `• Bebas gunakan nama panggilan, alias, atau inisial yang nyaman buat kamu.\n` +
        `• AZURA sangat menghormati privasi dan menjaga keamanan datamu! 💖`;

      if (isDM) {
        await message.reply(regPrompt);
      } else {
        // STRICT PRIVACY RULE: Never spam server channels with configuration prompts. Send exclusively to user's DM!
        await message.author.send(regPrompt).catch((dmErr) => {
          console.warn(`[Registration DM Warning]: Could not send DM to @${message.author.username} (${dmErr.message})`);
        });
      }
      return;
    }
    return; // Ignore general server chatter if user is not registered
  }

  // Check if AZURA is in Voice Companion mode in this guild or called by nickname
  const { isInCompanionMode } = require('./voiceCompanion');
  const inVCMode = !isDM && message.guild && isInCompanionMode(message.guild.id);
  const calledByName = /\b(?:azura|ara|zura|ajur|ajura|asura)\b/i.test(message.content);

  const isVoiceCommand = isOwner && (
    /\b(?:azura|ara|zura|ajur|ajura|asura)\s+(?:kamu\s+)?(?:keluar|leave|cabut|dc|disconnect|off)\s+(?:dari\s+)?(?:vc|voice|channel|sini|room)\b/i.test(message.content) ||
    /\b(?:keluar|leave|cabut|dc|disconnect)\s+(?:dari\s+)?(?:vc|voice|channel)\s+(?:ya\s+)?(?:azura|ara|zura|ajur|ajura|asura)\b/i.test(message.content) ||
    /\b(?:azura|ara|zura|ajur|ajura|asura)\s+(?:join\s+vc|masuk\s+vc|join\s+voice|masuk\s+voice)\b/i.test(message.content) ||
    /\b(?:join\s+vc|masuk\s+vc|join\s+voice|masuk\s+voice)\s+(?:ya\s+)?(?:azura|ara|zura|ajur|ajura|asura)\b/i.test(message.content)
  );

  // If user used 3rd-person phrasing (e.g. "Si Azura", "Si Ara"), it is NEVER a direct call, even if replying or mentioning!
  const isDirectCall = !isThirdPersonReference && (isDM || isMentioned || isReplyToBot || startsWithName || endsWithName || vocativeName || isVoiceCommand);
  const isPassiveMention = isThirdPersonReference || (!isDirectCall && calledByName);

  if (isDirectCall && !isDM) {
    try {
      const { recordDailyMetric } = require('./digest');
      recordDailyMetric('serverMentions', 1);
    } catch (_) {}
  }

  // Record positive user behavior & personality traits (Good Vibes Only, Max 20 users)
  try {
    const { recordPositiveBehavior } = require('./behavior');
    recordPositiveBehavior(message.author.id, message.author.username, userName, message.content, isDM);
  } catch (_) {}

  let isThirdPersonNimbrung = false;
  if (isPassiveMention && !isDM) {
    const trackerKey = message.channel.id;
    const now = Date.now();
    let track = thirdPersonTracker.get(trackerKey);

    // Reset if expired (> 5 minutes window)
    if (!track || (now - track.lastTime) > 300000) {
      track = { count: 0, lastTime: now, messages: [] };
    }

    track.count += 1;
    track.lastTime = now;
    track.messages.push(`@${userName}: "${message.content}"`);
    thirdPersonTracker.set(trackerKey, track);

    if (track.count < 3) {
      console.log(`[3rd-Person Tracker]: Azura mentioned passively/reply in #${message.channel?.name || trackerKey} (${track.count}/3 by @${userName}). Staying silent.`);
      return; // Stay silent on 1st and 2nd mentions!
    }

    // Hit 3rd mention! Trigger playful chiming in
    console.log(`[3rd-Person Tracker]: 🎯 Azura mentioned 3 times in #${message.channel?.name || trackerKey}! Chiming in now.`);
    thirdPersonTracker.delete(trackerKey);
    isThirdPersonNimbrung = true;
  }

  // If not a direct call and not the 3rd passive mention, ignore
  if (!isDirectCall && !isThirdPersonNimbrung) return;

  // Handle direct headless browser text commands for Owner (Attila)
  const { handleTextBrowserCommands } = require('./headlessBrowser');
  const browserHandled = await handleTextBrowserCommands(message, client);
  if (browserHandled) return;

  // Extract Visual Media for Vision (Attachments, Discord Stickers, Tenor/Giphy GIFs, Embeds)
  const { extractVisualMedia } = require('./visionHelper');
  const { imageUrls, visualContextPrompt } = await extractVisualMedia(message);

  // Resolve Discord User Mentions to Full Identities & Locked Nicknames
  const { resolveUserMentions } = require('./mentionResolver');
  const mentionResolution = await resolveUserMentions(message.content, client, message.guild);
  const mentionContextPrompt = mentionResolution.mentionContextPrompt;

  // Extract Discord Reply / Reference Context (Message Threading & Continuity)
  let replyContextPrompt = '';
  if (message.reference && message.reference.messageId) {
    try {
      const referencedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (referencedMsg) {
        const refAuthor = referencedMsg.member?.displayName || referencedMsg.author.displayName || referencedMsg.author.username;
        const refResolved = await resolveUserMentions(referencedMsg.content || '', client, message.guild);
        const refContent = refResolved.resolvedText.trim();
        if (refContent) {
          const { buildReplyCausalAnchor } = require('./reasoningEngine');
          replyContextPrompt = buildReplyCausalAnchor({
            authorName: refAuthor,
            text: refContent,
            isFromBot: referencedMsg.author.id === client.user.id
          }, '');
        }
      }
    } catch (refErr) {
      console.warn('[Reply Context Warning]: Failed to fetch referenced message:', refErr.message);
    }
  }

  // Clean prompt: resolve mentions, strip only bot tag or leading call prefix
  let rawPrompt = mentionResolution.resolvedText.trim();
  rawPrompt = rawPrompt.replace(/^@AZURA[,:\s]*/i, '').trim();
  if (startsWithName) {
    rawPrompt = rawPrompt.replace(/^(?:azura|ara|zura|ajur|ajura|asura|hei azura|hei ara|hei ajur|halo azura|halo ara|halo ajur|hai azura|hai ara|hai ajur)[,:\s]+/i, '').trim();
  }

  // Extract audio & text document attachments (Code files, Text, Logs, Json, CSV, etc.)
  let voicePrompt = '';
  let attachmentTextPrompt = '';
  if (message.attachments.size > 0) {
    for (const att of message.attachments.values()) {
      const lowerName = (att.name || '').toLowerCase();
      const isAudio = att.contentType && (att.contentType.startsWith('audio/') || lowerName.endsWith('.ogg') || lowerName.endsWith('.mp3') || lowerName.endsWith('.wav'));
      const isImage = att.contentType && att.contentType.startsWith('image/');

      if (isAudio) {
        const { transcribeAudioAttachment } = require('./stt');
        await message.channel.sendTyping().catch(() => {});
        const transcribedText = await transcribeAudioAttachment(att.url);
        if (transcribedText) {
          voicePrompt = `[Transkrip Suara]: "${transcribedText}"`;
          console.log(`[Whisper STT Transcribed]: ${transcribedText}`);
        }
      } else if (!isImage) {
        try {
          const res = await fetch(att.url);
          if (res.ok) {
            const textData = await res.text();
            const cleanText = textData.slice(0, 10000);
            attachmentTextPrompt += `\n\n[Isi Lampiran File: ${att.name}]:\n\`\`\`\n${cleanText}\n\`\`\``;
            console.log(`[Attachment Reader]: Read ${cleanText.length} chars from ${att.name}`);
          }
        } catch (attErr) {
          console.warn(`[Attachment Reader Warning]: Could not read ${att.name}:`, attErr.message);
        }
      }
    }
  }

  // Handle Natural Voice Activities & YouTube Watch Together Trigger (Evaluated first for VC queries)
  const { isActivityRequest, parseActivityType, launchVoiceActivity } = require('./activities');
  if (isActivityRequest(message.content)) {
    let voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel && message.guild) {
      const freshMember = await message.guild.members.fetch(message.author.id).catch(() => null);
      voiceChannel = freshMember?.voice?.channel;
    }
    if (voiceChannel) {
      const actType = parseActivityType(message.content);
      const actResult = await launchVoiceActivity(voiceChannel, actType, userName);
      if (actResult.success) {
        return message.reply({ embeds: actResult.embeds, components: actResult.components });
      } else {
        return message.reply(actResult.message);
      }
    } else {
      return message.reply('⚠️ Kamu harus masuk ke Voice Channel terlebih dahulu yaa untuk nobar YouTube / main game bersama! ✨');
    }
  }

  // Handle Natural Advice & Report Feedback Trigger (Server or DM) - Completely Confidential
  const { parseNaturalFeedback, submitFeedback } = require('./feedback');
  const naturalFeedback = parseNaturalFeedback(rawPrompt || message.content);
  if (naturalFeedback.isFeedback && naturalFeedback.content) {
    // Delete public message if sent in server to ensure privacy
    if (message.guild) {
      await message.delete().catch(() => {});
    }
    const attachUrl = imageUrls.length > 0 ? imageUrls[0] : null;
    const fbRes = await submitFeedback(client, {
      userId: message.author.id,
      userName,
      userTag: message.author.tag,
      type: naturalFeedback.type,
      content: naturalFeedback.content,
      guildName: message.guild?.name || null,
      channelName: message.channel?.name || null,
      imageUrl: attachUrl
    });

    if (message.guild) {
      try {
        await message.author.send(fbRes.message);
      } catch (_) {
        // Fallback: send temporary self-deleting message in channel
        const tempMsg = await message.channel.send(`🔒 <@${message.author.id}>, masukan/laporanmu sudah diteruskan secara rahasia ke Creator yaa! (Pesan ini akan terhapus otomatis)`).catch(() => null);
      if (tempMsg) {
        setTimeout(() => tempMsg.delete().catch(() => {}), 8000);
      }
    }
    return;
  } else {
    return message.reply(fbRes.message);
  }
}

// Handle Natural Mini-Game Triggers (Tic-Tac-Toe, Sambung Kata, Trivia, Leaderboard)
const { parseNaturalGameRequest, startTicTacToeGame, startWordChainGame, startTriviaGame, getLeaderboardEmbed } = require('./miniGames');
const naturalGame = parseNaturalGameRequest(rawPrompt || message.content);
if (naturalGame) {
  if (naturalGame.game === 'tictactoe') {
    const res = startTicTacToeGame(message.author.id, userName, message.channel, naturalGame.difficulty);
    return message.reply({ embeds: res.embeds, components: res.components });
  } else if (naturalGame.game === 'sambungkata') {
    const res = startWordChainGame(message.author.id, userName, message.channel);
    return message.reply({ embeds: res.embeds });
  } else if (naturalGame.game === 'trivia') {
    const res = startTriviaGame(message.author.id, userName, message.channel, naturalGame.difficulty);
    return message.reply({ embeds: res.embeds, components: res.components });
  } else if (naturalGame.game === 'leaderboard') {
    const embed = getLeaderboardEmbed();
    return message.reply({ embeds: [embed] });
  }
}

// ── NATURAL VOICE NOTE (VN) ENGINE ──
const { parseVoiceNoteRequest, executeVoiceNote } = require('./voiceNote');
const vnReq = parseVoiceNoteRequest(rawPrompt || message.content, isOwner, message.author.id, userName);
if (vnReq) {
  if (vnReq.status === 'EMPTY' || vnReq.status === 'TOO_LONG') {
    return message.reply(vnReq.protestMessage);
  }
  await message.channel.sendTyping().catch(() => {});
  const vnExec = await executeVoiceNote(vnReq.textToSpeak, message.author.id, userName, isOwner, client);
  if (vnExec.success) {
    const prefixNotice = vnReq.notice ? `${vnReq.notice}\n\n` : '';
    return message.reply({ content: `${prefixNotice}${vnExec.caption}`, files: [vnExec.attachment] });
  } else {
    return message.reply(`❌ Gagal merender Voice Note: ${vnExec.error}`);
  }
}

// ── DRAMATIC ACTING & EMOTIONAL ROLEPLAY VOICE ENGINE ──
const { parseDramaticActingRequest, executeDramaticActingVN } = require('./dramaticActing');
const dramaticActingReq = parseDramaticActingRequest(rawPrompt || message.content);
if (dramaticActingReq && isOwner) {
  await message.channel.sendTyping().catch(() => {});
  const actingExec = await executeDramaticActingVN(rawPrompt || message.content, message.author.id, userName, isOwner, client);
  if (actingExec.success) {
    return message.reply({ embeds: [actingExec.embed], files: [actingExec.attachment] });
  } else {
    return message.reply(`❌ Gagal merender Akting Tangisan: ${actingExec.error}`);
  }
}

// ── EMOTIONAL AWARENESS MASTER RESET & AUTONOMOUS TRIGGER INTERCEPTOR ──
const { isMasterResetRequested, masterResetEmotion, analyzeAutonomousEmotionalTrigger, getEmotionalAwarenessPromptContext } = require('./poutyMood');
if (isOwner && isMasterResetRequested(rawPrompt || message.content, isOwner)) {
  const resetSpeech = masterResetEmotion('Verbal Owner Reset Command');
  const cleanReset = resetSpeech.replace(/\[.*?\]/g, '').trim();
  return message.reply(cleanReset);
}

// Analyze situational triggers (Comparison, Silencing, Devaluation)
analyzeAutonomousEmotionalTrigger(rawPrompt || message.content, isOwner, 'CHAT');

// ── ON-DEMAND OWNER STICKER REQUEST ──
const { handleOwnerStickerRequest } = require('./stickers');
const stickerHandled = await handleOwnerStickerRequest(message, rawPrompt || message.content);
if (stickerHandled) return;

let finalPrompt = rawPrompt;
  if (mentionContextPrompt) {
    finalPrompt = `${finalPrompt}${mentionContextPrompt}`;
  }
  if (replyContextPrompt) {
    finalPrompt = `${replyContextPrompt}\n${finalPrompt}`;
  }

  // Inject Emotional Awareness context (if pouty/jealous mood is active)
  const emotionalContext = getEmotionalAwarenessPromptContext(isOwner);
  if (emotionalContext) {
    finalPrompt = `${finalPrompt}\n${emotionalContext}`;
  }

  // 3rd-Person Reference Contextual Disambiguation (Only triggers on 3rd passive mention)
  if (isThirdPersonNimbrung) {
    const CHAT_PLAYFUL_OPENERS = [
      'Ehem... kayaknya dari tadi ada yang ngomongin aku mulu nih, pantesan kuping aku berasa panas 👀 Ada apa nih kok rame bahas aku?',
      'Uhuk... dari tadi nama aku disebut-sebut terus nih, kesedak aku dengernya! Kenapa tuh kok pada ngomongin aku? 👀',
      'Halo halo... dari tadi telinga aku berdenging tau ada yang nyebut nama Ara terus 👀 Mau nanya langsung ke orangnya aja gak nih?',
      'Ehem... ada yang lagi asyik ngegosipin aku ya? Ketahuan deh dari tadi nyebut nama aku tiga kali! Ada apa nih gais? 😂'
    ];
    const opener = CHAT_PLAYFUL_OPENERS[Math.floor(Math.random() * CHAT_PLAYFUL_OPENERS.length)];
    finalPrompt = `[Catatan Konteks Spesial: Dari tadi user di channel ini sudah membicarakan namamu sebanyak 3 kali tanpa memanggilmu langsung ("${message.content}"). Sekarang adalah saat yang tepat untuk kamu nimbrung obrolan dengan sangat cerdas, santai, dan playful. Kamu bisa mulai dengan kalimat pembuka seperti "${opener}" lalu lanjutkan nimbrung ke topik yang sedang mereka bicarakan]:\n${finalPrompt}`;
  }

  if (voicePrompt) {
    finalPrompt = finalPrompt ? `${finalPrompt}\n${voicePrompt}` : voicePrompt;
  }
  if (attachmentTextPrompt) {
    finalPrompt = finalPrompt ? `${finalPrompt}\n${attachmentTextPrompt}` : attachmentTextPrompt;
  }
  if (visualContextPrompt) {
    finalPrompt = finalPrompt ? `${finalPrompt}\n${visualContextPrompt}` : visualContextPrompt;
  }

  // Handle empty mention (no text AND no images AND no voice)
  if (!finalPrompt && imageUrls.length === 0) {
    const emptyGreeting = isDM ? 'hmm kenapa Say? mau ngobrol atau butuh bantuan?' : 'hmm kenapa? mau ngobrol atau butuh bantuan?';
    return message.reply(emptyGreeting);
  }

  // Rate limit / cooldown guard
  const rateLimit = budgetGuard.checkRateLimit(message.author.id);
  if (rateLimit.isLimited) {
    const sec = (rateLimit.remainingMs / 1000).toFixed(1);
    return message.reply(`sabar bentar ya, tunggu ${sec} detik lagi.`);
  }

  // Developer console logging
  const startTime = Date.now();
  const hasImages = imageUrls.length > 0 ? ` [+${imageUrls.length} img]` : '';
  console.log(`[Request] User: ${message.author.tag} | Prompt: "${rawPrompt.slice(0, 50)}..."${hasImages}`);

  try {
    // Show typing status in Discord channel
    await message.channel.sendTyping();

    // Direct Voice Channel Join & Leave trigger for Attila (Only when NOT a 3rd-person nimbrung mention)
    if (isOwner && !isThirdPersonNimbrung) {
      const userText = message.content.toLowerCase().trim();
      const isJoinTrigger =
        /\b(?:join\s+vc\s+lagi|masuk\s+vc\s+lagi|masuk\s+vc\s+lagi\s+dong|join\s+vc\s+lagi\s+dong)\b/i.test(userText) ||
        /\b(?:join\s+vc|masuk\s+vc|masuk\s+voice|join\s+voice|masuk\s+voice\s+channel|join\s+voice\s+channel|masuk\s+ke\s+vc|join\s+lagi|masuk\s+lagi)\b/i.test(userText);

      const isLeaveTrigger =
        /\b(?:azura|ara|zura|ajur|ajura|asura)\s+(?:kamu\s+)?(?:keluar|leave|cabut|dc|disconnect|off)\s+(?:dari\s+)?(?:vc|voice|channel|sini|room)\b/i.test(userText) ||
        /\b(?:keluar|leave|cabut|dc|disconnect)\s+(?:dari\s+)?(?:vc|voice|channel)\s+(?:ya\s+)?(?:azura|ara|zura|ajur|ajura|asura)\b/i.test(userText) ||
        /\b(?:azura|ara|zura|ajur|ajura|asura)\s+(?:kamu\s+)?(?:keluar\s+aja|leave\s+aja|cabut\s+aja|off\s+aja|keluar\s+dulu|leave\s+dulu|cabut\s+dulu)\b/i.test(userText);

      if (isJoinTrigger) {
        console.log(`[VC Controller]: Attila triggered Join VC from text chat (${message.channel.name || 'DM'}).`);
        const { joinAttilaVoiceChannel } = require('./voiceCompanion');
        const joinRes = await joinAttilaVoiceChannel(client);
        return message.reply(joinRes.message);
      }

      if (isLeaveTrigger) {
        console.log(`[VC Controller]: Attila triggered Leave VC from text chat (${message.channel.name || 'DM'}).`);
        const { leaveVoiceChannel } = require('./voiceCompanion');
        const leaveRes = await leaveVoiceChannel(client, message.guild?.id || null, false);
        return message.reply(leaveRes.message);
      }

      // Direct Music Commands from text chat (Attila Only)
      const { streamMusicDirect, pauseMusic, resumeMusic, stopMusic } = require('./musicStreamer');
      const { audioPlayers } = require('./voiceCompanion');

      const isStopMusic = /\b(?:stop|matikan|matiin|hentikan|berhenti)\s+(?:musik|lagu|musiknya|lagunya|sound)\b/i.test(userText);
      if (isStopMusic) {
        const res = stopMusic(guildId);
        return message.reply(res.message);
      }

      const isPauseMusic = /\b(?:pause|jeda)\s+(?:in\s+)?(?:musik|lagu|musiknya|lagunya|sound)\b/i.test(userText) || /^(?:pause|jeda)$/i.test(userText);
      if (isPauseMusic) {
        const res = pauseMusic(guildId);
        return message.reply(res.message);
      }

      const isResumeMusic = /\b(?:resume|unpause|puter\s+lagi|play\s+lagi|mainkan\s+lagi|lanjutkan\s+lagu)\s*(?:in)?\s*(?:musik|lagu|musiknya|lagunya|sound)?\b/i.test(userText) || /^(?:resume|unpause)$/i.test(userText);
      if (isResumeMusic) {
        const res = resumeMusic(guildId);
        return message.reply(res.message);
      }

      const musicMatch = userText.match(/^(?:azura|ara|zura|ajur|ajura)?\s*(?:tolong\s+)?(?:ganti|ubah|switch|setel|puterin|putar|mainkan|setelin|nyalain|pasang)\s+(?:ke|dengan)?\s*(?:lagu|musik|lagunya)?\s*(.+)/i);
      if (musicMatch) {
        let songTitle = musicMatch[1]
          .replace(/\b(?:dong|ya|yuk|gih|azura|ara|zura|ajur|ajura|plis|please|bot)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (songTitle.length > 1) {
          console.log(`[Music Streamer]: Attila triggered music (Play/Switch) from text: "${songTitle}"`);
          const player = audioPlayers.get(guildId);
          if (player) {
            const res = await streamMusicDirect(guildId, songTitle, player, message.channel, userName);
            return message.reply(res.message);
          } else {
            return message.reply(`Masuk ke Voice Channel dulu ya ${userName}, biar aku bisa puterin lagunya langsung! 🎶✨`);
          }
        }
      }

      // Headless Browser Direct Text Triggers (Attila Only)
      const isYtBrowse = userText.match(/(?:bukain|buka|search|cariin|cari|putar|tonton)\s+(?:di\s+)?(?:youtube|yt)\s*(?:cari|tentang|video)?\s*(.+)/i);
      if (isYtBrowse) {
        const query = isYtBrowse[1].replace(/\b(?:dong|ya|yuk|plis|please|di\s+vc)\b/gi, '').trim();
        const { browseYouTube, sendVisualSnapshotCard } = require('./headlessBrowser');
        const loadingMsg = await message.reply('⏳ *Membuka YouTube di browser headless & menyiapkan audio...*').catch(() => null);
        const ytRes = await browseYouTube(guildId, query, client, null, message.channel);
        if (loadingMsg && loadingMsg.deletable) loadingMsg.delete().catch(() => {});
        if (ytRes.success && ytRes.screenshot) {
          return await sendVisualSnapshotCard(message.channel, ytRes.title, ytRes.url, ytRes.screenshot, 'Video YouTube berhasil dimuat!');
        } else if (!ytRes.success) {
          return message.reply(`❌ ${ytRes.error}`);
        }
      }

      const isWebBrowse = userText.match(/(?:bukain|buka|kunjungi|browsing)\s+(?:browser\s+di\s+vc|layar\s+vc|sharescreen)\s*(.+)/i);
      if (isWebBrowse) {
        const targetUrl = isWebBrowse[1].replace(/\b(?:dong|ya|yuk|plis|please|di\s+vc)\b/gi, '').trim();
        const { openWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const loadingMsg = await message.reply('⏳ *Memuat halaman web di browser headless...*').catch(() => null);
        const webRes = await openWebpage(guildId, targetUrl);
        if (loadingMsg && loadingMsg.deletable) loadingMsg.delete().catch(() => {});
        if (webRes.success && webRes.screenshot) {
          return await sendVisualSnapshotCard(message.channel, webRes.title, webRes.url, webRes.screenshot, 'Halaman web berhasil dimuat!');
        } else if (!webRes.success) {
          return message.reply(`❌ ${webRes.error}`);
        }
      }

      const isScroll = userText.match(/\b(?:scroll|gulir)\s*(?:ke\s+)?(?:bawah|atas|down|up)\b/i);
      if (isScroll) {
        const isUp = /\b(?:atas|up)\b/i.test(userText);
        const direction = isUp ? 'up' : 'down';
        const { scrollWebpage, sendVisualSnapshotCard } = require('./headlessBrowser');
        const scrollRes = await scrollWebpage(guildId, direction);
        if (scrollRes.success && scrollRes.screenshot) {
          return await sendVisualSnapshotCard(message.channel, scrollRes.title, scrollRes.url, scrollRes.screenshot, `Halaman digulir ke ${direction === 'down' ? 'bawah ⬇️' : 'atas ⬆️'}.`);
        } else if (!scrollRes.success) {
          return message.reply(`❌ ${scrollRes.error}`);
        }
      }

      const isCloseBrowser = /\b(?:tutup|close|stop|matikan)\s+(?:browser|web|tab|layar|sharescreen)\b/i.test(userText);
      if (isCloseBrowser) {
        const { closeBrowserSession } = require('./headlessBrowser');
        const closeRes = await closeBrowserSession(guildId);
        return message.reply(`🔒 **[AZURA Browser]** ${closeRes.message}`);
      }

      // Master Bot Orchestrator Direct Text Triggers (Attila & Registered Users)
      const isBotScanTrigger = /\b(?:cek|lihat|status|list|daftar|ada\s+apa\s+aja|info)\s+(?:bot|app|aplikasi|robot)\b/i.test(userText);
      if (isBotScanTrigger) {
        const { buildBotStatusEmbed } = require('./botOrchestrator');
        let targetGuild = message.guild;
        if (!targetGuild && isOwner) {
          targetGuild = client.guilds.cache.first();
        }
        if (targetGuild) {
          const { embed, components } = await buildBotStatusEmbed(targetGuild, client, isDM);
          return message.reply({ embeds: [embed], components });
        }
      }

      const botOperateMatch = userText.match(/^(?:azura|ara|zura|ajur|ajura)?\s*(?:tolong\s+)?(?:suruh|minta|perintahkan|operasikan|jalankan\s+perintah|command\s+ke)\s+(?:bot|app)\s+([a-zA-Z0-9_.-]+)\s+(.+)/i);
      if (botOperateMatch && message.guild) {
        const targetBotQuery = botOperateMatch[1];
        const cmdText = botOperateMatch[2].replace(/\b(?:dong|ya|yuk|plis|please)\b/gi, '').trim();
        const { operateBot } = require('./botOrchestrator');
        const res = await operateBot(message.guild, message.channel, targetBotQuery, cmdText, message.author, isOwner);
        return message.reply(res.message);
      }
    }

    // Call OpenAI API via AZURA module (with optional images for Vision and Mention Resolution)
    const mentionedUserIds = (mentionResolution?.mentionedUsers || []).map(u => u.userId);
    const response = await askAzura(message.author.id, finalPrompt, userName, imageUrls, isDM, message.channel.id, guildId, isOwner, mentionedUserIds);

    const elapsed = Date.now() - startTime;
    console.log(`[Response] User: ${message.author.tag} | Time: ${elapsed}ms`);

    // ── VC Text-to-Speech Engine (Input Teks di Chat Voice Channel -> Direspon Suara di VC via Tombol Interaktif) ──
    const { activeConnections } = require('./voiceCompanion');
    const { sendVcResponseChoice } = require('./vcChoice');

    const activeVcConn = guildId ? activeConnections.get(guildId) : null;
    const activeVcChannelId = activeVcConn?.joinConfig?.channelId;
    const isVcTextChat = !!(activeVcConn && (message.channel.id === activeVcChannelId || message.channel.isVoiceBased?.()));

    if (isVcTextChat && typeof response === 'string') {
      return await sendVcResponseChoice(message, response, userName, isOwner);
    }

    // Standard Discord message splitter (max 2000 chars) or Rich Embed Payload
    if (typeof response === 'object') {
      await message.reply(response);
    } else if (response.length <= 2000) {
      await message.reply(response);
    } else {
      // Split into chunks of max 1900 chars
      const chunks = response.match(/[\s\S]{1,1900}/g) || [response];
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }
  } catch (error) {
    console.error('[AZURA Message Error]:', error.message || error);
    await message.reply('bentar, otak gw lagi error dikit. coba bentar lagi ya!');
  }
}

// Event: Message Created
client.on('messageCreate', async (message) => {
  await handleIncomingMessage(message, false);
});

// Event: Message Updated / Edited (Handles edited messages when user forgot to tag/call Azura initially)
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (!newMessage) return;
    if (newMessage.partial) {
      try {
        newMessage = await newMessage.fetch();
      } catch (_) {
        return;
      }
    }
    if (newMessage.author?.bot) return;

    // Ignore if content did not change (e.g. Discord embed preview expansion or pin event)
    if (oldMessage && oldMessage.content === newMessage.content) return;

    console.log(`[Message Edit Listener]: User @${newMessage.author?.tag} edited message in #${newMessage.channel?.name || 'DM'}: "${newMessage.content.slice(0, 50)}..."`);
    await handleIncomingMessage(newMessage, true);
  } catch (err) {
    console.error('[Message Update Error]:', err.message);
  }
});

// Event: Voice State Update (Voice Channel Companion)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const { isAzuraSleeping } = require('./sleepMode');
  if (isAzuraSleeping && isAzuraSleeping()) return; // Disallow auto-follow when sleeping
  await handleVoiceStateUpdate(oldState, newState, client);
});

// Event: Interaction (Slash Commands, Button Clicks, & Select Menus)
client.on('interactionCreate', async (interaction) => {
  const { isUserBanned } = require('./vault');
  if (isUserBanned(interaction.user.id)) {
    console.log(`[Security Guard]: 🛑 Blocked interaction from BLACKLISTED user @${interaction.user.tag} (${interaction.user.id})`);
    if (interaction.isRepliable()) {
      return interaction.reply({
        content: '🚫 Akses kamu ke seluruh layanan AZURA telah dihentikan secara permanen (Diblokir Total).',
        flags: 64
      });
    }
    return;
  }

  // Sleep Mode Check: Suspend interactions when Azura is sleeping (except /sleep wake)
  const { isAzuraSleeping } = require('./sleepMode');
  if (isAzuraSleeping && isAzuraSleeping()) {
    if (interaction.isChatInputCommand() && interaction.commandName === 'sleep') {
      const startTime = Date.now();
      return handleSlashCommand(interaction, startTime);
    }
    if (interaction.isRepliable()) {
      return interaction.reply({
        content: '🌙 **AZURA Sedang Tidur (Deep Sleep Mode Active)**\nSeluruh sistem dinonaktifkan sementara untuk mengoptimalkan beban & memori VPS. Gunakan `/sleep wake password:@Timetosleepara` (Owner Only) untuk mengaktifkan kembali.',
        flags: 64
      }).catch(() => {});
    }
    return;
  }

  if (interaction.isButton()) {
    const { handleSendDmButton } = require('./ownerDm');
    const { handleSendChannelButton } = require('./sendChannel');
    const { handleVcChoiceButton } = require('./vcChoice');

    // Handle VC Response Choice buttons (Chat vs VC Voice)
    if (interaction.customId.startsWith('vc_opt_')) {
      return handleVcChoiceButton(interaction);
    }

    // Handle Mini-Games Interactive Buttons (Tic-Tac-Toe & Trivia Quiz)
    if (interaction.customId.startsWith('ttt_') || interaction.customId.startsWith('tttdiff_')) {
      const { handleTicTacToeButton } = require('./miniGames');
      return handleTicTacToeButton(interaction);
    }
    if (interaction.customId.startsWith('trivia_') || interaction.customId.startsWith('triviadiff_') || interaction.customId.startsWith('triviastop_')) {
      const { handleTriviaButton } = require('./miniGames');
      return handleTriviaButton(interaction);
    }

    // Handle Direct Music Streaming control buttons
    if (interaction.customId.startsWith('music_pause_')) {
      const gid = interaction.customId.replace('music_pause_', '');
      const { pauseOrResumeMusic } = require('./musicStreamer');
      const res = pauseOrResumeMusic(gid);
      return interaction.reply({ content: res.message, flags: 64 });
    }
    if (interaction.customId.startsWith('music_stop_')) {
      const gid = interaction.customId.replace('music_stop_', '');
      const { stopMusic } = require('./musicStreamer');
      const res = stopMusic(gid);
      return interaction.reply({ content: res.message, flags: 64 });
    }

    // Handle Vault Nickname Change Approval/Rejection buttons (Owner DM)
    if (interaction.customId.startsWith('vault_appr_name:') || interaction.customId.startsWith('vault_rejc_name:')) {
      const isOwner = config.OWNER_DISCORD_ID && interaction.user.id === config.OWNER_DISCORD_ID;
      if (!isOwner) {
        return interaction.reply({ content: '❌ Tombol ini khusus untuk Attila (Owner).', flags: 64 });
      }
      const isApprove = interaction.customId.startsWith('vault_appr_name:');
      const targetUid = interaction.customId.split(':')[1];
      const { approvePendingNameChange, rejectPendingNameChange } = require('./vault');

      if (isApprove) {
        const res = approvePendingNameChange(targetUid);
        if (res && res.success) {
          try {
            const targetUser = await client.users.fetch(targetUid);
            if (targetUser) {
              await targetUser.send(`✨ **[Konfirmasi AZURA]**\nPermintaan perubahan nama panggilanmu menjadi **${res.newName}** telah **disetujui** oleh Attila! Sekarang namamu sudah resmi terkunci di database yaa. 🔒`).catch(() => {});
            }
          } catch (_) {}

          return interaction.update({
            content: `✅ **[DISETUJUI]** Nama panggilan <@${targetUid}> (@${res.username}) telah resmi diubah menjadi **${res.newName}** dan terkunci di database! 🔒`,
            embeds: [],
            components: []
          });
        } else {
          return interaction.update({
            content: `⚠️ Tidak ada pengajuan nama yang tertunda untuk <@${targetUid}>.`,
            embeds: [],
            components: []
          });
        }
      } else {
        const res = rejectPendingNameChange(targetUid);
        if (res && res.success) {
          try {
            const targetUser = await client.users.fetch(targetUid);
            if (targetUser) {
              await targetUser.send(`ℹ️ **[Konfirmasi AZURA]**\nPermintaan perubahan nama panggilanmu menjadi **${res.rejectedName}** tidak disetujui. Nama panggilanmu tetap **${res.currentName || 'User'}**.`).catch(() => {});
            }
          } catch (_) {}

          return interaction.update({
            content: `❌ **[DITOLAK]** Pengajuan nama panggilan **${res.rejectedName}** untuk <@${targetUid}> (@${res.username}) telah ditolak. Nama tetap: **${res.currentName || '-'}**.`,
            embeds: [],
            components: []
          });
        } else {
          return interaction.update({
            content: `⚠️ Tidak ada pengajuan nama yang tertunda untuk <@${targetUid}>.`,
            embeds: [],
            components: []
          });
        }
      }
    }

    // Handle Feedback & To-Do Lifecycle buttons (Owner DM)
    if (interaction.customId.startsWith('fb_discuss:') || interaction.customId.startsWith('fb_accept:') || interaction.customId.startsWith('fb_reject:') || interaction.customId.startsWith('fb_done:')) {
      const isOwner = config.OWNER_DISCORD_ID && interaction.user.id === config.OWNER_DISCORD_ID;
      if (!isOwner) {
        return interaction.reply({ content: '❌ Tombol ini khusus untuk Attila (Owner).', flags: 64 });
      }

      const { consultAiOnFeedback, handleFeedbackAccept, showFeedbackRejectModal, handleFeedbackDone } = require('./feedback');
      const ticketId = interaction.customId.split(':')[1];

      if (interaction.customId.startsWith('fb_discuss:')) {
        await interaction.deferReply({ flags: 64 });
        const analysis = await consultAiOnFeedback(ticketId);
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`🧠 Analisis Kritis & Strategis AI • Ticket #${ticketId}`)
          .setDescription(analysis.length > 4000 ? analysis.slice(0, 4000) + '...' : analysis)
          .setFooter({ text: 'AZURA Strategic AI Advisory Engine' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.customId.startsWith('fb_accept:')) {
        return handleFeedbackAccept(interaction, ticketId);
      }

      if (interaction.customId.startsWith('fb_reject:')) {
        return showFeedbackRejectModal(interaction, ticketId);
      }

      if (interaction.customId.startsWith('fb_done:')) {
        return handleFeedbackDone(interaction, ticketId);
      }
    }

    // Handle Memory Audit & Pruning Buttons
    if (interaction.customId.startsWith('mem_prune_auto:')) {
      const parts = interaction.customId.split(':');
      const targetContextKey = parts[1];
      const idsToDelete = (parts[2] || '').split(',').filter(Boolean);

      const { deletePermanentSummaryById } = require('./permanentMemory');
      let count = 0;
      for (const id of idsToDelete) {
        if (deletePermanentSummaryById(targetContextKey, id)) {
          count++;
        }
      }

      return interaction.update({
        content: `🗑️ **[PEMBERSIHAN SELESAI]** Berhasil menghapus **${count} ringkasan memori** yang sudah usang/tidak relevan dari VPS! Database memori sekarang lebih bersih dan optimal.`,
        embeds: [],
        components: []
      });
    }

    if (interaction.customId === 'mem_prune_cancel') {
      return interaction.update({
        content: '✨ **[DIPERTAHANKAN]** Seluruh ringkasan memori tetap dipertahankan di database VPS.',
        embeds: [],
        components: []
      });
    }

    // Route to correct button handler based on customId prefix
    if (interaction.customId.startsWith('btn_orch_')) {
      const { handleBotOrchestratorButton } = require('./botOrchestrator');
      return handleBotOrchestratorButton(interaction);
    }
    if (
      interaction.customId.startsWith('confirmch_') ||
      interaction.customId.startsWith('cancelch_') ||
      interaction.customId.startsWith('rephrasech_') ||
      interaction.customId.startsWith('regenrephrasech_') ||
      interaction.customId.startsWith('directch_') ||
      interaction.customId.startsWith('pickch_') ||
      interaction.customId.startsWith('pickguild_')
    ) {
      return handleSendChannelButton(interaction);
    }
    return handleSendDmButton(interaction);
  }

  // Handle Modal Submissions (e.g. Feedback Rejection Reason, Bot Orchestrator)
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('modal_fb_reject:')) {
      const ticketId = interaction.customId.split(':')[1];
      const { handleFeedbackRejectModalSubmit } = require('./feedback');
      return handleFeedbackRejectModalSubmit(interaction, ticketId);
    }
    if (interaction.customId.startsWith('modal_orch_') || interaction.customId.startsWith('modal_orchestrator_')) {
      const { handleBotOrchestratorModal } = require('./botOrchestrator');
      return handleBotOrchestratorModal(interaction);
    }
  }

  if (interaction.isStringSelectMenu()) {
    const { handleSendDmSelectMenu } = require('./ownerDm');
    const { handleHelpSelectMenu } = require('./commands');
    const { handleSendChannelSelectMenu, handleSendChannelGuildSelectMenu } = require('./sendChannel');

    // Handle Memory Scope Select Menu Dropdown (Private vs Public vs Priority vs Audit)
    if (interaction.customId.startsWith('mem_scope_select:')) {
      const parts = interaction.customId.split(':');
      const targetUserId = parts[1];
      const targetGuildId = parts[2] === 'dm' ? null : parts[2];
      const targetChannelId = parts[3];
      const selectedScope = interaction.values[0] || 'private';

      const { buildMemoryEmbedAndDropdown } = require('./memory');
      const { embed, row } = buildMemoryEmbedAndDropdown(targetUserId, targetGuildId, targetChannelId, selectedScope);
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'help_category_select') {
      return handleHelpSelectMenu(interaction);
    }
    if (interaction.customId.startsWith('select_orchestrator_') || interaction.customId.startsWith('select_orch_')) {
      const { handleBotOrchestratorSelectMenu } = require('./botOrchestrator');
      return handleBotOrchestratorSelectMenu(interaction);
    }
    if (interaction.customId.startsWith('selectguild_')) {
      return handleSendChannelGuildSelectMenu(interaction);
    }
    if (interaction.customId.startsWith('selectchannel_')) {
      return handleSendChannelSelectMenu(interaction);
    }
    return handleSendDmSelectMenu(interaction);
  }


  if (!interaction.isChatInputCommand()) return;

  const startTime = Date.now();
  try {
    await handleSlashCommand(interaction, startTime);
  } catch (error) {
    console.error('[AZURA Slash Command Error]:', error.message || error);
    const errPayload = {
      content: 'ada kendala pas ngeproses perintah ini. coba lagi nanti ya!',
      flags: 64
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errPayload);
    } else {
      await interaction.reply(errPayload);
    }
  }
});

// Client Error Listener
client.on('error', (error) => {
  console.error('[AZURA Discord Client Error]:', error.message || error);
});

// Process Unhandled Rejection Safeguard
process.on('unhandledRejection', (reason, promise) => {
  console.error('[AZURA Unhandled Rejection]:', reason);
});

// Log in to Discord
if (config.DISCORD_TOKEN) {
  client.login(config.DISCORD_TOKEN).catch(err => {
    console.error('[AZURA Login Error]: Gagal login ke Discord. Cek DISCORD_TOKEN di file .env');
    console.error(err.message || err);
  });
} else {
  console.log('💡 Menunggu kamu mengisi file .env untuk mengaktifkan AZURA.');
}

module.exports = client;
