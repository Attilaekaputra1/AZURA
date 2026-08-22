const { Client, GatewayIntentBits, Partials } = require('discord.js');
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
client.once('ready', async () => {
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
  const isMentioned = message.mentions.has(client.user.id);
  const startsWithName = /^(?:azura\b|hei azura|halo azura|hai azura)/i.test(message.content.trim());

  // Check if user is directly replying to a previous message from AZURA
  let isReplyToBot = false;
  if (message.reference && message.reference.messageId) {
    const repliedMsg = message.channel.messages.cache.get(message.reference.messageId);
    if (repliedMsg && repliedMsg.author.id === client.user.id) {
      isReplyToBot = true;
    }
  }

  // Check if AZURA is in Voice Companion mode in this guild
  const { isInCompanionMode } = require('./voiceCompanion');
  const inVCMode = !isDM && message.guild && isInCompanionMode(message.guild.id);
  const calledByName = inVCMode && /\bazura\b/i.test(message.content);

  // If it's not a DM and not mentioned, not replied to bot, and not called by name, ignore
  if (!isDM && !isMentioned && !isReplyToBot && !startsWithName && !calledByName) return;

  // Clean prompt by removing bot mention tag and leading 'azura' prefix
  let rawPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (startsWithName) {
    rawPrompt = rawPrompt.replace(/^(?:azura[,:\s]+|hei azura[,:\s]+|halo azura[,:\s]+|hai azura[,:\s]+)/i, '').trim();
  }

  // Extract image attachments for Vision & audio attachments for Whisper STT
  const imageUrls = [];
  let voicePrompt = '';

  if (message.attachments.size > 0) {
    for (const att of message.attachments.values()) {
      if (att.contentType && att.contentType.startsWith('image/')) {
        imageUrls.push(att.url);
      } else if (att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.ogg') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'))) {
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

  // If no direct image attachment, check if user replied to a message containing an image
  if (imageUrls.length === 0 && message.reference && message.reference.messageId) {
    const referencedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (referencedMsg && referencedMsg.attachments && referencedMsg.attachments.size > 0) {
      for (const att of referencedMsg.attachments.values()) {
        if (att.contentType && att.contentType.startsWith('image/')) {
          imageUrls.push(att.url);
        }
      }
    }
  }

  let finalPrompt = rawPrompt;
  if (voicePrompt) {
    finalPrompt = rawPrompt ? `${rawPrompt}\n${voicePrompt}` : voicePrompt;
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

    // Get user's display name from Discord profile
    const userName = message.member?.displayName || message.author.displayName || message.author.username;
    const guildId = message.guild?.id || null;
    const isOwner = config.OWNER_DISCORD_ID && message.author.id === config.OWNER_DISCORD_ID;

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
