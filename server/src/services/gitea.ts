import { env, giteaEnabled } from '../config/env.js';
import { mockSnapshot } from '../data/mock.js';
import { giteaGet, giteaGetAll, mapLimit, describeError } from './giteaApi.js';
import type {
  PrReview,
  PrState,
  PullRequest,
  ReviewState,
  SyncSnapshot,
} from '../types.js';

/**
 * Ingest de PRs desde Gitea.
 *
 * Por qué repo por repo y no una búsqueda global: en Gitea 1.21
 * `/repos/issues/search` sólo filtra por el usuario del token (`created=true`),
 * no acepta un autor arbitrario. Bajamos entonces los PRs de cada repo una vez
 * (todos los autores) y agrupamos en memoria — así una sola sync alimenta las
 * métricas de todo el equipo en vez de N×repos requests por persona.
 *
 * Se usa `/issues?type=pulls` en lugar de `/pulls` porque acepta `since`, trae
 * `repository`, labels y body, y expone `pull_request.merged`.
 */

interface GiteaUser {
  login?: string;
  full_name?: string;
  email?: string;
}

interface GiteaIssueAsPull {
  id: number;
  number: number;
  title?: string;
  body?: string;
  state?: string;
  user?: GiteaUser;
  labels?: { name: string }[];
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  comments?: number;
  html_url?: string;
  ref?: string;
  repository?: { owner?: string; name?: string; full_name?: string };
  pull_request?: { merged?: boolean; merged_at?: string | null } | null;
}

interface GiteaReview {
  state?: string;
  submitted_at?: string;
  stale?: boolean;
  official?: boolean;
  dismissed?: boolean;
  user?: GiteaUser;
}

interface GiteaFile {
  additions?: number;
  deletions?: number;
}

/** Keys tipo DM-1617, NPA-1180, GRPM-659 en título, rama o cuerpo. */
const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/;

export function extractTicketKey(...sources: (string | undefined)[]): string | undefined {
  for (const source of sources) {
    if (!source) continue;
    const m = source.toUpperCase().match(TICKET_RE);
    if (m) return `${m[1]}-${m[2]}`;
  }
  return undefined;
}

function normalizeReviewState(raw?: string): ReviewState {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REQUEST_CHANGES':
    case 'REQUEST_REVIEW':
      return 'REQUEST_CHANGES';
    case 'COMMENT':
      return 'COMMENT';
    case 'PENDING':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

function toPrState(issue: GiteaIssueAsPull): PrState {
  if (issue.pull_request?.merged) return 'merged';
  return issue.state === 'closed' ? 'closed' : 'open';
}

function normalizePr(issue: GiteaIssueAsPull, repoFullName: string): PullRequest {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title ?? '(sin título)',
    state: toPrState(issue),
    authorLogin: issue.user?.login ?? 'desconocido',
    reviews: [],
    reviewsCount: 0,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    mergedAt: issue.pull_request?.merged_at ?? undefined,
    closedAt: issue.closed_at ?? undefined,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    repo: issue.repository?.full_name ?? repoFullName,
    ticketKey: extractTicketKey(issue.title, issue.ref, issue.body),
    labels: (issue.labels ?? []).map((l) => l.name),
    htmlUrl: issue.html_url ?? '',
    commentsCount: issue.comments ?? 0,
  };
}

/** Repos a analizar: los del org si se configuró GITEA_ORGS, si no la lista fija. */
async function resolveRepos(errors: string[]): Promise<string[]> {
  if (!env.gitea.orgs.length) return env.gitea.repos;

  const found: string[] = [];
  for (const org of env.gitea.orgs) {
    try {
      const repos = await giteaGetAll<{ full_name: string; empty?: boolean }>(
        `/orgs/${org}/repos`,
      );
      found.push(...repos.filter((r) => !r.empty).map((r) => r.full_name));
    } catch (err) {
      errors.push(`org ${org}: ${describeError(err)}`);
    }
  }
  return found.length ? found : env.gitea.repos;
}

async function fetchRepoPulls(
  repoFullName: string,
  since: string,
): Promise<PullRequest[]> {
  const [owner, repo] = repoFullName.split('/');
  const issues = await giteaGetAll<GiteaIssueAsPull>(
    `/repos/${owner}/${repo}/issues`,
    { type: 'pulls', state: 'all', since },
  );
  return issues.map((i) => normalizePr(i, repoFullName));
}

