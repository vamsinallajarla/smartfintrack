// Minimal service worker: lets the app install as a PWA and open its shell offline.
// Network first (so updates always arrive), cache as the fallback. Firebase/Google calls are never cached.
const CACHE = "smartfintrack-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)); } return res; })
      .catch(() => caches.match(r).then((m) => m || (r.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
