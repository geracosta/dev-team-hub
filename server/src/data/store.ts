import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  User,
  DailySession,
  DailyEntry,
  CalendarEvent,
} from '../types.js';

/**
 * Store en memoria para el scaffold. Se reinicia con el server.
 * En producción esto pasa a una base de datos (ver docs/ROADMAP.md).
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
export const dailySessions = new Map<string, DailySession>();
// Entries indexadas por id.
export const dailyEntries = new Map<string, DailyEntry>();

export const entriesForSession = (sessionId: string) =>
  [...dailyEntries.values()].filter((e) => e.sessionId === sessionId);

// Calendario del equipo: vacaciones, licencias, feriados y reuniones.
export const calendarEvents = new Map<string, CalendarEvent>();

/** Cambios manuales de facilitador: fecha (YYYY-MM-DD) -> userId. */
export const facilitatorOverrides = new Map<string, string>();

// Overrides sembrados desde el roster (p. ej. huecos al migrar de un proceso
// anterior). Van en el JSON porque el store todavía es en memoria y si no se
// perderían en cada reinicio; con persistencia (Entrega 3) se cargan una vez.
for (const [date, login] of Object.entries(roster.facilitatorOverrides ?? {})) {
  const user = findUserByGiteaLogin(login);
  if (user) facilitatorOverrides.set(date, user.id);
  else console.warn(`[roster] override ${date}: login desconocido "${login}"`);
}
