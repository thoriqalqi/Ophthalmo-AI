// ============================================================
// OPHTHALMO-AI — Sistem Pakar Triase Kegawatdaruratan Mata
//
// 3 role:
//  • Pasien      : anonim, verifikasi NIK + kode akses unik
//  • Nakes       : login → upload foto mata → ML Vision analisis
//                  awal → gejala klinis → Ophthalmo-AI (Claude)
//                  menyusun triase final → tersimpan ke rekam medis
//  • Super Admin : audit log, tracking, manajemen user, arsip
//
// Desain TIDAK berubah — semua memakai komponen styles.css yang ada.
// ============================================================

import { store, isDemo, currentUser, URGENCY, ACTIONS, PROB_BADGE, SYMPTOM_QUESTIONS } from "./store.js";

// ---------- elemen global ----------
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const $connDot = document.getElementById("conn-dot");
const $connLabel = document.getElementById("conn-label");
const $roleDot = document.getElementById("role-dot");
const $roleLabel = document.getElementById("role-label");
const $toast = document.getElementById("toast");

function toast(msg, ms = 3400) {
  $toast.textContent = msg;
  $toast.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $toast.classList.add("hidden"), ms);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(x) {
  const d = x?.toDate?.() ?? (x ? new Date(x) : null);
  return d && !isNaN(d) ? d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

const urgencyBadge = (u) => `<span class="badge badge-${URGENCY[u].badge}">${esc(URGENCY[u].label)}</span>`;
const actionBadge = (a) => `<span class="badge badge-${ACTIONS[a].badge}">${esc(ACTIONS[a].label)}</span>`;
const probBadge = (p) => `<span class="badge badge-${PROB_BADGE[p] || "neutral"}">${esc(p)}</span>`;
const confPct = (c) => `${Math.round(c * 100)}%`;

// ---------- indikator koneksi ----------
function renderConnection() {
  const online = navigator.onLine;
  $connDot.className = "dot " + (online ? "online" : "offline");
  $connLabel.textContent = online ? "Online" : "Offline";
}
window.addEventListener("online", renderConnection);
window.addEventListener("offline", renderConnection);
renderConnection();

// ---------- indikator role + nav dinamis ----------
function renderChrome() {
  const u = currentUser();
  if (u) {
    $roleDot.className = "dot online";
    $roleLabel.textContent = `${u.role === "admin" ? "Admin" : "Nakes"} · ${u.name.split(" ")[0]}`;
  } else {
    $roleDot.className = "dot";
    $roleLabel.textContent = "Anonim";
  }

  const links = !u
    ? [["#/", "Cek Rekam Medis"], ["#/login", "Login Nakes"]]
    : u.role === "nakes"
      ? [["#/nakes", "Dashboard"], ["#/nakes/triase", "Triase Baru"], ["#/nakes/pasien", "Rekam Medis"], ["#logout", "Keluar"]]
      : [["#/admin", "Dashboard"], ["#/admin/audit", "Audit Log"], ["#/admin/users", "User"], ["#/admin/arsip", "Arsip"], ["#logout", "Keluar"]];

  const hash = location.hash || "#/";
  $nav.innerHTML = links
    .map(([href, label]) => {
      const active = href !== "#logout" && (hash === href || (href !== "#/" && hash.startsWith(href)));
      return `<a href="${href}" class="${active ? "active" : ""}" ${href === "#logout" ? 'data-logout="1"' : ""}>${label}</a>`;
    })
    .join("");

  $nav.querySelector("[data-logout]")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await store.logout();
    scr = null; // buang state triase yang belum selesai
    toast("Anda telah keluar.");
    if (location.hash === "#/" || location.hash === "") route();
    else location.hash = "#/";
  });
}

// ============================================================
// ROUTER
// ============================================================
function route() {
  const hash = location.hash || "#/";
  const u = currentUser();
  renderChrome();

  // guard per-role
  if (hash.startsWith("#/nakes") && (!u || (u.role !== "nakes" && u.role !== "admin"))) { location.hash = "#/login"; return; }
  if (hash.startsWith("#/admin") && (!u || u.role !== "admin")) { location.hash = "#/login"; return; }

  if (hash.startsWith("#/demo/")) return handleDemoLogin(hash.split("/")[2]);
  if (hash.startsWith("#/login")) return renderLogin();
  if (hash.startsWith("#/nakes/triase")) return renderTriase();
  if (hash.startsWith("#/nakes/pasien/")) return renderPasienDetail(hash.split("/")[3]);
  if (hash.startsWith("#/nakes/pasien")) return renderPasienList();
  if (hash.startsWith("#/nakes")) return renderNakesDashboard();
  if (hash.startsWith("#/admin/audit")) return renderAudit();
  if (hash.startsWith("#/admin/users")) return renderUsers();
  if (hash.startsWith("#/admin/arsip/")) return renderArsipDetail(hash.split("/")[3]);
  if (hash.startsWith("#/admin/arsip")) return renderArsip();
  if (hash.startsWith("#/admin")) return renderAdminDashboard();
  return renderPasienPortal();
}
window.addEventListener("hashchange", route);

async function handleDemoLogin(role) {
  try {
    await store.demoLoginAs(role);
    toast(`Mode demo: masuk sebagai ${role}.`);
    location.hash = role === "admin" ? "#/admin" : "#/nakes";
  } catch (e) { toast(e.message); location.hash = "#/login"; }
}

