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
const contadorEl = $("contador");
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

async function cargarPortada(url, soloCache = false) {
  if (!url) return url;

  // La URL original siempre sigue siendo la fuente de la imagen. La caché
  // solo añade una copia local; nunca debe impedir que <img> cargue la portada.
  if (!guardarPortadasActivado()) return url;

  try {
    const cache = await caches.open(COVER_CACHE);
    let respuesta = await cache.match(url);

    if (!respuesta) {
      const controlador = new AbortController();
      const timeoutId = setTimeout(() => controlador.abort(), 10000);
      try {
        respuesta = await fetch(url, {
          mode: "no-cors",
          credentials: "omit",
          signal: controlador.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!respuesta || (!respuesta.ok && respuesta.type !== "opaque")) {
        throw new Error(`No se pudo descargar la portada (${respuesta?.status ?? "sin respuesta"})`);
      }

      await cache.put(url, respuesta.clone());
    }

    portadasEnCache.add(url);
    actualizarContadorPortadas();

    // No convertimos respuestas opaque del CDN a Blob. El navegador puede
    // mostrar directamente la URL y el Service Worker servirá la copia
    // almacenada cuando exista.
    return url;
  } catch (e) {
    console.error("[AnimeAV1 Tracker] No se pudo guardar la portada:", url, e);
    // Aunque falle la caché, la portada debe seguir funcionando desde Internet.
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


// --- Estadísticas ------------------------------------------------------------
const dlgStatsEl = document.getElementById("dlgStats");
const btnStats = document.getElementById("btnStats");

function numeroNota(a) {
  const n = parseFloat(String(a?.score ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.min(10, n) : null;
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

  const distrib = Array.from({ length: 11 }, () => 0);
  notas.forEach((n) => distrib[Math.round(n)]++);
  const secNotas = el("div", { className: "stats-seccion" }, el("h3", { textContent: "Distribución de notas" }));
  const notasGrid = el("div", { className: "stats-notas" });
  distrib.forEach((c, i) => notasGrid.append(el("div", { className: "stats-nota" }, el("b", { textContent: String(i) }), el("span", { textContent: c }))));
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

  const inputScore = el("input", { className: "nota", type: "number", inputMode: "decimal", step: "0.1", min: "0", max: "10", value: anime.score ?? "", placeholder: "–", title: "Nota (0-10)", ariaLabel: "Nota (0-10)" });
  aplicarColorNota(inputScore);
  inputScore.addEventListener("input", () => aplicarColorNota(inputScore));
  inputScore.addEventListener("change", () => {
    let valor = String(inputScore.value || "").replace(",", ".").trim();
    if (valor !== "") {
      const n = parseFloat(valor);
      if (!Number.isFinite(n)) return;
      valor = String(Math.min(10, Math.max(0, n)));
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
function posicionPortada(anime, img) {
  if (!anime?.cover) { img.hidden = true; return; }
  img.hidden = false;
  img.alt = anime.title || "";
  img.src = anime.cover;
  cargarPortada(anime.cover).then(src => { if (img.isConnected) img.src = src; });
}
function posicionTitulo(a) { return a?.title || "(sin título)"; }

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
  dlgPosicionarEl.innerHTML = "";
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
    lista.innerHTML = "";
    const arr = obtenerLista();
    mensaje.hidden = arr.length > 0;
    if (!arr.length) { mensaje.textContent = "No hay series que coincidan con estos filtros."; return; }
    arr.forEach(a => {
      const card = el("button", { className: "pos-selector-card", type: "button", title: `Posicionar ${posicionTitulo(a)}` });
      const portada = el("div", { className: "pos-selector-portada" });
      if (a.cover) { const img = el("img", { alt: "", loading: "lazy" }); img.src = a.cover; img.addEventListener("error", () => { img.remove(); portada.append(el("div", { className: "sin-portada", textContent: "Sin portada" })); }); portada.append(img); }
      else portada.append(el("div", { className: "sin-portada", textContent: "Sin portada" }));
      const info = el("div", { className: "pos-selector-info" });
      info.append(el("strong", { textContent: posicionTitulo(a) }));
      const n = notaNumero(a); info.append(el("span", { className: "pos-selector-nota", textContent: n == null ? "Sin valorar" : `⭐ ${n.toFixed(1)}` }));
      const gs = parseGeneros(a.genre); if (gs.length) info.append(el("small", { textContent: gs.slice(0,2).join(" · ") }));
      card.append(portada, info); card.addEventListener("click", () => iniciarPosicionamiento(Number(a.row))); lista.append(card);
    });
  }
  buscador.addEventListener("input", () => { posicionFiltros.q = buscador.value; pintarLista(); });
  estado.addEventListener("change", () => { posicionFiltros.estado = estado.value; pintarLista(); });
  genero.addEventListener("change", () => { posicionFiltros.genero = genero.value; pintarLista(); });
  orden.addEventListener("change", () => { posicionFiltros.orden = orden.value; pintarLista(); });
  pintarLista();
  const cerrar = el("button", { className: "btn-mini", type: "button", textContent: "Cerrar" });
  cerrar.addEventListener("click", () => dlgPosicionarEl.close());
  dlgPosicionarEl.append(
    el("div", { className: "pos-head" }, el("div", { className: "pos-mark", textContent: "⚖" }), el("div", {}, el("h2", { textContent: "Posicionar serie" }), el("p", { textContent: "Elige una serie y compárala con otras para calcular su nota." })), el("button", { className: "btn-mini", type: "button", textContent: "Separar notas iguales", title: "Ordenar series que tienen la misma nota", onclick: abrirSeparadorEmpates })) ,
    el("div", { className: "pos-selector-toolbar" }, buscador, estado, genero, orden),
    lista, mensaje,
    el("div", { className: "pos-help" }, el("strong", { textContent: `${sinNota.length} sin valorar` }), " · Pulsa una tarjeta para comenzar. También puedes recolocar una serie ya valorada."),
    el("div", { className: "pos-actions" }, cerrar)
  );
}

function iniciarPosicionamiento(row) {
  const candidate = posicionState.validas.find(a => Number(a.row) === Number(row));
  if (!candidate) return;

  const rated = posicionState.validas.filter(a => a !== candidate && notaNumero(a) != null);
  const original = notaNumero(candidate);
  const working = new Map(posicionState.validas.map(a => [a.row, notaNumero(a)]));
  const inicial = original ?? (rated.length ? mediana(rated.map(notaNumero)) : 5);
  working.set(candidate.row, inicial);

  posicionState = {
    ...posicionState,
    candidate,
    rated,
    working,
    grupos: crearGrupos(rated, working),
    lo: 0,
    hi: Math.max(-1, crearGrupos(rated, working).length - 1),
    igualGrupo: null,
    comparadorGrupo: null,
    comparaciones: 0,
    saltados: [],
    historial: [],
    inicial,
    cambiosReferencias: new Set(),
    finalizadoPorComparaciones: false
  };

  // Sin referencias no hay nada que comparar: la nota neutra es 5.0.
  if (!rated.length) {
    sFinalizarPosicionamientoSinComparar();
    return;
  }
  mostrarComparacion();
}

function crearGrupos(items, working) {
  const mapa = new Map();
  items.forEach(a => {
    const n = working.get(a.row);
    if (n == null) return;
    const key = notaRedondeada(n).toFixed(1);
    if (!mapa.has(key)) mapa.set(key, { key, score: notaRedondeada(n), items: [] });
    mapa.get(key).items.push(a);
  });
  return Array.from(mapa.values()).sort((a,b) => b.score - a.score);
}

function grupoTieneDisponible(s, grupo) {
  return grupo && grupo.items.some(a => !s.saltados.includes(a.row));
}

function elegirComparador() {
  const s = posicionState;
  if (!s || s.igualGrupo != null || s.lo > s.hi) return null;
  if (!s.grupos.length) return null;

  // Búsqueda binaria: siempre intentamos el grupo central del intervalo.
  const centro = Math.floor((s.lo + s.hi) / 2);
  const candidatos = [];
  for (let distancia = 0; distancia < s.grupos.length; distancia++) {
    const izquierda = centro - distancia;
    const derecha = centro + distancia;
    if (izquierda >= s.lo && izquierda <= s.hi && grupoTieneDisponible(s, s.grupos[izquierda])) candidatos.push(s.grupos[izquierda]);
    if (distancia > 0 && derecha >= s.lo && derecha <= s.hi && grupoTieneDisponible(s, s.grupos[derecha])) candidatos.push(s.grupos[derecha]);
    if (candidatos.length) break;
  }
  const grupo = candidatos[0];
  if (!grupo) return null;
  s.comparadorGrupo = s.grupos.indexOf(grupo);
  return grupo.items.find(a => !s.saltados.includes(a.row)) || null;
}

function calcularPosicionFinal(s) {
  if (s.igualGrupo != null) return { tipo: "igual", indice: s.igualGrupo };
  return { tipo: "insertar", indice: Math.max(0, Math.min(s.grupos.length, s.lo)) };
}

function calcularNotaPosicion(s) {
  // La posición se decide exclusivamente por las comparaciones.
  // Las notas de las referencias son anclas: no debemos moverlas para
  // "fabricar" huecos en la escala, porque eso introduce cambios que el
  // usuario nunca pidió.
  if (s.igualGrupo != null) {
    return notaRedondeada(s.grupos[s.igualGrupo].score);
  }

  const indice = Math.max(0, Math.min(s.grupos.length, s.lo));
  const superior = indice > 0 ? s.grupos[indice - 1].score : null;
  const inferior = indice < s.grupos.length ? s.grupos[indice].score : null;

  // Extremos: si ya estamos en 10/0 no existe un valor decimal que pueda
  // expresar una posición estrictamente superior/inferior. Se satura.
  if (superior == null) return 10;
  if (inferior == null) return 0;

  const centro = (superior + inferior) / 2;
  const redondeado = notaRedondeada(centro);

  // Si el intervalo tiene al menos una décima disponible, el punto medio
  // redondeado es la mejor estimación. Si no la tiene, ninguna nota de una
  // sola decimal puede representar una posición estricta; en ese caso
  // elegimos el extremo más cercano a la nota previa (si existe) para evitar
  // movimientos artificiales.
  if (redondeado < superior && redondeado > inferior) return redondeado;

  const previa = notaNumero(s.candidate);
  if (previa != null) {
    if (previa < superior && previa > inferior) return notaRedondeada(previa);
    return Math.abs(previa - superior) <= Math.abs(previa - inferior)
      ? notaRedondeada(superior)
      : notaRedondeada(inferior);
  }

  return redondeado;
}

function construirResultadoFinal(s) {
  const pos = calcularPosicionFinal(s);
  const nueva = calcularNotaPosicion(s);

  s.working.set(s.candidate.row, nueva);
  s.gruposFinales = s.grupos.map(g => ({
    key: g.key,
    score: g.score,
    items: g.items.slice()
  }));
  s.posicionFinal = pos.indice;
  return nueva;
}

function posicionTerminada(s) {
  if (s.igualGrupo != null) return true;
  return s.lo > s.hi;
}

function mostrarComparacion() {
  const s = posicionState;
  const rival = elegirComparador();
  if (!rival) return finalizarPosicionamiento();
  s.rival = rival;
  const candidate = s.candidate;
  dlgPosicionarEl.innerHTML = "";
  const leftImg = el("img", { className: "pos-cover", alt: "" });
  const rightImg = el("img", { className: "pos-cover", alt: "" });
  posicionPortada(candidate, leftImg); posicionPortada(rival, rightImg);
  const scoreActual = s.working.get(candidate.row) ?? 5;
  const progreso = `${s.comparaciones} comparación${s.comparaciones === 1 ? "" : "es"}`;
  const botones = el("div", { className: "pos-votos" });
  [["más", "↑", "pos-mas"],["igual", "=", "pos-igual"],["menos", "↓", "pos-menos"]].forEach(([tipo, icono, clase]) => {
    const b = el("button", { className: `pos-voto ${clase}`, type: "button" }, el("span", { textContent: icono }), el("strong", { textContent: tipo === "más" ? "Me gusta más" : tipo === "menos" ? "Me gusta menos" : "Me gustan lo mismo" }));
    b.addEventListener("click", () => responderPosicionamiento(tipo)); botones.append(b);
  });
  const saltar = el("button", { className: "btn-mini", type: "button", textContent: "Saltar →", title: "No he visto esta serie" });
  saltar.addEventListener("click", () => { if (!s.saltados.includes(rival.row)) s.saltados.push(rival.row); mostrarComparacion(); });
  const cerrar = el("button", { className: "btn-mini", type: "button", textContent: "Cancelar" });
  cerrar.addEventListener("click", () => dlgPosicionarEl.close());
  dlgPosicionarEl.append(
    el("div", { className: "pos-topline" }, el("span", { textContent: "POSICIONAR" }), el("span", { textContent: progreso })),
    el("div", { className: "pos-estimacion" }, el("span", { textContent: "NOTA ESTIMADA" }), el("strong", { textContent: scoreActual.toFixed(1) }), el("small", { textContent: "La estimación se calcula desde la posición actual" })),
    el("div", { className: "pos-comparacion" },
      el("div", { className: "pos-serie" }, leftImg, el("strong", { textContent: posicionTitulo(candidate) }), el("small", { textContent: `Estimación: ${scoreActual.toFixed(1)}` })),
      el("div", { className: "pos-vs", textContent: "VS" }),
      el("div", { className: "pos-serie" }, rightImg, el("strong", { textContent: posicionTitulo(rival) }), el("small", { textContent: `Nota: ${(s.working.get(rival.row) ?? 0).toFixed(1)}` }))
    ),
    el("p", { className: "pos-question", textContent: "¿Cuál te gusta más?" }), botones,
    el("div", { className: "pos-foot" }, el("span", { textContent: "Si no has visto la serie de la derecha, puedes saltarla." }), el("div", { className: "pos-foot-actions" }, saltar, cerrar))
  );
}

async function responderPosicionamiento(tipo) {
  const s = posicionState; if (!s?.rival) return;
  const grupoIdx = s.comparadorGrupo;
  const b = s.rival;
  const oldB = s.working.get(b.row) ?? 5;
  s.historial.push({ rival: b.row, tipo, score: oldB });
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
  const s = posicionState;
  if (!s?.candidate) return;
  s.working.set(s.candidate.row, 5);
  finalizarPosicionamiento();
}

async function finalizarPosicionamiento() {
  const s = posicionState;
  if (!s?.candidate) return;

  construirResultadoFinal(s);

  const cambios = [];
  s.working.forEach((valor, row) => {
    const anime = s.validas.find(a => Number(a.row) === Number(row));
    if (!anime) return;
    const original = notaNumero(anime);
    const nueva = notaRedondeada(valor);
    if (anime === s.candidate || (original != null && Math.abs(nueva - original) >= 0.05)) {
      cambios.push({ anime, original, nueva });
    }
  });

  const referencias = cambios.filter(c => c.anime !== s.candidate);
  const resumen = referencias.length
    ? `${referencias.length} ${referencias.length === 1 ? "nota existente ha cambiado" : "notas existentes han cambiado"}.`
    : "Ninguna otra nota ha cambiado.";

  const filas = referencias.map(c => el("div", { className: "pos-cambio" },
    el("span", { className: "pos-cambio-nombre", textContent: posicionTitulo(c.anime) }),
    el("span", { className: "pos-cambio-notas", textContent: `${c.original == null ? "Sin nota" : c.original.toFixed(1)} → ${c.nueva.toFixed(1)}` })
  ));

  const guardarBtn = el("button", { className: "btn pos-primary", type: "button", textContent: "Guardar y terminar" });
  guardarBtn.addEventListener("click", () => {
    const todosCambios = cambios.map(c => ({ anime: c.anime, nueva: c.nueva }));
    todosCambios.forEach(c => { c.anime.score = c.nueva.toFixed(1); });
    dlgPosicionarEl.close();
    render();
    toast("Posicionamiento guardado localmente");
    Promise.all(todosCambios.map(c => guardar({ type: "UPDATE_ANIME", row: c.anime.row, campo: "score", valor: c.anime.score })))
      .then(resultados => {
        if (resultados.some(ok => !ok)) toast("Algunas notas no pudieron sincronizarse con Google Sheets");
        else toast("Posicionamiento sincronizado");
      })
      .catch(() => toast("No se pudo sincronizar el posicionamiento"));
  });

  const antesCandidato = notaNumero(s.candidate);
  const textoAntes = antesCandidato == null ? "Sin nota" : antesCandidato.toFixed(1);
  const textoDespues = notaRedondeada(s.working.get(s.candidate.row)).toFixed(1);

  dlgPosicionarEl.innerHTML = "";
  dlgPosicionarEl.append(
    el("div", { className: "pos-resultado" },
      el("div", { className: "pos-check", textContent: "✓" }),
      el("h2", { textContent: "¡Serie posicionada!" }),
      el("div", { className: "pos-resultado-titulo", textContent: posicionTitulo(s.candidate) }),
      el("div", { className: "pos-nota-final", textContent: `${textoAntes} → ${textoDespues}` }),
      el("p", { textContent: `${s.comparaciones} comparación${s.comparaciones === 1 ? "" : "es"} realizadas.` })
    ),
    el("div", { className: "pos-cambios-panel" },
      el("h3", { textContent: "Cambios de puntuación" }),
      el("p", { className: "pos-cambios-resumen", textContent: resumen }),
      el("div", { className: "pos-cambios-lista" }, ...filas)
    ),
    el("div", { className: "pos-actions" },
      guardarBtn,
      el("button", { className: "btn-mini", type: "button", textContent: "Cancelar", onclick: () => dlgPosicionarEl.close() })
    )
  );
}


// --- Separador de empates ------------------------------------------------------
// Ordena únicamente las series que comparten una misma décima. La nota sigue
// siendo una nota decimal real: al terminar, las series se redistribuyen entre
// las décimas disponibles más cercanas a su nota original.
let empateState = null;

function abrirSeparadorEmpates() {
  const validas = posicionState?.validas || todosLosAnimes;
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
  dlgPosicionarEl.innerHTML = "";
  const lista = el("div", { className: "pos-selector-grid" });
  grupos.forEach(g => {
    const card = el("button", { className: "pos-selector-card", type: "button", title: `Separar las ${g.items.length} series con ${g.score.toFixed(1)}` });
    const portada = el("div", { className: "pos-selector-portada" });
    const img = el("img", { alt: "" });
    posicionPortada(g.items[0], img); portada.append(img);
    const info = el("div", { className: "pos-selector-info" });
    info.append(el("strong", { textContent: `Nota ${g.score.toFixed(1)}` }), el("span", { className: "pos-selector-nota", textContent: `${g.items.length} series` }), el("small", { textContent: "Pulsa para ordenar este empate" }));
    card.append(portada, info);
    card.addEventListener("click", () => iniciarSeparacionEmpate(g.score));
    lista.append(card);
  });
  const cerrar = el("button", { className: "btn-mini", type: "button", textContent: "Cerrar", onclick: () => dlgPosicionarEl.close() });
  dlgPosicionarEl.append(
    el("div", { className: "pos-head" }, el("div", { className: "pos-mark", textContent: "↕" }), el("div", {}, el("h2", { textContent: "Separar notas iguales" }), el("p", { textContent: "Compara las series que tienen la misma décima y conviértelas en un orden real con notas decimales." }))),
    el("p", { className: "pos-help", textContent: "La aplicación usa búsqueda binaria para ordenar el grupo con el menor número de comparaciones posible. Después utiliza las décimas disponibles más cercanas a la nota original." }),
    lista,
    el("div", { className: "pos-actions" }, cerrar)
  );
  if (!dlgPosicionarEl.open) dlgPosicionarEl.showModal();
}

function iniciarSeparacionEmpate(score) {
  const validas = posicionState?.validas || todosLosAnimes;
  const grupo = validas.filter(a => notaNumero(a) === score);
  if (grupo.length < 2) return;
  empateState = {
    score,
    items: grupo,
    sorted: [],
    pending: [],
    comparaciones: 0,
    historial: [],
    cambios: []
  };
  // Merge sort interactivo: óptimo en número de comparaciones en el peor caso.
  prepararMergeEmpate();
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

function mostrarComparacionEmpate(a, b) {
  const s = empateState;
  dlgPosicionarEl.innerHTML = "";
  const ia = el("img", { className: "pos-cover", alt: "" });
  const ib = el("img", { className: "pos-cover", alt: "" });
  posicionPortada(a, ia); posicionPortada(b, ib);
  const botones = el("div", { className: "pos-votos" });
  [["a", "↑", "Me gusta más"], ["igual", "=", "Me gustan igual"], ["b", "↓", "Me gusta más"]].forEach(([tipo, icono, texto], i) => {
    const btt = el("button", { className: `pos-voto ${i === 0 ? "pos-mas" : i === 2 ? "pos-menos" : "pos-igual"}`, type: "button" }, el("span", { textContent: icono }), el("strong", { textContent: i === 1 ? texto : `${texto}: ${i === 0 ? posicionTitulo(a) : posicionTitulo(b)}` }));
    btt.addEventListener("click", () => responderEmpate(tipo));
    botones.append(btt);
  });
  dlgPosicionarEl.append(
    el("div", { className: "pos-topline" }, el("span", { textContent: "SEPARAR EMPATE" }), el("span", { textContent: `${s.comparaciones} comparación${s.comparaciones === 1 ? "" : "es"}` })),
    el("div", { className: "pos-estimacion" }, el("span", { textContent: `TODAS TENÍAN ${s.score.toFixed(1)}` }), el("strong", { textContent: String(s.items.length) }), el("small", { textContent: "La nota se mantendrá decimal; se redistribuirán décimas al terminar." })),
    el("div", { className: "pos-comparacion" },
      el("div", { className: "pos-serie" }, ia, el("strong", { textContent: posicionTitulo(a) }), el("small", { textContent: "Empate actual" })),
      el("div", { className: "pos-vs", textContent: "VS" }),
      el("div", { className: "pos-serie" }, ib, el("strong", { textContent: posicionTitulo(b) }), el("small", { textContent: "Empate actual" }))
    ),
    el("p", { className: "pos-question", textContent: "¿Cuál te gusta más?" }), botones,
    el("div", { className: "pos-foot" }, el("span", { textContent: "Si son exactamente iguales, puedes conservar el empate." }))
  );
}

function responderEmpate(tipo) {
  const s = empateState;
  if (!s) return;
  const a = s.currentLeft[s.leftIndex];
  const b = s.currentRight[s.rightIndex];
  s.comparaciones++;
  s.historial.push({ a: a.row, b: b.row, tipo });
  if (tipo === "a") {
    s.merged.push(a); s.leftIndex++;
  } else if (tipo === "b") {
    s.merged.push(b); s.rightIndex++;
  } else {
    // Un empate subjetivo no necesita otra comparación; mantenemos el orden estable.
    s.merged.push(a); s.leftIndex++;
    s.merged.push(b); s.rightIndex++;
  }
  siguienteMergeEmpate();
}

function obtenerNotasDisponiblesParaEmpate(s) {
  const otras = new Set(
    todosLosAnimes
      .filter(a => !s.items.includes(a))
      .map(notaNumero)
      .filter(n => n != null)
      .map(n => Math.round(n * 10))
  );
  const base = Math.round(s.score * 10);
  const cantidad = s.items.length;
  if (cantidad < 1) return [];

  // Una separación de empate debe permanecer cerca de la nota original.
  // Antes se buscaba el mejor bloque en TODO 0.0-10.0; si las décimas cercanas
  // estaban ocupadas, el algoritmo podía terminar encontrando, por ejemplo,
  // 2.1-2.9 para un empate de 9.0. Eso es conceptualmente incorrecto.
  //
  // Buscamos bloques consecutivos de la longitud necesaria cuyo centro esté
  // lo más cerca posible de la nota original. Limitamos además la desviación
  // máxima para no convertir una separación en una renotación global.
  const maxDesviacion = Math.max(5, Math.ceil((cantidad - 1) / 2) + 3); // décimas
  let mejor = null;

  for (let start = Math.max(0, base - maxDesviacion - cantidad); start <= Math.min(100 - cantidad + 1, base + maxDesviacion); start++) {
    const bloque = Array.from({ length: cantidad }, (_, i) => start + i);
    if (bloque.some(x => otras.has(x))) continue;

    const centro = (bloque[0] + bloque[bloque.length - 1]) / 2;
    const distanciaCentro = Math.abs(centro - base);
    const desviacionMax = Math.max(...bloque.map(x => Math.abs(x - base)));
    if (desviacionMax > maxDesviacion) continue;

    // Penalizamos ligeramente alejarse de la nota original; el criterio
    // principal sigue siendo mantener el bloque centrado alrededor de ella.
    const distanciaTotal = bloque.reduce((sum, x) => sum + Math.abs(x - base), 0);
    const coste = distanciaCentro * 100 + distanciaTotal;
    if (!mejor || coste < mejor.coste) mejor = { bloque, coste, distanciaCentro };
  }

  return mejor?.bloque || [];
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
  const disponibles = obtenerNotasDisponiblesParaEmpate(s);
  dlgPosicionarEl.innerHTML = "";
  if (disponibles.length < s.sorted.length) {
    dlgPosicionarEl.append(
      el("div", { className: "pos-resultado" }, el("div", { className: "pos-check", textContent: "!" }), el("h2", { textContent: "No hay suficientes décimas libres" }), el("p", { textContent: `Has ordenado las ${s.sorted.length} series de ${s.score.toFixed(1)}, pero solo hay ${disponibles.length} décimas consecutivas libres sin tocar otras notas. No voy a cambiar notas de otras series sin que las compares.` })),
      el("div", { className: "pos-actions" }, el("button", { className: "btn-mini", type: "button", textContent: "Cerrar", onclick: () => dlgPosicionarEl.close() }))
    );
    return;
  }
  const cambios = s.sorted.map((anime, i) => ({ anime, nueva: disponibles[disponibles.length - 1 - i] / 10, original: s.score }));
  const filas = cambios.map(c => el("div", { className: "pos-cambio" }, el("span", { className: "pos-cambio-nombre", textContent: posicionTitulo(c.anime) }), el("span", { className: "pos-cambio-notas", textContent: `${c.original.toFixed(1)} → ${c.nueva.toFixed(1)}` })));
  const guardarBtnEmpate = el("button", { className: "btn pos-primary", type: "button", textContent: "Guardar orden" });
  guardarBtnEmpate.addEventListener("click", () => {
    cambios.forEach(c => c.anime.score = c.nueva.toFixed(1));
    dlgPosicionarEl.close();
    render();
    Promise.all(cambios.map(c => guardar({ type: "UPDATE_ANIME", row: c.anime.row, campo: "score", valor: c.anime.score }))).catch(() => toast("No se pudo sincronizar alguna nota"));
    toast(`${cambios.length} series ordenadas por nota`);
  });
  dlgPosicionarEl.append(
    el("div", { className: "pos-resultado" }, el("div", { className: "pos-check", textContent: "✓" }), el("h2", { textContent: "Empate ordenado" }), el("p", { textContent: `${s.comparaciones} comparación${s.comparaciones === 1 ? "" : "es"}. Las notas siguen usando una sola decimal.` })),
    el("div", { className: "pos-cambios-panel" }, el("h3", { textContent: `Nuevo orden de ${s.score.toFixed(1)}` }), el("div", { className: "pos-cambios-lista" }, ...filas)),
    el("div", { className: "pos-actions" }, guardarBtnEmpate, el("button", { className: "btn-mini", type: "button", textContent: "Cancelar", onclick: () => dlgPosicionarEl.close() }))
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
  if (c.includes("ENLACE_ANIME_INVALIDO")) return "Pega un enlace completo (con http:// o https://) a la ficha del anime.";
  if (c.includes("NO_SE_PUDO_LEER_LA_PAGINA")) return "No se pudo abrir esa página. Comprueba el enlace o tu conexión.";
  if (c.includes("SIN_TITULO")) return "No se encontró el título en esa página. ¿Es el enlace correcto?";
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
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
      blobUrls.clear();
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

  todosLosAnimes = res.lista;
  sincronizarCatalogo();
  await inicializarContadorPortadas();
  render();
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
