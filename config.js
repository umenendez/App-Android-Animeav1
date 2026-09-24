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
  googleClientId: "1Pasl_bWsVlMPKhNLes3MAXLIFi3-4sD8ErkuP1EvO2M/edit?pli",
  googleScopes: "https://www.googleapis.com/auth/spreadsheets"
};
