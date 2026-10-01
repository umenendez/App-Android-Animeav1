// background.js
// Recibe el aviso del content script y escribe la fila correspondiente
// en el Google Sheet del usuario. Además precarga las portadas en la
// caché local del navegador para que el popup las muestre al instante.

// El Google Sheet ya no está fijo en el código: cada usuario pega el enlace de
// su hoja en el popup (Herramientas → Hoja de Google Sheets) y se guarda en
// chrome.storage.local.
let SPREADSHEET_ID = null;
let GID = 0; // sheetId de la pestaña que se usa; se resuelve en getSheetName()
let GID_CONFIG = null; // gid indicado en el enlace (null = primera pestaña)
const ESTADO_VIENDO = "-";
const COVER_CACHE = "anime-covers-v1";

// --- Ventana independiente ---------------------------------------------------

let popupWindowId = null;

chrome.action.onClicked.addListener(async () => {
  if (popupWindowId !== null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch (e) {
      popupWindowId = null;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 480,
    height: 680,
  });
  popupWindowId = win.id;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) popupWindowId = null;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REGISTER_ANIME") {
    const tarea = message.url
      ? registrarAnimePorUrl(message.url)
      : handleRegisterAnime(message);
    tarea
      .then((resultado) => sendResponse({ ok: true, ...(resultado || {}) }))
      .catch((err) => {
        console.error("[AnimeAV1 Tracker]", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }
  if (message.type === "UPDATE_GENRES_BULK") {
    actualizarGenerosLote(message.cambios)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GET_LISTAS") {
    obtenerListasParaUI()
      .then((listas) => sendResponse({ ok: true, listas }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "ADD_LISTA") {
    agregarListaGuardada(message.name, message.url)
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "DELETE_LISTA") {
    eliminarListaGuardada(message.id)
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "SWITCH_LISTA") {
    cambiarListaActiva(message.id)
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "CAMBIAR_CUENTA") {
    cambiarCuenta()
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GET_ANIME_LIST") {
    obtenerListaCompleta()
      .then((lista) => sendResponse({ ok: true, lista }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "UPDATE_ANIME") {
    actualizarCampo(message.row, message.campo, message.valor)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "UPDATE_TITLE_URL") {
    actualizarTituloUrl(message.row, message.title, message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "FILL_COVERS") {
    rellenarPortadas()
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "SET_COVER_STORAGE") {
    chrome.storage.local.set({ guardarPortadas: message.enabled !== false })
      .then(() => sendResponse({ ok: true, enabled: message.enabled !== false }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GET_CONFIG") {
    chrome.storage.local.get("config")
      .then(({ config }) => sendResponse({ ok: true, config: config || null }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "SAVE_CONFIG") {
    guardarConfig(message.url)
      .then(async (resultado) => {
        await registrarConfigComoLista(message.url, resultado.titulo, resultado.hoja);
        sendResponse({ ok: true, ...resultado });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "MIGRATE_ANIMEFLV") {
    migrarAnimeFlv()
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

// --- Caché local de portadas --------------------------------------------------
// Descarga la imagen una vez y la guarda en la Cache Storage de la extensión
// (compartida entre background.js y popup.js). Las siguientes veces se lee
// de ahí en vez de volver a pedirla por red.

async function precachearImagen(url) {
  if (!url) return;
  try {
    const { guardarPortadas = true } = await chrome.storage.local.get({ guardarPortadas: true });
    if (!guardarPortadas) return;
    const cache = await caches.open(COVER_CACHE);
    const yaEsta = await cache.match(url);
    if (yaEsta) return;
    const res = await fetch(url);
    if (res.ok) await cache.put(url, res.clone());
  } catch (e) {
    console.error("[AnimeAV1 Tracker] Error precacheando portada:", e);
  }
}

// --- Auth ---------------------------------------------------------------

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const mensaje = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "No se obtuvo token";
        reject(new Error(mensaje));
      } else {
        resolve(token);
      }
    });
  });
}

async function cargarConfig() {
  if (SPREADSHEET_ID) return;
  const { config } = await chrome.storage.local.get("config");
  if (!config || !config.spreadsheetId) throw new Error("SIN_CONFIG");
  SPREADSHEET_ID = config.spreadsheetId;
  GID_CONFIG = config.gid ?? null;
}

function resetConfig() {
  SPREADSHEET_ID = null;
  GID_CONFIG = null;
  cachedSheetName = null;
}

// --- Varias listas guardadas --------------------------------------------------
// Cada lista conserva su propio enlace, spreadsheetId y pestaña. La hoja activa
// sigue usando la misma configuración que ya utilizaba la extensión.

async function getListasGuardadas() {
  const { listas = [] } = await chrome.storage.local.get("listas");
  return Array.isArray(listas) ? listas : [];
}

async function setListasGuardadas(listas) {
  await chrome.storage.local.set({ listas });
}

function nuevoIdLista() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function obtenerListasParaUI() {
  let listas = await getListasGuardadas();
  const { config } = await chrome.storage.local.get("config");
  let activaId = (await chrome.storage.local.get("listaActivaId")).listaActivaId || null;

  // Migra automáticamente la hoja que ya tenía configurada una instalación
  // anterior para que aparezca en el nuevo selector de listas.
  if (!listas.length && config?.spreadsheetId) {
    const migrada = {
      id: nuevoIdLista(),
      name: "Mi lista",
      url: config.url || "",
      spreadsheetId: config.spreadsheetId,
      gid: config.gid ?? null,
      titulo: config.titulo || "",
      hoja: config.hoja || ""
    };
    listas = [migrada];
    activaId = migrada.id;
    await chrome.storage.local.set({ listas, listaActivaId: activaId });
  }

  // Si no hay una lista activa pero sí hay listas, usa la primera.
  if (!activaId && listas.length) {
    activaId = listas[0].id;
    await chrome.storage.local.set({ listaActivaId: activaId });
  }

  return listas.map((l) => ({ ...l, activa: l.id === activaId }));
}

async function verificarAccesoHojaParaLista(p) {
  const token = await getAuthToken(true);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${p.spreadsheetId}?fields=properties.title,sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    throw new Error("TOKEN_INVALIDO");
  }
  if (res.status === 404) throw new Error("HOJA_NO_ENCONTRADA");
  if (res.status === 403) throw new Error("SIN_PERMISO");
  if (!res.ok) throw new Error(`Error de Sheets API (${res.status})`);
  const data = await res.json();
  const hojas = (data.sheets || []).map((s) => s.properties);
  const hoja = (p.gid !== null && hojas.find((h) => h.sheetId === p.gid)) || hojas[0];
  if (!hoja) throw new Error("El documento no tiene ninguna pestaña");
  return { titulo: data.properties?.title || "", hoja: hoja.title };
}

async function registrarConfigComoLista(enlace, titulo, hoja) {
  const p = parsearEnlaceSheet(enlace);
  if (!p) return;
  let listas = await getListasGuardadas();
  const activa = (await chrome.storage.local.get("listaActivaId")).listaActivaId || null;
  const existente = listas.find((l) => l.spreadsheetId === p.spreadsheetId && l.gid === p.gid);
  if (existente) {
    existente.name = existente.name || "Mi lista";
    existente.url = String(enlace).trim();
    existente.titulo = titulo || existente.titulo || "";
    existente.hoja = hoja || existente.hoja || "";
    await setListasGuardadas(listas);
    await chrome.storage.local.set({ listaActivaId: existente.id });
    return;
  }
  const nueva = {
    id: nuevoIdLista(),
    name: listas.length ? `Lista ${listas.length + 1}` : "Mi lista",
    url: String(enlace).trim(),
    spreadsheetId: p.spreadsheetId,
    gid: p.gid,
    titulo: titulo || "",
    hoja: hoja || ""
  };
  listas.push(nueva);
  await setListasGuardadas(listas);
  await chrome.storage.local.set({ listaActivaId: nueva.id });
}

async function agregarListaGuardada(nombre, enlace) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("FALTA_NOMBRE");
  const p = parsearEnlaceSheet(enlace);
  if (!p) throw new Error("ENLACE_INVALIDO");
  const { titulo, hoja } = await verificarAccesoHojaParaLista(p);
  const listas = await getListasGuardadas();
  const nueva = {
    id: nuevoIdLista(),
    name: nombreLimpio,
    url: String(enlace).trim(),
    spreadsheetId: p.spreadsheetId,
    gid: p.gid,
    titulo,
    hoja
  };
  listas.push(nueva);
  await setListasGuardadas(listas);
  return { id: nueva.id, name: nueva.name, titulo, hoja };
}

async function cambiarListaActiva(id) {
  const listas = await getListasGuardadas();
  const lista = listas.find((l) => l.id === id);
  if (!lista) throw new Error("LISTA_NO_ENCONTRADA");

  await chrome.storage.local.set({
    config: {
      spreadsheetId: lista.spreadsheetId,
      gid: lista.gid,
      url: lista.url,
      titulo: lista.titulo,
      hoja: lista.hoja
    },
    listaActivaId: lista.id
  });
  resetConfig();
  chrome.action.setBadgeText({ text: "" });
  return { titulo: lista.titulo, hoja: lista.hoja, name: lista.name };
}

async function eliminarListaGuardada(id) {
  let listas = await getListasGuardadas();
  const activaId = (await chrome.storage.local.get("listaActivaId")).listaActivaId || null;
  const restantes = listas.filter((l) => l.id !== id);
  if (restantes.length === listas.length) throw new Error("LISTA_NO_ENCONTRADA");

  if (activaId === id) {
    const siguiente = restantes[0] || null;
    if (siguiente) {
      await chrome.storage.local.set({
        listas: restantes,
        listaActivaId: siguiente.id,
        config: {
          spreadsheetId: siguiente.spreadsheetId,
          gid: siguiente.gid,
          url: siguiente.url,
          titulo: siguiente.titulo,
          hoja: siguiente.hoja
        }
      });
    } else {
      await chrome.storage.local.set({ listas: restantes, listaActivaId: null });
      await chrome.storage.local.remove("config");
    }
    resetConfig();
  } else {
    await setListasGuardadas(restantes);
  }
  return { removed: true };
}

async function cambiarCuenta() {
  if (chrome.identity.clearAllCachedAuthTokens) {
    await chrome.identity.clearAllCachedAuthTokens();
  }
  // Forzar una autenticación interactiva para que Chrome permita elegir
  // nuevamente la cuenta.
  await getAuthToken(true);
  return { changed: true };
}


// Nombre de pestaña entre comillas simples (necesario si tiene espacios, p. ej. "Hoja 1")
function rango(nombreHoja, celdas) {
  return `'${nombreHoja.replace(/'/g, "''")}'!${celdas}`;
}

async function sheetsFetch(path, token, options = {}) {
  await cargarConfig();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    throw new Error("TOKEN_INVALIDO");
  }
  if (res.status === 404) throw new Error("HOJA_NO_ENCONTRADA");
  if (res.status === 403) throw new Error("SIN_PERMISO");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error de Sheets API (${res.status}): ${text}`);
  }
  return res.json();
}

let cachedSheetName = null;
async function getSheetName(token) {
  if (cachedSheetName) return cachedSheetName;
  await cargarConfig();
  const data = await sheetsFetch("?fields=sheets.properties", token);
  const hojas = (data.sheets || []).map((s) => s.properties);
  const hoja = (GID_CONFIG !== null && hojas.find((h) => h.sheetId === GID_CONFIG)) || hojas[0];
  if (!hoja) throw new Error("El documento no tiene ninguna pestaña");
  GID = hoja.sheetId;
  cachedSheetName = hoja.title;
  return cachedSheetName;
}

// --- Lectura de columnas -----------------------------------------------

// Trae las filas de la columna D a la K (título+enlace, descripción,
// estado, género... portada, y ahora también el último capítulo visto).
// Índice dentro de "values": 0=D,1=E,2=F,3=G,4=H,5=I,6=J,7=K
async function getFilasDaK(token, sheetName) {
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(rango(sheetName, "D:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink)`,
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

// --- Escritura de celdas ---------------------------------------------------

async function actualizarSoloEstado(token, row, estado) {
  await getSheetName(token);
  const requests = [
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 5, endColumnIndex: 6 },
        rows: [{ values: [{ userEnteredValue: { stringValue: estado } }] }],
        fields: "userEnteredValue",
      },
    },
  ];
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

// Columna K (índice absoluto 10): URL del último capítulo visto.
async function actualizarUltimoCapitulo(token, row, episodeUrl) {
  if (!episodeUrl) return;
  await getSheetName(token);
  const requests = [
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 10, endColumnIndex: 11 },
        rows: [{ values: [{ userEnteredValue: { stringValue: episodeUrl } }] }],
        fields: "userEnteredValue",
      },
    },
  ];
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

async function escribirFilaNueva(token, row, { title, url, score, description, cover, episodeUrl }) {
  const requests = [
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 2, endColumnIndex: 3 },
        rows: [
          {
            values: [
              {
                userEnteredValue: score ? { numberValue: parseFloat(score) } : { stringValue: "" },
                userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.0" } },
              },
            ],
          },
        ],
        fields: "userEnteredValue,userEnteredFormat.numberFormat",
      },
    },
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 3, endColumnIndex: 4 },
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: title },
                textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }],
              },
            ],
          },
        ],
        fields: "userEnteredValue,textFormatRuns",
      },
    },
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 4, endColumnIndex: 5 },
        rows: [{ values: [{ userEnteredValue: { stringValue: description || "" } }] }],
        fields: "userEnteredValue",
      },
    },
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 5, endColumnIndex: 6 },
        rows: [{ values: [{ userEnteredValue: { stringValue: ESTADO_VIENDO } }] }],
        fields: "userEnteredValue",
      },
    },
  ];

  if (cover) {
    requests.push({
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 9, endColumnIndex: 10 },
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${cover}",1)` } }] }],
        fields: "userEnteredValue",
      },
    });
    precachearImagen(cover);
  }

  if (episodeUrl) {
    requests.push({
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 10, endColumnIndex: 11 },
        rows: [{ values: [{ userEnteredValue: { stringValue: episodeUrl } }] }],
        fields: "userEnteredValue",
      },
    });
  }

  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

