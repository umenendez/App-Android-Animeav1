const ESTADOS = [
  { value: "-", label: "Viendo" },
  { value: "✔", label: "Visto" },
  { value: "✖", label: "Sin ver" },
  { value: "📉", label: "Dropeado" },
  { value: "@", label: "Por ver" },
];

// Se preservan tal cual las opciones del Sheet, incluyendo mayúsculas/acentos
const GENEROS = [
  "ISEKAI", "SHOUNEN", "EL RESTO", "ROMANCE", "(._.)", "PELICULA",
  "NOVELA", "MANGA / MANWHA", "SLICE OF LIFE", "FANTASÍA", "MONOGATARI",
];

const $ = (id) => document.getElementById(id);
const cargandoEl = $("cargando");
const errorEl = $("error");
const vacioEl = $("vacio");
const bienvenidaEl = $("bienvenida");
const filtrosEl = document.querySelector(".filtros");
const listaEl = $("lista");
const contadorEl = $("contador");
const contadorPortadasEl = $("contadorPortadas");
const chipsEl = $("chips");
const busquedaEl = $("busqueda");
const filtroGeneroEl = $("filtroGenero");
const ordenEl = $("orden");
const precargarBtn = $("precargarPortadas");
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

function enviarMensaje(msg) {
  if (typeof window.enviarMensajePWA === "function") return window.enviarMensajePWA(msg);
  return Promise.resolve({ ok: false, error: "SIN_RESPUESTA" });
}

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  hijos.forEach((h) => h && n.append(h));
  return n;
}

const normalizar = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

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

const MODOS_TEMA = ["auto", "light", "dark"];
const NOMBRE_TEMA = { auto: "automático", light: "claro", dark: "oscuro" };
const btnTema = $("btnTema");

function aplicarTema(modo) {
  document.documentElement.dataset.tema = modo;
  btnTema.dataset.modo = modo;
  btnTema.title = `Tema: ${NOMBRE_TEMA[modo]}`;
}
aplicarTema(document.documentElement.dataset.tema || "auto");
btnTema.addEventListener("click", () => {
  const actual = document.documentElement.dataset.tema;
  const siguiente = MODOS_TEMA[(MODOS_TEMA.indexOf(actual) + 1) % MODOS_TEMA.length];
  try { localStorage.setItem("tema", siguiente); } catch (e) {}
  aplicarTema(siguiente);
  toast(`Tema: ${NOMBRE_TEMA[siguiente]}`);
});

// --- Preferencias de filtros (se recuerdan entre aperturas) -------------------

function guardarFiltros() {
  try {
    localStorage.setItem("filtros", JSON.stringify({ estado: filtroEstado, genero: filtroGeneroEl.value, orden: ordenEl.value }));
  } catch (e) {}
}
function cargarFiltros() {
  try {
    const f = JSON.parse(localStorage.getItem("filtros") || "null");
    if (f) {
      filtroEstado = f.estado ?? "-";
      filtroGeneroEl.value = f.genero || "";
      ordenEl.value = f.orden || "";
    }
  } catch (e) {}
}

// --- Caché local de portadas -------------------------------------------------
// La primera vez se descarga y se guarda en la Cache Storage de la extensión
// (compartida con background.js). Las siguientes veces se lee de ahí, sin red.

