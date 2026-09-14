# Deploy en Windows Server 2012

> **Si el host puede correr Docker, usá el `Dockerfile` de la raíz y saltate
> esta guía entera.** El contenedor trae su propio Node, así que el problema de
> versiones que domina todo lo que sigue desaparece. La contra: Docker necesita
> Windows Server 2016+ (los contenedores de Windows no existen en 2012) o
> directamente un host Linux. Ver [DOCKER.md](./DOCKER.md).

Guía para dejar Dev Team Hub corriendo en un server interno. El caso difícil es
la versión del SO: Windows Server 2012 está fuera del rango soportado de Node
moderno, así que la estrategia es **buildear afuera y correr adentro** con la
última versión de Node que todavía arranca en ese kernel.

## 0. Antes que nada: chequear la versión exacta

```powershell
winver              # o: systeminfo | findstr /B /C:"Nombre del sistema operativo"
```

Importa si es **2012** (kernel 6.2, base Windows 8) o **2012 R2** (kernel 6.3,
base Windows 8.1). La tabla oficial de plataformas de Node dice:

| Node | Windows 10 / Server 2016+ | 8.1 / Server 2012 R2 | Server 2012  |
|------|---------------------------|----------------------|--------------|
| 16.x | Tier 1                    | Tier 1               | Experimental |
| 18.x | Tier 1                    | Experimental         | Experimental |
| 20.x | Tier 1                    | Experimental         | Experimental |

*Experimental* = puede compilar y correr, pero no hay tests ni soporte: si algo
se rompe, no bloquea un release de Node.

**Plan:** probar **Node 18.20.x** (última 18 LTS). Si `node -v` falla —
típicamente "no es una aplicación Win32 válida" o "no se encontró el punto de
entrada en KERNEL32.dll" — bajar a **Node 16.20.2**, que es la última que lista
Server 2012 explícitamente. El server compilado (`server/dist`) apunta a ES2022
y ESM, así que 16 es el piso real; con 14 no alcanza.

Dos cosas para decidir con los ojos abiertos, no para frenar el deploy: Server
2012 salió de soporte extendido el 10/10/2023 y Node 18 llegó a EOL en abril de
2025. Para una herramienta interna alcanza; para exponerla más allá de la red
del área, no.

## 1. Buildear en la máquina de desarrollo

En el server **no** se compila: Vite 5 y `tsc` piden Node 18+, y `npm install`
sobre 2012 pelea con TLS viejo. Ojo: desde que entró SQLite hay una dependencia
**nativa** (`better-sqlite3`), así que el `node_modules` que se copia tiene que
armarse con el **mismo Node mayor y arquitectura** que va a correr en el server
(el binario compilado es por ABI de Node; si no coincide, el server no arranca).

```powershell
cd <repo>\server
npm install
npm run build          # -> server\dist

cd ..\client
npm install
npm run build          # -> client\dist
```

Para el `node_modules` de producción (sin `tsx` ni `typescript`), conviene
armarlo aparte en vez de podar el de desarrollo:

```powershell
mkdir C:\temp\dth-prod
copy <repo>\server\package.json C:\temp\dth-prod
copy <repo>\server\package-lock.json C:\temp\dth-prod
cd C:\temp\dth-prod
npm ci --omit=dev
```

(`npm prune --omit=dev` sobre `server\node_modules` también sirve, pero te deja
sin `tsx` y hay que reinstalar para volver a `npm run dev`.)

## 2. El bundle que va al server

```
C:\apps\dev-team-hub\
├── server\
│   ├── dist\           <- salida de tsc
│   ├── node_modules\   <- el de C:\temp\dth-prod
│   ├── package.json
│   ├── roster.json     <- el roster real del equipo (ver README)
│   └── .env            <- ver paso 5
├── client\
│   └── dist\           <- salida de vite build
└── logs\
```

## 3. Node en el server (zip, no MSI)

Bajá `node-v18.20.8-win-x64.zip` en tu máquina y copialo por red. El MSI tiene
una condición de instalación por versión de SO que puede rechazar 2012; el zip
te evita eso.

```powershell
# En el server
Expand-Archive C:\temp\node-v18.20.8-win-x64.zip -DestinationPath C:\
ren C:\node-v18.20.8-win-x64 node
setx /M PATH "$env:PATH;C:\node"
# Abrir una consola nueva y verificar:
node -v
```

