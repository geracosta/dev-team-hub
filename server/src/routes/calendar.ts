import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  calendarEvents,
  facilitatorOverrides,
  findUserById,
  rotationRoster,
} from '../data/store.js';
import {
  calendarRange,
  facilitatorFor,
  facilitatorToday,
  fromKey,
  isValidKey,
  nextTurnsFor,
  roundFor,
  toKey,
} from '../services/facilitator.js';
import {
  ABSENCE_TYPES,
  type CalendarEvent,
  type CalendarEventType,
} from '../types.js';

const router = Router();

const TYPES: CalendarEventType[] = ['vacaciones', 'licencia', 'feriado', 'reunion'];

/** Quién facilita hoy + los próximos turnos del usuario autenticado. */
router.get('/facilitator/today', requireAuth, (req, res) => {
  const today = facilitatorToday();
  res.json({
    today,
    isMine: today.userId === req.auth!.sub,
    myNextTurns: nextTurnsFor(req.auth!.sub, 3),
  });
});


/**
 * La ronda de facilitadores: una pasada completa por el roster, con la fecha y
 * el número de daily de cada turno. Es lo que reemplaza a la lista que el
 * equipo pegaba a mano en el chat, así que la ve todo el equipo, no sólo el lead.
 * Acepta `date` para mirar la ronda de otro momento.
 */
router.get('/round', requireAuth, (req, res) => {
  const date = req.query.date ? String(req.query.date) : toKey(new Date());
  if (!isValidKey(date)) {
    res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
    return;
  }
  const round = roundFor(date);
  if (!round) {
    res.status(409).json({ error: 'No hay personas activas en la rotación' });
    return;
  }
  res.json({ round, today: facilitatorToday() });
});
/** Turnos futuros de una persona (por defecto, el propio usuario). */
router.get('/facilitator/next', requireAuth, (req, res) => {
  const userId = String(req.query.userId ?? req.auth!.sub);
  const limit = Math.min(Number(req.query.limit ?? 5) || 5, 20);
  res.json({ userId, dates: nextTurnsFor(userId, limit) });
});

/**
 * Rango del calendario. Acepta `from`/`to` o `year`/`month` (1-12), en cuyo caso
 * devuelve el mes completo.
 */
router.get('/', requireAuth, (req, res) => {
  let from = String(req.query.from ?? '');
  let to = String(req.query.to ?? '');

  if (req.query.year && req.query.month) {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'year/month inválidos' });
      return;
    }
    from = toKey(new Date(year, month - 1, 1));
    to = toKey(new Date(year, month, 0)); // día 0 del mes siguiente = último de este
  }

  if (!isValidKey(from) || !isValidKey(to)) {
    res.status(400).json({ error: 'Rango inválido: usá from/to (YYYY-MM-DD) o year/month' });
    return;
  }
  if (fromKey(to) < fromKey(from)) {
    res.status(400).json({ error: '`to` es anterior a `from`' });
    return;
  }
  const spanDays = (fromKey(to).getTime() - fromKey(from).getTime()) / 864e5;
  if (spanDays > 366) {
    res.status(400).json({ error: 'El rango no puede superar 366 días' });
    return;
  }

  res.json({
    from,
    to,
    days: calendarRange(from, to),
    people: rotationRoster().map((u) => ({ id: u.id, name: u.name, role: u.role })),
  });
});

/**
 * Crea un evento.
 * - vacaciones/licencia: propias, o de cualquiera si sos lead.
 * - feriado: sólo lead (afecta a todo el equipo).
 * - reunion: cualquiera.
 */
