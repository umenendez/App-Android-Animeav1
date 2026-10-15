# CAMBIOS

Registro de cambios de **AnimeAV1 Tracker**. Este archivo es idéntico en las dos
carpetas (`chrome-extension_AnimeAV1-tracker/` y `android-app_AnimeAV1-tracker/`):
cualquier cambio de comportamiento se anota aquí una sola vez y se copia a las dos.
Cuando una mejora es solo de una plataforma, se indica con **[ext]** o **[PWA]**.

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