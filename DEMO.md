# 🎬 DEMO.md — Runbook Demo di Depan Juri

Panduan langkah-demi-langkah untuk mendemokan **Ophthalmo-AI** dalam ±5 menit.
Seluruh demo berjalan di **mode demo** (mock AI in-memory) — **tidak butuh Firebase, tidak butuh API key, tidak butuh internet** setelah load pertama.

---

## ✅ Persiapan (5 menit sebelum maju)

| # | Cek | Keterangan |
|---|---|---|
| 1 | Laptop + Chrome/Edge | Browser modern apa pun |
| 2 | Node.js terpasang | Sudah ada di mesin ini |
| 3 | **Double-click `start-demo.bat`** | Server jalan + browser terbuka otomatis di `http://localhost:5173` |
| 4 | Load halaman sekali **dengan internet** | Agar font Space Grotesk ter-cache; setelah itu bisa full offline |
| 5 | Buka folder `demo-assets/` di Explorer | Berisi 3 foto mata contoh utk di-upload |
| 6 | ⚠️ **JANGAN refresh halaman di tengah alur demo** | Data demo hidup di memori — refresh mengembalikan ke data awal (data seed tetap ada) |

**Kredensial demo** (atau pakai tombol *Demo Nakes* / *Demo Admin* di halaman login):

| Role | Email | Password |
|---|---|---|
| Nakes | `nakes@demo.id` | `demo123` |
| Admin | `admin@demo.id` | `demo123` |

**Data seed pasien** (selalu tersedia, tahan refresh):
NIK `3201014455660001` · Kode `OA-DEMO-2024` (Sumarni — kasus glaukoma akut)

**Foto mata contoh** (`demo-assets/`) — nama file sudah dikalibrasi ke mock ML Vision:

| File | Hasil ML Vision | Skenario |
|---|---|---|
| `mata-merah-ad.png` | Hiperemia konjungtiva **0.61** | Glaukoma akut / iritasi ringan |
| `mata-keruh-ab.png` | Kekeruhan kornea **0.64** | Keratitis → rujukan dokter |
| `mata-normal-2s.png` | Semua skor rendah | Self-care (aturan 20-20-20) |

---

## 🎯 Alur Demo 5 Menit

### Babak 1 — Portal Pasien Anonim (±45 detik)

1. Halaman awal = **Portal Pasien** (tanpa login).
2. Tunjuk statistik besar & indikator Online/role di pojok kanan atas.
3. Isi NIK `3201014455660001` + kode `OA-DEMO-2024` → **Lihat Rekam Medis**.
4. 💬 *"Pasien tidak butuh akun — cukup NIK + kode unik dari nakes. Verifikasi dua faktor ini divalidasi server-side, dan setiap percobaan akses (berhasil/gagal) tercatat di audit log."*

### Babak 2 — INTI: Triase AI Dua Tahap (±2,5 menit)

1. Klik **Login Nakes** → tombol **Demo Nakes**.
2. Tunjuk dashboard: statistik triase, daftar kasus dengan badge urgensi berwarna.
3. Klik **Triase Baru**:
   - NIK baru: `3201017788990011`, Nama: `Budi Santoso`, Usia: `45`
   - Upload **`demo-assets/mata-merah-ad.png`** → pratinjau muncul
   - Klik **🔍 Analisis dengan ML Vision**
4. 💬 Saat loading: *"Tahap 1 — model Computer Vision mengekstrak fitur visual: hiperemia, kekeruhan kornea, asimetri pupil…"*
5. Hasil ML Vision tampil (hiperemia 0.61). 💬 *"Mata merah — sekilas tampak konjungtivitis biasa. Tapi sistem TIDAK langsung menyimpulkan…"*
6. Isi gejala (kunci skenario glaukoma):
   - Tingkat nyeri: **Nyeri hebat**
   - Melihat halo: **Ya**
   - Sakit kepala + mual: **Ya**
   - Fotofobia: **Ya**
