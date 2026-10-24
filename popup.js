const ESTADOS = [
  { value: "-", label: "Viendo" },
  { value: "✔", label: "Visto" },
  { value: "✖", label: "Sin ver" },
  { value: "📉", label: "Dropeado" },
  { value: "@", label: "Por ver" },
];

// Se preservan tal cual las opciones del Sheet, incluyendo mayúsculas/acentos
const GENEROS_BASE = [
  "ISEKAI", "SHOUNEN", "EL RESTO", "ROMANCE", "(._.)", "PELICULA",
  "NOVELA", "MANGA / MANWHA", "SLICE OF LIFE", "FANTASÍA", "MONOGATARI",
];

// --- Géneros: varios por anime, separados por coma en la columna A -------------
const unico = (a) => [...new Set(a)];
const parseGeneros = (s) => unico(String(s || "").split(",").map((g) => g.trim()).filter(Boolean));
const limpiarGenero = (s) => String(s || "").replace(/,/g, " ").replace(/\s+/g, " ").trim().toLocaleUpperCase("es");
// Cada lista tiene su propio catálogo de géneros ("generos:<id de la lista>").
let catalogo = GENEROS_BASE.slice();
let catalogoListaId; // undefined = aún no se ha cargado ninguno
const claveCatalogoDe = (id) => (id ? `generos:${id}` : "generos");
function leerCatalogoGuardado(id) {
  try {
    const c = JSON.parse(localStorage.getItem(claveCatalogoDe(id)) || "null");
    if (Array.isArray(c) && c.length) return unico(c);
  } catch (e) {}
  return null;
}
function guardarCatalogoDe(id, lista) { try { localStorage.setItem(claveCatalogoDe(id), JSON.stringify(lista)); } catch (e) {} }
function cargarCatalogo(listaId) {
  const id = listaId || null;
  const cambioDeLista = catalogoListaId !== undefined && catalogoListaId !== id;
  catalogoListaId = id;
  let guardado = leerCatalogoGuardado(id);
  if (!guardado && id) {
    // Antes el catálogo era uno solo para todas las listas: la primera lista que se abre
    // tras actualizar lo hereda; las demás empiezan con los géneros base.
    try {
      if (!localStorage.getItem("generosMigrado")) {
        localStorage.setItem("generosMigrado", "1");
        guardado = leerCatalogoGuardado(null);
        if (guardado) guardarCatalogoDe(id, guardado);
      }
    } catch (e) {}
  }
  catalogo = guardado || GENEROS_BASE.slice();
  // Un filtro por géneros de otra lista podría dejar esta vacía
  if (cambioDeLista && filtroGeneros.size) { filtroGeneros.clear(); guardarFiltros(); }
}
function guardarCatalogo() { guardarCatalogoDe(catalogoListaId, catalogo); }
// Los géneros que ya están en la hoja siempre aparecen en el catálogo
function sincronizarCatalogo() {
  todosLosAnimes.forEach((a) => parseGeneros(a.genre).forEach((g) => { if (!catalogo.includes(g)) catalogo.push(g); }));
  guardarCatalogo();
}

const $ = (id) => document.getElementById(id);
const cargandoEl = $("cargando");
const errorEl = $("error");
const vacioEl = $("vacio");
const bienvenidaEl = $("bienvenida");
const filtrosEl = document.querySelector(".filtros");
const listaEl = $("lista");
const contadorPortadasEl = $("contadorPortadas");
const chipsEl = $("chips");
// La rueda del ratón desliza los filtros (Viendo, Por ver…) hacia los lados
chipsEl.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && chipsEl.scrollWidth > chipsEl.clientWidth) { chipsEl.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
const busquedaEl = $("busqueda");
const filtroGeneroEl = $("filtroGenero");
const ordenEl = $("orden");
const precargarBtn = $("precargarPortadas");
const guardarPortadasEl = $("guardarPortadas");
const borrarPortadasBtn = $("borrarPortadas");
const precargarStatusEl = $("precargarStatus");
const fillCoversBtn = $("fillCovers");
const fillStatusEl = $("fillStatus");
const migrateFlvBtn = $("migrateFlv");
const migrateStatusEl = $("migrateStatus");
const agregarPanelEl = $("agregarPanel");
const agregarUrlEl = $("agregarUrl");
const agregarBtnEl = $("agregarBtn");
const agregarStatusEl = $("agregarStatus");
const listasPanelEl = $("listasPanel");
const listasContenidoEl = $("listasContenido");
const listaNombreEl = $("listaNombre");
const listaUrlEl = $("listaUrl");
const listaGuardarBtnEl = $("listaGuardarBtn");
const listaStatusEl = $("listaStatus");

let todosLosAnimes = [];
let modoEdicion = false;
let filtroEstado = "-"; // por defecto: viendo
let filtroPendientes = false; // solo series en «Viendo» con capítulos publicados que no has visto
let filtroGeneros = new Set(); // filtro múltiple: el anime debe tener TODOS los seleccionados (y puede tener más)
const panelGenerosEl = $("panelGeneros");
const dlgGenerosEl = $("dlgGeneros");

// true mientras se muestra la lista guardada y se espera la de la hoja: las filas podrían
// haber cambiado, así que las escrituras por fila esperan a la lista actualizada.
let refrescandoLista = false;

function enviarMensaje(msg) {
  if (refrescandoLista && /^UPDATE_/.test(msg?.type || "")) return Promise.resolve({ ok: false, error: "SINCRONIZANDO" });
  if (typeof window.enviarMensajePWA === "function") return window.enviarMensajePWA(msg);
  return Promise.resolve({ ok: false, error: "SIN_RESPUESTA" });
}

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  hijos.forEach((h) => h && n.append(h));
  return n;
}

// normalizar() se llama una vez por serie en cada tecla del buscador, así que
// sin memoizar se vuelve a descomponer Unicode de toda la lista mientras se
// escribe. La caché va por texto de origen y se vacía si creciera sin control.
const cacheNormalizar = new Map();
function normalizar(s) {
  const k = String(s || "");
  let v = cacheNormalizar.get(k);
  if (v === undefined) {
    v = k.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (cacheNormalizar.size > 4000) cacheNormalizar.clear();
    cacheNormalizar.set(k, v);
  }
  return v;
}

// --- Aviso temporal ----------------------------------------------------------

const toastEl = $("toast");
let toastTimer;
function toast(texto) {
  toastEl.textContent = texto;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 1800);
}

// --- Tema claro / oscuro / automático ----------------------------------------

// El tema se elige en Opciones (selector «Tema»); aquí solo se aplica y se mantiene sincronizado.
function aplicarTema(modo) {
  document.documentElement.dataset.tema = modo;
  const ajT = $("ajTema");
  if (ajT) ajT.value = modo;
}
aplicarTema(document.documentElement.dataset.tema || "auto");

// --- Ajustes de apariencia y comportamiento (se guardan en este dispositivo) -------
const AJUSTES_BASE = { vista: "cuadricula", columnas: "auto", tamano: 155, espacio: 8, nota: true, estado: true, genero: true, siguienteCap: true, avisosCaps: false };
let ajustes = { ...AJUSTES_BASE };
try {
  const g = JSON.parse(localStorage.getItem("ajustes") || "null");
  if (g && typeof g === "object") ajustes = { ...AJUSTES_BASE, ...g };
} catch (e) {}

function aplicarAjustes() {
  const l = $("lista");
  const cols = parseInt(ajustes.columnas, 10);
  const tamano = Math.min(220, Math.max(100, Number(ajustes.tamano) || AJUSTES_BASE.tamano));
  const espacio = Number.isFinite(Number(ajustes.espacio)) ? Math.min(24, Math.max(0, Number(ajustes.espacio))) : AJUSTES_BASE.espacio;
  // Con los valores por defecto no se toca el CSS original (cada versión tiene su diseño base)
  if (cols >= 1 && cols <= 6) {
    // Columnas fijas: cada card ocupa su columna entera
    l.style.setProperty("--cols", `repeat(${cols}, minmax(0, 1fr))`);
    l.style.setProperty("--card-w", "100%");
  } else if (tamano !== AJUSTES_BASE.tamano) {
    l.style.setProperty("--cols", `repeat(auto-fit, minmax(${Math.round(tamano * 0.78)}px, 1fr))`);
    l.style.setProperty("--card-w", `${tamano}px`);
  } else {
    l.style.removeProperty("--cols");
    l.style.removeProperty("--card-w");
  }
  if (espacio !== AJUSTES_BASE.espacio) l.style.setProperty("--gap", `${espacio}px`);
  else l.style.removeProperty("--gap");
  l.classList.toggle("sin-nota", !ajustes.nota);
  l.classList.toggle("sin-estado", !ajustes.estado);
  l.classList.toggle("sin-genero", !ajustes.genero);
  l.classList.toggle("sin-siguiente", !ajustes.siguienteCap);
  l.classList.toggle("vista-lista", ajustes.vista === "lista");
}

function sincronizarControlesAjustes() {
  const fijas = parseInt(ajustes.columnas, 10) >= 1;
  $("ajTema").value = document.documentElement.dataset.tema || "auto";
  $("ajColumnas").value = fijas ? String(parseInt(ajustes.columnas, 10)) : "auto";
  $("ajTamano").value = ajustes.tamano;
  const enLista = ajustes.vista === "lista"; // en vista de lista no hay columnas ni tamaño de card
  $("ajVista").value = enLista ? "lista" : "cuadricula";
  $("ajColumnas").disabled = enLista;
  $("ajTamano").disabled = fijas || enLista;
  $("ajTamanoAyuda").textContent = fijas ? "Con columnas fijas, la card se adapta al ancho de la columna." : "Ancho máximo de cada card.";
  $("ajTamanoVal").textContent = `${ajustes.tamano}px`;
  $("ajEspacio").value = ajustes.espacio;
  $("ajEspacioVal").textContent = `${ajustes.espacio}px`;
  $("ajNota").checked = !!ajustes.nota;
  $("ajEstado").checked = !!ajustes.estado;
  $("ajGenero").checked = !!ajustes.genero;
  $("ajSiguienteCap").checked = !!ajustes.siguienteCap;
  $("ajAvisos").checked = !!ajustes.avisosCaps;
}

function guardarAjustes() {
  try { localStorage.setItem("ajustes", JSON.stringify(ajustes)); } catch (e) {}
  aplicarAjustes();
  sincronizarControlesAjustes();
}

$("ajTema").addEventListener("change", (e) => {
  try { localStorage.setItem("tema", e.target.value); } catch (err) {}
  aplicarTema(e.target.value);
});
$("ajVista").addEventListener("change", (e) => { ajustes.vista = e.target.value; guardarAjustes(); });
$("ajColumnas").addEventListener("change", (e) => { ajustes.columnas = e.target.value; guardarAjustes(); });
$("ajTamano").addEventListener("input", (e) => { ajustes.tamano = Number(e.target.value); guardarAjustes(); });
$("ajEspacio").addEventListener("input", (e) => { ajustes.espacio = Number(e.target.value); guardarAjustes(); });
[["ajNota", "nota"], ["ajEstado", "estado"], ["ajGenero", "genero"], ["ajSiguienteCap", "siguienteCap"]].forEach(([id, clave]) => {
  $(id).addEventListener("change", (e) => { ajustes[clave] = e.target.checked; guardarAjustes(); });
});
$("ajReset").addEventListener("click", () => { ajustes = { ...AJUSTES_BASE, avisosCaps: ajustes.avisosCaps }; // los avisos no son de apariencia: se conservan
   guardarAjustes(); toast("Apariencia restablecida"); });
aplicarAjustes();
sincronizarControlesAjustes();

// --- Logo e icono personalizados (se importan desde una imagen) -----------------------
// El logo de la cabecera se guarda en este dispositivo. En la extensión, además, se cambia el icono de la
// barra de herramientas de Chrome (background.js). En la PWA el icono de la pantalla de inicio lo fija
// Android al instalar la app (viene del manifest) y no se puede cambiar desde dentro.
const ES_EXTENSION = !!(window.chrome && chrome.runtime && chrome.runtime.id);
$("ajLogoAyuda").textContent = ES_EXTENSION
  ? "Cambia el logo de la cabecera y el icono de la extensión en la barra de Chrome."
  : "Cambia el logo de la cabecera. El icono de la pantalla de inicio lo fija Android al instalar la app.";

function aplicarLogo() {
  let url = "";
  try { url = localStorage.getItem("logoPersonal") || ""; } catch (e) {}
  document.querySelectorAll("img.logo").forEach((img) => { img.src = url || "icon48.png"; });
  let link = document.querySelector('link[rel~="icon"]');
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.append(link); }
  link.href = url || "icon48.png";
}

async function cargarImagenArchivo(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}

// Recorte cuadrado centrado, a `lado` px, como PNG (data URL)
function imagenCuadrada(img, lado) {
  const c = document.createElement("canvas");
  c.width = c.height = lado;
  const ctx = c.getContext("2d");
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, lado, lado);
  return c.toDataURL("image/png");
}

async function elegirLogo(archivo) {
  if (!archivo.type.startsWith("image/")) { toast("Elige un archivo de imagen"); return; }
  let img;
  try { img = await cargarImagenArchivo(archivo); } catch (e) { img = null; }
  if (!img || !img.naturalWidth || !img.naturalHeight) { toast("No se pudo leer esa imagen"); return; }
  try { localStorage.setItem("logoPersonal", imagenCuadrada(img, 96)); } catch (e) { toast("No se pudo guardar la imagen"); return; }
  if (ES_EXTENSION) {
    const iconos = {};
    [16, 32, 48, 128].forEach((n) => { iconos[n] = imagenCuadrada(img, n); });
    const r = await enviarMensaje({ type: "SET_ICONO", iconos });
    if (!r?.ok) toast("Logo cambiado, pero no se pudo cambiar el icono de la barra");
    else toast("Logo e icono cambiados");
  } else {
    toast("Logo cambiado");
  }
  aplicarLogo();
}

async function quitarLogo() {
  try { localStorage.removeItem("logoPersonal"); } catch (e) {}
  if (ES_EXTENSION) await enviarMensaje({ type: "RESET_ICONO" });
  aplicarLogo();
  toast("Logo e icono restablecidos");
}

$("ajLogoElegir").addEventListener("click", () => $("ajLogoArchivo").click());
$("ajLogoArchivo").addEventListener("change", (e) => {
  const archivo = e.target.files[0];
  e.target.value = ""; // permite volver a elegir el mismo archivo
  if (archivo) elegirLogo(archivo);
});
$("ajLogoQuitar").addEventListener("click", quitarLogo);
aplicarLogo();

// --- Preferencias de filtros (se recuerdan entre aperturas) -------------------

function guardarFiltros() {
  try {
    localStorage.setItem("filtros", JSON.stringify({ estado: filtroEstado, generos: [...filtroGeneros], orden: ordenEl.value, pendientes: filtroPendientes }));
  } catch (e) {}
}
function cargarFiltros() {
  try {
    const f = JSON.parse(localStorage.getItem("filtros") || "null");
    if (f) {
      filtroEstado = f.estado ?? "-";
      filtroGeneros = new Set(Array.isArray(f.generos) ? f.generos : (f.genero ? [f.genero] : []));
      ordenEl.value = f.orden || "";
      filtroPendientes = !!f.pendientes;
    }
  } catch (e) {}
}

// --- Caché local de portadas -------------------------------------------------
// La primera vez se descarga y se guarda en la Cache Storage de la extensión
// (compartida con background.js). Las siguientes veces se lee de ahí, sin red.

const COVER_CACHE = "anime-covers-v3";
const portadasEnCache = new Set();

function actualizarContadorPortadas() {
  const conPortada = todosLosAnimes.filter((a) => a.cover);
  const guardadas = conPortada.filter((a) => portadasEnCache.has(a.cover)).length;
  contadorPortadasEl.textContent = `Portadas guardadas en este dispositivo: ${guardadas} de ${conPortada.length}`;
}

async function inicializarContadorPortadas() {
  portadasEnCache.clear();
  try {
    const cache = await caches.open(COVER_CACHE);
    (await cache.keys()).forEach((k) => portadasEnCache.add(k.url));
  } catch (e) {
    console.error("[AnimeAV1 Tracker] No se pudo leer la caché de portadas:", e);
  }
  actualizarContadorPortadas();
}

// Devuelve una URL usable en <img>. Con soloCache=true solo asegura que
// la portada esté guardada (para la precarga) sin crear el blob.
function guardarPortadasActivado() {
  try { return localStorage.getItem("guardarPortadas") !== "false"; } catch (e) { return true; }
}

function aplicarPreferenciaPortadas() {
  const activado = guardarPortadasActivado();
  if (guardarPortadasEl) guardarPortadasEl.checked = activado;
  if (precargarBtn) precargarBtn.disabled = !activado;
  if (borrarPortadasBtn) borrarPortadasBtn.disabled = false;
  if (precargarStatusEl && !activado) precargarStatusEl.textContent = "El guardado local está desactivado.";
  actualizarContadorPortadas();
}

// --- Portadas rápidas (lista principal y posicionador) ---------------------------
// En la PWA el Service Worker sirve de la caché local cualquier <img> cuya URL esté
// guardada. Por eso aquí se descarga UNA sola vez (con límite de descargas
// simultáneas), se guarda en caché y se predecodifica para que, al pintarla, aparezca
// al instante. Mientras llega se muestra un esqueleto animado.
const portadaMem = new Set();    // urls ya descargadas y listas para pintar
const portadaPend = new Map();   // url -> Promise en curso (evita descargas duplicadas)
const portadaImgs = new Map();   // referencias a imágenes predecodificadas (máx. 80)
let portadaSlots = 4;
const portadaCola = [];
function portadaSlot() {
  return new Promise((res) => { if (portadaSlots > 0) { portadaSlots--; res(); } else portadaCola.push(res); });
}
function portadaLiberar() { const n = portadaCola.shift(); if (n) n(); else portadaSlots++; }

// Las portadas de Manwhaweb (img1mw.xyz, img2mw.xyz, …) bloquean la carga desde otros
// dominios según el Referer. Por eso: 1) se piden sin Referer, 2) si falla se prueban
// proxies de imágenes y 3) no se guardan en la caché local (la respuesta opaca podría ser
// un error 403 y quedaría guardada para siempre). El resto de URLs no cambia.
function esMW(url) {
  try { return /(^|\.)img\d+mw\.xyz$/i.test(new URL(url, location.href).hostname); } catch (_) { return false; }
}
// animeav1 (y su CDN) también se piden sin Referer: así lo hace la extensión y evita que el
// anti-hotlink del CDN rechace algunas portadas cuando llegan con el Referer de github.io.
function sinReferer(url) {
  try { return esMW(url) || /(^|\.)animeav1\.com$/i.test(new URL(url, location.href).hostname); } catch (_) { return false; }
}
const politicaReferer = (url) => (sinReferer(url) ? "no-referrer" : "strict-origin-when-cross-origin");

// Comprueba que la URL carga como imagen de verdad (pasa por el Service Worker, o sea, por la copia guardada).
function imagenValida(url) {
  return new Promise((resolve) => {
    const im = new Image();
    const t = setTimeout(() => resolve(false), 10000);
    im.referrerPolicy = politicaReferer(url);
    im.onload = () => { clearTimeout(t); resolve(true); };
    im.onerror = () => { clearTimeout(t); resolve(false); };
    im.src = url;
  });
}

// Borra una portada de todas las cachés de portadas (una copia opaca podía ser un error guardado).
async function purgarPortada(url) {
  portadaMem.delete(url); portadasEnCache.delete(url); portadaImgs.delete(url);
  try {
    for (const k of await caches.keys()) {
      if (k.startsWith("anime-covers-")) await (await caches.open(k)).delete(url);
    }
  } catch (_) {}
  try { actualizarContadorPortadas(); } catch (_) {}
}

function portadaAlternativas(url) {
  try {
    const u = new URL(url, location.href);
    if (!esMW(url)) return [];
    const sinProtocolo = encodeURIComponent(u.host + u.pathname + u.search);
    const propio = String(window.PWA_CONFIG?.mwProxy || "").trim().replace(/\/+$/, "");
    if (propio) return [propio + "/?url=" + encodeURIComponent(u.href)];
    return [
      "https://images.weserv.nl/?url=" + sinProtocolo,
      "https://wsrv.nl/?url=" + sinProtocolo,
      "https://wsrv.nl/?url=" + encodeURIComponent(u.href),
    ];
  } catch (_) { return []; }
}
// Siguiente intento tras un error de carga; devuelve false si ya no quedan.
function reintentarPortada(img, original) {
  // Portadas normales: si falla, puede ser una copia local corrupta. Se borra y se pide de nuevo a la red, sin Referer (una vez).
  if (!esMW(original)) {
    const n = Number(img.dataset.portadaCurada || 0);
    if (n < 3) {
      img.dataset.portadaCurada = String(n + 1);
      const espera = [1500, 5000, 12000][n];
      setTimeout(() => {
        purgarPortada(original).finally(() => {
          img.referrerPolicy = politicaReferer(original);
          // A partir del 2.º reintento se evita también una respuesta de error guardada por el navegador o el CDN.
          img.src = n >= 1 ? original + (original.includes("?") ? "&" : "?") + "_r=" + Date.now() : original;
        });
      }, espera);
      return true;
    }
  }
  const alts = portadaAlternativas(original);
  const n = Number(img.dataset.intentoPortada || 0);
  if (n >= alts.length) return false;
  img.dataset.intentoPortada = String(n + 1);
  img.referrerPolicy = "no-referrer";
  img.src = alts[n];
  return true;
}

function predecodificar(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(resolve, 8000);
    const fin = () => { clearTimeout(t); resolve(); };
    img.onload = fin; img.onerror = fin;
    img.src = url;
    portadaImgs.set(url, img);
    if (portadaImgs.size > 80) portadaImgs.delete(portadaImgs.keys().next().value);
    if (img.decode) img.decode().then(fin, fin);
  });
}

// Guarda la portada en la caché local (respuesta opaca, que el Service Worker sabe servir).
async function guardarEnCache(url) {
  if (esMW(url)) return; // ver nota sobre Manwhaweb más arriba
  const cache = await caches.open(COVER_CACHE);
  if (!(await cache.match(url))) {
    await portadaSlot();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12000);
      let res;
      try { res = await fetch(url, { mode: "no-cors", credentials: "omit", referrerPolicy: politicaReferer(url), signal: ctl.signal }); } finally { clearTimeout(t); }
      if (!res || (!res.ok && res.type !== "opaque")) throw new Error(`HTTP ${res?.status ?? "?"}`);
      await cache.put(url, res.clone());
      // Una respuesta opaca puede ser un error (403/429/5xx): se comprueba que carga como imagen o se descarta.
      if (!(await imagenValida(url))) { await cache.delete(url); throw new Error("la copia guardada no es una imagen válida"); }
    } finally { portadaLiberar(); }
  }
  portadasEnCache.add(url);
  actualizarContadorPortadas();
}

function obtenerPortada(url) {
  if (!url) return Promise.resolve("");
  if (portadaMem.has(url)) return Promise.resolve(url);
  if (portadaPend.has(url)) return portadaPend.get(url);
  // Con proxy propio, las de Manwhaweb van directas por él (la URL original siempre da 403).
  if (esMW(url) && window.PWA_CONFIG?.mwProxy) return Promise.resolve(portadaAlternativas(url)[0]);
  const p = (async () => {
    // Una sola petición por portada: primero se descarga y guarda (con límite de descargas simultáneas)
    // y solo después se pinta, desde la copia local. Si no se puede guardar, se pinta igualmente desde la red.
    // Antes se pedía 3-4 veces a la vez y el CDN rechazaba algunas.
    if (guardarPortadasActivado()) {
      try { await guardarEnCache(url); } catch (e) { console.error("[AnimeAV1 Tracker] No se pudo guardar la portada:", url, e); }
    }
    predecodificar(url).then(() => portadaMem.add(url));
    return url;
  })().finally(() => portadaPend.delete(url));
  portadaPend.set(url, p);
  return p;
}

function precalentarPortadas(animes) {
  (animes || []).forEach((a) => { if (a?.cover) obtenerPortada(a.cover); });
}

function observadorPortadas(raiz) {
  return new IntersectionObserver((entradas, obs) => {
    entradas.forEach((e) => { if (e.isIntersecting) { obs.unobserve(e.target); e.target._cargar?.(); } });
  }, { root: raiz, rootMargin: "240px" });
}

// Caja con esqueleto → portada con fundido; "Sin portada" si no hay o falla.
function crearPortada(anime, clase, observador) {
  const img = el("img", { alt: anime?.title || "", draggable: false, referrerPolicy: "strict-origin-when-cross-origin" });
  const caja = el("div", { className: clase }, img);
  const url = anime?.cover ? String(anime.cover).replace(/^http:\/\//i, "https://") : "";
  if (!url) { caja.classList.add("sin"); img.hidden = true; return caja; }
  caja.classList.add("cargando");
  const asignar = (src) => {
    const original = src || url;
    img.dataset.intentoPortada = "0";
    img.onload = () => { caja.classList.remove("cargando"); caja.classList.remove("sin"); img.hidden = false; img.classList.add("cargada"); };
    img.onerror = () => {
      if (reintentarPortada(img, original)) return;
      caja.classList.remove("cargando"); caja.classList.add("sin"); img.hidden = true;
    };
    img.referrerPolicy = politicaReferer(original);
    img.src = original;
  };
  const cargar = () => { if (portadaMem.has(url)) asignar(url); else obtenerPortada(url).then(asignar); };
  if (observador) { caja._cargar = cargar; observador.observe(caja); } else cargar();
  return caja;
}

// Con soloCache=true solo asegura que la portada esté guardada (precarga).
async function cargarPortada(url, soloCache = false) {
  if (!url) return url;
  if (soloCache) {
    if (guardarPortadasActivado() && !portadasEnCache.has(url)) {
      try { await guardarEnCache(url); } catch (e) { console.error("[AnimeAV1 Tracker] No se pudo guardar la portada:", url, e); }
    }
    return url;
  }
  return obtenerPortada(url);
}

// Las portadas solo se cargan cuando están cerca de la zona visible
const observador = new IntersectionObserver(
  (entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      const img = e.target;
      observador.unobserve(img);
      if (portadaMem.has(img.dataset.src)) img.src = img.dataset.src; else cargarPortada(img.dataset.src).then((src) => { img.src = src; });
    });
  },
  { root: listaEl, rootMargin: "300px" }
);


