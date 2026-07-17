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

import { store, currentUser, URGENCY, ACTIONS, SYMPTOM_QUESTIONS } from "./store.js";

// Unregister Service Worker agar cache tidak memblokir update
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) r.unregister();
  });
  caches.keys().then((keys) => {
    keys.forEach((k) => caches.delete(k));
  });
}

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

const getAction = (a) => {
  if (a === "HOME_CARE") return ACTIONS.SELF_CARE;
  if (a === "CLINIC_VISIT") return ACTIONS.DOCTOR_CONSULT;
  return ACTIONS[a] || ACTIONS.SELF_CARE;
};

const urgencyBadge = (u) => `<span class="badge badge-${URGENCY[u].badge}">${esc(URGENCY[u].label)}</span>`;
const actionBadge = (a) => `<span class="badge badge-${getAction(a).badge}">${esc(getAction(a).label)}</span>`;
const confPct = (c) => `${Math.round(c * 100)}%`;

// ---------- indikator koneksi ----------
function renderConnection() {
  const online = navigator.onLine;
  if ($connDot) $connDot.className = "dot " + (online ? "online" : "offline");
  if ($connLabel) $connLabel.textContent = online ? "Online" : "Offline";
}
window.addEventListener("online", renderConnection);
window.addEventListener("offline", renderConnection);
renderConnection();

