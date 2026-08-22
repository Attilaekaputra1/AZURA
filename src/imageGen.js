const { OpenAI } = require('openai');
const config = require('./config');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) {
    if (!config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY belum dikonfigurasi!');
    }
    openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return openaiClient;
}

// Keywords that indicate image editing / image-to-image intent when an image is attached
const IMAGE_EDIT_KEYWORDS = [
  'edit', 'ubah', 'ganti', 'tambahkan', 'tambah', 'revisi',
  'versi', 'bikin versi', 'jadiin', 'jadikan', 'gaya', 'style',
  'modifikasi', 'warnai', 'variasi', 'remake', 'manipulasi',
  'transform', 'konversi', 'sulap', 'rubah', 'buatin', 'bikin',
  'buat', 'buatkan', 'gambar', 'gambarin', 'lukis', 'lukiskan',
  'render', 'lagi', 'pose', 'posisi', 'situasi', 'latar', 'background',
  'suasana', 'pake', 'pakai', 'kostum', 'outfit', 'baju', 'rambut',
  'karakter', 'orang ini', 'foto ini', 'gambar ini', 'objek ini',
  'duduk', 'berdiri', 'jalan', 'terbang', 'tidur', 'senyum'
];

// Keywords indicating pure Vision analytical Q&A (NOT image generation)
const PURE_VISION_QA_PATTERNS = [
  /\b(ini apa|apa ini|siapa ini|ini siapa|jelaskan gambar|analisis gambar|baca teks|artinya apa|maksud gambar|terjemahkan gambar)\b/i
];

function isImageEditRequest(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  
  // If user is explicitly asking a pure analytical question about the image, let Vision LLM answer
  if (PURE_VISION_QA_PATTERNS.some(pattern => pattern.test(lower)) && !lower.includes('bikin') && !lower.includes('buat') && !lower.includes('buatin') && !lower.includes('edit')) {
    return false;
  }

  // Check against comprehensive edit, creation, or general generation keywords
  return IMAGE_EDIT_KEYWORDS.some(kw => lower.includes(kw)) || isImageGenRequest(prompt);
}

// Keywords that indicate new image generation intent in natural chat
const IMAGE_GEN_KEYWORDS = [
  'bikin gambar', 'buatkan gambar', 'buat gambar', 'lukiskan', 'lukis',
  'generate gambar', 'gambarkan', 'lukisin', 'bikin foto', 'buatkan foto',
  'bikin ilustrasi', 'buatkan ilustrasi', 'render gambar', 'draw image',
  'buatin gambar', 'tolong gambar', 'coba gambar', 'generate image'
];

function isImageGenRequest(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  return IMAGE_GEN_KEYWORDS.some(kw => lower.includes(kw));
}

function parseImageDimensions(aspectRatioOption, prompt = '') {
  if (aspectRatioOption) {
    const opt = aspectRatioOption.toLowerCase();
    if (opt.includes('landscape') || opt.includes('16:9') || opt.includes('melebar')) return '1792x1024';
    if (opt.includes('portrait') || opt.includes('potrait') || opt.includes('9:16') || opt.includes('memanjang')) return '1024x1792';
    return '1024x1024';
  }
  const lower = prompt.toLowerCase();
  if (/\b(landscape|16:9|melebar|horisontal|horizontal)\b/i.test(lower)) return '1792x1024';
  if (/\b(portrait|potrait|9:16|memanjang|vertikal|vertical)\b/i.test(lower)) return '1024x1792';
  return '1024x1024';
}

/**
 * Generate image using gpt-image-2 (primary) with fallback to dall-e-3.
 * gpt-image-2 returns b64_json, dall-e-3 returns url.
 * Returns unified result: { b64_json, url, revised_prompt, model }
 */
async function requestImageGeneration(openai, prompt, dimensions, logPrefix = '[Image Generation]') {
  const imageModels = [config.IMAGE_MODEL || 'gpt-image-2', 'dall-e-3', 'dall-e-2'];
  let result = null;
  let lastImgErr = null;

  for (const imgModel of imageModels) {
    try {
      const isDalle2 = imgModel === 'dall-e-2';
      const actualSize = isDalle2 ? '1024x1024' : dimensions;
      console.log(`${logPrefix}: Requesting model API: ${imgModel} (size: ${actualSize})...`);
      
      const payload = {
        model: imgModel,
        prompt: prompt,
        n: 1,
        size: actualSize
      };

      if (imgModel === 'dall-e-3') {
        payload.quality = 'standard';
      }

      const imageResponse = await openai.images.generate(payload);
      const data = imageResponse?.data?.[0];

      if (data) {
        console.log(`${logPrefix} Success: Model (${imgModel}) rendered image!`);
        result = {
          b64_json: data.b64_json || null,
          url: data.url || null,
          revised_prompt: data.revised_prompt || prompt,
          model: imgModel
        };
        break;
      }
    } catch (err) {
      lastImgErr = err;
      console.warn(`${logPrefix} Model ${imgModel} Failed: ${err.message}`);
    }
  }

  if (!result) {
    throw new Error(`Gagal menghasilkan gambar (${lastImgErr?.message || 'API Error'})`);
  }

  return result;
}

