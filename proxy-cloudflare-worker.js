// Proxy + backend de login mínimo para AnimeAV1 Tracker (Android/PWA).
//
// Hace dos trabajos:
//
// 1) PROXY CORS: un navegador normal (a diferencia de una extensión con
//    host_permissions) no puede leer el HTML de animeav1.com/animeflv.net
//    si esos sitios no mandan cabeceras CORS. Este Worker pide la página
//    él mismo (sin esa restricción, porque es un servidor) y te la
//    devuelve con las cabeceras que el navegador necesita.
//
// 2) LOGIN PERSISTENTE: los tokens de acceso de Google caducan cada hora y
//    un sitio web normal no puede renovarlos en silencio de forma fiable
//    (Chrome bloquea las cookies de terceros que ese truco necesita). La
//    solución de verdad es un "refresh token", pero para conseguirlo hace
//    falta un client_secret — y eso NUNCA debe estar en el navegador. Por
//    eso vive aquí, en el Worker, como secret de Cloudflare.
//
// ───────────────────────────── DESPLIEGUE ─────────────────────────────
// 1. En Google Cloud Console, en el MISMO cliente OAuth "Aplicación web"
//    que ya tenías, copia también el "Client secret" (antes solo hacía
//    falta el Client ID).
// 2. Despliega este Worker (wrangler deploy, o pega el código en el editor
//    de dash.cloudflare.com y Deploy).
// 3. Configura dos cosas en el Worker (Settings → Variables, o por CLI):
//      wrangler secret put GOOGLE_CLIENT_ID
//      wrangler secret put GOOGLE_CLIENT_SECRET
//    (pega el Client ID y el Client secret cuando te los pida, uno por
//    comando). Si usas el editor web: Settings → Variables and Secrets →
//    Add → marca "Encrypt" para las dos.
// 4. En Ajustes de la app pon el mismo Client ID de siempre, y en "Proxy
//    CORS" la URL de este Worker (con /?url= al final, como antes).
//
// Si NO configuras los secrets de Google, el proxy de scraping (portadas,
// migración, registro) sigue funcionando igual; solo no tendrás login
// persistente y la app pedirá reconectar cada hora, como hasta ahora.

const PERMITIDOS = ["animeav1.com", "animeflv.net", "www.animeflv.net"];

const CORS_BASE = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Proxy-Upstream-Status, X-Proxy-Upstream-Url",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_BASE });
    }

    if (url.pathname === "/auth/exchange") return manejarExchange(request, env);
    if (url.pathname === "/auth/refresh") return manejarRefresh(request, env);
    return manejarProxy(url);
  },
};

// --- Proxy de scraping ----------------------------------------------------

async function manejarProxy(url) {
  const objetivo = url.searchParams.get("url");
  if (!objetivo) {
    return new Response("Falta el parámetro ?url=", { status: 400, headers: CORS_BASE });
  }

  let destino;
  try {
    destino = new URL(objetivo);
  } catch (e) {
    return new Response("URL inválida", { status: 400, headers: CORS_BASE });
  }

  const permitido = PERMITIDOS.some(
    (dominio) => destino.hostname === dominio || destino.hostname.endsWith("." + dominio)
  );
  if (!permitido) {
    return new Response("Dominio no permitido", { status: 403, headers: CORS_BASE });
  }

  const resp = await fetch(destino.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Referer": `https://${destino.hostname}/`,
    },
    redirect: "follow",
  });
  const texto = await resp.text();

  return new Response(texto, {
    // Si el sitio de origen dio error, lo pasamos como cabecera aparte y
    // respondemos 200 al navegador: así la app puede leer el cuerpo (para
    // saber qué pasó) en vez de que fetch() lo trate como fallo genérico.
    // OJO: estas cabeceras solo las ve el navegador si van en
    // Access-Control-Expose-Headers (ver CORS_BASE arriba) — ese era
    // exactamente el bug de la versión anterior de este Worker.
    status: 200,
    headers: {
      ...CORS_BASE,
      "Content-Type": "text/html; charset=utf-8",
      "X-Proxy-Upstream-Status": String(resp.status),
      "X-Proxy-Upstream-Url": destino.toString(),
    },
  });
}

// --- Login persistente (OAuth code -> access + refresh token) -------------

async function manejarExchange(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return jsonError("El Worker no tiene configurados GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (wrangler secret put ...).", 500);
  }
  try {
    const { code } = await request.json();
    if (!code) return jsonError("Falta el código de autorización", 400);

    const params = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: "postmessage", // reservado por Google para el flujo de popup de GIS
      grant_type: "authorization_code",
    });
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) return jsonError(data.error_description || data.error || "Error al canjear el código", 400);

    return jsonOk({
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token || null,
    });
  } catch (e) {
    return jsonError("Petición inválida: " + e.message, 400);
  }
}

async function manejarRefresh(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return jsonError("El Worker no tiene configurados GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (wrangler secret put ...).", 500);
  }
  try {
    const url = new URL(request.url);
    const refresh_token = url.searchParams.get("refresh_token");
    if (!refresh_token) return jsonError("Falta refresh_token", 400);

    const params = new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    });
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) return jsonError(data.error_description || data.error || "Error al renovar el token", 400);

    return jsonOk({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (e) {
    return jsonError("Petición inválida: " + e.message, 400);
  }
}

function jsonOk(obj) {
  return new Response(JSON.stringify(obj), { headers: { ...CORS_BASE, "Content-Type": "application/json" } });
}
function jsonError(mensaje, status) {
  return new Response(JSON.stringify({ error: mensaje }), { status, headers: { ...CORS_BASE, "Content-Type": "application/json" } });
}