// --- Configuración de la hoja ---------------------------------------------------

// Acepta un enlace completo de Google Sheets (con o sin #gid=...) o solo el ID.
function parsearEnlaceSheet(texto) {
  const t = String(texto || "").trim();
  const m = t.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : /^[a-zA-Z0-9_-]{25,}$/.test(t) ? t : null;
  if (!id) return null;
  const g = t.match(/[#&?]gid=(\d+)/);
  return { spreadsheetId: id, gid: g ? parseInt(g[1], 10) : null };
}

async function guardarConfig(enlace) {
  const p = parsearEnlaceSheet(enlace);
  if (!p) throw new Error("ENLACE_INVALIDO");

  // Comprobamos que la cuenta de Google tiene acceso antes de guardar nada
  const token = await getAuthToken(true);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${p.spreadsheetId}?fields=properties.title,sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    throw new Error("TOKEN_INVALIDO");
  }
  if (res.status === 404) throw new Error("HOJA_NO_ENCONTRADA");
  if (res.status === 403) throw new Error("SIN_PERMISO");
  if (!res.ok) throw new Error(`Error de Sheets API (${res.status})`);

  const data = await res.json();
  const hojas = (data.sheets || []).map((s) => s.properties);
  const hoja = (p.gid !== null && hojas.find((h) => h.sheetId === p.gid)) || hojas[0];
  if (!hoja) throw new Error("El documento no tiene ninguna pestaña");

  await chrome.storage.local.set({
    config: {
      spreadsheetId: p.spreadsheetId,
      gid: p.gid,
      url: String(enlace).trim(),
      titulo: data.properties?.title || "",
      hoja: hoja.title,
    },
  });
  resetConfig();
  chrome.action.setBadgeText({ text: "" });

  const encabezadosCreados = await asegurarEncabezados(token);
  return { titulo: data.properties?.title || "", hoja: hoja.title, encabezadosCreados };
}

// Si la fila 1 está vacía (hoja nueva), escribe los encabezados. La extensión
// asume que la fila 1 es de encabezados y los datos empiezan en la fila 2.
async function asegurarEncabezados(token) {
  const nombre = await getSheetName(token);
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(rango(nombre, "A1:K1"))}&fields=sheets.data.rowData.values(formattedValue)`,
    token
  );
  const fila = data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
  if (fila.some((c) => (c.formattedValue || "").trim())) return false;

  // A=género, C=nota, D=título+enlace, E=descripción, F=estado, J=portada, K=último capítulo
  const encabezados = ["Género", "", "Nota", "Título", "Descripción", "Estado", "", "", "", "Portada", "Último capítulo"];
  const requests = [
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: encabezados.length },
        rows: [{ values: encabezados.map((t) => ({ userEnteredValue: { stringValue: t }, userEnteredFormat: { textFormat: { bold: true } } })) }],
        fields: "userEnteredValue,userEnteredFormat.textFormat",
      },
    },
  ];
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
  return true;
}

// --- Notificación para preguntar al usuario --------------------------------

function crearNotificacionPregunta(nuevoTitulo, existingTitle) {
  const notifId = `sequel-${Date.now()}`;
  return new Promise((resolve) => {
    chrome.notifications.create(
      notifId,
      {
        type: "basic",
        iconUrl: "icon128.png",
        title: "¿Misma serie?",
        message: `"${nuevoTitulo}" parece relacionado con "${existingTitle}", que ya tienes en la lista. ¿Qué quieres hacer?`,
        buttons: [{ title: "Marcar existente como viendo" }, { title: "Crear registro nuevo" }],
        requireInteraction: true,
      },
      () => resolve(notifId)
    );
  });
}

const pendientes = {}; // notifId -> { token, existingRow, nuevaFila, slug }

chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
  const info = pendientes[notifId];
  if (!info) return;
  delete pendientes[notifId];
  chrome.notifications.clear(notifId);

  try {
    if (buttonIndex === 0) {
      await actualizarSoloEstado(info.token, info.existingRow, ESTADO_VIENDO);
      await actualizarUltimoCapitulo(info.token, info.existingRow, info.nuevaFila.episodeUrl);
    } else {
      const sheetName = await getSheetName(info.token);
      const filas = await getFilasDaK(info.token, sheetName);
      const row = filas.length + 1;
      await escribirFilaNueva(info.token, row, info.nuevaFila);
    }
    avisarOk();
  } catch (e) {
    console.error("[AnimeAV1 Tracker] Error tras la respuesta del usuario:", e);
  }
});

chrome.notifications.onClosed.addListener((notifId) => {
  delete pendientes[notifId];
});

function avisarOk() {
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  chrome.action.setBadgeText({ text: "OK" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
}

// --- Flujo principal (registrar / resincronizar estado) ---------------------

async function handleRegisterAnime({ slug, title, url, score, description, cover, episodeUrl }) {
  let token;
  try {
    token = await getAuthToken(true);
  } catch (e) {
    console.error("[AnimeAV1 Tracker] No se pudo autenticar con Google:", e);
    return;
  }

  if (cover) precachearImagen(cover);

  const ejecutar = async () => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaK(token, sheetName);

    const tituloNorm = title.trim().toLowerCase();

    // 1) ¿Ya existe una fila con el MISMO título? -> resincronizamos estado y último capítulo
    for (let i = 0; i < filas.length; i++) {
      const v = filas[i].values || [];
      const existente = (v[0]?.formattedValue || "").trim();
      if (existente.toLowerCase() === tituloNorm) {
        const row = i + 1;
        const estadoActual = (v[2]?.formattedValue || "").trim();
        if (estadoActual !== ESTADO_VIENDO) {
          await actualizarSoloEstado(token, row, ESTADO_VIENDO);
        }
        await actualizarUltimoCapitulo(token, row, episodeUrl);
        avisarOk();
        return;
      }
    }

    // 2) ¿Hay una temporada/parte relacionada con título distinto?
    const nuevoCore = coreTitle(title);
    if (nuevoCore) {
      for (let i = 0; i < filas.length; i++) {
        const v = filas[i].values || [];
        const existente = (v[0]?.formattedValue || "").trim();
        if (!existente) continue;
        if (coreTitle(existente) === nuevoCore) {
          const notifId = await crearNotificacionPregunta(title, existente);
          pendientes[notifId] = {
            token,
            existingRow: i + 1,
            nuevaFila: { title, url, score, description, cover, episodeUrl },
            slug,
          };
          return;
        }
      }
    }

    // 3) No hay coincidencia: fila nueva
    const row = filas.length + 1;
    await escribirFilaNueva(token, row, { title, url, score, description, cover, episodeUrl });
    avisarOk();
  };

  try {
    await ejecutar();
  } catch (e) {
    if (String(e).includes("SIN_CONFIG")) {
      // Aún no hay hoja elegida: avisamos con una insignia en el icono
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      chrome.action.setBadgeText({ text: "!" });
    } else if (String(e).includes("TOKEN_INVALIDO")) {
      token = await getAuthToken(true);
      await ejecutar();
    } else {
      throw e;
    }
  }
}

// --- Lista completa para el popup (con filtros/orden en el propio popup) ---

// Columnas A:K -> índices dentro del array "values" de cada fila:
// 0=A,1=B,2=C,3=D,4=E,5=F,6=G,7=H,8=I,9=J,10=K
async function obtenerListaCompleta() {
  const token = await getAuthToken(true);
  const sheetName = await getSheetName(token);
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(rango(sheetName, "A:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)`,
    token
  );
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];
  const lista = [];
  rowData.forEach((r, i) => {
    if (i === 0) return; // fila 1 = encabezados
    const values = r.values || [];
    const titulo = values[3]?.formattedValue || ""; // columna D
    if (!titulo) return;
    const cover = extraerUrlImagen(values[9]); // columna J
    if (cover) precachearImagen(cover);
    lista.push({
      row: i + 1,
      genre: values[0]?.formattedValue || "", // columna A
      score: values[2]?.formattedValue || "", // columna C
      title: titulo,
      url: values[3]?.hyperlink || "",
      status: (values[5]?.formattedValue || "").trim(), // columna F
      cover,
      lastEpisodeUrl: values[10]?.formattedValue || values[10]?.hyperlink || "", // columna K
    });
  });
  return lista;
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

