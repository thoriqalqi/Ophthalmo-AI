# Ophthalmo-AI

Sistem Pakar Triase Kegawatdaruratan Mata & Rekam Medis Digital berbasis Clinical Decision Support System (CDSS), dipakai oleh Puskesmas untuk mendeteksi kondisi mata gawat darurat dari foto pasien + gejala klinis, menggunakan **ML Vision** (ekstraksi fitur visual) yang bekerja berdampingan dengan **Ophthalmo-AI** (Claude API — penalaran klinis final).

> 🎬 **Mau langsung demo?** Double-click **`start-demo.bat`**, lalu ikuti runbook [**DEMO.md**](DEMO.md) — skenario 5 menit lengkap dengan kredensial, foto mata contoh (`demo-assets/`), dan talking points untuk juri. Tanpa Firebase, tanpa API key.

## 1. Arsitektur

```
┌─ Nakes (login) ───────────────────────────────────────────────┐
│ 1) Registrasi/pilih pasien + upload foto mata                 │
│ 2) ML Vision (mock/placeholder) → ekstrak fitur visual         │
│ 3) Form gejala klinis subjektif                                │
│ 4) Ophthalmo-AI (Claude) → triase final (JSON ketat)           │
│ 5) Kode akses digenerate & disimpan ke rekam medis             │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
                Firestore: patients, screening_sessions,
                           medical_records, audit_logs
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌─ Pasien (anonim) ─┐  ┌─ Super Admin ────┐  ┌─ Audit trail ──────┐
│ NIK + kode akses  │  │ Statistik global │  │ Setiap aksi dicatat│
│ → lihat rekam medis│ │ Manajemen user   │  │ (login, triase,    │
│                    │ │ Arsip lengkap    │  │  akses pasien, dst)│
└────────────────────┘  └──────────────────┘  └────────────────────┘
```

**Frontend**: JavaScript vanilla + Firestore SDK (offline-capable), desain gelap-terang terinspirasi satyaxbt.xyz — lihat `public/`.
**Backend**: Firebase Cloud Functions (Node.js) — jembatan antara aplikasi, model ML Vision, dan Claude API.
**Model AI (di luar web app)**: model klasifikasi/deteksi fitur visual dilatih terpisah (mis. di Google Colab); untuk tahap ini diakses via endpoint placeholder/mock (`exports.analyzeVision` di `functions/index.js`) — ganti dengan panggilan HTTP ke endpoint model sesungguhnya saat sudah tersedia.

## 2. Alur Sistem

1. Nakes login → pilih/registrasi pasien → upload foto mata.
2. **ML Vision** menganalisis foto → mengekstrak fitur visual eksternal (hiperemia, kekeruhan kornea, asimetri pupil, dll.) — `analyzeVision`.
3. Nakes melengkapi form gejala klinis subjektif (durasi keluhan, nyeri, fotofobia, halo, riwayat trauma/kimia, dll.).
4. **Ophthalmo-AI** (Claude, `ophthalmoTriage`) menyatukan profil pasien + gejala + hasil ML Vision → mengeluarkan triase klinis terstruktur (skema JSON ketat, lihat §4).
5. Sistem generate **kode akses unik** & menyimpan seluruh hasil ke `medical_records`.
6. Nakes memberi tahu pasien NIK + kode tersebut (manual, lisan/kertas).
7. Pasien mengakses portal secara anonim → input NIK + kode → melihat rekam medisnya (`patientAccess`).
8. Super Admin memantau seluruh aktivitas via dashboard audit & log.

## 3. Struktur Database (Firestore)

| Koleksi | Isi |
|---|---|
| `users` | Akun Nakes & Super Admin: `{ name, email, role: "nakes"\|"admin", puskesmas, active }` |
| `patients` | Data pasien: `{ nik, name, age, gender, historyDiabetes, historyHipertensi, pakaiLensaKontak, riwayatMataSebelumnya, accessCode, createdBy, createdAt }` |
| `screening_sessions` | Sesi triase yang sedang berjalan: `{ patientId, nakesUid, status, vision, symptoms, diagnosis, createdAt }` — status: `menunggu_gejala` → `final` |
| `medical_records` | Hasil triase final (permanen): `{ patientId, sessionId, diagnosis, nakesUid, puskesmas, createdAt }` — `diagnosis` mengikuti skema JSON di §4 persis |
| `audit_logs` | Jejak audit seluruh sistem: `{ actor, role, action, target, detail, at }` |

**`patients.accessCode`** ditulis ulang setiap kali triase baru selesai (kode terbaru yang berlaku).

## 4. Kontrak Endpoint AI Inference

### Tahap 1 — `analyzeVision` (ML Vision, placeholder)

**Request:**
```json
{ "patientId": "p123", "imageBase64": "<base64 foto mata>" }
```

