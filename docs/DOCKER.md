# Docker

Una sola imagen: el server Express sirve la API y el build del cliente. Un
proceso, un puerto, sin nginx ni IIS adelante.

## Antes: dónde va a correr

Docker **no corre en Windows Server 2012**. Los contenedores de Windows
aparecieron en Server 2016, y los de Linux necesitan Hyper-V o WSL2, que
tampoco están. Las opciones son:

- **Host Linux** (lo natural): cualquier distro con Docker. Es lo que asume
  este Dockerfile.
- **Windows Server 2019/2022** con Docker en modo Linux containers.
- Si el server tiene que ser sí o sí el 2012, no hay contenedor: va la
  instalación nativa de [DEPLOY.md](./DEPLOY.md).

El lado bueno es que el contenedor resuelve de una el problema que domina esa
guía: adentro corre Node 22 sin importar qué SO tenga el host.

## Build y arranque

```bash
cp server/.env.example server/.env    # editar: TZ, JWT_SECRET, GITEA_TOKEN, etc.
cp server/roster.example.json server/roster.json   # editar con tu equipo
docker compose up -d --build
docker compose logs -f app
```

La app queda en `http://<host>:4000` — front y API en el mismo origen.

Sin compose:

```bash
docker build -t dev-team-hub .
docker run -d --name dev-team-hub -p 4000:4000 \
  --env-file server/.env \
  --restart unless-stopped \
  dev-team-hub
```

(`TZ` viene de `server/.env`; también se puede pasar con `-e TZ=<zona>`.)

## Cómo está armada la imagen

Cuatro etapas, para que la imagen final no cargue con compiladores ni
devDependencies:

| Etapa | Qué hace |
|---|---|
| `server-deps` | `npm ci --omit=dev` — sólo lo que necesita el runtime |
| `server-build` | `npm ci` completo + `tsc` → `dist/` |
| `client-build` | `npm ci` + `vite build` → `client/dist` |
| `runtime` | copia los tres resultados, corre como usuario `node` |

Detalles que no son obvios:

- **`server/package.json` va a la imagen final.** Tiene `"type": "module"`; sin
  él Node lee `dist/index.js` como CommonJS y no arranca.
- **`tzdata` + `TZ`.** La rotación de facilitador y el número de daily se
  calculan con la fecha **local** (`getFullYear/getMonth/getDate` en
  `services/facilitator.ts`, a propósito, para no correrse un día al parsear).
  Un contenedor sin `TZ` corre en UTC: pasada cierta hora local ya sería el día
  siguiente y la app mostraría el facilitador de mañana — definí `TZ` en
  `server/.env`. En alpine, `TZ` sin `tzdata` instalado se ignora en silencio.
- **El roster entra en la imagen.** `roster.example.json` siempre;
  `server/roster.json` (el real, gitignoreado) sólo si existe al buildear.
  También se puede montar como volumen o apuntar con `ROSTER_FILE`.
- **`HEALTHCHECK`** contra `/api/health` con `start-period` de 40 s, porque el
  arranque dispara la sync inicial de Gitea (~34 s).
- **Corre como `node`, no como root.** La app no escribe nada en disco.

## Configuración

Todo por variables de entorno; `docker-compose.yml` levanta `server/.env` con
`env_file`. Las que importan en producción están en
[DEPLOY.md, paso 5](./DEPLOY.md#5-serverenv-de-producción) — sobre todo
`JWT_SECRET`, que tiene un default de desarrollo.

`CLIENT_ORIGIN` queda casi decorativa con esta imagen: el front se sirve desde
el mismo origen que la API, así que CORS no entra en juego.

## Datos

La app persiste en **SQLite** (dailies, eventos de calendario, identidades
confirmadas). En el compose la base vive en el volumen `dth-data`
(`DATABASE_PATH=/data/dev-team-hub.db`), así que sobrevive a `restart`,
`up --build` y borrado del contenedor. Backup = copiar ese archivo
(`docker run --rm -v dth-data:/data alpine cat /data/dev-team-hub.db > backup.db`
con la app parada, o usar `.backup` de sqlite3 en caliente).

`better-sqlite3` es un módulo nativo sin prebuilds para musl: por eso las
etapas de build del Dockerfile instalan `python3 make g++` (la imagen final no
los carga).

## Actualizar

```bash
docker compose up -d --build
```

Reconstruye y reemplaza el contenedor; la base queda en el volumen. No hay
migraciones formales todavía: el esquema es clave→JSON y se crea solo.
