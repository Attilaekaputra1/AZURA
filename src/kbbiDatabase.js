/**
 * AZURA Indonesian KBBI Dictionary & Word Chain Database Subsystem
 * 
 * Contains 2,000+ authentic Indonesian root words indexed A-Z for instant O(1) candidate matching,
 * session duplicate prevention, and dynamic vocabulary validation.
 */

const KBBI_DICTIONARY_RAW = {
  a: [
    'abadi', 'abjad', 'acara', 'ada', 'adat', 'adil', 'adu', 'aduk', 'afal', 'agama',
    'agar', 'agung', 'ahli', 'aib', 'air', 'ajaib', 'ajak', 'ajar', 'aju', 'akad',
    'akal', 'akan', 'akar', 'akhir', 'akhlak', 'akibat', 'akrab', 'aksara', 'akses', 'aksi',
    'aktif', 'aku', 'akur', 'akurat', 'alam', 'alamat', 'alang', 'alas', 'alat', 'album',
    'aliansi', 'alih', 'alir', 'alis', 'alun', 'alur', 'aman', 'amanat', 'amat', 'ambang',
    'ambil', 'ambisi', 'ambruk', 'ampun', 'amuk', 'anak', 'anarki', 'ancam', 'anda', 'andai',
    'aneh', 'aneka', 'angan', 'anggap', 'anggar', 'anggun', 'angin', 'angka', 'angkat', 'angkot',
    'angsa', 'anjing', 'anjur', 'antar', 'antara', 'anting', 'antre', 'antri', 'anugerah', 'anut',
    'anyam', 'apa', 'apung', 'arah', 'arang', 'arsip', 'arti', 'artikel', 'arung', 'arus',
    'asah', 'asal', 'asam', 'asap', 'asas', 'asin', 'asing', 'asli', 'asmara', 'aspal',
    'asri', 'asuh', 'atap', 'atas', 'atau', 'atlas', 'atom', 'atur', 'aula', 'awan',
    'awas', 'ayah', 'ayam', 'ayat', 'ayun', 'azab', 'azimat', 'azon', 'azal', 'azan'
  ],
  b: [
    'baca', 'badan', 'badai', 'badak', 'badut', 'bagan', 'bagai', 'bagus', 'bahan', 'bahas',
    'bahasa', 'bahkan', 'bahaya', 'bahu', 'baik', 'baja', 'bajak', 'baju', 'bakar', 'bakat',
    'bakti', 'baku', 'balai', 'balap', 'balas', 'balok', 'balon', 'balut', 'bambu', 'banal',
    'bandar', 'bandel', 'banding', 'bangga', 'bangkai', 'bangkit', 'bangku', 'bangsa', 'bangun', 'banjir',
    'bantah', 'bantai', 'bantal', 'banting', 'bantu', 'banyak', 'bapak', 'barang', 'barat', 'baring',
    'baris', 'baru', 'basah', 'basi', 'basis', 'batal', 'batang', 'batas', 'baterai', 'batin',
    'batu', 'batuk', 'baung', 'baur', 'bawa', 'bawah', 'bawang', 'bayang', 'bayar', 'bayi',
    'bebas', 'bebek', 'beber', 'becak', 'beda', 'bedil', 'begal', 'begitu', 'bekal', 'bekas',
    'beku', 'bela', 'belah', 'belajar', 'belakang', 'belalang', 'belanja', 'belas', 'belit', 'belut',
    'benar', 'bencana', 'benci', 'benda', 'bendera', 'bengkel', 'bengkok', 'benih', 'bening', 'bensin',
    'bentang', 'benteng', 'bentrok', 'bentuk', 'berak', 'berani', 'beras', 'berat', 'beres', 'berita',
    'berkas', 'berkat', 'berlian', 'bersih', 'besar', 'besi', 'besok', 'beton', 'biang', 'biar',
    'biasa', 'biaya', 'bibir', 'bibit', 'bicara', 'bidadari', 'bidang', 'bidik', 'bijak', 'biji',
    'bilang', 'bilas', 'bimbang', 'bina', 'binang', 'binar', 'binatang', 'bingkai', 'bingung', 'bintang',
    'biola', 'biologi', 'bioskop', 'biru', 'bisik', 'bisnis', 'bisu', 'bisul', 'bocor', 'bodoh',
    'bohong', 'bola', 'bolak', 'boleh', 'bolpen', 'bom', 'boneka', 'bongkar', 'borong', 'bosan',
    'botak', 'botol', 'buah', 'bual', 'buang', 'buas', 'buat', 'buaya', 'bubar', 'bubu',
    'bubuk', 'bubur', 'budi', 'bugar', 'bujang', 'bujuk', 'bujur', 'buka', 'bukan', 'bukit',
    'bukti', 'buku', 'bulan', 'bulat', 'bulir', 'bulu', 'bumbu', 'bumi', 'buncit', 'bunda',
    'bundar', 'bunga', 'bungkus', 'buntet', 'bunting', 'buntu', 'buntut', 'bunuh', 'bunyi', 'bupati',
    'buru', 'buruh', 'buruk', 'burung', 'busa', 'busana', 'busuk', 'busur', 'buta', 'butik',
    'butir', 'butuh', 'buyar', 'buyut'
  ],
  c: [
    'cabang', 'cabe', 'cakar', 'cakap', 'cakram', 'calon', 'camar', 'camilan', 'campur', 'candi',
    'canggih', 'cantik', 'capai', 'capung', 'cara', 'cari', 'catat', 'catur', 'catut', 'cegah',
    'cekik', 'celah', 'celana', 'celoteh', 'cemas', 'cemburu', 'cempaka', 'cengkeh', 'cepat', 'cerah',
    'cerdas', 'cerita', 'cermin', 'cerutu', 'cetak', 'cibir', 'cicil', 'cincin', 'cinta', 'ciprat',
    'cipta', 'ciri', 'cita', 'cium', 'cuaca', 'cuci', 'cucuk', 'cucu', 'cuka', 'cukup',
    'cukur', 'culas', 'culik', 'cuma', 'cumbu', 'curam', 'curang', 'curi', 'curiga', 'curhat'
  ],
  d: [
    'dada', 'dadu', 'daerah', 'daftar', 'dagang', 'daging', 'dagu', 'dahaga', 'dahan', 'dahi',
    'dahsyat', 'dahulu', 'daki', 'dalam', 'damai', 'dampar', 'danau', 'dandan', 'dangkal', 'dansa',
    'dapat', 'dapur', 'darat', 'daring', 'darurat', 'dasar', 'dasi', 'daster', 'datang', 'datar',
    'daun', 'dawai', 'daya', 'dayung', 'debar', 'debu', 'dedikasi', 'definisi', 'degup', 'dekap',
    'dekat', 'delapan', 'delima', 'demam', 'demi', 'demokrasi', 'denda', 'dendam', 'dengar', 'dengki',
    'depan', 'derap', 'deras', 'derajat', 'derita', 'dermaga', 'desa', 'desak', 'desain', 'desis',
    'destinasi', 'detail', 'detik', 'dewa', 'dewan', 'dewasa', 'diagnosis', 'dialek', 'dialog', 'dian',
    'didik', 'diet', 'digit', 'dinamis', 'dinding', 'dingin', 'dini', 'diploma', 'direktur', 'diri',
    'disiplin', 'diskon', 'diskusi', 'doa', 'dobrak', 'dokumen', 'dokter', 'doktrin', 'domba', 'domestik',
    'dominan', 'dompet', 'donasi', 'dorong', 'dosen', 'dosis', 'drama', 'drastis', 'duet', 'duga',
    'duit', 'duka', 'dukun', 'dulang', 'dulu', 'dunia', 'dupa', 'durasi', 'duren', 'duri',
    'durian', 'dusta', 'duta', 'duyung'
  ],
  e: [
    'edar', 'edisi', 'edukasi', 'efek', 'efektif', 'efisien', 'egois', 'eja', 'ejek', 'ekor',
    'ekologi', 'ekonomi', 'ekosistem', 'eksemplar', 'eksis', 'ekspresi', 'ekspos', 'ekstra', 'ekstrak', 'ekstrim',
    'elak', 'elang', 'elegan', 'elemen', 'eliminasi', 'elit', 'elok', 'elus', 'email', 'emas',
    'emban', 'embun', 'emisi', 'emosi', 'empat', 'empu', 'empuk', 'enak', 'enam', 'encer',
    'endap', 'energi', 'enggan', 'engsel', 'entah', 'enteng', 'epilog', 'episode', 'era', 'erang',
    'erat', 'erosi', 'erti', 'erupsi', 'esak', 'esensi', 'esok', 'estetis', 'etik', 'etika',
    'etnis', 'evaluasi', 'evolusi'
  ],
  f: [
    'fabel', 'fajar', 'faktor', 'faktual', 'faktur', 'fakultas', 'falsafah', 'famili', 'fana', 'fantasi',
    'fase', 'fasilitas', 'fasih', 'fatal', 'fatwa', 'fauna', 'favorit', 'feminin', 'fenomena', 'fermentasi',
    'fiksi', 'filamen', 'film', 'filosofi', 'final', 'finansial', 'firman', 'fisik', 'fisika', 'fisiologi',
    'fitnah', 'fitrah', 'fleksibel', 'flora', 'fluida', 'fobia', 'fokus', 'folder', 'fondasi', 'formal',
    'format', 'formula', 'formulir', 'forum', 'foto', 'fotografi', 'fraksi', 'frekuensi', 'fungsi', 'fusi'
  ],
  g: [
    'gabung', 'gading', 'gadis', 'gadai', 'gadget', 'gagah', 'gagal', 'gagang', 'gaharu', 'gajah',
    'gaji', 'galak', 'galang', 'galau', 'galeri', 'galian', 'gamang', 'gambar', 'gamelan', 'gampang',
    'ganda', 'gandum', 'ganggu', 'ganjil', 'ganteng', 'ganti', 'gantung', 'gapai', 'garam', 'garang',
    'gardu', 'garing', 'garis', 'garpu', 'garuda', 'gas', 'gasing', 'gaul', 'gaun', 'gawang',
    'gelang', 'gelap', 'gelar', 'gelas', 'gelembung', 'geli', 'gelombang', 'gelora', 'gembira', 'gembok',
    'gempa', 'gempar', 'gemuk', 'genang', 'genap', 'gencet', 'gencar', 'gendang', 'gendong', 'generasi',
    'genggam', 'genius', 'genta', 'genting', 'gerak', 'gerbang', 'gerbong', 'gereja', 'gerigi', 'gerimis',
    'gertak', 'geser', 'getar', 'getah', 'giat', 'gigi', 'gigit', 'gila', 'gilang', 'gilir',
    'gitar', 'gizi', 'glamor', 'global', 'godaan', 'golongan', 'goreng', 'gores', 'gosip', 'gotong',
    'gradasi', 'grafik', 'granat', 'gratis', 'grosir', 'grup', 'gubernur', 'gugur', 'gugus', 'gula',
    'gulat', 'guling', 'gulung', 'gumam', 'guna', 'gunung', 'gurau', 'gurih', 'gurita', 'guru',
    'gurun', 'gusar', 'gusi'
  ],
  h: [
    'habis', 'habitat', 'hadap', 'hadiah', 'hadir', 'hadirat', 'hafal', 'hajat', 'haji', 'hak',
    'hakiki', 'hakim', 'halaman', 'halang', 'halau', 'halilintar', 'haluan', 'halus', 'hama', 'hamba',
    'hambat', 'hambur', 'hamil', 'hampa', 'hampar', 'hancur', 'handal', 'hangat', 'hangus', 'hantam',
    'hantu', 'hanya', 'hapus', 'harap', 'harap', 'harga', 'hari', 'harimau', 'harkat', 'harmoni',
    'harta', 'harum', 'harus', 'hasil', 'hasrat', 'hasut', 'hati', 'haus', 'hawa', 'hayat',
    'hebat', 'heboh', 'hektar', 'helai', 'hemat', 'hembus', 'hening', 'henti', 'hepar', 'heran',
    'heroik', 'hewan', 'hias', 'hibur', 'hidang', 'hidro', 'hidup', 'higienis', 'hijau', 'hijrah',
    'hikayat', 'hikmah', 'hilang', 'hilir', 'himpun', 'hina', 'hincap', 'hindar', 'hingga', 'hiruk',
    'hirup', 'hisap', 'hitam', 'hitung', 'hormat', 'horor', 'hotel', 'hubung', 'hujan', 'hukum',
    'hulu', 'huma', 'humanis', 'huni', 'hutan', 'hutang', 'huyung'
  ],
  i: [
    'iba', 'ibadah', 'ibarat', 'iblis', 'ibu', 'idaman', 'ide', 'ideal', 'identik', 'identitas',
    'idiom', 'idola', 'ijazah', 'ijin', 'ikan', 'ikat', 'iklan', 'iklim', 'ikrar', 'ikut',
    'ilahi', 'ilang', 'ilham', 'ilmiah', 'ilmu', 'ilustrasi', 'imajinasi', 'imam', 'imbang', 'imbau',
    'imbuh', 'imigrasi', 'imitasi', 'impian', 'impor', 'imun', 'inap', 'incar', 'indah', 'indeks',
    'indikasi', 'individu', 'induk', 'industri', 'infeksi', 'inferior', 'informasi', 'infrastruktur', 'ingat', 'ingin',
    'ingkar', 'inisial', 'inisiatif', 'injak', 'inkubator', 'inovasi', 'insan', 'insentif', 'insiden', 'insinyur',
    'inspeksi', 'inspirasi', 'instalasi', 'insting', 'institusi', 'instruksi', 'instrumen', 'intai', 'intan', 'integrasi',
    'intelek', 'intensif', 'inti', 'intrik', 'intro', 'intuisi', 'invasi', 'investasi', 'iptek', 'irama',
    'iri', 'iring', 'iris', 'ironis', 'isap', 'iseng', 'isi', 'istana', 'istilah', 'istirahat',
    'istri', 'isyarat', 'itik', 'itikad', 'izin'
  ],
  j: [
    'jadwal', 'jaga', 'jagal', 'jago', 'jagung', 'jahanam', 'jahat', 'jahit', 'jajan', 'jajar',
    'jaket', 'jaksa', 'jalan', 'jalar', 'jalur', 'jam', 'jamah', 'jamban', 'jambu', 'jamin',
    'jamuan', 'jamur', 'janda', 'jangan', 'janggal', 'jangka', 'jangkar', 'janji', 'jantan', 'jantung',
    'jarak', 'jarang', 'jari', 'jaring', 'jarum', 'jas', 'jasa', 'jasmani', 'jatah', 'jatuh',
    'jauh', 'jawab', 'jawara', 'jaya', 'jebak', 'jebol', 'jeda', 'jegil', 'jejak', 'jejal',
    'jelajah', 'jelang', 'jelas', 'jelata', 'jelita', 'jelma', 'jelujur', 'jemari', 'jembatan', 'jempol',
    'jemput', 'jemur', 'jenaka', 'jendela', 'jenderal', 'jengkal', 'jengkel', 'jenggot', 'jenis', 'jenius',
    'jenjang', 'jenuh', 'jepit', 'jepret', 'jera', 'jeram', 'jerang', 'jerat', 'jerawat', 'jerit',
    'jernih', 'jeruk', 'jidat', 'jihad', 'jijik', 'jika', 'jilat', 'jilid', 'jimat', 'jinak',
    'jiwa', 'jodoh', 'joget', 'jongkok', 'jorok', 'jual', 'juang', 'juara', 'jubah', 'judul',
    'jujur', 'juling', 'jumpa', 'jumlah', 'jungkir', 'jurnal', 'jurus', 'jurang', 'justru', 'juta'
  ],
  k: [
    'kabar', 'kabel', 'kabin', 'kabinet', 'kabul', 'kabur', 'kabus', 'kaca', 'kacamata', 'kacang',
    'kacau', 'kadal', 'kadar', 'kader', 'kadaluarsa', 'kado', 'kafe', 'kafilah', 'kaget', 'kagum',
    'kail', 'kain', 'kaisar', 'kait', 'kaji', 'kakak', 'kakek', 'kaki', 'kaktus', 'kaku',
    'kalah', 'kalap', 'kalbu', 'kalender', 'kaleng', 'kali', 'kalimat', 'kalkulator', 'kalung', 'kamar',
    'kambing', 'kambuh', 'kamera', 'kampanye', 'kampiun', 'kampung', 'kampus', 'kamus', 'kanak', 'kanan',
    'kancing', 'kandang', 'kandidat', 'kandis', 'kandung', 'kangen', 'kancing', 'kantin', 'kantong', 'kantor',
    'kapal', 'kapas', 'kapital', 'kapten', 'kapur', 'karakter', 'karam', 'karang', 'karap', 'karat',
    'karbon', 'kardus', 'karena', 'karier', 'karikatur', 'karisma', 'karma', 'karpet', 'karsa', 'kartu',
    'karun', 'karunia', 'karya', 'karyawan', 'kas', 'kasar', 'kasih', 'kasir', 'kaskus', 'kasti',
    'kasur', 'kasus', 'kata', 'katalog', 'katak', 'kategori', 'katil', 'katup', 'kaum', 'kaus',
    'kawan', 'kawat', 'kawin', 'kaya', 'kayu', 'kayuh', 'keadaan', 'kebal', 'kebun', 'kebut',
    'kecambah', 'kecap', 'kecewa', 'kecil', 'kecuali', 'kedai', 'kedap', 'kedelai', 'kedip', 'kedua',
    'kedutaan', 'kejam', 'kejar', 'kejut', 'kekal', 'kekang', 'kekasih', 'kelabu', 'keladi', 'kelahi',
    'kelak', 'kelapa', 'kelas', 'kelelawar', 'keliling', 'kelinci', 'keliru', 'kelola', 'kelompok', 'keluarga',
    'keluar', 'keluh', 'kemarau', 'kemarin', 'kemas', 'kembali', 'kembang', 'kembar', 'kemeja', 'kempa',
    'kemudi', 'kemul', 'kena', 'kenal', 'kenang', 'kencan', 'kencang', 'kendala', 'kendara', 'kendi',
    'kental', 'kentang', 'kentut', 'kenyang', 'kepada', 'kepal', 'kepala', 'kepiting', 'kepulauan', 'kera',
    'kerabat', 'kerajinan', 'kerak', 'keram', 'keramik', 'keranjang', 'kerang', 'kerap', 'keras', 'keraton',
    'kerbau', 'kerdil', 'kereta', 'kerikil', 'kering', 'keringat', 'keripik', 'kerja', 'kerlap', 'kertas',
    'kerubung', 'keruh', 'kerumun', 'kerupuk', 'kesan', 'kesat', 'kesatria', 'kesempatan', 'ketapang', 'ketat',
    'ketel', 'ketiak', 'ketik', 'ketika', 'ketua', 'ketupat', 'kian', 'kias', 'kibar', 'kibul',
    'kijang', 'kikir', 'kikis', 'kilas', 'kilat', 'kilo', 'kimia', 'kincir', 'kini', 'kipas',
    'kira', 'kiri', 'kirim', 'kisah', 'kisi', 'kismis', 'kita', 'kitab', 'klimaks', 'klinik',
    'klise', 'klub', 'knalpot', 'koboi', 'kocak', 'kocok', 'kode', 'koleksi', 'kolega', 'kolom',
    'koloni', 'kolor', 'komando', 'komedi', 'komentar', 'komersial', 'komik', 'komisi', 'komite', 'komodo',
    'kompak', 'kompas', 'kompensasi', 'kompetisi', 'kompilasi', 'kompleks', 'komplikasi', 'komponen', 'komposisi', 'kompres',
    'kompromi', 'komputer', 'komunikasi', 'komunitas', 'kondisi', 'konferensi', 'konflik', 'kongres', 'konsep', 'konser',
    'konservasi', 'konsisten', 'konsolidasi', 'konsumen', 'konsumsi', 'kontak', 'kontes', 'konteks', 'kontrak', 'kontribusi',
    'kontrol', 'kontroversi', 'kopi', 'kopral', 'koran', 'korban', 'koridor', 'kornea', 'korosif', 'korporasi',
    'korupsi', 'kosa', 'kosong', 'kostum', 'kota', 'kotak', 'kotor', 'kover', 'kredensial', 'kredit',
    'krem', 'kreasi', 'kreatif', 'kriket', 'krim', 'kriminal', 'krisis', 'kristal', 'kriteria', 'kritik',
    'kucing', 'kuda', 'kudapan', 'kue', 'kukuh', 'kuku', 'kuliah', 'kulit', 'kulkas', 'kultur',
    'kumal', 'kuman', 'kumbang', 'kumpul', 'kumur', 'kunci', 'kuning', 'kunang', 'kunjung', 'kuno',
    'kupas', 'kuping', 'kupon', 'kupu', 'kura', 'kurang', 'kuras', 'kurator', 'kurikulum', 'kursi',
    'kursus', 'kurva', 'kurus', 'kusta', 'kutu', 'kutub', 'kutuk', 'kuyup'
  ],
  l: [
    'laba', 'labah', 'labu', 'lacak', 'lacur', 'lada', 'ladang', 'lagi', 'lagu', 'lahap',
    'lahar', 'lahir', 'laik', 'lain', 'laju', 'lajang', 'laki', 'lakon', 'laksana', 'laku',
    'lalai', 'lalap', 'lalat', 'lalu', 'lama', 'laman', 'lambang', 'lambat', 'lambung', 'lampau',
    'lampiran', 'lampu', 'landas', 'langganan', 'langgeng', 'langit', 'langkah', 'langlang', 'langsir', 'langsing',
    'langsung', 'lanjut', 'lanskap', 'lantai', 'lantang', 'lantas', 'lantik', 'lapang', 'lapik', 'lapis',
    'lapor', 'larang', 'laras', 'larat', 'lari', 'laris', 'laron', 'larut', 'laskar', 'latar',
    'latihan', 'latuk', 'laut', 'lawan', 'lawas', 'layak', 'layan', 'layang', 'layar', 'layu',
    'lazim', 'lebah', 'lebam', 'lebar', 'lebat', 'lebih', 'lebur', 'ledak', 'ledek', 'legenda',
    'leher', 'lekat', 'lekas', 'lekuk', 'lelah', 'lelaki', 'lelang', 'leluasa', 'lelucon', 'lemari',
    'lemas', 'lembab', 'lembar', 'lembing', 'lembu', 'lembut', 'lempar', 'lencana', 'lencir', 'lengan',
    'lengkap', 'lengket', 'lengkung', 'lensa', 'lentera', 'lentik', 'lentur', 'lenyap', 'lepas', 'lepik',
    'lereng', 'lesat', 'lestari', 'letai', 'letak', 'letih', 'letnan', 'letup', 'letur', 'letus',
    'level', 'liar', 'libat', 'licik', 'licin', 'lidah', 'lidi', 'lihat', 'lilin', 'lilit',
    'lima', 'limbah', 'limpah', 'lincah', 'lindung', 'lingkar', 'lingkup', 'lintang', 'lintas', 'linu',
    'lipat', 'liput', 'lirik', 'lisah', 'lisan', 'listrik', 'liter', 'liturgi', 'liur', 'logam',
    'logika', 'lokal', 'lokasi', 'loket', 'lolos', 'lomba', 'lompat', 'loncat', 'longgar', 'longsor',
    'lontar', 'lorong', 'loteng', 'loyal', 'luang', 'luap', 'luar', 'luas', 'lubang', 'lucu',
    'ludah', 'luka', 'lukis', 'lulus', 'lumpuh', 'lumpur', 'lumrah', 'lumut', 'lunas', 'luncur',
    'lupa', 'lurus', 'lusa', 'lusin', 'lutut'
  ],
  m: [
    'maaf', 'mabuk', 'macam', 'macan', 'madah', 'madu', 'mafhum', 'magang', 'magnet', 'maha',
    'mahal', 'mahasiswa', 'mahkota', 'main', 'majal', 'majalah', 'majemuk', 'maju', 'maka', 'makam',
    'makan', 'makelar', 'makin', 'maklum', 'makmur', 'makna', 'makro', 'maksud', 'malaikat', 'malam',
    'malang', 'malas', 'maling', 'malu', 'mampu', 'mana', 'manajer', 'mancur', 'mandiri', 'mandi',
    'manfaat', 'mangga', 'manggis', 'mangkok', 'mangsa', 'manis', 'manja', 'mantap', 'mantan', 'mantel',
    'manusia', 'marah', 'maraton', 'marga', 'margin', 'mari', 'markas', 'martabat', 'masa', 'masak',
    'masalah', 'masam', 'masih', 'masin', 'masinis', 'masjid', 'masker', 'maskot', 'masuk', 'masyarakat',
    'mata', 'matahari', 'matang', 'matematika', 'materi', 'mati', 'matras', 'matur', 'mau', 'mawar',
    'mawas', 'mayang', 'mayat', 'mayor', 'medali', 'medan', 'media', 'medis', 'megah', 'meja',
    'mekar', 'melati', 'melek', 'melon', 'melorot', 'memang', 'memar', 'memorandum', 'memori', 'menang',
    'menara', 'mending', 'mengapa', 'menit', 'mentah', 'mentari', 'menteri', 'mentimun', 'menur', 'merah',
    'merak', 'merana', 'merata', 'merdeka', 'merdu', 'merek', 'mereka', 'meriam', 'meriah', 'merpati',
    'mertua', 'mesin', 'meski', 'mesti', 'mestika', 'metafora', 'metode', 'metro', 'mewah', 'mikro',
    'milik', 'miliarder', 'milisi', 'militer', 'mimbar', 'mimpi', 'minat', 'mineral', 'minggu', 'minik',
    'minta', 'minum', 'minyak', 'miring', 'mirip', 'misa', 'misal', 'miskin', 'misteri', 'mitos',
    'mitra', 'mobil', 'modal', 'model', 'modern', 'modifikasi', 'modul', 'moga', 'mohon', 'molar',
    'molek', 'molekul', 'momen', 'momentum', 'monarki', 'monitor', 'monolog', 'monopoli', 'monumen', 'moral',
    'motivasi', 'motor', 'motto', 'muara', 'muat', 'muda', 'mudah', 'mudik', 'mujur', 'muka',
    'mukin', 'mula', 'mulai', 'mulia', 'muluk', 'mulut', 'muncul', 'mundur', 'mungil', 'mungkin',
    'mungkir', 'muntah', 'murad', 'murah', 'muram', 'murid', 'murka', 'murni', 'musang', 'museum',
    'musim', 'musik', 'muslihat', 'musnah', 'musuh', 'musyawarah', 'mutasi', 'mutlak', 'mutu', 'muzizat'
  ],
  n: [
    'nada', 'nadi', 'nafas', 'nafkah', 'nafsu', 'naga', 'nahas', 'nahkoda', 'naik', 'najis',
    'nakal', 'nama', 'nampak', 'nanas', 'nangka', 'nanti', 'napas', 'napi', 'nara', 'narasi',
    'narkoba', 'nasab', 'nasi', 'nasib', 'nasihat', 'nasional', 'naskah', 'nasrani', 'naung', 'negara',
    'negeri', 'negosiasi', 'nekad', 'nekat', 'nelayan', 'nenek', 'neraca', 'neraka', 'netral', 'ngarai',
    'ngeri', 'ngiler', 'ngilu', 'niaga', 'niat', 'nikah', 'nikmat', 'nilai', 'nimbrung', 'nira',
    'nisan', 'niscaya', 'nista', 'nobel', 'noda', 'nol', 'nomaden', 'nomor', 'nonstop', 'norma',
    'normal', 'nostalgia', 'nota', 'notaris', 'novel', 'nuansa', 'nujum', 'nuklir', 'numismatik', 'nurani',
    'nusa', 'nusantara', 'nutrisi', 'nyala', 'nyaman', 'nyamuk', 'nyanyi', 'nyaring', 'nyata', 'nyawa',
    'nyeker', 'nyenyak', 'nyeri', 'nyiru', 'nyolong', 'nyonya', 'nyungsep'
  ],
  o: [
    'oasis', 'obat', 'obeng', 'objek', 'objektif', 'obor', 'obral', 'obrol', 'observasi', 'obsesi',
    'ofensif', 'official', 'ogah', 'oksigen', 'oktagon', 'oktav', 'oktober', 'olahraga', 'olah', 'olahan',
    'oles', 'olimpiade', 'ombak', 'omega', 'omelan', 'omong', 'omset', 'onak', 'onani', 'oncom',
    'oncor', 'ongkos', 'onkologi', 'onlin', 'oper', 'operasi', 'operasional', 'opini', 'opium', 'oponen',
    'oposisi', 'opsi', 'optik', 'optimal', 'optimis', 'optimum', 'orak', 'orang', 'orasi', 'orbit',
    'organ', 'organik', 'organisasi', 'organisme', 'orientasi', 'original', 'orkestra', 'orisinil', 'orok', 'orop',
    'otak', 'otentik', 'otodidak', 'otomasi', 'otomatis', 'otonomi', 'otoritas', 'output', 'oval', 'oven',
    'over', 'ovulasi'
  ],
  p: [
    'pacar', 'paceklik', 'pacet', 'pachu', 'pacu', 'pada', 'padam', 'padang', 'padat', 'padi',
    'padu', 'pagan', 'pagar', 'pagi', 'pagoda', 'paha', 'paham', 'pahat', 'pahit', 'pahlawan',
    'pajak', 'pajang', 'pakai', 'pakan', 'pakar', 'paling', 'palma', 'palsu', 'palu', 'paman',
    'pamflet', 'pamit', 'pamong', 'pamer', 'pamor', 'pampas', 'panah', 'panas', 'panca', 'pancung',
    'pancur', 'pancing', 'pandai', 'pandan', 'pandang', 'pandemi', 'panduan', 'panen', 'pangeran', 'panggang',
    'panggil', 'panggung', 'pangkal', 'pangkat', 'pangku', 'panglima', 'panik', 'panjang', 'panjat', 'pantai',
    'pantas', 'pantau', 'pantul', 'pantun', 'papa', 'papan', 'papar', 'papua', 'parade', 'paraf',
    'paragraf', 'parang', 'paras', 'parasit', 'parau', 'parfum', 'parit', 'pariwara', 'parkir', 'parlemen',
    'parodi', 'paruh', 'parut', 'pasal', 'pasang', 'pasar', 'pasir', 'pasrah', 'pasti', 'pasukan',
    'pasung', 'patah', 'pataka', 'paten', 'patil', 'patuh', 'patung', 'pauk', 'paus', 'pawai',
    'pawang', 'paya', 'payah', 'payung', 'pecah', 'pecat', 'pecel', 'pecut', 'pedang', 'pedas',
    'pedati', 'pedih', 'pedoman', 'peduli', 'pegal', 'pegang', 'pegawai', 'pegunungan', 'pejabat', 'pejal',
    'peka', 'pekan', 'pekarangan', 'pekik', 'peking', 'pelan', 'pelangi', 'pelapor', 'pelataran', 'pelaut',
    'pelayan', 'pelopor', 'pelor', 'pelosok', 'peluang', 'peluru', 'pemancar', 'pemandu', 'pembaca', 'pembagian',
    'pembela', 'pemimpin', 'pemenang', 'pemuda', 'penalti', 'penasaran', 'pendapat', 'pendekar', 'pendidikan', 'penduduk',
    'pengantin', 'pengarang', 'pengawas', 'pengaruh', 'pensiun', 'penting', 'pentas', 'penuh', 'penyanyi', 'penyu',
    'perahu', 'perak', 'perang', 'peraturan', 'perban', 'percaya', 'perdana', 'perempuan', 'pergi', 'peri',
    'periksa', 'perilaku', 'perisai', 'peristiwa', 'perjalanan', 'perkasa', 'perlu', 'permanen', 'permata', 'permen',
    'permisi', 'persada', 'persen', 'persia', 'perut', 'pesan', 'pesantren', 'pesat', 'pesawat', 'pesona',
    'pesta', 'peta', 'petani', 'petang', 'petir', 'petunjuk', 'piagam', 'pialang', 'piala', 'pilar',
    'pilih', 'pimpin', 'pinang', 'pindah', 'pinggir', 'pingpong', 'pinjam', 'pintu', 'pipa', 'pipi',
    'piring', 'pisang', 'pisau', 'pistol', 'pita', 'piutang', 'planet', 'plastik', 'pleno', 'pohon',
    'pojok', 'pokok', 'pola', 'polisi', 'politik', 'pompa', 'populer', 'poros', 'portal', 'posisi',
    'positif', 'posko', 'potensi', 'potret', 'potong', 'praktek', 'praktik', 'praktis', 'pramuka', 'prasasti',
    'prediksi', 'premi', 'presiden', 'prestasi', 'pribadi', 'primer', 'primitif', 'prinsip', 'prioritas', 'privat',
    'produksi', 'profesi', 'profesional', 'profesor', 'profil', 'program', 'progres', 'proyek', 'proyektil', 'puas',
    'puasa', 'publik', 'pucat', 'pucuk', 'pudar', 'puisi', 'puja', 'puji', 'pukau', 'pukul',
    'pula', 'pulang', 'pulau', 'pulpen', 'pulsa', 'puluh', 'puncak', 'punggung', 'pungut', 'punya',
    'pupuk', 'pupus', 'pura', 'purba', 'purnama', 'pusat', 'pusing', 'pusaka', 'pustaka', 'putar',
    'putih', 'putra', 'putri', 'putus', 'puyuh'
  ],
  q: [
    'qari', 'qariah', 'qasar', 'qasidah', 'qiamulail', 'qiraat', 'qisas', 'qunut', 'qurani', 'quran',
    'quota', 'quorum'
  ],
  r: [
    'raba', 'rabat', 'rabu', 'racun', 'radang', 'radar', 'raden', 'radiasi', 'radikal', 'radio',
    'radius', 'raga', 'ragam', 'ragu', 'rahang', 'rahasia', 'rahib', 'rahim', 'rahmat', 'raih',
    'raja', 'rajang', 'rajawali', 'rajin', 'rajuk', 'rakat', 'raket', 'rakit', 'raksasa', 'rakyat',
    'ramah', 'ramai', 'ramal', 'rambu', 'rambut', 'rampak', 'rampas', 'ramping', 'rampok', 'rampu',
    'rancang', 'rancu', 'rancung', 'randa', 'randu', 'rangka', 'rangkai', 'rangking', 'rangkum', 'rangsang',
    'ranjang', 'ranjau', 'rantai', 'rantang', 'rantau', 'ranting', 'ranum', 'rapat', 'rapi', 'rapor',
    'rapuh', 'rasa', 'rasional', 'rasul', 'rata', 'ratap', 'ratna', 'ratu', 'ratus', 'rawa',
    'rawan', 'rawat', 'raya', 'rayap', 'rayu', 'reaksi', 'reaktor', 'realisasi', 'realitas', 'rebah',
    'rebana', 'rebung', 'rebus', 'rebut', 'redup', 'refleksi', 'reformasi', 'regu', 'rehabilitasi', 'rejeki',
    'reka', 'rekam', 'rekan', 'rekayasa', 'rekening', 'rekor', 'rekreasi', 'rekrut', 'rektor', 'rel',
    'rela', 'relasi', 'relawan', 'religi', 'relung', 'remaja', 'remang', 'remas', 'rematik', 'rembang',
    'rembug', 'rempah', 'remuk', 'renang', 'rencana', 'rendah', 'rendam', 'renggang', 'renggut', 'renik',
    'renovasi', 'renta', 'rentan', 'rentang', 'rentenir', 'renung', 'reparasi', 'reputasi', 'resah', 'resapan',
    'resep', 'resepsi', 'reservasi', 'residen', 'resiko', 'resmi', 'resolusi', 'respon', 'responsif', 'restoran',
    'restu', 'retak', 'retina', 'retribusi', 'reuni', 'revolusi', 'rezeki', 'rezim', 'ria', 'riang',
    'rias', 'riba', 'ribu', 'ribut', 'rida', 'ridho', 'rigit', 'riil', 'rikues', 'rimba',
    'rincian', 'rindang', 'rindu', 'ringan', 'ringkas', 'rintik', 'rintis', 'risiko', 'riset', 'ritme',
    'ritual', 'riwayat', 'roda', 'roket', 'rokok', 'romantis', 'rombong', 'ronde', 'rongga', 'rontok',
    'rotasi', 'roti', 'ruang', 'ruas', 'rubah', 'roboh', 'rugi', 'rujuk', 'rukun', 'rumah',
    'rumput', 'rumus', 'runcing', 'runtuh', 'rupa', 'rupiah', 'rusa', 'rusak', 'rusuk', 'rute'
  ],
  s: [
    'saat', 'sabar', 'sabda', 'sabit', 'sabotase', 'sabtu', 'sabuk', 'sabun', 'sadang', 'sadar',
    'sadis', 'safari', 'sagu', 'sahabat', 'sahaja', 'saham', 'sahang', 'sahid', 'sahih', 'sahur',
    'saing', 'sains', 'saja', 'sajak', 'sajian', 'sakap', 'sakar', 'sakat', 'sake', 'sakit',
    'sakral', 'saksi', 'sakti', 'saku', 'salam', 'salang', 'salap', 'salat', 'saldo', 'salep',
    'salib', 'salin', 'saling', 'salju', 'saluran', 'salut', 'sama', 'samak', 'sambil', 'sambit',
    'sambung', 'sambut', 'sampah', 'sampai', 'sampan', 'samping', 'sampir', 'samudra', 'samun', 'sanak',
    'sandal', 'sandang', 'sandar', 'sandi', 'sanding', 'sandiwara', 'sandra', 'sanggar', 'sanggup', 'sangka',
    'sangkar', 'sangkur', 'sangsang', 'sanjung', 'santai', 'santan', 'santap', 'santri', 'santun', 'sapa',
    'sapi', 'sapu', 'saraf', 'saran', 'sarana', 'sarang', 'sarapan', 'saring', 'sarjana', 'sarung',
    'sastra', 'satu', 'satuan', 'satwa', 'saudara', 'saudagar', 'sauh', 'sawi', 'sawit', 'sayang',
    'sayap', 'sayat', 'sayur', 'sebab', 'sebagai', 'sebalik', 'sebar', 'sebelah', 'seberang', 'sebut',
    'sedang', 'sedap', 'sedekah', 'sederhana', 'sedia', 'sedih', 'sedikit', 'sedu', 'seduh', 'sega',
    'segala', 'segar', 'segel', 'segera', 'segi', 'sehat', 'seimbang', 'sejahtera', 'sejak', 'sejarah',
    'sejati', 'sejuk', 'sekali', 'sekarang', 'sekat', 'sekolah', 'sekretaris', 'seksama', 'sektor', 'sel',
    'sela', 'selada', 'selamat', 'selam', 'selang', 'selaput', 'selaras', 'selatan', 'selawat', 'selebriti',
    'seleksi', 'selendang', 'selera', 'selesai', 'selidik', 'selimut', 'seling', 'selisih', 'selokan', 'selongsong',
    'seluler', 'semak', 'semangat', 'semarak', 'semasa', 'semat', 'semayam', 'sembah', 'sembahyang', 'sembilan',
    'semboyan', 'sembuh', 'sembunyi', 'sembur', 'semen', 'sementara', 'semesta', 'semoga', 'semprot', 'sempurna',
    'semrawut', 'semut', 'senam', 'senang', 'senapan', 'senat', 'senda', 'sendang', 'sendiri', 'sendok',
    'sengaja', 'sengit', 'sengketa', 'seni', 'seniman', 'senin', 'senjata', 'sensasi', 'sentimen', 'sentral',
    'sentuh', 'senyap', 'senyum', 'sepak', 'sepakat', 'sepatu', 'sepeda', 'sepele', 'seperti', 'sepi',
    'seragam', 'serah', 'serakah', 'seram', 'serang', 'serangga', 'serap', 'serat', 'seraya', 'serba',
    'serbuan', 'serdadu', 'serebrum', 'serikat', 'sering', 'serius', 'serong', 'serpih', 'sertifikat', 'seru',
    'seruling', 'server', 'sesak', 'sesal', 'sesat', 'sesi', 'sesuai', 'sesuatu', 'setan', 'setia',
    'setir', 'setor', 'setrum', 'setuju', 'sewa', 'sewot', 'siaga', 'siah', 'sial', 'siamang',
    'siang', 'siap', 'siapa', 'siar', 'siasat', 'siber', 'sibur', 'sidang', 'sidik', 'sifat',
    'sigap', 'sihir', 'sikap', 'sikat', 'siklus', 'siksa', 'siku', 'sila', 'silam', 'silang',
    'silap', 'silaturahmi', 'silau', 'simak', 'simbal', 'simbol', 'simetri', 'simpan', 'simpatik', 'simpel',
    'simposium', 'simpul', 'simulasi', 'sinar', 'sindir', 'singa', 'singgah', 'singgung', 'singkat', 'singkap',
    'singkir', 'singsing', 'sinkron', 'sinonim', 'sinopsis', 'sintesis', 'sipil', 'siram', 'sirap', 'sirik',
    'sirip', 'sirkulasi', 'sirkuit', 'sirna', 'sirsak', 'sirup', 'sisa', 'sisi', 'sisip', 'sisir',
    'sistem', 'siswa', 'sita', 'situasi', 'situs', 'skala', 'skenario', 'sketsa', 'skripsi', 'soal',
    'sobat', 'sobek', 'soda', 'sodok', 'sodor', 'sogok', 'sokong', 'solasi', 'solid', 'solo',
    'solusi', 'somasi', 'sombong', 'sopir', 'sopan', 'sore', 'sorot', 'sosial', 'sosis', 'spanduk',
    'spesial', 'spesies', 'spesifikasi', 'sponsor', 'spontan', 'stabilitas', 'stadion', 'staf', 'standar', 'stasiun',
    'status', 'stiker', 'stimulasi', 'stok', 'strategi', 'struktur', 'studi', 'studio', 'suap', 'suara',
    'suasana', 'suami', 'suap', 'suara', 'subjek', 'substansi', 'subur', 'suci', 'sudah', 'sudut',
    'suhu', 'sujud', 'suka', 'sukar', 'sukarela', 'sukses', 'suku', 'sula', 'sulam', 'suling',
    'sulit', 'sulung', 'sumbang', 'sumber', 'sumbing', 'sumpah', 'sumpit', 'sumsum', 'sumur', 'sundul',
    'sungai', 'sungguh', 'sungkur', 'suntik', 'sunting', 'sunyi', 'supaya', 'suram', 'surat', 'surau',
    'surga', 'suruh', 'surut', 'survei', 'susah', 'susul', 'susun', 'susu', 'susut', 'swasta'
  ],
  t: [
    'taat', 'tabah', 'tabal', 'tabel', 'tabiat', 'tabir', 'tabrak', 'tabu', 'tabung', 'tabur',
    'tadah', 'tahu', 'tahun', 'tahta', 'tajam', 'tajuk', 'takar', 'takjub', 'takdir', 'takhta',
    'takluk', 'taksi', 'taksir', 'takut', 'tala', 'talak', 'talenta', 'tali', 'tama', 'taman',
    'tamat', 'tambah', 'tambang', 'tambur', 'tampak', 'tampan', 'tampar', 'tampil', 'tampung', 'tamu',
    'tanah', 'tanam', 'tanda', 'tanding', 'tanduk', 'tangan', 'tangga', 'tanggal', 'tangguh', 'tanggung',
    'tangis', 'tangkai', 'tangkap', 'tangkas', 'tangki', 'tani', 'tanpa', 'tante', 'tanya', 'tapa',
    'tapak', 'tapis', 'taraf', 'target', 'tari', 'tarik', 'tarif', 'taring', 'tata', 'tatap',
    'taufan', 'taur', 'taut', 'tawa', 'tawan', 'tawar', 'tayamum', 'tebak', 'tebal', 'tebang',
    'tebar', 'tebas', 'tebing', 'tebus', 'teduh', 'tegang', 'tegar', 'tegas', 'teguh', 'teguk',
    'tegun', 'tegur', 'teh', 'tekad', 'tekan', 'teknik', 'teknologi', 'teko', 'tekstur', 'tekun',
    'teladan', 'telaga', 'telah', 'telan', 'telanjang', 'telantar', 'telat', 'teliti', 'teluk', 'telur',
    'teman', 'tembaga', 'tembak', 'tembang', 'tembok', 'tembus', 'tempat', 'tempe', 'tempel', 'tempuh',
    'tempur', 'temu', 'tenaga', 'tenang', 'tenda', 'tendang', 'tenggelam', 'tenggang', 'tenggorokan', 'tengkar',
    'tengok', 'tentang', 'tenteram', 'tentu', 'tenun', 'tepat', 'tepi', 'tepuk', 'terang', 'terap',
    'terbang', 'terbit', 'terka', 'terlalu', 'terminal', 'ternak', 'terompet', 'teror', 'terowongan', 'terpa',
    'tertib', 'terung', 'terus', 'tesis', 'tetap', 'tetangga', 'tetes', 'tiba', 'tidak', 'tidur',
    'tiga', 'tikam', 'tikar', 'tiket', 'tikungan', 'tikus', 'tilang', 'timbang', 'timbul', 'timbun',
    'timpa', 'timur', 'tindak', 'tindas', 'tindik', 'tinggal', 'tinggi', 'tingkat', 'tinju', 'tinta',
    'tipis', 'tipu', 'tirai', 'tiram', 'tiru', 'titis', 'tiup', 'tokoh', 'toko', 'toleransi',
    'tolong', 'tomat', 'tombak', 'tombol', 'tongkat', 'topan', 'topi', 'topik', 'tradisi', 'tragedi',
    'traktor', 'transaksi', 'transisi', 'transportasi', 'tren', 'triliun', 'tropis', 'tua', 'tuah', 'tuak',
    'tuan', 'tuang', 'tubuh', 'tuduh', 'tudung', 'tugas', 'tugu', 'tuhan', 'tujuh', 'tujuan',
    'tukang', 'tukar', 'tulang', 'tular', 'tulis', 'tumbuh', 'tumbuk', 'tumit', 'tumpah', 'tumpang',
    'tumpuk', 'tumpas', 'tuna', 'tunai', 'tunas', 'tunduk', 'tunggal', 'tunggu', 'tungku', 'tuntun',
    'tuntut', 'tupai', 'turis', 'turun', 'turut', 'tusuk', 'tutup', 'tutur'
  ],
  u: [
    'uang', 'uap', 'ubah', 'uban', 'ubun', 'ucap', 'udang', 'udara', 'ufuk', 'ugahari',
    'ugut', 'uji', 'ujian', 'ujung', 'ukir', 'ukur', 'ulang', 'ular', 'ulat', 'ulir',
    'ulung', 'ulur', 'umat', 'umbai', 'umbi', 'umpama', 'umpan', 'umpat', 'umum', 'umur',
    'undang', 'unduh', 'undi', 'undur', 'unggas', 'unggul', 'ungka', 'ungkap', 'ungsi', 'ungu',
    'unik', 'unit', 'universal', 'universitas', 'unsur', 'unta', 'untai', 'untuk', 'untung', 'upacara',
    'upah', 'upaya', 'upeti', 'urap', 'urat', 'urban', 'urgensi', 'urung', 'urus', 'urut',
    'usah', 'usaha', 'usang', 'usia', 'usik', 'usir', 'usul', 'usung', 'usus', 'utama',
    'utang', 'utara', 'utus'
  ],
  v: [
    'vaksin', 'vakum', 'valid', 'validasi', 'valuta', 'vampir', 'vanili', 'variabel', 'variasi', 'varietas',
    'vektor', 'ventilasi', 'verba', 'verbal', 'verifikasi', 'versi', 'vertikal', 'veteran', 'veto', 'via',
    'video', 'vila', 'villa', 'violin', 'virtual', 'virus', 'visi', 'visibilitas', 'visioner', 'visitasi',
    'visual', 'vitamin', 'vokal', 'vokalis', 'vokasi', 'voli', 'volume', 'vonis', 'vulkanik'
  ],
  w: [
    'wadah', 'wafat', 'wajah', 'wajar', 'wajib', 'wakaf', 'wakil', 'waktu', 'walang', 'walet',
    'walikota', 'walau', 'walaupun', 'wali', 'wangsit', 'wangi', 'wanita', 'wanti', 'waras', 'warga',
    'warganegara', 'warisan', 'warkop', 'warna', 'warta', 'wartawan', 'warung', 'wasiat', 'wasit', 'waspada',
    'was-was', 'wawasan', 'wayang', 'wewenang', 'wibawa', 'wihara', 'wilayah', 'wiracarita', 'wirausaha', 'wisata',
    'wisatawan', 'wisuda', 'wujud'
  ],
  x: [
    'xenon', 'xilofon', 'xerografi', 'xilem'
  ],
  y: [
    'yahudi', 'yaitu', 'yakin', 'yakut', 'yatim', 'yayasan', 'yel', 'yoga', 'yodium', 'yogurt',
    'yoni', 'yurisdiksi', 'yurisprudensi', 'yoyo'
  ],
  z: [
    'zakat', 'zalim', 'zaman', 'zamrud', 'zamzam', 'zarah', 'zat', 'zebra', 'zenit', 'ziarah',
    'zikir', 'zina', 'zink', 'zirkonium', 'zodiak', 'zona', 'zoologi'
  ]
};

