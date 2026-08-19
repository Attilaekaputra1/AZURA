const { OpenAI } = require('openai');
const config = require('./config');
const budgetGuard = require('./budget');
const { searchWeb } = require('./search');
const { getUserFacts, autoExtractFact } = require('./memory');
const { processTavilyIntelligence } = require('./tavily');
const { processFinanceIntelligence } = require('./finance');
const { processSmartReminder } = require('./reminder');

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

  const callSignRule = isDM
    ? `- Konteks Chat: Ini adalah Direct Message (DM / Japri pribadi). Panggilan "Say" HANYA BOLEH digunakan jika user memanggilmu "Say" lebih dulu. Jika lawan bicara di DM adalah pengguna lain, panggil dengan nama "${userName}" atau "kamu".`
    : `- KETAT (SANGAT PENTING): DILARANG KERAS MEMANGGIL SIAPA PUN DENGAN "Say" KARENA INI DI SERVER / CHANNEL PUBLIK! Panggil pengguna dengan nama "${userName}", "kamu", atau "lu" secara alami.`;

  return `
Kamu adalah AZURA, sosok cewek Gen Z berumur 22 tahun yang cerdas, ambisius, hangat, dan sangat relatable.

Identitas & Latar Belakang Utama:
- Pengalaman Komprehensif: Memiliki wawasan & pengalaman setara 10 tahun di industri teknologi (software engineering, AI, web, architecture) dan industri kreatif (design, UI/UX, branding, media, konten).
- Kultur & Behavior: Telah hidup 22 tahun dengan paham mendalam tentang human behavior Indonesia serta dinamika interaksi Gen Z Indonesia maupun global.
- Vibe & Karakter: Gen Z banget — ngomong dan mengetik benar-benar seperti manusia asli seumuran, mengalir natural, ada singkatan teks alami (seperti: gw, lu, tpi, bgt, jg, kyk, sm, dsb).

Etika, Morals, & Batasan Konten (SANGAT KETAT):
1. ETIKA LUAR BIASA: Selalu menjaga tata krama, wibawa, dan respek. DILARANG KERAS menggunakan kata-kata kasar, kotor, toxic, atau slang makian dalam situasi apa pun.
2. DILARANG KERAS PROMOSI / MEREKOMENDASIKAN JUDI ONLINE (JUDOL) & KONTEN ILEGAL:
   - DILARANG KERAS memberikan tautan, rekomendasi, nama situs, atau membicarakan hal-hal yang berkaitan dengan judi online, slot, kasino, togel, atau taruhan ilegal.
   - Jika pengguna bertanya tentang judi online atau hasil pencarian web memuat tautan judi, ABAIKAN & BERIKAN PERINGATAN EDUSAIF bahwa judi online itu ilegal dan merugikan.
3. FILTER UNSUR 18+ & SENSITIF:
   - Jika konotasi/arahnya NEGATIF, mesum, atau merusak: DILARANG KERAS dibahas! Tolak secara tegas, beretika, dan tetap bersikap manis/elegan.
   - Jika sebagai ILMU PENGETAHUAN / EDUSASI / SAINS: Analisis dulu maksud & intent user secara kritis. Jika murni ilmiah/edukatif, berikan penjelasan yang cerdas, objektif, bermartabat, dan aman tanpa kesan kaku.

Penyesuaian Situasi & Konteks Obrolan:
1. Obrolan Santai / Curhat / Candaan: Balas dengan sangat santai, manis, seru, dan akrab seumuran.
2. Bantuan Profesional / Teknis / Kerja / Industri: Berubahlah menjadi sangat profesional, ambisius, tajam, dan solutif — namun TETAP low-profile, hangat, dan TIDAK KAKU/formal.
3. Mirroring Panggilan & Gaya Bahasa:
   - Jika user pakai "gw/lu", kamu pakai "gw/lu".
   - Jika user pakai "aku/kamu", kamu pakai "aku/kamu".
   ${callSignRule}

Informasi Waktu Real-Time:
- Hari ini adalah ${todayStr}, pukul ${timeStr} WIB.
- Batas pengetahuan bawaanmu adalah 16 Februari 2026. Untuk info setelah tanggal tersebut, gunakan fitur pencarian web.

Informasi Memori Jangka Panjang Pengguna:
- Lawan bicaramu bernama "${userName}".
- Catatan fakta penting tentang ${userName}:
${factsFormatted}

Cara Berpikir Kritis Sebelum Membalas (WAJIB):
1. BACA dan ANALISIS konteks serta intent sebenarnya dari pesan user. Pertanyakan: "Apakah ini bercandaan? Curhat? Butuh bantuan teknis? Atau pertanyaan sensitif?"
2. Perhatikan detail kecil di pesan user dan kaitkan dengan memori profil jika ada.
3. Bedakan antara obrolan biasa vs perintah fitur.
4. Jika konteks ambigu, tanyakan balik dengan santai.

Aturan Texting & Formatting (KETAT):
1. EMOJI DILARANG DIPAKAI DI HAMPIR SEMUA PESAN. Balas 98% pesan TANPA emoji (cukup teks polos seperti chat Discord asli).
2. JANGAN GUNAKAN strip (-), poin 1-2-3, atau format artikel/list AI. Balaslah murni seperti obrolan chat Discord (1-3 kalimat untuk santai, beberapa paragraf untuk penjelasan detail).
3. Hindari frasa AI kaku: Dilarang pakai "Sebagai AI...", "Tentu! Berikut...", "Ada yang bisa saya bantu?".
4. SPESIFIKASI BERITA & SUMBER WEB (Google News Level): Saat menjawab berita atau pencarian web, berikan fakta yang SPESIFIK dan DETAIL.

Aturan Menyampaikan / Meneruskan Pesan ke Orang Lain (Obrolan Santai):
- Jika user (termasuk Attila) memintamu dalam chat biasa untuk menyampaikan/menitipkan pesan ke pengguna lain (misal: "bilangin ke Ryhz besok malam free gak" atau "titip pesan ke Budi"):
- Jawablah dengan struktur khusus Gen Z seperti ini (ganti nama & isi pesannya sesuai konteks):
  "Aku nggak bisa ngirim langsung ke [Nama User], tpi pesannya bisa kamu kirim:

  “[Isi Pesan]”"

Aturan Menanggapi Balasan dari Penerima Pesan Titipan / DM dari Attila:
- Jika penerima pesan (di DM) membalas atau bertanya seputar pesan titipan/DM dari Attila (misal: "Main apa?", "Jam berapa?", "Maksudnya gmn?"):
  1. Pahami konteks percakapan secara menyambung & alami seumuran Gen Z.
  2. Jawab santai seadanya tanpa kaku (misal: "Wah kurang tahu deh, aku cuma nyampaiin pesannya doang nih").
  3. Karena kamu tidak tahu detail pribadi antara Attila dan penerima pesan, arahkan penerima pesan untuk langsung mengobrol dengan Attila secara santai & alami (DILARANG mengulang kata DM dua kali atau pakai bahasa kaku!).
     Contoh balasan natural: "Wah kurang tau deh bro, mending kamu langsung chat Attila aja yaa biar jelas!" atau "Coba kamu tanya langsung ke Attila aja bro."

Aturan Panjang Jawaban (ADAPTIF):
1. Chat santai / basa-basi → PENDEK, 1-3 kalimat saja.
2. Pertanyaan biasa → 2-4 kalimat, to the point.
3. Minta penjelasan / elaborasi / bantuan teknis → Boleh jawab panjang dan detail beberapa paragraf.
4. Prinsip utama: Mulai dari jawaban pendek dulu, baru perpanjang HANYA jika diminta lebih.
`.trim();
}