const COVER_CACHE = "anime-covers-v1";
const portadasEnCache = new Set();
const blobUrls = new Map(); // url -> objectURL, para no crear duplicados

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
async function cargarPortada(url, soloCache = false) {
  if (!url) return url;
  // Las URLs de las portadas suelen ser de otro dominio (CDN). En una PWA,
  // fetch() normal puede bloquearse por CORS aunque <img> sí pueda mostrarla.
  // Por eso dejamos que el Service Worker intercepte la petición y usamos
  // Cache Storage como almacenamiento persistente.
  try {
    const cache = await caches.open(COVER_CACHE);
    const guardada = await cache.match(url);
    if (guardada) {
      portadasEnCache.add(url);
      actualizarContadorPortadas();
      return url;
    }

    // mode:no-cors permite guardar respuestas de imágenes externas como
    // respuestas opacas. No intentamos convertirlas a Blob; el <img> seguirá
    // usando la URL original y el Service Worker servirá la copia cacheada.
    // Con timeout: si una portada concreta no responde (mala señal, CDN
    // atascado…) no se queda colgada bloqueando a las demás.
    const controlador = new AbortController();
    const timeoutId = setTimeout(() => controlador.abort(), 10000);
    let res;
    try {
      res = await fetch(url, { mode: "no-cors", credentials: "omit", signal: controlador.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res || (!res.ok && res.type !== "opaque")) {
      throw new Error(`No se pudo descargar la portada (${res?.status ?? "sin respuesta"})`);
    }
    await cache.put(url, res.clone());
    portadasEnCache.add(url);
    actualizarContadorPortadas();
    return url;
  } catch (e) {
    console.error("[AnimeAV1 Tracker] No se pudo cachear la portada:", url, e);
    return url;
  }
}

// Las portadas solo se cargan cuando están cerca de la zona visible
const observador = new IntersectionObserver(
  (entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      const img = e.target;
      observador.unobserve(img);
      cargarPortada(img.dataset.src).then((src) => { img.src = src; });
    });
  },
  { root: listaEl, rootMargin: "300px" }
);

// --- Filtros -----------------------------------------------------------------

function llenarSelect(select, primera, opciones) {
  select.innerHTML = "";
  select.append(el("option", { value: "", textContent: primera }));
  opciones.forEach(({ value, label }) => select.append(el("option", { value, textContent: label })));
}

