import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  env,
  giteaConfigured,
  giteaEnabled,
  jiraConfigured,
  jiraEnabled,
  jiraWriteEnabled,
} from '../config/env.js';
import { cachedSnapshot, getSnapshot, giteaPing } from '../services/gitea.js';
import { getIssue, jiraPing, searchUsers } from '../services/jira.js';
import { applyMapping, resolveIdentities } from '../services/mapping.js';
import { users } from '../data/store.js';

const router = Router();

/**
 * Estado de las integraciones. Lo consume el badge de la UI: sirve para saber
 * de un vistazo si lo que se está viendo es real o mock, y por qué.
 */
router.get('/status', requireAuth, async (_req, res) => {
  const snapshot = cachedSnapshot();
  const [gitea, jira] = await Promise.all([
    giteaEnabled() ? giteaPing() : Promise.resolve({ ok: false, error: 'deshabilitado' }),
    jiraEnabled() ? jiraPing() : Promise.resolve({ ok: false, error: 'deshabilitado' }),
  ]);

  res.json({
    gitea: {
      enabled: giteaEnabled(),
      configured: giteaConfigured(),
      baseUrl: env.gitea.baseUrl,
      repos: env.gitea.orgs.length ? `org: ${env.gitea.orgs.join(', ')}` : env.gitea.repos,
      windowMonths: env.gitea.windowMonths,
      fetchReviews: env.gitea.fetchReviews,
      fetchSizes: env.gitea.fetchSizes,
      ...gitea,
    },
    jira: {
      enabled: jiraEnabled(),
      writeEnabled: jiraWriteEnabled(),
      configured: jiraConfigured(),
      baseUrl: env.jira.baseUrl || null,
      ...jira,
    },
    snapshot: snapshot
      ? {
          mode: snapshot.mode,
          syncedAt: snapshot.syncedAt,
          durationMs: snapshot.durationMs,
          prs: snapshot.prs.length,
          repos: snapshot.repos.length,
          truncated: snapshot.truncated,
          errors: snapshot.errors,
        }
      : null,
  });
});

/** Fuerza una sync ignorando el TTL — solo lead. */
router.post('/sync', requireAuth, requireRole('lead'), async (_req, res) => {
  const snapshot = await getSnapshot(true);
  res.json({
    mode: snapshot.mode,
    syncedAt: snapshot.syncedAt,
    durationMs: snapshot.durationMs,
    repos: snapshot.repos,
    prs: snapshot.prs.length,
    truncated: snapshot.truncated,
    errors: snapshot.errors,
  });
});

/** Mapeo actual app ↔ Gitea ↔ Jira. */
router.get('/mapping', requireAuth, requireRole('lead'), (_req, res) => {
  res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      giteaLogin: u.giteaLogin,
      jiraAccountId: u.jiraAccountId ?? null,
      jiraMatch: u.jiraMatch ?? 'none',
    })),
    emailDomain: env.jira.emailDomain,
  });
});

/** Sugerencias de identidad (no persiste nada) — solo lead. */
router.post('/mapping/resolve', requireAuth, requireRole('lead'), async (_req, res) => {
  const { suggestions, errors } = await resolveIdentities();
  res.json({ suggestions, errors });
});

/** Confirma el mapeo de un usuario — solo lead. */
router.put('/mapping/:userId', requireAuth, requireRole('lead'), (req, res) => {
  const { giteaLogin, jiraAccountId } = req.body ?? {};
  const user = applyMapping(req.params.userId, { giteaLogin, jiraAccountId });
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }
  res.json({
    user: {
      id: user.id,
      name: user.name,
      giteaLogin: user.giteaLogin,
      jiraAccountId: user.jiraAccountId ?? null,
      jiraMatch: user.jiraMatch ?? 'none',
    },
  });
});

/** Búsqueda libre de usuarios Jira, para resolver ambigüedades a mano. */
router.get('/jira/users', requireAuth, requireRole('lead'), async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  if (!query) {
    res.status(400).json({ error: 'Falta el parámetro q' });
    return;
  }
  res.json({ users: await searchUsers(query) });
});

/** Validación de un ticket antes de sincronizar la daily. */
router.get('/jira/issue/:key', requireAuth, async (req, res) => {
  const result = await getIssue(req.params.key.toUpperCase());
  res.status(result.ok ? 200 : 404).json(result);
});

export default router;
