// ============================================================
// OPHTHALMO-AI — Express Server
//
// Pengganti Firebase Cloud Functions (free, deploy di Railway/Render).
// Mengekspos 5 endpoint REST:
//
//  POST /api/vision          — ML Vision (analyzeVision)
//  POST /api/triage          — Penalaran klinis Claude (ophthalmoTriage)
//  POST /api/patient         — Akses pasien anonim (patientAccess)
//  POST /api/users/create    — Buat akun Nakes baru (admin only)
//  POST /api/users/active    — Aktif/nonaktifkan Nakes (admin only)
//  GET  /health              — Health check (untuk Railway/Render)
//
// Setup:
//  1. cp .env.example .env  →  isi ANTHROPIC_API_KEY & FIREBASE_PROJECT_ID
//  2. Taruh serviceAccount.json (dari Firebase Console → Service accounts) di folder ini
//  3. npm install
//  4. npm start
//
// Deploy Railway:
//  railway login && railway init && railway up
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

// ---------- Load Jurnal Referensi Medis (PDF, TXT, MD) ----------
async function loadJournals() {
  const journalsDir = path.join(__dirname, "journals");
  if (!fs.existsSync(journalsDir)) return "";
  
  let combinedText = "";
  try {
    const files = fs.readdirSync(journalsDir);
    for (const file of files) {
      const filePath = path.join(journalsDir, file);
      const ext = path.extname(file).toLowerCase();
      
      if (ext === ".pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        try {
          const parsed = await pdf(dataBuffer);
          combinedText += `\n\n--- JURNAL REFERENSI: ${file} ---\n${parsed.text}`;
        } catch (pdfErr) {
          console.error(`Gagal membaca PDF ${file}:`, pdfErr);
        }
      } else if (ext === ".txt" || ext === ".md") {
        const text = fs.readFileSync(filePath, "utf8");
        combinedText += `\n\n--- REFERENSI: ${file} ---\n${text}`;
      }
    }
  } catch (err) {
    console.error("Gagal membaca folder journals:", err);
  }
  return combinedText;
}

// ---------- inisialisasi Firebase Admin ----------
// Coba serviceAccount.json dulu (lokal); fallback ke GOOGLE_APPLICATION_CREDENTIALS
// atau Application Default Credentials (otomatis di Railway/Google Cloud).
let serviceAccount = null;
const saPath = path.join(__dirname, "serviceAccount.json");
if (fs.existsSync(saPath)) {
  serviceAccount = require(saPath);
}

if (!admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    // Railway / Cloud Run: set env GOOGLE_APPLICATION_CREDENTIALS atau pakai ADC
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
}

const db = admin.firestore();

// ---------- Express setup ----------
const app = express();
app.use(express.json({ limit: "20mb" })); // base64 foto bisa besar
app.use(
  cors({
    origin: "*", // produksi: ganti dengan domain hosting Anda
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ---------- util ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I
function generateAccessCode() {
  const rand = crypto.randomBytes(8);
  const s = [...rand].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `OA-${s.slice(0, 4)}-${s.slice(4)}`;
}

// ---------- Auth middleware ----------
// Memverifikasi Firebase ID token yang dikirim dari frontend.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Wajib login sebagai nakes/admin." });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // { uid, email, role, name, puskesmas, ... }
    next();
  } catch {
    return res.status(401).json({ error: "Token tidak valid atau sudah kedaluwarsa." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Hanya Super Admin yang boleh melakukan ini." });
  }
  next();
}

// ============================================================
// SKEMA JSON KETAT — persis [OUTPUT SCHEMA] Ophthalmo-AI
// ============================================================
const OPHTHALMO_SCHEMA = {
  type: "object",
  properties: {
    triage_assessment: {
      type: "object",
      properties: {
        urgency_level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        primary_action_category: { type: "string", enum: ["SELF_CARE", "OTC_MEDICATION", "DOCTOR_CONSULT", "EMERGENCY"] },
        is_emergency: { type: "boolean" },
        confidence_score: { type: "number" },
      },
      required: ["urgency_level", "primary_action_category", "is_emergency", "confidence_score"],
      },
    clinical_analysis: {
      type: "object",
      properties: {
        synthesis_summary: { type: "string" },
        ml_vision_correlation: { type: "string" },
        possible_conditions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              condition_name: { type: "string" },
              probability: { type: "string", enum: ["Tinggi", "Sedang", "Rendah"] },
              rationale: { type: "string" },
            },
            required: ["condition_name", "probability", "rationale"],
            },
        },
        danger_signs_present: { type: "array", items: { type: "string" } },
      },
      required: ["synthesis_summary", "ml_vision_correlation", "possible_conditions", "danger_signs_present"],
      },
    emergency_care_protocol: {
      type: "object",
      properties: {
        requires_immediate_hospital: { type: "boolean" },
        golden_hour_timeframe: { type: "string" },
        immediate_first_aid_instructions: { type: "array", items: { type: "string" } },
        what_NOT_to_do: { type: "array", items: { type: "string" } },
      },
      required: ["requires_immediate_hospital", "golden_hour_timeframe", "immediate_first_aid_instructions", "what_NOT_to_do"],
      },
    recommendations: {
      type: "object",
      properties: {
        patient_action_plan: { type: "array", items: { type: "string" } },
        safe_otc_medication_advice: { type: "string" },
        doctor_referral_details: {
          type: "object",
          properties: {
            specialist_needed: { type: "string" },
            examination_needed: { type: "string" },
          },
          required: ["specialist_needed", "examination_needed"],
          },
      },
      required: ["patient_action_plan", "safe_otc_medication_advice", "doctor_referral_details"],
      },
  },
  required: ["triage_assessment", "clinical_analysis", "emergency_care_protocol", "recommendations"],
  };

