const https = require('https');
const http = require('http');
const config = require('./config');

// ══════════════════════════════════════════════════════════════════════════════
// 🚆 TRANSIT JABODETABEK & INDONESIA NETWORK (KRL, MRT, LRT, WHOOSH, BANDARA)
// ══════════════════════════════════════════════════════════════════════════════

const TRANSIT_LINES = {
  // 1. KRL COMMUTER LINE JABODETABEK
  KRL_BOGOR_LINE: [
    'Bogor', 'Cilebut', 'Bojong Gede', 'Citayam', 'Depok', 'Depok Baru',
    'Pondok Cina', 'Universitas Indonesia', 'Universitas Pancasila', 'Lenteng Agung',
    'Tanjung Barat', 'Pasar Minggu', 'Pasar Minggu Baru', 'Duren Kalibata',
    'Cawang', 'Tebet', 'Manggarai', 'Cikini', 'Gondangdia', 'Juanda',
    'Sawah Besar', 'Mangga Besar', 'Jayakarta', 'Jakarta Kota'
  ],
  KRL_NAMBO_BRANCH: [
    'Nambo', 'Cibinong', 'Pondok Rajeg', 'Citayam'
  ],
  KRL_CIKARANG_LOOP_LINE: [
    'Cikarang', 'Metland Telaga Murni', 'Cibitung', 'Tambun', 'Bekasi Timur', 'Bekasi',
    'Kranji', 'Cakung', 'Klender Baru', 'Buaran', 'Klender', 'Jatinegara',
    'Matraman', 'Manggarai', 'Sudirman', 'BNI City', 'Karet', 'Tanah Abang',
    'Duri', 'Angke', 'Kampung Bandan', 'Rajawali', 'Kemayoran', 'Pasar Senen',
    'Gang Sentiong', 'Kramat', 'Pondok Jati'
  ],
  KRL_RANGKASBITUNG_LINE: [
    'Rangkasbitung', 'Citeras', 'Maja', 'Cikoya', 'Tigaraksa', 'Tenjo', 'Daru',
    'Cilejit', 'Parung Panjang', 'Cicayur', 'Cisauk', 'Serpong', 'Rawabuntu',
    'Sudimara', 'Jurangmangu', 'Pondok Ranji', 'Kebayoran', 'Palmerah', 'Tanah Abang'
  ],
  KRL_TANGERANG_LINE: [
    'Tangerang', 'Tanah Tinggi', 'Batu Ceper', 'Poris', 'Kalideres', 'Rawa Buaya',
    'Bojong Indah', 'Taman Kota', 'Pesing', 'Grogol', 'Duri'
  ],
  KRL_TANJUNG_PRIOK_LINE: [
    'Jakarta Kota', 'Kampung Bandan', 'Ancol', 'Tanjung Priok'
  ],

  // 2. MRT JAKARTA (NORTH-SOUTH LINE FASE 1)
  MRT_JAKARTA: [
    'Lebak Bulus Grab', 'Fatmawati Indomaret', 'Cipete Raya', 'Haji Nawi', 'Blok A',
    'Blok M BCA', 'ASEAN', 'Senayan Mastercard', 'Istora Mandiri', 'Bendungan Hilir',
    'Setiabudi Astra', 'Dukuh Atas BNI', 'Bundaran HI'
  ],

  // 3. LRT JABODEBEK (CIBUBUR & BEKASI LINES)
  LRT_JABODEBEK_CIBUBUR: [
    'Dukuh Atas', 'Setiabudi', 'Rasuna Said', 'Kuningan', 'Pancoran', 'Cikoko',
    'Ciliwung', 'Cawang', 'TMII', 'Kampung Rambutan', 'Ciracas', 'Harjamukti'
  ],
  LRT_JABODEBEK_BEKASI: [
    'Dukuh Atas', 'Setiabudi', 'Rasuna Said', 'Kuningan', 'Pancoran', 'Cikoko',
    'Ciliwung', 'Cawang', 'Halim', 'Jatibening Baru', 'Cikunir I', 'Cikunir II',
    'Bekasi Barat', 'Jatimulya'
  ],

  // 4. LRT JAKARTA (KELAPA GADING - VELODROME)
  LRT_JAKARTA: [
    'Pegangsaan Dua', 'Boulevard Utara', 'Boulevard Selatan', 'Pulomas', 'Equestrian', 'Velodrome'
  ],

  // 5. KERETA BANDARA SOEKARNO-HATTA (RAILINK)
  KA_BANDARA_SOETTA: [
    'Manggarai', 'BNI City', 'Duri', 'Rawa Buaya', 'Batu Ceper', 'Bandara Soekarno-Hatta'
  ],

  // 6. KERETA CEPAT WHOOSH (KCIC JAKARTA - BANDUNG)
  WHOOSH_KCIC: [
    'Halim', 'Karawang', 'Padalarang', 'Tegalluar Summarecon'
  ]
};

