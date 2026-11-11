const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  // Credentials (loaded strictly from .env)
  DISCORD_TOKEN: (process.env.DISCORD_TOKEN || '').trim(),
  DISCORD_CLIENT_ID: (process.env.DISCORD_CLIENT_ID || '').trim(),
  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
  GROQ_API_KEY: (process.env.GROQ_API_KEY || '').trim(),
  OWNER_DISCORD_ID: (process.env.OWNER_DISCORD_ID || process.env.OWNER_ID || '').trim(),
  OWNER_ID: (process.env.OWNER_DISCORD_ID || process.env.OWNER_ID || '').trim(),
  ELEVENLABS_API_KEY: (process.env.ELEVENLABS_API_KEY || '').trim(),
  ELEVENLABS_VOICE_ID: (process.env.ELEVENLABS_VOICE_ID || 'd15jrIAARvF899pDoC6T').trim(), // Kak Ceria
  ELEVENLABS_MODEL_ID: (process.env.ELEVENLABS_MODEL_ID || 'eleven_v3').trim(),
  INDONESIAN_FEMALE_FALLBACK_VOICE: (process.env.INDONESIAN_FEMALE_FALLBACK_VOICE || 'gadis_cute').trim(), // gadis_cute | siti_mature | gadis_natural | openai_shimmer | openai_nova
  VTUBER_VOICE_MODE: (process.env.VTUBER_VOICE_MODE || 'openai_shimmer').trim(),
  TAVILY_API_KEY: (process.env.TAVILY_API_KEY || '').trim(),
  DATABASE_ENCRYPTION_KEY: (process.env.DATABASE_ENCRYPTION_KEY || '').trim(),
  MASTER_SECURITY_PASSWORD: (process.env.MASTER_SECURITY_PASSWORD || '').trim(),
  SESSION_SIGNING_KEY: (process.env.SESSION_SIGNING_KEY || '').trim(),
  STREAMER_USER_TOKEN: (process.env.STREAMER_USER_TOKEN || '').trim(),
  VIDEO_INTRO_PATH: path.join(__dirname, '../assets/videos/cam_intro.mp4'),
  VIDEO_LOOP_PATH: path.join(__dirname, '../assets/videos/cam_loop.mp4'),

  // AI Model Configuration
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  IMAGE_MODEL: process.env.IMAGE_MODEL || 'gpt-image-2',
  AZURA_VOICE_ENGINE: (process.env.AZURA_VOICE_ENGINE || 'legacy').trim().toLowerCase(),
  AZURA_VOICE_ADAPTIVE_BUDGET: (process.env.AZURA_VOICE_ADAPTIVE_BUDGET === 'true'),

  // Cost & Performance Parameters
  MAX_OUTPUT_TOKENS: parseInt(process.env.MAX_OUTPUT_TOKENS || '50000', 10),
  MAX_CONTEXT_TOKENS: parseInt(process.env.MAX_CONTEXT_TOKENS || '100000', 10),
  MAX_INPUT_TOKENS: parseInt(process.env.MAX_INPUT_TOKENS || '50000', 10),
  MAX_CONTEXT_MESSAGES: parseInt(process.env.MAX_CONTEXT_MESSAGES || '50', 10),
  RATE_LIMIT_COOLDOWN_MS: parseInt(process.env.RATE_LIMIT_COOLDOWN_MS || '300', 10),
  STANDBY_DELAY_MS: parseInt(process.env.STANDBY_DELAY_MS || '300000', 10),
  MONTHLY_BUDGET_TARGET: parseFloat(process.env.MONTHLY_BUDGET_TARGET || '5'),

  // Validation function
  validate() {
    const missing = [];
    if (!this.DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
    if (!this.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
    if (!this.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
    return missing;
  }
};

module.exports = config;
