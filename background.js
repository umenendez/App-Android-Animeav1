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
let LISTA_LOCAL_ID = null; // id de la lista activa si es una lista local (sin Google Sheets)
const ESTADO_VIENDO = "-";
const COVER_CACHE = "anime-covers-v1";

// --- Listas en la nube (Cloudflare D1) ---------------------------------------------
// NUBE_WORKER_URL: el Worker (worker-completo.js). NUBE_CLIENT_ID: el OAuth Client ID de tipo
// «Aplicación web» que ya usa el Worker como GOOGLE_CLIENT_ID (el mismo de la PWA). Solo se usa para
// identificar la cuenta (openid/email), no da acceso a Sheets ni a Drive.
const NUBE_WORKER_URL = "https://red-violet-9fed.unaxmenendez.workers.dev";
const NUBE_CLIENT_ID = "123415018434-6dicvlgt2j37v841f9m0hricunuatp9c.apps.googleusercontent.com";

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

function manejarMensaje(message, sender, sendResponse) {
  // Añadir anime por enlace desde el popup
  // Último capítulo publicado de una serie (lo usa el botón «Siguiente capítulo» del popup)
  // Icono personalizado de la barra de herramientas (lo manda el popup, ya recortado y en varios tamaños)
  // --- Otras páginas fuente (BETA) ---
  // Completa la portada de una serie ya registrada (la página de la serie puede tardar en dibujarse, así que se
  // hace después de registrar el capítulo). Sin `cover`: solo responde si la serie necesita portada.
  if (message.type === "PORTADA_SERIE") {
    portadaSerie(message)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "INICIAR_ASISTENTE_FUENTE") {
    iniciarAsistenteFuente(message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GUARDAR_FUENTE") {
    guardarFuente(message.receta)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "CANCELAR_ASISTENTE_FUENTE") {
    chrome.storage.local.remove("asistenteFuente").then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "GET_FUENTES") {
    chrome.storage.local.get("fuentes").then(({ fuentes }) => sendResponse({ ok: true, fuentes: fuentes || [] }));
    return true;
  }
  if (message.type === "ACTUALIZAR_FUENTE") {
    actualizarFuente(message.id, { activa: message.activa, lista: message.lista, capitulo: message.capitulo, receta: message.receta })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "ACTIVAR_REFERER") {
    activarReferer(message.id, message.hosts)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "BORRAR_FUENTE") {
    borrarFuente(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "SET_ICONO") {
    guardarIconoPersonal(message.iconos)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "RESET_ICONO") {
    chrome.storage.local.remove("iconoPersonal")
      .then(() => chrome.action.setIcon({ path: { 16: "icon16.png", 48: "icon48.png", 128: "icon128.png" } }))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "REPARAR_FUENTES") {
    asegurarScriptsFuentes({ inyectar: true })
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GET_FALLO") {
    chrome.storage.local.get("ultimoFallo").then(({ ultimoFallo }) => sendResponse({ ok: true, fallo: ultimoFallo || null }));
    return true;
  }
  if (message.type === "CLEAR_FALLO") {
    limpiarFallo().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "ENLACES_CAP") {
    guardarEnlacesCap(message.origen, message.rutas)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "CAP_EXISTE") {
    capituloSiguienteExiste(message)
      .then((existe) => sendResponse({ ok: true, existe }))
      .catch(() => sendResponse({ ok: true, existe: null }));
    return true;
  }
  if (message.type === "COMPROBAR_FINAL") {
    comprobarFinal(message.slug, message.ep)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch(() => sendResponse({ ok: true, proponer: false })); // sin sesión, sin lista, sin red…: simplemente no se propone
    return true;
  }
  if (message.type === "MARCAR_VISTO") {
    marcarVisto(message.slug)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "DESCARTAR_FINAL") {
    descartarFinal(message.slug, message.ep)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "GET_AVISOS") {
    Promise.all([avisosActivos(), calcularPendientesAvisos()])
      .then(([activo, pend]) => sendResponse({ ok: true, activo, pendientes: pend.length }))
      .catch(() => sendResponse({ ok: true, activo: false, pendientes: 0 }));
    return true;
  }
  if (message.type === "SET_AVISOS") {
    activarAvisos(!!message.activo)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GET_CAPITULOS") {
    infoCapitulos(message.slug)
      .then((i) => sendResponse({ ok: true, max: i?.max ?? null, emision: i?.emision ?? null }))
      .catch(() => sendResponse({ ok: true, max: null, emision: null }));
    return true;
  }
  if (message.type === "REGISTER_ANIME") {
    registrarAnimePorUrl(message.url)
      .then((resultado) => sendResponse({ ok: true, ...(resultado || {}) }))
      .catch((err) => {
        console.error("[AnimeAV1 Tracker]", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }
  // El content script avisa de que se ha abierto un episodio
  if (message.type === "EPISODIO_DETECTADO") {
    handleEpisodioDetectado(message)
      .then((resultado) => sendResponse({ ok: true, ...(resultado || {}) }))
      .catch((err) => {
        console.error("[AnimeAV1 Tracker]", err);
        registrarFallo(err, message);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }
  // Respuesta del usuario a "¿Es la misma serie?"
  if (message.type === "RESOLVER_SECUELA") {
    resolverSecuela(message)
      .then(() => sendResponse({ ok: true }))
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
  if (message.type === "ADD_LISTA_LOCAL") {
    agregarListaLocal(message.name, message.series)
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "ADD_SERIE_LOCAL") {
    agregarSerieLocal(message.serie)
      .then((row) => sendResponse({ ok: true, row }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "ADD_SERIE_COMPLETA") { // mover serie: se añade a la lista indicada (listaId) con todos sus datos
    agregarSerieCompleta(message.serie)
      .then((row) => sendResponse({ ok: true, row }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "DELETE_SERIE") { // quita una serie de la lista activa (local u hoja de Google)
    eliminarSerie(message.row, message.title)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "DELETE_SERIE_LOCAL") {
    eliminarSerieLocal(message.row)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "EXPORT_LISTA_LOCAL") {
    exportarListaLocal(message.id)
      .then((datos) => sendResponse({ ok: true, datos }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "RENAME_LISTA") {
    renombrarLista(message.id, message.name)
      .then(() => sendResponse({ ok: true }))
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
  // El popup ofrece "Iniciar sesión con Google" cuando la lista no carga por sesión
  // caducada. Pide el token de forma interactiva para que aparezca el selector de
  // cuentas. La PWA tiene su propio case "LOGIN" en pwa-api.js (mismo contrato).
  if (message.type === "LOGIN") {
    getAuthToken(true)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[AnimeAV1 Tracker]", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }
  // La página de inicio de animeav1.com pide que el índice de series «Viendo» esté al día
  if (message.type === "REFRESCAR_VIENDO") {
    refrescarIndiceViendo({ force: !!message.force })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === "GET_ANIME_LIST") {
    obtenerListaCompleta({ sinSync: !!message.sinSync })
      .then((lista) => sendResponse({ ok: true, lista, nube: estadoNube }))
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
    // Se añade el id de la lista activa: el catálogo de géneros del popup es propio de cada lista.
    // obtenerListasParaUI() garantiza que una instalación antigua ya tiene su lista (y su id).
    (async () => {
      await obtenerListasParaUI().catch(() => {});
      const { config, listaActivaId } = await chrome.storage.local.get(["config", "listaActivaId"]);
      return config ? { ...config, listaId: listaActivaId || null } : null;
    })()
      .then((config) => sendResponse({ ok: true, config }))
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
  // --- Vínculo hoja ↔ nube ---
  if (typeof message.type === "string" && message.type.startsWith("VINCULO_")) {
    manejarMensajeVinculo(message)
      .then((resultado) => sendResponse({ ok: true, ...(resultado || {}) }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  // --- Listas en la nube (Cloudflare D1) ---
  if (typeof message.type === "string" && message.type.startsWith("NUBE_")) {
    manejarMensajeNube(message)
      .then((resultado) => sendResponse({ ok: true, ...(resultado || {}) }))
      .catch((err) => {
        const e = String(err?.message || err);
        sendResponse({ ok: false, error: e });
      });
    return true;
  }
  if (message.type === "MIGRATE_ANIMEFLV") {
    migrarAnimeFlv()
      .then((resultado) => sendResponse({ ok: true, ...resultado }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
}

// --- Despacho de mensajes con bloqueo de lista -----------------------------------------------
// Casi todo lo que llega depende de la lista activa (la configuración en memoria: SPREADSHEET_ID,
// LISTA_LOCAL_ID...). Las páginas fuente pueden pedir registrar en OTRA lista (message.listaId) sin cambiar
// la activa. Para que eso no pise operaciones en curso hay un bloqueo lector/escritor: las operaciones
// normales van en paralelo (lectores) y las de «otra lista» son exclusivas (escritor) y fuerzan su lista
// mientras duran (CONFIG_FORZADA).
const SIN_LISTA = new Set(["ACTIVAR_REFERER", "GET_FUENTES", "GUARDAR_FUENTE", "CANCELAR_ASISTENTE_FUENTE", "INICIAR_ASISTENTE_FUENTE", "ACTUALIZAR_FUENTE", "BORRAR_FUENTE", "SET_ICONO", "RESET_ICONO", "GET_CAPITULOS", "GET_AVISOS", "SET_AVISOS", "DESCARTAR_FINAL", "CAP_EXISTE", "ENLACES_CAP", "GET_FALLO", "CLEAR_FALLO", "REPARAR_FUENTES", "NUBE_ESTADO", "NUBE_LOGIN", "NUBE_CERRAR_SESION", "NUBE_LISTAR", "NUBE_CREAR", "NUBE_ANADIR", "NUBE_MIEMBROS", "NUBE_COMPARTIR", "NUBE_QUITAR_MIEMBRO", "NUBE_ENLACE", "NUBE_ENLACE_CREAR", "NUBE_ENLACE_QUITAR", "NUBE_SINCRONIZAR", "NUBE_ESPERAR_SYNC", "NUBE_BORRAR", "VINCULO_CREAR", "VINCULO_QUITAR", "VINCULO_SINCRONIZAR"]);
let CONFIG_FORZADA = null;
const bloqueo = { lectores: 0, escribiendo: false, cola: [] };
function avanzarBloqueo() {
  while (bloqueo.cola.length) {
    const s = bloqueo.cola[0];
    if (s.tipo === "r" && !bloqueo.escribiendo) { bloqueo.cola.shift(); bloqueo.lectores++; s.res(); }
    else if (s.tipo === "w" && !bloqueo.escribiendo && bloqueo.lectores === 0) { bloqueo.cola.shift(); bloqueo.escribiendo = true; s.res(); }
    else break;
  }
}
const adquirirBloqueo = (tipo) => new Promise((res) => { bloqueo.cola.push({ tipo, res }); avanzarBloqueo(); });
function liberarBloqueo(tipo) {
  if (tipo === "r") bloqueo.lectores--; else bloqueo.escribiendo = false;
  avanzarBloqueo();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (SIN_LISTA.has(message?.type)) return manejarMensaje(message, sender, sendResponse);
  (async () => {
    const { listaActivaId, listas = [] } = await chrome.storage.local.get(["listaActivaId", "listas"]);
    const otra = !!message.listaId && message.listaId !== listaActivaId;
    const tipo = otra ? "w" : "r";
    await adquirirBloqueo(tipo);
    let liberado = false;
    const terminar = () => {
      if (liberado) return;
      liberado = true;
      clearTimeout(seguridad);
      if (tipo === "w") { CONFIG_FORZADA = null; resetConfig(true); }
      liberarBloqueo(tipo);
    };
    const seguridad = setTimeout(terminar, 120000); // por si un manejador no llegara a responder
    const responder = (x) => { terminar(); try { sendResponse(x); } catch (e) {} };
    try {
      if (otra) {
        const lista = listas.find((l) => l.id === message.listaId);
        if (!lista) { responder({ ok: false, error: "LISTA_NO_ENCONTRADA" }); return; }
        resetConfig(true);
        CONFIG_FORZADA = configDeLista(lista);
      }
      if (!manejarMensaje(message, sender, responder)) responder(); // manejador síncrono: no habrá respuesta posterior
    } catch (e) { responder({ ok: false, error: String(e) }); }
  })();
  return true;
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
    const res = await fetch(url, { referrerPolicy: "no-referrer" });
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
  const config = CONFIG_FORZADA || (await chrome.storage.local.get("config")).config;
  if ((config?.tipo === "local" || config?.tipo === "nube") && config.listaId) {
    // Lista local: no hay hoja. SPREADSHEET_ID/GID se rellenan con valores propios para que
    // las claves que dependen de ellos (vínculos de temporadas, índice «Viendo») sigan siendo únicas.
    LISTA_LOCAL_ID = config.listaId;
    SPREADSHEET_ID = `${config.tipo}:${config.listaId}`;
    GID_CONFIG = 0;
    GID = 0;
    return;
  }
  if (!config || !config.spreadsheetId) throw new Error("SIN_CONFIG");
  SPREADSHEET_ID = config.spreadsheetId;
  GID_CONFIG = config.gid ?? null;
}

function resetConfig(conservarIndice) {
  SPREADSHEET_ID = null;
  GID_CONFIG = null;
  LISTA_LOCAL_ID = null;
  cachedSheetName = null;
  // El índice de series «Viendo» pertenece a la hoja anterior: se descarta.
  if (!conservarIndice) chrome.storage.local.remove("indiceViendo").catch(() => {});
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

// Configuración activa que corresponde a una lista guardada (hoja de Google o lista local)
function configDeLista(l) {
  if (l.tipo === "local" || l.tipo === "nube") return { tipo: l.tipo, listaId: l.id, url: l.url, titulo: l.titulo, hoja: "" };
  return { spreadsheetId: l.spreadsheetId, gid: l.gid, url: l.url, titulo: l.titulo, hoja: l.hoja };
}

async function cambiarListaActiva(id) {
  const listas = await getListasGuardadas();
  const lista = listas.find((l) => l.id === id);
  if (!lista) throw new Error("LISTA_NO_ENCONTRADA");

  await chrome.storage.local.set({
    config: configDeLista(lista),
    listaActivaId: lista.id
  });
  resetConfig();
  actualizarBadgeAvisos();
  return { titulo: lista.titulo, hoja: lista.hoja, name: lista.name };
}

// Cambia el nombre con el que se ve una lista guardada (en las locales es también su título)
async function renombrarLista(id, nombre) {
  const name = String(nombre ?? "").trim().slice(0, 60);
  if (!name) throw new Error("FALTA_NOMBRE");
  const listas = await getListasGuardadas();
  const l = listas.find((x) => x.id === id);
  if (!l) throw new Error("LISTA_NO_ENCONTRADA");
  l.name = name;
  if (l.tipo === "local" || l.tipo === "nube") l.titulo = name;
  await setListasGuardadas(listas);
  if (l.tipo === "nube" && l.rol === "propietario") nubeFetch(`/api/listas/${encodeURIComponent(id)}`, { method: "PATCH", body: { nombre: name } }).catch(() => {});
  const { listaActivaId, config } = await chrome.storage.local.get(["listaActivaId", "config"]);
  if (listaActivaId === id && config && (l.tipo === "local" || l.tipo === "nube")) await chrome.storage.local.set({ config: { ...config, titulo: name } });
}

async function eliminarListaGuardada(id) {
  let listas = await getListasGuardadas();
  const activaId = (await chrome.storage.local.get("listaActivaId")).listaActivaId || null;
  const restantes = listas.filter((l) => l.id !== id);
  if (restantes.length === listas.length) throw new Error("LISTA_NO_ENCONTRADA");
  const quitada = listas.find((l) => l.id === id);
  if (quitada?.tipo === "local" || quitada?.tipo === "nube") await chrome.storage.local.remove(claveDatosLocal(id));
  if (quitada?.vinculo) { // la otra lista del vínculo queda suelta
    const par = restantes.find((l) => l.id === quitada.vinculo.con);
    if (par) delete par.vinculo;
    await chrome.storage.local.remove([claveBaseVinculo(id, quitada.vinculo.con), claveBaseVinculo(quitada.vinculo.con, id)]);
  }

  if (activaId === id) {
    const siguiente = restantes[0] || null;
    if (siguiente) {
      await chrome.storage.local.set({
        listas: restantes,
        listaActivaId: siguiente.id,
        config: configDeLista(siguiente)
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
  GRID_FILAS = hoja.gridProperties?.rowCount ?? null;
  cachedSheetName = hoja.title;
  return cachedSheetName;
}

// --- Lectura de columnas -----------------------------------------------

// Trae las filas de la columna D a la K (título+enlace, descripción,
// estado, género... portada, y ahora también el último capítulo visto).
// Índice dentro de "values": 0=D,1=E,2=F,3=G,4=H,5=I,6=J,7=K
async function getFilasDaK(token, sheetName) {
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(rango(sheetName, "D:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)`,
    token
  );
  return data.sheets?.[0]?.data?.[0]?.rowData || [];
}

// --- Detección de series relacionadas (temporadas, partes, arcos…) ---------
// Reduce un título (o un slug) a su "núcleo": quita marcadores de temporada/parte
// en inglés y castellano ("3rd Season", "Season 3", "Segunda Temporada",
// "Part 2", "Cour 2", "Final Season", "II", "2"…) y subtítulos tras ": " o " - ".
const ORDEN = "(?:\\d{1,2}(?:st|nd|rd|th|a|o|er|ra|da)?|first|second|third|fourth|fifth|sixth|primera|segunda|tercera|cuarta|quinta|sexta|final|last|ultima|ultimate)";
const PARTE = "(?:season|temporada|saison|cour|part|parte|pt)";
const RE_ORDEN_PARTE = new RegExp(`\\b(?:the )?${ORDEN} ${PARTE}\\b`, "g");
const RE_PARTE_ORDEN = new RegExp(`\\b${PARTE} ?${ORDEN}\\b`, "g");

function nucleoTitulo(texto) {
  let t = String(texto || "").trim();
  t = t.split(/:\s|\s[-–—]\s/)[0]; // "Re:Zero" no se parte: no lleva espacio tras ":"
  t = normalizarTitulo(t);
  t = t.replace(RE_ORDEN_PARTE, " ").replace(RE_PARTE_ORDEN, " ");
  t = t.replace(/\b(tv|ova|oav|ona|movie|pelicula|special|especial|recap)\b/g, " ");
  t = t.replace(/\s+(ii|iii|iv|vi|vii|viii|ix)\s*$/, ""); // Overlord IV, Mob Psycho 100 III…
  t = t.replace(/\s+\d{1,2}\s*$/, "");                 // "Titulo 2"
  return t.replace(/\s+/g, " ").trim();
}

function nucleosRelacionados(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Uno es el comienzo del otro ("Dr Stone" ↔ "Dr Stone New World"), si es lo bastante específico
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return corto.length >= 8 && corto.includes(" ") && largo.startsWith(corto + " ");
}

function slugDeUrl(u) {
  const m = String(u || "").match(/\/media\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

// Compara título y slug de la serie nueva con título y enlace de una ya registrada
function sonSeriesRelacionadas(nueva, existente) {
  const nuevos = [nucleoTitulo(nueva.title), nucleoTitulo(String(nueva.slug || "").replace(/-/g, " "))];
  const slugExistente = slugDeUrl(existente.url);
  const existentes = [nucleoTitulo(existente.title), slugExistente ? nucleoTitulo(slugExistente.replace(/-/g, " ")) : ""];
  return nuevos.some((n) => existentes.some((e) => nucleosRelacionados(n, e)));
}

// --- Índice de series «Viendo» (para la página de inicio de animeav1.com) ---
// home.js necesita saber qué series están en estado «Viendo» sin tocar Google Sheets
// en cada visita. Guardamos en chrome.storage.local solo los slugs de esas series y
// lo mantenemos al día: al leer la lista, al escribir en la hoja y, si ha pasado más
// de VIENDO_TTL_MS, cuando home.js lo pide (por si cambiaste algo a mano en la hoja).
const VIENDO_TTL_MS = 5 * 60 * 1000;

function claveIndiceViendo() {
  return `${SPREADSHEET_ID}#${GID_CONFIG ?? ""}`;
}

// items: [{ url, status }]  (sin la fila de encabezados)
async function guardarIndiceViendo(items) {
  if (CONFIG_FORZADA) return; // se está trabajando en otra lista: el índice «Viendo» es el de la lista activa
  const slugs = new Set();
  const ultimos = {}; // slug -> número del último capítulo visto (para avisar de capítulos nuevos)
  const titulos = {}; // slug -> título (para el texto de la notificación)
  for (const it of items) {
    if ((it.status || "").trim() !== ESTADO_VIENDO) continue;
    const slug = slugDeUrl(it.url);
    if (slug) slugs.add(slug);
    const m = String(it.lastEpisodeUrl || "").match(/\/media\/([^/?#]+)(?:\/(\d+))?\/?(?:[?#].*)?$/i);
    if (m) {
      const s = m[1].toLowerCase(), n = m[2] ? parseInt(m[2], 10) : 0; // ficha sin número = ninguno visto
      if (!(ultimos[s] >= n)) ultimos[s] = n;
      if (it.title && !titulos[s]) titulos[s] = String(it.title).slice(0, 120);
    }
  }
  // Temporadas que el usuario vinculó a una serie existente («¿Es la misma serie?» → Sí)
  const vinculos = await leerVinculos();
  const prefijo = `${SPREADSHEET_ID}#${GID}|`;
  for (const [clave, v] of Object.entries(vinculos)) {
    if (!clave.startsWith(prefijo)) continue;
    if (slugs.has(slugDeUrl(v?.url))) slugs.add(clave.slice(prefijo.length));
  }
  await chrome.storage.local.set({
    indiceViendo: { clave: claveIndiceViendo(), ts: Date.now(), slugs: [...slugs], ultimos, titulos },
  });
  actualizarBadgeAvisos().then(avisosTrasCambioDeLista).catch(() => {});
}

// Sin interacción: si la sesión de Google caducó no se abre ninguna ventana,
// simplemente se queda el último índice guardado.
async function refrescarIndiceViendo({ force = false } = {}) {
  await cargarConfig();
  if (LISTA_LOCAL_ID) { // lista local: se lee del almacenamiento, sin red ni sesión de Google
    // Lista de la nube: si el índice tiene más de unos minutos, primero se trae lo de otros dispositivos
    // (con force, que es lo que usa la propia sincronización, no se vuelve a sincronizar)
    if (!force && (await listaNube(LISTA_LOCAL_ID))) {
      const { indiceViendo } = await chrome.storage.local.get("indiceViendo");
      if (indiceViendo && indiceViendo.clave === claveIndiceViendo() && Date.now() - indiceViendo.ts < VIENDO_TTL_MS) return;
      try { await sincronizarNube(LISTA_LOCAL_ID); } catch (e) {}
    }
    await guardarIndiceViendo((await leerDatosLocal()).items);
    return;
  }
  const { indiceViendo } = await chrome.storage.local.get("indiceViendo");
  if (!force && indiceViendo && indiceViendo.clave === claveIndiceViendo() && Date.now() - indiceViendo.ts < VIENDO_TTL_MS) return;
  const token = await getAuthToken(false);
  const sheetName = await getSheetName(token);
  const data = await sheetsFetch(
    `?ranges=${encodeURIComponent(rango(sheetName, "D:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink)`,
    token
  );
  const filas = data.sheets?.[0]?.data?.[0]?.rowData || [];
  // D=0 (título+enlace), F=2 (estado), K=7 (último capítulo). La fila 1 son encabezados.
  await guardarIndiceViendo(
    filas.slice(1).map((r) => ({
      title: r.values?.[0]?.formattedValue || "",
      url: r.values?.[0]?.hyperlink || "",
      status: r.values?.[2]?.formattedValue || "",
      lastEpisodeUrl: r.values?.[7]?.formattedValue || r.values?.[7]?.hyperlink || "",
    }))
  );
}

function reindexarViendo() {
  if (CONFIG_FORZADA) return; // se está escribiendo en otra lista: el índice «Viendo» es el de la lista activa
  refrescarIndiceViendo({ force: true }).catch(() => {});
}

// --- Listas locales (sin Google Sheets) ----------------------------------------------
// Una lista local vive en chrome.storage.local ("datosLista:<id>") con las mismas filas que
// devolvería la hoja: { row, genre, score, title, url, status, cover, lastEpisodeUrl }.
// El popup se encarga de exportarla a / importarla desde un archivo .json.

function claveDatosLocal(id) { return `datosLista:${id}`; }

// true si la lista activa es local (y deja LISTA_LOCAL_ID rellenado)
async function esListaLocal() {
  try { await cargarConfig(); } catch (e) { return false; }
  return LISTA_LOCAL_ID !== null;
}

async function leerDatosLocal(id = LISTA_LOCAL_ID) {
  const k = claveDatosLocal(id);
  const d = (await chrome.storage.local.get(k))[k];
  return d && Array.isArray(d.items) ? d : { items: [], siguiente: 2 };
}

// Sin gancho de la nube: lo usa la propia sincronización (y el alta de listas) para guardar tal cual
async function guardarDatosCrudo(datos, id = LISTA_LOCAL_ID) {
  await chrome.storage.local.set({ [claveDatosLocal(id)]: datos });
}

async function guardarDatosLocal(datos, id = LISTA_LOCAL_ID) {
  const nube = await listaNube(id);
  if (!nube) { await guardarDatosCrudo(datos, id); return; }
  if (nube.rol === "lectura") throw new Error("SOLO_LECTURA");
  registrarCambiosNube(datos);
  await guardarDatosCrudo(datos, id);
  programarEnvioNube(id);
}

// Las lecturas-modificaciones-escrituras se encolan para que dos mensajes seguidos
// (p. ej. abrir un episodio mientras editas en el popup) no se pisen.
let colaLocal = Promise.resolve();
function enColaLocal(fn) {
  const p = colaLocal.then(fn);
  colaLocal = p.catch(() => {});
  return p;
}

// Mismo criterio que la hoja: vacío o ≤ 0 = sin valorar; una décima; máximo 10.
function notaLocal(valor) {
  const n = parseFloat(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? (Math.min(10, Math.round(n * 10) / 10)).toFixed(1) : "";
}

function itemLocal(x, row) {
  const title = String(x?.title ?? "").trim();
  if (!title) return null;
  return {
    row,
    genre: String(x.genre ?? "").trim(),
    score: notaLocal(x.score),
    title,
    url: String(x.url ?? "").trim(),
    status: String(x.status ?? "").trim(),
    cover: String(x.cover ?? "").trim(),
    lastEpisodeUrl: String(x.lastEpisodeUrl ?? "").trim(),
  };
}

async function agregarListaLocal(nombre, series) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("FALTA_NOMBRE");
  if (series !== undefined && !Array.isArray(series)) throw new Error("JSON_INVALIDO");
  const items = [];
  let fila = 2; // como en la hoja, la fila 1 serían los encabezados
  for (const s of series || []) {
    const it = itemLocal(s, fila);
    if (it) { items.push(it); fila++; }
  }
  const id = nuevoIdLista();
  await guardarDatosLocal({ items, siguiente: fila }, id);
  const listas = await getListasGuardadas();
  listas.push({ id, name: nombreLimpio, tipo: "local", url: `local:${id}`, spreadsheetId: "", gid: null, titulo: nombreLimpio, hoja: "" });
  await setListasGuardadas(listas);
  return { id, name: nombreLimpio, total: items.length };
}

async function exportarListaLocal(id) {
  const lista = (await getListasGuardadas()).find((l) => l.id === id && (l.tipo === "local" || l.tipo === "nube"));
  if (!lista) throw new Error("LISTA_NO_ENCONTRADA");
  const d = await leerDatosLocal(id);
  return { nombre: lista.name, series: d.items.map(({ row, ...resto }) => resto) };
}

// Añadir una serie escribiendo los datos a mano (solo listas locales)
async function agregarSerieLocal(datos) {
  if (!(await esListaLocal())) throw new Error("NO_ES_LISTA_LOCAL");
  const title = String(datos?.title ?? "").trim();
  if (!title) throw new Error("FALTA_TITULO");
  const row = await enColaLocal(async () => {
    const d = await leerDatosLocal();
    if (buscarItemLocal(d.items, datos.url, title)) throw new Error("YA_EXISTE");
    const it = itemLocal({ ...datos, title }, d.siguiente);
    d.siguiente++;
    d.items.push(it);
    await guardarDatosLocal(d);
    if (it.cover) precachearImagen(it.cover);
    return it.row;
  });
  reindexarViendo();
  return row;
}

// Las listas locales no tienen hoja de la que borrar filas: se borra desde aquí
async function eliminarSerieLocal(row) {
  if (!(await esListaLocal())) throw new Error("NO_ES_LISTA_LOCAL");
  await enColaLocal(async () => {
    const d = await leerDatosLocal();
    const antes = d.items.length;
    d.items = d.items.filter((i) => i.row !== Number(row));
    if (d.items.length === antes) throw new Error("FILA_NO_ENCONTRADA");
    await guardarDatosLocal(d);
  });
  reindexarViendo();
}

// Mover series entre listas: añade con todos los datos (nota, estado, género, portada, último capítulo)
async function agregarSerieCompleta(s) {
  const title = String(s?.title ?? "").trim();
  if (!title) throw new Error("FALTA_TITULO");
  if (await esListaLocal()) return agregarSerieLocal({ ...s, title });
  return conToken(async (token) => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaK(token, sheetName);
    if (filaPorEnlaceOTitulo(filas, s.url, title) >= 1) throw new Error("YA_EXISTE");
    const row = await siguienteFilaLibre(token, sheetName);
    await escribirFilaNueva(token, row, { title, url: String(s.url || ""), score: s.score, description: "", cover: String(s.cover || ""), episodeUrl: String(s.lastEpisodeUrl || "") });
    await actualizarCampo(row, "status", String(s.status ?? "")); // escribirFilaNueva deja «Viendo»
    if (s.genre) await actualizarCampo(row, "genre", String(s.genre));
    return row;
  });
}

// Quita una serie de la lista activa. En hojas se borra la fila entera, comprobando antes que sigue siendo esa serie
async function eliminarSerie(row, title) {
  if (await esListaLocal()) return eliminarSerieLocal(row);
  const n = Number(row);
  if (!Number.isInteger(n) || n < 2) throw new Error("FILA_NO_ENCONTRADA");
  await conToken(async (token) => {
    const sheetName = await getSheetName(token);
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(sheetName, `D${n}`))}&fields=sheets.data.rowData.values(formattedValue)`, token);
    const actual = (data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.formattedValue || "").trim().toLowerCase();
    if (!actual || actual !== String(title || "").trim().toLowerCase()) throw new Error("FILA_CAMBIADA");
    await sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: GID, dimension: "ROWS", startIndex: n - 1, endIndex: n } } }] }) });
  });
  reindexarViendo();
}

function buscarItemLocal(items, url, titulo) {
  const slug = slugDeUrl(url);
  const tit = String(titulo || "").trim().toLowerCase();
  if (slug) {
    const it = items.find((i) => slugDeUrl(i.url) === slug);
    if (it) return it;
  }
  return tit ? items.find((i) => i.title.trim().toLowerCase() === tit) || null : null;
}

function sincronizarItemLocal(it, episodeUrl) {
  it.status = ESTADO_VIENDO;
  if (episodeUrl) it.lastEpisodeUrl = episodeUrl;
}

function anadirItemLocal(d, { title, url, score, cover, episodeUrl }) {
  d.items.push({
    row: d.siguiente++,
    genre: "",
    score: notaLocal(score),
    title: String(title || "").trim(),
    url: url || "",
    status: ESTADO_VIENDO,
    cover: cover || "",
    lastEpisodeUrl: episodeUrl || "",
  });
}

// Mismo flujo que handleEpisodioDetectado, contra la lista local
async function handleEpisodioDetectadoLocal(datos) {
  const { slug, title, url, score, description, cover, episodeUrl } = datos;
  const nuevaFila = { title, url, score, description, cover, episodeUrl };
  if (cover) precachearImagen(cover);

  return enColaLocal(async () => {
    const d = await leerDatosLocal();

    // 1) Ya registrada con este mismo enlace o título
    let it = buscarItemLocal(d.items, url, title);
    if (it) {
      sincronizarItemLocal(it, episodeUrl);
      await guardarDatosLocal(d);
      avisarOk();
      return {};
    }

    // 2) El usuario ya dijo antes que esta temporada es una serie que tiene registrada
    const vinculos = await leerVinculos();
    const vinculo = slug ? vinculos[claveVinculo(slug)] : null;
    if (vinculo) {
      it = buscarItemLocal(d.items, vinculo.url, vinculo.title);
      if (it) {
        sincronizarItemLocal(it, episodeUrl);
        await guardarDatosLocal(d);
        avisarOk();
        return {};
      }
      delete vinculos[claveVinculo(slug)]; // la serie ya no está
      await guardarVinculos(vinculos);
    }

    // 3) ¿Hay series registradas que parezcan la misma (otra temporada/parte)? -> preguntar
    const candidatos = [];
    for (let k = d.items.length - 1; k >= 0; k--) { // las más recientes primero
      const e = d.items[k];
      if (sonSeriesRelacionadas({ title, slug }, { title: e.title, url: e.url })) {
        candidatos.push({ title: e.title, url: e.url, cover: e.cover });
      }
    }
    if (candidatos.length) return { pregunta: { nuevaFila, slug, candidatos: candidatos.slice(0, 4) } };

    // 4) Serie nueva
    anadirItemLocal(d, nuevaFila);
    await guardarDatosLocal(d);
    avisarOk();
    return {};
  });
}

async function resolverSecuelaLocal({ decision, slug, existingUrl, existingTitle, nuevaFila }) {
  await enColaLocal(async () => {
    const d = await leerDatosLocal();
    if (decision === "misma") {
      const it = buscarItemLocal(d.items, existingUrl, existingTitle);
      if (!it) throw new Error("FILA_NO_ENCONTRADA");
      sincronizarItemLocal(it, nuevaFila.episodeUrl);
      if (slug) {
        const vinculos = await leerVinculos();
        vinculos[claveVinculo(slug)] = { url: existingUrl, title: existingTitle };
        await guardarVinculos(vinculos);
      }
    } else {
      anadirItemLocal(d, nuevaFila);
    }
    await guardarDatosLocal(d);
    avisarOk();
  });
}

async function actualizarCampoLocal(row, campo, valor) {
  if (COLUMNAS_EDITABLES[campo] === undefined) throw new Error("Campo desconocido: " + campo);
  await enColaLocal(async () => {
    const d = await leerDatosLocal();
    const it = d.items.find((i) => i.row === Number(row));
    if (!it) throw new Error("FILA_NO_ENCONTRADA");
    if (campo === "score") it.score = notaLocal(valor);
    else if (campo === "cover") { it.cover = String(valor || ""); if (it.cover) precachearImagen(it.cover); }
    else it[campo] = String(valor ?? "");
    await guardarDatosLocal(d);
  });
  if (campo === "status" || campo === "lastEpisodeUrl") reindexarViendo();
}

async function actualizarTituloUrlLocal(row, title, url) {
  await enColaLocal(async () => {
    const d = await leerDatosLocal();
    const it = d.items.find((i) => i.row === Number(row));
    if (!it) throw new Error("FILA_NO_ENCONTRADA");
    it.title = String(title || "").trim() || it.title;
    it.url = String(url || "").trim();
    await guardarDatosLocal(d);
  });
  reindexarViendo();
}

async function actualizarGenerosLoteLocal(cambios) {
  if (!Array.isArray(cambios) || !cambios.length) return;
  await enColaLocal(async () => {
    const d = await leerDatosLocal();
    const porFila = new Map(d.items.map((i) => [i.row, i]));
    for (const c of cambios) {
      const it = porFila.get(Number(c.row));
      if (it) it.genre = String(c.valor ?? "");
    }
    await guardarDatosLocal(d);
  });
}

async function rellenarPortadasLocal() {
  const d = await leerDatosLocal();
  const hallazgos = [];
  let sinImagen = 0;
  for (const it of d.items) {
    if (it.cover || !it.url) continue;
    try {
      const imagenUrl = extraerPortadaDesdeHtml(await (await fetch(it.url)).text());
      if (!imagenUrl) { sinImagen++; continue; }
      hallazgos.push([it.row, imagenUrl]);
      precachearImagen(imagenUrl);
    } catch (e) {
      console.error("[AnimeAV1 Tracker] Error obteniendo portada para", it.url, e);
      sinImagen++;
    }
  }
  if (hallazgos.length) {
    await enColaLocal(async () => {
      const d2 = await leerDatosLocal();
      for (const [row, imagenUrl] of hallazgos) {
        const it = d2.items.find((i) => i.row === row);
        if (it && !it.cover) it.cover = imagenUrl;
      }
      await guardarDatosLocal(d2);
    });
  }
  return { encontradas: hallazgos.length, sinImagen };
}

async function migrarAnimeFlvLocal() {
  const d = await leerDatosLocal();
  const cambios = [];
  let migradas = 0, portadasFlv = 0, sinCambios = 0;
  for (const it of d.items) {
    if (!it.url.includes("animeflv")) continue;
    const encontrado = await buscarEnAnimeAV1(it.title, it.url);
    if (encontrado) {
      const c = { row: it.row, url: encontrado.url };
      if (!it.cover) {
        const imagenUrl = extraerPortadaDesdeHtml(encontrado.html);
        if (imagenUrl) { c.cover = imagenUrl; precachearImagen(imagenUrl); }
      }
      cambios.push(c);
      migradas++;
    } else if (!it.cover) {
      try {
        const imagenUrl = extraerPortadaAnimeFlv(await (await fetch(it.url)).text());
        if (imagenUrl) { cambios.push({ row: it.row, cover: imagenUrl }); precachearImagen(imagenUrl); portadasFlv++; }
        else sinCambios++;
      } catch (e) { sinCambios++; }
    } else {
      sinCambios++;
    }
  }
  if (cambios.length) {
    await enColaLocal(async () => {
      const d2 = await leerDatosLocal();
      for (const c of cambios) {
        const it = d2.items.find((i) => i.row === c.row);
        if (!it) continue;
        if (c.url) it.url = c.url;
        if (c.cover) it.cover = c.cover;
      }
      await guardarDatosLocal(d2);
    });
    reindexarViendo();
  }
  return { migradas, portadasFlv, sinCambios };
}

// --- Listas en la nube (Cloudflare D1) ----------------------------------------------
// Una lista "nube" es una lista local (mismos datos en chrome.storage.local, mismas funciones,
// funciona sin conexión) con una capa de sincronización contra el Worker:
//   · cada serie recibe un id estable (d.nube.ids: fila → id) y se recuerda qué versión se
//     envió por última vez (d.nube.rec[id].h) frente a la actual (.l); si difieren, está pendiente;
//   · tras cada cambio se envía lo pendiente (con un pequeño retraso) y al abrir la lista se
//     descarga lo nuevo; si dos dispositivos tocan la misma serie gana el cambio más reciente;
//   · los borrados se envían como "lápidas" para que lleguen a los demás dispositivos.
// El login usa un id_token de Google que el Worker canjea por su propia sesión (dura meses).
const NUBE_LOTE = 200;
const NUBE_TIMEOUT_MS = 15000; // tiempo máximo de una petición al Worker

async function leerSesionNube() {
  const { nubeSesion: s } = await chrome.storage.local.get("nubeSesion");
  return s?.token && s.exp * 1000 > Date.now() + 60000 ? s : null;
}
async function guardarSesionNube(s) {
  if (s) await chrome.storage.local.set({ nubeSesion: s });
  else await chrome.storage.local.remove("nubeSesion");
}

async function nubeFetch(ruta, { method = "GET", body, sinSesion = false } = {}) {
  const headers = {};
  if (!sinSesion) {
    const s = await leerSesionNube();
    if (!s) throw new Error("NUBE_SESION_CADUCADA");
    headers.Authorization = "Bearer " + s.token;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  // Con tiempo máximo: una petición colgada (red mala) no debe bloquear para siempre la cola de sincronización
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NUBE_TIMEOUT_MS);
  try { res = await fetch(NUBE_WORKER_URL + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal }); }
  catch (e) { throw new Error("NUBE_SIN_CONEXION"); }
  finally { clearTimeout(timer); }
  let json = null;
  try { json = await res.json(); } catch (e) {}
  if (res.status === 401 && !sinSesion) { await guardarSesionNube(null); throw new Error("NUBE_SESION_CADUCADA"); }
  // La lista ya no existe en la nube (la borraron desde otro dispositivo, o dejó de estar compartida contigo)
  if (res.status === 404 && /^Lista no encontrada/i.test(String(json?.error || ""))) throw new Error("NUBE_LISTA_NO_EXISTE");
  if (!res.ok) throw new Error(json?.error || `Error de la nube (${res.status})`);
  return json;
}

async function nubeLoginConIdToken(idToken) {
  const r = await nubeFetch("/api/login", { method: "POST", body: { id_token: idToken }, sinSesion: true });
  await guardarSesionNube({ token: r.token, exp: r.exp, email: r.usuario.email, name: r.usuario.name });
  return r.usuario;
}

// Inicio de sesión: ventana de Google (solo identificación: openid + email). Requiere que la
// «URI de redireccionamiento autorizada» https://<id-extensión>.chromiumapp.org/ esté añadida
// al cliente OAuth web (ver CAMBIOS.md).
async function nubeLogin() {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: NUBE_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: "openid email profile",
    nonce: crypto.randomUUID(),
    prompt: "select_account",
  });
  const vuelta = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!vuelta) throw new Error("No se obtuvo token");
  const frag = new URLSearchParams(new URL(vuelta).hash.replace(/^#/, ""));
  const idToken = frag.get("id_token");
  if (!idToken) throw new Error(frag.get("error") || "No se obtuvo token");
  return nubeLoginConIdToken(idToken);
}

async function listaNube(id) { return (await getListasGuardadas()).find((l) => l.id === id && l.tipo === "nube") || null; }
const idSerieNube = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const hashItem = (it) => JSON.stringify([it.genre, it.score, it.title, it.url, it.status, it.cover, it.lastEpisodeUrl]);

function metaNube(d) {
  if (!d.nube || typeof d.nube !== "object") d.nube = {};
  const n = d.nube;
  if (!n.ids) n.ids = {};
  if (!n.rec) n.rec = {};
  if (!n.borradas) n.borradas = {};
  if (!n.desde) n.desde = 0;
  return n;
}

// Compara los datos con lo último sincronizado: asigna ids a series nuevas, anota la hora de
// cada cambio local y convierte las series quitadas en lápidas pendientes de enviar.
function registrarCambiosNube(d, ahora = Date.now()) {
  const n = metaNube(d);
  const vivas = new Set();
  for (const it of d.items) {
    let sid = n.ids[it.row];
    if (!sid) { sid = idSerieNube(); n.ids[it.row] = sid; }
    vivas.add(sid);
    const h = hashItem(it);
    const rec = n.rec[sid];
    if (!rec) n.rec[sid] = { h: "", l: h, loc: ahora };
    // La hora de un cambio local siempre supera a la última conocida: un reloj atrasado no pierde frente a otro dispositivo
    else if (rec.l !== h) { rec.l = h; rec.loc = Math.max(ahora, rec.loc + 1); }
    delete n.borradas[sid];
  }
  for (const [row, sid] of Object.entries(n.ids)) {
    if (vivas.has(sid)) continue;
    const rec = n.rec[sid];
    delete n.ids[row]; delete n.rec[sid];
    if (rec && rec.h !== "") n.borradas[sid] = Math.max(ahora, rec.loc + 1); // ya estaba en la nube: hay que avisar
  }
}

function cambioDeItem(sid, it, loc) {
  return {
    id: sid, titulo: it.title, url: it.url, nota: it.score === "" ? null : Number(it.score), estado: it.status,
    genero: it.genre, portada: it.cover, ultimo_cap_url: it.lastEpisodeUrl, actualizado: loc,
  };
}

// Todas las operaciones de sincronización de una lista van en fila, de una en una
const colaNube = {};
function enColaNube(id, fn) {
  const p = (colaNube[id] || Promise.resolve()).catch(() => {}).then(fn);
  colaNube[id] = p;
  return p;
}

// Las lecturas-modificaciones-escrituras de los datos van por enColaLocal (la misma cola que las
// ediciones), así una sincronización no pisa un cambio hecho a la vez en el popup.
async function _enviarNube(id) {
  const lista = await listaNube(id);
  if (!lista || lista.rol === "lectura") return { enviados: 0 };
  let enviados = 0;
  for (;;) {
    const lote = await enColaLocal(async () => {
      const d = await leerDatosLocal(id);
      const n = metaNube(d);
      const lote = [];
      for (const it of d.items) {
        if (lote.length >= NUBE_LOTE) break;
        const sid = n.ids[it.row];
        const rec = sid && n.rec[sid];
        if (rec && rec.l !== rec.h) lote.push({ sid, hash: rec.l, cambio: cambioDeItem(sid, it, rec.loc) });
      }
      for (const [sid, ts] of Object.entries(n.borradas)) {
        if (lote.length >= NUBE_LOTE) break;
        lote.push({ sid, hash: null, cambio: { id: sid, borrada: true, actualizado: ts } });
      }
      return lote;
    });
    if (!lote.length) break;
    await nubeFetch(`/api/listas/${id}/series`, { method: "POST", body: { cambios: lote.map((x) => x.cambio) } });
    // Se vuelve a leer: mientras se enviaba pudo haber cambios locales nuevos (esos siguen pendientes)
    await enColaLocal(async () => {
      if (!(await listaNube(id))) return; // la quitaron del dispositivo mientras tanto
      const d2 = await leerDatosLocal(id);
      const n2 = metaNube(d2);
      for (const x of lote) {
        if (x.hash === null) { if (n2.borradas[x.sid] === x.cambio.actualizado) delete n2.borradas[x.sid]; }
        else if (n2.rec[x.sid]) n2.rec[x.sid].h = x.hash;
      }
      await guardarDatosCrudo(d2, id);
    });
    enviados += lote.length;
  }
  return { enviados };
}

async function _traerNube(id) {
  // Se pide con 2 s de margen: aplicar dos veces el mismo cambio es inofensivo, perderlo no
  const desde = Math.max(0, (metaNube(await leerDatosLocal(id)).desde || 0) - 2000);
  const r = await nubeFetch(`/api/listas/${id}/series?since=${desde}`);
  const portadas = [];
  const resumen = await enColaLocal(async () => {
    if (!(await listaNube(id))) return { recibidas: 0, cambios: 0 };
    const d = await leerDatosLocal(id);
    const n = metaNube(d);
    const filaDe = new Map(Object.entries(n.ids).map(([row, sid]) => [sid, Number(row)]));
    let cambios = 0;
    for (const s of r.series) {
      const rec = n.rec[s.id];
      const tumba = n.borradas[s.id];
      if (tumba !== undefined && tumba > s.actualizado) continue;       // la quité yo después
      if (rec && rec.l !== rec.h && rec.loc > s.actualizado) continue;  // mi cambio es más reciente (pendiente de enviar)
      const row = filaDe.get(s.id);
      const idx = row === undefined ? -1 : d.items.findIndex((i) => i.row === row);
      if (s.borrada) {
        if (idx >= 0) { d.items.splice(idx, 1); cambios++; }
        if (row !== undefined) delete n.ids[row];
        delete n.rec[s.id]; delete n.borradas[s.id];
        continue;
      }
      if (!s.titulo) continue;
      const campos = {
        genre: s.genero || "", score: notaLocal(s.nota ?? ""), title: s.titulo, url: s.url || "",
        status: s.estado || "", cover: s.portada || "", lastEpisodeUrl: s.ultimo_cap_url || "",
      };
      let it;
      if (idx >= 0) { it = d.items[idx]; if (hashItem({ ...it, ...campos }) !== hashItem(it)) cambios++; Object.assign(it, campos); }
      else { it = { row: d.siguiente++, ...campos }; d.items.push(it); n.ids[it.row] = s.id; cambios++; }
      if (it.cover) portadas.push(it.cover);
      const h = hashItem(it);
      n.rec[s.id] = { h, l: h, loc: s.actualizado };
      delete n.borradas[s.id];
    }
    n.desde = Math.max(n.desde || 0, r.hasta || 0);
    await guardarDatosCrudo(d, id);
    // Si el propietario cambió tus permisos (lectura ↔ edición), se refleja aquí
    if (r.rol) {
      const listas = await getListasGuardadas();
      const l = listas.find((x) => x.id === id);
      if (l && l.rol !== r.rol) { l.rol = r.rol; await setListasGuardadas(listas); }
    }
    return { recibidas: r.series.length, cambios };
  });
  portadas.forEach((u) => precachearImagen(u)); // portadas nuevas de otros dispositivos: a la caché local
  if (resumen.cambios) {
    const { listaActivaId } = await chrome.storage.local.get("listaActivaId");
    if (listaActivaId === id) reindexarViendo(); // el símbolo «Viendo» de animeav1.com sigue a la lista
  }
  return resumen;
}

const enviarCambiosNube = (id) => enColaNube(id, () => _enviarNube(id));
const ultimaSincNube = {}; // id → cuándo terminó la última sincronización completa
const sincronizarNube = (id) => enColaNube(id, async () => {
  const t = await _traerNube(id);
  const e = await _enviarNube(id);
  ultimaSincNube[id] = Date.now();
  return { ...t, ...e }; // { recibidas, cambios, enviados }
});

const temporizadoresNube = {};
function programarEnvioNube(id) {
  clearTimeout(temporizadoresNube[id]);
  temporizadoresNube[id] = setTimeout(() => { enviarCambiosNube(id).catch((e) => { if (!/NUBE_LISTA_NO_EXISTE|NUBE_SESION_CADUCADA/.test(String(e?.message || e))) programarReintentoNube(); }); }, 500);
}

// Si no hay conexión (o el servicio se apagó antes de enviar), se reintenta cada minuto hasta que salga
function programarReintentoNube() {
  try { chrome.alarms?.create("nubeReintento", { delayInMinutes: 1 }); } catch (e) {}
}
async function enviarPendientesNube() {
  const listas = (await getListasGuardadas()).filter((l) => l.tipo === "nube" && l.rol !== "lectura");
  let fallo = false;
  for (const l of listas) { try { await enviarCambiosNube(l.id); } catch (e) { if (!/NUBE_SESION_CADUCADA|NUBE_LISTA_NO_EXISTE/.test(String(e?.message || e))) fallo = true; } }
  if (fallo) programarReintentoNube();
}
try {
  chrome.alarms?.onAlarm.addListener((a) => { if (a.name === "nubeReintento") enviarPendientesNube(); });
  chrome.runtime.onStartup.addListener(() => { enviarPendientesNube(); });
} catch (e) {}

// --- Sincronizar al abrir una lista de la nube ------------------------------------------------
// La lista se enseña AL INSTANTE con lo guardado en el dispositivo; la sincronización con la nube corre en segundo
// plano y el popup se entera después (NUBE_ESPERAR_SYNC): solo repinta si llegó algo nuevo. Sin conexión, la lista
// no espera nada.
let estadoNube = null;
const syncAlAbrir = {};      // id → promesa mientras dura la sincronización
const resultadoAlAbrir = {}; // id → resultado de la última, hasta que el popup lo recoge
function lanzarSyncAlAbrir(id) {
  if (syncAlAbrir[id]) return syncAlAbrir[id];
  const p = (async () => {
    let timer;
    try {
      const r = await Promise.race([
        sincronizarNube(id),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("NUBE_SIN_CONEXION")), 10000); }),
      ]);
      return { id, ok: true, cambios: r?.cambios || 0 };
    } catch (e) {
      const error = String(e?.message || e).replace(/^Error:\s*/, "");
      if (/NUBE_SIN_CONEXION/.test(error)) programarReintentoNube();
      return { id, ok: false, error };
    } finally { clearTimeout(timer); }
  })().then((r) => { resultadoAlAbrir[id] = { ...r, ts: Date.now() }; delete syncAlAbrir[id]; return r; });
  syncAlAbrir[id] = p;
  return p;
}
// La nube al día para quien la necesite ya: si se está sincronizando se espera a esa; si acaba de sincronizarse
// (menos de maxEdadMs) solo se envía lo pendiente, sin volver a pedir nada.
function nubeAlDia(id, maxEdadMs = 8000) {
  if (syncAlAbrir[id]) return syncAlAbrir[id].then((r) => { if (!r.ok) throw new Error(r.error); return r; });
  if (Date.now() - (ultimaSincNube[id] || 0) < maxEdadMs) return enviarCambiosNube(id);
  return sincronizarNube(id);
}

async function anadirEntradaNube(id, nombre, rol) {
  await obtenerListasParaUI(); // asegura la migración de "Mi lista" si hacía falta
  const listas = await getListasGuardadas();
  if (listas.some((l) => l.id === id)) throw new Error("LISTA_YA_EN_DISPOSITIVO");
  listas.push({ id, name: nombre, tipo: "nube", url: `nube:${id}`, spreadsheetId: "", gid: null, titulo: nombre, hoja: "", rol });
  await setListasGuardadas(listas);
}
const nombreListaNube = (n) => {
  const name = String(n ?? "").trim().slice(0, 60);
  if (!name) throw new Error("FALTA_NOMBRE");
  return name;
};

async function nubeListar() {
  const r = await nubeFetch("/api/listas");
  const locales = new Set((await getListasGuardadas()).map((l) => l.id));
  return r.listas.map((l) => ({ id: l.id, nombre: l.nombre, rol: l.rol, enDispositivo: locales.has(l.id) }));
}

async function nubeCrearLista(nombre) {
  const name = nombreListaNube(nombre);
  const id = nuevoIdLista();
  await nubeFetch("/api/listas", { method: "POST", body: { id, nombre: name } });
  await guardarDatosCrudo({ items: [], siguiente: 2 }, id);
  await anadirEntradaNube(id, name, "propietario");
  return { id, name };
}

// Añade a este dispositivo una lista que ya existe en la nube (tuya en otro dispositivo, o compartida contigo)
async function nubeAnadirLista(id) {
  if ((await getListasGuardadas()).some((l) => l.id === id)) throw new Error("LISTA_YA_EN_DISPOSITIVO");
  const r = await nubeFetch(`/api/listas/${encodeURIComponent(id)}`);
  await guardarDatosCrudo({ items: [], siguiente: 2 }, id);
  await anadirEntradaNube(id, r.lista.nombre, r.lista.rol);
  let total = 0;
  try { await sincronizarNube(id); total = (await leerDatosLocal(id)).items.length; } catch (e) { /* se completará al abrirla */ }
  return { id, name: r.lista.nombre, total };
}

// Sube una COPIA de una lista (local o de Google Sheets) a la nube; la original no se toca.
// Para una hoja de Google, el popup manda listaId = la lista de origen y el despachador la deja activa mientras dura.
async function nubeSubirCopia(origenId, nombre) {
  const origen = (await getListasGuardadas()).find((l) => l.id === origenId);
  if (!origen) throw new Error("LISTA_NO_ENCONTRADA");
  if (origen.tipo === "nube") throw new Error("YA_ESTA_EN_LA_NUBE");
  const name = nombreListaNube(nombre || origen.name);
  const filas = origen.tipo === "local" ? (await leerDatosLocal(origenId)).items : await obtenerListaCompleta();
  const items = [];
  let fila = 2;
  for (const x of filas) { const it = itemLocal(x, fila); if (it) { items.push(it); fila++; } }
  const id = nuevoIdLista();
  await nubeFetch("/api/listas", { method: "POST", body: { id, nombre: name } }); // si falla aquí, no queda nada a medias
  const d = { items, siguiente: fila };
  registrarCambiosNube(d);
  await guardarDatosCrudo(d, id);
  await anadirEntradaNube(id, name, "propietario");
  let error = "";
  try { await sincronizarNube(id); } catch (e) { error = String(e?.message || e).replace(/^Error:\s*/, ""); programarReintentoNube(); }
  return { id, name, total: items.length, error };
}

async function manejarMensajeNube(msg) {
  switch (msg.type) {
    case "NUBE_ESTADO": {
      const s = await leerSesionNube();
      return { sesion: s ? { email: s.email, name: s.name, exp: s.exp } : null, redirectUri: chrome.identity.getRedirectURL() };
    }
    case "NUBE_LOGIN": return { usuario: await nubeLogin() };
    case "NUBE_CERRAR_SESION": await guardarSesionNube(null); return {};
    case "NUBE_LISTAR": return { listas: await nubeListar() };
    case "NUBE_CREAR": return await nubeCrearLista(msg.name);
    case "NUBE_ANADIR": return await nubeAnadirLista(msg.id);
    case "NUBE_SUBIR": return await nubeSubirCopia(msg.id, msg.name);
    case "NUBE_MIEMBROS": return { miembros: (await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}`)).miembros || [] };
    case "NUBE_COMPARTIR": return await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}/miembros`, { method: "POST", body: { email: msg.email, rol: msg.rol } });
    case "NUBE_QUITAR_MIEMBRO": await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}/miembros?email=${encodeURIComponent(msg.email)}`, { method: "DELETE" }); return {};
    case "NUBE_ENLACE": return { enlace: (await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}/enlace`)).enlace || null };
    case "NUBE_ENLACE_CREAR": return { enlace: (await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}/enlace`, { method: "POST", body: { renovar: !!msg.renovar } })).enlace };
    case "NUBE_ENLACE_QUITAR": await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}/enlace`, { method: "DELETE" }); return {};
    case "NUBE_SINCRONIZAR": return await sincronizarNube(msg.id);
    case "NUBE_ESPERAR_SYNC": { // resultado de la sincronización que se lanzó al abrir la lista
      let r = syncAlAbrir[msg.id] ? await syncAlAbrir[msg.id] : resultadoAlAbrir[msg.id];
      if (!r || (r.ts && Date.now() - r.ts > 60000)) r = { id: msg.id, ok: true, cambios: 0 };
      delete resultadoAlAbrir[msg.id];
      return { nube: r };
    }
    case "NUBE_BORRAR": { // si ya la borraron desde otro dispositivo, el objetivo (que no exista) ya está cumplido
      try { await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}`, { method: "DELETE" }); }
      catch (e) { if (!/NUBE_LISTA_NO_EXISTE/.test(String(e?.message || e))) throw e; }
      return {};
    }
  }
  throw new Error("Mensaje desconocido: " + msg.type);
}

// --- Vínculo hoja de Google ↔ lista de la nube -------------------------------------------------
// Dos listas vinculadas se mantienen iguales en los dos sentidos. Cada serie se identifica por su enlace
// (o por su título si no tiene). Para saber QUÉ lado cambió se guarda, por serie, cómo era la última vez que se
// sincronizaron («base»): si solo cambió la nube se escribe en la hoja; si solo cambió la hoja se escribe en la
// nube; si cambiaron los dos, gana la hoja. Una serie que existe en un solo lado se añade al otro, salvo que
// estuviera en la base (entonces es que se borró en el otro lado y se borra aquí también).
const CAMPOS_VINCULO = ["genre", "score", "title", "url", "status", "cover", "lastEpisodeUrl"];
function normItemVinculo(it) {
  const t = (v) => String(v ?? "").trim();
  const n = parseFloat(t(it?.score).replace(",", "."));
  return {
    genre: t(it?.genre), score: Number.isFinite(n) && n > 0 ? String(Math.round(n * 10) / 10) : "", title: t(it?.title),
    url: t(it?.url), status: t(it?.status), cover: t(it?.cover), lastEpisodeUrl: t(it?.lastEpisodeUrl),
  };
}
const hashVinculo = (it) => JSON.stringify(CAMPOS_VINCULO.map((c) => normItemVinculo(it)[c]));
function claveSerieVinculo(it) {
  const u = String(it?.url ?? "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return u ? "u:" + u : "t:" + String(it?.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function diferenciasVinculo(de, a) {
  const x = normItemVinculo(de), y = normItemVinculo(a);
  const campos = [];
  for (const c of ["genre", "score", "status", "cover", "lastEpisodeUrl"]) if (x[c] !== y[c]) campos.push([c, y[c]]);
  return { campos, tituloUrl: x.title !== y.title || x.url !== y.url, title: y.title, url: y.url };
}
function planificarVinculo(base, hoja, nube) {
  base = base || {};
  const mapa = (arr) => { const m = new Map(); for (const it of arr) { const k = claveSerieVinculo(it); if (!m.has(k)) m.set(k, it); } return m; };
  const H = mapa(hoja), N = mapa(nube);
  const plan = { aHoja: { actualizar: [], anadir: [], eliminar: [] }, aNube: { actualizar: [], anadir: [], eliminar: [] }, base: {}, previo: base, sospechoso: false, borrados: 0 };
  for (const k of new Set([...H.keys(), ...N.keys()])) {
    const s = H.get(k), c = N.get(k), b = base[k];
    const hs = s ? hashVinculo(s) : undefined, hc = c ? hashVinculo(c) : undefined;
    if (s && c) {
      if (hs === hc) plan.base[k] = hs;
      else if (b !== undefined && hs === b) { plan.aHoja.actualizar.push({ k, row: s.row, de: s, a: c }); plan.base[k] = hc; } // cambió la nube
      else { plan.aNube.actualizar.push({ k, row: c.row, a: s }); plan.base[k] = hs; }                                        // cambió la hoja (o las dos: gana la hoja)
    } else if (s) {
      if (b !== undefined && hs === b) plan.aHoja.eliminar.push({ k, row: s.row, title: s.title });                           // se borró en la nube
      else { plan.aNube.anadir.push({ k, item: s }); plan.base[k] = hs; }
    } else {
      if (b !== undefined && hc === b) plan.aNube.eliminar.push({ k, row: c.row });                                           // se borró en la hoja
      else { plan.aHoja.anadir.push({ k, item: c }); plan.base[k] = hc; }
    }
  }
  // Seguro: si el plan borraría una parte grande de la lista (hoja vacía por un error, pestaña equivocada…), no se hace nada
  plan.borrados = plan.aHoja.eliminar.length + plan.aNube.eliminar.length;
  plan.sospechoso = plan.borrados > Math.max(5, Math.ceil(0.4 * Math.max(H.size, N.size)));
  return plan;
}
const claveBaseVinculo = (nubeId, hojaId) => `vinculoBase:${nubeId}:${hojaId}`;
// Datos de una serie tal como se guardan en una lista de la nube (la nota con una décima)
const camposParaNube = (it) => { const x = normItemVinculo(it); return { ...x, score: notaLocal(x.score) }; };
const resumenVinculoVacio = () => ({ hoja: { actualizadas: 0, anadidas: 0, eliminadas: 0 }, nube: { actualizadas: 0, anadidas: 0, eliminadas: 0 } });

// Peticiones de Sheets para aplicar a la hoja los cambios del plan EN POCAS LLAMADAS (no serie a serie):
// ediciones, borrados (de abajo arriba) y altas se agrupan en lotes; el coste ya no crece con el número de series.
function requestCampoHoja(sheetId, row, campo, valor) {
  const col = { genre: 0, score: 2, status: 5, cover: 9, lastEpisodeUrl: 10 }[campo];
  const c = {};
  let fields = "userEnteredValue";
  if (campo === "score") {
    const n = parseFloat(String(valor).replace(",", "."));
    c.userEnteredValue = !Number.isFinite(n) || n <= 0 ? { stringValue: "" } : { numberValue: n };
    c.userEnteredFormat = { numberFormat: { type: "NUMBER", pattern: "0.0" } };
    fields += ",userEnteredFormat.numberFormat";
  } else if (campo === "cover") {
    c.userEnteredValue = valor ? { formulaValue: `=IMAGE("${String(valor).replace(/"/g, '""')}",1)` } : { stringValue: "" };
  } else c.userEnteredValue = { stringValue: String(valor ?? "") };
  return { updateCells: { range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + 1 }, rows: [{ values: [c] }], fields } };
}
function construirLotesHoja(sheetId, aHoja, hojaActual, filasHoja) {
  const lotes = { actualizar: [], eliminar: [], anadir: [] };
  for (const op of aHoja.actualizar) {
    const dif = diferenciasVinculo(op.de, op.a);
    const reqs = dif.campos.map(([campo, valor]) => requestCampoHoja(sheetId, op.row, campo, valor));
    if (dif.tituloUrl) reqs.push({ updateCells: {
      range: { sheetId, startRowIndex: op.row - 1, endRowIndex: op.row, startColumnIndex: 3, endColumnIndex: 4 },
      rows: [{ values: [{ userEnteredValue: { stringValue: dif.title }, textFormatRuns: dif.url ? [{ startIndex: 0, format: { link: { uri: dif.url } } }] : [] }] }],
      fields: "userEnteredValue,textFormatRuns",
    } });
    lotes.actualizar.push({ k: op.k, reqs });
  }
  const borradas = aHoja.eliminar.map((o) => o.row);
  for (const op of [...aHoja.eliminar].sort((a, b) => b.row - a.row)) {
    lotes.eliminar.push({ k: op.k, reqs: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: op.row - 1, endIndex: op.row } } }] });
  }
  if (aHoja.anadir.length) {
    // Primera fila libre DESPUÉS de los borrados (cada borrado por encima sube las filas de debajo)
    let ultima = 1;
    for (const it of hojaActual) {
      if (borradas.includes(it.row)) continue;
      ultima = Math.max(ultima, it.row - borradas.filter((r) => r < it.row).length);
    }
    let fila = ultima + 1;
    for (const op of aHoja.anadir) {
      const x = normItemVinculo(op.item);
      const num = parseFloat(x.score);
      const valores = Array.from({ length: 11 }, () => ({}));
      valores[0] = { userEnteredValue: { stringValue: x.genre } };
      if (Number.isFinite(num) && num > 0) valores[2] = { userEnteredValue: { numberValue: num }, userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.0" } } };
      valores[3] = x.url ? { userEnteredValue: { stringValue: x.title }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: x.url } } }] } : { userEnteredValue: { stringValue: x.title } };
      valores[5] = { userEnteredValue: { stringValue: x.status } };
      if (x.cover) valores[9] = { userEnteredValue: { formulaValue: `=IMAGE("${x.cover.replace(/"/g, '""')}",1)` } };
      if (x.lastEpisodeUrl) valores[10] = { userEnteredValue: { stringValue: x.lastEpisodeUrl } };
      lotes.anadir.push({ k: op.k, reqs: [{ updateCells: {
        range: { sheetId, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 0, endColumnIndex: 11 },
        rows: [{ values: valores }], fields: "userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat",
      } }] });
      fila++;
    }
    // Si la hoja se queda sin filas para tantas altas, se amplía (solo se sabe el tamaño si la API lo dio)
    const disponibles = Number.isFinite(filasHoja) ? filasHoja - borradas.length : Infinity;
    if (fila - 1 > disponibles) lotes.anadir[0].reqs.unshift({ appendDimension: { sheetId, dimension: "ROWS", length: fila - 1 - disponibles } });
  }
  return lotes;
}
// Envía los lotes por fases (ediciones → borrados → altas), con un máximo de peticiones por llamada. Cada llamada de
// la API de Sheets es atómica: o entra entera o no entra. Lo que no entra se devuelve en `fallos` para reintentarlo.
async function ejecutarLotesHoja(lotes, enviar, maxReqs = 300) {
  const hechos = { actualizadas: 0, eliminadas: 0, anadidas: 0, fallos: new Set() };
  const fase = async (items, contador) => {
    let i = 0, roto = false;
    while (i < items.length) {
      const trozo = [];
      let n = 0;
      while (i < items.length && (n === 0 || n + items[i].reqs.length <= maxReqs)) { trozo.push(items[i]); n += items[i].reqs.length; i++; }
      if (roto) { trozo.forEach((x) => hechos.fallos.add(x.k)); continue; }
      try { await enviar(trozo.flatMap((x) => x.reqs)); hechos[contador] += trozo.length; }
      catch (e) { roto = true; trozo.forEach((x) => hechos.fallos.add(x.k)); }
    }
    return !roto;
  };
  await fase(lotes.actualizar, "actualizadas");
  const bien = await fase(lotes.eliminar, "eliminadas");
  if (bien) await fase(lotes.anadir, "anadidas");
  else lotes.anadir.forEach((x) => hechos.fallos.add(x.k)); // las altas dependen de dónde queden las filas tras los borrados
  return hechos;
}
let GRID_FILAS = null; // filas de la pestaña (para saber si hay que ampliarla al añadir series)
// Filas que tiene ahora la pestaña (null si no se puede saber: entonces no se amplía nada)
async function leerFilasHoja() {
  try {
    const data = await conToken((token) => sheetsFetch("?fields=sheets.properties", token));
    const hoja = (data.sheets || []).map((s) => s.properties).find((p) => p.sheetId === GID);
    return hoja?.gridProperties?.rowCount ?? null;
  } catch (e) { return null; }
}
async function enviarRequestsHoja(requests) {
  await conToken((token) => sheetsFetch(":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) }));
}

// --- Vínculo hoja ↔ nube: motor en la extensión ----------------------------------------------
// Corre en segundo plano al abrir cualquiera de las dos listas en un dispositivo con acceso a la hoja. Si no hay
// sesión de Google Sheets (o no hay conexión) no hace nada ni abre ventanas: la lista de la nube sigue funcionando.
// Para tocar la hoja se «fuerza» su configuración con el bloqueo exclusivo (como al registrar en otra lista).
async function conListaForzada(listaId, fn) {
  const lista = (await getListasGuardadas()).find((l) => l.id === listaId);
  if (!lista) throw new Error("LISTA_NO_ENCONTRADA");
  await adquirirBloqueo("w");
  try {
    resetConfig(true);
    CONFIG_FORZADA = configDeLista(lista);
    return await fn();
  } finally {
    CONFIG_FORZADA = null;
    resetConfig(true);
    liberarBloqueo("w");
  }
}

let colaVinculo = Promise.resolve();
const ultimaSincVinculo = {};
const sincronizarVinculo = (id, opciones = {}) => {
  const p = colaVinculo.catch(() => {}).then(() => _sincronizarVinculo(id, opciones));
  colaVinculo = p;
  return p;
};

async function _sincronizarVinculo(id, { forzar = false, interactivo = false } = {}) {
  if (!id) id = (await chrome.storage.local.get("listaActivaId")).listaActivaId;
  const listas = await getListasGuardadas();
  const l = listas.find((x) => x.id === id);
  const otra = l?.vinculo ? listas.find((x) => x.id === l.vinculo.con) : null;
  if (!l || !otra) return { omitido: "sin_vinculo" };
  const nubeL = l.tipo === "nube" ? l : otra;
  const hojaL = l.tipo === "nube" ? otra : l;
  if (nubeL.tipo !== "nube" || hojaL.tipo === "nube" || hojaL.tipo === "local") return { omitido: "sin_vinculo" };
  if (nubeL.rol === "lectura") return { omitido: "solo_lectura" };
  const clave = claveBaseVinculo(nubeL.id, hojaL.id);
  if (!forzar && Date.now() - (ultimaSincVinculo[clave] || 0) < 45000) return { omitido: "reciente" };
  ultimaSincVinculo[clave] = Date.now();

  // 1) Acceso a la hoja: sin ventanas salvo que el usuario lo haya pedido (botón «Sincronizar ahora»)
  try { await getAuthToken(interactivo); } catch (e) { return { omitido: "sin_sesion_hoja" }; }
  // 2) En paralelo: la lista de la nube al día y la hoja leída (no dependen una de otra). Si la nube se acaba de
  //    sincronizar (al abrir la lista) no se repite.
  const pNube = nubeAlDia(nubeL.id, forzar ? 0 : 8000).then(() => null, (e) => e);
  const { [clave]: baseGuardada } = await chrome.storage.local.get(clave);
  const resultado = await conListaForzada(hojaL.id, async () => {
    const [errNube, hoja] = await Promise.all([pNube, obtenerListaCompleta()]);
    if (errNube) return { omitido: "sin_nube", error: String(errNube?.message || errNube).replace(/^Error:\s*/, "") };
    const base = baseGuardada || {};
    const plan = planificarVinculo(base, hoja, (await leerDatosLocal(nubeL.id)).items);
    if (plan.sospechoso) return { omitido: "borrados_masivos", borrados: plan.borrados };
    const res = resumenVinculoVacio();
    const fallos = new Set();
    // --- Hoja: todos los cambios en una o pocas peticiones
    if (plan.aHoja.anadir.length) GRID_FILAS = await leerFilasHoja();
    const hechos = await ejecutarLotesHoja(construirLotesHoja(GID, plan.aHoja, hoja, GRID_FILAS), enviarRequestsHoja);
    res.hoja.actualizadas = hechos.actualizadas; res.hoja.eliminadas = hechos.eliminadas; res.hoja.anadidas = hechos.anadidas;
    hechos.fallos.forEach((k) => fallos.add(k));
    // --- Nube: sobre los datos locales de la lista (se envían solos al Worker)
    const portadas = [];
    await enColaLocal(async () => {
      const d = await leerDatosLocal(nubeL.id);
      const pos = (k) => d.items.findIndex((i) => claveSerieVinculo(i) === k);
      let cambios = 0;
      for (const op of plan.aNube.actualizar) {
        const i = pos(op.k);
        if (i < 0) { fallos.add(op.k); continue; }
        d.items[i] = { ...d.items[i], ...camposParaNube(op.a) };
        if (d.items[i].cover) portadas.push(d.items[i].cover);
        res.nube.actualizadas++; cambios++;
      }
      for (const op of plan.aNube.anadir) {
        if (pos(op.k) >= 0) continue;
        const it = { row: d.siguiente++, ...camposParaNube(op.item) };
        d.items.push(it);
        if (it.cover) portadas.push(it.cover);
        res.nube.anadidas++; cambios++;
      }
      for (const op of plan.aNube.eliminar) {
        const i = pos(op.k);
        if (i >= 0) { d.items.splice(i, 1); res.nube.eliminadas++; cambios++; }
      }
      if (cambios) await guardarDatosLocal(d, nubeL.id);
    });
    portadas.forEach((u) => precachearImagen(u));
    // Lo que falló se reintenta en la próxima sincronización (su base no cambia)
    const nuevaBase = { ...plan.base };
    for (const k of fallos) { if (k in base) nuevaBase[k] = base[k]; else delete nuevaBase[k]; }
    await chrome.storage.local.set({ [clave]: nuevaBase });
    return { ...res, fallos: fallos.size };
  });
  if (resultado.omitido) return resultado;
  const { listaActivaId } = await chrome.storage.local.get("listaActivaId");
  const tocaHoja = resultado.hoja.actualizadas + resultado.hoja.anadidas + resultado.hoja.eliminadas > 0;
  const tocaNube = resultado.nube.actualizadas + resultado.nube.anadidas + resultado.nube.eliminadas > 0;
  return { ...resultado, cambiosActiva: (listaActivaId === hojaL.id && tocaHoja) || (listaActivaId === nubeL.id && tocaNube) };
}

async function crearVinculo(hojaId, nubeId) {
  const listas = await getListasGuardadas();
  const h = listas.find((l) => l.id === hojaId), n = listas.find((l) => l.id === nubeId);
  if (!h || !n) throw new Error("LISTA_NO_ENCONTRADA");
  if (h.tipo === "local" || h.tipo === "nube" || n.tipo !== "nube") throw new Error("VINCULO_INVALIDO");
  if (n.rol === "lectura") throw new Error("SOLO_LECTURA");
  if (h.vinculo || n.vinculo) throw new Error("YA_VINCULADA");
  h.vinculo = { con: n.id };
  n.vinculo = { con: h.id };
  await setListasGuardadas(listas);
  await chrome.storage.local.remove(claveBaseVinculo(n.id, h.id)); // sin base: la primera sincronización las une
  return {};
}

async function quitarVinculo(id) {
  const listas = await getListasGuardadas();
  const l = listas.find((x) => x.id === id);
  if (!l?.vinculo) return {};
  const par = listas.find((x) => x.id === l.vinculo.con);
  delete l.vinculo;
  if (par) delete par.vinculo;
  await setListasGuardadas(listas);
  await chrome.storage.local.remove([claveBaseVinculo(l.id, par?.id), claveBaseVinculo(par?.id, l.id)]);
  return {};
}

async function manejarMensajeVinculo(msg) {
  switch (msg.type) {
    case "VINCULO_CREAR": return crearVinculo(msg.hojaId, msg.nubeId);
    case "VINCULO_QUITAR": return quitarVinculo(msg.id);
    case "VINCULO_SINCRONIZAR": return sincronizarVinculo(msg.id, { forzar: !!msg.forzar, interactivo: !!msg.interactivo });
  }
  throw new Error("Mensaje desconocido: " + msg.type);
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
                // El 0 significa "sin valorar": se escribe celda vacía, no un 0.
                userEnteredValue: Number.isFinite(parseFloat(score)) && parseFloat(score) > 0 ? { numberValue: parseFloat(score) } : { stringValue: "" },
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
                ...(url ? { textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }] } : {}),
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
  actualizarBadgeAvisos();

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

// Si registrar un capítulo falla (sesión de Google caducada, lista que ya no existe…) se deja anotado el motivo
// y un «!» rojo en el icono; el popup lo explica al abrirse (GET_FALLO). Un registro correcto lo borra.
async function registrarFallo(err, contexto) {
  try {
    await chrome.storage.local.set({ ultimoFallo: { ts: Date.now(), error: String(err?.message || err).slice(0, 300), titulo: String(contexto?.title || "").slice(0, 120), url: String(contexto?.url || contexto?.episodeUrl || "").slice(0, 300) } });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.action.setBadgeText({ text: "!" });
  } catch (e) {}
}
async function limpiarFallo() {
  try { await chrome.storage.local.remove("ultimoFallo"); } catch (e) {}
  actualizarBadgeAvisos();
}

function avisarOk() {
  chrome.storage.local.remove("ultimoFallo").catch(() => {});
  reindexarViendo(); // acaba de escribirse en la hoja: el índice de «Viendo» puede haber cambiado
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  chrome.action.setBadgeText({ text: "OK" });
  setTimeout(() => actualizarBadgeAvisos(), 5000);
}

// --- Flujo principal (registrar / resincronizar estado) ---------------------

// Ejecuta fn(token) y, si el token caducó, lo renueva y reintenta una vez.
async function conToken(fn) {
  let token = await getAuthToken(true);
  try {
    return await fn(token);
  } catch (e) {
    if (String(e).includes("TOKEN_INVALIDO")) {
      token = await getAuthToken(true);
      return await fn(token);
    }
    throw e;
  }
}

function filaPorEnlaceOTitulo(filas, url, titulo) {
  const slug = slugDeUrl(url);
  const tit = String(titulo || "").trim().toLowerCase();
  for (let i = 1; i < filas.length; i++) { // i=0 es la fila de encabezados
    const v = filas[i].values?.[0];
    if (slug && slugDeUrl(v?.hyperlink) === slug) return i;
  }
  for (let i = 1; i < filas.length; i++) {
    const v = filas[i].values?.[0];
    if (tit && (v?.formattedValue || "").trim().toLowerCase() === tit) return i;
  }
  return -1;
}

async function sincronizarExistente(token, filas, i, episodeUrl) {
  const row = i + 1;
  const estadoActual = (filas[i].values?.[2]?.formattedValue || "").trim();
  if (estadoActual !== ESTADO_VIENDO) await actualizarSoloEstado(token, row, ESTADO_VIENDO);
  await actualizarUltimoCapitulo(token, row, episodeUrl);
}

// Series que el usuario ya confirmó como "la misma" (por hoja): slug -> fila existente
function claveVinculo(slug) {
  return `${SPREADSHEET_ID}#${GID}|${slug}`;
}
async function leerVinculos() {
  const { seriesVinculadas = {} } = await chrome.storage.local.get("seriesVinculadas");
  return seriesVinculadas;
}
async function guardarVinculos(v) {
  await chrome.storage.local.set({ seriesVinculadas: v });
}

async function handleEpisodioDetectado(datos) {
  if (await esListaLocal()) return handleEpisodioDetectadoLocal(datos);
  const { slug, title, url, score, description, cover, episodeUrl } = datos;
  const nuevaFila = { title, url, score, description, cover, episodeUrl };
  if (cover) precachearImagen(cover);

  try {
    return await conToken(async (token) => {
      const sheetName = await getSheetName(token);
      const filas = await getFilasDaK(token, sheetName);

      // 1) Ya registrada con este mismo enlace o con el mismo título
      let i = filaPorEnlaceOTitulo(filas, url, title);
      if (i > 0) {
        await sincronizarExistente(token, filas, i, episodeUrl);
        avisarOk();
        return {};
      }

      // 2) El usuario ya dijo antes que esta temporada es una serie que tiene registrada
      const vinculos = await leerVinculos();
      const vinculo = slug ? vinculos[claveVinculo(slug)] : null;
      if (vinculo) {
        i = filaPorEnlaceOTitulo(filas, vinculo.url, vinculo.title);
        if (i > 0) {
          await sincronizarExistente(token, filas, i, episodeUrl);
          avisarOk();
          return {};
        }
        delete vinculos[claveVinculo(slug)]; // la fila ya no existe
        await guardarVinculos(vinculos);
      }

      // 3) ¿Hay series registradas que parezcan la misma (otra temporada/parte)? -> preguntar
      const candidatos = [];
      for (let k = filas.length - 1; k > 0; k--) { // las más recientes primero
        const v = filas[k].values || [];
        const existente = {
          title: (v[0]?.formattedValue || "").trim(),
          url: v[0]?.hyperlink || "",
          cover: extraerUrlImagen(v[6]), // columna J
        };
        if (!existente.title) continue;
        if (sonSeriesRelacionadas({ title, slug }, existente)) candidatos.push(existente);
      }
      if (candidatos.length) {
        return { pregunta: { nuevaFila, slug, candidatos: candidatos.slice(0, 4) } };
      }

      // 4) Serie nueva
      const row = await siguienteFilaLibre(token, sheetName);
      await escribirFilaNueva(token, row, nuevaFila);
      avisarOk();
      return {};
    });
  } catch (e) {
    if (String(e).includes("SIN_CONFIG")) {
      // Aún no hay hoja elegida: avisamos con una insignia en el icono
      registrarFallo(new Error("SIN_CONFIG"), datos);
      return {};
    }
    throw e;
  }
}

// El usuario contestó a la pregunta mostrada en la página
async function resolverSecuela({ decision, slug, existingUrl, existingTitle, nuevaFila }) {
  if (await esListaLocal()) return resolverSecuelaLocal({ decision, slug, existingUrl, existingTitle, nuevaFila });
  await conToken(async (token) => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaK(token, sheetName);

    if (decision === "misma") {
      const i = filaPorEnlaceOTitulo(filas, existingUrl, existingTitle);
      if (i < 1) throw new Error("FILA_NO_ENCONTRADA");
      await sincronizarExistente(token, filas, i, nuevaFila.episodeUrl);
      if (slug) {
        const vinculos = await leerVinculos();
        vinculos[claveVinculo(slug)] = { url: existingUrl, title: existingTitle };
        await guardarVinculos(vinculos);
      }
    } else {
      const row = await siguienteFilaLibre(token, sheetName);
      await escribirFilaNueva(token, row, nuevaFila);
    }
    avisarOk();
  });
}

// --- Lista completa para el popup (con filtros/orden en el propio popup) ---

// Columnas A:K -> índices dentro del array "values" de cada fila:
// 0=A,1=B,2=C,3=D,4=E,5=F,6=G,7=H,8=I,9=J,10=K
async function obtenerListaCompleta(opciones = {}) {
  estadoNube = null;
  if (await esListaLocal()) {
    if (!opciones.sinSync && (await listaNube(LISTA_LOCAL_ID))) { // se sincroniza en segundo plano; la lista no espera
      lanzarSyncAlAbrir(LISTA_LOCAL_ID);
      estadoNube = { id: LISTA_LOCAL_ID, ok: true, pendiente: true };
    }
    const d = await leerDatosLocal();
    guardarIndiceViendo(d.items).catch(() => {});
    return d.items;
  }
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
  guardarIndiceViendo(lista).catch(() => {});
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
  if (await esListaLocal()) return actualizarCampoLocal(row, campo, valor);
  const token = await getAuthToken(true);
  await getSheetName(token);
  const colIndex = COLUMNAS_EDITABLES[campo];
  if (colIndex === undefined) throw new Error("Campo desconocido: " + campo);

  const celda = { userEnteredValue: null };
  const fields = ["userEnteredValue"];

  if (campo === "score") {
    // El 0 significa "sin valorar", no una nota cero: se guarda como celda vacía.
    // Así el 0 nunca aparece en la hoja y la columna C solo contiene notas reales.
    const num = parseFloat(String(valor).replace(",", "."));
    celda.userEnteredValue = !Number.isFinite(num) || num <= 0 ? { stringValue: "" } : { numberValue: num };
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
  if (campo === "status" || campo === "lastEpisodeUrl") reindexarViendo();
}

// Título y enlace viven en la misma celda (columna D): el texto es el
// título, y el enlace va como hyperlink sobre ese texto.
async function actualizarTituloUrl(row, title, url) {
  if (await esListaLocal()) return actualizarTituloUrlLocal(row, title, url);
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
  reindexarViendo(); // el enlace es lo que identifica la serie en la página de inicio
}

// --- Rellenar portadas que faltan (columna J) ------------------------------

function extraerPortadaDesdeHtml(html) {
  const match = html.match(/cdn\.animeav1\.com\/covers\/\d+\.jpg/i);
  return match ? `https://${match[0]}` : null;
}

async function rellenarPortadas() {
  if (await esListaLocal()) return rellenarPortadasLocal();
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
  if (await esListaLocal()) return actualizarGenerosLoteLocal(cambios);
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

// Reconoce enlaces de AnimeAV1 a la ficha de una serie o a un episodio concreto:
//   https://animeav1.com/media/black-clover-2nd-season      -> serie
//   https://animeav1.com/media/black-clover-2nd-season/1    -> episodio 1 de esa serie
// Devuelve { slug, url (ficha de la serie), episodeUrl ("" si no es un episodio) }.
// Otros sitios se aceptan como antes (sin slug ni episodio). null si no es un enlace válido.
function parsearEnlaceAnime(texto) {
  let t = String(texto || "").trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t) && /^(www\.)?animeav1\.com\//i.test(t)) t = "https://" + t;
  let u;
  try { u = new URL(t); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "animeav1.com") return { slug: "", url: u.href, episodeUrl: "" };
  const m = u.pathname.match(/^\/media\/([^/]+)(?:\/(\d+))?\/?$/);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  const url = `https://animeav1.com/media/${slug}`;
  return { slug, url, episodeUrl: m[2] ? `${url}/${m[2]}` : "" };
}

// Serie de la lista activa (o de la forzada) que corresponde a este título/enlace
async function buscarSerieParaPortada(title, url) {
  const lista = await obtenerListaCompleta();
  const tit = String(title || "").trim().toLowerCase();
  return lista.find((x) => (url && x.url && x.url === url) || (tit && String(x.title || "").trim().toLowerCase() === tit)) || null;
}
async function portadaSerie({ title, url, cover }) {
  const fila = await buscarSerieParaPortada(title, url);
  if (!fila) return { necesita: false };
  if (fila.cover) return { necesita: false };
  if (!cover) return { necesita: true };
  const limpia = String(cover);
  if (!/^https?:\/\//i.test(limpia)) throw new Error("URL_INVALIDA");
  await actualizarCampo(fila.row, "cover", limpia);
  precachearImagen(limpia);
  return { necesita: false, guardada: true };
}

// --- Otras páginas fuente (BETA) ------------------------------------------------------------
// El usuario añade una web (permiso por web, pedido desde el popup) y un asistente que corre dentro de esa web
// (fuente.js) guarda una "receta": patrón de dirección de capítulo + selectores de título, portada y ficha.
// La receta vive en chrome.storage.local ("fuentes"); fuente.js se registra solo para los sitios añadidos.
function origenDe(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("URL_INVALIDA");
  if (/(^|\.)animeav1\.com$/i.test(u.hostname)) throw new Error("YA_SOPORTADA");
  return u.origin;
}
const idFuente = (origen) => "fuente-" + origen.replace(/[^a-z0-9]/gi, "_");

async function registrarScriptFuente(origen) {
  const id = idFuente(origen);
  if ((await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) return;
  await chrome.scripting.registerContentScripts([{ id, matches: [origen + "/*"], js: ["visto.js", "ui-pregunta.js", "fuente.js"], runAt: "document_idle", persistAcrossSessions: true }]);
}

// Deja registrado el script de cada web fuente y, si se pide, lo inyecta en las pestañas que ya estaban abiertas.
// Se ejecuta cada vez que arranca el service worker, al instalar/actualizar la extensión y con el botón «Reparar».
// Así las fuentes siguen registrando solas aunque Chrome haya olvidado el registro o la pestaña sea anterior a la actualización.
async function asegurarScriptsFuentes({ inyectar = false } = {}) {
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  let reparadas = 0, pestanas = 0;
  for (const f of fuentes) {
    try {
      if (!(await chrome.permissions.contains({ origins: [f.origen + "/*"] }))) continue;
      const id = idFuente(f.origen);
      const registrado = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      if (!registrado.length) { await registrarScriptFuente(f.origen); reparadas++; }
      else if (!(registrado[0].js || []).includes("visto.js")) { // registro de una versión anterior: se añade visto.js
        await chrome.scripting.updateContentScripts([{ id, js: ["visto.js", "ui-pregunta.js", "fuente.js"] }]);
        reparadas++;
      }
      if (inyectar) {
        for (const t of await chrome.tabs.query({ url: f.origen + "/*" })) {
          try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["visto.js", "ui-pregunta.js", "fuente.js"] }); pestanas++; } catch (e) {}
        }
      }
    } catch (e) { console.error("[AnimeAV1 Tracker] Fuente", f?.origen, e); }
  }
  return { fuentes: fuentes.length, reparadas, pestanas };
}

async function iniciarAsistenteFuente(url) {
  const origen = origenDe(url);
  if (!(await chrome.permissions.contains({ origins: [origen + "/*"] }))) throw new Error("SIN_PERMISO");
  await registrarScriptFuente(origen);
  await chrome.storage.local.set({ asistenteFuente: { origen, ts: Date.now() } });
  await chrome.tabs.create({ url });
}

// Dónde está el número del capítulo en la dirección: { seg, num } o { q, num } (null = no se sabe)
function limpiarCapitulo(c) {
  if (!c || typeof c !== "object" || !Number.isInteger(c.num) || c.num >= 0 || c.num < -10) return null;
  if (Number.isInteger(c.seg) && c.seg >= 0 && c.seg <= 30) return { seg: c.seg, num: c.num };
  if (typeof c.q === "string" && c.q && c.q.length <= 40) return { q: c.q, num: c.num };
  return null;
}

async function guardarFuente(r) {
  const origen = origenDe(r?.origen || "");
  const sel = r?.selectores || {};
  if (typeof sel.titulo !== "string" || !sel.titulo) throw new Error("FALTA_TITULO_FUENTE");
  try { new RegExp(r.patron); } catch (e) { throw new Error("PATRON_INVALIDO"); }
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  const receta = {
    id: idFuente(origen), nombre: String(r.nombre || origen).slice(0, 60), origen, activa: true, patron: String(r.patron), listaId: String(r.listaId || ""),
    capitulo: limpiarCapitulo(r.capitulo),
    selectores: { titulo: sel.titulo, portada: String(sel.portada || ""), portadaSerie: String(sel.portadaSerie || ""), serie: String(sel.serie || "") },
    ejemplo: { titulo: String(r.ejemplo?.titulo || ""), ruta: String(r.ejemplo?.ruta || ""), portada: String(r.ejemplo?.portada || ""), hostPortada: String(r.ejemplo?.hostPortada || "") },
    hostsImg: [],
    creada: Date.now(),
  };
  await registrarScriptFuente(origen);
  await chrome.storage.local.set({ fuentes: [...fuentes.filter((f) => f.origen !== origen), receta] });
  await chrome.storage.local.remove("asistenteFuente");
}

async function actualizarFuente(id, cambios) {
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  const f = fuentes.find((x) => x.id === id);
  if (!f) throw new Error("FUENTE_NO_ENCONTRADA");
  if (cambios.activa !== undefined) f.activa = !!cambios.activa;
  if (cambios.capitulo !== undefined) f.capitulo = limpiarCapitulo(cambios.capitulo);
  if (cambios.lista !== undefined) f.listaId = String(cambios.lista || ""); // "" = la lista que esté abierta
  if (cambios.receta) { // editar la receta sin repetir el asistente
    const r = cambios.receta;
    if (typeof r.nombre === "string" && r.nombre.trim()) f.nombre = r.nombre.trim().slice(0, 60);
    if (r.patron !== undefined) {
      try { new RegExp(r.patron); } catch (e) { throw new Error("PATRON_INVALIDO"); }
      f.patron = String(r.patron);
    }
    if (r.selectores) {
      const s = r.selectores;
      if (typeof s.titulo !== "string" || !s.titulo.trim()) throw new Error("FALTA_TITULO_FUENTE");
      f.selectores = { titulo: s.titulo.trim(), portada: String(s.portada || "").trim(), portadaSerie: String(s.portadaSerie || "").trim(), serie: String(s.serie || "").trim() };
    }
  }
  await chrome.storage.local.set({ fuentes });
}

// Portadas de otras webs: muchos servidores de imágenes (p. ej. el de manhwaweb) solo las sirven si la petición
// trae como Referer la web de origen. Con permiso para ese servidor, estas reglas de declarativeNetRequest ponen
// ese Referer en las peticiones de imágenes que hace la propia extensión (popup y segundo plano). El permiso lo
// concede el usuario desde Opciones (botón «Permitir imágenes de …»).
const patronHost = (h) => `https://${h}/*`;
async function aplicarReglasReferer() {
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  const reglas = [];
  for (const f of fuentes) {
    for (const host of f.hostsImg || []) {
      if (!(await chrome.permissions.contains({ origins: [patronHost(host)] }))) continue;
      reglas.push({
        id: reglas.length + 1, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: f.origen + "/" }] },
        condition: { requestDomains: [host], initiatorDomains: [chrome.runtime.id], resourceTypes: ["image", "xmlhttprequest", "other"] },
      });
    }
  }
  const previas = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: previas.map((r) => r.id), addRules: reglas });
}

async function activarReferer(id, hosts) {
  const limpios = [...new Set((Array.isArray(hosts) ? hosts : []).map((h) => String(h).toLowerCase()))].filter((h) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h));
  if (!limpios.length) throw new Error("URL_INVALIDA");
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  const f = fuentes.find((x) => x.id === id);
  if (!f) throw new Error("FUENTE_NO_ENCONTRADA");
  for (const h of limpios) if (!(await chrome.permissions.contains({ origins: [patronHost(h)] }))) throw new Error("SIN_PERMISO");
  f.hostsImg = [...new Set([...(f.hostsImg || []), ...limpios])];
  await chrome.storage.local.set({ fuentes });
  await aplicarReglasReferer();
}

async function borrarFuente(id) {
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  const f = fuentes.find((x) => x.id === id);
  if (!f) throw new Error("FUENTE_NO_ENCONTRADA");
  await chrome.storage.local.set({ fuentes: fuentes.filter((x) => x.id !== id) });
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
  try { await chrome.permissions.remove({ origins: [f.origen + "/*", ...(f.hostsImg || []).map(patronHost)] }); } catch (e) {}
  try { await aplicarReglasReferer(); } catch (e) {}
}

// --- Icono personalizado de la barra de herramientas ------------------------------------
// chrome.action.setIcon no se conserva al reiniciar Chrome ni al despertar el service worker, así que se
// guardan los PNG en chrome.storage.local y se vuelven a aplicar al arrancar.
async function guardarIconoPersonal(iconos) {
  const lados = [16, 32, 48, 128];
  const valido = iconos && lados.every((n) => typeof iconos[n] === "string" && iconos[n].startsWith("data:image/png;base64,") && iconos[n].length < 400000);
  if (!valido) throw new Error("ICONO_INVALIDO");
  await chrome.storage.local.set({ iconoPersonal: Object.fromEntries(lados.map((n) => [n, iconos[n]])) });
  await aplicarIconoPersonal();
}

async function aplicarIconoPersonal() {
  const { iconoPersonal } = await chrome.storage.local.get("iconoPersonal");
  if (!iconoPersonal) return;
  const imageData = {};
  for (const [lado, dataUrl] of Object.entries(iconoPersonal)) {
    const n = Number(lado);
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const ctx = new OffscreenCanvas(n, n).getContext("2d");
    ctx.drawImage(bmp, 0, 0, n, n);
    imageData[n] = ctx.getImageData(0, 0, n, n);
  }
  await chrome.action.setIcon({ imageData });
}
aplicarIconoPersonal().catch(() => {});
aplicarReglasReferer().catch(() => {});
chrome.runtime.onStartup.addListener(() => aplicarIconoPersonal().catch(() => {}));
asegurarScriptsFuentes().catch(() => {}); // cada vez que arranca el service worker
chrome.runtime.onInstalled.addListener(() => asegurarScriptsFuentes({ inyectar: true }).catch(() => {})); // instalación y actualización
chrome.runtime.onStartup.addListener(() => asegurarScriptsFuentes().catch(() => {}));

// Mayor número de capítulo que aparece en la ficha de la serie (enlaces .../media/<slug>/<n>).
// null = no se pudo saber (sin conexión, o la ficha no lista capítulos): el popup actúa como si existiera.
// ¿La serie está en emisión o ya ha terminado? Se lee de la ficha (texto visible). Solo se aceptan líneas que
// sean exactamente una insignia («Finalizado», «En emisión»…) o «Estado: …», para no confundir una palabra suelta
// de una sinopsis o de un menú de filtros. null = no se sabe (entonces no se propone nada).
const RE_SERIE_FIN = /^(finalizad[oa]s?|terminad[oa]s?|completad[oa]s?|concluid[oa]s?|finished(?: airing)?|completed|ended)$/i;
const RE_SERIE_EMISION = /^(en emisi[oó]n|emiti[eé]ndose|emitiendo|en curso|en publicaci[oó]n|currently airing|airing|ongoing|releasing|pr[oó]ximamente|upcoming|not yet aired|por estrenar)$/i;
function clasificarEmision(t) {
  t = String(t || "").replace(/^[^\p{L}]+/u, "").replace(/[.:!]+$/, "").trim(); // sin iconos/símbolos delante ni puntuación al final
  if (RE_SERIE_FIN.test(t)) return "terminada";
  if (RE_SERIE_EMISION.test(t)) return "emision";
  return null;
}
function estadoEmisionDeHtml(html) {
  const limpio = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|select|nav|footer|noscript|template)\b[\s\S]*?<\/\1>/gi, "");
  const lineas = limpio.replace(/<[^>]*>/g, "\n").replace(/&nbsp;/g, " ").split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const m = l.match(/^(?:estado|status|emisi[oó]n)\s*:\s*(.+)$/i);
    if (m) { const c = clasificarEmision(m[1]); if (c) return c; }
    if (/^(?:estado|status)\s*:?$/i.test(l) && lineas[i + 1]) { const c = clasificarEmision(lineas[i + 1]); if (c) return c; }
    if (l.length <= 24) { const c = clasificarEmision(l); if (c) return c; } // insignia suelta
  }
  // Respaldo: datos incrustados en la página (status:"Finalizado"…). Solo vale si todos coinciden.
  const claves = new Set();
  for (const m of String(html || "").matchAll(/["']?\b(?:status|estado)["']?\s*:\s*["']([^"']{3,24})["']/gi)) { const c = clasificarEmision(m[1]); if (c) claves.add(c); }
  return claves.size === 1 ? [...claves][0] : null;
}

// --- Avisos de capítulos nuevos --------------------------------------------------------------------
// Si el ajuste está activado, cada AVISOS_CADA_MIN minutos se mira la ficha de cada serie en «Viendo» y, si hay
// capítulos publicados que no has visto, se muestra una notificación (una sola por tanda) y el número de series
// pendientes en el icono. Se guarda en chrome.storage.local:
//   avisosCapitulos: boolean (el ajuste)
//   avisosCaps: { clave, ts, max: {slug: último capítulo publicado}, notificados: {slug: capítulo ya avisado} }
// El contador se recalcula sin red cada vez que cambia el índice «Viendo» (p. ej. al ver un capítulo).
const AVISOS_ALARMA = "avisoCapitulos";
const AVISOS_CADA_MIN = 180;
let comprobandoAvisos = false;
let ultimoIntentoAvisos = 0;

async function avisosActivos() {
  try { return !!(await chrome.storage.local.get("avisosCapitulos")).avisosCapitulos; } catch (e) { return false; }
}

async function programarAvisos() {
  try {
    if (await avisosActivos()) {
      const a = await chrome.alarms.get(AVISOS_ALARMA);
      if (!a || a.periodInMinutes !== AVISOS_CADA_MIN) chrome.alarms.create(AVISOS_ALARMA, { delayInMinutes: 1, periodInMinutes: AVISOS_CADA_MIN });
    } else {
      await chrome.alarms.clear(AVISOS_ALARMA);
    }
  } catch (e) {}
}

async function activarAvisos(activo) {
  await chrome.storage.local.set({ avisosCapitulos: activo });
  await programarAvisos();
  if (activo) comprobarCapitulosNuevos({ silencioso: true }).catch(() => {}); // al activarlo, el contador se rellena sin avisar de lo ya pendiente
  else await actualizarBadgeAvisos();
}

// Series en «Viendo» con capítulos publicados (según la última comprobación) que no has visto
async function calcularPendientesAvisos() {
  const { indiceViendo, avisosCaps } = await chrome.storage.local.get(["indiceViendo", "avisosCaps"]);
  if (!indiceViendo || !avisosCaps || avisosCaps.clave !== indiceViendo.clave) return [];
  const out = [];
  for (const [slug, ultimo] of Object.entries(indiceViendo.ultimos || {})) {
    const max = avisosCaps.max?.[slug];
    if (Number.isFinite(max) && max > ultimo) out.push({ slug, ultimo, max, titulo: indiceViendo.titulos?.[slug] || "" });
  }
  return out;
}

// Pinta el contador. El «!» rojo de un registro fallido tiene prioridad: no se pisa.
async function actualizarBadgeAvisos() {
  try {
    const { ultimoFallo } = await chrome.storage.local.get("ultimoFallo");
    if (ultimoFallo) return;
    const n = (await avisosActivos()) ? (await calcularPendientesAvisos()).length : 0;
    await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    await chrome.action.setBadgeText({ text: n ? String(n) : "" });
  } catch (e) {}
}

// Si cambia la lista activa, los datos de la anterior no sirven: se recalculan en silencio (como mucho cada 10 min)
async function avisosTrasCambioDeLista() {
  if (comprobandoAvisos || Date.now() - ultimoIntentoAvisos < 10 * 60 * 1000) return;
  if (!(await avisosActivos())) return;
  const { indiceViendo, avisosCaps } = await chrome.storage.local.get(["indiceViendo", "avisosCaps"]);
  if (indiceViendo && (!avisosCaps || avisosCaps.clave !== indiceViendo.clave)) comprobarCapitulosNuevos({ silencioso: true }).catch(() => {});
}

async function comprobarCapitulosNuevos({ silencioso = false } = {}) {
  if (comprobandoAvisos) return;
  comprobandoAvisos = true;
  ultimoIntentoAvisos = Date.now();
  try {
    if (!(await avisosActivos())) { await actualizarBadgeAvisos(); return; }
    try { await refrescarIndiceViendo({ force: true }); } catch (e) {} // sin sesión de Google o sin red: se usa el último índice guardado
    const { indiceViendo, avisosCaps } = await chrome.storage.local.get(["indiceViendo", "avisosCaps"]);
    if (!indiceViendo) return;
    const slugs = Object.keys(indiceViendo.ultimos || {});
    const mismaLista = !!avisosCaps && avisosCaps.clave === indiceViendo.clave;
    const max = {};
    for (const s of slugs) if (mismaLista && Number.isFinite(avisosCaps.max?.[s])) max[s] = avisosCaps.max[s]; // si falla una consulta se conserva el dato anterior
    let i = 0, consultadas = 0;
    await Promise.all(Array.from({ length: Math.min(3, slugs.length) }, async () => {
      while (i < slugs.length) {
        const slug = slugs[i++];
        const info = await infoCapitulos(slug);
        if (info) consultadas++;
        if (info && Number.isFinite(info.max)) max[slug] = info.max;
      }
    }));
    if (slugs.length && !consultadas) return; // sin conexión: no se toca nada
    const notificados = mismaLista ? { ...(avisosCaps.notificados || {}) } : {};
    const pendientes = [];
    for (const s of slugs) if (Number.isFinite(max[s]) && max[s] > indiceViendo.ultimos[s]) pendientes.push({ slug: s, ultimo: indiceViendo.ultimos[s], max: max[s], titulo: indiceViendo.titulos?.[s] || "" });
    // Solo se avisa de lo que no se había avisado ya. Con otra lista (o al activarlo) se marca todo como avisado sin notificar.
    const nuevos = pendientes.filter((p) => !(notificados[p.slug] >= p.max));
    for (const p of nuevos) notificados[p.slug] = p.max;
    for (const s of Object.keys(notificados)) if (!(s in max)) delete notificados[s];
    await chrome.storage.local.set({ avisosCaps: { clave: indiceViendo.clave, ts: Date.now(), max, notificados } });
    await actualizarBadgeAvisos();
    if (nuevos.length && mismaLista && !silencioso) notificarCapitulosNuevos(nuevos);
  } finally {
    comprobandoAvisos = false;
  }
}

function notificarCapitulosNuevos(nuevos) {
  const nombre = (p) => p.titulo || p.slug.replace(/-/g, " ");
  const n = nuevos.length;
  let url = "", title, message;
  if (n === 1) {
    const p = nuevos[0];
    url = `https://animeav1.com/media/${p.slug}/${p.ultimo + 1}`;
    title = "Capítulo nuevo";
    message = `${nombre(p)} — capítulo ${p.ultimo + 1}` + (p.max > p.ultimo + 1 ? ` (hay hasta el ${p.max})` : "");
  } else {
    title = `${n} series con capítulos nuevos`;
    message = nuevos.slice(0, 4).map(nombre).join(", ") + (n > 4 ? ` y ${n - 4} más` : "");
  }
  try { chrome.notifications.create(`capnuevo|${Date.now()}|${url}`, { type: "basic", iconUrl: "icon128.png", title, message }); } catch (e) {}
}

try {
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === AVISOS_ALARMA) comprobarCapitulosNuevos().catch(() => {}); });
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith("capnuevo|")) return;
    const url = id.split("|").slice(2).join("|");
    chrome.notifications.clear(id);
    if (url) chrome.tabs.create({ url });
    else chrome.action.openPopup?.().catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => { programarAvisos(); actualizarBadgeAvisos(); });
  chrome.runtime.onInstalled.addListener(() => { programarAvisos(); });
} catch (e) {}
programarAvisos();
actualizarBadgeAvisos();

// Ficha de la serie: mayor capítulo publicado y si está en emisión o terminada (null = no se pudo saber)
async function infoCapitulos(slug) {
  if (!/^[a-z0-9-]+$/i.test(slug || "")) return null;
  try {
    const res = await fetch(`https://animeav1.com/media/${slug}`);
    if (!res.ok) return null;
    const html = await res.text();
    let max = 0;
    for (const m of html.matchAll(new RegExp(`/media/${slug}/(\\d+)(?!\\d)`, "gi"))) max = Math.max(max, parseInt(m[1], 10));
    return { max: max > 0 ? max : null, emision: estadoEmisionDeHtml(html) };
  } catch (e) { return null; }
}
async function capituloMaximo(slug) { return (await infoCapitulos(slug))?.max ?? null; }

// --- «¿Has terminado la serie?»: propone pasarla a «Visto» -------------------------------------
// Fila de la lista activa que corresponde a esa serie (por su enlace o por una temporada vinculada)
async function buscarSerieActiva(slug) {
  const url = `https://animeav1.com/media/${slug}`;
  if (await esListaLocal()) {
    const d = await leerDatosLocal();
    let it = buscarItemLocal(d.items, url, "");
    if (!it) { const v = (await leerVinculos())[claveVinculo(slug)]; if (v) it = buscarItemLocal(d.items, v.url, v.title); }
    return it ? { row: it.row, title: it.title, status: it.status } : null;
  }
  return conToken(async (token) => {
    const sheetName = await getSheetName(token);
    const filas = await getFilasDaK(token, sheetName);
    let i = filaPorEnlaceOTitulo(filas, url, "");
    if (i < 1) { const v = (await leerVinculos())[claveVinculo(slug)]; if (v) i = filaPorEnlaceOTitulo(filas, v.url, v.title); }
    if (i < 1) return null;
    const v = filas[i].values || [];
    return { row: i + 1, title: (v[0]?.formattedValue || "").trim(), status: (v[2]?.formattedValue || "").trim() };
  });
}

// Solo propone si: el capítulo es el último publicado, la ficha dice que la serie ha terminado, está en «Viendo»
// y el usuario no dijo «Ahora no» para ese mismo capítulo.
async function comprobarFinal(slug, ep) {
  const n = Number(ep);
  if (!Number.isInteger(n) || n < 1) return { proponer: false };
  const info = await infoCapitulos(slug);
  if (!info || info.emision !== "terminada" || info.max !== n) return { proponer: false };
  const { finalDescartado = {} } = await chrome.storage.local.get("finalDescartado");
  if (finalDescartado[slug] === n) return { proponer: false };
  const serie = await buscarSerieActiva(slug);
  if (!serie || serie.status !== ESTADO_VIENDO) return { proponer: false };
  return { proponer: true, title: serie.title, ep: n };
}

async function marcarVisto(slug) {
  const serie = await buscarSerieActiva(slug);
  if (!serie || serie.status !== ESTADO_VIENDO) return { marcada: false };
  await actualizarCampo(serie.row, "status", "✔");
  const { finalDescartado = {} } = await chrome.storage.local.get("finalDescartado");
  if (slug in finalDescartado) { delete finalDescartado[slug]; await chrome.storage.local.set({ finalDescartado }); }
  return { marcada: true, title: serie.title };
}

async function descartarFinal(slug, ep) {
  const { finalDescartado = {} } = await chrome.storage.local.get("finalDescartado");
  finalDescartado[slug] = Number(ep);
  const claves = Object.keys(finalDescartado);
  if (claves.length > 300) delete finalDescartado[claves[0]]; // no crece sin límite
  await chrome.storage.local.set({ finalDescartado });
}
async function capituloSiguienteExiste({ url, serie, patron }) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const { fuentes = [] } = await chrome.storage.local.get("fuentes");
  if (!fuentes.some((f) => f.origen === u.origin && f.activa !== false)) return null;
  if (!(await chrome.permissions.contains({ origins: [u.origin + "/*"] }))) return null;
  let re = null;
  try { re = new RegExp(patron); } catch (e) {}
  const norm = (p) => { try { p = decodeURIComponent(p); } catch (e) {} return p.replace(/\/+$/, "") || "/"; };
  const objetivo = norm(u.pathname);
  const { capsConocidos = {} } = await chrome.storage.local.get("capsConocidos");
  if ((capsConocidos[u.origin] || []).some((r) => norm(r) === objetivo)) return true; // visto enlazado en la web
  let hayLista = false;
  try {
    const s = new URL(serie);
    if (s.origin === u.origin) {
      const res = await fetch(s.href, { credentials: "include" });
      if (res.ok) {
        const html = await res.text();
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)/gi)) {
          let h;
          try { h = new URL(m[1].replace(/&amp;/g, "&"), s.href); } catch (e) { continue; }
          if (h.origin !== u.origin) continue;
          if (norm(h.pathname) === objetivo) return true;
          if (re && re.test(h.pathname)) hayLista = true;
        }
      }
    }
  } catch (e) {}
  try {
    const res = await fetch(u.href, { credentials: "include" });
    if (res.status === 404 || res.status === 410) return false;
    if (!res.ok) return null;
    if (res.redirected) { try { if (norm(new URL(res.url).pathname) !== objetivo) return false; } catch (e) {} }
    return hayLista ? false : null; // 200 sin poder confirmarlo (web dibujada con JavaScript): no se sabe
  } catch (e) { return null; }
}

