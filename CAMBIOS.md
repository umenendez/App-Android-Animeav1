# CAMBIOS

Registro de cambios de **AnimeAV1 Tracker**. Este archivo es idéntico en las dos
carpetas (`chrome-extension_AnimeAV1-tracker/` y `android-app_AnimeAV1-tracker/`):
cualquier cambio de comportamiento se anota aquí una sola vez y se copia a las dos.
Cuando una mejora es solo de una plataforma, se indica con **[ext]** o **[PWA]**.

## 1.27.1

### Página pública con el diseño de la app y listas en ventanas estrechas [ext + PWA + Worker]

- **Página pública del enlace:** ahora usa el mismo diseño que la app: cabecera con el logo, chips de estado con su punto de
  color y contador, tarjetas teñidas según el estado, portada con la franja de color, nota con el degradado rojo → verde,
  estado y géneros en cajitas como en la app, y la misma rejilla (3, 4, 5 o 6 columnas según el ancho). Sigue el modo
  claro/oscuro del dispositivo. Añade filtro por género y el orden por nota «mayor a menor» / «menor a mayor».
  Si una portada no carga, se muestra «Sin portada».
- **Panel «Tus listas» en ventanas estrechas:** cada fila se organiza ahora en dos bloques (nombre con sus etiquetas, y
  botones a la derecha) y se recoloca sola cuando falta sitio, en vez de dejar el engranaje o «Quitar» sueltos. Los nombres
  y los correos ya no se cortan con «…»: se parten en varias líneas. Los formularios de «Compartir» y «Enlace público»
  se adaptan al ancho. Se acabó el desbordamiento horizontal.
- **PWA:** la página ya no tiene un ancho mínimo de 320 px y la cabecera con los iconos baja a una segunda fila si no caben.
- **Worker:** hay que volver a pegar `worker-completo.js` y pulsar Deploy (solo cambia la página pública).
- Extensión `1.27.1`; caché de la PWA `v49`.

## 1.27.0

### Enlace público de solo lectura [ext + PWA + Worker]

- **Qué hace:** desde una lista de la nube tuya puedes generar un enlace que cualquiera abre en el navegador, **sin cuenta
  y sin instalar nada**, para enseñarle tu lista. El Worker sirve una página con las series (buscador, filtro por estado,
  orden por nombre o nota, y modo claro/oscuro según el dispositivo). Se puede revocar cuando quieras.
- **Cómo se usa:** «Tus listas» > ⚙ de la lista de la nube > **🌐 Enlace público** > **Crear enlace público**. Debajo salen
  el enlace y los botones **Copiar**, **Enviar…** (si el dispositivo lo admite), **Abrir**, **Renovar** y **Desactivar**.
  Solo el propietario de la lista ve este botón.
- **Revocar y renovar:** **Desactivar** borra el enlace y deja de funcionar al instante (la página no se guarda en caché).
  **Renovar** crea un código nuevo y el anterior deja de valer, útil si el enlace se ha compartido donde no debía.
  Una lista tiene como mucho un enlace. Al borrar la lista se borra también su enlace.
- **Qué se ve:** título, portada, nota, estado, géneros y enlace de cada serie. No se ve el último capítulo visto, ni con quién
  más compartes la lista, ni tu email. Las series borradas no salen. La página no se puede editar ni da acceso a la API.
- **Seguridad:** el código tiene 192 bits aleatorios (no se puede adivinar), la página lleva `noindex` (los buscadores no
  la indexan) y una política CSP estricta, y todo el texto de la lista se escapa antes de pintarse.
  Las portadas de Manwhaweb se sirven a través del proxy del propio Worker.
- **Worker:** hay que volver a pegar `worker-completo.js` y pulsar Deploy. **No hace falta ningún paso en D1**: la tabla
  `enlaces_publicos` se crea sola la primera vez que se usa. Rutas nuevas: `GET/POST/DELETE /api/listas/:id/enlace`
  (propietario) y `GET /v/<código>` (público). El `worker-completo.js` de la extensión se sincroniza con el de la PWA
  (incluye la consulta de menos de 1.25.0, que la copia de la extensión aún no tenía).
- Extensión `1.27.0`; caché de la PWA `v48`.

## 1.26.0

### Avisos de capítulos nuevos [ext + PWA]

- **Nuevo ajuste «Avisos de capítulos nuevos»** (Opciones, desactivado por defecto).
- **Extensión:** cada 3 horas (y al activarlo) se mira la ficha de cada serie en «Viendo». Si hay capítulos publicados
  que no has visto, sale **una notificación** (agrupada si son varias series; al pulsarla se abre el capítulo siguiente)
  y el icono muestra **el número de series pendientes**. El contador baja solo al registrar un capítulo y el «!» rojo de
  un registro fallido tiene prioridad sobre él. Solo se avisa una vez por capítulo nuevo; al activar el ajuste o cambiar
  de lista se rellena el contador sin notificar lo que ya estaba pendiente. Sin conexión no se toca nada.
- **PWA:** al abrir la app se actualiza el contador (en el icono de la app, donde Android lo admita, y sobre el botón ⏭).
  Avisos con la app cerrada exigirían notificaciones push y una tarea programada en el Worker: no incluido.
