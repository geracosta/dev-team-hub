import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

interface DemoUser {
  name: string;
  email: string;
  role: 'developer' | 'lead';
}

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('demo');
  const [error, setError] = useState('');
  // Se piden al server: si se hardcodean, quedan viejas cada vez que cambia el roster.
  const [demo, setDemo] = useState<DemoUser[]>([]);

  useEffect(() => {
    api
      .get('/auth/demo-users')
      .then((r) => setDemo(r.data.users ?? []))
      .catch(() => setDemo([]));
  }, []);

  if (user) nav('/');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      nav('/');
    } catch {
      setError('Credenciales inválidas');
    }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Dev Team Hub</h1>
        <p className="muted">Ingresá con tu cuenta del equipo</p>
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vos@tuempresa.com"
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Entrar</button>

        {demo.length > 0 && (
          <div className="demo">
            <span className="muted">Usuarios de ejemplo (contraseña: demo):</span>
            {demo.map((d) => (
              <button
                type="button"
                key={d.email}
                className="ghost"
                onClick={() => {
                  setEmail(d.email);
                  setPassword('demo');
                }}
              >
                {d.role === 'lead' ? 'Líder técnico' : 'Desarrollador'} — {d.email}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
