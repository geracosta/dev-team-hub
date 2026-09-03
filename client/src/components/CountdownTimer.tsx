import { useEffect, useRef, useState } from 'react';

interface Props {
  seconds: number;
  /** Cambiar esta key reinicia el timer (ej: id del orador actual). */
  resetKey: string;
  onElapsed?: () => void;
}

/** Timer de cuenta regresiva para el turno de cada persona en la daily. */
export default function CountdownTimer({ seconds, resetKey, onElapsed }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(true);
  const elapsedFired = useRef(false);

  useEffect(() => {
    setRemaining(seconds);
    setRunning(true);
    elapsedFired.current = false;
  }, [resetKey, seconds]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (remaining === 0 && !elapsedFired.current) {
      elapsedFired.current = true;
      onElapsed?.();
    }
  }, [remaining, onElapsed]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const over = remaining === 0;

  return (
    <div className={`timer ${over ? 'timer-over' : ''}`}>
      <div className="timer-display">
        {mm}:{ss}
      </div>
      <div className="timer-controls">
        <button onClick={() => setRunning((r) => !r)}>
          {running ? 'Pausar' : 'Reanudar'}
        </button>
        <button
          onClick={() => {
            setRemaining(seconds);
            elapsedFired.current = false;
            setRunning(true);
          }}
        >
          Reiniciar
        </button>
      </div>
      {over && <div className="timer-warn">¡Tiempo! Pasá al siguiente.</div>}
    </div>
  );
}
