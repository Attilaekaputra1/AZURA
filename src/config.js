const path = require('path');

// Load environment variables from .env file
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
} catch (_) {}

const config = {
  // Credentials
  DISCORD_TOKEN: (process.env.DISCORD_TOKEN || '').trim(),
  DISCORD_CLIENT_ID: (process.env.DISCORD_CLIENT_ID || '').trim(),
  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
  OWNER_DISCORD_ID: (process.env.OWNER_DISCORD_ID || '').trim(),
  TAVILY_API_KEY: (process.env.TAVILY_API_KEY || '').trim(),
  ELEVENLABS_API_KEY: (process.env.ELEVENLABS_API_KEY || 'sk_a4c26e321b7abf0f20320d5ddd09e51a06bca2369ca5e328').trim(),
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'd15jrIAARvF899pDoC6T', // Kak Ceria (Indonesian cheerful female)

  // AI Model Configuration
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  IMAGE_MODEL: process.env.IMAGE_MODEL || 'gpt-image-2',

  // Cost & Performance Parameters
  MAX_OUTPUT_TOKENS: parseInt(process.env.MAX_OUTPUT_TOKENS || '50000', 10),
  MAX_CONTEXT_MESSAGES: parseInt(process.env.MAX_CONTEXT_MESSAGES || '10', 10),
  RATE_LIMIT_COOLDOWN_MS: parseInt(process.env.RATE_LIMIT_COOLDOWN_MS || '500', 10),
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
