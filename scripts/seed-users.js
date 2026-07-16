// ============================================================
// SEED USERS — bootstrap akun pertama (jalankan SEKALI dari laptop Anda)
//
// Membuat:
//   • 1 Super Admin  (email/password di CONFIG bawah)
//   • 1 Nakes contoh
// lengkap dengan custom claims `role` (dipakai firestore.rules & Functions)
// dan profil di koleksi `users`.
//
// Cara pakai:
//   1. Firebase Console → Project Settings → Service accounts
//      → Generate new private key → simpan sbg scripts/serviceAccount.json
//      (JANGAN pernah di-commit / dibagikan)
//   2. cd scripts && npm install
//   3. node seed-users.js
//   4. Ganti password kedua akun setelah login pertama!
// ============================================================

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

// ---------- GANTI SESUAI KEBUTUHAN ----------
const SEED = [
  {
    email: "admin@puskesmas.go.id",
    password: "GantiSegera#2026",
    name: "Admin Dinkes",
    role: "admin",
    puskesmas: "-",
  },
  {
    email: "nakes@puskesmas.go.id",
    password: "GantiSegera#2026",
    name: "Ns. Dewi Lestari",
    role: "nakes",
    puskesmas: "Puskesmas Cempaka",
  },
];
// --------------------------------------------

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function seedUser({ email, password, name, role, puskesmas }) {
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    console.log(`• ${email} sudah ada (${user.uid}) — memperbarui claims/profil.`);
  } catch {
    user = await admin.auth().createUser({ email, password, displayName: name });
    console.log(`• ${email} dibuat (${user.uid}).`);
  }

  await admin.auth().setCustomUserClaims(user.uid, { role, name, puskesmas });
  await db.collection("users").doc(user.uid).set(
    {
      name, email, role, puskesmas, active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`  ↳ claims role=${role} + profil users/${user.uid} tersimpan.`);
}

(async () => {
  for (const u of SEED) await seedUser(u);
  console.log("\n✅ Seed selesai. PENTING:");
  console.log("   1. Login & ganti password kedua akun.");
  console.log("   2. Hapus/simpan aman scripts/serviceAccount.json.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
