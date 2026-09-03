export type Role = 'developer' | 'lead';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string; // scaffold: texto plano. Producción: hash + SSO.
  role: Role;
  giteaLogin: string;
  jiraAccountId?: string;
  /** Cómo se resolvió la identidad Jira: manual, por mail o por nombre. */
  jiraMatch?: IdentityMatch;
  active?: boolean;
}

export type PublicUser = Omit<User, 'password'>;

export type IdentityMatch = 'manual' | 'email' | 'name' | 'none';

export interface IdentitySuggestion {
  userId: string;
  name: string;
  giteaLogin: string;
  currentJiraAccountId?: string;
  suggestion?: {
    accountId: string;
    displayName: string;
    email?: string;
    match: IdentityMatch;
    /** alta = 1 solo candidato por mail; media = match por nombre. */
    confidence: 'alta' | 'media' | 'baja';
  };
  candidates: { accountId: string; displayName: string; email?: string }[];
  note?: string;
}

export type PrState = 'open' | 'merged' | 'closed';

export type ReviewState =
  | 'APPROVED'
  | 'REQUEST_CHANGES'
  | 'COMMENT'
  | 'PENDING'
  | 'UNKNOWN';

export interface PrReview {
  authorLogin: string;
  state: ReviewState;
  submittedAt: string;
  stale: boolean;
  official: boolean;
}

export interface PullRequest {
  id: number;
  /** Índice del PR dentro del repo (el número que se ve en la UI de Gitea). */
  number: number;
  title: string;
  state: PrState;
  authorLogin: string;
  reviews: PrReview[];
  /** Reviews efectivamente enviados (excluye PENDING y al propio autor). */
  reviewsCount: number;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  closedAt?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** `owner/repo`. */
  repo: string;
  ticketKey?: string;
  labels: string[];
  htmlUrl: string;
  commentsCount: number;
}

export interface MonthlyPrStats {
  month: string; // YYYY-MM
  open: number;
  merged: number;
  closed: number;
  /** Lead time mediano (h) de los PRs mergeados ese mes. */
  medianLeadTimeHours: number;
}

export interface HealthMetrics {
  userId: string;
  giteaLogin: string;
  byMonth: MonthlyPrStats[];
  totals: { open: number; merged: number; closed: number };
  reviewsReceived: number;
  reviewsGiven: number;
  avgReviewsPerPr: number;
  avgTimeToFirstReviewHours: number;
  medianTimeToFirstReviewHours: number;
  avgPrLifetimeHours: number;
  medianPrLifetimeHours: number;
  avgPrSizeLines: number;
  openWithoutReview: number;
  /** PRs abiertos hace más de `staleDays` sin ningún review. */
  stalePrs: number;
  staleDays: number;
  /** % de PRs con key de ticket detectada (trazabilidad). */
  ticketLinkRate: number;
  /** Merges por semana dentro de la ventana analizada. */
  mergesPerWeek: number;
  /** Reviews recibidos de cada revisor: detecta knowledge holders. */
  reviewersBreakdown: { login: string; count: number }[];
  repos: string[];
  /** Sin datos reales todavía (mock o sin PRs en la ventana). */
  sampleSize: number;
}

/** Fila del heatmap dar/recibir del panel del lead. */
export interface ReviewMatrixRow {
  reviewerLogin: string;
  reviewerName: string;
  /** authorLogin -> cantidad de reviews que le hizo. */
  given: Record<string, number>;
  totalGiven: number;
  totalReceived: number;
}

export interface SyncSnapshot {
  mode: 'real' | 'mock';
  syncedAt: string;
  durationMs: number;
  repos: string[];
  prs: PullRequest[];
  errors: string[];
  windowFrom: string;
  reviewsFetched: boolean;
  sizesFetched: boolean;
  truncated: boolean;
}


/**
 * Los tres bloques del pre-update (ayer, hoy, barreras) usan la misma forma:
 * el ticket de Jira como título y un comentario libre. Un solo modelo evita
 * que cada sección se vea y se cargue distinto.
 */
