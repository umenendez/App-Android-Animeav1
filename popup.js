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
let catalogo = GENEROS_BASE.slice();
try {
  const c = JSON.parse(localStorage.getItem("generos") || "null");
  if (Array.isArray(c) && c.length) catalogo = unico(c);
} catch (e) {}
function guardarCatalogo() { try { localStorage.setItem("generos", JSON.stringify(catalogo)); } catch (e) {} }
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
    localStorage.setItem("filtros", JSON.stringify({ estado: filtroEstado, generos: [...filtroGeneros], orden: ordenEl.value }));
  } catch (e) {}
}
function cargarFiltros() {
  try {
    const f = JSON.parse(localStorage.getItem("filtros") || "null");
    if (f) {
      filtroEstado = f.estado ?? "-";
      filtroGeneros = new Set(Array.isArray(f.generos) ? f.generos : (f.genero ? [f.genero] : []));
      ordenEl.value = f.orden || "";
    }
  } catch (e) {}
}

// --- Caché local de portadas -------------------------------------------------
// La primera vez se descarga y se guarda en la Cache Storage de la extensión
// (compartida con background.js). Las siguientes veces se lee de ahí, sin red.

const COVER_CACHE = "anime-covers-v1";
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
let portadaSlots = 6;
const portadaCola = [];
function portadaSlot() {
  return new Promise((res) => { if (portadaSlots > 0) { portadaSlots--; res(); } else portadaCola.push(res); });
}
function portadaLiberar() { const n = portadaCola.shift(); if (n) n(); else portadaSlots++; }

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
  const cache = await caches.open(COVER_CACHE);
  if (!(await cache.match(url))) {
    await portadaSlot();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12000);
      let res;
      try { res = await fetch(url, { mode: "no-cors", credentials: "omit", signal: ctl.signal }); } finally { clearTimeout(t); }
      if (!res || (!res.ok && res.type !== "opaque")) throw new Error(`HTTP ${res?.status ?? "?"}`);
      await cache.put(url, res.clone());
    } finally { portadaLiberar(); }
  }
  portadasEnCache.add(url);
  actualizarContadorPortadas();
}

