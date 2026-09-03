# 🎮 AZURA MLBB Autonomous Pilot (Shadow PC Edition)

Modul otomatisasi bermain Mobile Legends (MLBB) di emulator Android (LDPlayer 9 / MuMu 12) dengan respons ultra-cepat menggunakan **DirectX Desktop Duplication (BetterCam)** dan **DirectInput Virtual Controller**.

---

## 🚀 Cara Menjalankan di Shadow PC

### 1. Install Dependencies
Buka terminal PowerShell / Command Prompt di Shadow PC, masuk ke folder ini, dan jalankan:
```bash
pip install -r requirements.txt
```

### 2. Siapkan Emulator LDPlayer 9 / MuMu 12
1. Buka emulator dan jalankan game **Mobile Legends**.
2. Masuk ke **Custom Mode ➔ Practice (Mode Latihan)** dengan hero apapun (misal: Layla / Miya).
3. Pastikan resolusi emulator diatur ke **1280 x 720**.

### 3. Jalankan Azura MLBB Pilot
```bash
python azura_mlbb_pilot.py
```

---

## 🛑 Emergency Killswitch (Pemberhentian Darurat)
Tekan tombol **`Q`** atau **`ESC`** di keyboard kapan saja untuk menghentikan bot seketika.
