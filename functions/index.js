// ============================================================
// OPHTHALMO-AI — Cloud Functions
//
// Dua tahap inference, dipanggil dari aplikasi Nakes:
//
//  1. analyzeVision   — placeholder utk model Computer Vision (ML)
//                       yang mengekstrak fitur visual eksternal &
//                       lesi mikro-mata dari foto pasien. Dalam
//                       produksi, ganti bagian ini dengan panggilan
//                       ke endpoint model CV yang sesungguhnya
//                       (mis. hasil training di Google Colab yang
//                       di-deploy sbg REST API terpisah).
//
//  2. ophthalmoTriage — "Otak Penalaran Klinis": Claude API yang
//                       menyatukan profil pasien + gejala subjektif
//                       + hasil ML Vision menjadi triase klinis
//                       terstruktur, mengikuti persis system prompt
//                       & skema JSON yang didefinisikan di bawah.
//
//  3. patientAccess   — verifikasi NIK + kode akses utk portal
//                       pasien anonim.
//
// Konfigurasi rahasia (sekali saja):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

admin.initializeApp();
const db = admin.firestore();

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// URL endpoint model CV hasil training Colab (FastAPI /predict).
// Set via functions/.env → VISION_ENDPOINT=https://xxxx.ngrok-free.app/predict
// Bila kosong, analyzeVision memakai mock deterministik (fallback aman).
const visionEndpoint = defineString("VISION_ENDPOINT", { default: "" });

setGlobalOptions({ region: "asia-southeast2", maxInstances: 10 }); // Jakarta

// ---------- guard util ----------
function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Wajib login sebagai nakes/admin.");
}
function requireAdmin(request) {
  requireAuth(request);
  if (request.auth.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Hanya Super Admin yang boleh melakukan ini.");
  }
}

// ============================================================
// SKEMA JSON KETAT — persis mengikuti [OUTPUT SCHEMA] Ophthalmo-AI.
// Menggunakan output_config.format (structured outputs) sehingga
// Claude WAJIB mengembalikan JSON yang valid sesuai skema ini —
// tidak perlu parsing/regex yang rapuh.
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
      additionalProperties: false,
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
            additionalProperties: false,
          },
        },
        danger_signs_present: { type: "array", items: { type: "string" } },
      },
      required: ["synthesis_summary", "ml_vision_correlation", "possible_conditions", "danger_signs_present"],
      additionalProperties: false,
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
      additionalProperties: false,
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
          additionalProperties: false,
        },
      },
      required: ["patient_action_plan", "safe_otc_medication_advice", "doctor_referral_details"],
      additionalProperties: false,
    },
  },
  required: ["triage_assessment", "clinical_analysis", "emergency_care_protocol", "recommendations"],
  additionalProperties: false,
};