const COLUMNAS_EDITABLES = { score: 2, status: 5, genre: 0, cover: 9, lastEpisodeUrl: 10 };

async function actualizarCampo(row, campo, valor) {
  const token = await getAuthToken(true);
  await getSheetName(token);
  const colIndex = COLUMNAS_EDITABLES[campo];
  if (colIndex === undefined) throw new Error("Campo desconocido: " + campo);

  const celda = { userEnteredValue: null };
  const fields = ["userEnteredValue"];

  if (campo === "score") {
    const num = parseFloat(String(valor).replace(",", "."));
    celda.userEnteredValue = isNaN(num) ? { stringValue: "" } : { numberValue: num };
    celda.userEnteredFormat = { numberFormat: { type: "NUMBER", pattern: "0.0" } };
    fields.push("userEnteredFormat.numberFormat");
  } else if (campo === "cover") {
    celda.userEnteredValue = valor ? { formulaValue: `=IMAGE("${valor}",1)` } : { stringValue: "" };
    if (valor) precachearImagen(valor);
  } else {
    celda.userEnteredValue = { stringValue: valor };
  }

  const requests = [
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
        rows: [{ values: [celda] }],
        fields: fields.join(","),
      },
    },
  ];

  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

// Título y enlace viven en la misma celda (columna D): el texto es el
// título, y el enlace va como hyperlink sobre ese texto.
async function actualizarTituloUrl(row, title, url) {
  const token = await getAuthToken(true);
  await getSheetName(token);
  const requests = [
    {
      updateCells: {
        range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 3, endColumnIndex: 4 },
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: title },
                textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }],
              },
            ],
          },
        ],
        fields: "userEnteredValue,textFormatRuns",
      },
    },
  ];
  await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

