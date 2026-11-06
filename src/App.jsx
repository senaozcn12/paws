import { useEffect, useState } from "react";
import Login from "./pages/login";
import Search from "./pages/search";
import Recovery from './pages/Recovery';
import Register from './pages/Register';
import Account from './pages/Account';
import Pharmacy from './pages/Pharmacy';
import DiagnosticCenter from './pages/DiagnosticCenter';
import { recoveryRoute } from './lib/auth';
import { supabase } from "./services/supabaseClient";
import "./App.css";

function App() {
  const [recovery, setRecovery] = useState(() => recoveryRoute(window.location));
  const [recoveryValid, setRecoveryValid] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let authEventReceived = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventReceived = true;
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
        setRecoveryValid(true);
        sessionStorage.setItem('paws-recovery-user', nextSession.user.id);
        window.history.replaceState(null, '', '/reset-password');
      }
      if (event === 'SIGNED_OUT') {
        setRecoveryValid(false);
        sessionStorage.removeItem('paws-recovery-user');
      }
      if (nextSession && !window.location.hash.includes('error') && sessionStorage.getItem('paws-recovery-user') === nextSession.user.id) setRecoveryValid(true);

      if (active) {
        setSession(nextSession);
        setLoading(false);
        setError("");
      }
    });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || authEventReceived) return;

        if (error) {
          setError("Your session could not be loaded. Please sign in again.");
        }

        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (!active || authEventReceived) return;

        setError("Your session could not be loaded. Please sign in again.");
        setLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId || recovery) return;
    let active = true;
    supabase.from('profiles').select('*').eq('id', userId).single().then(({ data, error }) => {
      if (!active) return;
      setProfile(data);
      setProfileError(error ? 'Account status could not be loaded. Please sign out and try again.' : '');
      setProfileLoading(false);
    }).catch(() => {
      if (active) { setProfileError('Account status could not be loaded. Please sign out and try again.'); setProfileLoading(false); }
    });
    return () => { active = false; };
  }, [userId, recovery]);

  async function handleLogout() {
    setError("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
      setProfile(null);
      setProfileLoading(true);
    } catch {
      setError("Logout failed. Please try again.");
    }
  }

  if (loading) {
    return <p role="status">Loading PAWS...</p>;
  }

  if (recovery) return <Recovery reset valid={recoveryValid && Boolean(session)} />;
  if (window.location.pathname === '/forgot-password') return <Recovery />;
  if (!session && window.location.pathname === '/register') return <Register />;
  if (session && profileLoading) return <p role="status">Loading account status...</p>;
  if (session && profileError) return <div className="login-page"><main className="login-container"><p className="error-message" role="alert">{profileError}</p><button onClick={handleLogout}>Log out</button></main></div>;

  if (session && profile?.role === 'diagnostic_staff' && profile?.approval_status === 'approved') return <DiagnosticCenter profile={profile} onLogout={handleLogout} authError={error} />;

  if (session && profile?.role === 'pharmacy' && profile?.approval_status === 'approved') return <Pharmacy profile={profile} onLogout={handleLogout} authError={error} />;

  return (
    <>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {session ? ['veterinarian', 'admin'].includes(profile?.role) && profile?.approval_status === 'approved' ? <Search profile={profile} onLogout={handleLogout} /> : <Account profile={profile} onLogout={handleLogout} /> : <Login />}
    </>
  );
}

export default App;