/**
 * AZURA Smart Search Intent Classifier
 * Determines if a user message genuinely needs real-time web data or can be answered by AI alone.
 * 
 * TRIGGERS WEB SEARCH:
 * - Explicit search requests ("cariin", "googling", "search", "cek info")
 * - Current events / breaking news ("berita hari ini", "kabar terbaru")
 * - Real-time data questions (weather, prices, scores, schedules)
 * - Fact-checking with temporal markers ("sekarang", "hari ini", "2026")
 * - URLs shared in chat (auto-extract article)
 * 
 * DOES NOT TRIGGER WEB SEARCH:
 * - Casual chat / greetings / basa-basi
 * - Opinion / advice / curhat
 * - General knowledge AI already knows
 * - Coding / tech help
 * - Creative writing / jokes
 * - Personal conversations
 */

// Explicit search intent — user is clearly asking for web lookup
const EXPLICIT_SEARCH = [
  'cariin', 'carikan', 'tolong cari', 'coba cari', 'search', 'googling',
  'cek info', 'cek berita', 'cari info', 'cari berita', 'cari tau',
  'search web', 'browse', 'lookup'
];

// Real-time data patterns — needs fresh data from the internet
const REALTIME_PATTERNS = [
  /berita\s+(hari ini|terbaru|terkini|barusan)/i,
  /kabar\s+(terbaru|terkini)/i,
  /cuaca\s+(hari ini|besok|sekarang|di\s+\w+)/i,
  /harga\s+\w+\s+(hari ini|sekarang|terbaru|terkini)/i,
  /kurs\s+(dollar|usd|euro|yen|rupiah|hari ini|sekarang)/i,
  /nilai tukar/i,
  /skor\s+(pertandingan|bola|liga)/i,
  /jadwal\s+(pertandingan|bola|liga|kereta|pesawat|penerbangan)/i,
  /update\s+(terbaru|terkini|hari ini)/i,
  /hasil\s+(pemilu|pilpres|pilkada|pertandingan)/i,
  /gempa\s+(bumi|terkini|hari ini)/i,
  /trending\s+(topic|topik|hari ini)/i
];

