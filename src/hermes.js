const { exec } = require('child_process');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { OpenAI } = require('openai');
const config = require('./config');

// Destructive command blacklist for security shield
const BLACKLISTED_COMMAND_PATTERNS = [
  /\brm\s+-[rfR]+\s+[\/~]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i, // Fork bomb
  /\b(?:shutdown|reboot|poweroff|init\s+0|init\s+6)\b/i,
  /\bsystemctl\s+(?:stop|disable)\s+(?:ssh|sshd|networking|ufw)\b/i,
  /\bufw\s+disable\b/i,
  /\bchmod\s+-[rR]+\s+000\b/i,
  />\s*\/dev\/[sh]da/i
];

let _openai = null;
function getOpenAIClient() {
  if (!_openai && config.OPENAI_API_KEY) {
    _openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return _openai;
}

/**
 * Check health status of Hermes Agent on the VPS
 * @returns {Promise<{ available: boolean, version?: string, binaryPath?: string }>}
 */
function checkHermesStatus() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const checkCmd = isWin ? 'where hermes' : 'which hermes 2>/dev/null';
    exec(checkCmd, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve({ available: false, version: 'Offline / Fallback to Cloud Agent' });
      }
      const binaryPath = stdout.trim().split('\n')[0].trim();
      exec('hermes --version 2>/dev/null || echo "Hermes Agent v1.0"', { timeout: 3000 }, (vErr, vOut) => {
        resolve({
          available: true,
          binaryPath: binaryPath,
          version: (vOut || '').trim() || 'Hermes Agent Active'
        });
      });
    });
  });
}

/**
 * Execute an autonomous task via Hermes Agent on the VPS with fallback
 * @param {string} taskPrompt The instruction/task to execute
 * @param {string} userId Discord user ID
 * @param {string} userName Discord user display name
 * @returns {Promise<{ success: boolean, payload: any }>}
 */
