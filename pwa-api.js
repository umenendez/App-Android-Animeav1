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
  let gridFilas = null; // filas de la pestaña (para saber si hay que ampliarla al añadir series)
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
    try { const t = JSON.parse(localStorage.getItem("config") || "null")?.tipo; if ((t === "local" || t === "nube") && !activaVinculada()) return; } catch (e) {} // lista local o de la nube: sin Google Sheets (salvo que esté vinculada a una hoja)
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
    if ((config?.tipo === "local" || config?.tipo === "nube") && config.listaId) {
      // Lista local: sin hoja. spreadsheetId/gid reciben valores propios para que las claves que
      // dependen de ellos (vínculos de temporadas) sigan siendo únicas.
      listaLocalId = config.listaId; spreadsheetId = `${config.tipo}:${config.listaId}`; gidConfig = 0; gid = 0;
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
    gid = hoja.sheetId; gridFilas = hoja.gridProperties?.rowCount ?? null; cachedSheetName = hoja.title;
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

  function renombrarLista(id, nombre) {
    const name = String(nombre ?? "").trim().slice(0, 60);
    if (!name) throw new Error("FALTA_NOMBRE");
    const listas = obtenerListasArr();
    const l = listas.find((x) => x.id === id);
    if (!l) throw new Error("LISTA_NO_ENCONTRADA");
    l.name = name;
    if (l.tipo === "local" || l.tipo === "nube") l.titulo = name;
    guardarListasArr(listas);
    if (l.tipo === "nube" && l.rol === "propietario") nubeFetch(`/api/listas/${encodeURIComponent(id)}`, { method: "PATCH", body: { nombre: name } }).catch(() => {});
    if (idListaActiva() === id && (l.tipo === "local" || l.tipo === "nube")) {
      try { const c = JSON.parse(localStorage.getItem("config") || "null"); if (c) localStorage.setItem("config", JSON.stringify({ ...c, titulo: name })); } catch (e) {}
    }
  }

  async function eliminarListaGuardada(id) {
    const listas = obtenerListasArr();
    const restantes = listas.filter((l) => l.id !== id);
    if (restantes.length === listas.length) throw new Error("LISTA_NO_ENCONTRADA");
    const quitada = listas.find((l) => l.id === id);
    if (quitada?.vinculo) { // la otra lista del vínculo queda suelta
      const par = restantes.find((l) => l.id === quitada.vinculo.con);
      if (par) delete par.vinculo;
      try { localStorage.removeItem(claveBaseVinculo(id, quitada.vinculo.con)); localStorage.removeItem(claveBaseVinculo(quitada.vinculo.con, id)); } catch (e) {}
    }
    guardarListasArr(restantes);
    if (quitada?.tipo === "local" || quitada?.tipo === "nube") { try { localStorage.removeItem(claveDatosLocal(id)); } catch (e) {} }
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
    if (l.tipo === "local" || l.tipo === "nube") return { tipo: l.tipo, listaId: l.id, url: l.url, titulo: l.titulo, hoja: "" };
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
    const data = await sheetsFetch(`?ranges=${encodeURIComponent(rango(sheetName, "D:K"))}&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)`);
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

  async function obtenerListaCompleta(opciones = {}) {
    estadoNube = null;
    if (await esListaLocal()) {
      if (!opciones.sinSync && listaNube(listaLocalId)) { // se sincroniza en segundo plano; la lista no espera
        lanzarSyncAlAbrir(listaLocalId);
        estadoNube = { id: listaLocalId, ok: true, pendiente: true };
      }
      return leerDatosLocal().items;
    }
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
  // Sin gancho de la nube: lo usa la propia sincronización (y el alta de listas) para guardar tal cual
  function guardarDatosCrudo(d, id = listaLocalId) { localStorage.setItem(claveDatosLocal(id), JSON.stringify(d)); }
  function guardarDatosLocal(d, id = listaLocalId) {
    const nube = listaNube(id);
    if (!nube) { guardarDatosCrudo(d, id); return; }
    if (nube.rol === "lectura") throw new Error("SOLO_LECTURA");
    registrarCambiosNube(d);
    guardarDatosCrudo(d, id);
    programarEnvioNube(id);
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
    const lista = obtenerListasArr().find((l) => l.id === id && (l.tipo === "local" || l.tipo === "nube"));
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

  // --- Progreso de «Migrar enlaces»: el popup escucha este evento y lo muestra bajo el botón ---
  function avisarProgreso(texto) { try { window.dispatchEvent(new CustomEvent("migrar-progreso", { detail: texto })); } catch (e) {} }
  const esPortadaFlv = (c) => /(^|\/\/|\.)animeflv\.net\//i.test(String(c || ""));
  const esFichaAV1 = (u) => /^https:\/\/animeav1\.com\/media\//i.test(String(u || ""));
  // Serie ya enlazada a AnimeAV1 pero con la portada de AnimeFLV: se saca la portada de su ficha
  async function portadaDesdeFichaAV1(url) {
    try { return extraerPortadaDesdeHtml(await leerPaginaWorker(url)); } catch (e) { return null; }
  }

  async function migrarAnimeFlvLocal() {
    const cambios = []; let migradas = 0, portadasFlv = 0, sinCambios = 0, portadasAV1 = 0; const fallos = []; let refrescadas = 0;
    const pendientes = leerDatosLocal().items.filter((it) => it.url.includes("animeflv") || (esPortadaFlv(it.cover) && esFichaAV1(it.url)));
    let hechas = 0;
    for (const it of pendientes) {
      hechas++; avisarProgreso(`Migrando ${hechas}/${pendientes.length}: ${it.title}`);
      if (!it.url.includes("animeflv")) {
        const img = await portadaDesdeFichaAV1(it.url);
        if (img) { cambios.push({ row: it.row, cover: img }); precachearImagen(img); refrescadas++; } else sinCambios++;
        continue;
      }
      const encontrado = await buscarEnAnimeAV1(it.title,it.url,fallos);
      if (encontrado) {
        const c = { row: it.row, url: encontrado.url };
        { const img = extraerPortadaDesdeHtml(encontrado.html); if (img) { c.cover = img; precachearImagen(img); portadasAV1++; } }
        cambios.push(c); migradas++;
      } else if (!it.cover) {
        try {
          const img = extraerPortadaAnimeFlv(await leerPaginaWorker(it.url));
          if (img) { cambios.push({ row: it.row, cover: img }); precachearImagen(img); portadasFlv++; } else sinCambios++;
        } catch (e) { sinCambios++; }
      } else sinCambios++;
    }
    if (cambios.length) {
      avisarProgreso("Guardando cambios…");
      const d = leerDatosLocal();
      for (const c of cambios) { const it = d.items.find((i) => i.row === c.row); if (!it) continue; if (c.url) it.url = c.url; if (c.cover) it.cover = c.cover; }
      guardarDatosLocal(d);
    }
    if (fallos.length) console.log("[AnimeAV1 Tracker] Sin equivalente en AnimeAV1:", fallos);
    return { migradas, portadasFlv, sinCambios, portadasAV1, refrescadas, total: pendientes.length, fallos: fallos.slice(0, 8) };
  }

  // Mayor número de capítulo que aparece en la ficha de la serie (enlaces .../media/<slug>/<n>) y si la serie está en
  // emisión o terminada. null = no se pudo saber (sin conexión, o la ficha no lista capítulos): el popup actúa como si existiera.
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

  async function infoCapitulos(slug) {
    if (!/^[a-z0-9-]+$/i.test(slug || "")) return null;
    try {
      const r = await fetch(`${WORKER_URL}/leer?url=${encodeURIComponent("https://animeav1.com/media/" + slug)}`);
      const upstream = Number(r.headers.get("X-Proxy-Upstream-Status") || 0);
      if (!r.ok || (upstream && upstream >= 400)) return null;
      const html = await r.text();
      let max = 0;
      for (const m of html.matchAll(new RegExp(`/media/${slug}/(\\d+)(?!\\d)`, "gi"))) max = Math.max(max, parseInt(m[1], 10));
      return { max: max > 0 ? max : null, emision: estadoEmisionDeHtml(html) };
    } catch (e) { return null; }
  }
  async function capituloMaximo(slug) { return (await infoCapitulos(slug))?.max ?? null; }

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
  // --- Otras páginas fuente (BETA) --------------------------------------------------------
  // Las recetas se crean en la extensión y se pegan aquí (IMPORTAR_FUENTES). La PWA no puede abrir las webs ni
  // ejecutar su JavaScript: lee el HTML de la página a través del Worker y aplica los selectores de la receta.
  function leerFuentes() { try { const f = JSON.parse(localStorage.getItem("fuentes") || "[]"); return Array.isArray(f) ? f : []; } catch (e) { return []; } }
  function guardarFuentes(f) { try { localStorage.setItem("fuentes", JSON.stringify(f)); } catch (e) {} }
  function fuenteDeUrl(u) { return leerFuentes().find((f) => f.activa !== false && String(u || "").startsWith(f.origen + "/")) || null; }
  function importarFuentes(texto) {
    let d;
    try { d = JSON.parse(String(texto || "").trim()); } catch (e) { throw new Error("FUENTES_INVALIDAS"); }
    if (!d || d.tipo !== "fuentes" || !Array.isArray(d.fuentes)) throw new Error("FUENTES_INVALIDAS");
    const listas = obtenerListasArr();
    const actuales = leerFuentes();
    let n = 0;
    for (const r of d.fuentes) {
      let origen;
      try { const u = new URL(r.origen); if (!/^https?:$/.test(u.protocol) || /(^|\.)animeav1\.com$/i.test(u.hostname)) continue; origen = u.origin; } catch (e) { continue; }
      if (!r.selectores || typeof r.selectores.titulo !== "string" || !r.selectores.titulo) continue;
      try { new RegExp(r.patron); } catch (e) { continue; }
      const previa = actuales.find((f) => f.origen === origen);
      const porNombre = r.listaNombre ? listas.find((l) => l.name === r.listaNombre) : null;
      const s = r.selectores;
      const receta = {
        id: "fuente-" + origen.replace(/[^a-z0-9]/gi, "_"), nombre: String(r.nombre || origen).slice(0, 60), origen, activa: previa ? previa.activa !== false : true,
        patron: String(r.patron), capitulo: r.capitulo || null, listaId: previa?.listaId || porNombre?.id || "",
        selectores: { titulo: s.titulo, portada: String(s.portada || ""), portadaSerie: String(s.portadaSerie || ""), serie: String(s.serie || "") },
      };
      const i = actuales.findIndex((f) => f.origen === origen);
      if (i >= 0) actuales[i] = receta; else actuales.push(receta);
      n++;
    }
    if (!n) throw new Error("FUENTES_INVALIDAS");
    guardarFuentes(actuales);
    return n;
  }
  function actualizarFuente(id, cambios) {
    const fs = leerFuentes(), f = fs.find((x) => x.id === id);
    if (!f) throw new Error("FUENTE_NO_ENCONTRADA");
    if (cambios.activa !== undefined) f.activa = !!cambios.activa;
    if (cambios.lista !== undefined) f.listaId = String(cambios.lista || "");
    guardarFuentes(fs);
  }
  function borrarFuente(id) { guardarFuentes(leerFuentes().filter((x) => x.id !== id)); }

  async function leerPaginaWorker(url) {
    const r = await fetch(`${WORKER_URL}/leer?url=${encodeURIComponent(url)}`);
    const upstream = Number(r.headers.get("X-Proxy-Upstream-Status") || 0);
    if (!r.ok || (upstream && upstream >= 400)) throw new Error("NO_SE_PUDO_LEER_LA_PAGINA");
    return r.text();
  }
  function datosDePagina(f, url, html, selPortada) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sel = f.selectores || {};
    const q = (s) => { try { return s ? doc.querySelector(s) : null; } catch (e) { return null; } };
    const abs = (u) => { try { return new URL(u, url).href; } catch (e) { return ""; } };
    const https = (u) => (u && /^http:\/\//i.test(u) ? "https://" + u.slice(7) : u); // una PWA https bloquea imágenes http
    const imagen = (el) => {
      if (!el) return "";
      const im = el.tagName === "IMG" ? el : (el.querySelector && el.querySelector("img"));
      if (!im) return "";
      let s = im.getAttribute("src") || im.getAttribute("data-src") || im.getAttribute("data-lazy-src") || "";
      if (!s || s.startsWith("data:")) s = (im.getAttribute("srcset") || "").split(",")[0].trim().split(" ")[0];
      return s ? https(abs(s)) : "";
    };
    const titulo = (q(sel.titulo)?.textContent || "").replace(/\s+/g, " ").trim();
    const a = q(sel.serie)?.closest?.("a");
    let serieUrl = a && a.getAttribute("href") ? abs(a.getAttribute("href")) : "";
    if (!serieUrl) {
      const u = new URL(url), segs = u.pathname.split("/").filter(Boolean);
      serieUrl = segs.length >= 2 && /^\d+$/.test(segs[segs.length - 1]) ? `${u.origin}/${segs.slice(0, -1).join("/")}/` : url;
    }
    const og = doc.querySelector('meta[property="og:image"]')?.content || "";
    return { titulo, serieUrl: serieUrl.split("#")[0], cover: imagen(q(selPortada ?? sel.portada)), og: og ? https(abs(og)) : "" };
  }
  const slugTitulo = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // Registra una serie desde un enlace de una web fuente (en la lista asignada a esa web). Devuelve lo mismo que registrarAnime.
  // ¿Existe ya el capítulo siguiente? true / false / null (no se sabe). Mismo criterio que la extensión: 1) la página de la
  // serie lo enlaza -> existe; 2) el servidor de esa web responde 404/410 -> no existe; 3) la página de la serie lista
  // capítulos y no incluye ese -> no existe. Sin poder confirmarlo (web dibujada con JavaScript) -> null y no se muestra ⏭.
  async function capituloSiguienteExiste({ url, serie, patron }) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const f = leerFuentes().find((x) => x.origen === u.origin && x.activa !== false);
    if (!f) return null;
    let re = null;
    try { re = new RegExp(patron || f.patron); } catch (e) {}
    const norm = (p) => { try { p = decodeURIComponent(p); } catch (e) {} return p.replace(/\/+$/, "") || "/"; };
    const objetivo = norm(u.pathname);
    let hayLista = false;
    try {
      const s = new URL(serie);
      if (s.origin === u.origin) {
        const html = await leerPaginaWorker(s.href);
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)/gi)) {
          let h;
          try { h = new URL(m[1].replace(/&amp;/g, "&"), s.href); } catch (e) { continue; }
          if (h.origin !== u.origin) continue;
          if (norm(h.pathname) === objetivo) return true;
          if (re && re.test(h.pathname)) hayLista = true;
        }
      }
    } catch (e) {}
    try {
      const r = await fetch(`${WORKER_URL}/leer?url=${encodeURIComponent(u.href)}`);
      const up = Number(r.headers.get("X-Proxy-Upstream-Status") || 0);
      if (up === 404 || up === 410) return false;
      if (!r.ok || up >= 400) return null;
      return hayLista ? false : null;
    } catch (e) { return null; }
  }

  async function registrarDesdeFuente(url, f) {
    const u = new URL(url);
    let esCap = false;
    try { esCap = new RegExp(f.patron).test(u.pathname); } catch (e) {}
    let datos;
    try { datos = datosDePagina(f, url, await leerPaginaWorker(url)); } catch (e) { throw new Error("NO_SE_PUDO_LEER_LA_PAGINA"); }
    if (!datos.titulo) throw new Error("SIN_TITULO_FUENTE");
    let cover = datos.cover;
    if (!cover && datos.serieUrl && datos.serieUrl !== url) {
      try { const d2 = datosDePagina(f, datos.serieUrl, await leerPaginaWorker(datos.serieUrl), f.selectores?.portadaSerie || ""); cover = d2.cover || d2.og; } catch (e) {}
    }
    if (!cover) cover = datos.og;
    const episodeUrl = esCap ? url.split("#")[0] : "";
    const slug = slugTitulo(datos.titulo);
    const nuevaFila = { title: datos.titulo, url: datos.serieUrl, cover: cover || "", episodeUrl };
    const listaNombre = f.listaId ? (obtenerListasArr().find((l) => l.id === f.listaId)?.name || "") : "";
    return conLista(f.listaId, async () => {
      await getSheetName();
      const existentes = await obtenerListaCompleta();
      const canon = (x) => String(x || "").replace(/\/+$/, "");
      const tit = datos.titulo.trim().toLowerCase();
      const existente = existentes.find((x) => (x.url && canon(x.url) === canon(datos.serieUrl)) || (x.title || "").trim().toLowerCase() === tit);
      if (existente) {
        if (!episodeUrl) throw new Error("YA_EXISTE");
        await marcarViendo(existente, episodeUrl);
        return { title: existente.title, url: existente.url, vinculada: true, listaNombre };
      }
      const vinculo = leerVinculos()[claveVinculo(slug)];
      if (vinculo) {
        const anime = filaExistente(existentes, vinculo.url, vinculo.title);
        if (anime) { await marcarViendo(anime, ultimoParaSerie(anime, episodeUrl, datos.serieUrl)); return { title: anime.title, vinculada: true, listaNombre }; }
      }
      const candidatos = [];
      for (let k = existentes.length - 1; k >= 0; k--) {
        const x = existentes[k];
        if (sonSeriesRelacionadas({ title: datos.titulo, slug }, { title: x.title, url: x.url })) candidatos.push({ row: x.row, title: x.title, url: x.url, cover: x.cover });
      }
      if (candidatos.length) return { pregunta: { nuevaFila, slug, candidatos: candidatos.slice(0, 4), listaId: f.listaId || "" }, listaNombre };
      return { ...(await escribirAnimeNuevo(nuevaFila)), listaNombre };
    });
  }

  async function registrarAnime(enlace) {
    const fuente = fuenteDeUrl(enlace);
    if (fuente) return registrarDesdeFuente(String(enlace).trim(), fuente);
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
    html = String(html || "");
    // La ficha también lista series relacionadas (/covers/<otro id>.jpg): se prefiere la portada cuyo id coincide
    // con el del fondo (/backdrops/<id>.jpg) o el de las capturas (/screenshots/<id>/…) de la propia serie.
    const id = (html.match(/cdn\.animeav1\.com\/backdrops\/(\d+)\./i) || html.match(/cdn\.animeav1\.com\/screenshots\/(\d+)\//i) || [])[1];
    if (id && new RegExp(`cdn\\.animeav1\\.com/covers/${id}\\.(?:jpg|jpeg|png|webp)`, "i").test(html)) return `https://cdn.animeav1.com/covers/${id}.jpg`;
    const m = html.match(/cdn\.animeav1\.com\/covers\/\d+\.(?:jpg|jpeg|png|webp)/i);
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
  // Slug de una ficha de AnimeFLV (cualquier subdominio: www.animeflv.net, www3., www4., …): /anime/<slug>
  function slugDeAnimeFlv(enlace){try{const u=new URL(enlace);if(!/(^|\.)animeflv\.net$/i.test(u.hostname))return "";const m=u.pathname.match(/\/anime\/([^/]+)/i);return m?m[1].toLowerCase():"";}catch(e){return "";}}
  const compactoTitulo=(t)=>normalizarTitulo(t).replace(/ /g,"");
  // --- Búsqueda en el catálogo de AnimeAV1 (cuando el slug del enlace/título no existe) --------------------------
  // AnimeAV1 nombra las series en romaji (p. ej. «Neon Genesis Evangelion» es /media/shinseiki-evangelion), así que
  // el slug adivinado falla con muchas. Se buscan en su catálogo el título, el título sin subtítulo y los títulos
  // alternativos de la ficha de AnimeFLV, y se elige el resultado que contiene todas las palabras con menos añadidos.
  const PALABRAS_EXTRA_AV1 = /\b(movie|pelicula|ova|ovas|ona|special|specials|especial|recap|pv|cm)\b/;

  function nombresParaBuscar(titulo, htmlFlv) {
    const nombres = [titulo, String(titulo || "").split(/[:：]/)[0]];
    if (htmlFlv) {
      for (const m of String(htmlFlv).matchAll(/class=["'][^"']*TxtAlt[^"']*["'][^>]*>([^<]{2,120})</gi)) nombres.push(m[1]);
      const og = String(htmlFlv).match(/<h1[^>]*>([^<]{2,120})<\/h1>/i);
      if (og) nombres.push(og[1]);
    }
    const vistos = new Set();
    return nombres.map((n) => String(n || "").trim()).filter((n) => {
      const k = normalizarTitulo(n);
      if (!k || k.length < 3 || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    }).slice(0, 4);
  }

  function elegirResultadoAV1(nombre, slugs) {
    const q = new Set(normalizarTitulo(nombre).split(" ").filter(Boolean));
    if (!q.size) return null;
    const quiereExtra = PALABRAS_EXTRA_AV1.test(normalizarTitulo(nombre));
    let mejor = null;
    for (const slug of slugs) {
      const palabras = slug.replace(/-/g, " ").split(" ").filter(Boolean);
      if (!quiereExtra && PALABRAS_EXTRA_AV1.test(palabras.join(" "))) continue;
      const c = new Set(palabras);
      let comunes = 0;
      for (const w of q) if (c.has(w)) comunes++;
      if (comunes / q.size < 1) continue; // deben estar todas las palabras buscadas
      const extra = c.size - q.size;
      if (!mejor || extra < mejor.extra) mejor = { slug, extra };
    }
    return mejor ? mejor.slug : null;
  }

  // leerHtml(url) -> texto HTML (lanza si no se puede leer)
  async function buscarPorCatalogoAV1(titulo, enlaceFlv, leerHtml, notas) {
    let htmlFlv = "";
    if (enlaceFlv) { try { htmlFlv = await leerHtml(enlaceFlv); } catch (e) { notas.push("no se pudo leer la ficha de AnimeFLV"); } }
    for (const nombre of nombresParaBuscar(titulo, htmlFlv)) {
      for (const param of ["search", "q"]) {
        let html;
        try { html = await leerHtml(`https://animeav1.com/catalogo?${param}=${encodeURIComponent(nombre)}`); }
        catch (e) { notas.push(`catálogo (${param}=${nombre}): ${e && e.message || "error"}`); continue; }
        const slugs = [...new Set([...html.matchAll(/href=["']\/media\/([a-z0-9-]+)["']/gi)].map((m) => m[1].toLowerCase()))];
        const slug = elegirResultadoAV1(nombre, slugs);
        if (!slug) { notas.push(`catálogo (${param}=${nombre}): ${slugs.length} resultado(s), ninguno encaja`); continue; }
        try {
          const ficha = await leerHtml(`https://animeav1.com/media/${slug}`);
          return { url: `https://animeav1.com/media/${slug}`, html: ficha };
        } catch (e) { notas.push(`${slug}: no se pudo abrir`); }
      }
    }
    return null;
  }

  function parecidoTitulos(a,b){const A=new Set(normalizarTitulo(a).split(" ").filter(Boolean)),B=new Set(normalizarTitulo(b).split(" ").filter(Boolean));if(!A.size||!B.size)return 0;let c=0;for(const w of A)if(B.has(w))c++;return c/Math.max(A.size,B.size);}
  // `motivos` (opcional): array donde se anota por qué no se encontró cada candidato (diagnóstico)
  async function buscarEnAnimeAV1(titulo,enlaceFlv,motivos){
    const slugFlv=slugDeAnimeFlv(enlaceFlv);
    const candidatos=[...new Set([slugify(titulo),slugFlv,slugFlv.replace(/-?(tv|season-?\d+)$/,"")].filter(Boolean))];
    const notas=[];
    for(const slug of candidatos){
      const url=`https://animeav1.com/media/${slug}`;
      try{
        const r=await fetch(`${WORKER_URL}/leer?url=${encodeURIComponent(url)}`);
        const up=Number(r.headers.get("X-Proxy-Upstream-Status")||0);
        if(!r.ok||(up&&up>=400)){notas.push(`${slug}: HTTP ${up||r.status}`);continue;}
        const html=await r.text();
        const m=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);const h=m?m[1].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim():"";
        if(!h){notas.push(`${slug}: sin título en la ficha`);continue;}
        const ch=compactoTitulo(h);
        const igual=ch===compactoTitulo(titulo)||(slugFlv&&ch===slugFlv.replace(/-/g,""));
        const parecido=slug===slugFlv&&Math.max(parecidoTitulos(h,titulo),parecidoTitulos(h,slugFlv.replace(/-/g," ")))>=0.5;
        if(igual||parecido)return {url,html};
        notas.push(`${slug}: la ficha se llama «${h}»`);
      }catch(e){notas.push(`${slug}: ${e&&e.message||"error de red"}`);}
    }
    // Último recurso: buscar en el catálogo de AnimeAV1 (siempre por el Worker: la PWA no puede leer esas webs directamente)
    const porCatalogo=await buscarPorCatalogoAV1(titulo,enlaceFlv,leerPaginaWorker,notas);
    if(porCatalogo)return porCatalogo;
    if(Array.isArray(motivos))motivos.push({titulo,motivo:notas.join(" · ")||"sin candidatos"});
    return null;
  }
  function extraerPortadaAnimeFlv(html){const a=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);if(a)return a[1];const b=html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);return b?b[1]:null;}
  async function migrarAnimeFlv(){
    if (await esListaLocal()) return migrarAnimeFlvLocal();
    const sheetName=await getSheetName(); const filas=await getFilasDaK(sheetName); const requests=[]; let migradas=0,portadasFlv=0,sinCambios=0,portadasAV1=0;const fallos=[];let refrescadas=0;
    // Series con enlace de AnimeFLV, o ya enlazadas a AnimeAV1 pero con la portada de AnimeFLV (columna J)
    const portadaDe=(v)=>extraerUrlImagen(v[6])||(v[6]?.formattedValue||"");
    const esPendiente=(v)=>{const e=v[0]?.hyperlink||"";return e.includes("animeflv")||(esFichaAV1(e)&&esPortadaFlv(portadaDe(v)));};
    const total=filas.filter((f)=>esPendiente(f.values||[])).length;let hechas=0;
    for(let i=0;i<filas.length;i++){const v=filas[i].values||[];const enlace=v[0]?.hyperlink||"";if(!esPendiente(v))continue;hechas++;avisarProgreso(`Migrando ${hechas}/${total}: ${v[0]?.formattedValue||""}`);
      if(!enlace.includes("animeflv")){const img=await portadaDesdeFichaAV1(enlace);if(img){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:9,endColumnIndex:10},rows:[{values:[{userEnteredValue:{formulaValue:`=IMAGE("${img}",1)`}}]}],fields:"userEnteredValue"}});precachearImagen(img);refrescadas++;}else sinCambios++;continue;}
      const titulo=v[0]?.formattedValue||"";const ya=(v[6]?.formattedValue||"").trim()!=="";const encontrado=await buscarEnAnimeAV1(titulo,enlace,fallos);
      if(encontrado){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:3,endColumnIndex:4},rows:[{values:[{userEnteredValue:{stringValue:titulo},textFormatRuns:[{startIndex:0,format:{link:{uri:encontrado.url}}}]}]}],fields:"userEnteredValue,textFormatRuns"}});migradas++;{const img=extraerPortadaDesdeHtml(encontrado.html);if(img){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:9,endColumnIndex:10},rows:[{values:[{userEnteredValue:{formulaValue:`=IMAGE("${img}",1)`}}]}],fields:"userEnteredValue"}});precachearImagen(img);portadasAV1++;}}}
      else if(!ya){try{const html=await leerPaginaWorker(enlace);const img=extraerPortadaAnimeFlv(html);if(img){requests.push({updateCells:{range:{sheetId:gid,startRowIndex:i,endRowIndex:i+1,startColumnIndex:9,endColumnIndex:10},rows:[{values:[{userEnteredValue:{formulaValue:`=IMAGE("${img}",1)`}}]}],fields:"userEnteredValue"}});precachearImagen(img);portadasFlv++;}else sinCambios++;}catch(e){sinCambios++;}}
      else sinCambios++;
    }
    if(requests.length){avisarProgreso("Guardando cambios en la hoja…");await sheetsFetch(":batchUpdate",{method:"POST",body:JSON.stringify({requests})});}if(fallos.length)console.log("[AnimeAV1 Tracker] Sin equivalente en AnimeAV1:",fallos);return{migradas,portadasFlv,sinCambios,portadasAV1,refrescadas,total,fallos:fallos.slice(0,8)};
  }

  // --- Listas en la nube (Cloudflare D1) ----------------------------------------------
  // Una lista "nube" es una lista local (mismos datos en localStorage, mismas funciones, funciona
  // sin conexión) con una capa de sincronización contra el Worker:
  //   · cada serie recibe un id estable (d.nube.ids: fila → id) y se recuerda qué versión se
  //     envió por última vez (d.nube.rec[id].h) frente a la actual (.l); si difieren, está pendiente;
  //   · tras cada cambio se envía lo pendiente (con un pequeño retraso) y al abrir la lista se
  //     descarga lo nuevo; si dos dispositivos tocan la misma serie gana el cambio más reciente;
  //   · los borrados se envían como "lápidas" para que lleguen a los demás dispositivos.
  // El login usa un id_token de Google que el Worker canjea por su propia sesión (dura meses).
  const NUBE_SESION = "nubeSesion";
  const NUBE_LOTE = 200;
  const NUBE_TIMEOUT_MS = 15000; // tiempo máximo de una petición al Worker

  function leerSesionNube() {
    try {
      const s = JSON.parse(localStorage.getItem(NUBE_SESION) || "null");
      if (s?.token && s.exp * 1000 > Date.now() + 60000) return s;
    } catch (e) {}
    return null;
  }
  function guardarSesionNube(s) {
    try { if (s) localStorage.setItem(NUBE_SESION, JSON.stringify(s)); else localStorage.removeItem(NUBE_SESION); } catch (e) {}
  }

  async function nubeFetch(ruta, { method = "GET", body, sinSesion = false } = {}) {
    const headers = {};
    if (!sinSesion) {
      const s = leerSesionNube();
      if (!s) throw new Error("NUBE_SESION_CADUCADA");
      headers.Authorization = "Bearer " + s.token;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    // Con tiempo máximo: una petición colgada (red mala) no debe bloquear para siempre la cola de sincronización
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NUBE_TIMEOUT_MS);
    try { res = await fetch(WORKER_URL + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal }); }
    catch (e) { throw new Error("NUBE_SIN_CONEXION"); }
    finally { clearTimeout(timer); }
    let json = null;
    try { json = await res.json(); } catch (e) {}
    if (res.status === 401 && !sinSesion) { guardarSesionNube(null); throw new Error("NUBE_SESION_CADUCADA"); }
    // La lista ya no existe en la nube (la borraron desde otro dispositivo, o dejó de estar compartida contigo)
    if (res.status === 404 && /^Lista no encontrada/i.test(String(json?.error || ""))) throw new Error("NUBE_LISTA_NO_EXISTE");
    if (!res.ok) throw new Error(json?.error || `Error de la nube (${res.status})`);
    return json;
  }

  async function nubeLoginConIdToken(idToken) {
    const r = await nubeFetch("/api/login", { method: "POST", body: { id_token: idToken }, sinSesion: true });
    guardarSesionNube({ token: r.token, exp: r.exp, email: r.usuario.email, name: r.usuario.name });
    return r.usuario;
  }

  // Botón de "Continuar con Google" con el estilo de la app. Debajo va un botón propio (solo
  // visual) y encima, casi transparente, el botón oficial de Google que recibe el clic: así el
  // login sigue siendo el de Google (id_token) pero se ve como el resto de la PWA.
  const LOGO_GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

  async function nubeRenderBoton(contenedor, alOk, alError) {
    const clientId = obtenerClientId();
    if (!clientId) return alError(new Error("CONFIGURA_CLIENT_ID_WEB"));
    try { await esperarGIS(); } catch (e) { return alError(e); }
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (r) => { try { alOk(await nubeLoginConIdToken(r.credential)); } catch (e) { alError(e); } },
    });
    contenedor.innerHTML = "";
    const caja = document.createElement("div");
    caja.className = "btn-google";
    const vista = document.createElement("div");
    vista.className = "btn-google-vista";
    vista.innerHTML = LOGO_GOOGLE + "<span>Continuar con Google</span>";
    const real = document.createElement("div");
    real.className = "btn-google-real";
    caja.append(vista, real);
    contenedor.append(caja);
    const ancho = Math.max(200, Math.min(400, Math.round(caja.clientWidth) || 300));
    google.accounts.id.renderButton(real, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: ancho, locale: "es" });
  }

  window.PWA_NUBE = {
    estado: () => { const s = leerSesionNube(); return s ? { email: s.email, name: s.name, exp: s.exp } : null; },
    renderBoton: nubeRenderBoton,
    loginConIdToken: nubeLoginConIdToken,
    cerrarSesion: () => guardarSesionNube(null),
  };

  function listaNube(id) { return obtenerListasArr().find((l) => l.id === id && l.tipo === "nube") || null; }
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

  async function _enviarNube(id) {
    const lista = listaNube(id);
    if (!lista || lista.rol === "lectura") return { enviados: 0 };
    let enviados = 0;
    for (;;) {
      const d = leerDatosLocal(id);
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
      if (!lote.length) break;
      await nubeFetch(`/api/listas/${id}/series`, { method: "POST", body: { cambios: lote.map((x) => x.cambio) } });
      // Se vuelve a leer: mientras se enviaba pudo haber cambios locales nuevos (esos siguen pendientes)
      const d2 = leerDatosLocal(id);
      const n2 = metaNube(d2);
      for (const x of lote) {
        if (x.hash === null) { if (n2.borradas[x.sid] === x.cambio.actualizado) delete n2.borradas[x.sid]; }
        else if (n2.rec[x.sid]) n2.rec[x.sid].h = x.hash;
      }
      guardarDatosCrudo(d2, id);
      enviados += lote.length;
    }
    return { enviados };
  }

  async function _traerNube(id) {
    // Se pide con 2 s de margen: aplicar dos veces el mismo cambio es inofensivo, perderlo no
    const desde = Math.max(0, (metaNube(leerDatosLocal(id)).desde || 0) - 2000);
    const r = await nubeFetch(`/api/listas/${id}/series?since=${desde}`);
    const d = leerDatosLocal(id);
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
      const h = hashItem(it);
      n.rec[s.id] = { h, l: h, loc: s.actualizado };
      delete n.borradas[s.id];
    }
    n.desde = Math.max(n.desde || 0, r.hasta || 0);
    guardarDatosCrudo(d, id);
    // Si el propietario cambió tus permisos (lectura ↔ edición), se refleja aquí
    if (r.rol) {
      const listas = obtenerListasArr();
      const l = listas.find((x) => x.id === id);
      if (l && l.rol !== r.rol) { l.rol = r.rol; guardarListasArr(listas); }
    }
    return { recibidas: r.series.length, cambios };
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
    temporizadoresNube[id] = setTimeout(() => { enviarCambiosNube(id).catch(() => {}); }, 500);
  }
  // Al salir de la app (o ocultarla) se envía ya lo pendiente: un temporizador no sobreviviría
  const enviarPendientesYa = () => {
    for (const l of obtenerListasArr()) {
      if (l.tipo !== "nube" || l.rol === "lectura") continue;
      clearTimeout(temporizadoresNube[l.id]);
      enviarCambiosNube(l.id).catch(() => {});
    }
  };
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") enviarPendientesYa(); });
    window.addEventListener("pagehide", enviarPendientesYa);
  } catch (e) {}
  try {
    window.addEventListener("online", () => {
      const id = idListaActiva();
      if (id && listaNube(id)) enviarCambiosNube(id).catch(() => {});
    });
  } catch (e) {}

  // --- Sincronizar al abrir una lista de la nube ------------------------------------------------
  // La lista se enseña AL INSTANTE con lo guardado en el dispositivo; la sincronización con la nube corre en segundo
  // plano y la interfaz se entera después (NUBE_ESPERAR_SYNC): solo repinta si llegó algo nuevo. Sin conexión, la lista
  // no espera nada.
  let estadoNube = null;
  const syncAlAbrir = {};      // id → promesa mientras dura la sincronización
  const resultadoAlAbrir = {}; // id → resultado de la última, hasta que la interfaz lo recoge
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
        return { id, ok: false, error: String(e?.message || e).replace(/^Error:\s*/, "") };
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

  function anadirEntradaNube(id, nombre, rol) {
    obtenerListasParaUI(); // asegura la migración de "Mi lista" si hacía falta
    const listas = obtenerListasArr();
    if (listas.some((l) => l.id === id)) throw new Error("LISTA_YA_EN_DISPOSITIVO");
    listas.push({ id, name: nombre, tipo: "nube", url: `nube:${id}`, spreadsheetId: "", gid: null, titulo: nombre, hoja: "", rol });
    guardarListasArr(listas);
  }
  const nombreListaNube = (n) => {
    const name = String(n ?? "").trim().slice(0, 60);
    if (!name) throw new Error("FALTA_NOMBRE");
    return name;
  };

  async function nubeListar() {
    const r = await nubeFetch("/api/listas");
    const locales = new Set(obtenerListasArr().map((l) => l.id));
    return r.listas.map((l) => ({ id: l.id, nombre: l.nombre, rol: l.rol, enDispositivo: locales.has(l.id) }));
  }

  async function nubeCrearLista(nombre) {
    const name = nombreListaNube(nombre);
    const id = nuevoIdLista();
    await nubeFetch("/api/listas", { method: "POST", body: { id, nombre: name } });
    guardarDatosCrudo({ items: [], siguiente: 2 }, id);
    anadirEntradaNube(id, name, "propietario");
    return { id, name };
  }

  // Añade a este dispositivo una lista que ya existe en la nube (tuya en otro dispositivo, o compartida contigo)
  async function nubeAnadirLista(id) {
    if (obtenerListasArr().some((l) => l.id === id)) throw new Error("LISTA_YA_EN_DISPOSITIVO");
    const r = await nubeFetch(`/api/listas/${encodeURIComponent(id)}`);
    guardarDatosCrudo({ items: [], siguiente: 2 }, id);
    anadirEntradaNube(id, r.lista.nombre, r.lista.rol);
    let total = 0;
    try { await sincronizarNube(id); total = leerDatosLocal(id).items.length; } catch (e) { /* se completará al abrirla */ }
    return { id, name: r.lista.nombre, total };
  }

  // Sube una COPIA de una lista (local o de Google Sheets) a la nube; la original no se toca
  async function nubeSubirCopia(origenId, nombre) {
    const origen = obtenerListasArr().find((l) => l.id === origenId);
    if (!origen) throw new Error("LISTA_NO_ENCONTRADA");
    if (origen.tipo === "nube") throw new Error("YA_ESTA_EN_LA_NUBE");
    const name = nombreListaNube(nombre || origen.name);
    const filas = origen.tipo === "local" ? leerDatosLocal(origenId).items : await conLista(origenId, () => obtenerListaCompleta());
    const items = [];
    let fila = 2;
    for (const x of filas) { const it = itemLocal(x, fila); if (it) { items.push(it); fila++; } }
    const id = nuevoIdLista();
    await nubeFetch("/api/listas", { method: "POST", body: { id, nombre: name } }); // si falla aquí, no queda nada a medias
    const d = { items, siguiente: fila };
    registrarCambiosNube(d);
    guardarDatosCrudo(d, id);
    anadirEntradaNube(id, name, "propietario");
    let error = "";
    try { await sincronizarNube(id); } catch (e) { error = String(e?.message || e).replace(/^Error:\s*/, ""); }
    return { id, name, total: items.length, error };
  }

  async function nubeMiembros(id) { return (await nubeFetch(`/api/listas/${encodeURIComponent(id)}`)).miembros || []; }
  async function nubeCompartir(id, email, rol) {
    return nubeFetch(`/api/listas/${encodeURIComponent(id)}/miembros`, { method: "POST", body: { email, rol } });
  }
  async function nubeQuitarMiembro(id, email) {
    return nubeFetch(`/api/listas/${encodeURIComponent(id)}/miembros?email=${encodeURIComponent(email)}`, { method: "DELETE" });
  }
  // Enlace público de solo lectura (solo el propietario): ver, crear/renovar y revocar
  async function nubeEnlace(id) { return (await nubeFetch(`/api/listas/${encodeURIComponent(id)}/enlace`)).enlace || null; }
  async function nubeEnlaceCrear(id, renovar) {
    return (await nubeFetch(`/api/listas/${encodeURIComponent(id)}/enlace`, { method: "POST", body: { renovar: !!renovar } })).enlace;
  }
  async function nubeEnlaceQuitar(id) { await nubeFetch(`/api/listas/${encodeURIComponent(id)}/enlace`, { method: "DELETE" }); }

  // --- Avisos push de capítulos nuevos con la app cerrada --------------------------------------------------
  // La suscripción vive en el navegador (service worker); el Worker guarda qué series sigues y, con una tarea
  // programada, envía la notificación. Ver «Notificaciones push» en worker-completo.js.
  const PUSH_DISPONIBLE = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const pushBytes = (b64u) => {
    const bin = atob(b64u.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64u.length / 4) * 4, "="));
    const o = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return o;
  };
  async function pushPeticion(ruta, cuerpo, keepalive) {
    const r = await fetch(WORKER_URL + ruta, cuerpo === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), keepalive: !!keepalive });
    let datos = null;
    try { datos = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(datos?.error || `PUSH_HTTP_${r.status}`);
    return datos || {};
  }
  async function pushSuscripcion() {
    if (!PUSH_DISPONIBLE()) return null;
    try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch (e) { return null; }
  }
  async function pushEstado() {
    if (!PUSH_DISPONIBLE()) return { soportado: false };
    const sub = await pushSuscripcion();
    return { soportado: true, permiso: Notification.permission, activo: !!sub && Notification.permission === "granted" };
  }
  async function pushActivar(series) {
    if (!PUSH_DISPONIBLE()) throw new Error("PUSH_NO_SOPORTADO");
    const permiso = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permiso !== "granted") throw new Error("PUSH_PERMISO_DENEGADO");
    const reg = await navigator.serviceWorker.ready;
    const { clave } = await pushPeticion("/push/clave");
    const claveBytes = pushBytes(clave);
    let sub = await reg.pushManager.getSubscription();
    if (sub) { // si el Worker cambió de claves (p. ej. base de datos nueva), la suscripción antigua ya no sirve
      const vieja = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (!vieja || vieja.length !== claveBytes.length || vieja.some((v, i) => v !== claveBytes[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes });
    await pushPeticion("/push/suscribir", { subscription: sub.toJSON(), series: series || [] });
  }
  async function pushDesactivar() {
    const sub = await pushSuscripcion();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await pushPeticion("/push/baja", { endpoint }).catch(() => {}); // sin conexión: el Worker lo descartará solo cuando el servicio push responda 410
  }
  async function pushSincronizar(series) {
    const sub = await pushSuscripcion();
    if (!sub || Notification.permission !== "granted") return { enviado: false };
    await pushPeticion("/push/suscribir", { subscription: sub.toJSON(), series: series || [] }, true);
    return { enviado: true };
  }
  async function pushPrueba() {
    const sub = await pushSuscripcion();
    if (!sub) throw new Error("PUSH_SIN_SUSCRIPCION");
    await pushPeticion("/push/prueba", { endpoint: sub.endpoint });
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
  // Filas que tiene ahora la pestaña (null si no se puede saber: entonces no se amplía nada)
  async function leerFilasHoja() {
    try {
      const data = await sheetsFetch("?fields=sheets.properties");
      const hoja = (data.sheets || []).map((s) => s.properties).find((p) => p.sheetId === gid);
      return hoja?.gridProperties?.rowCount ?? null;
    } catch (e) { return null; }
  }
  async function enviarRequestsHoja(requests) {
    await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  }

  // --- Vínculo hoja ↔ nube: motor en la PWA ---------------------------------------------------
  // Corre en segundo plano al abrir cualquiera de las dos listas en un dispositivo con acceso a la hoja. Si no hay
  // sesión de Google Sheets (o no hay conexión) no hace nada ni abre ventanas: la lista de la nube sigue funcionando.
  // Para tocar la hoja se cambia un momento la configuración activa (conLista); mientras tanto el resto de la API
  // espera (pausaApi), para que ninguna acción de la pantalla se ejecute contra la lista equivocada.
  let pausaApi = null;
  async function conListaExclusiva(listaId, fn) {
    let liberar;
    pausaApi = new Promise((r) => { liberar = r; });
    try { return await conLista(listaId, fn); }
    finally { pausaApi = null; liberar(); }
  }
  const activaVinculada = () => !!obtenerListasArr().find((l) => l.id === idListaActiva())?.vinculo;

  let colaVinculo = Promise.resolve();
  const ultimaSincVinculo = {};
  const sincronizarVinculo = (id, opciones = {}) => {
    const p = colaVinculo.catch(() => {}).then(() => _sincronizarVinculo(id, opciones));
    colaVinculo = p;
    return p;
  };

  async function _sincronizarVinculo(id, { forzar = false, interactivo = false } = {}) {
    if (!id) id = idListaActiva();
    const listas = obtenerListasArr();
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
    try { await ensureToken(interactivo); } catch (e) { return { omitido: "sin_sesion_hoja" }; }
    // 2) En paralelo: la lista de la nube al día y la hoja leída (no dependen una de otra). Si la nube se acaba de
    //    sincronizar (al abrir la lista) no se repite.
    const pNube = nubeAlDia(nubeL.id, forzar ? 0 : 8000).then(() => null, (e) => e);
    let baseGuardada = null;
    try { baseGuardada = JSON.parse(localStorage.getItem(clave) || "null"); } catch (e) {}
    const resultado = await conListaExclusiva(hojaL.id, async () => {
      const [errNube, hoja] = await Promise.all([pNube, obtenerListaCompleta()]);
      if (errNube) return { omitido: "sin_nube", error: String(errNube?.message || errNube).replace(/^Error:\s*/, "") };
      const base = baseGuardada || {};
      const plan = planificarVinculo(base, hoja, leerDatosLocal(nubeL.id).items);
      if (plan.sospechoso) return { omitido: "borrados_masivos", borrados: plan.borrados };
      const res = resumenVinculoVacio();
      const fallos = new Set();
      // --- Hoja: todos los cambios en una o pocas peticiones
      if (plan.aHoja.anadir.length) gridFilas = await leerFilasHoja();
      const hechos = await ejecutarLotesHoja(construirLotesHoja(gid, plan.aHoja, hoja, gridFilas), enviarRequestsHoja);
      res.hoja.actualizadas = hechos.actualizadas; res.hoja.eliminadas = hechos.eliminadas; res.hoja.anadidas = hechos.anadidas;
      hechos.fallos.forEach((k) => fallos.add(k));
      // --- Nube: sobre los datos locales de la lista (se envían solos al Worker)
      const portadas = [];
      {
        const d = leerDatosLocal(nubeL.id);
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
        if (cambios) guardarDatosLocal(d, nubeL.id);
      }
      portadas.forEach((u) => precachearImagen(u));
      // Lo que falló se reintenta en la próxima sincronización (su base no cambia)
      const nuevaBase = { ...plan.base };
      for (const k of fallos) { if (k in base) nuevaBase[k] = base[k]; else delete nuevaBase[k]; }
      try { localStorage.setItem(clave, JSON.stringify(nuevaBase)); } catch (e) {}
      return { ...res, fallos: fallos.size };
    });
    if (resultado.omitido) return resultado;
    const listaActivaId = idListaActiva();
    const tocaHoja = resultado.hoja.actualizadas + resultado.hoja.anadidas + resultado.hoja.eliminadas > 0;
    const tocaNube = resultado.nube.actualizadas + resultado.nube.anadidas + resultado.nube.eliminadas > 0;
    return { ...resultado, cambiosActiva: (listaActivaId === hojaL.id && tocaHoja) || (listaActivaId === nubeL.id && tocaNube) };
  }


  function crearVinculo(hojaId, nubeId) {
    const listas = obtenerListasArr();
    const h = listas.find((l) => l.id === hojaId), n = listas.find((l) => l.id === nubeId);
    if (!h || !n) throw new Error("LISTA_NO_ENCONTRADA");
    if (h.tipo === "local" || h.tipo === "nube" || n.tipo !== "nube") throw new Error("VINCULO_INVALIDO");
    if (n.rol === "lectura") throw new Error("SOLO_LECTURA");
    if (h.vinculo || n.vinculo) throw new Error("YA_VINCULADA");
    h.vinculo = { con: n.id };
    n.vinculo = { con: h.id };
    guardarListasArr(listas);
    try { localStorage.removeItem(claveBaseVinculo(n.id, h.id)); } catch (e) {} // sin base: la primera sincronización las une
    return {};
  }

  function quitarVinculo(id) {
    const listas = obtenerListasArr();
    const l = listas.find((x) => x.id === id);
    if (!l?.vinculo) return {};
    const par = listas.find((x) => x.id === l.vinculo.con);
    delete l.vinculo;
    if (par) delete par.vinculo;
    guardarListasArr(listas);
    try { localStorage.removeItem(claveBaseVinculo(l.id, par?.id)); localStorage.removeItem(claveBaseVinculo(par?.id, l.id)); } catch (e) {}
    return {};
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
      case "RENAME_LISTA": renombrarLista(msg.id,msg.name); return {ok:true};
      case "DELETE_LISTA": return {ok:true,...await eliminarListaGuardada(msg.id)};
      case "SWITCH_LISTA": return {ok:true,...await cambiarListaActiva(msg.id)};
      case "GET_ANIME_LIST": { const lista = await obtenerListaCompleta({sinSync:!!msg.sinSync}); return {ok:true,lista,nube:estadoNube}; }
      case "NUBE_ESTADO": return {ok:true,sesion:window.PWA_NUBE.estado(),clientId:obtenerClientId()};
      case "NUBE_CERRAR_SESION": window.PWA_NUBE.cerrarSesion(); return {ok:true};
      case "NUBE_LISTAR": return {ok:true,listas:await nubeListar()};
      case "NUBE_CREAR": return {ok:true,...await nubeCrearLista(msg.name)};
      case "NUBE_ANADIR": return {ok:true,...await nubeAnadirLista(msg.id)};
      case "VINCULO_CREAR": return {ok:true,...crearVinculo(msg.hojaId,msg.nubeId)};
      case "VINCULO_QUITAR": return {ok:true,...quitarVinculo(msg.id)};
      case "VINCULO_SINCRONIZAR": return {ok:true,...await sincronizarVinculo(msg.id,{forzar:!!msg.forzar,interactivo:!!msg.interactivo})};
      case "NUBE_SUBIR": return {ok:true,...await nubeSubirCopia(msg.id,msg.name)};
      case "NUBE_MIEMBROS": return {ok:true,miembros:await nubeMiembros(msg.id)};
      case "NUBE_COMPARTIR": return {ok:true,...await nubeCompartir(msg.id,msg.email,msg.rol)};
      case "NUBE_QUITAR_MIEMBRO": await nubeQuitarMiembro(msg.id,msg.email); return {ok:true};
      case "NUBE_ENLACE": return {ok:true,enlace:await nubeEnlace(msg.id)};
      case "NUBE_ENLACE_CREAR": return {ok:true,enlace:await nubeEnlaceCrear(msg.id,msg.renovar)};
      case "NUBE_ENLACE_QUITAR": await nubeEnlaceQuitar(msg.id); return {ok:true};
      case "PUSH_ESTADO": return {ok:true,...(await pushEstado())};
      case "PUSH_ACTIVAR": await pushActivar(msg.series); return {ok:true};
      case "PUSH_DESACTIVAR": await pushDesactivar(); return {ok:true};
      case "PUSH_SINCRONIZAR": return {ok:true,...(await pushSincronizar(msg.series))};
      case "PUSH_PRUEBA": await pushPrueba(); return {ok:true};
      case "NUBE_SINCRONIZAR": return {ok:true,...await sincronizarNube(msg.id)};
      case "NUBE_ESPERAR_SYNC": { // resultado de la sincronización que se lanzó al abrir la lista
        let r = syncAlAbrir[msg.id] ? await syncAlAbrir[msg.id] : resultadoAlAbrir[msg.id];
        if (!r || (r.ts && Date.now() - r.ts > 60000)) r = { id: msg.id, ok: true, cambios: 0 };
        delete resultadoAlAbrir[msg.id];
        return {ok:true,nube:r};
      }
      case "NUBE_BORRAR": { // si ya la borraron desde otro dispositivo, el objetivo (que no exista) ya está cumplido
        try { await nubeFetch(`/api/listas/${encodeURIComponent(msg.id)}`,{method:"DELETE"}); }
        catch (e) { if (!/NUBE_LISTA_NO_EXISTE/.test(String(e?.message || e))) throw e; }
        return {ok:true};
      }
      case "UPDATE_ANIME": await actualizarCampo(msg.row,msg.campo,msg.valor); return {ok:true};
      case "UPDATE_GENRES_BULK": await actualizarGenerosLote(msg.cambios); return {ok:true};
      case "UPDATE_TITLE_URL": await actualizarTituloUrl(msg.row,msg.title,msg.url); return {ok:true};
      case "FILL_COVERS": return {ok:true,...await rellenarPortadas()};
      case "MIGRATE_ANIMEFLV": return {ok:true,...await migrarAnimeFlv()};
      case "GET_CAPITULOS": { const i=await infoCapitulos(msg.slug); return {ok:true,max:i?.max??null,emision:i?.emision??null}; }
      case "REGISTER_ANIME": return {ok:true,...await registrarAnime(msg.url)};
      case "RESOLVER_SECUELA": return {ok:true,...await conLista(msg.listaId,()=>resolverSecuela(msg))};
      case "CAP_EXISTE": return {ok:true,existe:await capituloSiguienteExiste(msg)};
      case "GET_FUENTES": return {ok:true,fuentes:leerFuentes()};
      case "IMPORTAR_FUENTES": return {ok:true,total:importarFuentes(msg.texto)};
      case "ACTUALIZAR_FUENTE": actualizarFuente(msg.id,msg); return {ok:true};
      case "BORRAR_FUENTE": borrarFuente(msg.id); return {ok:true};
      default: throw new Error("MENSAJE_DESCONOCIDO");
    }
  }
  window.enviarMensajePWA = async msg => { try{ while (pausaApi && !/^VINCULO_/.test(String(msg?.type))) await pausaApi; return await handle(msg);}catch(e){return {ok:false,error:String(e?.message||e).replace(/^Error:\s*/,"")};} };
})();