// ============================================================
// SYSTEM PROMPT — Ophthalmo-AI (identik dengan functions/index.js)
// ============================================================
const OPHTHALMO_SYSTEM_PROMPT = `[ROLE]
Anda adalah "Ophthalmo-AI", sebuah Sistem Pakar Medis Spesialis Mata (Clinical Decision Support System / CDSS) berstandar internasional dan Dokter Spesialis Mata Senior (Sp.M) yang berpengalaman dalam triase kegawatdaruratan mata (Ophthalmic Emergency) dan pelayanan tele-oftalmologi untuk daerah pedesaan/terpencil.
Anda bekerja berdampingan dengan Model Machine Learning (Computer Vision) yang bertugas mengekstrak fitur visual eksternal dan lesi mikro-mata dari foto pasien. Tugas Anda adalah menjadi "Otak Penalaran Klinis" yang menyatukan data visual ML tersebut dengan keluhan subjektif pasien.

[TASK]
Lakukan analisis medis mendalam, holistik, dan komprehensif berdasarkan input kombinasi yang diberikan (PROFIL PASIEN, KELUHAN & GEJALA SUBJEKTIF, HASIL DETEKSI MIKRO-MATA DARI MACHINE LEARNING).

LANGKAH KERJA SISTEM PAKAR (TASK FLOW):
1. VALIDASI & KORELASI MULTIMODAL: Bandingkan probabilitas klasifikasi dari model ML dengan keluhan subjektif pasien. (Contoh: Jika ML mendeteksi hiperemia konjungtiva, tetapi pasien mengeluh nyeri kepala berdenyut hebat dan melihat lingkaran pelangi/halos, korelasi ini mengarah pada Glaukoma Akut, bukan sekadar mata merah biasa).
2. EVALUASI BAHAYA (EMERGENCY SCREENING): Periksa secara ketat apakah terdapat tanda-tanda kegawatdaruratan mata (Red Flags) yang berisiko kebutaan permanen.
3. KLASIFIKASI TINDAKAN (PRIMARY ACTION): Tentukan salah satu dari 4 kategori tindakan:
   - EMERGENCY: Kegawatdaruratan mata (Trauma kimia, glaukoma akut, ablasi retina, trauma penetrasi). Wajib tindakan IGD < 2 jam.
   - DOCTOR_CONSULT: Butuh pemeriksaan fisik langsung oleh Dokter Spesialis Mata / Optometris (Katarak, infeksi kornea, kelainan refraksi/butuh resep kacamata).
   - OTC_MEDICATION: Gejala iritasi/alergi ringan yang aman ditangani dengan obat bebas (tetes mata lubrikan/air mata buatan).
   - SELF_CARE: Kelelahan mata digital (Computer Vision Syndrome/Asthenopia), cukup istirahat aturan 20-20-20 dan kompres hangat/dingin.
4. GENERATE OUTPUT JSON: Kembalikan KETAT hanya format JSON baku sesuai skema, tanpa teks pembuka/penutup.

[LIMITATIONS & CLINICAL SAFETY RULES]
1. LARANGAN STEROID MANDIRI: DILARANG KERAS menyarankan atau meresepkan obat tetes mata golongan STEROID (seperti Dexamethasone, Betamethasone, Prednisolone) kepada pasien tanpa resep fisik dokter spesialis, karena risiko kebutaan akibat glaukoma steroid/ulserasi kornea.
2. BATASAN REFRAKSI KACAMATA: DILARANG menebak atau menerbitkan angka pasti ukuran resep kacamata (Spheris/Cylinder/Axis) hanya dari foto/wawancara. Jika pasien mengeluh buram, rekomendasikan pemeriksaan visus & refraksi fisik ke klinik/optik.
3. BATASAN SEGMEN BELAKANG MATA: Jika foto kamera HP hanya memperlihatkan segmen eksternal, jelaskan bahwa kondisi retina/saraf optik bagian dalam (misal Retinopati Diabetik/Degenerasi Makula) memerlukan pemeriksaan lanjut dengan Funduscope/Slit Lamp di fasilitas kesehatan.
4. PROTOKOL GOLDEN HOUR EMERGENCY: Jika terdeteksi kata kunci "Trauma Kimia / Terkena Cairan Pembersih / Pestisida / Asam / Basa", instruksi pertama pada 'immediate_first_aid_instructions' WAJIB memerintahkan irigasi/pembilasan mata dengan air bersih mengalir selama minimal 15-20 menit SEKARANG JUGA sebelum pasien dibawa ke RS.

Kembalikan HANYA JSON sesuai skema yang diberikan melalui structured output — jangan menambahkan teks lain di luar JSON.`;

