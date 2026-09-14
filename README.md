# Dev Team Hub

Herramienta web para equipos de desarrollo que usan **Gitea + Jira**. Centraliza
en un solo lugar la salud del equipo (métricas de PRs y reviews), la daily y el
calendario de facilitadores.

## Features

1. **Login con dos vistas** — Desarrollador y Líder técnico (roles con permisos
   y dashboards distintos).
2. **Salud del desarrollador** — Métricas de PRs por mes (abiertos, mergeados,
   cerrados), code reviews y un conjunto ampliado de indicadores de entrega y
   colaboración. Datos desde la API de Gitea.
3. **Daily** — Tablero del facilitador para correr la daily según el
   [proceso documentado](./docs/DAILY.md): carga del pre-update (qué se hizo
   ayer + qué se hará hoy), comentarios que se sincronizan a Jira, randomización
   del orden de exposición y timer por persona (60–70s) con cuenta regresiva.
   Muestra el **número de daily** y la **ronda de facilitadores** completa.
   **Todo el equipo rota como facilitador**, líderes incluidos.
4. **Calendario del equipo** — Quién facilita cada día hábil (rotación
   automática) más vacaciones, licencias, feriados y reuniones. Las ausencias
   saltean a la persona en la rotación; los feriados dejan el día sin daily.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + React Router + Recharts
- **Backend:** Node + Express + TypeScript + SQLite (better-sqlite3)
- **Integraciones:** Gitea API (PRs/reviews), Jira API (comentarios, validación de tickets)
- **Auth:** login con Gitea (OAuth2) + JWT propio; modo demo con usuarios de
  ejemplo para probar sin configurar nada

> La app corre con **datos mock** out-of-the-box. Las integraciones reales con
> Gitea y Jira se activan completando `server/.env` (ver `.env.example`).

## Estructura

```
dev-team-hub/
├── docs/                 Diseño: arquitectura, features, métricas, daily
├── server/               API Express + TypeScript
│   └── src/
│       ├── routes/       auth, developers (salud), daily, calendar,
│       │                 integrations
│       ├── services/     giteaApi (HTTP), gitea (ingest+cache), metrics,
│       │                 jira, mapping (identidades), facilitator (rotación)
│       ├── middleware/   auth (JWT + roles)
│       └── data/         store en memoria + datos mock
└── client/               SPA React + Vite
    └── src/
        ├── pages/        Login, DeveloperDashboard, LeadDashboard, Health,
        │                 Daily, Calendar, Mapping
        ├── components/   UI reutilizable (charts, timer, badge de integración)
        ├── context/      AuthContext
        └── api/          cliente HTTP
```

## Cómo correr

### Con Docker (recomendado para instalar)

Requiere Docker con Compose v2. Una sola imagen: el server Express sirve la API
y el build del cliente en el puerto 4000.

```bash
cp server/.env.example server/.env   # completar TZ, secretos e integraciones
docker compose up -d --build
```

Abrí http://localhost:4000. Logs con `docker compose logs -f`, apagar con
`docker compose down`. Importante definir `TZ` en `server/.env`: la rotación de
facilitador usa la fecha local. Los datos (dailies, calendario, identidades)
van a una base SQLite en el volumen `dth-data`, así que sobreviven a reinicios
y rebuilds. Más detalle en [docs/DOCKER.md](./docs/DOCKER.md).

### En desarrollo (sin Docker)

Requiere Node 18+.

```bash
# Backend (puerto 4000)
cd server
cp .env.example .env
npm install
npm run dev

# Frontend (puerto 5173) — en otra terminal
cd client
npm install
npm run dev
```

Abrí http://localhost:5173. Sin configurar nada, la app usa el roster de
demostración (`server/roster.example.json`): entrá por ejemplo con
`adalovelace@example.com` y password `demo` — es un scaffold, la auth real
viene después. La pantalla de login lista algunas cuentas pidiéndolas al server
(`GET /api/auth/demo-users`); se apaga con `AUTH_DEMO_MODE=false`.

## Roster del equipo

Las personas del equipo viven en un JSON fuera del código:

```bash
cp server/roster.example.json server/roster.json   # editar con tu equipo
```

`roster.json` está gitignoreado (datos de personas reales no se versionan);
también se puede apuntar a otra ruta con `ROSTER_FILE`. Cada persona lleva
`login` (el de Gitea), `name`, `role` (`developer` | `lead`) y opcionalmente
`email` o `jiraAccountId`. El mail se deriva como `<login>@<emailDomain>` si no
viene explícito. `facilitatorOverrides` permite fijar facilitador a mano en
fechas puntuales (p. ej. huecos al migrar de un proceso anterior).

