const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  // Credentials (strictly loaded from .env)
  DISCORD_TOKEN: (process.env.DISCORD_TOKEN || '').trim(),
  DISCORD_CLIENT_ID: (process.env.DISCORD_CLIENT_ID || '').trim(),
  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
  OWNER_DISCORD_ID: (process.env.OWNER_DISCORD_ID || '').trim(),
  ELEVENLABS_API_KEY: (process.env.ELEVENLABS_API_KEY || '').trim(),
  ELEVENLABS_VOICE_ID: (process.env.ELEVENLABS_VOICE_ID || 'd15jrIAARvF899pDoC6T').trim(),
  TAVILY_API_KEY: (process.env.TAVILY_API_KEY || '').trim(),

  // AI Model Configuration
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  IMAGE_MODEL: process.env.IMAGE_MODEL || 'gpt-image-2',

  // Cost & Performance Parameters
  MAX_OUTPUT_TOKENS: parseInt(process.env.MAX_OUTPUT_TOKENS || '50000', 10),
  MAX_CONTEXT_TOKENS: parseInt(process.env.MAX_CONTEXT_TOKENS || '100000', 10),
  MAX_INPUT_TOKENS: parseInt(process.env.MAX_INPUT_TOKENS || '50000', 10),
  MAX_CONTEXT_MESSAGES: parseInt(process.env.MAX_CONTEXT_MESSAGES || '50', 10),
  RATE_LIMIT_COOLDOWN_MS: parseInt(process.env.RATE_LIMIT_COOLDOWN_MS || '300', 10), // 300ms (< 0.5s cooldown)
  STANDBY_DELAY_MS: parseInt(process.env.STANDBY_DELAY_MS || '300000', 10), // Default 5 menit (300,000 ms)
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
