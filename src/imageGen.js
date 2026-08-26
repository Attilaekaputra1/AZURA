const { OpenAI } = require('openai');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    if (!config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY belum dikonfigurasi!');
    }
    openaiClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: 60000,
      maxRetries: 2
    });
  }
  return openaiClient;
}

// Daily Quota & Cooldown Configuration
const QUOTA_FILE = path.join(__dirname, '../data/image_quota.json');
const DAILY_LIMIT_PER_SERVER = 10;
const COOLDOWN_MS = 5000; // 5 detik

// In-memory cooldowns: Map<userId, timestamp>
const imageCooldowns = new Map();

function getTodayKey() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

function loadQuotaData() {
  try {
    if (fs.existsSync(QUOTA_FILE)) {
      return JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

function saveQuotaData(data) {
  try {
    const dir = path.dirname(QUOTA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Image Quota Error]: Failed to save quota data:', err.message);
  }
}

/**
 * Check if a server or user can generate an image
 * @param {string} guildId Guild ID or 'dm'
 * @param {string} userId User ID
 * @param {boolean} isOwner Whether the caller is the bot owner
 * @returns {{ allowed: boolean, reason?: string, remainingToday?: number, usedToday?: number, isOwner?: boolean }}
 */
function checkImageQuota(guildId, userId, isOwner = false) {
  if (isOwner) {
    return { allowed: true, remainingToday: 999, usedToday: 0, isOwner: true };
  }

  const now = Date.now();
  const lastTime = imageCooldowns.get(userId) || 0;
  const diff = now - lastTime;

  // Enforce 5-second cooldown
  if (diff < COOLDOWN_MS) {
    const remainingSec = ((COOLDOWN_MS - diff) / 1000).toFixed(1);
    return {
      allowed: false,
      reason: `⏳ **Cooldown Aktif!** Harap tunggu **${remainingSec} detik** lagi sebelum generate gambar berikutnya.`
    };
  }

  const scopeKey = guildId || `dm_${userId}`;
  const today = getTodayKey();
  const allData = loadQuotaData();

  if (!allData[today]) {
    allData[today] = {};
  }

  const used = allData[today][scopeKey] || 0;

  if (used >= DAILY_LIMIT_PER_SERVER) {
    return {
      allowed: false,
      reason: `🛑 **Kuota Harian Server Habis!**\nJatah kuota **${DAILY_LIMIT_PER_SERVER} gambar per hari** untuk server ini sudah terpakai semua (*sistem siapa cepat dia dapat*).\n\n⏰ Kuota akan otomatis direset kembali besok pada pukul **00:00 WIB**!`
    };
  }

  return {
    allowed: true,
    usedToday: used,
    remainingToday: DAILY_LIMIT_PER_SERVER - used,
    isOwner: false
  };
}

/**
 * Record a successful image generation
 * @param {string} guildId 
 * @param {string} userId 
 * @param {boolean} isOwner 
 * @returns {{ usedToday: number, remainingToday: number }}
 */
function recordImageGeneration(guildId, userId, isOwner = false) {
  imageCooldowns.set(userId, Date.now());

  if (isOwner) {
    return { usedToday: 0, remainingToday: 999, isOwner: true };
  }

  const scopeKey = guildId || `dm_${userId}`;
  const today = getTodayKey();
  const allData = loadQuotaData();

  if (!allData[today]) {
    allData[today] = {};
  }

  const newUsed = (allData[today][scopeKey] || 0) + 1;
  allData[today][scopeKey] = newUsed;
  saveQuotaData(allData);

  try {
    const { recordDailyMetric } = require('./digest');
    recordDailyMetric('imagesGenerated', 1);
  } catch (_) {}

  return {
    usedToday: newUsed,
    remainingToday: Math.max(0, DAILY_LIMIT_PER_SERVER - newUsed),
    isOwner: false
  };
}

// Dimensions mapping for Portrait, Landscape, and Square
const DIMENSIONS = {
  portrait: {
    size: '1024x1792',
    label: 'Portrait (9:16 Vertikal)',
    resolution: '1024 x 1792 px'
  },
  landscape: {
    size: '1792x1024',
    label: 'Landscape (16:9 Horizontal)',
    resolution: '1792 x 1024 px'
  },
  square: {
    size: '1024x1024',
    label: 'Square (1:1 Kotak)',
    resolution: '1024 x 1024 px'
  }
};

/**
 * Generate an image using OpenAI GPT Image 2 API (with graceful fallback)
 * @param {string} prompt 
 * @param {'portrait' | 'landscape' | 'square'} orientation 
 * @param {'standard' | 'hd'} quality 
 * @param {'vivid' | 'natural'} style 
 * @returns {Promise<{ success: boolean, imageUrl?: string, imageBuffer?: Buffer, revisedPrompt?: string, error?: string, orientationInfo?: typeof DIMENSIONS['square'], modelUsed?: string }>}
 */
async function generateAiImage(prompt, orientation = 'square', quality = 'standard', style = 'vivid') {
  const openai = getOpenAIClient();
  const normalizedOrientation = (orientation || 'square').toLowerCase().trim();
  const orientationConfig = DIMENSIONS[normalizedOrientation] || DIMENSIONS.square;

  const targetModel = config.IMAGE_MODEL || 'gpt-image-2';

  console.log(`[GPT Image 2 Engine]: Generating image using model "${targetModel}" (${orientationConfig.label}) for prompt: "${prompt}"`);

  let response;
  let modelUsed = targetModel;

  try {
    // Primary attempt with gpt-image-2 (does not use legacy 'style' parameter)
    const requestPayload = {
      model: targetModel,
      prompt: prompt,
      n: 1,
      size: orientationConfig.size,
    };

    if (quality && quality !== 'standard') {
      requestPayload.quality = quality;
    }

    if (targetModel.includes('dall-e') && style) {
      requestPayload.style = style;
    }

    response = await openai.images.generate(requestPayload);
  } catch (err) {
    console.warn(`[GPT Image 2 Warning]: Direct call with "${targetModel}" returned: ${err.message}. Trying fallback to DALL·E 3...`);
    if (targetModel !== 'dall-e-3') {
      try {
        response = await openai.images.generate({
          model: 'dall-e-3',
          prompt: prompt,
          n: 1,
          size: orientationConfig.size,
          quality: quality || 'standard',
          style: style || 'vivid',
        });
        modelUsed = 'dall-e-3';
      } catch (fallbackErr) {
        return {
          success: false,
          error: fallbackErr.message || err.message
        };
      }
    } else {
      return {
        success: false,
        error: err.message
      };
    }
  }

  const imageData = response.data?.[0];
  if (!imageData) {
    return {
      success: false,
      error: 'OpenAI tidak mengembalikan data gambar.'
    };
  }

  let imageBuffer = null;
  let imageUrl = imageData.url || null;

  if (imageData.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, 'base64');
  }

  return {
    success: true,
    imageUrl: imageUrl,
    imageBuffer: imageBuffer,
    revisedPrompt: imageData.revised_prompt || null,
    orientationInfo: orientationConfig,
    modelUsed: modelUsed
  };
}

/**
 * Build Discord Embed & Attachment Payload for Generated Image
 * @param {string} prompt 
 * @param {string} userName 
 * @param {{ success: boolean, imageUrl?: string, imageBuffer?: Buffer, revisedPrompt?: string, error?: string, orientationInfo?: any, modelUsed?: string }} result 
 * @param {{ usedToday?: number, remainingToday?: number, isOwner?: boolean }} quotaInfo
 */
function buildImageEmbed(prompt, userName, result, quotaInfo = {}) {
  if (!result.success) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Gagal Membuat Gambar AI')
          .setDescription(`Terjadi kendala saat memproses permintaan gambar kamu:\n\`\`\`${result.error}\`\`\``)
          .setColor(0xE74C3C)
          .setTimestamp()
      ],
      files: [],
      components: []
    };
  }

  const embed = new EmbedBuilder()
    .setTitle('🎨 Gambar AI Telah Selesai Dibuat!')
    .setDescription(`Karya visual dari **GPT Image 2** untuk **${userName}**:`)
    .setColor(0x00AE89) // Emerald Green
    .addFields(
      { name: '📝 Prompt', value: `>>> ${prompt}` },
      { name: '📐 Format & Resolusi', value: `\`${result.orientationInfo.label}\` (${result.orientationInfo.resolution})`, inline: true },
      { name: '🤖 Model Engine', value: `\`${result.modelUsed || 'gpt-image-2'}\``, inline: true }
    )
    .setFooter({ text: 'AZURA Creative Engine • Powered by OpenAI GPT Image 2' })
    .setTimestamp();

  if (quotaInfo.isOwner) {
    embed.addFields({ name: '👑 Status Kuota', value: '`Unlimited (Owner Access)`', inline: true });
  } else if (typeof quotaInfo.usedToday === 'number') {
    embed.addFields({
      name: '📊 Kuota Server Hari Ini',
      value: `\`${quotaInfo.usedToday}/${DAILY_LIMIT_PER_SERVER}\` (Sisa: **${quotaInfo.remainingToday}** slot)`,
      inline: true
    });
  }

  if (result.revisedPrompt && result.revisedPrompt !== prompt) {
    const truncatedRevised = result.revisedPrompt.length > 400
      ? result.revisedPrompt.substring(0, 400) + '...'
      : result.revisedPrompt;
    embed.addFields({
      name: '✨ Prompt yang Dioptimasi AI',
      value: `*${truncatedRevised}*`
    });
  }

  const files = [];
  const components = [];

  if (result.imageBuffer) {
    const attachment = new AttachmentBuilder(result.imageBuffer, { name: 'azura_gpt_image.png' });
    embed.setImage('attachment://azura_gpt_image.png');
    files.push(attachment);
  } else if (result.imageUrl) {
    embed.setImage(result.imageUrl);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Buka Resolusi Penuh (HD) ↗')
        .setStyle(ButtonStyle.Link)
        .setURL(result.imageUrl)
    );
    components.push(row);
  }

  return {
    embeds: [embed],
    files: files,
    components: components
  };
}

