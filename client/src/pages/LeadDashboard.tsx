import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  fmtHours,
  type HealthMetrics,
  type ReviewMatrixRow,
  type SnapshotMeta,
} from '../api/client';
import IntegrationBadge from '../components/IntegrationBadge';

type TeamRow = HealthMetrics & { user: { id: string; name: string } };

export default function LeadDashboard() {
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [meta, setMeta] = useState<SnapshotMeta | undefined>();
  const [matrix, setMatrix] = useState<ReviewMatrixRow[]>([]);
  const [people, setPeople] = useState<{ login: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/developers/team/health'),
      api.get('/developers/team/reviews'),
    ])
      .then(([health, reviews]) => {
        setTeam(health.data.team);
        setMeta(health.data.meta);
        setMatrix(reviews.data.matrix);
        setPeople(reviews.data.people);
      })
      .catch(() => setError('No se pudo cargar el equipo'))
      .finally(() => setLoading(false));
  }, []);

  const maxGiven = Math.max(1, ...matrix.flatMap((r) => Object.values(r.given)));

  return (
    <div>
      <h1>Panel del líder técnico</h1>
      <p className="muted">Salud del equipo y herramientas de la daily.</p>
      <IntegrationBadge meta={meta} canSync />

      <div className="grid">
        <Link to="/daily" className="card tile">
          <h3>Facilitar daily</h3>
          <p>Randomizar orden, timer por persona y barreras del día.</p>
        </Link>
        <Link to="/calendario" className="card tile">
          <h3>Calendario</h3>
          <p>Rotación de facilitador, vacaciones, feriados y reuniones.</p>
        </Link>
        <Link to="/mapping" className="card tile">
          <h3>Mapeo de identidades</h3>
          <p>Vincular cada persona con su login de Gitea y su cuenta de Jira.</p>
        </Link>
      </div>

      <h2>Salud del equipo</h2>
      {loading && <p>Cargando…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Desarrollador</th>
                <th>Abiertos</th>
                <th>Mergeados</th>
                <th>Cerrados</th>
                <th>Reviews/PR</th>
                <th>Reviews dados</th>
                <th>Lead time mediano</th>
                <th>Ticket %</th>
                <th>Estancados</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {team.map((row) => (
                <tr key={row.userId}>
                  <td>{row.user.name}</td>
                  <td>{row.totals.open}</td>
                  <td>{row.totals.merged}</td>
                  <td>{row.totals.closed}</td>
                  <td>{row.avgReviewsPerPr}</td>
                  <td>{row.reviewsGiven}</td>
                  <td>{fmtHours(row.medianPrLifetimeHours)}</td>
                  <td className={row.ticketLinkRate < 80 ? 'warn' : ''}>
                    {row.ticketLinkRate}%
                  </td>
                  <td className={row.stalePrs > 0 ? 'warn' : ''}>{row.stalePrs}</td>
                  <td>
                    <Link to={`/health/${row.userId}`}>Ver detalle</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Quién revisa a quién</h2>
      <p className="muted small">
        Filas: revisor. Columnas: autor del PR. Sirve para ver si el review está
        concentrado en una o dos personas.
      </p>
      {!loading && matrix.length > 0 && (
        <div className="card scroll-x">
          <table className="table heatmap">
            <thead>
              <tr>
                <th>Revisor \ Autor</th>
                {people.map((p) => (
                  <th key={p.login} title={p.name}>
                    {p.login.slice(0, 6)}
                  </th>
                ))}
                <th>Dio</th>
                <th>Recibió</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.reviewerLogin}>
                  <td title={row.reviewerName}>{row.reviewerName}</td>
                  {people.map((p) => {
                    const n = row.given[p.login] ?? 0;
                    return (
                      <td
                        key={p.login}
                        className="cell"
                        style={{
                          background: n
                            ? `rgba(21, 101, 192, ${0.15 + (n / maxGiven) * 0.75})`
                            : undefined,
                          color: n / maxGiven > 0.6 ? '#fff' : undefined,
                        }}
                      >
                        {n || ''}
                      </td>
                    );
                  })}
                  <td>
                    <strong>{row.totalGiven}</strong>
                  </td>
                  <td>{row.totalReceived}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
