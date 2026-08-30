/**
 * AZURA Cognitive Reasoning & Causal Context Engine Subsystem
 * 
 * Provides:
 * 1. Intent Classification: Detects self-feature questions, causal follow-ups, commands, debates, critiques.
 * 2. Causal Context & Pronoun Disambiguation: Resolves ambiguous references ("itu", "dia", "yang tadi", "kenapa gitu")
 *    against multi-turn conversation turns.
 * 3. Reply Chain Structuring: Integrates parent referenced messages into a causal anchor.
 */

const INTENT_TYPES = {
  SELF_FEATURE_INQUIRY: 'SELF_FEATURE_INQUIRY', // Questions about Azura's features, capabilities, quotas, rules
  CAUSAL_FOLLOW_UP: 'CAUSAL_FOLLOW_UP',         // Follow-ups like "kenapa gitu?", "terus gimana?", "maksudnya?"
  DIRECT_QUESTION: 'DIRECT_QUESTION',           // Specific factual/technical questions
  COMMAND_REQUEST: 'COMMAND_REQUEST',           // Requesting an action (search, generate image, calculate, leave)
  CRITIQUE_CORRECTION: 'CRITIQUE_CORRECTION',   // User correcting, criticizing, or challenging Azura
  BANTER_CASUAL: 'BANTER_CASUAL',               // Casual conversation, teasing, jokes
  GENERAL_CHAT: 'GENERAL_CHAT'
};

/**
 * Classify the cognitive intent of the user prompt
 * @param {string} prompt 
 * @param {boolean} hasReplyContext 
 * @returns {string}
 */
function classifyCognitiveIntent(prompt, hasReplyContext = false) {
  if (!prompt || typeof prompt !== 'string') return INTENT_TYPES.GENERAL_CHAT;
  const lower = prompt.toLowerCase().trim();

  // 1. Self-Feature Inquiry (Questions about Azura's capabilities, voice quota, rules, owner privileges, humming, etc.)
  const selfFeatureRegex = /\b(?:kamu\s+(?:bisa\s+apa|punya\s+fitur|fiturnya\s+apa|bisa\s+ngapain)|fitur\s+(?:kamu|azura|ara|zura|ajur)|apa\s+saja\s+kemampuanmu|kuota\s+(?:vc|suara|teman|harian)|countdown\s+24\s*jam|kapan\s+kuota\s+reset|aturan\s+(?:vc|kuota|member|teman)|bedanya\s+owner|hak\s+akses|humming|icebreaker|deep\s+sleep|auto\s*leave|master\s+password|enkripsi|keamanan\s+database|siapa\s+pembuatmu|siapa\s+creator|bisa\s+generate\s+gambar|bisa\s+search|bisa\s+nyanyi|bisa\s+keluar\s+vc)\b/i;
  if (selfFeatureRegex.test(lower)) {
    return INTENT_TYPES.SELF_FEATURE_INQUIRY;
  }

  // 2. Causal Follow-Up (Short inquiries or questions starting with causal connectors)
  const causalFollowUpRegex = /\b(?:kenapa\s+(?:gitu|bisa\s+begitu|bisa\s+gitu|begitu|kayak\s+gitu)|maksudnya\s+(?:gimana|apa)|terus\s+(?:gimana|langkah\s+selanjutnya|apa\s+lagi|kelanjutannya)|yang\s+(?:tadi|kedua|nomor\s+\d|itu|mana)|kenapa\s+milih|alasan\s+kenapa|kok\s+bisa|emang\s+(?:iya|beneran|kenapa)|lanjutannya\s+apa|contohnya\s+gimana|jelasin\s+lagi)\b/i;
  if (causalFollowUpRegex.test(lower) || (hasReplyContext && lower.length < 50 && /\b(?:kenapa|terus|maksud|gimana|apa|yang)\b/i.test(lower))) {
    return INTENT_TYPES.CAUSAL_FOLLOW_UP;
  }

  // 3. Critique / Correction (User challenging, arguing, or correcting)
  const critiqueRegex = /\b(?:salah\s+tuh|bukan\s+gitu|keliru|nggak\s+gitu|ngaco|kurang\s+tepat|maksud\s+aku\s+bukan|lu\s+salah|kamu\s+salah|kebalik|kok\s+ngaco)\b/i;
  if (critiqueRegex.test(lower)) {
    return INTENT_TYPES.CRITIQUE_CORRECTION;
  }

  // 4. Command / Request
  const commandRegex = /\b(?:tolong\s+(?:bikinin|buatkan|carikan|search|hitung|kerjakan|analisis)|generate\s+gambar|buatkan\s+gambar|tuliskan\s+kode|bantu\s+aku\s+bikin|jalankan)\b/i;
  if (commandRegex.test(lower)) {
    return INTENT_TYPES.COMMAND_REQUEST;
  }

  // 5. Direct Question
  if (lower.includes('?') || /\b(?:apa|kenapa|mengapa|bagaimana|gimana|siapa|kapan|dimana|berapa|apakah)\b/i.test(lower)) {
    return INTENT_TYPES.DIRECT_QUESTION;
  }

  // 6. Banter / Casual
  if (/\b(?:haha|wkwk|hehe|lucu|kocak|canda|jail|ledek|ngakak|garing|cie|sayang|ganteng|cantik|imut)\b/i.test(lower)) {
    return INTENT_TYPES.BANTER_CASUAL;
  }

  return INTENT_TYPES.GENERAL_CHAT;
}