// ---------- indikator role + nav dinamis ----------
function renderChrome() {
  const u = currentUser();
  const statusCluster = document.getElementById("status-cluster");

  if (u) {
    // Logged in: right cluster = CTA + avatar
    statusCluster.innerHTML = `
      <button style="background: #0033a0; color: #fff; border: none; padding: 0.5rem 1.2rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.5rem;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Unduh PDF
      </button>
      <button style="background: none; border: none; color: #555; cursor: pointer; padding: 0.4rem; display: flex;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
      </button>
      <button style="background: none; border: none; color: #555; cursor: pointer; padding: 0.4rem; display: flex;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </button>
      <a href="#logout" data-logout="1" style="width: 34px; height: 34px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid #e5e7eb; flex-shrink:0; margin-left: 0.5rem" title="Logout — ${esc(u.name)}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" style="margin-top:2px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
      </a>
    `;
  } else {
    // Not logged in: right cluster = subtle Super Admin button
    statusCluster.innerHTML = `
      <a href="#/login" style="display: flex; align-items: center; gap: 0.4rem; padding: 0.38rem 0.85rem; border: 1px solid rgba(0,0,0,0.12); border-radius: 999px; font-size: 0.68rem; font-weight: 700; color: var(--text-dim); text-decoration: none; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; transition: border-color 0.15s, color 0.15s;" onmouseover="this.style.borderColor='#111'; this.style.color='#111'" onmouseout="this.style.borderColor='rgba(0,0,0,0.12)'; this.style.color='var(--text-dim)'">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.029 10 8 10c-2.029 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>
        Super Admin
      </a>
    `;
  }

  const links = !u
    ? [["#/", "CEK REKAM MEDIS"], ["#/about", "About"], ["#/login", "Login Nakes"]]
    : u.role === "nakes"
      ? [["#/nakes", "Dashboard"], ["#/nakes/triase", "New Triage"], ["#/nakes/pasien", "Patient Records"]]
      : [["#/admin", "Dashboard"], ["#/admin/audit", "Audit Log"], ["#/admin/users", "Users"], ["#/admin/arsip", "Arsip"]];

  const hash = location.hash || "#/";
  const $nav = document.getElementById("nav");
  $nav.innerHTML = links
    .map(([href, label]) => {
      const active = hash === href || (href !== "#/" && hash.startsWith(href));
      return `<a href="${href}" class="${active ? "active" : ""}">${label}</a>`;
    })
    .join("");

  // Logout handler on avatar
  statusCluster.querySelector("[data-logout]")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await store.logout();
    scr = null;
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


  if (hash.startsWith("#/login"))       return renderLogin();
  if (hash.startsWith("#/about"))        return renderAbout();
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



// ============================================================
// ABOUT PAGE
// ============================================================
function renderAbout() {
  $app.innerHTML = `
    <div class="page-header" style="text-align:center; padding: 3.5rem 2.4rem;">
      <div class="eyebrow">Tentang Kami</div>
      <h1 class="page-title" style="font-size: clamp(2.2rem,5vw,4.5rem);">OPHTHALMO<span class="accent">-AI</span></h1>
      <p class="page-sub" style="margin: 1rem auto 0; max-width: 580px;">Sistem Pakar Triase Kegawatdaruratan Mata berbasis Kecerdasan Buatan untuk fasilitas kesehatan primer Indonesia.</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <div class="card">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">🔬</div>
        <div class="card-title">Misi Kami</div>
        <p style="color: var(--text-dim); line-height: 1.7; font-size: 0.95rem;">Mendemokratisasi akses terhadap layanan triase mata berkualitas tinggi di fasilitas kesehatan primer melalui teknologi AI mutakhir — sehingga setiap pasien mendapatkan penanganan yang tepat waktu dan tepat sasaran.</p>
      </div>
      <div class="card">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">🤖</div>
        <div class="card-title">Teknologi</div>
        <p style="color: var(--text-dim); line-height: 1.7; font-size: 0.95rem;">Menggabungkan <strong>Computer Vision</strong> untuk deteksi mikro-patologi mata dari foto, dengan <strong>LLM (Gemini AI)</strong> untuk penalaran klinis mendalam — menghasilkan diagnosis yang komprehensif dan dapat dipercaya.</p>
      </div>
      <div class="card">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">🏥</div>
        <div class="card-title">Untuk Siapa</div>
        <p style="color: var(--text-dim); line-height: 1.7; font-size: 0.95rem;"><strong>Tenaga Kesehatan (Nakes)</strong> di Puskesmas mendapat alat bantu triase berbasis AI. <strong>Dinas Kesehatan (Dinkes)</strong> dapat memantau data secara real-time. <strong>Pasien</strong> dapat mengakses rekam medis secara mandiri dan aman.</p>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <!-- Card Alur Kerja -->
      <div class="card" style="padding: 2.5rem; margin-bottom: 0;">
        <div class="eyebrow" style="margin-bottom: 0.8rem;">Alur Kerja Sistem</div>
        <h2 style="font-size: 1.8rem; font-weight: 800; margin-bottom: 1.5rem; letter-spacing: -0.02em;">DARI FOTO MATA<br>KE TRIASE FINAL</h2>
        <ol style="list-style: none; display: flex; flex-direction: column; gap: 1.1rem; padding: 0;">
          ${["Nakes memfoto kondisi mata pasien", "Computer Vision menganalisis mikropatologi (edema, kekeruhan, hiperemia)", "Nakes mengisi keluhan klinis tambahan", "Ophthalmo-AI menyusun triase, protokol darurat & rekomendasi", "Hasil tersimpan di rekam medis digital — pasien dapat akses mandiri"].map((s, i) => `
          <li style="display: flex; gap: 1rem; align-items: flex-start;">
            <span style="background: var(--accent); color: #fff; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.78rem; flex-shrink:0;">${i+1}</span>
            <span style="color: var(--text-dim); font-size: 0.95rem; padding-top: 0.15rem;">${s}</span>
          </li>`).join("")}
        </ol>
      </div>

      <!-- Card Keunggulan -->
      <div class="card card-dark" style="padding: 2.5rem; margin-bottom: 0; display: flex; flex-direction: column;">
        <div class="eyebrow" style="margin-bottom: 0.8rem; color: #9ca3af;">Keunggulan</div>
        <h2 style="font-size: 1.8rem; font-weight: 800; margin-bottom: 1.5rem; letter-spacing: -0.02em; color: #fff;">FITUR UNGGULAN SYSTEM</h2>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem;">
          ${["Triase berbasis AI terpercaya (bukan sekedar chatbot)", "Protokol kegawatdaruratan golden hour otomatis", "Rekam medis digital terenkripsi di Firebase", "Dashboard analitik real-time untuk Dinkes", "Akses pasien anonim dengan kode unik"].map(x => `
          <div style="display:flex; gap: 0.8rem; align-items: center;">
            <span style="color: #4ade80; font-size: 1.1rem; font-weight: bold;">✓</span>
            <span style="font-size: 0.95rem; color: #d1d5db;">${x}</span>
          </div>`).join("")}
        </div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 2rem;">
      <a href="#/" class="btn btn-accent" style="margin-right: 1rem;">Cek Rekam Medis →</a>
      <a href="#/login" class="btn">Login Nakes</a>
    </div>
  `;
}

// ============================================================
// PORTAL PASIEN (anonim, tanpa login)
// ============================================================
async function renderPasienPortal() {
  $app.innerHTML = `
    <!-- HERO HEADER CARD (Matches satyaxbt SELECTED WORK card) -->
    <div class="page-header" style="text-align: left; padding: 3rem; margin-bottom: 2rem;">
      <div class="eyebrow" style="color: var(--accent); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 0.8rem;">PORTAL PASIEN • AKSES MANDIRI</div>
      <h1 class="page-title" style="font-size: clamp(2.2rem, 5vw, 4.2rem); font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; line-height: 1.05; margin-bottom: 1.5rem; color: var(--text);">CEK REKAM MEDIS</h1>
      <p class="page-sub" style="color: var(--text-dim); margin-top: 1rem; max-width: 48rem; font-size: 1.02rem; line-height: 1.6;">Masukkan NIK Anda beserta kode akses unik yang diberikan oleh petugas kesehatan saat pemeriksaan Puskesmas untuk mengunduh, melihat, dan mencetak laporan triase secara aman.</p>
    </div>

    <!-- WORKFLOW SECTION CARD (Matches satyaxbt SECTION A / CONTENT COLLABORATIONS style) -->
    <div class="card" style="padding: 3rem; margin-bottom: 2rem;">
      <div class="eyebrow" style="color: var(--accent); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 0.8rem;">ALUR SISTEM</div>
      <h2 style="font-size: 1.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; margin-bottom: 0.8rem; color: var(--text);">ALUR PEMERIKSAAN MATA</h2>
      <p style="color: var(--text-dim); font-size: 1rem; max-width: 48rem; margin-bottom: 2rem; line-height: 1.6;">Proses triase digital kami menggunakan model machine learning canggih terintegrasi guna memberikan analisis tercepat dan rekomendasi medis akurat.</p>
      
      <hr style="border: 0; border-top: 1px solid rgba(0,0,0,0.08); margin-bottom: 2rem;" />
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
        <!-- Langkah 1 -->
        <div style="background: #fafafa; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; padding: 1.5rem; display: flex; align-items: center; gap: 1.2rem; transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
          <div style="width: 48px; height: 48px; background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
            <svg width="18" height="18" fill="var(--accent)" viewBox="0 0 16 16"><path d="M8 0a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2H9v6a1 1 0 1 1-2 0V9H1a1 1 0 0 1 0-2h6V1a1 1 0 0 1 1-1z"/></svg>
          </div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: #111; text-transform: uppercase; letter-spacing: 0.02em;">PERIKSA MATA</div>
            <div style="font-size: 0.72rem; color: var(--text-faint); text-transform: uppercase; font-weight: 700; margin-top: 0.1rem; letter-spacing: 0.05em;">Langkah 1 • Puskesmas</div>
          </div>
        </div>
        <!-- Langkah 2 -->
        <div style="background: #fafafa; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; padding: 1.5rem; display: flex; align-items: center; gap: 1.2rem; transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
          <div style="width: 48px; height: 48px; background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
            <svg width="18" height="18" fill="var(--accent)" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-1zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-1zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-1z"/></svg>
          </div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: #111; text-transform: uppercase; letter-spacing: 0.02em;">KODE AKSES NIK</div>
            <div style="font-size: 0.72rem; color: var(--text-faint); text-transform: uppercase; font-weight: 700; margin-top: 0.1rem; letter-spacing: 0.05em;">Langkah 2 • Terima Kode</div>
          </div>
        </div>
        <!-- Langkah 3 -->
        <div style="background: #fafafa; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; padding: 1.5rem; display: flex; align-items: center; gap: 1.2rem; transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
          <div style="width: 48px; height: 48px; background: #fff; border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
            <svg width="18" height="18" fill="var(--accent)" viewBox="0 0 16 16"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>
          </div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: #111; text-transform: uppercase; letter-spacing: 0.02em;">HASIL DIAGNOSIS</div>
            <div style="font-size: 0.72rem; color: var(--text-faint); text-transform: uppercase; font-weight: 700; margin-top: 0.1rem; letter-spacing: 0.05em;">Langkah 3 • Verifikasi</div>
          </div>
        </div>
      </div>
    </div>

    <!-- FORMULIR VERIFIKASI IDENTITAS CARD -->
    <div class="card" style="padding: 3rem; margin-bottom: 2rem;">
      <div class="eyebrow" style="color: var(--accent); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 0.8rem;">VERIFIKASI INTEGRITAS</div>
      <h2 style="font-size: 1.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; margin-bottom: 0.8rem; color: var(--text);">VERIFIKASI IDENTITAS</h2>
      <p style="color: var(--text-dim); font-size: 1rem; max-width: 48rem; margin-bottom: 2rem; line-height: 1.6;">Keamanan data Anda terjamin sepenuhnya melalui sistem validasi enkripsi data end-to-end.</p>
      
      <hr style="border: 0; border-top: 1px solid rgba(0,0,0,0.08); margin-bottom: 2.5rem;" />

      <form id="access-form" style="max-width: 800px; margin: 0 auto; text-align: left;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
          <div>
            <label for="p-nik" style="font-size: 0.7rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; display: block; margin-bottom: 0.5rem; letter-spacing: 0.05em;">NIK (16 digit)</label>
            <div style="position: relative;">
              <svg style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: #aaa;" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
              <input id="p-nik" required minlength="16" maxlength="16" pattern="[0-9]{16}" placeholder="cth. 3201014455660001" inputmode="numeric" autocomplete="off" style="width: 100%; padding: 1rem 1rem 1rem 2.8rem; border: 1px solid var(--border); border-radius: 12px; font-size: 0.95rem; outline: none; background: #fafafa; font-family: inherit;" />
            </div>
          </div>
          <div>
            <label for="p-code" style="font-size: 0.7rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; display: block; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Kode Akses</label>
            <div style="position: relative;">
              <svg style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: #aaa;" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
              <input id="p-code" required placeholder="CTH. OA-XXXX-XXXX" autocomplete="off" style="width: 100%; padding: 1rem 1rem 1rem 2.8rem; border: 1px solid var(--border); border-radius: 12px; font-size: 0.95rem; outline: none; text-transform: uppercase; background: #fafafa; font-family: inherit;" />
            </div>
          </div>
        </div>

        <button type="submit" id="access-btn" class="btn btn-accent" style="width: 100%; padding: 1.2rem; border-radius: 999px; font-size: 0.88rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          LIHAT REKAM MEDIS
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/></svg>
        </button>
        
        <div style="text-align: center; margin-top: 1.5rem; font-size: 0.6rem; color: #aaa; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 0.4rem; letter-spacing: 0.05em;">
          <svg width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
          DATA TERENKRIPSI END-TO-END
        </div>
      </form>
      <div id="access-result"></div>
    </div>

    <!-- 2-COLUMN SPLIT: VIDEO PANDUAN (LEFT CARD) & HELP/SECURITY (RIGHT CARDS) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <!-- Left Card: Video Panduan -->
      <div class="card" style="display: flex; flex-direction: column;">
        <div class="eyebrow" style="color: var(--accent); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 0.8rem;">PANDUAN VISUAL</div>
        <h2 style="font-size: 1.6rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; margin-bottom: 0.8rem; color: var(--text);">DEMO PENGGUNAAN SISTEM</h2>
        <p style="color: var(--text-dim); font-size: 0.95rem; margin-bottom: 1.5rem; line-height: 1.6;">Tonton video demo singkat ini untuk mengetahui cara lengkap memasukkan NIK dan membaca hasil triase klinis Anda.</p>
        
        <hr style="border: 0; border-top: 1px solid rgba(0,0,0,0.08); margin-bottom: 1.5rem;" />
        
        <div style="border-radius: 12px; overflow: hidden; background: #eaeaea; aspect-ratio: 16/9; position: relative; border: 1px solid rgba(0,0,0,0.08);">
          <video controls style="width: 100%; height: 100%; object-fit: cover; display: block;">
            <source src="https://www.w3schools.com/html/mov_bbb.mp4" type="video/mp4">
            Browser Anda tidak mendukung tag video.
          </video>
        </div>
      </div>

      <!-- Right Column: Staged Cards (Help & Security) -->
      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        <!-- Help Card -->
        <div class="card" style="margin-bottom: 0; flex: 1; display: flex; flex-direction: column;">
          <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.6rem; color: #111; text-transform: uppercase; letter-spacing: 0.02em;">
            <svg width="18" height="18" fill="var(--accent)" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/></svg>
            Butuh Bantuan?
          </h3>
          <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: auto;">
            <a href="#" style="color: var(--text-dim); text-decoration: none; font-size: 0.9rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(0,0,0,0.04); padding-bottom: 0.6rem;">Lupa kode akses? <svg width="10" height="10" fill="#ccc" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/></svg></a>
            <a href="#" style="color: var(--text-dim); text-decoration: none; font-size: 0.9rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(0,0,0,0.04); padding-bottom: 0.6rem;">Berapa lama rekam medis tersedia? <svg width="10" height="10" fill="#ccc" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/></svg></a>
            <a href="#" style="color: var(--text-dim); text-decoration: none; font-size: 0.9rem; display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.6rem;">Cara membaca hasil triase? <svg width="10" height="10" fill="#ccc" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/></svg></a>
          </div>
          <button class="btn btn-accent btn-block" style="margin-top: 1.5rem; font-size: 0.78rem; border-radius: 999px; min-height: 44px; padding: 0.5rem 1rem;">HUBUNGI DUKUNGAN</button>
        </div>

        <!-- Security Card -->
        <div class="card" style="background-color: #fafafa; margin-bottom: 0; flex: 1; display: flex; flex-direction: column;">
          <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.8rem; display: flex; align-items: center; gap: 0.6rem; color: #111; text-transform: uppercase; letter-spacing: 0.02em;">
            <svg width="16" height="16" fill="var(--accent)" viewBox="0 0 16 16"><path d="M5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.775 11.775 0 0 1-2.517 2.453 7.159 7.159 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7.158 7.158 0 0 1-1.048-.625 11.777 11.777 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 62.456 62.456 0 0 1 5.072.56z"/></svg>
            Sistem Keamanan
          </h3>
          <p style="color: var(--text-dim); line-height: 1.5; font-size: 0.88rem; margin-bottom: auto;">Data Anda dilindungi dengan enkripsi end-to-end tingkat lanjut. Hanya Anda dan tenaga medis berwenang yang dapat mengakses informasi rekam medis ini.</p>
          <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
            <span style="font-size: 0.65rem; font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 0.4rem; letter-spacing: 0.05em;"><svg width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg> ENKRIPSI</span>
            <span style="font-size: 0.65rem; font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 0.4rem; letter-spacing: 0.05em;"><svg width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/></svg> PRIVASI</span>
          </div>
        </div>
      </div>
    </div>

    <!-- PANDUAN CEPAT (BOTTOM CARD) -->
    <div class="card" style="padding: 3rem; text-align: center; margin-bottom: 2rem;">
      <div class="eyebrow" style="color: var(--accent); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 0.8rem;">RINGKASAN CEPAT</div>
      <h2 style="font-size: 1.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; margin-bottom: 0.8rem; color: var(--text);">PANDUAN VERIFIKASI IDENTITAS</h2>
      <p style="color: var(--text-dim); font-size: 1rem; max-width: 48rem; margin: 0 auto 2.5rem auto; line-height: 1.6;">Pastikan seluruh data yang Anda masukkan sesuai dengan instruksi berikut.</p>
      
      <hr style="border: 0; border-top: 1px solid rgba(0,0,0,0.08); margin-bottom: 2.5rem;" />
      
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 4rem;">
        <div style="display: flex; align-items: center; gap: 1rem; text-align: left;">
          <svg width="24" height="24" fill="var(--accent)" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/></svg>
          <div>
            <div style="font-size: 0.88rem; font-weight: 700; color: #222; text-transform: uppercase;">INPUT NIK</div>
            <div style="font-size: 0.78rem; color: var(--text-faint);">16 Digit Sesuai KTP Anda</div>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; gap: 1rem; text-align: left;">
          <svg width="24" height="24" fill="var(--accent)" viewBox="0 0 16 16"><path d="M3.5 11.5a3.5 3.5 0 1 1 3.163-5h1.232l.702.701a.5.5 0 0 1 0 .708l-.702.701H7.728l-.344.345a.5.5 0 0 1-.708 0l-.344-.345H5.06a3.5 3.5 0 0 1-1.56 3.19zM2.5 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>
          <div>
            <div style="font-size: 0.88rem; font-weight: 700; color: #222; text-transform: uppercase;">KODE AKSES</div>
            <div style="font-size: 0.78rem; color: var(--text-faint);">Ditemukan Di Struk Pemeriksaan</div>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; gap: 1rem; text-align: left;">
          <svg width="24" height="24" fill="var(--accent)" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>
          <div>
            <div style="font-size: 0.88rem; font-weight: 700; color: #222; text-transform: uppercase;">LIHAT HASIL</div>
            <div style="font-size: 0.78rem; color: var(--text-faint);">Data Bersifat Instan &amp; Aman</div>
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
        ${records.map(r => clinicalDashboard(r, patient)).join("") || `<div class="empty-state">Belum ada hasil triase.</div>`}
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

// ---------- indikator visual rekam medis ----------
// Skala urgensi 4 tingkat; status selalu ikon + label, tak pernah warna saja.
const URGENCY_META = {
  LOW:      { label: "Rendah", cls: "u-low",  icon: "✓", desc: "Kondisi ringan — perawatan mandiri umumnya memadai" },
  MEDIUM:   { label: "Sedang", cls: "u-med",  icon: "!", desc: "Perlu pengobatan & pemantauan lanjutan" },
  HIGH:     { label: "Tinggi", cls: "u-high", icon: "▲", desc: "Segera konsultasikan ke dokter" },
  CRITICAL: { label: "Kritis", cls: "u-crit", icon: "⚠", desc: "Kegawatdaruratan — penanganan segera diperlukan" },
};
const URGENCY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const PROB_META = { Rendah: { n: 1, cls: "u-low" }, Sedang: { n: 2, cls: "u-med" }, Tinggi: { n: 3, cls: "u-crit" } };

// ---------- meta modul DR Specialist (skala ICDR 0-4) ----------
const DR_META = {
  0: { title: "Tidak Ada Retinopati Diabetik",    cls: "good",   card: "",       icon: "✓", sub: "ICDR Grade 0 — Profil risiko minimal terdeteksi.",              chips: ["Risiko Sangat Rendah", "Rujukan Tidak Diperlukan"] },
  1: { title: "Retinopati Diabetik Ringan",       cls: "good",   card: "",       icon: "!", sub: "ICDR Grade 1 — Mild NPDR terdeteksi pada citra fundus.",        chips: ["Risiko Rendah", "Kontrol Ulang 6–12 Bulan"] },
  2: { title: "Retinopati Diabetik Sedang",       cls: "warn",   card: "warn",   icon: "▲", sub: "ICDR Grade 2 — Moderate NPDR terdeteksi pada citra fundus.",    chips: ["Risiko Sedang", "Rujukan ke Sp.M"] },
  3: { title: "Retinopati Diabetik Berat",        cls: "danger", card: "danger", icon: "⚠", sub: "ICDR Grade 3 — Severe NPDR terdeteksi pada citra fundus.",      chips: ["Risiko Tinggi", "Rujukan Segera"] },
  4: { title: "Retinopati Diabetik Proliferatif", cls: "danger", card: "danger", icon: "⚠", sub: "ICDR Grade 4 — Proliferative DR terdeteksi pada citra fundus.", chips: ["Risiko Sangat Tinggi", "Rujukan Darurat < 24 Jam"] },
};
const ICDR_STEPS = ["Tidak Ada DR", "Ringan", "Sedang", "Berat", "PDR"];
const EYE_LABEL = { Kanan: "Kanan (OD)", Kiri: "Kiri (OS)", Keduanya: "Bilateral (ODS)" };
const VISION_SOURCE_LABEL = {
  "ml-endpoint": "Model CV Custom",
  "gemini-vision-real": "Gemini Vision",
  "mock-fallback": "Mock Vision",
  "fundus-dr-model": "DR Specialist",
};

// Ring keyakinan AI — ring membawa warna, angkanya memakai tinta teks
function confRing(score) {
  const pct = Math.round(score * 100);
  const r = 30, circ = 2 * Math.PI * r;
  return `
    <div class="conf">
      <div class="conf-ring" role="img" aria-label="Keyakinan AI ${pct} persen">
        <svg viewBox="0 0 72 72">
          <circle class="conf-track" cx="36" cy="36" r="${r}"/>
          <circle class="conf-fill" cx="36" cy="36" r="${r}"
            stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${(circ * (1 - score)).toFixed(2)}"/>
        </svg>
        <div class="conf-num">${pct}<span>%</span></div>
      </div>
      <div class="conf-cap">Keyakinan AI</div>
    </div>`;
}

// Meter urgensi 4 segmen — terisi s.d. tingkat aktif dgn warna tingkat tsb
function urgencyScale(level) {
  const idx = URGENCY_ORDER.indexOf(level);
  return `
    <div class="uscale" role="img" aria-label="Tingkat urgensi ${URGENCY_META[level].label}, skala ${idx + 1} dari 4">
      ${URGENCY_ORDER.map((k, i) => `
        <div class="uscale-step ${i <= idx ? "on" : ""}${i === idx ? " now" : ""}">
          <div class="uscale-bar"></div>
          <div class="uscale-label">${URGENCY_META[k].label}</div>
        </div>`).join("")}
    </div>`;
}

// Indikator probabilitas 3 titik (Rendah ● / Sedang ●● / Tinggi ●●●)
function probDots(p) {
  const m = PROB_META[p] || { n: 0, cls: "" };
  return `<span class="prob ${m.cls}" title="Probabilitas ${esc(p)}">
    ${[1, 2, 3].map((i) => `<i class="${i <= m.n ? "on" : ""}"></i>`).join("")}<b>${esc(p)}</b></span>`;
}

// kartu hasil triase ekstensif — dipakai pasien, nakes, dan arsip admin
function clinicalDashboard(r, p) {
  const d = r.diagnosis || {};
  const isNew = !!d.executive_summary;
  
  const exec = d.executive_summary || {};
  const t = d.triage_assessment || {};
  const urgencyLevel = exec.urgency_level || t.urgency_level || "LOW";
  const confVal = Math.round((exec.ai_confidence || t.confidence_score || 0) * 100);
  
  const v = r.vision || {};
  const drGrade = v.dr_grade ?? null;
  const hasDR = drGrade != null;
  const drConf = v.dr?.class_probabilities ? Math.max(...Object.values(v.dr.class_probabilities)) : null;

  const lesions = d.retinal_lesion_detection || [];
  const reasoning = d.ai_clinical_reasoning || [];
  const differentials = d.differential_diagnosis || [];
  const risks = d.risk_assessment || { disease_progression: 0, vision_threat: 0, macular_edema: 0, follow_up_compliance: 0 };
  const imgQuality = d.image_quality_assessment?.metrics || [];
  const recomms = d.clinical_recommendation || [];
  const suggestedActions = d.suggested_clinical_actions || (d.recommendations?.patient_action_plan || []);
  const timeline = d.icdr_timeline || { current_stage_index: drGrade || 0, rationale: "" };

  const age = p?.age ? `${p.age}th` : '-';
  const sex = p?.gender === 'L' ? 'Laki-laki' : 'Perempuan';
  const mrn = p?.nik ? p.nik.slice(-6) : 'XXXXXX';
  const eye = EYE_LABEL[r.symptoms?.mataTerdampak] || null;
  const imgUrl = r.fundusImageDataUrl || r.imageDataUrl || "";
  
  const gradeColor = hasDR ? (drGrade === 0 ? "good" : drGrade <= 2 ? "warn" : "danger") : "good";
  const dm = hasDR ? (DR_META[drGrade] || DR_META[4]) : null;

  const urgColor = urgencyLevel === "LOW" ? "good" : urgencyLevel === "MEDIUM" ? "warn" : "danger";

  const ringDash = 282.7;
  const ringOffset = ringDash - (ringDash * (confVal / 100));

  const labels = ["Tidak Ada DR", "Ringan", "Sedang", "Berat", "PDR"];
  let barsHtml = "";
  for (let i = 0; i < 5; i++) {
    const isActive = hasDR && i === timeline.current_stage_index;
    const isPast = hasDR && i < timeline.current_stage_index;
    const bg = isActive ? (i === 0 ? "#10b981" : i <= 2 ? "#f59e0b" : "#ef4444") : (isPast ? "#d1d5db" : "#e5e7eb");
    barsHtml += `<div style="flex:1; background:${bg}; height:8px"></div>`;
  }

  // Komponen Helper
  const riskGauge = (label, val, col) => {
    const dash = 282.7;
    const off = dash - (dash * (val / 100));
    return `<div class="risk-gauge">
      <div style="position:relative; width:64px; height:64px">
        <svg class="gauge-svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" class="gauge-circle-bg"/><circle cx="50" cy="50" r="45" class="gauge-circle-fill" stroke="${col}" stroke-dasharray="${dash}" stroke-dashoffset="${off}"/></svg>
        <div class="gauge-text">${val}</div>
      </div>
      <div class="gauge-label">${label}</div>
    </div>`;
  };

  return `
    <div class="dashboard-grid">
      <div class="dash-left">
        <!-- HEADER PASIEN -->
        <div class="dash-card" style="padding: 1.8rem">
          <div style="display:flex; justify-content:space-between; align-items:flex-start">
            <div>
              <div class="patient-name" style="font-size:1.4rem; color:#111; letter-spacing:-0.02em">${esc(p?.name || 'Pasien Anonim')}</div>
              <div class="patient-meta" style="margin-top:0.5rem; display:flex; align-items:center; gap:0.6rem; color:var(--text-dim); font-size:0.85rem">
                <span style="background:#f3f4f6; border:1px solid #e5e7eb; padding:0.2rem 0.5rem; border-radius:4px; font-weight:600; color:#374151">MRN: ${esc(mrn)}</span>
                • ${age}, ${sex} • Periksa: ${fmtDate(r.createdAt || new Date())}
              </div>
              <div style="margin-top:0.8rem; color:var(--accent); font-weight:600; font-size:0.9rem">Mata: ${eye ? esc(eye) : "Tidak diketahui"}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:0.75rem; font-weight:700; color:var(--text-faint)">Fasilitas:</div>
              <div style="font-size:0.9rem; font-weight:700; color:#111; margin-top:0.1rem">${esc(r.puskesmas || 'RSUD Kota')}</div>
            </div>
          </div>
        </div>

        <!-- EXECUTIVE SUMMARY -->
        <div class="dash-card" style="padding:2rem; border-left:4px solid ${gradeColor === 'good' ? '#10b981' : gradeColor === 'warn' ? '#f59e0b' : '#ef4444'}">
          <div style="display:flex; align-items:flex-start; justify-content:space-between">
            <div style="display:flex; gap:1.2rem; align-items:flex-start">
              <div style="width:52px; height:52px; border-radius:50%; background:${gradeColor === 'good' ? '#dcfce7' : gradeColor === 'warn' ? '#fef3c7' : '#fee2e2'}; color:${gradeColor === 'good' ? '#166534' : gradeColor === 'warn' ? '#92400e' : '#991b1b'}; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:1.5rem">
                ${hasDR ? dm.icon : (URGENCY_META[urgencyLevel] || URGENCY_META.LOW).icon}
              </div>
              <div>
                <div style="font-size:1.35rem; font-weight:700; color:${gradeColor === 'good' ? '#166534' : gradeColor === 'warn' ? '#92400e' : '#991b1b'}; margin-bottom:0.3rem; letter-spacing:-0.01em">
                  ${isNew ? esc(exec.primary_diagnosis || "Diagnosis Utama") : (hasDR ? dm.title : "Urgensi " + esc(URGENCY[urgencyLevel]?.label || "—"))}
                </div>
                <div style="font-size:0.95rem; color:var(--text-dim); margin-bottom:1.2rem">
                  ${isNew ? esc(exec.icdr_classification || "") : (hasDR ? dm.sub : (URGENCY_META[urgencyLevel] || URGENCY_META.LOW).desc)}
                </div>
                <div style="display:flex; gap:0.6rem; flex-wrap:wrap">
                  <div style="padding:0.35rem 0.7rem; border:1px solid #e5e7eb; background:#f9fafb; border-radius:6px; font-size:0.75rem; font-weight:700; color:var(--text-dim)">Urgensi: ${esc(urgencyLevel)}</div>
                  <div style="padding:0.35rem 0.7rem; border:1px solid #e5e7eb; background:#f9fafb; border-radius:6px; font-size:0.75rem; font-weight:700; color:var(--text-dim)">Rujukan: ${esc(isNew ? exec.referral_recommendation : (r.diagnosis?.recommendations?.doctor_referral_details?.specialist_needed || "—"))}</div>
                </div>
              </div>
            </div>
            
            <div style="display:flex; flex-direction:column; align-items:center">
              <div style="position:relative; width:86px; height:86px">
                <svg width="86" height="86" viewBox="0 0 100 100" style="transform:rotate(-90deg)">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" stroke-width="8"/>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent)" stroke-width="8" stroke-dasharray="282.7" stroke-dashoffset="${ringOffset}" stroke-linecap="round"/>
                </svg>
                <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:1.6rem; font-weight:800; color:var(--accent); letter-spacing:-0.02em">
                  ${confVal}<span style="font-size:1rem">%</span>
                </div>
              </div>
              <div style="font-size:0.65rem; font-weight:700; color:var(--text-faint); margin-top:0.6rem; text-transform:uppercase; letter-spacing:0.05em">Keyakinan AI</div>
            </div>
          </div>
          
          ${hasDR ? `
          <div style="margin-top:2.5rem">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.6rem; font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em">
              ${labels.map((l, i) => `<span style="color:${i === timeline.current_stage_index ? (i === 0 ? '#166534' : i <= 2 ? '#92400e' : '#991b1b') : '#6b7280'}; width:20%; text-align:${i===0?'left':i===4?'right':'center'}">${l}</span>`).join("")}
            </div>
            <div style="display:flex; height:10px; border-radius:999px; overflow:hidden; gap:2px">
              ${barsHtml}
            </div>
            ${timeline.rationale ? `<div style="margin-top:0.8rem; font-size:0.85rem; color:var(--text-dim)"><b>Alasan Tahap:</b> ${esc(timeline.rationale)}</div>` : ""}
          </div>` : ""}
        </div>

        <!-- RISK ASSESSMENT & DIFFERENTIAL DIAGNOSIS -->
        ${isNew ? `
        <div class="split-panels" style="margin-top:1.5rem">
          <div class="dash-card" style="margin-bottom:0; padding:1.8rem">
            <div style="display:flex; align-items:center; gap:0.6rem; font-size:1.1rem; font-weight:700; color:#111; margin-bottom:1.5rem">
              <svg width="20" height="20" fill="var(--accent)" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-4A.5.5 0 0 1 8 4z"/></svg>
              Penilaian Risiko
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem 1rem">
              ${riskGauge("Perburukan Penyakit", risks.disease_progression, risks.disease_progression > 60 ? "#ef4444" : "#f59e0b")}
              ${riskGauge("Ancaman Penglihatan", risks.vision_threat, risks.vision_threat > 50 ? "#ef4444" : "#10b981")}
              ${riskGauge("Risiko Edema Makula", risks.macular_edema, risks.macular_edema > 40 ? "#ef4444" : "#f59e0b")}
              ${riskGauge("Kepatuhan Kontrol", risks.follow_up_compliance, risks.follow_up_compliance < 50 ? "#ef4444" : "#10b981")}
            </div>
          </div>
          
          <div class="dash-card" style="margin-bottom:0; padding:1.8rem">
            <div style="display:flex; align-items:center; gap:0.6rem; font-size:1.1rem; font-weight:700; color:#111; margin-bottom:1.5rem">
              <svg width="20" height="20" fill="var(--accent)" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z"/></svg>
              Diagnosis Banding (Differentials)
            </div>
            ${differentials.map(df => `
              <div class="diff-row">
                <div class="diff-label" title="${esc(df.rationale)}">${esc(df.condition)}</div>
                <div class="diff-bar-bg"><div class="diff-bar-fill" style="width:${df.probability}%; background:${df.probability > 70 ? '#ef4444' : df.probability > 30 ? '#f59e0b' : '#10b981'}"></div></div>
                <div class="diff-pct">${df.probability}%</div>
              </div>
            `).join("")}
          </div>
        </div>` : ""}

        <!-- DETEKSI LESI RETINA (TABEL) -->
        ${isNew ? `
        <div class="dash-card" style="margin-top:1.5rem; padding:1.8rem">
          <div style="display:flex; align-items:center; gap:0.6rem; font-size:1.1rem; font-weight:700; color:#111; margin-bottom:1rem">
            <svg width="20" height="20" fill="var(--accent)" viewBox="0 0 16 16"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>
            Deteksi Lesi Retina Khusus
          </div>
          <table class="lesion-table">
            <thead>
              <tr><th>Jenis Lesi</th><th>Status Deteksi</th><th>Severity</th><th>Confidence</th></tr>
            </thead>
            <tbody>
              ${lesions.map(ls => `
                <tr>
                  <td style="font-weight:600; color:#111">${esc(ls.lesion_type)}</td>
                  <td>${ls.detection_status === 'Detected' ? '<span style="color:#b91c1c; font-weight:700">Terdeteksi</span>' : ls.detection_status === 'Suspected' ? '<span style="color:#b45309; font-weight:700">Suspect</span>' : '<span style="color:#047857">Negatif</span>'}</td>
                  <td><span class="badge-sev ${ls.severity.toLowerCase()}">${esc(ls.severity)}</span></td>
                  <td>${Math.round(ls.confidence * 100)}%</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>` : ""}

        <!-- AI CLINICAL REASONING -->
        <div class="dash-card" style="margin-top:1.5rem; padding:1.8rem">
          <div style="display:flex; align-items:center; gap:0.6rem; font-size:1.1rem; font-weight:700; color:#111; margin-bottom:1.2rem">
            <svg width="20" height="20" fill="var(--accent)" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2z"/><path d="M4 6.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5z"/></svg>
            Penalaran Klinis AI Transparan
          </div>
          <ul class="clinical-list" style="display:flex; flex-direction:column; gap:0.6rem">
            ${isNew ? reasoning.map(r => `
              <li>
                <span style="background:${r.is_present ? '#fee2e2' : '#dcfce7'}; color:${r.is_present ? '#dc2626' : '#059669'}; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; flex-shrink:0">${r.is_present ? '!' : '✓'}</span>
                <strong>${esc(r.feature)}:</strong> ${esc(r.description)}
              </li>
            `).join("") : (r.diagnosis?.clinical_analysis?.danger_signs_present || []).map(x => `<li><span style="background:#fee2e2; color:#dc2626; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; flex-shrink:0">!</span> ${esc(x)}</li>`).join("")}
          </ul>
        </div>
        
        <!-- SARAN TINDAKAN & REKOMENDASI KLINIS -->
        <div class="split-panels" style="margin-top:1.5rem">
          <!-- Suggested Clinical Actions Workflow -->
          <div class="dash-card" style="margin-bottom:0; padding:1.8rem">
            <div style="display:flex; align-items:center; gap:0.6rem; font-size:1.1rem; font-weight:700; color:#111; margin-bottom:1.2rem">
              <svg width="20" height="20" fill="var(--accent)" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-1zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-1zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-1z"/></svg>
              Saran Alur Kerja Klinis (Workflow)
            </div>
            <ul class="numbered-list" style="display:flex; flex-direction:column; gap:0.6rem">
              ${suggestedActions.map((a, i) => `<li><div class="num-badge">${i+1}</div>${esc(a)}</li>`).join("") || `<li>Tidak ada rencana tindakan tercatat.</li>`}
            </ul>
          </div>

          <!-- Clinical Recommendations (Status) -->
          <div class="dash-card" style="margin-bottom:0; padding:1.8rem">
            <div style="display:flex; align-items:center; gap:0.6rem; font-size:1.1rem; font-weight:700; color:#111; margin-bottom:1.2rem">
              <svg width="20" height="20" fill="var(--accent)" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8zm15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-8.5-4a.5.5 0 0 1 1 0v3.793l2.854 2.853a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1-.146-.353V4z"/></svg>
              Rekomendasi Berbasis Bukti
            </div>
            ${isNew ? recomms.map(rc => `
              <div style="display:flex; align-items:center; padding:0.75rem 0; border-bottom:1px solid #f3f4f6">
                <div style="font-weight:600; font-size:0.9rem; color:#374151" title="${esc(rc.evidence_based_rationale)}">${esc(rc.action)}</div>
                <div class="rec-badge ${rc.status === 'Indicated' ? 'indicated' : rc.status === 'Optional' ? 'optional' : 'not-recommended'}">${esc(rc.status)}</div>
              </div>
            `).join("") : `<div class="empty-state" style="padding:1rem; font-size:0.8rem">Rekomendasi khusus belum didukung di versi ini.</div>`}
          </div>
        </div>
      </div>

      <div class="dash-right">
        <!-- PENAMPIL FUNDUS & XAI -->
        <div class="dash-card" style="padding:1.5rem">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem">
            <div style="font-size:1.1rem; font-weight:700; color:#111">Penampil Fundus (Explainable AI)</div>
            <div class="viewer-toolbar" style="margin-bottom:0">
              <button class="viewer-btn" title="Zoom In"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg></button>
              <button class="viewer-btn" title="Zoom Out"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg></button>
              <button class="viewer-btn" title="Contrast/Brightness"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg></button>
              <button class="viewer-btn" title="Pan"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></button>
            </div>
          </div>
          
          <div class="fundus-viewer" style="border-radius:12px">
            ${imgUrl
              ? `<img src="${imgUrl}" alt="Citra mata pasien" style="border-radius:12px" />`
              : `<div style="min-height:240px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:0.85rem;text-align:center;padding:1.5rem;line-height:1.6">${hasDR ? "Citra fundus telah dianalisis —<br>file tidak diarsipkan." : "Tidak ada citra tersimpan<br>untuk pemeriksaan ini."}</div>`}
            <div class="fundus-overlay" style="background:none; text-shadow:0 1px 3px rgba(0,0,0,0.8); font-size:0.85rem">${eye ? esc(eye) : "OD"} • 45°</div>
          </div>
          
          <div class="viewer-tabs" style="gap:0.4rem">
            <div class="v-tab active" style="border-radius:999px; padding:0.4rem 1rem">Original Image</div>
            <div class="v-tab" style="border-radius:999px; padding:0.4rem 1rem">AI Heatmap</div>
            <div class="v-tab" style="border-radius:999px; padding:0.4rem 1rem">Lesion Overlay</div>
            <div class="v-tab" style="border-radius:999px; padding:0.4rem 1rem">Vessel Seg.</div>
            <div class="v-tab" style="border-radius:999px; padding:0.4rem 1rem">Macular Marker</div>
          </div>

          <!-- KUALITAS CITRA -->
          ${isNew && imgQuality.length > 0 ? `
          <div style="margin-top:1.5rem; margin-bottom:1.5rem">
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-faint); margin-bottom:0.8rem; text-transform:uppercase; letter-spacing:0.05em">Image Quality Assessment</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem 1rem">
              ${imgQuality.map(mq => `
                <div style="display:flex; flex-direction:column; font-size:0.75rem">
                  <div style="display:flex; justify-content:space-between; margin-bottom:0.2rem">
                    <span style="font-weight:600; color:#374151">${esc(mq.name)}</span>
                    <span style="color:var(--accent); font-weight:700">${mq.score}/100</span>
                  </div>
                  <div style="height:4px; background:#e5e7eb; border-radius:999px; overflow:hidden">
                    <div style="height:100%; background:${mq.score > 70 ? '#10b981' : mq.score > 40 ? '#f59e0b' : '#ef4444'}; width:${mq.score}%"></div>
                  </div>
                </div>
              `).join("")}
            </div>
            ${d.image_quality_assessment.affects_confidence ? `<div style="margin-top:0.6rem; font-size:0.7rem; color:#dc2626; font-weight:600">⚠ Kualitas gambar rendah berpotensi memengaruhi keyakinan AI.</div>` : ""}
          </div>` : ""}
          
          <div style="font-size:0.75rem; font-weight:700; color:var(--text-faint); margin:1.5rem 0 0.5rem; text-transform:uppercase; letter-spacing:0.05em">Ophthalmologist Notes</div>
          <textarea id="dash-notes" class="clinical-notes" style="background:#f9fafb; min-height:100px" placeholder="Tambahkan observasi, koreksi hasil AI, atau finalisasi laporan...">${esc(r.nakesNotes || "")}</textarea>

          <div class="action-grid" style="display:flex; flex-direction:column; gap:0.8rem; margin-top:1.5rem">
            ${r.recordId ? `<button type="button" id="dash-notes-save" class="btn btn-full" style="background:#0033a0; color:#fff; font-size:1.05rem; border:none; text-transform:none; font-weight:600; border-radius:8px">▷ Send to EMR</button>` : ""}
            <div style="display:flex; gap:0.8rem">
              <button type="button" class="btn btn-full" style="flex:1; background:transparent; border:1px solid #0033a0; color:#0033a0; text-transform:none; font-weight:600; border-radius:8px">📥 Export DICOM</button>
              <button type="button" class="btn btn-full" style="flex:1; background:transparent; border:1px solid #0033a0; color:#0033a0; text-transform:none; font-weight:600; border-radius:8px" onclick="window.print()">🖨 Download PDF Report</button>
            </div>
            <button type="button" class="btn btn-full" style="background:transparent; border:1px solid #0033a0; color:#0033a0; text-transform:none; font-weight:600; border-radius:8px">↺ Compare Previous Exam</button>
          </div>
        </div>

        ${r.accessCode ? `
        <div class="card card-dark">
          <div class="card-title">Kode Akses Pasien — Berikan kpd Pasien</div>
          <div class="code-display">${esc(r.accessCode)}</div>
          <div class="detail-grid" style="margin-top:1rem">
            <div class="detail-field"><div class="k">Pasien</div><div class="v">${esc(p?.name || "—")}</div></div>
            <div class="detail-field"><div class="k">NIK</div><div class="v">${esc(p?.nik || "—")}</div></div>
            <div class="detail-field"><div class="k">Cara Akses</div><div class="v">Portal → NIK + Kode</div></div>
          </div>
        </div>` : ""}
      </div>
    </div>

    <!-- AI TRANSPARENCY -->
    <div style="border-top:1px solid #e5e7eb; padding-top:1rem; margin-top:2rem; display:flex; gap:2rem; font-size:0.75rem; color:var(--text-dim); flex-wrap:wrap">
      <div style="display:flex; align-items:center; gap:0.4rem"><b style="color:#374151">Nama Model AI:</b> RetiScan Ophthalmo-AI (Hybrid)</div>
      <div style="display:flex; align-items:center; gap:0.4rem"><b style="color:#374151">Versi Model:</b> 4.2.1 (FundusDRGrading-resnet50 + Gemini 2.0 Flash)</div>
      <div style="display:flex; align-items:center; gap:0.4rem"><b style="color:#374151">Dataset Pelatihan:</b> EyePACS, APTOS, DDR, Messidor</div>
      <div style="display:flex; align-items:center; gap:0.4rem"><b style="color:#374151">Resolusi Gambar Input:</b> 4K / High Res</div>
      <div style="display:flex; align-items:center; gap:0.4rem"><b style="color:#374151">Metode XAI:</b> Grad-CAM & Lesion Segmentation Mask</div>
      <div style="display:flex; align-items:center; gap:0.4rem"><b style="color:#374151">Kerangka Klasifikasi:</b> International Clinical Diabetic Retinopathy (ICDR)</div>
    </div>
  `;
}

// kartu ringkas hasil triase — dipakai portal pasien, riwayat pemeriksaan, dan arsip admin
function recordCard(r) {
  const d = r.diagnosis;
  const t = d.triage_assessment;
  const ca = d.clinical_analysis;
  const ep = d.emergency_care_protocol;
  const rec = d.recommendations;
  const um = URGENCY_META[t.urgency_level] || URGENCY_META.LOW;

  return `
    <div class="card rc ${um.cls}">
      <div class="rc-top">
        <div>
          <div class="card-title" style="margin-bottom:0.35rem">Hasil Triase</div>
          <div class="rc-date">${fmtDate(r.createdAt)}${r.puskesmas ? ` · ${esc(r.puskesmas)}` : ""}</div>
        </div>
        ${confRing(t.confidence_score)}
      </div>

      <div class="rc-status">
        <div class="rc-status-icon">${um.icon}</div>
        <div>
          <div class="rc-status-level">${um.label}</div>
          <div class="rc-status-desc">${um.desc}</div>
        </div>
        <div class="rc-action">${actionBadge(t.primary_action_category)}</div>
      </div>

      ${urgencyScale(t.urgency_level)}

      ${r.vision?.dr_label ? `
      <div class="rc-sec">Modul DR Specialist</div>
      <div class="danger-chips">
        <span class="danger-chip" style="${(r.vision.dr_grade || 0) < 2 ? "background:rgba(5,150,105,0.08);color:#059669;border-color:rgba(5,150,105,0.25)" : ""}">ICDR Grade ${r.vision.dr_grade} — ${esc(r.vision.dr_label)}</span>
      </div>` : ""}

      <p class="rc-summary">${esc(ca.synthesis_summary)}</p>

      ${ca.possible_conditions?.length ? `
      <div class="rc-sec">Kemungkinan Kondisi</div>
      <div class="cond-list">
        ${ca.possible_conditions.map((c) => `
          <div class="cond">
            <div class="cond-head">
              <div class="cond-name">${esc(c.condition_name)}</div>
              ${probDots(c.probability)}
            </div>
            <div class="cond-note">${esc(c.rationale)}</div>
          </div>`).join("")}
      </div>` : ""}

      ${ca.danger_signs_present?.length ? `
      <div class="rc-sec">Tanda Bahaya Terdeteksi</div>
      <div class="danger-chips">
        ${ca.danger_signs_present.map((x) => `<span class="danger-chip">⚠ ${esc(x)}</span>`).join("")}
      </div>` : ""}

      ${rec.patient_action_plan?.length ? `
      <div class="rc-sec">Rencana Tindakan</div>
      <ol class="plan">${rec.patient_action_plan.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}

      ${ep.requires_immediate_hospital ? `
      <div class="rc-emg">
        <div class="rc-emg-head">
          <div class="rc-emg-title">⚠ Protokol Kegawatdaruratan</div>
          <span class="golden-chip">⏱ Golden Hour: ${esc(ep.golden_hour_timeframe)}</span>
        </div>
        <div class="rc-emg-cols">
          <div>
            <div class="rc-emg-sub">Pertolongan Pertama</div>
            <ul class="emg-list do">${(ep.immediate_first_aid_instructions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          </div>
          <div>
            <div class="rc-emg-sub">Jangan Dilakukan</div>
            <ul class="emg-list dont">${(ep.what_NOT_to_do || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          </div>
        </div>
      </div>` : ""}

      <div class="rc-meta">
        <div class="detail-field"><div class="k">Saran Obat Bebas</div><div class="v">${esc(rec.safe_otc_medication_advice || "—")}</div></div>
        <div class="detail-field"><div class="k">Rujukan</div><div class="v">${rec.doctor_referral_details ? `${esc(rec.doctor_referral_details.specialist_needed)} — ${esc(rec.doctor_referral_details.examination_needed)}` : "—"}</div></div>
      </div>
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
  const [s, allMyRecords, patients] = await Promise.all([
    store.stats(), store.listRecords({ nakesUid: u.uid }), store.listPatients(),
  ]);
  const myRecords = allMyRecords.filter(r => r.diagnosis);
  const pName = (id) => patients.find((p) => p.id === id)?.name || id;

  $app.innerHTML = `
    <!-- Top Stats Row -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem; margin-bottom: 3rem; margin-top: 2rem;">
      <div style="background: #fff; padding: 2.5rem 1rem; text-align: center; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 3.5rem; font-weight: 700; color: #0052ff; margin-bottom: 0.5rem; line-height: 1;">${s.todayScreenings}</div>
        <div style="font-size: 0.7rem; font-weight: 700; color: #777; text-transform: uppercase; letter-spacing: 0.05em;">Triase Hari Ini</div>
      </div>
      <div style="background: #fff; padding: 2.5rem 1rem; text-align: center; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 3.5rem; font-weight: 700; color: #111; margin-bottom: 0.5rem; line-height: 1;">${myRecords.length}</div>
        <div style="font-size: 0.7rem; font-weight: 700; color: #777; text-transform: uppercase; letter-spacing: 0.05em;">Total Triase Saya</div>
      </div>
      <div style="background: #fff; padding: 2.5rem 1rem; text-align: center; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 3.5rem; font-weight: 700; color: #111; margin-bottom: 0.5rem; line-height: 1;">${s.totalPatients}</div>
        <div style="font-size: 0.7rem; font-weight: 700; color: #777; text-transform: uppercase; letter-spacing: 0.05em;">Pasien Terdaftar</div>
      </div>
      <div style="background: #fff; padding: 2.5rem 1rem; text-align: center; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 3.5rem; font-weight: 700; color: #e53935; margin-bottom: 0.5rem; line-height: 1;">${myRecords.filter((r) => r.diagnosis.triage_assessment.is_emergency).length}</div>
        <div style="font-size: 0.7rem; font-weight: 700; color: #777; text-transform: uppercase; letter-spacing: 0.05em;">Kegawatdaruratan</div>
      </div>
    </div>

    ${(() => {
      // Hitung data mingguan (7 hari terakhir)
      const today = new Date();
      today.setHours(0,0,0,0);
      const weeklyData = Array.from({length: 7}).map((_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        const dayStr = d.toLocaleDateString("id-ID", {weekday: 'short'});
        return { date: d, label: dayStr, count: 0 };
      });

      myRecords.forEach(r => {
        const rDate = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        if (isNaN(rDate)) return;
        rDate.setHours(0,0,0,0);
        const diffTime = today.getTime() - rDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if(diffDays >= 0 && diffDays <= 6) {
           weeklyData[6 - diffDays].count++;
        }
      });

      const maxCount = Math.max(...weeklyData.map(d => d.count), 5); // base scale at least 5

      return `
        <div style="background: #fff; margin-bottom: 3rem; border-radius: 8px; border: 1px solid #e0e0e0; padding: 2.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
          <div style="font-size: 1.15rem; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3rem;">Aktivitas Triase Mingguan</div>
          
          <div style="position: relative; height: 250px; display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 2.5rem; border-bottom: 1px solid #eaeaea;">
            <!-- Grid lines -->
            <div style="position: absolute; top: 33%; left: 0; right: 0; height: 1px; background: #f5f5f5; z-index: 0;"></div>
            <div style="position: absolute; top: 66%; left: 0; right: 0; height: 1px; background: #f5f5f5; z-index: 0;"></div>

            ${weeklyData.map(d => {
              const heightPct = (d.count / maxCount) * 100;
              return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; position: relative; z-index: 1;">
                  <div style="font-size: 0.95rem; color: #111; font-weight: 700; margin-bottom: 0.8rem;">${d.count}</div>
                  <div style="width: 100%; max-width: 48px; background: ${d.count > 0 ? '#0052ff' : 'transparent'}; border-radius: 8px 8px 0 0; height: ${Math.max(heightPct, 0)}%; transition: height 0.5s ease;"></div>
                  <div style="position: absolute; bottom: -2.5rem; font-size: 0.75rem; color: #777; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">${d.label}</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    })()}

    <!-- Bottom Features Kept -->
    <div style="display: flex; gap: 2rem; margin-top: 4rem; margin-bottom: 4rem; flex-wrap: wrap;">
      <div style="flex: 1.5; min-width: 300px; background: #fff; padding: 2.5rem; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 1.15rem; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2rem;">Triase Terakhir</div>
        <div class="patient-list" style="display:flex; flex-direction:column; gap:1.5rem;">
          ${myRecords.slice(0, 8).map((r) => `
            <a href="#/nakes/pasien/${r.patientId}" style="text-decoration:none; color:inherit; display:block; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
              <div style="font-weight:700; color:var(--text); margin-bottom:0.5rem; font-size:1.05rem;">${esc(pName(r.patientId))}</div>
              ${recordCard(r)}
            </a>`).join("") || `<div style="padding: 3rem; text-align: center; color: #888; font-weight: 600;">Belum ada riwayat triase.</div>`}
        </div>
      </div>
      
      <div style="flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 1.5rem;">
        <div style="background: #fff; padding: 2.5rem; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 1.5rem; flex: 1;">
          <div style="font-size: 1.15rem; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem;">Aksi Cepat</div>
          <a href="#/nakes/triase" style="background: #0052ff; color: #fff; padding: 1.2rem; border-radius: 8px; font-weight: 600; text-decoration: none; text-align: center; display: block; font-size: 1.05rem;">+ Mulai Triase Baru</a>
          <a href="#/nakes/pasien" style="background: #fcfcfc; color: #333; padding: 1.2rem; border-radius: 8px; font-weight: 600; text-decoration: none; text-align: center; display: block; font-size: 1.05rem; border: 1px solid #e0e0e0;">Lihat Seluruh Rekam Medis</a>
          <div style="text-align: center; font-size: 0.75rem; color: #aaa; margin-top: auto; padding-top: 2rem;">Ophthalmo-AI CDSS System</div>
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
          <div class="full hidden" id="fundus-field">
            <label for="s-fundus">2b · Upload Foto Fundus — Skrining Retinopati Diabetik (opsional)</label>
            <input id="s-fundus" type="file" accept="image/*" />
            <img id="s-fundus-preview" class="retina-preview hidden" alt="Pratinjau foto fundus" />
            <p style="margin-top:0.5rem;color:var(--text-faint);font-size:0.8rem">
              Gunakan foto dari <strong>fundus camera / oftalmoskop</strong> — bukan kamera HP biasa.
              Model DR specialist akan menghitung grade Retinopati Diabetik (0–4).</p>
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

  // Toggle field foto fundus — hanya untuk pasien dengan riwayat diabetes
  const $dm = document.getElementById("s-dm");
  const $fundusField = document.getElementById("fundus-field");
  const $fundus = document.getElementById("s-fundus");
  const syncFundusField = () => {
    const show = $dm.value === "1";
    $fundusField.classList.toggle("hidden", !show);
    if (!show) {
      scr.fundusDataUrl = null;
      $fundus.value = "";
      document.getElementById("s-fundus-preview").classList.add("hidden");
    }
  };
  $dm.addEventListener("change", syncFundusField);
  syncFundusField();

  $fundus.addEventListener("change", () => {
    const f = $fundus.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      scr.fundusDataUrl = reader.result;
      const prev = document.getElementById("s-fundus-preview");
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
      syncFundusField();
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
        fundusImageDataUrl: scr.fundusDataUrl || null,
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
  const drGrade = s.vision.dr_grade;
  const drBadgeCls = drGrade == null ? "" : drGrade === 0 ? "ringan" : drGrade <= 2 ? "sedang" : "kritis";
  document.getElementById("triase-body").innerHTML = `
    <div class="split">
    <div>
      <div class="card">
        <div class="card-title">Hasil ML Vision — Ekstraksi Fitur Visual</div>
        <div class="ai-box">
          <span class="badge badge-neutral">Kualitas Citra: ${esc(s.vision.quality)}</span>
          <span class="badge badge-neutral">${esc(s.vision.segment)}</span>
          ${drGrade != null ? `<span class="badge badge-${drBadgeCls}">Retinopati Diabetik: Grade ${drGrade} — ${esc(s.vision.dr_label || "")}</span>` : ""}
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
      ${scr.fundusDataUrl ? `<div class="card"><div class="card-title">Foto Fundus — DR Specialist</div>
        <img src="${scr.fundusDataUrl}" class="retina-preview" alt="Foto fundus pasien" /></div>` : ""}
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
      scr.symptoms = symptoms;
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
  const { diagnosis, accessCode, record } = scr.result;
  const t = diagnosis.triage_assessment;

  document.getElementById("triase-body").innerHTML = `
    ${clinicalDashboard({
      diagnosis,
      vision: scr.result?.vision || scr.session?.vision || null,
      symptoms: scr.symptoms || null,
      createdAt: new Date().toISOString(),
      puskesmas: currentUser()?.puskesmas || "Klinik Umum",
      accessCode,
      recordId: record?.id || null,
      fundusImageDataUrl: scr.fundusDataUrl || null,
      imageDataUrl: scr.imageDataUrl || null,
    }, scr.patient)}
    <div class="dash-card" style="margin-top:1.5rem">
      <div class="dash-card-title">Langkah Berikutnya</div>
      <div style="display:flex;gap:0.8rem;flex-wrap:wrap">
        <a class="btn btn-accent" href="#/nakes/pasien/${scr.patient.id}" data-reset="1">Lihat Rekam Medis Pasien</a>
        <a class="btn" href="#/nakes/triase" data-reset="1">＋ Triase Pasien Lain</a>
        <a class="btn" href="#/nakes" data-reset="1">Kembali ke Dashboard</a>
      </div>
    </div>
  `;

  // Simpan catatan oftalmologis ke rekam medis yang baru dibuat
  document.getElementById("dash-notes-save")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "⏳ Menyimpan…";
    try {
      await store.updateRecordStatus(record.id, "Selesai", document.getElementById("dash-notes").value.trim());
      toast("✓ Catatan tersimpan — kasus ditandai selesai.");
      btn.textContent = "✓ Tersimpan";
    } catch (err) {
      toast("Gagal menyimpan catatan: " + err.message);
      btn.disabled = false; btn.textContent = "✓ Simpan Catatan & Tandai Selesai";
    }
  });

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
      const isSelesai = r && r.status === "Selesai";
      return `
      <a class="patient-item ${r && r.diagnosis.triage_assessment.is_emergency ? "kritis" : ""}" href="#/nakes/pasien/${p.id}">
        <div class="patient-info">
          <div class="patient-name">${esc(p.name)}</div>
          <div class="patient-meta">NIK …${esc(p.nik.slice(-6))} · ${esc(p.age)} th ${p.historyDiabetes ? "· Riwayat DM" : ""}</div>
          ${r ? `<div style="margin-top:0.5rem; font-size:0.8rem; display:flex; gap:0.5rem; align-items:center;">
            Status: 
            <select class="status-select" data-rid="${r.id}" style="padding:0.2rem 0.5rem; border-radius:4px; border:1px solid #ccc;" onclick="event.preventDefault(); event.stopPropagation();">
              <option value="Menunggu" ${!isSelesai ? "selected" : ""}>🔴 Menunggu Tindakan</option>
              <option value="Selesai" ${isSelesai ? "selected" : ""}>🟢 Sudah Ditangani</option>
            </select>
          </div>` : ""}
        </div>
        <div class="badges">${r ? urgencyBadge(r.diagnosis.triage_assessment.urgency_level) : `<span class="badge badge-neutral">Belum ditriase</span>`}</div>
      </a>`;
    }).join("") || `<div class="empty-state">Tidak ada pasien yang cocok.</div>`;
  };
  renderList();
  document.getElementById("search").addEventListener("input", (e) => renderList(e.target.value.toLowerCase()));
  
  // Event delegation untuk dropdown status
  document.getElementById("plist").addEventListener("change", async (e) => {
    if (e.target.classList.contains("status-select")) {
      e.preventDefault();
      e.stopPropagation();
      const rid = e.target.getAttribute("data-rid");
      const newStatus = e.target.value;
      try {
        await store.updateRecordStatus(rid, newStatus);
        toast(`Status berhasil diubah menjadi: ${newStatus}`);
        // Perbarui data records di memory
        const r = records.find(x => x.id === rid);
        if (r) r.status = newStatus;
      } catch (err) {
        toast("Gagal mengubah status: " + err.message);
      }
    }
  });
}

async function renderPasienDetail(pid) {
  const [p, allRecords] = await Promise.all([store.getPatient(pid), store.listRecords({ patientId: pid })]);
  if (!p) { $app.innerHTML = `<div class="empty-state">Pasien tidak ditemukan.</div>`; return; }

  const records = allRecords.filter(r => r.diagnosis); // Hanya ambil yang sudah selesai triasenya
  const latest = records[0] || null;
  const t = latest?.diagnosis?.triage_assessment || null;
  const um = t ? (URGENCY_META[t.urgency_level] || URGENCY_META.LOW) : null;
  const ca = latest?.diagnosis?.clinical_analysis || null;
  const ep = latest?.diagnosis?.emergency_care_protocol || null;
  const rec = latest?.diagnosis?.recommendations || null;
  const vision = latest?.vision || null;
  const drGrade = vision?.dr_grade ?? null;
  const dm = drGrade != null ? (DR_META[drGrade] || DR_META[4]) : null;
  const drCol = dm ? (dm.cls === "good" ? "#059669" : dm.cls === "warn" ? "#d97706" : "#dc2626") : null;
  const drProbs = vision?.dr?.class_probabilities || null;
  const drConf = drProbs ? Math.max(...Object.values(drProbs)) : null;
  const eye = EYE_LABEL[latest?.symptoms?.mataTerdampak] || null;
  const isSelesai = latest?.status === "Selesai";

  $app.innerHTML = `
    ${latest ? clinicalDashboard(latest, p) : `<div class="empty-state">Belum ada hasil triase untuk pasien ini.</div>`}

      ${records.length > 1 ? `
      <!-- Riwayat pemeriksaan sebelumnya (fitur catatan per-rekam tetap utuh) -->
      <div id="riwayat-lama" style="margin-top:2rem">
        <div class="dash-card-title">🕐 Pemeriksaan Sebelumnya (${records.length - 1})</div>
        <div class="tl">
          ${records.slice(1).map((r) => `
          <div class="tl-item ${(URGENCY_META[r.diagnosis.triage_assessment.urgency_level] || URGENCY_META.LOW).cls}">
            ${recordCard(r)}
            <div class="card" style="margin-top: 1rem; border: 1px solid #e0e0e0; box-shadow: none;">
              <div class="card-title" style="font-size: 0.95rem; margin-bottom:0.5rem;">Tindakan Medis / Catatan Nakes</div>
              ${r.status === "Selesai" 
                ? `<div style="background:#fcfcfc; padding: 1rem; border-radius: 6px; border: 1px solid #eaeaea; font-size:0.9rem; color:#444;">${esc(r.nakesNotes || "Tidak ada catatan khusus.")}</div>
                   <div style="margin-top:0.5rem; font-size:0.8rem; color:#0052ff; cursor:pointer; font-weight:600;" onclick="this.nextElementSibling.style.display='block'; this.style.display='none';">✏️ Edit Catatan</div>
                   <form class="notes-form" data-rid="${r.id}" style="display:none; margin-top:0.8rem;">
                     <textarea class="nakes-notes" placeholder="Ketik tindakan yang diberikan..." style="width:100%; min-height:80px; padding:0.8rem; border:1px solid #ccc; border-radius:6px; margin-bottom:0.8rem; font-family:inherit;">${esc(r.nakesNotes || "")}</textarea>
                     <div style="display:flex; gap:0.5rem;">
                       <button type="submit" class="btn btn-accent" style="padding: 0.4rem 1rem; font-size:0.85rem;">Simpan Perubahan</button>
                       <button type="button" class="btn" style="padding: 0.4rem 1rem; font-size:0.85rem; background:#eee; color:#333;" onclick="this.parentElement.parentElement.style.display='none'; this.parentElement.parentElement.previousElementSibling.style.display='block';">Batal</button>
                     </div>
                   </form>` 
                : `<form class="notes-form" data-rid="${r.id}" style="margin-top: 0.5rem;">
                     <textarea class="nakes-notes" placeholder="Ketik tindakan medis darurat yang diberikan..." style="width:100%; min-height:80px; padding:0.8rem; border:1px solid #ccc; border-radius:6px; margin-bottom:0.8rem; font-family:inherit;">${esc(r.nakesNotes || "")}</textarea>
                     <button type="submit" class="btn btn-accent" style="padding: 0.5rem 1.2rem; font-size:0.9rem;">✓ Simpan & Tandai Selesai</button>
                   </form>`}
            </div>
          </div>`).join("")}
        </div>
      </div>` : ""}
    </div>

    <!-- ===== Kolom Kanan ===== -->
    <div>
      <div class="dash-card">
        <div class="dash-card-title">👁 Penampil Fundus</div>
        <div class="fundus-viewer" style="min-height:220px;display:flex;align-items:center;justify-content:center">
          <div style="color:#9ca3af;font-size:0.85rem;text-align:center;padding:1.5rem;line-height:1.6">
            ${drGrade != null
              ? "Citra fundus telah dianalisis oleh modul<br>DR Specialist (FundusDRGrading-resnet50)."
              : "Tidak ada citra fundus<br>untuk pemeriksaan ini."}
          </div>
          <div class="fundus-overlay">${eye ? esc(eye) : "Fundus"}${drGrade != null ? ` • ICDR Grade ${drGrade}` : ""}</div>
        </div>
        ${vision?.dr_label ? `<div class="dr-chips" style="margin-bottom:0"><span class="dr-chip">Grade ${drGrade}</span><span class="dr-chip">${esc(vision.dr_label)}</span></div>` : ""}
      </div>

      ${latest ? `
      <div class="dash-card">
        <div class="dash-card-title">📝 Catatan Oftalmologis</div>
        <div style="margin-bottom:0.8rem">${isSelesai ? `<span class="badge badge-ringan">🟢 Sudah Ditangani</span>` : `<span class="badge badge-pending">🔴 Menunggu Tindakan</span>`}</div>
        <form class="notes-form" data-rid="${latest.id}">
          <textarea class="clinical-notes nakes-notes" placeholder="Masukkan observasi klinis, konfirmasi temuan AI, atau tambahkan rencana perawatan di sini...">${esc(latest.nakesNotes || "")}</textarea>
          <div class="action-grid">
            <button type="submit" class="btn btn-accent btn-full">${isSelesai ? "Simpan Perubahan Catatan" : "✓ Simpan & Tandai Selesai"}</button>
          </div>
        </form>
      </div>` : ""}

      <div class="dash-card">
        <div class="action-grid">
          <a class="btn btn-accent btn-full" href="#/nakes/triase">＋ Triase Baru utk Pasien Ini</a>
          <button type="button" class="btn btn-outline" onclick="window.print()">🖨 Cetak Laporan</button>
          <button type="button" class="btn btn-outline" ${records.length > 1 ? `onclick="document.getElementById('riwayat-lama').scrollIntoView({behavior:'smooth'})"` : "disabled"}>🕐 Riwayat Lama</button>
        </div>
      </div>

      <div class="card card-dark">
        <div class="card-title">Profil Pasien</div>
        <div class="detail-grid">
          <div class="detail-field"><div class="k">Total Triase</div><div class="v">${records.length}×</div></div>
          <div class="detail-field"><div class="k">Urgensi Terakhir</div><div class="v">${records[0]
            ? `<span class="udot ${(URGENCY_META[records[0].diagnosis.triage_assessment.urgency_level] || URGENCY_META.LOW).cls}"></span>${esc(URGENCY[records[0].diagnosis.triage_assessment.urgency_level].label)}`
            : "—"}</div></div>
          <div class="detail-field"><div class="k">NIK Lengkap</div><div class="v">${esc(p.nik)}</div></div>
          <div class="detail-field"><div class="k">Kode Akses</div><div class="v">${p.accessCode ? esc(p.accessCode) : "Belum dibuat"}</div></div>
          <div class="detail-field"><div class="k">Terdaftar</div><div class="v">${fmtDate(p.createdAt)}</div></div>
        </div>
      </div>
    </div>
    </div>
  `;

  document.querySelectorAll(".notes-form").forEach(f => {
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rid = f.getAttribute("data-rid");
      const notes = f.querySelector(".nakes-notes").value.trim();
      const btn = f.querySelector("button[type='submit']");
      const oldText = btn.textContent;
      btn.textContent = "⏳ Menyimpan...";
      btn.disabled = true;
      try {
        // Status otomatis "Selesai" karena sudah ditangani/diberi catatan
        await store.updateRecordStatus(rid, "Selesai", notes);
        toast("Tindakan medis berhasil disimpan dan ditandai selesai.");
        renderPasienDetail(pid); // Refresh tampilan
      } catch (err) {
        toast("Gagal menyimpan: " + err.message);
        btn.textContent = oldText;
        btn.disabled = false;
      }
    });
  });
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

    <div class="stats-row" style="margin-bottom: 2rem;">
      <div class="stat"><div class="stat-value">${s.totalScreenings}</div><div class="stat-label">Total Triase</div></div>
      <div class="stat"><div class="stat-value accent">${users.filter((u) => u.role === "nakes" && u.active).length}</div><div class="stat-label">Nakes Aktif</div></div>
      <div class="stat"><div class="stat-value">${s.totalPatients}</div><div class="stat-label">Pasien Terdaftar</div></div>
      <div class="stat"><div class="stat-value warn">${audit.length}</div><div class="stat-label">Entri Audit</div></div>
      <div class="stat"><div class="stat-value danger">${s.emergencies}</div><div class="stat-label">Kegawatdaruratan</div></div>
    </div>

    ${(() => {
      // Hitung data mingguan Global (7 hari terakhir)
      const today = new Date();
      today.setHours(0,0,0,0);
      const weeklyData = Array.from({length: 7}).map((_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        const dayStr = d.toLocaleDateString("id-ID", {weekday: 'short'});
        return { date: d, label: dayStr, count: 0 };
      });

      records.forEach(r => {
        const rDate = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        if (isNaN(rDate)) return;
        rDate.setHours(0,0,0,0);
        const diffTime = today.getTime() - rDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if(diffDays >= 0 && diffDays <= 6) {
           weeklyData[6 - diffDays].count++;
        }
      });

      const maxCount = Math.max(...weeklyData.map(d => d.count), 5); // base scale at least 5

      return `
        <div class="card" style="margin-bottom: 2rem; border-radius: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.03);">
          <div class="card-title" style="margin-bottom: 1.5rem; font-size: 1.1rem;">Aktivitas Triase Mingguan (Global)</div>
          <div style="display: flex; align-items: flex-end; justify-content: space-between; height: 160px; padding-top: 1rem; gap: 1rem;">
            ${weeklyData.map(d => {
              const heightPct = (d.count / maxCount) * 100;
              return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 0.5rem; height: 100%;">
                  <div style="font-size: 0.8rem; color: #555; font-weight: 700;">${d.count}</div>
                  <div style="width: 100%; max-width: 50px; background: ${d.count > 0 ? 'var(--accent)' : '#eee'}; border-radius: 6px 6px 0 0; height: ${Math.max(heightPct, 3)}%; transition: height 0.5s ease;"></div>
                  <div style="font-size: 0.75rem; color: #aaa; text-transform: uppercase; font-weight: 600;">${d.label}</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    })()}

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