/**
 * Build Discord Embed & Attachment Payload for Image-to-Image Transformed Image
 * @param {string} userInstruction 
 * @param {string} userName 
 * @param {{ success: boolean, imageUrl?: string, imageBuffer?: Buffer, revisedPrompt?: string, error?: string, orientationInfo?: any, modelUsed?: string }} result 
 * @param {string} referenceUrl 
 * @param {{ usedToday?: number, remainingToday?: number, isOwner?: boolean }} quotaInfo 
 */
function buildImg2ImgEmbed(userInstruction, userName, result, referenceUrl, quotaInfo = {}) {
  if (!result.success) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Gagal Transformasi Gambar AI')
          .setDescription(`Terjadi kendala saat memproses Image-to-Image:\n\`\`\`${result.error}\`\`\``)
          .setColor(0xE74C3C)
          .setTimestamp()
      ],
      files: [],
      components: []
    };
  }

  const embed = new EmbedBuilder()
    .setTitle('✨ Transformasi Gambar AI Berhasil!')
    .setDescription(`Hasil karya visual **Image-to-Image** dari referensi gambar untuk **${userName}**:`)
    .setColor(0x9B59B6) // Amethyst Purple for Img2Img
    .addFields(
      { name: '🎨 Instruksi Modifikasi', value: `>>> "${userInstruction}"` },
      { name: '📐 Format & Resolusi', value: `\`${result.orientationInfo.label}\` (${result.orientationInfo.resolution})`, inline: true },
      { name: '🤖 Engine Model', value: `\`${result.modelUsed || 'gpt-image-2'}\``, inline: true }
    )
    .setFooter({ text: 'AZURA Vision & Creative Engine • Powered by GPT Image 2' })
    .setTimestamp();

  if (referenceUrl) {
    embed.setThumbnail(referenceUrl);
  }

  if (quotaInfo.isOwner) {
    embed.addFields({ name: '👑 Status Kuota', value: '`Unlimited (Owner Access)`', inline: true });
  } else if (typeof quotaInfo.usedToday === 'number') {
    embed.addFields({
      name: '📊 Kuota Server Hari Ini',
      value: `\`${quotaInfo.usedToday}/${DAILY_LIMIT_PER_SERVER}\` (Sisa: **${quotaInfo.remainingToday}** slot)`,
      inline: true
    });
  }

  if (result.revisedPrompt && result.revisedPrompt !== userInstruction) {
    const truncatedRevised = result.revisedPrompt.length > 350
      ? result.revisedPrompt.substring(0, 350) + '...'
      : result.revisedPrompt;
    embed.addFields({
      name: '✨ Prompt yang Dioptimasi AI',
      value: `*${truncatedRevised}*`
    });
  }

  const files = [];
  const components = [];

  if (result.imageBuffer) {
    const attachment = new AttachmentBuilder(result.imageBuffer, { name: 'azura_transformed_image.png' });
    embed.setImage('attachment://azura_transformed_image.png');
    files.push(attachment);
  } else if (result.imageUrl) {
    embed.setImage(result.imageUrl);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Buka Resolusi Penuh (HD) ↗')
        .setStyle(ButtonStyle.Link)
        .setURL(result.imageUrl)
    );
    components.push(row);
  }

  return {
    embeds: [embed],
    files: files,
    components: components
  };
}

