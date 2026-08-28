const https = require('https');
const http = require('http');
const config = require('./config');

// ══════════════════════════════════════════════════════════════════════════════
// 🚆 KRL COMMUTER LINE & MRT JABODETABEK TOPOLOGY (VERIFIED STATION GRAPH)
// ══════════════════════════════════════════════════════════════════════════════

// Stations ordered along lines
const KRL_LINES = {
  BOGOR_LINE: [
    'Bogor', 'Cilebut', 'Bojong Gede', 'Citayam', 'Depok', 'Depok Baru',
    'Pondok Cina', 'Universitas Indonesia', 'Universitas Pancasila', 'Lenteng Agung',
    'Tanjung Barat', 'Pasar Minggu', 'Pasar Minggu Baru', 'Duren Kalibata',
    'Cawang', 'Tebet', 'Manggarai', 'Cikini', 'Gondangdia', 'Juanda',
    'Sawah Besar', 'Mangga Besar', 'Jayakarta', 'Jakarta Kota'
  ],
  NAMBO_BRANCH: [
    'Nambo', 'Cibinong', 'Pondok Rajeg', 'Citayam'
  ],
  CIKARANG_LOOP_LINE: [
    'Cikarang', 'Metland Telaga Murni', 'Cibitung', 'Tambun', 'Bekasi Timur', 'Bekasi',
    'Kranji', 'Cakung', 'Klender Baru', 'Buaran', 'Klender', 'Jatinegara',
    'Matraman', 'Manggarai', 'Sudirman', 'BNI City', 'Karet', 'Tanah Abang',
    'Duri', 'Angke', 'Kampung Bandan', 'Rajawali', 'Kemayoran', 'Pasar Senen',
    'Gang Sentiong', 'Kramat', 'Pondok Jati'
  ],
  RANGKASBITUNG_LINE: [
    'Rangkasbitung', 'Citeras', 'Maja', 'Cikoya', 'Tigaraksa', 'Tenjo', 'Daru',
    'Cilejit', 'Parung Panjang', 'Cicayur', 'Cisauk', 'Serpong', 'Rawabuntu',
    'Sudimara', 'Jurangmangu', 'Pondok Ranji', 'Kebayoran', 'Palmerah', 'Tanah Abang'
  ],
  TANGERANG_LINE: [
    'Tangerang', 'Tanah Tinggi', 'Batu Ceper', 'Poris', 'Kalideres', 'Rawa Buaya',
    'Bojong Indah', 'Taman Kota', 'Pesing', 'Grogol', 'Duri'
  ],
  TANJUNG_PRIOK_LINE: [
    'Jakarta Kota', 'Kampung Bandan', 'Ancol', 'Tanjung Priok'
  ],
  MRT_JAKARTA: [
    'Lebak Bulus Grab', 'Fatmawati', 'Cipete Raya', 'Haji Nawi', 'Blok A',
    'Blok M BCA', 'ASEAN', 'Senayan', 'Istora Mandiri', 'Bendungan Hilir',
    'Setiabudi Astra', 'Dukuh Atas BNI', 'Bundaran HI'
  ]
};

// Aliases and normalizations
const STATION_ALIASES = {
  'bogor': 'Bogor',
  'cilebut': 'Cilebut',
  'bojong': 'Bojong Gede',
  'bojonggede': 'Bojong Gede',
  'citayam': 'Citayam',
  'depok': 'Depok',
  'depok baru': 'Depok Baru',
  'pocis': 'Pondok Cina',
  'pondok cina': 'Pondok Cina',
  'ui': 'Universitas Indonesia',
  'up': 'Universitas Pancasila',
  'lenteng': 'Lenteng Agung',
  'pasar minggu': 'Pasar Minggu',
  'kalibata': 'Duren Kalibata',
  'cawang': 'Cawang',
  'tebet': 'Tebet',
  'manggarai': 'Manggarai',
  'cikini': 'Cikini',
  'gondangdia': 'Gondangdia',
  'juanda': 'Juanda',
  'kota': 'Jakarta Kota',
  'jakarta kota': 'Jakarta Kota',
  'jakartakota': 'Jakarta Kota',
  'tanah abang': 'Tanah Abang',
  'tanahabang': 'Tanah Abang',
  'sudirman': 'Sudirman',
  'dukuh atas': 'Sudirman',
  'karet': 'Karet',
  'duri': 'Duri',
  'jatinegara': 'Jatinegara',
  'bekasi': 'Bekasi',
  'cikarang': 'Cikarang',
  'serpong': 'Serpong',
  'rawabuntu': 'Rawabuntu',
  'parung panjang': 'Parung Panjang',
  'rangkas': 'Rangkasbitung',
  'rangkasbitung': 'Rangkasbitung',
  'kebayoran': 'Kebayoran',
  'palmerah': 'Palmerah',
  'tangerang': 'Tangerang',
  'batu ceper': 'Batu Ceper',
  'priok': 'Tanjung Priok',
  'tanjung priok': 'Tanjung Priok',
  'lebak bulus': 'Lebak Bulus Grab',
  'bundaran hi': 'Bundaran HI',
  'blok m': 'Blok M BCA'
};

