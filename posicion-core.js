// Lógica pura del posicionador y del separador de empates (sin DOM).
// Se carga antes que popup.js y también puede probarse con Node:
//   node -e "const P=require('./posicion-core.js'); ..."
const PosCore = (() => {
  // --- Utilidades ---------------------------------------------------------------
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  function notaNumero(a) {
    const n = parseFloat(String(a?.score ?? "").replace(",", "."));
    return Number.isFinite(n) ? (n <= 0 ? null : Math.min(10, Math.max(0, n))) : null;
  }
  function notaRedondeada(n) { return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10; }
  function mediana(nums) {
    const a = nums.slice().sort((x, y) => x - y);
    if (!a.length) return 5;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Agrupa por nota redondeada a una décima, de mayor a menor.
  function crearGrupos(items, working) {
    const mapa = new Map();
    items.forEach(a => {
      const n = working.get(a.row);
      if (n == null) return;
      const key = notaRedondeada(n).toFixed(1);
      if (!mapa.has(key)) mapa.set(key, { key, score: notaRedondeada(n), items: [] });
      mapa.get(key).items.push(a);
    });
    return Array.from(mapa.values()).sort((a, b) => b.score - a.score);
  }

  // Grupos de series que comparten nota (≥ 2), de mayor a menor.
  function gruposEmpate(validas) {
    const mapa = new Map();
    validas.forEach(a => {
      const n = notaNumero(a);
      if (n == null) return;
      const key = notaRedondeada(n).toFixed(1);
      if (!mapa.has(key)) mapa.set(key, { score: notaRedondeada(n), items: [] });
      mapa.get(key).items.push(a);
    });
    return Array.from(mapa.values()).filter(g => g.items.length >= 2).sort((a, b) => b.score - a.score);
  }
  function contarEmpates(validas) {
    return gruposEmpate(validas).reduce((t, g) => t + g.items.length, 0);
  }

  // --- Estado del posicionador --------------------------------------------------
  function crearEstado(validas, candidate, rng) {
    const rated = validas.filter(a => a !== candidate && notaNumero(a) != null);
    const original = notaNumero(candidate);
    const working = new Map(validas.map(a => [a.row, notaNumero(a)]));
    const inicial = original ?? (rated.length ? mediana(rated.map(notaNumero)) : 5);
    working.set(candidate.row, inicial);
    const grupos = crearGrupos(rated, working);
    return {
      validas, candidate, rated, working, grupos, inicial,
      lo: 0, hi: grupos.length - 1,
      igualGrupo: null, comparaciones: 0,
      saltados: [],            // filas que el usuario no ha visto
      usados: new Set(),       // filas ya usadas como rival en esta sesión
      confirmados: new Set(),  // "sup3" / "inf4": vecinas ya comprobadas
      omitirConfirmacion: false, entreIguales: false,
      rivalGrupo: new Map(),   // rival elegido por grupo (estable entre repintados)
      historial: [], paso: null, rival: null,
      rng: rng || Math.random
    };
  }

  function hayDisponible(s, g) {
    return !!g && g.items.some(a => !s.saltados.includes(a.row));
  }

  // Grupo central del intervalo [lo, hi]; si está saltado, el más cercano disponible.
  function grupoCentral(s, lo = s.lo, hi = s.hi) {
    if (lo > hi || !s.grupos.length) return null;
    const centro = Math.floor((lo + hi) / 2);
    for (let d = 0; d <= hi - lo; d++) {
      const izq = centro - d, der = centro + d;
      if (izq >= lo && hayDisponible(s, s.grupos[izq])) return izq;
      if (d > 0 && der <= hi && hayDisponible(s, s.grupos[der])) return der;
    }
    return null;
  }

  // Preferencia de rival: primero series que no se hayan usado ya, y entre ellas
  // las que se recuerdan mejor (vistas > viendo > dropeadas). Desempata al azar.
  function pesoRival(s, a) {
    let p = s.usados.has(a.row) ? 0 : 4;
    if (a.status === "✔") p += 2;
    else if (a.status === "-") p += 1;
    else if (a.status === "📉") p += 0.5;
    return p;
  }

  // nuevo=true: solo rivales aún no usados (para comprobaciones).
  function rivalDeGrupo(s, idx, nuevo = false) {
    const g = s.grupos[idx];
    if (!g) return null;
    const disp = g.items.filter(a => !s.saltados.includes(a.row));
    const pool = nuevo ? disp.filter(a => !s.usados.has(a.row)) : disp;
    if (!pool.length) return null;
    const clave = idx + (nuevo ? "n" : "");
    const previo = s.rivalGrupo.get(clave);
    if (previo && pool.includes(previo)) return previo;
    const mejor = Math.max(...pool.map(a => pesoRival(s, a)));
    const finalistas = pool.filter(a => pesoRival(s, a) === mejor);
    const elegido = finalistas[Math.floor(s.rng() * finalistas.length)];
    s.rivalGrupo.set(clave, elegido);
    return elegido;
  }

  // Siguiente comparación: búsqueda binaria y, ya resuelta, comprobación con las
  // vecinas de arriba y de abajo (con un rival distinto al usado). null = terminado.
  function siguientePaso(s) {
    if (s.igualGrupo != null || !s.grupos.length) return null;
    if (s.lo <= s.hi) {
      const idx = grupoCentral(s);
      if (idx == null) return null;
      return { tipo: "buscar", idx, rival: rivalDeGrupo(s, idx, false) };
    }
    if (s.omitirConfirmacion || s.comparaciones === 0) return null;
    const lados = [
      { lado: "sup", idx: s.lo - 1, esperado: "menos" },  // debe quedar por debajo de la de arriba
      { lado: "inf", idx: s.lo, esperado: "más" }         // y por encima de la de abajo
    ];
    for (const c of lados) {
      if (c.idx < 0 || c.idx >= s.grupos.length) continue;
      if (s.confirmados.has(c.lado + c.idx)) continue;
      const rival = rivalDeGrupo(s, c.idx, true);
      if (rival) return { tipo: "confirmar", ...c, rival };
    }
    return null;
  }

  // Foto del estado antes de cada respuesta, para poder deshacer.
  function instantanea(s) {
    return {
      lo: s.lo, hi: s.hi, igualGrupo: s.igualGrupo, comparaciones: s.comparaciones,
      saltados: s.saltados.slice(), usados: new Set(s.usados),
      confirmados: new Set(s.confirmados), omitirConfirmacion: s.omitirConfirmacion,
      entreIguales: !!s.entreIguales
    };
  }
  function deshacer(s) {
    const prev = s.historial.pop();
    if (!prev) return false;
    Object.assign(s, prev);
    s.rival = null; s.paso = null;
    return true;
  }
  function saltar(s, rival) {
    s.historial.push(instantanea(s));
    if (!s.saltados.includes(rival.row)) s.saltados.push(rival.row);
    s.rival = null;
  }

  // tipo: "más" (el candidato gusta más), "menos" o "igual".
  function responder(s, paso, tipo) {
    s.historial.push(instantanea(s));
    s.comparaciones++;
    s.usados.add(paso.rival.row);
    const idx = paso.idx;
    if (tipo === "igual") { s.igualGrupo = idx; return; }
    if (paso.tipo === "confirmar") {
      if (tipo === paso.esperado) { s.confirmados.add(paso.lado + idx); return; }
      // La vecina de ese grupo ya había respondido lo contrario con otro rival:
      // la serie cae entre dos series con la misma nota, así que hereda esa nota.
      s.confirmados.clear();
      s.igualGrupo = idx;
      s.entreIguales = true;
      return;
    }
    if (tipo === "más") s.hi = idx - 1; else s.lo = idx + 1;
  }

  // Rivales probables de la siguiente ronda (para precargar sus portadas).
  function proximosRivales(s, paso) {
    if (!paso || paso.tipo !== "buscar") return [];
    const out = [];
    [[s.lo, paso.idx - 1], [paso.idx + 1, s.hi]].forEach(([lo, hi]) => {
      const i = grupoCentral(s, lo, hi);
      const r = i == null ? null : rivalDeGrupo(s, i, false);
      if (r) out.push(r);
    });
    return out;
  }

  // Comparaciones que faltan, aproximadamente.
  function restantes(s) {
    if (s.igualGrupo != null) return 0;
    if (s.lo <= s.hi) return Math.ceil(Math.log2(s.hi - s.lo + 2));
    if (s.omitirConfirmacion) return 0;
    let n = 0;
    [["sup", s.lo - 1], ["inf", s.lo]].forEach(([lado, idx]) => {
      if (idx < 0 || idx >= s.grupos.length || s.confirmados.has(lado + idx)) return;
      if (rivalDeGrupo(s, idx, true)) n++;
    });
    return n;
  }

  function calcularNota(s) {
    if (s.igualGrupo != null) return notaRedondeada(s.grupos[s.igualGrupo].score);
    if (s.comparaciones === 0) return notaRedondeada(s.inicial);

    const resuelto = s.lo > s.hi;
    const superior = s.lo > 0 ? s.grupos[s.lo - 1].score : null;
    const inferior = s.hi + 1 < s.grupos.length ? s.grupos[s.hi + 1].score : null;

    // Extremos: en vez de saltar a 10.0 / 0.0, queda justo por encima de la mejor
    // (o por debajo de la peor). El usuario puede subirla en la pantalla final.
    if (resuelto) {
      if (superior == null && inferior != null) return Math.min(10, notaRedondeada(inferior + 0.1));
      if (inferior == null && superior != null) return Math.max(0.1, notaRedondeada(superior - 0.1));
    }

    const sup = superior ?? 10;
    const inf = inferior ?? 0;
    const medio = notaRedondeada((sup + inf) / 2);
    if (medio < sup && medio > inf) return medio;

    // No cabe ninguna décima entre las vecinas: se acepta repetir nota.
    const previa = notaNumero(s.candidate);
    if (previa != null) {
      if (previa < sup && previa > inf) return notaRedondeada(previa);
      return Math.abs(previa - sup) <= Math.abs(previa - inf) ? notaRedondeada(sup) : notaRedondeada(inf);
    }
    return medio;
  }

  // Vecinas del resultado (para enseñar el contexto antes de guardar).
  function vecinas(s) {
    const rep = g => {
      if (!g) return null;
      return { anime: g.items.find(a => s.usados.has(a.row)) || g.items[0], nota: g.score };
    };
    if (s.igualGrupo != null) {
      return { igual: rep(s.grupos[s.igualGrupo]), sup: rep(s.grupos[s.igualGrupo - 1]), inf: rep(s.grupos[s.igualGrupo + 1]) };
    }
    if (s.lo > s.hi) return { sup: rep(s.grupos[s.lo - 1]), inf: rep(s.grupos[s.lo]) };
    return { sup: rep(s.grupos[s.lo - 1]), inf: rep(s.grupos[s.hi + 1]), incierto: true };
  }

  // Extremo alcanzado: "arriba" si queda por encima de todas, "abajo" si por debajo.
  function extremo(s) {
    if (s.igualGrupo != null || s.lo <= s.hi || !s.grupos.length || s.comparaciones === 0) return null;
    if (s.lo === 0) return "arriba";
    if (s.lo >= s.grupos.length) return "abajo";
    return null;
  }

  function contarComparten(validas, anime, nota) {
    const n = notaRedondeada(nota);
    return validas.filter(a => a !== anime && notaNumero(a) != null && notaRedondeada(notaNumero(a)) === n).length;
  }

  // --- Separador de empates -----------------------------------------------------
  // Reparte las décimas para N escalones SIN salir del hueco que dejan las series
  // vecinas. Devuelve las notas en décimas, del mejor escalón al peor.
  function calcularReparto(animes, items, score, nEscalones) {
    const filasGrupo = new Set(items.map(a => a.row));
    const base = Math.round(score * 10);
    let vecinaInf = 0, vecinaSup = 101;
    animes.forEach(a => {
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

  // Máximo de comparaciones de una ordenación por mezcla de n elementos.
  function peorCasoMerge(n) {
    if (n < 2) return 0;
    const k = Math.ceil(Math.log2(n));
    return n * k - Math.pow(2, k) + 1;
  }

  return {
    plural, notaNumero, notaRedondeada, mediana, crearGrupos, gruposEmpate, contarEmpates,
    crearEstado, grupoCentral, rivalDeGrupo, siguientePaso, responder, saltar, deshacer,
    proximosRivales, restantes, calcularNota, vecinas, extremo, contarComparten,
    calcularReparto, peorCasoMerge
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PosCore;
