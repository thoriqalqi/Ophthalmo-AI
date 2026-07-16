// ============================================================
// STORE — lapisan data OPHTHALMO-AI
//
// Dua mode:
//  • MODE FIREBASE : Firestore + Auth + Cloud Functions (produksi)
//  • MODE DEMO     : data in-memory + mesin penalaran mock yang
//                    mengimplementasikan aturan keselamatan klinis
//                    yang sama dengan system prompt Claude di
//                    functions/index.js — aktif otomatis bila
//                    firebase-config.js masih placeholder.
// ============================================================

import { firebaseConfig, BACKEND_URL } from "./firebase-config.js";

// ---------- kosakata skema Ophthalmo-AI ----------
export const URGENCY = {
  LOW:      { label: "Rendah",  badge: "ringan" },
  MEDIUM:   { label: "Sedang",  badge: "sedang" },
  HIGH:     { label: "Tinggi",  badge: "kritis" },
  CRITICAL: { label: "Kritis",  badge: "kritis" },
};

export const ACTIONS = {
  SELF_CARE:      { label: "Perawatan Mandiri",  badge: "neutral" },
  OTC_MEDICATION: { label: "Obat Bebas (OTC)",   badge: "ringan" },
  DOCTOR_CONSULT: { label: "Konsultasi Dokter",  badge: "sedang" },
  EMERGENCY:      { label: "Kegawatdaruratan",   badge: "kritis" },
};

export const PROB_BADGE = { Tinggi: "kritis", Sedang: "sedang", Rendah: "ringan" };

export const SYMPTOM_QUESTIONS = [
  { id: "mataTerdampak",  label: "Mata yang terdampak", type: "select", options: ["Kanan", "Kiri", "Keduanya"] },
  { id: "durasiKeluhan",  label: "Sejak kapan keluhan dirasakan?", type: "text", placeholder: "cth. 3 jam, 2 hari, 1 minggu" },
  { id: "tingkatNyeri",   label: "Tingkat nyeri mata", type: "select", options: ["Tidak nyeri", "Nyeri ringan", "Nyeri sedang", "Nyeri hebat"] },
  { id: "penurunanVisus", label: "Perubahan penglihatan", type: "select", options: ["Tidak ada", "Buram perlahan (bertahap)", "Buram mendadak", "Hilang penglihatan total"] },
  { id: "fotofobia",      label: "Sensitif terhadap cahaya (fotofobia)?", type: "select", options: ["Tidak", "Ya"] },
  { id: "melihatHalo",    label: "Melihat lingkaran pelangi/halo di sekitar cahaya?", type: "select", options: ["Tidak", "Ya"] },
  { id: "floatersKilatan",label: "Ada floaters (bintik melayang) atau kilatan cahaya baru?", type: "select", options: ["Tidak", "Ya"] },
  { id: "sakitKepalaMual",label: "Disertai sakit kepala berdenyut dan/atau mual muntah?", type: "select", options: ["Tidak", "Ya"] },
  { id: "bendaAsing",     label: "Ada benda asing/tajam yang menancap di mata?", type: "select", options: ["Tidak", "Ya — ada benda menancap"] },
  { id: "riwayatTrauma",  label: "Riwayat trauma / terkena cairan (kosongkan jika tidak ada)", type: "text", placeholder: "cth. Terkena cairan pembersih 10 menit lalu" },
];

export const isDemo = firebaseConfig.apiKey.startsWith("GANTI");
// Backend siap bila BACKEND_URL sudah diisi (bukan placeholder)
export const isBackendReady = !BACKEND_URL.startsWith("GANTI");

// ---------- util ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I — hindari salah baca
export function generateAccessCode() {
  const rand = new Uint8Array(8);
  crypto.getRandomValues(rand);
  const s = [...rand].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `OA-${s.slice(0, 4)}-${s.slice(4)}`;
}

const uid = () => "id-" + Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

// ============================================================
// MESIN PENALARAN MOCK — meniru Ophthalmo-AI (lihat
// functions/index.js utk system prompt Claude yang sesungguhnya)
// ============================================================

