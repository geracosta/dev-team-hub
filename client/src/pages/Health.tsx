import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  api,
  fmtHours,
  type HealthMetrics,
  type PullRequestDto,
  type SnapshotMeta,
} from '../api/client';
import IntegrationBadge from '../components/IntegrationBadge';

export default function Health() {
  const { userId } = useParams();
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | undefined>();
  const [pulls, setPulls] = useState<PullRequestDto[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = userId ? `/developers/${userId}/health` : '/developers/me/health';
    api
      .get(url)
      .then((r) => {
        setHealth(r.data.health);
        setMeta(r.data.meta);
        return api.get(`/developers/${r.data.health.userId}/pulls`);
      })
      .then((r) => setPulls(r.data.pulls))
      .catch(() => setError('No se pudo cargar la salud'));
  }, [userId]);

  if (error) return <p className="error">{error}</p>;
  if (!health) return <p>Cargando…</p>;

  const stalled = pulls.filter((p) => p.state === 'open' && p.reviewsCount === 0);
  const months = meta
    ? Math.max(
        1,
        Math.round(
          (Date.now() - new Date(meta.windowFrom).getTime()) / (30 * 864e5),
        ),
      )
    : 6;

  return (
    <div>
      <h1>Salud del desarrollador</h1>
      <p className="muted">
        Gitea login: <code>{health.giteaLogin}</code> · {health.sampleSize} PRs en los
        últimos {months} meses · {health.repos.length} repos
      </p>
      <IntegrationBadge meta={meta} />

      {health.sampleSize === 0 && (
        <p className="warn-text">
          Sin PRs en la ventana analizada. Revisá que el login de Gitea sea el
          correcto en el mapeo de identidades.
        </p>
      )}

      <div className="stats">
        <Stat label="PRs abiertos" value={health.totals.open} />
        <Stat label="Mergeados" value={health.totals.merged} />
        <Stat label="Cerrados" value={health.totals.closed} />
        <Stat label="Merges / semana" value={health.mergesPerWeek} />
        <Stat label="Reviews recibidos" value={health.reviewsReceived} />
        <Stat label="Reviews dados" value={health.reviewsGiven} />
        <Stat label="Reviews / PR" value={health.avgReviewsPerPr} />
        <Stat
          label="Lead time mediano"
          value={fmtHours(health.medianPrLifetimeHours)}
          hint={`promedio ${fmtHours(health.avgPrLifetimeHours)}`}
        />
        <Stat
          label="Al 1er review (mediana)"
          value={fmtHours(health.medianTimeToFirstReviewHours)}
          hint="responsiveness del equipo"
        />
        <Stat
          label="Trazabilidad a ticket"
          value={`${health.ticketLinkRate}%`}
          warn={health.ticketLinkRate < 80}
          hint="PRs con key de Jira detectada"
        />
        <Stat
          label="Abiertos sin review"
          value={health.openWithoutReview}
          warn={health.openWithoutReview > 1}
        />
        <Stat
          label={`Estancados > ${health.staleDays} d`}
          value={health.stalePrs}
          warn={health.stalePrs > 0}
        />
        {health.fixRatio !== undefined && (
          <Stat label="PRs de fix" value={`${health.fixRatio}%`} />
        )}
        {meta?.sizesFetched ? (
          <Stat label="Tamaño medio (líneas)" value={health.avgPrSizeLines} />
        ) : (
          <Stat
            label="Tamaño medio"
            value="—"
            hint="activá GITEA_FETCH_SIZES para medirlo"
          />
        )}
      </div>

      <h2>PRs por mes</h2>
      <div className="card chart">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={health.byMonth}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="merged" stackId="a" fill="#2e7d32" name="Mergeados" />
            <Bar dataKey="open" stackId="a" fill="#1565c0" name="Abiertos" />
            <Bar dataKey="closed" stackId="a" fill="#b71c1c" name="Cerrados" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2>Lead time mediano por mes</h2>
      <p className="muted small">
        Horas desde que se abre el PR hasta que se mergea. Interesa la tendencia,
        no el valor puntual.
      </p>
      <div className="card chart">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={health.byMonth}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(v: number) => `${v} h`} />
            <Line
              type="monotone"
              dataKey="medianLeadTimeHours"
              stroke="#6a1b9a"
              strokeWidth={2}
              name="Lead time mediano (h)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {health.reviewersBreakdown.length > 0 && (
        <>
          <h2>Quién te revisa</h2>
          <p className="muted small">
            Si el review se concentra en una sola persona, hay dependencia de un
            único knowledge holder.
          </p>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Revisor</th>
                  <th>Reviews</th>
                </tr>
              </thead>
              <tbody>
                {health.reviewersBreakdown.map((r) => (
                  <tr key={r.login}>
                    <td>
                      <code>{r.login}</code>
                    </td>
                    <td>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {stalled.length > 0 && (
        <>
          <h2>PRs abiertos sin review</h2>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Repo</th>
                  <th>PR</th>
                  <th>Ticket</th>
                  <th>Título</th>
                  <th>Abierto</th>
                </tr>
              </thead>
              <tbody>
                {stalled.slice(0, 10).map((p) => (
                  <tr key={`${p.repo}#${p.number}`}>
                    <td>{p.repo}</td>
                    <td>
                      {p.htmlUrl ? (
                        <a href={p.htmlUrl} target="_blank" rel="noreferrer">
                          #{p.number}
                        </a>
                      ) : (
                        `#${p.number}`
                      )}
                    </td>
                    <td>{p.ticketKey ?? '—'}</td>
                    <td className="truncate">{p.title}</td>
                    <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="muted small">
        Criterio de cada métrica y anti-patrones en <code>docs/METRICAS.md</code>.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  hint,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className={`stat card ${warn ? 'warn' : ''}`} title={hint}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
