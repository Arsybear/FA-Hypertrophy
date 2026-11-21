const CACHE_NAME = "fa-hypertrophy-v28";
const ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "js/main.js",
  "js/store.js",
  "js/schedule.js",
  "js/progression.js",
  "js/ui.js",
  "js/workout.js",
  "js/chart.js",
  "js/version.js",
  "js/views/today.js",
  "js/views/program.js",
  "js/views/history.js",
  "js/views/settings.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/icon.svg",
  "icons/mark.svg",
];

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's HTTP cache (GitHub Pages lets it keep
  // files for 10 minutes), so a new version never precaches a mix of old and
  // new files.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fetchPromise;
    })
  );
});
