const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
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
});

// Event: Message Created (@AZURA mention listener & DM listener)
client.on('messageCreate', async (message) => {
  // Track channel activity for Autonomous Dead-Chat Catalyst
  if (message.guild && message.channel && !message.author.bot) {
    recordChannelActivity(message.channel.id, message);
  }

  // Track owner mentions and start 5-minute countdown auto-reply
  handleOwnerMentionTracking(message);

  // Ignore messages from bots or mass mentions (@everyone / @here)
  if (message.author.bot || message.mentions.everyone) return;

  const isDM = !message.guild;
  const userName = message.member?.displayName || message.author.displayName || message.author.username;
  const isOwner = config.OWNER_DISCORD_ID && message.author.id === config.OWNER_DISCORD_ID;
  const guildId = message.guild?.id || null;

  const isMentioned = message.mentions.has(client.user.id);
  const startsWithName = /^(?:azura|ara|zura|asura|hei azura|hei ara|halo azura|halo ara|hai azura|hai ara)\b/i.test(message.content.trim());

  // Check if user is directly replying to a previous message from AZURA
  let isReplyToBot = false;
  if (message.reference && message.reference.messageId) {
    const repliedMsg = message.channel.messages.cache.get(message.reference.messageId);
    if (repliedMsg && repliedMsg.author.id === client.user.id) {
      isReplyToBot = true;
    }
  }

  // Check if AZURA is in Voice Companion mode in this guild or called by nickname
  const { isInCompanionMode } = require('./voiceCompanion');
  const inVCMode = !isDM && message.guild && isInCompanionMode(message.guild.id);
  const calledByName = /\b(?:azura|ara|zura|asura)\b/i.test(message.content);

  const isVoiceCommand = isOwner && (
    /\b(?:keluar|leave|cabut|disconnect|dc|off)\s+(?:dari\s+)?(?:vc|voice|channel|sini)/i.test(message.content) ||
    /\b(?:keluar\s+vc|leave\s+vc|cabut\s+vc|join\s+vc|masuk\s+vc|join\s+voice|masuk\s+voice)\b/i.test(message.content) ||
    /\b(?:keluar\s+dulu|leave\s+dulu|cabut\s+dulu)\b/i.test(message.content)
  );

  // If it's not a DM and not mentioned, not replied to bot, not called by name, and not owner voice command, ignore
  if (!isDM && !isMentioned && !isReplyToBot && !startsWithName && !calledByName && !isVoiceCommand) return;

  // Extract Visual Media for Vision (Attachments, Discord Stickers, Tenor/Giphy GIFs, Embeds)
  const { extractVisualMedia } = require('./visionHelper');
  const { imageUrls, visualContextPrompt } = await extractVisualMedia(message);

  // Extract Discord Reply / Reference Context (Message Threading & Continuity)
  let replyContextPrompt = '';
  if (message.reference && message.reference.messageId) {
    try {
      const referencedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (referencedMsg) {
        const refAuthor = referencedMsg.member?.displayName || referencedMsg.author.displayName || referencedMsg.author.username;
        const refContent = (referencedMsg.content || '').replace(/<@!?\d+>/g, '').trim();
        if (refContent) {
          replyContextPrompt = `[Konteks Membalas Pesan @${refAuthor}]: "${refContent.slice(0, 600)}"`;
        }
      }
    } catch (refErr) {
      console.warn('[Reply Context Warning]: Failed to fetch referenced message:', refErr.message);
    }
  }

  // Clean prompt by removing bot mention tag and leading 'azura' / 'ara' / 'zura' prefix
  let rawPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (startsWithName) {
    rawPrompt = rawPrompt.replace(/^(?:azura|ara|zura|asura|hei azura|hei ara|halo azura|halo ara|hai azura|hai ara)[,:\s]+/i, '').trim();
  }

  // Extract audio attachments for Whisper STT
  let voicePrompt = '';
  if (message.attachments.size > 0) {
    for (const att of message.attachments.values()) {
      if (att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.ogg') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'))) {
        const { transcribeAudioAttachment } = require('./stt');
        await message.channel.sendTyping().catch(() => {});
        const transcribedText = await transcribeAudioAttachment(att.url);
        if (transcribedText) {
          voicePrompt = `[Transkrip Suara]: "${transcribedText}"`;
          console.log(`[Whisper STT Transcribed]: ${transcribedText}`);
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

  let finalPrompt = rawPrompt;
  if (replyContextPrompt) {
    finalPrompt = `${replyContextPrompt}\n${finalPrompt}`;
  }

  // 3rd-Person Reference Contextual Disambiguation
  const isThirdPersonRef = /\b(?:si\s+(?:azura|ara|zura|asura)|tentang\s+(?:azura|ara|zura)|bot\s+(?:azura|ara|zura)|azura\s*nya|ara\s*nya|kalau\s+(?:si\s+)?(?:azura|ara)|mungkin\s+(?:si\s+)?(?:azura|ara))\b/i.test(message.content);
  if (isThirdPersonRef && !isMentioned && !isReplyToBot) {
    finalPrompt = `[Catatan Konteks: User (${userName}) sedang membicarakan dirimu sebagai orang ketiga / monolog ("${message.content}"), BUKAN memanggilmu secara langsung. Tanggapi dengan sangat cerdas, santai, dan anggun sebagai seseorang yang mendengar namanya disebut—misal nimbrung secara playful/charming/humble]:\n${finalPrompt}`;
  }

  if (voicePrompt) {
    finalPrompt = finalPrompt ? `${finalPrompt}\n${voicePrompt}` : voicePrompt;
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

    // Direct Voice Channel Join & Leave trigger for Attila (supports Azura / Ara / Zura / @mention)
    if (isOwner) {
      const fullText = (message.content + ' ' + finalPrompt).toLowerCase().trim();
      const isJoinTrigger =
        /\b(?:join\s+vc\s+lagi|masuk\s+vc\s+lagi|masuk\s+vc\s+lagi\s+dong|join\s+vc\s+lagi\s+dong)\b/i.test(fullText) ||
        /\b(?:join\s+vc|masuk\s+vc|masuk\s+voice|join\s+voice|masuk\s+voice\s+channel|join\s+voice\s+channel|masuk\s+ke\s+vc|join\s+lagi|masuk\s+lagi)\b/i.test(fullText);

      const isLeaveTrigger =
        /\b(?:keluar\s+sekarang|keluar\s+skrg|keluar\s+skrng|leave\s+sekarang|cabut\s+sekarang)\b/i.test(fullText) ||
        /\b(?:keluar\s+vc|leave\s+vc|keluar\s+voice|leave\s+voice|keluar\s+dari\s+vc|cabut\s+dari\s+vc|keluar\s+dulu\s+dari\s+vc|keluar\s+dulu|leave\s+dulu|cabut\s+dulu)\b/i.test(fullText);

      if (isJoinTrigger) {
        console.log(`[VC Controller]: Attila triggered Join VC from text chat (${message.channel.name || 'DM'}).`);
        const { joinAttilaVoiceChannel } = require('./voiceCompanion');
        const joinRes = await joinAttilaVoiceChannel(client);
        return message.reply(joinRes.message);
      }

      if (isLeaveTrigger) {
        console.log(`[VC Controller]: Attila triggered Leave VC from text chat (${message.channel.name || 'DM'}).`);
        const { leaveVoiceChannel } = require('./voiceCompanion');
        const leaveRes = await leaveVoiceChannel(client, message.guild?.id || null);
        return message.reply(leaveRes.message);
      }

      // Direct Play Music trigger from chat (Direct Voice Music Streaming)
      const musicMatch = fullText.match(/(?:setel|puterin|putar|mainkan|setelin)\s+(?:lagu|musik|lagunya)?\s*(.+)/i);
      if (musicMatch) {
        let songTitle = musicMatch[1]
          .replace(/\b(?:dong|ya|yuk|gih|azura|ara|zura|plis|please|bot)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (songTitle.length > 1) {
          console.log(`[Music Streamer]: Attila triggered music from text: "${songTitle}"`);
          const { streamMusicDirect } = require('./musicStreamer');
          const { audioPlayers, companionTextChannels } = require('./voiceCompanion');
          const player = audioPlayers.get(guildId);
          if (player) {
            const res = await streamMusicDirect(guildId, songTitle, player, message.channel, userName);
            return message.reply(res.message);
          } else {
            return message.reply(`Masuk ke Voice Channel dulu ya ${userName}, biar aku bisa puterin lagunya langsung! 🎶✨`);
          }
        }
      }
    }

    // Call OpenAI API via AZURA module (with optional images for Vision)
    const response = await askAzura(message.author.id, finalPrompt, userName, imageUrls, isDM, message.channel.id, guildId, isOwner);

    const elapsed = Date.now() - startTime;
    console.log(`[Response] User: ${message.author.tag} | Time: ${elapsed}ms`);

    // Discord message splitter (max 2000 chars) or Rich Embed Payload
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
});

// Event: Voice State Update (Voice Channel Companion)
client.on('voiceStateUpdate', async (oldState, newState) => {
  await handleVoiceStateUpdate(oldState, newState, client);
});

// Event: Interaction (Slash Commands, Button Clicks, & Select Menus)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const { handleSendDmButton } = require('./ownerDm');
    const { handleSendChannelButton } = require('./sendChannel');

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

    // Route to correct button handler based on customId prefix
    if (interaction.customId.startsWith('confirmch_') || interaction.customId.startsWith('cancelch_')) {
      return handleSendChannelButton(interaction);
    }
    return handleSendDmButton(interaction);
  }

  if (interaction.isStringSelectMenu()) {
    const { handleSendDmSelectMenu } = require('./ownerDm');
    const { handleHelpSelectMenu } = require('./commands');
    const { handleSendChannelSelectMenu } = require('./sendChannel');
    if (interaction.customId === 'help_category_select') {
      return handleHelpSelectMenu(interaction);
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
