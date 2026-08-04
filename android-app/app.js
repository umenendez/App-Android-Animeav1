// app.js — versión Android (PWA) de la extensión AnimeAV1 → Google Sheets Tracker
// Reimplementa: popup (listado/filtros/edición), background (Sheets API,
// portadas, migración AnimeFLV) y content script (registrar al abrir un
// episodio) usando APIs de navegador en vez de APIs de extensión.

const ESTADOS = [
  { value: "-", label: "- Viendo" },
  { value: "✔", label: "✔ Visto" },
  { value: "✖", label: "✖ Sin ver" },
  { value: "📉", label: "📉 Dropeado" },
  { value: "@", label: "@ Por ver" },
];

const GENEROS = [
  "ISEKAI", "SHOUNEN", "EL RESTO", "ROMANCE", "(._.)", "PELICULA",
  "NOVELA", "MANGA / MANWHA", "SLICE OF LIFE", "FANTASÍA", "MONOGATARI",
];

const ESTADO_VIENDO = "-";
const GID_COL = 0; // A

// --- Configuración (guardada solo en este dispositivo) ---------------------

const CONFIG_KEY = "aat_config";
function cargarConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function guardarConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}
let CONFIG = cargarConfig();

// --- Referencias DOM ---------------------------------------------------

const $ = (id) => document.getElementById(id);
const pantallaLogin = $("pantallaLogin");
const mainEl = $("main");
const subtCuenta = $("subtCuenta");
const cargandoEl = $("cargando");
const errorEl = $("error");
const vacioEl = $("vacio");
const listaEl = $("lista");
const contadorEl = $("contador");
const filtroEstadoEl = $("filtroEstado");
const filtroGeneroEl = $("filtroGenero");
const ordenEl = $("orden");

let todosLosAnimes = [];

// --- Auth (Google Identity Services) -----------------------------------

let tokenClient = null;
let currentToken = sessionStorage.getItem("aat_token") || null;
let tokenExpiry = parseInt(sessionStorage.getItem("aat_token_exp") || "0", 10);

function gisListo() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

function initTokenClient() {
  if (!gisListo() || !CONFIG.clientId) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: "",
  });
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    if (currentToken && Date.now() < tokenExpiry - 30000) return resolve(currentToken);
    if (!CONFIG.clientId) return reject(new Error("Falta configurar el ID de cliente OAuth en Ajustes"));
    if (!gisListo()) return reject(new Error("Google Identity Services no ha cargado (revisa tu conexión)"));
    if (!tokenClient) initTokenClient();
    if (!tokenClient) return reject(new Error("No se pudo inicializar el cliente de Google"));

    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      currentToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
      sessionStorage.setItem("aat_token", currentToken);
      sessionStorage.setItem("aat_token_exp", String(tokenExpiry));
      resolve(currentToken);
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
  });
}

function cerrarSesion() {
  if (currentToken && gisListo()) {
    google.accounts.oauth2.revoke(currentToken, () => {});
  }
  currentToken = null;
  tokenExpiry = 0;
  sessionStorage.removeItem("aat_token");
  sessionStorage.removeItem("aat_token_exp");
  mostrarLogin();
}

// Ejecuta fn(token) y, si la API dice que el token ya no vale, pide uno
// nuevo (con interacción) y reintenta una vez — igual que hacía background.js.
async function conAuth(fn) {
  let token = await getAuthToken(true);
  try {
    return await fn(token);
  } catch (e) {
    if (String(e).includes("TOKEN_INVALIDO")) {
      currentToken = null;
      token = await getAuthToken(true);
      return await fn(token);
    }
    throw e;
  }
}

// --- Google Sheets API ---------------------------------------------------

async function sheetsFetch(path, token, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.sheetId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) throw new Error("TOKEN_INVALIDO");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error de Sheets API (${res.status}): ${text}`);
  }
  return res.json();
}

let cachedSheetName = null;
async function getSheetName(token) {
  if (cachedSheetName) return cachedSheetName;
  const gid = Number(CONFIG.gid || 0);
  const data = await sheetsFetch("?fields=sheets.properties", token);
  const sheet = (data.sheets || []).find((s) => s.properties.sheetId === gid);
  cachedSheetName = sheet ? sheet.properties.title : "Sheet1";
  return cachedSheetName;
}

async function getFilasDaJ(token, sheetName) {
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(sheetName + "!D:J")}&fields=sheets.data.rowData.values(formattedValue,hyperlink)`,
    token
  );
  return data.sheets?.[0]?.data?.[0]?.rowData || [];
}

