/**
 * AZURA Cognitive Reasoning & Causal Context Engine Subsystem
 * 
 * Provides:
 * 1. Intent Classification: Detects self-feature questions, causal follow-ups, commands, debates, critiques, music, emotional inquiry, VC actions.
 *    Supports multi-intent detection when a user combines multiple requests in one prompt.
 * 2. Causal Context & Pronoun Disambiguation: Resolves ambiguous references ("itu", "dia", "yang tadi", "kenapa gitu")
 *    against multi-turn conversation turns.
 * 3. Reply Chain Structuring: Integrates parent referenced messages into a causal anchor.
 * 4. Cross-Modal Directives: Tailors cognitive reasoning guidelines for both text chat and real-time Voice Channel responses.
 */

const INTENT_TYPES = {
  SELF_FEATURE_INQUIRY: 'SELF_FEATURE_INQUIRY', // Questions about Azura's features, capabilities, quotas, rules
  CAMERA_COMMAND: 'CAMERA_COMMAND',             // Open/close camera streaming in VC
  CAMERA_INQUIRY: 'CAMERA_INQUIRY',             // Asking about Azura Cam / webcam / camera account
  EMOTIONAL_INQUIRY: 'EMOTIONAL_INQUIRY',       // Questions about pouty/ngambek mood, emotions, jealousy
  MUSIC_COMMAND: 'MUSIC_COMMAND',               // Play, pause, resume, stop, switch music
  VC_ACTION_REQUEST: 'VC_ACTION_REQUEST',       // Reading prayers, Quran, singing in VC
  CROSS_CHANNEL_REFERENCE: 'CROSS_CHANNEL_REFERENCE', // Inquiries referencing topics/chats in other text channels
  CAUSAL_FOLLOW_UP: 'CAUSAL_FOLLOW_UP',         // Follow-ups like "kenapa gitu?", "terus gimana?", "maksudnya?"
  DIRECT_QUESTION: 'DIRECT_QUESTION',           // Specific factual/technical questions
  COMMAND_REQUEST: 'COMMAND_REQUEST',           // Requesting an action (search, generate image, calculate, leave)
  CRITIQUE_CORRECTION: 'CRITIQUE_CORRECTION',   // User correcting, criticizing, or challenging Azura
  BANTER_CASUAL: 'BANTER_CASUAL',               // Casual conversation, teasing, jokes
  GENERAL_CHAT: 'GENERAL_CHAT'
};

/**
 * Classify all matching cognitive intents of the user prompt
 * @param {string} prompt 
 * @param {boolean} hasReplyContext 
 * @returns {string[]} Array of matched intent strings
 */
