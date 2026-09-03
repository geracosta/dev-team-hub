import type { PrReview, PullRequest, PrState, SyncSnapshot } from '../types.js';
import { users } from './store.js';

/**
 * Generador determinístico de PRs mock (sin Math.random para que los números
 * sean estables entre requests). Cubre ~6 meses hacia atrás y respeta el mismo
 * shape que la sync real, incluyendo reviews cruzados entre miembros.
 */
const REPOS = ['acme/backend', 'acme/frontend', 'acme/mobile', 'acme/infra'];
const TICKET_PREFIXES = ['APP', 'WEB', 'OPS', 'CORE'];

function seeded(login: string): number {
  let h = 0;
  for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
}

export function mockPullRequests(login: string, monthsBack = 6): PullRequest[] {
  const base = seeded(login);
  const prs: PullRequest[] = [];
  let id = base;

  // Otros logins del equipo, para repartir reviews de forma estable.
  const peers = users.map((u) => u.giteaLogin).filter((l) => l && l !== login);

  const ref = new Date();
  const refYear = ref.getFullYear();
  const refMonth = ref.getMonth() + 1;

  for (let m = 0; m < monthsBack; m++) {
    let month = refMonth - m;
    let year = refYear;
    while (month <= 0) {
      month += 12;
      year -= 1;
    }
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const count = 4 + ((base + m) % 5); // 4..8 PRs por mes

    for (let i = 0; i < count; i++) {
      const roll = (base + m * 7 + i * 13) % 10;
      const state: PrState = roll < 7 ? 'merged' : roll < 9 ? 'open' : 'closed';
      const reviewCount = (base + i) % 4; // 0..3 reviews
      const additions = 20 + ((base + i * 17) % 400);
      const deletions = 5 + ((base + i * 7) % 120);
      const day = 1 + ((base + i) % 26);
      const dd = (n: number) => String(Math.min(n, 28)).padStart(2, '0');
      const createdAt = `${monthStr}-${dd(day)}T10:00:00Z`;
      const mergedAt =
        state === 'merged' ? `${monthStr}-${dd(day + 2)}T15:00:00Z` : undefined;
      const closedAt =
        state === 'closed' ? `${monthStr}-${dd(day + 1)}T12:00:00Z` : undefined;

      const reviews: PrReview[] = Array.from({ length: reviewCount }, (_, r) => ({
        authorLogin: peers.length ? peers[(base + i + r) % peers.length] : 'reviewer',
        state: r === 0 ? 'APPROVED' : 'COMMENT',
        submittedAt: `${monthStr}-${dd(day + 1)}T09:00:00Z`,
        stale: false,
        official: r === 0,
      }));

      const repo = REPOS[i % REPOS.length];
      const prefix = TICKET_PREFIXES[(base + i) % TICKET_PREFIXES.length];

      prs.push({
        id: id++,
        number: 100 + ((id + i) % 900),
        title: `[${prefix}-${100 + ((base + i) % 400)}] Cambio ${i + 1} de ${login}`,
        state,
        authorLogin: login,
        reviews,
        reviewsCount: reviews.length,
        createdAt,
        updatedAt: mergedAt ?? closedAt ?? createdAt,
        mergedAt,
        closedAt,
        additions,
        deletions,
        changedFiles: 1 + (i % 8),
        repo,
        ticketKey: `${prefix}-${100 + ((base + i) % 400)}`,
        labels: roll === 9 ? ['bug'] : [],
        htmlUrl: '',
        commentsCount: reviewCount,
      });
    }
  }
  return prs;
}

/** Snapshot mock con el mismo contrato que la sync real. */
export function mockSnapshot(): SyncSnapshot {
  const prs = users.flatMap((u) => mockPullRequests(u.giteaLogin));
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  return {
    mode: 'mock',
    syncedAt: new Date().toISOString(),
    durationMs: 0,
    repos: REPOS,
    prs,
    errors: [],
    windowFrom: from.toISOString(),
    reviewsFetched: true,
    sizesFetched: true,
    truncated: false,
  };
}