function hashOf(str = "", n = 0) {
  let h = n;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Tahap ML Vision (placeholder) — dalam produksi ini endpoint CV terpisah
// yang mengekstrak fitur visual eksternal dari foto. Di sini disimulasikan
// deterministik dari nama+ukuran file agar demo konsisten & reproducible.
function mockVisionAnalysis(file) {
  const h = hashOf(file?.name, file?.size);
  const sev = (offset) => Math.round(((h >> offset) % 100) / 100 * 100) / 100;
  const features = [
    { feature: "Hiperemia Konjungtiva",        severity: sev(0) },
    { feature: "Kekeruhan Kornea",              severity: sev(4) },
    { feature: "Edema Palpebra/Periorbital",    severity: sev(8) },
    { feature: "Asimetri Pupil (Anisokoria)",   severity: sev(12) < 0.15 ? 1 : 0 },
    { feature: "Benda Asing Tampak pada Citra", severity: sev(16) < 0.08 ? 1 : 0 },
  ];
  const dominant = features.reduce((a, b) => (b.severity > a.severity ? b : a));
  return {
    quality: sev(20) < 0.12 ? "Kurang — refleksi cahaya/blur" : "Baik",
    segment: "Eksternal (kamera ponsel)",
    detected_features: features,
    raw_summary:
      `Kualitas citra: ${sev(20) < 0.12 ? "kurang optimal" : "baik"}. Fitur paling menonjol: ` +
      `${dominant.feature} (skor ${dominant.severity.toFixed(2)}). Foto menampilkan segmen mata eksternal saja.`,
  };
}

const CHEMICAL_RX = /kimia|asam|basa|pestisida|pembersih|semprotan|cairan|deterjen|soda\s*api|kaustik/i;
const SHARP_RX = /tertusuk|tertancap|menancap|paku|pecahan\s*kaca|besi|kawat|serpihan/i;

// Tahap penalaran klinis (menyatukan profil + gejala + hasil vision).
// Ini mengimplementasikan aturan keselamatan yang SAMA dengan system
// prompt Claude di functions/index.js — lihat README bagian "Aturan
// Keselamatan Klinis" untuk daftar lengkap.
function mockOphthalmoAI(patient, symptoms, vision) {
  const vf = (name) => vision.detected_features.find((f) => f.feature === name)?.severity ?? 0;
  const hiperemia = vf("Hiperemia Konjungtiva");
  const kekeruhan = vf("Kekeruhan Kornea");
  const pupilAsimetri = vf("Asimetri Pupil (Anisokoria)") >= 1;
  const bendaAsingCitra = vf("Benda Asing Tampak pada Citra") >= 1;

  const traumaKimia = CHEMICAL_RX.test(symptoms.riwayatTrauma || "");
  const traumaTajam = SHARP_RX.test(symptoms.riwayatTrauma || "") || symptoms.bendaAsing?.startsWith("Ya");
  const halo = symptoms.melihatHalo === "Ya";
  const sakitKepalaMual = symptoms.sakitKepalaMual === "Ya";
  const nyeriBerat = symptoms.tingkatNyeri === "Nyeri hebat";
  const nyeriSedangKeatas = nyeriBerat || symptoms.tingkatNyeri === "Nyeri sedang";
  const fotofobia = symptoms.fotofobia === "Ya";
  const visusMendadak = symptoms.penurunanVisus === "Buram mendadak" || symptoms.penurunanVisus === "Hilang penglihatan total";
  const visusHilangTotal = symptoms.penurunanVisus === "Hilang penglihatan total";
  const floatersKilatan = symptoms.floatersKilatan === "Ya";
  const visusPerlahan = symptoms.penurunanVisus === "Buram perlahan (bertahap)";

  const base = {
    patientName: patient.name,
    mataTerdampak: symptoms.mataTerdampak || "tidak ditentukan",
  };

  // ---------- 1. TRAUMA KIMIA — protokol golden hour wajib ----------
  if (traumaKimia) {
    return {
      triage_assessment: { urgency_level: "CRITICAL", primary_action_category: "EMERGENCY", is_emergency: true, confidence_score: 0.94 },
      clinical_analysis: {
        synthesis_summary:
          `Pasien ${base.patientName} melaporkan riwayat terpapar bahan kimia/cairan pada mata ${base.mataTerdampak} ` +
          `("${symptoms.riwayatTrauma}"). Ini adalah kegawatdaruratan mata absolut — kerusakan kornea akibat zat kimia ` +
          `(terutama basa/alkali) dapat berkembang progresif dalam hitungan menit dan berisiko kebutaan permanen bila irigasi tertunda.`,
        ml_vision_correlation:
          `Hasil ML Vision (${vision.raw_summary}) bersifat sekunder pada kasus ini — riwayat paparan kimia yang eksplisit ` +
          `SELALU didahulukan di atas temuan visual, karena kerusakan jaringan akibat kimia dapat belum tampak jelas secara ` +
          `visual pada menit-menit awal namun tetap progresif merusak.`,
        possible_conditions: [
          { condition_name: "Trauma Kimia Okular (Chemical Eye Injury)", probability: "Tinggi", rationale: "Riwayat eksplisit terpapar cairan/bahan kimia pada mata." },
        ],
        danger_signs_present: ["Riwayat paparan bahan kimia pada mata", "Risiko kerusakan kornea progresif"],
      },
      emergency_care_protocol: {
        requires_immediate_hospital: true,
        golden_hour_timeframe: "SEKARANG JUGA — sebelum dan selama menuju RS",
        immediate_first_aid_instructions: [
          "IRIGASI SEGERA: bilas mata dengan air bersih mengalir (air keran/air mineral) selama MINIMAL 15–20 menit TANPA HENTI, mulai detik ini juga — sebelum melakukan hal lain.",
          "Buka kelopak mata selebar mungkin dengan jari bersih saat membilas agar air mengenai seluruh permukaan mata.",
          "Lepas lensa kontak jika digunakan, di sela-sela proses irigasi.",
          "Setelah irigasi minimal 15–20 menit, segera bawa ke IGD terdekat dengan membawa label/kemasan bahan kimia bila ada.",
        ],
        what_NOT_to_do: [
          "Jangan menunda irigasi untuk mencari obat tetes mata apa pun.",
          "Jangan mengucek atau menekan mata.",
          "Jangan menutup mata dengan perban sebelum irigasi tuntas.",
          "Jangan mencoba menetralisir asam dengan basa atau sebaliknya.",
        ],
      },
      recommendations: {
        patient_action_plan: ["Lanjutkan irigasi selama perjalanan ke RS bila memungkinkan", "Bawa informasi bahan kimia penyebab ke IGD"],
        safe_otc_medication_advice: "Tidak disarankan — WAJIB penanganan IGD, jangan menunda dengan obat tetes apa pun termasuk air mata buatan.",
        doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) — IGD", examination_needed: "Pemeriksaan pH mata, Slit Lamp, tajam penglihatan, debridemen bila perlu" },
      },
    };
  }

  // ---------- 2. TRAUMA TAJAM / BENDA MENANCAP ----------
  if (traumaTajam) {
    return {
      triage_assessment: { urgency_level: "CRITICAL", primary_action_category: "EMERGENCY", is_emergency: true, confidence_score: 0.9 },
      clinical_analysis: {
        synthesis_summary:
          `Terindikasi kemungkinan trauma penetrasi/benda asing tertanam pada mata ${base.mataTerdampak}. ` +
          `Kondisi ini berisiko tinggi terhadap perforasi bola mata dan kehilangan penglihatan permanen bila ditangani tidak tepat.`,
        ml_vision_correlation: bendaAsingCitra
          ? "ML Vision turut mendeteksi kemungkinan benda asing pada citra — konsisten dengan laporan klinis, memperkuat urgensi."
          : "ML Vision tidak secara jelas menampilkan benda asing pada foto eksternal, namun laporan klinis pasien tetap menjadi dasar utama keputusan — foto tunggal tidak dapat menyingkirkan trauma penetrasi.",
        possible_conditions: [
          { condition_name: "Trauma Penetrasi Okular / Benda Asing Intraokular (Open Globe Injury)", probability: "Tinggi", rationale: "Riwayat benda tajam/menancap pada mata." },
        ],
        danger_signs_present: ["Dugaan benda asing menancap / trauma tajam", "Risiko ruptur bola mata"],
      },
      emergency_care_protocol: {
        requires_immediate_hospital: true,
        golden_hour_timeframe: "Segera (< 1 Jam)",
        immediate_first_aid_instructions: [
          "Tutup mata dengan pelindung KAKU (misal gelas plastik/karton yang dilubangi tengahnya) tanpa menekan bola mata, JANGAN gunakan kain/kasa yang menempel langsung.",
          "Jaga pasien tetap tenang dan minimalkan gerakan kepala.",
          "Segera bawa ke IGD dengan mata tertutup pelindung tersebut.",
        ],
        what_NOT_to_do: [
          "JANGAN mencabut benda yang menancap.",
          "JANGAN menekan atau mengucek bola mata.",
          "JANGAN memberikan obat tetes mata apa pun.",
          "JANGAN memberi makan/minum pasien (antisipasi kebutuhan anestesi/operasi).",
        ],
      },
      recommendations: {
        patient_action_plan: ["Puasakan pasien sambil menunggu evaluasi IGD"],
        safe_otc_medication_advice: "Tidak disarankan — dilarang keras memberikan obat tetes apa pun sebelum evaluasi dokter spesialis mata.",
        doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) — IGD/Bedah Mata", examination_needed: "Pencitraan CT orbita, evaluasi bedah eksplorasi" },
      },
    };
  }

  // ---------- 3. KECURIGAAN ABLASIO RETINA ----------
  if (visusHilangTotal || (visusMendadak && floatersKilatan)) {
    return {
      triage_assessment: { urgency_level: "CRITICAL", primary_action_category: "EMERGENCY", is_emergency: true, confidence_score: 0.83 },
      clinical_analysis: {
        synthesis_summary:
          `Kombinasi penurunan visus mendadak dengan floaters/kilatan cahaya baru pada mata ${base.mataTerdampak} sangat ` +
          `mengarah pada ablasio retina (retinal detachment) — kegawatdaruratan yang butuh evaluasi segmen posterior segera.`,
        ml_vision_correlation:
          "ML Vision hanya menganalisis segmen eksternal mata dan TIDAK dapat menilai kondisi retina/segmen posterior. " +
          "Kecurigaan ablasio retina murni berdasarkan gejala klinis — funduskopi langsung wajib dilakukan.",
        possible_conditions: [
          { condition_name: "Ablasio Retina (Retinal Detachment)", probability: "Tinggi", rationale: "Penurunan visus mendadak disertai floaters/kilatan cahaya baru." },
          { condition_name: "Perdarahan Vitreus (Vitreous Hemorrhage)", probability: "Sedang", rationale: "Dapat menimbulkan gejala serupa floaters mendadak dan penurunan visus." },
        ],
        danger_signs_present: ["Penurunan visus mendadak", "Floaters/kilatan cahaya baru", "Kemungkinan tirai gelap pada lapang pandang"],
      },
      emergency_care_protocol: {
        requires_immediate_hospital: true,
        golden_hour_timeframe: "< 24 Jam",
        immediate_first_aid_instructions: [
          "Batasi gerakan kepala mendadak dan hindari aktivitas fisik berat.",
          "Segera rujuk ke IGD mata atau spesialis vitreoretina dalam 24 jam.",
        ],
        what_NOT_to_do: ["Jangan menunda rujukan menunggu gejala membaik sendiri.", "Jangan mengucek mata."],
      },
      recommendations: {
        patient_action_plan: ["Hindari mengangkat beban berat / gerakan kepala tiba-tiba sebelum evaluasi spesialis"],
        safe_otc_medication_advice: "Tidak disarankan — wajib evaluasi spesialis mata segera, obat tetes tidak akan menangani penyebab.",
        doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) — Vitreoretina", examination_needed: "Funduskopi dilatasi, USG B-scan bila media keruh" },
      },
    };
  }

  // ---------- 4. KECURIGAAN GLAUKOMA AKUT SUDUT TERTUTUP ----------
  if (halo && sakitKepalaMual && nyeriSedangKeatas) {
    return {
      triage_assessment: { urgency_level: "CRITICAL", primary_action_category: "EMERGENCY", is_emergency: true, confidence_score: 0.87 },
      clinical_analysis: {
        synthesis_summary:
          `Kombinasi mata merah, nyeri hebat, sakit kepala berdenyut, mual, dan melihat halo/lingkaran pelangi di sekitar cahaya ` +
          `pada pasien ${base.patientName} SANGAT KHAS untuk Glaukoma Akut Sudut Tertutup — kegawatdaruratan mata yang dapat ` +
          `menyebabkan kebutaan permanen dalam hitungan jam bila tekanan intraokular tidak segera diturunkan.`,
        ml_vision_correlation:
          `ML Vision mendeteksi hiperemia konjungtiva (skor ${hiperemia.toFixed(2)}), yang sekilas tampak seperti mata merah biasa. ` +
          `Namun korelasi dengan gejala nyeri kepala berdenyut dan halo mengubah interpretasi klinis menjadi kecurigaan kuat ` +
          `Glaukoma Akut, BUKAN konjungtivitis — pola ini tidak boleh disamakan dengan mata merah akibat iritasi/alergi biasa.`,
        possible_conditions: [
          { condition_name: "Glaukoma Akut Sudut Tertutup (Acute Angle-Closure Glaucoma)", probability: "Tinggi", rationale: "Nyeri hebat + halo + sakit kepala/mual + mata merah — pola klasik peningkatan TIO akut." },
          { condition_name: "Uveitis Anterior Akut", probability: "Rendah", rationale: "Dapat menimbulkan nyeri dan fotofobia namun jarang disertai halo & sakit kepala hebat." },
        ],
        danger_signs_present: ["Nyeri mata hebat mendadak", "Halo di sekitar cahaya", "Sakit kepala berdenyut disertai mual", pupilAsimetri ? "Asimetri pupil terdeteksi pada citra" : null].filter(Boolean),
      },
      emergency_care_protocol: {
        requires_immediate_hospital: true,
        golden_hour_timeframe: "Segera (< 2 Jam)",
        immediate_first_aid_instructions: [
          "Segera bawa pasien ke IGD/dokter spesialis mata terdekat — penurunan tekanan bola mata harus dilakukan oleh tenaga medis.",
          "Posisikan pasien berbaring terlentang sambil menunggu rujukan, hindari ruangan gelap total (dapat memperburuk sudut tertutup).",
        ],
        what_NOT_to_do: [
          "DILARANG memberikan obat tetes mata steroid maupun tetes mata lain tanpa resep dokter.",
          "Jangan menunda rujukan untuk mengobservasi 'siapa tahu membaik sendiri'.",
        ],
      },
      recommendations: {
        patient_action_plan: ["Catat waktu tepat mulai gejala untuk informasi dokter IGD"],
        safe_otc_medication_advice: "Tidak disarankan — DILARANG memberikan tetes mata steroid atau obat tetes lain tanpa resep dokter spesialis; wajib rujukan segera.",
        doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) — IGD", examination_needed: "Tonometri (pengukuran TIO), Gonioskopi, Slit Lamp" },
      },
    };
  }

  // ---------- 5. KECURIGAAN KERATITIS / ULKUS KORNEA ----------
  if (kekeruhan >= 0.55 && fotofobia && nyeriSedangKeatas) {
    const urgent = kekeruhan >= 0.8 || nyeriBerat;
    return {
      triage_assessment: {
        urgency_level: urgent ? "HIGH" : "MEDIUM",
        primary_action_category: "DOCTOR_CONSULT",
        is_emergency: false,
        confidence_score: 0.78,
      },
      clinical_analysis: {
        synthesis_summary:
          `Ditemukan kekeruhan kornea (skor ${kekeruhan.toFixed(2)}) disertai nyeri dan fotofobia pada mata ${base.mataTerdampak}, ` +
          `mengarah pada kecurigaan keratitis/infeksi kornea${patient.pakaiLensaKontak ? " — riwayat penggunaan lensa kontak menjadi faktor risiko penting" : ""}. ` +
          `Kondisi ini butuh pemeriksaan Slit Lamp langsung untuk memastikan ada tidaknya ulkus dan menentukan terapi antimikroba yang tepat.`,
        ml_vision_correlation: "Temuan ML Vision (kekeruhan kornea) konsisten dengan gejala klinis nyeri dan fotofobia — memperkuat kecurigaan keratitis, namun kultur/pewarnaan fluorescein tetap diperlukan untuk konfirmasi.",
        possible_conditions: [
          { condition_name: "Keratitis / Ulkus Kornea (Corneal Ulcer)", probability: "Tinggi", rationale: "Kekeruhan kornea + nyeri + fotofobia" + (patient.pakaiLensaKontak ? " + riwayat lensa kontak" : "") + "." },
        ],
        danger_signs_present: urgent ? ["Kekeruhan kornea signifikan — risiko perforasi bila terlambat ditangani"] : [],
      },
      emergency_care_protocol: {
        requires_immediate_hospital: urgent,
        golden_hour_timeframe: urgent ? "< 24 Jam" : "Tidak applicable",
        immediate_first_aid_instructions: urgent ? ["Segera ke dokter spesialis mata dalam 24 jam — jangan ditunda.", "Hentikan pemakaian lensa kontak sama sekali."] : [],
        what_NOT_to_do: [
          "DILARANG memberikan obat tetes steroid tanpa resep dokter — risiko memperparah infeksi/ulkus.",
          "Jangan memakai lensa kontak sampai dinyatakan sembuh oleh dokter.",
        ],
      },
      recommendations: {
        patient_action_plan: ["Hentikan pemakaian lensa kontak", "Hindari mengucek mata", "Segera periksa ke dokter spesialis mata"],
        safe_otc_medication_advice: "Tidak disarankan menunggu — wajib ke dokter untuk terapi antimikroba/antibiotik tetes sesuai penyebab; jangan menggunakan obat tetes sisa/lama.",
        doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M)", examination_needed: "Slit Lamp, pewarnaan Fluorescein, kultur kornea bila dicurigai infeksi berat" },
      },
    };
  }

  // ---------- 6. BURAM PERLAHAN TANPA RED FLAG — kecurigaan katarak/refraksi ----------
  if (visusPerlahan && !nyeriSedangKeatas && !fotofobia && !halo) {
    return {
      triage_assessment: { urgency_level: "MEDIUM", primary_action_category: "DOCTOR_CONSULT", is_emergency: false, confidence_score: 0.72 },
      clinical_analysis: {
        synthesis_summary:
          `Pasien melaporkan penglihatan buram yang memburuk secara bertahap tanpa nyeri, mata merah, maupun fotofobia. ` +
          `Pola ini umum ditemukan pada katarak (terutama pada pasien usia ${patient.age} tahun) atau kelainan refraksi murni. ` +
          `Diperlukan pemeriksaan tajam penglihatan dan refraksi fisik untuk memastikan penyebab pasti — sistem ini TIDAK dapat ` +
          `menentukan ukuran kacamata dari foto/wawancara.`,
        ml_vision_correlation: "ML Vision menganalisis segmen eksternal saja; kekeruhan lensa (katarak) dan kelainan refraksi tidak sepenuhnya dapat dinilai dari foto eksternal — perlu Slit Lamp dan tes refraksi langsung.",
        possible_conditions: [
          { condition_name: "Katarak (Cataract)", probability: patient.age >= 50 ? "Sedang" : "Rendah", rationale: `Buram bertahap tanpa nyeri, usia pasien ${patient.age} tahun.` },
          { condition_name: "Kelainan Refraksi (Refractive Error)", probability: "Sedang", rationale: "Buram bertahap tanpa tanda inflamasi/infeksi." },
        ],
        danger_signs_present: [],
      },
      emergency_care_protocol: { requires_immediate_hospital: false, golden_hour_timeframe: "Tidak applicable", immediate_first_aid_instructions: [], what_NOT_to_do: ["Jangan membeli kacamata jadi tanpa pemeriksaan refraksi resmi."] },
      recommendations: {
        patient_action_plan: ["Jadwalkan pemeriksaan tajam penglihatan & refraksi ke klinik/optik dalam waktu dekat", "Gunakan pencahayaan cukup saat beraktivitas untuk sementara"],
        safe_otc_medication_advice: "Tidak diperlukan obat tetes — keluhan ini bersifat refraksi/lensa, bukan iritasi.",
        doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) atau Optometris", examination_needed: "Tes Refraksi & Visus, Slit Lamp untuk evaluasi kejernihan lensa" },
      },
    };
  }

  // ---------- 7. IRITASI/ALERGI RINGAN — OTC ----------
  if (hiperemia >= 0.3 && !nyeriSedangKeatas && !fotofobia) {
    return {
      triage_assessment: { urgency_level: "LOW", primary_action_category: "OTC_MEDICATION", is_emergency: false, confidence_score: 0.8 },
      clinical_analysis: {
        synthesis_summary:
          `Ditemukan kemerahan ringan pada konjungtiva mata ${base.mataTerdampak} tanpa nyeri hebat maupun fotofobia — pola ini ` +
          `konsisten dengan iritasi ringan atau konjungtivitis alergi/viral ringan, aman ditangani dengan perawatan mandiri dan obat bebas.`,
        ml_vision_correlation: `ML Vision mendeteksi hiperemia konjungtiva ringan-sedang (skor ${hiperemia.toFixed(2)}) tanpa tanda kekeruhan kornea maupun asimetri pupil — konsisten dengan gejala subjektif yang ringan.`,
        possible_conditions: [
          { condition_name: "Konjungtivitis Alergi/Iritatif (Allergic/Irritant Conjunctivitis)", probability: "Sedang", rationale: "Kemerahan ringan tanpa nyeri/fotofobia signifikan." },
        ],
        danger_signs_present: [],
      },
      emergency_care_protocol: { requires_immediate_hospital: false, golden_hour_timeframe: "Tidak applicable", immediate_first_aid_instructions: [], what_NOT_to_do: ["Jangan mengucek mata.", "Jangan menggunakan obat tetes steroid tanpa resep dokter."] },
      recommendations: {
        patient_action_plan: ["Kompres dingin beberapa kali sehari", "Hindari memicu alergi (debu, asap, dsb.)", "Jaga kebersihan tangan sebelum menyentuh area mata"],
        safe_otc_medication_advice: "Air mata buatan (artificial tears) tanpa pengawet dapat digunakan untuk kenyamanan. Bila tersedia dan tanpa riwayat alergi obat, tetes mata antihistamin OTC dapat membantu bila penyebab alergi. Hindari tetes mata golongan steroid tanpa resep.",
        doctor_referral_details: { specialist_needed: "Dokter Umum / Dokter Spesialis Mata bila tidak membaik dalam 3–5 hari", examination_needed: "Evaluasi ulang bila gejala memburuk atau tidak membaik" },
      },
    };
  }

  // ---------- 8. DEFAULT — kelelahan mata digital / tanpa temuan berarti ----------
  return {
    triage_assessment: { urgency_level: "LOW", primary_action_category: "SELF_CARE", is_emergency: false, confidence_score: 0.75 },
    clinical_analysis: {
      synthesis_summary:
        `Tidak ditemukan tanda bahaya (red flag) yang signifikan pada citra maupun gejala subjektif pasien ${base.patientName}. ` +
        `Pola keluhan konsisten dengan kelelahan mata digital (Computer Vision Syndrome/Asthenopia) atau mata kering ringan.`,
      ml_vision_correlation: "ML Vision tidak mendeteksi kelainan signifikan pada segmen eksternal mata.",
      possible_conditions: [
        { condition_name: "Kelelahan Mata Digital / Astenopia (Computer Vision Syndrome)", probability: "Sedang", rationale: "Tidak ada red flag, gejala ringan dan tidak spesifik." },
      ],
      danger_signs_present: [],
    },
    emergency_care_protocol: { requires_immediate_hospital: false, golden_hour_timeframe: "Tidak applicable", immediate_first_aid_instructions: [], what_NOT_to_do: [] },
    recommendations: {
      patient_action_plan: ["Terapkan aturan 20-20-20: setiap 20 menit, lihat objek sejauh 20 kaki (~6 meter) selama 20 detik", "Kompres hangat/dingin sesuai kenyamanan", "Istirahat cukup dan kurangi waktu layar berlebih"],
      safe_otc_medication_advice: "Air mata buatan (artificial tears) tanpa pengawet dapat digunakan bila mata terasa kering.",
      doctor_referral_details: { specialist_needed: "Tidak diperlukan saat ini", examination_needed: "Periksa ke dokter bila keluhan menetap lebih dari 1–2 minggu" },
    },
  };
}