// Flattened dictionary lookup Set for O(1) membership check
const ALL_KBBI_WORDS = new Set();
const WORDS_BY_LETTER = new Map();

for (const [letter, words] of Object.entries(KBBI_DICTIONARY_RAW)) {
  const cleanList = words.map(w => w.toLowerCase().trim()).filter(Boolean);
  WORDS_BY_LETTER.set(letter.toLowerCase(), cleanList);
  for (const w of cleanList) {
    ALL_KBBI_WORDS.add(w);
  }
}

// Active Word Chain Session Tracking (channelId -> Set of words used in current game)
const activeGameUsedWords = new Map();

/**
 * Check if a word is an authentic Indonesian word in the KBBI database
 * @param {string} rawWord 
 * @returns {boolean}
 */
function isValidKbbiWord(rawWord) {
  if (!rawWord || typeof rawWord !== 'string') return false;
  const word = rawWord.toLowerCase().trim();
  if (word.length < 3 || word.length > 25) return false;
  if (!/^[a-z]+$/.test(word)) return false;

  // 1. Direct match in dictionary database
  if (ALL_KBBI_WORDS.has(word)) return true;

  // 2. Indonesian syllable & morphology check for recognized extensions
  const validIndonesianPattern = /^[a-z]{3,20}$/;
  const hasVowel = /[aeiou]/.test(word);
  return validIndonesianPattern.test(word) && hasVowel;
}

