const { OpenAI } = require('openai');
const config = require('./config');
const budgetGuard = require('./budget');
const { searchWeb } = require('./search');
const { getUserFacts, autoExtractFact } = require('./memory');
const { processTavilyIntelligence } = require('./tavily');
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
2. FILTER UNSUR 18+ & SENSITIF:
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

// Keywords that trigger web search
const SEARCH_KEYWORDS = [
  'berita', 'news', 'terbaru', 'terkini', 'hari ini',
  'cuaca', 'weather', 'harga', 'price', 'kurs',
  'search', 'cari', 'cariin', 'googling', 'cek info',
  'siapa itu', 'apa itu', 'kapan', 'update'
];

function needsSearch(prompt) {
  const lower = prompt.toLowerCase();
  return SEARCH_KEYWORDS.some(kw => lower.includes(kw));
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

  const tavilyResponse = await processTavilyIntelligence(userPrompt);
  if (tavilyResponse) return tavilyResponse;

  const financeResponse = await processFinanceIntelligence(userPrompt);
  if (financeResponse) return financeResponse;

  const imageGenResponse = await processImageIntelligence(userPrompt, userName, guildId, userId, isOwner, imageUrls);
  if (imageGenResponse && imageGenResponse.isImageRequest) return imageGenResponse.responsePayload;

  const contextKey = isDM ? `user_${userId}` : `channel_${channelId || 'main'}_user_${userId}`;
  const history = budgetGuard.getContext(contextKey);
  const systemPrompt = getSystemPrompt(userName, userId, isDM);

  let searchContext = null;
  if (needsSearch(userPrompt) && imageUrls.length === 0) {
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

  const systemMessage = searchContext 
    ? `${systemPrompt}\n\nKonteks dari internet (gunakan sebagai referensi, sampaikan secara santai):\n${searchContext}`
    : systemPrompt;

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

    const aiResponse = completion.choices[0]?.message?.content?.trim() || 'eh sori, otak gw blank bentar.';

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
      const retryResponse = retryCompletion.choices[0]?.message?.content?.trim() || 'eh sori, otak gw blank bentar.';
      budgetGuard.addMessageToContext(contextKey, 'user', userPrompt, effectiveMaxContextTokens);
      budgetGuard.addMessageToContext(contextKey, 'assistant', retryResponse, effectiveMaxContextTokens);
      return retryResponse;
    } catch (retryErr) {
      console.error('[AZURA Retry Error]:', retryErr.message || retryErr);
    }

    return 'sabar bentar ya, koneksi AI lagi penyesuaian dikit. coba tanya lagi!';
  }
}

module.exports = {
  askAzura,
  getSystemPrompt
};
