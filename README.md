# 🤖 AZURA — Discord Personal AI Assistant

> *"AZURA adalah teman Discord yang kebetulan punya otak AI."*

AZURA adalah bot Discord pribadi berbasis Node.js yang menggunakan **OpenAI API (`gpt-4o-mini`)** untuk berinteraksi secara santai, pintar, dan responsif menggunakan Bahasa Indonesia.

---

## 📋 Fitur Utama (v0.1)

- 💬 **Conversation Context**: AZURA mengingat konteks obrolan pendek (sliding window).
- 🏷️ **Mention Listener (`@AZURA`)**: Cukup mention `@AZURA pesan kamu` di server Discord.
- 🧹 **`/reset` Slash Command**: Mereset riwayat percakapan pengguna dari nol.
- 📊 **`/status` Slash Command**: Menampilkan status bot, model, latency, dan uptime.
- 🛡️ **Cost Guard & Rate Limiter**: Dilengkapi batas token dan jeda cooldown (3 detik) untuk menjaga biaya OpenAI tetap hemat (< $5/bulan).

---

## 🛠️ Persyaratan System

1. **Node.js**: Versi `v18.x` atau lebih baru (`v24.x` direkomendasikan).
2. **Discord Account**: Untuk membuat Discord Bot.
3. **OpenAI Account**: Kunci API dari OpenAI (`platform.openai.com`).

---

## 🚀 Cara Setup & Menjalankan AZURA

### 1. Buka Project di VS Code
Buka folder `AZURA` menggunakan aplikasi Visual Studio Code.

### 2. Isi Kredensial di File `.env`
Buka file bernama `.env` di folder project, lalu isi 3 nilai berikut:

```env
DISCORD_TOKEN=paste_discord_bot_token_kamu_di_sini
DISCORD_CLIENT_ID=paste_client_id_kamu_di_sini
OPENAI_API_KEY=paste_openai_api_key_kamu_di_sini
```

> ⚠️ **KEAMANAN**: File `.env` ini bersifat rahasia dan sudah otomatis dimasukkan ke `.gitignore` agar tidak ter-upload ke publik.

### 3. Install Dependency (Jika Belum)
Buka terminal di VS Code (Ctrl + ` ~ `) lalu ketik:
```bash
npm install
```

### 4. Dapatkan Link Invite Bot
Untuk memasukkan AZURA ke server Discord kamu, jalankan:
```bash
npm run invite
```
Copy URL yang muncul di terminal, lalu buka di browser untuk memasukkan AZURA ke server Discord kamu.

### 5. Jalankan AZURA
Ketik perintah berikut di terminal:
```bash
npm start
```

---

## 💬 Cara Menggunakan AZURA

1. **Mengobrol**:
   ```text
   @AZURA lu lagi apa?
   ```
2. **Mereset Obrolan**:
   Ketik `/reset` di Discord.
3. **Cek Status Bot**:
   Ketik `/status` di Discord.

---

## 🛑 Cara Menghentikan Bot
Untuk mematikan AZURA di komputer kamu:
- Klik terminal di VS Code → Tekan **`Ctrl + C`**.

---

## 💰 Perlindungan Biaya (Cost Control)
- Model yang digunakan adalah `gpt-4o-mini` (sangat murah).
- Disarankan memasang **Hard Limit $5.00** di menu Billing OpenAI (`platform.openai.com/account/limits`).
