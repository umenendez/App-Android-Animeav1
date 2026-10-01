# Corrección de posicionamiento (v8)

- El algoritmo de posicionamiento ya no reajusta las notas de todas las series para crear huecos de una décima.
- La nota de la serie posicionada se calcula a partir de las dos referencias que delimitan su posición.
- En intervalos sin una décima disponible, se minimiza el cambio de la nota previa en lugar de alterar notas de referencia.
- La misma lógica se aplica en Android/PWA y en la extensión.


## 1.4.4
- Menú de Opciones renovado, con diseño más visual e intuitivo.
- El guardado local de portadas ahora es opcional y configurable.
- Añadida opción para borrar las copias locales de las portadas.
## 1.4.2
- Tarjetas de anime con tamaño adaptable entre 120 y 155 px según el ancho disponible.
- La cuadrícula se reajusta al cambiar el tamaño de la ventana sin permitir portadas excesivamente grandes.

# AnimeAV1 Tracker — versión 1.4.0

## Funcionalidades incorporadas desde Android v8

- **Géneros múltiples por anime**: un anime puede tener varios géneros.
- **Filtro múltiple de géneros** y preferencias persistentes.
- **Gestor de géneros**: añadir, renombrar y eliminar géneros del catálogo.
- **Añadir anime por enlace** desde el popup: obtiene título y portada automáticamente.
- **Varias listas de Google Sheets**: guardar varias hojas, cambiar entre ellas y quitarlas del selector.
- **Cambio de cuenta de Google** desde Herramientas.
- **Carga/precarga de portadas mejorada**, con varios trabajadores simultáneos.
- Mensajes de error y flujo de inicio de sesión mejorados.

## Compatibilidad con Chrome

La integración conserva el sistema OAuth de la extensión mediante `chrome.identity` y el Client ID definido en `manifest.json`. No se utiliza el OAuth de Aplicación web de la PWA.

La detección automática de episodios mediante `content.js` se mantiene.

## Actualización

Recarga la extensión desde `chrome://extensions` y vuelve a abrir el popup.

La hoja configurada anteriormente se conserva. Al abrir el gestor de listas por primera vez, la hoja existente se convierte automáticamente en **Mi lista**.

- Corrección separador de empates: la redistribución de décimas queda limitada a un rango cercano a la nota original; nunca puede saltar de 9.x a valores alejados como 2.x por buscar un bloque libre global. Si no hay suficiente espacio cercano, se cancela la redistribución en lugar de alterar la escala.
