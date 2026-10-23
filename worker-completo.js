// Proxy + backend de login mínimo para AnimeAV1 Tracker (Android/PWA).
//
// Hace cinco trabajos:
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
// 3) PORTADAS DE MANWHAWEB: las imágenes de imgNmw.xyz solo se sirven si la
//    petición lleva el Referer de Manwhaweb (anti-hotlink de Cloudflare).
//    Si ?url= apunta a uno de esos dominios, el Worker pide la imagen con
//    ese Referer y la devuelve en bruto (con caché de un año).
//
// 4) LISTAS EN LA NUBE (D1): varios usuarios, login con Google y sincronización entre
//    dispositivos. Todo lo de /api/... (ver la sección «API de listas en la nube» abajo).
//
// 5) ENLACE PÚBLICO DE SOLO LECTURA: el propietario de una lista de la nube puede generar un enlace
//    (https://TU-WORKER.workers.dev/v/<código>) que muestra la lista como página web, sin cuenta ni app,
//    y revocarlo cuando quiera. Ver la sección «Enlace público» abajo. No necesita ningún paso extra:
//    la tabla que usa se crea sola la primera vez.
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

// Portadas de Manwhaweb
const HOST_IMG_MW = /(^|\.)img\d+mw\.xyz$/i;
const SITIO_MW = "https://manhwaweb.com/"; // web desde la que se ven normalmente las portadas

const CORS_BASE = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Proxy-Upstream-Status, X-Proxy-Upstream-Url",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API de listas en la nube (D1): tiene su propio CORS restringido, por eso va antes
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return manejarApi(request, env, url);

    // Página pública de una lista compartida con enlace (solo lectura, sin sesión)
    const pub = url.pathname.match(/^\/v\/([A-Za-z0-9_-]{16,64})\/?$/);
    if (pub && (request.method === "GET" || request.method === "HEAD")) return paginaPublica(request, env, pub[1], url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_BASE });
    }

    if (url.pathname === "/auth/exchange") return manejarExchange(request, env);
    if (url.pathname === "/auth/refresh") return manejarRefresh(request, env);
    return manejarProxy(url, request);
  },
};

// --- Proxy de scraping ----------------------------------------------------

