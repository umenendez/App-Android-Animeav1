/* AnimeAV1 Tracker - capa web para la PWA.
 * Sustituye chrome.storage/chrome.identity por localStorage + Google Identity Services.
 */
(function () {
  const CFG = window.PWA_CONFIG || {};
  const COVER_CACHE = "anime-covers-v1";
  const ESTADO_VIENDO = "-";
  let accessToken = null;
  let tokenExpiresAt = 0;
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

  function esperarGIS() {
    if (gisReady) return gisReady;
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

  function pedirToken(prompt) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response?.error) return reject(new Error(response.error));
        if (!response?.access_token) return reject(new Error("NO_SE_OBTUVO_TOKEN"));
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + ((response.expires_in || 3600) * 1000);
        guardarTokenSesion();
        resolve(accessToken);
      };
      try {
        tokenClient.requestAccessToken({ prompt });
      } catch (e) { reject(e); }
    });
  }

  // Intenta iniciar sesión sola, sin ventanas ni clics (prompt:""), usando la
  // sesión de Google que ya haya en el navegador/dispositivo. Solo si eso
  // falla (primera vez, o el acceso se revocó) se muestra el diálogo de
  // consentimiento de Google, y solo cuando interactive=true.
  async function ensureToken(interactive = true) {
    if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
    const clientId = obtenerClientId();
    if (!clientId) throw new Error("CONFIGURA_CLIENT_ID_WEB");
    await esperarGIS();
    if (!tokenClient || tokenClientId !== clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: CFG.googleScopes || "https://www.googleapis.com/auth/spreadsheets",
        // FedCM sustituye al viejo mecanismo de reautenticación silenciosa
        // basado en cookies de terceros (que los navegadores bloquean cada
        // vez más), así que el intento de prompt:"" es más fiable con esto.
        use_fedcm_for_prompt: true,
        callback: () => {}
      });
      tokenClientId = clientId;
    }
    try {
      return await pedirToken("");
    } catch (e) {
      if (!interactive) throw e;
      return await pedirToken("consent");
    }
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
      accessToken = null; tokenExpiresAt = 0; borrarTokenSesion();
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
    if (!config?.spreadsheetId) throw new Error("SIN_CONFIG");
    spreadsheetId = config.spreadsheetId;
    gidConfig = config.gid ?? null;
  }

  function resetConfig() {
    spreadsheetId = null; gidConfig = null; cachedSheetName = null;
  }
  function rango(nombre, celdas) { return `'${nombre.replace(/'/g, "''")}'!${celdas}`; }

  async function getSheetName() {
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
        accessToken = null; tokenExpiresAt = 0; tokenClient = null; tokenClientId = null; borrarTokenSesion();
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
    await getSheetName();
    const colIndex = COLUMNAS_EDITABLES[campo];
    if (colIndex === undefined) throw new Error("Campo desconocido: " + campo);
    const celda = { userEnteredValue: null };
    const fields = ["userEnteredValue"];
    if (campo === "score") {
      const num = parseFloat(String(valor).replace(",", "."));
      celda.userEnteredValue = Number.isNaN(num) ? { stringValue:"" } : { numberValue:num };
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

  async function actualizarTituloUrl(row, title, url) {
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

  // Añade un anime nuevo a partir de su enlace: descarga la página, saca el
  // título y la portada, y crea la fila. Sustituye a la detección automática
  // que hacía la extensión de Chrome al abrir un episodio (no disponible en
  // una PWA normal).
  async function registrarAnime(enlace) {
    const url = String(enlace || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("ENLACE_ANIME_INVALIDO");

    const existentes = await obtenerListaCompleta();
    const yaExiste = existentes.some((a) => a.url && a.url.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
    if (yaExiste) throw new Error("YA_EXISTE");

    let html;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      html = await r.text();
    } catch (e) { throw new Error("NO_SE_PUDO_LEER_LA_PAGINA"); }

    const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const titulo = m ? m[1].trim() : "";
    if (!titulo) throw new Error("SIN_TITULO");
    const cover = extraerPortadaDesdeHtml(html);

    const sheetName = await getSheetName();
    const fila = await siguienteFilaLibre(sheetName);

    const valores = new Array(11).fill(null).map(() => ({}));
    valores[3] = { userEnteredValue: { stringValue: titulo }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }] };
    valores[5] = { userEnteredValue: { stringValue: ESTADO_VIENDO } };
    if (cover) valores[9] = { userEnteredValue: { formulaValue: `=IMAGE("${cover}",1)` } };

    await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ updateCells: {
      range: { sheetId: gid, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 0, endColumnIndex: 11 },
      rows: [{ values: valores }],
      fields: "userEnteredValue,textFormatRuns"
    }}] }) });

    if (cover) precachearImagen(cover);
    return { row: fila, title: titulo, url, cover: cover || "", status: ESTADO_VIENDO };
  }

  async function precachearImagen(url) {
    if (!url) return;
    try { const cache = await caches.open(COVER_CACHE); if (!(await cache.match(url))) { const r=await fetch(url); if(r.ok) await cache.put(url,r.clone()); } } catch(e) {}
  }

  function extraerPortadaDesdeHtml(html) {
    const m = html.match(/cdn\.animeav1\.com\/covers\/\d+\.jpg/i);
    return m ? `https://${m[0]}` : null;
  }

  async function rellenarPortadas() {
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
      case "GET_CONFIG": return {ok:true,config:JSON.parse(localStorage.getItem("config")||"null")};
      case "GET_CLIENT_ID": return {ok:true,clientId:obtenerClientId()};
      case "SAVE_CONFIG": return {ok:true,...await guardarConfig(msg.url,msg.clientId)};
      case "GET_ANIME_LIST": return {ok:true,lista:await obtenerListaCompleta()};
      case "UPDATE_ANIME": await actualizarCampo(msg.row,msg.campo,msg.valor); return {ok:true};
      case "UPDATE_TITLE_URL": await actualizarTituloUrl(msg.row,msg.title,msg.url); return {ok:true};
      case "FILL_COVERS": return {ok:true,...await rellenarPortadas()};
      case "MIGRATE_ANIMEFLV": return {ok:true,...await migrarAnimeFlv()};
      case "REGISTER_ANIME": return {ok:true,...await registrarAnime(msg.url)};
      default: throw new Error("MENSAJE_DESCONOCIDO");
    }
  }
  window.enviarMensajePWA = async msg => { try{return await handle(msg);}catch(e){return {ok:false,error:String(e?.message||e).replace(/^Error:\s*/,"")};} };
})();
