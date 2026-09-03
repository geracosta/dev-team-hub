import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env, jiraEnabled, jiraWriteEnabled } from '../config/env.js';

/**
 * Integración con Jira Cloud (`/rest/api/3`, basic auth email + API token).
 *
 * Dos flags separados a propósito: JIRA_ENABLED habilita lecturas (validar
 * tickets, resolver usuarios) y JIRA_WRITE_ENABLED habilita las escrituras
 * (comentarios y worklogs). Sin ellos todo se stubbea y la app sigue andando.
 *
 * Nada de acá tira excepción hacia las rutas: un ticket que falla no debe
 * tumbar la sincronización completa de la daily.
 */

export interface JiraOpResult {
  ok: boolean;
  stubbed: boolean;
  error?: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  email?: string;
}

let instance: AxiosInstance | null = null;

function client(): AxiosInstance {
  if (!instance) {
    instance = axios.create({
      baseURL: `${env.jira.baseUrl}/rest/api/3`,
      auth: { username: env.jira.email, password: env.jira.apiToken },
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 20_000,
    });
  }
  return instance;
}

export function resetJiraClient(): void {
  instance = null;
}

function jiraError(err: unknown): string {
  const e = err as AxiosError;
  if (e?.isAxiosError && e.response) {
    const data = e.response.data as
      | { errorMessages?: string[]; errors?: Record<string, string> }
      | undefined;
    const detail =
      data?.errorMessages?.[0] ??
      (data?.errors ? Object.values(data.errors)[0] : undefined);
    return `HTTP ${e.response.status}${detail ? ` — ${detail}` : ''}`;
  }
  if (e?.isAxiosError) return e.code ?? 'error de red';
  return String(err);
}

/** Jira Cloud espera texto en Atlassian Document Format. */
function adf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: line }],
      })),
  };
}

export async function addComment(
  ticketKey: string,
  comment: string,
): Promise<JiraOpResult> {
  if (!jiraWriteEnabled()) {
    console.log(`[jira:stub] comentario a ${ticketKey}: ${comment}`);
    return { ok: true, stubbed: true };
  }
  try {
    await client().post(`/issue/${ticketKey}/comment`, { body: adf(comment) });
    return { ok: true, stubbed: false };
  } catch (err) {
    return { ok: false, stubbed: false, error: jiraError(err) };
  }
}


export interface JiraIssueInfo {
  key: string;
  summary: string;
  status: string;
  project: string;
  assignee?: string;
  timeSpentSeconds: number;
}

/** Valida que el ticket exista y devuelve lo mínimo para mostrar en la UI. */
export async function getIssue(
  ticketKey: string,
): Promise<{ ok: boolean; stubbed: boolean; issue?: JiraIssueInfo; error?: string }> {
  if (!jiraEnabled()) return { ok: true, stubbed: true };
  try {
    const { data } = await client().get(`/issue/${ticketKey}`, {
      params: { fields: 'summary,status,project,assignee,timetracking' },
    });
    const f = data.fields ?? {};
    return {
      ok: true,
      stubbed: false,
      issue: {
        key: data.key,
        summary: f.summary ?? '',
        status: f.status?.name ?? '',
        project: f.project?.key ?? '',
        assignee: f.assignee?.displayName,
        timeSpentSeconds: f.timetracking?.timeSpentSeconds ?? 0,
      },
    };
  } catch (err) {
    return { ok: false, stubbed: false, error: jiraError(err) };
  }
}

export async function searchUsers(query: string): Promise<JiraUser[]> {
  if (!jiraEnabled()) return [];
  try {
    const { data } = await client().get('/user/search', {
      params: { query, maxResults: 5 },
    });
    return (data ?? []).map((u: Record<string, string>) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      email: u.emailAddress || undefined,
    }));
  } catch {
    return [];
  }
}

export async function jiraPing(): Promise<{
  ok: boolean;
  displayName?: string;
  accountId?: string;
  error?: string;
}> {
  if (!jiraEnabled()) return { ok: false, error: 'deshabilitado' };
  try {
    const { data } = await client().get('/myself');
    return { ok: true, displayName: data.displayName, accountId: data.accountId };
  } catch (err) {
    return { ok: false, error: jiraError(err) };
  }
}