**Response:**
```json
{
  "id": "session_abc",
  "patientId": "p123",
  "status": "menunggu_gejala",
  "vision": {
    "quality": "Baik",
    "segment": "Eksternal (kamera ponsel)",
    "detected_features": [
      { "feature": "Hiperemia Konjungtiva", "severity": 0.62 },
      { "feature": "Kekeruhan Kornea", "severity": 0.10 },
      { "feature": "Edema Palpebra/Periorbital", "severity": 0.05 },
      { "feature": "Asimetri Pupil (Anisokoria)", "severity": 0 },
      { "feature": "Benda Asing Tampak pada Citra", "severity": 0 }
    ],
    "raw_summary": "..."
  }
}
```

> **Produksi**: ganti isi `exports.analyzeVision` di `functions/index.js` dengan panggilan HTTP ke endpoint model CV sesungguhnya (mis. Flask/FastAPI yang meng-host model hasil training).

### Tahap 2 — `ophthalmoTriage` (Claude API — penalaran klinis final)

**Request:**
```json
{
  "sessionId": "session_abc",
  "symptoms": {
    "mataTerdampak": "Kanan",
    "durasiKeluhan": "3 jam",
    "tingkatNyeri": "Nyeri hebat",
    "penurunanVisus": "Tidak ada",
    "fotofobia": "Ya",
    "melihatHalo": "Ya",
    "floatersKilatan": "Tidak",
    "sakitKepalaMual": "Ya",
    "bendaAsing": "Tidak",
    "riwayatTrauma": ""
  }
}
```

**Response** (`diagnosis` — persis skema `[OUTPUT SCHEMA]` Ophthalmo-AI):
```json
{
  "diagnosis": {
    "triage_assessment": {
      "urgency_level": "CRITICAL",
      "primary_action_category": "EMERGENCY",
      "is_emergency": true,
      "confidence_score": 0.87
    },
    "clinical_analysis": {
      "synthesis_summary": "...",
      "ml_vision_correlation": "...",
      "possible_conditions": [
        { "condition_name": "Glaukoma Akut Sudut Tertutup", "probability": "Tinggi", "rationale": "..." }
      ],
      "danger_signs_present": ["Nyeri mata hebat mendadak", "Halo di sekitar cahaya"]
    },
    "emergency_care_protocol": {
      "requires_immediate_hospital": true,
      "golden_hour_timeframe": "Segera (< 2 Jam)",
      "immediate_first_aid_instructions": ["..."],
      "what_NOT_to_do": ["..."]
    },
    "recommendations": {
      "patient_action_plan": ["..."],
      "safe_otc_medication_advice": "Tidak disarankan — wajib rujukan segera.",
      "doctor_referral_details": { "specialist_needed": "Dokter Spesialis Mata (Sp.M)", "examination_needed": "Tonometri, Gonioskopi" }
    }
  },
  "accessCode": "OA-4F2K-9XQP",
  "record": { "id": "rec_xyz", "patientId": "p123", "sessionId": "session_abc" }
}
```

Implementasi lengkap (system prompt Claude + `output_config.format` JSON Schema ketat) ada di [`functions/index.js`](functions/index.js).

### Portal Pasien — `patientAccess`

**Request:** `{ "nik": "3201014455660001", "code": "OA-4F2K-9XQP" }`
**Response:** `{ "patient": {...}, "records": [{...}, ...] }` — atau error `permission-denied` bila tidak cocok.

## 5. Aturan Keselamatan Klinis (dijalankan di system prompt & mesin mock)

1. **Larangan steroid mandiri** — tidak pernah menyarankan tetes mata golongan steroid tanpa resep dokter.
2. **Batasan refraksi kacamata** — tidak pernah menerbitkan angka pasti ukuran lensa dari foto/wawancara; selalu arahkan ke pemeriksaan refraksi fisik.
3. **Batasan segmen posterior** — foto kamera ponsel hanya mencakup segmen eksternal; kondisi retina/saraf optik selalu diarahkan ke Funduskopi/Slit Lamp.
4. **Protokol Golden Hour trauma kimia** — kata kunci kimia/asam/basa/pestisida/pembersih memicu instruksi irigasi 15–20 menit sebagai langkah pertama WAJIB, sebelum instruksi lain.
5. **Fail-safe kegagalan sistem** — bila panggilan Claude gagal/menolak, kasus otomatis dinaikkan ke `CRITICAL`/`EMERGENCY` agar tetap ditinjau manusia (tidak pernah under-triage secara diam-diam).

## 6. Kode Akses Pasien

Digenerate dengan `crypto.getRandomValues`/`crypto.randomBytes` (bukan `Math.random`), menggunakan alfabet 32 karakter yang membuang karakter ambigu (`0/O`, `1/I`) agar mudah dibacakan lisan oleh nakes: format `OA-XXXX-XXXX` (2×64 kombinasi/blok, total ruang kombinasi ~1 miliar). Kode ditulis ulang ke `patients.accessCode` setiap triase baru — kode lama otomatis tidak berlaku.