- «Restablecer apariencia» no desactiva los avisos.
- Extensión `1.26.0`; caché de la PWA `v47`.

## 1.25.0

### Sincronización más rápida [ext + PWA]

- **La lista de la nube se abre al instante.** Antes esperaba a que terminara la sincronización con la nube (hasta 8 s
  si la conexión era mala) antes de enseñar nada. Ahora se muestra enseguida lo guardado en el dispositivo, la
  sincronización corre en segundo plano y la lista solo se repinta si llegó algo nuevo.
- **Vínculo hoja ↔ nube: de decenas de peticiones a 4.** Los cambios se escribían en la hoja serie a serie (varias
  peticiones a Google por cada una; 33 cambios eran 40 peticiones, ~10-15 s). Ahora se envían en lote: 4 peticiones
  fijas sea cual sea el número de cambios. Además la nube y la hoja se leen a la vez, la nube no se vuelve a
  sincronizar si acaba de hacerse al abrir la lista, y tras sincronizar la pantalla se repinta sin volver a la red.
  Si a la pestaña le faltan filas para añadir series, se amplía sola.
- **Cambios de otros dispositivos sin recargar.** Con una lista de la nube abierta se comprueba al volver a la
  ventana y cada 30 s mientras está a la vista (no interrumpe si estás escribiendo o moviendo series).
- **Tus cambios salen antes:** se envían 0,5 s después de editar (antes 1,5 s) y, en la PWA, al salir o ocultar la app.
- **Tiempo máximo de 15 s por petición al Worker.** Una petición colgada ya no bloquea la sincronización de esa lista.
- **Worker:** una consulta menos a la base de datos en cada petición (comprobar el acceso a la lista). Opcional:
  para aprovecharlo, vuelve a pegar `worker-completo.js` y pulsa Deploy.
- Extensión `1.25.0`; caché de la PWA `v46`.

## 1.24.0

### Corrección: lista de la nube borrada desde otro dispositivo [ext + PWA]

- Si una lista de la nube estaba añadida en dos dispositivos y la borrabas desde uno, en el otro «Quitar» fallaba
  con «Lista no encontrada» y no había forma de quitarla. Ahora, si la lista ya no existe en la nube, el borrado
  se da por hecho y se quita del dispositivo; y al abrirla aparece el aviso «Esta lista ya no existe en la nube»
  con el botón «Quitar de este dispositivo». Ya no se reintenta enviar cambios de una lista que no existe.

### Vincular una hoja de Google con una lista de la nube [ext + PWA]

- **Qué hace:** mantiene iguales, en los dos sentidos, una hoja de Google Sheets y una lista de la nube. Así la
  lista de la nube se usa en cualquier dispositivo sin iniciar sesión en Google Sheets, y la hoja se puede seguir
  editando directamente en el documento: lo que cambies allí llega a la nube, y lo que cambies en la nube llega a la hoja.
- **Cómo se usa:** en «Tus listas», menú ⚙ de la hoja o de la lista de la nube > **🔗 Vincular…** y eliges la
  pareja. También al usar **«A la nube»** en una hoja se ofrece dejar la copia vinculada. Una vez vinculadas
  aparece la etiqueta 🔗 con el nombre de la otra, y en el ⚙ **🔗 Sincronizar** (ahora) y **Desvincular**.
- **Cuándo se sincroniza:** al abrir cualquiera de las dos listas en un dispositivo que tenga sesión de Google
  Sheets, en segundo plano y sin ventanas. En los dispositivos sin acceso a la hoja, la lista de la nube
  funciona igual y su contenido llega a la hoja la próxima vez que un dispositivo con acceso la sincronice.
  En la PWA, la sesión de la hoja se renueva sola mientras la usas, también con la lista de la nube abierta.
- **Reglas:** cada serie se identifica por su enlace (o por su título si no tiene). Si solo cambia un lado, el cambio
  pasa al otro; si cambian los dos a la vez, gana la hoja. Una serie que solo está en un lado se añade al otro; si
  la borras en un lado, se borra en el otro. La primera vez, las series que falten en una se añaden a la otra.
- **Seguros:** si una sincronización fuese a borrar de golpe una parte grande de la lista (por ejemplo, la hoja aparece
  vacía por un error), se detiene y avisa sin tocar nada. Si falla la escritura de alguna serie, se reintenta en la
  siguiente sincronización. Cada lista solo puede estar vinculada con otra; una lista de la nube de solo lectura no se
  puede vincular.
- Extensión `1.24.0`; caché de la PWA `v45`.

## 1.23.0

### Registrar al terminar de ver y proponer «Visto» al acabar una serie

- **Cuándo se registra un capítulo [ext]:** nuevo ajuste en Opciones > Registro de capítulos.
  «Al abrir el capítulo» (como hasta ahora) o «Al terminar de verlo»: se guarda como último visto cuando
  llegas al 80 % del vídeo. Si el reproductor está en otro dominio y la extensión no puede medirlo, cuenta tras
  15 minutos con la pestaña visible. Si cambias de capítulo o cierras antes de llegar, no se registra. Vale
  también para las otras páginas fuente (beta). Por defecto sigue siendo «al abrir».