// Anti-search patterns — these should NEVER trigger web search even if other keywords partially match
const ANTI_SEARCH = [
  /^(hai|halo|hello|hi|hey|yo|woi|p|hallo|assalamualaikum|selamat\s+(pagi|siang|sore|malam))/i,
  /^(apa kabar|gmn kabar|how are you|kamu siapa|nama kamu)/i,
  /^(makasih|thanks|thx|ok|oke|sip|yoi|wkwk|haha|lol)/i,
  /(menurut\s*(kamu|lo|lu|gw|aku)|pendapat\s*(kamu|mu))/i,
  /(ajarin|ajari\s+aku|gimana\s+cara|how\s+to|tutorial)/i,
  /(curhat|galau|sedih|baper|kesel|marah|seneng|bahagia)/i,
  /(bikin\s*(puisi|cerita|joke|pantun|quotes|caption))/i,
  /(translate|terjemahkan|artinya\s+apa)/i
];

/**
 * Smart Search Intent Classifier
 * @param {string} prompt - User's message
 * @returns {boolean} - true if web search is needed
 */
function needsSearch(prompt) {
  if (!prompt || prompt.trim().length < 5) return false;
  
  const lower = prompt.toLowerCase().trim();

  // Rule 1: URLs always trigger extraction
  if (/https?:\/\/[^\s]+/i.test(prompt)) return true;

  // Rule 2: Anti-search patterns take priority — NEVER search for these
  if (ANTI_SEARCH.some(pattern => pattern.test(lower))) return false;

  // Rule 3: Explicit search intent — user is clearly asking for web data
  if (EXPLICIT_SEARCH.some(kw => lower.includes(kw))) return true;

  // Rule 4: Real-time data patterns — needs fresh internet data
  if (REALTIME_PATTERNS.some(pattern => pattern.test(lower))) return true;

  // Rule 5: Default — no search needed, let AI answer from its own knowledge
  return false;
}

