const CACHE_NAME = "fa-hypertrophy-v37";
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
    // Only this app's caches: github.io is one origin for every project on it.
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("fa-hypertrophy-") && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache first, and the cache is only ever written with files of its own
// version, a whole set at a time: at install, and by refill() below.
// Writing single fresh network responses into it while the app runs
// (stale-while-revalidate, the earlier version) could leave one cache
// holding files from two versions: a deploy lands, half the modules
// revalidate, the signal drops, and the next offline launch links a new
// module against an old one and shows a blank page. A new version arrives
// whole or not at all: the browser re-checks sw.js, the new worker
// precaches everything under a new CACHE_NAME, and activate drops the old
// cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // A cache that cannot be read (storage blocked) falls through to the network.
  const cached = caches.open(CACHE_NAME).then((cache) => cache.match(event.request, { ignoreSearch: true })).catch(() => undefined);
  event.respondWith(cached.then((hit) => hit || fetch(event.request)));
  if (isAsset(event.request.url)) event.waitUntil(cached.then((hit) => hit || refill()));
});

const ASSET_URLS = new Set(ASSETS.map((url) => new URL(url, self.location).href));
function isAsset(requestUrl) {
  const url = new URL(requestUrl);
  url.search = "";
  url.hash = "";
  return ASSET_URLS.has(url.href);
}

// A browser can drop a cache, or one entry of it, and keep the worker
// (WebKit can remove caches left unopened for a few weeks). Install never runs
// again for the same CACHE_NAME, so without this the app would load from
// the network from then on and stop starting offline. A missing precached
// file therefore fetches the whole set again, into a scratch cache first:
// addAll writes all of it or nothing, and the set is copied over only when
// its js/version.js is this worker's version. Files of a newer deploy are
// left to that deploy's own worker, so one cache never mixes two versions;
// once such a deploy is seen this worker stops refilling (newerDeploy), or
// every later miss would fetch the whole set again only to drop it.
let refilling = null;
let newerDeploy = false;
function refill() {
  if (newerDeploy) return Promise.resolve();
  const scratch = `${CACHE_NAME}-refill`;
  refilling = refilling || (async () => {
    try {
      const fresh = await caches.open(scratch);
      await fresh.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })));
      const version = await (await fresh.match("js/version.js")).text();
      if ((version.match(/APP_VERSION\s*=\s*(\d+)/) || [])[1] !== CACHE_NAME.match(/\d+$/)[0]) {
        newerDeploy = true;
        return;
      }
      const cache = await caches.open(CACHE_NAME);
      for (const request of await fresh.keys()) await cache.put(request, await fresh.match(request));
    } catch {
      // No connection, or a file missing on the server: try again at the next miss.
    } finally {
      await caches.delete(scratch).catch(() => {});
      refilling = null;
    }
  })();
  return refilling;
}