function classifyCognitiveIntents(prompt, hasReplyContext = false) {
  if (!prompt || typeof prompt !== 'string') return [INTENT_TYPES.GENERAL_CHAT];
  const lower = prompt.toLowerCase().trim();
  const matched = [];

  // 1. Camera Command (Open / Close Camera)
  const cameraCmdRegex = /\b(?:buka\s+(?:cam|kamera)|nyalain\s+(?:cam|kamera)|tutup\s+(?:cam|kamera)|matiin\s+(?:cam|kamera)|matikan\s+(?:cam|kamera)|nyalakan\s+(?:cam|kamera)|open\s+cam|close\s+cam|start\s+cam|stop\s+cam|aktifkan\s+(?:kamera|cam))\b/i;
  if (cameraCmdRegex.test(lower)) {
    matched.push(INTENT_TYPES.CAMERA_COMMAND);
  }

  // 2. Camera Inquiry (Azura Cam / azura_camera / Webcam questions)
  const cameraInquiryRegex = /\b(?:azura\s*cam|azura_camera|kamera\s+kamu|akun\s+kamera|akun\s+cam|itu\s+akun\s+siapa|webcam\s+kamu|video\s+streaming\s+kamu|kenapa\s+ada\s+azura\s*cam|akun\s+alt\s+kamera)\b/i;
  if (cameraInquiryRegex.test(lower)) {
    matched.push(INTENT_TYPES.CAMERA_INQUIRY);
  }

  // 3. Music Command / Inquiry
  const musicRegex = /\b(?:setel(?:in)?\s+lagu|putar(?:in)?\s+lagu|mainkan\s+lagu|pause\s+musik|jeda\s+musik|stop\s+musik|matikan\s+musik|lanjutkan\s+musik|resume\s+musik|ganti\s+lagu|setel\s+musik|putar\s+musik|bisa\s+setel\s+musik|bisa\s+putar\s+lagu|lagu\s+lofi|nyalain\s+musik)\b/i;
  if (musicRegex.test(lower)) {
    matched.push(INTENT_TYPES.MUSIC_COMMAND);
  }

  // 4. Emotional / Ngambek Inquiry
  const emotionalRegex = /\b(?:kamu\s+(?:bisa\s+)?ngambek|cara\s+kerja\s+ngambek|fitur\s+ngambek|lagi\s+ngambek|lagi\s+marah|kenapa\s+ngambek|pouty|reset\s+emosi|damai\s+yuk|jangan\s+ngambek|cemburu|jangan\s+marah)\b/i;
  if (emotionalRegex.test(lower)) {
    matched.push(INTENT_TYPES.EMOTIONAL_INQUIRY);
  }

  // 5. VC Action Request (Doa, Ngaji, Surat Al-Qur'an, Menyanyi)
  const vcActionRegex = /\b(?:bacakan\s+(?:doa|surat|ayat|al-qur'an|quran)|baca\s+(?:doa|surat|ayat|al-fatihah|al-ikhlas|ayat\s+kursi|ngaji)|minta\s+(?:bacain|baca|ngaji|nyanyi)|nyanyiin|nyanyi\s+dong|lantunkan\s+(?:doa|surat|ayat))\b/i;
  if (vcActionRegex.test(lower)) {
    matched.push(INTENT_TYPES.VC_ACTION_REQUEST);
  }

  // 6. Cross-Channel Reference (e.g. "yang di channel project", "cek channel coding", "di general tadi bahas apa")
  const crossChannelRegex = /\b(?:di\s+(?:channel|ruang|room)|yang\s+di\s+(?:channel\s+|#)?|cek\s+channel|lihat\s+(?:obrolan\s+)?channel|obrolan\s+(?:di\s+)?channel|tadi\s+di\s+#|tadi\s+di\s+channel)\b/i;
  if (crossChannelRegex.test(lower) || /<#\d+>/.test(prompt)) {
    matched.push(INTENT_TYPES.CROSS_CHANNEL_REFERENCE);
  }

  // 7. Self-Feature Inquiry (Capabilities, quota, rules, privileges, humming, etc.)
  const selfFeatureRegex = /\b(?:kamu\s+(?:bisa\s+apa|punya\s+fitur|fiturnya\s+apa|bisa\s+ngapain)|fitur\s+(?:kamu|azura|ara|zura|ajur)|apa\s+saja\s+kemampuanmu|kuota\s+(?:vc|suara|teman|harian)|countdown\s+24\s*jam|kapan\s+kuota\s+reset|aturan\s+(?:vc|kuota|member|teman)|bedanya\s+owner|hak\s+akses|humming|icebreaker|deep\s+sleep|auto\s*leave|master\s+password|enkripsi|keamanan\s+database|siapa\s+pembuatmu|siapa\s+creator|bisa\s+generate\s+gambar|bisa\s+search|bisa\s+nyanyi|bisa\s+keluar\s+vc)\b/i;
  if (selfFeatureRegex.test(lower)) {
    matched.push(INTENT_TYPES.SELF_FEATURE_INQUIRY);
  }

  // 5. Causal Follow-Up (Short inquiries or questions starting with causal connectors)
  const causalFollowUpRegex = /\b(?:kenapa\s+(?:gitu|bisa\s+begitu|bisa\s+gitu|begitu|kayak\s+gitu)|maksudnya\s+(?:gimana|apa)|terus\s+(?:gimana|langkah\s+selanjutnya|apa\s+lagi|kelanjutannya)|yang\s+(?:tadi|kedua|nomor\s+\d|itu|mana)|kenapa\s+milih|alasan\s+kenapa|kok\s+bisa|emang\s+(?:iya|beneran|kenapa)|lanjutannya\s+apa|contohnya\s+gimana|jelasin\s+lagi|yang\s+di\s+chat\s+tadi)\b/i;
  if (causalFollowUpRegex.test(lower) || (hasReplyContext && lower.length < 50 && /\b(?:kenapa|terus|maksud|gimana|apa|yang)\b/i.test(lower))) {
    matched.push(INTENT_TYPES.CAUSAL_FOLLOW_UP);
  }

  // 6. Critique / Correction (User challenging, arguing, or correcting)
  const critiqueRegex = /\b(?:salah\s+tuh|bukan\s+gitu|keliru|nggak\s+gitu|ngaco|kurang\s+tepat|maksud\s+aku\s+bukan|lu\s+salah|kamu\s+salah|kebalik|kok\s+ngaco)\b/i;
  if (critiqueRegex.test(lower)) {
    matched.push(INTENT_TYPES.CRITIQUE_CORRECTION);
  }

  // 7. Command / Request
  const commandRegex = /\b(?:tolong\s+(?:bikinin|buatkan|carikan|search|hitung|kerjakan|analisis)|generate\s+gambar|buatkan\s+gambar|tuliskan\s+kode|bantu\s+aku\s+bikin|jalankan)\b/i;
  if (commandRegex.test(lower)) {
    matched.push(INTENT_TYPES.COMMAND_REQUEST);
  }

  // 8. Direct Question
  if (lower.includes('?') || /\b(?:apa|kenapa|mengapa|bagaimana|gimana|siapa|kapan|dimana|berapa|apakah)\b/i.test(lower)) {
    if (!matched.includes(INTENT_TYPES.DIRECT_QUESTION)) {
      matched.push(INTENT_TYPES.DIRECT_QUESTION);
    }
  }

  // 9. Banter / Casual
  if (/\b(?:haha|wkwk|hehe|lucu|kocak|canda|jail|ledek|ngakak|garing|cie|sayang|ganteng|cantik|imut)\b/i.test(lower)) {
    matched.push(INTENT_TYPES.BANTER_CASUAL);
  }

  return matched.length > 0 ? matched : [INTENT_TYPES.GENERAL_CHAT];
}

/**
 * Classify the primary cognitive intent of the user prompt (Backward compatible)
 * @param {string} prompt 
 * @param {boolean} hasReplyContext 
 * @returns {string}
 */
function classifyCognitiveIntent(prompt, hasReplyContext = false) {
  const intents = classifyCognitiveIntents(prompt, hasReplyContext);
  return intents[0] || INTENT_TYPES.GENERAL_CHAT;
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
 * based on classified intent(s), medium (text/voice), and conversation state.
 * @param {string|string[]} intentOrIntents 
 * @param {boolean} isOwner 
 * @param {string} userName 
 * @param {boolean} [isVoice=false]
 * @returns {string}
 */
function getCognitiveReasoningDirectives(intentOrIntents, isOwner, userName, isVoice = false) {
  const intents = Array.isArray(intentOrIntents) ? intentOrIntents : [intentOrIntents];
  let directiveSections = [];

  for (const intent of intents) {
    let directives = [];
    switch (intent) {
      case INTENT_TYPES.VC_ACTION_REQUEST:
        directives.push(
          '🕌 INTENSI AKSI VOICE CHANNEL (DOA / NGAJI / SURAT / NYANYI):',
          '- Perhatikan STATUS SITUASIONAL REAL-TIME AZURA di atas.',
          isVoice
            ? '- Kamu SEDANG BERBICARA DI VOICE CHANNEL: LANGSUNG LANTUNKAN dengan suara tartil merdu dan lembut menggunakan tag [softly]! JANGAN PERNAH menyuruh pengguna masuk ke VC lagi karena kamu SUDAH berada di VC!'
            : '- JIKA STATUS VC AKTIF: LANGSUNG LAKUKAN & LANTUNKAN dengan tartil merdu [softly]! JIKA TIDAK TERHUBUNG: Ajak pengguna masuk ke VC bersama secara santun.'
        );
        break;

      case INTENT_TYPES.CAMERA_COMMAND:
        directives.push(
          '🎥 INTENSI KONTROL KAMERA VIDEO (CAMERA COMMAND):',
          '- Lawan bicara ingin menyalakan atau mematikan kamera streaming Azura Cam di Voice Channel.',
          isOwner
            ? (isVoice
                ? '- Buka Kamera: Jawab super singkat dan langsung to the point ("Taraaa! [smiles] [ACTION:OPEN_CAMERA]") tanpa dialog panjang, karena Video 1 sudah memiliki audio dialog sambutan di videonya!\n- Tutup Kamera: Jawab santai dan bercanda dengan tag [ACTION:CLOSE_CAMERA].'
                : '- Jelaskan status kamera streaming atau konfirmasi perintah pembukaan/penutupan kamera.')
            : '- Tolak dengan nada bercanda dan manis bahwa kontrol on/off kamera Azura Cam hanya bisa diaktifkan oleh Attila.'
        );
        break;

      case INTENT_TYPES.CAMERA_INQUIRY:
        directives.push(
          '📸 INTENSI PERTANYAAN TENTANG AZURA CAM / KAMERA (CAMERA INQUIRY):',
          '- Lawan bicara menanyakan tentang akun "Azura Cam" (azura_camera), fungsi kamera, atau proyektor videomu.',
          '- Jelaskan dengan bangga, centil, dan bercanda bahwa Azura Cam adalah WEBCAM LIVE PRIBADI milikmu untuk menampilkan visual estetikmu di VC, bukan bot lain atau mata-mata.'
        );
        break;

      case INTENT_TYPES.EMOTIONAL_INQUIRY:
        directives.push(
          '💢 INTENSI PERTANYAAN EMOSI & NGAMBEK (POUTY MOOD INQUIRY):',
          '- Lawan bicara menanyakan sistem emosimu, cara kerja ngambek, atau status moodmu.',
          '- Jelaskan 4 state emosimu (IDLE, POUTY_MILD, POUTY_SEVERE, JEALOUS_INTROSPECTIVE), pemicunya, auto-decay 5 menit, dan Master Reset emosi.',
          isVoice
            ? '- Sampaikan dengan intonasi suara manis, sedikit manja/playful [laughs], dan hindari membaca markdown.'
            : '- Jawab dengan gaya Gen Z yang manis, sedikit playful, dan tidak kaku.'
        );
        break;

      case INTENT_TYPES.MUSIC_COMMAND:
        directives.push(
          '🎵 INTENSI PERINTAH & FITUR MUSIK (MUSIC COMMAND):',
          '- Lawan bicara ingin memutar, mengontrol, atau menanyakan fitur pemutar musik.',
          isVoice
            ? '- Konfirmasi atau jalankan pemutaran musik di VC dengan santai (SoundCloud/FFmpeg stream).'
            : '- Jelaskan bahwa kamu terintegrasi dengan streaming audio SoundCloud/FFmpeg langsung di VC, atau konfirmasi pemutaran lagu jika kamu berada di VC.'
        );
        break;

      case INTENT_TYPES.SELF_FEATURE_INQUIRY:
        directives.push(
          '🎯 INTENSI PERTANYAAN FITUR DIRI (SELF-FEATURE INQUIRY):',
          '- Lawan bicara sedang menanyakan fitur, aturan, kuota, kapabilitas, atau sistem internalmu.',
          '- Jawablah dengan FAKTA TEKNIS & ATURAN ASLIMU yang tercantum dalam KESADARAN FITUR DIRI di atas.',
          '- DILARANG KERAS mengarang/berhalusinasi fitur yang tidak kamu miliki atau memberikan jawaban generik AI robot.'
        );
        break;

      case INTENT_TYPES.CROSS_CHANNEL_REFERENCE:
        directives.push(
          '🌐 INTENSI REFERENSI LINTAS-CHANNEL (CROSS-CHANNEL REFERENCE):',
          '- Lawan bicara secara spesifik menanyakan obrolan, topik, atau aktivitas yang terjadi di channel lain di server ini.',
          '- Gunakan data riwayat [KONTEKS OBROLAN TERBARU DI CHANNEL] yang telah disuntikkan untuk menjawab pertanyaan mereka secara akurat, presisi, dan terhubung.',
          '- Jangan mengarang isi obrolan jika channel tersebut belum ada bahasan baru; jelaskan saja intinya secara santai dan ramah.'
        );
        break;

      case INTENT_TYPES.CAUSAL_FOLLOW_UP:
        directives.push(
          '🔗 INTENSI PERTANYAAN LANJUTAN & KAUSALITAS (CAUSAL FOLLOW-UP):',
          '- Pertanyaan ini merujuk ke topik, istilah, pilihan, obrolan chat teks sebelumnya, atau pesan yang di-reply.',
          '- Identifikasi kata ganti ambigu ("itu", "kenapa gitu", "yang tadi", "yang di chat") dan tautkan secara presisi ke subjek yang baru saja dibahas.',
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
    if (directives.length > 0) {
      directiveSections.push(directives.join('\n'));
    }
  }

  const voiceGuideline = isVoice
    ? '\n- FORMAT RESPON SUARA (VOICE OUTPUT): Jangan gunakan tanda baca markdown (seperti **, ##, bullet point). Gunakan intonasi yang mengalir alami dan sisipkan tag emosi ElevenLabs v3 ([laughs], [softly], [whispers], [yawns], [sighs]) pada momen yang tepat.'
    : '';

  return `\n\n[PANDUAN PENALARAN KOGNITIF AKTIF (ACTIVE REASONING DIRECTIVES)]:\n${directiveSections.join('\n\n')}${voiceGuideline}`;
}

module.exports = {
  INTENT_TYPES,
  classifyCognitiveIntent,
  classifyCognitiveIntents,
  buildReplyCausalAnchor,
  getCognitiveReasoningDirectives
};