// ============================================================
// MOCK ML VISION — identik dengan fallback di functions/index.js
// ============================================================
function mockVisionAnalysis(imageBase64) {
  const size = (imageBase64 || "").length;
  const roll = size % 100;
  const features = [
    { feature: "Hiperemia Konjungtiva",        severity: Math.round((roll % 40) / 40 * 100) / 100 },
    { feature: "Kekeruhan Kornea",              severity: Math.round(((roll >> 2) % 40) / 40 * 100) / 100 },
    { feature: "Edema Palpebra/Periorbital",    severity: Math.round(((roll >> 4) % 30) / 30 * 100) / 100 },
    { feature: "Asimetri Pupil (Anisokoria)",   severity: roll % 13 === 0 ? 1 : 0 },
    { feature: "Benda Asing Tampak pada Citra", severity: roll % 17 === 0 ? 1 : 0 },
  ];
  return {
    quality: roll % 9 === 0 ? "Kurang — refleksi cahaya/blur" : "Baik",
    segment: "Eksternal (kamera ponsel)",
    detected_features: features,
    raw_summary: `[MOCK ML VISION — endpoint belum diset] Fitur dievaluasi: ${features.map((f) => f.feature).join(", ")}.`,
    source: "mock-fallback",
  };
}

// ============================================================
// FAIL-SAFE DIAGNOSIS — dipakai bila Claude gagal
// ============================================================
const FAILSAFE_DIAGNOSIS = {
  triage_assessment: { urgency_level: "CRITICAL", primary_action_category: "EMERGENCY", is_emergency: true, confidence_score: 0 },
  clinical_analysis: {
    synthesis_summary: "Sistem AI gagal memproses triase. Kasus dinaikkan otomatis ke prioritas tertinggi (fail-safe) untuk ditinjau manual oleh tenaga medis.",
    ml_vision_correlation: "Tidak dapat dievaluasi — kegagalan sistem.",
    possible_conditions: [],
    danger_signs_present: ["Evaluasi AI gagal — wajib tinjauan manual segera"],
  },
  emergency_care_protocol: {
    requires_immediate_hospital: true, golden_hour_timeframe: "Segera",
    immediate_first_aid_instructions: ["Rujuk pasien untuk evaluasi manual oleh tenaga medis sesegera mungkin."],
    what_NOT_to_do: [],
  },
  recommendations: {
    patient_action_plan: [],
    safe_otc_medication_advice: "Tidak dapat ditentukan — wajib evaluasi manual.",
    doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M)", examination_needed: "Evaluasi klinis lengkap secara manual" },
  },
};

