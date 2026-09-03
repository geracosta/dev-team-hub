import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import DeveloperDashboard from './pages/DeveloperDashboard';
import LeadDashboard from './pages/LeadDashboard';
import Health from './pages/Health';
import Daily from './pages/Daily';
import Mapping from './pages/Mapping';
import Calendar from './pages/Calendar';
import type { JSX } from 'react';

function Protected({
  children,
  roles,
}: {
  children: JSX.Element;
  roles?: ('developer' | 'lead')[];
}) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/" replace />;
  return children;
}

function Nav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <nav className="topnav">
      <span className="brand">Dev Team Hub</span>
      <Link to="/">Inicio</Link>
      <Link to="/daily">Daily</Link>
      <Link to="/calendario">Calendario</Link>
      {user.role === 'developer' && <Link to="/health">Mi salud</Link>}
      {user.role === 'lead' && <Link to="/mapping">Identidades</Link>}
      <span className="spacer" />
      <span className="badge">{user.role === 'lead' ? 'Líder técnico' : 'Desarrollador'}</span>
      <span>{user.name}</span>
      <button
        onClick={() => {
          logout();
          nav('/login');
        }}
      >
        Salir
      </button>
    </nav>
  );
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === 'lead' ? <LeadDashboard /> : <DeveloperDashboard />;
}

export default function App() {
  return (
    <>
      <Nav />
      <main className="container">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <Home />
              </Protected>
            }
          />
          <Route
            path="/health"
            element={
              <Protected>
                <Health />
              </Protected>
            }
          />
          <Route
            path="/health/:userId"
            element={
              <Protected roles={['lead']}>
                <Health />
              </Protected>
            }
          />
          <Route
            path="/daily"
            element={
              <Protected>
                <Daily />
              </Protected>
            }
          />
          <Route
            path="/calendario"
            element={
              <Protected>
                <Calendar />
              </Protected>
            }
          />
          <Route
            path="/mapping"
            element={
              <Protected roles={['lead']}>
                <Mapping />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
