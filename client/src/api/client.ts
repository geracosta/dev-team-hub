import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

// Inyecta el JWT guardado en cada request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: 'developer' | 'lead';
  giteaLogin: string;
  jiraAccountId?: string;
}

export interface MonthlyPrStats {
  month: string;
  open: number;
  merged: number;
  closed: number;
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
  stalePrs: number;
  staleDays: number;
  ticketLinkRate: number;
  mergesPerWeek: number;
  reviewersBreakdown: { login: string; count: number }[];
  repos: string[];
  sampleSize: number;
  fixRatio?: number;
}

/** Contexto del snapshot: dice si lo que se ve es real o mock. */
export interface SnapshotMeta {
  mode: 'real' | 'mock';
  syncedAt: string;
  windowFrom: string;
  repos: string[];
  reviewsFetched: boolean;
  sizesFetched: boolean;
  degraded: boolean;
}

export interface PullRequestDto {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  authorLogin: string;
  reviewsCount: number;
  createdAt: string;
  updatedAt: string;
  repo: string;
  ticketKey?: string;
  htmlUrl: string;
}

export interface ReviewMatrixRow {
  reviewerLogin: string;
  reviewerName: string;
  given: Record<string, number>;
  totalGiven: number;
  totalReceived: number;
}

export interface IntegrationStatus {
  gitea: {
    enabled: boolean;
    configured: boolean;
    ok: boolean;
    baseUrl: string;
    version?: string;
    login?: string;
    error?: string;
    repos: string[] | string;
    windowMonths: number;
    fetchReviews: boolean;
    fetchSizes: boolean;
  };
  jira: {
    enabled: boolean;
    writeEnabled: boolean;
    configured: boolean;
    ok: boolean;
    baseUrl: string | null;
    displayName?: string;
    error?: string;
  };
  snapshot: {
    mode: 'real' | 'mock';
    syncedAt: string;
    durationMs: number;
    prs: number;
    repos: number;
    truncated: boolean;
    errors: string[];
  } | null;
}

export interface IdentitySuggestion {
  userId: string;
  name: string;
  giteaLogin: string;
  currentJiraAccountId?: string;
  suggestion?: {
    accountId: string;
    displayName: string;
    email?: string;
    match: 'manual' | 'email' | 'name' | 'none';
    confidence: 'alta' | 'media' | 'baja';
  };
  candidates: { accountId: string; displayName: string; email?: string }[];
  note?: string;
}

export interface MappingUser {
  id: string;
  name: string;
  email: string;
  role: 'developer' | 'lead';
  giteaLogin: string;
  jiraAccountId: string | null;
  jiraMatch: 'manual' | 'email' | 'name' | 'none';
}

export interface JiraOpResult {
  ok: boolean;
  stubbed: boolean;
  error?: string;
}

export interface JiraSyncItem {
  ticketKey: string;
  comment: JiraOpResult;
}

export type CalendarEventType = 'vacaciones' | 'licencia' | 'feriado' | 'reunion';

export const ABSENCE_TYPES: CalendarEventType[] = ['vacaciones', 'licencia'];

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  from: string;
  to: string;
  userId?: string;
  time?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface FacilitatorAssignment {
  date: string;
  userId?: string;
  userName?: string;
  source: 'rotacion' | 'override' | 'no-laborable' | 'sin-disponibles';
  skipped: { userId: string; userName: string; reason: string }[];
  nonWorkingReason?: string;
  /** Correlativo de la daily. Ausente los días sin daily. */
  dailyNumber?: number;
  /** Ronda (pasada completa por el roster) y posición dentro de ella. */
  roundNumber?: number;
  positionInRound?: number;
}

export interface RoundEntry {
  date: string;
  position: number;
  userId: string;
  userName: string;
  /** Quién facilita de verdad: difiere si hubo ausencia o cambio manual. */
  effectiveUserId?: string;
  effectiveUserName?: string;
  dailyNumber?: number;
  nonWorkingReason?: string;
  status: 'pasada' | 'hoy' | 'pendiente';
}

export interface FacilitatorRound {
  number: number;
  size: number;
  from: string;
  to: string;
  entries: RoundEntry[];
}

export interface CalendarDay extends FacilitatorAssignment {
  weekend: boolean;
  events: CalendarEvent[];
}

export interface CalendarPerson {
  id: string;
  name: string;
  role: 'developer' | 'lead';
}

/** Etiquetas y colores por tipo de evento, compartidos por el calendario. */
export const EVENT_META: Record<
  CalendarEventType,
  { label: string; icon: string; className: string }
> = {
  vacaciones: { label: 'Vacaciones', icon: '🏖', className: 'ev-vacaciones' },
  licencia: { label: 'Licencia', icon: '📋', className: 'ev-licencia' },
  feriado: { label: 'Feriado', icon: '🎉', className: 'ev-feriado' },
  reunion: { label: 'Reunión', icon: '📅', className: 'ev-reunion' },
};

/** YYYY-MM-DD en hora local (no UTC, para no correrse un día). */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const monthName = (month: number) => MONTHS[month - 1] ?? '';

/** "mar 5 ago" — para mostrar una fecha suelta sin ruido. */
export function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][date.getDay()];
  return `${dow} ${d} ${MONTHS[m - 1]?.slice(0, 3)}`;
}

export interface DailySession {
  id: string;
  date: string;
  facilitatorId?: string;
  status: 'preparing' | 'running' | 'closed';
  order: string[];
  currentIndex: number;
  perPersonSeconds: number;
}

/**
 * Los tres bloques del pre-update comparten forma: ticket de Jira como título
 * y un comentario libre.
 */
export interface PreUpdateItem {
  ticketKey: string;
  comment: string;
}

export interface DailyEntry {
  id: string;
  sessionId: string;
  userId: string;
  yesterday: PreUpdateItem[];
  today: PreUpdateItem[];
  barreras: PreUpdateItem[];
  syncedToJira: boolean;
  syncedAt?: string;
  lastSyncResult?: JiraSyncItem[];
  user?: { id: string; name: string } | null;
}

/** "hace 5 min", para el badge de última sincronización. */
export function timeAgo(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'recién';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Horas a un formato legible: 26.4 -> "1d 2h". */
export function fmtHours(hours: number): string {
  if (!hours) return '—';
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Resultado de chequear que un ticket exista, para validar lo que se carga en
 * el pre-update. Con Jira en modo stub (`JIRA_ENABLED=false`) vuelve
 * `stubbed: true` sin datos: no se puede confirmar ni desmentir la key.
 */
export interface JiraIssueCheck {
  ok: boolean;
  stubbed: boolean;
  issue?: {
    key: string;
    summary: string;
    status: string;
    project: string;
    assignee?: string;
  };
  error?: string;
}

/** Keys tipo DM-1617 o GRPM-659. Se valida el formato antes de ir al server. */
export const TICKET_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
