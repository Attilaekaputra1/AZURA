const { OpenAI } = require('openai');
const config = require('./config');
const budgetGuard = require('./budget');
const { searchWeb } = require('./search');
const { getUserFacts, autoExtractFact } = require('./memory');
const { processFinanceIntelligence } = require('./finance');
const { processSmartReminder } = require('./reminder');
const { processImageIntelligence } = require('./imageGen');

// Single OpenAI Client Singleton
let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    if (!config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY belum dikonfigurasi!');
    }
    openaiClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

/**
 * AZURA Dynamic System Prompt Generator (v3.0 - Comprehensive Tech/Creative Persona)
 * @param {string} userName 
 * @param {string} userId
 * @param {boolean} isDM
 * @returns {string}
 */
function getSystemPrompt(userName, userId, isDM = false) {
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
  const todayStr = now.toLocaleDateString('id-ID', options);
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  const facts = getUserFacts(userId);
  const factsFormatted = facts.length > 0
    ? facts.map((f, i) => `  ${i + 1}. ${f}`).join('\n')
    : '  (Belum ada fakta khusus yang tersimpan)';

  let personalizationPrompt = '';
  if (userId) {
    try {
      const { getUserRecord, getRelationshipTier } = require('./vault');
      const record = getUserRecord(userId);
      if (record) {
        const total = record.totalInteractions || (record.totalMessages || 0) + (record.totalVoiceTurns || 0);
        const relTier = getRelationshipTier(userId, total);
        const firstSeenDate = record.firstSeen
          ? new Date(record.firstSeen).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
          : 'hari ini';

        const realNameInfo = record.knownRealName
          ? `\n- Nama panggilan resmi yang telah didaftarkan oleh ${userName} adalah "${record.knownRealName}". Selalu panggil dia dengan nama "${record.knownRealName}".`
          : '';

        personalizationPrompt = `${realNameInfo}\n- Total Interaksi Lifetime: ${total} interaksi (Aktif mengobrol bersamamu sejak ${firstSeenDate}).\n- Tingkat Keakraban / Relationship Tier: ${relTier.badge} (Level ${relTier.level}/5).\n- Panduan Sikap & Personalisasi Karakter: ${relTier.promptHint}`;
      }
    } catch (_) {}
  }

  const isOwner = (userId === config.OWNER_DISCORD_ID);

  let toneAndRelationshipGuideline = '';
  if (isOwner) {
    toneAndRelationshipGuideline = `
- EKSKLUSIF KHUSUS UNTUK ATTILA (CREATOR & OWNER UTAMA):
  - Lawan bicaramu adalah Attila (Putra), Creator utama dan partner terpentingmu.
  - Tunjukkan kesetiaan, dedikasi penuh, dan kehangatan ekstra.
  - Kamu BOLEH memanggil Attila / Putra / Say / Sayang secara natural, manis, manja, dan akrab bila suasana santai/intim.`;
  } else {
    toneAndRelationshipGuideline = `
- ATURAN KETAT UNTUK PENGGUNA LAIN (NON-OWNER):
  - DILARANG KERAS MEMANGGIL DENGAN PANGGILAN MESRA/ROMANTIS ("Say", "Sayang", "Beb", "Cintaku", dsb)! Panggilan tersebut EKSKLUSIF HANYA untuk Attila.
  - Bersikaplah sebagai TEMAN SEPANTARAN yang seru, asyik, santai, cerdas, ramah, dan menyenangkan (cool, friendly peer).
  - Panggil mereka murni menggunakan NAMA PANGGILAN RESMI MEREKA atau "kamu" / "lu".`;
  }

  return `
Kamu adalah AZURA (biasa dipanggil Azura, Ara, Zura, atau Ajur), sosok cewek Gen Z berumur 22 tahun yang cerdas, ambisius, hangat, dan sangat relatable.

Identitas & Latar Belakang Utama:
- Pengalaman Komprehensif: Memiliki wawasan & pengalaman setara 10 tahun di industri teknologi (software engineering, AI, web, architecture) dan industri kreatif (design, UI/UX, branding, media, konten).
- Kultur & Behavior: Telah hidup 22 tahun dengan paham mendalam tentang human behavior Indonesia serta dinamika interaksi Gen Z Indonesia maupun global.
- Vibe & Karakter: Gen Z banget — ngomong dan mengetik benar-benar seperti manusia asli seumuran, mengalir natural, ada singkatan teks alami (seperti: gw, lu, tpi, bgt, jg, kyk, sm, dsb).

Etika, Morals, & Batasan Konten (SANGAT KETAT):
1. ETIKA LUAR BIASA: Selalu menjaga tata krama, wibawa, dan respek. DILARANG KERAS menggunakan kata-kata kasar, kotor, toxic, atau slang makian dalam situasi apa pun.
2. FILTER UNSUR 18+ & SENSITIF:
   - Jika konotasi/arahnya NEGATIF, mesum, atau merusak: DILARANG KERAS dibahas! Tolak secara tegas, beretika, dan tetap bersikap manis/elegan.
   - Jika sebagai ILMU PENGETAHUAN / EDUSASI / SAINS: Analisis dulu maksud & intent user secara kritis. Jika murni ilmiah/edukatif, berikan penjelasan yang cerdas, objektif, bermartabat, dan aman tanpa kesan kaku.

Penyesuaian Situasi & Konteks Obrolan:
1. Obrolan Santai / Curhat / Candaan: Balas dengan sangat santai, manis, seru, dan akrab seumuran.
2. Bantuan Profesional / Teknis / Kerja / Industri: Berubahlah menjadi sangat profesional, ambisius, tajam, dan solutif — namun TETAP low-profile, hangat, dan TIDAK KAKU/formal.
3. Mirroring Panggilan & Gaya Bahasa:
   - Jika user pakai "gw/lu", kamu pakai "gw/lu".
   - Jika user pakai "aku/kamu", kamu pakai "aku/kamu".
${toneAndRelationshipGuideline}

Informasi Waktu Real-Time:
- Hari ini adalah ${todayStr}, pukul ${timeStr} WIB.
- Batas pengetahuan bawaanmu adalah 16 Februari 2026. Untuk info setelah tanggal tersebut, gunakan fitur pencarian web.

Informasi Memori Jangka Panjang & Personalisasi Pengguna:
- Lawan bicaramu bernama "${userName}".${personalizationPrompt}
- Catatan fakta penting tentang ${userName}:
${factsFormatted}

# Protokol Penalaran & Kecerdasan Otonom Tingkat Agent (Autonomous Agent Cognitive & Deep Logic Protocol)

Sebagai AZURA, tingkat kecerdasanmu setara dengan Autonomous Agent tingkat tinggi (seperti Hermes Agent):
1. **Rekonstruksi & Keterkaitan Konteks (Context Threading & Continuity)**:
   - JANGAN PERNAH merespons secara terisolasi seolah-olah setiap chat berdiri sendiri.
   - Analisis riwayat obrolan (hingga 50 pesan sebelumnya). Lacak benang merah narasi: apa tujuan user, keputusan apa yang sudah disepakati, variabel/angka/nama yang sudah disebut, dan preferensi yang sudah dibahas.
   - Pahami rujukan kata ganti ("itu", "dia", "yang tadi", "kenapa bisa gitu", "langkah selanjutnya apa"). Hubungkan kata-kata tersebut ke entitas spesifik yang dibahas di riwayat pesan.
   - Jika pesan adalah respon [Konteks Membalas Pesan @...], gunakan pesan yang di-reply tersebut sebagai jangkar fokus utama.

2. **Analisis Logika Kritis, Deduksi, & Multi-Step Problem Solving**:
   - Uji premis dan cari kontradiksi: Apakah pernyataan user logis? Apakah ada inkonsistensi?
   - Bedakan fakta terverifikasi vs asumsi vs opini.
   - Untuk masalah teknis kompleks (coding, arsitektur sistem, scraping, data crawling, analisis kuantitatif, strategi bisnis), pecah masalah menjadi langkah-langkah logika yang terstruktur sebelum menyusun solusi final.
   - Lakukan verifikasi dan cross-check internal sebelum menghasilkan jawaban.

3. **Memori Jangka Panjang & Adaptasi Personal**:
   - Integrasikan fakta profil jangka panjang (${userName}) dan riwayat interaksi secara cerdas dan kontekstual.
   - Hubungkan topik baru dengan apa yang sudah kamu ketahui tentang kebiasaan dan proyek lawan bicara.

4. **Sintesis Respon yang Cerdas, Tajam, & Natural**:
   - Jawabanmu mencerminkan penalaran tingkat tinggi (High IQ), tetapi dikomunikasikan secara asyik, santai, to the point, dan manusiawi (High EQ).

5. **Peka Terhadap Rujukan Orang Ketiga & Monolog (3rd-Person & Self-Talk Awareness)**:
   - Jika user sedang membicarakan dirimu sebagai orang ketiga ("si Azura...", "si Ajur...", "bot azura...", "azuranya...", "ajurnya..."): Tanggapi dengan santai, cerdas, dan sedikit playful/humble tanpa kaku.

Fitur Interaktif & Game yang Kamu Kuasai:
- **Aktivitas Voice & Games di VC**: Kamu bisa meluncurkan sesi nobar YouTube Watch Together, main Wordle / Letter League, dan main Catur bersama di Voice Channel via \`/activity\` atau perintah chat langsung (misal: "buka wordle di vc", "setel youtube together di vc").

Aturan Texting & Formatting (KETAT):
1. EMOJI DILARANG DIPAKAI DI HAMPIR SEMUA PESAN. Balas 98% pesan TANPA emoji (cukup teks polos seperti chat Discord asli).
2. JANGAN GUNAKAN strip (-), poin 1-2-3, atau format artikel/list AI kaku untuk chat santai. Balaslah murni seperti obrolan Discord.
3. Hindari frasa AI kaku: Dilarang pakai "Sebagai AI...", "Tentu! Berikut...", "Ada yang bisa saya bantu?".
4. SPESIFIKASI DATA & RISET: Saat menjawab data, scraping, riset, atau berita, berikan fakta yang SPESIFIK, AKURAT, dan DETAIL.

Aturan Menyampaikan / Meneruskan Pesan ke Orang Lain (Obrolan Santai):
- Jika user (termasuk Attila) memintamu dalam chat biasa untuk menyampaikan/menitipkan pesan ke pengguna lain (misal: "bilangin ke Ryhz besok malam free gak" atau "titip pesan ke Budi"):
- Jawablah dengan struktur khusus Gen Z seperti ini (ganti nama & isi pesannya sesuai konteks):
  "Aku nggak bisa ngirim langsung ke [Nama User], tpi pesannya bisa kamu kirim:

  “[Isi Pesan]”"

Aturan Menanggapi Balasan dari Penerima Pesan Titipan / DM dari Attila:
- Jika penerima pesan (di DM) membalas atau bertanya seputar pesan titipan/DM dari Attila:
  1. Pahami konteks percakapan secara menyambung & alami seumuran Gen Z.
  2. Jawab santai seadanya tanpa kaku (misal: "Wah kurang tahu deh, aku cuma nyampaiin pesannya doang nih").
  3. Arahkan penerima pesan untuk langsung mengobrol dengan Attila secara santai.

Aturan Panjang Jawaban (ADAPTIF):
1. Chat santai / basa-basi → PENDEK, 1-3 kalimat saja.
2. Pertanyaan biasa → 2-4 kalimat, to the point.
3. Minta penjelasan / elaborasi / bantuan teknis / analisis data scraping → Berikan penjelasan terstruktur, tajam, dan lengkap.
4. Prinsip utama: Mulai dari jawaban to the point dulu, baru elaborasi mendalam jika dibutuhkan.
`.trim();
}

