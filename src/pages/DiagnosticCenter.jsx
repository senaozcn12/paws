import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import Account from './Account';
import DiagnosticQueue from "../components/DiagnosticQueue";

export default function DiagnosticCenter({ profile, onLogout, authError }) {
  const [center, setCenter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [account, setAccount] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(''); setCenter(null);
      try {
        const { data: id, error: membershipError } = await supabase.rpc('paws_diagnostic_center_id');
        if (membershipError) throw membershipError;
        if (!id) {
          if (active) setError('Your account is not linked to an approved diagnostic center, or your staff access is no longer approved. Contact an administrator.');
          return;
        }
        const { data, error } = await supabase.from('diagnostic_centers').select('id, name, approval_status').eq('id', id).maybeSingle();
        if (error) throw error;
        if (active) {
          if (data) setCenter(data);
          else setError('Your diagnostic-center access has changed. Contact an administrator.');
        }
      } catch { if (active) setError('Diagnostic-center access could not be loaded. Please refresh and try again.'); }
      finally { if (active) setLoading(false); }
    }
    load(); return () => { active = false; };
  }, [refresh]);
  return <main className="SearchRoot"><header className="page-header"><div><p className="brand">PAWS</p><h1>Diagnostic center</h1><p className="muted">Staff account and center access</p></div>
    <nav className="appointment-actions" aria-label="Account navigation"><button className="secondary-button" aria-pressed={!account} onClick={() => setAccount(false)}>Center Access</button><button className="secondary-button" aria-pressed={account} onClick={() => setAccount(true)}>Account</button><button className="secondary-button" onClick={onLogout}>Log Out</button></nav>
  </header>{authError && <p className="error-message" role="alert">{authError}</p>}
    {account ? <Account profile={profile} onLogout={onLogout} embedded/> : <section className="search-panel" aria-labelledby="center-access-heading"><h2 id="center-access-heading">Center access</h2>
      {loading && <p role="status">Checking diagnostic-center access...</p>}{error && <p className="error-message" role="alert">{error}</p>}
      {!loading && center && <><h3>{center.name}</h3><p>{profile.email}</p><p className="success-message" role="status">Your staff account is approved and linked to this diagnostic center.</p><DiagnosticQueue centerId={center.id} /></>}
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh center access</button>
    </section>}
  </main>;
}