function coreTitle(title) {
  if (!title) return "";
  let t = title.split(":")[0];
  t = t.replace(/\b(temporada|season)\s*\d+\b/gi, "");
  t = t.replace(/\b(part|cour|parte)\s*\d+\b/gi, "");
  t = t.replace(/\b\d+(st|nd|rd|th)\s*season\b/gi, "");
  t = t.replace(/\s+(I{1,3}|IV|VI{0,3}|IX|X)\s*$/i, "");
  t = t.replace(/\s+\d+\s*$/, "");
  return t.trim().toLowerCase();
}

async function actualizarSoloEstado(token, row, estado) {
  const gid = Number(CONFIG.gid || 0);
  const requests = [{
    updateCells: {
      range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 5, endColumnIndex: 6 },
      rows: [{ values: [{ userEnteredValue: { stringValue: estado } }] }],
      fields: "userEnteredValue",
    },
  }];
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

async function escribirFilaNueva(token, row, { title, url, score, description, cover }) {
  const gid = Number(CONFIG.gid || 0);
  const requests = [
    {
      updateCells: {
        range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 2, endColumnIndex: 3 },
        rows: [{ values: [{
          userEnteredValue: score ? { numberValue: parseFloat(score) } : { stringValue: "" },
          userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.0" } },
        }] }],
        fields: "userEnteredValue,userEnteredFormat.numberFormat",
      },
    },
    {
      updateCells: {
        range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 3, endColumnIndex: 4 },
        rows: [{ values: [{
          userEnteredValue: { stringValue: title },
          textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }],
        }] }],
        fields: "userEnteredValue,textFormatRuns",
      },
    },
    {
      updateCells: {
        range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 4, endColumnIndex: 5 },
        rows: [{ values: [{ userEnteredValue: { stringValue: description || "" } }] }],
        fields: "userEnteredValue",
      },
    },
    {
      updateCells: {
        range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 5, endColumnIndex: 6 },
        rows: [{ values: [{ userEnteredValue: { stringValue: ESTADO_VIENDO } }] }],
        fields: "userEnteredValue",
      },
    },
  ];
  if (cover) {
    requests.push({
      updateCells: {
        range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 9, endColumnIndex: 10 },
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${cover}",1)` } }] }],
        fields: "userEnteredValue",
      },
    });
  }
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

function extraerUrlImagen(celda) {
  if (!celda) return "";
  const formula = celda.userEnteredValue?.formulaValue || "";
  const match = formula.match(/IMAGE\(\s*"([^"]+)"/i);
  if (match) return match[1];
  const texto = celda.formattedValue || "";
  if (/^https?:\/\//i.test(texto)) return texto;
  return "";
}

async function obtenerListaCompleta(token) {
  const sheetName = await getSheetName(token);
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(sheetName + "!A:J")}&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)`,
    token
  );
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];
  const lista = [];
  rowData.forEach((r, i) => {
    if (i === 0) return;
    const values = r.values || [];
    const titulo = values[3]?.formattedValue || "";
    if (!titulo) return;
    lista.push({
      row: i + 1,
      genre: values[0]?.formattedValue || "",
      score: values[2]?.formattedValue || "",
      title: titulo,
      url: values[3]?.hyperlink || "",
      status: (values[5]?.formattedValue || "").trim(),
      cover: extraerUrlImagen(values[9]),
    });
  });
  return lista;
}

const COLUMNAS_EDITABLES = { score: 2, status: 5, genre: 0 };

async function actualizarCampo(token, row, campo, valor) {
  const gid = Number(CONFIG.gid || 0);
  const colIndex = COLUMNAS_EDITABLES[campo];
  if (colIndex === undefined) throw new Error("Campo desconocido: " + campo);
  const celda = { userEnteredValue: null };
  const fields = ["userEnteredValue"];
  if (campo === "score") {
    const num = parseFloat(String(valor).replace(",", "."));
    celda.userEnteredValue = isNaN(num) ? { stringValue: "" } : { numberValue: num };
    celda.userEnteredFormat = { numberFormat: { type: "NUMBER", pattern: "0.0" } };
    fields.push("userEnteredFormat.numberFormat");
  } else {
    celda.userEnteredValue = { stringValue: valor };
  }
  const requests = [{
    updateCells: {
      range: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      rows: [{ values: [celda] }],
      fields: fields.join(","),
    },
  }];
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

// --- Proxy CORS (necesario para leer animeav1.com / animeflv.net desde el navegador) --

function proxyFetch(url) {
  if (!CONFIG.proxy) {
    return Promise.reject(new Error("Configura un proxy CORS en Ajustes para usar esta herramienta (ver README)."));
  }
  return fetch(CONFIG.proxy + encodeURIComponent(url)).then((res) => {
    if (!res.ok) throw new Error(`Proxy respondió ${res.status}`);
    return res.text();
  });
}

function extraerPortadaDesdeHtml(html) {
  const match = html.match(/cdn\.animeav1\.com\/covers\/\d+\.jpg/i);
  return match ? `https://${match[0]}` : null;
}