- **Cambio de capítulo sin recargar [ext]:** animeav1.com es una web de una sola página; ahora la extensión detecta
  el paso de un capítulo al siguiente aunque no se recargue la página (antes solo registraba al cargarla).
- **Estado «Visto» automático (propuesta) [ext + PWA]:**
  - En animeav1.com, al terminar de ver el último capítulo publicado de una serie que la ficha marca como
    terminada y que está en «Viendo», aparece una tarjeta: «¿La marcas como Visto?» (Sí / Ahora no). «Ahora no»
    se recuerda para ese capítulo; la X o Esc lo vuelven a preguntar la próxima vez.
  - En las cards (extensión y PWA), las series en «Viendo» con el último capítulo publicado visto y la serie
    terminada muestran el botón «✔ Terminada: marcar como Visto».
  - Solo se propone si la ficha indica claramente que la serie ha terminado; si no se sabe, no se propone nada.
    El texto que se busca está en `estadoEmisionDeHtml` (`background.js` y `pwa-api.js`).
- Extensión `1.23.0`; caché de la PWA `v44`. Archivo nuevo en la extensión: `visto.js`.

## 1.22.0

### Listas en la nube en la extensión de Chrome **[ext]**

La extensión ya tiene el mismo tipo de lista que la PWA (1.21.0): se guarda en tu cuenta, se ve en
la extensión y en la PWA a la vez y se puede compartir con otras cuentas de Google.

- **Tus listas > Listas en la nube:** iniciar sesión, crear una lista vacía, ver tus listas de la
  nube y añadirlas a este dispositivo. En cada lista de Sheets o local aparece **«A la nube»** (sube
  una copia; la original no se toca) y en las tuyas de la nube **«Compartir»** por email (edición o
  solo lectura). «Quitar» la saca solo de este dispositivo; si eres el propietario puedes además
  borrarla de la nube. Una lista compartida como solo lectura no se puede editar.
- **Sincronización:** igual que en la PWA (mismo formato y mismas reglas: gana el cambio más reciente,
  los borrados llegan a los demás dispositivos). Cada cambio se envía a los ~1,5 s y al abrir la lista
  se descarga lo nuevo. Sin conexión todo se guarda en la extensión y se reintenta cada minuto
  (alarma de Chrome) y al arrancar el navegador. Las series que abres en animeav1.com se registran
  igual en una lista de la nube, y el símbolo «Viendo» de la portada sigue a esa lista.
- **Login:** botón «Continuar con Google» (ventana de Google, solo identificación: sin permisos
  sobre Drive ni Sheets). El Worker lo canjea por su propia sesión de 60 días. El Sheets sigue
  usando su inicio de sesión de siempre.
- **Menú de engranaje por lista** (también en la extensión): cada fila muestra nombre, etiquetas,
  «Usar», «Borrar/Quitar» y ⚙, que despliega Subir, Bajar, Nombre, Fijar, A la nube/Compartir y Exportar.
- **Puesta en marcha (una sola vez):**
  1. Vuelve a pegar `worker-completo.js` en el Worker y pulsa Deploy: ahora admite por defecto el
     origen de la extensión (`chrome-extension://cmlaaboekekgplbjbocbjmplnnmjjjpa`). Si usas la
     variable `ORIGENES_PERMITIDOS`, añádelo a la lista.
  2. En Google Cloud Console > Credenciales > tu cliente OAuth de tipo **Aplicación web** (el mismo
     que usa el Worker como `GOOGLE_CLIENT_ID`) > «URIs de redireccionamiento autorizados», añade
     `https://cmlaaboekekgplbjbocbjmplnnmjjjpa.chromiumapp.org/`. (La propia extensión muestra esta
     dirección en «¿Google da un error al iniciar sesión?».)
  3. Recarga la extensión en `chrome://extensions`: añade el permiso «alarms» y el acceso al Worker.
- Si cambias de Worker o de cliente OAuth, se editan las constantes `NUBE_WORKER_URL` y
  `NUBE_CLIENT_ID` al principio de `background.js`.
- Versión `1.22.0`.

## 1.21.1

### Tus listas: menú de engranaje y botón de Google integrado **[PWA]**

- **Engranaje por lista:** cada fila de «Tus listas» muestra ahora solo el nombre, las etiquetas,
  «Usar», «Borrar/Quitar» y un icono de engranaje ⚙. Al pulsarlo se despliegan Subir, Bajar,
  Nombre, Fijar, A la nube (o Compartir en tus listas de la nube) y Exportar. Ya no se salen
  botones por la derecha de la pantalla. El menú se queda abierto al subir/bajar una lista.
- **Botón de inicio de sesión de Google** (Listas en la nube): sustituye al botón blanco estándar
  por uno con el estilo de la app (tema claro/oscuro, mismos bordes y colores). Por debajo sigue
  siendo el inicio de sesión oficial de Google, así que no cambia nada en el Worker.
- Caché de la PWA `v43`.

## 1.21.0

### Listas en la nube (Cloudflare D1) **[PWA]**

