const CACHE = "animeav1-pwa-v1";
const CORE = ["./", "./index.html", "./theme.js", "./config.js", "./pwa-api.js", "./popup.js", "./icon48.png", "./icon128.png", "./manifest.webmanifest"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin === location.origin) {
    event.respondWith(caches.match(event.request).then(r => r || fetch(event.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return res;
    })));
  }
});