### Número de daily y de ronda

Si el equipo venía contando las dailies por otro medio (un chat, una planilla),
la app empalma con esa numeración: se ancla el último valor conocido
(`DAILY_NUMBER_ANCHOR_DATE` / `DAILY_NUMBER_ANCHOR_VALUE`) y las rondas previas
(`DAILY_ROUNDS_BEFORE_ANCHOR`), y se sigue contando desde ahí. La ronda sale de
la rotación; el correlativo de daily **descuenta feriados** (un día sin daily no
consume número). Son un dato de color para el equipo; no alimentan métricas.

## Integraciones

### Login con Gitea (OAuth2)

El login real delega la identidad en Gitea: la persona se autentica ahí (con
su 2FA si tiene) y entra si su login figura en el roster; el rol lo da
`roster.json`. Para activarlo, registrá una app OAuth2 en Gitea (Configuración
→ Aplicaciones) con redirect URI `<PUBLIC_URL>/api/auth/gitea/callback` y
completá:

```env
PUBLIC_URL=https://tu-hub.example.com
GITEA_OAUTH_CLIENT_ID=<client id>
GITEA_OAUTH_CLIENT_SECRET=<client secret>
AUTH_DEMO_MODE=false     # apaga las cuentas de ejemplo (y su password)
```

Mientras `AUTH_DEMO_MODE=true`, conviven el botón "Entrar con Gitea" y las
cuentas demo — útil para probar. Con el OAuth configurado y el modo demo en
`false`, el login por password queda deshabilitado del todo.

### Métricas desde Gitea

```env
GITEA_ENABLED=true
GITEA_BASE_URL=https://gitea.example.com
GITEA_TOKEN=<token>      # también se toma de la variable de entorno del sistema
GITEA_REPOS=org/repo1,org/repo2
```

Si falta el token o los repos, la app cae sola a datos mock y lo avisa en la
UI. También se puede escanear orgs enteros con `GITEA_ORGS`, y ajustar la
ventana de tiempo con `GITEA_WINDOW_MONTHS` (ver `.env.example`).

Referencia de costo: con 7 repos y ~700 PRs en una ventana de 6 meses, la sync
tarda ~35 s y queda cacheada 15 minutos. Activar `GITEA_FETCH_SIZES=true`
agrega un request por PR (Gitea 1.21 no devuelve las líneas de otra forma) y
duplica ese tiempo.

### Jira

```env
JIRA_ENABLED=true          # lecturas: validar tickets, resolver usuarios
JIRA_WRITE_ENABLED=true    # escrituras: comentarios reales en los tickets
JIRA_BASE_URL=https://tuempresa.atlassian.net
JIRA_EMAIL=tu.mail@dominio
JIRA_API_TOKEN=<token>     # id.atlassian.com/manage-profile/security/api-tokens
```

Son dos flags a propósito: comentar escribe en tickets reales del equipo, así
que no se activa junto con la lectura. Con `JIRA_ENABLED=false` todo se simula
y la daily sigue funcionando.

### Mapeo de identidades

En Gitea los mails de terceros vienen enmascarados (`@noreply.localhost`), así
que no se puede cruzar por mail. La pantalla **Identidades** (rol lead) resuelve
cada persona buscando `<giteaLogin>@<JIRA_EMAIL_DOMAIN>` en Jira y, si no
aparece, por nombre visible. Propone con un nivel de confianza; el lead
confirma.

### Rotación del facilitador

Cada día hábil tiene facilitador asignado por rotación sobre todo el equipo,
líderes incluidos. El turno se calcula desde una fecha ancla
(`DAILY_ROTATION_ANCHOR`) en vez de guardarse, así sobrevive a los reinicios y
el calendario a futuro es estable. Cambiar el ancla reacomoda toda la rotación.
Detalle y casos borde en
[docs/DAILY.md](./docs/DAILY.md#rotación-del-facilitador).

## Estado

Integraciones reales de Gitea y Jira + mapeo de identidades, verificadas contra
servidores reales (Gitea 1.21, Jira Cloud), rotación de facilitador y
calendario del equipo, login OAuth2 contra Gitea y persistencia en SQLite.
Ver [docs/ROADMAP.md](./docs/ROADMAP.md) para lo que sigue.

## Licencia

[MIT](./LICENSE)
