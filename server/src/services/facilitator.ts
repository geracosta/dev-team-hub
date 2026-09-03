import { env } from '../config/env.js';
import {
  calendarEvents,
  facilitatorOverrides,
  findUserById,
  rotationRoster,
} from '../data/store.js';
import {
  ABSENCE_TYPES,
  type CalendarDay,
  type CalendarEvent,
  type FacilitatorAssignment,
  type FacilitatorRound,
  type RoundEntry,
  type SkippedFacilitator,
} from '../types.js';

/**
 * Rotación del facilitador de la daily.
 *
 * Todo el equipo facilita, líderes incluidos, y cada día hábil tiene dueño.
 *
 * El turno se **calcula**, no se guarda: es el índice del día hábil desde una
 * fecha ancla, módulo la cantidad de personas. Dos razones:
 *  - Sobrevive a los reinicios del server (el store todavía es en memoria).
 *  - El calendario a futuro es estable y predecible: cada uno puede ver con
 *    semanas de anticipación cuándo le toca.
 *
 * Decisión fina: el índice cuenta **días de semana**, sin descontar feriados. Si
 * los feriados corrieran la cuenta, agregar un feriado reacomodaría todos los
 * turnos futuros ya publicados. Con este criterio, un feriado simplemente no
 * tiene daily y ese turno se pierde.
 *
 * Las ausencias sí se esquivan (se pasa al siguiente disponible), pero no mueven
 * el índice: al día siguiente la rotación sigue donde correspondía.
 */

const DAY_MS = 864e5;

export const toKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/** Parsea YYYY-MM-DD como fecha local (no UTC, para no correrse un día). */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export const isValidKey = (key: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(fromKey(key).getTime());

export function isWeekend(key: string): boolean {
  const day = fromKey(key).getDay();
  return day === 0 || day === 6;
}

/** Días de semana (lun–vie) transcurridos entre dos fechas, sin contar la de inicio. */
function weekdaysBetween(fromIso: string, toIso: string): number {
  const start = fromKey(fromIso);
  const end = fromKey(toIso);
  const sign = end >= start ? 1 : -1;
  const a = sign > 0 ? start : end;
  const b = sign > 0 ? end : start;

  const fullWeeks = Math.floor((b.getTime() - a.getTime()) / (7 * DAY_MS));
  let count = fullWeeks * 5;
  const cursor = new Date(a.getTime() + fullWeeks * 7 * DAY_MS);
  while (cursor < b) {
    cursor.setDate(cursor.getDate() + 1);
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) count += 1;
  }
  return count * sign;
}

const overlaps = (event: CalendarEvent, key: string) =>
  event.from <= key && key <= event.to;

export function eventsOn(key: string): CalendarEvent[] {
  return [...calendarEvents.values()]
    .filter((e) => overlaps(e, key))
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));
}

/** Feriado = no laborable para todo el equipo. */
function holidayOn(key: string): CalendarEvent | undefined {
  return eventsOn(key).find((e) => e.type === 'feriado');
}

function absenceFor(userId: string, key: string): CalendarEvent | undefined {
  return eventsOn(key).find(
    (e) => e.userId === userId && ABSENCE_TYPES.includes(e.type),
  );
}

export function isAbsent(userId: string, key: string): boolean {
  return Boolean(absenceFor(userId, key));
}