// --- Estadísticas ------------------------------------------------------------
const dlgStatsEl = document.getElementById("dlgStats");
const btnStats = document.getElementById("btnStats");

// Una nota de 0 NO es una nota: significa que la serie todavía no está valorada.
// Por eso se trata igual que una celda vacía en todo el cálculo (nota media,
// posicionador, separador de empates) y se muestra como "-" en la tarjeta.
function esNotaCero(a) {
  return parseFloat(String(a?.score ?? "").replace(",", ".")) === 0;
}

function numeroNota(a) {
  const n = parseFloat(String(a?.score ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.min(10, n) : null;
}

// Texto a mostrar en el campo de nota: un 0 se deja vacío para que se vea el
// guion del placeholder en vez de un 0 que parece una valoración pésima.
function textoNotaVisible(a) {
  return esNotaCero(a) ? "" : String(a?.score ?? "");
}

function crearBarraEstadistica(nombre, cantidad, maximo, sufijo = "") {
  const fila = el("div", { className: "stats-fila" });
  const ancho = maximo ? Math.round((cantidad / maximo) * 100) : 0;
  fila.append(
    el("span", { className: "nombre", textContent: nombre, title: nombre }),
    (() => { const barra = el("span", { className: "stats-barra" }); const relleno = el("i"); relleno.style.width = `${ancho}%`; barra.append(relleno); return barra; })(),
    el("span", { className: "cantidad", textContent: `${cantidad}${sufijo}` })
  );
  return fila;
}

function renderEstadisticas() {
  if (!dlgStatsEl) return;
  dlgStatsEl.innerHTML = "";
  const notas = todosLosAnimes.map(numeroNota).filter((n) => n !== null);
  const media = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : 0;
  const vistos = todosLosAnimes.filter((a) => a.status === "✔").length;
  const viendo = todosLosAnimes.filter((a) => a.status === "-").length;
  const porVer = todosLosAnimes.filter((a) => a.status === "@").length;
  const drop = todosLosAnimes.filter((a) => a.status === "📉").length;
  const sinVer = todosLosAnimes.filter((a) => a.status === "✖").length;
  const porcentajeVistos = todosLosAnimes.length ? Math.round(vistos / todosLosAnimes.length * 100) : 0;

  const cab = el("div", { className: "stats-cab" },
    el("h2", { textContent: "Estadísticas" }),
    el("button", { className: "stats-cerrar", type: "button", textContent: "×", ariaLabel: "Cerrar estadísticas", onclick: () => dlgStatsEl.close() })
  );
  const resumen = el("div", { className: "stats-resumen" });
  [
    [todosLosAnimes.length, "Anime en total"],
    [media ? media.toFixed(1) : "—", `Nota media · ${notas.length} valorados`],
    [vistos, `Vistos · ${porcentajeVistos}%`],
    [viendo, "Viendo ahora"],
    [porVer, "Por ver"],
    [sinVer + drop, `Sin completar · ${sinVer} sin ver / ${drop} drop`],
  ].forEach(([n, label]) => resumen.append(el("div", { className: "stats-tarjeta" }, el("span", { className: "stats-num", textContent: n }), el("span", { className: "stats-label", textContent: label }))));

  const estados = el("div", { className: "stats-seccion" }, el("h3", { textContent: "Estados" }));
  const estadoDatos = [["Vistos", vistos], ["Viendo", viendo], ["Por ver", porVer], ["Sin ver", sinVer], ["Dropeados", drop]];
  const maxEstado = Math.max(1, ...estadoDatos.map(x => x[1]));
  estadoDatos.forEach(([n, c]) => estados.append(crearBarraEstadistica(n, c, maxEstado)));

  const conteoGeneros = {};
  todosLosAnimes.forEach((a) => parseGeneros(a.genre).forEach((g) => { conteoGeneros[g] = (conteoGeneros[g] || 0) + 1; }));
  const generos = Object.entries(conteoGeneros).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, 8);
  const secGeneros = el("div", { className: "stats-seccion" }, el("h3", { textContent: "Géneros más frecuentes" }));
  if (!generos.length) secGeneros.append(el("div", { className: "stats-vacio", textContent: "Todavía no hay géneros." }));
  else { const maxGenero = Math.max(1, ...generos.map(x => x[1])); generos.forEach(([n,c]) => secGeneros.append(crearBarraEstadistica(n,c,maxGenero))); }

  // El 0 no aparece: no es una nota posible. La casilla "0" queda siempre a 0 y
  // no se pinta, para no sugerir que existe una nota cero. Sin el mínimo, las
  // notas de 0.1 a 0.4 redondearían a 0 y desaparecerían del gráfico: el total
  // pintado no cuadraría con "valorados".
  const distrib = Array.from({ length: 11 }, () => 0);
  notas.forEach((n) => distrib[Math.max(1, Math.round(n))]++);
  const secNotas = el("div", { className: "stats-seccion" }, el("h3", { textContent: "Distribución de notas" }));
  const notasGrid = el("div", { className: "stats-notas" });
  distrib.forEach((c, i) => { if (i === 0) return; notasGrid.append(el("div", { className: "stats-nota" }, el("b", { textContent: String(i) }), el("span", { textContent: c }))); });
  secNotas.append(notasGrid);

  dlgStatsEl.append(cab, resumen, estados, secGeneros, secNotas);
}

if (btnStats) btnStats.addEventListener("click", () => { renderEstadisticas(); dlgStatsEl.showModal(); });

// --- Comparar con la lista de un amigo ----------------------------------------------------------
// El amigo genera un enlace público (Tus listas > ⚙ > Enlace público). Aquí se lee su lista (solo lectura, en JSON)
// y se compara con la lista que tienes abierta: series en común, diferencias de nota y recomendaciones.
// Desde la página pública, el botón «Comparar con mi lista» abre la PWA con ?comparar=<enlace>.
const dlgCompararEl = document.getElementById("dlgComparar");
let enlaceCompararPendiente = null;
try {
  const p = new URLSearchParams(location.search).get("comparar");
  if (p) { enlaceCompararPendiente = p; history.replaceState(null, "", location.pathname + location.hash); }
} catch (e) {}
function lanzarCompararPendiente() {
  if (!enlaceCompararPendiente) return;
  const e = enlaceCompararPendiente;
  enlaceCompararPendiente = null;
  compararConEnlace(e);
}

// Acepta https://<worker>/v/<código> (con o sin .json, barra final, ?… o #…) y devuelve la dirección del JSON.
function urlDatosAmigo(texto) {
  const m = String(texto || "").trim().match(/^(https:\/\/[^\/\s?#]+)\/v\/([A-Za-z0-9_-]{16,64})(?:\.json)?\/?(?:[?#]\S*)?$/);
  return m ? `${m[1]}/v/${m[2]}.json` : "";
}
const normTextoComp = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// Identidad de una serie: host + /media/<serie> (sin número de capítulo); si no, host + ruta.
function claveUrlSerie(u) {
  try {
    const x = new URL(String(u || "").trim());
    const seg = x.pathname.split("/").filter(Boolean);
    if (!seg.length) return "";
    const ruta = seg[0].toLowerCase() === "media" && seg[1] ? seg.slice(0, 2) : seg;
    return (x.hostname.replace(/^www\./, "") + "/" + ruta.join("/")).toLowerCase();
  } catch (e) { return ""; }
}
// Empareja por enlace y, si no coincide, por título. Devuelve { comunes: [{m, s}], soloMias, soloSuyas }.
function emparejarListas(mias, suyas) {
  const porUrl = new Map(), porTitulo = new Map();
  suyas.forEach((s) => {
    const k = claveUrlSerie(s.url); if (k && !porUrl.has(k)) porUrl.set(k, s);
    const t = normTextoComp(s.titulo); if (t && !porTitulo.has(t)) porTitulo.set(t, s);
  });
  const usadas = new Set(), comunes = [], soloMias = [];
  mias.forEach((m) => {
    const s = porUrl.get(claveUrlSerie(m.url)) || porTitulo.get(normTextoComp(m.titulo));
    if (s && !usadas.has(s)) { usadas.add(s); comunes.push({ m, s }); } else soloMias.push(m);
  });
  return { comunes, soloMias, soloSuyas: suyas.filter((s) => !usadas.has(s)) };
}
const fmtComp = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
function analizarComparacion(mias, suyas) {
  const { comunes, soloMias, soloSuyas } = emparejarListas(mias, suyas);
  const ambos = comunes.filter(({ m, s }) => m.nota !== null && s.nota !== null).map(({ m, s }) => ({ m, s, dif: m.nota - s.nota }));
  const difMedia = ambos.length ? ambos.reduce((t, x) => t + Math.abs(x.dif), 0) / ambos.length : null;
  const coinciden = ambos.filter((x) => Math.abs(x.dif) <= 1).length;
  const filaBase = (x) => ({ titulo: x.titulo, url: x.url, portada: x.portada });
  const gustaAmbos = ambos.filter((x) => x.m.nota >= 8 && x.s.nota >= 8)
    .sort((a, b) => Math.min(b.m.nota, b.s.nota) - Math.min(a.m.nota, a.s.nota))
    .map((x) => ({ ...filaBase(x.m), pills: [["mia", "Tú " + fmtComp(x.m.nota)], ["", "Amigo " + fmtComp(x.s.nota)]] }));
  const discrepancias = ambos.filter((x) => Math.abs(x.dif) >= 1.5)
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))
    .map((x) => ({ ...filaBase(x.m), sub: x.dif > 0 ? "Te gusta más a ti" : "Le gusta más a tu amigo", pills: [["mia", "Tú " + fmtComp(x.m.nota)], ["", "Amigo " + fmtComp(x.s.nota)]] }));
  // Lo que tu amigo ha visto y puntúa alto, y tú no tienes o tienes pendiente
  const pendiente = (e) => e === "@" || e === "✖";
  const recomienda = [
    ...soloSuyas.filter((s) => s.estado === "✔" && s.nota !== null && s.nota >= 8).map((s) => ({ ...filaBase(s), sub: "No la tienes", nota: s.nota })),
    ...comunes.filter(({ m, s }) => pendiente(m.estado) && s.estado === "✔" && s.nota !== null && s.nota >= 8).map(({ s }) => ({ ...filaBase(s), sub: "La tienes pendiente", nota: s.nota })),
  ].sort((a, b) => b.nota - a.nota).map((x) => ({ ...x, pills: [["", "Amigo " + fmtComp(x.nota)]] }));
  // Lo que tú has visto y puntúas alto, y tu amigo no tiene
  const podriasRecomendar = soloMias.filter((m) => m.estado === "✔" && m.nota !== null && m.nota >= 8)
    .sort((a, b) => b.nota - a.nota).map((m) => ({ ...filaBase(m), pills: [["mia", "Tú " + fmtComp(m.nota)]] }));
  return { comunes, soloMias, soloSuyas, ambos, difMedia, coinciden, gustaAmbos, discrepancias, recomienda, podriasRecomendar };
}

function miniaturaComparacion(u) {
  const cont = el("div", { className: "comp-mini" });
  const src = /^https?:/i.test(u || "") ? (portadaAlternativas(u)[0] || u) : "";
  if (src) {
    const img = el("img", { src, alt: "", loading: "lazy", referrerPolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove());
    cont.append(img);
  }
  return cont;
}
function filaComparacion(x) {
  const props = { className: "comp-fila" };
  if (/^https?:/i.test(x.url || "")) Object.assign(props, { href: x.url, target: "_blank", rel: "noopener noreferrer" });
  return el(props.href ? "a" : "div", props,
    miniaturaComparacion(x.portada),
    el("div", { className: "comp-texto" },
      el("span", { className: "comp-titulo", textContent: x.titulo || "(sin título)" }),
      x.sub ? el("span", { className: "comp-sub", textContent: x.sub }) : null),
    el("div", { className: "comp-notas" }, ...(x.pills || []).map(([clase, t]) => el("span", { className: "comp-pill " + clase, textContent: t }))));
}
function seccionComparacion(titulo, ayuda, filas, vacio, max = 6) {
  const sec = el("div", { className: "stats-seccion" }, el("h3", { textContent: titulo + (filas.length ? ` (${filas.length})` : "") }));
  if (ayuda) sec.append(el("p", { className: "comp-ayuda", textContent: ayuda }));
  if (!filas.length) { sec.append(el("div", { className: "stats-vacio", textContent: vacio })); return sec; }
  const lista = el("div", { className: "comp-lista" });
  let todas = false;
  const pintar = () => { lista.innerHTML = ""; (todas ? filas : filas.slice(0, max)).forEach((f) => lista.append(filaComparacion(f))); };
  pintar();
  sec.append(lista);
  if (filas.length > max) {
    const b = el("button", { className: "btn-mini", type: "button", textContent: `Ver las ${filas.length}` });
    b.addEventListener("click", () => { todas = !todas; pintar(); b.textContent = todas ? "Ver menos" : `Ver las ${filas.length}`; });
    sec.append(b);
  }
  return sec;
}
function renderComparacion(amigo, miNombre) {
  const mias = todosLosAnimes.map((a) => ({ titulo: a.title, url: a.url, nota: notaNumero(a), estado: a.status, portada: a.cover }));
  const suyas = amigo.series.map((s) => ({ titulo: s.titulo, url: s.url, nota: Number(s.nota) > 0 ? Number(s.nota) : null, estado: s.estado, portada: s.portada }));
  const r = analizarComparacion(mias, suyas);
  dlgCompararEl.innerHTML = "";
  const cab = el("div", { className: "stats-cab" },
    el("h2", { textContent: "Comparar listas" }),
    el("button", { className: "stats-cerrar", type: "button", textContent: "×", ariaLabel: "Cerrar comparación", onclick: () => dlgCompararEl.close() }));
  const quien = el("p", { className: "comp-ayuda", textContent: `${miNombre || "Tu lista"} (${mias.length}) frente a «${amigo.nombre || "lista de tu amigo"}» (${suyas.length})` });
  const tarjeta = (num, label) => el("div", { className: "stats-tarjeta" }, el("span", { className: "stats-num", textContent: num }), el("span", { className: "stats-label", textContent: label }));
  const resumen = el("div", { className: "stats-resumen" },
    tarjeta(String(r.comunes.length), "Series en común"),
    tarjeta(r.difMedia === null ? "–" : fmtComp(r.difMedia), "Diferencia media de nota"),
    tarjeta(r.ambos.length ? `${r.coinciden} de ${r.ambos.length}` : "–", "Coincidís (±1 punto)"),
    tarjeta(String(r.soloSuyas.length), "Solo en su lista"));
  dlgCompararEl.append(cab, quien, resumen);
  if (!r.comunes.length) dlgCompararEl.append(el("div", { className: "stats-vacio", textContent: "No tenéis ninguna serie en común todavía." }));
  dlgCompararEl.append(
    seccionComparacion("Os gusta a los dos", "Series con 8 o más en las dos listas.", r.gustaAmbos, "Ninguna serie con 8 o más en las dos listas."),
    seccionComparacion("Opináis distinto", "Series en común con 1,5 puntos o más de diferencia.", r.discrepancias, "No hay diferencias grandes entre vuestras notas."),
    seccionComparacion("Te recomienda", "Series que tu amigo ha visto con 8 o más y que no tienes o tienes pendientes.", r.recomienda, "Nada que no tengas ya."),
    seccionComparacion("Podrías recomendarle", "Series que has visto con 8 o más y que él no tiene.", r.podriasRecomendar, "Nada que él no tenga ya."));
}
async function nombreListaActiva() {
  try { const r = await enviarMensaje({ type: "GET_LISTAS" }); return r?.listas?.find((l) => l.activa)?.name || ""; } catch (e) { return ""; }
}
async function compararConEnlace(texto, estadoEl) {
  const decir = (t) => { if (estadoEl) estadoEl.textContent = t; else if (t) toast(t); };
  const dir = urlDatosAmigo(texto);
  if (!dir) return decir("Pega el enlace público de una lista (tiene la forma https://…/v/…).");
  if (!todosLosAnimes.length) return decir("Abre primero una lista con series: es la que se comparará.");
  decir("Leyendo la lista de tu amigo…");
  const ctl = new AbortController();
  const corte = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(dir, { signal: ctl.signal, cache: "no-store" });
    if (r.status === 404) return decir("Ese enlace no existe o su dueño lo ha desactivado.");
    if (!r.ok) return decir(`No se pudo leer la lista (error ${r.status}).`);
    const datos = await r.json();
    if (!datos || !Array.isArray(datos.series)) return decir("La respuesta no parece una lista compartida.");
    renderComparacion(datos, await nombreListaActiva());
    decir("");
    dlgCompararEl.showModal();
  } catch (e) {
    decir(e?.name === "AbortError" ? "Tardó demasiado en responder. Inténtalo de nuevo." : "No se pudo conectar. Revisa el enlace y tu conexión.");
  } finally { clearTimeout(corte); }
}
$("compBtn").addEventListener("click", () => compararConEnlace($("compEnlace").value, $("compStatus")));
$("compEnlace").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); compararConEnlace($("compEnlace").value, $("compStatus")); } });

// --- Filtros -----------------------------------------------------------------

function llenarSelect(select, primera, opciones) {
  select.innerHTML = "";
  select.append(el("option", { value: "", textContent: primera }));
  opciones.forEach(({ value, label }) => select.append(el("option", { value, textContent: label })));
}

function inicializarToolbar() {
  llenarSelect(ordenEl, "Sin ordenar", [
    { value: "score-desc", label: "Nota: mayor a menor" },
    { value: "score-asc", label: "Nota: menor a mayor" },
  ]);
  cargarFiltros();
  ordenEl.addEventListener("change", () => { guardarFiltros(); render(); });
  filtroGeneroEl.addEventListener("click", () => { panelGenerosEl.hidden = !panelGenerosEl.hidden; renderPanelGeneros(); });
  busquedaEl.addEventListener("input", render);
}

function renderChips() {
  const conteo = {};
  todosLosAnimes.forEach((a) => { conteo[a.status] = (conteo[a.status] || 0) + 1; });
  chipsEl.innerHTML = "";
  [{ value: "", label: "Todos", n: todosLosAnimes.length }, ...ESTADOS.map((e) => ({ ...e, n: conteo[e.value] || 0 }))].forEach((e) => {
    const chip = el("button", { className: "chip", type: "button" }, e.value ? el("span", { className: "punto" }) : null, e.label, el("span", { className: "n", textContent: e.n }));
    if (e.value) chip.dataset.estado = e.value;
    chip.setAttribute("aria-pressed", String(filtroEstado === e.value));
    chip.addEventListener("click", () => { filtroEstado = e.value; guardarFiltros(); render(); });
    chipsEl.append(chip);
  });
}

// "Sin género" es un filtro especial y excluyente con el resto de géneros
const SIN = "__SIN_GENERO__";
// Con varios géneros seleccionados deben estar todos (el anime puede tener más)
function pasaGeneros(a, set) {
  if (!set.size) return true;
  const gs = parseGeneros(a.genre);
  if (set.has(SIN)) return gs.length === 0;
  for (const g of set) if (!gs.includes(g)) return false;
  return true;
}

// Recuento de cada género (y de "Sin género") en una sola pasada. Contarlo con
// un filter por género cuesta O(series × géneros), y el panel se repinta en cada
// tecla del buscador: con 500 series y 40 genres eran ~20 000 parseGeneros por
// pulsación. Así es O(series + géneros).
function contarGeneros(items) {
  const cuenta = new Map([[SIN, 0]]);
  items.forEach((a) => {
    const gs = parseGeneros(a.genre);
    if (!gs.length) cuenta.set(SIN, cuenta.get(SIN) + 1);
    gs.forEach((g) => cuenta.set(g, (cuenta.get(g) || 0) + 1));
  });
  return cuenta;
}

function renderPanelGeneros() {
  filtroGeneroEl.textContent = filtroGeneros.size ? `Géneros (${filtroGeneros.size})` : "Géneros";
  filtroGeneroEl.setAttribute("aria-pressed", String(filtroGeneros.size > 0));
  filtroGeneroEl.setAttribute("aria-expanded", String(!panelGenerosEl.hidden));
  panelGenerosEl.innerHTML = "";

  // El selector muestra solo géneros relevantes para los resultados actuales,
  // pero mantiene visibles los que ya están seleccionados.
  const q = normalizar(busquedaEl.value.trim());
  const base = todosLosAnimes.filter((a) =>
    (!filtroEstado || a.status === filtroEstado) &&
    (!q || normalizar(a.title).includes(q))
  );
  // Un solo recorrido para contar todos los géneros de la base.
  const conteo = contarGeneros(base);
  const cuenta = (g) => conteo.get(g) || 0;

  const cabecera = el("div", { className: "generos-cabecera" },
    el("span", { className: "generos-titulo", textContent: "Filtrar por género" }),
    el("span", { className: "generos-contador", textContent: filtroGeneros.size ? `${filtroGeneros.size} seleccionados` : "Sin filtro" })
  );

  const busqueda = el("input", {
    className: "generos-busqueda",
    type: "search",
    placeholder: "Buscar género…",
    ariaLabel: "Buscar género"
  });

  const lista = el("div", { className: "generos-lista" });
  const opciones = [SIN, ...catalogo];

  function pintarOpciones() {
    const texto = normalizar(busqueda.value.trim());
    lista.innerHTML = "";
    const visibles = opciones.filter((g) => !texto || normalizar(g === SIN ? "Sin género" : g).includes(texto));
    if (!visibles.length) {
      lista.append(el("div", { className: "generos-vacio", textContent: "No hay géneros que coincidan." }));
      return;
    }
    visibles.forEach((g) => {
      const cantidad = cuenta(g);
      const cb = el("input", { type: "checkbox", checked: filtroGeneros.has(g) });
      const fila = el("label", { className: "genero-opcion" },
        cb,
        el("span", { className: "nombre", textContent: g === SIN ? "Sin género" : g }),
        el("span", { className: "cantidad", textContent: cantidad })
      );
      cb.addEventListener("change", () => {
        if (g === SIN) {
          if (cb.checked) { filtroGeneros.clear(); filtroGeneros.add(SIN); }
          else filtroGeneros.delete(SIN);
        } else {
          if (cb.checked) { filtroGeneros.delete(SIN); filtroGeneros.add(g); }
          else filtroGeneros.delete(g);
        }
        guardarFiltros();
        render();
      });
      lista.append(fila);
    });
  }

  busqueda.addEventListener("input", pintarOpciones);
  pintarOpciones();

  const pie = el("div", { className: "generos-pie" });
  pie.append(
    el("button", { className: "btn-mini", type: "button", textContent: "Limpiar", disabled: !filtroGeneros.size,
      onclick: () => { filtroGeneros.clear(); guardarFiltros(); render(); }}),
    el("button", { className: "btn-mini", type: "button", textContent: "Gestionar géneros", onclick: () => abrirDialogoGeneros(null) })
  );

  panelGenerosEl.append(cabecera, busqueda, lista, pie);
}

// --- ¿Existe el capítulo siguiente? ------------------------------------------------
// El botón ⏭ solo se muestra si la ficha de la serie lista ese capítulo. Si no se puede
// comprobar (sin conexión, la ficha no lista capítulos), se muestra como antes.
let epsCache = {}; // slug -> { max: número | null, ts }
try { epsCache = JSON.parse(localStorage.getItem("epsDisponibles") || "{}") || {}; } catch (e) {}
const botonesSiguiente = new Map(); // slug -> Set(funciones que redibujan el botón de esa serie)
const colaCaps = [];
const enCaps = new Set();
let consultandoCaps = 0;

