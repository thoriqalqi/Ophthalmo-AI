# colab/ — Training & Serving Model Vision

## Isi

- **`Ophthalmo_AI_Training.ipynb`** — notebook lengkap: unduh dataset via Kaggle API → training EfficientNetB0 (transfer learning + fine-tune) → evaluasi → simpan model → serving FastAPI `/predict` via ngrok.

## Cara Pakai

1. Buka [colab.research.google.com](https://colab.research.google.com) → *Upload* → pilih `Ophthalmo_AI_Training.ipynb`.
2. *Runtime → Change runtime type → **T4 GPU***.
3. Jalankan sel berurutan. Saat diminta:
   - upload **`kaggle.json`** (kaggle.com → Settings → API → *Create New Token*),
   - tempel **NGROK authtoken** (dashboard.ngrok.com).
4. Sel terakhir mencetak URL, contoh: `https://xxxx.ngrok-free.app/predict`.
5. Di project web, buat file **`functions/.env`**:
   ```
   VISION_ENDPOINT=https://xxxx.ngrok-free.app/predict
   ```
6. Deploy ulang: `firebase deploy --only functions`.

Selesai — Cloud Function `analyzeVision` otomatis memakai model Anda; bila endpoint mati/timeout, ia *fallback* ke mock (aplikasi tidak pernah error di depan pengguna).

## Kontrak Endpoint (WAJIB dipertahankan bila Anda menulis server sendiri)

```
POST /predict
Body    : { "image": "<base64 tanpa prefix data:>" }
Respons : {
  "quality": "Baik" | "Kurang — …",
  "segment": "Eksternal (kamera ponsel)",
  "detected_features": [ { "feature": "<nama fitur>", "severity": 0.0–1.0 }, … ],
  "class_probabilities": { "<kelas>": 0.0–1.0, … },   // opsional
  "raw_summary": "<ringkasan 1-2 kalimat utk Claude>"
}
```

## Catatan Dataset

- Default notebook: `gunavenkatdoddi/eye-diseases-classification` (4 kelas: cataract, diabetic_retinopathy, glaucoma, normal — citra fundus). Slug bisa diganti di sel Konfigurasi.
- Jika memakai dataset **APTOS 2019** (kompetisi): ganti sel unduh dengan
  `!kaggle competitions download -c aptos2019-blindness-detection` (wajib klik *Join Competition* dulu di Kaggle), dan sesuaikan pipeline label (CSV, bukan folder-per-kelas).
- Untuk kasus mata **eksternal** (hiperemia, benda asing, dsb.) gunakan dataset foto mata eksternal dan sesuaikan `CLASS_FEATURE_MAP` di sel Konfigurasi — sisanya tidak perlu diubah.

## Dari Demo ke Produksi Sesungguhnya

URL ngrok gratis berumur pendek (mati saat Colab ditutup). Untuk endpoint permanen:

1. Unduh `ophthalmo_vision.keras` + `labels.json` dari Colab.
2. Bungkus dgn FastAPI yang sama (salin sel 7 tanpa ngrok) + `Dockerfile` sederhana (python:3.11-slim, pip install tensorflow fastapi uvicorn pillow).
3. Deploy: `gcloud run deploy ophthalmo-vision --source . --region asia-southeast2 --allow-unauthenticated`
4. Isi `functions/.env` dengan URL Cloud Run → deploy ulang functions.
