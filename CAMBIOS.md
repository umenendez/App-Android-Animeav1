# CAMBIOS

Registro de cambios de **AnimeAV1 Tracker**. Este archivo es idéntico en las dos
carpetas (`chrome-extension_AnimeAV1-tracker/` y `android-app_AnimeAV1-tracker/`):
cualquier cambio de comportamiento se anota aquí una sola vez y se copia a las dos.
Cuando una mejora es solo de una plataforma, se indica con **[ext]** o **[PWA]**.

## 1.8.0

### Listas locales en archivo .json (con géneros por lista) **[ext][PWA]**

Ahora puedes crear listas que **no dependen de Google Sheets**: se guardan en un archivo
`.json` en tu dispositivo (File System Access API en escritorio; almacenamiento interno
+ Importar/Exportar en Android). Cada lista tiene su propio catálogo de géneros
(Películas → terror, superhéroes…; Libros → mitología…).

**Novedades:**
- En el panel "Mis listas" hay un selector **Tipo de lista**: *Google Sheets* o *Archivo .json*.
- **.json → Crear**: abre el diálogo "Guardar como" y crea el archivo; la app lo mantiene
  actualizado automáticamente en cada cambio.
- **.json → Importar**: elige un `.json` existente y lo carga como lista nueva.
- **Exportar**: descarga el `.json` de la lista activa (solo en listas .json).
- **Añadir ítems**: en listas .json el panel "Añadir" muestra un formulario completo
  (título, nota, estado, géneros, portada, descripción, último capítulo, URL). También
  puedes pegar un enlace de animeav1.com y pulsar "Cargar" para autocompletar.
- **Sin sesión de Google**: las listas .json funcionan sin iniciar sesión.
- **Géneros por lista**: cada lista .json (y también cada hoja de Sheets) tiene su
  catálogo independiente (`localStorage["generos:<listaId>"]`). Se migra el catálogo
  global antiguo a la lista activa en la primera carga.

**Detalles técnicos:**
- Nuevos tipos de mensaje: `ADD_LISTA_JSON`, `IMPORT_LISTA_JSON`, `EXPORT_LISTA_JSON`,
  `GET_JSON_LISTA_DATA`, `SAVE_JSON_LISTA_DATA`, `SET_JSON_LISTA_HANDLE`,
  `PARSE_ANIME_URL`, `ADD_JSON_ITEM`.
- En la extensión, `UPDATE_ANIME` y `REGISTER_ANIME` detectan si la lista activa es
  `.json` y enrutan al almacenamiento local.
- En la PWA, `handle()` hace lo mismo para `UPDATE_ANIME`, `PARSE_ANIME_URL` y
  `ADD_JSON_ITEM`.
- El catálogo de géneros deja de ser global (`localStorage["generos"]`) y pasa a ser
  por lista (`localStorage["generos:<id>"]`). Primera carga: migra el global a la lista
  activa y borra la clave global.

## 1.7.0

### Símbolo «Viendo» en la página de inicio de animeav1.com **[ext]**

En https://animeav1.com/ las series que tienes en estado **Viendo** llevan ahora un
círculo naranja con un ojo arriba a la derecha de su imagen. Se marcan las portadas
de «Animes recientemente agregados» y las miniaturas de «Episodios», así que se ve a
primera vista cuándo sale un capítulo nuevo de algo que sigues. El fondo grande del
carrusel superior, los avatares de los comentarios y el resto de páginas no se tocan.

**Cómo funciona.**
- `home.js` (nuevo, se carga en `https://animeav1.com/*` y solo pinta en la página de
  inicio) lee de `chrome.storage.local` una lista de *slugs* de las series «Viendo»
  (`indiceViendo`). No llama a Google Sheets, así que la página no se ralentiza.
- `background.js` mantiene esa lista al día: se reconstruye al cargar la lista en el
  popup, tras cualquier escritura en la hoja (cambiar el estado, abrir un episodio,
  añadir por enlace, cambiar el enlace de una serie) y, si tiene más de 5 minutos,
  cuando se abre la página de inicio (nuevo mensaje `REFRESCAR_VIENDO`), por si
  cambiaste algo a mano en la hoja. Esa actualización no abre ventanas de Google: si la
  sesión caducó se queda la última lista guardada.
- Al cambiar de hoja o de lista la lista guardada se descarta, para no marcar series de
  la hoja anterior.
- Las temporadas que contestaste «Sí, es la misma serie» también se marcan si la serie
  vinculada está en «Viendo».
- Los símbolos siguen la página sin recargarla (contenido que carga después, cambios
  de ruta) y desaparecen en cuanto cambias una serie a otro estado.

**Ajustes** (arriba de `home.js`): `PAGINAS` (p. ej. añadir el catálogo), `TAM`,
`MARGEN` y `COLOR`.

**Limitación.** Se identifica la serie por su enlace de AnimeAV1, igual que el resto de
la extensión: una fila de la hoja que aún tenga un enlace de AnimeFLV no se marca hasta
que se migre.

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

**La solución.** `calcularRepartoEmpate()` ahora busca el hueco **incluyendo** los
bordes de las vecinas (`Math.max(1, vecinaInf)` / `Math.min(100, vecinaSup)`). Así el
hueco siempre tiene al menos 1 décima de ancho y, con 2+ escalones, siempre hay al
menos un cambio. La rama `ancho < 1` se eliminó como inalcanzable; el mensaje «Sin
cambios de nota» ahora solo significa «dijiste que son todas iguales».

**No aplicar al posicionador.** `calcularNotaPosicion()` sigue repitiendo `inferior`
cuando no cabe ninguna décima entre vecinas: allí los muros son respuestas del usuario
y repetir la de abajo es correcto.

### Nota 0 = «sin valorar» (reafirmado y blindado)

- `numeroNota()` y `notaNumero()` devuelven `null` para 0; `textoNotaVisible()` deja
  el campo vacío para que se vea el placeholder `—`.
- `notaRedondeada()` redondea a 0.1 mínimo (nunca a 0).
- `renderEstadisticas()` agrupa con `Math.max(1, Math.round(n))` (el `Math.round`
  simple metía 0.1–0.4 en el cubo 0, que no se pinta).
- Ordenación: las series sin valorar van **al final** en ambos sentidos (nunca primero
  en ascendente).
- Backends (Sheets y .json) escriben celda vacía en lugar de 0.

### Rendimiento: `contarGeneros()` en una sola pasada

Antes `renderPanelGeneros()` filtraba por género en cada tecla → O(series × géneros).
Ahora `contarGeneros()` recorre una sola vez y devuelve el recuento completo →
O(series + géneros). Con 500 series × 40 géneros pasa de ~20 000 `parseGeneros`
por pulsación a ~540.

### Caché de portadas: límite y revocación (extensión)

- `portadaMem` acotado a 200 entradas; al insertar la 201 se revoca la más antigua
  (`URL.revokeObjectURL`).
- `liberarPortadasMem()` (botón "Borrar portadas") revoca todas.
- La PWA usa `cache.put`/`cache.match` (Service Worker) y no necesita object URLs.

---

Entradas anteriores (1.6.1, 1.6.0, 1.5.x…) se omiten por brevedad; el histórico
completo sigue en el repositorio.