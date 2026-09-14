import { Router } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  canFacilitate,
  currentRound,
  facilitatorToday,
  isAbsent,
} from '../services/facilitator.js';
import {
  dailySessions,
  dailyEntries,
  entriesForSession,
  developers,
  findUserById,
} from '../data/store.js';
import { addComment } from '../services/jira.js';
import type { DailySession, DailyEntry, JiraSyncItem } from '../types.js';

const router = Router();

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

function getOrCreateToday(): DailySession {
  const date = todayKey();
  let session = dailySessions.get(date);
  if (!session) {
    session = {
      id: `daily-${date}`,
      date,
      status: 'preparing',
      order: [],
      currentIndex: 0,
      perPersonSeconds: 70, // 60–70s por persona (proceso oficial)
      // El facilitador sale de la rotación, no de quién abre la pantalla.
      facilitatorId: facilitatorToday().userId,
    };
    dailySessions.set(date, session);
  }
  return session;
}

/**
 * Correr la daily (fijar orden, avanzar) lo puede hacer quien facilita ese día
 * o un lead. Todo el equipo rota como facilitador, así que esto ya no es un
 * permiso por rol; el lead queda habilitado para cubrir si el facilitador falta.
 */
const requireFacilitator: RequestHandler = (req, res, next) => {
  if (!canFacilitate(req.auth!.sub, req.auth!.role)) {
    const today = facilitatorToday();
    res.status(403).json({
      error: today.userName
        ? `Hoy facilita ${today.userName}`
        : (today.nonWorkingReason ?? 'Hoy no hay daily'),
      facilitator: today,
    });
    return;
  }
  next();
};

function entryFor(sessionId: string, userId: string): DailyEntry | undefined {
  return entriesForSession(sessionId).find((e) => e.userId === userId);
}

/** Sesión del día + entries + datos de participantes (para el facilitador). */
router.get('/today', requireAuth, (req, res) => {
  const session = getOrCreateToday();
  const entries = entriesForSession(session.id).map((e) => ({
    ...e,
    user: (() => {
      const u = findUserById(e.userId);
      return u ? { id: u.id, name: u.name } : null;
    })(),
  }));
  const facilitator = facilitatorToday();
  res.json({
    session,
    entries,
    facilitator,
    canFacilitate: canFacilitate(req.auth!.sub, req.auth!.role),
    // La ronda entera viaja acá para que el panel del facilitador no tenga que
    // pedirla aparte: es la lista que antes se pegaba a mano en el chat.
    round: currentRound(),
  });
});

/** Upsert del pre-update del usuario autenticado. */
router.post('/today/entry', requireAuth, (req, res) => {
  const session = getOrCreateToday();
  const userId = req.auth!.sub;
  const { yesterday = [], today = [], barreras = [] } = req.body ?? {};

  let entry = entryFor(session.id, userId);
  if (!entry) {
    entry = {
      id: `entry-${session.id}-${userId}`,
      sessionId: session.id,
      userId,
      yesterday: [],
      today: [],
      barreras: [],
      syncedToJira: false,
    };
  }
  entry.yesterday = yesterday;
  entry.today = today;
  entry.barreras = barreras;
  entry.syncedToJira = false; // cambió → hay que re-sincronizar
  dailyEntries.set(entry.id, entry);
  res.json({ entry });
});

/**
 * Randomiza el orden de exposición. "Bloqueados primero" opcional:
 * si blockedFirst=true, quienes tienen barreras quedan al inicio.
 */
router.post('/today/randomize', requireAuth, requireFacilitator, (req, res) => {
  const session = getOrCreateToday();
  const blockedFirst = req.body?.blockedFirst !== false; // default true
  const entries = entriesForSession(session.id);
  const participantIds = (
    entries.length ? entries.map((e) => e.userId) : developers().map((u) => u.id)
    // Quien está de vacaciones o licencia no expone.
  ).filter((id) => !isAbsent(id, session.date));

  // Shuffle determinístico-no: usamos un barajado simple basado en orden actual.
  const shuffled = shuffle(participantIds);

  let order = shuffled;
  if (blockedFirst) {
    const hasBarrera = (id: string) =>
      (entryFor(session.id, id)?.barreras.length ?? 0) > 0;
    order = [
      ...shuffled.filter(hasBarrera),
      ...shuffled.filter((id) => !hasBarrera(id)),
    ];
  }

  session.order = order;
  session.currentIndex = 0;
  // facilitatorId ya viene de la rotación; no lo sobreescribimos con quien
  // apretó el botón (puede ser un lead cubriendo al facilitador del día).
  session.status = 'running';
  dailySessions.set(session.date, session); // persistir la mutación
  res.json({ session });
});

/** Avanza al siguiente orador (o cierra la sesión al terminar). */
router.post('/today/advance', requireAuth, requireFacilitator, (_req, res) => {
  const session = getOrCreateToday();
  if (session.currentIndex < session.order.length - 1) {
    session.currentIndex += 1;
  } else {
    session.status = 'closed';
  }
  dailySessions.set(session.date, session); // persistir la mutación
  res.json({ session });
});

/**
 * Empuja los comentarios "qué se hizo ayer" al ticket en Jira.
 *
 * Sólo el comentario: la imputación de horas la sigue haciendo el equipo por
 * fuera, así que la daily no toca worklogs.
 *
 * Cada ticket se reporta por separado: si uno falla (key inexistente, sin
 * permisos), los demás igual se sincronizan y la entry queda marcada como no
 * sincronizada para poder reintentar.
 */
router.post('/entry/:id/sync-jira', requireAuth, async (req, res) => {
  const entry = dailyEntries.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Entry no encontrada' });
    return;
  }
  // Cada uno sincroniza lo suyo; el lead puede empujar la de cualquiera.
  if (entry.userId !== req.auth!.sub && req.auth!.role !== 'lead') {
    res.status(403).json({ error: 'Solo podés sincronizar tu propio pre-update' });
    return;
  }

  const results: JiraSyncItem[] = [];
  for (const item of entry.yesterday) {
    if (!item.ticketKey || !item.comment) continue;
    const ticketKey = item.ticketKey.toUpperCase();
    results.push({ ticketKey, comment: await addComment(ticketKey, item.comment) });
  }

  const allOk = results.every((r) => r.comment.ok);
  entry.syncedToJira = allOk;
  entry.syncedAt = new Date().toISOString();
  entry.lastSyncResult = results;
  dailyEntries.set(entry.id, entry);

  res.status(allOk ? 200 : 207).json({
    synced: allOk,
    stubbed: results.every((r) => r.comment.stubbed),
    results,
  });
});

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default router;