function extraerPortadaAnimeFlv(html) {
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1) return m1[1];
  const m2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m2 ? m2[1] : null;
}

function normalizarTitulo(t) {
  return (t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function slugify(t) {
  return normalizarTitulo(t).replace(/\s+/g, "-");
}

async function buscarEnAnimeAV1(titulo) {
  const slug = slugify(titulo);
  if (!slug) return null;
  const url = `https://animeav1.com/media/${slug}`;
  try {
    const html = await proxyFetch(url);
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const h1 = h1Match ? h1Match[1].trim() : "";
    if (!h1 || normalizarTitulo(h1) !== normalizarTitulo(titulo)) return null;
    return { url, html };
  } catch (e) {
    return null;
  }
}

// --- Herramienta: rellenar portadas que faltan --------------------------

async function rellenarPortadas() {
  return conAuth(async (token) => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaJ(token, sheetName);
    const requests = [];
    let encontradas = 0, sinImagen = 0;
    const gid = Number(CONFIG.gid || 0);

    for (let i = 0; i < filas.length; i++) {
      const values = filas[i].values || [];
      const tituloUrl = values[0]?.hyperlink;
      const yaTienePortada = (values[6]?.formattedValue || "").trim() !== "";
      if (!tituloUrl || yaTienePortada) continue;
      try {
        const html = await proxyFetch(tituloUrl);
        const imagenUrl = extraerPortadaDesdeHtml(html);
        if (!imagenUrl) { sinImagen++; continue; }
        requests.push({
          updateCells: {
            range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 9, endColumnIndex: 10 },
            rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${imagenUrl}",1)` } }] }],
            fields: "userEnteredValue",
          },
        });
        encontradas++;
      } catch (e) {
        sinImagen++;
      }
    }
    if (requests.length > 0) {
      await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
    }
    return { encontradas, sinImagen };
  });
}

// --- Herramienta: migrar enlaces de AnimeFLV a AnimeAV1 ------------------

async function migrarAnimeFlv() {
  return conAuth(async (token) => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaJ(token, sheetName);
    const requests = [];
    let migradas = 0, portadasFlv = 0, sinCambios = 0;
    const gid = Number(CONFIG.gid || 0);

    for (let i = 0; i < filas.length; i++) {
      const values = filas[i].values || [];
      const enlace = values[0]?.hyperlink || "";
      if (!enlace.includes("animeflv")) continue;
      const titulo = values[0]?.formattedValue || "";
      const yaTienePortada = (values[6]?.formattedValue || "").trim() !== "";
      const encontrado = await buscarEnAnimeAV1(titulo);

      if (encontrado) {
        requests.push({
          updateCells: {
            range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 3, endColumnIndex: 4 },
            rows: [{ values: [{
              userEnteredValue: { stringValue: titulo },
              textFormatRuns: [{ startIndex: 0, format: { link: { uri: encontrado.url } } }],
            }] }],
            fields: "userEnteredValue,textFormatRuns",
          },
        });
        migradas++;
        if (!yaTienePortada) {
          const imagenUrl = extraerPortadaDesdeHtml(encontrado.html);
          if (imagenUrl) {
            requests.push({
              updateCells: {
                range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 9, endColumnIndex: 10 },
                rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${imagenUrl}",1)` } }] }],
                fields: "userEnteredValue",
              },
            });
          }
        }
      } else if (!yaTienePortada) {
        try {
          const html = await proxyFetch(enlace);
          const imagenUrl = extraerPortadaAnimeFlv(html);
          if (imagenUrl) {
            requests.push({
              updateCells: {
                range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 9, endColumnIndex: 10 },
                rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${imagenUrl}",1)` } }] }],
                fields: "userEnteredValue",
              },
            });
            portadasFlv++;
          } else {
            sinCambios++;
          }
        } catch (e) {
          sinCambios++;
        }
      } else {
        sinCambios++;
      }
    }
    if (requests.length > 0) {
      await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
    }
    return { migradas, portadasFlv, sinCambios };
  });
}

