# AnimeAV1 Tracker — PWA

Esta carpeta es la versión PWA de tu extensión de Chrome. Conserva la interfaz de `popup.html` y la gestión de la lista mediante Google Sheets, pero sustituye las APIs de Chrome por APIs web.

## Importante: Google OAuth

Una extensión de Chrome puede usar un OAuth Client ID de tipo Chrome Extension. Una PWA publicada en una web necesita un **OAuth 2.0 Client ID de tipo Aplicación web**.

1. En Google Cloud Console crea/selecciona un proyecto.
2. Activa **Google Sheets API**.
3. En **APIs y servicios → Credenciales**, crea un **ID de cliente OAuth 2.0 → Aplicación web**.
4. Añade como origen autorizado la URL exacta donde vas a publicar esta PWA, por ejemplo `https://usuario.github.io`.
5. Copia ese Client ID en `config.js` sustituyendo `PON_AQUI_TU_CLIENT_ID_WEB.apps.googleusercontent.com`.
6. Publica esta carpeta en GitHub Pages, Netlify, Cloudflare Pages o tu propio HTTPS.
7. Abre la URL desde Android con Chrome y usa **⋮ → Añadir a pantalla de inicio**.

No publiques un `client_secret`: para esta aplicación web solo necesitas el Client ID.

## Qué funciona

- Interfaz y tema claro/oscuro/automático.
- Lista y filtros.
- Edición de nota, estado, género, portada, título, enlace y último capítulo.
- Google Sheets mediante OAuth.
- Caché de portadas en el dispositivo.
- Buscar portadas que faltan.
- Migrar enlaces AnimeFLV → AnimeAV1.
- Instalable como PWA desde Android.

## Qué no puede hacer una PWA

El `content.js` de la extensión detectaba automáticamente cuando abrías un episodio de `animeav1.com`. Una PWA normal no puede inyectarse en otras páginas de Chrome, por lo que esa detección automática no está incluida en la versión PWA.

La extensión original puede seguir instalada en el PC para conservar esa función.
