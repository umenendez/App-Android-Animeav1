// CONFIGURACIÓN DE LA PWA
//
// Ya NO hace falta editar este archivo para poner el Client ID: la propia
// app lo pide en el formulario, junto al enlace del Google Sheet, y lo
// guarda en este dispositivo (localStorage). El valor de aquí abajo solo
// se usa como respaldo/valor por defecto si todavía no se ha guardado
// ninguno en el dispositivo.
//
// Recuerda: para usar Google Sheets desde una web necesitas un OAuth 2.0
// Client ID de tipo "Aplicación web" (no el de tipo Chrome Extension), y
// en Google Cloud Console debes añadir como "Orígenes autorizados de
// JavaScript" la URL exacta desde la que publiques esta PWA, por ejemplo:
//   https://tuusuario.github.io
window.PWA_CONFIG = {
  googleClientId: "123415018434-6dicvlgt2j37v841f9m0hricunuatp9c.apps.googleusercontent.com",
  googleScopes: "https://www.googleapis.com/auth/spreadsheets"
};