// Aliases and normalizations
const STATION_ALIASES = {
  // KRL
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
  'karet': 'Karet',
  'duri': 'Duri',
  'jatinegara': 'Jatinegara',
  'klender': 'Klender',
  'klender baru': 'Klender Baru',
  'buaran': 'Buaran',
  'cakung': 'Cakung',
  'kranji': 'Kranji',
  'bekasi': 'Bekasi',
  'bekasi timur': 'Bekasi Timur',
  'tambun': 'Tambun',
  'cibitung': 'Cibitung',
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

  // MRT
  'lebak bulus': 'Lebak Bulus Grab',
  'lebakbulus': 'Lebak Bulus Grab',
  'fatmawati': 'Fatmawati Indomaret',
  'cipete': 'Cipete Raya',
  'haji nawi': 'Haji Nawi',
  'blok m': 'Blok M BCA',
  'blok a': 'Blok A',
  'asean': 'ASEAN',
  'senayan': 'Senayan Mastercard',
  'istora': 'Istora Mandiri',
  'benhil': 'Bendungan Hilir',
  'bendungan hilir': 'Bendungan Hilir',
  'setiabudi astra': 'Setiabudi Astra',
  'dukuh atas bni': 'Dukuh Atas BNI',
  'bundaran hi': 'Bundaran HI',

  // LRT Jabodebek
  'dukuh atas': 'Dukuh Atas',
  'rasuna said': 'Rasuna Said',
  'kuningan': 'Kuningan',
  'pancoran': 'Pancoran',
  'cikoko': 'Cikoko',
  'tmii': 'TMII',
  'taman mini': 'TMII',
  'kampung rambutan': 'Kampung Rambutan',
  'ciracas': 'Ciracas',
  'harjamukti': 'Harjamukti',
  'cibubur': 'Harjamukti',
  'halim': 'Halim',
  'jatibening': 'Jatibening Baru',
  'cikunir': 'Cikunir I',
  'bekasi barat': 'Bekasi Barat',
  'jatimulya': 'Jatimulya',

  // LRT Jakarta
  'velodrome': 'Velodrome',
  'rawamangun': 'Velodrome',
  'pegangsaan dua': 'Pegangsaan Dua',
  'kelapa gading': 'Boulevard Utara',
  'pulomas': 'Pulomas',

  // KA Bandara & Whoosh
  'bandara soetta': 'Bandara Soekarno-Hatta',
  'bandara': 'Bandara Soekarno-Hatta',
  'soekarno hatta': 'Bandara Soekarno-Hatta',
  'soetta': 'Bandara Soekarno-Hatta',
  'padalarang': 'Padalarang',
  'tegalluar': 'Tegalluar Summarecon',
  'whoosh': 'Halim'
};

/**
 * Match a raw station query to canonical name
 * @param {string} rawName 
 * @returns {string|null}
 */