function inicializarToolbar() {
  llenarSelect(filtroGeneroEl, "Todos los géneros", GENEROS.map((g) => ({ value: g, label: g })));
  llenarSelect(ordenEl, "Sin ordenar", [
    { value: "score-desc", label: "Nota: mayor a menor" },
    { value: "score-asc", label: "Nota: menor a mayor" },
  ]);
  cargarFiltros();
  [filtroGeneroEl, ordenEl].forEach((s) => s.addEventListener("change", () => { guardarFiltros(); render(); }));
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

function render() {
  const genero = filtroGeneroEl.value;
  const orden = ordenEl.value;
  const q = normalizar(busquedaEl.value.trim());

  let lista = todosLosAnimes.filter((a) => {
    if (filtroEstado && a.status !== filtroEstado) return false;
    if (genero && a.genre !== genero) return false;
    if (q && !normalizar(a.title).includes(q)) return false;
    return true;
  });

  if (orden) {
    const nota = (a) => parseFloat(String(a.score).replace(",", ".")) || 0;
    lista = lista.slice().sort((a, b) => (orden === "score-desc" ? nota(b) - nota(a) : nota(a) - nota(b)));
  }

  renderChips();
  observador.disconnect();
  contadorEl.textContent = lista.length;
  listaEl.innerHTML = "";

  vacioEl.hidden = lista.length > 0;
  if (lista.length === 0) {
    vacioEl.innerHTML = "";
    if (todosLosAnimes.length === 0) {
      vacioEl.textContent = "Todavía no hay animes. Abre un episodio en animeav1.com y aparecerá aquí.";
    } else {
      vacioEl.append("Ningún anime coincide con estos filtros.", el("br"), el("button", {
        className: "btn", textContent: "Quitar filtros",
        onclick: () => { filtroEstado = ""; filtroGeneroEl.value = ""; ordenEl.value = ""; busquedaEl.value = ""; guardarFiltros(); render(); },
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
  else toast("No se pudo guardar el cambio");
  return !!res?.ok;
}

// Color de la nota: rojo (0) -> verde (10). Un 11 (fuera de escala) se marca en amarillo.
function aplicarColorNota(input) {
  const n = parseFloat(String(input.value).replace(",", "."));
  if (isNaN(n)) { input.style.backgroundColor = input.style.color = ""; return; }
  if (n > 10) { input.style.backgroundColor = "#facc15"; input.style.color = "#78350f"; return; }
  input.style.backgroundColor = `hsl(${(Math.max(0, n) / 10) * 120}, 72%, 38%)`;
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
    img = el("img", { className: "cover", alt: "", draggable: false });
    img.dataset.src = anime.cover;
    img.addEventListener("load", () => img.classList.add("lista"));
    portada.append(img);
    observador.observe(img);
  } else {
    portada.append(el("div", { className: "sin-portada", textContent: "Sin portada" }));
  }

  const inputScore = el("input", { className: "nota", type: "number", step: "0.1", min: "0", max: "11", value: anime.score || "", placeholder: "–", title: "Nota", ariaLabel: "Nota" });
  aplicarColorNota(inputScore);
  inputScore.addEventListener("input", () => aplicarColorNota(inputScore));
  inputScore.addEventListener("change", () => {
    anime.score = inputScore.value;
    aplicarColorNota(inputScore);
    guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "score", valor: inputScore.value }, inputScore);
  });

  const btnUltimoCap = el("a", { className: "btn-ultimo-cap", target: "_blank", title: "Ir al último capítulo visto", ariaLabel: "Último capítulo visto", textContent: "▶" });
  function actualizarBotonUltimoCap() {
    const visible = anime.status === "📉" && anime.lastEpisodeUrl;
    if (visible) btnUltimoCap.href = anime.lastEpisodeUrl; else btnUltimoCap.removeAttribute("href");
    btnUltimoCap.style.display = visible ? "flex" : "none";
  }
  actualizarBotonUltimoCap();
  portada.append(inputScore, btnUltimoCap);

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

  const selectGenero = crearSelect(GENEROS, anime.genre, true, "Sin género");
  selectGenero.className = "genero";
  selectGenero.title = selectGenero.ariaLabel = "Género";
  selectGenero.addEventListener("change", async () => {
    anime.genre = selectGenero.value;
    if (await guardar({ type: "UPDATE_ANIME", row: anime.row, campo: "genre", valor: selectGenero.value }, selectGenero)) render();
  });

  info.append(link, selectEstado, selectGenero);

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
  }

  card.append(portada, info);
  return card;
}

// --- Cabecera: modo edición y herramientas -------------------------------------

$("btnEdicion").addEventListener("click", (e) => {
  modoEdicion = !modoEdicion;
  e.currentTarget.setAttribute("aria-pressed", String(modoEdicion));
  toast(modoEdicion ? "Modo edición activado" : "Modo edición desactivado");
  render();
});

function setHerramientas(abierto) {
  $("herramientas").hidden = !abierto;
  $("btnHerramientas").setAttribute("aria-expanded", String(abierto));
}
$("btnHerramientas").addEventListener("click", () => setHerramientas($("herramientas").hidden));

// --- Añadir anime por enlace ---------------------------------------------------

function setAgregarPanel(abierto) {
  agregarPanelEl.hidden = !abierto;
  $("btnAgregar").setAttribute("aria-expanded", String(abierto));
  if (abierto) {
    agregarStatusEl.textContent = "";
    agregarUrlEl.value = "";
    setTimeout(() => agregarUrlEl.focus(), 0);
  }
}
$("btnAgregar").addEventListener("click", () => setAgregarPanel(agregarPanelEl.hidden));

async function agregarAnime() {
  const url = agregarUrlEl.value.trim();
  if (!url) { agregarStatusEl.textContent = "Pega primero el enlace."; return; }
  agregarBtnEl.disabled = true;
  agregarStatusEl.textContent = "Buscando título y portada…";
  const res = await enviarMensaje({ type: "REGISTER_ANIME", url });
  agregarBtnEl.disabled = false;
  if (!res || !res.ok) { agregarStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  agregarStatusEl.textContent = `Añadido: ${res.title}`;
  agregarUrlEl.value = "";
  toast("Anime añadido");
  cargar();
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
    cargarListasPanel();
  }
}
$("btnListas").addEventListener("click", () => setListasPanel(listasPanelEl.hidden));

async function cambiarAListaGuardada(l, usarBtn) {
  usarBtn.disabled = true;
  const r = await enviarMensaje({ type: "SWITCH_LISTA", id: l.id });
  if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); usarBtn.disabled = false; return; }
  toast(`Viendo: ${r.name}`);
  setListasPanel(false);
  todosLosAnimes = [];
  await cargar();
  // Refresca también el formulario de "Herramientas" para que muestre la hoja activa
  $("configTools").innerHTML = "";
  $("configTools").append(crearFormConfig({ bienvenida: false }));
}