// --- Registrar anime (equivalente al content script + handleRegisterAnime) --

// Acepta tanto el enlace de un episodio (/media/slug/12) como el de la
// ficha principal (/media/slug), igual que se comparte desde Chrome.
function normalizarUrlFicha(urlTexto) {
  try {
    const u = new URL(urlTexto);
    if (u.hostname !== "animeav1.com") return null;
    const m = u.pathname.replace(/\/+$/, "").match(/^\/media\/([^/]+)/);
    if (!m) return null;
    return { slug: m[1], url: `https://animeav1.com/media/${m[1]}` };
  } catch (e) {
    return null;
  }
}

async function extraerInfoAnime(mainUrl) {
  const html = await proxyFetch(mainUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");

  const title = (doc.querySelector("h1")?.textContent || mainUrl).trim();

  const bodyText = doc.body.innerText || doc.body.textContent || "";
  const scoreMatch = bodyText.match(/(\d+(?:[.,]\d+)?)\s*\n*\s*MAL RATING/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1].replace(",", ".")).toFixed(1) : "";

  const paragraphs = Array.from(doc.querySelectorAll("p"))
    .map((p) => p.textContent.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 60 && !/derechos|copyright|términos|política de privacidad/i.test(t));
  const description = paragraphs.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();

  const cover = extraerPortadaDesdeHtml(html) || "";

  return { title, url: mainUrl, score, description, cover };
}

function mostrarConflicto(nuevoTitulo, existingTitle) {
  return new Promise((resolve) => {
    $("textoConflicto").textContent = `"${nuevoTitulo}" parece relacionado con "${existingTitle}", que ya tienes en la lista. ¿Qué quieres hacer?`;
    abrirOverlay("overlayConflicto");
    const onExistente = () => { limpiar(); resolve("existente"); };
    const onNuevo = () => { limpiar(); resolve("nuevo"); };
    function limpiar() {
      cerrarOverlay("overlayConflicto");
      $("btnConflictoExistente").removeEventListener("click", onExistente);
      $("btnConflictoNuevo").removeEventListener("click", onNuevo);
    }
    $("btnConflictoExistente").addEventListener("click", onExistente);
    $("btnConflictoNuevo").addEventListener("click", onNuevo);
  });
}

async function handleRegisterAnime(info) {
  return conAuth(async (token) => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaJ(token, sheetName);
    const tituloNorm = info.title.trim().toLowerCase();

    for (let i = 0; i < filas.length; i++) {
      const v = filas[i].values || [];
      const existente = (v[0]?.formattedValue || "").trim();
      if (existente.toLowerCase() === tituloNorm) {
        const estadoActual = (v[2]?.formattedValue || "").trim();
        if (estadoActual !== ESTADO_VIENDO) await actualizarSoloEstado(token, i + 1, ESTADO_VIENDO);
        return { accion: "resincronizado" };
      }
    }

    const nuevoCore = coreTitle(info.title);
    if (nuevoCore) {
      for (let i = 0; i < filas.length; i++) {
        const v = filas[i].values || [];
        const existente = (v[0]?.formattedValue || "").trim();
        if (!existente) continue;
        if (coreTitle(existente) === nuevoCore) {
          const decision = await mostrarConflicto(info.title, existente);
          if (decision === "existente") {
            await actualizarSoloEstado(token, i + 1, ESTADO_VIENDO);
            return { accion: "marcado_existente" };
          } else {
            const filasActuales = await getFilasDaJ(token, sheetName);
            const row = filasActuales.length + 1;
            await escribirFilaNueva(token, row, info);
            return { accion: "creado" };
          }
        }
      }
    }

    const row = filas.length + 1;
    await escribirFilaNueva(token, row, info);
    return { accion: "creado" };
  });
}

// --- Overlays (hojas modales) --------------------------------------------

function abrirOverlay(id) { $(id).classList.add("open"); }
function cerrarOverlay(id) { $(id).classList.remove("open"); }
document.querySelectorAll("[data-cerrar]").forEach((el) => {
  el.addEventListener("click", () => cerrarOverlay(el.dataset.cerrar));
});

