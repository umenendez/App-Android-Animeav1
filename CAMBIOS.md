
- Corrección separador de empates: la redistribución de décimas queda limitada a un rango cercano a la nota original; nunca puede saltar de 9.x a valores alejados como 2.x por buscar un bloque libre global. Si no hay suficiente espacio cercano, se cancela la redistribución en lugar de alterar la escala.

- Posicionador: la "nota estimada" ahora se actualiza tras cada comparación (antes mostraba siempre la nota inicial). Si se saltan series y el tramo queda sin resolver, la estimación va al centro del tramo dudoso en lugar de pegarse a un extremo.
- Posicionador: nuevo botón "← Atrás" para deshacer la última respuesta o salto, y "← Corregir última respuesta" en la pantalla de resultado.
- Posicionador: corregido que la primera serie (sin referencias) acabara con 10.0 en lugar de 5.0. Sin comparaciones se conserva la nota actual o 5.0 si no tenía.
- Posicionador: eliminado el panel de "notas existentes cambiadas" (nunca se modificaban otras notas). Se avisa si la nota nueva coincide con la de otras series. Se siguen permitiendo notas repetidas.
- Separador de empates: el reparto de décimas ya no puede cruzar a otras series. Solo usa el hueco entre la nota vecina inferior y la superior; si no caben todas las posiciones, algunas series quedan empatadas en lugar de cancelar.
- Separador de empates: "Me gustan igual" ahora se respeta: esas series conservan la misma nota.
- Separador de empates: añadidos "← Atrás" y "← Corregir última respuesta". Los grupos se forman con la nota redondeada a una décima (antes una nota como 8.04 se quedaba fuera). Se omiten las notas que no cambian al guardar y se avisa si Sheets falla.