7. Klik **Kirim & Minta Triase Final** → hasil: **KRITIS · KEGAWATDARURATAN · Glaukoma Akut Sudut Tertutup**.
8. 💬 *"Inilah nilai sistem pakar: ML melihat 'mata merah', tapi korelasi dengan halo + sakit kepala + mual mengubah diagnosis menjadi glaukoma akut — kondisi yang membutakan dalam hitungan jam. Perhatikan: golden hour < 2 jam, larangan steroid tanpa resep, dan daftar yang TIDAK boleh dilakukan."*
9. Tunjuk **kode akses pasien** yang digenerate (mis. `OA-XXXX-XXXX`) — dicatat/dibacakan ke pasien.
10. *(Opsional, tanpa refresh)*: klik **Keluar** → portal pasien → masukkan NIK `3201017788990011` + kode barusan → pasien melihat hasilnya sendiri. **Loop tertutup.**

### Babak 3 — Protokol Golden Hour Trauma Kimia (±45 detik, paling dramatis)

1. Login Nakes lagi → **Triase Baru** → pasien baru (NIK bebas 16 digit, mis. `3201015566770022`), upload foto apa pun.
2. Di form gejala, isi **Riwayat trauma**: `Terkena cairan pembersih 10 menit lalu`.
3. Hasil: instruksi #1 = **IRIGASI air mengalir 15–20 menit SEKARANG JUGA — sebelum ke RS**.
4. 💬 *"Aturan keselamatan hard-coded di system prompt: kata kunci bahan kimia SELALU memicu protokol irigasi sebagai instruksi pertama — hasil ML Vision dikesampingkan karena kerusakan kimiawi belum tentu terlihat di foto menit-menit awal."*

### Babak 4 — Super Admin: Audit & Pengawasan (±45 detik)

1. Keluar → **Demo Admin**.
2. Dashboard: statistik global + distribusi tingkat urgensi.
3. **Audit Log**: tunjukkan seluruh jejak yang baru saja terjadi (login, registrasi pasien, vision analysis, triase final, akses pasien anonim).
4. **Arsip** → buka satu rekam medis → 💬 *"Bahkan akses admin ke arsip pun otomatis tercatat di audit log — akuntabilitas dua arah."*

---

## 🗣️ Talking Points Teknis (kalau juri bertanya)

- **Arsitektur 2-tahap**: model CV (dilatih terpisah, diakses via endpoint inference) mengekstrak fitur visual → Claude API sebagai "otak penalaran klinis" menggabungkan fitur + profil + gejala → JSON terstruktur ketat (schema-enforced, bukan parsing teks).
- **4 kategori tindakan**: SELF_CARE → OTC_MEDICATION → DOCTOR_CONSULT → EMERGENCY; 4 tingkat urgensi LOW→CRITICAL.
- **Aturan keselamatan klinis** (di system prompt & mock): larangan steroid tanpa resep, tidak menebak ukuran kacamata dari foto, batas segmen posterior (retina butuh funduskopi), protokol golden hour trauma kimia, **fail-safe**: bila AI gagal → otomatis naik ke CRITICAL (tidak pernah under-triage diam-diam).
- **Privasi**: pasien anonim tidak pernah membaca database langsung — verifikasi NIK+kode di Cloud Function; kode akses digenerate `crypto.randomBytes`, alfabet tanpa karakter ambigu (0/O/1/I) agar mudah dibacakan lisan.
- **Mode produksi**: tinggal isi `public/js/firebase-config.js` + `firebase functions:secrets:set ANTHROPIC_API_KEY` + `firebase deploy` — kontrak API demo dan produksi identik (lihat README §4).

---

## 🔧 Troubleshooting Cepat

| Gejala | Solusi |
|---|---|
| Port 5173 bentrok | Edit angka port di `start-demo.bat` (2 tempat) |
| Halaman tampil versi lama | `Ctrl+Shift+R` (hard refresh) sekali |
| Data pasien baru hilang | Wajar — refresh mengembalikan data demo awal; data seed (`OA-DEMO-2024`) selalu ada |
| Font berubah default saat offline | Load sekali dengan internet dulu (font ter-cache oleh service worker) |
| Tombol demo login tidak muncul | Pastikan `firebase-config.js` masih placeholder (mode demo aktif) |