// --- Toolbar de filtros/orden ---------------------------------------------

function inicializarToolbar() {
  filtroEstadoEl.innerHTML = "";
  const optTodos = document.createElement("option");
  optTodos.value = ""; optTodos.textContent = "Todos los estados";
  filtroEstadoEl.appendChild(optTodos);
  ESTADOS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value; opt.textContent = label;
    filtroEstadoEl.appendChild(opt);
  });
  filtroEstadoEl.value = "-";

  filtroGeneroEl.innerHTML = "";
  const optTodosGenero = document.createElement("option");
  optTodosGenero.value = ""; optTodosGenero.textContent = "Todos los géneros";
  filtroGeneroEl.appendChild(optTodosGenero);
  GENEROS.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g; opt.textContent = g;
    filtroGeneroEl.appendChild(opt);
  });

  ordenEl.innerHTML = "";
  [
    { value: "", label: "Sin ordenar" },
    { value: "score-desc", label: "Nota: mayor a menor" },
    { value: "score-asc", label: "Nota: menor a mayor" },
  ].forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value; opt.textContent = label;
    ordenEl.appendChild(opt);
  });

  [filtroEstadoEl, filtroGeneroEl, ordenEl].forEach((el) => el.addEventListener("change", render));
}

function render() {
  const estado = filtroEstadoEl.value;
  const genero = filtroGeneroEl.value;
  const orden = ordenEl.value;

  let lista = todosLosAnimes.filter((a) => {
    if (estado && a.status !== estado) return false;
    if (genero && a.genre !== genero) return false;
    return true;
  });

  if (orden === "score-desc" || orden === "score-asc") {
    lista = lista.slice().sort((a, b) => {
      const na = parseFloat(String(a.score).replace(",", ".")) || 0;
      const nb = parseFloat(String(b.score).replace(",", ".")) || 0;
      return orden === "score-desc" ? nb - na : na - nb;
    });
  }

  contadorEl.textContent = `${lista.length} anime(s)`;
  listaEl.innerHTML = "";

  if (lista.length === 0) {
    vacioEl.style.display = "block";
    return;
  }
  vacioEl.style.display = "none";
  lista.forEach((anime) => listaEl.appendChild(renderItem(anime)));
}

function crearSelect(options, valorActual, incluirVacio, labelVacio) {
  const select = document.createElement("select");
  if (incluirVacio) {
    const elVacio = document.createElement("option");
    elVacio.value = ""; elVacio.textContent = labelVacio || "—";
    if (!valorActual) elVacio.selected = true;
    select.appendChild(elVacio);
  }
  options.forEach((opt) => {
    const value = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    const el = document.createElement("option");
    el.value = value; el.textContent = label;
    if (value === valorActual) el.selected = true;
    select.appendChild(el);
  });
  return select;
}

function flashGuardado(el) {
  el.classList.add("saved-flash");
  setTimeout(() => el.classList.remove("saved-flash"), 700);
}

function colorPorNota(valorCrudo) {
  if (valorCrudo === "" || valorCrudo === null || valorCrudo === undefined) return null;
  const n = parseFloat(String(valorCrudo).replace(",", "."));
  if (isNaN(n)) return null;
  if (n > 10) return { bg: "#facc15", fg: "#78350f" };
  const clamped = Math.max(0, Math.min(10, n));
  const hue = (clamped / 10) * 120;
  return { bg: `hsl(${hue}, 72%, 45%)`, fg: "#ffffff" };
}
function aplicarColorNota(input) {
  const color = colorPorNota(input.value);
  if (color) { input.style.backgroundColor = color.bg; input.style.color = color.fg; }
  else { input.style.backgroundColor = ""; input.style.color = ""; }
}

