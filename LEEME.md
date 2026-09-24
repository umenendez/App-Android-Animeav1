# AnimeAV1 Tracker — versión Android (PWA)

Es la misma app que la extensión de Chrome, pero como aplicación web
instalable ("PWA") para que puedas ponerla en la pantalla de inicio de tu
móvil Android y usarla como una app normal. Incluye **todas** las
herramientas de la extensión:

- Listado con portadas en formato póster, filtros (estado/género), orden por nota.
- Edición directa de Nota, Estado y Género desde cada tarjeta, con los mismos colores.
- "Buscar portadas que faltan" (columna J).
- "Migrar enlaces de AnimeFLV a AnimeAV1".
- Registrar un anime nuevo (equivalente al script que se disparaba solo al
  abrir un episodio en el ordenador) — en el móvil se hace compartiendo el
  enlace desde Chrome, o pegándolo a mano con el botón "＋".

## 1. Por qué hacen falta algunos pasos extra

Una extensión de escritorio tiene permisos especiales (`host_permissions`)
que le dejan leer cualquier página web sin restricciones y disparar código
en cuanto visitas una URL. **Un navegador de Android no da esos permisos a
una página web normal**, así que:

- La lectura/edición de tu Google Sheet funciona igual de bien (la API de
  Google sí permite llamadas desde el navegador).
- Para leer páginas de animeav1.com/animeflv.net (portadas, migración,
  registro) hace falta un pequeño proxy — 2 minutos de configuración, ver
  paso 4. Es gratis y solo tú lo usas.
- En vez de dispararse solo al abrir un capítulo, aquí registras un anime
  compartiendo el enlace desde Chrome hacia la app (o pegándolo a mano).

## 2. Alojar la app (necesario para que el login de Google funcione)

Google no permite iniciar sesión desde una página abierta como archivo local
(`file://`), necesita una URL real con HTTPS. La forma más simple y gratuita:

1. Sube esta carpeta (`android-app`) a un repositorio de GitHub.
2. En el repositorio: Settings → Pages → Deploy from branch → selecciona la
   rama y la carpeta → Guardar.
3. En un par de minutos tendrás una URL tipo
   `https://tu-usuario.github.io/tu-repo/`.

(Netlify o Vercel funcionan igual de bien si ya los usas.)

## 3. Crear el ID de cliente OAuth de Google y ponerlo en el código

Es el mismo tipo de credencial que ya usaste para la extensión, pero
"Aplicación web" en vez de "Extensión de Chrome". Se pega **una vez en el
código**, igual que el `key` del `manifest.json` de la extensión — así,
igual que en la extensión, la persona que use la app después no tiene que
rellenar nada aparte de su cuenta de Google y el enlace de su Sheet.

1. Ve a https://console.cloud.google.com/apis/credentials (mismo proyecto
   donde tengas habilitada la Google Sheets API).
2. "Crear credenciales" → "ID de cliente de OAuth" → tipo **Aplicación web**.
3. En "Orígenes de JavaScript autorizados" añade la URL del paso 2, por
   ejemplo `https://tu-usuario.github.io`.
4. Guarda y copia el "ID de cliente" (acaba en `.apps.googleusercontent.com`).
5. Abre `app.js`, busca la línea:
   ```js
   const CLIENT_ID = "TU_CLIENT_ID.apps.googleusercontent.com";
   ```
   y sustituye el valor por el ID de cliente que acabas de copiar. Sube el
   cambio a tu repositorio de GitHub (es el mismo paso que "pásale la carpeta
   con la `key`" en la extensión: el ID de cliente no es secreto, solo
   identifica la app, y Google ya lo restringe al origen que autorizaste
   arriba).

## 4. Proxy CORS + login persistente (Cloudflare Worker)

Tienes el código ya escrito en `proxy-cloudflare-worker.js`. Este Worker hace
dos cosas: sirve de proxy para leer animeav1.com/animeflv.net, **y** ahora
también mantiene tu sesión de Google iniciada de verdad (con refresh token),
en vez de pedirte reconectar cada hora.