// ============================================================
// PORTAL PASIEN (anonim, tanpa login)
// ============================================================
async function renderPasienPortal() {
  const s = await store.stats();
  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Portal Pasien · Tanpa Login</div>
      <h1 class="page-title">Cek <span class="accent">Rekam Medis</span> Anda</h1>
      <p class="page-sub">Masukkan NIK dan kode akses unik yang diberikan petugas kesehatan
      saat pemeriksaan untuk melihat hasil triase mata Anda secara aman.</p>
    </div>

    <div class="stats-row">
      <div class="stat"><div class="stat-value">${s.totalScreenings}</div><div class="stat-label">Total Triase</div></div>
      <div class="stat"><div class="stat-value accent">${s.totalPatients}</div><div class="stat-label">Pasien Terdaftar</div></div>
      <div class="stat"><div class="stat-value danger">${s.emergencies}</div><div class="stat-label">Kasus Kegawatdaruratan</div></div>
      <div class="stat"><div class="stat-value warn">4</div><div class="stat-label">Kategori Tindakan</div></div>
    </div>

    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Verifikasi Identitas</div>
        <form id="access-form" class="form-grid">
          <div class="full">
            <label for="p-nik">NIK (16 digit)</label>
            <input id="p-nik" required minlength="16" maxlength="16" pattern="[0-9]{16}" placeholder="cth. 3201014455660001" inputmode="numeric" autocomplete="off" />
          </div>
          <div class="full">
            <label for="p-code">Kode Akses</label>
            <input id="p-code" required placeholder="cth. OA-XXXX-XXXX" autocomplete="off" style="text-transform:uppercase" />
          </div>
          <div class="full">
            <button type="submit" class="btn btn-accent btn-block btn-xl" id="access-btn">Lihat Rekam Medis</button>
          </div>
        </form>
        ${isDemo ? `<p style="margin-top:1rem;color:var(--text-faint);font-size:0.82rem">Mode demo — coba NIK <strong>3201014455660001</strong> dgn kode <strong>OA-DEMO-2024</strong></p>` : ""}
      </div>
      <div id="access-result"></div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Cara Kerja</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Langkah 1</div><div class="v">Periksa di Puskesmas</div></div>
          <div class="detail-field"><div class="k">Langkah 2</div><div class="v">Terima NIK + Kode</div></div>
          <div class="detail-field"><div class="k">Langkah 3</div><div class="v">Cek Hasil di Sini</div></div>
          <div class="detail-field"><div class="k">Privasi</div><div class="v">Data Terenkripsi</div></div>
        </div>
      </div>
    </div>
    </div>
  `;

  document.getElementById("access-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("access-btn");
    btn.disabled = true; btn.textContent = "Memverifikasi…";
    try {
      const { patient, records } = await store.patientAccess(
        document.getElementById("p-nik").value.trim(),
        document.getElementById("p-code").value.trim().toUpperCase()
      );
      document.getElementById("access-result").innerHTML = `
        <div class="card card-dark">
          <div class="card-title">Data Pasien Terverifikasi</div>
          <div class="detail-grid">
            <div class="detail-field"><div class="k">Nama</div><div class="v">${esc(patient.name)}</div></div>
            <div class="detail-field"><div class="k">Usia</div><div class="v">${esc(patient.age)} tahun</div></div>
            <div class="detail-field"><div class="k">Riwayat Skrining</div><div class="v">${records.length}×</div></div>
          </div>
        </div>
        ${records.map(recordCard).join("") || `<div class="empty-state">Belum ada hasil triase.</div>`}
      `;
      document.getElementById("access-result").scrollIntoView({ behavior: "smooth" });
      toast("✓ Verifikasi berhasil.");
    } catch (err) {
      toast(err.message || "Verifikasi gagal.");
    } finally {
      btn.disabled = false; btn.textContent = "Lihat Rekam Medis";
    }
  });
}

// kartu hasil triase — dipakai pasien, nakes, dan arsip admin
function recordCard(r) {
  const d = r.diagnosis;
  const t = d.triage_assessment;
  const ca = d.clinical_analysis;
  const ep = d.emergency_care_protocol;
  const rec = d.recommendations;

  return `
    <div class="card">
      <div class="card-title">Hasil Triase · ${fmtDate(r.createdAt)}</div>
      <div class="ai-box ${t.is_emergency ? "kritis" : ""}">
        ${urgencyBadge(t.urgency_level)}
        ${actionBadge(t.primary_action_category)}
        <span class="badge badge-neutral">Confidence ${confPct(t.confidence_score)}</span>
        <p class="ai-reasoning">${esc(ca.synthesis_summary)}</p>

        ${ca.possible_conditions?.length ? `
        <div class="instruction-history" style="margin-bottom:1rem">
          ${ca.possible_conditions.map((c) => `
            <div class="instruction-bubble">
              <div class="who">${esc(c.condition_name)} · ${probBadge(c.probability)}</div>
              <div>${esc(c.rationale)}</div>
            </div>`).join("")}
        </div>` : ""}

        ${ca.danger_signs_present?.length ? `
        <p style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);margin-bottom:0.5rem">Tanda Bahaya</p>
        <div class="badges" style="justify-content:flex-start;margin-bottom:1rem">
          ${ca.danger_signs_present.map((x) => `<span class="badge badge-kritis">${esc(x)}</span>`).join("")}
        </div>` : ""}

        <ul class="ai-recs">${(rec.patient_action_plan || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>

      ${ep.requires_immediate_hospital ? `
      <div class="ai-box kritis" style="margin-top:1.2rem">
        <span class="badge badge-kritis">Golden Hour: ${esc(ep.golden_hour_timeframe)}</span>
        <p style="font-weight:700;margin:0.7rem 0 0.4rem">Pertolongan Pertama</p>
        <ul class="ai-recs">${ep.immediate_first_aid_instructions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p style="font-weight:700;margin:0.9rem 0 0.4rem">Yang TIDAK Boleh Dilakukan</p>
        <ul class="ai-recs">${ep.what_NOT_to_do.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>` : ""}

      <div class="detail-grid" style="margin-top:1.2rem">
        <div class="detail-field"><div class="k">Saran Obat Bebas</div><div class="v" style="font-weight:500;font-size:0.92rem">${esc(rec.safe_otc_medication_advice)}</div></div>
        <div class="detail-field"><div class="k">Rujukan</div><div class="v" style="font-weight:500;font-size:0.92rem">${esc(rec.doctor_referral_details.specialist_needed)} — ${esc(rec.doctor_referral_details.examination_needed)}</div></div>
      </div>

      <p style="margin-top:1rem;color:var(--text-faint);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.1em">
        ${esc(r.puskesmas || "")}</p>
    </div>`;
}

// ============================================================
// LOGIN NAKES / ADMIN
// ============================================================
function renderLogin() {
  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Area Tenaga Kesehatan</div>
      <h1 class="page-title">Login <span class="accent">Nakes</span></h1>
      <p class="page-sub">Akses dashboard triase kegawatdaruratan mata. Akun dikelola oleh Super Admin.</p>
    </div>
    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Masuk</div>
        <form id="login-form" class="form-grid">
          <div class="full"><label for="l-email">Email</label>
            <input id="l-email" type="email" required placeholder="nama@puskesmas.go.id" /></div>
          <div class="full"><label for="l-pass">Kata Sandi</label>
            <input id="l-pass" type="password" required placeholder="••••••••" /></div>
          <div class="full"><button class="btn btn-accent btn-block btn-xl" id="login-btn">Masuk</button></div>
        </form>
        ${isDemo ? `
        <p style="margin:1.2rem 0 0.6rem;color:var(--text-faint);font-size:0.82rem">Mode demo — masuk cepat:</p>
        <div style="display:flex;gap:0.6rem;flex-wrap:wrap">
          <a class="btn" href="#/demo/nakes">Demo Nakes</a>
          <a class="btn" href="#/demo/admin">Demo Admin</a>
        </div>` : ""}
      </div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Keamanan</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Autentikasi</div><div class="v">Per Akun Nakes</div></div>
          <div class="detail-field"><div class="k">Audit</div><div class="v">Semua Aksi Tercatat</div></div>
          <div class="detail-field"><div class="k">Akses Pasien</div><div class="v">NIK + Kode Unik</div></div>
        </div>
      </div>
    </div>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("login-btn");
    btn.disabled = true; btn.textContent = "Memeriksa…";
    try {
      const u = await store.login(
        document.getElementById("l-email").value.trim(),
        document.getElementById("l-pass").value
      );
      toast(`Selamat datang, ${u.name}.`);
      location.hash = u.role === "admin" ? "#/admin" : "#/nakes";
    } catch (err) {
      toast(err.message || "Login gagal.");
      btn.disabled = false; btn.textContent = "Masuk";
    }
  });
}

// ============================================================
// NAKES — DASHBOARD
// ============================================================
async function renderNakesDashboard() {
  const u = currentUser();
  const [s, myRecords, patients] = await Promise.all([
    store.stats(), store.listRecords({ nakesUid: u.uid }), store.listPatients(),
  ]);
  const pName = (id) => patients.find((p) => p.id === id)?.name || id;

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">${esc(u.puskesmas)} · ${esc(u.name)}</div>
      <h1 class="page-title">Dashboard <span class="accent">Nakes</span></h1>
      <p class="page-sub">Ringkasan aktivitas triase kegawatdaruratan mata Anda.
      Mulai triase baru untuk menganalisis foto mata pasien dengan Ophthalmo-AI.</p>
    </div>

    <div class="stats-row">
      <div class="stat"><div class="stat-value accent">${s.todayScreenings}</div><div class="stat-label">Triase Hari Ini</div></div>
      <div class="stat"><div class="stat-value">${myRecords.length}</div><div class="stat-label">Total Triase Saya</div></div>
      <div class="stat"><div class="stat-value">${s.totalPatients}</div><div class="stat-label">Pasien Terdaftar</div></div>
      <div class="stat"><div class="stat-value danger">${myRecords.filter((r) => r.diagnosis.triage_assessment.is_emergency).length}</div><div class="stat-label">Kegawatdaruratan</div></div>
    </div>

    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Triase Terakhir</div>
        <div class="patient-list">
          ${myRecords.slice(0, 8).map((r) => `
            <a class="patient-item ${r.diagnosis.triage_assessment.is_emergency ? "kritis" : ""}" href="#/nakes/pasien/${r.patientId}">
              <div class="patient-info">
                <div class="patient-name">${esc(pName(r.patientId))}</div>
                <div class="patient-meta">${fmtDate(r.createdAt)} · Confidence ${confPct(r.diagnosis.triage_assessment.confidence_score)}</div>
              </div>
              <div class="badges">${urgencyBadge(r.diagnosis.triage_assessment.urgency_level)}</div>
            </a>`).join("") || `<div class="empty-state">Belum ada triase. Mulai dari "Triase Baru".</div>`}
        </div>
      </div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Aksi Cepat</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Triase</div><div class="v"><a href="#/nakes/triase" style="color:#fff">＋ Mulai Baru →</a></div></div>
          <div class="detail-field"><div class="k">Rekam Medis</div><div class="v"><a href="#/nakes/pasien" style="color:#fff">Lihat Semua →</a></div></div>
          <div class="detail-field"><div class="k">Sistem</div><div class="v">Ophthalmo-AI CDSS</div></div>
        </div>
      </div>
    </div>
    </div>
  `;
}

// ============================================================
// NAKES — TRIASE BARU (alur 2-tahap: Vision → Penalaran Klinis)
// ============================================================
let scr = null; // state alur triase aktif

function renderTriase() {
  if (!scr) scr = { step: 1 };
  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Triase Baru · Langkah ${scr.step} dari 3</div>
      <h1 class="page-title">${
        scr.step === 1 ? `Data & <span class="accent">Foto Mata</span>`
        : scr.step === 2 ? `Gejala <span class="accent">Klinis</span>`
        : `Hasil <span class="accent">Triase</span>`
      }</h1>
      <p class="page-sub">${
        scr.step === 1 ? "Daftarkan/pilih pasien lalu unggah foto mata. Model ML Vision akan mengekstrak fitur visual eksternal."
        : scr.step === 2 ? "ML Vision telah mengekstrak fitur visual. Lengkapi keluhan & gejala klinis pasien sebelum Ophthalmo-AI menyusun triase final."
        : "Triase tersimpan otomatis ke rekam medis. Berikan NIK + kode akses kepada pasien."
      }</p>
    </div>
    <div id="triase-body"></div>
  `;
  if (scr.step === 1) renderStep1();
  else if (scr.step === 2) renderStep2();
  else renderStep3();
}

function renderStep1() {
  document.getElementById("triase-body").innerHTML = `
    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">1 · Identitas & Riwayat Pasien</div>
        <form id="scr-form" class="form-grid">
          <div class="span-6"><label for="s-nik">NIK (16 digit) *</label>
            <input id="s-nik" required minlength="16" maxlength="16" pattern="[0-9]{16}" inputmode="numeric" placeholder="cth. 3201014455660001" /></div>
          <div class="span-6"><label for="s-name">Nama Lengkap *</label>
            <input id="s-name" required placeholder="cth. Sumarni" /></div>
          <div class="span-3"><label for="s-age">Usia *</label>
            <input id="s-age" type="number" min="1" max="120" required placeholder="cth. 58" /></div>
          <div class="span-3"><label for="s-gender">Jenis Kelamin</label>
            <select id="s-gender"><option value="P">Perempuan</option><option value="L">Laki-laki</option></select></div>
          <div class="span-3"><label for="s-dm">Riwayat Diabetes?</label>
            <select id="s-dm"><option value="0">Tidak</option><option value="1">Ya</option></select></div>
          <div class="span-3"><label for="s-htn">Riwayat Hipertensi?</label>
            <select id="s-htn"><option value="0">Tidak</option><option value="1">Ya</option></select></div>
          <div class="span-6"><label for="s-lens">Pengguna Lensa Kontak?</label>
            <select id="s-lens"><option value="0">Tidak</option><option value="1">Ya</option></select></div>
          <div class="full"><label for="s-history">Riwayat Penyakit Mata Sebelumnya (opsional)</label>
            <input id="s-history" placeholder="cth. Operasi katarak 2019, tidak ada, dll." /></div>
          <div class="full">
            <label for="s-img">2 · Foto Mata Pasien (segmen eksternal) *</label>
            <input id="s-img" type="file" accept="image/*" required />
            <img id="s-preview" class="retina-preview hidden" alt="Pratinjau foto mata" />
          </div>
          <div class="full">
            <button class="btn btn-accent btn-block btn-xl" id="scr-analyze">🔍 Analisis dengan ML Vision</button>
          </div>
        </form>
        <p id="s-hint" style="margin-top:0.9rem;color:var(--text-faint);font-size:0.82rem">
          NIK yang sudah terdaftar akan otomatis memuat riwayat medis pasien.</p>
      </div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Alur Analisis</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Tahap 1</div><div class="v">ML Vision — Fitur Visual</div></div>
          <div class="detail-field"><div class="k">Tahap 2</div><div class="v">Gejala Klinis Subjektif</div></div>
          <div class="detail-field"><div class="k">Tahap 3</div><div class="v">Ophthalmo-AI — Triase Final</div></div>
          <div class="detail-field"><div class="k">Kategori</div><div class="v">Self-Care → Emergency</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Catatan Penting</div>
        <p style="color:var(--text-dim);font-size:0.88rem">Foto kamera ponsel hanya menampilkan segmen eksternal mata.
        Kondisi segmen posterior (retina/saraf optik) memerlukan pemeriksaan Funduskopi/Slit Lamp langsung di fasilitas kesehatan.</p>
      </div>
    </div>
    </div>
  `;

  const $img = document.getElementById("s-img");
  $img.addEventListener("change", () => {
    const f = $img.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      scr.imageDataUrl = reader.result;
      const prev = document.getElementById("s-preview");
      prev.src = reader.result;
      prev.classList.remove("hidden");
    };
    reader.readAsDataURL(f);
  });

  document.getElementById("s-nik").addEventListener("blur", async (e) => {
    const p = await store.findPatientByNIK(e.target.value.trim());
    if (p) {
      document.getElementById("s-name").value = p.name;
      document.getElementById("s-age").value = p.age;
      document.getElementById("s-gender").value = p.gender;
      document.getElementById("s-dm").value = p.historyDiabetes ? "1" : "0";
      document.getElementById("s-htn").value = p.historyHipertensi ? "1" : "0";
      document.getElementById("s-lens").value = p.pakaiLensaKontak ? "1" : "0";
      document.getElementById("s-history").value = p.riwayatMataSebelumnya || "";
      scr.existingPatient = p;
      document.getElementById("s-hint").textContent =
        `✓ Pasien terdaftar — ${(await store.listRecords({ patientId: p.id })).length} riwayat triase ditemukan.`;
    } else scr.existingPatient = null;
  });

  document.getElementById("scr-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!scr.imageDataUrl) { toast("Unggah foto mata terlebih dahulu."); return; }
    const btn = document.getElementById("scr-analyze");
    btn.disabled = true; btn.textContent = "⏳ ML Vision sedang menganalisis foto…";
    try {
      const patient = scr.existingPatient || (await store.createPatient({
        nik: document.getElementById("s-nik").value.trim(),
        name: document.getElementById("s-name").value.trim(),
        age: Number(document.getElementById("s-age").value),
        gender: document.getElementById("s-gender").value,
        historyDiabetes: document.getElementById("s-dm").value === "1",
        historyHipertensi: document.getElementById("s-htn").value === "1",
        pakaiLensaKontak: document.getElementById("s-lens").value === "1",
        riwayatMataSebelumnya: document.getElementById("s-history").value.trim() || null,
      }));
      scr.patient = patient;
      scr.session = await store.analyzeEyePhoto({
        patientId: patient.id,
        file: document.getElementById("s-img").files[0],
        imageDataUrl: scr.imageDataUrl,
      });
      scr.step = 2;
      renderTriase();
    } catch (err) {
      console.error(err);
      toast(err.message || "Analisis gagal. Coba lagi.");
      btn.disabled = false; btn.textContent = "🔍 Analisis dengan ML Vision";
    }
  });
}

function renderStep2() {
  const s = scr.session;
  document.getElementById("triase-body").innerHTML = `
    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Hasil ML Vision — Ekstraksi Fitur Visual</div>
        <div class="ai-box">
          <span class="badge badge-neutral">Kualitas Citra: ${esc(s.vision.quality)}</span>
          <span class="badge badge-neutral">${esc(s.vision.segment)}</span>
          <p class="ai-reasoning">${esc(s.vision.raw_summary)}</p>
          <ul class="ai-recs">${s.vision.detected_features.map((f) => `<li>${esc(f.feature)} — skor ${f.severity.toFixed(2)}</li>`).join("")}</ul>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Keluhan & Gejala Subjektif Pasien</div>
        <form id="qa-form" class="form-grid">
          ${SYMPTOM_QUESTIONS.map((q) => `
            <div class="span-6">
              <label for="q-${q.id}">${esc(q.label)}</label>
              ${q.type === "select"
                ? `<select id="q-${q.id}">${q.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
                : `<input id="q-${q.id}" type="${q.type}" placeholder="${esc(q.placeholder || "Jawaban…")}" />`}
            </div>`).join("")}
          <div class="full">
            <button class="btn btn-accent btn-block btn-xl" id="qa-btn">✓ Kirim & Minta Triase Final dari Ophthalmo-AI</button>
          </div>
        </form>
      </div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Pasien</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Nama</div><div class="v">${esc(scr.patient.name)}</div></div>
          <div class="detail-field"><div class="k">NIK</div><div class="v">…${esc(scr.patient.nik.slice(-6))}</div></div>
          <div class="detail-field"><div class="k">Usia</div><div class="v">${esc(scr.patient.age)} th</div></div>
        </div>
      </div>
      ${scr.imageDataUrl ? `<div class="card"><div class="card-title">Foto Dianalisis</div>
        <img src="${scr.imageDataUrl}" class="retina-preview" alt="Foto mata pasien" /></div>` : ""}
    </div>
    </div>
  `;

  document.getElementById("qa-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const symptoms = {};
    for (const q of SYMPTOM_QUESTIONS) symptoms[q.id] = document.getElementById(`q-${q.id}`).value;
    const btn = document.getElementById("qa-btn");
    btn.disabled = true; btn.textContent = "⏳ Ophthalmo-AI menyusun triase final…";
    try {
      scr.result = await store.finalizeScreening(s.id, symptoms);
      scr.step = 3;
      renderTriase();
    } catch (err) {
      console.error(err);
      toast(err.message || "Gagal menyusun triase.");
      btn.disabled = false; btn.textContent = "✓ Kirim & Minta Triase Final dari Ophthalmo-AI";
    }
  });
}

function renderStep3() {
  const { diagnosis, accessCode } = scr.result;
  const t = diagnosis.triage_assessment;

  document.getElementById("triase-body").innerHTML = `
    <div class="split">
    <div>
      ${recordCard({ diagnosis, createdAt: new Date().toISOString(), puskesmas: currentUser().puskesmas })}
      <div class="card">
        <div class="card-title">Langkah Berikutnya</div>
        <div style="display:flex;gap:0.8rem;flex-wrap:wrap">
          <a class="btn btn-accent" href="#/nakes/pasien/${scr.patient.id}" data-reset="1">Lihat Rekam Medis Pasien</a>
          <a class="btn" href="#/nakes/triase" data-reset="1">＋ Triase Pasien Lain</a>
          <a class="btn" href="#/nakes" data-reset="1">Kembali ke Dashboard</a>
        </div>
      </div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Ringkasan Triase</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Urgensi</div><div class="v">${urgencyBadge(t.urgency_level)}</div></div>
          <div class="detail-field"><div class="k">Kategori Tindakan</div><div class="v">${actionBadge(t.primary_action_category)}</div></div>
        </div>
      </div>
      <div class="card card-dark">
        <div class="card-title">Kode Akses Pasien — Berikan kpd Pasien</div>
        <div class="code-display">${esc(accessCode)}</div>
        <div class="detail-grid" style="margin-top:1rem">
          <div class="detail-field"><div class="k">Pasien</div><div class="v">${esc(scr.patient.name)}</div></div>
          <div class="detail-field"><div class="k">NIK</div><div class="v">${esc(scr.patient.nik)}</div></div>
          <div class="detail-field"><div class="k">Cara Akses</div><div class="v">Portal → NIK + Kode</div></div>
        </div>
      </div>
    </div>
    </div>
  `;
  document.querySelectorAll("[data-reset]").forEach((a) =>
    a.addEventListener("click", () => {
      scr = null;
      // hash tujuan bisa sama dgn hash saat ini (mis. "Triase Pasien Lain"
      // dari #/nakes/triase) — hashchange tidak akan menembak, render manual.
      if (a.getAttribute("href") === location.hash) route();
    })
  );
  toast(t.is_emergency ? "🚨 KEGAWATDARURATAN — ikuti protokol pertolongan pertama." : "✓ Hasil triase tersimpan ke rekam medis.");
}

// ============================================================
// NAKES — REKAM MEDIS PASIEN
// ============================================================
async function renderPasienList() {
  const [patients, records] = await Promise.all([store.listPatients(), store.listRecords()]);
  const latest = (pid) => records.find((r) => r.patientId === pid);

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Rekam Medis</div>
      <h1 class="page-title">Daftar <span class="accent">Pasien</span></h1>
      <p class="page-sub">Seluruh pasien yang pernah menjalani triase kegawatdaruratan mata.</p>
    </div>
    <div class="card">
      <div class="card-title">Cari Pasien</div>
      <input id="search" placeholder="Ketik nama atau NIK…" />
    </div>
    <div class="patient-list" id="plist"></div>
  `;

  const renderList = (kw = "") => {
    const list = patients.filter((p) =>
      p.name.toLowerCase().includes(kw) || p.nik.includes(kw));
    document.getElementById("plist").innerHTML = list.map((p) => {
      const r = latest(p.id);
      return `
      <a class="patient-item ${r && r.diagnosis.triage_assessment.is_emergency ? "kritis" : ""}" href="#/nakes/pasien/${p.id}">
        <div class="patient-info">
          <div class="patient-name">${esc(p.name)}</div>
          <div class="patient-meta">NIK …${esc(p.nik.slice(-6))} · ${esc(p.age)} th ${p.historyDiabetes ? "· Riwayat DM" : ""}</div>
        </div>
        <div class="badges">${r ? urgencyBadge(r.diagnosis.triage_assessment.urgency_level) : `<span class="badge badge-neutral">Belum ditriase</span>`}</div>
      </a>`;
    }).join("") || `<div class="empty-state">Tidak ada pasien yang cocok.</div>`;
  };
  renderList();
  document.getElementById("search").addEventListener("input", (e) => renderList(e.target.value.toLowerCase()));
}

async function renderPasienDetail(pid) {
  const [p, records] = await Promise.all([store.getPatient(pid), store.listRecords({ patientId: pid })]);
  if (!p) { $app.innerHTML = `<div class="empty-state">Pasien tidak ditemukan.</div>`; return; }

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Rekam Medis Pasien</div>
      <h1 class="page-title">${esc(p.name)}</h1>
      <p class="page-sub">NIK ${esc(p.nik)} · ${esc(p.age)} tahun · ${p.gender === "L" ? "Laki-laki" : "Perempuan"}
      ${p.historyDiabetes ? " · Riwayat Diabetes" : ""}${p.historyHipertensi ? " · Riwayat Hipertensi" : ""}</p>
    </div>
    <div class="split">
    <div>
      ${records.map(recordCard).join("") || `<div class="empty-state">Belum ada hasil triase untuk pasien ini.</div>`}
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Profil Pasien</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Total Triase</div><div class="v">${records.length}×</div></div>
          <div class="detail-field"><div class="k">Terakhir</div><div class="v">${records[0] ? esc(URGENCY[records[0].diagnosis.triage_assessment.urgency_level].label) : "—"}</div></div>
          <div class="detail-field"><div class="k">Kode Akses</div><div class="v">${p.accessCode ? esc(p.accessCode) : "Belum dibuat"}</div></div>
          <div class="detail-field"><div class="k">Terdaftar</div><div class="v">${fmtDate(p.createdAt)}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Aksi</div>
        <a class="btn btn-accent btn-block" href="#/nakes/triase">＋ Triase Baru utk Pasien Ini</a>
      </div>
    </div>
    </div>
  `;
}

// ============================================================
// ADMIN — DASHBOARD
// ============================================================
async function renderAdminDashboard() {
  const [s, audit, users, records] = await Promise.all([
    store.stats(), store.listAudit(), store.listUsers(), store.listRecords(),
  ]);
  const dist = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  records.forEach((r) => dist[r.diagnosis.triage_assessment.urgency_level]++);

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Super Admin · Pengawasan Sistem</div>
      <h1 class="page-title">Statistik <span class="accent">Global</span></h1>
      <p class="page-sub">Pantauan seluruh aktivitas triase, pengguna, dan integritas data lintas Puskesmas.</p>
    </div>

    <div class="stats-row">
      <div class="stat"><div class="stat-value">${s.totalScreenings}</div><div class="stat-label">Total Triase</div></div>
      <div class="stat"><div class="stat-value accent">${users.filter((u) => u.role === "nakes" && u.active).length}</div><div class="stat-label">Nakes Aktif</div></div>
      <div class="stat"><div class="stat-value">${s.totalPatients}</div><div class="stat-label">Pasien Terdaftar</div></div>
      <div class="stat"><div class="stat-value warn">${audit.length}</div><div class="stat-label">Entri Audit</div></div>
      <div class="stat"><div class="stat-value danger">${s.emergencies}</div><div class="stat-label">Kegawatdaruratan</div></div>
    </div>

    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Aktivitas Terbaru (Audit)</div>
        <div class="patient-list">
          ${audit.slice(0, 6).map(auditRow).join("")}
        </div>
        <a class="btn" href="#/admin/audit" style="margin-top:1.1rem">Lihat Semua Audit Log →</a>
      </div>
    </div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Distribusi Tingkat Urgensi</div>
        <div class="detail-grid">
          ${Object.entries(URGENCY).map(([key, u]) => `
            <div class="detail-field"><div class="k">${esc(u.label)}</div><div class="v">${dist[key]} kasus</div></div>`).join("")}
        </div>
      </div>
    </div>
    </div>
  `;
}

function auditRow(a) {
  return `
    <div class="patient-item" style="cursor:default">
      <div class="patient-info">
        <div class="patient-name">${esc(a.action.replaceAll("_", " "))}</div>
        <div class="patient-meta">${esc(a.actor)} (${esc(a.role)}) → ${esc(a.target)} · ${esc(a.detail)}</div>
      </div>
      <div class="badges"><span class="badge badge-neutral">${fmtDate(a.at)}</span></div>
    </div>`;
}

// ============================================================
// ADMIN — AUDIT LOG
// ============================================================
async function renderAudit() {
  const audit = await store.listAudit();
  const actions = [...new Set(audit.map((a) => a.action))];

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Audit & Kepatuhan</div>
      <h1 class="page-title">Audit <span class="accent">Log</span></h1>
      <p class="page-sub">Seluruh aktivitas penting tercatat: login, triase, akses pasien, perubahan data.</p>
    </div>
    <div class="card">
      <div class="card-title">Filter</div>
      <select id="a-filter"><option value="">Semua aktivitas</option>
        ${actions.map((a) => `<option>${esc(a)}</option>`).join("")}</select>
    </div>
    <div class="patient-list" id="a-list"></div>
  `;

  const renderRows = (f = "") => {
    document.getElementById("a-list").innerHTML =
      audit.filter((a) => !f || a.action === f).map(auditRow).join("") ||
      `<div class="empty-state">Tidak ada entri.</div>`;
  };
  renderRows();
  document.getElementById("a-filter").addEventListener("change", (e) => renderRows(e.target.value));
}

// ============================================================
// ADMIN — MANAJEMEN USER
// ============================================================
async function renderUsers() {
  const users = await store.listUsers();

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Manajemen Akses</div>
      <h1 class="page-title">Akun <span class="accent">Nakes</span></h1>
      <p class="page-sub">Kelola akun tenaga kesehatan dan hak akses per Puskesmas.</p>
    </div>
    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Daftar Akun</div>
        <div class="patient-list">
          ${users.map((u) => `
            <div class="patient-item" style="cursor:default">
              <div class="patient-info">
                <div class="patient-name">${esc(u.name)}</div>
                <div class="patient-meta">${esc(u.email)} · ${esc(u.puskesmas)} · ${esc(u.role)}</div>
              </div>
              <div class="badges">
                ${u.active ? `<span class="badge badge-ringan">Aktif</span>` : `<span class="badge badge-kritis">Nonaktif</span>`}
                ${u.role !== "admin" ? `<button class="btn" style="min-height:38px;padding:0.4rem 0.9rem" data-toggle="${u.uid}">${u.active ? "Nonaktifkan" : "Aktifkan"}</button>` : ""}
              </div>
            </div>`).join("")}
        </div>
      </div>
    </div>
    <div>
      <div class="card">
        <div class="card-title">Tambah Akun Nakes</div>
        <form id="u-form" class="form-grid">
          <div class="full"><label>Nama</label><input id="u-name" required placeholder="cth. Ns. Rina" /></div>
          <div class="full"><label>Email</label><input id="u-email" type="email" required placeholder="rina@puskesmas.go.id" /></div>
          <div class="full"><label>Puskesmas</label><input id="u-pkm" required placeholder="cth. Puskesmas Mawar" /></div>
          <div class="full"><button class="btn btn-accent btn-block">＋ Tambah Akun</button></div>
        </form>
      </div>
    </div>
    </div>
  `;

  document.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const u = users.find((x) => x.uid === btn.dataset.toggle);
      await store.saveUser({ ...u, active: !u.active });
      toast(`Akun ${u.name} ${u.active ? "dinonaktifkan" : "diaktifkan"}.`);
      renderUsers();
    })
  );

  document.getElementById("u-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await store.saveUser({
        name: document.getElementById("u-name").value.trim(),
        email: document.getElementById("u-email").value.trim(),
        puskesmas: document.getElementById("u-pkm").value.trim(),
        role: "nakes", active: true,
      });
      toast(res?.tempPassword
        ? `✓ Akun dibuat. Password sementara: ${res.tempPassword} — catat & sampaikan ke nakes.`
        : "✓ Akun nakes ditambahkan.", 8000);
      renderUsers();
    } catch (err) {
      console.error(err);
      toast(err.message || "Gagal menambahkan akun.");
    }
  });
}

// ============================================================
// ADMIN — ARSIP REKAM MEDIS
// ============================================================
async function renderArsip() {
  const [records, patients] = await Promise.all([store.listRecords(), store.listPatients()]);
  const pOf = (id) => patients.find((p) => p.id === id);

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Arsip · Akses Diawasi</div>
      <h1 class="page-title">Arsip <span class="accent">Rekam Medis</span></h1>
      <p class="page-sub">Akses penuh untuk keperluan audit. Setiap pembukaan arsip tercatat di audit log.</p>
    </div>
    <div class="card">
      <div class="card-title">Cari</div>
      <input id="ar-search" placeholder="Nama pasien / NIK / puskesmas…" />
    </div>
    <div class="patient-list" id="ar-list"></div>
  `;

  const renderRows = (kw = "") => {
    const rows = records.filter((r) => {
      const p = pOf(r.patientId);
      return !kw || p?.name.toLowerCase().includes(kw) || p?.nik.includes(kw) || (r.puskesmas || "").toLowerCase().includes(kw);
    });
    document.getElementById("ar-list").innerHTML = rows.map((r) => {
      const p = pOf(r.patientId);
      return `
      <a class="patient-item ${r.diagnosis.triage_assessment.is_emergency ? "kritis" : ""}" href="#/admin/arsip/${r.id}">
        <div class="patient-info">
          <div class="patient-name">${esc(p?.name || r.patientId)}</div>
          <div class="patient-meta">${esc(r.puskesmas || "")} · ${fmtDate(r.createdAt)}</div>
        </div>
        <div class="badges">${urgencyBadge(r.diagnosis.triage_assessment.urgency_level)}</div>
      </a>`;
    }).join("") || `<div class="empty-state">Tidak ada arsip yang cocok.</div>`;
  };
  renderRows();
  document.getElementById("ar-search").addEventListener("input", (e) => renderRows(e.target.value.toLowerCase()));
}

async function renderArsipDetail(rid) {
  const records = await store.listRecords();
  const r = records.find((x) => x.id === rid);
  if (!r) { $app.innerHTML = `<div class="empty-state">Arsip tidak ditemukan.</div>`; return; }
  const p = await store.getPatient(r.patientId);
  await store.logAudit("LIHAT_ARSIP", `${p?.name} (${r.patientId})`, `Membuka arsip ${rid}`);

  $app.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Arsip · ${fmtDate(r.createdAt)}</div>
      <h1 class="page-title">${esc(p?.name || "Pasien")}</h1>
      <p class="page-sub">NIK ${esc(p?.nik || "—")} · ${esc(r.puskesmas || "")} — akses arsip ini telah dicatat di audit log.</p>
    </div>
    <div class="split">
    <div>${recordCard(r)}</div>
    <div>
      <div class="card card-dark">
        <div class="card-title">Metadata</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">ID Rekam</div><div class="v">${esc(r.id)}</div></div>
          <div class="detail-field"><div class="k">Sesi Triase</div><div class="v">${esc(r.sessionId)}</div></div>
          <div class="detail-field"><div class="k">Nakes</div><div class="v">${esc(r.nakesUid)}</div></div>
        </div>
      </div>
      <a class="btn" href="#/admin/arsip">← Kembali ke Arsip</a>
    </div>
    </div>
  `;
}

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW gagal:", e));
}

route();