Un tercer tipo de lista, además de Google Sheets y las locales (.json): se guarda en tu cuenta,
se ve en todos tus dispositivos y se puede compartir con otras cuentas de Google.

- **Cómo funciona:** es una lista local (funciona sin conexión) con una capa de sincronización.
  Cada cambio se envía al Worker a los ~1,5 s; al abrir la lista se descarga lo nuevo. Si dos
  dispositivos tocan la misma serie gana el cambio más reciente. Los borrados también llegan a
  los demás dispositivos. Sin conexión todo se guarda en el dispositivo y se envía al volver internet.
- **Login:** botón «Iniciar sesión con Google» (solo identificación, sin permisos sobre Drive ni
  Sheets). El Worker valida el token de Google y entrega su propia sesión, que dura 60 días, así
  que no hay que volver a entrar cada hora. El permiso de Sheets sigue siendo independiente.
- **Tus listas > Listas en la nube:** iniciar sesión, crear una lista vacía, ver tus listas de la
  nube y añadirlas a este dispositivo. En cada lista de Sheets o local aparece **«A la nube»**
  (sube una copia; la original no se toca). En las tuyas de la nube, **«Compartir»** por email con
  permiso de edición o solo lectura (quitar acceso cuando quieras).
- **Quitar una lista de la nube:** «Quitar» solo la saca de este dispositivo; si eres el
  propietario puedes además borrarla de la nube para todos (aviso aparte, no se puede deshacer).
- Una lista compartida contigo como **solo lectura** no se puede editar desde este dispositivo;
  si el propietario cambia tus permisos, se actualizan solos al abrir la lista.
- Exportar a .json funciona también con las listas de la nube (no se exportan los datos internos
  de sincronización).
- **Worker (`worker-completo.js`):** nuevas rutas `/api/...` con su propio CORS restringido
  (variable `ORIGENES_PERMITIDOS`; por defecto solo `https://umenendez.github.io`). Requiere un
  binding D1 llamado `DB` (esquema en `schema.sql`) y los secrets `GOOGLE_CLIENT_ID` y
  `SESSION_SECRET`. Lo anterior (proxy de scraping, portadas y login de Sheets) no cambia.
- **Portadas de Manwhaweb:** arreglado el bloqueo anti-hotlink (Cloudflare) pidiendo la imagen a
  través del Worker con el `Referer` correcto. Sustituye a la limitación indicada en 1.20.2:
  se configura con `mwProxy` en `config.js` (la URL base del Worker).
- Los géneros del catálogo siguen guardándose por dispositivo (se reconstruyen con las series).
- Caché de la PWA `v42`.

## 1.20.2

### Portadas de otras webs y pegado de páginas fuente en la PWA **[PWA]**

- Las portadas leídas de otras webs que vienen con `http://` se pasan a `https://`: la PWA
  (https) bloquea las imágenes `http` y salían sin portada. También se corrige al pintar las
  que ya estaban guardadas así en la lista.
- Nuevo botón **«Pegar del portapapeles»** en Opciones > Otras páginas fuente: lee lo copiado
  en la extensión («Copiar páginas fuente para la PWA») e importa de una vez. El cuadro de
  texto y «Pegar páginas fuente» siguen ahí por si el navegador no deja leer el portapapeles.
- Caché de la PWA `v37`. Si la app instalada no muestra la sección, hay que subir esta versión
  a GitHub Pages y abrir la app con conexión (el Service Worker se actualiza solo).
- **Limitación:** una PWA no puede poner el `Referer` a una imagen (no existe «Permitir
  imágenes» como en la extensión). Se piden sin `Referer`; si el servidor de portadas exige el
  de su web, esa portada no carga en la PWA (se puede pegar otra URL a mano en el modo edición).

## 1.6.2

### El separador de empates ya no se bloquea: se permiten notas repetidas

**El error.** Al separar las series que comparten nota, el reparto buscaba hueco
libre entre las series vecinas, dejando **fuera** la décima pegada a cada una. Si
el empate estaba encajonado entre dos vecinas contiguas, el hueco era de una sola
décima y no cabía nada: el separador terminaba siempre en «Sin cambios de nota —
Entre las notas vecinas no queda ninguna décima libre, así que no se puede
separar sin tocar otras series».

Con tus datos, por ejemplo, un grupo de 8.0 entre una serie de 7.9 y otra de 8.1:

| escalones | antes | ahora |
|---|---|---|
| 3 | 8.0, 8.0, 8.0 (sin cambios) | 8.1, 8.0, 7.9 |
| 5 | 8.0, 8.0, 8.0, 8.0, 8.0 (sin cambios) | 8.1, 8.1, 8.0, 8.0, 7.9 |
| 9 | 9 veces 8.0 (sin cambios) | 8.1 ×3, 8.0 ×3, 7.9 ×3 |

**La causa era una confusión entre repetir y cruzar.** El reparto trataba la nota
de la vecina como un muro que no se podía tocar. Pero compartir nota con una
serie vecina no contradice el orden que la hoja ya respeta: solo lo contradice
**pasarse**. Repetir es justo lo que hace este separador por definición (para eso
existe, para desempatar usando empates).