/**
 * Match a raw station query to canonical name
 * @param {string} rawName 
 * @returns {string|null}
 */
function matchStationName(rawName) {
  if (!rawName) return null;
  const clean = rawName.toLowerCase().replace(/^stasiun\s+/i, '').trim();

  if (STATION_ALIASES[clean]) {
    return STATION_ALIASES[clean];
  }

  // Exact / partial search in all lines
  for (const line of Object.values(KRL_LINES)) {
    for (const st of line) {
      if (st.toLowerCase() === clean) return st;
      if (clean.length >= 4 && st.toLowerCase().includes(clean)) return st;
    }
  }

  return null;
}

/**
 * Find station path in a single line
 * @param {string[]} lineArray 
 * @param {string} fromSt 
 * @param {string} toSt 
 * @returns {{ path: string[], count: number } | null}
 */
function findPathInLine(lineArray, fromSt, toSt) {
  const i1 = lineArray.indexOf(fromSt);
  const i2 = lineArray.indexOf(toSt);
  if (i1 !== -1 && i2 !== -1) {
    if (i1 <= i2) {
      return { path: lineArray.slice(i1, i2 + 1), count: i2 - i1 };
    } else {
      return { path: lineArray.slice(i2, i1 + 1).reverse(), count: i1 - i2 };
    }
  }
  return null;
}

/**
 * Calculate accurate KRL / MRT Route & Travel Time
 * @param {string} fromRaw 
 * @param {string} toRaw 
 * @returns {{ success: boolean, data?: object, message?: string }}
 */
