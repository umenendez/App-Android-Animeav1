# AnimeAV1 Tracker — PWA

Esta carpeta es la versión PWA de tu extensión de Chrome. Conserva la interfaz de `popup.html` y la gestión de la lista mediante Google Sheets, pero sustituye las APIs de Chrome por APIs web.

## Importante: Google OAuth

Una extensión de Chrome puede usar un OAuth Client ID de tipo Chrome Extension. Una PWA publicada en una web necesita un **OAuth 2.0 Client ID de tipo Aplicación web**.

1. En Google Cloud Console crea/selecciona un proyecto.
2. Activa **Google Sheets API**.
3. En **APIs y servicios → Credenciales**, crea un **ID de cliente OAuth 2.0 → Aplicación web**.
4. Añade como origen autorizado la URL exacta donde vas a publicar esta PWA, por ejemplo `https://usuario.github.io`.
5. Publica esta carpeta en GitHub Pages, Netlify, Cloudflare Pages o tu propio HTTPS.
6. Abre la URL: la propia app te pedirá el Client ID y el enlace de tu Google Sheet en el mismo formulario la primera vez (ya no hace falta editar `config.js`). Se guarda en este dispositivo (localStorage).
7. Desde Android, con Chrome, usa **⋮ → Añadir a pantalla de inicio** para instalarla y poder abrirla como una app.

No publiques un `client_secret`: para esta aplicación web solo necesitas el Client ID.

### Inicio de sesión automático

La app intenta iniciar sesión en Google en silencio (sin ventanas ni clics) cada vez que se abre, usando la sesión que ya tengas en el navegador. Si Google no puede confirmarlo en silencio (primera vez, sesión caducada más allá de una hora o permiso revocado), pedirá el consentimiento una vez. Esto es una limitación del propio sistema de login de Google en apps instaladas, no algo que se pueda eliminar del todo.

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