/** Quién facilita en una fecha dada. */
export function facilitatorFor(key: string): FacilitatorAssignment {
  const base: FacilitatorAssignment = { date: key, source: 'rotacion', skipped: [] };

  if (isWeekend(key)) {
    return { ...base, source: 'no-laborable', nonWorkingReason: 'Fin de semana' };
  }
  const holiday = holidayOn(key);
  if (holiday) {
    return { ...base, source: 'no-laborable', nonWorkingReason: holiday.title };
  }

  const roster = rotationRoster();
  const index = weekdaysBetween(env.daily.rotationAnchor, key);
  // El módulo de JS puede dar negativo para fechas previas al ancla.
  const start = roster.length
    ? ((index % roster.length) + roster.length) % roster.length
    : 0;

  // Numeración: llegado acá el día tiene daily (fin de semana y feriado ya
  // cortaron arriba), así que el correlativo aplica sí o sí.
  const numbers = {
    dailyNumber: dailyNumberFor(key),
    roundNumber: roster.length ? roundNumberAt(index, roster.length) : undefined,
    positionInRound: roster.length ? start + 1 : undefined,
  };

  // Un cambio manual gana siempre, incluso si la persona está ausente: si el
  // lead lo asignó a mano, sabe lo que hace.
  const override = facilitatorOverrides.get(key);
  if (override) {
    const user = findUserById(override);
    if (user) {
      return { ...base, ...numbers, source: 'override', userId: user.id, userName: user.name };
    }
    facilitatorOverrides.delete(key); // usuario borrado: cae a la rotación
  }

  if (!roster.length) {
    return {
      ...base,
      ...numbers,
      source: 'sin-disponibles',
      nonWorkingReason: 'Sin personas activas',
    };
  }

  const skipped: SkippedFacilitator[] = [];
  for (let step = 0; step < roster.length; step++) {
    const candidate = roster[(start + step) % roster.length];
    const absence = absenceFor(candidate.id, key);
    if (!absence) {
      return {
        ...base,
        ...numbers,
        userId: candidate.id,
        userName: candidate.name,
        skipped,
      };
    }
    skipped.push({
      userId: candidate.id,
      userName: candidate.name,
      reason: absence.type === 'vacaciones' ? 'vacaciones' : 'licencia',
    });
  }

  return {
    ...base,
    ...numbers,
    source: 'sin-disponibles',
    skipped,
    nonWorkingReason: 'Todo el equipo está ausente',
  };
}

export function facilitatorToday(): FacilitatorAssignment {
  return facilitatorFor(toKey(new Date()));
}

