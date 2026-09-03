import type {
  HealthMetrics,
  MonthlyPrStats,
  PullRequest,
  ReviewMatrixRow,
  User,
} from '../types.js';

/**
 * Cálculo de métricas a partir de un snapshot de PRs del equipo.
 *
 * Se recibe el set completo (no sólo los del usuario) porque las métricas de
 * colaboración —reviews dados, distribución de revisores— sólo existen mirando
 * los PRs de los demás. Ver docs/METRICAS.md para el criterio de cada una.
 */

const STALE_DAYS = 7;

const monthOf = (iso: string) => iso.slice(0, 7);

const hoursBetween = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 36e5;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return +m.toFixed(1);
}

const avg = (values: number[]) =>
  values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : 0;

/** Primer review recibido (cronológico), si hubo. */
function firstReviewAt(pr: PullRequest): string | undefined {
  if (!pr.reviews.length) return undefined;
  return pr.reviews
    .map((r) => r.submittedAt)
    .sort((a, b) => a.localeCompare(b))[0];
}

const isFixPr = (pr: PullRequest) =>
  pr.labels.some((l) => /bug|fix|hotfix/i.test(l)) ||
  /\b(fix|hotfix|bugfix|correccion|corrección)\b/i.test(pr.title);

/** Lista contigua de meses YYYY-MM entre dos fechas, ambos inclusive. */
function monthRange(from: Date, to: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= end) {
    months.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export function computeHealth(
  userId: string,
  giteaLogin: string,
  allPrs: PullRequest[],
  windowFrom?: string,
): HealthMetrics {
  /*
   * Gitea filtra por `updated_at`, así que el snapshot trae PRs viejos que se
   * tocaron hace poco. Para las métricas del autor nos quedamos con los
   * creados dentro de la ventana: si no, el gráfico por mes queda con meses
   * sueltos de hace un año y los promedios mezclan períodos.
   * Los reviews dados sí se cuentan sobre todo el snapshot: ahí lo que importa
   * es cuándo se revisó, no cuándo nació el PR.
   */
  const authored = allPrs.filter(
    (pr) =>
      pr.authorLogin === giteaLogin && (!windowFrom || pr.createdAt >= windowFrom),
  );

  const byMonthMap = new Map<string, MonthlyPrStats & { leadTimes: number[] }>();
  const reviewersMap = new Map<string, number>();
  const lifetimes: number[] = [];
  const firstReviewDelays: number[] = [];

  let reviewsReceived = 0;
  let sizeSum = 0;
  let openWithoutReview = 0;
  let stalePrs = 0;
  let withTicket = 0;
  const repos = new Set<string>();
  const now = Date.now();

  for (const pr of authored) {
    const month = monthOf(pr.createdAt);
    const bucket =
      byMonthMap.get(month) ??
      { month, open: 0, merged: 0, closed: 0, medianLeadTimeHours: 0, leadTimes: [] };
    bucket[pr.state] += 1;

    reviewsReceived += pr.reviewsCount;
    sizeSum += pr.additions + pr.deletions;
    repos.add(pr.repo);
    if (pr.ticketKey) withTicket += 1;

    for (const review of pr.reviews) {
      reviewersMap.set(
        review.authorLogin,
        (reviewersMap.get(review.authorLogin) ?? 0) + 1,
      );
    }

    if (pr.state === 'merged' && pr.mergedAt) {
      const lt = hoursBetween(pr.createdAt, pr.mergedAt);
      lifetimes.push(lt);
      bucket.leadTimes.push(lt);
    }

    const first = firstReviewAt(pr);
    if (first) firstReviewDelays.push(hoursBetween(pr.createdAt, first));

    if (pr.state === 'open' && pr.reviewsCount === 0) {
      openWithoutReview += 1;
      const ageDays = (now - new Date(pr.createdAt).getTime()) / 864e5;
      if (ageDays > STALE_DAYS) stalePrs += 1;
    }

    byMonthMap.set(month, bucket);
  }

  // Meses contiguos y rellenados con ceros: un mes sin PRs es información,
  // y el gráfico de barras no debe saltearlo.
  const months = windowFrom
    ? monthRange(new Date(windowFrom), new Date())
    : [...byMonthMap.keys()].sort();
  const byMonth: MonthlyPrStats[] = months.map((month) => {
    const bucket = byMonthMap.get(month);
    return {
      month,
      open: bucket?.open ?? 0,
      merged: bucket?.merged ?? 0,
      closed: bucket?.closed ?? 0,
      medianLeadTimeHours: median(bucket?.leadTimes ?? []),
    };
  });

  const totals = byMonth.reduce(
    (acc, m) => ({
      open: acc.open + m.open,
      merged: acc.merged + m.merged,
      closed: acc.closed + m.closed,
    }),
    { open: 0, merged: 0, closed: 0 },
  );

  // Reviews dados: revisiones firmadas por el usuario en PRs de otros.
  const reviewsGiven = allPrs.reduce(
    (acc, pr) =>
      pr.authorLogin === giteaLogin
        ? acc
        : acc + pr.reviews.filter((r) => r.authorLogin === giteaLogin).length,
    0,
  );

  const weeks = windowFrom
    ? Math.max(1, (now - new Date(windowFrom).getTime()) / (7 * 864e5))
    : 26;

  const denom = authored.length || 1;

  return {
    userId,
    giteaLogin,
    byMonth,
    totals,
    reviewsReceived,
    reviewsGiven,
    avgReviewsPerPr: +(reviewsReceived / denom).toFixed(2),
    avgTimeToFirstReviewHours: avg(firstReviewDelays),
    medianTimeToFirstReviewHours: median(firstReviewDelays),
    avgPrLifetimeHours: avg(lifetimes),
    medianPrLifetimeHours: median(lifetimes),
    avgPrSizeLines: Math.round(sizeSum / denom),
    openWithoutReview,
    stalePrs,
    staleDays: STALE_DAYS,
    ticketLinkRate: authored.length
      ? +((withTicket / authored.length) * 100).toFixed(0)
      : 0,
    mergesPerWeek: +(totals.merged / weeks).toFixed(1),
    reviewersBreakdown: [...reviewersMap.entries()]
      .map(([login, count]) => ({ login, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    repos: [...repos].sort(),
    sampleSize: authored.length,
  };
}

/** % de PRs marcados como fix/bug sobre el total del autor. */
export function fixRatio(giteaLogin: string, allPrs: PullRequest[]): number {
  const authored = allPrs.filter((pr) => pr.authorLogin === giteaLogin);
  if (!authored.length) return 0;
  return +((authored.filter(isFixPr).length / authored.length) * 100).toFixed(0);
}

/**
 * Heatmap dar/recibir del panel del lead: quién revisa a quién.
 * Detecta concentración del review en una o dos personas.
 */
export function reviewMatrix(team: User[], allPrs: PullRequest[]): ReviewMatrixRow[] {
  const logins = new Set(team.map((u) => u.giteaLogin));
  const rows = new Map<string, ReviewMatrixRow>();

  for (const user of team) {
    rows.set(user.giteaLogin, {
      reviewerLogin: user.giteaLogin,
      reviewerName: user.name,
      given: {},
      totalGiven: 0,
      totalReceived: 0,
    });
  }

  for (const pr of allPrs) {
    const authorRow = rows.get(pr.authorLogin);
    for (const review of pr.reviews) {
      if (!logins.has(review.authorLogin)) continue;
      const row = rows.get(review.authorLogin);
      if (!row || review.authorLogin === pr.authorLogin) continue;
      row.given[pr.authorLogin] = (row.given[pr.authorLogin] ?? 0) + 1;
      row.totalGiven += 1;
      if (authorRow) authorRow.totalReceived += 1;
    }
  }

  return [...rows.values()].sort((a, b) => b.totalGiven - a.totalGiven);
}
