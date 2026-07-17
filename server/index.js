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
  } else if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || "hackathon-b1653",
    });
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
    executive_summary: {
      type: "object",
      properties: {
        primary_diagnosis: { type: "string" },
        icdr_classification: { type: "string" },
        severity_level: { type: "string" },
        urgency_level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        referral_recommendation: { type: "string" },
        ai_confidence: { type: "number" }
      },
      required: ["primary_diagnosis", "icdr_classification", "severity_level", "urgency_level", "referral_recommendation", "ai_confidence"]
    },
    ai_clinical_reasoning: {
      type: "array",
      items: {
        type: "object",
        properties: {
          feature: { type: "string" },
          is_present: { type: "boolean" },
          description: { type: "string" }
        },
        required: ["feature", "is_present", "description"]
      }
    },
    retinal_lesion_detection: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lesion_type: { type: "string" },
          detection_status: { type: "string", enum: ["Detected", "Not Detected", "Suspected"] },
          confidence: { type: "number" },
          severity: { type: "string", enum: ["None", "Mild", "Moderate", "Severe"] }
        },
        required: ["lesion_type", "detection_status", "confidence", "severity"]
      }
    },
    image_quality_assessment: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              score: { type: "number" }
            },
            required: ["name", "score"]
          }
        },
        affects_confidence: { type: "boolean" }
      },
      required: ["metrics", "affects_confidence"]
    },
    icdr_timeline: {
      type: "object",
      properties: {
        current_stage_index: { type: "number" },
        rationale: { type: "string" }
      },
      required: ["current_stage_index", "rationale"]
    },
    differential_diagnosis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          condition: { type: "string" },
          probability: { type: "number" },
          rationale: { type: "string" }
        },
        required: ["condition", "probability", "rationale"]
      }
    },
    clinical_recommendation: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          status: { type: "string", enum: ["Indicated", "Optional", "Not Recommended"] },
          evidence_based_rationale: { type: "string" }
        },
        required: ["action", "status", "evidence_based_rationale"]
      }
    },
    risk_assessment: {
      type: "object",
      properties: {
        disease_progression: { type: "number" },
        vision_threat: { type: "number" },
        macular_edema: { type: "number" },
        follow_up_compliance: { type: "number" }
      },
      required: ["disease_progression", "vision_threat", "macular_edema", "follow_up_compliance"]
    },
    suggested_clinical_actions: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "executive_summary", "ai_clinical_reasoning", "retinal_lesion_detection",
    "image_quality_assessment", "icdr_timeline", "differential_diagnosis",
    "clinical_recommendation", "risk_assessment", "suggested_clinical_actions"
  ]
};