**El arreglo.** El hueco libre va ahora de la nota de la vecina inferior a la de
la superior, **ambas incluidas**. Cruzarlas sigue siendo imposible;encerlas no.
Como la nota original siempre queda dentro del hueco, con dos o más escalones
siempre hay algún cambio, así que la pantalla «Sin cambios de nota» ya no
significa «no se puede separar», sino solo «has dicho que todas te gustan igual».

**Lo que no cambia:** el orden interno de tus comparaciones se respeta siempre,
las notas siguen con una sola decimal dentro de 0.1-10, y ninguna serie de fuera
del grupo baja o sube de sitio.

Comprobado simulando 36 711 listas reales y repartos de 1 a 12 escalones: **cero
fallos** en los cuatro invariantes (orden interno, no cruzar a las vecinas,
escala 0.1-10, y cambio siempre presente con 2+ escalones). El caso «Sin cambios»
pasaba en 60 de 60 000 repartos sintéticos del código anterior y en **0** ahora.

Los textos de las pantallas se ajustan: el aviso de hueco comprimido explica que
compartir nota está permitido y cruzar no, y el resumen de éxito dice que las
notas pueden coincidir con las de otras series sin cruzarlas.

## 1.6.1

Cinco correcciones: cuatro de la lista, el buscador y las notas, más una fuga de
memoria que solo afectaba a la extensión. Ninguna cambia el funcionamiento del
posicionador ni el formato de los datos.

### Escribir en el buscador era lento (O(series × géneros))

`renderPanelGeneros()` contaba los géneros con un `filter` por género, es decir
O(series × géneros), y `render()` lo llama en cada tecla del buscador. Con 500
series y 40 géneros eran ~20 000 `parseGeneros` por pulsación.

Ahora hay `contarGeneros()`, que recorre la lista una sola vez y devuelve el
recuento de todos los géneros a la vez:

| series × géneros | antes | ahora | más rápido |
|---|---|---|---|
| 100 × 20 | 1,72 ms | 0,11 ms | 15,8× |
| 500 × 40 | 16,38 ms | 0,53 ms | 31,1× |
| 1000 × 60 | 52,79 ms | 1,07 ms | 49,5× |

Se comprobó que el recuento nuevo da **exactamente** el mismo número que el
antiguo, incluidos los géneros repetidos dentro de una misma serie y las series
sin género (0 discrepancias en 24 000 comparaciones).

Además `normalizar()` (el quitacentos y minúsculas de la búsqueda) ahora
memoiza su resultado por texto, así que escribir en el buscador no vuelve a
descomponer Unicode toda la lista en cada pulsación.

### Las series sin nota cambiaban de sitio según cómo ordenaras

Al ordenar por nota, una serie sin nota se leía como un **0**. Con «mayor a
menor» eso la dejaba al final, pero con «menor a mayor» la ponía **la primera**,
como si fuera la peor de todas, y además la mezclaba con una nota 0 real.

Una serie sin nota no está en la escala, así que ahora va **siempre al final** en
los dos sentidos, igual que ya hacía el selector del posicionador. De paso se
elimina una copia innecesaria de la lista (`lista.slice()` sobre un array que
acaba de crear `filter`).

### Las notas entre 0.1 y 0.4 desaparecían de las estadísticas

El gráfico de distribución de notas agrupaba por `Math.round(nota)`. Los valores
de 0.1 a 0.4 redondean a 0, y el cubo 0 no se pinta (porque 0 no es una nota
posible, desde 1.5.9), así que esas series desaparecían del gráfico. Con 10 series
valoradas por debajo de 0.5 el gráfico salía **vacío**, y el total pintado no
cuadraba nunca con «N valorados».

Esas notas ahora cuentan en el cubo 1, el más bajo que existe. El total pintado
vuelve a cuadrar siempre.

### `notaRedondeada()` podía devolver un 0 imposible

Su suelo era `Math.max(0, n)`, así que una nota de 0.04 (posible si la hoja trae
un valor raro) se redondeaba a 0, una nota que desde 1.5.9 significa «sin
valorar» y no debería escribirse nunca. El suelo ahora es 0.1.

Comprobado sobre 50 000 notas válidas: **cero diferencias** para cualquier valor
igual o mayor que 0.1. Solo cambian los valores por debajo de 0.05, que antes
producían un 0.

### Fuga de memoria en las portadas de la extensión **[ext]**

Cada portada de la lista se guarda como un `objectURL` en `portadaMem`. Esos
blobs nunca se revocaban, así que «Borrar portadas» liberaba la caché pero
dejaba todos los blobs retenidos, y una sesión larga (el posicionador va
precargando portadas) llegaba a acumular cientos.

Ahora `liberarPortadasMem()` revoca cada `objectURL` antes de vaciar el mapa, y
el mapa se acota a 200 entradas revocando las más antiguas. Las ya pintadas no se
rompen: una imagen `<img>` ya decodificada sigue funcionando aunque se revoque
su `objectURL`.

La PWA no tenía este problema: guarda URLs, no blobs, y delega los bytes en la
caché del navegador.

## 1.6.0

### El posicionador deja de saltarse al extremo de la escala

