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

/**
 * Detect if a prompt with an attached image is requesting an image-to-image edit
 * @param {string} prompt 
 * @returns {boolean}
 */
function isImageEditRequest(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  return IMAGE_EDIT_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Detect if a prompt in chat is requesting to generate a new image
 * @param {string} prompt 
 * @returns {boolean}
 */
function isImageGenRequest(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  return IMAGE_GEN_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Map aspect ratio string/option or prompt keywords to image size
 * Supported sizes: '1024x1024' (square), '1792x1024' (landscape), '1024x1792' (portrait)
 * @param {string} [aspectRatioOption] - Explicit aspect ratio ('square', 'landscape', 'portrait')
 * @param {string} [prompt] - User prompt to detect keywords
 * @returns {string} - '1024x1024' | '1792x1024' | '1024x1792'
 */
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
 * Generate image using gpt-image-2 model with fallback to dall-e-3
 * @param {object} openai - OpenAI client instance
 * @param {string} prompt - Sanitized prompt text
 * @param {string} dimensions - Image dimensions (e.g. '1024x1024')
 * @param {string} logPrefix - Log prefix for console output
 * @returns {Promise<object>} - Image response from OpenAI API
 */
async function requestImageGeneration(openai, prompt, dimensions, logPrefix = '[Image Generation]') {
  const imageModels = [config.IMAGE_MODEL || 'gpt-image-2', 'dall-e-3'];
  let imageResponse = null;
  let lastImgErr = null;

  for (const imgModel of imageModels) {
    try {
      console.log(`${logPrefix}: Requesting model API: ${imgModel} (size: ${dimensions})...`);
      const payload = {
        model: imgModel,
        prompt: prompt,
        n: 1,
        size: dimensions
      };
      // dall-e-3 specific settings
      if (imgModel === 'dall-e-3') payload.quality = 'standard';

      imageResponse = await openai.images.generate(payload);
      if (imageResponse?.data?.[0]) {
        console.log(`${logPrefix} Success: Model (${imgModel}) successfully rendered image!`);
        break; // Success!
      }
    } catch (err) {
      lastImgErr = err;
      console.warn(`${logPrefix} Model ${imgModel} Failed: ${err.message}`);
    }
  }

  if (!imageResponse?.data?.[0]) {
    throw new Error(`Gagal menghasilkan gambar (${lastImgErr?.message || 'API Error'})`);
  }

  return imageResponse;
}

/**
 * Image-to-Image / Reference-Based Image Editing
 * Uses gpt-5.6-luna Vision to analyze the original reference image and synthesize
 * a precise prompt for gpt-image-2 incorporating the user's requested modifications.
 * 
 * Supports: art style transformation, object addition/removal, background manipulation,
 * visual situation changes, outfit/expression edits, and more.
 * 
 * @param {string} imageUrl - Reference image URL
 * @param {string} editInstruction - User's edit prompt
 * @param {string} [aspectRatio] - 'square' | 'landscape' | 'portrait'
 * @returns {Promise<{ generatedImageUrl: string, revisedPrompt: string, synthesizedPrompt: string, dimensions: string }>}
 */
async function editReferenceImage(imageUrl, editInstruction, aspectRatio = '') {
  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, editInstruction);

  console.log(`[Image-to-Image Engine]: Analyzing reference image & edit request: "${editInstruction}" (Size: ${dimensions})`);

  // Step 1: Vision Analysis & Prompt Synthesis using gpt-5.6-luna (with gpt-4o fallback)
  const VISION_SYSTEM_PROMPT = `You are AZURA's Master AI Vision & Image Editing Architect.
Your role is to perform deep visual comprehension of the provided reference image and synthesize a master prompt for image generation that perfectly merges the original image's identity with the user's edit commands.

Follow these 3 steps in your prompt synthesis:
1. VISUAL IDENTIFICATION: Carefully analyze the reference image (subject, facial features, pose, lighting, camera angle, clothing, and background environment).
2. INTENT & MODIFICATION EXTRACTION: Parse the user's edit instruction (e.g., style transformation like anime/cyberpunk/3D/realistic, adding/removing objects, changing hair/outfit/background/expression, manipulating visual situations).
3. MASTER SYNTHESIS: Write a comprehensive, ultra-descriptive English prompt for image generation that maintains the visual identity, subject features, and camera angle of the reference photo while applying all requested edits seamlessly.

OUTPUT ONLY THE REFINED ENGLISH PROMPT TEXT. DO NOT INCLUDE ANY PREAMBLE OR INTRO.`;

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

  // Clean & sanitize synthesized prompt (max 4000 chars for gpt-image-2)
  let sanitizedPrompt = (visionResponse.choices[0].message.content.trim() || editInstruction)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 4000);

  console.log(`[Image-to-Image Engine]: Synthesized Prompt (${sanitizedPrompt.length} chars): "${sanitizedPrompt.slice(0, 100)}..."`);

  // Step 2: Generate edited image with gpt-image-2 (fallback dall-e-3)
  const imageResponse = await requestImageGeneration(openai, sanitizedPrompt, dimensions, '[Image-to-Image]');

  const generatedImageUrl = imageResponse.data[0].url || imageResponse.data[0].b64_json;
  const revisedPrompt = imageResponse.data[0].revised_prompt || sanitizedPrompt;

  return {
    generatedImageUrl,
    revisedPrompt,
    synthesizedPrompt: sanitizedPrompt,
    dimensions
  };
}

/**
 * Text-to-Image Generation with gpt-image-2 model (fallback dall-e-3)
 * @param {string} prompt 
 * @param {string} [aspectRatio] - 'square' | 'landscape' | 'portrait'
 * @returns {Promise<{ generatedImageUrl: string, revisedPrompt: string, dimensions: string }>}
 */
async function generateImage(prompt, aspectRatio = '') {
  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, prompt);
  const sanitizedPrompt = (prompt || 'A beautiful digital artwork').replace(/[\r\n]+/g, ' ').slice(0, 4000);

  const imageResponse = await requestImageGeneration(openai, sanitizedPrompt, dimensions, '[Text-to-Image]');

  return {
    generatedImageUrl: imageResponse.data[0].url || imageResponse.data[0].b64_json,
    revisedPrompt: imageResponse.data[0].revised_prompt || sanitizedPrompt,
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