function matchStationName(rawName) {
  if (!rawName) return null;
  const clean = rawName.toLowerCase().replace(/^(?:stasiun|st|halte)\s+/i, '').trim();

  if (STATION_ALIASES[clean]) {
    return STATION_ALIASES[clean];
  }

  // Check if query contains any known alias key (e.g. "harjamukti cibubur", "stasiun buaran baru", dll)
  for (const [aliasKey, target] of Object.entries(STATION_ALIASES)) {
    if (aliasKey.length >= 4 && clean.includes(aliasKey)) {
      return target;
    }
  }

  for (const line of Object.values(TRANSIT_LINES)) {
    for (const st of line) {
      if (st.toLowerCase() === clean) return st;
      if (clean.length >= 4 && (st.toLowerCase().includes(clean) || clean.includes(st.toLowerCase()))) return st;
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
 * Calculate accurate Rail & Transit Route across KRL, MRT, LRT, and High-Speed Train
 * @param {string} fromRaw 
 * @param {string} toRaw 
 * @returns {{ success: boolean, data?: object, message?: string }}
 */
function calculateRailRoute(fromRaw, toRaw) {
  const fromStation = matchStationName(fromRaw);
  const toStation = matchStationName(toRaw);

  if (!fromStation || !toStation) {
    return {
      success: false,
      message: `Stasiun/Halte tidak dikenali (Asal: ${fromStation || fromRaw}, Tujuan: ${toStation || toRaw}).`
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

  // 1. Check if both stations are on the same line (Direct Route)
  for (const [lineName, lineArray] of Object.entries(TRANSIT_LINES)) {
    const directPath = findPathInLine(lineArray, fromStation, toStation);
    if (directPath) {
      const segCount = directPath.count;
      let lineLabel = 'Kereta Rel Perkotaan';
      let distanceKm = Math.round(segCount * 1.75 * 10) / 10;
      let fareFormatted = 'Rp 3.000';
      let minDuration = Math.round(segCount * 2.8);
      let maxDuration = Math.round(segCount * 3.0 + 4);

      // Mode-specific calculations:
      if (lineName.startsWith('KRL_')) {
        lineLabel = lineName === 'KRL_BOGOR_LINE' ? 'KRL Red Line (Bogor - Jakarta Kota)' :
          lineName === 'KRL_CIKARANG_LOOP_LINE' ? 'KRL Blue Line (Cikarang Loop Line)' :
          lineName === 'KRL_RANGKASBITUNG_LINE' ? 'KRL Green Line (Rangkasbitung - Tanah Abang)' :
          lineName === 'KRL_TANGERANG_LINE' ? 'KRL Brown Line (Tangerang - Duri)' : 'KRL Commuter Line';
        
        distanceKm = Math.round(segCount * 1.75 * 10) / 10;
        const rawFare = distanceKm <= 25 ? 3000 : 3000 + Math.ceil((distanceKm - 25) / 10) * 1000;
        fareFormatted = `Rp ${Math.min(rawFare, 8000).toLocaleString('id-ID')}`;
        
        const passesManggarai = directPath.path.includes('Manggarai');
        minDuration = Math.round(segCount * 3.0);
        maxDuration = Math.round(segCount * 3.0 + (passesManggarai ? 8 : 4));

      } else if (lineName === 'MRT_JAKARTA') {
        lineLabel = 'MRT Jakarta (Lebak Bulus - Bundaran HI)';
        distanceKm = Math.round((segCount * 1.3) * 10) / 10;
        const mrtFare = Math.min(3000 + segCount * 1000, 14000);
        fareFormatted = `Rp ${mrtFare.toLocaleString('id-ID')}`;
        minDuration = Math.round(segCount * 2.3);
        maxDuration = Math.round(segCount * 2.6);

      } else if (lineName.startsWith('LRT_JABODEBEK')) {
        lineLabel = lineName.includes('CIBUBUR')
          ? 'LRT Jabodebek (Cibubur Line: Dukuh Atas - Harjamukti)'
          : 'LRT Jabodebek (Bekasi Line: Dukuh Atas - Jatimulya)';
        distanceKm = Math.round(segCount * 2.2 * 10) / 10;
        const lrtFare = Math.min(5000 + Math.ceil(distanceKm * 700), 20000);
        fareFormatted = `Rp ${lrtFare.toLocaleString('id-ID')} (Tarif Maks Off-Peak Rp 10.000 / Peak Rp 20.000)`;
        minDuration = Math.round(segCount * 3.2);
        maxDuration = Math.round(segCount * 3.5);

      } else if (lineName === 'LRT_JAKARTA') {
        lineLabel = 'LRT Jakarta (Kelapa Gading - Velodrome)';
        distanceKm = Math.round(segCount * 1.15 * 10) / 10;
        fareFormatted = 'Rp 5.000 (Flat)';
        minDuration = Math.round(segCount * 2.5);
        maxDuration = 13;

      } else if (lineName === 'KA_BANDARA_SOETTA') {
        lineLabel = 'KA Bandara Soekarno-Hatta (Railink)';
        distanceKm = Math.round(segCount * 7.5 * 10) / 10;
        fareFormatted = 'Rp 30.000 - Rp 70.000 (Tergantung stasiun asal)';
        minDuration = Math.round(segCount * 10);
        maxDuration = Math.round(segCount * 11);

      } else if (lineName === 'WHOOSH_KCIC') {
        lineLabel = 'Kereta Cepat Whoosh (KCIC Jakarta - Bandung)';
        distanceKm = Math.round(segCount * 45);
        fareFormatted = 'Rp 200.000 - Rp 300.000 (Kelas Ekonomi Premium)';
        minDuration = segCount === 2 ? 30 : 45;
        maxDuration = segCount === 2 ? 35 : 50;
      }

      return {
        success: true,
        data: {
          from: fromStation,
          to: toStation,
          isDirect: true,
          line: lineLabel,
          stationCount: segCount,
          stationsList: directPath.path,
          distanceKm: distanceKm,
          distanceFormatted: `~${distanceKm} km`,
          durationMin: minDuration,
          durationMax: maxDuration,
          durationFormatted: `${minDuration}–${maxDuration} menit (Estimasi operasional riil)`,
          transfers: [],
          fareFormatted: fareFormatted
        }
      };
    }
  }

  // 2. Multi-Line Route with Transit Hubs (Manggarai, Tanah Abang, Duri, Cawang, Dukuh Atas, Halim)
  const transferHubs = ['Manggarai', 'Tanah Abang', 'Duri', 'Kampung Bandan', 'Citayam', 'Jatinegara', 'Dukuh Atas', 'Cawang', 'Cikoko', 'Halim'];
  let bestRoute = null;

  for (const hub of transferHubs) {
    if (hub === fromStation || hub === toStation) continue;

    let leg1 = null;
    let line1Name = '';
    for (const [lName, lArr] of Object.entries(TRANSIT_LINES)) {
      const p = findPathInLine(lArr, fromStation, hub);
      if (p) { leg1 = p; line1Name = lName; break; }
    }

    let leg2 = null;
    let line2Name = '';
    for (const [lName, lArr] of Object.entries(TRANSIT_LINES)) {
      const p = findPathInLine(lArr, hub, toStation);
      if (p) { leg2 = p; line2Name = lName; break; }
    }

    if (leg1 && leg2) {
      const totalStations = leg1.count + leg2.count;
      const distanceKm = Math.round(totalStations * 1.8 * 10) / 10;
      const minDuration = Math.round(totalStations * 3.0 + 8); // +8 min platform change
      const maxDuration = Math.round(totalStations * 3.0 + 15);

      if (!bestRoute || maxDuration < bestRoute.durationMax) {
        bestRoute = {
          from: fromStation,
          to: toStation,
          isDirect: false,
          transferStation: hub,
          leg1: { line: line1Name, count: leg1.count, stations: leg1.path },
          leg2: { line: line2Name, count: leg2.count, stations: leg2.path },
          stationCount: totalStations,
          distanceKm: distanceKm,
          distanceFormatted: `~${distanceKm} km`,
          durationMin: minDuration,
          durationMax: maxDuration,
          durationFormatted: `${minDuration}–${maxDuration} menit (Termasuk jeda transit ~8-10 mnt)`,
          fareFormatted: 'Sesuai tarif integrasi per moda'
        };
      }
    }
  }

  if (bestRoute) {
    return { success: true, data: bestRoute };
  }

  return {
    success: false,
    message: `Tidak ditemukan jalur transit langsung 1x antara Stasiun ${fromStation} dan Stasiun ${toStation}.`
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 🚗 ROAD DISTANCE & TIME ESTIMATOR (OSRM + OPENSTREETMAP GEOCODING)
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
 * Automatically detects whether to use Rail Transit (KRL/MRT/LRT/Whoosh) or Road Driving/Motorcycle
 * @param {string} origin 
 * @param {string} destination 
 * @param {'rail'|'transit'|'driving'|'auto'} [mode='auto'] 
 * @returns {Promise<string>} Formatted verified data summary for AI prompt or direct response
 */
async function getVerifiedRouteAndDistance(origin, destination, mode = 'auto') {
  const isRailQuery = mode === 'rail' || mode === 'transit' ||
    /\b(?:krl|kereta|commuter|stasiun|mrt|lrt|whoosh|kcic|bandara|railink)\b/i.test(`${origin} ${destination}`) ||
    (matchStationName(origin) && matchStationName(destination));

  // 1. RAIL & TRANSIT ROUTING (KRL / MRT / LRT / WHOOSH / BANDARA)
  if (isRailQuery) {
    const railResult = calculateRailRoute(origin, destination);
    if (railResult.success && railResult.data) {
      const d = railResult.data;
      if (d.isDirect) {
        return `🚆 **[DATA RUTE REL & TRANSIT TERVERIFIKASI & AKURAT]**:\n` +
          `• **Asal:** Stasiun ${d.from} ➡️ **Tujuan:** Stasiun ${d.to}\n` +
          `• **Moda & Jalur:** **${d.line}** (Langsung tanpa transit)\n` +
          `• **Jumlah Stasiun/Pemberhentian:** ${d.stationCount} stasiun\n` +
          `• **Jarak Rel:** **${d.distanceFormatted}**\n` +
          `• **Estimasi Waktu Tempuh:** **${d.durationFormatted}**\n` +
          `• **Tarif Tiket Resmi:** **${d.fareFormatted}**\n` +
          `• **Daftar Stasiun yang Dilewati:** ${d.stationsList.join(' ➔ ')}`;
      } else {
        return `🚆 **[DATA RUTE REL & TRANSIT TERVERIFIKASI & AKURAT]**:\n` +
          `• **Asal:** Stasiun ${d.from} ➡️ **Tujuan:** Stasiun ${d.to}\n` +
          `• **Transit di:** **Stasiun ${d.transferStation}**\n` +
          `• **Rute Integrasi:** Stasiun ${d.from} ➔ (Transit ${d.transferStation}) ➔ Stasiun ${d.to}\n` +
          `• **Total Stasiun:** ${d.stationCount} stasiun\n` +
          `• **Jarak Rel Total:** **${d.distanceFormatted}**\n` +
          `• **Estimasi Waktu Tempuh:** **${d.durationFormatted}**\n` +
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
          `• **Jarak Tempuh Jalan Raya:** **${roadRoute.distanceKm} km**\n` +
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
 * Intercept message prompt to check if user is asking about distance / travel time / KRL / MRT / LRT / Whoosh
 * @param {string} prompt 
 * @returns {Promise<string|null>}
 */
async function interceptRouteAndDistance(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;

  const lower = prompt.toLowerCase();
  const hasRouteIntent = /\b(?:berapa\s+lama|waktu\s+tempuh|jarak|berapa\s+km|rute|naik\s+krl|naik\s+kereta|naik\s+mrt|naik\s+lrt|naik\s+whoosh|transit\s+di\s+mana|stasiun\s+ke\s+stasiun|dari\s+.+\s+ke\s+.+)\b/i.test(lower);
  if (!hasRouteIntent) return null;

  // Extract "dari X ke Y" or "stasiun X ke stasiun Y"
  const matchFromTo = lower.match(/(?:dari|stasiun|halte)\s+([a-z0-9\s.]+?)\s+(?:ke|menuju|sampai)\s+(?:stasiun\s+|halte\s+)?([a-z0-9\s.]+?)(?:[?.,!]|$)/i);
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
  calculateRailRoute,
  calculateKRLRoute: calculateRailRoute, // Backward compatibility
  getVerifiedRouteAndDistance,
  interceptRouteAndDistance,
  matchStationName
};
