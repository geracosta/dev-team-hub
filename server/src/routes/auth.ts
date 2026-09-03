import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { findUserByEmail, users } from '../data/store.js';
import { requireAuth } from '../middleware/auth.js';
import type { PublicUser } from '../types.js';

const router = Router();

const toPublic = (u: (typeof users)[number]): PublicUser => {
  const { password: _pw, ...rest } = u;
  return rest;
};

/**
 * Cuentas de ejemplo para la pantalla de login. Existe sólo mientras la auth
 * sea de scaffold (password compartida): así la lista no se desincroniza del
 * roster cada vez que cambia. Con AUTH_DEMO_MODE=false no devuelve nada, que es
 * lo que corresponde cuando entre SSO/LDAP (Entrega 4).
 */
router.get('/demo-users', (_req, res) => {
  if (!env.authDemoMode) {
    res.json({ demoMode: false, users: [] });
    return;
  }
  const lead = users.find((u) => u.role === 'lead');
  const devs = users.filter((u) => u.role === 'developer').slice(0, 3);
  res.json({
    demoMode: true,
    password: 'demo',
    users: [...(lead ? [lead] : []), ...devs].map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
    })),
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const user = findUserByEmail(String(email ?? ''));
  if (!user || user.password !== password) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }
  const token = jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: '12h' },
  );
  res.json({ token, user: toPublic(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = users.find((u) => u.id === req.auth!.sub);
  if (!user) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  res.json({ user: toPublic(user) });
});

// Listado liviano para selects (sin password). Útil en la vista del lead.
router.get('/users', requireAuth, (_req, res) => {
  res.json({ users: users.map(toPublic) });
});

export default router;
