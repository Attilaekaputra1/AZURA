/**
 * AZURA Voice-to-DM Encouragement Subsystem
 * 
 * Features:
 * 1. Owner can speak in VC to send personalized DM + Voice Note to any registered member.
 * 2. Phonetic nickname / alias / calling name resolution from user_vault.enc and server members.
 * 3. Immediate verbal acknowledgment in VC ("Tunggu sebentar yaa...").
 * 4. Generates personalized text message (Max 400 chars) and Kak Ceria Voice Note (Max 200 chars).
 * 5. Real-time delivery confirmation:
 *    - Speaks in VC if Owner is still present in Voice Channel.
 *    - Sends DM report to Owner if Owner has left VC.
 */

const { OpenAI } = require('openai');
const config = require('./config');
const { generateVoiceNote } = require('./tts');
const { getAllUsersList, getUserRecord } = require('./vault');

const MAX_TEXT_CHARS = 400;
const MAX_VN_CHARS = 200;

/**
 * Resolve target member and reason from voice transcript
 * @param {string} transcript 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<{ targetUser: import('discord.js').User, targetMember?: import('discord.js').GuildMember, targetName: string, contextReason: string }|null>}
 */
async function resolveTargetFromTranscript(transcript, client) {
  if (!transcript || typeof transcript !== 'string') return null;
  const cleanTranscript = transcript.toLowerCase();

  // 1. Gather all candidates from User Vault Database
  const vaultUsers = getAllUsersList();
  const candidates = [];

  for (const u of vaultUsers) {
    if (u.knownRealName) {
      candidates.push({ name: u.knownRealName.toLowerCase(), rawName: u.knownRealName, userId: u.userId });
      const parts = u.knownRealName.split(/\s+/).filter(p => p.length >= 3);
      for (const p of parts) {
        candidates.push({ name: p.toLowerCase(), rawName: u.knownRealName, userId: u.userId });
      }
    }
    if (u.displayName) {
      candidates.push({ name: u.displayName.toLowerCase(), rawName: u.displayName, userId: u.userId });
      const parts = u.displayName.split(/\s+/).filter(p => p.length >= 3);
      for (const p of parts) {
        candidates.push({ name: p.toLowerCase(), rawName: u.displayName, userId: u.userId });
      }
    }
    if (u.username) {
      candidates.push({ name: u.username.toLowerCase(), rawName: u.username, userId: u.userId });
    }
  }

  // 2. Gather active members across all connected Discord servers
  if (client?.guilds?.cache) {
    for (const guild of client.guilds.cache.values()) {
      if (guild.members?.cache) {
        for (const member of guild.members.cache.values()) {
          if (member.user.bot) continue;
          if (member.displayName) {
            candidates.push({ name: member.displayName.toLowerCase(), rawName: member.displayName, userId: member.user.id });
            const parts = member.displayName.split(/\s+/).filter(p => p.length >= 3);
            for (const p of parts) {
              candidates.push({ name: p.toLowerCase(), rawName: member.displayName, userId: member.user.id });
            }
          }
          if (member.user.username) {
            candidates.push({ name: member.user.username.toLowerCase(), rawName: member.user.username, userId: member.user.id });
          }
        }
      }
    }
  }

  // Sort candidates by name length descending to match longest specific alias first
  candidates.sort((a, b) => b.name.length - a.name.length);

  for (const cand of candidates) {
    // Avoid single-character or generic stop words
    if (cand.name.length < 2) continue;
    if (['azura', 'ara', 'zura', 'ajur', 'ajura', 'attila', 'putra', 'kamu', 'aku', 'saya', 'member', 'user'].includes(cand.name)) continue;

    // Check whole-word or substring match
    const regex = new RegExp(`\\b${cand.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(cleanTranscript) || cleanTranscript.includes(cand.name)) {
      try {
        const targetUser = await client.users.fetch(cand.userId).catch(() => null);
        if (targetUser) {
          // Extract context reason by stripping trigger phrases
          let contextReason = transcript
            .replace(new RegExp(`\\b${cand.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '')
            .replace(/\b(?:azura|ara|zura|ajur|ajura|kak\s+azura|kak\s+ara|kak\s+ajur)?\s*(?:tolong\s+|coba\s+|minta\s+|tolongin\s+)?(?:kirim\s+|buatkan\s+|bikin\s+|sampaikan\s+|semangatin|hibur|temenin)?\s*(?:ke|di\s+dm|lewat\s+dm|dm)?\s*/gi, '')
            .replace(/\b(?:ya|yaa|dong|plis|please|makasih|makasih\s+ara|terima\s+kasih)\b/gi, '')
            .trim();

          if (!contextReason || contextReason.length < 3) {
            contextReason = `Memberikan dukungan semangat dan motivasi hangat untuk ${cand.rawName}`;
          }

          return {
            targetUser,
            targetName: cand.rawName,
            contextReason
          };
        }
      } catch (_) {}
    }
  }

  return null;
}

