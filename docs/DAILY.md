# Módulo Daily — diseño

Basado en el proceso de daily documentado del equipo donde nació la app.
Reemplaza la combinación típica de un chat para el pre-update + un timer online
aparte por una sola herramienta para el facilitador.

## Reglas del proceso que el módulo implementa

- Daily diaria, **≤15 min**, arranca **9:05**, no se reinicia por rezagados.
- **Pre-update** por persona antes de empezar: *Hoy (1–2 bullets)*, *Barrera(s)*,
  *Ayuda concreta*, *Link al ticket*.
- **Orden de oradores:** primero los **bloqueados** (tienen Barrera), luego el
  resto. El usuario pidió además **randomizar** quién arranca → el módulo
  randomiza el orden y respeta "bloqueados primero" como capa opcional.
- **Timebox por persona 60–70s** con **timer visible** y aviso al límite.
- **1 repregunta máx.**; los debates se derivan al *After Daily*.
- **Barreras = subtareas "Barrera"** en Jira con dueño y vencimiento.
- **Facilitador rota** cada día — ver [Rotación del facilitador](#rotación-del-facilitador).

## Guión minuto a minuto (lo refleja la UI)

| Tramo         | Fase en la app            |
|---------------|---------------------------|
| 00:00–00:30   | Apertura: validar pre-updates, arrancar timer global |
| 00:30–01:00   | Bloqueados primero: el sistema los lista arriba |
| 01:00–14:00   | Ronda de updates: una persona por pantalla, timer 60–70s, cuenta regresiva |
| 14:00–15:00   | Cierre: confirmar barreras nuevas, dueños, After Daily |

## Flujo en la herramienta

### 1. Carga del pre-update (el día anterior / antes de la daily)
Cada dev entra a "Mi daily" y carga tres bloques — **ayer**, **hoy** y
**barreras**. Los tres usan el mismo formato, así se carga siempre igual:

- **Ticket de Jira** como título del ítem. Se chequea contra Jira mientras se
  escribe (`GET /api/integrations/jira/issue/:key`), con un respiro entre teclas
  y sólo si la key tiene forma de key. Muestra el summary y el estado si existe,
  o avisa si no. Con `JIRA_ENABLED=false` aclara que no puede verificar en vez
  de dar un ✓ falso.
- **Comentario** libre debajo, en un campo grande.

Las horas no se piden: la imputación la sigue haciendo el equipo por fuera.

### 2. Sincronización con Jira
Al sincronizar, el backend agrega el **comentario al ticket de Jira**
(`jira_add_comment`) por cada ítem de "ayer". No toca worklogs: la daily sólo
comenta, la imputación de horas queda fuera del proceso.
> En el scaffold la sync está **stubbeada** (loguea y marca `syncedToJira`).
> Se activa con credenciales Jira en `server/.env`.

### 3. Modo facilitador (pantalla para proyectar)
0. La app ya sabe a quién le toca hoy (ver [rotación](#rotación-del-facilitador))
   y lo avisa al entrar; quien no facilita ve la pantalla en modo consulta.
1. El facilitador abre la sesión del día → la app junta los pre-updates
   (quien está de vacaciones o licencia no entra en la ronda).
2. Botón **"Randomizar orden"** → baraja participantes (bloqueados primero, opcional).
3. **Una persona a la vez en pantalla**, mostrando:
   - lo que hizo ayer (ticket + comentario),
   - lo que va a trabajar hoy,
   - sus barreras.
4. **Timer de 60–70s** con cuenta regresiva; al llegar a 0 avisa y se pasa al
   siguiente con "Siguiente".
5. Al cerrar, resumen de barreras nuevas para el After Daily.

## Rotación del facilitador

**Todo el equipo facilita, líderes incluidos, y cada día hábil tiene dueño.**
La pantalla de facilitador está en el menú de todos, no sólo del lead.

### Cómo se decide el turno

El turno se **calcula**, no se guarda: es el índice del día hábil desde una fecha
ancla (`DAILY_ROTATION_ANCHOR`), módulo la cantidad de personas activas
ordenadas por id. Dos motivos:

- Sobrevive a los reinicios del server (el store todavía es en memoria).
- El calendario a futuro es estable: cada uno puede ver con semanas de
  anticipación cuándo le toca.

El ancla marca además **dónde empieza una ronda**: conviene ponerla en el día en
que el equipo arranca a usar la app. Si entre el proceso anterior y el ancla
quedan días sueltos ya asignados a alguien, se siembran como reasignación manual
con `facilitatorOverrides` en el roster (`server/roster.json`).

Reglas:

| Situación | Qué pasa |
|---|---|
| Fin de semana | No laborable, sin facilitador. |
| Feriado cargado en el calendario | No laborable, sin facilitador. |
| La persona del turno está de vacaciones o licencia | Se pasa al siguiente disponible; queda registrado a quién se salteó. |
| Cambio manual (lead, o quien tiene el turno) | Gana sobre la rotación; se puede revertir. |
| Todo el equipo ausente | El día queda "sin facilitador" y lo avisa. |

Detalle fino: el índice cuenta **días de semana sin descontar feriados**. Si los
feriados corrieran la cuenta, agregar uno reacomodaría todos los turnos futuros
ya publicados; con este criterio el feriado simplemente no tiene daily.

> Limitación conocida: agregar o quitar personas del roster cambia el módulo y
> por lo tanto reacomoda los turnos futuros. Con persistencia (Entrega 3)
> conviene congelar las asignaciones ya publicadas.

### Rondas y numeración

Una **ronda** es una pasada completa por el roster: cuando el último expone, se
cierra y arranca la siguiente con el equipo que haya en ese momento. Sale de
dividir el índice de rotación por la cantidad de personas, así que no se guarda
ni hay que armarla a mano — el panel del facilitador la muestra entera, con la
fecha y el número de daily de cada turno.

La **daily** tiene además un correlativo propio (`#101`, `#102`, …). Si el
equipo venía contando dailies por otro medio (threads de un chat, una planilla),
esa numeración se empalma: se ancla el último valor conocido
(`DAILY_NUMBER_ANCHOR_DATE` / `DAILY_NUMBER_ANCHOR_VALUE`) y se sigue contando
días con daily desde ahí. A diferencia del índice de rotación, este contador
**sí descuenta feriados**: un día sin daily no consume número.

El número de ronda arranca donde venía la numeración previa del equipo, con
`DAILY_ROUNDS_BEFORE_ANCHOR` (rondas completas previas al ancla de rotación).
Los dos números son un dato de color para el equipo: no alimentan métricas.

> Los anclajes pueden ser aproximados sin problema: si la numeración vieja era
> informal y no hay un valor exacto que recuperar, se pone el mejor estimado y,
> si el equipo después quiere corregirlo, se tocan las variables y listo.

### Quién puede operar la daily

Correr la ronda (fijar orden, avanzar) lo puede hacer **quien facilita ese día o
un lead** — el lead queda habilitado para cubrir si el facilitador falta. El
resto del equipo ve la pantalla en modo consulta. Si el facilitador del día no
va a estar, el lead reasigna el día desde el calendario.

## Calendario del equipo

Vista mensual con el facilitador de cada día hábil más los eventos del equipo:

| Tipo | Efecto en la rotación | Quién lo carga |
|---|---|---|
| `vacaciones` / `licencia` | Saltea a esa persona; tampoco expone en la ronda. | Cada uno las suyas; el lead, las de cualquiera. |
| `feriado` | Día no laborable para todos. | Sólo el lead. |
| `reunion` | Ninguno (informativo). Admite hora y puede ser de una persona o de todo el equipo. | Cualquiera. |

Borrar un evento lo puede hacer quien lo creó, el dueño de la ausencia, o el lead.

## Endpoints (backend)

```
GET    /api/daily/today                  Sesión del día (o la crea) + facilitador + ronda
POST   /api/daily/today/entry            Upsert del pre-update del usuario actual
POST   /api/daily/today/randomize        Randomiza y fija el orden (facilitador del día o lead)
POST   /api/daily/today/advance          Avanza al siguiente orador
POST   /api/daily/entry/:id/sync-jira    Empuja los comentarios de ayer a Jira

GET    /api/calendar/facilitator/today   Quién facilita hoy + tus próximos turnos
GET    /api/calendar/facilitator/next    Próximos turnos de una persona
GET    /api/calendar?year=&month=        Mes completo: facilitador + eventos por día
GET    /api/calendar?from=&to=           Ídem por rango (máx. 366 días)
POST   /api/calendar/events              Crear vacaciones/licencia/feriado/reunión
DELETE /api/calendar/events/:id          Borrar evento
PUT    /api/calendar/facilitator/:date   Reasignar (o revertir con userId vacío)
GET    /api/calendar/rotation            Reparto crudo de la rotación (lead)
GET    /api/calendar/round?date=         Ronda completa: turnos, fechas y número de daily
```

## Métricas de la daily (del proceso)

Asistencia, puntualidad (9:05), resúmenes hechos, barreras totales, duración
total. El módulo las puede registrar por sesión y alimentan la vista del lead.