/**
 * Image-to-Image Transformation Processor
 * Uses Vision AI to understand reference image and synthesizes edit generation prompt
 * @param {string} prompt 
 * @param {Array<string>} imageUrls 
 * @param {string} userName 
 * @param {string} guildId 
 * @param {string} userId 
 * @param {boolean} isOwner 
 * @returns {Promise<{ isImageRequest: boolean, responsePayload?: any }>}
 */
async function processImageToImage(prompt, imageUrls, userName = 'Pengguna', guildId = null, userId = null, isOwner = false) {
  if (!imageUrls || imageUrls.length === 0) return { isImageRequest: false };

  const cleanPrompt = prompt.trim();
  const lower = cleanPrompt.toLowerCase();

  // Keywords that indicate image-to-image modification/transformation intent
  const img2imgKeywords = [
    'ubah', 'ganti', 'edit', 'modifikasi', 'transformasi', 'jadikan', 'jadikanlah',
    'bikin jadi', 'buat jadi', 'restyle', 'remix', 'variasi', 'anime',
    'kartun', 'background', 'tambahin', 'tambahkan', 'versi', 'style',
    'gaya', 'convert', 'transform', 'make this', 'turn this', 'change',
    'modify', 'gambar ini', 'foto ini', '3d', 'lukisan', 'cyberpunk',
    'realistis', 'pixel art', 'vektor', 'vector'
  ];

  const isImg2ImgIntent = img2imgKeywords.some(kw => lower.includes(kw)) ||
    (lower.includes('gambar') && (lower.includes('bikin') || lower.includes('buat') || lower.includes('generate')));

  if (!isImg2ImgIntent) {
    return { isImageRequest: false };
  }

  console.log(`[Image-to-Image]: Processing transformation request: "${cleanPrompt}" with reference image.`);

  // Check Quota and Cooldown
  const quotaCheck = checkImageQuota(guildId, userId, isOwner);
  if (!quotaCheck.allowed) {
    return {
      isImageRequest: true,
      responsePayload: quotaCheck.reason
    };
  }

  // Detect orientation from natural language
  let orientation = 'square';
  if (lower.includes('portrait') || lower.includes('potrait') || lower.includes('vertikal') || lower.includes('tegak') || lower.includes('wallpaper hp') || lower.includes('story')) {
    orientation = 'portrait';
  } else if (lower.includes('landscape') || lower.includes('horizontal') || lower.includes('lebar') || lower.includes('wallpaper pc') || lower.includes('desktop') || lower.includes('banner')) {
    orientation = 'landscape';
  }

  const client = getOpenAIClient();

  // Step 1: Multimodal Vision Perception & Prompt Synthesis
  let synthesizedPrompt = cleanPrompt;
  try {
    const visionMessages = [
      {
        role: 'system',
        content: `You are an expert Image-to-Image AI Prompt Engineer. Your task is to analyze the provided reference image (subject identity, pose, clothing, facial features, lighting, composition, signature colors) and synthesize a detailed master prompt for an AI Image Generator (like GPT Image 2 / DALL-E 3).
The user wants to transform / edit this image with the following instruction: "${cleanPrompt}".
Synthesize a comprehensive English prompt that:
1. Keeps the core recognizable subject identity and structure from the reference.
2. Implements all the user's requested style transformations, additions, background changes, or artistic edits.
3. Uses vivid artistic keywords (e.g. masterpiece, highly detailed, expressive lighting).
Output ONLY the synthesized prompt in English as plain text without any markdown or conversational filler.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Please transform this reference image according to this instruction: "${cleanPrompt}"` },
          { type: 'image_url', image_url: { url: imageUrls[0], detail: 'high' } }
        ]
      }
    ];

    const visionRes = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: visionMessages,
      max_completion_tokens: 350
    });

    synthesizedPrompt = visionRes.choices[0]?.message?.content?.trim() || cleanPrompt;
    console.log(`[Image-to-Image Vision Prompt]: "${synthesizedPrompt}"`);
  } catch (visionErr) {
    console.warn('[Image-to-Image Warning]: Vision synthesis fallback, using direct prompt:', visionErr.message);
  }

  // Step 2: Generate Transformed Image via GPT Image 2 / Fallback
  const result = await generateAiImage(synthesizedPrompt, orientation);
  const quotaInfo = recordImageGeneration(guildId, userId, isOwner);
  const payload = buildImg2ImgEmbed(cleanPrompt, userName, result, imageUrls[0], quotaInfo);

  return {
    isImageRequest: true,
    responsePayload: payload
  };
}