async function registrarAnimePorUrl(enlace) {
  const p = parsearEnlaceAnime(enlace);
  if (!p) throw new Error("ENLACE_ANIME_INVALIDO");

  // ¿Ya está registrada? Se compara por enlace (también si el guardado es de un episodio) y por slug.
  const lista = await obtenerListaCompleta();
  const canon = (s) => String(s || "").replace(/\/+$/, "");
  const existente = lista.find((a) => a.url && (canon(a.url) === canon(p.url) || (p.slug && slugDeUrl(a.url) === p.slug)));
  if (existente) {
    // Con un enlace de episodio se aprovecha para dejarla "viendo" y guardar ese último capítulo.
    if (!p.episodeUrl) throw new Error("YA_EXISTE");
    await handleEpisodioDetectado({ slug: p.slug, title: existente.title, url: p.url, episodeUrl: p.episodeUrl });
    return { title: existente.title, url: existente.url, actualizada: true };
  }

  // Título y portada siempre salen de la ficha de la serie (aunque se haya pegado un episodio).
  let html;
  try {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error();
    html = await res.text();
  } catch (e) {
    throw new Error("NO_SE_PUDO_LEER_LA_PAGINA");
  }

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = h1Match ? h1Match[1].trim() : "";
  if (!title) throw new Error("SIN_TITULO");
  const cover = extraerPortadaDesdeHtml(html) || "";

  // Mismo flujo que al abrir un episodio: si parece otra temporada de una serie
  // registrada devuelve una "pregunta"; si no, crea la fila.
  const resultado = await handleEpisodioDetectado({ slug: p.slug, title, url: p.url, cover, episodeUrl: p.episodeUrl });
  return { title, url: p.url, cover, status: ESTADO_VIENDO, ...(resultado || {}) };
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

// Slug de una ficha de AnimeFLV (cualquier subdominio: www, www3, www4…): /anime/<slug>
function slugDeAnimeFlv(enlace) {
  try {
    const u = new URL(enlace);
    if (!/(^|\.)animeflv\.net$/i.test(u.hostname)) return "";
    const m = u.pathname.match(/\/anime\/([^/]+)/i);
    return m ? m[1].toLowerCase() : "";
  } catch (e) {
    return "";
  }
}

const compactoTitulo = (t) => normalizarTitulo(t).replace(/ /g, "");

async function buscarEnAnimeAV1(titulo, enlaceFlv) {
  const slugFlv = slugDeAnimeFlv(enlaceFlv);
  const candidatos = [...new Set([slugify(titulo), slugFlv, slugFlv.replace(/-?(tv|season-?\d+)$/, "")].filter(Boolean))];
  for (const slug of candidatos) {
    const url = `https://animeav1.com/media/${slug}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const html = await res.text();
      const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const h1 = h1Match ? h1Match[1].trim() : "";
      if (!h1) continue;
      const ch = compactoTitulo(h1);
      if (ch === compactoTitulo(titulo) || (slugFlv && ch === slugFlv.replace(/-/g, ""))) return { url, html };
    } catch (e) {}
  }
  return null;
}

function extraerPortadaAnimeFlv(html) {
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1) return m1[1];
  const m2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m2 ? m2[1] : null;
}

async function migrarAnimeFlv() {
  if (await esListaLocal()) return migrarAnimeFlvLocal();
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

    const encontrado = await buscarEnAnimeAV1(titulo, enlace);

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
