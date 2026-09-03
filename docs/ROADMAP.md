# Roadmap

## ✅ Entrega 1 — Estructura + scaffold base
- Monorepo `client` / `server` con TypeScript.
- Docs: arquitectura, métricas, diseño de la daily.
- Auth JWT con dos roles y dos vistas (developer / lead).
- Salud del desarrollador con métricas mock + servicio Gitea listo para conectar.
- Módulo daily: carga de pre-update, randomizador de orden, timer por persona,
  stub de sync a Jira.

## ✅ Entrega 2 — Integraciones reales (actual)
- **Gitea real**: ingest por repo con paginación, reintentos y concurrencia
  acotada; snapshot cacheado con TTL y *single flight*. Verificado contra un
  Gitea 1.21 real: ~700 PRs de 7 repos en ~35 s.
- **Reviews reales** por PR: reviews dados y recibidos, tiempo hasta el primer
  review y heatmap dar/recibir del equipo.
- **Métricas ampliadas**: medianas de lead time y de tiempo al primer review,
  lead time mensual, trazabilidad a ticket, merges por semana, PRs estancados,
  ratio de fixes, distribución de revisores.
- **Jira Cloud real** (`/rest/api/3`): comentarios y worklogs en ADF, validación
  de tickets y búsqueda de usuarios. Escrituras detrás de su propio flag.
- **Mapeo de identidades** app ↔ Gitea ↔ Jira con sugerencias y confianza,
  más pantalla para que el lead confirme.
- **Estado de integraciones** visible en la UI: real vs mock, última sync,
  errores por repo.

Pendiente de esta entrega: activar Jira cargando `JIRA_EMAIL` /
`JIRA_API_TOKEN` en `server/.env` (ver README).

## ✅ Entrega 2.1 — Rotación de facilitador + calendario
- **Todo el equipo facilita**, líderes incluidos: la pantalla de facilitador está
  en el menú de todos y cada día hábil tiene dueño asignado por rotación.
- Rotación **calculada** desde una fecha ancla (no se guarda): sobrevive a los
  reinicios y el calendario a futuro es estable.
- **Calendario mensual** del equipo con el facilitador de cada día más
  vacaciones, licencias, feriados y reuniones.
- Las ausencias saltean a la persona en la rotación y la excluyen de la ronda;
  los feriados dejan el día sin daily.
- Cambio manual de turno (el lead, o quien tiene el turno para cederlo).
- Detalle en [DAILY.md](./DAILY.md#rotación-del-facilitador).

## 🔭 Entrega 3 — Persistencia y métricas avanzadas
- Base de datos (Postgres/SQLite) en vez del store en memoria: hoy cada reinicio
  pierde dailies, eventos del calendario y mapeo de identidades, y obliga a
  re-sincronizar Gitea.
- Congelar las asignaciones de facilitador ya publicadas: hoy sumar o quitar
  gente del roster reacomoda los turnos futuros.
- Histórico de snapshots para ver tendencias más allá de la ventana configurada.
- Iteraciones de review y tasa de revert/reopen.
- Registro y reportes de métricas de daily (asistencia, puntualidad, barreras).

## 🔮 Entrega 4 — Pulido
- SSO/LDAP corporativo en vez de usuarios de ejemplo (hoy la password es la
  misma para todos: es un scaffold, no sirve para uso real).
- Notificaciones (recordatorio de pre-update antes de la daily).
- Vista de barreras agregadas del área (panel del facilitador).
- Tests e2e y CI en Gitea Actions.