async function executeHermesTask(taskPrompt, userId, userName = 'Attila') {
  const isOwner = config.OWNER_DISCORD_ID && userId === config.OWNER_DISCORD_ID;

  // 1. STRICT OWNER GUARD: Only Attila has permission to run Hermes Agent tasks
  if (!isOwner) {
    console.warn(`[Hermes Security]: Unauthorized agent task attempt by user ID ${userId} (${userName}).`);
    return {
      success: false,
      payload: {
        embeds: [
          new EmbedBuilder()
            .setTitle('⛔ Akses Terbatas (Owner Only)')
            .setColor(0xED4245)
            .setDescription(`Maaf **${userName}**, fitur eksekusi **Hermes Autonomous Agent** di VPS ini secara eksklusif hanya dapat diakses oleh **Attila** (Bot Owner) demi keamanan server.`)
            .setFooter({ text: 'AZURA Security Shield • Access Denied' })
            .setTimestamp()
        ]
      }
    };
  }

  // 2. ANTI-DESTRUCTIVE COMMAND SHIELD: Block dangerous bash execution
  for (const pattern of BLACKLISTED_COMMAND_PATTERNS) {
    if (pattern.test(taskPrompt)) {
      console.warn(`[Hermes Security]: Blocked destructive command pattern in prompt: "${taskPrompt}"`);
      return {
        success: false,
        payload: {
          embeds: [
            new EmbedBuilder()
              .setTitle('🛡️ Perintah Diblokir oleh Security Shield')
              .setColor(0xED4245)
              .setDescription(`Perintah yang diminta mengandung pola yang berbahaya atau dapat merusak sistem operasi VPS.\n\n>>> \`${taskPrompt}\`\n\nEksekusi otomatis dibatalkan oleh protokol keamanan AZURA.`)
              .setFooter({ text: 'AZURA Security Shield • Command Intercepted' })
              .setTimestamp()
          ]
        }
      };
    }
  }

  const startTime = Date.now();
  console.log(`[Hermes Agent]: Executing task for ${userName}: "${taskPrompt.slice(0, 80)}..."`);

  // 3. ATTEMPT LOCAL HERMES CLI EXECUTION
  try {
    const status = await checkHermesStatus();

    if (status.available) {
      const sanitizedPrompt = taskPrompt.replace(/"/g, '\\"');
      const hermesPromise = new Promise((resolve, reject) => {
        // Run hermes with safe timeout of 35 seconds
        exec(`hermes run "${sanitizedPrompt}" 2>&1 || hermes "${sanitizedPrompt}" 2>&1`, { timeout: 35000 }, (err, stdout, stderr) => {
          const output = (stdout || stderr || '').trim();
          if (output && output.length > 5 && !output.includes('command not found')) {
            resolve({ output, modelUsed: status.version });
          } else {
            reject(new Error(output || 'Hermes CLI returned empty output'));
          }
        });
      });

      const localResult = await hermesPromise.catch(() => null);
      if (localResult && localResult.output) {
        const durationMs = Date.now() - startTime;
        const embed = buildAgentEmbed(taskPrompt, localResult.output, durationMs, localResult.modelUsed);
        return { success: true, payload: { embeds: [embed] } };
      }
    }
  } catch (localErr) {
    console.warn('[Hermes Agent]: Local execution failed, switching to Cloud Agent Engine:', localErr.message);
  }

  // 4. CLOUD AGENT ENGINE FALLBACK (OpenAI GPT-5.6-Luna Agent Mode)
  try {
    const openai = getOpenAIClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY tidak tersedia untuk fallback agent.');
    }

    const agentRes = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `Kamu adalah HERMES AGENT & AZURA AUTONOMOUS TASK ENGINE.
Tugasmu adalah menganalisis, merancang solusi, atau mengeksekusi instruksi teknis dari Attila (Creator & Owner kamu).
Berikan output terstruktur, jelas, akurat, dan solutif.
Gunakan format markdown yang rapi dengan ringkasan eksekutif dan detail langkah jika relevan.`
        },
        { role: 'user', content: taskPrompt }
      ],
      max_completion_tokens: 1200
    });

    const durationMs = Date.now() - startTime;
    const aiOutput = agentRes.choices[0]?.message?.content?.trim() || 'Tugas telah selesai diproses.';
    const embed = buildAgentEmbed(taskPrompt, aiOutput, durationMs, `${config.OPENAI_MODEL} (Cloud Agent Fallback)`);

    return { success: true, payload: { embeds: [embed] } };
  } catch (cloudErr) {
    console.error('[Hermes Fallback Error]:', cloudErr.message);
    return {
      success: false,
      payload: `Gagal menjalankan tugas agent: ${cloudErr.message}`
    };
  }
}

/**
 * Build a sleek Discord Embed for Hermes Agent execution output
 */
function buildAgentEmbed(taskPrompt, output, durationMs, modelUsed) {
  const durationSec = (durationMs / 1000).toFixed(2);
  let cleanOutput = output.trim();
  if (cleanOutput.length > 3800) {
    cleanOutput = cleanOutput.slice(0, 3800) + '\n\n*(Output dipotong agar muat di limit Discord)*';
  }

  return new EmbedBuilder()
    .setTitle('⚡ Hermes Autonomous Agent Output')
    .setColor(0x10B981) // Emerald Green for Agent success
    .setDescription(`**📋 Tugas / Instruksi:**\n>>> ${taskPrompt.slice(0, 300)}\n\n**📊 Hasil Eksekusi & Analisis:**\n${cleanOutput}`)
    .addFields(
      { name: '⏱️ Durasi Eksekusi', value: `\`${durationSec}s\``, inline: true },
      { name: '🤖 Model Engine', value: `\`${modelUsed || 'Hermes Agent'}\``, inline: true },
      { name: '🔒 Security Level', value: '`Owner Verified (Attila)`', inline: true }
    )
    .setFooter({ text: 'AZURA × Hermes Autonomous Agent • VPS Integration' })
    .setTimestamp();
}

module.exports = {
  checkHermesStatus,
  executeHermesTask,
  buildAgentEmbed
};
