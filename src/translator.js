const https = require('https');

/**
 * Translate text using free MyMemory Translated API
 * @param {string} text 
 * @param {string} langPair - e.g. "en|id", "id|en", "ja|id", "autodetect|id"
 * @returns {Promise<string>}
 */
async function translateText(text, langPair = 'autodetect|id') {
  return new Promise((resolve) => {
    const cleanText = text.slice(0, 500).trim();
    const encodedText = encodeURIComponent(cleanText);
    const encodedPair = encodeURIComponent(langPair);

    https.get(`https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${encodedPair}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.responseData && json.responseData.translatedText) {
            const result = json.responseData.translatedText;
            const matchQuality = json.responseData.match ? `(Akurasi: ${(json.responseData.match * 100).toFixed(0)}%)` : '';
            resolve(`🔤 **Hasil Penerjemahan (MyMemory Translation API):**\n${result} ${matchQuality}`);
          } else {
            resolve('Gagal menerjemahkan teks tersebut.');
          }
        } catch (err) {
          resolve('Gagal mengurai hasil terjemahan.');
        }
      });
    }).on('error', () => resolve('Gagal terhubung ke server MyMemory Translation.')).setTimeout(5000, function() {
      this.destroy();
      resolve('Waktu penerjemahan habis.');
    });
  });
}

/**
 * Smart Translator Intelligence Router
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function processTranslationIntelligence(prompt) {
  const lower = prompt.toLowerCase().trim();

  // Explicit translate trigger: "terjemahkan: ...", "translate: ...", "artinya apa: ..."
  const transMatch = lower.match(/(?:terjemahkan|translate|artinya|artikan)\s*(?:ke|in)?\s*(indonesia|inggris|jepang)?\s*[:,]?\s*(.+)/i);

  if (transMatch && transMatch[2]) {
    const targetLang = (transMatch[1] || '').toLowerCase();
    let langPair = 'autodetect|id'; // Default target: Indonesian

    if (targetLang === 'inggris' || targetLang === 'english') {
      langPair = 'autodetect|en';
    } else if (targetLang === 'jepang' || targetLang === 'japanese') {
      langPair = 'autodetect|ja';
    }

    const textToTranslate = transMatch[2].trim();
    if (textToTranslate.length >= 2) {
      console.log(`[Translator Engine]: Translating text (pair: ${langPair}): "${textToTranslate.slice(0, 30)}..."`);
      return await translateText(textToTranslate, langPair);
    }
  }

  return null;
}

module.exports = {
  translateText,
  processTranslationIntelligence
};
