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
 * Image-to-Image / Reference-Based Image Editing
 * Uses GPT-4o Vision to analyze the original reference image and synthesize a precise DALL-E 3 prompt
 * incorporating the user's requested modifications.
 * 
 * @param {string} imageUrl - Reference image URL
 * @param {string} editInstruction - User's edit prompt (e.g. "ubah style ke anime", "tambahkan kacamata hitam")
 * @returns {Promise<{ generatedImageUrl: string, revisedPrompt: string, synthesizedPrompt: string }>}
 */
async function editReferenceImage(imageUrl, editInstruction) {
  const openai = getOpenAI();

  console.log(`[Image-to-Image Engine]: Analyzing reference image & edit request: "${editInstruction}"`);

  // Step 1: Vision Analysis & Prompt Synthesis
  const visionResponse = await openai.chat.completions.create({
    model: config.OPENAI_MODEL || 'gpt-5.6-luna',
    messages: [
      {
        role: 'system',
        content: `You are an expert AI Image Editing Prompt Engineer. Your task is to analyze the provided reference image and the user's requested edit instruction. Create a detailed, high-quality DALL-E 3 prompt in English that preserves the subject, pose, facial structure, composition, and key details of the reference image while precisely applying the user's requested changes. Return ONLY the refined prompt text.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Reference image attached. User's edit instruction: "${editInstruction || 'Enhance and recreate this image with high detail'}". Describe how to recreate this image with the requested edits in DALL-E 3.` },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
        ]
      }
    ],
    max_tokens: 300
  });

  const synthesizedPrompt = visionResponse.choices[0]?.message?.content?.trim() || editInstruction;
  console.log(`[Image-to-Image Engine]: Synthesized DALL-E 3 Prompt: "${synthesizedPrompt.slice(0, 100)}..."`);

  // Step 2: Generate edited image via GPT Image 2
  const imageResponse = await openai.images.generate({
    model: 'gpt-image-2',
    prompt: synthesizedPrompt,
    n: 1,
    size: '1024x1024'
  });

  const generatedImageUrl = imageResponse.data[0]?.url;
  const revisedPrompt = imageResponse.data[0]?.revised_prompt || synthesizedPrompt;

  return {
    generatedImageUrl,
    revisedPrompt,
    synthesizedPrompt
  };
}

/**
 * Text-to-Image Generation (GPT Image 2)
 * @param {string} prompt 
 * @returns {Promise<{ generatedImageUrl: string, revisedPrompt: string }>}
 */
async function generateImage(prompt) {
  const openai = getOpenAI();
  const imageResponse = await openai.images.generate({
    model: 'gpt-image-2',
    prompt: prompt,
    n: 1,
    size: '1024x1024'
  });

  return {
    generatedImageUrl: imageResponse.data[0]?.url,
    revisedPrompt: imageResponse.data[0]?.revised_prompt || prompt
  };
}

module.exports = {
  isImageEditRequest,
  editReferenceImage,
  generateImage
};
