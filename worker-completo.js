// Proxy + backend de login mínimo para AnimeAV1 Tracker (Android/PWA).
//
// Hace cuatro trabajos:
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
//     separados por comas. Por defecto solo https://umenendez.github.io
//
// Flujo de login: la app obtiene un "id_token" de Google (Google Identity Services), lo
// manda a POST /api/login y el Worker lo valida con las claves públicas de Google. Si es
// válido, devuelve su PROPIO token de sesión, que dura SESION_DIAS días: así no hay que
// volver a iniciar sesión cada hora como pasa con los tokens de Google.

const SESION_DIAS = 60;
const MAX_CAMBIOS = 200;
const ORIGENES_POR_DEFECTO = "https://umenendez.github.io";

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
  const l = await env.DB.prepare("SELECT propietario FROM listas WHERE id = ?").bind(listaId).first();
  if (!l) return null;
  if (l.propietario === usuario.sub) return "propietario";
  const m = await env.DB.prepare("SELECT rol FROM miembros WHERE lista_id = ? AND email = ?").bind(listaId, usuario.email).first();
  return m ? m.rol : null;
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
  await env.DB.batch([
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