// ============================================================
// SYSTEM PROMPT — Ophthalmo-AI (persis seperti spesifikasi)
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
// 1. ML VISION — placeholder/mock endpoint
//
// Dalam produksi: ganti isi fungsi ini dengan panggilan HTTP ke
// endpoint model CV terpisah (mis. Flask/FastAPI yang meng-host
// model hasil training APTOS/dataset kustom di Colab atau cloud),
// yang mengembalikan fitur-fitur visual eksternal terdeteksi.
// ============================================================
exports.analyzeVision = onCall({ maxInstances: 10, timeoutSeconds: 90 }, async (request) => {
  requireAuth(request);
  const { patientId, imageBase64 } = request.data;
  if (!patientId || !imageBase64) {
    throw new HttpsError("invalid-argument", "patientId dan imageBase64 wajib diisi.");
  }

  let vision = null;

  // --- Jalur produksi: panggil endpoint model CV hasil training Colab ---
  const endpoint = visionEndpoint.value();
  if (endpoint) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64 }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Endpoint ML membalas HTTP ${res.status}`);
      const data = await res.json();
      // Kontrak minimal endpoint (lihat colab/README.md):
      // { quality, detected_features: [{feature, severity}], raw_summary, class_probabilities? }
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

  // --- Fallback: mock deterministik (endpoint belum diset / gagal) ---
  if (!vision) {
    const size = imageBase64.length;
    const roll = size % 100;
    const features = [
      { feature: "Hiperemia Konjungtiva", severity: Math.round((roll % 40) / 40 * 100) / 100 },
      { feature: "Kekeruhan Kornea", severity: Math.round(((roll >> 2) % 40) / 40 * 100) / 100 },
      { feature: "Edema Palpebra/Periorbital", severity: Math.round(((roll >> 4) % 30) / 30 * 100) / 100 },
      { feature: "Asimetri Pupil (Anisokoria)", severity: roll % 13 === 0 ? 1 : 0 },
      { feature: "Benda Asing Tampak pada Citra", severity: roll % 17 === 0 ? 1 : 0 },
    ];
    vision = {
      quality: roll % 9 === 0 ? "Kurang — refleksi cahaya/blur" : "Baik",
      segment: "Eksternal (kamera ponsel)",
      detected_features: features,
      raw_summary: `[MOCK ML VISION — endpoint belum diset] Fitur dievaluasi: ${features.map((f) => f.feature).join(", ")}.`,
      source: "mock-fallback",
    };
  }

  const sessionRef = await db.collection("screening_sessions").add({
    patientId, nakesUid: request.auth?.uid || null,
    status: "menunggu_gejala", vision, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("audit_logs").add({
    actor: request.auth?.token?.name || request.auth?.uid || "system", role: "nakes",
    action: "VISION_ANALYSIS", target: patientId, detail: vision.raw_summary,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: sessionRef.id, patientId, vision, status: "menunggu_gejala" };
});

// ============================================================
// 2. OPHTHALMO-AI — penalaran klinis final (Claude API)
// ============================================================
exports.ophthalmoTriage = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 120, maxInstances: 10 },
  async (request) => {
    requireAuth(request);
    const { sessionId, symptoms } = request.data;
    if (!sessionId || !symptoms) {
      throw new HttpsError("invalid-argument", "sessionId dan symptoms wajib diisi.");
    }

    const sessionSnap = await db.collection("screening_sessions").doc(sessionId).get();
    if (!sessionSnap.exists) throw new HttpsError("not-found", "Sesi triase tidak ditemukan.");
    const session = sessionSnap.data();

    const patientSnap = await db.collection("patients").doc(session.patientId).get();
    if (!patientSnap.exists) throw new HttpsError("not-found", "Pasien tidak ditemukan.");
    const patient = patientSnap.data();

    // Susun 3 blok input persis sesuai placeholder di system prompt.
    const patientProfile = {
      nama: patient.name, usia: patient.age, jenisKelamin: patient.gender === "L" ? "Laki-laki" : "Perempuan",
      riwayatDiabetes: !!patient.historyDiabetes, riwayatHipertensi: !!patient.historyHipertensi,
      penggunaLensaKontak: !!patient.pakaiLensaKontak,
      riwayatPenyakitMataSebelumnya: patient.riwayatMataSebelumnya || "Tidak ada",
    };

    let diagnosis;
    try {
      const client = new Anthropic({ apiKey: anthropicApiKey.value() });
      const response = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system: OPHTHALMO_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `--- DATA INPUT PASIEN ---\n` +
              `PROFIL PASIEN:\n${JSON.stringify(patientProfile, null, 2)}\n\n` +
              `KELUHAN & GEJALA SUBJEKTIF:\n${JSON.stringify(symptoms, null, 2)}\n\n` +
              `HASIL DETEKSI MIKRO-MATA DARI MACHINE LEARNING (VISION MODEL):\n${JSON.stringify(session.vision, null, 2)}\n` +
              `-------------------------`,
          },
        ],
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: OPHTHALMO_SCHEMA },
        },
      });

      if (response.stop_reason === "refusal") {
        throw new Error("Ophthalmo-AI menolak memproses permintaan ini.");
      }
      const textBlock = response.content.find((b) => b.type === "text");
      diagnosis = JSON.parse(textBlock.text);
    } catch (err) {
      console.error(`Ophthalmo-AI gagal untuk sesi ${sessionId}:`, err);
      // Fail-safe medis: bila AI gagal, naikkan otomatis ke EMERGENCY agar
      // tetap ditinjau tenaga medis — JANGAN pernah biarkan kegagalan
      // sistem berujung pada under-triage yang membahayakan pasien.
      diagnosis = {
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
          patient_action_plan: [], safe_otc_medication_advice: "Tidak dapat ditentukan — wajib evaluasi manual.",
          doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M)", examination_needed: "Evaluasi klinis lengkap secara manual" },
        },
      };
    }

    const code = generateAccessCode();
    await patientSnap.ref.update({ accessCode: code });
    await sessionSnap.ref.update({
      status: "final", symptoms, diagnosis, finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const recordRef = await db.collection("medical_records").add({
      patientId: session.patientId, sessionId, diagnosis,
      nakesUid: request.auth?.uid || null, puskesmas: request.auth?.token?.puskesmas || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("audit_logs").add({
      actor: request.auth?.token?.name || request.auth?.uid || "system", role: "nakes",
      action: "TRIASE_FINAL", target: `${patient.name} (${session.patientId})`,
      detail: `${diagnosis.triage_assessment.urgency_level} · ${diagnosis.triage_assessment.primary_action_category}`,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { diagnosis, accessCode: code, record: { id: recordRef.id, patientId: session.patientId, sessionId, diagnosis } };
  }
);

// ============================================================
// 3. AKSES PASIEN ANONIM — verifikasi NIK + kode akses
// ============================================================
exports.patientAccess = onCall({ maxInstances: 10 }, async (request) => {
  const { nik, code } = request.data;
  if (!nik || !code) throw new HttpsError("invalid-argument", "NIK dan kode akses wajib diisi.");

  const patientQuery = await db.collection("patients").where("nik", "==", nik).limit(1).get();

  if (patientQuery.empty || patientQuery.docs[0].data().accessCode?.toUpperCase() !== code.toUpperCase()) {
    await db.collection("audit_logs").add({
      actor: "ANONIM", role: "pasien", action: "AKSES_PASIEN",
      target: `NIK …${nik.slice(-4)}`, detail: "Verifikasi GAGAL",
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw new HttpsError("permission-denied", "NIK atau kode akses tidak cocok.");
  }

  const patientDoc = patientQuery.docs[0];
  const recordsSnap = await db.collection("medical_records")
    .where("patientId", "==", patientDoc.id).orderBy("createdAt", "desc").get();

  await db.collection("audit_logs").add({
    actor: "ANONIM", role: "pasien", action: "AKSES_PASIEN",
    target: `NIK …${nik.slice(-4)}`, detail: "Verifikasi berhasil",
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    patient: { id: patientDoc.id, ...patientDoc.data() },
    records: recordsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
});

// ============================================================
// 4. MANAJEMEN USER (khusus Super Admin)
// ============================================================

// Buat akun Nakes baru: Auth user + custom claims role + profil Firestore.
exports.createNakes = onCall({ maxInstances: 5 }, async (request) => {
  requireAdmin(request);
  const { name, email, puskesmas } = request.data;
  if (!name || !email || !puskesmas) {
    throw new HttpsError("invalid-argument", "name, email, dan puskesmas wajib diisi.");
  }

  const tempPassword = generateAccessCode().replace("OA-", "Pkm-"); // acak, wajib diganti user
  const userRecord = await admin.auth().createUser({ email, password: tempPassword, displayName: name });
  await admin.auth().setCustomUserClaims(userRecord.uid, { role: "nakes", name, puskesmas });
  await db.collection("users").doc(userRecord.uid).set({
    name, email, puskesmas, role: "nakes", active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("audit_logs").add({
    actor: request.auth.token.name || request.auth.uid, role: "admin",
    action: "KELOLA_USER", target: email, detail: "Tambah akun nakes",
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Password sementara dikembalikan SEKALI ke admin utk disampaikan ke nakes.
  return { uid: userRecord.uid, tempPassword };
});

// Aktif/nonaktifkan akun Nakes (menonaktifkan login Auth sekaligus).
exports.setNakesActive = onCall({ maxInstances: 5 }, async (request) => {
  requireAdmin(request);
  const { uid, active } = request.data;
  if (!uid || typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "uid dan active (boolean) wajib diisi.");
  }

  await admin.auth().updateUser(uid, { disabled: !active });
  await db.collection("users").doc(uid).set({ active }, { merge: true });

  await db.collection("audit_logs").add({
    actor: request.auth.token.name || request.auth.uid, role: "admin",
    action: "KELOLA_USER", target: uid, detail: active ? "Aktifkan akun" : "Nonaktifkan akun",
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

// ---------- util ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I
function generateAccessCode() {
  const crypto = require("crypto");
  const rand = crypto.randomBytes(8);
  const s = [...rand].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `OA-${s.slice(0, 4)}-${s.slice(4)}`;
}