export interface PreUpdateItem {
  ticketKey: string;
  comment: string;
}

export interface JiraSyncItem {
  ticketKey: string;
  comment: { ok: boolean; stubbed: boolean; error?: string };
}

export interface DailyEntry {
  id: string;
  sessionId: string;
  userId: string;
  /** Qué se hizo: cada comentario va a Jira al sincronizar. */
  yesterday: PreUpdateItem[];
  today: PreUpdateItem[];
  barreras: PreUpdateItem[];
  syncedToJira: boolean;
  syncedAt?: string;
  lastSyncResult?: JiraSyncItem[];
}

/**
 * Tipos de evento del calendario del equipo.
 * - `vacaciones` / `licencia`: ausencia de una persona; la saltea la rotación.
 * - `feriado`: día no laborable para todos; no se asigna facilitador.
 * - `reunion`: informativo, no afecta la rotación.
 */
export type CalendarEventType = 'vacaciones' | 'licencia' | 'feriado' | 'reunion';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD inclusive; igual a `from` si dura un día. */
  to: string;
  /** Dueño de la ausencia. Vacío en feriados y en reuniones de todo el equipo. */
  userId?: string;
  /** HH:mm, sólo reuniones. */
  time?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export const ABSENCE_TYPES: CalendarEventType[] = ['vacaciones', 'licencia'];

export interface SkippedFacilitator {
  userId: string;
  userName: string;
  reason: string;
}

export interface FacilitatorAssignment {
  /** YYYY-MM-DD */
  date: string;
  userId?: string;
  userName?: string;
  /** De dónde sale la asignación. */
  source: 'rotacion' | 'override' | 'no-laborable' | 'sin-disponibles';
  /** A quién se salteó y por qué (ausencias). */
  skipped: SkippedFacilitator[];
  /** Motivo cuando el día no es laborable. */
  nonWorkingReason?: string;
  /**
   * Correlativo de la daily, el que el equipo venía llevando por fuera de la
   * app. Ausente cuando el día no tiene daily (fin de semana o feriado).
   */
  dailyNumber?: number;
  /** Ronda (pasada completa por el roster) a la que pertenece el turno. */
  roundNumber?: number;
  /** Posición dentro de la ronda, 1-based. */
  positionInRound?: number;
}

export interface CalendarDay extends FacilitatorAssignment {
  weekend: boolean;
  events: CalendarEvent[];
}

export type DailyStatus = 'preparing' | 'running' | 'closed';

export interface DailySession {
  id: string;
  date: string; // YYYY-MM-DD
  facilitatorId?: string;
  status: DailyStatus;
  order: string[]; // userIds en orden de exposición
  currentIndex: number;
  perPersonSeconds: number;
}

/** Un turno dentro de una ronda. */
export interface RoundEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Posición en la ronda, 1-based. */
  position: number;
  /** A quién le toca por rotación pura. */
  userId: string;
  userName: string;
  /**
   * Quién facilita de verdad ese día: puede diferir del de la rotación por una
   * ausencia salteada o un cambio manual. Ausente los días sin daily.
   */
  effectiveUserId?: string;
  effectiveUserName?: string;
  dailyNumber?: number;
  /** Motivo cuando ese día de la ronda cae en feriado y no hay daily. */
  nonWorkingReason?: string;
  status: 'pasada' | 'hoy' | 'pendiente';
}

/**
 * Una ronda es una pasada completa por el roster: cuando termina, arranca la
 * siguiente con el equipo que haya en ese momento. Es el mismo concepto que el
 * equipo venía publicando a mano en el chat, pero calculado.
 */
export interface FacilitatorRound {
  number: number;
  /** Cantidad de personas en la ronda. */
  size: number;
  /** Primer y último día hábil de la ronda (YYYY-MM-DD). */
  from: string;
  to: string;
  entries: RoundEntry[];
}
