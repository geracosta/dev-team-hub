import { useEffect, useState } from 'react';
import {
  api,
  shortDate,
  type DailySession,
  type DailyEntry,
  type FacilitatorAssignment,
  type FacilitatorRound,
  type RoundEntry,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import CountdownTimer from './CountdownTimer';

/**
 * Panel para el facilitador: randomiza orden y corre la ronda con timer.
 * Lo puede ver todo el equipo (todos rotan como facilitador), pero sólo quien
 * facilita ese día — o un lead cubriéndolo — puede operarlo.
 */
export default function FacilitatorPanel() {
  const { user } = useAuth();
  const [session, setSession] = useState<DailySession | null>(null);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [facilitator, setFacilitator] = useState<FacilitatorAssignment | null>(null);
  const [round, setRound] = useState<FacilitatorRound | null>(null);
  const [canRun, setCanRun] = useState(false);
  const [blockedFirst, setBlockedFirst] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await api.get('/daily/today');
    setSession(data.session);
    setEntries(data.entries);
    setFacilitator(data.facilitator ?? null);
    setRound(data.round ?? null);
    setCanRun(Boolean(data.canFacilitate));
  };

  useEffect(() => {
    load();
  }, []);

  const randomize = async () => {
    setError('');
    try {
      const { data } = await api.post('/daily/today/randomize', { blockedFirst });
      setSession(data.session);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const advance = async () => {
    setError('');
    try {
      const { data } = await api.post('/daily/today/advance');
      setSession(data.session);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  if (!session) return <p>Cargando…</p>;

  const entryByUser = (id: string) => entries.find((e) => e.userId === id);
  const currentId = session.order[session.currentIndex];
  const current = currentId ? entryByUser(currentId) : undefined;
  const isRunning = session.status === 'running' && session.order.length > 0;

  return (
    <div className="card facilitator">
      <div className="facilitator-head">
        <h2>
          {facilitator?.dailyNumber ? `Daily #${facilitator.dailyNumber}` : 'Daily'}
          <span className="muted"> · {session.date}</span>
          {facilitator?.userName && (
            <span className="muted"> · facilita {facilitator.userName}</span>
          )}
        </h2>
        {facilitator?.roundNumber && (
          <span className="badge badge-round" title="Ronda de facilitadores">
            Ronda {facilitator.roundNumber}
            {facilitator.positionInRound && round
              ? ` · turno ${facilitator.positionInRound}/${round.size}`
              : ''}
          </span>
        )}
        <label className="muted">
          <input
            type="checkbox"
            checked={blockedFirst}
            onChange={(e) => setBlockedFirst(e.target.checked)}
            disabled={!canRun}
          />
          Bloqueados primero
        </label>
        <button onClick={randomize} disabled={!canRun}>
          🎲 Randomizar orden
        </button>
        <button className="ghost" onClick={load}>
          Refrescar
        </button>
      </div>

      {!canRun && (
        <p className="muted">
          {facilitator?.source === 'no-laborable'
            ? `Hoy no hay daily — ${facilitator.nonWorkingReason}.`
            : facilitator?.userName
              ? `Hoy facilita ${facilitator.userName}. Podés seguir la ronda desde acá, ` +
                'pero sólo esa persona (o un líder) puede operarla.'
              : 'Hoy no hay facilitador asignado.'}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {canRun && !isRunning && session.status !== 'closed' && (
        <p className="muted">Randomizá el orden para arrancar la ronda.</p>
      )}

      {session.status === 'closed' && (
        <p className="ok">Daily cerrada. ¡Buen día de trabajo!</p>
      )}

      {isRunning && (
        <div className="speaker-layout">
          <div className="speaker-main">
            <div className="speaker-head">
              <span className="speaker-pos">
                {session.currentIndex + 1} / {session.order.length}
              </span>
              <h2>{nameOf(currentId, entries)}</h2>
              {current && current.barreras.length > 0 && (
                <span className="badge badge-blocked">Bloqueado</span>
              )}
            </div>

            {current ? (
              <div className="speaker-detail">
                <Section title="Ayer">
                  {current.yesterday.length ? (
                    current.yesterday.map((y, i) => (
                      <li key={i}>
                        <strong>{y.ticketKey}</strong> — {y.comment}
                      </li>
                    ))
                  ) : (
                    <li className="muted">Sin registro</li>
                  )}
                </Section>
                <Section title="Hoy">
                  {current.today.length ? (
                    current.today.map((t, i) => (
                      <li key={i}>
                        <strong>{t.ticketKey}</strong> — {t.comment}
                      </li>
                    ))
                  ) : (
                    <li className="muted">Sin registro</li>
                  )}
                </Section>
                <Section title="Barreras">
                  {current.barreras.length ? (
                    current.barreras.map((b, i) => (
                      <li key={i}>
                        {b.ticketKey ? <strong>{b.ticketKey} — </strong> : null}
                        {b.comment}
                      </li>
                    ))
                  ) : (
                    <li className="muted">Sin barreras</li>
                  )}
                </Section>
              </div>
            ) : (
              <p className="muted">Esta persona no cargó pre-update.</p>
            )}
          </div>

          <div className="speaker-side">
            <CountdownTimer
              seconds={session.perPersonSeconds}
              resetKey={`${session.currentIndex}-${currentId}`}
            />
            <button className="big" onClick={advance} disabled={!canRun}>
              {session.currentIndex < session.order.length - 1
                ? 'Siguiente ▶'
                : 'Cerrar daily'}
            </button>
            <ol className="order-list">
              {session.order.map((id, i) => (
                <li key={id} className={i === session.currentIndex ? 'active' : ''}>
                  {nameOf(id, entries)}
                  {(entryByUser(id)?.barreras.length ?? 0) > 0 ? ' 🚧' : ''}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {round && <RoundList round={round} meId={user?.id} />}
    </div>
  );
}

/**
 * La ronda completa: quién facilita cada día hábil hasta que se cierre la vuelta.
 * Reemplaza a la lista que se pegaba a mano en el canal del equipo, con la
 * ventaja de que se recalcula sola cuando cambia el roster o hay una ausencia.
 */
function RoundList({ round, meId }: { round: FacilitatorRound; meId?: string }) {
  return (
    <div className="round">
      <div className="round-head">
        <h3>Ronda {round.number}</h3>
        <span className="muted small">
          {round.size} personas · {shortDate(round.from)} → {shortDate(round.to)}
        </span>
      </div>
      <ol className="round-list">
        {round.entries.map((entry) => (
          <RoundRow key={entry.date} entry={entry} isMine={entry.userId === meId} />
        ))}
      </ol>
    </div>
  );
}

function RoundRow({ entry, isMine }: { entry: RoundEntry; isMine: boolean }) {
  // El facilitador efectivo difiere del de la rotación cuando la persona está
  // ausente o el lead reasignó el día: mostramos ambos para que no sorprenda.
  const reassigned =
    Boolean(entry.effectiveUserName) && entry.effectiveUserName !== entry.userName;

  return (
    <li
      className={[
        'round-row',
        `is-${entry.status}`,
        isMine ? 'mine' : '',
        entry.nonWorkingReason ? 'nonworking' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="round-pos">{entry.position}</span>
      <span className="round-date">{shortDate(entry.date)}</span>
      <span className="round-name">
        {reassigned ? (
          <>
            <s className="muted">{entry.userName}</s> → {entry.effectiveUserName}
          </>
        ) : (
          entry.userName
        )}
        {isMine && <span className="badge badge-mine small"> vos</span>}
      </span>
      <span className="round-num muted small">
        {entry.nonWorkingReason ?? (entry.dailyNumber ? `#${entry.dailyNumber}` : '—')}
      </span>
    </li>
  );
}

function nameOf(id: string | undefined, entries: DailyEntry[]): string {
  if (!id) return '—';
  return entries.find((e) => e.userId === id)?.user?.name ?? id;
}

function errMsg(e: unknown): string {
  const res = (e as { response?: { data?: { error?: string } } }).response;
  return res?.data?.error ?? 'No se pudo completar la acción';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h4>{title}</h4>
      <ul>{children}</ul>
    </div>
  );
}
