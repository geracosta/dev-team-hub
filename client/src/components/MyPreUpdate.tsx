import { useEffect, useRef, useState } from 'react';
import {
  api,
  TICKET_RE,
  type DailyEntry,
  type JiraIssueCheck,
  type JiraSyncItem,
  type PreUpdateItem,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

const vacio = (): PreUpdateItem => ({ ticketKey: '', comment: '' });

/** Un ítem cuenta si tiene ticket o texto; los vacíos no se guardan. */
const cargado = (item: PreUpdateItem) =>
  Boolean(item.ticketKey.trim() || item.comment.trim());

/**
 * Editor del pre-update: ayer, hoy y barreras.
 *
 * Las tres secciones son el mismo bloque — ticket de Jira como título y un
 * comentario libre debajo — así se carga siempre igual. Lo de ayer va a Jira
 * como comentario del ticket; las horas se imputan por fuera, no se piden acá.
 */
export default function MyPreUpdate({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth();
  const [yesterday, setYesterday] = useState<PreUpdateItem[]>([vacio()]);
  const [today, setToday] = useState<PreUpdateItem[]>([vacio()]);
  const [barreras, setBarreras] = useState<PreUpdateItem[]>([]);
  const [status, setStatus] = useState('');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<JiraSyncItem[]>([]);

  useEffect(() => {
    api.get('/daily/today').then((r) => {
      const mine = (r.data.entries as DailyEntry[]).find(
        (e) => e.userId === user?.id,
      );
      if (mine) {
        setEntryId(mine.id);
        if (mine.yesterday.length) setYesterday(mine.yesterday);
        if (mine.today.length) setToday(mine.today);
        setBarreras(mine.barreras);
      }
    });
  }, [user?.id]);

  const save = async () => {
    setStatus('Guardando…');
    const { data } = await api.post('/daily/today/entry', {
      yesterday: yesterday.filter(cargado),
      today: today.filter(cargado),
      barreras: barreras.filter(cargado),
    });
    setEntryId(data.entry.id);
    setStatus('Guardado ✓');
    onSaved?.();
  };

  const syncJira = async () => {
    if (!entryId) {
      setStatus('Guardá primero');
      return;
    }
    setStatus('Sincronizando a Jira…');
    setSyncResult([]);
    try {
      // 207 = algunos tickets fallaron; axios no lo trata como error.
      const { data } = await api.post(`/daily/entry/${entryId}/sync-jira`, null, {
        validateStatus: (s) => s < 400,
      });
      const results: JiraSyncItem[] = data.results ?? [];
      setSyncResult(results);
      if (!results.length) setStatus('No hay tickets de ayer para sincronizar');
      else if (data.stubbed) setStatus('Sync simulada (Jira en modo stub)');
      else if (data.synced) setStatus('Comentarios enviados a Jira ✓');
      else setStatus('Algunos tickets fallaron — ver detalle');
    } catch {
      setStatus('No se pudo sincronizar');
    }
  };

  return (
    <div className="card">
      <h2>Mi pre-update</h2>

      <EntrySection
        title="Ayer — qué hice"
        hint="va a Jira como comentario del ticket"
        placeholder="Qué se hizo…"
        addLabel="+ ticket"
        items={yesterday}
        onChange={setYesterday}
      />

      <EntrySection
        title="Hoy — qué voy a trabajar"
        placeholder="Plan para hoy…"
        addLabel="+ ticket"
        items={today}
        onChange={setToday}
      />

      <EntrySection
        title="Barreras"
        hint='subtareas "Barrera"'
        placeholder="Qué te bloquea y a quién necesitás…"
        addLabel="+ barrera"
        items={barreras}
        onChange={setBarreras}
      />

      <div className="actions">
        <button onClick={save}>Guardar pre-update</button>
        <button className="secondary" onClick={syncJira}>
          Enviar comentarios a Jira
        </button>
        <span className="muted">{status}</span>
      </div>

      {syncResult.length > 0 && (
        <table className="table sync-result">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Comentario</th>
            </tr>
          </thead>
          <tbody>
            {syncResult.map((r) => (
              <tr key={r.ticketKey}>
                <td>
                  <code>{r.ticketKey}</code>
                </td>
                <td className={r.comment.ok ? '' : 'warn'}>
                  {r.comment.stubbed ? 'simulado' : r.comment.ok ? '✓' : r.comment.error}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Bloque de ítems: mismo formato para ayer, hoy y barreras. */
function EntrySection({
  title,
  hint,
  placeholder,
  addLabel,
  items,
  onChange,
}: {
  title: string;
  hint?: string;
  placeholder: string;
  addLabel: string;
  items: PreUpdateItem[];
  onChange: (items: PreUpdateItem[]) => void;
}) {
  const patch = (index: number, cambio: Partial<PreUpdateItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...cambio } : item)));

  return (
    <>
      <h3>
        {title}
        {hint && <span className="muted small"> ({hint})</span>}
      </h3>

      {items.length === 0 && <p className="muted small">Nada cargado.</p>}

      {items.map((item, i) => (
        <div className="entry" key={i}>
          <div className="entry-head">
            <TicketField
              value={item.ticketKey}
              onChange={(ticketKey) => patch(i, { ticketKey })}
            />
            <button
              className="ghost small"
              title="Quitar"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Quitar
            </button>
          </div>
          <textarea
            className="entry-comment"
            rows={4}
            placeholder={placeholder}
            value={item.comment}
            onChange={(e) => patch(i, { comment: e.target.value })}
          />
        </div>
      ))}

      <button className="ghost" onClick={() => onChange([...items, vacio()])}>
        {addLabel}
      </button>
    </>
  );
}

type CheckState =
  | { kind: 'vacio' }
  | { kind: 'formato' }
  | { kind: 'buscando' }
  | { kind: 'ok'; summary: string; status: string }
  | { kind: 'stub' }
  | { kind: 'no-existe'; error?: string };

/**
 * Campo de ticket con chequeo contra Jira. Busca sola mientras se escribe, con
 * un respiro para no pegarle a la API en cada tecla, y sólo si la key tiene
 * forma de key: así el caso más común (un typo a medio escribir) ni sale a la red.
 */
function TicketField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [check, setCheck] = useState<CheckState>({ kind: 'vacio' });
  // Descarta respuestas viejas: si tipean rápido, la última pedida manda.
  const lastQuery = useRef('');

  useEffect(() => {
    const key = value.trim().toUpperCase();
    lastQuery.current = key;

    if (!key) {
      setCheck({ kind: 'vacio' });
      return;
    }
    if (!TICKET_RE.test(key)) {
      setCheck({ kind: 'formato' });
      return;
    }

    setCheck({ kind: 'buscando' });
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<JiraIssueCheck>(
          `/integrations/jira/issue/${key}`,
          { validateStatus: (s) => s < 500 },
        );
        if (lastQuery.current !== key) return;
        if (data.stubbed) setCheck({ kind: 'stub' });
        else if (data.ok && data.issue)
          setCheck({ kind: 'ok', summary: data.issue.summary, status: data.issue.status });
        else setCheck({ kind: 'no-existe', error: data.error });
      } catch {
        if (lastQuery.current === key) setCheck({ kind: 'no-existe' });
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="ticket-field">
      <input
        className={[
          'ticket-input',
          check.kind === 'no-existe' ? 'invalid' : '',
          check.kind === 'ok' ? 'valid' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        placeholder="DEV-123"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <TicketCheck check={check} />
    </div>
  );
}

function TicketCheck({ check }: { check: CheckState }) {
  switch (check.kind) {
    case 'buscando':
      return <span className="ticket-note muted">buscando…</span>;
    case 'formato':
      return <span className="ticket-note muted">formato ABC-123</span>;
    case 'ok':
      return (
        <span className="ticket-note ok" title={check.summary}>
          ✓ {check.summary}
          <span className="muted"> · {check.status}</span>
        </span>
      );
    case 'stub':
      return <span className="ticket-note muted">Jira en stub — sin verificar</span>;
    case 'no-existe':
      return (
        <span className="ticket-note warn">✕ {check.error ?? 'no existe en Jira'}</span>
      );
    default:
      return null;
  }
}
