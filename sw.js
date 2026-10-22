// Sube la versión (vNN) cuando cambien los archivos de CORE: el activate borra
// las cachés antiguas. Último bump: v46 (sincronización más rápida).
const CACHE = "animeav1-pwa-v46";
const COVER_CACHE = "anime-covers-v2";
const MW = /(^|\.)img\d+mw\.xyz$/i;
const CORE = ["./", "./index.html", "./theme.js", "./config.js", "./pwa-api.js", "./popup.js", "./register-sw.js", "./privacy.html", "./icon16.png", "./icon48.png", "./icon128.png", "./icon192.png", "./icon512.png", "./manifest.webmanifest"];

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
    // Limpia portadas de Manwhaweb guardadas antes (podían ser respuestas de error).
    try {
      const cc = await caches.open(COVER_CACHE);
      for (const r of await cc.keys()) if (MW.test(new URL(r.url).hostname)) await cc.delete(r);
    } catch (_) {}
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Portadas de Manwhaweb: sin caché ni intermediarios, que las gestione el navegador.
  if (MW.test(url.hostname)) return;

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
      }).catch(() => caches.match(request, { ignoreSearch: true }))
    );
  }
});
