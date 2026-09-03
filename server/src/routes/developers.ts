import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { developers, findUserById, users } from '../data/store.js';
import { getSnapshot } from '../services/gitea.js';
import { computeHealth, fixRatio, reviewMatrix } from '../services/metrics.js';
import type { SyncSnapshot } from '../types.js';

const router = Router();

/** Metadatos comunes para que la UI sepa si mira datos reales o mock. */
const meta = (s: SyncSnapshot) => ({
  mode: s.mode,
  syncedAt: s.syncedAt,
  windowFrom: s.windowFrom,
  repos: s.repos,
  reviewsFetched: s.reviewsFetched,
  sizesFetched: s.sizesFetched,
  degraded: s.errors.length > 0,
});

/** Salud del propio usuario autenticado. */
router.get('/me/health', requireAuth, async (req, res) => {
  const user = findUserById(req.auth!.sub);
  if (!user) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  const snapshot = await getSnapshot();
  res.json({
    health: {
      ...computeHealth(user.id, user.giteaLogin, snapshot.prs, snapshot.windowFrom),
      fixRatio: fixRatio(user.giteaLogin, snapshot.prs),
    },
    meta: meta(snapshot),
  });
});

/** Resumen del equipo — solo lead. Antes de /:id/health para no colisionar. */
router.get('/team/health', requireAuth, requireRole('lead'), async (_req, res) => {
  const snapshot = await getSnapshot();
  const team = developers().map((u) => ({
    user: { id: u.id, name: u.name },
    ...computeHealth(u.id, u.giteaLogin, snapshot.prs, snapshot.windowFrom),
  }));
  res.json({ team, meta: meta(snapshot) });
});

/** Heatmap dar/recibir reviews del equipo — solo lead. */
router.get('/team/reviews', requireAuth, requireRole('lead'), async (_req, res) => {
  const snapshot = await getSnapshot();
  res.json({
    matrix: reviewMatrix(users, snapshot.prs),
    people: users.map((u) => ({ login: u.giteaLogin, name: u.name })),
    meta: meta(snapshot),
  });
});

/** Salud de un dev específico — solo lead. */
router.get('/:id/health', requireAuth, requireRole('lead'), async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  const snapshot = await getSnapshot();
  res.json({
    health: {
      ...computeHealth(user.id, user.giteaLogin, snapshot.prs, snapshot.windowFrom),
      fixRatio: fixRatio(user.giteaLogin, snapshot.prs),
    },
    meta: meta(snapshot),
  });
});

/** PRs abiertos del usuario, para la tarjeta de "señales". */
router.get('/:id/pulls', requireAuth, async (req, res) => {
  const isSelf = req.params.id === req.auth!.sub;
  if (!isSelf && req.auth!.role !== 'lead') {
    res.status(403).json({ error: 'Solo el lead puede ver PRs de terceros' });
    return;
  }
  const user = findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  const snapshot = await getSnapshot();
  const pulls = snapshot.prs
    .filter((pr) => pr.authorLogin === user.giteaLogin)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50);
  res.json({ pulls, meta: meta(snapshot) });
});

export default router;
