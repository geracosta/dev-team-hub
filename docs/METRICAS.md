# Métricas de salud del desarrollador

El objetivo es **detectar cuellos de botella temprano y acompañar**, no rankear
personas. Toda métrica individual se lee en contexto de equipo y tendencia, no
como nota absoluta.

## Métricas base

- **PRs por mes:** abiertos, mergeados, cerrados (sin merge).
- **Code reviews por PR:** cuántas revisiones/aprobaciones recibió cada PR.

## Ideas adicionales para medir a un desarrollador

Agrupadas por dimensión. Todas son derivables de Gitea y/o Jira.

### Flujo / entrega (cycle time)
- **Lead time de PR:** tiempo desde apertura hasta merge (mediana, no promedio).
- **Tiempo hasta el primer review:** cuánto tarda el equipo en mirar tu PR
  (mide responsiveness del *equipo*, no del autor).
- **Tamaño de PR:** líneas y archivos cambiados. PRs chicos → reviews más rápidos
  y menos riesgo. Tendencia a bajar es buena señal.
- **Frecuencia de merge:** PRs mergeados por semana (entregas pequeñas y seguidas).
- **WIP promedio:** ítems "en curso" simultáneos. El proceso de daily fija un
  límite de **≤2**; superarlo de forma sostenida es un riesgo.

### Calidad
- **Iteraciones de review:** rondas de cambios / commits después del primer
  review. Muchas iteraciones repetidas pueden indicar specs poco claras.
- **Tasa de revert/reopen:** PRs revertidos o reabiertos tras merge.
- **PRs con descripción y link al ticket:** higiene de trazabilidad
  (la daily exige link al ticket).
- **Bugs/hotfix ratio:** proporción de PRs etiquetados como fix sobre el total.

### Colaboración (clave y muchas veces ignorada)
- **Reviews realizados a otros:** cuántos PRs revisás vos. Equilibrar dar y
  recibir review es señal de equipo sano.
- **Tiempo de respuesta como reviewer:** qué tan rápido destrabás a un compañero.
- **Distribución de reviews:** ¿el review se concentra en 1–2 personas? Detecta
  dependencia de un solo "knowledge holder".

### Proceso / daily (desde Jira + el módulo de daily)
- **Barreras generadas vs. resueltas** y **tiempo de resolución** de barreras
  donde sos dueño.
- **Asistencia y puntualidad** a la daily (9:05) y **resúmenes hechos**
  (las métricas que ya define el proceso documentado).
- **Tickets cerrados / throughput** por sprint.

## Visualizaciones sugeridas

- Barras apiladas de PRs por mes (abiertos/mergeados/cerrados).
- Línea de lead time mediano por mes (tendencia).
- Heatmap dar/recibir reviews entre miembros del equipo (vista del lead).
- Tarjetas de "señales" (WIP alto, PRs estancados sin review > N días).

## Anti-patrones a evitar

- No usar líneas de código como métrica de productividad.
- No comparar devs senior vs. junior con la misma vara.
- No exponer rankings individuales públicos; sí tendencias personales y de equipo.
