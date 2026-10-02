const CACHE = "animeav1-pwa-v13";
const COVER_CACHE = "anime-covers-v1";
const CORE = ["./", "./index.html", "./theme.js", "./config.js", "./pwa-api.js", "./posicion-core.js", "./popup.js", "./icon16.png", "./icon48.png", "./icon128.png", "./icon192.png", "./icon512.png", "./manifest.webmanifest"];

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

  // Si ya existe una copia local de una portada, servirla directamente.
  // Esto permite que <img src="URL-original"> use la copia guardada sin
  // convertir respuestas CORS/opaque en Blob.
  if (request.method === "GET" && request.destination === "image") {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

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
