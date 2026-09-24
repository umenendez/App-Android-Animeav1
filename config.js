// CONFIGURACIÓN DE LA PWA
//
// Para usar Google Sheets desde una web necesitas un OAuth 2.0 Client ID
// de tipo "Aplicación web". NO uses el Client ID específico de Chrome
// que aparece en el manifest de la extensión.
//
// En Google Cloud Console añade como "Orígenes autorizados de JavaScript"
// la URL exacta desde la que vas a publicar esta PWA, por ejemplo:
//   https://tuusuario.github.io
// o tu dominio propio.
window.PWA_CONFIG = {
  googleClientId: "123415018434-6dicvlgt2j37v841f9m0hricunuatp9c.apps.googleusercontent.com",
  googleScopes: "https://www.googleapis.com/auth/spreadsheets"
};