function renderItem(anime) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.estado = anime.status || "";

  if (anime.cover) {
    const img = document.createElement("img");
    img.className = "cover"; img.loading = "lazy";
    img.src = anime.cover; img.alt = "";
    card.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "cover-placeholder";
    placeholder.textContent = "Sin portada";
    card.appendChild(placeholder);
  }

  const info = document.createElement("div");
  info.className = "info";

  const link = document.createElement("a");
  link.className = "titulo"; link.href = anime.url || "#"; link.target = "_blank";
  link.rel = "noopener"; link.textContent = anime.title || "(sin título)";
  info.appendChild(link);

  const campoScore = document.createElement("div");
  campoScore.className = "campo";
  const labelScore = document.createElement("label");
  labelScore.textContent = "Nota";
  const inputScore = document.createElement("input");
  inputScore.type = "number"; inputScore.step = "0.1"; inputScore.min = "0"; inputScore.max = "11";
  inputScore.value = anime.score || "";
  aplicarColorNota(inputScore);
  inputScore.addEventListener("input", () => aplicarColorNota(inputScore));
  inputScore.addEventListener("change", async () => {
    anime.score = inputScore.value;
    aplicarColorNota(inputScore);
    try {
      await conAuth((token) => actualizarCampo(token, anime.row, "score", inputScore.value));
      flashGuardado(inputScore);
    } catch (e) { alert("No se pudo guardar: " + e.message); }
  });
  campoScore.appendChild(labelScore); campoScore.appendChild(inputScore);
  info.appendChild(campoScore);

  const campoEstado = document.createElement("div");
  campoEstado.className = "campo campo-estado";
  const labelEstado = document.createElement("label");
  labelEstado.textContent = "Estado";
  const selectEstado = crearSelect(ESTADOS, anime.status, false);
  selectEstado.addEventListener("change", async () => {
    anime.status = selectEstado.value;
    card.dataset.estado = selectEstado.value;
    try {
      await conAuth((token) => actualizarCampo(token, anime.row, "status", selectEstado.value));
      flashGuardado(selectEstado);
      render();
    } catch (e) { alert("No se pudo guardar: " + e.message); }
  });
  campoEstado.appendChild(labelEstado); campoEstado.appendChild(selectEstado);
  info.appendChild(campoEstado);

  const campoGenero = document.createElement("div");
  campoGenero.className = "campo";
  const labelGenero = document.createElement("label");
  labelGenero.textContent = "Género";
  const selectGenero = crearSelect(GENEROS, anime.genre, true, "Sin género");
  selectGenero.addEventListener("change", async () => {
    anime.genre = selectGenero.value;
    try {
      await conAuth((token) => actualizarCampo(token, anime.row, "genre", selectGenero.value));
      flashGuardado(selectGenero);
      render();
    } catch (e) { alert("No se pudo guardar: " + e.message); }
  });
  campoGenero.appendChild(labelGenero); campoGenero.appendChild(selectGenero);
  info.appendChild(campoGenero);

  card.appendChild(info);
  return card;
}

// --- Carga inicial de la lista --------------------------------------------

async function cargar() {
  cargandoEl.style.display = "block";
  errorEl.style.display = "none";
  vacioEl.style.display = "none";
  listaEl.innerHTML = "";
  contadorEl.textContent = "";

  try {
    todosLosAnimes = await conAuth((token) => obtenerListaCompleta(token));
    cargandoEl.style.display = "none";
    render();
  } catch (e) {
    cargandoEl.style.display = "none";
    errorEl.textContent = "No se pudo cargar la lista: " + e.message;
    errorEl.style.display = "block";
  }
}

// --- Pantallas: login vs app -----------------------------------------------

function mostrarLogin() {
  pantallaLogin.style.display = "flex";
  mainEl.style.display = "none";
  $("btnRegistrar").style.display = "none";
  subtCuenta.textContent = "Sin conectar";
}
function mostrarApp() {
  pantallaLogin.style.display = "none";
  mainEl.style.display = "flex";
  $("btnRegistrar").style.display = "flex";
  subtCuenta.textContent = "Conectado";
  cargar();
}

// --- Wiring de botones -------------------------------------------------

$("btnConectar").addEventListener("click", async () => {
  if (!CONFIG.clientId || !CONFIG.sheetId) {
    abrirOverlay("overlayAjustes");
    return;
  }
  initTokenClient();
  try {
    await getAuthToken(true);
    mostrarApp();
  } catch (e) {
    alert("No se pudo conectar: " + e.message);
  }
});
$("abrirAjustesDesdeLogin").addEventListener("click", (e) => { e.preventDefault(); abrirOverlay("overlayAjustes"); });
$("btnAjustes").addEventListener("click", () => {
  $("cfgClientId").value = CONFIG.clientId || "";
  $("cfgSheetId").value = CONFIG.sheetId || "";
  $("cfgGid").value = CONFIG.gid ?? 0;
  $("cfgProxy").value = CONFIG.proxy || "";
  abrirOverlay("overlayAjustes");
});
$("btnGuardarAjustes").addEventListener("click", () => {
  CONFIG = {
    clientId: $("cfgClientId").value.trim(),
    sheetId: $("cfgSheetId").value.trim(),
    gid: parseInt($("cfgGid").value, 10) || 0,
    proxy: $("cfgProxy").value.trim(),
  };
  guardarConfig(CONFIG);
  cachedSheetName = null;
  tokenClient = null;
  cerrarOverlay("overlayAjustes");
  if (CONFIG.clientId && CONFIG.sheetId) {
    initTokenClient();
    mostrarLogin();
  }
});