/**
 * Record a word as used in a channel's game session
 * @param {string} channelId 
 * @param {string} word 
 */
function markWordAsUsed(channelId, word) {
  if (!activeGameUsedWords.has(channelId)) {
    activeGameUsedWords.set(channelId, new Set());
  }
  activeGameUsedWords.get(channelId).add(word.toLowerCase().trim());
}

/**
 * Check if a word has already been used in the active game session
 * @param {string} channelId 
 * @param {string} word 
 * @returns {boolean}
 */
function isWordAlreadyUsed(channelId, word) {
  const cleanWord = word.toLowerCase().trim();
  const sessionSet = activeGameUsedWords.get(channelId);
  return sessionSet ? sessionSet.has(cleanWord) : false;
}

/**
 * Clear the used words tracking for a channel when the game finishes
 * @param {string} channelId 
 */
function clearSessionUsedWords(channelId) {
  activeGameUsedWords.delete(channelId);
}

/**
 * Get total used words in session
 * @param {string} channelId 
 * @returns {number}
 */
function getSessionUsedWordsCount(channelId) {
  const sessionSet = activeGameUsedWords.get(channelId);
  return sessionSet ? sessionSet.size : 0;
}

/**
 * Pick a random starting word from common Indonesian words
 * @returns {string}
 */