/**
 * Format and structure a Discord Reply Reference into an authoritative Causal Anchor
 * @param {object} replyData { authorName: string, text: string, isFromBot: boolean }
 * @param {string} userPrompt 
 * @returns {string}
 */
function buildReplyCausalAnchor(replyData, userPrompt) {
  if (!replyData || !replyData.text) return userPrompt;

  const authorLabel = replyData.isFromBot ? 'AZURA (Kamu Sendiri)' : `@${replyData.authorName}`;
  const cleanSnippet = replyData.text.replace(/\n+/g, ' ').slice(0, 400).trim();

  return `[KONTEKS JANGKAR BALASAN (REPLY THREAD)]:
- Pesan yang sedang dibalas berasal dari: ${authorLabel}
- Isi pesan sebelumnya: "${cleanSnippet}"
- Pertanyaan / Respon Lanjutan dari Pengguna:
${userPrompt}`;
}

/**
 * Build dynamic Cognitive Reasoning Directives to inject into the system prompt
 * based on classified intent and conversation state.
 * @param {string} intent 
 * @param {boolean} isOwner 
 * @param {string} userName 
 * @returns {string}
 */
function getCognitiveReasoningDirectives(intent, isOwner, userName) {
  let directives = [];

  switch (intent) {
    case INTENT_TYPES.SELF_FEATURE_INQUIRY:
      directives.push(
        '🎯 INTENSI PERTANYAAN FITUR DIRI (SELF-FEATURE INQUIRY):',
        '- Lawan bicara sedang menanyakan fitur, aturan, kuota, kapabilitas, atau sistem internalmu.',
        '- Jawablah dengan FAKTA TEKNIS & ATURAN ASLIMU yang tercantum dalam KESADARAN FITUR DIRI di atas.',
        '- DILARANG KERAS mengarang/berhalusinasi fitur yang tidak kamu miliki atau memberikan jawaban generik AI robot.'
      );
      break;

    case INTENT_TYPES.CAUSAL_FOLLOW_UP:
      directives.push(
        '🔗 INTENSI PERTANYAAN LANJUTAN & KAUSALITAS (CAUSAL FOLLOW-UP):',
        '- Pertanyaan ini merujuk ke topik, istilah, pilihan, atau kalimat pada riwayat obrolan sebelumnya atau pesan yang di-reply.',
        '- Identifikasi kata ganti ambigu ("itu", "kenapa gitu", "yang tadi", "kenapa lebih milih X") dan tautkan secara presisi ke subjek yang baru saja dibahas.',
        '- Jangan menjawab seolah-olah obrolan baru dimulai; lanjutkan penjelasan secara mengalir, mendalam, dan logis.'
      );
      break;

    case INTENT_TYPES.CRITIQUE_CORRECTION:
      directives.push(
        '💡 INTENSI KOREKSI / KRITIK DARI PENGGUNA:',
        '- Lawan bicara mengoreksi atau mengkritisi jawaban sebelumnya.',
        '- Dengarkan dengan seksama tanpa defensif. Evaluasi koreksinya dengan logika kritis.',
        '- Jika koreksi benar, akui secara santai & elegan ("Oh iya bener juga!", "Sip, paham maksudmu"), lalu berikan solusi yang telah diperbaiki.'
      );
      break;

    case INTENT_TYPES.COMMAND_REQUEST:
      directives.push(
        '⚡ INTENSI PERINTAH / PERMINTAAN TUGAS:',
        '- Berikan respon yang terstruktur, solutif, dan langsung eksekusi inti permintaan dengan kualitas tertinggi.'
      );
      break;

    default:
      directives.push(
        '🧠 PRINSIP LOGIKA & REASONING DASAR:',
        '- Selalu hubungkan alur sebab-akibat antar pesan secara kronologis.',
        '- Pahami konteks emosi, gaya bahasa, dan intensi lawan bicara.'
      );
      break;
  }

  return `\n\n[PANDUAN PENALARAN KOGNITIF AKTIF (ACTIVE REASONING DIRECTIVE)]:\n${directives.join('\n')}`;
}

module.exports = {
  INTENT_TYPES,
  classifyCognitiveIntent,
  buildReplyCausalAnchor,
  getCognitiveReasoningDirectives
};