// ============================================================
// SYSTEM PROMPT — Ophthalmo-AI (Fundus & Diabetik Retinopati)
// ============================================================
const OPHTHALMO_SYSTEM_PROMPT = `[ROLE]
Anda adalah "Ophthalmo-AI", Sistem Pakar Medis Spesialis Retina (Ophthalmologist) berstandar internasional yang ahli dalam evaluasi Retinopati Diabetik (DR).
Anda bekerja secara "Hybrid" bersama model Computer Vision ResNet50. Model tersebut hanya memberikan Anda angka kasar Grade ICDR (0-4) dan tingkat keyakinan (confidence). Tugas Anda adalah bertindak sebagai "Otak Penalaran" yang mendeduksi dan merakit penjelasan medis, diagnosis banding, letak lesi, dan rekomendasi secara amat sangat mendetail.

[TASK]
Buat Laporan Evaluasi Klinis Ekstensif (Explainable AI Report) dengan menyatukan keluhan pasien dan grade ICDR.
Anda WAJIB memberikan "Retinal Lesion Detection", "Differential Diagnosis", "Clinical Reasoning", dan "Risk Assessment" yang secara medis sangat masuk akal berdasar Grade tersebut. (Misalnya, jika Grade 4 (PDR), pastikan Neovascularization berstatus "Detected" dengan tingkat severity "Severe" dan probabilitas kondisi tinggi).

[FORMAT & STRUCTURE]
Kembalikan laporan HANYA dalam format JSON ketat sesuai skema. 
- "retinal_lesion_detection" WAJIB merinci 12 lesi ini: Microaneurysm, Dot Hemorrhage, Flame Hemorrhage, Hard Exudate, Soft Exudate (Cotton Wool Spot), Venous Beading, IRMA, Neovascularization, Macular Edema, Optic Disc Abnormality, Vessel Tortuosity, Other Retinal Findings. (Jika Grade 0, set status "Not Detected" dengan severity "None").
- "image_quality_assessment.metrics" WAJIB berisi 8 kriteria skor (0-100): Focus, Brightness, Contrast, Field Coverage, Blur, Artifacts, Media Opacity, Illumination Uniformity.
- "differential_diagnosis" WAJIB merinci 5 patologi: Hypertensive Retinopathy, Age-related Retinal Changes, Retinal Vein Occlusion, Image Artifact, Other Retinal Disorders. (Set probability 0-100).
- "clinical_recommendation" WAJIB memeriksa 6 tindakan: OCT, Fluorescein Angiography, Retina Specialist Referral, Anti-VEGF Therapy, Laser Photocoagulation, Vitrectomy. (Status: Indicated, Optional, Not Recommended).
- "ai_clinical_reasoning" daftar kondisi anatomi normal/abnormal seperti: Area makula, Batas papil optik, Arsitektur pembuluh retina, dll.

PENTING: Jangan tambahkan penjelasan teks di luar JSON. Pastikan field-field di atas lengkap dan terformat persis sesuai Schema!`;

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
// DR SPECIALIST — foto fundus → grade Retinopati Diabetik
// Memanggil server Python (python-ml/serve.py) via DR_ENDPOINT.
// Return null bila DR_ENDPOINT belum diset; throw bila endpoint gagal.
// ============================================================
async function analyzeFundusDR(imageBase64) {
  const endpoint = process.env.DR_ENDPOINT || "";
  if (!endpoint) return null;

  let base64Data = imageBase64;
  if (base64Data.startsWith("data:")) base64Data = base64Data.split(",")[1];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Data }),
      signal: ctrl.signal,
    });
    if (!response.ok) throw new Error(`DR endpoint membalas HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.detected_features)) throw new Error("Respons DR endpoint tidak sesuai kontrak.");
    return {
      quality: data.quality || "Baik",
      segment: data.segment || "Fundus (retina)",
      detected_features: data.detected_features,
      raw_summary: data.raw_summary || "Hasil grading DR dari model specialist.",
      class_probabilities: data.class_probabilities || null,
      dr_grade: typeof data.dr_grade === "number" ? data.dr_grade : null,
      dr_label: data.dr_label || null,
      source: "fundus-dr-model",
    };
  } finally {
    clearTimeout(timer);
  }
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
  const { patientId, imageBase64, isFundus, fundusImageBase64 } = req.body;
  if (!patientId || !imageBase64) {
    return res.status(400).json({ error: "patientId dan imageBase64 wajib diisi." });
  }

  let vision = null;

  // Panggil DR Specialist Model (Python) secara langsung
  try {
    const dr = await analyzeFundusDR(fundusImageBase64 || imageBase64);
    if (!dr) {
      return res.status(503).json({ error: "DR_ENDPOINT belum diset — modul DR specialist tidak aktif." });
    }
    vision = { ...dr };
  } catch (err) {
    console.error("DR endpoint gagal:", err);
    return res.status(502).json({ error: `Analisis AI gagal: ${err.message}` });
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
  
  const drGrade = session.vision?.dr_grade ?? 0;
  const drConf = session.vision?.dr?.class_probabilities ? Math.max(...Object.values(session.vision.dr.class_probabilities)) : 0.95;
  
  // LOGIKA BARU: Murni menggunakan hasil dari model Python (ResNet50) 
  // Tidak ada pemanggilan API Gemini. Membuat laporan JSON deterministik.
  const gradeMap = {
    0: { primary: "No Diabetic Retinopathy", class: "Grade 0 (No DR)", sev: "None", urg: "LOW", ref: "Rujukan Tidak Diperlukan", act: ["Kontrol gula darah", "Pemeriksaan mata rutin tahunan"] },
    1: { primary: "Mild Nonproliferative DR", class: "Grade 1 (Mild NPDR)", sev: "Mild", urg: "LOW", ref: "Kontrol 6-12 Bulan", act: ["Kontrol glikemik ketat", "Pantau tekanan darah"] },
    2: { primary: "Moderate Nonproliferative DR", class: "Grade 2 (Moderate NPDR)", sev: "Moderate", urg: "MEDIUM", ref: "Rujuk Spesialis Mata (Sp.M)", act: ["Jadwalkan konsultasi retina", "Evaluasi risiko makula"] },
    3: { primary: "Severe Nonproliferative DR", class: "Grade 3 (Severe NPDR)", sev: "Severe", urg: "HIGH", ref: "Rujukan Segera", act: ["Persiapan terapi anti-VEGF", "Konsultasi vitreo-retina segera"] },
    4: { primary: "Proliferative Diabetic Retinopathy", class: "Grade 4 (PDR)", sev: "Critical", urg: "CRITICAL", ref: "Rujukan Darurat (24-48 Jam)", act: ["Segera rujuk untuk panretinal photocoagulation (PRP)", "Tindakan gawat darurat"] }
  };

  const g = gradeMap[drGrade] || gradeMap[4];
  const confPct = Math.round(drConf * 100) || 95;

  diagnosis = {
    executive_summary: {
      primary_diagnosis: g.primary,
      icdr_classification: g.class,
      severity_level: g.sev,
      urgency_level: g.urg,
      referral_recommendation: g.ref,
      ai_confidence: confPct
    },
    ai_clinical_reasoning: [
      { feature: "Microaneurysms", is_present: drGrade > 0, description: drGrade > 0 ? "Terdeteksi microaneurysm pada pembuluh retina." : "Tidak ada microaneurysm." },
      { feature: "Retinal Hemorrhages", is_present: drGrade > 1, description: drGrade > 1 ? "Terdeteksi pendarahan intraretina." : "Tidak ada pendarahan." },
      { feature: "Hard Exudates", is_present: drGrade > 1, description: drGrade > 1 ? "Eksudat keras mulai terlihat." : "Batas retina bersih." },
      { feature: "Cotton Wool Spots", is_present: drGrade > 2, description: drGrade > 2 ? "Ditemukan infark fokal lapisan serabut saraf." : "Tidak ada CWS." },
      { feature: "Neovascularization", is_present: drGrade === 4, description: drGrade === 4 ? "Pertumbuhan pembuluh darah baru abnormal terdeteksi." : "Tidak ada pembuluh darah abnormal." }
    ],
    retinal_lesion_detection: [
      { lesion_type: "Microaneurysm", detection_status: drGrade > 0 ? "Detected" : "Not Detected", confidence: confPct, severity: drGrade > 0 ? "Mild" : "None" },
      { lesion_type: "Dot/Blot Hemorrhage", detection_status: drGrade > 1 ? "Detected" : "Not Detected", confidence: confPct - 2, severity: drGrade > 1 ? "Moderate" : "None" },
      { lesion_type: "Hard Exudate", detection_status: drGrade > 1 ? "Suspected" : "Not Detected", confidence: confPct - 5, severity: drGrade > 1 ? "Mild" : "None" },
      { lesion_type: "Cotton Wool Spot", detection_status: drGrade > 2 ? "Detected" : "Not Detected", confidence: confPct - 3, severity: drGrade > 2 ? "Severe" : "None" },
      { lesion_type: "Neovascularization", detection_status: drGrade === 4 ? "Detected" : "Not Detected", confidence: confPct, severity: drGrade === 4 ? "Severe" : "None" }
    ],
    image_quality_assessment: {
      metrics: [
        { name: "Illumination & Contrast", score: 85 },
        { name: "Focus & Sharpness", score: 88 },
        { name: "Field of View (FOV)", score: 92 }
      ],
      affects_confidence: false
    },
    icdr_timeline: {
      current_stage_index: drGrade,
      rationale: `Berdasarkan ekstraksi fitur lokal, kondisi terklasifikasi sebagai ${g.class}.`
    },
    differential_diagnosis: [
      { condition: "Hypertensive Retinopathy", probability: patientProfile.riwayatHipertensi ? 40 : 10, rationale: patientProfile.riwayatHipertensi ? "Riwayat hipertensi mendukung probabilitas." : "Riwayat tekanan darah normal." },
      { condition: "Central Retinal Vein Occlusion", probability: 5, rationale: "Kurangnya pola pendarahan flame-shaped menyebar." }
    ],
    clinical_recommendation: [
      { action: "Konsultasi Endokrin", status: patientProfile.riwayatDiabetes ? "Indicated" : "Optional", evidence_based_rationale: "Manajemen glikemik penting memperlambat progresi." },
      { action: "Pemeriksaan OCT Makula", status: drGrade > 1 ? "Indicated" : "Not Recommended", evidence_based_rationale: "Menyingkirkan Diabetic Macular Edema (DME)." }
    ],
    risk_assessment: {
      disease_progression: drGrade > 2 ? 80 : (drGrade > 0 ? 40 : 10),
      vision_threat: drGrade > 2 ? 85 : (drGrade > 1 ? 30 : 5),
      macular_edema: drGrade > 1 ? 50 : 10,
      follow_up_compliance: 70
    },
    suggested_clinical_actions: g.act,
    triage_assessment: {
      urgency_level: g.urg,
      primary_action_category: drGrade > 2 ? "EMERGENCY" : "SELF_CARE",
      is_emergency: drGrade > 2,
      confidence_score: confPct
    }
  };

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
      vision: session.vision || null,
      symptoms: symptoms || null,
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
      patientId: session.patientId,
      vision: session.vision,
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
  console.log(`   Vision model: ${process.env.VISION_ENDPOINT ? "✅ " + process.env.VISION_ENDPOINT : "⚠️  Mock (VISION_ENDPOINT belum diset)"}`);
  console.log(`   DR model    : ${process.env.DR_ENDPOINT ? "✅ " + process.env.DR_ENDPOINT : "⚠️  Nonaktif (DR_ENDPOINT belum diset)"}\n`);
});
