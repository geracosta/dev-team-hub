import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

interface DemoUser {
  name: string;
  email: string;
  role: 'developer' | 'lead';
}

export default function Login() {
  const { login, loginWithToken, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('demo');
  // Un error puede venir del submit o del callback de OAuth (?error=).
  const [error, setError] = useState(params.get('error') ?? '');
  // Se piden al server: si se hardcodean, quedan viejas cada vez que cambia el roster.
  const [demo, setDemo] = useState<DemoUser[]>([]);
  const [giteaOauth, setGiteaOauth] = useState(false);

  useEffect(() => {
    api
      .get('/auth/demo-users')
      .then((r) => {
        setDemo(r.data.users ?? []);
        setGiteaOauth(Boolean(r.data.giteaOauth));
      })
      .catch(() => setDemo([]));
  }, []);

  // Vuelta del OAuth de Gitea: el JWT llega en el fragment (#token=...), que
  // no pasa por el server ni queda en logs. Se consume y se limpia de la URL.
  useEffect(() => {
    const match = window.location.hash.match(/token=([^&]+)/);
    if (!match) return;
    window.history.replaceState(null, '', window.location.pathname);
    loginWithToken(match[1])
      .then(() => nav('/'))
      .catch(() => setError('No se pudo validar el login con Gitea'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        {giteaOauth && (
          <a className="button gitea-login" href="/api/auth/gitea/login">
            Entrar con Gitea
          </a>
        )}

        {error && <p className="error">{error}</p>}

        {(demo.length > 0 || !giteaOauth) && (
          <>
            {giteaOauth && <p className="muted divider">o con una cuenta de ejemplo</p>}
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
            <button type="submit">Entrar</button>
          </>
        )}

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
