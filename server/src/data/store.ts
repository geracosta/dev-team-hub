import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistentMap } from './db.js';
import type {
  User,
  DailySession,
  DailyEntry,
  CalendarEvent,
} from '../types.js';

/**
 * Store de la app: Maps en memoria espejados a SQLite (ver db.ts), así los
 * datos sobreviven a los reinicios sin cambiar la forma de usarlos.
 *
 * El roster del equipo vive en un JSON fuera del código: `roster.json` en la
 * raíz del server (gitignoreado, para no versionar datos de personas reales) o
 * la ruta que indique `ROSTER_FILE`. Sin ninguno de los dos se usa
 * `roster.example.json`, que trae un equipo de demostración.
 *
 * `giteaLogin` es el login real en Gitea; el mail se deriva como
 * `<login>@<emailDomain>` (o viene explícito por persona), que es lo que usa la
 * resolución de identidades contra Jira — en Gitea los mails de terceros vienen
 * enmascarados como `@noreply.localhost`.
 *
 * Auth sigue siendo de scaffold: password en texto plano e igual para todos.
 * Reemplazar por SSO/LDAP antes de cualquier uso real (Entrega 4).
 */

const DEMO_PASSWORD = 'demo';

interface RosterPerson {
  login: string;
  name: string;
  role?: 'developer' | 'lead';
  email?: string;
  jiraAccountId?: string;
}

interface RosterFile {
  emailDomain?: string;
  people: RosterPerson[];
  /** Facilitador fijado a mano: fecha (YYYY-MM-DD) -> login. */
  facilitatorOverrides?: Record<string, string>;
}

// src/data y dist/data están a la misma profundidad, así que ../../ llega a la
// raíz del server tanto en dev (tsx) como compilado.
const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const rosterPath = (() => {
  if (process.env.ROSTER_FILE) return path.resolve(process.env.ROSTER_FILE);
  const own = path.join(serverRoot, 'roster.json');
  return existsSync(own) ? own : path.join(serverRoot, 'roster.example.json');
})();

const roster: RosterFile = JSON.parse(readFileSync(rosterPath, 'utf8'));
if (!Array.isArray(roster.people) || roster.people.length === 0) {
  throw new Error(`Roster sin personas: ${rosterPath}`);
}
console.log(
  `[roster] ${roster.people.length} personas desde ${path.basename(rosterPath)}`,
);

const emailDomain = roster.emailDomain ?? 'example.com';

export const users: User[] = roster.people.map((seed, i) => ({
  id: `u${i + 1}`,
  name: seed.name,
  email: seed.email ?? `${seed.login}@${emailDomain}`,
  password: DEMO_PASSWORD,
  role: seed.role ?? 'developer',
  giteaLogin: seed.login,
  jiraAccountId: seed.jiraAccountId,
  jiraMatch: seed.jiraAccountId ? 'manual' : 'none',
  active: true,
}));

/**
 * Overrides de identidad hechos en runtime desde la pantalla de mapeo
 * (login de Gitea corregido, accountId de Jira confirmado). Persisten aparte
 * del roster y le ganan: el roster siembra, el mapeo confirmado manda.
 * Clave: email, que es lo más estable ante cambios de login.
 */
interface IdentityOverride {
  giteaLogin?: string;
  jiraAccountId?: string;
  jiraMatch?: User['jiraMatch'];
}

const identityOverrides = new PersistentMap<IdentityOverride>('user_identities');

for (const [email, ident] of identityOverrides) {
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) continue;
  if (ident.giteaLogin) user.giteaLogin = ident.giteaLogin;
  if ('jiraAccountId' in ident) user.jiraAccountId = ident.jiraAccountId;
  if (ident.jiraMatch) user.jiraMatch = ident.jiraMatch;
}

/** Llamar después de mutar la identidad de un user (ver services/mapping.ts). */
export const persistIdentity = (user: User): void => {
  identityOverrides.set(user.email, {
    giteaLogin: user.giteaLogin,
    jiraAccountId: user.jiraAccountId,
    jiraMatch: user.jiraMatch,
  });
};

export const findUserByEmail = (email: string) =>
  users.find((u) => u.email.toLowerCase() === email.toLowerCase());

export const findUserById = (id: string) => users.find((u) => u.id === id);

export const findUserByGiteaLogin = (login: string) =>
  users.find((u) => u.giteaLogin === login);

export const developers = () => users.filter((u) => u.role === 'developer');

/**
 * Roster de la rotación de facilitador: todas las personas activas, incluidos
 * los líderes. El orden es estable (por id) porque el turno se calcula a partir
 * del índice del día hábil: si el orden cambiara, cambiarían los turnos ya
 * publicados en el calendario.
 */
export const rotationRoster = () =>
  users.filter((u) => u.active !== false).sort((a, b) => a.id.localeCompare(b.id));

// Sesiones de daily indexadas por fecha (YYYY-MM-DD).
export const dailySessions = new PersistentMap<DailySession>('daily_sessions');
// Entries indexadas por id.
export const dailyEntries = new PersistentMap<DailyEntry>('daily_entries');

export const entriesForSession = (sessionId: string) =>
  [...dailyEntries.values()].filter((e) => e.sessionId === sessionId);

// Calendario del equipo: vacaciones, licencias, feriados y reuniones.
export const calendarEvents = new PersistentMap<CalendarEvent>('calendar_events');

/** Cambios manuales de facilitador: fecha (YYYY-MM-DD) -> userId. */
export const facilitatorOverrides = new PersistentMap<string>(
  'facilitator_overrides',
);

// Overrides sembrados desde el roster (p. ej. huecos al migrar de un proceso
// anterior). Sólo siembran fechas que la base no conoce, para no pisar cambios
// hechos desde el calendario. Contracara: un override borrado desde la UI
// vuelve en el próximo arranque si sigue en el roster — para sacarlo en serio,
// sacarlo del roster.json.
for (const [date, login] of Object.entries(roster.facilitatorOverrides ?? {})) {
  if (facilitatorOverrides.has(date)) continue;
  const user = findUserByGiteaLogin(login);
  if (user) facilitatorOverrides.set(date, user.id);
  else console.warn(`[roster] override ${date}: login desconocido "${login}"`);
}
