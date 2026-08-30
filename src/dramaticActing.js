/**
 * AZURA Dramatic Acting & Emotional Roleplay Engine
 * 
 * Capable of progressive 3-phase emotional voice acting:
 * Phase 1: Mellow, Voice Trembling & Teary-eyed ([softly] [voice trembling] [sniffs] [choked up])
 * Phase 2: Breakdown & Sobbing ([cries] [sobbing] [whimpering] [gasping for air])
 * Phase 3: Hysterical Wailing & Grief ([wailing] [sobbing loudly] [hyperventilating] [screams in tears] [breaking down])
 */

const { OpenAI } = require('openai');
const config = require('./config');
const { generateElevenLabsTTS } = require('./elevenlabs');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

/**
 * Detect whether a user prompt is asking Azura to perform dramatic crying acting / roleplay
 * @param {string} prompt 
 * @returns {{ isDramaticRequest: boolean, type: string, scenario: string } | null}
 */
function parseDramaticActingRequest(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const clean = prompt.trim().toLowerCase();

  const cryingPatterns = [
    /\b(?:coba\s+)?(?:akting|acting|peragain|drama|actingin|roleplay|mainkan\s+peran)\s+(?:nangis|menangis|sedih|kejer|kehilangan|histeris|mellow|tersedu)\b/i,
    /\b(?:nangis\s+kejer|nangis\s+kenceng|nangis\s+histeris|tangisan\s+kejer|menangis\s+histeris)\b/i,
    /\b(?:acting|akting)\s+(?:kehilangan\s+seseorang|orang\s+meninggal|ditinggal\s+pergi|patah\s+hati|drama\s+sedih)\b/i
  ];

  const matched = cryingPatterns.some(pat => pat.test(clean));
  if (!matched) return null;

  let scenario = 'kehilangan';
  if (clean.includes('kehilangan') || clean.includes('ditinggal')) scenario = 'kehilangan_seseorang';
  else if (clean.includes('kejer') || clean.includes('histeris')) scenario = 'nangis_kejer';
  else scenario = 'drama_sedih';

  return {
    isDramaticRequest: true,
    type: 'CRYING_SOBBING_PROGRESSION',
    scenario
  };
}

/**
 * 3-Phase Crafted Master Scripts for Crying Acting (Zero-failure fallback & AI template)
 */
const CRAFTED_DRAMATIC_SCRIPTS = {
  kehilangan: `[softly] [voice trembling] Kamu... kamu beneran mau pergi ninggalin aku sendirian di sini...? [sniffs] Jangan bercanda dong... ini sama sekali nggak lucu... [choked up] [cries] Kenapa harus kayak gini sih... [sobbing] [whimpering] Aku udah coba buat kuat tapi aku nggak bisa... [gasping for air] Hatiku sakit banget... [wailing] NGGAAAKKK!! JANGAN PERGI!! [sobbing loudly] [hyperventilating] BUKA MATAMU, AKU MOHON BANGUN!! [screams in tears] Aku nggak bisa hidup tanpa kamu... JANGAN TINGGALIN AKU SENDIRIAN!! [breaking down] [crying hysterically]`,
  
  nangis_kejer: `[softly] [voice trembling] T-tolong jangan tatap aku kayak gitu... [sniffs] Aku takut banget kehilangan kamu... [choked up] [cries] Kenapa takdir jahat banget sama kita... [sobbing] [whimpering] Aku nggak siap ngelepas kamu, sumpah aku nggak siap... [gasping for air] [wailing] JANGAN TINGGALIN AKU!! [sobbing loudly] [hyperventilating] TOLOOONG!! SIAPAPUN TOLONG SELAMATIN DIA!! [screams in tears] Jangan tutup matamu, aku mohon tetap di sini sama aku!! [breaking down] [crying hysterically]`,

  drama_sedih: `[softly] [voice trembling] Jadi selama ini... semua janji kita nggak ada artinya buat kamu...? [sniffs] [choked up] [cries] Kenapa kamu tega ngelakuin ini ke aku... [sobbing] [whimpering] Aku udah ngasih seluruh hatiku buat kamu... [gasping for air] [wailing] KENAPA KAMU TEGA HANCURIN SEMUANYA?! [sobbing loudly] [hyperventilating] Aku benci harus sesakit ini karena kamu!! [screams in tears] Aku benci kenyataan kalau aku masih sayang banget sama kamu!! [breaking down] [crying hysterically]`
};