1. Crea cuenta gratis en https://workers.cloudflare.com
2. "Create application" → "Create Worker" → pega el contenido de
   `proxy-cloudflare-worker.js` → "Deploy".
3. Copia la URL que te da Cloudflare (ej. `https://xxxx.workers.dev`).
4. En Google Cloud Console, abre el mismo Client ID "Aplicación web" que
   creaste en el paso 3, y copia también el **Client secret** (antes solo
   hacía falta el Client ID; ahora el Worker también necesita el secret,
   pero solo él — nunca va en la app ni en el navegador).
5. Configura esos dos datos en el Worker como *secrets* (Settings →
   Variables and Secrets → Add, marcando "Encrypt"; o por CLI):
   ```
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```
6. En la app, en Ajustes → "Proxy CORS", pon `https://xxxx.workers.dev/?url=`
   (con el `?url=` al final, tal cual).

Si no configuras los secrets del paso 5, el proxy de scraping (portadas,
migración, registro) sigue funcionando igual; solo no tendrás login
persistente y la app te pedirá reconectar cada hora, como antes.

**La primera vez** que conectes tras configurar esto, entra en
https://myaccount.google.com/permissions y quita el acceso previo de esta
app si ya la habías autorizado antes (así Google te da un refresh token
nuevo; si no, a veces solo lo entrega la primerísima vez que autorizas).



## 5. Instalar en el móvil

1. Abre la URL del paso 2 en Chrome de tu Android.
2. Menú (⋮) → "Añadir a pantalla de inicio" / "Instalar aplicación".
3. Ábrela como una app normal desde el icono.
4. Verás la pantalla "Conecta tu Google Sheet": pega el enlace de tu hoja
   (la misma que usarías en la extensión) y pulsa "Conectar y empezar". Se
   te pedirá iniciar sesión con Google y, a la vez, se comprobará el acceso
   a la hoja — igual que en la extensión, no hace falta nada más. Si la hoja
   está vacía, se crean los encabezados de la fila 1 automáticamente.
5. El proxy del paso 4 (opcional, solo para "Buscar portadas" y "Migrar
   AnimeFLV") se configura aparte, en ⚙️ Ajustes → "Proxy CORS".

## 6. Registrar animes desde el móvil

**Opción A — compartir (recomendada):** en Chrome, mientras ves la ficha de
un anime en animeav1.com, pulsa "Compartir" y elige "AnimeAV1 Tracker". La
app se abre, lee la ficha a través del proxy y la añade a tu hoja (o la
marca como "viendo" si ya estaba, o te pregunta si es una temporada
relacionada — igual que hacía la notificación de la extensión, pero como
diálogo dentro de la app).

**Opción B — manual:** botón "＋" flotante → pega el enlace de la ficha →
"Registrar".

## Diferencias respecto a la extensión de escritorio

- El aviso de "¿misma serie?" era una notificación del sistema con botones;
  aquí es un diálogo dentro de la app (mismo resultado, dos opciones).
- No hay disparo automático al abrir un episodio sin que tú hagas nada;
  Android no deja que una web se entere de lo que navegas en otra pestaña.
  Compartir el enlace (Opción A) es el equivalente más cercano y tarda lo
  mismo que sacar el móvil del bolsillo.
- Para usar la app día a día, tú (o quien la use) solo necesita su cuenta de
  Google y el enlace de su Sheet — igual que en la extensión. El ID de
  cliente OAuth se pega una sola vez en `app.js` al desplegar (paso 3), no
  se pide en la app.
- La sesión de Google dura aproximadamently 1 hora (así funciona el tipo de
  login seguro que usa esta app, sin servidor propio). Mientras esa hora no
  haya pasado, reabrir la app no te pedirá volver a iniciar sesión. Pasada
  la hora, si sigues con la cuenta iniciada en el navegador, la app
  intentará reconectar sola sin preguntarte nada; si no puede, verás la
  pantalla de "Conectar con Google" con un toque.
