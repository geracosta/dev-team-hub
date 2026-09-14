# Arquitectura

## Visión general

```
┌─────────────┐      HTTP/JSON      ┌──────────────┐      REST      ┌──────────────┐
│   Client    │  ───────────────▶   │   Server     │  ───────────▶  │  Gitea API   │
│ React+Vite  │  ◀───────────────   │ Express+TS   │  ◀───────────  │ (PRs/reviews)│
│  (SPA)      │      JWT auth       │              │                └──────────────┘
└─────────────┘                     │              │      REST      ┌──────────────┐
                                    │              │  ───────────▶  │   Jira API   │
                                    │              │  ◀───────────  │ (comments,   │
                                    │              │                │  worklog)    │
                                    └──────┬───────┘                └──────────────┘
                                           │
                                    ┌──────▼───────┐
                                    │  Datastore   │  SQLite embebido
                                    │              │  (better-sqlite3, ver db.ts)
                                    └──────────────┘
```

## Decisiones

| Tema            | Decisión                          | Motivo |
|-----------------|-----------------------------------|--------|
| Front/back      | Repos separados (`client`/`server`) en un monorepo | Pedido del equipo; deploy independiente. |
| Lenguaje        | TypeScript en ambos                | Tipos compartidos para los DTOs, menos bugs de integración. |
| Auth            | OAuth2 contra Gitea + JWT propio con roles (`developer`,`lead`) | La identidad ya vive en Gitea (2FA incluido); el rol lo da el roster. Modo demo opcional para correr sin nada. |
| Fuente PRs      | Gitea API                          | El git del equipo es un Gitea autohosteado. |
| Comentarios     | Jira API                           | La daily ya documenta tickets/subtareas en Jira. |
| Datos           | SQLite embebido (clave→JSON espejado en Maps) + mock | Persistencia sin server de DB aparte; los Maps mantienen simple el resto del código. |
| Ingest de PRs   | Por repo, cacheado en un snapshot  | Gitea no filtra PRs por autor arbitrario; una sync sirve a todo el equipo. |
| Escrituras Jira | Flag propio (`JIRA_WRITE_ENABLED`) | Comentar e imputar horas toca tickets reales del equipo: opt-in aparte de la lectura. |

## Capas del backend

- **routes/** — controladores HTTP, validación de entrada, shape de respuesta.
- **services/** — lógica de integración:
  - `giteaApi.ts` — capa HTTP: cliente, paginación, reintentos y concurrencia acotada.
  - `gitea.ts` — ingest de PRs + cache del snapshot.
  - `metrics.ts` — cálculo de métricas sobre el snapshot (no habla HTTP).
  - `jira.ts` — Jira Cloud: comentarios, worklogs, validación de tickets, búsqueda de usuarios.
  - `mapping.ts` — resolución de identidades app ↔ Gitea ↔ Jira.
- **middleware/auth.ts** — verifica el JWT y autoriza por rol.
- **data/** — store en memoria de dailies/sesiones + generadores de datos mock.

## Cómo se traen los PRs (Entrega 2)

Gitea 1.21 no permite buscar PRs por autor arbitrario: `/repos/issues/search`
sólo filtra por el usuario del token (`created=true`). Por eso el ingest baja
**todos los PRs de cada repo trackeado una sola vez** y agrupa por autor en
memoria: una sync alimenta las métricas de todo el equipo, en vez de hacer
`N usuarios × M repos` requests.

```
GET /repos/{owner}/{repo}/issues?type=pulls&state=all&since=<ventana>   (paginado)
  └─ por cada PR: GET /pulls/{n}/reviews          (reviews dados/recibidos)
  └─ opcional:    GET /pulls/{n}/files            (líneas +/-; ver nota)
```

Se usa `/issues?type=pulls` y no `/pulls` porque acepta `since`, devuelve
`repository`, labels y body, y expone `pull_request.merged`.

Notas que condicionan el diseño:

- **`since` filtra por `updated_at`**, así que entran PRs viejos actualizados
  hace poco. Las métricas del autor descartan los creados fuera de la ventana,
  si no el gráfico por mes queda con meses sueltos de hace un año.
- **`additions`/`deletions` vienen en null** en esta versión de Gitea, tanto en
  el listado como en el detalle del PR. El tamaño sólo sale de
  `/pulls/{n}/files`, que es un request extra por PR: por eso
  `GITEA_FETCH_SIZES` está apagado por defecto.
- El snapshot se cachea (`GITEA_CACHE_TTL_MINUTES`) con *single flight*: varias
  requests concurrentes comparten la misma sync en curso.

## Identidades (Entrega 2)

Gitea enmascara los mails de terceros como `login@noreply.localhost`, así que no
hay campo común con Jira. La resolución usa el patrón corporativo
`<giteaLogin>@<JIRA_EMAIL_DOMAIN>`, que la búsqueda de Jira matchea aun con el
mail oculto; si falla, cae a matchear por nombre visible. Nunca asigna sola:
devuelve candidatos y un nivel de confianza para que el lead confirme.

## Modelo de datos (inicial)

```ts
User          { id, name, email, role: 'developer'|'lead', giteaLogin,
                jiraAccountId?, jiraMatch?: 'manual'|'email'|'name'|'none' }
PullRequest   { id, number, repo, title, state: 'open'|'merged'|'closed',
                authorLogin, reviews:[{authorLogin,state,submittedAt}], reviewsCount,
                createdAt, updatedAt, mergedAt?, closedAt?, additions, deletions,
                changedFiles, labels, ticketKey?, htmlUrl }
SyncSnapshot  { mode:'real'|'mock', syncedAt, durationMs, repos, prs, errors,
                windowFrom, reviewsFetched, sizesFetched, truncated }
HealthMetrics { userId, giteaLogin, byMonth:[{month,open,merged,closed,
                medianLeadTimeHours}], totals, reviewsReceived, reviewsGiven,
                avgReviewsPerPr, avg/medianTimeToFirstReviewHours,
                avg/medianPrLifetimeHours, avgPrSizeLines, openWithoutReview,
                stalePrs, ticketLinkRate, mergesPerWeek, reviewersBreakdown, ... }
DailySession  { id, date, facilitatorId, status, order:[participantId],
                currentIndex, perPersonSeconds }
DailyEntry    { id, sessionId, userId, yesterday:[{ticketKey,hours,comment}],
                today:[{ticketKey,note}], barreras:[{ticketKey,detail}],
                syncedToJira, syncedAt?, lastSyncResult? }
```

## Seguridad / privacidad

Las métricas de salud son para **acompañamiento y detección temprana de cuellos
de botella**, no para ranking individual punitivo. El acceso a la vista
agregada del equipo se restringe al rol `lead`. Cada desarrollador ve sus
propias métricas. Ver [METRICAS.md](./METRICAS.md).
