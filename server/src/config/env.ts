import dotenv from 'dotenv';

dotenv.config();

const csv = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const port = num(process.env.PORT, 4000);

export const env = {
  port,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  /**
   * URL pública del server (sin barra final): es la base del redirect_uri de
   * OAuth, tiene que coincidir con la registrada en la app OAuth2 de Gitea.
   */
  publicUrl: trimSlash(process.env.PUBLIC_URL ?? `http://localhost:${port}`),
  /** Cuentas de ejemplo con password compartida. Apagar al pasar al login real. */
  authDemoMode: process.env.AUTH_DEMO_MODE !== 'false',
  daily: {
    /**
     * Fecha ancla de la rotación de facilitador. El turno de cada día es el
     * índice del día hábil desde acá, módulo la cantidad de personas, así que
     * el ancla también marca dónde **empieza** una ronda. Cambiarla reacomoda
     * toda la rotación: tocar sólo a propósito.
     */
    rotationAnchor: process.env.DAILY_ROTATION_ANCHOR ?? '2026-01-01',
    /**
     * Numeración correlativa de la daily. Si el equipo venía contando dailies
     * por otro medio antes de usar la app, se ancla el último valor conocido
     * (fecha + número) y se sigue contando desde ahí. Es un dato de color, no
     * alimenta ninguna métrica.
     */
    numberAnchorDate: process.env.DAILY_NUMBER_ANCHOR_DATE ?? '2026-01-01',
    numberAnchorValue: num(process.env.DAILY_NUMBER_ANCHOR_VALUE, 1),
    /**
     * Rondas completas del proceso anterior a `rotationAnchor` (una ronda = una
     * pasada entera por el roster): corre la numeración de ronda para que
     * empalme con la que el equipo ya venía usando. 0 si se arranca de cero.
     */
    roundsBeforeAnchor: num(process.env.DAILY_ROUNDS_BEFORE_ANCHOR, 0),
  },
  gitea: {
    enabled: process.env.GITEA_ENABLED === 'true',
    baseUrl: trimSlash(process.env.GITEA_BASE_URL ?? ''),
    token: process.env.GITEA_TOKEN ?? '',
    /**
     * App OAuth2 registrada en Gitea (Configuración → Aplicaciones) para el
     * login real: redirect_uri = <PUBLIC_URL>/api/auth/gitea/callback.
     * Independiente del token: el login funciona aunque las métricas no estén
     * configuradas, y al revés.
     */
    oauthClientId: process.env.GITEA_OAUTH_CLIENT_ID ?? '',
    oauthClientSecret: process.env.GITEA_OAUTH_CLIENT_SECRET ?? '',
    /** Si hay orgs, se descubren sus repos y se ignora la lista fija. */
    orgs: csv(process.env.GITEA_ORGS),
    /** Lista `owner/repo` a analizar. Obligatoria salvo que haya GITEA_ORGS. */
    repos: csv(process.env.GITEA_REPOS),
    /** Ventana de análisis; Gitea filtra por updated_at (`since`). */
    windowMonths: num(process.env.GITEA_WINDOW_MONTHS, 6),
    concurrency: num(process.env.GITEA_CONCURRENCY, 6),
    cacheTtlMinutes: num(process.env.GITEA_CACHE_TTL_MINUTES, 15),
    /** Reviews: 1 request por PR. Necesario para reviews dados/recibidos. */
    fetchReviews: process.env.GITEA_FETCH_REVIEWS !== 'false',
    /**
     * Tamaño de PR: otro request por PR. Gitea 1.21 devuelve additions y
     * deletions en null tanto en el listado como en el detalle del PR, así que
     * las líneas sólo salen de /pulls/{n}/files. Opt-in por costo.
     */
    fetchSizes: process.env.GITEA_FETCH_SIZES === 'true',
    /** Tope duro de PRs por sync, para no colgar el server con un org grande. */
    maxPrs: num(process.env.GITEA_MAX_PRS, 3000),
  },
  jira: {
    /** Lecturas contra Jira (validar tickets, resolver usuarios). */
    enabled: process.env.JIRA_ENABLED === 'true',
    /** Escrituras (comentarios y worklogs). Opt-in aparte y explícito. */
    writeEnabled: process.env.JIRA_WRITE_ENABLED === 'true',
    baseUrl: trimSlash(process.env.JIRA_BASE_URL ?? ''),
    email: process.env.JIRA_EMAIL ?? '',
    apiToken: process.env.JIRA_API_TOKEN ?? '',
    /**
     * Dominio corporativo para resolver identidades: en Gitea los mails están
     * enmascarados (@noreply.localhost), pero `<giteaLogin>@<dominio>` matchea
     * en la búsqueda de usuarios de Jira.
     */
    emailDomain: process.env.JIRA_EMAIL_DOMAIN ?? 'example.com',
  },
};

export const giteaConfigured = () =>
  Boolean(
    env.gitea.token &&
      env.gitea.baseUrl &&
      (env.gitea.repos.length || env.gitea.orgs.length),
  );
/** Login real contra Gitea: requiere la app OAuth2 registrada. */
export const giteaOauthEnabled = () =>
  Boolean(
    env.gitea.baseUrl && env.gitea.oauthClientId && env.gitea.oauthClientSecret,
  );
/**
 * True solo con opt-in explícito (GITEA_ENABLED=true) y token presente.
 * Por defecto el scaffold usa datos mock, incluso si hay un token Gitea
 * en el entorno del sistema.
 */
export const giteaEnabled = () => env.gitea.enabled && giteaConfigured();
export const jiraConfigured = () =>
  Boolean(env.jira.baseUrl && env.jira.email && env.jira.apiToken);
/** Lecturas a Jira: requiere opt-in + credenciales. */
export const jiraEnabled = () => env.jira.enabled && jiraConfigured();
/** Escrituras a Jira: además, opt-in propio. Si no, se stubbea. */
export const jiraWriteEnabled = () => jiraEnabled() && env.jira.writeEnabled;
