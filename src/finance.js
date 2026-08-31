const https = require('https');

/**
 * Fetch Live Currency Exchange Rate from ExchangeRate-API (Free Open Endpoint)
 * @param {number} amount 
 * @param {string} fromCurr 
 * @param {string} toCurr 
 * @returns {Promise<string>}
 */
async function getExchangeRate(amount = 1, fromCurr = 'USD', toCurr = 'IDR') {
  return new Promise((resolve) => {
    const from = fromCurr.toUpperCase();
    const to = toCurr.toUpperCase();

    https.get(`https://open.er-api.com/v6/latest/${from}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.result === 'success' && json.rates && json.rates[to]) {
            const rate = json.rates[to];
            const converted = (amount * rate).toLocaleString('id-ID', { maximumFractionDigits: 2 });
            const singleRate = rate.toLocaleString('id-ID', { maximumFractionDigits: 2 });

            const calc10 = (10 * rate).toLocaleString('id-ID', { maximumFractionDigits: 0 });
            const calc100 = (100 * rate).toLocaleString('id-ID', { maximumFractionDigits: 0 });
            const calc1000 = (1000 * rate).toLocaleString('id-ID', { maximumFractionDigits: 0 });

            resolve(
              `💵 **KURS MATA UANG USD ➔ IDR REAL-TIME:**\n\n` +
              `• **Nilai Konversi**: **$${amount} ${from}** = **Rp ${converted}**\n` +
              `• **Patokan Exchange Rate**: \`1 USD = Rp ${singleRate}\`\n\n` +
              `📊 **Kalkulator Cepat Dollar ➔ Rupiah:**\n` +
              `• **$10 USD** = Rp ${calc10}\n` +
              `• **$100 USD** = Rp ${calc100}\n` +
              `• **$1.000 USD** = Rp ${calc1000}\n\n` +
              `*Data diperbarui secara real-time via ExchangeRate-API.*`
            );
          } else {
            resolve('Gagal mendapatkan data kurs mata uang.');
          }
        } catch (err) {
          resolve('Gagal mengurai data kurs.');
        }
      });
    }).on('error', () => resolve('Gagal terhubung ke server kurs mata uang.')).setTimeout(5000, function() {
      this.destroy();
      resolve('Waktu koneksi kurs habis.');
    });
  });
}

/**
 * Fetch Live Crypto Price in USD & IDR from CoinGecko API
 * @param {string} coinName 
 * @returns {Promise<string>}
 */
async function getCryptoPrice(coinName = 'bitcoin') {
  const coinMap = {
    'btc': 'bitcoin',
    'bitcoin': 'bitcoin',
    'eth': 'ethereum',
    'ethereum': 'ethereum',
    'sol': 'solana',
    'solana': 'solana',
    'bnb': 'binancecoin',
    'binance': 'binancecoin',
    'doge': 'dogecoin',
    'dogecoin': 'dogecoin',
    'xrp': 'ripple',
    'ripple': 'ripple',
    'ada': 'cardano',
    'cardano': 'cardano',
    'dot': 'polkadot',
    'shib': 'shiba-inu',
    'pepe': 'pepe',
    'sui': 'sui',
    'avax': 'avalanche-2',
    'near': 'near',
    'link': 'chainlink'
  };

  const cleanName = coinName.toLowerCase().trim();
  const coinId = coinMap[cleanName] || cleanName;

  return new Promise((resolve) => {
    https.get({
      hostname: 'api.coingecko.com',
      path: `/api/v3/simple/price?ids=${coinId}&vs_currencies=usd,idr&include_24hr_change=true&include_24hr_vol=true`,
      headers: { 'User-Agent': 'AZURA-Discord-Bot/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json[coinId]) {
            const price = json[coinId];
            const usdVal = price.usd;
            const idrVal = price.idr;

            const priceUsdStr = usdVal >= 1 
              ? `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;

            const priceIdrStr = idrVal >= 100
              ? `Rp ${idrVal.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
              : `Rp ${idrVal.toLocaleString('id-ID', { maximumFractionDigits: 4 })}`;

            const change24h = price.usd_24h_change ? price.usd_24h_change.toFixed(2) : '0.00';
            const changeNum = parseFloat(change24h);
            const changeSymbol = changeNum >= 0 ? '📈 +' : '📉 ';
            const marketSentiment = changeNum >= 0 ? 'Bullish' : 'Bearish';

            const estimatedRate = (idrVal / usdVal).toLocaleString('id-ID', { maximumFractionDigits: 0 });

            resolve(
              `🪙 **HARGA KRIPTO REAL-TIME (CoinGecko):**\n\n` +
              `• **Koin**: **${coinId.toUpperCase()}**\n` +
              `• **Harga USD**: **${priceUsdStr}**\n` +
              `• **Harga Rupiah (IDR)**: **${priceIdrStr}**\n` +
              `• **Perubahan 24 Jam**: \`${changeSymbol}${change24h}%\` (${marketSentiment})\n` +
              `• **Estimasi Kurs USD/IDR**: \`1 USD = Rp ${estimatedRate}\`\n\n` +
              `*Data diperbarui secara live dari pasar kripto global.*`
            );
          } else {
            resolve(`Gagal menemukan data harga untuk koin "${coinName}". Pastikan koin tersebut ada di CoinGecko!`);
          }
        } catch (err) {
          resolve('Gagal mengurai data harga kripto.');
        }
      });
    }).on('error', () => resolve('Gagal terhubung ke CoinGecko API.')).setTimeout(5000, function() {
      this.destroy();
      resolve('Waktu koneksi CoinGecko habis.');
    });
  });
}

/**
 * Smart Finance Intelligence Router
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function processFinanceIntelligence(prompt) {
  const lower = prompt.toLowerCase().trim();

  // Currency Converter Trigger: "100 dollar berapa rupiah", "10 usd ke idr", "kurs dollar"
  const currMatch = lower.match(/(\d+[\d,.]*)\s*(dollar|usd|dolar)\s*(?:ke|berapa|in)?\s*(rupiah|idr)?/i) ||
                    lower.match(/(?:kurs|rate)\s*(dollar|usd|dolar|idr|rupiah)/i);

  if (currMatch) {
    const amount = parseFloat(currMatch[1]) || 1;
    console.log(`[Finance Engine]: Fetching USD/IDR Exchange Rate for amount: ${amount}`);
    return await getExchangeRate(amount, 'USD', 'IDR');
  }

  // Crypto Price Trigger: "harga btc", "harga 1 btc", "harga bitcoin", "harga eth", "harga solana", "berapa harga btc"
  const cryptoMatch = lower.match(/(?:harga|price|cek|berapa\s+harga)\s*(?:\d+[\d,.]*\s*)?(btc|bitcoin|eth|ethereum|sol|solana|bnb|binance|doge|xrp|ada|pepe|shib|sui)\b/i);
  if (cryptoMatch) {
    const coin = cryptoMatch[1];
    console.log(`[Finance Engine]: Fetching Crypto Price for: ${coin}`);
    return await getCryptoPrice(coin);
  }

  return null;
}

module.exports = {
  getExchangeRate,
  getCryptoPrice,
  processFinanceIntelligence
};