// ============================================================
// MODE DEMO — data contoh
// ============================================================
const demo = {
  users: [
    { uid: "u-nakes1", email: "nakes@demo.id",  pass: "demo123", name: "Ns. Dewi Lestari",   role: "nakes", puskesmas: "Puskesmas Cempaka", active: true },
    { uid: "u-nakes2", email: "nakes2@demo.id", pass: "demo123", name: "dr. Bima Prasetyo",  role: "nakes", puskesmas: "Puskesmas Melati",  active: true },
    { uid: "u-admin",  email: "admin@demo.id",  pass: "demo123", name: "Admin Dinkes",       role: "admin", puskesmas: "-",                  active: true },
  ],
  patients: [
    { id: "p1", nik: "3201014455660001", name: "Sumarni",      age: 58, gender: "P", historyHipertensi: true,  historyDiabetes: false, pakaiLensaKontak: false, accessCode: "OA-DEMO-2024", createdBy: "u-nakes1", createdAt: "2026-07-10T02:10:00Z" },
    { id: "p2", nik: "3201014455660002", name: "Hendra Wijaya",age: 46, gender: "L", historyHipertensi: false, historyDiabetes: false, pakaiLensaKontak: false, accessCode: "OA-DEMO-4646", createdBy: "u-nakes1", createdAt: "2026-07-12T03:30:00Z" },
    { id: "p3", nik: "3201014455660003", name: "Rukmini",      age: 63, gender: "P", historyHipertensi: true,  historyDiabetes: true,  pakaiLensaKontak: false, accessCode: "OA-DEMO-6363", createdBy: "u-nakes2", createdAt: "2026-07-14T01:05:00Z" },
    { id: "p4", nik: "3201014455660004", name: "Slamet Riyadi",age: 34, gender: "L", historyHipertensi: false, historyDiabetes: false, pakaiLensaKontak: false, accessCode: "OA-DEMO-3434", createdBy: "u-nakes2", createdAt: "2026-07-15T05:20:00Z" },
  ],
  records: [
    {
      id: "r1", patientId: "p1", sessionId: "s-old1", nakesUid: "u-nakes1", puskesmas: "Puskesmas Cempaka", createdAt: "2026-07-10T02:35:00Z",
      diagnosis: {
        triage_assessment: { urgency_level: "CRITICAL", primary_action_category: "EMERGENCY", is_emergency: true, confidence_score: 0.89 },
        clinical_analysis: {
          synthesis_summary: "Mata merah disertai nyeri hebat, sakit kepala berdenyut, mual, dan melihat halo di sekitar cahaya. Pola klasik peningkatan tekanan intraokular akut.",
          ml_vision_correlation: "ML Vision mendeteksi hiperemia konjungtiva; dikombinasikan dengan gejala nyeri kepala dan halo, mengarah pada Glaukoma Akut, bukan mata merah biasa.",
          possible_conditions: [{ condition_name: "Glaukoma Akut Sudut Tertutup (Acute Angle-Closure Glaucoma)", probability: "Tinggi", rationale: "Nyeri hebat + halo + sakit kepala/mual + mata merah." }],
          danger_signs_present: ["Nyeri mata hebat mendadak", "Halo di sekitar cahaya", "Sakit kepala berdenyut disertai mual"],
        },
        emergency_care_protocol: {
          requires_immediate_hospital: true, golden_hour_timeframe: "Segera (< 2 Jam)",
          immediate_first_aid_instructions: ["Segera bawa ke IGD/dokter spesialis mata terdekat.", "Posisikan pasien berbaring terlentang sambil menunggu rujukan."],
          what_NOT_to_do: ["DILARANG memberikan obat tetes steroid tanpa resep dokter.", "Jangan menunda rujukan."],
        },
        recommendations: {
          patient_action_plan: ["Catat waktu tepat mulai gejala untuk informasi dokter IGD"],
          safe_otc_medication_advice: "Tidak disarankan — DILARANG memberikan tetes steroid; wajib rujukan segera.",
          doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) — IGD", examination_needed: "Tonometri (TIO), Gonioskopi, Slit Lamp" },
        },
      },
    },
    {
      id: "r2", patientId: "p2", sessionId: "s-old2", nakesUid: "u-nakes1", puskesmas: "Puskesmas Cempaka", createdAt: "2026-07-12T03:55:00Z",
      diagnosis: {
        triage_assessment: { urgency_level: "LOW", primary_action_category: "OTC_MEDICATION", is_emergency: false, confidence_score: 0.81 },
        clinical_analysis: {
          synthesis_summary: "Kemerahan ringan pada konjungtiva tanpa nyeri hebat maupun fotofobia — konsisten dengan konjungtivitis alergi ringan.",
          ml_vision_correlation: "ML Vision mendeteksi hiperemia konjungtiva ringan tanpa kekeruhan kornea — konsisten dengan gejala subjektif ringan.",
          possible_conditions: [{ condition_name: "Konjungtivitis Alergi/Iritatif", probability: "Sedang", rationale: "Kemerahan ringan tanpa nyeri/fotofobia." }],
          danger_signs_present: [],
        },
        emergency_care_protocol: { requires_immediate_hospital: false, golden_hour_timeframe: "Tidak applicable", immediate_first_aid_instructions: [], what_NOT_to_do: ["Jangan menggunakan obat tetes steroid tanpa resep dokter."] },
        recommendations: {
          patient_action_plan: ["Kompres dingin beberapa kali sehari", "Hindari pemicu alergi"],
          safe_otc_medication_advice: "Air mata buatan (artificial tears) tanpa pengawet.",
          doctor_referral_details: { specialist_needed: "Dokter Umum bila tidak membaik 3–5 hari", examination_needed: "Evaluasi ulang bila memburuk" },
        },
      },
    },
    {
      id: "r3", patientId: "p3", sessionId: "s-old3", nakesUid: "u-nakes2", puskesmas: "Puskesmas Melati", createdAt: "2026-07-14T01:40:00Z",
      diagnosis: {
        triage_assessment: { urgency_level: "MEDIUM", primary_action_category: "DOCTOR_CONSULT", is_emergency: false, confidence_score: 0.74 },
        clinical_analysis: {
          synthesis_summary: "Penglihatan buram bertahap tanpa nyeri maupun mata merah pada pasien usia 63 tahun — mengarah pada kecurigaan katarak atau kelainan refraksi.",
          ml_vision_correlation: "ML Vision menganalisis segmen eksternal saja; kekeruhan lensa tidak dapat dinilai penuh dari foto eksternal.",
          possible_conditions: [{ condition_name: "Katarak (Cataract)", probability: "Sedang", rationale: "Buram bertahap, usia 63 tahun." }],
          danger_signs_present: [],
        },
        emergency_care_protocol: { requires_immediate_hospital: false, golden_hour_timeframe: "Tidak applicable", immediate_first_aid_instructions: [], what_NOT_to_do: ["Jangan membeli kacamata jadi tanpa pemeriksaan refraksi resmi."] },
        recommendations: {
          patient_action_plan: ["Jadwalkan pemeriksaan refraksi & visus"],
          safe_otc_medication_advice: "Tidak diperlukan obat tetes.",
          doctor_referral_details: { specialist_needed: "Dokter Spesialis Mata (Sp.M) atau Optometris", examination_needed: "Tes Refraksi & Visus, Slit Lamp" },
        },
      },
    },
  ],
  sessions: [],
  audit: [
    { id: "a1", actor: "Ns. Dewi Lestari", role: "nakes", action: "TRIASE_FINAL", target: "Sumarni (p1)", detail: "CRITICAL · EMERGENCY · confidence 0.89", at: "2026-07-10T02:35:00Z" },
    { id: "a2", actor: "ANONIM",           role: "pasien", action: "AKSES_PASIEN",  target: "NIK …0001", detail: "Verifikasi NIK + kode berhasil", at: "2026-07-11T09:12:00Z" },
    { id: "a3", actor: "dr. Bima Prasetyo", role: "nakes", action: "TRIASE_FINAL", target: "Rukmini (p3)", detail: "MEDIUM · DOCTOR_CONSULT · confidence 0.74", at: "2026-07-14T01:40:00Z" },
    { id: "a4", actor: "Admin Dinkes",     role: "admin", action: "LIHAT_ARSIP",   target: "p3", detail: "Akses arsip rekam medis", at: "2026-07-15T04:00:00Z" },
  ],
};

