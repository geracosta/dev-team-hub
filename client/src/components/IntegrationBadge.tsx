import { useEffect, useState } from 'react';
import { api, timeAgo, type IntegrationStatus, type SnapshotMeta } from '../api/client';

/**
 * Indicador de si lo que se está viendo son datos reales de Gitea/Jira o el
 * modo mock. Sin esto es imposible saber si una métrica en cero es un problema
 * del equipo o una integración apagada.
 */
export default function IntegrationBadge({
  meta,
  canSync,
}: {
  meta?: SnapshotMeta;
  canSync?: boolean;
}) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState(false);

  const load = () =>
    api
      .get('/integrations/status')
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));

  useEffect(() => {
    load();
  }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      await api.post('/integrations/sync');
      await load();
      // La página que muestra métricas necesita releer con el snapshot nuevo.
      window.location.reload();
    } finally {
      setSyncing(false);
    }
  };

  const mode = meta?.mode ?? status?.snapshot?.mode;
  const real = mode === 'real';
  const syncedAt = meta?.syncedAt ?? status?.snapshot?.syncedAt;

  return (
    <div className={`integration-badge ${real ? 'ok' : 'mock'}`}>
      <button className="link" onClick={() => setDetail(!detail)}>
        <span className="dot" />
        {real ? 'Gitea: datos reales' : 'Datos mock'}
        {syncedAt && <span className="muted small"> · {timeAgo(syncedAt)}</span>}
        {status && !status.jira.enabled && (
          <span className="muted small"> · Jira: stub</span>
        )}
        {status?.jira.enabled && (
          <span className="muted small">
            {' '}
            · Jira: {status.jira.writeEnabled ? 'escritura on' : 'sólo lectura'}
          </span>
        )}
        {meta?.degraded && <span className="warn-text small"> · con errores</span>}
      </button>

      {canSync && (
        <button className="ghost small" onClick={sync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      )}

      {detail && status && (
        <div className="integration-detail card">
          <p>
            <strong>Gitea</strong> — {status.gitea.baseUrl}
            {status.gitea.version && ` (v${status.gitea.version})`}
            {status.gitea.login && ` como ${status.gitea.login}`}
            {!status.gitea.enabled && ' — deshabilitado (GITEA_ENABLED=false)'}
            {status.gitea.error && ` — ${status.gitea.error}`}
          </p>
          <p className="muted small">
            Ventana: {status.gitea.windowMonths} meses · Repos:{' '}
            {Array.isArray(status.gitea.repos)
              ? status.gitea.repos.join(', ')
              : status.gitea.repos}
            {!status.gitea.fetchSizes && ' · tamaños de PR desactivados'}
          </p>
          <p>
            <strong>Jira</strong> — {status.jira.baseUrl ?? 'sin configurar'}
            {status.jira.displayName && ` como ${status.jira.displayName}`}
            {!status.jira.enabled &&
              ' — comentarios y worklogs se simulan (JIRA_ENABLED=false)'}
            {status.jira.error && status.jira.enabled && ` — ${status.jira.error}`}
          </p>
          {status.snapshot && (
            <p className="muted small">
              Último snapshot: {status.snapshot.prs} PRs de {status.snapshot.repos} repos
              en {(status.snapshot.durationMs / 1000).toFixed(1)}s
              {status.snapshot.truncated && ' (truncado)'}
            </p>
          )}
          {status.snapshot?.errors?.map((e) => (
            <p className="error small" key={e}>
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