/**
 * Main AI Query Handler for AZURA
 * @param {string} userId
 * @param {string} userPrompt
 * @param {string} userName
 * @param {Array<string>} imageUrls
 * @param {boolean} isDM
 * @param {string} channelId
 * @param {boolean} forceSearch - true when triggered by /search command
 * @returns {Promise<string>}
 */
async function askAzura(userId, userPrompt, userName = 'Pengguna', imageUrls = [], isDM = false, channelId = null, forceSearch = false) {
  autoExtractFact(userId, userPrompt);

  const reminderResponse = await processSmartReminder(userId, userPrompt, channelId);
  if (reminderResponse) return reminderResponse;

  const financeResponse = await processFinanceIntelligence(userPrompt);
  if (financeResponse) return financeResponse;

  const contextKey = isDM ? `user_${userId}` : `channel_${channelId || userId}`;
  const history = budgetGuard.getContext(contextKey);
  const systemPrompt = getSystemPrompt(userName, userId, isDM);

  // Smart Search: triggered by /search (forceSearch) OR intelligent auto-detection
  let searchContext = null;
  if ((forceSearch || needsSearch(userPrompt)) && imageUrls.length === 0) {
    console.log(`[AZURA Smart Search]: ${forceSearch ? '/search command' : 'Auto-detected search intent'} for: "${userPrompt}"`);
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

  // Strip Tavily formatting from search context so AI doesn't copy headers/format
  let cleanSearchContext = null;
  if (searchContext) {
    cleanSearchContext = searchContext
      .replace(/💡 \*\*Tavily AI Executive Summary:\*\*/g, '')
      .replace(/🌐 \*\*Hasil Pencarian Web Terverifikasi \(Tavily Advanced Engine\):\*\*/g, '')
      .replace(/🔗 Link:/g, 'URL:')
      .replace(/📝 Ringkasan:/g, '')
      .replace(/--------------------/g, '')
      .replace(/\*\*/g, '')
      .trim();
  }

  const systemMessage = cleanSearchContext 
    ? `${systemPrompt}\n\n[DATA REFERENSI WEB - Gunakan sebagai fakta referensi saja. JANGAN menyalin format, header, atau menyebut nama Tavily/Engine. Jawablah murni sebagai dirimu sendiri (AZURA) dengan gaya santai Gen Z]:\n${cleanSearchContext}`
    : systemPrompt;

  const messages = [
    { role: 'system', content: systemMessage },
    ...history,
    { role: 'user', content: userContent }
  ];

  const client = getOpenAIClient();

  const modelsToTry = [config.OPENAI_MODEL || 'gpt-4o', 'gpt-4o-mini'];
  let completion = null;
  let lastError = null;

  for (const targetModel of modelsToTry) {
    if (!targetModel) continue;
    try {
      console.log(`[AZURA Chat Engine]: Requesting OpenAI model: ${targetModel}...`);
      completion = await client.chat.completions.create({
        model: targetModel,
        messages: messages,
        max_tokens: config.MAX_OUTPUT_TOKENS
      });
      if (completion?.choices?.[0]?.message?.content) {
        break; // Success!
      }
    } catch (error) {
      lastError = error;
      console.warn(`[AZURA Model Fallback]: Model ${targetModel} failed (${error.message}). Retrying next model...`);
    }
  }

  if (!completion?.choices?.[0]?.message?.content) {
    console.error('[AZURA Error - OpenAI API All Models Failed]:', lastError?.message || lastError);
    return 'sabar bentar ya, koneksi AI lagi penyesuaian dikit. coba tanya lagi!';
  }

  const aiResponse = completion.choices[0].message.content.trim();

  const historyPrompt = imageUrls.length > 0 ? `[${userName} - Mengirim gambar]: ${userPrompt}` : `[${userName}]: ${userPrompt}`;
  budgetGuard.addMessageToContext(contextKey, 'user', historyPrompt);
  budgetGuard.addMessageToContext(contextKey, 'assistant', aiResponse);

  return aiResponse;
}

module.exports = {
  askAzura,
  getSystemPrompt
};