Si preferís descargar desde el propio server, PowerShell 3.0 arranca en TLS 1.0
y nodejs.org lo rechaza:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing https://nodejs.org/dist/v18.20.8/node-v18.20.8-win-x64.zip -OutFile C:\temp\node.zip
```

Evitá Chocolatey: las versiones actuales piden .NET 4.8, que en 2012 es otra
instalación más.

## 4. Servir el front

Hoy el server sólo expone `/api`, y el cliente pega a `/api` relativo — en
desarrollo lo resuelve el proxy de Vite (`client/vite.config.ts`). En el server
hay que unificar el origen. Dos caminos:

### A. Express sirve `client/dist` (ya implementado)

Un proceso, un puerto, sin CORS ni IIS. Está en `server/src/index.ts`: sirve
`client/dist` como estático y manda todo lo que no empiece con `/api` a
`index.html`, para que React Router resuelva la ruta del lado del navegador.

Busca el build en `../../client/dist` relativo al archivo, así que funciona
igual corriendo `dist/index.js` que `tsx src/index.ts`, y respeta la estructura
del bundle del paso 2. Si necesitás otra ubicación, `CLIENT_DIST` la
sobreescribe.

### B. IIS + Application Request Routing

Sitio estático apuntando a `C:\apps\dev-team-hub\client\dist` y una regla de
URL Rewrite que mande `/api/*` a `http://localhost:4000/api/*`. Requiere
instalar ARR 3.0 y URL Rewrite 2.1 (ambos corren en 2012). Más piezas, pero te
da el puerto 80/443, certificado, logs de IIS y la puerta abierta a auth de
Windows más adelante. Con este camino, `CLIENT_ORIGIN` tiene que ser la URL
pública del sitio.

## 5. `server\.env` de producción

```env
PORT=4000
JWT_SECRET=<string largo y random>       # el default es 'dev-secret-change-me'
CLIENT_ORIGIN=http://<host>:4000
PUBLIC_URL=http://<host>:4000            # base del redirect_uri del login
AUTH_DEMO_MODE=false
TZ=<zona horaria del equipo>
# DATABASE_PATH=<ruta del .db>           # default: junto al server

GITEA_ENABLED=true
GITEA_BASE_URL=https://<tu-gitea>
GITEA_TOKEN=<token>
GITEA_REPOS=<org/repo1,org/repo2,...>

# Login real: app OAuth2 registrada en Gitea con redirect
# <PUBLIC_URL>/api/auth/gitea/callback (ver README).
GITEA_OAUTH_CLIENT_ID=<client id>
GITEA_OAUTH_CLIENT_SECRET=<client secret>

JIRA_ENABLED=false
JIRA_WRITE_ENABLED=false
```

Revisá que las anclas `DAILY_ROTATION_ANCHOR`, `DAILY_NUMBER_ANCHOR_*` y
`DAILY_ROUNDS_BEFORE_ANCHOR` sigan siendo las calibradas (ver README): mover el
ancla de rotación reacomoda toda la ronda.

`AUTH_DEMO_MODE=false` sólo deja de publicar la lista de cuentas en el login;
**no** cambia que la password siga siendo `demo` para todos.

## 6. Correrlo como servicio de Windows (NSSM)

```powershell
nssm install DevTeamHub C:\node\node.exe
```

En el diálogo:

- **Path:** `C:\node\node.exe`
- **Startup directory:** `C:\apps\dev-team-hub\server` ← importante: `dotenv`
  lee `.env` desde el directorio de trabajo
- **Arguments:** `dist\index.js`
- **I/O** → stdout y stderr a `C:\apps\dev-team-hub\logs\out.log` / `err.log`
- **Exit actions** → Restart

```powershell
nssm set DevTeamHub AppRotateFiles 1
net start DevTeamHub
```

Sin NSSM, la alternativa es una tarea programada "al iniciar el sistema"
corriendo como SYSTEM, pero se porta peor con los reinicios y los logs.

## 7. Firewall

```powershell
netsh advfirewall firewall add rule name="DevTeamHub 4000" dir=in action=allow protocol=TCP localport=4000
```

## 8. Verificación

```powershell
# En el server
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health | Select -Expand Content
```

Tiene que devolver `{"ok":true,"integrations":{...}}`, con `gitea: true` si el
token está bien. En `logs\out.log` va a aparecer la sync inicial de Gitea —
como referencia, ~35 s para ~700 PRs de 7 repos con ventana de 6 meses.
Después, desde otra máquina de la red: `http://<host>:4000`.

Si el server sale a internet por proxy corporativo, axios respeta `HTTPS_PROXY`
y `NO_PROXY` del entorno del servicio. El TLS hacia Gitea y Jira no depende del
SO: Node trae su propio OpenSSL y su propio store de CAs, así que un Windows
viejo no rompe la conexión.

## 9. Lo que hay que saber antes de dejarlo prendido

- **Los datos viven en un archivo SQLite** (`DATABASE_PATH`, por defecto junto
  al server). Backupear ese archivo es backupear la app; excluirlo de borrados
  de limpieza.
- **Con OAuth configurado y `AUTH_DEMO_MODE=false`, el login es real** (Gitea,
  con su 2FA). Si el modo demo queda prendido, la password `demo` compartida
  sigue activa — apagarlo en cualquier deploy alcanzable por terceros.
- **El `.env` queda con el token de Gitea en texto plano.** Restringí la carpeta
  por NTFS a la cuenta del servicio y a los admins.
- **`JIRA_WRITE_ENABLED=true` comenta en tickets reales.** Dejalo en `false`
  hasta que el flujo esté validado en el server.