// --- Rellenar portadas que faltan (columna J) ------------------------------

function extraerPortadaDesdeHtml(html) {
  const match = html.match(/cdn\.animeav1\.com\/covers\/\d+\.jpg/i);
  return match ? `https://${match[0]}` : null;
}

async function rellenarPortadas() {
  const token = await getAuthToken(true);
  const sheetName = await getSheetName(token);
  const filas = await getFilasDaK(token, sheetName);

  const requests = [];
  let encontradas = 0;
  let sinImagen = 0;

  for (let i = 0; i < filas.length; i++) {
    const values = filas[i].values || [];
    const tituloUrl = values[0]?.hyperlink;
    const yaTienePortada = (values[6]?.formattedValue || "").trim() !== "";
    if (!tituloUrl || yaTienePortada) continue;

    try {
      const res = await fetch(tituloUrl);
      const html = await res.text();
      const imagenUrl = extraerPortadaDesdeHtml(html);
      if (!imagenUrl) {
        sinImagen++;
        continue;
      }
      requests.push({
        updateCells: {
          range: { sheetId: GID, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 9, endColumnIndex: 10 },
          rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${imagenUrl}",1)` } }] }],
          fields: "userEnteredValue",
        },
      });
      precachearImagen(imagenUrl);
      encontradas++;
    } catch (e) {
      console.error("[AnimeAV1 Tracker] Error obteniendo portada para", tituloUrl, e);
      sinImagen++;
    }
  }

  if (requests.length > 0) {
    await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
  }

  return { encontradas, sinImagen };
}


