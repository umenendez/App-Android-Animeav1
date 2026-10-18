/* AnimeAV1 Tracker - capa web para la PWA.
 * Sustituye chrome.storage/chrome.identity por localStorage + Google Identity Services.
 */
(function () {
  const CFG = window.PWA_CONFIG || {};
  const COVER_CACHE = "anime-covers-v1";
  const ESTADO_VIENDO = "-";

  // En Android, si el navegador nota que casi no usas la PWA, puede borrar
  // sus datos (localStorage incluido) para liberar espacio — eso es lo que
  // hacía que, pasado un tiempo, se perdiera el enlace del Sheet guardado y
  // volviera a pedirlo. Pedir almacenamiento "persistente" evita ese borrado
  // automático. Es un permiso silencioso (no muestra ningún diálogo en la
  // mayoría de los casos) y si el navegador lo deniega no pasa nada más.
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((yaConcedido) => {
        if (!yaConcedido) navigator.storage.persist().catch(() => {});
      }).catch(() => {});
    }
  } catch (e) {}

  let accessToken = null;
  let tokenExpiresAt = 0;
  const WORKER_URL = "https://red-violet-9fed.unaxmenendez.workers.dev";
  // localStorage (no sessionStorage): tiene que sobrevivir a cerrar del
  // todo la app y volver a abrirla, no solo a recargar la pestaña. Sigue
  // sin evitar el aviso pasada la hora de vida del token (eso ya es un
  // límite de Google, no nuestro), pero si abres/cierras varias veces
  // dentro de esa hora ya no debería volver a pedir nada.
  try {
    const guardado = JSON.parse(localStorage.getItem("gauth") || "null");
    if (guardado?.token && guardado.exp > Date.now()) {
      accessToken = guardado.token;
      tokenExpiresAt = guardado.exp;
    }
  } catch (e) {}
  function guardarTokenSesion() {
    try { localStorage.setItem("gauth", JSON.stringify({ token: accessToken, exp: tokenExpiresAt })); } catch (e) {}
  }
  function borrarTokenSesion() {
    try { localStorage.removeItem("gauth"); } catch (e) {}
  }
  let spreadsheetId = null;
  let gidConfig = null;
  let gid = 0;
  let cachedSheetName = null;
  let listaLocalId = null; // id de la lista activa si es una lista local (sin Google Sheets)
  let tokenClient = null;
  let tokenClientId = null;
  let gisReady = null;

  function parsearEnlaceSheet(texto) {
    const t = String(texto || "").trim();
    const m = t.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const id = m ? m[1] : /^[a-zA-Z0-9_-]{25,}$/.test(t) ? t : null;
    if (!id) return null;
    const g = t.match(/[#&?]gid=(\d+)/);
    return { spreadsheetId: id, gid: g ? parseInt(g[1], 10) : null };
  }

  // El Client ID de OAuth ya no hace falta pegarlo en config.js: se pide en
  // el propio formulario junto al enlace del Google Sheet y se guarda en
  // este dispositivo (localStorage). config.js solo se usa como valor por
  // defecto si el usuario no ha guardado ninguno todavía.
  function obtenerClientIdGuardado() {
    try { return (localStorage.getItem("oauthClientId") || "").trim(); } catch (e) { return ""; }
  }
  function guardarClientIdLocal(id) {
    try {
      if (id) localStorage.setItem("oauthClientId", id);
      else localStorage.removeItem("oauthClientId");
    } catch (e) {}
  }
  function obtenerClientId() {
    return obtenerClientIdGuardado() || CFG.googleClientId || "";
  }

  // Con listas locales no se usa nada de Google: el script de inicio de sesión solo se
  // descarga la primera vez que hace falta (al usar una hoja de Google Sheets).
  function cargarScriptGIS() {
    if (window.google?.accounts?.oauth2 || document.querySelector("script[data-gis]")) return;
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.dataset.gis = "1";
    document.head.append(sc);
  }

  function esperarGIS() {
    if (gisReady) return gisReady;
    cargarScriptGIS();
    gisReady = new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (window.google?.accounts?.oauth2) return resolve();
        if (Date.now() - start > 15000) return reject(new Error("GOOGLE_GIS_NO_CARGA"));
        setTimeout(tick, 100);
      };
      tick();
    });
    return gisReady;
  }

  // --- Inicio de sesión de Google (solo del lado del cliente) -------------
  // El token de Google dura 1 hora y sin servidor no hay forma de renovarlo
  // del todo a escondidas. Lo que sí se puede hacer:
  //  - recordar el correo de la cuenta y pasarlo como "hint": la ventana de
  //    Google elige esa cuenta sola y, como ya diste permiso, se cierra al
  //    instante (nada de selector ni de "cambiar de cuenta");
  //  - renovar el token con el primer toque cuando le queda poco, para que
  //    no caduque mientras usas la app;
  //  - si de verdad hace falta iniciar sesión, abrir directamente el
  //    selector de cuentas de Google.
  const SCOPES = (CFG.googleScopes || "https://www.googleapis.com/auth/spreadsheets") +
    " https://www.googleapis.com/auth/userinfo.email";
  let pendiente = null;
  let tokenEnCurso = null;

  function emailGuardado() {
    try { return localStorage.getItem("gemail") || ""; } catch (e) { return ""; }
  }
  function guardarEmail(e) {
    try { if (e) localStorage.setItem("gemail", e); else localStorage.removeItem("gemail"); } catch (x) {}
  }
  async function recordarCuenta(token) {
    try {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const d = await r.json();
      if (d.email) guardarEmail(d.email);
    } catch (e) {}
  }

  function crearTokenClient(clientId) {
    if (tokenClient && tokenClientId === clientId) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (r) => pendiente && pendiente.ok(r),
      // Sin esto, si el navegador bloquea o se cierra la ventana de Google,
      // la promesa se quedaba colgada para siempre.
      error_callback: (e) => pendiente && pendiente.err(new Error(e?.type || "popup_error"))
    });
    tokenClientId = clientId;
    return tokenClient;
  }

  function pedirToken(clientId, prompt) {
    return new Promise((resolve, reject) => {
      const cliente = crearTokenClient(clientId);
      pendiente = {
        ok: (r) => {
          if (r?.error) return reject(new Error(r.error));
          if (!r?.access_token) return reject(new Error("NO_SE_OBTUVO_TOKEN"));
          accessToken = r.access_token;
          tokenExpiresAt = Date.now() + ((r.expires_in || 3600) * 1000);
          guardarTokenSesion();
          recordarCuenta(accessToken);
          resolve(accessToken);
        },
        err: reject
      };
      const opciones = { prompt };
      const hint = emailGuardado();
      if (hint && prompt !== "select_account") opciones.hint = hint;
      try { cliente.requestAccessToken(opciones); } catch (e) { reject(e); }
    });
  }

  function esErrorDeVentana(e) {
    const m = String(e?.message || e);
    return m.includes("popup_failed_to_open") || m.includes("popup_closed");
  }

  // interactive=true: si hace falta, abre el selector de cuentas de Google.
  // forzar=true: renueva aunque el token actual aún sea válido.
  function ensureToken(interactive = true, forzar = false) {
    if (!forzar && accessToken && Date.now() < tokenExpiresAt - 60000) return Promise.resolve(accessToken);
    if (tokenEnCurso) return tokenEnCurso;
    tokenEnCurso = (async () => {
      const clientId = obtenerClientId();
      if (!clientId) throw new Error("CONFIGURA_CLIENT_ID_WEB");
      await esperarGIS();
      try {
        if (emailGuardado()) {
          try { return await pedirToken(clientId, ""); }
          catch (e) { if (esErrorDeVentana(e) || !interactive) throw e; }
        }
        if (!interactive) throw new Error("popup_failed_to_open");
        return await pedirToken(clientId, "select_account");
      } catch (e) {
        if (esErrorDeVentana(e)) throw new Error("NECESITA_INICIO_SESION");
        throw e;
      }
    })().finally(() => { tokenEnCurso = null; });
    return tokenEnCurso;
  }

  // Mientras usas la app, con el primer toque cuando al token le quedan
  // menos de 10 minutos (o ya caducó) se renueva en silencio, con la cuenta
  // recordada. Así casi nunca caduca a mitad de uso.
  let ultimoRefrescoAuto = 0;
  document.addEventListener("pointerdown", () => {
    if (!emailGuardado() || !window.google?.accounts?.oauth2) return;
    try { if (JSON.parse(localStorage.getItem("config") || "null")?.tipo === "local") return; } catch (e) {} // lista local: sin Google
    if (accessToken && Date.now() < tokenExpiresAt - 10 * 60 * 1000) return;
    if (tokenEnCurso || Date.now() - ultimoRefrescoAuto < 60000) return;
    ultimoRefrescoAuto = Date.now();
    ensureToken(false, true).catch(() => {});
  }, { capture: true, passive: true });

  // Botón explícito "Cambiar de cuenta": olvida la cuenta y abre el selector.
  async function cambiarCuenta() {
    accessToken = null; tokenExpiresAt = 0; guardarEmail("");
    guardarTokenSesion();
    const clientId = obtenerClientId();
    if (!clientId) throw new Error("CONFIGURA_CLIENT_ID_WEB");
    await esperarGIS();
    try { await pedirToken(clientId, "select_account"); }
    catch (e) { throw esErrorDeVentana(e) ? new Error("NECESITA_INICIO_SESION") : e; }
    resetConfig();
    return { cambiada: true };
  }

  async function sheetsFetch(path, options = {}) {
    const token = await ensureToken(true);
    await cargarConfig();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      accessToken = null; tokenExpiresAt = 0; guardarTokenSesion();
      throw new Error("TOKEN_INVALIDO");
    }
    if (res.status === 404) throw new Error("HOJA_NO_ENCONTRADA");
    if (res.status === 403) throw new Error("SIN_PERMISO");
    if (!res.ok) throw new Error(`Error de Sheets API (${res.status}): ${await res.text()}`);
    return res.json();
  }

  async function cargarConfig() {
    if (spreadsheetId) return;
    const config = JSON.parse(localStorage.getItem("config") || "null");
    if (config?.tipo === "local" && config.listaId) {
      // Lista local: sin hoja. spreadsheetId/gid reciben valores propios para que las claves que
      // dependen de ellos (vínculos de temporadas) sigan siendo únicas.
      listaLocalId = config.listaId; spreadsheetId = `local:${config.listaId}`; gidConfig = 0; gid = 0;
      return;
    }
    if (!config?.spreadsheetId) throw new Error("SIN_CONFIG");
    spreadsheetId = config.spreadsheetId;
    gidConfig = config.gid ?? null;
  }

  function resetConfig() {
    spreadsheetId = null; gidConfig = null; cachedSheetName = null; listaLocalId = null;
  }
  function rango(nombre, celdas) { return `'${nombre.replace(/'/g, "''")}'!${celdas}`; }

  async function getSheetName() {
    if (await esListaLocal()) return "";
    if (cachedSheetName) return cachedSheetName;
    const data = await sheetsFetch("?fields=sheets.properties");
    const hojas = (data.sheets || []).map(s => s.properties);
    const hoja = (gidConfig !== null && hojas.find(h => h.sheetId === gidConfig)) || hojas[0];
    if (!hoja) throw new Error("El documento no tiene ninguna pestaña");
    gid = hoja.sheetId; cachedSheetName = hoja.title;
    return cachedSheetName;
  }

  async function guardarConfig(enlace, clientId) {
    const p = parsearEnlaceSheet(enlace);
    if (!p) throw new Error("ENLACE_INVALIDO");
    if (clientId !== undefined) {
      const limpio = String(clientId || "").trim();
      if (limpio && limpio !== obtenerClientIdGuardado()) {
        guardarClientIdLocal(limpio);
        accessToken = null; tokenExpiresAt = 0; borrarTokenSesion();
      }
    }
    if (!obtenerClientId()) throw new Error("CONFIGURA_CLIENT_ID_WEB");
    const token = await ensureToken(true);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p.spreadsheetId}?fields=properties.title,sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) throw new Error("TOKEN_INVALIDO");
    if (res.status === 404) throw new Error("HOJA_NO_ENCONTRADA");
    if (res.status === 403) throw new Error("SIN_PERMISO");
    if (!res.ok) throw new Error(`Error de Sheets API (${res.status})`);
    const data = await res.json();
    const hojas = (data.sheets || []).map(s => s.properties);
    const hoja = (p.gid !== null && hojas.find(h => h.sheetId === p.gid)) || hojas[0];
    if (!hoja) throw new Error("El documento no tiene ninguna pestaña");
    localStorage.setItem("config", JSON.stringify({
      spreadsheetId: p.spreadsheetId, gid: p.gid, url: String(enlace).trim(),
      titulo: data.properties?.title || "", hoja: hoja.title
    }));
    resetConfig();
    const encabezadosCreados = await asegurarEncabezados();
    return { titulo: data.properties?.title || "", hoja: hoja.title, encabezadosCreados };
  }

  // --- Varias listas guardadas (por ejemplo, la de un amigo) -------------------

  function obtenerListasArr() {
    try { return JSON.parse(localStorage.getItem("listas") || "[]"); } catch (e) { return []; }
  }
  function guardarListasArr(arr) {
    try { localStorage.setItem("listas", JSON.stringify(arr)); } catch (e) {}
  }
  function idListaActiva() {
    try { return localStorage.getItem("listaActivaId") || null; } catch (e) { return null; }
  }
  function marcarListaActiva(id) {
    try {
      if (id) localStorage.setItem("listaActivaId", id);
      else localStorage.removeItem("listaActivaId");
    } catch (e) {}
  }
  function nuevoIdLista() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // La primera vez que se abre el gestor de listas, convierte la hoja que ya
  // tenías configurada en la primera entrada de la lista, para que también
  // aparezca en el selector.
  function obtenerListasParaUI() {
    let listas = obtenerListasArr();
    const config = JSON.parse(localStorage.getItem("config") || "null");
    if (listas.length === 0 && config?.spreadsheetId) {
      const migrada = {
        id: nuevoIdLista(), name: "Mi lista", url: config.url,
        spreadsheetId: config.spreadsheetId, gid: config.gid,
        titulo: config.titulo, hoja: config.hoja
      };
      listas = [migrada];
      guardarListasArr(listas);
      marcarListaActiva(migrada.id);
    }
    const activaId = idListaActiva();
    return listas.map((l) => ({ ...l, activa: l.id === activaId }));
  }

  async function verificarAccesoHoja(p) {
    if (!obtenerClientId()) throw new Error("CONFIGURA_CLIENT_ID_WEB");
    const token = await ensureToken(true);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p.spreadsheetId}?fields=properties.title,sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) throw new Error("TOKEN_INVALIDO");
    if (res.status === 404) throw new Error("HOJA_NO_ENCONTRADA");
    if (res.status === 403) throw new Error("SIN_PERMISO");
    if (!res.ok) throw new Error(`Error de Sheets API (${res.status})`);
    const data = await res.json();
    const hojas = (data.sheets || []).map(s => s.properties);
    const hoja = (p.gid !== null && hojas.find(h => h.sheetId === p.gid)) || hojas[0];
    if (!hoja) throw new Error("El documento no tiene ninguna pestaña");
    return { titulo: data.properties?.title || "", hoja: hoja.title };
  }

  async function agregarListaGuardada(nombre, enlace) {
    const nombreLimpio = String(nombre || "").trim();
    if (!nombreLimpio) throw new Error("FALTA_NOMBRE");
    const p = parsearEnlaceSheet(enlace);
    if (!p) throw new Error("ENLACE_INVALIDO");
    const { titulo, hoja } = await verificarAccesoHoja(p);
    obtenerListasParaUI(); // asegura la migración de "Mi lista" si hacía falta
    const listas = obtenerListasArr();
    const nueva = {
      id: nuevoIdLista(), name: nombreLimpio, url: String(enlace).trim(),
      spreadsheetId: p.spreadsheetId, gid: p.gid, titulo, hoja
    };
    listas.push(nueva);
    guardarListasArr(listas);
    return { id: nueva.id, name: nueva.name, titulo, hoja };
  }

  async function eliminarListaGuardada(id) {
    const listas = obtenerListasArr();
    const restantes = listas.filter((l) => l.id !== id);
    if (restantes.length === listas.length) throw new Error("LISTA_NO_ENCONTRADA");
    guardarListasArr(restantes);
    const quitada = listas.find((l) => l.id === id);
    if (quitada?.tipo === "local") { try { localStorage.removeItem(claveDatosLocal(id)); } catch (e) {} }
    if (idListaActiva() === id) {
      const siguiente = restantes[0] || null;
      marcarListaActiva(siguiente?.id || null);
      // La configuración activa debe seguir a la lista activa (si no, seguiría apuntando a la borrada)
      if (siguiente) localStorage.setItem("config", JSON.stringify(configDeLista(siguiente)));
      else localStorage.removeItem("config");
      resetConfig();
    }
    return { removed: true };
  }

  // Configuración activa que corresponde a una lista guardada (hoja de Google o lista local)
  function configDeLista(l) {
    if (l.tipo === "local") return { tipo: "local", listaId: l.id, url: l.url, titulo: l.titulo, hoja: "" };
    return { spreadsheetId: l.spreadsheetId, gid: l.gid, url: l.url, titulo: l.titulo, hoja: l.hoja };
  }

  async function cambiarListaActiva(id) {
    const listas = obtenerListasArr();
    const lista = listas.find((l) => l.id === id);
    if (!lista) throw new Error("LISTA_NO_ENCONTRADA");
    localStorage.setItem("config", JSON.stringify(configDeLista(lista)));
    marcarListaActiva(id);
    resetConfig();
    return { titulo: lista.titulo, hoja: lista.hoja, name: lista.name };
  }

  async function asegurarEncabezados() {
    const nombre = await getSheetName();
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(nombre, "A1:K1"))}&fields=sheets.data.rowData.values(formattedValue)`);
    const fila = data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
    if (fila.some(c => (c.formattedValue || "").trim())) return false;
    const encabezados = ["Género", "", "Nota", "Título", "Descripción", "Estado", "", "", "", "Portada", "Último capítulo"];
    const requests = [{ updateCells: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: encabezados.length },
      rows: [{ values: encabezados.map(t => ({ userEnteredValue: { stringValue: t }, userEnteredFormat: { textFormat: { bold: true } } })) }],
      fields: "userEnteredValue,userEnteredFormat.textFormat"
    }}];
    await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
    return true;
  }

  async function getFilasDaK(sheetName) {
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(sheetName, "D:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink)`);
    return data.sheets?.[0]?.data?.[0]?.rowData || [];
  }

  function extraerUrlImagen(celda) {
    if (!celda) return "";
    const formula = celda.userEnteredValue?.formulaValue || "";
    const match = formula.match(/IMAGE\(\s*"([^"]+)"/i);
    if (match) return match[1];
    const texto = celda.formattedValue || "";
    return /^https?:\/\//i.test(texto) ? texto : "";
  }

  async function obtenerListaCompleta() {
    if (await esListaLocal()) return leerDatosLocal().items;
    const sheetName = await getSheetName();
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(sheetName, "A:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)`);
    const rows = data.sheets?.[0]?.data?.[0]?.rowData || [];
    const lista = [];
    rows.forEach((r, i) => {
      if (i === 0) return;
      const v = r.values || [];
      const title = v[3]?.formattedValue || "";
      if (!title) return;
      lista.push({ row:i+1, genre:v[0]?.formattedValue || "", score:v[2]?.formattedValue || "", title,
        url:v[3]?.hyperlink || "", status:(v[5]?.formattedValue || "").trim(), cover:extraerUrlImagen(v[9]),
        lastEpisodeUrl:v[10]?.formattedValue || v[10]?.hyperlink || "" });
    });
    return lista;
  }

  const COLUMNAS_EDITABLES = { score:2, status:5, genre:0, cover:9, lastEpisodeUrl:10 };
  async function actualizarCampo(row, campo, valor) {
    if (await esListaLocal()) return actualizarCampoLocal(row, campo, valor);
    await getSheetName();
    const colIndex = COLUMNAS_EDITABLES[campo];
    if (colIndex === undefined) throw new Error("Campo desconocido: " + campo);
    const celda = { userEnteredValue: null };
    const fields = ["userEnteredValue"];
    if (campo === "score") {
      // El 0 significa "sin valorar", no una nota cero: se guarda como celda vacía.
      // Así el 0 nunca aparece en la hoja y la columna C solo contiene notas reales.
      const num = parseFloat(String(valor).replace(",", "."));
      celda.userEnteredValue = !Number.isFinite(num) || num <= 0 ? { stringValue:"" } : { numberValue:num };
      celda.userEnteredFormat = { numberFormat:{ type:"NUMBER", pattern:"0.0" } };
      fields.push("userEnteredFormat.numberFormat");
    } else if (campo === "cover") {
      celda.userEnteredValue = valor ? { formulaValue:`=IMAGE("${String(valor).replace(/"/g, '""')}",1)` } : { stringValue:"" };
    } else celda.userEnteredValue = { stringValue:String(valor ?? "") };
    await sheetsFetch(":batchUpdate", { method:"POST", body:JSON.stringify({ requests:[{ updateCells:{
      range:{sheetId:gid,startRowIndex:row-1,endRowIndex:row,startColumnIndex:colIndex,endColumnIndex:colIndex+1},
      rows:[{values:[celda]}], fields:fields.join(",")
    }}] }) });
  }

  // Cambia la columna A de varias filas en una sola petición (renombrar/quitar géneros)
  async function actualizarGenerosLote(cambios) {
    if (await esListaLocal()) return actualizarGenerosLoteLocal(cambios);
    await getSheetName();
    if (!cambios?.length) return;
    await sheetsFetch(":batchUpdate", { method:"POST", body:JSON.stringify({ requests:cambios.map(c => ({ updateCells:{
      range:{sheetId:gid,startRowIndex:c.row-1,endRowIndex:c.row,startColumnIndex:0,endColumnIndex:1},
      rows:[{values:[{userEnteredValue:{stringValue:String(c.valor ?? "")}}]}], fields:"userEnteredValue"
    }})) }) });
  }

  async function actualizarTituloUrl(row, title, url) {
    if (await esListaLocal()) return actualizarTituloUrlLocal(row, title, url);
    await getSheetName();
    await sheetsFetch(":batchUpdate", { method:"POST", body:JSON.stringify({ requests:[{ updateCells:{
      range:{sheetId:gid,startRowIndex:row-1,endRowIndex:row,startColumnIndex:3,endColumnIndex:4},
      rows:[{values:[{userEnteredValue:{stringValue:title},textFormatRuns:[{startIndex:0,format:{link:{uri:url}}}]}]}],
      fields:"userEnteredValue,textFormatRuns"
    }}] }) });
  }

  async function siguienteFilaLibre(sheetName) {
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(sheetName, "D:D"))}&fields=sheets.data.rowData.values(formattedValue)`);
    const filas = data.sheets?.[0]?.data?.[0]?.rowData || [];
    let ultimaConTitulo = 1; // la fila 1 es la cabecera
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

  // --- Series relacionadas (temporadas, partes, arcos…) ---------------------------
  // Reduce un título (o un slug) a su "núcleo": quita marcadores de temporada/parte
  // en inglés y castellano ("3rd Season", "Season 3", "Segunda Temporada", "Part 2",
  // "Cour 2", "Final Season", "II", "2"…) y subtítulos tras ": " o " - ".
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
    t = t.replace(/\s+(ii|iii|iv|vi|vii|viii|ix)\s*$/, "");
    t = t.replace(/\s+\d{1,2}\s*$/, "");
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

  function sonSeriesRelacionadas(nueva, existente) {
    const nuevos = [nucleoTitulo(nueva.title), nucleoTitulo(String(nueva.slug || "").replace(/-/g, " "))];
    const slugExistente = slugDeUrl(existente.url);
    const existentes = [nucleoTitulo(existente.title), slugExistente ? nucleoTitulo(slugExistente.replace(/-/g, " ")) : ""];
    return nuevos.some((n) => existentes.some((e) => nucleosRelacionados(n, e)));
  }

  // Series que el usuario ya confirmó como "la misma" (por hoja): slug -> serie existente
  function claveVinculo(slug) { return `${spreadsheetId}#${gid}|${slug}`; }
  function leerVinculos() {
    try { return JSON.parse(localStorage.getItem("seriesVinculadas") || "{}") || {}; } catch (e) { return {}; }
  }
  function guardarVinculos(v) {
    try { localStorage.setItem("seriesVinculadas", JSON.stringify(v)); } catch (e) {}
  }

  function filaExistente(lista, url, titulo) {
    const slug = slugDeUrl(url);
    const tit = String(titulo || "").trim().toLowerCase();
    return (slug && lista.find((a) => slugDeUrl(a.url) === slug))
      || (tit && lista.find((a) => (a.title || "").trim().toLowerCase() === tit))
      || null;
  }

  // Pone la serie existente como "viendo" y, si se pegó un episodio, lo guarda como último capítulo.
  // Último capítulo que se guarda al marcar una serie como «viendo». Sin enlace de episodio (se añadió la
  // ficha de una temporada nueva y se dijo «es la misma serie») se guarda la ficha de esa temporada, que
  // equivale a «aún no has visto ninguno» (el siguiente es el 1). Si ya vas por esa temporada, no se toca.
  function ultimoParaSerie(anime, episodeUrl, url) {
    if (episodeUrl) return episodeUrl;
    return url && slugDeUrl(anime.lastEpisodeUrl) !== slugDeUrl(url) ? url : "";
  }

  async function marcarViendo(anime, episodeUrl) {
    if (anime.status !== ESTADO_VIENDO) await actualizarCampo(anime.row, "status", ESTADO_VIENDO);
    if (episodeUrl) await actualizarCampo(anime.row, "lastEpisodeUrl", String(episodeUrl).trim());
  }

  async function escribirAnimeNuevo({ title, url, cover, episodeUrl }) {
    if (await esListaLocal()) return escribirAnimeNuevoLocal({ title, url, cover, episodeUrl });
    const sheetName = await getSheetName();
    const fila = await siguienteFilaLibre(sheetName);

    const valores = new Array(11).fill(null).map(() => ({}));
    valores[3] = { userEnteredValue: { stringValue: title }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }] };
    valores[5] = { userEnteredValue: { stringValue: ESTADO_VIENDO } };
    if (cover) valores[9] = { userEnteredValue: { formulaValue: `=IMAGE("${cover}",1)` } };
    if (episodeUrl) valores[10] = { userEnteredValue: { stringValue: episodeUrl } };

    await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ updateCells: {
      range: { sheetId: gid, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 0, endColumnIndex: 11 },
      rows: [{ values: valores }],
      fields: "userEnteredValue,textFormatRuns"
    }}] }) });

    if (cover) precachearImagen(cover);
    return { row: fila, title, url, cover: cover || "", status: ESTADO_VIENDO };
  }

  // El usuario contestó a "¿Es la misma serie?"
  // --- Listas locales (sin Google Sheets) --------------------------------------------
  // Una lista local vive en localStorage ("datosLista:<id>") con las mismas filas que
  // devolvería la hoja: { row, genre, score, title, url, status, cover, lastEpisodeUrl }.
  // El popup se encarga de exportarla a / importarla desde un archivo .json.
  // Todo es síncrono (localStorage), así que no hace falta ninguna cola de escrituras.
  function claveDatosLocal(id) { return `datosLista:${id}`; }

  async function esListaLocal() {
    try { await cargarConfig(); } catch (e) { return false; }
    return listaLocalId !== null;
  }

  function leerDatosLocal(id = listaLocalId) {
    try {
      const d = JSON.parse(localStorage.getItem(claveDatosLocal(id)) || "null");
      if (d && Array.isArray(d.items)) return d;
    } catch (e) {}
    return { items: [], siguiente: 2 };
  }
  function guardarDatosLocal(d, id = listaLocalId) { localStorage.setItem(claveDatosLocal(id), JSON.stringify(d)); }

  // Mismo criterio que la hoja: vacío o ≤ 0 = sin valorar; una décima; máximo 10.
  function notaLocal(valor) {
    const n = parseFloat(String(valor ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? (Math.min(10, Math.round(n * 10) / 10)).toFixed(1) : "";
  }

  function itemLocal(x, row) {
    const title = String(x?.title ?? "").trim();
    if (!title) return null;
    return {
      row, genre: String(x.genre ?? "").trim(), score: notaLocal(x.score), title,
      url: String(x.url ?? "").trim(), status: String(x.status ?? "").trim(),
      cover: String(x.cover ?? "").trim(), lastEpisodeUrl: String(x.lastEpisodeUrl ?? "").trim(),
    };
  }

  function agregarListaLocal(nombre, series) {
    const nombreLimpio = String(nombre || "").trim();
    if (!nombreLimpio) throw new Error("FALTA_NOMBRE");
    if (series !== undefined && !Array.isArray(series)) throw new Error("JSON_INVALIDO");
    const items = [];
    let fila = 2; // como en la hoja, la fila 1 serían los encabezados
    for (const x of series || []) { const it = itemLocal(x, fila); if (it) { items.push(it); fila++; } }
    obtenerListasParaUI(); // asegura la migración de "Mi lista" si hacía falta
    const id = nuevoIdLista();
    guardarDatosLocal({ items, siguiente: fila }, id);
    const listas = obtenerListasArr();
    listas.push({ id, name: nombreLimpio, tipo: "local", url: `local:${id}`, spreadsheetId: "", gid: null, titulo: nombreLimpio, hoja: "" });
    guardarListasArr(listas);
    return { id, name: nombreLimpio, total: items.length };
  }

  function exportarListaLocal(id) {
    const lista = obtenerListasArr().find((l) => l.id === id && l.tipo === "local");
    if (!lista) throw new Error("LISTA_NO_ENCONTRADA");
    return { nombre: lista.name, series: leerDatosLocal(id).items.map(({ row, ...resto }) => resto) };
  }

  // Mover series entre listas: se ejecuta contra la lista indicada cambiando la configuración un momento
  async function conLista(listaId, fn) {
    if (!listaId || listaId === idListaActiva()) return fn();
    const lista = obtenerListasArr().find((l) => l.id === listaId);
    if (!lista) throw new Error("LISTA_NO_ENCONTRADA");
    const previa = localStorage.getItem("config");
    localStorage.setItem("config", JSON.stringify(configDeLista(lista)));
    resetConfig();
    try { return await fn(); }
    finally {
      if (previa === null) localStorage.removeItem("config"); else localStorage.setItem("config", previa);
      resetConfig();
    }
  }

  async function agregarSerieCompleta(s) {
    const title = String(s?.title ?? "").trim();
    if (!title) throw new Error("FALTA_TITULO");
    if (await esListaLocal()) return agregarSerieLocal({ ...s, title });
    const sheetName = await getSheetName();
    const filas = await getFilasDaK(sheetName);
    const slug = slugDeUrl(s.url), tit = title.toLowerCase();
    const existe = filas.some((f, i) => i >= 1 && ((slug && slugDeUrl(f.values?.[0]?.hyperlink) === slug) || (f.values?.[0]?.formattedValue || "").trim().toLowerCase() === tit));
    if (existe) throw new Error("YA_EXISTE");
    const fila = await siguienteFilaLibre(sheetName);
    const num = parseFloat(String(s.score ?? "").replace(",", "."));
    const valores = new Array(11).fill(null).map(() => ({}));
    valores[0] = { userEnteredValue: { stringValue: String(s.genre ?? "") } };
    valores[2] = Number.isFinite(num) && num > 0 ? { userEnteredValue: { numberValue: num }, userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.0" } } } : {};
    valores[3] = s.url ? { userEnteredValue: { stringValue: title }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: String(s.url) } } }] } : { userEnteredValue: { stringValue: title } };
    valores[5] = { userEnteredValue: { stringValue: String(s.status ?? "") } };
    if (s.cover) valores[9] = { userEnteredValue: { formulaValue: `=IMAGE("${String(s.cover).replace(/"/g, '""')}",1)` } };
    if (s.lastEpisodeUrl) valores[10] = { userEnteredValue: { stringValue: String(s.lastEpisodeUrl) } };
    await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ updateCells: {
      range: { sheetId: gid, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 0, endColumnIndex: 11 },
      rows: [{ values: valores }], fields: "userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat"
    }}] }) });
    if (s.cover) precachearImagen(s.cover);
    return fila;
  }

  async function eliminarSerie(row, title) {
    if (await esListaLocal()) return eliminarSerieLocal(row);
    const n = Number(row);
    if (!Number.isInteger(n) || n < 2) throw new Error("FILA_NO_ENCONTRADA");
    const sheetName = await getSheetName();
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(sheetName, `D${n}`))}&fields=sheets.data.rowData.values(formattedValue)`);
    const actual = (data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.formattedValue || "").trim().toLowerCase();
    if (!actual || actual !== String(title || "").trim().toLowerCase()) throw new Error("FILA_CAMBIADA");
    await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: n - 1, endIndex: n } } }] }) });
  }

  function buscarItemLocal(items, url, titulo) {
    const slug = slugDeUrl(url);
    const tit = String(titulo || "").trim().toLowerCase();
    return (slug && items.find((i) => slugDeUrl(i.url) === slug))
      || (tit && items.find((i) => i.title.trim().toLowerCase() === tit))
      || null;
  }

  function anadirItemLocal(d, { title, url, score, cover, episodeUrl, status }) {
    const it = { row: d.siguiente++, genre: "", score: notaLocal(score), title: String(title || "").trim(), url: url || "",
      status: status ?? ESTADO_VIENDO, cover: cover || "", lastEpisodeUrl: episodeUrl || "" };
    d.items.push(it);
    return it;
  }

  function actualizarCampoLocal(row, campo, valor) {
    if (COLUMNAS_EDITABLES[campo] === undefined) throw new Error("Campo desconocido: " + campo);
    const d = leerDatosLocal();
    const it = d.items.find((i) => i.row === Number(row));
    if (!it) throw new Error("FILA_NO_ENCONTRADA");
    if (campo === "score") it.score = notaLocal(valor);
    else if (campo === "cover") { it.cover = String(valor || ""); if (it.cover) precachearImagen(it.cover); }
    else it[campo] = String(valor ?? "");
    guardarDatosLocal(d);
  }

  function actualizarGenerosLoteLocal(cambios) {
    if (!Array.isArray(cambios) || !cambios.length) return;
    const d = leerDatosLocal();
    const porFila = new Map(d.items.map((i) => [i.row, i]));
    for (const c of cambios) { const it = porFila.get(Number(c.row)); if (it) it.genre = String(c.valor ?? ""); }
    guardarDatosLocal(d);
  }

  function actualizarTituloUrlLocal(row, title, url) {
    const d = leerDatosLocal();
    const it = d.items.find((i) => i.row === Number(row));
    if (!it) throw new Error("FILA_NO_ENCONTRADA");
    it.title = String(title || "").trim() || it.title;
    it.url = String(url || "").trim();
    guardarDatosLocal(d);
  }

  // Añadir una serie escribiendo los datos a mano (solo listas locales)
  async function agregarSerieLocal(datos) {
    if (!(await esListaLocal())) throw new Error("NO_ES_LISTA_LOCAL");
    const title = String(datos?.title ?? "").trim();
    if (!title) throw new Error("FALTA_TITULO");
    const d = leerDatosLocal();
    if (buscarItemLocal(d.items, datos.url, title)) throw new Error("YA_EXISTE");
    const it = itemLocal({ ...datos, title }, d.siguiente);
    d.siguiente++;
    d.items.push(it);
    guardarDatosLocal(d);
    if (it.cover) precachearImagen(it.cover);
    return it.row;
  }

  // Las listas locales no tienen hoja de la que borrar filas: se borra desde aquí
  async function eliminarSerieLocal(row) {
    if (!(await esListaLocal())) throw new Error("NO_ES_LISTA_LOCAL");
    const d = leerDatosLocal();
    const antes = d.items.length;
    d.items = d.items.filter((i) => i.row !== Number(row));
    if (d.items.length === antes) throw new Error("FILA_NO_ENCONTRADA");
    guardarDatosLocal(d);
  }

  // Serie nueva desde un enlace de AnimeAV1 (equivale a escribirAnimeNuevo, contra la lista local)
  function escribirAnimeNuevoLocal({ title, url, cover, episodeUrl }) {
    const d = leerDatosLocal();
    const it = anadirItemLocal(d, { title, url, cover, episodeUrl });
    guardarDatosLocal(d);
    if (cover) precachearImagen(cover);
    return { row: it.row, title, url, cover: cover || "", status: ESTADO_VIENDO };
  }

  async function rellenarPortadasLocal() {
    const hallazgos = []; let sinImagen = 0;
    for (const it of leerDatosLocal().items) {
      if (it.cover || !it.url) continue;
      try {
        const img = extraerPortadaDesdeHtml(await (await fetch(it.url)).text());
        if (!img) { sinImagen++; continue; }
        hallazgos.push([it.row, img]); precachearImagen(img);
      } catch (e) { sinImagen++; }
    }
    if (hallazgos.length) { // se vuelve a leer: durante las descargas la lista pudo cambiar
      const d = leerDatosLocal();
      for (const [row, img] of hallazgos) { const it = d.items.find((i) => i.row === row); if (it && !it.cover) it.cover = img; }
      guardarDatosLocal(d);
    }
    return { encontradas: hallazgos.length, sinImagen };
  }

  async function migrarAnimeFlvLocal() {
    const cambios = []; let migradas = 0, portadasFlv = 0, sinCambios = 0;
    for (const it of leerDatosLocal().items) {
      if (!it.url.includes("animeflv")) continue;
      const encontrado = await buscarEnAnimeAV1(it.title);
      if (encontrado) {
        const c = { row: it.row, url: encontrado.url };
        if (!it.cover) { const img = extraerPortadaDesdeHtml(encontrado.html); if (img) { c.cover = img; precachearImagen(img); } }
        cambios.push(c); migradas++;
      } else if (!it.cover) {
        try {
          const img = extraerPortadaAnimeFlv(await (await fetch(it.url)).text());
          if (img) { cambios.push({ row: it.row, cover: img }); precachearImagen(img); portadasFlv++; } else sinCambios++;
        } catch (e) { sinCambios++; }
      } else sinCambios++;
    }
    if (cambios.length) {
      const d = leerDatosLocal();
      for (const c of cambios) { const it = d.items.find((i) => i.row === c.row); if (!it) continue; if (c.url) it.url = c.url; if (c.cover) it.cover = c.cover; }
      guardarDatosLocal(d);
    }
    return { migradas, portadasFlv, sinCambios };
  }

  // Mayor número de capítulo que aparece en la ficha de la serie (enlaces .../media/<slug>/<n>).
  // null = no se pudo saber (sin conexión, o la ficha no lista capítulos): el popup actúa como si existiera.
  async function capituloMaximo(slug) {
    if (!/^[a-z0-9-]+$/i.test(slug || "")) return null;
    try {
      const r = await fetch(`${WORKER_URL}/leer?url=${encodeURIComponent("https://animeav1.com/media/" + slug)}`);
      const upstream = Number(r.headers.get("X-Proxy-Upstream-Status") || 0);
      if (!r.ok || (upstream && upstream >= 400)) return null;
      const html = await r.text();
      let max = 0;
      for (const m of html.matchAll(new RegExp(`/media/${slug}/(\\d+)(?!\\d)`, "gi"))) max = Math.max(max, parseInt(m[1], 10));
      return max > 0 ? max : null;
    } catch (e) { return null; }
  }

  async function resolverSecuela({ decision, slug, existingUrl, existingTitle, nuevaFila }) {
    if (decision === "misma") {
      const lista = await obtenerListaCompleta();
      const anime = filaExistente(lista, existingUrl, existingTitle);
      if (!anime) throw new Error("FILA_NO_ENCONTRADA");
      await marcarViendo(anime, ultimoParaSerie(anime, nuevaFila?.episodeUrl, nuevaFila?.url));
      if (slug) {
        await getSheetName(); // asegura spreadsheetId/gid para la clave
        const vinculos = leerVinculos();
        vinculos[claveVinculo(slug)] = { url: existingUrl, title: existingTitle };
        guardarVinculos(vinculos);
      }
      return { title: anime.title, vinculada: true };
    }
    return await escribirAnimeNuevo(nuevaFila);
  }

  // Añade un anime nuevo a partir de su enlace: descarga la página, saca el
  // título y la portada, y crea la fila. Sustituye a la detección automática
  // que hacía la extensión de Chrome al abrir un episodio (no disponible en
  // una PWA normal).
  async function registrarAnime(enlace) {
    const p = parsearEnlaceAnime(enlace);
    if (!p) throw new Error("ENLACE_ANIME_INVALIDO");
    const { slug, url, episodeUrl } = p;

    // ¿Ya está registrada? Se compara por enlace (también si el guardado es de un episodio) y por slug.
    const existentes = await obtenerListaCompleta();
    const canon = (x) => String(x || "").replace(/\/+$/, "");
    const existente = existentes.find((a) => a.url && (canon(a.url) === canon(url) || (slug && slugDeUrl(a.url) === slug)));
    if (existente) {
      // Con un enlace de episodio se aprovecha para dejarla "viendo" y guardar ese último capítulo.
      if (!episodeUrl) throw new Error("YA_EXISTE");
      await marcarViendo(existente, episodeUrl);
      return { title: existente.title, url: existente.url, vinculada: true };
    }

    // Si ya dijiste antes que esta temporada es una serie que tienes registrada, se actualiza sin preguntar.
    await getSheetName();
    const vinculo = slug ? leerVinculos()[claveVinculo(slug)] : null;
    if (vinculo) {
      const anime = filaExistente(existentes, vinculo.url, vinculo.title);
      if (anime) {
        await marcarViendo(anime, ultimoParaSerie(anime, episodeUrl, url));
        return { title: anime.title, vinculada: true };
      }
      const vinculos = leerVinculos();
      delete vinculos[claveVinculo(slug)]; // la fila ya no existe
      guardarVinculos(vinculos);
    }

    let html;
    try {
      const r = await fetch(`${WORKER_URL}/leer?url=${encodeURIComponent(url)}`);
      // Este Worker siempre responde 200 y mete el status real de la
      // página de origen en X-Proxy-Upstream-Status (para poder leer el
      // cuerpo del error en vez de que fetch() lo trate como fallo).
      const upstream = Number(r.headers.get("X-Proxy-Upstream-Status") || 0);
      if (!r.ok || (upstream && upstream >= 400)) throw new Error();
      html = await r.text();
    } catch (e) { throw new Error("NO_SE_PUDO_LEER_LA_PAGINA"); }

    const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const titulo = m ? m[1].trim() : "";
    if (!titulo) throw new Error("SIN_TITULO");
    const cover = extraerPortadaDesdeHtml(html);
    const nuevaFila = { title: titulo, url, cover: cover || "", episodeUrl };

    // ¿Parece otra temporada/parte de una serie ya registrada? -> se pregunta (las más recientes primero)
    const candidatos = [];
    for (let k = existentes.length - 1; k >= 0; k--) {
      const a = existentes[k];
      if (sonSeriesRelacionadas({ title: titulo, slug }, { title: a.title, url: a.url })) {
        candidatos.push({ row: a.row, title: a.title, url: a.url, cover: a.cover });
      }
    }
    if (candidatos.length) return { pregunta: { nuevaFila, slug, candidatos: candidatos.slice(0, 4) } };

    return await escribirAnimeNuevo(nuevaFila);
  }

  function guardarPortadasActivado() {
    try { return localStorage.getItem("guardarPortadas") !== "false"; } catch (e) { return true; }
  }

  async function precachearImagen(url) {
    if (!url || !guardarPortadasActivado()) return;
    try {
      const cache = await caches.open(COVER_CACHE);
      if (await cache.match(url)) return;
      const r = await fetch(url, { mode: "no-cors", credentials: "omit" });
      if (r && (r.ok || r.type === "opaque")) await cache.put(url, r.clone());
    } catch(e) {}
  }

  function extraerPortadaDesdeHtml(html) {
    const m = html.match(/cdn\.animeav1\.com\/covers\/\d+\.jpg/i);
    return m ? `https://${m[0]}` : null;
  }

  async function rellenarPortadas() {
    if (await esListaLocal()) return rellenarPortadasLocal();
    const sheetName = await getSheetName();
    const filas = await getFilasDaK(sheetName);
    const requests=[]; let encontradas=0, sinImagen=0;
    for(let i=0;i<filas.length;i++) {
      const v=filas[i].values||[]; const url=v[0]?.hyperlink; const ya= (v[6]?.formattedValue||"").trim()!=="";
      if(!url||ya) continue;
      try { const r=await fetch(url); const html=await r.text(); const img=extraerPortadaDesdeHtml(html); if(!img){sinImagen++;continue;}
        requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:9,endColumnIndex:10},rows:[{values:[{userEnteredValue:{formulaValue:`=IMAGE("${img}",1)`}}]}],fields:"userEnteredValue"}}); encontradas++; precachearImagen(img);
      } catch(e){sinImagen++;}
    }
    if(requests.length) await sheetsFetch(":batchUpdate",{method:"POST",body:JSON.stringify({requests})});
    return {encontradas,sinImagen};
  }

  function normalizarTitulo(t){return (t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
  function slugify(t){return normalizarTitulo(t).replace(/\s+/g,"-");}
  async function buscarEnAnimeAV1(titulo){const slug=slugify(titulo);if(!slug)return null;const url=`https://animeav1.com/media/${slug}`;try{const r=await fetch(url);if(!r.ok)return null;const html=await r.text();const m=html.match(/<h1[^>]*>([^<]+)<\/h1>/i);const h=m?m[1].trim():"";return h&&normalizarTitulo(h)===normalizarTitulo(titulo)?{url,html}:null;}catch(e){return null;}}
  function extraerPortadaAnimeFlv(html){const a=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);if(a)return a[1];const b=html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);return b?b[1]:null;}
  async function migrarAnimeFlv(){
    if (await esListaLocal()) return migrarAnimeFlvLocal();
    const sheetName=await getSheetName(); const filas=await getFilasDaK(sheetName); const requests=[]; let migradas=0,portadasFlv=0,sinCambios=0;
    for(let i=0;i<filas.length;i++){const v=filas[i].values||[];const enlace=v[0]?.hyperlink||"";if(!enlace.includes("animeflv"))continue;const titulo=v[0]?.formattedValue||"";const ya=(v[6]?.formattedValue||"").trim()!=="";const encontrado=await buscarEnAnimeAV1(titulo);
      if(encontrado){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:3,endColumnIndex:4},rows:[{values:[{userEnteredValue:{stringValue:titulo},textFormatRuns:[{startIndex:0,format:{link:{uri:encontrado.url}}}]}]}],fields:"userEnteredValue,textFormatRuns"}});migradas++;if(!ya){const img=extraerPortadaDesdeHtml(encontrado.html);if(img){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:9,endColumnIndex:10},rows:[{values:[{userEnteredValue:{formulaValue:`=IMAGE("${img}",1)`}}]}],fields:"userEnteredValue"}});precachearImagen(img);}}}
      else if(!ya){try{const r=await fetch(enlace);const html=await r.text();const img=extraerPortadaAnimeFlv(html);if(img){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:9,endColumnIndex:10},rows:[{values:[{userEnteredValue:{formulaValue:`=IMAGE("${img}",1)`}}]}],fields:"userEnteredValue"}});precachearImagen(img);portadasFlv++;}else sinCambios++;}catch(e){sinCambios++;}}
      else sinCambios++;
    }
    if(requests.length)await sheetsFetch(":batchUpdate",{method:"POST",body:JSON.stringify({requests})});return{migradas,portadasFlv,sinCambios};
  }

  async function handle(msg){
    switch(msg.type){
      case "GET_CONFIG": { // se añade el id de la lista activa: el catálogo de géneros es propio de cada lista
        obtenerListasParaUI(); // garantiza que una instalación antigua ya tiene su lista (y su id)
        const config = JSON.parse(localStorage.getItem("config")||"null");
        return {ok:true,config:config?{...config,listaId:idListaActiva()}:null};
      }
      case "LOGIN": {
        // Si ya hay un intento en marcha (renovación con el primer toque), se espera a él.
        if (tokenEnCurso) { try { await tokenEnCurso; return {ok:true}; } catch (e) {} }
        await ensureToken(true);
        return {ok:true};
      }
      case "CAMBIAR_CUENTA": return {ok:true,...await cambiarCuenta()};
      case "GET_CLIENT_ID": return {ok:true,clientId:obtenerClientId()};
      case "SAVE_CONFIG": return {ok:true,...await guardarConfig(msg.url,msg.clientId)};
      case "GET_LISTAS": return {ok:true,listas:obtenerListasParaUI()};
      case "ADD_LISTA": return {ok:true,...await agregarListaGuardada(msg.name,msg.url)};
      case "ADD_LISTA_LOCAL": return {ok:true,...agregarListaLocal(msg.name,msg.series)};
      case "ADD_SERIE_LOCAL": return {ok:true,row:await agregarSerieLocal(msg.serie)};
      case "DELETE_SERIE_LOCAL": await eliminarSerieLocal(msg.row); return {ok:true};
      case "ADD_SERIE_COMPLETA": return {ok:true,row:await conLista(msg.listaId,()=>agregarSerieCompleta(msg.serie))};
      case "DELETE_SERIE": await eliminarSerie(msg.row,msg.title); return {ok:true};
      case "EXPORT_LISTA_LOCAL": return {ok:true,datos:exportarListaLocal(msg.id)};
      case "DELETE_LISTA": return {ok:true,...await eliminarListaGuardada(msg.id)};
      case "SWITCH_LISTA": return {ok:true,...await cambiarListaActiva(msg.id)};
      case "GET_ANIME_LIST": return {ok:true,lista:await obtenerListaCompleta()};
      case "UPDATE_ANIME": await actualizarCampo(msg.row,msg.campo,msg.valor); return {ok:true};
      case "UPDATE_GENRES_BULK": await actualizarGenerosLote(msg.cambios); return {ok:true};
      case "UPDATE_TITLE_URL": await actualizarTituloUrl(msg.row,msg.title,msg.url); return {ok:true};
      case "FILL_COVERS": return {ok:true,...await rellenarPortadas()};
      case "MIGRATE_ANIMEFLV": return {ok:true,...await migrarAnimeFlv()};
      case "GET_CAPITULOS": return {ok:true,max:await capituloMaximo(msg.slug)};
      case "REGISTER_ANIME": return {ok:true,...await registrarAnime(msg.url)};
      case "RESOLVER_SECUELA": return {ok:true,...await resolverSecuela(msg)};
      default: throw new Error("MENSAJE_DESCONOCIDO");
    }
  }
  window.enviarMensajePWA = async msg => { try{return await handle(msg);}catch(e){return {ok:false,error:String(e?.message||e).replace(/^Error:\s*/,"")};} };
})();