Este es el cambio de comportamiento más grande desde que existe el minijuego de
posicionamiento, así que conviene explicar bien qué pasaba.

**El problema.** Cuando la serie que estás posicionando quedaba **por encima de
todas** las ya valoradas (o por debajo de todas), el algoritmo no estimaba nada:
devolvía directamente un **10** o un **0.1**. Es decir, una sola comparación del
tipo «esta es mejor que la de 8.0» bastaba para decir que la serie era «la mejor
de todas». Con 100 series valoradas casi nunca se llegaba a ese caso, así que
pasaba desapercibido; pero con una lista corta, muy dispersa, o con muchas notas
iguales, era el resultado más frecuente.

**La solución.** Ahora se aplica en todos los casos la misma regla que ya se
usaba en el resto del posicionador: la serie se sitúa **en el centro del hueco
libre** que queda entre las dos notas vecinas. Si está por encima de todas, el
hueco va de la nota más alta a 10 y sale el punto medio de ese tramo; si está por
debajo de todas, el hueco va de 0.1 a la nota más baja. El extremo de la escala
solo se usa cuando de verdad no cabe nada más.

**Medido.** Simulé el algoritmo completo con las dos versiones, respondiendo en
cada partida como si el usuario acertara siempre, sobre listas sintéticas de
distintas formas (notas continuas, notas discretas, muy agrupadas, todas
iguales, todas altas, todas bajas):

| Tipo de lista | Error medio antes | Error medio ahora |
|---|---|---|
| 100 series, notas continuas | 0.01 | 0.01 |
| 20 series, notas continuas | 0.21 | 0.18 |
| 20 series, notas discretas | 0.40 | 0.38 |
| 20 series, agrupadas | 1.24 | 1.21 |
| Todas a 8.0 | 3.46 | 1.60 |
| Todas entre 8.5 y 10 | 3.33 | 1.77 |
| Todas entre 0.1 y 0.8 | 4.15 | 2.21 |

En los casos donde la búsqueda se queda sin referencias útiles (listas cortas o
muy concentradas) el error se reduce a menos de la mitad; en los casos densos no
cambia, porque ahí el hueco entre vecinas ya es de una décima y no había nada que
mejorar. Nunca empeora.

### Otros cambios en el posicionador

- **El resultado dice dónde encaja.** La pantalla final ahora muestra la vecina
  más próxima por encima y por debajo («Quedaría por encima de «Frieren» (8.0) y
  por debajo de «Vinland» (7.5)»). Antes solo decía el puesto, y para comprobar
  que el resultado era el esperado había que volver a comparar a mano.
- **La comparación recuerda la nota anterior.** Si la serie ya tenía nota, en la
  pantalla de comparación aparece junto a la estimación («Estimación: 7.8 ·
  antes 7.0»). Así se puede responder «igual que antes» sin tener que buscar una
  serie con la nota antigua.
- **El intervalo en vivo ya no enseña un 0.** La cabecera decía «Entre 0.0 y …»
  cuando no había ninguna serie por debajo, aunque desde la 1.5.9 el 0 está
  reservado para «sin valorar» y nunca puede ser el suelo de una nota.
- **Cuando no cabe ninguna décima, se repite la nota de abajo.** Antes se repetía
  la de la serie que el usuario acababa de decir que era *peor*, lo que
  contradecía la respuesta recién dada. Si ese lado no tiene ninguna serie
  valorada, se usa el extremo de la escala, que no genera ningún empate real.
- **Limpieza.** Se ha eliminado estado que se escribía y nunca se leía
  (`calcularPosicionFinal`, `gruposFinales`, `posicionFinal`,
  `finalizadoPorComparaciones`, `rated` y el `Map` `working`), y `elegirRivalPara`
  ya no copia el grupo entero en cada sondeo cuando no hay series saltadas.

## 1.5.9

### El 0 ya no es una nota: significa "sin valorar"

- **Una puntuación de 0 se muestra como «-».** Antes una serie con 0 en la hoja
  aparecía con un 0 rojo en la esquina de la portada, indistinguible de una
  valoración mínima real. Ahora el campo queda vacío y se ve el guion.
- **El 0 no cuenta como nota en ninguna estadística.** La nota media y la
  distribución lo trataban como si fuera una valoración, así que una hoja con
  muchas series sin valorar tenía la media arrastrada hacia cero. Ahora el
  «N valorados» de la media no las incluye y la casilla «0» de la distribución ya
  no se pinta, porque esa nota no existe.
- **Escribir un 0 a mano equivale a borrar la nota.** Si tecleas 0 en el campo de
  la tarjeta, se guarda como celda vacía en la hoja, que es lo que significa
  "sin valorar". El backend (`background.js` y `pwa-api.js`) también lo normaliza,
  así que un 0 enviado por cualquier otra vía no llega a escribirse en la hoja.
- **El mínimo de la escala es 0.1.** El posicionador, al decidir que una serie
  queda por debajo de todas las demás, laaba en 0 y se guardaba como si fuera
  "sin valorar" en lugar de como la peor nota posible. Ahora satura en 0.1, igual
  que ya hacía «Separar notas iguales» con su suelo.
