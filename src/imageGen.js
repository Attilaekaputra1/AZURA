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
  'modifikasi', 'warnai', 'variasi', 'remake'
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
 * Map aspect ratio string/option or prompt keywords to DALL-E image size
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
 * Image-to-Image / Reference-Based Image Editing
 * Uses GPT-4o Vision to analyze the original reference image and synthesize a precise DALL-E 3 prompt
 * incorporating the user's requested modifications.
 * 
 * @param {string} imageUrl - Reference image URL
 * @param {string} editInstruction - User's edit prompt (e.g. "ubah style ke anime", "tambahkan kacamata hitam")
 * @param {string} [aspectRatio] - 'square' | 'landscape' | 'portrait'
 * @returns {Promise<{ generatedImageUrl: string, revisedPrompt: string, synthesizedPrompt: string, dimensions: string }>}
 */
async function editReferenceImage(imageUrl, editInstruction, aspectRatio = '') {
  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, editInstruction);

  console.log(`[Image-to-Image Engine]: Analyzing reference image & edit request: "${editInstruction}" (Size: ${dimensions})`);

  // Step 1: Vision Analysis & Prompt Synthesis (with fallback)
  let visionResponse;
  const primaryVisionModel = config.OPENAI_MODEL || 'gpt-5.6-luna';
  try {
    visionResponse = await openai.chat.completions.create({
      model: primaryVisionModel,
      messages: [
        {
          role: 'system',
          content: `You are an expert AI Image Editing Prompt Engineer. Your task is to analyze the provided reference image and the user's requested edit instruction. Create a detailed, high-quality DALL-E prompt in English that preserves the subject, pose, facial structure, composition, and key details of the reference image while precisely applying the user's requested changes. Return ONLY the refined prompt text.`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Reference image attached. User's edit instruction: "${editInstruction || 'Enhance and recreate this image with high detail'}". Describe how to recreate this image with the requested edits.` },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 300
    });
  } catch (visionErr) {
    console.warn(`[Image-to-Image Vision Fallback]: Model ${primaryVisionModel} failed (${visionErr.message}). Retrying with gpt-4o...`);
    visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert AI Image Editing Prompt Engineer. Your task is to analyze the provided reference image and the user's requested edit instruction. Create a detailed, high-quality DALL-E prompt in English that preserves the subject, pose, facial structure, composition, and key details of the reference image while precisely applying the user's requested changes. Return ONLY the refined prompt text.`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Reference image attached. User's edit instruction: "${editInstruction || 'Enhance and recreate this image with high detail'}". Describe how to recreate this image with the requested edits.` },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 300
    });
  }

  const synthesizedPrompt = visionResponse.choices[0]?.message?.content?.trim() || editInstruction;
  console.log(`[Image-to-Image Engine]: Synthesized Prompt: "${synthesizedPrompt.slice(0, 100)}..."`);

  // Step 2: Generate edited image with fallback models
  let imageResponse;
  const imageModels = ['gpt-image-2.0', 'gpt-image-2', 'dall-e-3'];
  let lastImgErr = null;

  for (const imgModel of imageModels) {
    try {
      console.log(`[Image Generation]: Attempting model: ${imgModel} (size: ${dimensions})...`);
      const payload = {
        model: imgModel,
        prompt: synthesizedPrompt,
        n: 1,
        size: dimensions
      };
      if (imgModel === 'dall-e-3') payload.quality = 'standard';

      imageResponse = await openai.images.generate(payload);
      if (imageResponse?.data?.[0]?.url) {
        console.log(`[Image Generation Success]: Model (${imgModel}) successfully generated image!`);
        break; // Success!
      }
    } catch (err) {
      lastImgErr = err;
      console.warn(`[Image Generation Model ${imgModel} Failed]: ${err.message}`);
    }
  }

  if (!imageResponse?.data?.[0]?.url) {
    throw new Error(`Gagal menghasilkan gambar: ${lastImgErr?.message || 'Unknown error'}`);
  }

  const generatedImageUrl = imageResponse.data[0].url;
  const revisedPrompt = imageResponse.data[0].revised_prompt || synthesizedPrompt;

  return {
    generatedImageUrl,
    revisedPrompt,
    synthesizedPrompt,
    dimensions
  };
}

/**
 * Text-to-Image Generation with silent fallback and dynamic aspect ratio
 * @param {string} prompt 
 * @param {string} [aspectRatio] - 'square' | 'landscape' | 'portrait'
 * @returns {Promise<{ generatedImageUrl: string, revisedPrompt: string, dimensions: string }>}
 */
async function generateImage(prompt, aspectRatio = '') {
  const openai = getOpenAI();
  const dimensions = parseImageDimensions(aspectRatio, prompt);

  let imageResponse;
  const imageModels = ['gpt-image-2.0', 'gpt-image-2', 'dall-e-3'];
  let lastImgErr = null;

  for (const imgModel of imageModels) {
    try {
      console.log(`[Text-to-Image]: Attempting model: ${imgModel} (size: ${dimensions})...`);
      const payload = {
        model: imgModel,
        prompt: prompt,
        n: 1,
        size: dimensions
      };
      if (imgModel === 'dall-e-3') payload.quality = 'standard';

      imageResponse = await openai.images.generate(payload);
      if (imageResponse?.data?.[0]?.url) {
        console.log(`[Text-to-Image Success]: Model (${imgModel}) successfully generated image!`);
        break;
      }
    } catch (err) {
      lastImgErr = err;
      console.warn(`[Text-to-Image Model ${imgModel} Failed]: ${err.message}`);
    }
  }

  if (!imageResponse?.data?.[0]?.url) {
    throw new Error(`Gagal menghasilkan gambar: ${lastImgErr?.message || 'Unknown error'}`);
  }

  return {
    generatedImageUrl: imageResponse.data[0].url,
    revisedPrompt: imageResponse.data[0].revised_prompt || prompt,
    dimensions
  };
}

module.exports = {
  isImageEditRequest,
  editReferenceImage,
  generateImage,
  parseImageDimensions
};
