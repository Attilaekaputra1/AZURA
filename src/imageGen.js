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

// Keywords that indicate image editing / image-to-image intent
const IMAGE_EDIT_KEYWORDS = [
  'edit', 'ubah', 'ganti', 'tambahkan', 'tambah', 'revisi',
  'versi', 'bikin versi', 'jadiin', 'jadikan', 'gaya', 'style',
  'modifikasi', 'warnai', 'variasi', 'remake', 'manipulasi',
  'transform', 'konversi', 'sulap', 'rubah'
];

// Keywords that indicate new image generation intent in natural chat
const IMAGE_GEN_KEYWORDS = [
  'bikin gambar', 'buatkan gambar', 'buat gambar', 'lukiskan', 'lukis',
  'generate gambar', 'gambarkan', 'lukisin', 'bikin foto', 'buatkan foto',
  'bikin ilustrasi', 'buatkan ilustrasi', 'render gambar', 'draw image',
  'buatin gambar', 'tolong gambar', 'coba gambar', 'generate image'
];

function isImageEditRequest(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  return IMAGE_EDIT_KEYWORDS.some(kw => lower.includes(kw));
}

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
  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, editInstruction);

  console.log(`[Image-to-Image Engine]: Analyzing reference image & edit request: "${editInstruction}" (Size: ${dimensions})`);

  const VISION_SYSTEM_PROMPT = `You are AZURA's Master AI Vision & Image Editing Architect.
Your role is to perform deep visual comprehension of the provided reference image and synthesize a master prompt for image generation that perfectly merges the original image's identity with the user's edit commands.

Follow these 3 steps:
1. VISUAL IDENTIFICATION: Carefully analyze the reference image (subject, facial features, pose, lighting, camera angle, clothing, background).
2. INTENT & MODIFICATION EXTRACTION: Parse the user's edit instruction (style transformation, adding/removing objects, changing hair/outfit/background/expression, manipulating visual situations).
3. MASTER SYNTHESIS: Write a comprehensive, ultra-descriptive English prompt for image generation that maintains the visual identity while applying all requested edits seamlessly.

OUTPUT ONLY THE REFINED ENGLISH PROMPT TEXT. NO PREAMBLE.`;

  const visionMessages = [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Reference image attached. User's edit instruction: "${editInstruction || 'Enhance and recreate this image with high detail'}". Perform deep visual analysis and synthesize the prompt.` },
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
        [vm.tokenParam]: 500
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

  let sanitizedPrompt = (visionResponse.choices[0].message.content.trim() || editInstruction)
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

/**
 * Text-to-Image Generation with gpt-image-2 (fallback dall-e-3)
 */
async function generateImage(prompt, aspectRatio = '') {
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
  parseImageDimensions
};
