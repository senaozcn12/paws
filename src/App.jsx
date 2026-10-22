import { useEffect, useState } from "react";
import Login from "./pages/login";
import Search from "./pages/search";
import { supabase } from "./services/supabaseClient";
import "./App.css";

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let authEventReceived = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true;

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

  async function handleLogout() {
    setError("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
    } catch {
      setError("Logout failed. Please try again.");
    }
  }

  if (loading) {
    return <p role="status">Loading PAWS...</p>;
  }

  return (
    <>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {session ? <Search onLogout={handleLogout} /> : <Login />}
    </>
  );
}

export default App;