## 7. Privasi & Kontrol Akses

- **Akses pasien anonim WAJIB divalidasi via Cloud Function** (`patientAccess`) — pasien tidak pernah membaca koleksi `patients`/`medical_records` langsung dari klien; kombinasi NIK + kode diverifikasi server-side sebelum data dikembalikan.
- **`firestore.rules`** membatasi baca/tulis koleksi sensitif (`medical_records`, `audit_logs`) hanya untuk pengguna ter-autentikasi (nakes/admin); tulis rekam medis & audit log hanya lewat Admin SDK di Cloud Function.
- **Setiap akses arsip oleh Super Admin tercatat di `audit_logs`** (siapa membuka rekam medis siapa, kapan).
- Untuk produksi: aktifkan Firebase Auth custom claims (`role: "nakes"|"admin"`) dan perketat rules per-puskesmas.

## 8. Setup Produksi Lengkap (Full System)

Urutan dari nol sampai live — kerjakan berurutan:

### 8.1 Firebase (database + backend)

1. **Buat project** di [console.firebase.google.com](https://console.firebase.google.com) → upgrade ke **Blaze plan** (wajib utk Cloud Functions v2 + egress ke Claude API & endpoint ML).
2. Aktifkan **Firestore** (mode production, lokasi `asia-southeast2`).
3. Aktifkan **Authentication → Sign-in method → Email/Password**.
4. *Project Settings → Your apps → Web app* → salin config ke [`public/js/firebase-config.js`](public/js/firebase-config.js). (Begitu `apiKey` bukan placeholder lagi, mode demo otomatis nonaktif.)
5. Login CLI & pilih project:
   ```sh
   npm install -g firebase-tools
   firebase login
   firebase use <project-id-anda>
   ```
6. **Set API key Claude** (diminta interaktif, tidak tersimpan di kode):
   ```sh
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
7. Deploy semuanya (rules, indexes, hosting, functions):
   ```sh
   cd functions && npm install && cd ..
   firebase deploy
   ```

### 8.2 Akun pertama (Super Admin + Nakes)

Akun harus punya **custom claims `role`** (dipakai firestore.rules & Functions) — dibuat via script sekali-jalan:

1. *Project Settings → Service accounts → Generate new private key* → simpan sebagai `scripts/serviceAccount.json` (**jangan pernah dibagikan/di-commit**).
2. ```sh
   cd scripts && npm install && node seed-users.js
   ```
3. Login sebagai admin → ganti password → tambah akun nakes lain langsung dari dashboard **Manajemen User** (sistem membuat Auth user + claims otomatis dan menampilkan password sementara sekali).

### 8.3 Model AI (Google Colab)

1. Buka [`colab/Ophthalmo_AI_Training.ipynb`](colab/Ophthalmo_AI_Training.ipynb) di Google Colab (runtime **T4 GPU**).
2. Siapkan: **kaggle.json** (API token Kaggle) + **ngrok authtoken**.
3. Jalankan semua sel → training → sel serving mencetak URL endpoint.
4. Buat **`functions/.env`**:
   ```
   VISION_ENDPOINT=https://xxxx.ngrok-free.app/predict
   ```
5. `firebase deploy --only functions` — selesai; `analyzeVision` kini memanggil model Anda (dengan fallback mock otomatis bila endpoint mati).

Detail kontrak endpoint & jalur produksi permanen (Cloud Run): [`colab/README.md`](colab/README.md).

### 8.4 Verifikasi

- Buka URL hosting → login nakes → jalankan satu triase penuh → cek dokumen muncul di Firestore (`patients`, `screening_sessions`, `medical_records`, `audit_logs`).
- Portal pasien: NIK + kode dari triase tadi → hasil tampil.
- Dashboard admin → Audit Log terisi.

## 9. Mode Demo (tanpa setup)

Selama `firebase-config.js` masih placeholder, aplikasi otomatis berjalan di **mode demo** — seluruh alur (login, upload, ML Vision, Ophthalmo-AI, portal pasien, audit) berjalan dengan mesin penalaran mock in-memory yang mengimplementasikan aturan keselamatan yang sama seperti system prompt Claude di produksi. Login cepat tersedia di halaman `#/login`.

## 10. Struktur Navigasi

**Nakes**: Dashboard → Triase Baru (upload → ML Vision → gejala → Ophthalmo-AI) → Rekam Medis Pasien → (Profil, akan datang)
**Super Admin**: Dashboard → Audit Log → Manajemen User → Arsip Rekam Medis
**Pasien (anonim)**: Portal Cek Rekam Medis (NIK + kode) → Hasil (read-only)
