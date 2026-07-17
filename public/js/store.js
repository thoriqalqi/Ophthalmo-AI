// ============================================================
// STORE — lapisan data OPHTHALMO-AI (Production)
//
// Mode tunggal: Firebase (Firestore + Auth) + Express backend.
// Tidak ada mock/demo — semua operasi ke Firebase & server nyata.
// ============================================================

import { firebaseConfig, BACKEND_URL } from "./firebase-config.js";

// ---------- kosakata skema Ophthalmo-AI ----------
export const URGENCY = {
  LOW:      { label: "Rendah",  badge: "ringan" },
  MEDIUM:   { label: "Sedang",  badge: "sedang" },
  HIGH:     { label: "Tinggi",  badge: "tinggi" },
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

// ---------- util ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateAccessCode() {
  const rand = new Uint8Array(8);
  crypto.getRandomValues(rand);
  const s = [...rand].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `OA-${s.slice(0, 4)}-${s.slice(4)}`;
}

// ============================================================
// SESI LOGIN — disimpan di sessionStorage
// ============================================================
let _session = null;
try { _session = JSON.parse(sessionStorage.getItem("oa_session") || "null"); } catch {}

export function currentUser() { return _session; }

function setSession(u) {
  _session = u;
  if (u) sessionStorage.setItem("oa_session", JSON.stringify(u));
  else sessionStorage.removeItem("oa_session");
}

// ---------- Firebase SDK (lazy load) ----------
let fb = null;
async function firebase() {
  if (fb) return fb;
  const appMod  = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const fsMod   = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const app = appMod.initializeApp(firebaseConfig);
  fb = {
    db:   fsMod.getFirestore(app),
    auth: authMod.getAuth(app),
    fsMod, authMod,
  };
  return fb;
}

// ---------- Helper: panggil Express backend dengan Firebase ID token ----------
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

// ============================================================
// API PUBLIK STORE
// ============================================================
export const store = {

  // ---------- AUTH ----------
  async login(email, pass) {
    const { auth, db, fsMod, authMod } = await firebase();
    const cred = await authMod.signInWithEmailAndPassword(auth, email, pass);
    const prof  = await fsMod.getDoc(fsMod.doc(db, "users", cred.user.uid));
    if (!prof.exists() || !prof.data().active) throw new Error("Akun tidak aktif.");
    setSession({ uid: cred.user.uid, ...prof.data() });
    return _session;
  },

  async logout() {
    const { auth, authMod } = await firebase();
    await authMod.signOut(auth);
    setSession(null);
  },

  // ---------- PASIEN ----------
  async findPatientByNIK(nik) {
    const { db, fsMod } = await firebase();
    const q    = fsMod.query(fsMod.collection(db, "patients"), fsMod.where("nik", "==", nik), fsMod.limit(1));
    const snap = await fsMod.getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async createPatient(data) {
    const { db, fsMod } = await firebase();
    const ref = await fsMod.addDoc(fsMod.collection(db, "patients"), {
      ...data, createdBy: _session.uid, createdAt: fsMod.serverTimestamp(),
    });
    return { id: ref.id, ...data };
  },

  async listPatients() {
    const { db, fsMod } = await firebase();
    const snap = await fsMod.getDocs(
      fsMod.query(fsMod.collection(db, "patients"), fsMod.orderBy("createdAt", "desc"), fsMod.limit(100))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async getPatient(id) {
    const { db, fsMod } = await firebase();
    const d = await fsMod.getDoc(fsMod.doc(db, "patients", id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  },

  // ---------- TRIASE (2 tahap: vision → penalaran klinis) ----------
  async analyzeEyePhoto({ patientId, imageDataUrl }) {
    return await callBackend("/api/vision", { patientId, imageBase64: imageDataUrl.split(",")[1] });
  },

  async finalizeScreening(sessionId, symptoms) {
    return await callBackend("/api/triage", { sessionId, symptoms });
  },

  // ---------- REKAM MEDIS ----------
  async listRecords({ patientId, nakesUid } = {}) {
    const { db, fsMod } = await firebase();
    let q = fsMod.collection(db, "medical_records");
    // Workaround: Hilangkan orderBy jika pakai where untuk hindari kebutuhan composite index
    if (patientId) {
      q = fsMod.query(q, fsMod.where("patientId", "==", patientId));
    } else if (nakesUid) {
      q = fsMod.query(q, fsMod.where("nakesUid", "==", nakesUid));
    } else {
      q = fsMod.query(q, fsMod.orderBy("createdAt", "desc"), fsMod.limit(200));
    }
    const snap = await fsMod.getDocs(q);
    let records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    
    // Sort manual di client (menggantikan orderBy desc yang gagal)
    if (patientId || nakesUid) {
      records.sort((a, b) => {
        const ta = a.createdAt?.seconds || 0;
        const tb = b.createdAt?.seconds || 0;
        return tb - ta;
      });
    }
    return records;
  },

  async updateRecordStatus(recordId, status, notes) {
    const { db, fsMod } = await firebase();
    await fsMod.updateDoc(fsMod.doc(db, "medical_records", recordId), {
      status,
      nakesNotes: notes || "",
      updatedAt: fsMod.serverTimestamp()
    });
  },

  // ---------- AKSES PASIEN ANONIM (NIK + kode) ----------
  async patientAccess(nik, code) {
    return await callBackend("/api/patient", { nik, code });
  },

  // ---------- ADMIN ----------
  async listAudit() {
    const { db, fsMod } = await firebase();
    const snap = await fsMod.getDocs(
      fsMod.query(fsMod.collection(db, "audit_logs"), fsMod.orderBy("at", "desc"), fsMod.limit(300))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listUsers() {
    const { db, fsMod } = await firebase();
    const snap = await fsMod.getDocs(fsMod.collection(db, "users"));
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },

  async saveUser(user) {
    if (user.uid) {
      await callBackend("/api/users/active", { uid: user.uid, active: user.active });
      return {};
    }
    return await callBackend("/api/users/create", { name: user.name, email: user.email, puskesmas: user.puskesmas });
  },

  async logAudit(action, target, detail) {
    const { db, fsMod } = await firebase();
    await fsMod.addDoc(fsMod.collection(db, "audit_logs"), {
      actor: _session?.name || "ANONIM", role: _session?.role || "pasien",
      action, target, detail, at: fsMod.serverTimestamp(),
    });
  },

  // ---------- STATISTIK ----------
  async stats() {
    const [records, patients, usersSnap] = await Promise.all([
      this.listRecords(),
      this.listPatients(),
      (async () => {
        const { db, fsMod } = await firebase();
        // Workaround: Hapus filter kedua untuk hindari composite index
        const snap = await fsMod.getDocs(fsMod.query(
          fsMod.collection(db, "users"),
          fsMod.where("role", "==", "nakes")
        ));
        // Filter aktif manual di client
        const activeCount = snap.docs.filter(d => d.data().active === true).length;
        return { size: activeCount };
      })(),
    ]);
    const today = new Date().toDateString();
    return {
      totalScreenings:  records.length,
      todayScreenings:  records.filter((r) => (r.createdAt?.toDate?.() ?? new Date(0)).toDateString() === today).length,
      totalPatients:    patients.length,
      emergencies:      records.filter((r) => r.diagnosis?.triage_assessment?.is_emergency).length,
      activeNakes:      usersSnap.size,
      auditCount:       0, // diisi dari listAudit() bila dibutuhkan
    };
  },
};
