import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env, giteaOauthEnabled } from '../config/env.js';
import {
  findUserByEmail,
  findUserByGiteaLogin,
  users,
} from '../data/store.js';
import { requireAuth } from '../middleware/auth.js';
import type { PublicUser, User } from '../types.js';

const router = Router();

const toPublic = (u: (typeof users)[number]): PublicUser => {
  const { password: _pw, ...rest } = u;
  return rest;
};

const signToken = (user: User) =>
  jwt.sign({ sub: user.id, role: user.role, name: user.name }, env.jwtSecret, {
    expiresIn: '12h',
  });

/**
 * Cuentas de ejemplo para la pantalla de login. Existe sólo mientras la auth
 * sea de scaffold (password compartida): así la lista no se desincroniza del
 * roster cada vez que cambia. Con AUTH_DEMO_MODE=false no devuelve nada, que es
 * lo que corresponde cuando entre SSO/LDAP (Entrega 4).
 */
router.get('/demo-users', (_req, res) => {
  const giteaOauth = giteaOauthEnabled();
  if (!env.authDemoMode) {
    res.json({ demoMode: false, giteaOauth, users: [] });
    return;
  }
  const lead = users.find((u) => u.role === 'lead');
  const devs = users.filter((u) => u.role === 'developer').slice(0, 3);
  res.json({
    demoMode: true,
    giteaOauth,
    password: 'demo',
    users: [...(lead ? [lead] : []), ...devs].map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
    })),
  });
});

router.post('/login', (req, res) => {
  // Login de scaffold con password compartida. Con el login real de Gitea
  // configurado + AUTH_DEMO_MODE=false queda deshabilitado del todo.
  if (!env.authDemoMode && giteaOauthEnabled()) {
    res.status(403).json({ error: 'Ingresá con tu cuenta de Gitea' });
    return;
  }
  const { email, password } = req.body ?? {};
  const user = findUserByEmail(String(email ?? ''));
  if (!user || user.password !== password) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }
  res.json({ token: signToken(user), user: toPublic(user) });
});

/**
 * Login real contra Gitea (OAuth2, authorization code). El server redirige a
 * Gitea, la persona se autentica ahí (con su 2FA si tiene) y Gitea vuelve al
 * callback con un code que se canjea por el usuario. Sólo entra quien está en
 * el roster: la identidad la da Gitea, el rol lo da roster.json.
 */
const oauthStates = new Map<string, number>(); // state -> vencimiento (ms)

router.get('/gitea/login', (_req, res) => {
  if (!giteaOauthEnabled()) {
    res.status(404).json({ error: 'Login con Gitea no configurado' });
    return;
  }
  const state = randomUUID();
  oauthStates.set(state, Date.now() + 10 * 60_000);
  const params = new URLSearchParams({
    client_id: env.gitea.oauthClientId,
    redirect_uri: `${env.publicUrl}/api/auth/gitea/callback`,
    response_type: 'code',
    state,
  });
  res.redirect(`${env.gitea.baseUrl}/login/oauth/authorize?${params}`);
});

router.get('/gitea/callback', async (req, res) => {
  // Los errores van al login del front como query, no como JSON pelado: esta
  // ruta la navega el browser, no el cliente HTTP de la SPA.
  const fail = (msg: string) =>
    res.redirect(`${env.clientOrigin}/login?error=${encodeURIComponent(msg)}`);

  if (!giteaOauthEnabled()) return fail('Login con Gitea no configurado');

  const { code, state } = req.query as { code?: string; state?: string };
  const expiry = state ? oauthStates.get(state) : undefined;
  if (state) oauthStates.delete(state);
  if (!code || !expiry || expiry < Date.now()) {
    return fail('Login vencido o inválido, probá de nuevo');
  }
  // Limpieza oportunista de states que nunca volvieron.
  for (const [s, exp] of oauthStates) if (exp < Date.now()) oauthStates.delete(s);

  try {
    const { data: tokenData } = await axios.post(
      `${env.gitea.baseUrl}/login/oauth/access_token`,
      {
        client_id: env.gitea.oauthClientId,
        client_secret: env.gitea.oauthClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${env.publicUrl}/api/auth/gitea/callback`,
      },
      { timeout: 10_000 },
    );
    const { data: giteaUser } = await axios.get<{ login: string }>(
      `${env.gitea.baseUrl}/api/v1/user`,
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        timeout: 10_000,
      },
    );
    const user = findUserByGiteaLogin(giteaUser.login);
    if (!user) {
      return fail(
        `${giteaUser.login} no está en el roster del equipo — pedile al lead que te agregue`,
      );
    }
    // El token viaja en el fragment (#), que no llega al server ni a los logs.
    res.redirect(`${env.clientOrigin}/login#token=${signToken(user)}`);
  } catch (err) {
    console.warn('[auth] OAuth Gitea falló:', String(err));
    return fail('No se pudo completar el login con Gitea');
  }
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