async function attachReviews(pr: PullRequest): Promise<void> {
  const [owner, repo] = pr.repo.split('/');
  const { data } = await giteaGet<GiteaReview[]>(
    `/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
  );
  const reviews: PrReview[] = (data ?? [])
    .filter((r) => !r.dismissed && r.submitted_at)
    .map((r) => ({
      authorLogin: r.user?.login ?? 'desconocido',
      state: normalizeReviewState(r.state),
      submittedAt: r.submitted_at as string,
      stale: Boolean(r.stale),
      official: Boolean(r.official),
    }))
    // El autor comentando su propio PR no es un review.
    .filter((r) => r.authorLogin !== pr.authorLogin && r.state !== 'PENDING');

  pr.reviews = reviews;
  pr.reviewsCount = reviews.length;
}

async function attachSize(pr: PullRequest): Promise<void> {
  const [owner, repo] = pr.repo.split('/');
  const files = await giteaGetAll<GiteaFile>(
    `/repos/${owner}/${repo}/pulls/${pr.number}/files`,
    {},
    300,
  );
  pr.additions = files.reduce((a, f) => a + (f.additions ?? 0), 0);
  pr.deletions = files.reduce((a, f) => a + (f.deletions ?? 0), 0);
  pr.changedFiles = files.length;
}

function windowStart(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - env.gitea.windowMonths);
  return d;
}

async function runSync(): Promise<SyncSnapshot> {
  const started = Date.now();
  const from = windowStart();
  const since = from.toISOString();
  const errors: string[] = [];

  const repos = await resolveRepos(errors);

  const perRepo = await mapLimit(repos, env.gitea.concurrency, async (repo) => {
    try {
      return await fetchRepoPulls(repo, since);
    } catch (err) {
      errors.push(`${repo}: ${describeError(err)}`);
      return [] as PullRequest[];
    }
  });

  let prs = perRepo.flat();
  const truncated = prs.length > env.gitea.maxPrs;
  if (truncated) {
    // Nos quedamos con lo más reciente: es lo que mueven las métricas.
    prs = prs
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, env.gitea.maxPrs);
    errors.push(
      `se truncó a ${env.gitea.maxPrs} PRs (GITEA_MAX_PRS); ampliá el tope o reducí la ventana`,
    );
  }

  if (env.gitea.fetchReviews) {
    await mapLimit(prs, env.gitea.concurrency, async (pr) => {
      try {
        await attachReviews(pr);
      } catch (err) {
        errors.push(`reviews ${pr.repo}#${pr.number}: ${describeError(err)}`);
      }
    });
  }

  if (env.gitea.fetchSizes) {
    await mapLimit(prs, env.gitea.concurrency, async (pr) => {
      try {
        await attachSize(pr);
      } catch (err) {
        errors.push(`files ${pr.repo}#${pr.number}: ${describeError(err)}`);
      }
    });
  }

  return {
    mode: 'real',
    syncedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    repos,
    prs,
    // Un repo caído no debe llenar la UI de ruido: mostramos los primeros.
    errors: errors.slice(0, 20),
    windowFrom: since,
    reviewsFetched: env.gitea.fetchReviews,
    sizesFetched: env.gitea.fetchSizes,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Cache + single flight
// ---------------------------------------------------------------------------

let cached: SyncSnapshot | null = null;
let inFlight: Promise<SyncSnapshot> | null = null;

function isFresh(snapshot: SyncSnapshot): boolean {
  const ageMs = Date.now() - new Date(snapshot.syncedAt).getTime();
  return ageMs < env.gitea.cacheTtlMinutes * 60_000;
}

/**
 * Snapshot de PRs del equipo. Con la integración apagada devuelve mock.
 * `force` ignora el TTL; las llamadas concurrentes comparten la misma promesa.
 */
export async function getSnapshot(force = false): Promise<SyncSnapshot> {
  if (!giteaEnabled()) {
    cached = mockSnapshot();
    return cached;
  }
  if (!force && cached && cached.mode === 'real' && isFresh(cached)) return cached;
  if (inFlight) return inFlight;

  inFlight = runSync()
    .then((snapshot) => {
      cached = snapshot;
      return snapshot;
    })
    .catch((err) => {
      // Si la sync real falla entera, no dejamos la app sin datos.
      const fallback = mockSnapshot();
      fallback.errors = [`sync falló, se muestran datos mock: ${describeError(err)}`];
      cached = fallback;
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function cachedSnapshot(): SyncSnapshot | null {
  return cached;
}

export function invalidateSnapshot(): void {
  cached = null;
}

/** Ping de conectividad para el endpoint de estado. */
export async function giteaPing(): Promise<{
  ok: boolean;
  version?: string;
  login?: string;
  error?: string;
}> {
  try {
    const [{ data: v }, { data: me }] = await Promise.all([
      giteaGet<{ version: string }>('/version'),
      giteaGet<GiteaUser>('/user'),
    ]);
    return { ok: true, version: v.version, login: me.login };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