- El campo pasa a `min="0.1"` y suayuda indica «Vacío o 0 = sin valorar».

Las notas que ya tuvieras a 0 en la hoja se muestran como «-» desde el primer
momento, sin necesidad de reescribirlas. Si quieres limpiarlas de la hoja,
edita la celda y déjala vacía una vez.

## 1.5.8

### Correcciones

- **"Separar notas iguales" ya no incluye series marcadas como "Sin ver".** La
  PWA heredaba la lista del posicionador, que no filtra por estado, así que una
  serie sin ver podía aparecer en un grupo de empates. Ahora ambas apps usan el
  mismo filtro (`seriesParaSeparar()`): se excluyen "Sin ver" y las que no tienen
  fila ni título. Siguen entrando el resto de estados (Visto, Viendo, Por ver,
  Dropeado…).
- **"Iniciar sesión con Google" funciona en la extensión.** El popup enviaba un
  mensaje `LOGIN` que `background.js` no atendía, así que el botón no hacía nada
  cuando la sesión había caducado. Ahora pide el token de forma interactiva, con
  el mismo contrato que el `case "LOGIN"` de la PWA.
- **El puesto final se cuenta sobre las notas ya redondeadas.** Antes se
  comparaba el valor sin redondear, así que con una nota como 8.04 la pantalla
  final podía indicar un puesto distinto del que corresponde a lo que se ve.
- **La nota estimada en vivo usa el mismo cálculo que la nota final.** Cuando no
  cabía ninguna décima entre las vecinas, se mostraba el punto medio redondeado y
  luego se guardaba otra cosa.

### Mantenimiento

- El repositorio incluye `check-paridad.py`, que compara los cuerpos de las
  funciones compartidas de los dos `popup.js` y avisa si divergen. Ejecuta
  `python3 check-paridad.py` antes de cerrar un cambio que toque la lógica del
  posicionador o del separador de empates.
- `sw.js` sube a `animeav1-pwa-v14` e incluye `register-sw.js` y `privacy.html`
  en la lista `CORE` para que también se puedan servir sin conexión.

## 1.5.7

### Posicionar serie y separar notas iguales (paridad con Android/PWA)

- **Nota estimada correcta al terminar:** si se salta todo y no hubo ninguna
  comparación, se conserva la nota actual de la serie (o 5.0 si no tenía). Antes
  acababa en 10.0.
- **Al guardar solo cambia la nota de esa serie.** Las notas de las referencias
  son anclas: ya no se reajustan para "fabricar" huecos en la escala. Si la nota
  nueva coincide con la de otras series, se avisa y se sugiere usar «Separar notas
  iguales».
- **Separar notas iguales ya no salta de escala:** el reparto de décimas se
  limita al hueco entre la nota vecina inferior y la superior. Antes buscaba un
  bloque libre global, así que una serie con 9.0 podía acabar con 2.x.
- **"Me gustan igual" se respeta:** las series marcadas como iguales comparten
  escalón y conservan la misma nota final.
- Si no caben todas las posiciones en el hueco, algunas series siguen empatadas
  (con aviso de cuántas décimas hay disponibles) en lugar de cancelar la
  operación.
- ~~Cuando no queda ninguna décima libre, se indica que no se puede separar sin
  tocar otras series.~~ **Corregido en 1.6.2**: ya no puede darse ese caso; el
  reparto puede compartir la nota de las vecinas.
- Los grupos se forman con la nota redondeada a una décima (antes una nota como
  8.04 se quedaba fuera del grupo).

## 1.5.6

- **Añadir por enlace reconoce serie y episodio:** vale tanto
  `https://animeav1.com/media/black-clover-2nd-season` como
  `https://animeav1.com/media/black-clover-2nd-season/1` (también con `www.`,
  sin `https://`, con `/` final, `?parámetros` o `#`). Siempre se guarda el
  enlace de la ficha de la serie y el título y la portada salen de ella. Si se
  pega un episodio, se guarda como último capítulo.
  - Si la serie ya está registrada: con un enlace de episodio se deja como
    "viendo" y se actualiza el último capítulo; con el enlace de la ficha avisa
    de que ya existe.
  - Si parece otra temporada de una registrada, pregunta "¿Es la misma serie?"
    (también en el popup de la extensión).
- **"¿Es la misma serie?"**: si el anime que pegas parece otra temporada/parte de
  uno ya registrado (2nd/3rd Season, Season 2, Temporada 2, Segunda Temporada,
  Part/Cour/Parte 2, Final Season, numerales romanos, subtítulos…), pregunta una
  sola vez mostrando la portada registrada. "Sí" marca la serie existente como
  viendo (y guarda el último capítulo si el enlace era de un episodio) y recuerda
  la respuesta; "No" la registra como serie aparte.

## 1.5.5

- **Lista principal con portadas rápidas:** usa el mismo sistema que el
  posicionador (caché local → memoria → imagen), sin la doble descarga de antes.
  Al volver a filtrar u ordenar, las portadas ya vistas aparecen al instante.
  En la PWA se predecodifican antes de pintarse.
