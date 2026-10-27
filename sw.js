// Offline support: cache the app shell, network-first so updates arrive.
const CACHE = "arribada-v1";
const FILES = ["./", "index.html", "app.css", "icon.svg", "manifest.webmanifest",
  "js/app.js", "js/scoring.js", "js/checks.js", "js/vision.js", "js/digits.js", "model/digits.json"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