/**
 * Generate AI personalized encouragement message and Voice Note script
 * @param {string} targetName 
 * @param {string} contextReason 
 * @returns {Promise<{ textMessage: string, vnScript: string }>}
 */
async function generateEncouragementContent(targetName, contextReason) {
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const systemPrompt = `Kamu adalah AZURA, asisten AI cewek Gen Z berumur 22 tahun yang cerdas, manis, ramah, dan sangat peduli.
Creatormu (Attila / Putra) sedang berada di Voice Channel dan meminta tolong kepadamu untuk mengirimkan pesan motivasi, semangat, dan dukungan hangat ke DM teman / member bernama "${targetName}".
Konteks / Keadaan dari Attila: "${contextReason}".

TUGAS UTAMA:
Buatkan 2 konten penyemangat yang berbeda:
1. PESAN TEKS DM (Maksimal 400 karakter): Teks hangat, tulus, dan ramah khas Gen Z. Sampaikan bahwa Attila tadi cerita dan minta Azura buat semangatin dia. Berikan kata-kata motivasi positif. (WAJIB <= 400 karakter).
2. SCRIPT VOICE NOTE (Maksimal 200 karakter): Kalimat yang akan dibacakan langsung oleh suara ceria Azura di rekaman VN. Ringkas, manis, hidup, menyemangati secara langsung. (WAJIB <= 200 karakter).

Format Output JSON persis:
{
  "textMessage": "...",
  "vnScript": "..."
}`;

  try {
    const res = await openai.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Buatkan pesan teks DM (maks 400 kar) dan script VN (maks 200 kar) untuk ${targetName}:` }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 300
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    let textMessage = (parsed.textMessage || `Hai ${targetName}! Tadi Attila nitip pesan ke aku buat semangatin kamu nih. Apapun yang lagi dihadapi, jangan lupa istirahat dan tetap semangat yaa! ✨`).slice(0, MAX_TEXT_CHARS);
    let vnScript = (parsed.vnScript || `Hai ${targetName}! Semangat terus yaa, we always root for you!`).slice(0, MAX_VN_CHARS);

    return { textMessage, vnScript };
  } catch (err) {
    console.error('[Encouragement AI Generator Error]:', err.message);
    return {
      textMessage: `Hai ${targetName}! Tadi si Bos Attila nitip pesan ke aku buat semangatin kamu nih. Apapun yang lagi kamu hadapi, tetap semangat dan jangan lupa istirahat yaa! We always support you! 💖✨`.slice(0, MAX_TEXT_CHARS),
      vnScript: `Hai ${targetName}! Semangat terus yaa, jangan patah arang, we always root for you!`.slice(0, MAX_VN_CHARS)
    };
  }
}

/**
 * Handle Voice-to-DM Encouragement Dispatch from VC
 * @param {import('discord.js').Client} client 
 * @param {string} transcript 
 * @param {string} guildId 
 * @param {import('discord.js').VoiceChannel} voiceChannel 
 * @param {Function} playInVcFn 
 * @param {Function} textToAudioFn 
 * @param {Function} recordSessionFn 
 * @returns {Promise<boolean>}
 */
async function handleVoiceDmEncouragement(client, transcript, guildId, voiceChannel, playInVcFn, textToAudioFn, recordSessionFn) {
  const isDmEncouragementIntent =
    /\b(?:dm|pesan\s+(?:ke|buat)|semangatin|sampaikan\s+ke|kirim\s+(?:pesan\s+)?ke|hibur|temenin)\b/i.test(transcript) ||
    /\b(?:lagi\s+(?:sedih|capek|down|pusing|galau|lelah)|tolong\s+semangatin)\b/i.test(transcript);

  if (!isDmEncouragementIntent) return false;

  const resolved = await resolveTargetFromTranscript(transcript, client);
  if (!resolved) {
    return false;
  }

  const { targetUser, targetName, contextReason } = resolved;
  console.log(`[Voice DM]: 🎯 Target member resolved from VC speech: "${targetName}" (${targetUser.id}) | Context: "${contextReason}"`);

  // 1. Immediate Voice Acknowledgment in VC
  const ackSpoken = `Siap Attila! Tunggu sebentar yaa, aku siapin pesan semangat sama VN spesial buat ${targetName} sekarang juga! ✨`;
  if (recordSessionFn) recordSessionFn(guildId, 'AZURA', ackSpoken);
  const ackAudio = await textToAudioFn(ackSpoken, client);
  if (ackAudio) await playInVcFn(guildId, ackAudio);

  // 2. Asynchronous Background Generation and Delivery
  (async () => {
    try {
      const { textMessage, vnScript } = await generateEncouragementContent(targetName, contextReason);
      const vnAttachment = await generateVoiceNote(vnScript, client);

      const dmPayload = {
        content: `🌸 **[Pesan Hangat Dari Azura & Attila]** 🌸\n\n${textMessage}\n\n🎙️ *Voice Note dari Azura terlampir di bawah ini:*`,
        files: [vnAttachment]
      };

      await targetUser.send(dmPayload);
      console.log(`[Voice DM]: ✅ Successfully delivered DM and VN to ${targetName} (${targetUser.id})`);

      // 3. Real-Time Confirmation Back to Attila
      const isAttilaInVc = voiceChannel?.members ? voiceChannel.members.has(config.OWNER_DISCORD_ID) : false;

      if (isAttilaInVc) {
        // Confirmation out loud via VC Voice
        const confirmSpoken = `Attila, pesan semangat sama Voice Note udah sukses aku kirim ke DM-nya ${targetName} yaa! [laughs]`;
        if (recordSessionFn) recordSessionFn(guildId, 'AZURA', confirmSpoken);
        const confirmAudio = await textToAudioFn(confirmSpoken, client);
        if (confirmAudio) await playInVcFn(guildId, confirmAudio);
      } else {
        // Confirmation delivered to Attila's DM
        const ownerUser = await client.users.fetch(config.OWNER_DISCORD_ID);
        if (ownerUser) {
          await ownerUser.send({
            content: `✅ **[Laporan Voice Note & Pesan Terkirim]**\nAttila, pesan semangat dan Voice Note yang kamu minta tadi sudah berhasil aku kirimkan langsung ke DM-nya **${targetName}** yaa! 🌸✨\n\n📝 **Isi Pesan Teks (${textMessage.length}/${MAX_TEXT_CHARS} kar):**\n>>> ${textMessage}\n\n🎙️ **Script VN (${vnScript.length}/${MAX_VN_CHARS} kar):**\n>>> *"${vnScript}"*`
          });
        }
      }
    } catch (dmErr) {
      console.error('[Voice DM Delivery Error]:', dmErr.message);
      try {
        const ownerUser = await client.users.fetch(config.OWNER_DISCORD_ID);
        if (ownerUser) {
          ownerUser.send(`⚠️ Gagal mengirim DM ke **${targetName}**: ${dmErr.message}`).catch(() => {});
        }
      } catch (_) {}
    }
  })();

  return true;
}

module.exports = {
  resolveTargetFromTranscript,
  generateEncouragementContent,
  handleVoiceDmEncouragement,
  MAX_TEXT_CHARS,
  MAX_VN_CHARS
};