/** Días del rango con su facilitador y sus eventos. */
export function calendarRange(fromIso: string, toIso: string): CalendarDay[] {
  const days: CalendarDay[] = [];
  const cursor = fromKey(fromIso);
  const end = fromKey(toIso);
  // Tope defensivo: el endpoint ya limita el rango, pero no queremos un loop
  // infinito si llega algo raro.
  for (let i = 0; cursor <= end && i < 400; i++) {
    const key = toKey(cursor);
    days.push({
      ...facilitatorFor(key),
      weekend: isWeekend(key),
      events: eventsOn(key),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Próximos turnos de una persona, para "cuándo me toca". */
export function nextTurnsFor(
  userId: string,
  limit = 3,
  horizonDays = 120,
): string[] {
  const out: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < horizonDays && out.length < limit; i++) {
    const key = toKey(cursor);
    if (facilitatorFor(key).userId === userId) out.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** ¿Puede esta persona correr la daily de hoy? El facilitador del día o un lead. */
export function canFacilitate(userId: string, role: string): boolean {
  if (role === 'lead') return true;
  return facilitatorToday().userId === userId;
}

// ---------------------------------------------------------------------------
// Numeración: correlativo de daily y de ronda
// ---------------------------------------------------------------------------

/**
 * Feriados que caen en día de semana dentro de (from, to]. Es el mismo
 * intervalo semiabierto que cuenta `weekdaysBetween`, así restarlos da los días
 * que realmente tuvieron daily.
 */
function holidayWeekdaysBetween(fromIso: string, toIso: string): number {
  const days = new Set<string>();
  for (const event of calendarEvents.values()) {
    if (event.type !== 'feriado') continue;
    const cursor = fromKey(event.from);
    const end = fromKey(event.to);
    for (let i = 0; cursor <= end && i < 400; i++) {
      const day = toKey(cursor);
      if (day > fromIso && day <= toIso && !isWeekend(day)) days.add(day);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return days.size;
}

/** Días con daily entre dos fechas: días hábiles menos feriados. Con signo. */
function dailiesBetween(fromIso: string, toIso: string): number {
  const weekdays = weekdaysBetween(fromIso, toIso);
  if (weekdays === 0) return 0;
  const sign = weekdays > 0 ? 1 : -1;
  const [lo, hi] = sign > 0 ? [fromIso, toIso] : [toIso, fromIso];
  return sign * (Math.abs(weekdays) - holidayWeekdaysBetween(lo, hi));
}

/**
 * Correlativo de la daily de esa fecha, o undefined si ese día no hay daily.
 *
 * Se cuenta desde un ancla calibrada (`DAILY_NUMBER_ANCHOR_*`) en vez de
 * guardarse: el número sobrevive a los reinicios y es estable hacia adelante.
 * Ojo con las fechas muy anteriores al ancla: los feriados viejos no están
 * cargados en el calendario, así que hacia atrás el número se va yendo de rango.
 */
export function dailyNumberFor(key: string): number | undefined {
  if (isWeekend(key) || holidayOn(key)) return undefined;
  return env.daily.numberAnchorValue + dailiesBetween(env.daily.numberAnchorDate, key);
}

/**
 * Ronda a la que pertenece un índice de rotación. Una ronda es una pasada
 * completa por el roster, así que sale de dividir el índice por la cantidad de
 * personas. `roundsBeforeAnchor` acomoda la numeración para que empalme con las
 * rondas que el equipo venía armando a mano antes de tener la app.
 */
function roundNumberAt(index: number, size: number): number {
  return Math.floor(index / size) + env.daily.roundsBeforeAnchor + 1;
}

/**
 * Fecha del día hábil número `index` contando desde el ancla de rotación
 * (índice 0 = el ancla). Es la inversa de `weekdaysBetween`.
 */
function dateForWeekdayIndex(index: number): string {
  const anchor = fromKey(env.daily.rotationAnchor);
  // Posición del ancla dentro de su semana laboral (lunes = 0). Si el ancla
  // cayera en fin de semana la tratamos como lunes, que es lo que asume el
  // resto del cálculo.
  const anchorDow = anchor.getDay();
  const anchorSlot = anchorDow >= 1 && anchorDow <= 5 ? anchorDow - 1 : 0;
  const monday = new Date(anchor.getTime() - anchorSlot * DAY_MS);

  const slot = anchorSlot + index;
  const weeks = Math.floor(slot / 5);
  const rest = ((slot % 5) + 5) % 5;
  const date = new Date(monday.getTime() + weeks * 7 * DAY_MS);
  date.setDate(date.getDate() + rest);
  return toKey(date);
}

/**
 * La ronda que contiene una fecha, con sus turnos. Es lo que reemplaza a la
 * lista que se pegaba a mano en el chat: quién expone cada día, en qué orden y
 * qué número de daily le toca.
 */
export function roundFor(key: string): FacilitatorRound | null {
  const roster = rotationRoster();
  if (!roster.length) return null;

  const index = weekdaysBetween(env.daily.rotationAnchor, key);
  // Piso de la ronda: el índice del primer turno de esta pasada.
  const first = Math.floor(index / roster.length) * roster.length;
  const today = toKey(new Date());

  const entries: RoundEntry[] = roster.map((user, position) => {
    const date = dateForWeekdayIndex(first + position);
    const assignment = facilitatorFor(date);
    return {
      date,
      position: position + 1,
      userId: user.id,
      userName: user.name,
      effectiveUserId: assignment.userId,
      effectiveUserName: assignment.userName,
      dailyNumber: assignment.dailyNumber,
      nonWorkingReason: assignment.nonWorkingReason,
      status: date === today ? 'hoy' : date < today ? 'pasada' : 'pendiente',
    };
  });

  return {
    number: roundNumberAt(index, roster.length),
    size: roster.length,
    from: entries[0].date,
    to: entries[entries.length - 1].date,
    entries,
  };
}

/** La ronda en curso. */
export function currentRound(): FacilitatorRound | null {
  return roundFor(toKey(new Date()));
}