// --- Gestión de varios géneros -----------------------------------------------

async function actualizarGenerosLote(cambios) {
  const token = await getAuthToken(true);
  await getSheetName(token);
  if (!Array.isArray(cambios) || !cambios.length) return;
  const requests = cambios.map((c) => ({
    updateCells: {
      range: {
        sheetId: GID,
        startRowIndex: c.row - 1,
        endRowIndex: c.row,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      rows: [{ values: [{ userEnteredValue: { stringValue: String(c.valor ?? "") } }] }],
      fields: "userEnteredValue",
    },
  }));
  await sheetsFetch(":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

// --- Añadir anime por enlace desde el popup ----------------------------------

async function siguienteFilaLibre(token, sheetName) {
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(rango(sheetName, "D:D"))}&fields=sheets.data.rowData.values(formattedValue)`,
    token
  );
  const filas = data.sheets?.[0]?.data?.[0]?.rowData || [];
  let ultimaConTitulo = 1;
  filas.forEach((r, i) => {
    if ((r?.values?.[0]?.formattedValue || "").trim()) ultimaConTitulo = i + 1;
  });
  return ultimaConTitulo + 1;
}

async function registrarAnimePorUrl(enlace) {
  const url = String(enlace || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("ENLACE_ANIME_INVALIDO");

  const lista = await obtenerListaCompleta();
  const canon = (s) => String(s || "").replace(/\/+$/, "");
  if (lista.some((a) => a.url && canon(a.url) === canon(url))) {
    throw new Error("YA_EXISTE");
  }

  let html;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    html = await res.text();
  } catch (e) {
    throw new Error("NO_SE_PUDO_LEER_LA_PAGINA");
  }

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = h1Match ? h1Match[1].trim() : "";
  if (!title) throw new Error("SIN_TITULO");
  const cover = extraerPortadaDesdeHtml(html);

  const token = await getAuthToken(true);
  const sheetName = await getSheetName(token);
  const row = await siguienteFilaLibre(token, sheetName);
  const valores = new Array(11).fill(null).map(() => ({}));

  valores[3] = {
    userEnteredValue: { stringValue: title },
    textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }],
  };
  valores[5] = { userEnteredValue: { stringValue: ESTADO_VIENDO } };
  if (cover) valores[9] = { userEnteredValue: { formulaValue: `=IMAGE("${cover}",1)` } };

  await sheetsFetch(":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({
      requests: [{
        updateCells: {
          range: { sheetId: GID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 11 },
          rows: [{ values: valores }],
          fields: "userEnteredValue,textFormatRuns",
        },
      }],
    }),
  });

  if (cover) precachearImagen(cover);
  return { row, title, url, cover: cover || "", status: ESTADO_VIENDO };
}

// --- Migrar enlaces de AnimeFLV a AnimeAV1 ---------------------------------

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
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const h1 = h1Match ? h1Match[1].trim() : "";
    if (!h1 || normalizarTitulo(h1) !== normalizarTitulo(titulo)) return null;
    return { url, html };
  } catch (e) {
    return null;
  }
}

function extraerPortadaAnimeFlv(html) {
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1) return m1[1];
  const m2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m2 ? m2[1] : null;
}

async function migrarAnimeFlv() {
  const token = await getAuthToken(true);
  const sheetName = await getSheetName(token);
  const filas = await getFilasDaK(token, sheetName);

  const requests = [];
  let migradas = 0;
  let portadasFlv = 0;
  let sinCambios = 0;

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
          range: { sheetId: GID, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 3, endColumnIndex: 4 },
          rows: [
            {
              values: [
                {
                  userEnteredValue: { stringValue: titulo },
                  textFormatRuns: [{ startIndex: 0, format: { link: { uri: encontrado.url } } }],
                },
              ],
            },
          ],
          fields: "userEnteredValue,textFormatRuns",
        },
      });
      migradas++;

      if (!yaTienePortada) {
        const imagenUrl = extraerPortadaDesdeHtml(encontrado.html);
        if (imagenUrl) {
          requests.push({
            updateCells: {
              range: { sheetId: GID, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 9, endColumnIndex: 10 },
              rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${imagenUrl}",1)` } }] }],
              fields: "userEnteredValue",
            },
          });
          precachearImagen(imagenUrl);
        }
      }
    } else if (!yaTienePortada) {
      try {
        const res = await fetch(enlace);
        const html = await res.text();
        const imagenUrl = extraerPortadaAnimeFlv(html);
        if (imagenUrl) {
          requests.push({
            updateCells: {
              range: { sheetId: GID, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 9, endColumnIndex: 10 },
              rows: [{ values: [{ userEnteredValue: { formulaValue: `=IMAGE("${imagenUrl}",1)` } }] }],
              fields: "userEnteredValue",
            },
          });
          precachearImagen(imagenUrl);
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
}
