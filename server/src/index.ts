import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {
  env,
  giteaEnabled,
  jiraEnabled,
  jiraWriteEnabled,
} from './config/env.js';
import authRoutes from './routes/auth.js';
import developerRoutes from './routes/developers.js';
import dailyRoutes from './routes/daily.js';
import integrationRoutes from './routes/integrations.js';
import calendarRoutes from './routes/calendar.js';
import { getSnapshot } from './services/gitea.js';

const app = express();

app.use(cors({ origin: env.clientOrigin }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    integrations: {
      gitea: giteaEnabled(),
      jira: jiraEnabled(),
      jiraWrite: jiraWriteEnabled(),
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/developers', developerRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/calendar', calendarRoutes);

/**
 * Front servido desde el mismo origen que la API. En desarrollo esto no corre
 * (el build no existe y el proxy de Vite resuelve `/api`); en el contenedor y
 * en cualquier deploy es lo que evita tener que montar un nginx o un IIS
 * adelante nada más que para servir tres archivos estáticos.
 */
const clientDist = process.env.CLIENT_DIST
  ? path.resolve(process.env.CLIENT_DIST)
  : path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../client/dist',
    );

app.use(express.static(clientDist));
// Rutas del SPA: todo lo que no sea /api cae en index.html y lo resuelve
// React Router del lado del navegador.
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port}`);
  console.log(
    `Integraciones — Gitea: ${giteaEnabled() ? 'real' : 'mock'}, ` +
      `Jira: ${jiraEnabled() ? 'real' : 'stub'}` +
      `${jiraEnabled() ? ` (escritura: ${jiraWriteEnabled() ? 'on' : 'off'})` : ''}`,
  );

  // Warm-up: la primera sync real tarda, mejor que no la pague el primer usuario.
  if (giteaEnabled()) {
    const started = Date.now();
    getSnapshot(true)
      .then((s) => {
        console.log(
          `[gitea] sync inicial: ${s.prs.length} PRs de ${s.repos.length} repos ` +
            `en ${((Date.now() - started) / 1000).toFixed(1)}s` +
            `${s.errors.length ? ` — ${s.errors.length} error(es)` : ''}`,
        );
        for (const err of s.errors.slice(0, 5)) console.warn(`[gitea]   ${err}`);
      })
      .catch((err) => console.warn('[gitea] sync inicial falló:', String(err)));
  }
});