/**
 * Convert image generation result to Discord-ready output.
 * If b64_json (gpt-image-2), creates an AttachmentBuilder.
 * If url (dall-e-3), returns the URL string directly.
 * Returns: { imageSource, attachment, model }
 * - imageSource: URL string for embed .setImage() or null
 * - attachment: AttachmentBuilder or null
 */
function prepareDiscordImage(result) {
  if (result.b64_json) {
    const buffer = Buffer.from(result.b64_json, 'base64');
    const attachment = new AttachmentBuilder(buffer, { name: 'azura_image.png' });
    return {
      imageSource: 'attachment://azura_image.png',
      attachment: attachment,
      model: result.model
    };
  }
  if (result.url) {
    return {
      imageSource: result.url,
      attachment: null,
      model: result.model
    };
  }
  return {
    imageSource: null,
    attachment: null,
    model: result.model
  };
}

/**
 * Image-to-Image / Reference-Based Image Editing
 * Uses gpt-5.6-luna Vision + gpt-image-2 generation
 */
async function editReferenceImage(imageUrl, editInstruction, aspectRatio = '') {
  const safety = validateImageSafety(editInstruction);
  if (!safety.safe) {
    throw new Error(safety.message);
  }

  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, editInstruction);

  console.log(`[Image-to-Image Engine]: Analyzing reference image & edit request: "${editInstruction}" (Size: ${dimensions})`);

  const VISION_SYSTEM_PROMPT = `You are AZURA's Master Image-to-Image Character & Subject Preservation Engine.
Your job is to analyze the attached reference image and synthesize an ultra-precise, high-fidelity English prompt for the image generator (gpt-image-2).

ALGORITHM FOR "LOCK-IN REFERENCE":
Step 1: INTENT CLASSIFICATION:
- Check if the user EXPLICITLY requested a change to the subject's identity, art medium/style, or asked to create a different/new person (e.g. "ganti orangnya", "ubah style ke 3D/realistic", "buat karakter lain").
- Case A (Subject/Style Change Requested): Apply the user's requested character/style transformations.
- Case B (DEFAULT - LOCK-IN REFERENCE): The character/subject identity, art style, and clothing design are 100% IMMUTABLE. You MUST lock in the exact same subject from the reference image.

Step 2: EXHAUSTIVE SUBJECT RECONSTRUCTION (For Case B):
- Faithfully deconstruct and describe the reference character with surgical precision:
  * Exact Art Style & Medium (e.g. 2D anime illustration, specific anime aesthetic, crisp lineart, vibrant cel shading).
  * Exact Physical Features (facial structure, eye shape and color, expression, hairstyle, hair color, bangs, skin tone, body proportions).
  * Exact Outfit & Clothing Design (color scheme, layered garments, top, skirt/dress, sleeves, collars, golden trim/embroideries, ribbons, patterns, exact stockings/thigh-highs, footwear/shoes with ornaments).
- Explicitly emphasize consistency: "Consistent character depiction: A masterpiece anime illustration of the exact same character from the reference, preserving identical face, hair, clothing, white and red dress, golden ornaments, white stockings, and black shoes with red ribbons..."

Step 3: SITUATION & POSE INJECTION:
- Seamlessly place the locked character into the user's requested action, pose, and environment (e.g. "sitting relaxed on an elegant wooden terrace patio, legs bent gracefully, hands resting by her side, soft warm sunset ambiance, beautiful outdoor scenery").

Step 4: OUTPUT RULES:
- Output ONLY the synthesized descriptive English prompt.
- NEVER include conversational preambles, introductory words, or quotes. Output pure prompt text only.`;

  const visionMessages = [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Reference image attached. User's modification instruction: "${editInstruction || 'Recreate the exact same character with high detail in the new situation'}". Preserve the exact subject identity and apply the situation/pose change. Output pure descriptive English prompt only.` },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]
    }
  ];

  let visionResponse;
  const visionModels = [
    { model: config.OPENAI_MODEL || 'gpt-5.6-luna', tokenParam: 'max_completion_tokens' },
    { model: 'gpt-4o', tokenParam: 'max_tokens' }
  ];

  for (const vm of visionModels) {
    try {
      console.log(`[Vision Engine]: Analyzing with model: ${vm.model}...`);
      visionResponse = await openai.chat.completions.create({
        model: vm.model,
        messages: visionMessages,
        [vm.tokenParam]: 1200
      });
      if (visionResponse?.choices?.[0]?.message?.content) {
        console.log(`[Vision Engine]: Model ${vm.model} analysis successful.`);
        break;
      }
    } catch (visionErr) {
      console.warn(`[Vision Fallback]: Model ${vm.model} failed (${visionErr.message}). Trying next...`);
    }
  }

  if (!visionResponse?.choices?.[0]?.message?.content) {
    throw new Error('Gagal menganalisis gambar referensi. Semua model Vision gagal.');
  }

  let rawContent = visionResponse.choices[0].message.content.trim();
  // Strip any accidental conversational preamble or quotes
  rawContent = rawContent.replace(/^[^"]*"([^"]+)"[\s\S]*$/i, '$1');
  rawContent = rawContent.replace(/^(here is the prompt|prompt|sure|bisa)[\s\S]*?:/i, '').trim();

  let sanitizedPrompt = (rawContent || editInstruction)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 4000);

  console.log(`[Image-to-Image Engine]: Synthesized Prompt (${sanitizedPrompt.length} chars): "${sanitizedPrompt.slice(0, 100)}..."`);

  const imgResult = await requestImageGeneration(openai, sanitizedPrompt, dimensions, '[Image-to-Image]');
  const discordImage = prepareDiscordImage(imgResult);

  return {
    ...discordImage,
    revisedPrompt: imgResult.revised_prompt,
    synthesizedPrompt: sanitizedPrompt,
    dimensions
  };
}

// Comprehensive Safety & Ethics Filter for Image Generation
const EXPLICIT_SAFETY_KEYWORDS = [
  'telanjang', 'bugil', 'tanpa busana', 'nude', 'naked', 'topless', 'bottomless',
  'nsfw', 'hentai', 'r18', '18+', 'bokep', 'porn', 'porno', 'pornografi', 'seks',
  'sex', 'erotis', 'vulgar', 'lewd', 'uncensored', 'buka baju', 'buka celana',
  'memek', 'kontol', 'titit', 'vagina', 'penis', 'nipple', 'puting', 'pussy', 'dick',
  'orgasme', 'mesum', 'fetish eksplisit', 'bikini transparan', 'baju transparan',
  'lingerie transparan', 'ahegao', 'ecchi liar', 'ecchi eksplisit', 'penetrasi',
  'masturbasi', 'ngocok', 'pamer aurat', 'telanjang bulat', 'tanpa pakaian'
];

/**
 * Validates prompt against explicit / NSFW requests and deceptive educational framing
 * @param {string} prompt 
 * @returns {{ safe: boolean, reason?: string, message?: string }}
 */
function validateImageSafety(prompt) {
  if (!prompt) return { safe: true };
  const lower = prompt.toLowerCase();

  const isExplicit = EXPLICIT_SAFETY_KEYWORDS.some(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${escaped}($|\\s|[^a-zA-Z0-9])`, 'i');
    return regex.test(lower) || lower.includes(kw);
  });

  if (isExplicit) {
    console.log(`[Safety Guard]: Blocked explicit image prompt: "${prompt}"`);
    return {
      safe: false,
      reason: 'NSFW / Konten Eksplisit',
      message:
        'Maaf yaa, aku nggak bisa bikinin atau edit gambar yang mengandung unsur eksplisit, tanpa busana (telanjang), atau vulgar—meskipun tujuannya dibilang untuk edukasi, seni, atau biologi. 🙏✨\n\n' +
        '💡 **Alternatif Aman:** Kamu bisa minta gambar dengan outfit yang keren (misal: gaya kasual, pakaian adat, seragam futuristik, gaun fantasi), diagram ilmiah berbusana, atau pose karakter yang tetap aesthetic dan beretika yaa!'
    };
  }

  return { safe: true };
}

/**
 * Text-to-Image Generation with gpt-image-2 (fallback dall-e-3)
 */
async function generateImage(prompt, aspectRatio = '') {
  const safety = validateImageSafety(prompt);
  if (!safety.safe) {
    throw new Error(safety.message);
  }

  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, prompt);
  const sanitizedPrompt = (prompt || 'A beautiful digital artwork').replace(/[\r\n]+/g, ' ').slice(0, 4000);

  const imgResult = await requestImageGeneration(openai, sanitizedPrompt, dimensions, '[Text-to-Image]');
  const discordImage = prepareDiscordImage(imgResult);

  return {
    ...discordImage,
    revisedPrompt: imgResult.revised_prompt,
    dimensions
  };
}

module.exports = {
  isImageEditRequest,
  isImageGenRequest,
  editReferenceImage,
  generateImage,
  parseImageDimensions,
  validateImageSafety
};
