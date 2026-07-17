/* Service Worker — app shell cache-first agar PWA tetap terbuka tanpa sinyal.
   Mode demo sepenuhnya offline; mode Firebase memakai persistence sendiri. */

const CACHE_NAME = "ophthalmo-ai-shell-v10";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/store.js",
  "./js/firebase-config.js",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Jangan intersep kanal Firestore/Auth — SDK mengelola koneksinya sendiri
  // (long-polling/streaming rusak jika dilewatkan ke cache).
  if (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  // App shell + font + SDK gstatic: cache-first, isi cache dari jaringan saat ada.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchAndCache = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline & belum di-cache → biarkan gagal ke cached (bisa undefined)
      return cached || fetchAndCache;
    })
  );
});
