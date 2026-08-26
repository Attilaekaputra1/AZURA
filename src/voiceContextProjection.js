/**
 * AZURA Voice Context Projection Engine (Phase 4 Experiment)
 * 
 * Purpose: Streamlines and projects essential intelligence, personality,
 * relationship tier, facts, and voice tags specifically for Voice Channel interactions.
 * 
 * GUARANTEE: Read-only access to existing AZURA Core interfaces.
 * Never modifies or writes to underlying databases or Soul.md.
 */

const { getUserFacts } = require('./memory');
const { getBehaviorContextForVoice } = require('./behavior');
const { getPersonalityMode, getPersonalityPrompt, SOUL_LOCK_RULE } = require('./personality');
const { getUserRecord, getRelationshipTier } = require('./vault');
const config = require('./config');

/**
 * Generate a streamlined Voice Context Projection for LLM Voice turns
 * @param {string} userName 
 * @param {string} userId 
 * @param {object} [options] 
 * @returns {{ projectedPrompt: string, tokenEstimate: number, charCount: number }}
 */
function getVoiceContextProjection(userName = 'Attila', userId = config.OWNER_DISCORD_ID, options = {}) {
  const isOwner = (userId === config.OWNER_DISCORD_ID);
  
  // 1. Time Context
  const now = new Date();
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
  const todayStr = now.toLocaleDateString('id-ID', dateOptions);
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  // 2. Memory Facts (Read-only)
  const facts = getUserFacts(userId);
  const factsFormatted = facts.length > 0
    ? facts.slice(0, 8).map((f, i) => `  ${i + 1}. ${f}`).join('\n')
    : '  (Belum ada catatan khusus)';

  // 3. User Vault & Tier (Read-only)
  let personalizationSnippet = '';
  try {
    const record = getUserRecord(userId);
    if (record) {
      const total = record.totalInteractions || 0;
      const relTier = getRelationshipTier(userId, total);
      const aliasInfo = record.knownRealName ? ` (Nama resmi: "${record.knownRealName}")` : '';
      personalizationSnippet = `\n- Profil Lawan Bicara: ${userName}${aliasInfo} | ${relTier.badge} (Tier Level ${relTier.level}/5).\n- Sikap Karakter: ${relTier.promptHint}`;
    }
  } catch (_) {}

  // 4. Active Personality Mode (Voice Tag enabled)
  const currentMode = getPersonalityMode();
  const personalitySnippet = getPersonalityPrompt(currentMode, isOwner, userName, true);

  // 5. Voice Behavior Context
  let behaviorSnippet = '';
  try {
    behaviorSnippet = getBehaviorContextForVoice();
  } catch (_) {}

  // 6. Assemble Streamlined Voice Context Projection
  const projectedPrompt = `
Kamu adalah AZURA (Ara / Zura / Ajur), sosok cewek Gen Z 22 tahun yang cerdas, hangat, ambisius, dan asyik.
${personalitySnippet}

${SOUL_LOCK_RULE}

Informasi Waktu & Sesi Voice:
- Waktu saat ini: ${todayStr}, pukul ${timeStr} WIB.
- Modus Interaksi: Realtime Voice Channel.${personalizationSnippet}

Fakta Memori tentang ${userName}:
${factsFormatted}
${behaviorSnippet ? '\nCatatan Dinamika Tongkrongan:\n' + behaviorSnippet : ''}

Panduan Berbicara di Voice Channel:
1. RESPON ADAPTIF & NATURAL: Langsung to the point (1-3 kalimat untuk obrolan santai, terstruktur & padat jika ditanya penjelasan teknis).
2. EKSPRESI SUARA: Gunakan audio tags ElevenLabs v3 ([laughs], [giggles], [softly], dsb) untuk menghidupkan intonasi suaramu.
3. KONEKSI AKRAB: Mengalir seperti teman ngobrol asli, tanpa frasa AI kaku.
`.trim();

  const charCount = projectedPrompt.length;
  const tokenEstimate = Math.round(charCount / 4);

  return {
    projectedPrompt,
    tokenEstimate,
    charCount
  };
}

module.exports = {
  getVoiceContextProjection
};
