import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, shortDate, type FacilitatorAssignment } from '../api/client';
import { useAuth } from '../context/AuthContext';
import MyPreUpdate from '../components/MyPreUpdate';
import FacilitatorPanel from '../components/FacilitatorPanel';

export default function Daily() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'mine' | 'facilitator'>('mine');
  const [today, setToday] = useState<FacilitatorAssignment | null>(null);
  const [myTurns, setMyTurns] = useState<string[]>([]);

  useEffect(() => {
    api
      .get('/calendar/facilitator/today')
      .then((r) => {
        setToday(r.data.today);
        setMyTurns(r.data.myNextTurns ?? []);
        // Si hoy te toca facilitar, la pantalla útil es la del facilitador.
        if (r.data.isMine) setTab('facilitator');
      })
      .catch(() => setToday(null));
  }, []);

  const isMine = Boolean(today?.userId && today.userId === user?.id);

  return (
    <div>
      <h1>Daily</h1>

      {today && (
        <p className={`facilitator-today ${isMine ? 'mine' : ''}`}>
          {today.source === 'no-laborable' ? (
            <>
              Hoy no hay daily — <strong>{today.nonWorkingReason}</strong>.
            </>
          ) : isMine ? (
            <>
              <strong>Hoy facilitás vos.</strong> Abrí la pestaña “Facilitar” para
              correr la ronda.
            </>
          ) : today.userName ? (
            <>
              Hoy facilita <strong>{today.userName}</strong>.
            </>
          ) : (
            <>Hoy no hay facilitador disponible.</>
          )}
          {myTurns.length > 0 && !isMine && (
            <span className="muted">
              {' '}
              · Tu próximo turno: {shortDate(myTurns[0])}
            </span>
          )}
          <Link to="/calendario" className="muted small">
            {' '}
            ver calendario
          </Link>
        </p>
      )}

      {/* Todo el equipo rota como facilitador, así que la pestaña está para todos. */}
      <div className="tabs">
        <button
          className={tab === 'mine' ? 'active' : ''}
          onClick={() => setTab('mine')}
        >
          Mi pre-update
        </button>
        <button
          className={tab === 'facilitator' ? 'active' : ''}
          onClick={() => setTab('facilitator')}
        >
          Facilitar
        </button>
      </div>

      {tab === 'facilitator' ? <FacilitatorPanel /> : <MyPreUpdate />}
    </div>
  );
}
