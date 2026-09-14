# syntax=docker/dockerfile:1

# Imagen única: el server Express sirve la API y además el build del cliente,
# así el front y el back comparten origen y no hace falta ni CORS ni un proxy
# aparte (en desarrollo eso lo resuelve el proxy de Vite).

# ---------------------------------------------------------------------------
# Dependencias de producción del server (sin tsx ni typescript).
# better-sqlite3 es nativo y no trae prebuilds para musl: en alpine compila
# desde el fuente, de ahí el toolchain. Sólo vive en las etapas de build.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Compilación del server (necesita las devDependencies).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Build del cliente (Vite -> client/dist).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# La rotación de facilitador y el número de daily se calculan con la fecha
# LOCAL (getFullYear/getMonth/getDate, ver services/facilitator.ts). Un
# contenedor sin TZ corre en UTC: pasada cierta hora local ya sería "mañana" y
# la app mostraría el facilitador del día siguiente. tzdata es necesario en
# alpine para que TZ tenga efecto — el valor se pasa por entorno (server/.env
# vía docker compose), acá sólo queda el default neutro.
RUN apk add --no-cache tzdata
ENV TZ=Etc/UTC
ENV NODE_ENV=production

WORKDIR /app/server

# package.json va sí o sí: tiene "type": "module" y sin eso Node interpreta
# dist/index.js como CommonJS y no arranca.
COPY server/package.json ./
# Roster: el example siempre; roster.json (real, gitignoreado) sólo si existe
# en la máquina que buildea. También se puede montar o apuntar con ROSTER_FILE.
COPY server/roster*.json ./
COPY --from=server-deps  /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist         ./dist
COPY --from=client-build /app/client/dist         /app/client/dist

# La base SQLite vive en /data (montado como volumen por docker-compose, con
# DATABASE_PATH apuntando adentro). El chown importa: el volumen hereda el
# dueño del directorio de la imagen y el proceso corre como `node`.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
