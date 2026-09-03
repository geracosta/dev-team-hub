import { useEffect, useState } from 'react';
import { api, type IdentitySuggestion, type MappingUser } from '../api/client';

/**
 * Mapeo app ↔ Gitea ↔ Jira. No auto-asigna: propone y el lead confirma, porque
 * el match por nombre puede traer homónimos.
 */
export default function Mapping() {
  const [users, setUsers] = useState<MappingUser[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, IdentitySuggestion>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [resolving, setResolving] = useState(false);

  const load = () =>
    api.get('/integrations/mapping').then((r) => setUsers(r.data.users));

  useEffect(() => {
    load();
  }, []);

  const resolve = async () => {
    setResolving(true);
    setStatus('Consultando Gitea y Jira…');
    try {
      const { data } = await api.post('/integrations/mapping/resolve');
      const map: Record<string, IdentitySuggestion> = {};
      for (const s of data.suggestions as IdentitySuggestion[]) map[s.userId] = s;
      setSuggestions(map);
      setErrors(data.errors ?? []);
      setStatus(`${data.suggestions.length} usuarios analizados`);
    } catch {
      setStatus('Falló la resolución');
    } finally {
      setResolving(false);
    }
  };

  const apply = async (
    userId: string,
    patch: { giteaLogin?: string; jiraAccountId?: string },
  ) => {
    await api.put(`/integrations/mapping/${userId}`, patch);
    await load();
    setStatus('Mapeo actualizado ✓');
  };

  const applyAllConfident = async () => {
    const targets = Object.values(suggestions).filter(
      (s) => s.suggestion?.confidence === 'alta' && !s.currentJiraAccountId,
    );
    for (const s of targets) {
      await apply(s.userId, {
        giteaLogin: s.giteaLogin,
        jiraAccountId: s.suggestion!.accountId,
      });
    }
    setStatus(`${targets.length} identidades aplicadas`);
  };

  return (
    <div>
      <h1>Mapeo de identidades</h1>
      <p className="muted">
        Cada persona necesita su login de Gitea (para las métricas) y su cuenta de
        Jira (para comentarios y worklogs). En Gitea los mails de terceros vienen
        enmascarados, así que la búsqueda usa{' '}
        <code>&lt;giteaLogin&gt;@dominio</code> y, si falla, el nombre visible.
      </p>

      <div className="actions">
        <button onClick={resolve} disabled={resolving}>
          {resolving ? 'Resolviendo…' : 'Resolver identidades'}
        </button>
        <button
          className="secondary"
          onClick={applyAllConfident}
          disabled={!Object.keys(suggestions).length}
        >
          Aplicar las de confianza alta
        </button>
        <span className="muted">{status}</span>
      </div>

      {errors.map((e) => (
        <p className="error small" key={e}>
          {e}
        </p>
      ))}

      <div className="card scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Gitea</th>
              <th>Jira actual</th>
              <th>Sugerencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const s = suggestions[u.id];
              return (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td>
                    <code>{u.giteaLogin}</code>
                    {s && s.giteaLogin !== u.giteaLogin && (
                      <div className="warn-text small">sugerido: {s.giteaLogin}</div>
                    )}
                  </td>
                  <td>
                    {u.jiraAccountId ? (
                      <span title={u.jiraAccountId}>
                        {u.jiraAccountId.slice(0, 12)}…
                        <div className="muted small">{u.jiraMatch}</div>
                      </span>
                    ) : (
                      <span className="muted">sin vincular</span>
                    )}
                  </td>
                  <td>
                    {s?.suggestion ? (
                      <>
                        {s.suggestion.displayName}
                        <div className="muted small">
                          match por {s.suggestion.match} · confianza{' '}
                          <span
                            className={
                              s.suggestion.confidence === 'alta' ? '' : 'warn-text'
                            }
                          >
                            {s.suggestion.confidence}
                          </span>
                        </div>
                        {s.candidates.length > 1 && (
                          <select
                            onChange={(e) =>
                              apply(u.id, { jiraAccountId: e.target.value })
                            }
                            defaultValue=""
                          >
                            <option value="" disabled>
                              {s.candidates.length} candidatos…
                            </option>
                            {s.candidates.map((c) => (
                              <option key={c.accountId} value={c.accountId}>
                                {c.displayName} {c.email ? `(${c.email})` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    ) : (
                      <span className="muted small">{s?.note ?? '—'}</span>
                    )}
                  </td>
                  <td>
                    {s?.suggestion && (
                      <button
                        className="ghost small"
                        onClick={() =>
                          apply(u.id, {
                            giteaLogin: s.giteaLogin,
                            jiraAccountId: s.suggestion!.accountId,
                          })
                        }
                      >
                        Aplicar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
