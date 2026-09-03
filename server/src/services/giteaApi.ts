import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env } from '../config/env.js';

/**
 * Capa HTTP contra Gitea: cliente, paginación y concurrencia acotada.
 * Todo lo que sepa de métricas vive en gitea.ts / metrics.ts.
 */

let instance: AxiosInstance | null = null;

export function giteaHttp(): AxiosInstance {
  if (!instance) {
    instance = axios.create({
      baseURL: `${env.gitea.baseUrl}/api/v1`,
      headers: { Authorization: `token ${env.gitea.token}` },
      timeout: 30_000,
    });
  }
  return instance;
}

/** Sólo para tests o cambios de config en caliente. */
export function resetGiteaHttp(): void {
  instance = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  const e = err as AxiosError;
  if (!e?.isAxiosError) return false;
  if (!e.response) return true; // timeout / red
  return e.response.status === 429 || e.response.status >= 500;
}

/** GET con reintentos exponenciales ante 429/5xx/red. */
export async function giteaGet<T>(
  path: string,
  params: Record<string, unknown> = {},
  retries = 3,
): Promise<{ data: T; headers: Record<string, string> }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await giteaHttp().get<T>(path, { params });
      return { data: res.data, headers: res.headers as Record<string, string> };
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr;
}

const PAGE_SIZE = 50;

/**
 * Recorre un endpoint paginado hasta agotarlo. Gitea expone X-Total-Count,
 * pero cortamos también por página corta y por `max` para acotar el costo.
 */
export async function giteaGetAll<T>(
  path: string,
  params: Record<string, unknown> = {},
  max = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const { data } = await giteaGet<T[]>(path, {
      ...params,
      limit: PAGE_SIZE,
      page,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE || out.length >= max) break;
  }
  return out.length > max ? out.slice(0, max) : out;
}

/** map con concurrencia acotada: no queremos 700 requests simultáneos. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Mensaje corto y legible para el log / la UI de estado. */
export function describeError(err: unknown): string {
  const e = err as AxiosError;
  if (e?.isAxiosError) {
    if (e.response) {
      const body = e.response.data as { message?: string } | undefined;
      return `HTTP ${e.response.status}${body?.message ? ` — ${body.message}` : ''}`;
    }
    return e.code ?? 'error de red';
  }
  return String(err);
}