/**
 * Natural Chat Intelligence Router for Image Generation (Text-to-Image & Image-to-Image)
 * @param {string} prompt 
 * @param {string} userName 
 * @param {string} guildId 
 * @param {string} userId 
 * @param {boolean} isOwner 
 * @param {Array<string>} imageUrls
 * @returns {Promise<{ isImageRequest: boolean, responsePayload?: any }>}
 */
async function processImageIntelligence(prompt, userName = 'Pengguna', guildId = null, userId = null, isOwner = false, imageUrls = []) {
  // Check Image-to-Image first if image attachments/references are provided
  if (imageUrls && imageUrls.length > 0) {
    const img2imgResult = await processImageToImage(prompt, imageUrls, userName, guildId, userId, isOwner);
    if (img2imgResult.isImageRequest) {
      return img2imgResult;
    }
  }

  let cleanPrompt = prompt.trim().replace(/\s+(?:dong|deh|ya|plis|pls|please|kan|coba)$/i, '').trim();
  const lower = cleanPrompt.toLowerCase();

  // Flexible trigger patterns for Text-to-Image
  const triggers = [
    /^(?:azura\s+)?(?:tolong\s+)?(?:buatkan|buatin|bikinin|bikin|generate|buat|gambar|gambarkan|lukiskan|create|draw)\s+(?:sebuah\s+|suatu\s+)?(?:gambar|image|foto|wallpaper|lukisan|artwork|fanart)\s+(.+)/i,
    /^(?:azura\s+)?(?:tolong\s+)?(?:buatkan|buatin|bikinin|bikin|gambar|gambarkan|lukiskan|draw)\s+(.+)/i,
    /^(?:azura\s+)?(?:generate|create)\s+image\s+(.+)/i
  ];

  let rawSubject = null;
  for (const pattern of triggers) {
    const match = cleanPrompt.match(pattern);
    if (match && match[1]) {
      rawSubject = match[1].trim();
      break;
    }
  }

  if (!rawSubject) {
    if (lower.includes('gambar') && (lower.includes('buatin') || lower.includes('buatkan') || lower.includes('bikin') || lower.includes('generate'))) {
      rawSubject = cleanPrompt
        .replace(/^(?:azura\s+)?/i, '')
        .replace(/(?:tolong\s+)?(?:buatkan|buatin|bikinin|bikin|generate|buat)\s+(?:gambar|image|foto)?/i, '')
        .trim();
    }
  }

  if (!rawSubject || rawSubject.length < 2) {
    return { isImageRequest: false };
  }

  console.log(`[Image Intelligence]: Detected natural image generation request: "${rawSubject}"`);

  // Check Quota and Cooldown
  const quotaCheck = checkImageQuota(guildId, userId, isOwner);
  if (!quotaCheck.allowed) {
    return {
      isImageRequest: true,
      responsePayload: quotaCheck.reason
    };
  }

  // Detect orientation from natural language
  let orientation = 'square';
  if (lower.includes('portrait') || lower.includes('potrait') || lower.includes('vertikal') || lower.includes('tegak') || lower.includes('wallpaper hp') || lower.includes('story')) {
    orientation = 'portrait';
  } else if (lower.includes('landscape') || lower.includes('horizontal') || lower.includes('lebar') || lower.includes('wallpaper pc') || lower.includes('desktop') || lower.includes('banner')) {
    orientation = 'landscape';
  }

  // Clean prompt for the image model
  const promptForModel = rawSubject
    .replace(/(?:portrait|potrait|landscape|vertikal|horizontal|square|kotak)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const result = await generateAiImage(promptForModel || rawSubject, orientation);
  const quotaInfo = recordImageGeneration(guildId, userId, isOwner);
  const payload = buildImageEmbed(rawSubject, userName, result, quotaInfo);

  return {
    isImageRequest: true,
    responsePayload: payload
  };
}

module.exports = {
  generateAiImage,
  buildImageEmbed,
  buildImg2ImgEmbed,
  processImageToImage,
  processImageIntelligence,
  checkImageQuota,
  recordImageGeneration,
  DIMENSIONS,
  DAILY_LIMIT_PER_SERVER
};

