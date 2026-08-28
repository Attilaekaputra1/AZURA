/**
 * AZURA Autonomous Voice Behaviors Subsystem
 * Handles 3-minute silence spontaneous singing/humming, 10-minute silence icebreakers,
 * 10-second absence auto-replies, and idle lifecycle timers.
 */

// Spontaneous singing & humming library for 3-minute silence in VC
const SPONTANEOUS_SONGS = [
  '[humming] Hm hm hm hm... [sings] Balonku ada lima... rupa-rupa warnanya... merah kuning kelabu... [softly] meletus balon hijau, dor! [gasp] [laughs] kaget sendiri kan tuh.',
  '[sings] Pelangi-pelangi alangkah indahmu... merah kuning hijau di langit yang biru... [humming] la la la la... [softly] hening banget, pada melamun ya? [giggles]',
  '[sings] Bintang kecil di langit yang tinggi... amat banyak menghias angkasa... [softly] ku ingin terbang dan melayang... [giggles] aduh jadi pengen rebahan.',
  '[humming] Hm hm hm... [sings] Burung kakak tua... hinggap di jendela... [softly] nenek sudah tua... giginya tinggal dua... [laughs] klasik banget lagunya.',
  '[sings] Naik-naik ke puncak gunung... tinggi-tinggi sekali... [humming] kiri kanan kulihat saja... banyak pohon cemara... [laughs] adem banget vibes-nya.',
  '[sings] Topi saya bundar... bundar topi saya... [softly] kalau tidak bundar... bukan topi saya... [giggles] kok aku jadi nyanyi lagu anak-anak ya?',
  '[humming] Hm hm hm hm... [sings] Cicak-cicak di dinding... diam-diam merayap... [softly] datang seekor nyamuk... hap! lalu ditangkap... [giggles] dapet nyamuknya!',
  '[sings] Sayonara sayonara... sampai berjumpa lagi... [laughs] eh jangan udahan dulu deng, kan lagi santai di VC.',
  '[humming] Hm hm hm... [sings] Ambilkan bulan bu... ambilkan bulan bu... yang selalu bersinar di langit... [softly] suasananya tenang banget malam ini.',
  '[humming] Hm hm hm... la la la... [softly] hmm lagu apa lagi ya yang enak? Kalau sepi gini hawanya pengen karaokean deh [giggles].',
  '[humming] Hm hm hm... la la la la la... [sings] ku bahagia bersama kalian di sini... [laughs] asik sendiri deh aku.',
  '[sings] Satu-satu aku sayang Attila... dua-dua juga sayang semuanya... [giggles] tiga-tiga sayang semuanya... satu dua tiga sayang semuanya!'
];

const pendingAttilaVoiceCalls = new Map(); // guildId -> { timer, channel, targetUser }
const hummingTimers = new Map();          // guildId -> Timeout

/**
 * Start or reset 3-minute spontaneous singing timer
 */
function resetHummingTimer(guildId, audioPlayers, textToAudioResource, playInVC, isBotSpeaking, client) {
  if (hummingTimers.has(guildId)) {
    clearTimeout(hummingTimers.get(guildId));
    hummingTimers.delete(guildId);
  }

  const timer = setTimeout(async () => {
    try {
      const player = audioPlayers.get(guildId);
      if (!player) return;
      if (isBotSpeaking && isBotSpeaking.has(guildId)) return;

      const randomSong = SPONTANEOUS_SONGS[Math.floor(Math.random() * SPONTANEOUS_SONGS.length)];
      console.log(`[Autonomous Singing]: 🎵 3 minutes of VC silence. Triggering spontaneous song: "${randomSong.slice(0, 50)}..."`);
      
      const audioResource = await textToAudioResource(randomSong, client);
      if (audioResource) {
        await playInVC(guildId, audioResource);
      }
    } catch (err) {
      console.warn('[Autonomous Singing Warning]:', err.message);
    } finally {
      resetHummingTimer(guildId, audioPlayers, textToAudioResource, playInVC, isBotSpeaking, client);
    }
  }, 3 * 60 * 1000);

  hummingTimers.set(guildId, timer);
}

function clearHummingTimer(guildId) {
  if (hummingTimers.has(guildId)) {
    clearTimeout(hummingTimers.get(guildId));
    hummingTimers.delete(guildId);
  }
}

module.exports = {
  SPONTANEOUS_SONGS,
  pendingAttilaVoiceCalls,
  hummingTimers,
  resetHummingTimer,
  clearHummingTimer
};
