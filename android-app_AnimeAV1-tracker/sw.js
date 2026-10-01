const CACHE = "animeav1-pwa-v11";
const COVER_CACHE = "anime-covers-v1";
const CORE = ["./", "./index.html", "./theme.js", "./config.js", "./pwa-api.js", "./popup.js", "./icon16.png", "./icon48.png", "./icon128.png", "./icon192.png", "./icon512.png", "./manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([CACHE, COVER_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith("animeav1-pwa-") || key.startsWith("anime-covers-")) {
        if (!keep.has(key)) await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Las portadas las gestiona popup.js/pwa-api.js según la preferencia
  // del usuario. El Service Worker no las guarda automáticamente.

  // Archivos de la propia PWA: red primero (así las actualizaciones llegan
  // solas) y, si no hay conexión, la copia guardada.
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
  }
});
