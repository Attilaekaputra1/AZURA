/**
 * AZURA Voice Intent Router Subsystem
 * Comprehensive Voice Intent & Summon Analyzer:
 * 1. Wake-Word Detection (Awal Kalimat, Akhir Kalimat, Direct Vocative)
 * 2. Intent Categorization (Question vs Statement/Banter vs Command vs Direct Call)
 * 3. 3rd-Person Filter (Strict silence if talking about Azura in 3rd person)
 */

const WAKE_WORDS = new Set([
  'azura', 'ara', 'zura', 'ajura', 'ajur', 'asura',
  'azuraa', 'araa', 'zuraa', 'ajuraa', 'ajurr',
  'azura,', 'ara,', 'zura,', 'ajur,', 'asura,',
  'kak azura', 'kak ara', 'kak zura', 'kak ajur'
]);

/**
 * Check if the transcript contains Azura's wake word
 * @param {string} transcript 
 * @returns {boolean}
 */
function hasWakeWord(transcript) {
  if (!transcript) return false;
  const clean = transcript.toLowerCase();
  return /\b(?:azura|ara|zura|ajur|ajura|asura|kak\s+azura|kak\s+ara|kak\s+ajur)\b/i.test(clean);
}

/**
 * Comprehensive Voice Intent & Summon Analyzer
 * @param {string} transcript 
 */
function analyzeVoiceIntent(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    return {
      hasWakeWord: false,
      wakePosition: 'none',
      isQuestion: false,
      isCommand: false,
      isBanter: false,
      isThirdPerson: false,
      category: 'STATEMENT'
    };
  }

  const raw = transcript.trim();
  const clean = raw.toLowerCase().replace(/[.,!?;:'"()[\]]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);

  // 1. Strict Silence on 3rd-person conjunction "si" (e.g. "si azura", "si ara", "si zura", "si ajur")
  const isThirdPersonWithSi = /\b(?:si\s+(?:azura|ara|zura|asura|ajura|ajur))\b/i.test(clean);
  const isPassiveThirdPerson = /\b(?:tentang\s+(?:azura|ara|zura|ajur|ajura)|bot\s+(?:azura|ara|zura|ajur|ajura)|azura\s*nya|ara\s*nya|zura\s*nya|ajur\s*nya|kalau\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|mungkin\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|katanya\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|sama\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura)|ke\s+(?:si\s+)?(?:azura|ara|zura|ajur|ajura))\b/i.test(clean);

  if (isThirdPersonWithSi || isPassiveThirdPerson) {
    return {
      hasWakeWord: false,
      wakePosition: 'none',
      isQuestion: false,
      isCommand: false,
      isBanter: false,
      isThirdPerson: true,
      category: 'STATEMENT'
    };
  }

  // 2. Wake-word position analysis
  let detectedWake = false;
  let wakePosition = 'none';

  // A. Check BEGINNING (first 4 words)
  const prefixLimit = Math.min(words.length, 4);
  for (let i = 0; i < prefixLimit; i++) {
    if (WAKE_WORDS.has(words[i]) || (words[i] === 'kak' && i + 1 < words.length && WAKE_WORDS.has(words[i + 1]))) {
      detectedWake = true;
      wakePosition = 'beginning';
      break;
    }
  }

  // B. Check END (last 4 words)
  if (!detectedWake) {
    const suffixStart = Math.max(0, words.length - 4);
    for (let i = suffixStart; i < words.length; i++) {
      if (WAKE_WORDS.has(words[i]) || (words[i] === 'kak' && i + 1 < words.length && WAKE_WORDS.has(words[i + 1]))) {
        detectedWake = true;
        wakePosition = 'end';
        break;
      }
    }
  }

  // C. Check Middle Vocative / Direct Call directed at Azura
  if (!detectedWake) {
    const isDirectQuestionToAzura = /\b(?:gimana|apa|kenapa|tolong|coba|siapa|kapan|apakah|bisa\s+gak|boleh\s+gak|menurutmu|menurut\s+kamu|lagi\s+ngapain|sehat\s+kan|halo|hai|eh)\b.*?\b(?:azura|ara|zura|ajur|ajura)\b/i.test(clean);
    if (isDirectQuestionToAzura) {
      detectedWake = true;
      wakePosition = 'middle';
    }
  }

  // 3. Question Detection
  const hasQuestionMark = raw.includes('?');
  const questionWordsRegex = /\b(?:apa|kenapa|mengapa|bagaimana|gimana|siapa|kapan|dimana|kemana|dari\s+mana|apakah|bisa\s+gak|boleh\s+gak|tau\s+gak|tahu\s+gak|bener\s+gak|iya\s+gak|beneran|emang|menurutmu|menurut\s+kamu|lagi\s+ngapain|ada\s+apa|udah\s+belum|sudah\s+belum|kamu\s+tau|bisa\s+bantu)\b/i;
  const questionSuffixRegex = /\b(?:ya\?|kah\?|dong\?|kan\?|sih\?|tuh\?|kah|kan)\b/i;
  const isQuestion = hasQuestionMark || questionWordsRegex.test(clean) || questionSuffixRegex.test(clean);

  // 4. Command Detection
  const commandRegex = /\b(?:setel|putar|play|nyanyi|sing|cerita|dongeng|lelucon|jokes|krik|buka|search|cari|bantu|keluar|leave)\b/i;
  const isCommand = commandRegex.test(clean);

  // 5. Banter / Teasing Detection
  const banterRegex = /\b(?:haha|wkwk|hehe|lucu|kocak|canda|jail|ledek|ngakak|garing|cie|sayang|ganteng|cantik|imut)\b/i;
  const isBanter = banterRegex.test(clean);

  let category = 'STATEMENT';
  if (isCommand) category = 'COMMAND';
  else if (isQuestion) category = 'QUESTION';
  else if (isBanter) category = 'BANTER';
  else if (detectedWake && words.length <= 3) category = 'CALL';

  return {
    hasWakeWord: detectedWake,
    wakePosition,
    isQuestion,
    isCommand,
    isBanter,
    isThirdPerson: false,
    category
  };
}

function isWakeWordInvoked(transcript) {
  const intent = analyzeVoiceIntent(transcript);
  return intent.hasWakeWord;
}

module.exports = {
  WAKE_WORDS,
  hasWakeWord,
  analyzeVoiceIntent,
  isWakeWordInvoked
};