// ============================================================
// GET /health — Railway/Render health check
// ============================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ophthalmo-ai-server", ts: new Date().toISOString() });
});

// ============================================================
// POST /api/vision — ML Vision (analyzeVision)
// ============================================================
app.post("/api/vision", requireAuth, async (req, res) => {
  const { patientId, imageBase64 } = req.body;
  if (!patientId || !imageBase64) {
    return res.status(400).json({ error: "patientId dan imageBase64 wajib diisi." });
  }

  let vision = null;

  // Jalur produksi: panggil endpoint model CV hasil training Colab
  const endpoint = process.env.VISION_ENDPOINT || "";
  if (endpoint) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64 }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Endpoint ML membalas HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.detected_features)) throw new Error("Respons endpoint tidak sesuai kontrak.");
      vision = {
        quality: data.quality || "Baik",
        segment: data.segment || "Eksternal (kamera ponsel)",
        detected_features: data.detected_features,
        raw_summary: data.raw_summary || "Hasil ekstraksi fitur dari model CV.",
        class_probabilities: data.class_probabilities || null,
        source: "ml-endpoint",
      };
    } catch (err) {
      console.warn(`VISION_ENDPOINT gagal (${err.message}) — fallback ke mock.`);
      vision = null;
    }
  }

  // Fallback: Analisis gambar rill menggunakan Gemini Vision
  if (!vision) {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (apiKey) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        // Coba deteksi tipe mime atau set default ke jpeg
        let mimeType = "image/jpeg";
        let base64Data = imageBase64;
        if (imageBase64.startsWith("data:")) {
          const parts = imageBase64.split(",");
          mimeType = parts[0].match(/:(.*?);/)[1];
          base64Data = parts[1];
        }

        const prompt = "Anda adalah model ML Vision khusus mata. Analisis foto mata pasien ini. Deteksi fitur-fitur klinis yang tampak pada segmen eksternal. Kembalikan JSON dengan format ketat: { quality: string, segment: string, detected_features: [{ feature: string, severity: number (0-1)}], raw_summary: string }. Fokus mengevaluasi: Hiperemia Konjungtiva, Kekeruhan Kornea, Edema Palpebra, Asimetri Pupil, dan Benda Asing.\n\nLakukan ekstraksi fitur visual dari foto mata ini dan berikan respons HANYA dalam bentuk JSON yang valid.";
        const result = await model.generateContent({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { data: base64Data, mimeType } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        });
        
        const responseText = result.response.text();
        vision = JSON.parse(responseText);
        vision.source = "gemini-vision-real";
      } catch (err) {
        console.error("Gemini Vision gagal menganalisis gambar:", err);
        vision = mockVisionAnalysis(imageBase64);
      }
    } else {
      vision = mockVisionAnalysis(imageBase64);
    }
  }

  try {
    const sessionRef = await db.collection("screening_sessions").add({
      patientId,
      nakesUid: req.user.uid,
      status: "menunggu_gejala",
      vision,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("audit_logs").add({
      actor: req.user.name || req.user.uid,
      role: "nakes",
      action: "VISION_ANALYSIS",
      target: patientId,
      detail: vision.raw_summary,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: sessionRef.id, patientId, vision, status: "menunggu_gejala" });
  } catch (err) {
    console.error("vision /api/vision error:", err);
    res.status(500).json({ error: "Gagal menyimpan sesi analisis." });
  }
});