async function manejarProxy(url, request) {
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

  // Imágenes de Manwhaweb: se devuelven en bruto, con el Referer correcto
  if (HOST_IMG_MW.test(destino.hostname)) return manejarImagenMW(destino, request);

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

// --- Portadas de Manwhaweb ------------------------------------------------
// Aquí SÍ se devuelve el código de error real (no 200): un <img> necesita
// un fallo de verdad para pasar al siguiente intento.

async function manejarImagenMW(destino, request) {
  if (destino.protocol !== "https:") {
    return new Response("Solo https", { status: 400, headers: CORS_BASE });
  }
  const origen = await fetch(destino.toString(), {
    headers: {
      "Referer": SITIO_MW,
      "Origin": SITIO_MW.replace(/\/$/, ""),
      "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
      "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
    },
    cf: { cacheEverything: true, cacheTtl: 31536000 },
  });
  if (!origen.ok) {
    return new Response(`Origen respondió ${origen.status}`, { status: 502, headers: CORS_BASE });
  }
  return new Response(origen.body, {
    status: 200,
    headers: {
      ...CORS_BASE,
      "Content-Type": origen.headers.get("Content-Type") || "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
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

// --- API de listas en la nube (D1) ----------------------------------------
// Varios usuarios: cada uno inicia sesión con Google y solo ve sus listas y las que
// le comparten. Requiere (ver schema.sql y las instrucciones de despliegue):
//   · binding D1 llamado DB
//   · secret GOOGLE_CLIENT_ID   (el mismo de siempre; sirve para validar el login)
//   · secret SESSION_SECRET     (una cadena larga y aleatoria que inventas tú)
//   · variable ORIGENES_PERMITIDOS (opcional): orígenes web que pueden usar la API,
//     separados por comas. Por defecto: https://umenendez.github.io (la PWA) y
//     chrome-extension://cmlaaboekekgplbjbocbjmplnnmjjjpa (la extensión de Chrome). Si defines la
//     variable, SUSTITUYE a estos: incluye también el de la extensión.
//
// Flujo de login: la app obtiene un "id_token" de Google (Google Identity Services), lo
// manda a POST /api/login y el Worker lo valida con las claves públicas de Google. Si es
// válido, devuelve su PROPIO token de sesión, que dura SESION_DIAS días: así no hay que
// volver a iniciar sesión cada hora como pasa con los tokens de Google.

const SESION_DIAS = 60;
const MAX_CAMBIOS = 200;
// La PWA (GitHub Pages) y la extensión de Chrome (su origen sale del "key" del manifest.json).
const ORIGENES_POR_DEFECTO = "https://umenendez.github.io,chrome-extension://cmlaaboekekgplbjbocbjmplnnmjjjpa";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64uDeBytes(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesDeB64u(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const jsonDeB64u = (s) => JSON.parse(dec.decode(bytesDeB64u(s)));
const b64uDeJson = (o) => b64uDeBytes(enc.encode(JSON.stringify(o)));

// ---- CORS restringido para /api ----
function origenesPermitidos(env) {
  return String(env.ORIGENES_PERMITIDOS || ORIGENES_POR_DEFECTO).split(",").map((s) => s.trim()).filter(Boolean);
}
function corsApi(request, env) {
  const origen = request.headers.get("Origin");
  const base = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origen && origenesPermitidos(env).includes(origen)) base["Access-Control-Allow-Origin"] = origen;
  return base;
}
// Un navegador desde un origen no autorizado no puede usar la API (aunque tenga token).
// Peticiones sin Origin (curl, pruebas) pasan: lo que protege los datos es el token.
function origenBloqueado(request, env) {
  const origen = request.headers.get("Origin");
  return !!origen && !origenesPermitidos(env).includes(origen);
}

// ---- Token de sesión propio (JWT HS256) ----
async function claveHmac(env) {
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function firmarSesion(env, usuario) {
  const ahora = Math.floor(Date.now() / 1000);
  const payload = { sub: usuario.sub, email: usuario.email, name: usuario.name, iat: ahora, exp: ahora + SESION_DIAS * 86400 };
  const cuerpo = b64uDeJson({ alg: "HS256", typ: "JWT" }) + "." + b64uDeJson(payload);
  const firma = await crypto.subtle.sign("HMAC", await claveHmac(env), enc.encode(cuerpo));
  return { token: cuerpo + "." + b64uDeBytes(firma), exp: payload.exp };
}
async function verificarSesion(env, token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3) return null;
  try {
    if (jsonDeB64u(partes[0]).alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await claveHmac(env), bytesDeB64u(partes[2]), enc.encode(partes[0] + "." + partes[1]));
    if (!ok) return null;
    const p = jsonDeB64u(partes[1]);
    if (!p.sub || !p.email || p.exp < Date.now() / 1000) return null;
    return { sub: p.sub, email: String(p.email).toLowerCase(), name: p.name || "" };
  } catch (_) { return null; }
}

// ---- Validación del id_token de Google (RS256 con las claves públicas de Google) ----
let _jwks = { keys: null, t: 0 };
async function clavesGoogle(forzar) {
  if (!forzar && _jwks.keys && Date.now() - _jwks.t < 3600e3) return _jwks.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("No se pudieron obtener las claves de Google");
  _jwks = { keys: (await r.json()).keys || [], t: Date.now() };
  return _jwks.keys;
}
async function verificarIdTokenGoogle(idToken, env) {
  const partes = String(idToken || "").split(".");
  if (partes.length !== 3) throw new Error("Token de Google con formato inválido");
  const cabecera = jsonDeB64u(partes[0]);
  if (cabecera.alg !== "RS256") throw new Error("Algoritmo no admitido");
  let jwk = (await clavesGoogle(false)).find((k) => k.kid === cabecera.kid);
  if (!jwk) jwk = (await clavesGoogle(true)).find((k) => k.kid === cabecera.kid); // Google rota las claves
  if (!jwk) throw new Error("Clave de firma desconocida");
  const clave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valido = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", clave, bytesDeB64u(partes[2]), enc.encode(partes[0] + "." + partes[1]));
  if (!valido) throw new Error("Firma de Google inválida");
  const c = jsonDeB64u(partes[1]);
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new Error("Emisor inválido");
  if (c.aud !== env.GOOGLE_CLIENT_ID) throw new Error("El token no es para esta aplicación");
  if (!c.exp || c.exp < Date.now() / 1000) throw new Error("El token de Google ha caducado");
  if (!c.sub || !c.email || c.email_verified !== true) throw new Error("Cuenta de Google sin email verificado");
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: String(c.name || "") };
}

// ---- Utilidades de respuesta / validación ----
function resp(request, env, cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...corsApi(request, env), "Content-Type": "application/json" } });
}
class ErrorApi extends Error { constructor(status, mensaje) { super(mensaje); this.status = status; } }
const texto = (v, max) => String(v ?? "").slice(0, max);
const ID_VALIDO = /^[A-Za-z0-9_-]{6,64}$/;
const EMAIL_VALIDO = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
async function leerJson(request) {
  try { const j = await request.json(); if (j && typeof j === "object") return j; } catch (_) {}
  throw new ErrorApi(400, "Cuerpo JSON inválido");
}

// ---- Acceso a listas ----
// Devuelve "propietario" | "edicion" | "lectura" | null. Sin acceso se responde 404 (no se
// revela si la lista existe).
async function rolEnLista(env, usuario, listaId) {
  // Una sola consulta (antes eran dos seguidas): la lista y, si no eres el propietario, tu fila de miembro
  const f = await env.DB.prepare(
    "SELECT l.propietario AS propietario, m.rol AS rol FROM listas l LEFT JOIN miembros m ON m.lista_id = l.id AND m.email = ? WHERE l.id = ?"
  ).bind(usuario.email, listaId).first();
  if (!f) return null;
  if (f.propietario === usuario.sub) return "propietario";
  return f.rol || null;
}
async function exigirRol(env, usuario, listaId, roles) {
  const rol = await rolEnLista(env, usuario, listaId);
  if (!rol) throw new ErrorApi(404, "Lista no encontrada");
  if (!roles.includes(rol)) throw new ErrorApi(403, "No tienes permiso para esto en esta lista");
  return rol;
}
const listaParaCliente = (f, rol) => ({
  id: f.id, nombre: f.nombre, generos: JSON.parse(f.generos || "[]"), actualizado: f.actualizado, rol,
});

// ---- Router ----
async function manejarApi(request, env, url) {
  if (origenBloqueado(request, env)) return new Response("Origen no permitido", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsApi(request, env) });
  if (!env.DB) return resp(request, env, { error: "Falta el binding D1 llamado DB en el Worker." }, 500);
  if (!env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID) {
    return resp(request, env, { error: "Faltan los secrets SESSION_SECRET y/o GOOGLE_CLIENT_ID en el Worker." }, 500);
  }
  try {
    const ruta = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const metodo = request.method;

    if (ruta[0] === "login" && metodo === "POST") return await apiLogin(request, env);

    const auth = request.headers.get("Authorization") || "";
    const usuario = await verificarSesion(env, auth.replace(/^Bearer\s+/i, ""));
    if (!usuario) throw new ErrorApi(401, "Sesión no válida o caducada: vuelve a iniciar sesión");

    if (ruta[0] === "yo" && metodo === "GET") return resp(request, env, { usuario });
    if (ruta[0] === "listas") {
      if (ruta.length === 1 && metodo === "GET") return await apiListas(request, env, usuario);
      if (ruta.length === 1 && metodo === "POST") return await apiCrearLista(request, env, usuario);
      const id = ruta[1];
      if (ruta.length === 2 && metodo === "GET") return await apiLista(request, env, usuario, id);
      if (ruta.length === 2 && metodo === "PATCH") return await apiEditarLista(request, env, usuario, id);
      if (ruta.length === 2 && metodo === "DELETE") return await apiBorrarLista(request, env, usuario, id);
      if (ruta[2] === "series" && ruta.length === 3 && metodo === "GET") return await apiSeriesGet(request, env, usuario, id, url);
      if (ruta[2] === "series" && ruta.length === 3 && metodo === "POST") return await apiSeriesPost(request, env, usuario, id);
      if (ruta[2] === "enlace" && ruta.length === 3 && metodo === "GET") return await apiEnlaceGet(request, env, usuario, id, url);
      if (ruta[2] === "enlace" && ruta.length === 3 && metodo === "POST") return await apiEnlaceCrear(request, env, usuario, id, url);
      if (ruta[2] === "enlace" && ruta.length === 3 && metodo === "DELETE") return await apiEnlaceQuitar(request, env, usuario, id);
      if (ruta[2] === "miembros" && ruta.length === 3 && metodo === "POST") return await apiMiembroAnadir(request, env, usuario, id);
      if (ruta[2] === "miembros" && ruta.length === 3 && metodo === "DELETE") return await apiMiembroQuitar(request, env, usuario, id, url);
    }
    throw new ErrorApi(404, "Ruta no encontrada");
  } catch (e) {
    if (e instanceof ErrorApi) return resp(request, env, { error: e.message }, e.status);
    console.error("Error en la API:", e && e.stack || e);
    return resp(request, env, { error: "Error interno del servidor" }, 500);
  }
}

async function apiLogin(request, env) {
  const { id_token } = await leerJson(request);
  let usuario;
  try { usuario = await verificarIdTokenGoogle(id_token, env); }
  catch (e) { throw new ErrorApi(401, "Login de Google rechazado: " + e.message); }
  const ahora = Date.now();
  await env.DB.prepare(
    "INSERT INTO usuarios (sub, email, nombre, creado, ultimo_acceso) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(sub) DO UPDATE SET email = excluded.email, nombre = excluded.nombre, ultimo_acceso = excluded.ultimo_acceso"
  ).bind(usuario.sub, usuario.email, usuario.name, ahora, ahora).run();
  const { token, exp } = await firmarSesion(env, usuario);
  return resp(request, env, { token, exp, usuario });
}

async function apiListas(request, env, usuario) {
  const { results } = await env.DB.prepare(
    "SELECT id, nombre, generos, actualizado, 'propietario' AS rol FROM listas WHERE propietario = ? " +
    "UNION ALL " +
    "SELECT l.id, l.nombre, l.generos, l.actualizado, m.rol AS rol FROM miembros m JOIN listas l ON l.id = m.lista_id WHERE m.email = ? " +
    "ORDER BY nombre COLLATE NOCASE"
  ).bind(usuario.sub, usuario.email).all();
  return resp(request, env, { listas: results.map((f) => listaParaCliente(f, f.rol)) });
}

async function apiCrearLista(request, env, usuario) {
  const b = await leerJson(request);
  // El id lo puede traer la app (así una lista local se sube con el mismo id). Si ya existe y es
  // tuya, la petición es idempotente (se actualiza); si es de otro, conflicto.
  const id = b.id ? String(b.id) : crypto.randomUUID().replace(/-/g, "");
  if (!ID_VALIDO.test(id)) throw new ErrorApi(400, "Id de lista inválido (6-64 caracteres: letras, números, - y _)");
  const nombre = texto(b.nombre, 100).trim();
  if (!nombre) throw new ErrorApi(400, "Falta el nombre de la lista");
  const generos = JSON.stringify(Array.isArray(b.generos) ? b.generos.slice(0, 200).map((g) => texto(g, 60)) : []);
  const existente = await env.DB.prepare("SELECT propietario FROM listas WHERE id = ?").bind(id).first();
  if (existente && existente.propietario !== usuario.sub) throw new ErrorApi(409, "Ese id de lista ya está en uso");
  const ahora = Date.now();
  await env.DB.prepare(
    "INSERT INTO listas (id, propietario, nombre, generos, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, generos = excluded.generos, actualizado = excluded.actualizado"
  ).bind(id, usuario.sub, nombre, generos, ahora, ahora).run();
  return resp(request, env, { lista: { id, nombre, generos: JSON.parse(generos), actualizado: ahora, rol: "propietario" } }, existente ? 200 : 201);
}

async function apiLista(request, env, usuario, id) {
  const rol = await exigirRol(env, usuario, id, ["propietario", "edicion", "lectura"]);
  const f = await env.DB.prepare("SELECT id, nombre, generos, actualizado FROM listas WHERE id = ?").bind(id).first();
  const out = { lista: listaParaCliente(f, rol) };
  if (rol === "propietario") {
    const { results } = await env.DB.prepare("SELECT email, rol FROM miembros WHERE lista_id = ? ORDER BY email").bind(id).all();
    out.miembros = results;
  }
  return resp(request, env, out);
}

async function apiEditarLista(request, env, usuario, id) {
  const rol = await exigirRol(env, usuario, id, ["propietario", "edicion"]);
  const b = await leerJson(request);
  const sets = [], vals = [];
  if (b.nombre !== undefined) {
    if (rol !== "propietario") throw new ErrorApi(403, "Solo el propietario puede cambiar el nombre");
    const nombre = texto(b.nombre, 100).trim();
    if (!nombre) throw new ErrorApi(400, "El nombre no puede estar vacío");
    sets.push("nombre = ?"); vals.push(nombre);
  }
  if (b.generos !== undefined) {
    if (!Array.isArray(b.generos)) throw new ErrorApi(400, "generos debe ser una lista");
    sets.push("generos = ?"); vals.push(JSON.stringify(b.generos.slice(0, 200).map((g) => texto(g, 60))));
  }
  if (!sets.length) throw new ErrorApi(400, "Nada que actualizar");
  sets.push("actualizado = ?"); vals.push(Date.now());
  await env.DB.prepare(`UPDATE listas SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  const f = await env.DB.prepare("SELECT id, nombre, generos, actualizado FROM listas WHERE id = ?").bind(id).first();
  return resp(request, env, { lista: listaParaCliente(f, rol) });
}

async function apiBorrarLista(request, env, usuario, id) {
  await exigirRol(env, usuario, id, ["propietario"]);
  await asegurarTablaEnlaces(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM enlaces_publicos WHERE lista_id = ?").bind(id),
    env.DB.prepare("DELETE FROM series WHERE lista_id = ?").bind(id),
    env.DB.prepare("DELETE FROM miembros WHERE lista_id = ?").bind(id),
    env.DB.prepare("DELETE FROM listas WHERE id = ?").bind(id),
  ]);
  return resp(request, env, { ok: true });
}

// GET /api/listas/:id/series?since=<ms>  → series cambiadas desde `since` (borradas incluidas).
// La app guarda `hasta` y lo manda como `since` la próxima vez (conviene restarle ~2 s de margen:
// aplicar dos veces el mismo cambio es inofensivo, perderlo no).
async function apiSeriesGet(request, env, usuario, id, url) {
  const rol = await exigirRol(env, usuario, id, ["propietario", "edicion", "lectura"]);
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
  const { results } = await env.DB.prepare(
    "SELECT id, titulo, url, nota, estado, genero, portada, ultimo_cap_url, extra, actualizado, servidor, borrada " +
    "FROM series WHERE lista_id = ? AND servidor > ? ORDER BY servidor, id"
  ).bind(id, since).all();
  const series = results.map((f) => ({
    id: f.id, titulo: f.titulo, url: f.url, nota: f.nota, estado: f.estado, genero: f.genero,
    portada: f.portada, ultimo_cap_url: f.ultimo_cap_url, extra: safeJson(f.extra),
    actualizado: f.actualizado, borrada: !!f.borrada,
  }));
  const hasta = results.length ? results[results.length - 1].servidor : since;
  return resp(request, env, { series, hasta, ahora: Date.now(), rol });
}
function safeJson(s) { try { return JSON.parse(s); } catch (_) { return {}; } }

// POST /api/listas/:id/series  { cambios: [ {id, titulo, url, nota, estado, genero, portada,
//   ultimo_cap_url, extra, actualizado, borrada}, ... ] }  (máx. 200 por petición)
// Cada cambio se aplica solo si es más reciente (campo `actualizado`) que lo que ya hay.
async function apiSeriesPost(request, env, usuario, id) {
  await exigirRol(env, usuario, id, ["propietario", "edicion"]);
  const { cambios } = await leerJson(request);
  if (!Array.isArray(cambios)) throw new ErrorApi(400, "Falta la lista «cambios»");
  if (cambios.length > MAX_CAMBIOS) throw new ErrorApi(413, `Máximo ${MAX_CAMBIOS} cambios por petición`);
  const ahora = Date.now();
  const sentencias = [];
  for (const c of cambios) {
    if (!c || !ID_VALIDO.test(String(c.id))) throw new ErrorApi(400, "Serie con id inválido (6-64 caracteres: letras, números, - y _)");
    // No se aceptan horas del futuro (un reloj mal puesto ganaría para siempre a los demás)
    const act = Math.min(Number(c.actualizado) || ahora, ahora + 60e3);
    const nota = c.nota === null || c.nota === undefined || c.nota === "" ? null : Number(c.nota);
    if (nota !== null && !Number.isFinite(nota)) throw new ErrorApi(400, "Nota inválida");
    const extra = JSON.stringify(c.extra && typeof c.extra === "object" ? c.extra : {});
    if (extra.length > 4000) throw new ErrorApi(413, "El campo extra de una serie es demasiado grande");
    sentencias.push(env.DB.prepare(
      "INSERT INTO series (lista_id, id, titulo, url, nota, estado, genero, portada, ultimo_cap_url, extra, actualizado, servidor, borrada) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(lista_id, id) DO UPDATE SET titulo = excluded.titulo, url = excluded.url, nota = excluded.nota, " +
      "estado = excluded.estado, genero = excluded.genero, portada = excluded.portada, ultimo_cap_url = excluded.ultimo_cap_url, " +
      "extra = excluded.extra, actualizado = excluded.actualizado, servidor = excluded.servidor, borrada = excluded.borrada " +
      "WHERE excluded.actualizado >= series.actualizado"
    ).bind(
      id, String(c.id), texto(c.titulo, 300), texto(c.url, 1000), nota, texto(c.estado, 40), texto(c.genero, 300),
      texto(c.portada, 1000), texto(c.ultimo_cap_url, 1000), extra, act, ahora, c.borrada ? 1 : 0
    ));
  }
  for (let i = 0; i < sentencias.length; i += 50) await env.DB.batch(sentencias.slice(i, i + 50));
  return resp(request, env, { ok: true, recibidos: cambios.length, ahora });
}

async function apiMiembroAnadir(request, env, usuario, id) {
  await exigirRol(env, usuario, id, ["propietario"]);
  const b = await leerJson(request);
  const email = String(b.email || "").trim().toLowerCase();
  const rol = b.rol === "lectura" ? "lectura" : "edicion";
  if (!EMAIL_VALIDO.test(email)) throw new ErrorApi(400, "Email inválido");
  if (email === usuario.email) throw new ErrorApi(400, "Ya eres el propietario de la lista");
  await env.DB.prepare(
    "INSERT INTO miembros (lista_id, email, rol) VALUES (?, ?, ?) ON CONFLICT(lista_id, email) DO UPDATE SET rol = excluded.rol"
  ).bind(id, email, rol).run();
  return resp(request, env, { ok: true, email, rol });
}

async function apiMiembroQuitar(request, env, usuario, id, url) {
  await exigirRol(env, usuario, id, ["propietario"]);
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) throw new ErrorApi(400, "Falta ?email=");
  await env.DB.prepare("DELETE FROM miembros WHERE lista_id = ? AND email = ?").bind(id, email).run();
  return resp(request, env, { ok: true });
}

// --- Enlace público de solo lectura ----------------------------------------
// El propietario de una lista de la nube genera un enlace /v/<código> que cualquiera puede abrir
// (sin cuenta y sin instalar nada) para ver la lista como una página web. Es solo lectura: el
// código solo sirve para ver esa página, no da acceso a la API ni a las demás listas.
//   · Una lista tiene como mucho un enlace.
//   · «Revocar» borra el enlace: deja de funcionar al instante (la página no se guarda en caché).
//   · «Renovar» lo sustituye por otro código nuevo: el anterior deja de valer.
//   · Se muestran título, portada, nota, estado, géneros y enlace de cada serie; nada más
//     (ni el último capítulo visto, ni quién más tiene acceso a la lista, ni el email del dueño).
// La tabla se crea sola la primera vez que se usa: no hay que tocar schema.sql.

let _tablaEnlaces = false;
async function asegurarTablaEnlaces(env) {
  if (_tablaEnlaces) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS enlaces_publicos (token TEXT PRIMARY KEY, lista_id TEXT NOT NULL UNIQUE, creado INTEGER NOT NULL)"
  ).run();
  _tablaEnlaces = true;
}
const urlEnlace = (url, token) => `${url.origin}/v/${token}`;

async function apiEnlaceGet(request, env, usuario, id, url) {
  await exigirRol(env, usuario, id, ["propietario"]);
  await asegurarTablaEnlaces(env);
  const f = await env.DB.prepare("SELECT token, creado FROM enlaces_publicos WHERE lista_id = ?").bind(id).first();
  return resp(request, env, { enlace: f ? { token: f.token, url: urlEnlace(url, f.token), creado: f.creado } : null });
}

// POST /api/listas/:id/enlace            → crea el enlace (o devuelve el que ya existe)
// POST /api/listas/:id/enlace {renovar}  → lo sustituye por uno nuevo
async function apiEnlaceCrear(request, env, usuario, id, url) {
  await exigirRol(env, usuario, id, ["propietario"]);
  await asegurarTablaEnlaces(env);
  let renovar = false;
  try { const b = await request.json(); renovar = !!(b && b.renovar); } catch (_) {}
  if (!renovar) {
    const ya = await env.DB.prepare("SELECT token, creado FROM enlaces_publicos WHERE lista_id = ?").bind(id).first();
    if (ya) return resp(request, env, { enlace: { token: ya.token, url: urlEnlace(url, ya.token), creado: ya.creado } });
  }
  const token = b64uDeBytes(crypto.getRandomValues(new Uint8Array(24))); // 192 bits: imposible de adivinar
  const creado = Date.now();
  // lista_id es UNIQUE: si ya había enlace, INSERT OR REPLACE lo sustituye (el código viejo deja de valer)
  await env.DB.prepare("INSERT OR REPLACE INTO enlaces_publicos (token, lista_id, creado) VALUES (?, ?, ?)").bind(token, id, creado).run();
  return resp(request, env, { enlace: { token, url: urlEnlace(url, token), creado } }, 201);
}

async function apiEnlaceQuitar(request, env, usuario, id) {
  await exigirRol(env, usuario, id, ["propietario"]);
  await asegurarTablaEnlaces(env);
  await env.DB.prepare("DELETE FROM enlaces_publicos WHERE lista_id = ?").bind(id).run();
  return resp(request, env, { ok: true });
}

// ---- Página pública (GET /v/<código>) ----
// Mismos estados que la app: [valor guardado, etiqueta, clase CSS]
const ESTADOS_PUBLICOS = [
  ["-", "Viendo", "viendo"], ["✔", "Visto", "visto"], ["✖", "Sin ver", "sin"], ["📉", "Dropeado", "drop"], ["@", "Por ver", "por"],
];
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function enlaceHttp(u) {
  try { const d = new URL(String(u || "").trim()); return d.protocol === "https:" || d.protocol === "http:" ? d.toString() : ""; }
  catch (_) { return ""; }
}
// Las portadas de Manwhaweb solo se ven con el Referer correcto: pasan por el proxy de este mismo Worker
function portadaPublica(u, origen) {
  let d;
  try { d = new URL(String(u || "").trim()); } catch (_) { return ""; }
  if (d.protocol !== "https:") return "";
  if (HOST_IMG_MW.test(d.hostname)) return origen + "/?url=" + encodeURIComponent(d.toString());
  return d.toString();
}

const LOGO_PUBLICO = "data:image/png;base64,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";

// Mismo diseño que la app (index.html): mismos colores, tamaños, rejilla y tarjetas teñidas según el estado
const CSS_PUBLICO = `
:root{color-scheme:light dark;
--bg:light-dark(#f4f5f8,#0e131b);--surface:light-dark(#fff,#171d29);--field:light-dark(#eef0f4,#202837);--border:light-dark(#e1e4ea,#2a3345);--text:light-dark(#141824,#e8ebf2);--muted:light-dark(#667085,#8b95a7);--accent:light-dark(#dc2626,#f05252);
--c-viendo:light-dark(#c2410c,#fb923c);--c-visto:light-dark(#15803d,#4ade80);--c-sin:light-dark(#b91c1c,#f87171);--c-drop:light-dark(#9f1239,#f472b6);--c-por:light-dark(#7e22ce,#c084fc);
--st:var(--muted);--tinte:var(--surface)}
[data-estado="-"]{--st:var(--c-viendo);--tinte:#f97316}
[data-estado="✔"]{--st:var(--c-visto);--tinte:#22c55e}
[data-estado="✖"]{--st:var(--c-sin);--tinte:#ef4444}
[data-estado="📉"]{--st:var(--c-drop);--tinte:#9f1239}
[data-estado="@"]{--st:var(--c-por);--tinte:#9333ea}
[hidden]{display:none!important}
*{box-sizing:border-box}
body{margin:0;padding:12px;background:var(--bg);color:var(--text);font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
button,select,input{font:inherit;color:inherit}
button{cursor:pointer}
.cabecera{display:flex;align-items:center;gap:8px}
.logo{width:24px;height:24px;border-radius:50%;flex-shrink:0}
h1{font-size:15px;font-weight:700;margin:0;min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#contador{font-size:12px;color:var(--muted);flex-shrink:0}
.filtros{display:flex;flex-direction:column;gap:5px}
.fila{display:flex;flex-wrap:wrap;gap:5px}
.fila>*{flex:1 1 80px;min-width:0}
.fila>#q{flex:2 1 120px}
#q,.filtros select{height:28px;padding:0 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
#q::placeholder{color:var(--muted)}
select{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:20px;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%239ca3af' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");background-repeat:no-repeat;background-position:right 7px center}
.chips{display:flex;flex-wrap:nowrap;gap:5px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:1px}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid var(--border);background:var(--surface);font-size:11.5px;font-weight:500}
.chip:hover{border-color:var(--muted)}
.chip .punto{width:7px;height:7px;border-radius:50%;background:var(--st)}
.chip .n{color:var(--muted);font-size:11px}
.chip.vacio{opacity:.4}
.chip[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.chip[aria-pressed="true"] .n{color:inherit;opacity:.7}
.chip[aria-pressed="true"][data-estado]{background:color-mix(in srgb,var(--st) 16%,var(--surface));color:var(--st);border-color:var(--st)}
#grid{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:min-content;align-content:start;gap:7px;margin:0;padding:0 0 12px;list-style:none}
@media (min-width:480px){#grid{grid-template-columns:repeat(4,1fr)}}
@media (min-width:620px){#grid{grid-template-columns:repeat(5,1fr)}}
@media (min-width:860px){#grid{grid-template-columns:repeat(6,1fr)}}
.card{display:flex;flex-direction:column;min-width:0;background:color-mix(in srgb,var(--tinte) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--tinte) 40%,var(--border));border-radius:12px}
.portada{position:relative;aspect-ratio:2/3;background:var(--field);overflow:hidden;border-radius:11px 11px 0 0}
.portada::after{content:"";position:absolute;inset:auto 0 0 0;height:3px;background:var(--st)}
.cover{width:100%;height:100%;object-fit:cover;display:block}
.js .cover{opacity:0;transition:opacity .25s}
.js .cover.lista{opacity:1}
.sin-portada{height:100%;display:grid;place-items:center;color:var(--muted);font-size:11px}
.nota{position:absolute;top:5px;left:5px;width:34px;height:19px;line-height:19px;text-align:center;font-size:10.5px;font-weight:700;border-radius:6px;background:rgba(15,20,29,.72);color:rgba(255,255,255,.6);z-index:10}
.info{display:flex;flex-direction:column;gap:4px;padding:6px}
.titulo{color:var(--text);text-decoration:none;font-weight:650;font-size:10.5px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:25px;overflow-wrap:anywhere}
a.titulo:hover{text-decoration:underline}
.est,.gen{display:block;width:100%;height:23px;line-height:21px;padding:0 6px;font-size:10.5px;border:1px solid var(--border);border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.est{font-weight:600;color:var(--st);border-color:color-mix(in srgb,var(--st) 45%,var(--border));background:color-mix(in srgb,var(--st) 12%,var(--surface))}
.gen{color:var(--muted);background:var(--field)}
.aviso{text-align:center;color:var(--muted);padding:40px 12px}
footer{color:var(--muted);font-size:11px;text-align:center;padding:0 0 14px}
`;

function htmlAviso(titulo, texto, nonce) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escHtml(titulo)}</title><style nonce="${nonce}">${CSS_PUBLICO}</style></head><body><main><header class="cabecera"><img class="logo" src="${LOGO_PUBLICO}" alt=""><h1>AnimeAV1 Tracker</h1></header><div class="aviso"><strong>${escHtml(titulo)}</strong><br>${escHtml(texto)}</div></main></body></html>`;
}

// Código que se ejecuta en el navegador de quien abre el enlace (buscar, filtrar por estado y género, ordenar).
// Se inserta con .toString(): no puede usar nada de fuera de la función.
function guionPublico() {
  var q = document.getElementById("q"), orden = document.getElementById("orden"), gen = document.getElementById("gen"), grid = document.getElementById("grid");
  var vacio = document.getElementById("vacio"), cont = document.getElementById("contador");
  var cartas = Array.prototype.slice.call(grid.children), chips = document.querySelectorAll(".chip"), estado = "";
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  cartas.forEach(function (c) { c._b = norm(c.getAttribute("data-b")); });
  function aplicar() {
    var t = norm(q.value.trim()), g = gen ? gen.value : "", n = 0;
    cartas.forEach(function (c) {
      var ok = (!estado || c.getAttribute("data-estado") === estado) && (!t || c._b.indexOf(t) !== -1) &&
        (!g || c.getAttribute("data-g").indexOf("|" + g + "|") !== -1);
      c.hidden = !ok;
      if (ok) n++;
    });
    cont.textContent = n + (n === 1 ? " serie" : " series");
    vacio.hidden = n !== 0;
  }
  function ordenar() {
    var m = orden.value;
    cartas.slice().sort(function (a, b) {
      if (m === "score-desc" || m === "score-asc") {
        var x = +a.getAttribute("data-n"), y = +b.getAttribute("data-n");
        if (x < 0 && y >= 0) return 1; // las series sin nota van siempre al final
        if (y < 0 && x >= 0) return -1;
        if (x !== y) return m === "score-desc" ? y - x : x - y;
      }
      return a.getAttribute("data-i") - b.getAttribute("data-i");
    }).forEach(function (c) { grid.appendChild(c); });
  }
  q.addEventListener("input", aplicar);
  if (gen) gen.addEventListener("change", aplicar);
  orden.addEventListener("change", ordenar);
  Array.prototype.forEach.call(chips, function (ch) {
    ch.addEventListener("click", function () {
      estado = ch.getAttribute("data-estado") || "";
      Array.prototype.forEach.call(chips, function (o) { o.setAttribute("aria-pressed", String(o === ch)); });
      aplicar();
    });
  });
  aplicar();
}

function htmlListaPublica(nombre, series, origen, nonce) {
  const cuentas = {}, todosGeneros = new Set(), coloresNota = new Map();
  const tarjetas = series.map((f, i) => {
    cuentas[f.estado || ""] = (cuentas[f.estado || ""] || 0) + 1;
    const est = ESTADOS_PUBLICOS.find((e) => e[0] === f.estado);
    const titulo = String(f.titulo || "").trim() || "(sin título)";
    const enlace = enlaceHttp(f.url);
    const portada = portadaPublica(f.portada, origen);
    const nota = f.nota === null || f.nota === undefined ? NaN : Number(f.nota);
    const hayNota = Number.isFinite(nota) && nota > 0; // en la app, 0 significa «sin valorar»
    const generos = String(f.genero || "").split(",").map((g) => g.trim().replace(/\|/g, "")).filter(Boolean);
    generos.forEach((g) => todosGeneros.add(g));
    // Misma escala que la app: rojo (0) → verde (10); fuera de escala, amarillo
    // (con la CSP no valen los style="" en línea: se generan clases en el <style> de la página)
    const claseNota = !hayNota ? "" : nota > 10 ? "cy" : "c" + Math.round(nota * 10);
    if (claseNota && !coloresNota.has(claseNota)) coloresNota.set(claseNota, nota > 10 ? "background:#facc15;color:#78350f" : `background:hsl(${(nota / 10) * 120},72%,38%);color:#fff`);
    const tituloHtml = enlace
      ? `<a class="titulo" href="${escHtml(enlace)}" target="_blank" rel="noopener noreferrer" title="${escHtml(titulo)}">${escHtml(titulo)}</a>`
      : `<span class="titulo" title="${escHtml(titulo)}">${escHtml(titulo)}</span>`;
    return `<li class="card" data-estado="${escHtml(f.estado || "")}" data-n="${hayNota ? nota : -1}" data-i="${i}" data-g="${escHtml("|" + generos.join("|") + "|")}" data-b="${escHtml(titulo + " " + generos.join(" "))}">` +
      `<div class="portada">${portada ? `<img class="cover" src="${escHtml(portada)}" alt="" loading="lazy" decoding="async">` : `<div class="sin-portada">Sin portada</div>`}` +
      `<span class="nota${claseNota ? " " + claseNota : ""}">${hayNota ? escHtml(String(nota).replace(".", ",")) : "-"}</span></div>` +
      `<div class="info">${tituloHtml}${est ? `<span class="est">${est[1]}</span>` : ""}<span class="gen" title="${escHtml(generos.join(", "))}">${escHtml(generos.join(" · ") || "Sin género")}</span></div></li>`;
  }).join("");

  const chips = [`<button class="chip" type="button" aria-pressed="true">Todos<span class="n">${series.length}</span></button>`]
    .concat(ESTADOS_PUBLICOS.map((e) =>
      `<button class="chip${cuentas[e[0]] ? "" : " vacio"}" type="button" data-estado="${escHtml(e[0])}" aria-pressed="false"><span class="punto"></span>${e[1]}<span class="n">${cuentas[e[0]] || 0}</span></button>`)).join("");

  const listaGeneros = [...todosGeneros].sort((a, b) => a.localeCompare(b, "es"));
  const selGenero = listaGeneros.length
    ? `<select id="gen" aria-label="Filtrar por género"><option value="">Todos los géneros</option>${listaGeneros.map((g) => `<option value="${escHtml(g)}">${escHtml(g)}</option>`).join("")}</select>` : "";

  const ultimo = series.reduce((m, f) => Math.max(m, Number(f.servidor) || 0), 0);
  const fecha = ultimo ? new Date(ultimo).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }) : "";
  const n = series.length;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">` +
    `<title>${escHtml(nombre)} · AnimeAV1 Tracker</title><style nonce="${nonce}">${CSS_PUBLICO}${[...coloresNota].map(([c, r]) => `.nota.${c}{${r}}`).join("")}</style>` +
    `<script nonce="${nonce}">document.documentElement.className="js";` +
    `document.addEventListener("load",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.className==="cover")t.classList.add("lista")},true);` +
    `document.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.className==="cover"){var p=t.parentNode,d=document.createElement("div");d.className="sin-portada";d.textContent="Sin portada";t.remove();p.insertBefore(d,p.firstChild)}},true);` +
    `</script></head><body><main>` +
    `<header class="cabecera"><img class="logo" src="${LOGO_PUBLICO}" alt=""><h1>${escHtml(nombre)}</h1><span id="contador">${n} ${n === 1 ? "serie" : "series"}</span></header>` +
    `<div class="filtros"><div class="chips">${chips}</div><div class="fila"><input id="q" type="search" placeholder="Buscar por título" aria-label="Buscar por título">${selGenero}` +
    `<select id="orden" aria-label="Ordenar"><option value="">Sin ordenar</option><option value="score-desc">Nota: mayor a menor</option><option value="score-asc">Nota: menor a mayor</option></select></div></div>` +
    `<ul id="grid">${tarjetas}</ul><div id="vacio" class="aviso" hidden>Ninguna serie coincide con los filtros.</div>` +
    `<footer>Lista compartida en solo lectura${fecha ? ` · actualizada el ${escHtml(fecha)}` : ""}</footer></main>` +
    `<script nonce="${nonce}">(${guionPublico.toString()})()</script></body></html>`;
}

async function paginaPublica(request, env, token, url) {
  const nonce = b64uDeBytes(crypto.getRandomValues(new Uint8Array(12)));
  const cabeceras = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store", // si se revoca el enlace, deja de verse al instante
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "origin", // nunca se envía el código a otras webs (las portadas sí necesitan saber de qué web vienen)
    "Content-Security-Policy": `default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
  const cuerpo = (html) => (request.method === "HEAD" ? null : html);
  const aviso = (titulo, texto, status) => new Response(cuerpo(htmlAviso(titulo, texto, nonce)), { status, headers: cabeceras });
  if (!env.DB) return aviso("Servicio no disponible", "Este Worker no tiene configurada la base de datos.", 500);
  try {
    await asegurarTablaEnlaces(env);
    const lista = await env.DB.prepare(
      "SELECT l.id AS id, l.nombre AS nombre FROM enlaces_publicos e JOIN listas l ON l.id = e.lista_id WHERE e.token = ?"
    ).bind(token).first();
    if (!lista) return aviso("Enlace no disponible", "Este enlace no existe o su dueño lo ha desactivado.", 404);
    const { results } = await env.DB.prepare(
      "SELECT titulo, url, nota, estado, genero, portada, servidor FROM series WHERE lista_id = ? AND borrada = 0 ORDER BY titulo COLLATE NOCASE"
    ).bind(lista.id).all();
    return new Response(cuerpo(htmlListaPublica(lista.nombre, results, url.origin, nonce)), { headers: cabeceras });
  } catch (e) {
    console.error("Error en la página pública:", e && e.stack || e);
    return aviso("Error", "No se pudo cargar la lista. Inténtalo de nuevo dentro de un rato.", 500);
  }
}
