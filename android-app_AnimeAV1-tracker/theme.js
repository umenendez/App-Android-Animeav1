// theme.js — se carga en <head> (sin defer) para aplicar el tema antes de pintar
// y evitar el parpadeo blanco/negro al abrir el popup.
(function () {
  let modo = "auto";
  try { modo = localStorage.getItem("tema") || "auto"; } catch (e) {}
  document.documentElement.dataset.tema = modo;
})();