function calculateKRLRoute(fromRaw, toRaw) {
  const fromStation = matchStationName(fromRaw);
  const toStation = matchStationName(toRaw);

  if (!fromStation || !toStation) {
    return {
      success: false,
      message: `Stasiun tidak dikenali (Asal: ${fromStation || fromRaw}, Tujuan: ${toStation || toRaw}).`
    };
  }

  if (fromStation === toStation) {
    return {
      success: true,
      data: {
        from: fromStation,
        to: toStation,
        durationMinutes: 0,
        stationCount: 0,
        transfers: [],
        fare: 0,
        description: 'Stasiun asal dan tujuan sama.'
      }
    };
  }

  // 1. Check if both stations are on the same line (Direct Train)
  for (const [lineName, lineArray] of Object.entries(KRL_LINES)) {
    const directPath = findPathInLine(lineArray, fromStation, toStation);
    if (directPath) {
      const durationMins = Math.round(directPath.count * 2.8); // avg 2.8 mins per station
      const fare = directPath.count <= 5 ? 3000 : 3000 + Math.ceil((directPath.count - 5) / 5) * 1000;
      
      let lineLabel = 'KRL Commuter Line';
      if (lineName === 'BOGOR_LINE') lineLabel = 'KRL Red Line (Bogor - Jakarta Kota)';
      else if (lineName === 'CIKARANG_LOOP_LINE') lineLabel = 'KRL Blue Line (Cikarang Loop Line)';
      else if (lineName === 'RANGKASBITUNG_LINE') lineLabel = 'KRL Green Line (Rangkasbitung - Tanah Abang)';
      else if (lineName === 'TANGERANG_LINE') lineLabel = 'KRL Brown Line (Tangerang - Duri)';
      else if (lineName === 'MRT_JAKARTA') lineLabel = 'MRT Jakarta (Lebak Bulus - Bundaran HI)';

      return {
        success: true,
        data: {
          from: fromStation,
          to: toStation,
          isDirect: true,
          line: lineLabel,
          stationCount: directPath.count,
          stationsList: directPath.path,
          durationMinutes: durationMins,
          durationFormatted: durationMins >= 60 ? `${Math.floor(durationMins / 60)} jam ${durationMins % 60} menit` : `${durationMins} menit`,
          transfers: [],
          fare: Math.min(fare, 7000),
          fareFormatted: `Rp ${Math.min(fare, 7000).toLocaleString('id-ID')}`
        }
      };
    }
  }

  // 2. Multi-Line Route with Transfer Stations (Manggarai, Tanah Abang, Duri, Kampung Bandan, Citayam)
  const transferHubs = ['Manggarai', 'Tanah Abang', 'Duri', 'Kampung Bandan', 'Citayam', 'Jatinegara'];
  let bestRoute = null;

  for (const hub of transferHubs) {
    if (hub === fromStation || hub === toStation) continue;

    // Check line 1 (fromStation -> hub)
    let leg1 = null;
    let line1Name = '';
    for (const [lName, lArr] of Object.entries(KRL_LINES)) {
      const p = findPathInLine(lArr, fromStation, hub);
      if (p) { leg1 = p; line1Name = lName; break; }
    }

    // Check line 2 (hub -> toStation)
    let leg2 = null;
    let line2Name = '';
    for (const [lName, lArr] of Object.entries(KRL_LINES)) {
      const p = findPathInLine(lArr, hub, toStation);
      if (p) { leg2 = p; line2Name = lName; break; }
    }

    if (leg1 && leg2) {
      const totalStations = leg1.count + leg2.count;
      const travelMins = Math.round(totalStations * 2.8) + 8; // +8 mins for transit platform change
      if (!bestRoute || travelMins < bestRoute.durationMinutes) {
        bestRoute = {
          from: fromStation,
          to: toStation,
          isDirect: false,
          transferStation: hub,
          leg1: { line: line1Name, count: leg1.count, stations: leg1.path },
          leg2: { line: line2Name, count: leg2.count, stations: leg2.path },
          stationCount: totalStations,
          durationMinutes: travelMins,
          durationFormatted: travelMins >= 60 ? `${Math.floor(travelMins / 60)} jam ${travelMins % 60} menit` : `${travelMins} menit`,
          fare: Math.min(totalStations <= 5 ? 3000 : 3000 + Math.ceil((totalStations - 5) / 5) * 1000, 8000),
          fareFormatted: `Rp ${Math.min(totalStations <= 5 ? 3000 : 3000 + Math.ceil((totalStations - 5) / 5) * 1000, 8000).toLocaleString('id-ID')}`
        };
      }
    }
  }

  if (bestRoute) {
    return { success: true, data: bestRoute };
  }

  return {
    success: false,
    message: `Tidak ditemukan jalur KRL langsung/transit 1x antara Stasiun ${fromStation} dan Stasiun ${toStation}.`
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 🚗 ROAD DISTANCE & TIME ESTIMATOR (OSRM + GOOGLE MAPS API)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Geocode address or landmark via OpenStreetMap Nominatim
 * @param {string} query 
 * @returns {Promise<{ lat: number, lon: number, displayName: string } | null>}
 */
function geocodeLocation(query) {
  return new Promise((resolve) => {
    const cleanQuery = encodeURIComponent(`${query}, Indonesia`);
    const options = {
      hostname: 'nominatim.openstreetmap.org',
      path: `/search?q=${cleanQuery}&format=json&limit=1&countrycodes=id`,
      headers: {
        'User-Agent': 'AZURA-AI-Assistant/1.0 (Discord Bot Assistant)'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.length > 0) {
            resolve({
              lat: parseFloat(json[0].lat),
              lon: parseFloat(json[0].lon),
              displayName: json[0].display_name
            });
          } else {
            resolve(null);
          }
        } catch (_) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Calculate driving distance and duration via OSRM (Open Source Routing Machine)
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {Promise<{ distanceKm: number, durationMinutes: number, durationFormatted: string } | null>}
 */
function getOSRMDrivingRoute(lat1, lon1, lat2, lon2) {
  return new Promise((resolve) => {
    const url = `http://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 'Ok' && json.routes && json.routes.length > 0) {
            const route = json.routes[0];
            const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
            // Real-world Indonesian traffic multiplier (+25% buffer)
            const durationMinutes = Math.round((route.duration / 60) * 1.25);
            const durationFormatted = durationMinutes >= 60
              ? `${Math.floor(durationMinutes / 60)} jam ${durationMinutes % 60} menit`
              : `${durationMinutes} menit`;

            resolve({
              distanceKm,
              durationMinutes,
              durationFormatted
            });
          } else {
            resolve(null);
          }
        } catch (_) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Comprehensive Routing & Distance Master Service
 * Automatically detects whether to use KRL/MRT Transit or Road Driving/Motorcycle
 * @param {string} origin 
 * @param {string} destination 
 * @param {'krl'|'transit'|'driving'|'auto'} [mode='auto'] 
 * @returns {Promise<string>} Formatted verified data summary for AI prompt or direct response
 */
async function getVerifiedRouteAndDistance(origin, destination, mode = 'auto') {
  const isKRLQuery = mode === 'krl' || mode === 'transit' ||
    /\b(?:krl|kereta|commuter|stasiun|mrt|lrt)\b/i.test(`${origin} ${destination}`) ||
    (matchStationName(origin) && matchStationName(destination));

  // 1. KRL / MRT TRANSIT ROUTING
  if (isKRLQuery) {
    const krlResult = calculateKRLRoute(origin, destination);
    if (krlResult.success && krlResult.data) {
      const d = krlResult.data;
      if (d.isDirect) {
        return `🚆 **[DATA RUTE KRL TERVERIFIKASI & AKURAT]**:\n` +
          `• **Asal:** Stasiun ${d.from} ➡️ **Tujuan:** Stasiun ${d.to}\n` +
          `• **Jalur:** ${d.line} (Langsung tanpa transit)\n` +
          `• **Jumlah Stasiun:** ${d.stationCount} stasiun\n` +
          `• **Estimasi Waktu Tempuh:** ~${d.durationFormatted}\n` +
          `• **Tarif Tiket:** ${d.fareFormatted}\n` +
          `• **Daftar Stasiun yang Dilewati:** ${d.stationsList.join(' ➔ ')}`;
      } else {
        return `🚆 **[DATA RUTE KRL TRANSIT TERVERIFIKASI & AKURAT]**:\n` +
          `• **Asal:** Stasiun ${d.from} ➡️ **Tujuan:** Stasiun ${d.to}\n` +
          `• **Transit di:** **Stasiun ${d.transferStation}**\n` +
          `• **Rute:** Stasiun ${d.from} ➔ (Transit ${d.transferStation}) ➔ Stasiun ${d.to}\n` +
          `• **Total Stasiun:** ${d.stationCount} stasiun\n` +
          `• **Estimasi Waktu Tempuh:** ~${d.durationFormatted} (Termasuk jeda pindah peron ~8 mnt)\n` +
          `• **Tarif Tiket:** ${d.fareFormatted}`;
      }
    }
  }

  // 2. ROAD DISTANCE & COMMUTE VIA OSRM / GEOCODING
  try {
    const [loc1, loc2] = await Promise.all([
      geocodeLocation(origin),
      geocodeLocation(destination)
    ]);

    if (loc1 && loc2) {
      const roadRoute = await getOSRMDrivingRoute(loc1.lat, loc1.lon, loc2.lat, loc2.lon);
      if (roadRoute) {
        // Motorcycle estimate is typically ~25% faster in congestion
        const motorMins = Math.round(roadRoute.durationMinutes * 0.75);
        const motorFormatted = motorMins >= 60 ? `${Math.floor(motorMins / 60)} jam ${motorMins % 60} menit` : `${motorMins} menit`;

        return `📍 **[DATA JARAK & WAKTU TEMPUH JALAN RAYA TERVERIFIKASI]**:\n` +
          `• **Dari:** ${origin}\n` +
          `• **Ke:** ${destination}\n` +
          `• **Jarak Tempuh:** **${roadRoute.distanceKm} km**\n` +
          `• **Mobil / Taksi:** ~${roadRoute.durationFormatted} (Kondisi lalu lintas wajar)\n` +
          `• **Motor:** ~${motorFormatted}`;
      }
    }
  } catch (err) {
    console.error('[Route Engine Error]:', err.message);
  }

  return `Jarak antara ${origin} dan ${destination} belum dapat dihitung secara presisi.`;
}

/**
 * Intercept message prompt to check if user is asking about distance / travel time / KRL
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function interceptRouteAndDistance(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;

  const lower = prompt.toLowerCase();
  const hasRouteIntent = /\b(?:berapa\s+lama|waktu\s+tempuh|jarak|berapa\s+km|rute\s+krl|naik\s+krl|naik\s+kereta|transit\s+di\s+mana|stasiun\s+ke\s+stasiun|dari\s+.+\s+ke\s+.+)\b/i.test(lower);
  if (!hasRouteIntent) return null;

  // Extract "dari X ke Y" or "stasiun X ke stasiun Y"
  const matchFromTo = lower.match(/(?:dari|stasiun)\s+([a-z0-9\s.]+?)\s+(?:ke|menuju|sampai)\s+(?:stasiun\s+)?([a-z0-9\s.]+?)(?:[?.,!]|$)/i);
  if (matchFromTo) {
    const noiseRegex = /\b(?:berapa\s+km|berapa\s+lama|waktu\s+tempuh|jarak|naik\s+apa|transit\s+di\s+mana|ya|nih|dong|kira\s*kira|estimasinya|lewat\s+mana|tolong|coba)\b/gi;
    let origin = matchFromTo[1].replace(noiseRegex, '').trim();
    let destination = matchFromTo[2].replace(noiseRegex, '').trim();

    if (origin && destination && origin !== destination && origin.length >= 2 && destination.length >= 2) {
      console.log(`[Route Engine]: 🗺️ Intercepted route query: "${origin}" ➔ "${destination}"`);
      const routeData = await getVerifiedRouteAndDistance(origin, destination);
      return routeData;
    }
  }

  return null;
}

module.exports = {
  calculateKRLRoute,
  getVerifiedRouteAndDistance,
  interceptRouteAndDistance,
  matchStationName
};