/**
 * Generate a 3-phase progressive crying acting script with audio tags
 * @param {string} scenario 
 * @param {string} requesterName 
 * @returns {Promise<{ script: string, title: string }>}
 */
async function generateDramaticCryingScript(scenario = 'kehilangan', requesterName = 'Attila') {
  if (!config.OPENAI_API_KEY) {
    const script = CRAFTED_DRAMATIC_SCRIPTS[scenario] || CRAFTED_DRAMATIC_SCRIPTS.kehilangan;
    return { script, title: '🎭 Akting 3-Fase: Tangisan Histeris & Kehilangan' };
  }

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const systemPrompt = `Kamu adalah AZURA, asisten AI berjiwa aktris dengan kemampuan akting emosional suara tingkat tinggi.
TUGAS:
Tuliskan 1 naskah monolog akting suara (Voice Acting Script) dalam Bahasa Indonesia dengan TRANSISI 3 FASE EMOSI TANGISAN:

STRUKTUR WAJIB 3 FASE:
- FASE 1 (Berkaca-kaca & Suara Bergetar): Gunakan tag [softly] [voice trembling] [sniffs] [choked up] di awal kalimat dengan kata-kata menahan tangis.
- FASE 2 (Tangisan Pecah & Terisak): Gunakan tag [cries] [sobbing] [whimpering] [gasping for air] dengan tarikan napas sesenggukan.
- FASE 3 (Nangis Kejer / Histeris / Menjerit Pilu): Gunakan tag [wailing] [sobbing loudly] [hyperventilating] [screams in tears] [breaking down] [crying hysterically] dengan jeritan kesedihan mendalam layaknya kehilangan sosok terpenting.

ATURAN SANGAT KETAT:
1. Naskah harus mengalir dalam 1 paragraf utuh (total 60 - 90 kata).
2. Gunakan tanda baca dramatis (titik-titik ..., huruf gagap k-kamu, tanda seru ganda !!) untuk memberi jeda napas pada TTS ElevenLabs.
3. DILARANG ada teks narasi pengantar ("Ini naskahnya:") atau tanda kutip ganda pembuka/penutup untuk seluruh naskah. HANYA keluarkan naskah monolognya saja!`;

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Buat naskah akting tangisan dramatis 3-fase untuk skenario: ${scenario}` }
      ],
      max_completion_tokens: 250
    });

    const script = res.choices[0]?.message?.content?.trim();
    if (script && script.includes('[') && script.length > 50) {
      return { script, title: '🎭 Akting 3-Fase: Tangisan Histeris & Kehilangan' };
    }
  } catch (err) {
    console.warn('[Dramatic Acting Script Warning]:', err.message);
  }

  const script = CRAFTED_DRAMATIC_SCRIPTS[scenario] || CRAFTED_DRAMATIC_SCRIPTS.kehilangan;
  return { script, title: '🎭 Akting 3-Fase: Tangisan Histeris & Kehilangan' };
}

/**
 * Execute dramatic acting and render as Voice Note (VN)
 * @param {string} prompt 
 * @param {string} userId 
 * @param {string} userName 
 * @param {boolean} isOwner 
 * @param {import('discord.js').Client} client 
 * @returns {Promise<{ success: boolean, attachment?: AttachmentBuilder, embed?: EmbedBuilder, error?: string }>}
 */
async function executeDramaticActingVN(prompt, userId, userName, isOwner, client) {
  const dramaticReq = parseDramaticActingRequest(prompt);
  const scenario = dramaticReq?.scenario || 'kehilangan';

  try {
    console.log(`[Dramatic Acting Engine]: 🎭 Rendering 3-phase crying monologue for ${userName}...`);
    const { script, title } = await generateDramaticCryingScript(scenario, userName);

    // Render audio using ElevenLabs v3 with extreme emotional modulation (stability: 0.22, style: 0.55)
    const audioBuffer = await generateElevenLabsTTS(script, null, 'eleven_v3', client, {
      stability: 0.22,
      similarity_boost: 0.75,
      style: 0.55
    });

    if (!audioBuffer || audioBuffer.length === 0) {
      return { success: false, error: 'Gagal merender audio ElevenLabs v3 untuk akting tangisan.' };
    }

    const attachment = new AttachmentBuilder(audioBuffer, {
      name: `azura_dramatic_acting_crying.mp3`,
      description: `Azura Dramatic Acting: 3-Phase Crying & Sobbing Monologue`
    });

    const cleanCaption = script.replace(/\[.*?\]/g, '').trim();

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(title)
      .setDescription(
        `😭 **Transisi Akting Emosi 3-Fase:**\n` +
        `• **Fase 1:** Berkaca-kaca & Suara Bergetar (*Teary-eyed & Voice Trembling*)\n` +
        `• **Fase 2:** Tangisan Pecah & Sesenggukan (*Sobbing & Gasping*)\n` +
        `• **Fase 3:** Nangis Kejer & Histeris (*Hysterical Wailing & Breakdown*)\n\n` +
        `📝 **Naskah Dialog:**\n` +
        `*"${cleanCaption}"*`
      )
      .setFooter({ text: 'ElevenLabs v3 Dynamic Low-Stability Voice Acting Engine (PID: 325343)' })
      .setTimestamp();

    return {
      success: true,
      attachment,
      embed
    };
  } catch (err) {
    console.error('[Dramatic Acting VN Error]:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Execute dramatic acting directly inside an active Voice Channel (VC)
 * @param {string} guildId 
 * @param {string} scenario 
 * @param {import('discord.js').Client} client 
 * @param {import('discord.js').TextChannel} [textChannel] 
 */
async function executeDramaticActingVC(guildId, scenario = 'kehilangan', client, textChannel = null) {
  const { textToAudioResource, playInVC, recordSessionEntry, getActiveVoiceSession } = require('./voiceCompanion');
  const session = getActiveVoiceSession ? getActiveVoiceSession(guildId) : null;
  if (!session) return;

  try {
    const { script, title } = await generateDramaticCryingScript(scenario, 'Attila');
    recordSessionEntry(guildId, 'AZURA', script);

    if (textChannel) {
      const cleanCaption = script.replace(/\[.*?\]/g, '').trim();
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(title)
        .setDescription(
          `🎭 **Sedang Berakting di VC:**\n` +
          `😭 *3-Phase Crying Progression: Berkaca-kaca ➔ Terisak ➔ Nangis Kejer*\n\n` +
          `💬 *"${cleanCaption}"*`
        )
        .setFooter({ text: 'ElevenLabs v3 Dynamic Emotional Voice Modulation' })
        .setTimestamp();

      await textChannel.send({ embeds: [embed] }).catch(() => {});
    }

    const audioResource = await textToAudioResource(script, client, 1500, { forcedModel: 'eleven_v3' });
    if (audioResource) {
      await playInVC(guildId, audioResource);
    }
  } catch (err) {
    console.error('[Dramatic Acting VC Error]:', err.message);
  }
}

module.exports = {
  parseDramaticActingRequest,
  generateDramaticCryingScript,
  executeDramaticActingVN,
  executeDramaticActingVC,
  CRAFTED_DRAMATIC_SCRIPTS
};
