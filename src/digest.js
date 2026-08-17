const config = require('./config');

const stats = {
  mentionsReceived: 0,
  mentionsForwarded: 0,
  dmsSent: 0,
  lastDigestDate: ''
};

function incrementStat(key) {
  if (stats[key] !== undefined) {
    stats[key]++;
  }
}

/**
 * Check if current time is 21:00 WIB and send Daily Digest to Attila's DM
 * @param {import('discord.js').Client} client 
 */
async function checkDailyDigest(client) {
  const ownerId = config.OWNER_DISCORD_ID;
  if (!ownerId) return;

  const now = new Date();
  const options = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
  const timeStr = now.toLocaleTimeString('id-ID', options); // e.g. "21:00"
  const dateStr = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });

  // Only trigger once per day around 21:00 WIB
  if (timeStr.startsWith('21:00') && stats.lastDigestDate !== dateStr) {
    stats.lastDigestDate = dateStr;

    try {
      const ownerUser = await client.users.fetch(ownerId).catch(() => null);
      if (ownerUser) {
        const uptimeSec = Math.floor(process.uptime());
        const hours = Math.floor(uptimeSec / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);

        const digestMessage = `
📊 **[AZURA DAILY DIGEST] Ringkasan Laporan Harian - ${dateStr}**

• **Mention Masuk Server**: \`${stats.mentionsReceived} kali\`
• **Mention Di-Forward (Auto-Reply)**: \`${stats.mentionsForwarded} kali\`
• **Pesan DM Terkirim**: \`${stats.dmsSent} pesan\`
• **System Uptime Bot**: \`${hours} jam ${mins} menit\`
• **Status System**: 🟢 100% Online & Normal

*Laporan ini dikirimkan otomatis setiap hari pukul 21:00 WIB.*
        `.trim();

        await ownerUser.send(digestMessage);
        console.log(`[DailyDigest]: Sent 21:00 WIB daily digest report to Attila.`);

        // Reset daily counters
        stats.mentionsReceived = 0;
        stats.mentionsForwarded = 0;
        stats.dmsSent = 0;
      }
    } catch (err) {
      console.error('[DailyDigest Error]:', err.message);
    }
  }
}

module.exports = {
  incrementStat,
  checkDailyDigest
};
