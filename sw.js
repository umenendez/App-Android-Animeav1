// Sube la versión (vNN) cuando cambien los archivos de CORE: el activate borra
// las cachés antiguas. Último bump: v52 (avisos push de capítulos nuevos).
const CACHE = "animeav1-pwa-v58";
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

// --- Avisos push: capítulos nuevos con la app cerrada ---------------------------------------------
// El Worker (tarea programada) manda un mensaje cifrado { titulo, cuerpo, tag, url, pendientes }. Chrome exige mostrar
// siempre una notificación al recibir un push.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { cuerpo: event.data ? event.data.text() : "" }; }
  const tareas = [self.registration.showNotification(String(d.titulo || "AnimeAV1 Tracker"), {
    body: String(d.cuerpo || ""),
    icon: "./icon192.png",
    tag: String(d.tag || "capitulos-nuevos"),
    renotify: true,
    data: { url: String(d.url || "./") },
  })];
  // Contador del icono de la app: series en «Viendo» con capítulos sin ver
  if (typeof d.pendientes === "number" && self.navigator && "setAppBadge" in self.navigator) {
    tareas.push((d.pendientes > 0 ? self.navigator.setAppBadge(d.pendientes) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(tareas));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abiertas) {
      if (c.url.startsWith(self.registration.scope) && "focus" in c) { await c.focus(); return; }
    }
    await self.clients.openWindow(destino);
  })());
});