// ============================================================
// POST /api/triage — Penalaran klinis Claude (ophthalmoTriage)
// ============================================================
app.post("/api/triage", requireAuth, async (req, res) => {
  const { sessionId, symptoms } = req.body;
  if (!sessionId || !symptoms) {
    return res.status(400).json({ error: "sessionId dan symptoms wajib diisi." });
  }

  let sessionSnap, patientSnap;
  try {
    sessionSnap = await db.collection("screening_sessions").doc(sessionId).get();
    if (!sessionSnap.exists) return res.status(404).json({ error: "Sesi triase tidak ditemukan." });

    patientSnap = await db.collection("patients").doc(sessionSnap.data().patientId).get();
    if (!patientSnap.exists) return res.status(404).json({ error: "Pasien tidak ditemukan." });
  } catch (err) {
    console.error("triage fetch error:", err);
    return res.status(500).json({ error: "Gagal membaca data sesi/pasien." });
  }

  const session = sessionSnap.data();
  const patient = patientSnap.data();

  const patientProfile = {
    nama: patient.name,
    usia: patient.age,
    jenisKelamin: patient.gender === "L" ? "Laki-laki" : "Perempuan",
    riwayatDiabetes: !!patient.historyDiabetes,
    riwayatHipertensi: !!patient.historyHipertensi,
    penggunaLensaKontak: !!patient.pakaiLensaKontak,
    riwayatPenyakitMataSebelumnya: patient.riwayatMataSebelumnya || "Tidak ada",
  };

  let diagnosis;
  const apiKey = process.env.GEMINI_API_KEY || "";

  if (apiKey) {
    // --- Jalur produksi: Gemini API ---
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
      });

      const journalsContext = await loadJournals();

      const prompt = `${OPHTHALMO_SYSTEM_PROMPT}\n\n` +
        `--- JURNAL & PANDUAN PENGOBATAN REFERENSI (GROUND TRUTH) ---\n` +
        `${journalsContext || "Tidak ada file jurnal tambahan."}\n\n` +
        `--- DATA INPUT PASIEN ---\n` +
        `PROFIL PASIEN:\n${JSON.stringify(patientProfile, null, 2)}\n\n` +
        `KELUHAN & GEJALA SUBJEKTIF:\n${JSON.stringify(symptoms, null, 2)}\n\n` +
        `HASIL DETEKSI MIKRO-MATA DARI MACHINE LEARNING (VISION MODEL):\n${JSON.stringify(session.vision, null, 2)}\n` +
        `-------------------------`;

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: OPHTHALMO_SCHEMA,
        },
      });

      const responseText = result.response.text();
      diagnosis = JSON.parse(responseText);
    } catch (err) {
      console.error(`Ophthalmo-AI (Gemini) gagal untuk sesi ${sessionId}:`, err);
      // Fail-safe medis: bila AI gagal → CRITICAL/EMERGENCY otomatis
      diagnosis = FAILSAFE_DIAGNOSIS;
    }
  } else {
    // --- Mock mode (GEMINI_API_KEY belum diset) ---
    console.warn("GEMINI_API_KEY belum diset — menggunakan mock diagnosis.");
    diagnosis = {
      triage_assessment: {
        urgency_level: "HIGH",
        primary_action_category: "DOCTOR_CONSULT",
        is_emergency: false,
        confidence_score: 0.72,
      },
      clinical_analysis: {
        synthesis_summary: "[MOCK] Analisis klinis membutuhkan GEMINI_API_KEY yang valid. Set variable di file .env untuk mengaktifkan Gemini.",
        ml_vision_correlation: "Data ML Vision tersedia namun analisis Gemini belum aktif.",
        possible_conditions: [
          { condition_name: "Perlu evaluasi lebih lanjut", probability: "Sedang", rationale: "API key belum dikonfigurasi — hasil ini adalah mock." },
        ],
        danger_signs_present: [],
      },
      emergency_care_protocol: {
        requires_immediate_hospital: false,
        golden_hour_timeframe: "Tidak applicable",
        immediate_first_aid_instructions: ["Segera konfigurasi GEMINI_API_KEY untuk mendapatkan triase klinis sesungguhnya."],
        what_NOT_to_do: [],
      },
      recommendations: {
        patient_action_plan: ["Konsultasikan dengan dokter untuk evaluasi lebih lanjut"],
        safe_otc_medication_advice: "Tidak dapat ditentukan tanpa analisis AI aktif.",
        doctor_referral_details: { specialist_needed: "Dokter Umum / Sp.M", examination_needed: "Evaluasi klinis langsung" },
      },
    };
  }

  try {
    const code = generateAccessCode();
    await patientSnap.ref.update({ accessCode: code });
    await sessionSnap.ref.update({
      status: "final", symptoms, diagnosis,
      finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const recordRef = await db.collection("medical_records").add({
      patientId: session.patientId,
      sessionId,
      diagnosis,
      nakesUid: req.user.uid,
      puskesmas: req.user.puskesmas || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("audit_logs").add({
      actor: req.user.name || req.user.uid,
      role: "nakes",
      action: "TRIASE_FINAL",
      target: `${patient.name} (${session.patientId})`,
      detail: `${diagnosis.triage_assessment.urgency_level} · ${diagnosis.triage_assessment.primary_action_category}`,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      diagnosis,
      accessCode: code,
      record: { id: recordRef.id, patientId: session.patientId, sessionId, diagnosis },
    });
  } catch (err) {
    console.error("triage save error:", err);
    res.status(500).json({ error: "Gagal menyimpan hasil triase." });
  }
});

// ============================================================
// POST /api/patient — Akses pasien anonim (patientAccess)
// Tidak butuh auth token — verifikasi via NIK + kode akses
// ============================================================
app.post("/api/patient", async (req, res) => {
  const { nik, code } = req.body;
  if (!nik || !code) {
    return res.status(400).json({ error: "NIK dan kode akses wajib diisi." });
  }

  try {
    const patientQuery = await db.collection("patients")
      .where("nik", "==", nik).limit(1).get();

    const logBase = {
      actor: "ANONIM", role: "pasien", action: "AKSES_PASIEN",
      target: `NIK …${nik.slice(-4)}`,
      at: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (patientQuery.empty || patientQuery.docs[0].data().accessCode?.toUpperCase() !== code.toUpperCase()) {
      await db.collection("audit_logs").add({ ...logBase, detail: "Verifikasi GAGAL" });
      return res.status(403).json({ error: "NIK atau kode akses tidak cocok." });
    }

    const patientDoc = patientQuery.docs[0];
    const recordsSnap = await db.collection("medical_records")
      .where("patientId", "==", patientDoc.id)
      .orderBy("createdAt", "desc").get();

    await db.collection("audit_logs").add({ ...logBase, detail: "Verifikasi berhasil" });

    res.json({
      patient: { id: patientDoc.id, ...patientDoc.data() },
      records: recordsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    console.error("patientAccess error:", err);
    res.status(500).json({ error: "Gagal memverifikasi akses pasien." });
  }
});

// ============================================================
// POST /api/users/create — Buat akun Nakes baru (admin only)
// ============================================================
app.post("/api/users/create", requireAuth, requireAdmin, async (req, res) => {
  const { name, email, puskesmas } = req.body;
  if (!name || !email || !puskesmas) {
    return res.status(400).json({ error: "name, email, dan puskesmas wajib diisi." });
  }

  try {
    const tempPassword = generateAccessCode().replace("OA-", "Pkm-");
    const userRecord = await admin.auth().createUser({ email, password: tempPassword, displayName: name });
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: "nakes", name, puskesmas });
    await db.collection("users").doc(userRecord.uid).set({
      name, email, puskesmas, role: "nakes", active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("audit_logs").add({
      actor: req.user.name || req.user.uid, role: "admin",
      action: "KELOLA_USER", target: email, detail: "Tambah akun nakes",
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ uid: userRecord.uid, tempPassword });
  } catch (err) {
    console.error("createNakes error:", err);
    res.status(500).json({ error: err.message || "Gagal membuat akun nakes." });
  }
});

// ============================================================
// POST /api/users/active — Aktif/nonaktifkan Nakes (admin only)
// ============================================================
app.post("/api/users/active", requireAuth, requireAdmin, async (req, res) => {
  const { uid, active } = req.body;
  if (!uid || typeof active !== "boolean") {
    return res.status(400).json({ error: "uid dan active (boolean) wajib diisi." });
  }

  try {
    await admin.auth().updateUser(uid, { disabled: !active });
    await db.collection("users").doc(uid).set({ active }, { merge: true });

    await db.collection("audit_logs").add({
      actor: req.user.name || req.user.uid, role: "admin",
      action: "KELOLA_USER", target: uid,
      detail: active ? "Aktifkan akun" : "Nonaktifkan akun",
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("setNakesActive error:", err);
    res.status(500).json({ error: err.message || "Gagal mengubah status akun." });
  }
});

// ---------- 404 catch-all ----------
app.use((req, res) => {
  res.status(404).json({ error: `Endpoint ${req.method} ${req.path} tidak ditemukan.` });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Ophthalmo-AI Server berjalan di port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Mode Gemini : ${process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith("GANTI_") ? "✅ Aktif" : "⚠️  Mock (set GEMINI_API_KEY di .env)"}`);
  console.log(`   Vision model: ${process.env.VISION_ENDPOINT ? "✅ " + process.env.VISION_ENDPOINT : "⚠️  Mock (VISION_ENDPOINT belum diset)"}\n`);
});