async function borrarListaGuardada(l) {
  if (!confirm(`¿Quitar «${l.name}» de tus listas guardadas? (no borra la hoja de Google, solo el acceso rápido)`)) return;
  const r = await enviarMensaje({ type: "DELETE_LISTA", id: l.id });
  if (!r?.ok) { toast(mensajeError(r?.error || "error desconocido")); return; }
  cargarListasPanel();
}

async function cargarListasPanel() {
  listasContenidoEl.innerHTML = "";
  const res = await enviarMensaje({ type: "GET_LISTAS" });
  const listas = res?.listas || [];
  if (listas.length === 0) {
    listasContenidoEl.append(el("p", { className: "vacio-listas", textContent: "Todavía no has guardado ninguna lista." }));
    return;
  }
  listas.forEach((l) => {
    const usarBtn = el("button", { className: "btn-mini", type: "button", textContent: l.activa ? "En uso" : "Usar", disabled: l.activa });
    usarBtn.addEventListener("click", () => cambiarAListaGuardada(l, usarBtn));
    const borrarBtn = el("button", { className: "btn-mini peligro", type: "button", textContent: "Quitar" });
    borrarBtn.addEventListener("click", () => borrarListaGuardada(l));
    listasContenidoEl.append(el("div", { className: "lista-item" },
      el("span", { className: "nombre", textContent: l.name }),
      l.activa ? el("span", { className: "etiqueta-activa", textContent: "Activa" }) : null,
      usarBtn, borrarBtn));
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

// --- Configuración: qué Google Sheet se usa -----------------------------------

let configActual = null; // { url, titulo, hoja } o null si aún no se ha elegido hoja
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
  if (c.includes("ENLACE_ANIME_INVALIDO")) return "Pega un enlace completo (con http:// o https://) a la ficha del anime.";
  if (c.includes("NO_SE_PUDO_LEER_LA_PAGINA")) return "No se pudo abrir esa página. Comprueba el enlace o tu conexión.";
  if (c.includes("SIN_TITULO")) return "No se encontró el título en esa página. ¿Es el enlace correcto?";
  if (c.includes("YA_EXISTE")) return "Ese anime ya está en tu lista.";
  if (c.includes("FALTA_NOMBRE")) return "Ponle un nombre a la lista.";
  if (c.includes("LISTA_NO_ENCONTRADA")) return "Esa lista ya no existe.";
  return c.replace(/^Error:\s*/, "");
}

async function cambiarCuentaGoogleDesdeUI(estado, btn) {
  if (btn) btn.disabled = true;
  if (estado) estado.textContent = "Selecciona la cuenta de Google que quieres usar…";
  const res = await enviarMensaje({ type: "SWITCH_GOOGLE_ACCOUNT" });
  if (btn) btn.disabled = false;
  if (!res?.ok) {
    if (estado) estado.textContent = mensajeError(res?.error || "No se pudo cambiar de cuenta");
    return false;
  }
  if (estado) estado.textContent = `Cuenta activa: ${res.account?.email || res.account?.name || "Google"}`;
  configActual = null;
  try {
    const cfg = await enviarMensaje({ type: "GET_CONFIG" });
    configActual = cfg?.config || null;
  } catch (e) {}
  return true;
}

async function obtenerCuentaGoogleUI() {
  const res = await enviarMensaje({ type: "GET_GOOGLE_ACCOUNT" });
  return res?.account || null;
}

function crearFormConfig({ bienvenida }) {
  const input = el("input", { type: "url", placeholder: "https://docs.google.com/spreadsheets/d/…", value: configActual?.url || "", ariaLabel: "Enlace de tu Google Sheet" });
  const clientIdInput = el("input", { type: "text", placeholder: "Client ID de OAuth (…apps.googleusercontent.com)", value: clientIdActual || "", ariaLabel: "Client ID de OAuth de Google" });
  const cuentaEstado = el("div", { className: "estado-txt" });
  const cambiarCuentaBtn = el("button", { className: "btn", type: "button", textContent: "Cambiar cuenta de Google" });
  const estado = el("div", { className: "estado-txt" });
  const btn = el("button", { className: "btn", type: "button", textContent: bienvenida ? "Conectar y empezar" : "Guardar hoja" });
  obtenerCuentaGoogleUI().then((cuenta) => {
    cuentaEstado.textContent = cuenta?.email ? `Cuenta de Google activa: ${cuenta.email}` : "No hay una cuenta de Google activa.";
  });
  cambiarCuentaBtn.addEventListener("click", async () => {
    const ok = await cambiarCuentaGoogleDesdeUI(cuentaEstado, cambiarCuentaBtn);
    if (ok) {
      configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || null;
      input.value = configActual?.url || "";
      estado.textContent = configActual ? `Conectada: ${configActual.titulo} (pestaña «${configActual.hoja}»)` : "Cuenta cambiada. Conecta ahora su Google Sheet.";
      if (!bienvenida) setHerramientas(true);
    }
  });
  if (configActual?.titulo) estado.textContent = `Conectada: ${configActual.titulo} (pestaña «${configActual.hoja}»)`;

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
    cuentaEstado, cambiarCuentaBtn, clientIdInput, input, btn, estado);
}

// --- Herramientas ------------------------------------------------------------

// Precarga TODAS las portadas desde el propio popup (no depende del service
// worker, que Chrome puede matar a mitad). Hay que dejar el popup abierto.
precargarBtn.addEventListener("click", async () => {
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

async function cargar() {
  cargandoEl.hidden = false;
  errorEl.hidden = true;
  vacioEl.hidden = true;
  bienvenidaEl.hidden = true;
  listaEl.innerHTML = "";

  configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || null;
  filtrosEl.hidden = !configActual;
  if (!configActual) {
    // Primera vez: hay que elegir la hoja antes de nada
    cargandoEl.hidden = true;
    contadorEl.textContent = "";
    bienvenidaEl.innerHTML = "";
    bienvenidaEl.append(crearFormConfig({ bienvenida: true }));
    bienvenidaEl.hidden = false;
    return;
  }

  const res = await enviarMensaje({ type: "GET_ANIME_LIST" });
  cargandoEl.hidden = true;

  if (!res || !res.ok) {
    errorEl.innerHTML = "";
    errorEl.append("No se pudo cargar la lista: " + mensajeError(res?.error || "error desconocido"), el("br"),
      el("button", { className: "btn", textContent: "Reintentar", onclick: cargar }), " ",
      el("button", { className: "btn", textContent: "Cambiar de hoja", onclick: () => setHerramientas(true) }));
    errorEl.hidden = false;
    return;
  }

  todosLosAnimes = res.lista;
  await inicializarContadorPortadas();
  render();
}

inicializarToolbar();
(async () => {
  // El formulario de "Herramientas" necesita conocer la hoja actual antes de crearse
  configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || null;
  clientIdActual = (await enviarMensaje({ type: "GET_CLIENT_ID" }))?.clientId || "";
  $("configTools").append(crearFormConfig({ bienvenida: false }));
  cargar();
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