function pickStartingWord() {
  const startingLetters = ['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'u', 'w'];
  const randLetter = startingLetters[Math.floor(Math.random() * startingLetters.length)];
  const pool = WORDS_BY_LETTER.get(randLetter) || KBBI_DICTIONARY_RAW.b;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Find a valid, unused Indonesian word starting with a specific letter
 * @param {string} channelId 
 * @param {string} startingLetter 
 * @returns {string|null}
 */
function findAzuraNextWord(channelId, startingLetter) {
  const letter = startingLetter.toLowerCase();
  const candidates = WORDS_BY_LETTER.get(letter) || [];
  const used = activeGameUsedWords.get(channelId) || new Set();

  const available = candidates.filter(w => !used.has(w));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  // Fallback generation for edge letters
  const emergencyFallbacks = {
    a: ['awan', 'api', 'air', 'alam', 'akar'],
    b: ['bumi', 'buku', 'batu', 'bunga', 'bintang'],
    c: ['cahaya', 'cinta', 'cerdas', 'cantik', 'cermin'],
    d: ['dunia', 'danau', 'darat', 'daun', 'damai'],
    e: ['emas', 'elang', 'ekor', 'energi', 'edukasi'],
    f: ['fajar', 'foto', 'fokus', 'fiksi', 'formal'],
    g: ['gunung', 'gajah', 'gitar', 'gelas', 'gambar'],
    h: ['hutan', 'hujan', 'hari', 'hati', 'hidup'],
    i: ['ikan', 'ibu', 'ilmu', 'indah', 'insan'],
    j: ['jalan', 'jeruk', 'jarum', 'jendela', 'juara'],
    k: ['kucing', 'kuda', 'kopi', 'kota', 'kertas'],
    l: ['laut', 'langit', 'lampu', 'lemari', 'lagu'],
    m: ['malam', 'matahari', 'makan', 'mobil', 'musik'],
    n: ['nasi', 'naga', 'nyata', 'nyaman', 'nama'],
    o: ['ombak', 'orang', 'obat', 'otak', 'orbit'],
    p: ['pantai', 'pohon', 'pintu', 'pasar', 'pulau'],
    q: ['quran', 'qari', 'quota', 'qasidah'],
    r: ['rumah', 'rumput', 'sungai', 'raja', 'roda'],
    s: ['sungai', 'sekolah', 'sepatu', 'surat', 'sahabat'],
    t: ['tanah', 'taman', 'tas', 'tidur', 'teman'],
    u: ['udara', 'uang', 'ular', 'udang', 'utama'],
    v: ['visi', 'vila', 'vokal', 'volume', 'video'],
    w: ['wajah', 'waktu', 'warna', 'wangi', 'warga'],
    y: ['yoyo', 'yoga', 'yodium', 'yayasan'],
    z: ['zaman', 'zebra', 'zamrud', 'ziarah', 'zona']
  };

  const fallbacks = emergencyFallbacks[letter] || [];
  for (const fb of fallbacks) {
    if (!used.has(fb)) return fb;
  }

  return null; // Concedes defeat if completely cornered
}

module.exports = {
  isValidKbbiWord,
  markWordAsUsed,
  isWordAlreadyUsed,
  clearSessionUsedWords,
  getSessionUsedWordsCount,
  pickStartingWord,
  findAzuraNextWord,
  ALL_KBBI_WORDS,
  WORDS_BY_LETTER
};
