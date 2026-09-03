import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  dateKey,
  monthName,
  shortDate,
  ABSENCE_TYPES,
  EVENT_META,
  type CalendarDay,
  type CalendarEventType,
  type CalendarPerson,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Calendario del equipo: quién facilita cada día hábil, más vacaciones,
 * licencias, feriados y reuniones.
 */
export default function Calendar() {
  const { user } = useAuth();
  const isLead = user?.role === 'lead';
  const today = dateKey(new Date());

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [people, setPeople] = useState<CalendarPerson[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/calendar', {
        params: { year: cursor.year, month: cursor.month },
      });
      setDays(data.days);
      setPeople(data.people);
    } catch {
      setError('No se pudo cargar el calendario');
    } finally {
      setLoading(false);
    }
  }, [cursor.year, cursor.month]);

  useEffect(() => {
    load();
  }, [load]);

  const move = (delta: number) => {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setSelected(null);
  };

  const byDate = useMemo(
    () => new Map(days.map((d) => [d.date, d])),
    [days],
  );

  // Huecos al inicio para que el 1° caiga en su día de la semana (semana Lun-Dom).
  const leading = days.length
    ? (new Date(cursor.year, cursor.month - 1, 1).getDay() + 6) % 7
    : 0;

  const myTurns = days.filter((d) => d.userId === user?.id).map((d) => d.date);
  const selectedDay = selected ? byDate.get(selected) : undefined;

  return (
    <div>
      <h1>Calendario del equipo</h1>
      <p className="muted">
        Cada día hábil tiene un facilitador asignado por rotación — todo el equipo
        rota, líderes incluidos. Los fines de semana y feriados no tienen daily.
      </p>

      <div className="cal-head">
        <button className="ghost" onClick={() => move(-1)}>
          ← Anterior
        </button>
        <h2>
          {monthName(cursor.month)} {cursor.year}
        </h2>
        <button className="ghost" onClick={() => move(1)}>
          Siguiente →
        </button>
        <span className="spacer" />
        {myTurns.length > 0 ? (
          <span className="badge badge-mine">
            Te toca {myTurns.length === 1 ? 'el' : 'los días'}{' '}
            {myTurns.map((d) => Number(d.slice(-2))).join(', ')}
          </span>
        ) : (
          <span className="muted small">No te toca facilitar este mes</span>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p>Cargando…</p>}

      {!loading && !error && (
        <>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => (
              <div className="cal-dow" key={w}>
                {w}
              </div>
            ))}
            {Array.from({ length: leading }, (_, i) => (
              <div className="cal-cell empty" key={`pad-${i}`} />
            ))}
            {days.map((day) => {
              const isToday = day.date === today;
              const isMine = day.userId === user?.id;
              const nonWorking = day.source === 'no-laborable';
              return (
                <button
                  type="button"
                  key={day.date}
                  className={[
                    'cal-cell',
                    day.weekend ? 'weekend' : '',
                    nonWorking && !day.weekend ? 'holiday' : '',
                    isToday ? 'today' : '',
                    isMine ? 'mine' : '',
                    selected === day.date ? 'selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelected(selected === day.date ? null : day.date)}
                >
                  <span className="cal-daynum">{Number(day.date.slice(-2))}</span>

                  {day.userName && (
                    <span className="cal-facilitator" title="Facilitador">
                      {day.source === 'override' && '↔ '}
                      {day.userName}
                    </span>
                  )}
                  {nonWorking && !day.weekend && (
                    <span className="cal-nonworking">{day.nonWorkingReason}</span>
                  )}
                  {day.source === 'sin-disponibles' && (
                    <span className="cal-nonworking warn-text">Sin facilitador</span>
                  )}

                  <span className="cal-events">
                    {day.events.map((e) => (
                      <span
                        key={e.id}
                        className={`cal-chip ${EVENT_META[e.type].className}`}
                        title={`${EVENT_META[e.type].label}: ${e.title}${
                          e.time ? ` (${e.time})` : ''
                        }`}
                      >
                        {EVENT_META[e.type].icon}
                        {e.type === 'reunion' && e.time ? ` ${e.time}` : ''}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="cal-legend muted small">
            {Object.entries(EVENT_META).map(([type, meta]) => (
              <span key={type}>
                {meta.icon} {meta.label}
              </span>
            ))}
            <span className="legend-mine">■ tu turno</span>
          </div>

          {selectedDay && (
            <DayDetail
              day={selectedDay}
              people={people}
              isLead={isLead}
              currentUserId={user?.id}
              onChanged={load}
            />
          )}

          <NewEvent
            people={people}
            isLead={isLead}
            defaultFrom={selected ?? today}
            onCreated={load}
          />
        </>
      )}
    </div>
  );
}

function DayDetail({
  day,
  people,
  isLead,
  currentUserId,
  onChanged,
}: {
  day: CalendarDay;
  people: CalendarPerson[];
  isLead: boolean;
  currentUserId?: string;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState('');
  const canReassign = isLead || day.userId === currentUserId;

  const reassign = async (userId: string) => {
    setStatus('Guardando…');
    try {
      await api.put(`/calendar/facilitator/${day.date}`, { userId });
      setStatus('');
      onChanged();
    } catch (e) {
      setStatus(errMsg(e));
    }
  };

  const removeEvent = async (id: string) => {
    setStatus('Borrando…');
    try {
      await api.delete(`/calendar/events/${id}`);
      setStatus('');
      onChanged();
    } catch (e) {
      setStatus(errMsg(e));
    }
  };

  return (
    <div className="card cal-detail">
      <h3>{shortDate(day.date)}</h3>

      {day.source === 'no-laborable' ? (
        <p className="muted">No laborable — {day.nonWorkingReason}. No hay daily.</p>
      ) : (
        <p>
          Facilita: <strong>{day.userName ?? 'nadie disponible'}</strong>
          {day.source === 'override' && (
            <span className="muted small"> (asignado a mano)</span>
          )}
        </p>
      )}

      {day.skipped.length > 0 && (
        <p className="muted small">
          Salteados por ausencia:{' '}
          {day.skipped.map((s) => `${s.userName} (${s.reason})`).join(', ')}
        </p>
      )}

      {canReassign && day.source !== 'no-laborable' && (
        <div className="row">
          <label className="muted">
            Reasignar a{' '}
            <select
              value={day.userId ?? ''}
              onChange={(e) => reassign(e.target.value)}
            >
              <option value="">— rotación automática —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {day.events.length > 0 && (
        <ul className="cal-detail-events">
          {day.events.map((e) => {
            const owner = people.find((p) => p.id === e.userId);
            const canDelete =
              isLead || e.createdBy === currentUserId || e.userId === currentUserId;
            return (
              <li key={e.id}>
                <span className={`cal-chip ${EVENT_META[e.type].className}`}>
                  {EVENT_META[e.type].icon} {EVENT_META[e.type].label}
                </span>{' '}
                {e.title}
                {e.time && <span className="muted"> · {e.time}</span>}
                {owner && <span className="muted"> · {owner.name}</span>}
                {e.from !== e.to && (
                  <span className="muted small">
                    {' '}
                    ({shortDate(e.from)} → {shortDate(e.to)})
                  </span>
                )}
                {e.notes && <div className="muted small">{e.notes}</div>}
                {canDelete && (
                  <button className="ghost small" onClick={() => removeEvent(e.id)}>
                    Borrar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {status && <p className="error small">{status}</p>}
    </div>
  );
}

function NewEvent({
  people,
  isLead,
  defaultFrom,
  onCreated,
}: {
  people: CalendarPerson[];
  isLead: boolean;
  defaultFrom: string;
  onCreated: () => void;
}) {
  const [type, setType] = useState<CalendarEventType>('vacaciones');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultFrom);
  const [time, setTime] = useState('');
  const [userId, setUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setFrom(defaultFrom);
    setTo((prev) => (prev < defaultFrom ? defaultFrom : prev));
  }, [defaultFrom]);

  const isAbsence = ABSENCE_TYPES.includes(type);
  // Los feriados sólo los carga el lead; el resto, cualquiera.
  const types: CalendarEventType[] = isLead
    ? ['vacaciones', 'licencia', 'feriado', 'reunion']
    : ['vacaciones', 'licencia', 'reunion'];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Guardando…');
    try {
      await api.post('/calendar/events', {
        type,
        title: title.trim() || undefined,
        from,
        to: to || from,
        time: type === 'reunion' && time ? time : undefined,
        userId: (isAbsence && isLead) || type === 'reunion' ? userId || undefined : undefined,
        notes: notes.trim() || undefined,
      });
      setStatus('Agregado ✓');
      setTitle('');
      setNotes('');
      setTime('');
      onCreated();
    } catch (err) {
      setStatus(errMsg(err));
    }
  };

  return (
    <form className="card cal-form" onSubmit={submit}>
      <h3>Agregar al calendario</h3>
      <div className="row wrap">
        <label>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value as CalendarEventType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {EVENT_META[t].icon} {EVENT_META[t].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {type === 'reunion' && (
          <label>
            Hora
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
        {((isAbsence && isLead) || type === 'reunion') && (
          <label>
            {isAbsence ? 'Persona' : 'Sólo para (opcional)'}
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{isAbsence ? '— yo —' : '— todo el equipo —'}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row wrap">
        <label className="grow">
          Título
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={EVENT_META[type].label}
          />
        </label>
        <label className="grow">
          Notas
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional"
          />
        </label>
      </div>
      <div className="actions">
        <button type="submit">Agregar</button>
        <span className="muted">{status}</span>
      </div>
      {isAbsence && !isLead && (
        <p className="muted small">
          Podés cargar tus propias ausencias. Las de otras personas las carga el lead.
        </p>
      )}
    </form>
  );
}

function errMsg(e: unknown): string {
  const res = (e as { response?: { data?: { error?: string } } }).response;
  return res?.data?.error ?? 'No se pudo completar la acción';
}