router.post('/events', requireAuth, (req, res) => {
  const { type, title, from, to, userId, time, notes } = req.body ?? {};

  if (!TYPES.includes(type)) {
    res.status(400).json({ error: `type debe ser uno de: ${TYPES.join(', ')}` });
    return;
  }
  if (!isValidKey(String(from ?? ''))) {
    res.status(400).json({ error: '`from` debe ser YYYY-MM-DD' });
    return;
  }
  const end = to ? String(to) : String(from);
  if (!isValidKey(end)) {
    res.status(400).json({ error: '`to` debe ser YYYY-MM-DD' });
    return;
  }
  if (fromKey(end) < fromKey(String(from))) {
    res.status(400).json({ error: '`to` es anterior a `from`' });
    return;
  }
  if (time && !/^\d{2}:\d{2}$/.test(String(time))) {
    res.status(400).json({ error: '`time` debe ser HH:mm' });
    return;
  }

  const isLead = req.auth!.role === 'lead';
  const isAbsence = ABSENCE_TYPES.includes(type);

  let owner: string | undefined;
  if (isAbsence) {
    owner = String(userId ?? req.auth!.sub);
    if (owner !== req.auth!.sub && !isLead) {
      res.status(403).json({ error: 'Solo el lead puede cargar ausencias de otras personas' });
      return;
    }
    if (!findUserById(owner)) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
  } else if (type === 'feriado' && !isLead) {
    res.status(403).json({ error: 'Solo el lead puede cargar feriados' });
    return;
  } else if (type === 'reunion' && userId) {
    // Reunión de una persona en particular (ej. una entrevista).
    if (!findUserById(String(userId))) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    owner = String(userId);
  }

  const defaultTitle: Record<CalendarEventType, string> = {
    vacaciones: 'Vacaciones',
    licencia: 'Licencia',
    feriado: 'Feriado',
    reunion: 'Reunión',
  };

  const event: CalendarEvent = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title: String(title ?? '').trim() || defaultTitle[type as CalendarEventType],
    from: String(from),
    to: end,
    userId: owner,
    time: time ? String(time) : undefined,
    notes: notes ? String(notes) : undefined,
    createdBy: req.auth!.sub,
    createdAt: new Date().toISOString(),
  };
  calendarEvents.set(event.id, event);

  // Un feriado o una ausencia puede cambiar quién facilita esos días.
  res.status(201).json({ event, affected: calendarRange(event.from, event.to) });
});

/** Borra un evento: el autor, el dueño de la ausencia, o un lead. */
router.delete('/events/:id', requireAuth, (req, res) => {
  const event = calendarEvents.get(req.params.id);
  if (!event) {
    res.status(404).json({ error: 'Evento no encontrado' });
    return;
  }
  const isOwn = event.createdBy === req.auth!.sub || event.userId === req.auth!.sub;
  if (!isOwn && req.auth!.role !== 'lead') {
    res.status(403).json({ error: 'No podés borrar este evento' });
    return;
  }
  calendarEvents.delete(event.id);
  res.json({ deleted: true });
});

/**
 * Cambia el facilitador de un día. Lo puede hacer el lead, o la persona a la que
 * le toca (para pasarle el turno a alguien más).
 */
router.put('/facilitator/:date', requireAuth, (req, res) => {
  const date = req.params.date;
  if (!isValidKey(date)) {
    res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
    return;
  }
  const current = facilitatorFor(date);
  const isLead = req.auth!.role === 'lead';
  if (!isLead && current.userId !== req.auth!.sub) {
    res.status(403).json({ error: 'Solo el facilitador de ese día o el lead pueden cambiarlo' });
    return;
  }

  const { userId } = req.body ?? {};
  if (userId === null || userId === '') {
    facilitatorOverrides.delete(date);
    res.json({ assignment: facilitatorFor(date), reverted: true });
    return;
  }
  const user = findUserById(String(userId ?? ''));
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }
  facilitatorOverrides.set(date, user.id);
  res.json({ assignment: facilitatorFor(date) });
});

/** Vista de la rotación cruda, sin ausencias — útil para revisar el reparto. */
router.get('/rotation', requireAuth, requireRole('lead'), (_req, res) => {
  res.json({
    anchor: env.daily.rotationAnchor,
    roster: rotationRoster().map((u, i) => ({
      position: i + 1,
      id: u.id,
      name: u.name,
      role: u.role,
      nextTurns: nextTurnsFor(u.id, 2),
    })),
  });
});

export default router;
