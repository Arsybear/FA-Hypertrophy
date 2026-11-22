const CACHE_NAME = "fa-hypertrophy-v31";
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

// Cache first, and the cache is only ever written at install. Writing fresh
// network responses into it while the app runs (stale-while-revalidate, the
// earlier version) could leave one cache holding files from two versions: a
// deploy lands, half the modules revalidate, the signal drops, and the next
// offline launch links a new module against an old one and shows a blank
// page. A new version arrives whole or not at all: the browser re-checks
// sw.js, the new worker precaches everything under a new CACHE_NAME, and
// activate drops the old cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(event.request, { ignoreSearch: true }))
      .then((cached) => cached || fetch(event.request))
  );
});
