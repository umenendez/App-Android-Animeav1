// Proxy CORS mínimo para la app AnimeAV1 Tracker (Android/PWA).
//
// Por qué hace falta: un navegador de verdad (a diferencia de una extensión
// con host_permissions) no puede leer el HTML de animeav1.com o animeflv.net
// desde JavaScript si esos sitios no envían cabeceras CORS. Este Worker
// simplemente pide la página él mismo (sin restricción de CORS, porque es
// un servidor) y te la devuelve con las cabeceras que el navegador necesita.
//
// Despliegue (gratis, ~2 minutos):
// 1. Crea una cuenta en https://workers.cloudflare.com
// 2. "Create application" -> "Create Worker" -> pega este código -> "Deploy"
// 3. Copia la URL que te da (algo como https://xxxx.tu-usuario.workers.dev)
// 4. En Ajustes de la app, en "Proxy CORS" pon: https://xxxx.tu-usuario.workers.dev/?url=

const PERMITIDOS = ["animeav1.com", "animeflv.net", "www.animeflv.net"];

export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const objetivo = searchParams.get("url");

    if (!objetivo) {
      return new Response("Falta el parámetro ?url=", { status: 400 });
    }

    let destino;
    try {
      destino = new URL(objetivo);
    } catch (e) {
      return new Response("URL inválida", { status: 400 });
    }

    const permitido = PERMITIDOS.some(
      (dominio) => destino.hostname === dominio || destino.hostname.endsWith("." + dominio)
    );
    if (!permitido) {
      return new Response("Dominio no permitido", { status: 403 });
    }

    const resp = await fetch(destino.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AnimeAV1TrackerProxy/1.0)" },
    });
    const texto = await resp.text();

    return new Response(texto, {
      status: resp.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