function slugYNumero(u) {
  const m = String(u || "").match(/\/media\/([^/?#]+)\/(\d+)/);
  return m ? { slug: m[1].toLowerCase(), n: parseInt(m[2], 10) } : null;
}
// max puede estar caducado: se sigue usando para dibujar mientras se vuelve a consultar
function capsInfo(slug, n) {
  const c = epsCache[slug];
  if (!c) return { max: undefined, fresco: false };
  const ttl = (c.max === null || (n && n > c.max)) ? 30 * 60 * 1000 : 6 * 60 * 60 * 1000; // sin más capítulos: se revisa antes
  return { max: c.max, fresco: Date.now() - c.ts < ttl };
}
function solicitarCapitulos(slug) {
  if (enCaps.has(slug)) return;
  enCaps.add(slug);
  colaCaps.push(slug);
  siguienteConsultaCaps();
}
function siguienteConsultaCaps() {
  while (consultandoCaps < 3 && colaCaps.length) {
    const slug = colaCaps.shift();
    consultandoCaps++;
    enviarMensaje({ type: "GET_CAPITULOS", slug })
      .then((r) => {
        epsCache[slug] = { max: r?.ok && Number.isFinite(r.max) ? r.max : null, emision: r?.ok ? (r.emision || null) : null, ts: Date.now() };
        try { localStorage.setItem("epsDisponibles", JSON.stringify(epsCache)); } catch (e) {}
        (botonesSiguiente.get(slug) || []).forEach((redibujar) => redibujar());
        volverAFiltrarPendientes();
      })
      .catch(() => {})
      .finally(() => { consultandoCaps--; enCaps.delete(slug); siguienteConsultaCaps(); });
  }
}

// ¿Tiene capítulos publicados que aún no has visto? (usa los datos de epsCache, que se piden a GET_CAPITULOS)
function infoUltimo(u) { // { slug, n }: n = último capítulo visto (0 si solo está la ficha de la serie)
  const m = String(u || "").match(/\/media\/([^/?#]+)(?:\/(\d+))?/i);
  return m ? { slug: m[1].toLowerCase(), n: m[2] ? parseInt(m[2], 10) : 0 } : null;
}
// «Pendientes» solo existe dentro de «Viendo»: con otro estado (o «Todos») el botón se oculta y el filtro no se aplica
function pendientesActivo() { return filtroPendientes && filtroEstado === "-"; }
function tieneCapituloPendiente(a) {
  if (a.status !== "-") return false;
  const inf = infoUltimo(a.lastEpisodeUrl);
  const max = inf ? epsCache[inf.slug]?.max : undefined;
  return Number.isFinite(max) && max > inf.n;
}
// Con el filtro «Pendientes» hay que conocer los capítulos de todas las series en «Viendo», no solo de las que se dibujan
function prepararPendientes() {
  for (const a of todosLosAnimes) {
    if (a.status !== "-") continue;
    const inf = infoUltimo(a.lastEpisodeUrl);
    if (inf && !capsInfo(inf.slug, inf.n + 1).fresco) solicitarCapitulos(inf.slug);
  }
}
let tmrPendientes = null;
function volverAFiltrarPendientes() { // llega una respuesta: se repinta (agrupando las que llegan juntas)
  actualizarContadorAvisos();
  if (!pendientesActivo()) return;
  clearTimeout(tmrPendientes);
  tmrPendientes = setTimeout(render, 200);
}
const filtroPendientesEl = $("filtroPendientes");
// Avisos de capítulos nuevos: número de series en «Viendo» con capítulos sin ver, en el botón ⏭ y (PWA) en el icono de la app.
// En la extensión el icono y las notificaciones los gestiona background.js (SET_AVISOS / GET_AVISOS).
function actualizarContadorAvisos() {
  const n = ajustes.avisosCaps ? todosLosAnimes.filter(tieneCapituloPendiente).length : 0;
  if (n) filtroPendientesEl.dataset.n = n > 99 ? "99+" : String(n); else delete filtroPendientesEl.dataset.n;
  if (!ES_EXTENSION && navigator.setAppBadge) {
    try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
  }
}
$("ajAvisos").addEventListener("change", async (e) => {
  ajustes.avisosCaps = e.target.checked;
  guardarAjustes();
  if (ES_EXTENSION) {
    const r = await enviarMensaje({ type: "SET_AVISOS", activo: ajustes.avisosCaps }).catch(() => null);
    if (!r?.ok) { ajustes.avisosCaps = !ajustes.avisosCaps; guardarAjustes(); toast("No se pudo cambiar el ajuste"); return; }
  }
  if (ajustes.avisosCaps) prepararPendientes();
  actualizarContadorAvisos();
  toast(ajustes.avisosCaps ? "Avisos de capítulos nuevos activados" : "Avisos desactivados");
});
if (ES_EXTENSION) { // la fuente de verdad es el segundo plano (el popup no puede programar alarmas)
  enviarMensaje({ type: "GET_AVISOS" }).then((r) => {
    if (r?.ok && !!r.activo !== !!ajustes.avisosCaps) { ajustes.avisosCaps = !!r.activo; guardarAjustes(); render(); }
  }).catch(() => {});
}
// --- Notificaciones push con la app cerrada ---------------------------------------------------------
// Las envía el Worker (tarea programada) cuando sale un capítulo nuevo de una serie en «Viendo». Aquí solo se activan y se
// le pasa al Worker qué series sigues y por qué capítulo vas (no puede leer tu Google Sheet). El seguimiento queda ligado a
// la lista que estaba activa al activarlo: al cambiar de lista no se mezclan las series (ni se vacía el seguimiento).
function seriesParaPush() {
  const porSlug = new Map();
  for (const a of todosLosAnimes) {
    if (a.status !== "-") continue;
    const inf = infoUltimo(a.lastEpisodeUrl);
    if (!inf || !/^[a-z0-9-]{1,80}$/.test(inf.slug)) continue;
    const previa = porSlug.get(inf.slug);
    if (!previa || inf.n > previa.visto) porSlug.set(inf.slug, { slug: inf.slug, titulo: String(a.title || inf.slug).slice(0, 80), visto: inf.n });
  }
  return [...porSlug.values()].slice(0, 200);
}
async function listaActivaInfo() {
  try { const r = await enviarMensaje({ type: "GET_LISTAS" }); const l = r?.listas?.find((x) => x.activa); return l ? { id: l.id, name: l.name || "" } : null; } catch (e) { return null; }
}
let tmrPush = null;
function sincronizarPush({ inmediato = false, forzar = false } = {}) {
  const lid = localStorage.getItem("pushListaId");
  if (!lid || !todosLosAnimes.length) return; // sin seguimiento activado o con la lista aún sin cargar (no se pisa lo ya enviado)
  clearTimeout(tmrPush);
  const ejecutar = async () => {
    const act = await listaActivaInfo();
    if (!act || act.id !== lid) return;
    const series = seriesParaPush();
    const hash = JSON.stringify(series);
    const reciente = Date.now() - Number(localStorage.getItem("pushSyncTs") || 0) < 5 * 24 * 3600 * 1000;
    if (!forzar && reciente && hash === localStorage.getItem("pushSyncHash")) return;
    const r = await enviarMensaje({ type: "PUSH_SINCRONIZAR", series }).catch(() => null);
    if (r?.ok && r.enviado) { localStorage.setItem("pushSyncHash", hash); localStorage.setItem("pushSyncTs", String(Date.now())); }
  };
  if (inmediato) ejecutar(); else tmrPush = setTimeout(ejecutar, 3000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sincronizarPush({ inmediato: true }); });

function mensajePush(err) {
  const e = String(err || "");
  if (e === "PUSH_PERMISO_DENEGADO") return "Has bloqueado las notificaciones: permítelas en los ajustes del navegador para este sitio.";
  if (e === "PUSH_NO_SOPORTADO") return "Este navegador no admite notificaciones push.";
  if (e === "PUSH_SIN_SUSCRIPCION") return "Este dispositivo no está suscrito: desactiva y vuelve a activar las notificaciones.";
  if (/failed to fetch|networkerror|load failed/i.test(e)) return "No se pudo conectar con el Worker.";
  if (/^PUSH_HTTP_404$/.test(e)) return "El Worker no tiene las notificaciones: vuelve a pegar worker-completo.js y pulsa Deploy.";
  return e || "No se pudo completar la operación.";
}
async function refrescarPush() {
  const r = await enviarMensaje({ type: "PUSH_ESTADO" }).catch(() => null);
  const interruptor = $("ajPush"), texto = $("ajPushEstado"), acciones = $("ajPushAcciones"), lista = $("ajPushLista");
  if (!r?.ok || !r.soportado) {
    interruptor.checked = false; interruptor.disabled = true; acciones.hidden = true;
    texto.textContent = "Este navegador no admite notificaciones push (en iPhone, solo con la app añadida a la pantalla de inicio).";
    return;
  }
  interruptor.disabled = false;
  interruptor.checked = !!r.activo;
  acciones.hidden = !r.activo;
  if (r.activo) {
    const nombre = localStorage.getItem("pushListaNombre");
    const act = await listaActivaInfo();
    texto.textContent = `Activas en este dispositivo${nombre ? ` · se sigue la lista «${nombre}»` : ""}.`;
    lista.hidden = !(act && act.id !== localStorage.getItem("pushListaId"));
  } else {
    texto.textContent = r.permiso === "denied" ? "Bloqueadas en el navegador: permítelas en los ajustes del sitio y vuelve a activarlas." : "Desactivadas.";
  }
}
$("ajPush").addEventListener("change", async (e) => {
  const interruptor = e.target, quiere = interruptor.checked;
  interruptor.disabled = true;
  try {
    if (quiere) {
      const act = await listaActivaInfo();
      if (!act) throw new Error("Abre primero una lista: se avisará de sus series en «Viendo».");
      const series = seriesParaPush();
      const r = await enviarMensaje({ type: "PUSH_ACTIVAR", series });
      if (!r?.ok) throw new Error(mensajePush(r?.error));
      localStorage.setItem("pushListaId", act.id);
      localStorage.setItem("pushListaNombre", act.name);
      localStorage.setItem("pushSyncHash", JSON.stringify(series));
      localStorage.setItem("pushSyncTs", String(Date.now()));
      toast("Notificaciones activadas. Prueba a enviarte una para comprobarlo.");
    } else {
      await enviarMensaje({ type: "PUSH_DESACTIVAR" });
      ["pushListaId", "pushListaNombre", "pushSyncHash", "pushSyncTs"].forEach((k) => localStorage.removeItem(k));
      toast("Notificaciones desactivadas");
    }
  } catch (err) { toast(err.message || mensajePush("")); }
  finally { interruptor.disabled = false; refrescarPush(); }
});
$("ajPushPrueba").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  const r = await enviarMensaje({ type: "PUSH_PRUEBA" }).catch(() => null);
  b.disabled = false;
  toast(r?.ok ? "Notificación enviada: debería llegar en unos segundos" : mensajePush(r?.error));
  if (r && !r.ok) sincronizarPush({ inmediato: true, forzar: true }); // si el Worker había perdido este dispositivo, se vuelve a registrar
});
$("ajPushLista").addEventListener("click", async () => {
  const act = await listaActivaInfo();
  if (!act) return;
  localStorage.setItem("pushListaId", act.id);
  localStorage.setItem("pushListaNombre", act.name);
  sincronizarPush({ inmediato: true, forzar: true });
  toast(`Ahora se avisa de las series de «${act.name || "esta lista"}»`);
  setTimeout(refrescarPush, 400);
});
refrescarPush();

function actualizarBotonPendientes() {
  filtroPendientesEl.hidden = filtroEstado !== "-";
  filtroPendientesEl.setAttribute("aria-pressed", String(filtroPendientes));
}
filtroPendientesEl.addEventListener("click", () => {
  filtroPendientes = !filtroPendientes;
  guardarFiltros();
  render();
});

// ---- Qué número de la dirección es el del capítulo ----
// ref = { seg, num } (parte de la ruta) o { q, num } (parámetro de la dirección). `num` cuenta los números de
// esa parte DESDE EL FINAL (-1 = el último), así no se rompe si el nombre de la serie lleva números.
function refCapituloPorDefecto(urlStr) {
  try {
    const u = new URL(urlStr);
    const segs = u.pathname.split("/");
    for (let i = segs.length - 1; i >= 0; i--) if (/\d/.test(segs[i])) return { seg: i, num: -1 };
    for (const [k, v] of u.searchParams) if (/\d/.test(v)) return { q: k, num: -1 };
  } catch (e) {}
  return null;
}
function urlCapituloSiguiente(urlStr, ref) {
  if (!ref) return "";
  try {
    const u = new URL(urlStr);
    const sumar = (s) => {
      const total = (s.match(/\d+/g) || []).length;
      const objetivo = total + ref.num;
      if (!total || objetivo < 0 || objetivo >= total) return null;
      let k = -1;
      return s.replace(/\d+/g, (m) => (++k === objetivo ? String(parseInt(m, 10) + 1).padStart(m.length, "0") : m));
    };
    if (ref.q !== undefined) {
      const v = u.searchParams.get(ref.q);
      const n = v === null ? null : sumar(v);
      if (n === null) return "";
      u.searchParams.set(ref.q, n);
    } else {
      const segs = u.pathname.split("/");
      const n = segs[ref.seg] === undefined ? null : sumar(segs[ref.seg]);
      if (n === null) return "";
      segs[ref.seg] = n;
      u.pathname = segs.join("/");
    }
    u.hash = "";
    return u.href;
  } catch (e) { return ""; }
}
// Otras webs (páginas fuente): se suma 1 al último número de la dirección del capítulo y se comprueba con el
// patrón de la fuente (así /serie/1/ -> /serie/2/ y /leer/x-12 -> /leer/x-13, pero no se inventa nada raro)
let fuentesCache = [];
function fuenteDe(u) { return fuentesCache.find((x) => x.activa !== false && String(u || "").startsWith(x.origen + "/")); }
function urlSiguienteFuente(u) {
  const f = fuenteDe(u);
  if (!f) return "";
  // El número del capítulo lo marca el usuario en la receta; sin marcar, se usa el último número de la ruta
  const sig = urlCapituloSiguiente(u, f.capitulo || refCapituloPorDefecto(u));
  try { return sig && new RegExp(f.patron).test(new URL(sig).pathname) ? sig : ""; } catch (e) { return ""; }
}
function siguienteCapitulo(u) { return fuenteDe(u) ? urlSiguienteFuente(u) : (urlSiguienteCap(u) || urlSiguienteFuente(u)); }

// ¿Existe ya el capítulo siguiente en esa otra web? Lo comprueba background (CAP_EXISTE) y se recuerda:
// existe -> 30 días; no existe -> 30 min; no se sabe -> 10 min. Si no está confirmado, el botón no se muestra.
let sigCache = {};
try { sigCache = JSON.parse(localStorage.getItem("sigFuente2") || "{}") || {}; } catch (e) { sigCache = {}; }
const enSig = new Set();
function sigFuenteInfo(sig) {
  const c = sigCache[sig];
  if (!c) return { existe: undefined, fresco: false };
  const ttl = c.e === true ? 30 * 864e5 : c.e === false ? 30 * 60e3 : 10 * 60e3;
  return { existe: c.e, fresco: Date.now() - c.ts < ttl };
}
const colaSig = [];
let activasSig = 0;
function solicitarSigFuente(sig, serie, patron) {
  if (enSig.has(sig)) return;
  enSig.add(sig);
  colaSig.push({ sig, serie, patron });
  siguienteSigFuente();
}
function siguienteSigFuente() {
  while (activasSig < 3 && colaSig.length) { activasSig++; consultarSigFuente(colaSig.shift()); }
}
function consultarSigFuente({ sig, serie, patron }) {
  enviarMensaje({ type: "CAP_EXISTE", url: sig, serie, patron })
    .then((r) => {
      sigCache[sig] = { e: r?.ok && typeof r.existe === "boolean" ? r.existe : null, ts: Date.now() };
      const claves = Object.keys(sigCache);
      if (claves.length > 600) claves.sort((a, b) => sigCache[a].ts - sigCache[b].ts).slice(0, claves.length - 500).forEach((k) => delete sigCache[k]);
      try { localStorage.setItem("sigFuente2", JSON.stringify(sigCache)); } catch (e) {}
      (botonesSiguiente.get(sig) || []).forEach((redibujar) => redibujar());
    })
    .catch(() => {})
    .finally(() => { enSig.delete(sig); activasSig--; siguienteSigFuente(); });
}

// Enlace al capítulo siguiente del último guardado (".../media/<serie>/<n>" -> n + 1; la ficha sin número -> 1), o "" si no se puede
function urlSiguienteCap(u) {
  const m = String(u || "").match(/^(https?:\/\/[^?#\s]*\/media\/[^/?#]+)(?:\/(\d+))?\/?(?:[?#].*)?$/i);
  return m ? `${m[1]}/${m[2] ? parseInt(m[2], 10) + 1 : 1}` : ""; // sin número (ficha de la serie): el siguiente es el 1
}

function render() {
  botonesSiguiente.clear(); // las cards se recrean: se vuelven a registrar al dibujarlas
  actualizarBotonPendientes();
  // Con los avisos activados en la PWA hay que conocer los capítulos de todas las series en «Viendo» (en la extensión lo hace el segundo plano)
  if (pendientesActivo() || (ajustes.avisosCaps && !ES_EXTENSION)) prepararPendientes();
  actualizarContadorAvisos();
  const orden = ordenEl.value;
  const q = normalizar(busquedaEl.value.trim());

  let lista = todosLosAnimes.filter((a) => {
    if (filtroEstado && a.status !== filtroEstado) return false;
    if (pendientesActivo() && !tieneCapituloPendiente(a)) return false;
    if (!pasaGeneros(a, filtroGeneros)) return false;
    if (q && !normalizar(a.title).includes(q)) return false;
    return true;
  });

  if (orden) {
    const desc = orden === "score-desc";
    // Una serie sin nota no está en la escala, así que va siempre al final, en los
    // dos sentidos. Antes se leía como un 0 y cambiaba de sitio según la dirección
    // (primera al ordenar de menor a mayor, última al revés), lo que además la
    // mezclaba con una nota 0 real.
    lista.sort((a, b) => {
      const na = numeroNota(a), nb = numeroNota(b);
      if (na == null) return nb == null ? 0 : 1;
      if (nb == null) return -1;
      return desc ? nb - na : na - nb;
    });
  }

  renderChips();
  renderPanelGeneros();
  observador.disconnect();
  listaEl.innerHTML = "";

  vacioEl.hidden = lista.length > 0;
  if (lista.length === 0) {
    vacioEl.innerHTML = "";
    if (todosLosAnimes.length === 0) {
      vacioEl.textContent = "Todavía no hay animes. Abre un episodio en animeav1.com y aparecerá aquí.";
    } else if (pendientesActivo() && (consultandoCaps > 0 || colaCaps.length > 0)) {
      vacioEl.textContent = "Comprobando los capítulos publicados…";
    } else {
      vacioEl.append("Ningún anime coincide con estos filtros.", el("br"), el("button", {
        className: "btn", textContent: "Quitar filtros",
        onclick: () => { filtroEstado = ""; filtroPendientes = false; filtroGeneros.clear(); ordenEl.value = ""; busquedaEl.value = ""; guardarFiltros(); render(); },
      }));
    }
    return;
  }
  lista.forEach((anime) => listaEl.append(renderItem(anime)));
}

// --- Tarjeta de cada anime --------------------------------------------------

function crearSelect(options, valorActual, incluirVacio, labelVacio) {
  const select = el("select");
  if (incluirVacio) select.append(el("option", { value: "", textContent: labelVacio || "—", selected: !valorActual }));
  options.forEach((opt) => {
    const value = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    select.append(el("option", { value, textContent: label, selected: value === valorActual }));
  });
  return select;
}

function flashGuardado(elemento) {
  elemento.classList.add("saved-flash");
  setTimeout(() => elemento.classList.remove("saved-flash"), 700);
}

async function guardar(msg, ...elementos) {
  const res = await enviarMensaje(msg);
  if (res?.ok) elementos.forEach(flashGuardado);
  else toast(res?.error === "SINCRONIZANDO" ? "Sincronizando con la hoja… repite el cambio en un momento" : "No se pudo guardar el cambio");
  if (res?.ok) guardarListaCache();
  return !!res?.ok;
}

// Color de la nota: rojo (0) -> verde (10). Un 11 (fuera de escala) se marca en amarillo.
// Sin nota (vacío) o nota 0 no se colorea: el 0 significa "sin valorar", así que
// nunca debe verse el rojo de "nota pésima".
function aplicarColorNota(input) {
  const n = parseFloat(String(input.value).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) { input.style.backgroundColor = input.style.color = ""; return; }
  if (n > 10) { input.style.backgroundColor = "#facc15"; input.style.color = "#78350f"; return; }
  input.style.backgroundColor = `hsl(${(n / 10) * 120}, 72%, 38%)`;
  input.style.color = "#fff";
}

function campoEdicion(etiqueta, valor, placeholder, onChange) {
  const input = el("input", { type: "text", value: valor || "", placeholder: placeholder || "" });
  input.addEventListener("change", () => onChange && onChange(input));
  return { input, campo: el("label", { textContent: etiqueta }, input) };
}

function renderItem(anime) {
  const card = el("div", { className: "card" });
  card.dataset.estado = anime.status || "";

  // Portada con nota y acceso al último capítulo
  const portada = el("div", { className: "portada" });
  let img = null;
  if (anime.cover) {
    img = el("img", { className: "cover", alt: "", draggable: false, referrerPolicy: "strict-origin-when-cross-origin" });
    const portadaSrc = String(anime.cover).replace(/^http:\/\//i, "https://");
    img.dataset.src = portadaSrc;
    img.addEventListener("load", () => img.classList.add("lista"));
    img.addEventListener("error", () => { reintentarPortada(img, portadaSrc); });
    img.referrerPolicy = politicaReferer(portadaSrc);
    portada.append(img);
    if (portadaMem.has(portadaSrc)) img.src = portadaSrc; else observador.observe(img);
  } else {
    portada.append(el("div", { className: "sin-portada", textContent: "Sin portada" }));
  }

  // El 0 significa "sin valorar": se muestra como "-" (placeholder), nunca como nota.
  const inputScore = el("input", { className: "nota", type: "number", inputMode: "decimal", step: "0.1", min: "0.1", max: "10", value: textoNotaVisible(anime), placeholder: "-", title: "Nota (0.1-10). Vacío o 0 = sin valorar", ariaLabel: "Nota (0.1-10), vacío o 0 significa sin valorar" });
  aplicarColorNota(inputScore);
  inputScore.addEventListener("input", () => aplicarColorNota(inputScore));
  inputScore.addEventListener("change", () => {
    let valor = String(inputScore.value || "").replace(",", ".").trim();
    if (valor !== "") {
      const n = parseFloat(valor);
      if (!Number.isFinite(n)) return;
      // Un 0 escrito a mano se interpreta como "sin valorar" y se guarda vacío.
      valor = n > 0 ? String(Math.min(10, n)) : "";
      inputScore.value = valor;
    }
    anime.score = valor;
    aplicarColorNota(inputScore);
    guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "score", valor }, inputScore);
  });

  const btnUltimoCap = el("a", { className: "btn-ultimo-cap", target: "_blank", title: "Ir al último capítulo visto", ariaLabel: "Último capítulo visto", textContent: "▶" });
  // «Viendo»: abre el capítulo siguiente al último registrado y lo marca como el último visto
  const btnSiguienteCap = el("a", { className: "btn-ultimo-cap btn-siguiente", target: "_blank", rel: "noopener", title: "Abrir el siguiente capítulo", ariaLabel: "Siguiente capítulo", textContent: "⏭\uFE0E" });
  btnSiguienteCap.addEventListener("click", (e) => {
    const sig = siguienteCapitulo(anime.lastEpisodeUrl);
    e.preventDefault(); // se abre a mano: así el enlace no cambia mientras se procesa el clic
    if (!sig) return;
    window.open(sig, "_blank", "noopener");
    anime.lastEpisodeUrl = sig;
    enviarMensaje({ type: "UPDATE_ANIME", row: anime.row, campo: "lastEpisodeUrl", valor: sig })
      .then((r) => { if (!r?.ok) toast(mensajeError(r?.error || "error desconocido")); });
    actualizarBotonUltimoCap();
  });
  // Serie terminada y ya vista hasta el último capítulo publicado: sugiere pasarla a «Visto» con un toque
  const chipVisto = el("button", { className: "btn-mini chip-visto", type: "button", textContent: "✔ Terminada: marcar como Visto", title: "Has visto el último capítulo publicado y la serie ya ha terminado" });
  chipVisto.style.display = "none";
  chipVisto.addEventListener("click", () => { selectEstado.value = "✔"; selectEstado.dispatchEvent(new Event("change")); });
  function actualizarBotonUltimoCap() {
    const visible = anime.status === "📉" && anime.lastEpisodeUrl;
    if (visible) btnUltimoCap.href = anime.lastEpisodeUrl; else btnUltimoCap.removeAttribute("href");
    btnUltimoCap.style.display = visible ? "flex" : "none";
    let sig = anime.status === "-" ? siguienteCapitulo(anime.lastEpisodeUrl) : "";
    const fuenteWeb = sig ? fuenteDe(anime.lastEpisodeUrl) : null;
    const inf = sig && !fuenteWeb ? slugYNumero(sig) : null;
    if (fuenteWeb) { // otra web: solo se muestra si está confirmado que existe el capítulo siguiente
      const clave = sig;
      const { existe, fresco } = sigFuenteInfo(clave);
      if (!botonesSiguiente.has(clave)) botonesSiguiente.set(clave, new Set());
      botonesSiguiente.get(clave).add(actualizarBotonUltimoCap);
      if (!fresco) solicitarSigFuente(clave, anime.url, fuenteWeb.patron);
      if (existe !== true) sig = "";
    } else if (inf) {
      const { max, fresco } = capsInfo(inf.slug, inf.n);
      if (Number.isFinite(max) && inf.n > max) sig = ""; // la ficha no lista ese capítulo: no hay siguiente
      if (!botonesSiguiente.has(inf.slug)) botonesSiguiente.set(inf.slug, new Set());
      botonesSiguiente.get(inf.slug).add(actualizarBotonUltimoCap);
      if (!fresco) solicitarCapitulos(inf.slug);
    }
    if (sig) btnSiguienteCap.href = sig; else btnSiguienteCap.removeAttribute("href");
    btnSiguienteCap.style.display = sig ? "flex" : "none";
    // ¿Terminada y vista hasta el último capítulo publicado? (los datos llegan de GET_CAPITULOS y esta función se vuelve a llamar)
    const infV = anime.status === "-" ? infoUltimo(anime.lastEpisodeUrl) : null;
    const cV = infV ? epsCache[infV.slug] : null;
    chipVisto.style.display = cV && cV.emision === "terminada" && Number.isFinite(cV.max) && infV.n > 0 && infV.n >= cV.max ? "" : "none";
  }
  actualizarBotonUltimoCap();
  portada.append(inputScore, btnUltimoCap, btnSiguienteCap);

  // Info
  const info = el("div", { className: "info" });
  const link = el("a", { className: "titulo", href: anime.url || "#", target: "_blank", textContent: anime.title || "(sin título)", title: anime.title || "" });

  const selectEstado = crearSelect(ESTADOS, anime.status, false);
  selectEstado.className = "estado";
  selectEstado.title = selectEstado.ariaLabel = "Estado";
  selectEstado.addEventListener("change", async () => {
    anime.status = selectEstado.value;
    card.dataset.estado = selectEstado.value;
    actualizarBotonUltimoCap();
    if (await guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "status", valor: selectEstado.value }, selectEstado)) render();
  });

  const gsAnime = parseGeneros(anime.genre);
  const selectGenero = el("button", { className: "genero", type: "button", textContent: gsAnime.join(" · ") || "Sin género", title: gsAnime.join(", ") || "Añadir géneros" });
  selectGenero.ariaLabel = "Géneros";
  selectGenero.addEventListener("click", () => abrirDialogoGeneros(anime));

  info.append(link, selectEstado, selectGenero, chipVisto);

  // Bloque de edición (solo con "Modo edición" activado)
  if (modoEdicion) {
    const cover = campoEdicion("Portada (URL)", anime.cover, "https://…", async (input) => {
      anime.cover = input.value.trim();
      if (!(await guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "cover", valor: anime.cover }, input)) || !anime.cover) return;
      if (img) cargarPortada(anime.cover).then((src) => { img.src = src; });
      else render();
    });
    const titulo = campoEdicion("Título", anime.title);
    const enlace = campoEdicion("Enlace", anime.url, "https://animeav1.com/media/…");
    // Título y enlace se guardan juntos (viven en la misma celda del Sheet)
    async function guardarTituloEnlace() {
      anime.title = titulo.input.value.trim();
      anime.url = enlace.input.value.trim();
      link.textContent = anime.title || "(sin título)";
      link.href = anime.url || "#";
      await guardar({ type: "UPDATE_TITLE_URL", row: anime.row, title: anime.title, url: anime.url }, titulo.input, enlace.input);
    }
    titulo.input.addEventListener("change", guardarTituloEnlace);
    enlace.input.addEventListener("change", guardarTituloEnlace);

    const ultimo = campoEdicion("Último capítulo (URL)", anime.lastEpisodeUrl, "Enlace al último capítulo", async (input) => {
      anime.lastEpisodeUrl = input.value.trim();
      if (await guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "lastEpisodeUrl", valor: anime.lastEpisodeUrl }, input)) actualizarBotonUltimoCap();
    });
    info.append(el("div", { className: "edicion" }, cover.campo, titulo.campo, enlace.campo, ultimo.campo));
    // Mover a otra lista (copia con todos sus datos al destino y la quita de esta)
    const destinos = listasCache.filter((l) => !l.activa);
    if (destinos.length) {
      const mover = el("select", { className: "mover-lista", ariaLabel: "Mover a otra lista", title: "Mover esta serie a otra lista" });
      mover.append(el("option", { value: "", textContent: "Mover a…" }));
      destinos.forEach((l) => mover.append(el("option", { value: l.id, textContent: l.name })));
      mover.addEventListener("change", async () => {
        const dest = destinos.find((l) => l.id === mover.value);
        mover.value = "";
        if (dest) moverSerie(anime, dest, mover);
      });
      // Varias a la vez: se marcan y la barra de arriba las mueve juntas
      const chk = el("input", { type: "checkbox", ariaLabel: "Elegir para mover varias a la vez" });
      chk.checked = seleccionMover.has(anime.row);
      chk.addEventListener("change", () => { if (chk.checked) seleccionMover.set(anime.row, anime); else seleccionMover.delete(anime.row); pintarBarraMover(); });
      info.append(el("label", { className: "marcar-mover", title: "Elegir para mover varias series a la vez" }, chk, "Elegir"), mover);
    }
    if (esListaSinSheet()) {
      // Una lista local o de la nube no tiene hoja donde borrar la fila: se elimina desde aquí
      const borrar = el("button", { className: "btn-mini peligro", type: "button", textContent: "Eliminar de la lista" });
      borrar.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar «${anime.title}» de esta lista?`)) return;
        const r = await enviarMensaje({ type: "DELETE_SERIE_LOCAL", row: anime.row });
        if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
        todosLosAnimes = todosLosAnimes.filter((a) => a.row !== anime.row);
        toast("Serie eliminada");
        render();
        guardarListaCache();
      });
      info.append(borrar);
    }
  }

  card.append(portada, info);
  return card;
}

// --- Diálogo de géneros: asignar varios a un anime y añadir / renombrar / quitar --

// Aplica fn a los géneros de cada anime y guarda todos los cambios de una vez
async function cambiarGeneroEnHoja(fn) {
  const cambios = [];
  todosLosAnimes.forEach((a) => {
    const ant = parseGeneros(a.genre), nue = fn(ant);
    if (nue.join("|") !== ant.join("|")) cambios.push({ a, valor: nue.join(", ") });
  });
  if (cambios.length) {
    const res = await enviarMensaje({ type: "UPDATE_GENRES_BULK", cambios: cambios.map((c) => ({ row: c.a.row, valor: c.valor })) });
    if (!res?.ok) { toast("No se pudo guardar el cambio"); return false; }
    cambios.forEach((c) => { c.a.genre = c.valor; });
  }
  return true;
}

function abrirDialogoGeneros(anime) {
  const sel = new Set(anime ? parseGeneros(anime.genre) : []);

  async function renombrar(g) {
    const n = limpiarGenero(prompt(`Nuevo nombre para «${g}» (se cambia en todos los animes):`, g));
    if (!n || n === g) return;
    if (!(await cambiarGeneroEnHoja((a) => unico(a.map((x) => (x === g ? n : x)))))) return;
    catalogo = unico(catalogo.map((x) => (x === g ? n : x))); guardarCatalogo();
    if (filtroGeneros.delete(g)) filtroGeneros.add(n);
    if (sel.delete(g)) sel.add(n);
    guardarFiltros(); pintar(); render();
  }

  async function quitar(g) {
    const usos = todosLosAnimes.filter((a) => parseGeneros(a.genre).includes(g)).length;
    if (!confirm(`¿Quitar «${g}»?` + (usos ? ` Se eliminará de ${usos} anime(s).` : ""))) return;
    if (!(await cambiarGeneroEnHoja((a) => a.filter((x) => x !== g)))) return;
    catalogo = catalogo.filter((x) => x !== g); guardarCatalogo();
    filtroGeneros.delete(g); sel.delete(g);
    guardarFiltros(); pintar(); render();
  }

  function pintar() {
    dlgGenerosEl.innerHTML = "";
    const lista = el("div", { className: "gen-lista" });
    catalogo.forEach((g) => {
      const fila = el("div", { className: "gen-fila" });
      if (anime) {
        const cb = el("input", { type: "checkbox", checked: sel.has(g) });
        cb.addEventListener("change", () => { if (cb.checked) sel.add(g); else sel.delete(g); });
        fila.append(el("label", { className: "gen-nombre" }, cb, g));
      } else fila.append(el("span", { className: "gen-nombre", textContent: g }));
      fila.append(
        el("button", { className: "btn-mini", type: "button", textContent: "✎", title: "Renombrar", onclick: () => renombrar(g) }),
        el("button", { className: "btn-mini peligro", type: "button", textContent: "✕", title: "Quitar", onclick: () => quitar(g) })
      );
      lista.append(fila);
    });

    const nuevo = el("input", { type: "text", placeholder: "Nuevo género", ariaLabel: "Nuevo género" });
    const anadir = () => {
      const n = limpiarGenero(nuevo.value);
      if (!n) return;
      if (!catalogo.includes(n)) catalogo.push(n);
      if (anime) sel.add(n);
      guardarCatalogo(); pintar(); render();
    };
    nuevo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } });

    const pie = el("div", { className: "gen-pie" });
    if (anime) {
      pie.append(
        el("button", { className: "btn", type: "button", textContent: "Cancelar", onclick: () => dlgGenerosEl.close() }),
        el("button", { className: "btn", type: "button", textContent: "Guardar", onclick: async () => {
          const valor = catalogo.filter((g) => sel.has(g)).join(", ");
          if (valor !== anime.genre) {
            if (!(await guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "genre", valor }))) return;
            anime.genre = valor;
          }
          dlgGenerosEl.close(); render();
        } })
      );
    } else pie.append(el("button", { className: "btn", type: "button", textContent: "Cerrar", onclick: () => dlgGenerosEl.close() }));

    dlgGenerosEl.append(
      el("h2", { textContent: anime ? `Géneros: ${anime.title || "(sin título)"}` : "Gestionar géneros" }),
      lista,
      el("div", { className: "gen-add" }, nuevo, el("button", { className: "btn", type: "button", textContent: "Añadir", onclick: anadir })),
      pie
    );
  }
  pintar();
  if (!dlgGenerosEl.open) dlgGenerosEl.showModal();
}

// --- Minijuego de posicionamiento ----------------------------------------------
const dlgPosicionarEl = $("dlgPosicionar");
let posicionState = null;

function notaNumero(a) {
  const n = parseFloat(String(a?.score ?? "").replace(",", "."));
  return Number.isFinite(n) ? (n <= 0 ? null : Math.min(10, Math.max(0, n))) : null;
}
function notaRedondeada(n) { return Math.round(Math.min(10, Math.max(0.1, n)) * 10) / 10; }
function mediana(nums) {
  const a = nums.slice().sort((x,y) => x-y);
  if (!a.length) return 5;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}
function posicionTitulo(a) { return a?.title || "(sin título)"; }

let posObservadores = [];
function limpiarObservadoresPos() { posObservadores.forEach((o) => o.disconnect()); posObservadores = []; }
function nuevoObservadorPos(raiz) { const o = observadorPortadas(raiz); posObservadores.push(o); return o; }
function pantallaNueva() {
  limpiarObservadoresPos();
  dlgPosicionarEl.onkeydown = null;
  dlgPosicionarEl.innerHTML = "";
}
dlgPosicionarEl.addEventListener("close", () => { dlgPosicionarEl.onkeydown = null; limpiarObservadoresPos(); });

function abrirPosicionador() {
  const validas = todosLosAnimes.filter(a => a && a.row != null && a.title);
  if (validas.length < 2) { toast("Necesitas al menos 2 series para posicionar"); return; }
  posicionState = { validas };
  renderPosicionInicio();
  if (!dlgPosicionarEl.open) { dlgPosicionarEl.showModal(); dlgPosicionarEl.focus({ preventScroll: true }); }
}

let posicionFiltros = { q: "", genero: "", estado: "", orden: "" };

function renderPosicionInicio() {
  const validas = posicionState.validas;
  pantallaNueva();
  const sinNota = validas.filter(a => notaNumero(a) == null);
  const generos = unico(validas.flatMap(a => parseGeneros(a.genre))).sort((a,b) => a.localeCompare(b, "es"));
  const buscador = el("input", { className: "pos-busqueda", type: "search", placeholder: "Buscar por nombre…", ariaLabel: "Buscar serie" });
  buscador.value = posicionFiltros.q;
  const estado = el("select", { className: "pos-filtro", ariaLabel: "Filtrar por estado" });
  estado.append(el("option", { value: "", textContent: "Todos los estados" }));
  ESTADOS.forEach(e => estado.append(el("option", { value: e.value, textContent: e.label })));
  estado.value = posicionFiltros.estado;
  const genero = el("select", { className: "pos-filtro", ariaLabel: "Filtrar por género" });
  genero.append(el("option", { value: "", textContent: "Todos los géneros" }));
  generos.forEach(g => genero.append(el("option", { value: g, textContent: g })));
  genero.value = posicionFiltros.genero;
  const orden = el("select", { className: "pos-filtro", ariaLabel: "Ordenar series" });
  [["", "Orden recomendado"],["title-asc", "Nombre: A → Z"],["title-desc", "Nombre: Z → A"],["score-desc", "Nota: mayor a menor"],["score-asc", "Nota: menor a mayor"],["unrated", "Sin valorar primero"]].forEach(([value,label]) => orden.append(el("option", { value, textContent: label })));
  orden.value = posicionFiltros.orden;
  const lista = el("div", { className: "pos-selector-grid" });
  const mensaje = el("div", { className: "pos-lista-vacia", hidden: true });
  const cuenta = el("span", {});
  let obsLista = null;
  function obtenerLista() {
    const q = normalizar(posicionFiltros.q);
    let arr = validas.filter(a => (!q || normalizar(a.title).includes(q)) && (!posicionFiltros.estado || a.status === posicionFiltros.estado) && (!posicionFiltros.genero || parseGeneros(a.genre).includes(posicionFiltros.genero)));
    const nota = a => notaNumero(a);
    arr.sort((a,b) => {
      if (posicionFiltros.orden === "title-asc") return posicionTitulo(a).localeCompare(posicionTitulo(b), "es");
      if (posicionFiltros.orden === "title-desc") return posicionTitulo(b).localeCompare(posicionTitulo(a), "es");
      if (posicionFiltros.orden === "score-desc") return (nota(b) ?? -1) - (nota(a) ?? -1);
      if (posicionFiltros.orden === "score-asc") return (nota(a) ?? 11) - (nota(b) ?? 11);
      if (posicionFiltros.orden === "unrated") return (nota(a) == null ? 0 : 1) - (nota(b) == null ? 0 : 1) || posicionTitulo(a).localeCompare(posicionTitulo(b), "es");
      return (nota(a) == null ? 0 : 1) - (nota(b) == null ? 0 : 1) || (nota(b) ?? 0) - (nota(a) ?? 0) || posicionTitulo(a).localeCompare(posicionTitulo(b), "es");
    });
    return arr;
  }
  function pintarLista() {
    if (obsLista) obsLista.disconnect();
    obsLista = nuevoObservadorPos(lista); // las portadas se cargan solo al acercarse a la zona visible
    lista.innerHTML = "";
    const arr = obtenerLista();
    cuenta.textContent = `${arr.length} serie${arr.length === 1 ? "" : "s"}`;
    mensaje.hidden = arr.length > 0;
    lista.scrollTop = 0;
    if (!arr.length) { mensaje.textContent = "No hay series que coincidan con estos filtros."; return; }
    arr.forEach(a => {
      const card = el("button", { className: "pos-selector-card", type: "button", title: `Posicionar ${posicionTitulo(a)}` });
      const portada = crearPortada(a, "pos-selector-portada", obsLista);
      const info = el("div", { className: "pos-selector-info" });
      info.append(el("strong", { textContent: posicionTitulo(a) }));
      const n = notaNumero(a); info.append(el("span", { className: "pos-selector-nota", textContent: n == null ? "Sin valorar" : `⭐ ${n.toFixed(1)}` }));
      const gs = parseGeneros(a.genre); if (gs.length) info.append(el("small", { textContent: gs.slice(0,2).join(" · ") }));
      card.append(portada, info); card.addEventListener("click", () => iniciarPosicionamiento(Number(a.row))); lista.append(card);
    });
  }
  let t = null;
  buscador.addEventListener("input", () => { posicionFiltros.q = buscador.value; clearTimeout(t); t = setTimeout(pintarLista, 120); });
  buscador.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const primera = obtenerLista()[0];
    if (primera) iniciarPosicionamiento(Number(primera.row));
  });
  estado.addEventListener("change", () => { posicionFiltros.estado = estado.value; pintarLista(); });
  genero.addEventListener("change", () => { posicionFiltros.genero = genero.value; pintarLista(); });
  orden.addEventListener("change", () => { posicionFiltros.orden = orden.value; pintarLista(); });
  pintarLista();
  const cerrar = el("button", { className: "btn-mini", type: "button", textContent: "Cerrar" });
  cerrar.addEventListener("click", () => dlgPosicionarEl.close());
  dlgPosicionarEl.append(
    el("div", { className: "pos-head" }, el("div", { className: "pos-mark", textContent: "⚖" }), el("div", {}, el("h2", { textContent: "Posicionar serie" }), el("p", { textContent: "Elige una serie y compárala con otras para calcular su nota." })), el("button", { className: "btn-mini", type: "button", textContent: "Separar notas iguales", title: "Ordenar series que tienen la misma nota", onclick: abrirSeparadorEmpates })),
    el("div", { className: "pos-selector-toolbar" }, buscador, estado, genero, orden),
    lista, mensaje,
    el("div", { className: "pos-help" }, el("strong", { textContent: `${sinNota.length} sin valorar` }), " · ", cuenta, " · Pulsa una tarjeta (o Enter en el buscador) para comenzar. También puedes recolocar una serie ya valorada."),
    el("div", { className: "pos-actions" }, cerrar)
  );
  setTimeout(() => { if (dlgPosicionarEl.open) buscador.focus({ preventScroll: true }); }, 30);
}

function iniciarPosicionamiento(row) {
  const candidate = posicionState.validas.find(a => Number(a.row) === Number(row));
  if (!candidate) return;

  const rated = posicionState.validas.filter(a => a !== candidate && notaNumero(a) != null);
  const original = notaNumero(candidate);
  const inicial = original ?? (rated.length ? mediana(rated.map(notaNumero)) : 5);
  const grupos = crearGrupos(rated);

  posicionState = {
    ...posicionState,
    candidate,
    grupos,
    lo: 0,
    hi: Math.max(-1, grupos.length - 1),
    igualGrupo: null,
    rival: null,
    rivalIdx: null,
    comparaciones: 0,
    saltados: [],
    historial: [],
    inicial
  };

  // Sin referencias no hay nada que comparar: la nota neutra es 5.0.
  if (!rated.length) {
    sFinalizarPosicionamientoSinComparar();
    return;
  }
  precalentarPortadas([candidate]);
  mostrarComparacion();
}

// Un grupo por cada nota distincta, ordenados de mejor a peor. Solo entran las
// series ya valoradas: las notas de los grupos son anclas y no se tocan nunca,
// así que basta con la nota de cada serie tal como está en la hoja.
function crearGrupos(items) {
  const mapa = new Map();
  items.forEach(a => {
    const n = notaNumero(a);
    if (n == null) return;
    const key = notaRedondeada(n).toFixed(1);
    if (!mapa.has(key)) mapa.set(key, { key, score: notaRedondeada(n), items: [] });
    mapa.get(key).items.push(a);
  });
  return Array.from(mapa.values()).sort((a,b) => b.score - a.score);
}

// Búsqueda binaria: se compara contra el grupo central del intervalo [lo, hi]
// (si está agotado por "saltar", el más cercano). Es una función pura para poder
// adivinar también las comparaciones siguientes y precargar sus portadas.
function elegirRivalPara(s, lo, hi, saltados = s.saltados) {
  if (lo > hi || !s.grupos.length) return null;
  const centro = Math.floor((lo + hi) / 2);
  for (let d = 0; d <= hi - lo; d++) {
    const idxs = d === 0 ? [centro] : [centro - d, centro + d];
    for (const idx of idxs) {
      if (idx < lo || idx > hi) continue;
      const items = s.grupos[idx].items;
      // Casi siempre no hay saltados: entonces no hace falta filtrar ni copiar el
      // grupo entero, que en una lista grande son cientos de elementos por sondeo.
      const libres = saltados.length ? items.filter(a => !saltados.includes(a.row)) : items;
      // Se prefiere una serie con portada: la comparación es mucho más fácil de juzgar.
      if (libres.length) return { idx, item: libres.find(a => a.cover) || libres[0] };
    }
  }
  return null;
}

// Nota estimada con lo que ya se sabe: el candidato está por debajo de grupos[lo-1]
// y por encima de grupos[hi+1]. El valor se calcula con la misma función que decide
// la nota final, para que lo que se muestra en vivo y lo que se guarda coincidan
// (también cuando no cabe ninguna décima entre las vecinas, caso en el que el
// punto medio redondeado no sería la nota real).
function estimacionActual(s) {
  if (s.igualGrupo != null) { const n = s.grupos[s.igualGrupo].score; return { sup: n, inf: n, nota: n }; }
  const sup = s.lo > 0 ? s.grupos[s.lo - 1].score : 10;
  const inf = s.hi + 1 < s.grupos.length ? s.grupos[s.hi + 1].score : 0.1;
  return { sup, inf, nota: calcularNotaPosicion(s) };
}

function precalentarSiguientes(s) {
  const r = s.rivalIdx;
  if (r == null || !s.rival) return;
  const sig = [
    elegirRivalPara(s, s.lo, r - 1),                               // si el candidato gusta más
    elegirRivalPara(s, r + 1, s.hi),                               // si gusta menos
    elegirRivalPara(s, s.lo, s.hi, [...s.saltados, s.rival.row])   // si se salta este rival
  ];
  precalentarPortadas(sig.filter(Boolean).map(x => x.item));
}

function calcularNotaPosicion(s) {
  // La posición se decide exclusivamente por las comparaciones. Las notas de
  // las referencias son anclas: nunca se mueven para "fabricar" huecos.
  if (s.igualGrupo != null) {
    return notaRedondeada(s.grupos[s.igualGrupo].score);
  }
  // Sin comparaciones no hay información: se mantiene la nota de partida.
  if (s.comparaciones === 0) return notaRedondeada(s.inicial);

  // Hueco libre en el que cae la serie: por encima de `inferior` y por debajo de
  // `superior`. Da igual que el intervalo esté resuelto (lo > hi) o que quedara
  // sin resolver por series saltadas: en ambos casos dentro del hueco no queda
  // ninguna referencia, y solo se sabe que la serie cae ahí.
  const superior = s.lo > 0 ? s.grupos[s.lo - 1].score : null;
  const inferior = s.hi + 1 < s.grupos.length ? s.grupos[s.hi + 1].score : null;
  const sup = superior ?? 10;
  const inf = inferior ?? 0.1;   // el 0 está reservado para "sin valorar"

  // Si cabe alguna décima se sitúa en el centro del hueco, que es la estimación
  // de menor error máximo. Esto incluye los extremos de la lista: con la serie
  // por encima o por debajo de todas las valoradas, el hueco va de la nota
  // vecina al extremo de la escala, en lugar de saltar a 10 o 0.1 y afirmar "la
  // mejor de todas" o "la peor de todas" a partir de una sola comparación.
  const media = notaRedondeada((sup + inf) / 2);
  if (media > inf && media < sup) return media;

  // No cabe ninguna décima entre las dos vecinas (son décimas contiguas), así
  // que hay que repetir la nota de una de ellas. Si ese lado no tiene ninguna
  // serie valorada con la que empatar, se repite el extremo de la escala, que no
  // genera ningún empate real.
  if (inferior == null) return notaRedondeada(inf);
  if (superior == null) return notaRedondeada(sup);

  // Con vecinas reales a ambos lados el empate es inevitable. Se repite la de
  // abajo: atar con la serie que el usuario acaba de decir que es peor
  // contradiría la respuesta que acaba de dar.
  return notaRedondeada(inf);
}

function posicionTerminada(s) {
  if (s.igualGrupo != null) return true;
  return s.lo > s.hi;
}

// Foto del estado de la búsqueda antes de cada respuesta, para poder deshacer.
function instantaneaPos(s) {
  return { lo: s.lo, hi: s.hi, igualGrupo: s.igualGrupo, saltados: s.saltados.slice(), comparaciones: s.comparaciones };
}

function deshacerPosicionamiento() {
  const s = posicionState;
  if (!s?.historial?.length) return;
  Object.assign(s, s.historial.pop(), { rival: null });
  mostrarComparacion();
}

function pantallaComparacion(o) {
  pantallaNueva();
  const tit = (d) => posicionTitulo(d.anime);
  const lado = (d, fn) => {
    const b = el("button", { className: "pos-serie", type: "button", title: `Prefiero «${tit(d)}»` },
      crearPortada(d.anime, "pos-portada"),
      el("strong", { textContent: tit(d) }),
      el("small", { textContent: d.sub || "" }));
    b.addEventListener("click", fn);
    return b;
  };
  const voto = (clase, icono, texto, fn) => {
    const b = el("button", { className: `pos-voto ${clase}`, type: "button", title: texto }, el("span", { textContent: icono }), el("strong", { textContent: texto }));
    b.addEventListener("click", fn);
    return b;
  };
  const deshacer = el("button", { className: "btn-mini", type: "button", textContent: "↶ Deshacer", title: "Volver a la comparación anterior (Z)", disabled: !o.onDeshacer });
  if (o.onDeshacer) deshacer.addEventListener("click", o.onDeshacer);
  const acciones = el("div", { className: "pos-foot-actions" }, deshacer);
  if (o.onSaltar) {
    const sk = el("button", { className: "btn-mini", type: "button", textContent: "Saltar →", title: "No he visto esta serie (S)" });
    sk.addEventListener("click", o.onSaltar);
    acciones.append(sk);
  }
  acciones.append(el("button", { className: "btn-mini", type: "button", textContent: "Cancelar", onclick: () => dlgPosicionarEl.close() }));

  dlgPosicionarEl.append(
    el("div", { className: "pos-topline" }, el("span", { textContent: o.etiqueta }), el("span", { textContent: o.progreso })),
    o.cabecera,
    el("div", { className: "pos-comparacion" }, lado(o.izq, o.onIzq), el("div", { className: "pos-vs", textContent: "VS" }), lado(o.der, o.onDer)),
    el("p", { className: "pos-question", textContent: "¿Cuál te gusta más?" }),
    el("div", { className: "pos-votos" },
      voto("pos-mas", "←", `Prefiero «${tit(o.izq)}»`, o.onIzq),
      voto("pos-igual", "=", o.textoIgual || "Me gustan igual", o.onIgual),
      voto("pos-menos", "→", `Prefiero «${tit(o.der)}»`, o.onDer)),
    el("div", { className: "pos-foot" }, el("span", { textContent: "Atajos: ← → elegir · = igual · Z deshacer" + (o.onSaltar ? " · S saltar" : "") }), acciones)
  );

  dlgPosicionarEl.onkeydown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft") o.onIzq();
    else if (k === "arrowright") o.onDer();
    else if (k === "arrowdown" || k === "=" || k === "e") o.onIgual();
    else if ((k === "z" || k === "backspace") && o.onDeshacer) o.onDeshacer();
    else if (k === "s" && o.onSaltar) o.onSaltar();
    else return;
    e.preventDefault();
  };
  dlgPosicionarEl.focus({ preventScroll: true });
}

function saltarRivalPosicion() {
  const s = posicionState; if (!s?.rival) return;
  s.historial.push(instantaneaPos(s));
  if (!s.saltados.includes(s.rival.row)) s.saltados.push(s.rival.row);  // no repetir el mismo rival
  s.rival = null;
  mostrarComparacion();
}

function mostrarComparacion() {
  const s = posicionState;
  const r = s.igualGrupo != null ? null : elegirRivalPara(s, s.lo, s.hi);
  if (!r) return finalizarPosicionamiento();
  s.rival = r.item;
  s.rivalIdx = r.idx;
  precalentarSiguientes(s);

  const est = estimacionActual(s);
  const restantes = Math.max(1, Math.ceil(Math.log2(s.hi - s.lo + 2)));
  const total = s.comparaciones + restantes;
  const progreso = `${s.comparaciones} ${s.comparaciones === 1 ? "comparación" : "comparaciones"}`;
  const cabecera = el("div", { className: "pos-estimacion" },
    el("span", { textContent: "NOTA ESTIMADA" }),
    el("strong", { textContent: est.nota.toFixed(1) }),
    el("small", { textContent: `Entre ${est.inf.toFixed(1)} y ${est.sup.toFixed(1)} · unas ${restantes} ${restantes === 1 ? "comparación" : "comparaciones"} más` }),
    el("div", { className: "pos-barra" }, el("i", { style: `width:${Math.round((s.comparaciones / total) * 100)}%` }))
  );

  // Se recuerda la nota que tenía el candidato: sin ella no se puede responder
  // "igual que antes", que es la comparación más rápida cuando la nota ya era
  // correcta y solo se quiere confirmar.
  const previa = notaNumero(s.candidate);
  const notaRival = notaNumero(s.rival);
  const subIzq = `Estimación: ${est.nota.toFixed(1)}`
    + (previa != null && notaRedondeada(previa) !== est.nota ? ` · antes ${previa.toFixed(1)}` : "");

  pantallaComparacion({
    etiqueta: "POSICIONAR",
    progreso,
    cabecera,
    izq: { anime: s.candidate, sub: subIzq },
    der: { anime: s.rival, sub: `Nota: ${notaRival == null ? "-" : notaRival.toFixed(1)}` },
    onIzq: () => responderPosicionamiento("más"),
    onIgual: () => responderPosicionamiento("igual"),
    onDer: () => responderPosicionamiento("menos"),
    onSaltar: saltarRivalPosicion,
    onDeshacer: s.historial.length ? deshacerPosicionamiento : null
  });
}

async function responderPosicionamiento(tipo) {
  const s = posicionState; if (!s?.rival) return;
  const grupoIdx = s.rivalIdx;
  s.historial.push(instantaneaPos(s));
  s.comparaciones++;

  if (tipo === "igual") {
    s.igualGrupo = grupoIdx;
  } else if (tipo === "más") {
    // El candidato queda por encima del grupo comparado.
    s.hi = grupoIdx - 1;
  } else {
    // El candidato queda por debajo del grupo comparado.
    s.lo = grupoIdx + 1;
  }

  s.rival = null;
  if (posicionTerminada(s)) await finalizarPosicionamiento();
  else mostrarComparacion();
}

function sFinalizarPosicionamientoSinComparar() {
  // Sin referencias no hay nada que comparar: se conserva la nota actual de
  // la serie o, si no tenía, la neutra (5.0). Ambas ya están en s.inicial.
  if (!posicionState?.candidate) return;
  finalizarPosicionamiento();
}

async function finalizarPosicionamiento() {
  const s = posicionState;
  if (!s?.candidate) return;

  // Solo se modifica la nota de la serie posicionada. Las referencias son
  // anclas: no se reajustan para fabricar huecos en la escala.
  const anime = s.candidate;
  const antes = notaNumero(anime);
  const textoAntes = antes == null ? "Sin nota" : antes.toFixed(1);
  const nueva = calcularNotaPosicion(s);

  const otras = s.validas.filter(a => a !== anime && notaNumero(a) != null);
  const nVecina = (a) => notaRedondeada(notaNumero(a));
  const comparten = otras.filter(a => nVecina(a) === nueva).length;
  const porEncima = otras.filter(a => nVecina(a) > nueva);
  const porDebajo = otras.filter(a => nVecina(a) < nueva);
  // El puesto se cuenta sobre las notas ya redondeadas a una décima, que es lo que
  // se muestra y lo que usa crearGrupos(): comparar el valor sin redondear daría un
  // puesto distinto del que ve el usuario (p. ej. 8.04 contaría sobre 8.0).
  const puesto = porEncima.length + 1;
  // Vecina más próxima a cada lado, para comprobar de un vistazo que la nota
  // elegida encaja con las comparaciones hechas, sin tener que comparar otra vez.
  const arriba = porEncima.sort((a, b) => nVecina(a) - nVecina(b))[0] || null;
  const abajo = porDebajo.sort((a, b) => nVecina(b) - nVecina(a))[0] || null;
  const citar = (a) => `«${posicionTitulo(a)}» (${nVecina(a).toFixed(1)})`;
  const encaje = `Quedaría por encima de ${arriba ? citar(arriba) : "todas"}`
    + ` y por debajo de ${abajo ? citar(abajo) : "todas"}.`;
  const resumen = "Solo cambia la nota de esta serie; las demás no se modifican."
    + (comparten ? ` Comparte nota con ${comparten} ${comparten === 1 ? "serie" : "series"}; puedes usar «Separar notas iguales» para ordenarlas.` : "");

  const aplicar = (volverAElegir) => {
    anime.score = nueva.toFixed(1);
    if (volverAElegir) abrirPosicionador(); else dlgPosicionarEl.close();
    render();
    toast("Posicionamiento guardado localmente");
    guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "score", valor: anime.score })
      .then(ok => toast(ok ? "Posicionamiento sincronizado" : "No se pudo sincronizar con Google Sheets"))
      .catch(() => toast("No se pudo sincronizar el posicionamiento"));
  };

  const guardarBtn = el("button", { className: "btn pos-primary", type: "button", textContent: "Guardar y terminar" });
  guardarBtn.addEventListener("click", () => aplicar(false));
  const otraBtn = el("button", { className: "btn", type: "button", textContent: "Guardar y posicionar otra" });
  otraBtn.addEventListener("click", () => aplicar(true));
  const corregirBtn = s.historial.length
    ? el("button", { className: "btn-mini", type: "button", textContent: "↶ Corregir última respuesta", onclick: deshacerPosicionamiento })
    : null;

  pantallaNueva();
  dlgPosicionarEl.append(
    el("div", { className: "pos-resultado" },
      el("div", { className: "pos-check", textContent: "✓" }),
      el("h2", { textContent: "¡Serie posicionada!" }),
      el("div", { className: "pos-resultado-titulo", textContent: posicionTitulo(s.candidate) }),
      el("div", { className: "pos-nota-final", textContent: `${textoAntes} → ${nueva.toFixed(1)}` }),
      el("p", { textContent: `${s.comparaciones} ${s.comparaciones === 1 ? "comparación" : "comparaciones"} · puesto ${puesto} de ${otras.length + 1} series valoradas.` }),
      el("p", { textContent: encaje })
    ),
    el("div", { className: "pos-cambios-panel" },
      el("h3", { textContent: "Nota de esta serie" }),
      el("p", { className: "pos-cambios-resumen", textContent: resumen })
    ),
    el("div", { className: "pos-actions" },
      corregirBtn,
      el("button", { className: "btn-mini", type: "button", textContent: "Cancelar", onclick: () => dlgPosicionarEl.close() }),
      otraBtn,
      guardarBtn
    )
  );
  dlgPosicionarEl.focus({ preventScroll: true });
}

// --- Separador de empates ------------------------------------------------------
// Ordena únicamente las series que comparten una misma décima. La nota sigue
// siendo una nota decimal real: al terminar, las series se reparten entre las
// décimas libres que hay entre las notas vecinas, sin cruzar a otras series.
let empateState = null;

// Series que participan en "Separar notas iguales": se excluyen las marcadas como
// "Sin ver" y las que todavía no tienen fila ni título. El resto de estados (Visto,
// Viendo, Por ver, Dropeado, etc.) sí participa.
// Esta lista NO debe derivarse de posicionState.validas: esa se construye para el
// posicionador y no filtra por estado, así que arrastraría series "Sin ver".
function seriesParaSeparar() {
  return todosLosAnimes.filter(a => a && a.status !== "✖" && a.row != null && a.title);
}

function abrirSeparadorEmpates() {
  const validas = seriesParaSeparar();
  const mapa = new Map();
  validas.forEach(a => {
    const n = notaNumero(a);
    if (n == null) return;
    const key = notaRedondeada(n).toFixed(1);
    if (!mapa.has(key)) mapa.set(key, { score: notaRedondeada(n), items: [] });
    mapa.get(key).items.push(a);
  });
  const grupos = Array.from(mapa.values()).filter(g => g.items.length >= 2).sort((a,b) => b.score - a.score);
  if (!grupos.length) {
    toast("No hay notas repetidas que separar");
    return;
  }
  mostrarSelectorEmpate(grupos);
}

function mostrarSelectorEmpate(grupos) {
  pantallaNueva();
  const lista = el("div", { className: "pos-selector-grid" });
  const obs = nuevoObservadorPos(lista);
  grupos.forEach(g => {
    const card = el("button", { className: "pos-selector-card", type: "button", title: `Separar las ${g.items.length} series con ${g.score.toFixed(1)}` });
    const portada = crearPortada(g.items.find(a => a.cover) || g.items[0], "pos-selector-portada", obs);
    const info = el("div", { className: "pos-selector-info" });
    info.append(el("strong", { textContent: `Nota ${g.score.toFixed(1)}` }), el("span", { className: "pos-selector-nota", textContent: `${g.items.length} series` }), el("small", { textContent: "Pulsa para ordenar este empate" }));
    card.append(portada, info);
    card.addEventListener("click", () => iniciarSeparacionEmpate(g.score));
    lista.append(card);
  });
  const cerrar = el("button", { className: "btn-mini", type: "button", textContent: "Cerrar", onclick: () => dlgPosicionarEl.close() });
  const volver = el("button", { className: "btn-mini", type: "button", textContent: "← Posicionar serie", onclick: abrirPosicionador });
  dlgPosicionarEl.append(
    el("div", { className: "pos-head" }, el("div", { className: "pos-mark", textContent: "↕" }), el("div", {}, el("h2", { textContent: "Separar notas iguales" }), el("p", { textContent: "Compara las series que tienen la misma décima y conviértelas en un orden real con notas decimales." }))),
    el("p", { className: "pos-help", textContent: "Ordenas el grupo con el menor número de comparaciones posible. Después se reparten las décimas libres que hay entre las notas vecinas, sin cruzar otras series; si no caben todas, algunas seguirán empatadas." }),
    lista,
    el("div", { className: "pos-actions" }, volver, cerrar)
  );
  if (!dlgPosicionarEl.open) dlgPosicionarEl.showModal();
}

function iniciarSeparacionEmpate(score) {
  const validas = seriesParaSeparar();
  const grupo = validas.filter(a => { const n = notaNumero(a); return n != null && notaRedondeada(n) === score; });
  if (grupo.length < 2) return;
  empateState = {
    score,
    items: grupo,
    sorted: [],
    comparaciones: 0,
    historial: [],
    // Unión de series que el usuario ha marcado como "iguales" (union-find).
    padre: new Map(grupo.map(a => [a.row, a.row]))
  };
  // Merge sort interactivo: óptimo en número de comparaciones en el peor caso.
  prepararMergeEmpate();
}

function empateRaiz(s, row) {
  while (s.padre.get(row) !== row) {
    s.padre.set(row, s.padre.get(s.padre.get(row)));
    row = s.padre.get(row);
  }
  return row;
}
function empateUnir(s, rowA, rowB) {
  const ra = empateRaiz(s, rowA), rb = empateRaiz(s, rowB);
  if (ra !== rb) s.padre.set(rb, ra);
}

function prepararMergeEmpate() {
  const s = empateState;
  s.runs = s.items.map(a => [a]);
  s.nextRuns = [];
  s.runIndex = 0;
  s.left = null;
  s.right = null;
  s.phase = "merge";
  siguienteMergeEmpate();
}

function siguienteMergeEmpate() {
  const s = empateState;
  if (!s) return;
  if (s.runs.length <= 1) return finalizarSeparacionEmpate();
  if (!s.currentLeft) {
    if (s.runIndex >= s.runs.length) {
      s.runs = s.nextRuns;
      s.nextRuns = [];
      s.runIndex = 0;
      if (s.runs.length <= 1) return finalizarSeparacionEmpate();
    }
    s.currentLeft = s.runs[s.runIndex];
    s.currentRight = s.runs[s.runIndex + 1] || [];
    s.merged = [];
    s.leftIndex = 0;
    s.rightIndex = 0;
    s.runIndex += 2;
  }
  if (s.leftIndex >= s.currentLeft.length) {
    s.merged.push(...s.currentRight.slice(s.rightIndex));
    s.nextRuns.push(s.merged);
    s.currentLeft = null;
    s.currentRight = null;
    return siguienteMergeEmpate();
  }
  if (s.rightIndex >= s.currentRight.length) {
    s.merged.push(...s.currentLeft.slice(s.leftIndex));
    s.nextRuns.push(s.merged);
    s.currentLeft = null;
    s.currentRight = null;
    return siguienteMergeEmpate();
  }
  const a = s.currentLeft[s.leftIndex];
  const b = s.currentRight[s.rightIndex];
  mostrarComparacionEmpate(a, b);
}

// Foto del estado del merge antes de cada respuesta, para poder deshacer.
function instantaneaEmpate(s) {
  const c = (x) => (x ? x.slice() : x);
  return {
    runs: s.runs.map(c), nextRuns: s.nextRuns.map(c), runIndex: s.runIndex,
    currentLeft: c(s.currentLeft),
    currentRight: c(s.currentRight),
    merged: c(s.merged),
    leftIndex: s.leftIndex, rightIndex: s.rightIndex,
    comparaciones: s.comparaciones, padre: new Map(s.padre)
  };
}

function deshacerEmpate() {
  const s = empateState;
  if (!s?.historial?.length) return;
  Object.assign(s, s.historial.pop());
  // siguienteMergeEmpate() en vez de mostrarComparacionEmpate() directamente: la
  // primera vuelve a interpretar el estado restaurado y cierra el reparto si ya no
  // quedan comparaciones; la segunda da por hecho que currentLeft/Right existen.
  siguienteMergeEmpate();
}

function mostrarComparacionEmpate(a, b) {
  const s = empateState;
  precalentarPortadas([s.currentLeft[s.leftIndex + 1], s.currentRight[s.rightIndex + 1]].filter(Boolean));
  const cabecera = el("div", { className: "pos-estimacion" },
    el("span", { textContent: `TODAS TENÍAN ${s.score.toFixed(1)}` }),
    el("strong", { textContent: String(s.items.length) }),
    el("small", { textContent: "La nota se mantendrá decimal; se redistribuirán décimas al terminar." })
  );
  pantallaComparacion({
    etiqueta: "SEPARAR EMPATE",
    progreso: `${s.comparaciones} ${s.comparaciones === 1 ? "comparación" : "comparaciones"}`,
    cabecera,
    izq: { anime: a, sub: "Empate actual" },
    der: { anime: b, sub: "Empate actual" },
    textoIgual: "Me gustan igual",
    onIzq: () => responderEmpate("a"),
    onIgual: () => responderEmpate("igual"),
    onDer: () => responderEmpate("b"),
    onDeshacer: s.historial.length ? deshacerEmpate : null
  });
}

function responderEmpate(tipo) {
  const s = empateState;
  if (!s || !s.currentLeft || !s.currentRight) return;
  const a = s.currentLeft[s.leftIndex];
  const b = s.currentRight[s.rightIndex];
  if (!a || !b) return;
  s.historial.push(instantaneaEmpate(s));
  s.comparaciones++;
  if (tipo === "a") {
    s.merged.push(a); s.leftIndex++;
  } else if (tipo === "b") {
    s.merged.push(b); s.rightIndex++;
  } else {
    // Iguales: se recuerda el vínculo para que acaben con la misma nota.
    empateUnir(s, a.row, b.row);
    s.merged.push(a); s.leftIndex++;
    s.merged.push(b); s.rightIndex++;
  }
  siguienteMergeEmpate();
}

// Agrupa la lista ya ordenada en "escalones": las series marcadas como iguales
// y contiguas comparten escalón y, por tanto, nota final.
function agruparEscalonesEmpate(s) {
  const escalones = [];
  s.sorted.forEach((a, i) => {
    if (i > 0 && empateRaiz(s, a.row) === empateRaiz(s, s.sorted[i - 1].row)) escalones[escalones.length - 1].push(a);
    else escalones.push([a]);
  });
  return escalones;
}

// Reparte las décimas para N escalones SIN salir del hueco que dejan las
// series vecinas: la nota inmediatamente inferior y la inmediatamente superior
// al empate (de otras series) son un muro que no se cruza. Si caben, se elige
// el bloque consecutivo más centrado en la nota original; si no caben, se
// reparten por todo el hueco y algunos escalones seguirán empatados.
// Devuelve las notas en décimas, del mejor escalón al peor.
function calcularRepartoEmpate(s, nEscalones) {
  const filasGrupo = new Set(s.items.map(a => a.row));
  const base = Math.round(s.score * 10);
  let vecinaInf = 0, vecinaSup = 101;
  // Las vecinas se buscan en TODA la lista, no solo en seriesParaSeparar(): una
  // serie "Sin ver" también ocupa su sitio en el orden y con su nota, así que su
  // nota es un muro igual de real. Excluirla partiría el hueco en dos y dejaría
  // menos décimas libres de las que hay.
  todosLosAnimes.forEach(a => {
    if (!a || filasGrupo.has(a.row)) return;
    const n = notaNumero(a);
    if (n == null) return;
    const t = Math.round(n * 10);
    if (t < base && t > vecinaInf) vecinaInf = t;
    if (t > base && t < vecinaSup) vecinaSup = t;
  });
  const desde = Math.max(1, vecinaInf);
  const hasta = Math.min(100, vecinaSup);
  const ancho = hasta - desde + 1;
  const asignacion = [];

  if (nEscalones <= ancho) {
    let mejorInicio = desde, mejorCoste = Infinity;
    for (let inicio = desde; inicio + nEscalones - 1 <= hasta; inicio++) {
      const coste = Math.abs(inicio + (nEscalones - 1) / 2 - base);
      if (coste < mejorCoste) { mejorCoste = coste; mejorInicio = inicio; }
    }
    for (let i = 0; i < nEscalones; i++) asignacion.push(mejorInicio + nEscalones - 1 - i);
    return { asignacion, comprimido: false, desde, hasta, ancho };
  }
  for (let i = 0; i < nEscalones; i++) asignacion.push(hasta - Math.floor(i * ancho / nEscalones));
  return { asignacion, comprimido: true, desde, hasta, ancho };
}

function finalizarSeparacionEmpate() {
  const s = empateState;
  if (!s) return;
  if (s.currentLeft) {
    s.merged.push(...s.currentLeft.slice(s.leftIndex), ...s.currentRight.slice(s.rightIndex));
    s.nextRuns.push(s.merged);
    s.currentLeft = null;
    s.currentRight = null;
  }
  if (s.runs.length > 1) return siguienteMergeEmpate();
  s.sorted = s.runs[0] || [];

  const escalones = agruparEscalonesEmpate(s);
  const reparto = calcularRepartoEmpate(s, escalones.length);
  const cambios = [];
  escalones.forEach((grupo, i) => grupo.forEach(anime => cambios.push({ anime, nueva: reparto.asignacion[i] / 10, original: s.score })));
  const aCambiar = cambios.filter(c => Math.abs(c.nueva - c.original) >= 0.05);

  const acciones = el("div", { className: "pos-actions" });
  const corregir = s.historial.length
    ? el("button", { className: "btn-mini", type: "button", textContent: "↶ Corregir última respuesta", onclick: deshacerEmpate })
    : null;
  const cerrar = el("button", { className: "btn-mini", type: "button", textContent: aCambiar.length ? "Cancelar" : "Cerrar", onclick: () => dlgPosicionarEl.close() });

  pantallaNueva();

  // Con 2+ escalones calcularRepartoEmpate() siempre mueve alguno, así que aquí
  // solo se llega cuando el usuario marcó todas las series como iguales.
  if (!aCambiar.length) {
    acciones.append(...[corregir, cerrar].filter(Boolean));
    dlgPosicionarEl.append(
      el("div", { className: "pos-resultado" }, el("div", { className: "pos-check", textContent: "=" }), el("h2", { textContent: "Sin cambios de nota" }), el("p", { textContent: "Has indicado que todas te gustan lo mismo, así que conservan la misma nota." })),
      acciones
    );
    return;
  }

  const filas = cambios.map(c => el("div", { className: "pos-cambio" }, el("span", { className: "pos-cambio-nombre", textContent: posicionTitulo(c.anime) }), el("span", { className: "pos-cambio-notas", textContent: `${c.original.toFixed(1)} → ${c.nueva.toFixed(1)}` })));
  const guardarBtnEmpate = el("button", { className: "btn pos-primary", type: "button", textContent: "Guardar orden" });
  guardarBtnEmpate.addEventListener("click", () => {
    aCambiar.forEach(c => { c.anime.score = c.nueva.toFixed(1); });
    dlgPosicionarEl.close();
    render();
    toast(`${aCambiar.length} series ordenadas por nota`);
    Promise.all(aCambiar.map(c => guardar({ type: "UPDATE_ANIME", row: c.anime.row, campo: "score", valor: c.anime.score })))
      .then(resultados => { if (resultados.some(ok => !ok)) toast("Algunas notas no pudieron sincronizarse con Google Sheets"); })
      .catch(() => toast("No se pudo sincronizar alguna nota"));
  });
  acciones.append(...[guardarBtnEmpate, corregir, cerrar].filter(Boolean));

  const aviso = reparto.comprimido
    ? el("p", { className: "pos-cambios-resumen", textContent: `Solo caben ${reparto.ancho} décimas entre ${(reparto.desde / 10).toFixed(1)} y ${(reparto.hasta / 10).toFixed(1)} para ${escalones.length} posiciones, así que algunas series seguirán con la misma nota. Compartir nota con una serie vecina está permitido; cruzarla no.` })
    : (escalones.length < s.items.length
      ? el("p", { className: "pos-cambios-resumen", textContent: "Las series que marcaste como iguales comparten nota." })
      : null);

  dlgPosicionarEl.append(
    el("div", { className: "pos-resultado" }, el("div", { className: "pos-check", textContent: "✓" }), el("h2", { textContent: "Empate ordenado" }), el("p", { textContent: `${s.comparaciones} ${s.comparaciones === 1 ? "comparación" : "comparaciones"}. Las notas siguen usando una sola decimal y no cruzan a otras series, aunque pueden compartir nota con ellas.` })),
    el("div", { className: "pos-cambios-panel" }, el("h3", { textContent: `Nuevo orden de ${s.score.toFixed(1)}` }), aviso, el("div", { className: "pos-cambios-lista" }, ...filas)),
    acciones
  );
}

// --- Cabecera: modo edición y herramientas -------------------------------------

$("btnEdicion").addEventListener("click", (e) => {
  modoEdicion = !modoEdicion;
  e.currentTarget.setAttribute("aria-pressed", String(modoEdicion));
  toast(modoEdicion ? "Modo edición activado" : "Modo edición desactivado");
  pintarBarraMover();
  render();
});

// --- Otras páginas fuente (BETA): las recetas se crean en la extensión y se pegan aquí ------------
const fuentesStatusEl = $("fuentesStatus");
async function cargarFuentes() {
  const r = await enviarMensaje({ type: "GET_FUENTES" });
  const nuevas = r?.fuentes || [];
  const clave = (a) => JSON.stringify(a.map((x) => [x.origen, x.patron, x.activa, x.capitulo]));
  const cambio = clave(nuevas) !== clave(fuentesCache);
  fuentesCache = nuevas;
  if (cambio && todosLosAnimes.length) render(); // el botón ⏭ de las series de otras webs depende de estas fuentes
  const listas = (await enviarMensaje({ type: "GET_LISTAS" }))?.listas || [];
  const cont = $("fuentesLista");
  cont.innerHTML = "";
  if (!nuevas.length) cont.append(el("p", { className: "ayuda-opciones", textContent: "Aún no hay ninguna página fuente en esta app." }));
  for (const f of nuevas) {
    const selLista = el("select", { ariaLabel: `Lista para ${f.nombre}`, title: "Lista donde se registran las series de esta web" });
    selLista.append(el("option", { value: "", textContent: "Lista abierta" }));
    for (const l of listas) selLista.append(el("option", { value: l.id, textContent: l.name }));
    if (f.listaId && !listas.some((l) => l.id === f.listaId)) selLista.append(el("option", { value: f.listaId, textContent: "(lista borrada)" }));
    selLista.value = f.listaId || "";
    selLista.addEventListener("change", async () => {
      const x = await enviarMensaje({ type: "ACTUALIZAR_FUENTE", id: f.id, lista: selLista.value });
      if (!x?.ok) { selLista.value = f.listaId || ""; toast(mensajeError(x?.error || "error desconocido")); } else { f.listaId = selLista.value; toast("Lista asignada"); }
    });
    const sw = el("input", { type: "checkbox", id: `fuente_${f.id}` });
    sw.checked = f.activa !== false;
    sw.addEventListener("change", async () => {
      const x = await enviarMensaje({ type: "ACTUALIZAR_FUENTE", id: f.id, activa: sw.checked });
      if (!x?.ok) { sw.checked = !sw.checked; toast(mensajeError(x?.error || "error desconocido")); } else cargarFuentes();
    });
    const borrar = el("button", { className: "btn-mini peligro", type: "button", textContent: "Borrar" });
    borrar.addEventListener("click", async () => {
      if (!confirm(`¿Quitar la página fuente «${f.nombre}»? Las series ya registradas se quedan en tu lista.`)) return;
      const x = await enviarMensaje({ type: "BORRAR_FUENTE", id: f.id });
      if (!x?.ok) { toast(mensajeError(x?.error || "error desconocido")); return; }
      cargarFuentes();
    });
    cont.append(el("div", { className: "ajuste ajuste-fuente" },
      el("label", { className: "ajuste-nombre", htmlFor: `fuente_${f.id}` }, f.nombre, el("small", { textContent: f.origen })),
      el("label", { className: "switch" }, sw, el("span", { className: "switch-track" })),
      selLista, borrar));
  }
}
$("fuentesPortapapeles").addEventListener("click", async () => {
  try { $("fuentesPegar").value = await navigator.clipboard.readText(); } catch (e) { fuentesStatusEl.textContent = "No se pudo leer el portapapeles: pega el texto a mano en el cuadro."; return; }
  $("fuentesImportar").click();
});
$("fuentesImportar").addEventListener("click", async () => {
  const texto = $("fuentesPegar").value.trim();
  if (!texto) { fuentesStatusEl.textContent = "Pega primero lo copiado en la extensión."; return; }
  const r = await enviarMensaje({ type: "IMPORTAR_FUENTES", texto });
  if (!r?.ok) { fuentesStatusEl.textContent = mensajeError(r?.error || "error desconocido"); return; }
  $("fuentesPegar").value = "";
  fuentesStatusEl.textContent = `Importada${r.total === 1 ? "" : "s"} ${r.total} página${r.total === 1 ? "" : "s"} fuente. Si alguna debe ir a otra lista, elígela abajo.`;
  toast("Páginas fuente importadas");
  cargarFuentes();
});

// --- Opciones: pestañas y buscador de ajustes ------------------------------------------------
// Cada ajuste lleva la clase item-op (y palabras clave en data-k). Sin texto en el buscador se ve una sola pestaña;
// al escribir se buscan los ajustes de todas las pestañas a la vez y las pestañas se ocultan.
const PESTANAS_OPCIONES = ["apariencia", "series", "datos", "fuentes"];
let pestanaOpciones = "apariencia";
try { const g = localStorage.getItem("opcionesPestana"); if (PESTANAS_OPCIONES.includes(g)) pestanaOpciones = g; } catch (e) {}
const normalizarBusqueda = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function seleccionarPestanaOpciones(nombre, guardar = true) {
  if (!PESTANAS_OPCIONES.includes(nombre)) nombre = "apariencia";
  pestanaOpciones = nombre;
  if (guardar) { try { localStorage.setItem("opcionesPestana", nombre); } catch (e) {} }
  document.querySelectorAll("#herramientas .opciones-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.pestana === nombre)));
  document.querySelectorAll("#herramientas .opciones-panel").forEach((p) => { p.hidden = p.dataset.pestana !== nombre; });
}
function filtrarOpciones() {
  const panel = $("herramientas"), q = normalizarBusqueda($("opcionesBuscar").value.trim());
  panel.querySelector(".opciones-barra").classList.toggle("buscando", !!q);
  panel.querySelectorAll(".sin-coincidencia").forEach((e) => e.classList.remove("sin-coincidencia"));
  if (!q) { seleccionarPestanaOpciones(pestanaOpciones, false); $("opcionesVacio").hidden = true; return; }
  const palabras = q.split(/\s+/);
  let total = 0;
  panel.querySelectorAll(".opciones-panel").forEach((p) => { p.hidden = false; });
  panel.querySelectorAll(".seccion-opciones").forEach((sec) => {
    const titulo = normalizarBusqueda(sec.querySelector(".seccion-opciones-titulo")?.textContent);
    let visibles = 0;
    sec.querySelectorAll(".item-op").forEach((it) => {
      const ok = !it.hidden && palabras.every((w) => normalizarBusqueda(it.textContent + " " + (it.dataset.k || "")).includes(w) || titulo.includes(w));
      it.classList.toggle("sin-coincidencia", !ok);
      if (ok) visibles++;
    });
    sec.classList.toggle("sin-coincidencia", !visibles);
    total += visibles;
  });
  panel.querySelectorAll(".opciones-panel").forEach((p) => p.classList.toggle("sin-coincidencia", !p.querySelector(".seccion-opciones:not(.sin-coincidencia)")));
  $("opcionesVacio").hidden = total > 0;
}
document.querySelectorAll("#herramientas .opciones-tab").forEach((t) => t.addEventListener("click", () => {
  seleccionarPestanaOpciones(t.dataset.pestana);
  $("herramientas").scrollTop = 0;
}));
$("opcionesBuscar").addEventListener("input", filtrarOpciones);
$("opcionesBuscar").addEventListener("keydown", (e) => { if (e.key === "Escape" && $("opcionesBuscar").value) { e.preventDefault(); $("opcionesBuscar").value = ""; filtrarOpciones(); } });
seleccionarPestanaOpciones(pestanaOpciones, false);

function setHerramientas(abierto, pestana) {
  if (abierto) cargarFuentes();
  if (abierto) { if (pestana) seleccionarPestanaOpciones(pestana); if ($("opcionesBuscar").value) { $("opcionesBuscar").value = ""; filtrarOpciones(); } }
  $("herramientas").hidden = !abierto;
  $("btnHerramientas").setAttribute("aria-expanded", String(abierto));
}
$("btnHerramientas").addEventListener("click", () => setHerramientas($("herramientas").hidden));
const btnPosicionarEl = $("btnPosicionar");
if (btnPosicionarEl) btnPosicionarEl.addEventListener("click", abrirPosicionador);


// --- Añadir anime por enlace ---------------------------------------------------

function setAgregarPanel(abierto) {
  agregarPanelEl.hidden = !abierto;
  $("agregarManual").hidden = configActual?.tipo !== "local"; // la entrada manual es de las listas locales
  $("btnAgregar").setAttribute("aria-expanded", String(abierto));
  if (abierto) {
    agregarStatusEl.textContent = "";
    agregarUrlEl.value = "";
    setTimeout(() => agregarUrlEl.focus(), 0);
  }
}
$("btnAgregar").addEventListener("click", () => setAgregarPanel(agregarPanelEl.hidden));

// --- Lista local: añadir una serie escribiendo los datos a mano ---------------------
const mEstadoEl = $("manualEstado");
ESTADOS.forEach((e) => mEstadoEl.append(el("option", { value: e.value, textContent: e.label })));
mEstadoEl.value = "@"; // Por ver
async function agregarManual() {
  const title = $("manualTitulo").value.trim();
  if (!title) { agregarStatusEl.textContent = mensajeError("FALTA_TITULO"); return; }
  const generos = unico($("manualGenero").value.split(",").map(limpiarGenero).filter(Boolean));
  const serie = {
    title, url: $("manualUrl").value.trim(), status: mEstadoEl.value, genre: generos.join(", "),
    score: $("manualNota").value, cover: $("manualPortada").value.trim(),
  };
  $("manualBtn").disabled = true;
  const res = await enviarMensaje({ type: "ADD_SERIE_LOCAL", serie });
  $("manualBtn").disabled = false;
  if (!res?.ok) { agregarStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  ["manualTitulo", "manualUrl", "manualGenero", "manualNota", "manualPortada"].forEach((id) => { $(id).value = ""; });
  agregarStatusEl.textContent = `Añadido: ${title}`;
  toast("Serie añadida");
  cargar();
}
$("manualBtn").addEventListener("click", agregarManual);
$("manualTitulo").addEventListener("keydown", (e) => { if (e.key === "Enter") agregarManual(); });

const dlgSerieEl = $("dlgSerie");

// Pregunta si el anime que se va a añadir es otra temporada/parte de uno ya registrado.
// Devuelve { decision: "misma", candidato } | { decision: "otra" } | null (cerrado sin responder).
function preguntarMismaSerie({ nuevaFila, candidatos }) {
  return new Promise((resolve) => {
    let respondido = false;
    const fin = (valor) => { respondido = true; dlgSerieEl.close(); resolve(valor); };
    dlgSerieEl.innerHTML = "";
    dlgSerieEl.onclose = () => { if (!respondido) resolve(null); };

    const opciones = el("div", { className: "serie-opciones" });
    candidatos.forEach((c) => {
      const b = el("button", { className: "serie-opcion", type: "button" },
        crearPortada({ cover: c.cover, title: c.title }, "serie-portada"),
        el("span", { textContent: `Sí, es «${c.title}»` }));
      b.addEventListener("click", () => fin({ decision: "misma", candidato: c }));
      opciones.append(b);
    });
    const otra = el("button", { className: "btn pos-primary", type: "button", textContent: "No, es otra serie (registrar aparte)" });
    otra.addEventListener("click", () => fin({ decision: "otra" }));
    const cerrar = el("button", { className: "btn-mini", type: "button", textContent: "Cancelar", onclick: () => dlgSerieEl.close() });

    const p = el("p", {});
    p.append("Vas a añadir ", el("strong", { textContent: nuevaFila.title }),
      candidatos.length > 1 ? ". ¿Es alguna de estas, que ya tienes en tu lista?" : ". ¿Es la misma que esta, que ya tienes en tu lista?");
    dlgSerieEl.append(el("h2", { textContent: "¿Es la misma serie?" }), p, opciones, el("div", { className: "serie-acciones" }, cerrar, otra));
    dlgSerieEl.showModal();
  });
}

async function agregarAnime() {
  const url = agregarUrlEl.value.trim();
  if (!url) { agregarStatusEl.textContent = "Pega primero el enlace."; return; }
  agregarBtnEl.disabled = true;
  agregarStatusEl.textContent = "Buscando título y portada…";
  let res = await enviarMensaje({ type: "REGISTER_ANIME", url });

  if (res?.ok && res.pregunta) {
    agregarStatusEl.textContent = "Esperando tu respuesta…";
    const r = await preguntarMismaSerie(res.pregunta);
    if (!r) {
      agregarBtnEl.disabled = false;
      agregarStatusEl.textContent = "No se ha añadido nada. Vuelve a pegar el enlace cuando quieras decidir.";
      return;
    }
    res = await enviarMensaje({
      type: "RESOLVER_SECUELA",
      decision: r.decision,
      slug: res.pregunta.slug,
      existingUrl: r.candidato?.url || "",
      existingTitle: r.candidato?.title || "",
      nuevaFila: res.pregunta.nuevaFila,
      listaId: res.pregunta.listaId || undefined
    });
  }

  agregarBtnEl.disabled = false;
  if (!res || !res.ok) { agregarStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  agregarStatusEl.textContent = (res.vinculada ? `Marcada como viendo: ${res.title}` : `Añadido: ${res.title}`) + (res.listaNombre ? ` (en «${res.listaNombre}»)` : "");
  agregarUrlEl.value = "";
  toast(res.vinculada ? "Serie actualizada" : "Anime añadido");
  cargar();
}
// --- Compartir desde Android: «Compartir → AnimeAV1 Tracker» en un capítulo de animeav1.com ---------
// El manifest registra la app como destino de «Compartir» (share_target) y Android la abre con
// ?title=...&text=...&url=...; el enlace puede venir en cualquiera de los tres. Se registra igual que
// al pegarlo en «Añadir»: serie nueva, o «viendo» + último capítulo si ya estaba (con la pregunta
// «¿Es la misma serie?» si parece otra temporada).
async function procesarCompartido() {
  let p;
  try { p = new URL(location.href).searchParams; } catch (e) { return; }
  const textos = ["url", "text", "title"].map((k) => p.get(k) || "");
  if (!textos.some(Boolean)) return;
  try { history.replaceState(null, "", location.pathname); } catch (e) {} // recargar no debe volver a registrarlo
  const todo = textos.join(" ");
  let enlace = todo.match(/https?:\/\/(?:www\.)?animeav1\.com\/media\/[^\s"'<>]+/i)?.[0];
  if (!enlace) { // enlace de una página fuente añadida en Opciones (beta)
    const fuentes = (await enviarMensaje({ type: "GET_FUENTES" }))?.fuentes || [];
    enlace = (todo.match(/https?:\/\/[^\s"'<>]+/gi) || []).find((u) => fuentes.some((f) => f.activa !== false && u.startsWith(f.origen + "/")));
  }
  if (!enlace) { toast("Ese enlace no es de animeav1.com ni de una página fuente añadida"); return; }
  if (!configActual) { toast("Primero conecta una hoja o crea una lista local"); return; }
  setAgregarPanel(true);
  agregarUrlEl.value = enlace;
  await agregarAnime();
}

agregarBtnEl.addEventListener("click", agregarAnime);
agregarUrlEl.addEventListener("keydown", (e) => { if (e.key === "Enter") agregarAnime(); });

// --- Varias listas guardadas (la tuya, la de un amigo…) --------------------------

function setListasPanel(abierto) {
  listasPanelEl.hidden = !abierto;
  $("btnListas").setAttribute("aria-expanded", String(abierto));
  if (abierto) {
    listaStatusEl.textContent = "";
    listaNombreEl.value = "";
    listaUrlEl.value = "";
    listaLocalStatusEl.textContent = "";
    listaLocalNombreEl.value = "";
    cargarListasPanel();
    cargarNubePanel();
  }
}
$("btnListas").addEventListener("click", () => setListasPanel(listasPanelEl.hidden));

// --- Nombre de la lista en la cabecera y accesos directos (fijados) ------------------------
const tituloListaEl = $("tituloLista");
const atajosListasEl = $("atajosListas");
function listasFijadas() {
  try { const a = JSON.parse(localStorage.getItem("listasFijadas") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function guardarListasFijadas(a) { try { localStorage.setItem("listasFijadas", JSON.stringify(a)); } catch (e) {} }
function alternarListaFijada(id) {
  const a = listasFijadas(), i = a.indexOf(id);
  if (i >= 0) a.splice(i, 1); else a.push(id);
  guardarListasFijadas(a);
}
// Orden de las listas (solo en este dispositivo): se cambia con ▲▼ en Listas y vale para el selector de la cabecera
function ordenListasGuardado() {
  try { const a = JSON.parse(localStorage.getItem("ordenListas") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function ordenarListas(listas) {
  const o = ordenListasGuardado();
  const pos = (id) => { const i = o.indexOf(id); return i < 0 ? 1e6 : i; };
  return listas.map((l, i) => [l, i]).sort((a, b) => pos(a[0].id) - pos(b[0].id) || a[1] - b[1]).map((x) => x[0]);
}
function moverOrdenLista(listas, id, d) {
  const ids = ordenarListas(listas).map((l) => l.id);
  const i = ids.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try { localStorage.setItem("ordenListas", JSON.stringify(ids)); } catch (e) {}
}
let listasCache = []; // listas guardadas (para «Mover a…» en el modo edición)
async function refrescarCabeceraListas() {
  const res = await enviarMensaje({ type: "GET_LISTAS" });
  const listas = ordenarListas(res?.ok ? (res.listas || []) : []);
  listasCache = listas;
  const activa = listas.find((l) => l.activa);
  tituloListaEl.textContent = activa?.name || "Mis animes";
  tituloListaEl.title = tituloListaEl.textContent;
  const previas = listasFijadas();
  const fijadas = previas.filter((id) => listas.some((l) => l.id === id));
  if (fijadas.length !== previas.length) guardarListasFijadas(fijadas); // se olvidan las listas borradas
  // Selector de la cabecera: las listas fijadas; si no hay ninguna fijada, todas
  const mostrar = fijadas.length ? fijadas : listas.map((l) => l.id);
  atajosListasEl.textContent = "";
  for (const id of mostrar) {
    const l = listas.find((x) => x.id === id);
    const b = el("button", { className: "atajo-lista" + (l.activa ? " activo" : ""), type: "button", textContent: l.name, title: l.activa ? "Lista en uso" : `Cambiar a «${l.name}»` });
    b.setAttribute("aria-pressed", String(!!l.activa));
    b.addEventListener("click", () => { if (!l.activa) cambiarAListaGuardada(l, b); });
    atajosListasEl.append(b);
  }
  atajosListasEl.hidden = listas.length < 2;
  const act = atajosListasEl.querySelector(".activo");
  if (act && act.scrollIntoView) act.scrollIntoView({ inline: "center", block: "nearest" });
}
// La rueda del ratón desliza el selector hacia los lados
atajosListasEl.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && atajosListasEl.scrollWidth > atajosListasEl.clientWidth) { atajosListasEl.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });

let cambiandoLista = false;
// Mueve una serie a otra lista: primero se añade al destino (con nota, estado, género, portada y último
// capítulo) y solo si sale bien se quita de la lista actual. Si ya está en el destino, no se mueve.
const seleccionMover = new Map(); // fila -> serie elegida en el modo edición para moverla junto a otras
function pintarBarraMover() {
  const barra = $("barraMover");
  if (!modoEdicion) seleccionMover.clear();
  barra.textContent = "";
  if (!seleccionMover.size) { barra.hidden = true; return; }
  const destinos = listasCache.filter((l) => !l.activa);
  const n = seleccionMover.size;
  const sel = el("select", { className: "mover-lista", ariaLabel: "Mover las series elegidas a otra lista", title: "Mover las series elegidas a otra lista" });
  sel.append(el("option", { value: "", textContent: "Mover a…" }));
  destinos.forEach((l) => sel.append(el("option", { value: l.id, textContent: l.name })));
  sel.addEventListener("change", () => {
    const dest = destinos.find((l) => l.id === sel.value);
    sel.value = "";
    if (dest) moverVarias([...seleccionMover.values()], dest, sel);
  });
  const limpiar = el("button", { className: "btn-mini", type: "button", textContent: "Quitar selección" });
  limpiar.addEventListener("click", () => { seleccionMover.clear(); pintarBarraMover(); render(); });
  barra.append(el("span", { textContent: `${n} serie${n > 1 ? "s" : ""} elegida${n > 1 ? "s" : ""}` }), sel, limpiar);
  barra.hidden = false;
}

// Mover varias: primero se añaden todas al destino y solo las que llegaron se quitan de esta lista
// (de abajo arriba: en una hoja, al borrar una fila las de debajo cambian de número).
async function moverVarias(animes, dest, selectEl) {
  if (moviendoSerie || !animes.length) return;
  if (!confirm(`¿Mover ${animes.length} serie${animes.length > 1 ? "s" : ""} a «${dest.name}»? Se quitarán de esta lista.`)) return;
  moviendoSerie = true;
  if (selectEl) selectEl.disabled = true;
  const movidas = [], repetidas = [], fallos = [], sinQuitar = [];
  try {
    const cat = leerCatalogoGuardado(dest.id) || GENEROS_BASE.slice();
    let catCambio = false;
    for (const a of animes) {
      toast(`Moviendo ${movidas.length + repetidas.length + fallos.length + 1} de ${animes.length}…`);
      const serie = { title: a.title, url: a.url, score: a.score, status: a.status, genre: a.genre, cover: a.cover, lastEpisodeUrl: a.lastEpisodeUrl };
      const r = await enviarMensaje({ type: "ADD_SERIE_COMPLETA", serie, listaId: dest.id });
      if (r?.ok) { movidas.push(a); parseGeneros(a.genre).forEach((g) => { if (!cat.includes(g)) { cat.push(g); catCambio = true; } }); }
      else if (String(r?.error || "").includes("YA_EXISTE")) repetidas.push(a);
      else fallos.push(a);
    }
    if (catCambio) guardarCatalogoDe(dest.id, cat);
    for (const a of movidas.slice().sort((x, y) => y.row - x.row)) {
      const d = await enviarMensaje({ type: "DELETE_SERIE", row: a.row, title: a.title });
      if (!d?.ok) sinQuitar.push(a);
    }
    const quitadas = movidas.filter((a) => !sinQuitar.includes(a));
    const partes = [`${quitadas.length} movida${quitadas.length === 1 ? "" : "s"} a «${dest.name}»`];
    if (repetidas.length) partes.push(`${repetidas.length} ya estaba${repetidas.length === 1 ? "" : "n"} allí`);
    if (sinQuitar.length) partes.push(`${sinQuitar.length} copiada${sinQuitar.length === 1 ? "" : "s"} sin poder quitar`);
    if (fallos.length) partes.push(`${fallos.length} con error`);
    toast(partes.join(" · "));
    seleccionMover.clear();
    if (esListaSinSheet()) {
      const filasQuitadas = new Set(quitadas.map((a) => a.row));
      todosLosAnimes = todosLosAnimes.filter((x) => !filasQuitadas.has(x.row));
      render();
      guardarListaCache();
    } else {
      await cargar();
    }
  } finally {
    moviendoSerie = false;
    if (selectEl) selectEl.disabled = false;
    pintarBarraMover();
  }
}

let moviendoSerie = false;
async function moverSerie(anime, dest, selectEl) {
  if (moviendoSerie) return;
  if (!confirm(`¿Mover «${anime.title}» a «${dest.name}»? Se quitará de esta lista.`)) return;
  moviendoSerie = true;
  if (selectEl) selectEl.disabled = true;
  try {
    const serie = { title: anime.title, url: anime.url, score: anime.score, status: anime.status, genre: anime.genre, cover: anime.cover, lastEpisodeUrl: anime.lastEpisodeUrl };
    const a = await enviarMensaje({ type: "ADD_SERIE_COMPLETA", serie, listaId: dest.id });
    if (!a?.ok) { toast(String(a?.error || "").includes("YA_EXISTE") ? `Ya está en «${dest.name}»: no se mueve` : mensajeError(a?.error || "error desconocido")); return; }
    // El género pasa al catálogo de la lista destino si aún no lo tiene
    try {
      const cat = leerCatalogoGuardado(dest.id) || GENEROS_BASE.slice();
      const nuevos = parseGeneros(anime.genre).filter((g) => !cat.includes(g));
      if (nuevos.length) guardarCatalogoDe(dest.id, cat.concat(nuevos));
    } catch (e) {}
    const d = await enviarMensaje({ type: "DELETE_SERIE", row: anime.row, title: anime.title });
    if (!d?.ok) { toast("Se copió a «" + dest.name + "», pero no se pudo quitar de esta lista: " + mensajeError(d?.error || "error desconocido")); return; }
    toast(`Movida a «${dest.name}»`);
    if (esListaSinSheet()) {
      todosLosAnimes = todosLosAnimes.filter((x) => x.row !== anime.row);
      render();
      guardarListaCache();
    } else {
      await cargar(); // al borrar una fila de la hoja, las de debajo cambian de número
    }
  } finally {
    moviendoSerie = false;
    if (selectEl) selectEl.disabled = false;
  }
}

async function cambiarAListaGuardada(l, usarBtn) {
  if (cambiandoLista) return;
  cambiandoLista = true;
  usarBtn.disabled = true;
  const r = await enviarMensaje({ type: "SWITCH_LISTA", id: l.id });
  if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); usarBtn.disabled = false; cambiandoLista = false; return; }
  toast(`Viendo: ${r.name}`);
  setListasPanel(false);
  todosLosAnimes = [];
  await cargar();
  cambiandoLista = false;
  // Refresca también el formulario de "Herramientas" para que muestre la hoja activa
  $("configTools").innerHTML = "";
  $("configTools").append(crearFormConfig({ bienvenida: false }), crearBotonCuenta());
}

async function borrarListaGuardada(l) {
  if (l.tipo === "nube") return quitarListaNube(l);
  const aviso = l.tipo === "local"
    ? `¿Borrar la lista local «${l.name}»? Se eliminarán sus series de la extensión y no se puede deshacer. Si quieres conservarlas, exporta antes un .json.`
    : `¿Quitar «${l.name}» de tus listas guardadas? (no borra la hoja de Google, solo el acceso rápido)`;
  if (!confirm(aviso)) return;
  const r = await enviarMensaje({ type: "DELETE_LISTA", id: l.id });
  if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
  try { localStorage.removeItem(claveCatalogoDe(l.id)); } catch (e) {}
  cargarListasPanel();
}

// --- Listas locales: exportar / importar .json --------------------------------------
function descargarJson(nombreArchivo, objeto) {
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nombreArchivo });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportarLista(l, btn) {
  btn.disabled = true;
  let datos;
  if (l.tipo === "local" || l.tipo === "nube") {
    const r = await enviarMensaje({ type: "EXPORT_LISTA_LOCAL", id: l.id });
    if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); btn.disabled = false; return; }
    datos = r.datos;
  } else {
    // Lista de Google Sheets en uso: se exporta lo que se está viendo
    datos = {
      nombre: l.name,
      series: todosLosAnimes.map((a) => ({ title: a.title, url: a.url, score: a.score, status: a.status, genre: a.genre, cover: a.cover, lastEpisodeUrl: a.lastEpisodeUrl })),
    };
  }
  const generos = l.activa ? catalogo : (leerCatalogoGuardado(l.id) || GENEROS_BASE);
  const archivo = (l.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "lista") + ".json";
  descargarJson(archivo, { app: "AnimeAV1 Tracker", formato: 1, exportado: new Date().toISOString(), nombre: datos.nombre, generos, series: datos.series });
  toast("Lista exportada");
  btn.disabled = false;
}

const listaLocalNombreEl = $("listaLocalNombre");
const listaLocalStatusEl = $("listaLocalStatus");
const listaLocalArchivoEl = $("listaLocalArchivo");

async function crearListaLocal() {
  const name = listaLocalNombreEl.value.trim();
  if (!name) { listaLocalStatusEl.textContent = "Ponle un nombre a la lista."; return; }
  const res = await enviarMensaje({ type: "ADD_LISTA_LOCAL", name });
  if (!res?.ok) { listaLocalStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  listaLocalNombreEl.value = "";
  listaLocalStatusEl.textContent = `Lista local creada: ${res.name}. Pulsa «Usar» para abrirla.`;
  toast("Lista local creada");
  cargarListasPanel();
}

async function importarListaLocal(archivo) {
  listaLocalStatusEl.textContent = "Leyendo archivo…";
  let datos;
  try { datos = JSON.parse(await archivo.text()); } catch (e) { datos = null; }
  const series = Array.isArray(datos) ? datos : datos?.series;
  if (!Array.isArray(series)) { listaLocalStatusEl.textContent = mensajeError("JSON_INVALIDO"); return; }
  const name = listaLocalNombreEl.value.trim() || String(datos?.nombre || "").trim() || archivo.name.replace(/\.json$/i, "");
  const res = await enviarMensaje({ type: "ADD_LISTA_LOCAL", name, series });
  if (!res?.ok) { listaLocalStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  // Catálogo de géneros de la lista nueva: los del archivo y los que usan sus series
  const delArchivo = Array.isArray(datos?.generos) ? datos.generos.map((g) => String(g).replace(/,/g, " ").trim()).filter(Boolean) : [];
  const enUso = series.flatMap((x) => parseGeneros(x?.genre));
  const generos = unico([...delArchivo, ...enUso]);
  if (generos.length) guardarCatalogoDe(res.id, generos);
  listaLocalNombreEl.value = "";
  listaLocalStatusEl.textContent = `Importada: ${res.name} (${res.total} series). Pulsa «Usar» para abrirla.`;
  toast("Lista importada");
  cargarListasPanel();
}

$("listaLocalCrearBtn").addEventListener("click", crearListaLocal);
listaLocalNombreEl.addEventListener("keydown", (e) => { if (e.key === "Enter") crearListaLocal(); });
$("listaLocalImportarBtn").addEventListener("click", () => listaLocalArchivoEl.click());
listaLocalArchivoEl.addEventListener("change", () => {
  const archivo = listaLocalArchivoEl.files[0];
  listaLocalArchivoEl.value = ""; // permite volver a elegir el mismo archivo
  if (archivo) importarListaLocal(archivo);
});

const menusListaAbiertos = new Set(); // ids de listas con el menú del engranaje desplegado
const SVG_ENGRANAJE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1-1.8 3.1-.2-.1a3 3 0 0 1-3.3.2l-.1-.1a3 3 0 0 0-4.2 0l-.1.1a3 3 0 0 1-3.3-.2l-.2.1-1.8-3.1.1-.1a3 3 0 0 0 .3-3.3v-.2a3 3 0 0 0-.3-3.3l-.1-.1 1.8-3.1.2.1a3 3 0 0 1 3.3-.2l.1.1a3 3 0 0 0 4.2 0l.1-.1a3 3 0 0 1 3.3.2l.2-.1 1.8 3.1-.1.1a3 3 0 0 0-.3 3.3v.2a3 3 0 0 0 .3 3.3Z"/></svg>';

async function cargarListasPanel() {
  listasContenidoEl.innerHTML = "";
  refrescarCabeceraListas();
  const res = await enviarMensaje({ type: "GET_LISTAS" });
  const listas = ordenarListas(res?.listas || []);
  if (listas.length === 0) {
    listasContenidoEl.append(el("p", { className: "vacio-listas", textContent: "Todavía no has guardado ninguna lista." }));
    return;
  }
  listas.forEach((l, idx) => {
    const subir = el("button", { className: "btn-mini mover-orden", type: "button", textContent: "▲ Subir", title: "Subir en el selector", ariaLabel: "Subir", disabled: idx === 0 });
    const bajar = el("button", { className: "btn-mini mover-orden", type: "button", textContent: "▼ Bajar", title: "Bajar en el selector", ariaLabel: "Bajar", disabled: idx === listas.length - 1 });
    subir.addEventListener("click", () => { moverOrdenLista(listas, l.id, -1); cargarListasPanel(); });
    bajar.addEventListener("click", () => { moverOrdenLista(listas, l.id, 1); cargarListasPanel(); });
    const usarBtn = el("button", { className: "btn-mini", type: "button", textContent: l.activa ? "En uso" : "Usar", disabled: l.activa });
    usarBtn.addEventListener("click", () => cambiarAListaGuardada(l, usarBtn));
    const exportarBtn = el("button", { className: "btn-mini", type: "button", textContent: "Exportar", title: "Guardar esta lista en un archivo .json" });
    exportarBtn.addEventListener("click", () => exportarLista(l, exportarBtn));
    const renombrarBtn = el("button", { className: "btn-mini", type: "button", textContent: "✎ Nombre", title: "Cambiar el nombre de la lista", ariaLabel: "Cambiar el nombre de la lista" });
    renombrarBtn.addEventListener("click", async () => {
      const nuevo = prompt("Nuevo nombre de la lista", l.name);
      if (nuevo === null || !nuevo.trim() || nuevo.trim() === l.name) return;
      const r = await enviarMensaje({ type: "RENAME_LISTA", id: l.id, name: nuevo });
      if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
      toast("Nombre cambiado");
      cargarListasPanel();
      if (typeof cargarFuentes === "function") cargarFuentes(); // los nombres de lista también salen en Otras páginas fuente
      if (l.activa) { configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || configActual; $("configTools").innerHTML = ""; $("configTools").append(crearFormConfig({ bienvenida: false }), crearBotonCuenta()); }
    });
    const borrarBtn = el("button", { className: "btn-mini peligro", type: "button", textContent: l.tipo === "local" ? "Borrar" : "Quitar" });
    borrarBtn.addEventListener("click", () => borrarListaGuardada(l));
    // Lista de Sheets o local → subir una copia a la nube; lista de la nube propia → compartir
    let nubeBtn = null, cajaCompartir = null, enlaceBtn = null, cajaEnlace = null;
    if (l.tipo === "nube") {
      if (l.rol === "propietario") {
        nubeBtn = el("button", { className: "btn-mini", type: "button", textContent: "Compartir", title: "Dar acceso a otras cuentas de Google" });
        cajaCompartir = el("div", { className: "nube-compartir", hidden: true });
        nubeBtn.addEventListener("click", () => { if (cajaCompartir.hidden) abrirCompartir(l, cajaCompartir); else cajaCompartir.hidden = true; });
        enlaceBtn = el("button", { className: "btn-mini", type: "button", textContent: "🌐 Enlace público", title: "Generar un enlace de solo lectura para enseñar la lista sin que el otro tenga cuenta" });
        cajaEnlace = el("div", { className: "nube-compartir", hidden: true });
        enlaceBtn.addEventListener("click", () => { if (cajaEnlace.hidden) abrirEnlacePublico(l, cajaEnlace); else cajaEnlace.hidden = true; });
      }
    } else {
      nubeBtn = el("button", { className: "btn-mini", type: "button", textContent: "A la nube", title: "Subir una copia de esta lista a la nube (la original no cambia)" });
      nubeBtn.addEventListener("click", () => subirListaANube(l, nubeBtn));
    }
    const etiquetaNube = l.tipo !== "nube" ? null : el("span", { className: "etiqueta-local", textContent: l.rol === "propietario" ? "Nube" : (l.rol === "lectura" ? "Nube · solo lectura" : "Nube · compartida") });
    // Vínculo hoja ↔ nube
    const par = l.vinculo ? listas.find((x) => x.id === l.vinculo.con) : null;
    let vinculoBtns = [], cajaVinculo = null;
    if (par) {
      const sinc = el("button", { className: "btn-mini", type: "button", textContent: "🔗 Sincronizar", title: `Sincronizar ahora con «${par.name}»` });
      sinc.addEventListener("click", () => sincronizarVinculoManual(l, sinc));
      const desv = el("button", { className: "btn-mini peligro", type: "button", textContent: "Desvincular", title: `Dejar de sincronizar con «${par.name}»` });
      desv.addEventListener("click", async () => {
        if (!confirm(`¿Desvincular «${l.name}» de «${par.name}»?\nLas dos listas se quedan como están, pero dejan de sincronizarse.`)) return;
        const r = await enviarMensaje({ type: "VINCULO_QUITAR", id: l.id });
        if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
        cargarListasPanel();
      });
      vinculoBtns = [sinc, desv];
    } else if (l.tipo === "nube" ? l.rol !== "lectura" : l.tipo !== "local") {
      const vb = el("button", { className: "btn-mini", type: "button", textContent: "🔗 Vincular…", title: l.tipo === "nube" ? "Vincular con una hoja de Google" : "Vincular con una lista de la nube" });
      cajaVinculo = el("div", { className: "nube-compartir", hidden: true });
      vb.addEventListener("click", () => { if (cajaVinculo.hidden) abrirVincular(l, listas, cajaVinculo); else cajaVinculo.hidden = true; });
      vinculoBtns = [vb];
    }
    const etiquetaVinculo = par ? el("span", { className: "etiqueta-local etiqueta-vinculo", textContent: "🔗 " + par.name, title: `Vinculada con «${par.name}»` }) : null;
    const fijada = listasFijadas().includes(l.id);
    const fijarBtn = el("button", { className: "btn-mini btn-fijar", type: "button", textContent: fijada ? "📌 Fijada" : "📌 Fijar", title: fijada ? "Quitar de la barra de listas" : "Fijar en la barra de listas (si fijas alguna, solo se muestran las fijadas)", ariaLabel: fijada ? "Quitar acceso directo" : "Fijar acceso directo" });
    fijarBtn.setAttribute("aria-pressed", String(fijada));
    fijarBtn.addEventListener("click", () => { alternarListaFijada(l.id); cargarListasPanel(); });
    const menu = el("div", { className: "lista-menu", hidden: !menusListaAbiertos.has(l.id) },
      subir, bajar, renombrarBtn, fijarBtn, nubeBtn, enlaceBtn, ...vinculoBtns, (l.tipo === "local" || l.tipo === "nube" || l.activa) ? exportarBtn : null);
    const engranaje = el("button", { className: "icon-btn btn-engranaje", type: "button", title: "Más opciones de la lista", ariaLabel: "Más opciones de la lista" });
    engranaje.innerHTML = SVG_ENGRANAJE;
    engranaje.setAttribute("aria-expanded", String(!menu.hidden));
    engranaje.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      if (menu.hidden) menusListaAbiertos.delete(l.id); else menusListaAbiertos.add(l.id);
      engranaje.setAttribute("aria-expanded", String(!menu.hidden));
    });
    listasContenidoEl.append(el("div", { className: "lista-bloque" },
      el("div", { className: "lista-item" },
        el("div", { className: "lista-info" },
          el("span", { className: "nombre", textContent: l.name }),
          el("div", { className: "lista-etiquetas" },
            l.tipo === "local" ? el("span", { className: "etiqueta-local", textContent: "Local" }) : null,
            etiquetaNube,
            etiquetaVinculo,
            l.activa ? el("span", { className: "etiqueta-activa", textContent: "Activa" }) : null)),
        el("div", { className: "lista-acciones" }, usarBtn, borrarBtn, engranaje)),
      menu,
      cajaCompartir,
      cajaEnlace,
      cajaVinculo));
  });
}

async function guardarListaNueva() {
  const name = listaNombreEl.value.trim();
  const url = listaUrlEl.value.trim();
  if (!name) { listaStatusEl.textContent = "Ponle un nombre a la lista."; return; }
  if (!url) { listaStatusEl.textContent = "Pega el enlace de la hoja."; return; }
  listaGuardarBtnEl.disabled = true;
  listaStatusEl.textContent = "Comprobando acceso…";
  const res = await enviarMensaje({ type: "ADD_LISTA", name, url });
  listaGuardarBtnEl.disabled = false;
  if (!res?.ok) { listaStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  listaStatusEl.textContent = `Guardada: ${res.name}`;
  listaNombreEl.value = ""; listaUrlEl.value = "";
  toast("Lista guardada");
  cargarListasPanel();
}
listaGuardarBtnEl.addEventListener("click", guardarListaNueva);
[listaNombreEl, listaUrlEl].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") guardarListaNueva(); }));


// --- Listas en la nube (Cloudflare D1) -----------------------------------------------
const nubeSesionEl = $("nubeSesion");
const nubeAccionesEl = $("nubeAcciones");
const nubeNombreEl = $("nubeNombre");
const nubeStatusEl = $("nubeStatus");
const nubeListasEl = $("nubeListas");

// Aviso sobre la última sincronización al abrir una lista de la nube (la lista se muestra igualmente)
// Resultado de la sincronización que se lanzó al abrir la lista (la lista ya se ha enseñado con lo guardado):
// si llegaron cambios de otros dispositivos se repinta, y si falló se avisa.
async function esperarSyncNube(id) {
  const r = await enviarMensaje({ type: "NUBE_ESPERAR_SYNC", id });
  if (!r?.ok || !r.nube) return;
  avisoNube(r.nube);
  if (r.nube.ok && r.nube.cambios > 0 && configActual?.listaId === id) cargar({ sinSync: true });
}

// Cambios de otros dispositivos: se miran al volver a la ventana y cada 30 s mientras está a la vista
let ultimoRefrescoNube = 0;
async function refrescarNubeSiToca(alVolver) {
  if (document.visibilityState !== "visible" || configActual?.tipo !== "nube" || !configActual.listaId) return;
  if (Date.now() - ultimoRefrescoNube < (alVolver ? 4000 : 25000)) return;
  const a = document.activeElement;
  if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return; // no molestar mientras se escribe
  if (seleccionMover.size) return;                              // ni en mitad de mover series
  ultimoRefrescoNube = Date.now();
  const id = configActual.listaId;
  const r = await enviarMensaje({ type: "NUBE_SINCRONIZAR", id });
  if (r?.ok && r.cambios > 0 && configActual?.listaId === id) cargar({ sinSync: true });
}
document.addEventListener("visibilitychange", () => refrescarNubeSiToca(true));
window.addEventListener("focus", () => refrescarNubeSiToca(true));
setInterval(() => refrescarNubeSiToca(false), 30000);

function avisoNube(n) {
  if (!n || n.ok) return;
  const e = String(n.error || "");
  if (/NUBE_SESION_CADUCADA/.test(e)) {
    mostrarSync("Sesión de la nube caducada: mostrando lo guardado en este dispositivo.", { texto: "Iniciar sesión", accion: () => setListasPanel(true) });
  } else if (/NUBE_LISTA_NO_EXISTE/.test(e)) {
    mostrarSync("Esta lista ya no existe en la nube (la borraron o dejó de estar compartida contigo). Lo que tienes guardado aquí sigue en este dispositivo.", { texto: "Quitar de este dispositivo", accion: () => quitarListaDeEsteDispositivo(n.id) });
  } else if (/NUBE_SIN_CONEXION/.test(e)) {
    mostrarSync("Sin conexión: tus cambios se enviarán a la nube cuando vuelva internet.", { texto: "Reintentar", accion: cargar });
  } else {
    mostrarSync("No se pudo sincronizar con la nube: " + mensajeError(e), { texto: "Reintentar", accion: cargar });
  }
}

// Si el error es de sesión, enseña el botón de Google; en cualquier caso muestra el mensaje
function errorNube(r, destino) {
  const e = String(r?.error || "error desconocido");
  const msg = mensajeError(e);
  if (destino) destino.textContent = msg; else toast(msg);
  if (/NUBE_SESION_CADUCADA/.test(e)) cargarNubePanel();
}

async function cargarNubePanel() {
  nubeStatusEl.textContent = "";
  nubeListasEl.innerHTML = "";
  nubeSesionEl.innerHTML = "";
  const est = await enviarMensaje({ type: "NUBE_ESTADO" });
  if (!est?.sesion) {
    nubeAccionesEl.hidden = true;
    const cont = el("div", { className: "nube-boton-google" });
    nubeSesionEl.append(el("p", { className: "nube-ayuda", textContent: "Inicia sesión con Google para usar las listas en la nube." }), cont);
    window.PWA_NUBE.renderBoton(
      cont,
      () => { toast("Sesión iniciada"); cargarNubePanel(); cargarListasPanel(); },
      (e) => { nubeStatusEl.textContent = mensajeError(e?.message || e); }
    );
    return;
  }
  const salir = el("button", { className: "btn-mini", type: "button", textContent: "Cerrar sesión" });
  salir.addEventListener("click", async () => { await enviarMensaje({ type: "NUBE_CERRAR_SESION" }); cargarNubePanel(); });
  nubeSesionEl.append(el("div", { className: "lista-item" }, el("span", { className: "nombre", textContent: "Sesión: " + est.sesion.email }), salir));
  nubeAccionesEl.hidden = false;
  listarNube();
}

async function listarNube() {
  nubeListasEl.innerHTML = "";
  const r = await enviarMensaje({ type: "NUBE_LISTAR" });
  if (!r?.ok) { errorNube(r, nubeStatusEl); return; }
  if (!r.listas.length) {
    nubeListasEl.append(el("p", { className: "vacio-listas", textContent: "Todavía no tienes listas en la nube." }));
    return;
  }
  r.listas.forEach((l) => {
    const rol = l.rol === "propietario" ? "" : (l.rol === "lectura" ? " · compartida, solo lectura" : " · compartida contigo");
    let accion;
    if (l.enDispositivo) accion = el("span", { className: "etiqueta-activa", textContent: "En este dispositivo" });
    else {
      accion = el("button", { className: "btn-mini", type: "button", textContent: "Añadir a este dispositivo" });
      accion.addEventListener("click", async () => {
        accion.disabled = true;
        const a = await enviarMensaje({ type: "NUBE_ANADIR", id: l.id });
        if (!a?.ok) { accion.disabled = false; errorNube(a); return; }
        toast(`«${a.name}» añadida (${a.total} series)`);
        cargarListasPanel(); listarNube();
      });
    }
    nubeListasEl.append(el("div", { className: "lista-item" },
      el("div", { className: "lista-info" }, el("span", { className: "nombre", textContent: l.nombre + rol })),
      el("div", { className: "lista-acciones" }, accion)));
  });
}

$("nubeCrearBtn").addEventListener("click", async () => {
  const name = nubeNombreEl.value.trim();
  if (!name) { nubeStatusEl.textContent = "Ponle un nombre a la lista."; return; }
  $("nubeCrearBtn").disabled = true;
  const r = await enviarMensaje({ type: "NUBE_CREAR", name });
  $("nubeCrearBtn").disabled = false;
  if (!r?.ok) { errorNube(r, nubeStatusEl); return; }
  nubeNombreEl.value = "";
  nubeStatusEl.textContent = `Creada: ${r.name}`;
  toast("Lista creada en la nube");
  cargarListasPanel(); listarNube();
});
nubeNombreEl.addEventListener("keydown", (e) => { if (e.key === "Enter") $("nubeCrearBtn").click(); });

// --- Vincular una hoja de Google con una lista de la nube ------------------------------------
// Las dos listas se mantienen iguales en los dos sentidos. La nube se puede usar en cualquier dispositivo sin
// iniciar sesión en Google Sheets; la hoja se actualiza cuando un dispositivo con acceso a ella abre cualquiera de las dos.
function candidatosVinculo(l, listas) {
  if (l.tipo === "nube") return listas.filter((x) => x.tipo !== "nube" && x.tipo !== "local" && !x.vinculo);
  return listas.filter((x) => x.tipo === "nube" && x.rol !== "lectura" && !x.vinculo);
}

function resumenVinculo(r) {
  if (!r?.ok) return mensajeError(r?.error || "error desconocido");
  const o = r.omitido;
  if (o === "sin_sesion_hoja") return "Vinculadas. Para sincronizar hace falta tener sesión de Google Sheets en este dispositivo.";
  if (o === "sin_nube") return "No se pudo sincronizar la lista de la nube: " + mensajeError(r.error || "NUBE_SIN_CONEXION");
  if (o === "borrados_masivos") return `Sincronización detenida: iba a borrar ${r.borrados} series de golpe. Revisa que la hoja y la lista estén bien y vuelve a intentarlo.`;
  if (o === "solo_lectura") return "La lista de la nube es de solo lectura.";
  if (o) return "Nada que sincronizar.";
  const t = (x) => x.actualizadas + x.anadidas + x.eliminadas;
  const partes = [];
  if (t(r.hoja)) partes.push(`hoja: ${t(r.hoja)} cambio${t(r.hoja) === 1 ? "" : "s"}`);
  if (t(r.nube)) partes.push(`nube: ${t(r.nube)} cambio${t(r.nube) === 1 ? "" : "s"}`);
  const fallos = r.fallos ? ` ${r.fallos} no se pudo escribir y se reintentará.` : "";
  if (!partes.length) return r.fallos ? fallos.trim() : "Todo al día: la hoja y la nube ya coinciden.";
  return "Sincronizadas (" + partes.join(", ") + ")." + fallos;
}

function abrirVincular(l, listas, caja) {
  caja.hidden = false;
  caja.innerHTML = "";
  const esNube = l.tipo === "nube";
  const cands = candidatosVinculo(l, listas);
  caja.append(el("p", { className: "nube-ayuda", textContent: esNube ? "Elige la hoja de Google que quieres mantener sincronizada con esta lista." : "Elige la lista de la nube que quieres mantener sincronizada con esta hoja." }));
  if (!cands.length) {
    caja.append(el("div", { className: "estado-txt", textContent: esNube ? "No tienes ninguna hoja de Google guardada sin vincular en este dispositivo. Añádela antes en «Tus listas»." : "No tienes en este dispositivo ninguna lista de la nube (tuya o con permiso de edición) sin vincular." }));
    return;
  }
  const sel = el("select", { ariaLabel: "Lista a vincular" }, ...cands.map((c) => el("option", { value: c.id, textContent: c.name })));
  const ok = el("button", { className: "btn", type: "button", textContent: "Vincular" });
  const estado = el("div", { className: "estado-txt" });
  ok.addEventListener("click", async () => {
    const otra = cands.find((c) => c.id === sel.value);
    if (!otra) return;
    if (!confirm(`Se vincularán «${l.name}» y «${otra.name}».\n\nLas series que falten en una se añadirán a la otra y, desde ahora, los cambios de una llegarán a la otra (si cambias lo mismo en las dos a la vez, gana la hoja). Se sincronizan al abrir cualquiera de las dos en un dispositivo con acceso a la hoja.\n\n¿Vincular?`)) return;
    ok.disabled = true;
    estado.textContent = "Vinculando y sincronizando…";
    const r = await enviarMensaje({ type: "VINCULO_CREAR", hojaId: esNube ? otra.id : l.id, nubeId: esNube ? l.id : otra.id });
    if (!r?.ok) { ok.disabled = false; estado.textContent = mensajeError(r?.error || "error desconocido"); return; }
    const s = await enviarMensaje({ type: "VINCULO_SINCRONIZAR", id: l.id, forzar: true, interactivo: true });
    toast(resumenVinculo(s));
    cargarListasPanel();
    if (s?.cambiosActiva) cargar();
  });
  caja.append(sel, ok, estado);
}

async function sincronizarVinculoManual(l, btn) {
  btn.disabled = true;
  toast("Sincronizando…");
  const r = await enviarMensaje({ type: "VINCULO_SINCRONIZAR", id: l.id, forzar: true, interactivo: true });
  btn.disabled = false;
  toast(resumenVinculo(r));
  if (r?.ok && r.cambiosActiva) cargar();
}

// Al abrir una lista vinculada: sincroniza en segundo plano, sin ventanas ni avisos (si no hay sesión de la hoja, no hace nada)
async function sincronizarVinculoSilencioso() {
  try {
    const r = await enviarMensaje({ type: "VINCULO_SINCRONIZAR" });
    if (r?.ok && r.cambiosActiva) cargar(); // la sincronización siguiente sale como «reciente»: no hay bucle
  } catch (e) {}
}

async function subirListaANube(l, btn) {
  if (!confirm(`¿Subir una copia de «${l.name}» a la nube? La lista original no se modifica. Después podrás usarla desde otros dispositivos y compartirla.`)) return;
  btn.disabled = true;
  toast("Subiendo…");
  const r = await enviarMensaje({ type: "NUBE_SUBIR", id: l.id });
  btn.disabled = false;
  if (!r?.ok) { errorNube(r); return; }
  toast(r.error
    ? `Copia creada (${r.total} series), pero no se pudo enviar todo: ${mensajeError(r.error)}`
    : `Copia en la nube creada (${r.total} series)`);
  // Una hoja de Google puede quedar vinculada a su copia: los cambios de una llegan a la otra
  if (l.tipo !== "local" && !l.vinculo && confirm("¿Dejar la copia vinculada con la hoja?\nAsí los cambios de la hoja llegarán a la nube y los de la nube a la hoja, y en otros dispositivos podrás usar la lista de la nube sin iniciar sesión en Google Sheets.")) {
    const v = await enviarMensaje({ type: "VINCULO_CREAR", hojaId: l.id, nubeId: r.id });
    toast(v?.ok ? "Listas vinculadas" : mensajeError(v?.error || "error desconocido"));
  }
  cargarListasPanel(); cargarNubePanel();
}

// Quitar una lista de la nube de ESTE dispositivo; si eres el propietario, opcionalmente borrarla para todos
// Quita del dispositivo una lista de la nube que ya no existe allí (sin preguntar por borrarla de la nube)
async function quitarListaDeEsteDispositivo(id) {
  if (!confirm("¿Quitar esta lista de este dispositivo?\nYa no existe en la nube, así que las series que tengas guardadas solo aquí se perderán. Si quieres conservarlas, exporta antes un .json desde Tus listas.")) return;
  const r = await enviarMensaje({ type: "DELETE_LISTA", id });
  if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
  try { localStorage.removeItem(claveCatalogoDe(id)); } catch (e) {}
  toast("Lista quitada de este dispositivo");
  cargar();
}

async function quitarListaNube(l) {
  if (!confirm(`¿Quitar «${l.name}» de este dispositivo? Sus series siguen en la nube y podrás volver a añadirla.`)) return;
  let borrarRemota = false;
  if (l.rol === "propietario") {
    borrarRemota = confirm(`¿Borrarla también de la nube?\nSe eliminará para todas las cuentas con las que la compartas y no se puede deshacer.\n\nAceptar = borrar de la nube · Cancelar = solo quitarla de este dispositivo`);
  }
  if (borrarRemota) {
    const b = await enviarMensaje({ type: "NUBE_BORRAR", id: l.id });
    if (!b?.ok) { errorNube(b); return; }
  } else {
    await enviarMensaje({ type: "NUBE_SINCRONIZAR", id: l.id }); // envía antes lo pendiente; si falla, no impide quitarla
  }
  const r = await enviarMensaje({ type: "DELETE_LISTA", id: l.id });
  if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
  try { localStorage.removeItem(claveCatalogoDe(l.id)); } catch (e) {}
  cargarListasPanel(); listarNube();
}

async function abrirCompartir(l, caja) {
  caja.hidden = false;
  caja.innerHTML = "";
  caja.append(el("p", { className: "nube-ayuda", textContent: "Comparte esta lista con otras cuentas de Google. La otra persona entra con ese email en «Listas en la nube» y la añade a su dispositivo." }));
  const r = await enviarMensaje({ type: "NUBE_MIEMBROS", id: l.id });
  if (!r?.ok) { caja.append(el("div", { className: "estado-txt", textContent: mensajeError(r?.error || "error desconocido") })); return; }
  r.miembros.forEach((m) => {
    const quitar = el("button", { className: "btn-mini peligro", type: "button", textContent: "Quitar acceso" });
    quitar.addEventListener("click", async () => {
      quitar.disabled = true;
      const q = await enviarMensaje({ type: "NUBE_QUITAR_MIEMBRO", id: l.id, email: m.email });
      if (!q?.ok) { quitar.disabled = false; errorNube(q); return; }
      abrirCompartir(l, caja);
    });
    caja.append(el("div", { className: "lista-item" },
      el("div", { className: "lista-info" },
        el("span", { className: "nombre", textContent: m.email }),
        el("div", { className: "lista-etiquetas" }, el("span", { className: "etiqueta-local", textContent: m.rol === "lectura" ? "Solo lectura" : "Puede editar" }))),
      el("div", { className: "lista-acciones" }, quitar)));
  });
  const email = el("input", { type: "email", placeholder: "email@gmail.com", ariaLabel: "Email de la cuenta de Google" });
  const rol = el("select", { ariaLabel: "Permisos" },
    el("option", { value: "edicion", textContent: "Puede editar" }),
    el("option", { value: "lectura", textContent: "Solo lectura" }));
  const anadir = el("button", { className: "btn", type: "button", textContent: "Compartir" });
  const estado = el("div", { className: "estado-txt" });
  anadir.addEventListener("click", async () => {
    const e = email.value.trim();
    if (!e) { estado.textContent = "Escribe un email."; return; }
    anadir.disabled = true;
    const a = await enviarMensaje({ type: "NUBE_COMPARTIR", id: l.id, email: e, rol: rol.value });
    anadir.disabled = false;
    if (!a?.ok) { errorNube(a, estado); return; }
    abrirCompartir(l, caja);
  });
  email.addEventListener("keydown", (ev) => { if (ev.key === "Enter") anadir.click(); });
  caja.append(email, rol, anadir, estado);
}

async function abrirEnlacePublico(l, caja) {
  caja.hidden = false;
  caja.innerHTML = "";
  caja.append(el("p", { className: "nube-ayuda", textContent: "Genera un enlace para enseñar esta lista a cualquiera, sin cuenta y sin instalar nada. Solo se puede ver (título, portada, nota, estado y géneros), no editar. Puedes desactivarlo cuando quieras." }));
  const estado = el("div", { className: "estado-txt", textContent: "Cargando…" });
  caja.append(estado);
  const r = await enviarMensaje({ type: "NUBE_ENLACE", id: l.id });
  estado.textContent = "";
  if (!r?.ok) { errorNube(r, estado); return; }
  if (!r.enlace) {
    const crear = el("button", { className: "btn", type: "button", textContent: "Crear enlace público" });
    crear.addEventListener("click", async () => {
      crear.disabled = true;
      const c = await enviarMensaje({ type: "NUBE_ENLACE_CREAR", id: l.id });
      if (!c?.ok) { crear.disabled = false; errorNube(c, estado); return; }
      abrirEnlacePublico(l, caja);
    });
    caja.append(crear);
    return;
  }
  const url = r.enlace.url;
  const campo = el("input", { type: "text", readOnly: true, value: url, ariaLabel: "Enlace público de la lista" });
  campo.addEventListener("focus", () => campo.select());
  const copiar = el("button", { className: "btn-mini", type: "button", textContent: "Copiar" });
  copiar.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); }
    catch (e) { campo.focus(); campo.select(); toast("Cópialo a mano desde el cuadro"); }
  });
  const botones = [copiar];
  if (typeof navigator.share === "function") {
    const enviar = el("button", { className: "btn-mini", type: "button", textContent: "Enviar…" });
    enviar.addEventListener("click", () => { navigator.share({ title: l.name, url }).catch(() => {}); });
    botones.push(enviar);
  }
  botones.push(el("a", { className: "btn-mini", href: url, target: "_blank", rel: "noopener noreferrer", textContent: "Abrir" }));
  const renovar = el("button", { className: "btn-mini", type: "button", textContent: "Renovar", title: "Crear un enlace nuevo; el actual deja de funcionar" });
  renovar.addEventListener("click", async () => {
    if (!confirm("¿Crear un enlace nuevo?\nEl enlace actual dejará de funcionar y tendrás que enviar el nuevo.")) return;
    renovar.disabled = true;
    const c = await enviarMensaje({ type: "NUBE_ENLACE_CREAR", id: l.id, renovar: true });
    if (!c?.ok) { renovar.disabled = false; errorNube(c, estado); return; }
    toast("Enlace renovado");
    abrirEnlacePublico(l, caja);
  });
  const quitar = el("button", { className: "btn-mini peligro", type: "button", textContent: "Desactivar", title: "Dejar de compartir: el enlace deja de funcionar" });
  quitar.addEventListener("click", async () => {
    if (!confirm("¿Desactivar el enlace público?\nQuien lo tenga ya no podrá ver la lista.")) return;
    quitar.disabled = true;
    const c = await enviarMensaje({ type: "NUBE_ENLACE_QUITAR", id: l.id });
    if (!c?.ok) { quitar.disabled = false; errorNube(c, estado); return; }
    toast("Enlace desactivado");
    abrirEnlacePublico(l, caja);
  });
  botones.push(renovar, quitar);
  const creado = r.enlace.creado ? new Date(r.enlace.creado).toLocaleDateString() : "";
  caja.append(
    campo,
    el("div", { className: "lista-menu" }, ...botones),
    creado ? el("div", { className: "estado-txt", textContent: `Enlace activo desde el ${creado}. Cualquiera que lo tenga puede ver la lista.` }) : null);
}

// --- Configuración: qué Google Sheet se usa -----------------------------------

let configActual = null; // { url, titulo, hoja } o null si aún no se ha elegido hoja
// Listas que no usan Google Sheets (locales y de la nube): las series se guardan en el dispositivo
const esListaSinSheet = () => configActual?.tipo === "local" || configActual?.tipo === "nube";
let clientIdActual = ""; // Client ID de OAuth ya guardado en este dispositivo (si lo hay)

function mensajeError(error) {
  const c = String(error);
  if (c.includes("SIN_RESPUESTA")) return "No se pudo comunicar con la aplicación.";
  if (c.includes("CONFIGURA_CLIENT_ID_WEB")) return "Falta configurar el Client ID OAuth de tipo Aplicación web en config.js.";
  if (c.includes("GOOGLE_GIS_NO_CARGA")) return "No se pudo cargar el inicio de sesión de Google. Comprueba tu conexión.";
  if (c.includes("origin_mismatch") || c.includes("redirect_uri_mismatch")) return "Google ha rechazado este dominio. Añade la URL de esta PWA en los orígenes autorizados del cliente OAuth.";
  if (c.includes("ENLACE_INVALIDO")) return "Ese enlace no parece de Google Sheets (debe contener «/spreadsheets/d/…»).";
  if (c.includes("HOJA_NO_ENCONTRADA")) return "No se encuentra esa hoja. Revisa el enlace.";
  if (c.includes("SIN_PERMISO")) return "Tu cuenta de Google no tiene acceso a esa hoja. Comprueba que está compartida contigo con permiso de edición.";
  if (c.includes("TOKEN_INVALIDO")) return "La sesión de Google ha caducado. Inténtalo de nuevo.";
  if (c.includes("NECESITA_INICIO_SESION")) return "Toca el botón para iniciar sesión con Google.";
  if (c.includes("access_denied")) return "Has cancelado el inicio de sesión de Google.";
  if (c.includes("ENLACE_ANIME_INVALIDO")) return "Pega un enlace de AnimeAV1 a la ficha de la serie o a uno de sus episodios (animeav1.com/media/…).";
  if (c.includes("FUENTES_INVALIDAS")) return "Eso no parece lo copiado en la extensión (Opciones > Fuentes > «Copiar páginas fuente para la PWA»).";
  if (c.includes("SIN_TITULO_FUENTE")) return "No se encontró el título en esa página. Puede que la web se dibuje con JavaScript (la app solo lee el HTML) o que haya que ajustar la página fuente en la extensión.";
  if (c.includes("FUENTE_NO_ENCONTRADA")) return "Esa página fuente ya no existe.";
  if (c.includes("NO_SE_PUDO_LEER_LA_PAGINA")) return "No se pudo abrir esa página. Comprueba el enlace o tu conexión.";
  if (c.includes("SIN_TITULO")) return "No se encontró el título en esa página. ¿Es el enlace correcto?";
  if (c.includes("FILA_NO_ENCONTRADA")) return "No se encontró la serie registrada. Puede que se haya movido o borrado en la hoja.";
  if (c.includes("YA_EXISTE")) return "Ese anime ya está en tu lista.";
  if (c.includes("FILA_CAMBIADA")) return "La fila de la hoja ya no es esa serie (se editó fuera). Recarga la lista y vuelve a intentarlo.";
  if (c.includes("FALTA_NOMBRE")) return "Ponle un nombre a la lista.";
  if (c.includes("YA_VINCULADA")) return "Una de las dos listas ya está vinculada con otra. Desvincúlala primero.";
  if (c.includes("VINCULO_INVALIDO")) return "Solo se puede vincular una hoja de Google con una lista de la nube.";
  if (c.includes("NUBE_LISTA_NO_EXISTE")) return "Esa lista ya no existe en la nube (la borraron o dejó de estar compartida contigo). Puedes quitarla de este dispositivo.";
  if (c.includes("NUBE_SESION_CADUCADA")) return "Tu sesión de la nube ha caducado. Vuelve a iniciar sesión en «Listas en la nube» (dentro de Tus listas).";
  if (c.includes("NUBE_SIN_CONEXION")) return "No se pudo conectar con la nube. Comprueba tu conexión.";
  if (c.includes("SOLO_LECTURA")) return "Esta lista está compartida contigo como solo lectura.";
  if (c.includes("LISTA_YA_EN_DISPOSITIVO")) return "Esa lista ya está en este dispositivo.";
  if (c.includes("YA_ESTA_EN_LA_NUBE")) return "Esa lista ya está en la nube.";
  if (c.includes("LISTA_NO_ENCONTRADA")) return "Esa lista ya no existe.";
  if (c.includes("FALTA_TITULO")) return "Escribe el título de la serie.";
  if (c.includes("NO_ES_LISTA_LOCAL")) return "Esto solo está disponible en listas locales.";
  if (c.includes("JSON_INVALIDO")) return "Ese archivo no parece una lista exportada de AnimeAV1 Tracker (.json).";
  return c.replace(/^Error:\s*/, "");
}

function crearFormConfigBase({ bienvenida }) {
  const input = el("input", { type: "url", placeholder: "https://docs.google.com/spreadsheets/d/…", value: esListaSinSheet() ? "" : (configActual?.url || ""), ariaLabel: "Enlace de tu Google Sheet" });
  const clientIdInput = el("input", { type: "text", placeholder: "Client ID de OAuth (…apps.googleusercontent.com)", value: clientIdActual || "", ariaLabel: "Client ID de OAuth de Google" });
  const estado = el("div", { className: "estado-txt" });
  const btn = el("button", { className: "btn", type: "button", textContent: bienvenida ? "Conectar y empezar" : "Guardar hoja" });
  if (esListaSinSheet()) estado.textContent = `${configActual.tipo === "nube" ? "Lista en la nube" : "Lista local"} en uso: ${configActual.titulo} (sin Google Sheets). Pega un enlace aquí si prefieres conectar una hoja.`;
  else if (configActual?.titulo) estado.textContent = `Conectada: ${configActual.titulo} (pestaña «${configActual.hoja}»)`;

  async function guardarConfig() {
    const url = input.value.trim();
    const clientId = clientIdInput.value.trim();
    if (!clientId) { estado.textContent = "Pega el Client ID de OAuth (tipo Aplicación web)."; return; }
    if (!url) { estado.textContent = "Pega primero el enlace de tu Google Sheet."; return; }
    btn.disabled = true;
    estado.textContent = "Comprobando acceso…";
    const res = await enviarMensaje({ type: "SAVE_CONFIG", url, clientId });
    btn.disabled = false;
    if (!res?.ok) { estado.textContent = mensajeError(res?.error || "Error desconocido"); return; }
    configActual = { url, titulo: res.titulo, hoja: res.hoja };
    clientIdActual = clientId;
    estado.textContent = `Conectada: ${res.titulo} (pestaña «${res.hoja}»)` + (res.encabezadosCreados ? " · encabezados creados" : "");
    toast("Hoja conectada");
    if (!bienvenida) setHerramientas(false);
    cargar();
  }
  btn.addEventListener("click", guardarConfig);
  [input, clientIdInput].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") guardarConfig(); }));

  return el("div", { className: "config" },
    el("h2", { textContent: bienvenida ? "Conecta tu Google Sheet" : "Hoja de Google Sheets" }),
    el("p", { textContent: bienvenida
      ? "Usa una hoja tuya (vacía o una copia de la plantilla), comprueba que tu cuenta de Google puede editarla y pega aquí su enlace, junto con el Client ID de OAuth (Aplicación web) de tu proyecto de Google Cloud."
      : "Cambia aquí la hoja o el Client ID de OAuth. Se guardan solo en este dispositivo." }),
    clientIdInput, input, btn, estado);
}

// Primera vez: además de conectar una hoja, se puede empezar con una lista local (sin Google)
function crearFormConfig(opts) {
  const form = crearFormConfigBase(opts);
  if (opts?.bienvenida) {
    const estado = form.querySelector(".estado-txt");
    const local = el("button", { className: "btn-mini", type: "button", textContent: "…o empezar con una lista local (sin Google)" });
    local.addEventListener("click", async () => {
      local.disabled = true;
      const a = await enviarMensaje({ type: "ADD_LISTA_LOCAL", name: "Mi lista" });
      const b = a?.ok ? await enviarMensaje({ type: "SWITCH_LISTA", id: a.id }) : a;
      if (!b?.ok) { local.disabled = false; if (estado) estado.textContent = mensajeError(b?.error || "error desconocido"); return; }
      await cargar();
      $("configTools").innerHTML = "";
      $("configTools").append(crearFormConfig({ bienvenida: false }), crearBotonCuenta());
    });
    form.append(local);
  }
  return form;
}

function crearBotonCuenta() {
  if (esListaSinSheet()) return el("div"); // lista local o de la nube: no se usa la cuenta de Google Sheets
  const estado = el("div", { className: "estado-txt" });
  const btn = el("button", { className: "btn", type: "button", textContent: "Cambiar de cuenta de Google" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    estado.textContent = "";
    const r = await enviarMensaje({ type: "CAMBIAR_CUENTA" });
    btn.disabled = false;
    if (!r?.ok) { estado.textContent = mensajeError(r?.error || "error desconocido"); return; }
    toast("Cuenta cambiada");
    setHerramientas(false);
    cargar();
  });
  return el("div", { className: "config" }, btn, estado);
}

// --- Herramientas ------------------------------------------------------------

// --- Opciones -----------------------------------------------------------------

if (guardarPortadasEl) {
  aplicarPreferenciaPortadas();
  guardarPortadasEl.addEventListener("change", async () => {
    const activado = guardarPortadasEl.checked;
    try { localStorage.setItem("guardarPortadas", String(activado)); } catch (e) {}
    aplicarPreferenciaPortadas();
    toast(activado ? "Guardado de portadas activado" : "Guardado de portadas desactivado");
  });
}

if (borrarPortadasBtn) {
  borrarPortadasBtn.addEventListener("click", async () => {
    if (!confirm("¿Borrar todas las portadas guardadas en este dispositivo?")) return;
    try {
      const cache = await caches.open(COVER_CACHE);
      await cache.keys().then(keys => Promise.all(keys.map(k => cache.delete(k))));
      portadasEnCache.clear();
      portadaMem.clear();
      portadaImgs.clear();
      actualizarContadorPortadas();
      precargarStatusEl.textContent = "Se han borrado las copias locales de las portadas.";
      toast("Portadas locales borradas");
    } catch (e) {
      precargarStatusEl.textContent = "No se pudieron borrar las portadas guardadas.";
    }
  });
}

// Precarga TODAS las portadas desde el propio popup (no depende del service
// worker, que Chrome puede matar a mitad). Hay que dejar el popup abierto.
precargarBtn.addEventListener("click", async () => {
  if (!guardarPortadasActivado()) {
    toast("Activa el guardado de portadas primero");
    aplicarPreferenciaPortadas();
    return;
  }
  precargarBtn.disabled = true;
  const pendientes = todosLosAnimes.filter((a) => a.cover);
  const total = pendientes.length;
  const CONCURRENCIA = 8;
  let hechas = 0;
  precargarStatusEl.textContent = `Guardando 0/${total}… no cierres esta ventana.`;

  // Pool continuo: en cuanto un "trabajador" termina una portada, coge la
  // siguiente al momento. Así una portada lenta solo ocupa su propio hueco
  // y no frena a las demás (antes se esperaba a un grupo fijo entero).
  let indice = 0;
  async function trabajador() {
    while (indice < total) {
      const anime = pendientes[indice++];
      await cargarPortada(anime.cover, true);
      hechas++;
      precargarStatusEl.textContent = `Guardando ${hechas}/${total}… no cierres esta ventana.`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, total) }, trabajador));

  precargarStatusEl.textContent = `Listo: ${total} portada(s) guardadas en este dispositivo.`;
  precargarBtn.disabled = false;
});

fillCoversBtn.addEventListener("click", async () => {
  fillCoversBtn.disabled = true;
  fillStatusEl.textContent = "Buscando portadas… puede tardar un poco si hay muchas series.";
  const res = await enviarMensaje({ type: "FILL_COVERS" });
  fillCoversBtn.disabled = false;
  if (!res || !res.ok) {
    fillStatusEl.textContent = "Error al buscar portadas: " + (res?.error || "error desconocido");
    return;
  }
  fillStatusEl.textContent = `Añadidas ${res.encontradas} portada(s).` + (res.sinImagen > 0 ? ` (${res.sinImagen} sin imagen encontrada)` : "");
  cargar();
});

migrateFlvBtn.addEventListener("click", async () => {
  migrateFlvBtn.disabled = true;
  migrateStatusEl.textContent = "Revisando enlaces de AnimeFLV… puede tardar un poco.";
  const res = await enviarMensaje({ type: "MIGRATE_ANIMEFLV" });
  migrateFlvBtn.disabled = false;
  if (!res || !res.ok) {
    migrateStatusEl.textContent = "Error: " + (res?.error || "error desconocido");
    return;
  }
  migrateStatusEl.textContent =
    `Migrados a AnimeAV1: ${res.migradas}. ` +
    `Portada de AnimeFLV usada (sin equivalente en AnimeAV1): ${res.portadasFlv}. ` +
    `Sin cambios: ${res.sinCambios}.`;
  cargar();
});

// --- Carga inicial -----------------------------------------------------------

// --- Caché de la lista: la app se abre al instante y se actualiza después ---------
const syncEl = $("sync");
// La clave identifica la hoja activa: si cambia (otra hoja u otra hoja de cálculo),
// la lista cacheada deja de servir y se vuelve a pedir a Google Sheets.
// Mismo criterio que en la extensión. Ojo: configActual solo tiene {url, titulo, hoja}.
function claveListaActual() {
  return configActual ? `${configActual.url}|${configActual.hoja || ""}` : "";
}

function leerListaCache() {
  try {
    const c = JSON.parse(localStorage.getItem("listaCache") || "null");
    if (c && c.clave === claveListaActual() && Array.isArray(c.lista) && c.lista.length) return c;
  } catch (e) {}
  return null;
}

let guardarCacheTimer = null;
function guardarListaCache() {
  clearTimeout(guardarCacheTimer);
  guardarCacheTimer = setTimeout(() => {
    if (!configActual || !todosLosAnimes.length) return;
    try { localStorage.setItem("listaCache", JSON.stringify({ clave: claveListaActual(), ts: Date.now(), lista: todosLosAnimes })); } catch (e) {}
  }, 400);
}

function mostrarSync(texto, boton) {
  if (!syncEl) return;
  syncEl.innerHTML = "";
  if (!texto) { syncEl.hidden = true; return; }
  if (!boton) syncEl.append(el("div", { className: "spinner mini" }));
  syncEl.append(el("span", { textContent: texto }));
  if (boton) syncEl.append(el("button", { className: "btn-mini", type: "button", textContent: boton.texto, onclick: boton.accion }));
  syncEl.hidden = false;
}

async function cargar(opciones = {}) {
  seleccionMover.clear();
  pintarBarraMover();
  errorEl.hidden = true;
  vacioEl.hidden = true;
  bienvenidaEl.hidden = true;
  mostrarSync("");

  configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || null;
  refrescarCabeceraListas();
  cargarCatalogo(configActual?.listaId);
  filtrosEl.hidden = !configActual;
  const cache = configActual ? leerListaCache() : null;
  if (cache) {
    // Se pinta ya la última lista conocida; mientras tanto se pide la de la hoja.
    cargandoEl.hidden = true;
    todosLosAnimes = cache.lista;
    sincronizarCatalogo();
    render();
    inicializarContadorPortadas();
    refrescandoLista = true;
    mostrarSync("Actualizando…");
  } else {
    cargandoEl.hidden = false;
    listaEl.innerHTML = "";
  }
  if (!configActual) {
    // Primera vez: hay que elegir la hoja antes de nada
    cargandoEl.hidden = true;
    bienvenidaEl.innerHTML = "";
    bienvenidaEl.append(crearFormConfig({ bienvenida: true }));
    bienvenidaEl.hidden = false;
    return;
  }

  const res = await enviarMensaje({ type: "GET_ANIME_LIST", sinSync: !!opciones?.sinSync });
  refrescandoLista = false;
  cargandoEl.hidden = true;

  if ((!res || !res.ok) && cache) {
    // Sin conexión o sesión caducada: se sigue mostrando la lista guardada.
    const error = String(res?.error || "");
    const sesion = /NECESITA_INICIO_SESION|TOKEN_INVALIDO|NO_SE_OBTUVO_TOKEN|access_denied|interaction_required/.test(error);
    if (sesion) {
      mostrarSync("Sesión de Google caducada: mostrando la última lista guardada.", {
        texto: "Iniciar sesión",
        accion: async () => {
          const r = await enviarMensaje({ type: "LOGIN" });
          if (r?.ok) cargar(); else toast(mensajeError(r?.error || "error desconocido"));
        }
      });
    } else {
      mostrarSync("No se pudo actualizar: mostrando la última lista guardada.", { texto: "Reintentar", accion: cargar });
    }
    return;
  }

  if (!res || !res.ok) {
    const error = String(res?.error || "");
    const hayQueIniciarSesion = /NECESITA_INICIO_SESION|TOKEN_INVALIDO|NO_SE_OBTUVO_TOKEN|access_denied|interaction_required/.test(error);
    errorEl.innerHTML = "";
    if (hayQueIniciarSesion) {
      // El enlace del Sheet ya está guardado: solo falta la sesión de Google.
      // Un toque abre directamente el selector de cuentas de Google.
      const btn = el("button", { className: "btn", type: "button", textContent: "Iniciar sesión con Google" });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const r = await enviarMensaje({ type: "LOGIN" });
        if (r?.ok) return cargar();
        btn.disabled = false;
        toast(mensajeError(r?.error || "error desconocido"));
      });
      errorEl.append(el("p", { textContent: "Inicia sesión con Google para ver tu lista." }), btn);
    } else {
      errorEl.append("No se pudo cargar la lista: " + mensajeError(error || "error desconocido"), el("br"),
        el("button", { className: "btn", textContent: "Reintentar", onclick: cargar }), " ",
        el("button", { className: "btn", textContent: "Cambiar de hoja", onclick: () => setHerramientas(true, "datos") }));
    }
    errorEl.hidden = false;
    return;
  }

  mostrarSync("");
  if (res.nube?.pendiente) esperarSyncNube(res.nube.id); else avisoNube(res.nube);
  sincronizarVinculoSilencioso();
  const igual = cache && JSON.stringify(cache.lista) === JSON.stringify(res.lista);
  todosLosAnimes = res.lista;
  sincronizarCatalogo();
  lanzarCompararPendiente();
  sincronizarPush();
  await inicializarContadorPortadas();
  if (!igual) {
    const scroll = listaEl.scrollTop;
    render();
    listaEl.scrollTop = scroll;
  }
  guardarListaCache();
}

inicializarToolbar();
(async () => {
  // El formulario de "Herramientas" necesita conocer la hoja actual antes de crearse
  configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || null;
  clientIdActual = (await enviarMensaje({ type: "GET_CLIENT_ID" }))?.clientId || "";
  $("configTools").append(crearFormConfig({ bienvenida: false }), crearBotonCuenta());
  cargarFuentes();
  cargar().then(procesarCompartido);
})();

// Salvaguarda: en algunas ventanas recién creadas Chrome no recalcula bien
// el layout hasta que hay un resize. Forzamos un reflow mínimo al cargar.
window.addEventListener("load", () => {
  requestAnimationFrame(() => {
    document.body.style.display = "none";
    void document.body.offsetHeight;
    document.body.style.display = "flex";
  });
});
