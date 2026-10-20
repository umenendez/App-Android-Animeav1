// Cloudflare Worker: proxy de portadas de Manwhaweb.
// Uso: https://TU-WORKER.workers.dev/?url=<URL de la imagen codificada>
//
// Pide la imagen con el Referer de Manwhaweb (así la regla anti-hotlink la deja pasar)
// y la devuelve con CORS abierto y caché de un año. Solo acepta dominios imgNmw.xyz,
// así que no sirve de proxy abierto para otras webs.

const SITIO = "https://manhwaweb.com/"; // web desde la que se ven normalmente las portadas
const HOST_OK = /(^|\.)img\d+mw\.xyz$/i;

export default {
  async fetch(request, env, ctx) {
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("Método no permitido", { status: 405, headers: cors });

    const objetivo = new URL(request.url).searchParams.get("url");
    let u;
    try { u = new URL(objetivo); } catch (_) { return new Response("Falta ?url=", { status: 400, headers: cors }); }
    if (u.protocol !== "https:" || !HOST_OK.test(u.hostname)) {
      return new Response("Dominio no permitido", { status: 403, headers: cors });
    }

    // Caché de Cloudflare: la imagen se pide a Manwhaweb una sola vez
    const cache = caches.default;
    const clave = new Request(u.href, { method: "GET" });
    let resp = await cache.match(clave);
    if (!resp) {
      const origen = await fetch(u.href, {
        headers: {
          "Referer": SITIO,
          "Origin": SITIO.replace(/\/$/, ""),
          "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
          "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
        },
        cf: { cacheEverything: true },
      });
      if (!origen.ok) return new Response(`Origen respondió ${origen.status}`, { status: 502, headers: cors });
      resp = new Response(origen.body, origen);
      resp.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      ctx.waitUntil(cache.put(clave, resp.clone()));
    }
    const out = new Response(resp.body, resp);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
