import { env, jiraEnabled } from '../config/env.js';
import { giteaGetAll, describeError } from './giteaApi.js';
import { searchUsers } from './jira.js';
import { users } from '../data/store.js';
import type { IdentitySuggestion, User } from '../types.js';

/**
 * Mapeo de identidades app ↔ Gitea ↔ Jira.
 *
 * Por qué no alcanza con el mail: Gitea enmascara los mails de terceros
 * (`login@noreply.localhost`), así que no hay campo común con Jira. Lo que sí
 * funciona es que el usuario corporativo sigue el patrón
 * `<giteaLogin>@<JIRA_EMAIL_DOMAIN>`, y la búsqueda de Jira lo matchea aun
 * cuando el mail está oculto en la respuesta. Si eso falla, se cae a matchear
 * por nombre visible, que puede ser ambiguo — por eso devolvemos candidatos y
 * un nivel de confianza en vez de asignar a ciegas.
 */

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export interface GiteaMember {
  login: string;
  fullName: string;
}

export async function orgMembers(org: string): Promise<GiteaMember[]> {
  const raw = await giteaGetAll<{ login: string; full_name?: string }>(
    `/orgs/${org}/members`,
  );
  return raw.map((m) => ({ login: m.login, fullName: m.full_name ?? '' }));
}

/** Bots y cuentas de servicio que no son personas del equipo. */
const BOT_RE = /^(gitea|jenkins|bot[_-]|.*[_-]bot$|mcp|aligare)/i;

export const isBot = (login: string) => BOT_RE.test(login);

/** Sugiere el login de Gitea para un usuario de la app (por login o nombre). */
export function suggestGiteaLogin(
  user: User,
  members: GiteaMember[],
): string | undefined {
  const byLogin = members.find((m) => m.login === user.giteaLogin);
  if (byLogin) return byLogin.login;

  const target = normalize(user.name);
  const byName = members.find((m) => m.fullName && normalize(m.fullName) === target);
  if (byName) return byName.login;

  const local = normalize(user.email.split('@')[0]);
  return members.find((m) => normalize(m.login) === local)?.login;
}

async function suggestJira(user: User): Promise<IdentitySuggestion> {
  const base: IdentitySuggestion = {
    userId: user.id,
    name: user.name,
    giteaLogin: user.giteaLogin,
    currentJiraAccountId: user.jiraAccountId,
    candidates: [],
  };

  if (!jiraEnabled()) {
    return { ...base, note: 'Jira deshabilitado (JIRA_ENABLED=false)' };
  }

  // 1) Mail corporativo derivado del login de Gitea: es el match más confiable.
  const corporateEmail = `${user.giteaLogin}@${env.jira.emailDomain}`;
  const byEmail = await searchUsers(corporateEmail);
  if (byEmail.length === 1) {
    return {
      ...base,
      candidates: byEmail,
      suggestion: { ...byEmail[0], match: 'email', confidence: 'alta' },
    };
  }

  // 2) Fallback por nombre visible. Puede traer homónimos.
  const byName = await searchUsers(user.name);
  if (byName.length) {
    const exact = byName.filter((u) => normalize(u.displayName) === normalize(user.name));
    const pick = exact[0] ?? byName[0];
    return {
      ...base,
      candidates: byName,
      suggestion: {
        ...pick,
        match: 'name',
        confidence: exact.length === 1 ? 'media' : 'baja',
      },
      note:
        byName.length > 1
          ? `${byName.length} candidatos por nombre — confirmá cuál corresponde`
          : undefined,
    };
  }

  return { ...base, note: 'sin coincidencias en Jira' };
}

/**
 * Resuelve las identidades de todo el roster. No escribe nada: devuelve
 * sugerencias para que el lead confirme desde la UI.
 */
export async function resolveIdentities(): Promise<{
  suggestions: IdentitySuggestion[];
  errors: string[];
}> {
  const errors: string[] = [];
  const org = env.gitea.orgs[0] ?? env.gitea.repos[0]?.split('/')[0];

  let members: GiteaMember[] = [];
  if (org) {
    try {
      members = (await orgMembers(org)).filter((m) => !isBot(m.login));
    } catch (err) {
      errors.push(`miembros de ${org}: ${describeError(err)}`);
    }
  }

  const suggestions: IdentitySuggestion[] = [];
  for (const user of users) {
    const suggestion = await suggestJira(user);
    const giteaLogin = members.length
      ? suggestGiteaLogin(user, members)
      : user.giteaLogin;
    suggestions.push({
      ...suggestion,
      giteaLogin: giteaLogin ?? user.giteaLogin,
      note:
        !giteaLogin && members.length
          ? [suggestion.note, 'sin login de Gitea que matchee'].filter(Boolean).join(' | ')
          : suggestion.note,
    });
  }

  return { suggestions, errors };
}

export function applyMapping(
  userId: string,
  patch: { giteaLogin?: string; jiraAccountId?: string },
): User | undefined {
  const user = users.find((u) => u.id === userId);
  if (!user) return undefined;
  if (patch.giteaLogin) user.giteaLogin = patch.giteaLogin;
  if (patch.jiraAccountId !== undefined) {
    user.jiraAccountId = patch.jiraAccountId || undefined;
    user.jiraMatch = patch.jiraAccountId ? 'manual' : 'none';
  }
  return user;
}
