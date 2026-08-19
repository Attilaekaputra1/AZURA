const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const budgetGuard = require('./budget');
const { askAzura } = require('./azura');
const { generateVoiceNote } = require('./tts');
const { registerSlashCommands, handleSlashCommand } = require('./commands');
const { initReminderChecker } = require('./reminder');
const { handleOwnerMentionTracking } = require('./autoReply');
const { handleVoiceStateUpdate } = require('./voiceCompanion');

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
  console.log(`• Features : Vision 📸 | VoiceNote 🎙️ | Search 🌐 | Reminder ⏰`);
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
});

// Event: Message Created (@AZURA mention listener & DM listener)
client.on('messageCreate', async (message) => {
  // Track owner mentions and start 5-minute countdown auto-reply
  handleOwnerMentionTracking(message);

  // Ignore messages from bots or mass mentions (@everyone / @here)
  if (message.author.bot || message.mentions.everyone) return;

  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user.id);
  const userName = message.member?.displayName || message.author.displayName || message.author.username;

  // Check if AZURA is in Voice Companion mode in this guild
  const { isInCompanionMode } = require('./voiceCompanion');
  const inVCMode = !isDM && message.guild && isInCompanionMode(message.guild.id);

  // Check if message calls "azura" by name (case-insensitive) — triggers response in VC text chat
  const calledByName = inVCMode && /\bazura\b/i.test(message.content);

  // Record ambient server channel messages into sliding window memory for multi-user context
  if (!isDM && message.channel.id && message.content && !isMentioned) {
    const rawText = message.content.replace(/<@!?\d+>/g, '').trim();
    if (rawText) {
      budgetGuard.addMessageToContext(`channel_${message.channel.id}`, 'user', `[${userName}]: ${rawText}`);
    }
  }

  // If it's not a DM and not mentioned and not called by name in VC mode, ignore
  if (!isDM && !isMentioned && !calledByName) return;

  // Clean prompt by removing bot mention tag
  const rawPrompt = message.content.replace(/<@!?\d+>/g, '').trim();

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

  // Extract stickers & analyze sticker sentiment
  const { parseMessageStickers } = require('./stickers');
  const stickerParsed = parseMessageStickers(message);
  let stickerPrompt = stickerParsed.textPrompt;

  let finalPrompt = rawPrompt;
  if (voicePrompt) {
    finalPrompt = finalPrompt ? `${finalPrompt}\n${voicePrompt}` : voicePrompt;
  }
  if (stickerPrompt) {
    finalPrompt = finalPrompt ? `${finalPrompt}\n${stickerPrompt}` : stickerPrompt;
  }

  // Handle empty mention (no text AND no images AND no voice)
  if (!finalPrompt && imageUrls.length === 0) {
    const emptyGreeting = isDM ? 'hmm kenapa Say? mau ngobrol atau butuh bantuan?' : 'hmm kenapa? mau ngobrol atau butuh bantuan?';
    return message.reply(emptyGreeting);
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

    // Call OpenAI API via AZURA module (with optional images for Vision)
    const response = await askAzura(message.author.id, finalPrompt, userName, imageUrls, isDM, message.channel.id);

    const elapsed = Date.now() - startTime;
    console.log(`[Response] User: ${message.author.tag} | Time: ${elapsed}ms`);

    // Discord message splitter (max 2000 chars)
    if (response.length <= 2000) {
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
