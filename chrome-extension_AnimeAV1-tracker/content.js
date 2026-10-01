// content.js
// Se ejecuta en https://animeav1.com/media/*
// Detecta cuando el usuario abre un EPISODIO (ej: /media/one-piece/12),
// lo que interpretamos como "empezar a ver" ese anime.

(function () {
  const path = location.pathname.replace(/\/+$/, ""); // sin barra final
  const match = path.match(/^\/media\/([^/]+)\/(\d+)$/);
  if (!match) return; // no es una página de episodio, no hacemos nada

  const slug = match[1];
  const episodeUrl = location.origin + path;

  // Siempre avisamos al background, que es quien decide qué hacer
  // según el estado actual en Firestore (no nos fiamos de un registro
  // local, porque el usuario puede haber cambiado el estado a mano).
  extraerInfoAnime(slug)
    .then((info) => chrome.runtime.sendMessage({ type: "REGISTER_ANIME", slug, episodeUrl, ...info }))
    .catch((e) => console.error("[AnimeAV1 Tracker] Error extrayendo datos:", e));
})();

async function extraerInfoAnime(slug) {
  const mainUrl = `https://animeav1.com/media/${slug}`;
  const res = await fetch(mainUrl);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Título
  const title = (doc.querySelector("h1")?.textContent || slug).trim();

  // Puntuación (aparece como "8.73" seguido de "MAL RATING")
  const bodyText = doc.body.innerText || "";
  const scoreMatch = bodyText.match(/(\d+(?:[.,]\d+)?)\s*\n*\s*MAL RATING/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1].replace(",", ".")).toFixed(1) : "";

  // Descripción: tomamos los párrafos largos de la sinopsis
  // (después de los géneros y antes de la puntuación/tráiler) y los
  // dejamos como texto seguido, sin saltos de línea ni dobles espacios.
  const paragraphs = Array.from(doc.querySelectorAll("p"))
    .map((p) => p.textContent.replace(/\s+/g, " ").trim())
    .filter(
      (t) =>
        t.length > 60 &&
        !/derechos|copyright|términos|política de privacidad/i.test(t)
    );
  const description = paragraphs.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();

  // Portada (póster junto a la sinopsis): cdn.animeav1.com/covers/<id>.jpg
  const coverMatch = html.match(/cdn\.animeav1\.com\/covers\/\d+\.jpg/i);
  const cover = coverMatch ? `https://${coverMatch[0]}` : "";

  return { title, url: mainUrl, score, description, cover };
}
