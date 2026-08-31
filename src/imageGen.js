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
 * Generate an image using OpenAI GPT Image 2 API (with graceful fallback & clean parameter guard)
 * @param {string} prompt 
 * @param {'portrait' | 'landscape' | 'square'} orientation 
 * @param {'standard' | 'hd'} quality 
 * @returns {Promise<{ success: boolean, imageUrl?: string, imageBuffer?: Buffer, revisedPrompt?: string, error?: string, orientationInfo?: typeof DIMENSIONS['square'], modelUsed?: string }>}
 */
async function generateAiImage(prompt, orientation = 'square', quality = 'standard') {
  const openai = getOpenAIClient();
  const normalizedOrientation = (orientation || 'square').toLowerCase().trim();
  const orientationConfig = DIMENSIONS[normalizedOrientation] || DIMENSIONS.square;

  const targetModel = config.IMAGE_MODEL || 'gpt-image-2';

  console.log(`[GPT Image 2 Engine]: Generating image using model "${targetModel}" (${orientationConfig.label}) for prompt: "${prompt}"`);

  let response;
  let modelUsed = targetModel;

  // Primary Payload - clean without legacy 'style' parameter
  const requestPayload = {
    model: targetModel,
    prompt: prompt,
    n: 1,
    size: orientationConfig.size
  };

  if (quality && quality !== 'standard') {
    requestPayload.quality = quality;
  }

  try {
    response = await openai.images.generate(requestPayload);
  } catch (err) {
    console.warn(`[GPT Image 2 Warning]: First attempt with "${targetModel}" returned: ${err.message}. Retrying with clean payload...`);

    // Retry 1: Minimalist payload (no quality / no extra flags)
    try {
      response = await openai.images.generate({
        model: targetModel,
        prompt: prompt,
        n: 1,
        size: orientationConfig.size
      });
    } catch (retryErr) {
      console.warn(`[GPT Image 2 Warning]: Minimalist retry failed (${retryErr.message}). Trying fallback to DALL·E 3...`);

      // Retry 2: Fallback to dall-e-3 with clean payload
      if (targetModel !== 'dall-e-3') {
        try {
          response = await openai.images.generate({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: orientationConfig.size
          });
          modelUsed = 'dall-e-3';
        } catch (fallbackErr) {
          return {
            success: false,
            error: fallbackErr.message || retryErr.message || err.message
          };
        }
      } else {
        return {
          success: false,
          error: retryErr.message || err.message
        };
      }
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
 * @param {{ processType?: string, styleDna?: string }} metadata
 */
function buildImg2ImgEmbed(userInstruction, userName, result, referenceUrl, quotaInfo = {}, metadata = {}) {
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
    .setTitle(`✨ ${metadata.processType || 'Transformasi Gambar AI'} Berhasil!`)
    .setDescription(`Karya visual hasil **Vision AI Forensic Synthesis** dari referensi gambar untuk **${userName}**:`)
    .setColor(0x9B59B6) // Amethyst Purple for Img2Img
    .addFields(
      { name: '🎨 Instruksi Modifikasi', value: `>>> "${userInstruction}"` },
      { name: '📐 Format & Resolusi', value: `\`${result.orientationInfo?.label || 'Square'}\` (${result.orientationInfo?.resolution || '1024x1024'})`, inline: true },
      { name: '🤖 Engine Model', value: `\`${result.modelUsed || 'gpt-image-2'} (HD)\``, inline: true }
    )
    .setFooter({ text: 'AZURA Vision & Creative Engine • Style DNA Lock & Surgical Inpaint' })
    .setTimestamp();

  if (metadata.styleDna) {
    embed.addFields({
      name: '🧬 Style DNA Terkunci',
      value: `*${metadata.styleDna}*`,
      inline: false
    });
  }

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
 * Advanced Image-to-Image & Photoshop-Style Surgical Transformation Processor
 * Uses Deep Forensic Vision AI to deconstruct reference image (Style DNA, Lighting, Subject Blueprint)
 * and synthesizes precision prompts for 100% style locking or surgical element modification.
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

  // Sanitize prompt from any system-injected tags
  let cleanPrompt = (prompt || '')
    .replace(/\[PENGGUNA MENGUNGGAH GAMBAR[^\]]*\][\s\S]*?(?:berikan tanggapan yang sangat akurat dan mendalam!|\n|$)/gi, '')
    .replace(/\[PENGGUNA MENGIRIM STIKER[^\]]*\][\s\S]*?(?:tanggapi ekspresi\/reaksinya!|\n|$)/gi, '')
    .replace(/\[PENGGUNA MENGUNGGAH FILE GIF[^\]]*\][\s\S]*?(?:animasinya secara detail!|\n|$)/gi, '')
    .replace(/\[Pengguna mengunggah video:[^\]]*\]/gi, '')
    .replace(/\[Transkrip Suara\]:\s*"[^"]*"/gi, '')
    .replace(/\[Isi Lampiran Dokumen[^\]]*\]:\s*```[\s\S]*?```/gi, '')
    .replace(/\[Catatan Konteks Spesial:[\s\S]*?\]:\s*\n?/gi, '')
    .replace(/\[Catatan Emosional Aktif:[\s\S]*?\]:\s*\n?/gi, '')
    .replace(/\[KONTEKS[^\]]*\][\s\S]*?(?:\n|$)/gi, '')
    .trim();

  // Strip leading bot name mention
  cleanPrompt = cleanPrompt.replace(/^(?:azura|ara|zura|ajur|ajura)[,\s:]+/i, '').trim();

  if (!cleanPrompt || cleanPrompt.length < 2) {
    cleanPrompt = 'Recreate this image in high resolution masterpiece quality';
  }

  const lower = cleanPrompt.toLowerCase();

  // Broad intent detection for Image-to-Image / Visual Modification / Pose / Styling
  const img2imgKeywords = [
    'ubah', 'ganti', 'edit', 'modifikasi', 'transformasi', 'jadikan', 'jadikanlah',
    'bikin', 'buat', 'restyle', 'remix', 'variasi', 'anime', 'kartun', 'background',
    'tambahin', 'tambahkan', 'versi', 'style', 'gaya', 'convert', 'transform',
    'make this', 'turn this', 'change', 'modify', 'gambar', 'foto', '3d',
    'lukisan', 'cyberpunk', 'realistis', 'pixel art', 'vektor', 'vector',
    'sama persis', 'style sama', 'gaya sama', 'stylenya sama', 'mirip',
    'photoshop', 'inpaint', 'bajunya', 'latarnya', 'warnanya', 'mukanya',
    'karakternya', 'rambutnya', 'topinya', 'duduk', 'berdiri', 'pose',
    'senyum', 'nangis', 'tidur', 'lari', 'teras', 'kamar', 'pantai', 'outdoor'
  ];

  // Pure conversational inquiries about the image should be handled by text LLM
  const isPureImageQuestion = /^(?:ini\s+(?:gambar|foto|siapa|apa)|jelaskan|apa\s+isi|siapakah|baca\s+teks|ada\s+apa)/i.test(lower);
  if (isPureImageQuestion) {
    return { isImageRequest: false };
  }

  const isImg2ImgIntent = img2imgKeywords.some(kw => lower.includes(kw)) ||
    (cleanPrompt.length >= 3 && !isPureImageQuestion);

  if (!isImg2ImgIntent) {
    return { isImageRequest: false };
  }

  console.log(`[Vision Image Engine]: 🔍 Processing Forensic Style & Transformation for: "${cleanPrompt}" with reference image.`);

  // Check Quota and Cooldown
  const quotaCheck = checkImageQuota(guildId, userId, isOwner);
  if (!quotaCheck.allowed) {
    return {
      isImageRequest: true,
      responsePayload: quotaCheck.reason
    };
  }

  // Detect orientation / aspect ratio from natural language
  let orientation = 'square';
  if (/\b(?:portrait|potrait|vertikal|tegak|wallpaper\s*hp|story|9:16|tall)\b/i.test(lower)) {
    orientation = 'portrait';
  } else if (/\b(?:landscape|horizontal|lebar|wallpaper\s*pc|desktop|banner|16:9|wide)\b/i.test(lower)) {
    orientation = 'landscape';
  }

  const client = getOpenAIClient();

  // Step 1: Deep Forensic Vision Analysis & Master Prompt Synthesis
  let synthesizedPrompt = cleanPrompt;
  let detectedStyleInfo = 'Adaptive AI Vision Reference';
  let processTypeLabel = 'Transformasi Visual AI';

  try {
    const visionSystemPrompt = `You are an elite Vision AI and Master Prompt Engineer specialized in Character DNA Deconstruction, 1:1 Aesthetic Cloning, and Surgical Inpainting / Pose / Scene Transformation for state-of-the-art Image Generation engines (GPT Image 2 / DALL-E 3).

USER GOAL / INSTRUCTION: "${cleanPrompt}"

CRITICAL RULES FOR HIGH-FIDELITY RECREATION:
1. [STRICT ART MEDIUM & STYLE PRESERVATION]:
   - If the reference image is an Anime / 3D CGI / Game Character (e.g. Genshin Impact, Honkai, VTuber, Japanese Anime style), the generated master prompt MUST preserve that exact Anime / 3D Cel-shaded CGI style!
   - NEVER turn an Anime / Stylized character into a realistic human photograph unless the user explicitly requested "jadikan manusia asli / realistic human photo".
   - If the reference is a realistic photograph, keep it as a realistic photograph.

2. [CHARACTER IDENTITY & OUTFIT CONTINUITY]:
   - Meticulously deconstruct the character's facial features, eye color, hair color, hair style, headpiece / headdress, signature outfit, dress, and iconic accessories.
   - Keep all character visual identifiers 100% consistent with the reference image.

3. [APPLY THE REQUESTED ACTION / POSE / SETTING]:
   - Read the user instruction: "${cleanPrompt}".
   - Accurately place the character in the requested pose (e.g., sitting, standing, walking) and setting (e.g., "duduk di teras" -> sitting gracefully on a traditional wooden porch / outdoor terrace with natural warm daylight, lush green garden in the background, matching the art style).

OUTPUT FORMAT:
Provide ONLY a valid JSON object with the following schema:
{
  "processType": "Style-Locked Clone" OR "Photoshop Surgical Inpainting" OR "Pose & Scene Transformation",
  "styleDnaSummary": "Short 5-8 word summary of the identified character, art style, and lighting (in Indonesian)",
  "masterPrompt": "Ultra-detailed, rich English DALL-E/GPT Image prompt incorporating the locked Character Identity, Art Style, and the requested action/setting. Must be vivid, aesthetic, masterpiece quality, no garbled text."
}`;

    const targetVisionModel = config.OPENAI_MODEL || 'gpt-5.6-luna';
    let visionRes;
    try {
      visionRes = await client.chat.completions.create({
        model: targetVisionModel,
        messages: [
          { role: 'system', content: visionSystemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this reference image and synthesize the master image generation prompt for: "${cleanPrompt}"` },
              { type: 'image_url', image_url: { url: imageUrls[0], detail: 'high' } }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 500
      });
    } catch (primaryVisionErr) {
      console.warn(`[Vision Image Engine Warning]: Primary model "${targetVisionModel}" failed (${primaryVisionErr.message}), falling back to secondary vision...`);
      visionRes = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: visionSystemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this reference image and synthesize the master image generation prompt for: "${cleanPrompt}"` },
              { type: 'image_url', image_url: { url: imageUrls[0], detail: 'high' } }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 500
      });
    }

    const parsedVision = JSON.parse(visionRes.choices[0]?.message?.content || '{}');
    if (parsedVision.masterPrompt) {
      synthesizedPrompt = parsedVision.masterPrompt;
      detectedStyleInfo = parsedVision.styleDnaSummary || detectedStyleInfo;
      processTypeLabel = parsedVision.processType || processTypeLabel;
    }
    console.log(`[Vision Image Engine]: ✅ Synthesized Prompt via ${targetVisionModel} (${processTypeLabel}): "${synthesizedPrompt}"`);
  } catch (visionErr) {
    console.warn('[Vision Image Engine Warning]: Vision synthesis fallback, using direct prompt:', visionErr.message);
  }

  // Step 2: High-Fidelity Image Generation with HD Quality
  const result = await generateAiImage(synthesizedPrompt, orientation, 'hd');
  const quotaInfo = recordImageGeneration(guildId, userId, isOwner);
  const payload = buildImg2ImgEmbed(cleanPrompt, userName, result, imageUrls[0], quotaInfo, {
    processType: processTypeLabel,
    styleDna: detectedStyleInfo
  });

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
/**
 * Build rich Discord embed for Multi-Step Research & Infographic Visual Generation
 */
function buildInfographicEmbed(topic, userName, result, researchSummary, sources, quotaInfo) {
  const embed = new EmbedBuilder()
    .setColor(0x00FFB2)
    .setTitle(`📊 Infografis & Riset Terpadu: ${topic.slice(0, 70)}`)
    .setDescription(
      `👤 **Permintaan Oleh:** ${userName}\n\n` +
      `💡 **Ringkasan Inti & Key Points (Tavily AI Intelligence):**\n${researchSummary.slice(0, 900)}\n\n` +
      `🎨 **Visualisasi Infografis:** *Gambar visual berhasil digenerate berdasarkan data riset terbaru!*`
    )
    .setFooter({
      text: quotaInfo?.isOwner
        ? '👑 Unlimited Owner Access • Autonomous Research & Visual Engine'
        : `⚡ Kuota Server: ${quotaInfo?.remainingToday || 0}/${DAILY_LIMIT_PER_SERVER} tersisa • Reset 00:00 WIB`
    })
    .setTimestamp();

  if (sources && sources.length > 0) {
    const sourceLinks = sources.slice(0, 3).map((s, i) => `${i + 1}. [${s.title.slice(0, 40)}](${s.url})`).join(' • ');
    embed.addFields({ name: '🌐 Sumber Terverifikasi', value: sourceLinks || 'Tavily Web Search', inline: false });
  }

  const files = [];
  if (result && result.buffer) {
    embed.setImage('attachment://infographic.png');
    files.push(new AttachmentBuilder(result.buffer, { name: 'infographic.png' }));
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`img_regen_${Date.now()}`)
      .setLabel('🔄 Generate Ulang Visual')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🎨')
  );

  return {
    embeds: [embed],
    files,
    components: [row]
  };
}

