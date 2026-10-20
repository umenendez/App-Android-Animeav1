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
- Se abre al instante con la última lista guardada y se actualiza en segundo plano.
- Listas locales sin Google Sheets: se guardan en el dispositivo, se pueden crear vacías o importar desde un `.json`, exportar a `.json` (mismo formato que la extensión), añadir series a mano y eliminarlas. No necesitan Client ID ni sesión de Google.
- Cada lista tiene su propio catálogo de géneros.
- Panel de Opciones personalizable: tema, número de columnas, tamaño y separación de las cards, y qué se muestra en ellas (nota, estado, género y el botón ⏭ «Siguiente capítulo»). Se guarda en el dispositivo.
- Vista en lista (Opciones > Vista) y filtro «Pendientes» (series en «Viendo» con capítulos publicados que aún no has visto).
- Logo de la cabecera personalizable (Opciones > Logo e icono) importando una imagen. El icono de la pantalla de inicio lo fija Android al instalar y no se puede cambiar desde la app.
- Compartir desde Android: en un capítulo de animeav1.com, Compartir → AnimeAV1 Tracker lo registra (serie nueva o «Viendo» + último capítulo). Requiere la PWA instalada; si no aparece en la lista de Compartir, desinstálala y vuelve a instalarla.
- Otras páginas fuente (beta): las recetas se crean en la extensión («Copiar páginas fuente para la PWA») y se pegan en Opciones > Otras páginas fuente. Luego Compartir o el «+» registran series de esas webs en la lista asignada. Solo webs cuyo título sale en el HTML (no las que se dibujan con JavaScript), y el Worker debe poder leerlas.
- Botón ⏭ «Siguiente capítulo» en las series en «Viendo»: abre el capítulo siguiente y lo guarda como último visto.
- Añadir anime por enlace, con aviso "¿Es la misma serie?" si parece otra temporada de una ya registrada.

## Listas en la nube (Cloudflare D1)

Además de Google Sheets y las listas locales, puedes guardar una lista en tu propia base de datos
de Cloudflare: se sincroniza entre dispositivos, funciona sin conexión y se puede compartir.

**Puesta en marcha (una vez):**
1. Cloudflare > Storage & Databases > D1 > crear una base y ejecutar `schema.sql` en su consola.
2. En el Worker: Settings > Bindings > añadir la base D1 con el nombre de variable **`DB`**.
3. En el Worker: secrets `GOOGLE_CLIENT_ID` (el mismo de la PWA) y `SESSION_SECRET` (una cadena larga
   y aleatoria inventada por ti). Pega `worker-completo.js` y pulsa Deploy.
4. Opcional: variable `ORIGENES_PERMITIDOS` con los orígenes que pueden usar la API, separados por
   comas (**sustituye** al valor por defecto, que es solo `https://umenendez.github.io`).
5. Para que cualquier cuenta de Google pueda entrar, el proyecto de Google Cloud debe estar en
   «In production» (para este login solo se piden los permisos básicos; no requiere verificación).
6. Comprobación: `https://TU-WORKER.workers.dev/api/yo` debe responder «Sesión no válida o caducada».

**Uso:** Tus listas > Listas en la nube > iniciar sesión. Para subir una lista que ya tienes, usa
**«A la nube»** (copia). Para usarla en otro dispositivo, inicia sesión allí y pulsa «Añadir a este dispositivo».

## Qué no puede hacer una PWA

El `content.js` de la extensión detectaba automáticamente cuando abrías un episodio de `animeav1.com`. Una PWA normal no puede inyectarse en otras páginas de Chrome, por lo que esa detección automática no está incluida en la versión PWA.

La extensión original puede seguir instalada en el PC para conservar esa función.