- **El popup / la app se abren al instante:** muestran la última lista guardada
  mientras se actualiza desde Google Sheets en segundo plano (aviso
  "Actualizando…"). Si no hay conexión o la sesión caducó, sigue mostrando la
  lista guardada con un aviso y botón "Reintentar" (o "Iniciar sesión" si lo que
  caducó fue la sesión).
- Mientras se actualiza, los cambios por fila se pausan unos instantes para no
  escribir en una fila equivocada si la hoja había cambiado.
- La precarga de portadas guarda copias legibles (no opacas) cuando el dominio
  lo permite.

## 1.5.4

### Posicionar serie y separar notas iguales

- **Portadas mucho más rápidas:** se leen de la caché local (antes solo servía de
  marcador y cada portada se pedía a la red dos veces), con esqueleto animado
  mientras llegan y fundido al aparecer. Las portadas de las siguientes
  comparaciones se precargan mientras decides la actual.
- La cuadrícula de series solo carga las portadas que están a la vista, con un
  máximo de descargas simultáneas.
- **Nota estimada en vivo:** antes se quedaba fija; ahora se actualiza con cada
  respuesta, muestra el rango ("entre 8.0 y 9.0"), las comparaciones que quedan
  aproximadamente y una barra de progreso.
- **Comparación más clara:** las portadas son clicables, los botones dicen
  "Prefiero «serie»" en lugar de un ambiguo "Me gusta más", y hay atajos de
  teclado (← → elegir, = igual, Z deshacer, S saltar).
- **Deshacer** la última respuesta (también tras saltar una serie) y "Corregir
  última respuesta" desde la pantalla final; también en "Separar notas iguales".
- Se prefiere comparar contra series que tienen portada.
- Pantalla final con el puesto resultante ("puesto 12 de 87") y botón "Guardar y
  posicionar otra".
- Selector: Enter en el buscador abre la primera serie, el buscador tiene un
  pequeño retardo para no repintar en cada tecla, contador de series,
  transiciones suaves entre pantallas y un único scroll (el de la cuadrícula).

## 1.5.3

- Al abrir un episodio de una serie relacionada con otra ya registrada (otra
  temporada, parte, arco…), la extensión pregunta una sola vez, dentro de la
  propia página, si es la misma serie.
  - "Sí": marca la serie existente como viendo, actualiza el último capítulo y
    recuerda la respuesta para esa temporada (no vuelve a preguntar).
  - "No": registra la temporada como una serie nueva.
- Reconoce más nomenclaturas: 2nd/3rd Season, Season 2, Temporada 2, Segunda
  Temporada, Part/Cour/Parte 2, Final Season, numerales romanos (II, III, IV…),
  números finales, subtítulos tras ":" o " - " y arcos ("… New World", "…-hen").
- El aviso "¿Es la misma serie?" muestra en grande la portada registrada de cada
  serie candidata (la original, no la de la temporada nueva).
- Corregido: abrir un episodio nunca llegaba a la comprobación de series
  relacionadas (el aviso se confundía con "añadir por enlace" del popup).
- Corregido: el aviso ya no depende de las notificaciones del sistema ni de que
  el service worker siga activo.

## 1.4.4

- Menú de Opciones renovado, con diseño más visual e intuitivo.
- El guardado local de portadas ahora es opcional y configurable.
- Añadida opción para borrar las copias locales de las portadas.
- **[ext]** Menú de Opciones dentro del popup de 480×680.

## 1.4.2

- Tarjetas de anime con tamaño adaptable entre 120 y 155 px según el ancho
  disponible.
- La cuadrícula se reajusta al cambiar el tamaño de la ventana sin permitir
  portadas excesivamente grandes.

## 1.4.0

### Funcionalidades incorporadas desde la versión Android

- **Géneros múltiples por anime**: un anime puede tener varios géneros.
- **Filtro múltiple de géneros** y preferencias persistentes.
- **Gestor de géneros**: añadir, renombrar y eliminar géneros del catálogo.
- **Añadir anime por enlace** desde el popup: obtiene título y portada
  automáticamente.
- **Varias listas de Google Sheets**: guardar varias hojas, cambiar entre ellas y
  quitarlas del selector.
- **Cambio de cuenta de Google** desde Herramientas.
- **Carga/precarga de portadas mejorada**, con varios trabajadores simultáneos.
- Mensajes de error y flujo de inicio de sesión mejorados.

### Compatibilidad con Chrome [ext]

La integración conserva el sistema OAuth de la extensión mediante
`chrome.identity` y el Client ID definido en `manifest.json`. No se utiliza el
OAuth de Aplicación web de la PWA.

La detección automática de episodios mediante `content.js` se mantiene.

### Actualización

- **[ext]** Recarga la extensión desde `chrome://extensions` y vuelve a abrir el
  popup.
- **[PWA]** Vuelve a cargar la app. Si cambiaron los archivos de `CORE`, sube la
  versión `animeav1-pwa-vNN` en `sw.js` para que el service worker purgue la
  caché antigua.
- La hoja configurada anteriormente se conserva. Al abrir el gestor de listas
  por primera vez, la hoja existente se convierte automáticamente en **Mi lista**.