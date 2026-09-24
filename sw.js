const CACHE = "animeav1-pwa-v3";
const COVER_CACHE = "anime-covers-v1";
const CORE = ["./", "./index.html", "./theme.js", "./config.js", "./pwa-api.js", "./popup.js", "./icon16.png", "./icon48.png", "./icon128.png", "./manifest.webmanifest"];

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

  // Portadas: incluye imágenes del CDN externo. Las respuestas opacas
  // también se pueden guardar en Cache Storage.
  if (request.destination === "image") {
    event.respondWith((async () => {
      const cache = await caches.open(COVER_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw error;
      }
    })());
    return;
  }

  // Archivos de la propia PWA: cache-first.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return response;
      }))
    );
  }
});