$("btnHerramientas").addEventListener("click", () => abrirOverlay("overlayHerramientas"));
$("btnCerrarSesion").addEventListener("click", () => { cerrarOverlay("overlayHerramientas"); cerrarSesion(); });

$("fillCovers").addEventListener("click", async () => {
  const btn = $("fillCovers"); const status = $("fillStatus");
  btn.disabled = true;
  status.textContent = "Buscando portadas… puede tardar un poco si hay muchas series.";
  try {
    const res = await rellenarPortadas();
    status.textContent = `Añadidas ${res.encontradas} portada(s).` + (res.sinImagen > 0 ? ` (${res.sinImagen} sin imagen encontrada)` : "");
    cargar();
  } catch (e) {
    status.textContent = "Error al buscar portadas: " + e.message;
  }
  btn.disabled = false;
});

$("migrateFlv").addEventListener("click", async () => {
  const btn = $("migrateFlv"); const status = $("migrateStatus");
  btn.disabled = true;
  status.textContent = "Revisando enlaces de AnimeFLV… puede tardar un poco.";
  try {
    const res = await migrarAnimeFlv();
    status.textContent = `Migrados a AnimeAV1: ${res.migradas}. Portada de AnimeFLV usada: ${res.portadasFlv}. Sin cambios: ${res.sinCambios}.`;
    cargar();
  } catch (e) {
    status.textContent = "Error: " + e.message;
  }
  btn.disabled = false;
});

$("btnRegistrar").addEventListener("click", () => {
  $("urlRegistrar").value = "";
  $("estadoRegistrar").textContent = "";
  abrirOverlay("overlayRegistrar");
});

async function registrarDesdeUrl(urlTexto) {
  const estadoEl = $("estadoRegistrar");
  const ficha = normalizarUrlFicha(urlTexto);
  if (!ficha) {
    estadoEl.textContent = "Ese enlace no parece una ficha de animeav1.com/media/…";
    return;
  }
  estadoEl.textContent = "Leyendo la ficha…";
  try {
    const info = await extraerInfoAnime(ficha.url);
    estadoEl.textContent = `Registrando "${info.title}"…`;
    const res = await handleRegisterAnime(info);
    estadoEl.textContent = res.accion === "resincronizado" || res.accion === "marcado_existente"
      ? "Ya estaba en la lista: marcado como viendo."
      : "Añadido a la lista.";
    cargar();
    setTimeout(() => cerrarOverlay("overlayRegistrar"), 900);
  } catch (e) {
    estadoEl.textContent = "Error: " + e.message;
  }
}
$("btnConfirmarRegistrar").addEventListener("click", () => registrarDesdeUrl($("urlRegistrar").value.trim()));

// --- Recepción vía "Compartir" (Web Share Target) --------------------------
// Equivale a que la extensión detecte que abriste un episodio: aquí el
// usuario comparte el enlace de animeav1.com desde Chrome hacia esta app.

function comprobarShareTarget() {
  const params = new URLSearchParams(location.search);
  const compartido = params.get("shared_url") || params.get("shared_text") || "";
  if (!compartido) return;
  // El texto compartido puede traer más cosas alrededor del enlace.
  const m = compartido.match(/https?:\/\/animeav1\.com\/media\/\S+/i);
  const url = m ? m[0] : compartido;
  history.replaceState(null, "", location.pathname);
  $("urlRegistrar").value = url;
  $("estadoRegistrar").textContent = "";
  abrirOverlay("overlayRegistrar");
  registrarDesdeUrl(url);
}

// --- Arranque ---------------------------------------------------------------

inicializarToolbar();
if (CONFIG.clientId && CONFIG.sheetId) {
  initTokenClient();
  if (currentToken && Date.now() < tokenExpiry) mostrarApp();
  else mostrarLogin();
} else {
  mostrarLogin();
}
window.addEventListener("load", () => {
  comprobarShareTarget();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});
