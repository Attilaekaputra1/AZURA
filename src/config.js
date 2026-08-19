const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  // Credentials
  DISCORD_TOKEN: (process.env.DISCORD_TOKEN || '').trim(),
  DISCORD_CLIENT_ID: (process.env.DISCORD_CLIENT_ID || '').trim(),
  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
  OWNER_DISCORD_ID: (process.env.OWNER_DISCORD_ID || '').trim(),
  TAVILY_API_KEY: (process.env.TAVILY_API_KEY || '').trim(),

  // AI Model Configuration
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o',

  // Cost & Performance Parameters
  MAX_OUTPUT_TOKENS: parseInt(process.env.MAX_OUTPUT_TOKENS || '300', 10),
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
