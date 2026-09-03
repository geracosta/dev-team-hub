import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, shortDate, type FacilitatorAssignment } from '../api/client';
import IntegrationBadge from '../components/IntegrationBadge';

export default function DeveloperDashboard() {
  const { user } = useAuth();
  const [today, setToday] = useState<FacilitatorAssignment | null>(null);
  const [myTurns, setMyTurns] = useState<string[]>([]);

  useEffect(() => {
    api
      .get('/calendar/facilitator/today')
      .then((r) => {
        setToday(r.data.today);
        setMyTurns(r.data.myNextTurns ?? []);
      })
      .catch(() => setToday(null));
  }, []);

  const isMine = Boolean(today?.userId && today.userId === user?.id);

  return (
    <div>
      <h1>Hola, {user?.name}</h1>
      <p className="muted">Vista de desarrollador.</p>
      <IntegrationBadge />

      {today && (
        <p className={`facilitator-today ${isMine ? 'mine' : ''}`}>
          {today.source === 'no-laborable' ? (
            <>
              Hoy no hay daily — <strong>{today.nonWorkingReason}</strong>.
            </>
          ) : isMine ? (
            <>
              <strong>Hoy facilitás vos la daily.</strong>
            </>
          ) : (
            <>
              Hoy facilita <strong>{today.userName ?? '—'}</strong>.
              {myTurns.length > 0 && (
                <span className="muted"> Te toca el {shortDate(myTurns[0])}.</span>
              )}
            </>
          )}
        </p>
      )}

      <div className="grid">
        <Link to="/health" className="card tile">
          <h3>Mi salud</h3>
          <p>PRs por mes, code reviews, lead time y señales de tu trabajo.</p>
        </Link>
        <Link to="/daily" className="card tile">
          <h3>Mi daily</h3>
          <p>Cargá qué hiciste ayer (con horas) y qué vas a trabajar hoy.</p>
        </Link>
        <Link to="/calendario" className="card tile">
          <h3>Calendario</h3>
          <p>Turnos de facilitador, vacaciones, feriados y reuniones del equipo.</p>
        </Link>
      </div>
    </div>
  );
}