// ============================================================
// SESI LOGIN (demo: sessionStorage)
// ============================================================
let _session = null;
try { _session = JSON.parse(sessionStorage.getItem("oa_session") || "null"); } catch {}

export function currentUser() { return _session; }

function setSession(u) {
  _session = u;
  if (u) sessionStorage.setItem("oa_session", JSON.stringify(u));
  else sessionStorage.removeItem("oa_session");
}

// -- Firebase imports dimuat malas hanya bila bukan demo --
let fb = null;
async function firebase() {
  if (fb) return fb;
  const appMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const app = appMod.initializeApp(firebaseConfig);
  fb = {
    db: fsMod.getFirestore(app),
    auth: authMod.getAuth(app),
    fsMod, authMod,
  };
  return fb;
}

// -- Helper: panggil Express backend dengan Firebase ID token --
async function callBackend(path, body = {}) {
  const { auth } = await firebase();
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BACKEND_URL + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

async function auditDemo(action, target, detail) {
  demo.audit.unshift({
    id: uid(),
    actor: _session ? _session.name : "ANONIM",
    role: _session ? _session.role : "pasien",
    action, target, detail, at: now(),
  });
}

// ============================================================
// API PUBLIK STORE
// ============================================================
export const store = {
  // ---------- AUTH ----------
  async login(email, pass) {
    if (isDemo) {
      const u = demo.users.find((x) => x.email === email && x.pass === pass && x.active);
      if (!u) throw new Error("Email atau kata sandi salah.");
      setSession({ uid: u.uid, name: u.name, role: u.role, puskesmas: u.puskesmas, email: u.email });
      auditDemo("LOGIN", u.email, `Login sebagai ${u.role}`);
      return _session;
    }
    const { auth, db, fsMod, authMod } = await firebase();
    const cred = await authMod.signInWithEmailAndPassword(auth, email, pass);
    const prof = await fsMod.getDoc(fsMod.doc(db, "users", cred.user.uid));
    if (!prof.exists() || !prof.data().active) throw new Error("Akun tidak aktif.");
    setSession({ uid: cred.user.uid, ...prof.data() });
    return _session;
  },

  async demoLoginAs(role) {
    if (!isDemo) throw new Error("Hanya tersedia di mode demo.");
    const u = demo.users.find((x) => x.role === role);
    return this.login(u.email, u.pass);
  },

  async logout() {
    if (!isDemo) { const { auth, authMod } = await firebase(); await authMod.signOut(auth); }
    setSession(null);
  },

  // ---------- PASIEN ----------
  async findPatientByNIK(nik) {
    if (isDemo) return demo.patients.find((p) => p.nik === nik) || null;
    const { db, fsMod } = await firebase();
    const q = fsMod.query(fsMod.collection(db, "patients"), fsMod.where("nik", "==", nik), fsMod.limit(1));
    const snap = await fsMod.getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async createPatient(data) {
    if (isDemo) {
      const p = { id: uid(), ...data, accessCode: null, createdBy: _session.uid, createdAt: now() };
      demo.patients.unshift(p);
      auditDemo("REGISTRASI_PASIEN", `${p.name} (${p.id})`, `NIK …${p.nik.slice(-4)}`);
      return p;
    }
    const { db, fsMod } = await firebase();
    const ref = await fsMod.addDoc(fsMod.collection(db, "patients"), {
      ...data, createdBy: _session.uid, createdAt: fsMod.serverTimestamp(),
    });
    return { id: ref.id, ...data };
  },

  async listPatients() {
    if (isDemo) return [...demo.patients];
    const { db, fsMod } = await firebase();
    const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, "patients"), fsMod.orderBy("createdAt", "desc"), fsMod.limit(100)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async getPatient(id) {
    if (isDemo) return demo.patients.find((p) => p.id === id) || null;
    const { db, fsMod } = await firebase();
    const d = await fsMod.getDoc(fsMod.doc(db, "patients", id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  },

  // ---------- TRIASE (2 tahap: vision → penalaran klinis) ----------
  async analyzeEyePhoto({ patientId, file, imageDataUrl }) {
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 1300)); // simulasi latensi inference ML Vision
      const vision = mockVisionAnalysis(file);
      const session = {
        id: uid(), patientId, nakesUid: _session.uid, status: "menunggu_gejala",
        imageDataUrl, vision, createdAt: now(),
      };
      demo.sessions.unshift(session);
      const p = demo.patients.find((x) => x.id === patientId);
      auditDemo("VISION_ANALYSIS", `${p?.name} (${patientId})`, vision.raw_summary);
      return session;
    }
    return await callBackend("/api/vision", { patientId, imageBase64: imageDataUrl.split(",")[1] });
  },

  async finalizeScreening(sessionId, symptoms) {
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 1500)); // simulasi latensi Ophthalmo-AI
      const session = demo.sessions.find((s) => s.id === sessionId);
      const patient = demo.patients.find((p) => p.id === session.patientId);
      const diagnosis = mockOphthalmoAI(patient, symptoms, session.vision);
      const code = generateAccessCode();
      session.status = "final";
      session.symptoms = symptoms;
      session.diagnosis = diagnosis;
      patient.accessCode = code;

      const record = {
        id: uid(), patientId: patient.id, sessionId, diagnosis,
        nakesUid: _session.uid, puskesmas: _session.puskesmas, createdAt: now(),
      };
      demo.records.unshift(record);
      const t = diagnosis.triage_assessment;
      auditDemo("TRIASE_FINAL", `${patient.name} (${patient.id})`, `${t.urgency_level} · ${t.primary_action_category} · confidence ${t.confidence_score.toFixed(2)}`);
      return { diagnosis, accessCode: code, record };
    }
    return await callBackend("/api/triage", { sessionId, symptoms });
  },

  // ---------- REKAM MEDIS ----------
  async listRecords({ patientId, nakesUid } = {}) {
    if (isDemo) {
      let r = [...demo.records];
      if (patientId) r = r.filter((x) => x.patientId === patientId);
      if (nakesUid) r = r.filter((x) => x.nakesUid === nakesUid);
      return r;
    }
    const { db, fsMod } = await firebase();
    let q = fsMod.collection(db, "medical_records");
    if (patientId) q = fsMod.query(q, fsMod.where("patientId", "==", patientId), fsMod.orderBy("createdAt", "desc"));
    else if (nakesUid) q = fsMod.query(q, fsMod.where("nakesUid", "==", nakesUid), fsMod.orderBy("createdAt", "desc"));
    else q = fsMod.query(q, fsMod.orderBy("createdAt", "desc"), fsMod.limit(200));
    const snap = await fsMod.getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  // ---------- AKSES PASIEN ANONIM (NIK + kode) ----------
  async patientAccess(nik, code) {
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 600));
      const p = demo.patients.find((x) => x.nik === nik && x.accessCode && x.accessCode.toUpperCase() === code.toUpperCase());
      auditDemo("AKSES_PASIEN", `NIK …${nik.slice(-4)}`, p ? "Verifikasi berhasil" : "Verifikasi GAGAL");
      if (!p) throw new Error("NIK atau kode akses tidak cocok.");
      const records = demo.records.filter((r) => r.patientId === p.id);
      return { patient: p, records };
    }
    return await callBackend("/api/patient", { nik, code });
  },

  // ---------- ADMIN ----------
  async listAudit() {
    if (isDemo) return [...demo.audit];
    const { db, fsMod } = await firebase();
    const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, "audit_logs"), fsMod.orderBy("at", "desc"), fsMod.limit(300)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listUsers() {
    if (isDemo) return demo.users.map(({ pass, ...u }) => u);
    const { db, fsMod } = await firebase();
    const snap = await fsMod.getDocs(fsMod.collection(db, "users"));
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },

  async saveUser(user) {
    if (isDemo) {
      const idx = demo.users.findIndex((u) => u.uid === user.uid);
      if (idx >= 0) demo.users[idx] = { ...demo.users[idx], ...user };
      else demo.users.push({ ...user, uid: uid(), pass: "demo123" });
      auditDemo("KELOLA_USER", user.email, idx >= 0 ? "Update akun" : "Tambah akun");
      return {};
    }
    // Produksi: kedua operasi lewat Express server (menggunakan Admin SDK).
    if (user.uid) {
      await callBackend("/api/users/active", { uid: user.uid, active: user.active });
      return {};
    }
    return await callBackend("/api/users/create", { name: user.name, email: user.email, puskesmas: user.puskesmas });
  },

  async logAudit(action, target, detail) {
    if (isDemo) return auditDemo(action, target, detail);
    const { db, fsMod } = await firebase();
    await fsMod.addDoc(fsMod.collection(db, "audit_logs"), {
      actor: _session?.name || "ANONIM", role: _session?.role || "pasien",
      action, target, detail, at: fsMod.serverTimestamp(),
    });
  },

  // ---------- STATISTIK ----------
  async stats() {
    if (isDemo) {
      const today = new Date().toISOString().slice(0, 10);
      const emergencies = demo.records.filter((r) => r.diagnosis.triage_assessment.is_emergency).length;
      return {
        totalScreenings: demo.records.length,
        todayScreenings: demo.records.filter((r) => r.createdAt.startsWith(today)).length,
        totalPatients: demo.patients.length,
        emergencies,
        activeNakes: demo.users.filter((u) => u.role === "nakes" && u.active).length,
        auditCount: demo.audit.length,
      };
    }
    const records = await this.listRecords();
    const patients = await this.listPatients();
    return {
      totalScreenings: records.length,
      todayScreenings: records.filter((r) => (r.createdAt?.toDate?.() ?? new Date(0)).toDateString() === new Date().toDateString()).length,
      totalPatients: patients.length,
      emergencies: records.filter((r) => r.diagnosis?.triage_assessment?.is_emergency).length,
      activeNakes: 0, auditCount: 0,
    };
  },
};