/**
 * Natural Chat Intelligence Router for Image Generation (Text-to-Image, Multi-Step Research Infographic & Image-to-Image)
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

  // Extract actual user command by stripping reply/system context prefixes
  let userActualText = prompt
    .replace(/\[Konteks\s+[^\]]+\]:\s*"[^"]*"\s*/gi, '')
    .replace(/\[Isi\s+Lampiran\s+[^\]]+\]:\s*```[\s\S]*?```/gi, '')
    .replace(/\[Transkrip\s+Suara\]:\s*"[^"]*"/gi, '')
    .replace(/\[Catatan\s+Konteks\s+[^\]]+\]:\s*/gi, '')
    .trim();

  let cleanPrompt = userActualText.replace(/\s+(?:dong|deh|ya|plis|pls|please|kan|coba)$/i, '').trim();
  const lower = cleanPrompt.toLowerCase();

  // ── NON-VISUAL / PURE TEXT INTENT SHIELD ──
  // If user asks for pure text, code, database, essay, or business plan without explicit visual intent, REJECT image gen!
  const explicitVisualKeywords = [
    'gambar', 'image', 'foto', 'photo', 'wallpaper', 'lukisan', 'painting', 'artwork',
    'fanart', 'infografis', 'infografik', 'infographic', 'poster', 'ilustrasi', 'illustration',
    'visualisasi', 'banner', 'logo', 'karikatur', 'komik', 'diagram visual', 'sketsa'
  ];

  const hasExplicitVisual = explicitVisualKeywords.some(kw => lower.includes(kw));

  const nonVisualKeywords = [
    'code', 'koding', 'script', 'database', 'sql', 'sqlite', 'rencana', 'plan', 'jadwal',
    'ringkasan', 'summary', 'artikel', 'essay', 'cerita', 'story', 'tabel', 'query',
    'fungsi', 'backend', 'frontend', 'analisis', 'teks', 'pesan', 'surat', 'puisi',
    'lirik', 'resep', 'makalah', 'soal', 'jawaban', 'dokumen', 'rumus', 'seperti apa', 'kayak gimana'
  ];

  const hasNonVisualOnly = nonVisualKeywords.some(kw => lower.includes(kw)) && !hasExplicitVisual;
  if (hasNonVisualOnly || !hasExplicitVisual) {
    return { isImageRequest: false }; // Let normal LLM answer the text request!
  }

  // ── MULTI-STEP RESEARCH & VISUAL / INFOGRAPHIC PIPELINE ──
  // MUST have explicit command to CREATE/GENERATE an infographic/poster/visual
  const hasVisualGenCommand = /\b(?:buatkan|buatin|bikinin|bikin|generate|buat|render|draw|lukiskan|desainkan)\s+(?:sebuah\s+|suatu\s+)?(?:infografis|infografik|infographic|poster|visualisasi|gambar|ilustrasi)\b/i.test(lower);
  const isResearchAndVisual = (
    (lower.includes('search') || lower.includes('cari') || lower.includes('riset') || lower.includes('googling') || lower.includes('info') || lower.includes('berita')) &&
    hasVisualGenCommand
  );

  if (isResearchAndVisual) {
    console.log(`[Multi-Step Visual Engine]: 🔍 Detected Research + Visual Infographic request: "${cleanPrompt}"`);
    
    // Check Quota and Cooldown
    const quotaCheck = checkImageQuota(guildId, userId, isOwner);
    if (!quotaCheck.allowed) {
      return { isImageRequest: true, responsePayload: quotaCheck.reason };
    }

    try {
      const { searchTavily } = require('./tavily');
      // Extract search query topic
      const topic = cleanPrompt
        .replace(/^(?:azura|ara|zura|ajur)?\s*(?:tolong\s+)?(?:search|cari|riset|googling)\s+(?:tentang|soal|mengenai)?/i, '')
        .replace(/(?:lalu|kemudian|terus|setelah\s+itu)?\s*(?:buatkan|buatin|bikinin|bikin|generate)?\s*(?:infografis|infografik|infographic|poster|visualisasikan|visual|gambar(?:nya)?).*/i, '')
        .trim() || cleanPrompt;

      console.log(`[Multi-Step Visual Engine]: Step 1 - Conducting live web research on topic: "${topic}"...`);
      const researchText = await searchTavily(topic, 'general');

      console.log(`[Multi-Step Visual Engine]: Step 2 - Synthesizing key points and crafting visual prompt...`);
      const client = getOpenAIClient();
      const synthRes = await client.chat.completions.create({
        model: config.OPENAI_MODEL || 'gpt-5.6-luna',
        messages: [
          {
            role: 'system',
            content: `You are an expert Data Visualizer & Infographic Designer. Given a research text about "${topic}", generate two things in JSON format:
1. "summary": A concise Indonesian executive summary and 3 bullet key points highlighting the facts/statistics (max 100 words).
2. "imagePrompt": A vivid, English DALL-E prompt to generate a modern aesthetic minimalist infographic illustration (vector style, clean UI data card visual, high resolution, visually stunning, no garbled text).
Output JSON format: {"summary": "...", "imagePrompt": "..."}`
          },
          { role: 'user', content: researchText }
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 450
      });

      const parsed = JSON.parse(synthRes.choices[0]?.message?.content || '{}');
      const visualPrompt = parsed.imagePrompt || `Modern minimalist aesthetic infographic illustration about ${topic}, sleek data cards, vibrant elements`;
      const execSummary = parsed.summary || researchText.slice(0, 300);

      console.log(`[Multi-Step Visual Engine]: Step 3 - Generating visual infographic image...`);
      const imgResult = await generateAiImage(visualPrompt, 'landscape');
      const quotaInfo = recordImageGeneration(guildId, userId, isOwner);
      const payload = buildInfographicEmbed(topic, userName, imgResult, execSummary, [], quotaInfo);

      return {
        isImageRequest: true,
        responsePayload: payload
      };
    } catch (err) {
      console.error('[Multi-Step Visual Engine Error]:', err.message);
      // Fallback to normal flow
    }
  }

  // ── STANDARD TEXT-TO-IMAGE INTENT DETECTION ──
  const triggers = [
    /^(?:azura\s+)?(?:tolong\s+)?(?:buatkan|buatin|bikinin|bikin|generate|buat|gambar|gambarkan|lukiskan|create|draw)\s+(?:sebuah\s+|suatu\s+)?(?:gambar|image|foto|wallpaper|lukisan|artwork|fanart|infografis|poster|ilustrasi)\s+(.+)/i,
    /^(?:azura\s+)?(?:tolong\s+)?(?:gambar|gambarkan|lukiskan|draw)\s+(.+)/i,
    /^(?:azura\s+)?(?:generate|create)\s+(?:image|artwork|illustration)\s+(.+)/i
  ];

  let rawSubject = null;
  for (const pattern of triggers) {
    const match = cleanPrompt.match(pattern);
    if (match && match[1]) {
      rawSubject = match[1].trim();
      break;
    }
  }

  if (!rawSubject && hasExplicitVisual) {
    if (lower.includes('gambar') && (lower.includes('buatin') || lower.includes('buatkan') || lower.includes('bikin') || lower.includes('generate'))) {
      rawSubject = cleanPrompt
        .replace(/^(?:azura\s+)?/i, '')
        .replace(/(?:tolong\s+)?(?:buatkan|buatin|bikinin|bikin|generate|buat)\s+(?:gambar|image|foto|wallpaper|lukisan|ilustrasi)?/i, '')
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
  buildInfographicEmbed,
  processImageToImage,
  processImageIntelligence,
  checkImageQuota,
  recordImageGeneration,
  DIMENSIONS,
  DAILY_LIMIT_PER_SERVER
};