function obtenerPortada(url) {
  if (!url) return Promise.resolve("");
  if (portadaMem.has(url)) return Promise.resolve(url);
  if (portadaPend.has(url)) return portadaPend.get(url);
  const p = (async () => {
    try {
      if (guardarPortadasActivado()) await guardarEnCache(url);
    } catch (e) {
      console.error("[AnimeAV1 Tracker] No se pudo guardar la portada:", url, e);
    }
    await predecodificar(url);
    portadaMem.add(url);
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
  const img = el("img", { alt: anime?.title || "", draggable: false });
  const caja = el("div", { className: clase }, img);
  const url = anime?.cover;
  if (!url) { caja.classList.add("sin"); img.hidden = true; return caja; }
  caja.classList.add("cargando");
  const asignar = (src) => {
    img.onload = () => { caja.classList.remove("cargando"); img.classList.add("cargada"); };
    img.onerror = () => { caja.classList.remove("cargando"); caja.classList.add("sin"); img.hidden = true; };
    img.src = src || url;
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
  // no se pinta, para no sugerir que existe una nota cero.
  const distrib = Array.from({ length: 11 }, () => 0);
  notas.forEach((n) => distrib[Math.round(n)]++);
  const secNotas = el("div", { className: "stats-seccion" }, el("h3", { textContent: "Distribución de notas" }));
  const notasGrid = el("div", { className: "stats-notas" });
  distrib.forEach((c, i) => { if (i === 0) return; notasGrid.append(el("div", { className: "stats-nota" }, el("b", { textContent: String(i) }), el("span", { textContent: c }))); });
  secNotas.append(notasGrid);

  dlgStatsEl.append(cab, resumen, estados, secGeneros, secNotas);
}

if (btnStats) btnStats.addEventListener("click", () => { renderEstadisticas(); dlgStatsEl.showModal(); });

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
  const cuenta = (g) => base.filter((a) =>
    g === SIN ? parseGeneros(a.genre).length === 0 : parseGeneros(a.genre).includes(g)
  ).length;

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

function render() {
  const orden = ordenEl.value;
  const q = normalizar(busquedaEl.value.trim());

  let lista = todosLosAnimes.filter((a) => {
    if (filtroEstado && a.status !== filtroEstado) return false;
    if (!pasaGeneros(a, filtroGeneros)) return false;
    if (q && !normalizar(a.title).includes(q)) return false;
    return true;
  });

  if (orden) {
    const nota = (a) => parseFloat(String(a.score).replace(",", ".")) || 0;
    lista = lista.slice().sort((a, b) => (orden === "score-desc" ? nota(b) - nota(a) : nota(a) - nota(b)));
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
    } else {
      vacioEl.append("Ningún anime coincide con estos filtros.", el("br"), el("button", {
        className: "btn", textContent: "Quitar filtros",
        onclick: () => { filtroEstado = ""; filtroGeneros.clear(); ordenEl.value = ""; busquedaEl.value = ""; guardarFiltros(); render(); },
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
    img = el("img", { className: "cover", alt: "", draggable: false });
    img.dataset.src = anime.cover;
    img.addEventListener("load", () => img.classList.add("lista"));
    portada.append(img);
    if (portadaMem.has(anime.cover)) img.src = anime.cover; else observador.observe(img);
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

  const gsAnime = parseGeneros(anime.genre);
  const selectGenero = el("button", { className: "genero", type: "button", textContent: gsAnime.join(" · ") || "Sin género", title: gsAnime.join(", ") || "Añadir géneros" });
  selectGenero.ariaLabel = "Géneros";
  selectGenero.addEventListener("click", () => abrirDialogoGeneros(anime));

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
function notaRedondeada(n) { return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10; }
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
  const desde = Math.max(1, vecinaInf + 1);
  const hasta = Math.min(100, vecinaSup - 1);
  const ancho = hasta - desde + 1;
  const asignacion = [];

  if (ancho < 1) {
    for (let i = 0; i < nEscalones; i++) asignacion.push(base);
    return { asignacion, comprimido: nEscalones > 1, desde: base, hasta: base, ancho: 1 };
  }
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

  if (!aCambiar.length) {
    const motivo = escalones.length === 1
      ? "Has indicado que todas te gustan lo mismo, así que conservan la misma nota."
      : `Entre las notas vecinas no queda ninguna décima libre, así que no se puede separar sin tocar otras series.`;
    acciones.append(...[corregir, cerrar].filter(Boolean));
    dlgPosicionarEl.append(
      el("div", { className: "pos-resultado" }, el("div", { className: "pos-check", textContent: "=" }), el("h2", { textContent: "Sin cambios de nota" }), el("p", { textContent: motivo })),
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
    ? el("p", { className: "pos-cambios-resumen", textContent: `Entre las notas vecinas solo caben ${reparto.ancho} décimas (${(reparto.desde / 10).toFixed(1)}–${(reparto.hasta / 10).toFixed(1)}) para ${escalones.length} posiciones, así que algunas series seguirán con la misma nota.` })
    : (escalones.length < s.items.length
      ? el("p", { className: "pos-cambios-resumen", textContent: "Las series que marcaste como iguales comparten nota." })
      : null);

  dlgPosicionarEl.append(
    el("div", { className: "pos-resultado" }, el("div", { className: "pos-check", textContent: "✓" }), el("h2", { textContent: "Empate ordenado" }), el("p", { textContent: `${s.comparaciones} ${s.comparaciones === 1 ? "comparación" : "comparaciones"}. Las notas siguen usando una sola decimal y no cruzan a otras series.` })),
    el("div", { className: "pos-cambios-panel" }, el("h3", { textContent: `Nuevo orden de ${s.score.toFixed(1)}` }), aviso, el("div", { className: "pos-cambios-lista" }, ...filas)),
    acciones
  );
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
const btnPosicionarEl = $("btnPosicionar");
if (btnPosicionarEl) btnPosicionarEl.addEventListener("click", abrirPosicionador);


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
      nuevaFila: res.pregunta.nuevaFila
    });
  }

  agregarBtnEl.disabled = false;
  if (!res || !res.ok) { agregarStatusEl.textContent = mensajeError(res?.error || "error desconocido"); return; }
  agregarStatusEl.textContent = res.vinculada ? `Marcada como viendo: ${res.title}` : `Añadido: ${res.title}`;
  agregarUrlEl.value = "";
  toast(res.vinculada ? "Serie actualizada" : "Anime añadido");
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
  $("configTools").append(crearFormConfig({ bienvenida: false }), crearBotonCuenta());
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
  if (c.includes("NECESITA_INICIO_SESION")) return "Toca el botón para iniciar sesión con Google.";
  if (c.includes("access_denied")) return "Has cancelado el inicio de sesión de Google.";
  if (c.includes("ENLACE_ANIME_INVALIDO")) return "Pega un enlace de AnimeAV1 a la ficha de la serie o a uno de sus episodios (animeav1.com/media/…).";
  if (c.includes("NO_SE_PUDO_LEER_LA_PAGINA")) return "No se pudo abrir esa página. Comprueba el enlace o tu conexión.";
  if (c.includes("SIN_TITULO")) return "No se encontró el título en esa página. ¿Es el enlace correcto?";
  if (c.includes("FILA_NO_ENCONTRADA")) return "No se encontró la serie registrada. Puede que se haya movido o borrado en la hoja.";
  if (c.includes("YA_EXISTE")) return "Ese anime ya está en tu lista.";
  if (c.includes("FALTA_NOMBRE")) return "Ponle un nombre a la lista.";
  if (c.includes("LISTA_NO_ENCONTRADA")) return "Esa lista ya no existe.";
  return c.replace(/^Error:\s*/, "");
}

function crearFormConfig({ bienvenida }) {
  const input = el("input", { type: "url", placeholder: "https://docs.google.com/spreadsheets/d/…", value: configActual?.url || "", ariaLabel: "Enlace de tu Google Sheet" });
  const clientIdInput = el("input", { type: "text", placeholder: "Client ID de OAuth (…apps.googleusercontent.com)", value: clientIdActual || "", ariaLabel: "Client ID de OAuth de Google" });
  const estado = el("div", { className: "estado-txt" });
  const btn = el("button", { className: "btn", type: "button", textContent: bienvenida ? "Conectar y empezar" : "Guardar hoja" });
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
    clientIdInput, input, btn, estado);
}

function crearBotonCuenta() {
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

async function cargar() {
  errorEl.hidden = true;
  vacioEl.hidden = true;
  bienvenidaEl.hidden = true;
  mostrarSync("");

  configActual = (await enviarMensaje({ type: "GET_CONFIG" }))?.config || null;
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

  const res = await enviarMensaje({ type: "GET_ANIME_LIST" });
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
        el("button", { className: "btn", textContent: "Cambiar de hoja", onclick: () => setHerramientas(true) }));
    }
    errorEl.hidden = false;
    return;
  }

  mostrarSync("");
  const igual = cache && JSON.stringify(cache.lista) === JSON.stringify(res.lista);
  todosLosAnimes = res.lista;
  sincronizarCatalogo();
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