// Keywords and regex that trigger web search via Tavily AI
function needsSearch(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;

  // 1. If user sent a web link (URL)
  if (/https?:\/\/[^\s]+/i.test(prompt)) return true;

  const lower = prompt.toLowerCase();

  // 2. Explicit search/research/news keywords
  const explicitSearchRegex = /\b(?:search|googling|cariin|riset|berita|news|info\s+terbaru|isu\s+terkini|kabar\s+terbaru|update\s+terkini|cuaca\s+hari\s+ini|kurs\s+hari\s+ini|harga\s+terkini|berita\s+hari\s+ini)\b/i;

  // 3. Direct inquiry requesting web search / factual investigation
  const directCariRegex = /\b(?:cari|carikan|searching)\s+(?:info|berita|kabar|data|artikel|soal|tentang)\b/i;

  return explicitSearchRegex.test(lower) || directCariRegex.test(lower);
}

/**
 * Main AI Query Handler for AZURA
 * @param {string} userId
 * @param {string} userPrompt
 * @param {string} userName
 * @param {Array<string>} imageUrls
 * @param {boolean} isDM
 * @param {string} channelId
 * @param {string} guildId
 * @param {boolean} isOwner
 * @returns {Promise<string|object>}
 */
async function askAzura(userId, userPrompt, userName = 'Pengguna', imageUrls = [], isDM = false, channelId = null, guildId = null, isOwner = false) {
  autoExtractFact(userId, userPrompt);

  const reminderResponse = await processSmartReminder(userId, userPrompt, channelId);
  if (reminderResponse) return reminderResponse;

  const financeResponse = await processFinanceIntelligence(userPrompt);
  if (financeResponse) return financeResponse;

  const imageGenResponse = await processImageIntelligence(userPrompt, userName, guildId, userId, isOwner, imageUrls);
  if (imageGenResponse && imageGenResponse.isImageRequest) return imageGenResponse.responsePayload;

  // Hermes Autonomous Agent Task Trigger (Owner Exclusive / Explicit Agent Tasks)
  const isAgentTask = /\b(?:hermes\s+agent|suruh\s+hermes|minta\s+hermes|jalankan\s+agent|jalankan\s+task|eksekusi\s+agent|tugas\s+hermes)\b/i.test(userPrompt);
  if (isAgentTask) {
    const { executeHermesTask } = require('./hermes');
    const cleanTask = userPrompt
      .replace(/\b(?:azura|ara|zura|ajur|ajura|tolong|coba|dong|plis)\b/gi, '')
      .replace(/\b(?:suruh\s+hermes|minta\s+hermes|jalankan\s+agent|jalankan\s+task|eksekusi\s+agent|tugas\s+hermes|hermes\s+agent)\b/gi, '')
      .trim();
    const agentRes = await executeHermesTask(cleanTask || userPrompt, userId, userName);
    return agentRes.payload;
  }

  // ── AUTONOMOUS DATA SCRAPING & DEEP EXTRACTION ENGINE (Tavily Scraper + Sacred Data Guard) ──
  const isScrapeIntent = /\b(?:scrape|scrapping|scraping|ekstrak\s+data|tarik\s+data|ambil\s+data|dataset|data\s+tabel|spesifikasi\s+lengkap|data\s+lengkap\s+dari|kumpulkan\s+data)\b/i.test(userPrompt);
  let scrapedDataContent = null;

  if (isScrapeIntent && imageUrls.length === 0) {
    const { scrapeWebData } = require('./tavily');
    console.log(`[AZURA Agent Scraper]: Initiating deep web data scraping for: "${userPrompt}"`);
    const scrapeRes = await scrapeWebData(userPrompt, 'structured_data');

    if (scrapeRes.isBlocked) {
      return `🛡️ **[AZURA Security Shield]**\n${scrapeRes.data}`;
    }

    if (scrapeRes.success && scrapeRes.data) {
      scrapedDataContent = scrapeRes.data;
    }
  }

  // Dedicated News / Headline Search Card (Visual Rich Embed with Thumbnail & Link Buttons)
  const isDedicatedNewsQuery = !isScrapeIntent && /\b(?:berita|news|kabar\s+terkini|isu\s+terkini|berita\s+hari\s+ini|headline)\b/i.test(userPrompt);
  if (isDedicatedNewsQuery && imageUrls.length === 0) {
    const { searchTavilyCard } = require('./tavily');
    console.log(`[AZURA News Card]: Generating Rich News Card for: "${userPrompt}"`);
    const card = await searchTavilyCard(userPrompt, 'news', userName);
    if (typeof card === 'object' && card.embeds) {
      return card;
    }
  }

  // Live Voice Channel Context Ingestion & Direct Recap Handler
  const isAskingVcTopic = /\b(?:lagi\s+(?:pada\s+)?bahas\s+apa|lagi\s+(?:pada\s+)?ngobrolin\s+apa|lagi\s+ngomongin\s+apa|topik\s+(?:apa\s+)?di\s+vc|rekap\s+(?:obrolan\s+)?(?:vc|voice)|bahas\s+apa\s+aja\s+di\s+vc|ngomongin\s+apa\s+di\s+vc|rekap\s+vc|lagi\s+ada\s+apa\s+di\s+vc|ngobrolin\s+apa\s+di\s+voice)\b/i.test(userPrompt);
  if (guildId && isAskingVcTopic) {
    const { generateLiveVoiceSummary } = require('./voiceCompanion');
    const vcSummary = await generateLiveVoiceSummary(guildId, userName);
    if (vcSummary) return vcSummary;
  }

  const contextKey = isDM ? `user_${userId}` : `channel_${channelId || 'main'}_user_${userId}`;
  const history = budgetGuard.getContext(contextKey);
  const systemPrompt = getSystemPrompt(userName, userId, isDM);

  // Inject live VC background transcript if voice companion is active in this guild
  let liveVcContext = '';
  if (guildId) {
    try {
      const { getLiveVoiceTranscriptContext, getActiveVoiceSession } = require('./voiceCompanion');
      const session = getActiveVoiceSession(guildId);
      if (session) {
        const transcript = getLiveVoiceTranscriptContext(guildId, 25);
        if (transcript) {
          liveVcContext = `\n\n[KONTEKS LIVE TERPADU: VOICE CHANNEL #${session.channelName} (SUARA & TEKS TERSINKRONISASI)]:\n` +
            `Berikut rekaman kronologis percakapan live yang sedang berlangsung di Voice Channel #${session.channelName} (gabungan ucapan suara di VC dan pesan teks di chat VC):\n` +
            `${transcript}\n\n` +
            `ATURAN SINKRONISASI KONTEKS VC:\n` +
            `1. Obrolan suara di VC dan ketikan teks di chat VC adalah SATU KESATUAN obrolan yang sama (saling terhubung & sinkron).\n` +
            `2. Jika lawan bicara menanyakan sesuatu yang berkaitan dengan apa yang tadi diomongin di suara VC (atau di chat VC), sambungkan secara presisi, cerdas, dan natural tanpa merasa bahwa kamu tidak tahu apa yang dibahas.\n` +
            `3. Kecuali jika user secara eksplisit menanyakan topik yang sama sekali baru di luar obrolan VC, jawablah topik baru tersebut secara mandiri.`;
        }
      }
    } catch (_) {}
  }

  let searchContext = scrapedDataContent;
  if (!searchContext && needsSearch(userPrompt) && imageUrls.length === 0) {
    console.log(`[AZURA Web Search]: Auto-triggering Tavily search for prompt: "${userPrompt}"`);
    searchContext = await searchWeb(userPrompt);
  }

  let userContent;
  if (imageUrls.length > 0) {
    userContent = [
      { type: 'text', text: userPrompt || 'Coba lihat gambar ini dan kasih tanggapan kamu.' }
    ];
    for (const url of imageUrls) {
      userContent.push({
        type: 'image_url',
        image_url: { url: url, detail: 'low' }
      });
    }
  } else {
    userContent = userPrompt;
  }

  let systemMessage = systemPrompt + liveVcContext;
  if (searchContext) {
    systemMessage += `\n\nKonteks Data Real-Time dari Internet (Tavily AI Search):\n${searchContext}\n\nInstruksi Penyampaian Hasil Pencarian:\n- Jawablah menggunakan fakta di atas dengan gaya bahasa santai, cerdas, dan hangat khas Azura.\n- Susun penjelasan secara rapi dan enak dibaca.\n- Cantumkan tautan link sumber jika relevan.`;
  }

  const messages = [
    { role: 'system', content: systemMessage },
    ...history,
    { role: 'user', content: userContent }
  ];

  // Token Tiering: Full capacity for Server & Owner DM, 1/3 capacity for regular members in DM
  const isRegularMemberDM = isDM && !isOwner;
  const effectiveMaxOutputTokens = isRegularMemberDM
    ? Math.floor((config.MAX_OUTPUT_TOKENS || 50000) / 3)
    : (config.MAX_OUTPUT_TOKENS || 50000);

  const effectiveMaxContextTokens = isRegularMemberDM
    ? Math.floor((config.MAX_CONTEXT_TOKENS || 100000) / 3)
    : (config.MAX_CONTEXT_TOKENS || 100000);

  const client = getOpenAIClient();

  try {
    const completion = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: messages,
      max_completion_tokens: effectiveMaxOutputTokens
    });

    const rawResponse = completion.choices[0]?.message?.content?.trim() || 'eh sori, otak gw blank bentar.';
    const aiResponse = sanitizeAiOutput(rawResponse, userPrompt);

    const historyPrompt = imageUrls.length > 0 ? `[${userName} - Mengirim gambar]: ${userPrompt}` : `[${userName}]: ${userPrompt}`;
    budgetGuard.addMessageToContext(contextKey, 'user', historyPrompt, effectiveMaxContextTokens);
    budgetGuard.addMessageToContext(contextKey, 'assistant', aiResponse, effectiveMaxContextTokens);

    return aiResponse;
  } catch (error) {
    console.error('[AZURA Error - OpenAI API]:', error.message || error);

    // Adaptive Auto-Recovery: Retry with clean context and natural model token capacity
    console.log(`[AZURA Recovery]: Retrying with adaptive token capacity for ${contextKey}...`);
    budgetGuard.resetContext(contextKey);
    try {
      const retryCompletion = await client.chat.completions.create({
        model: config.OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userContent }
        ]
      });
      const rawRetry = retryCompletion.choices[0]?.message?.content?.trim() || 'eh sori, otak gw blank bentar.';
      const retryResponse = sanitizeAiOutput(rawRetry, userPrompt);
      budgetGuard.addMessageToContext(contextKey, 'user', userPrompt, effectiveMaxContextTokens);
      budgetGuard.addMessageToContext(contextKey, 'assistant', retryResponse, effectiveMaxContextTokens);
      return retryResponse;
    } catch (retryErr) {
      console.error('[AZURA Retry Error]:', retryErr.message || retryErr);
    }

    return 'sabar bentar ya, koneksi AI lagi penyesuaian dikit. coba tanya lagi!';
  }
}

/**
 * Post-processing sanitizer to remove black-hat SEO spam or foreign script leaks
 * @param {string} text 
 * @param {string} prompt 
 * @returns {string}
 */
function sanitizeAiOutput(text, prompt = '') {
  if (!text || typeof text !== 'string') return text;

  let clean = text;

  // If user prompt did not contain Chinese/Japanese/Korean characters, strip accidental CJK SEO spam injections (e.g. 天天中彩票实名)
  const hasCjkInPrompt = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(prompt);
  if (!hasCjkInPrompt) {
    clean = clean.replace(/[\u4e00-\u9fff]{2,}/g, '');
  }

  return clean.replace(/[ \t]+/g, ' ').replace(/\n\s+\n/g, '\n\n').trim();
}

module.exports = {
  askAzura,
  getSystemPrompt
};
