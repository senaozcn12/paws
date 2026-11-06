import { useEffect, useState } from 'react';
import PharmacyAdmin from '../components/PharmacyAdmin';
import DiagnosticCenterAdmin from '../components/DiagnosticCenterAdmin';
import { supabase } from '../services/supabaseClient';
const roleLabels = { veterinarian: 'Veterinarian', admin: 'Administrator', pharmacy: 'Pharmacy staff', diagnostic_staff: 'Diagnostic-center staff' };
export default function Account({ profile, onLogout, embedded = false }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = profile?.role === 'admin' && profile?.approval_status === 'approved';
  async function load() {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) setError('Reviews could not be loaded. Please retry.');
    else { setRows(data); setError(''); }
  }
  useEffect(() => { if (admin) { let active = true; supabase.from('profiles').select('*').order('created_at').then(({ data, error }) => { if (active) { if (error) setError('Reviews could not be loaded. Please retry.'); else setRows(data); } }); return () => { active = false; }; } }, [admin]);
  async function review(id, status) {
    setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('review_registration', { applicant_id: id, decision: status });
      if (error) throw error;
      await load();
    } catch { setError('The review could not be saved. Please retry.'); }
    finally { setBusy(false); }
  }
  if (embedded && !admin) return <section className="search-panel" aria-labelledby="account-heading"><h2 id="account-heading">Account</h2><p>{profile?.full_name}</p><p>{profile?.email}</p><p>Status: {profile?.approval_status}</p></section>;
  if (!admin) return <div className="login-page"><main className="login-container"><p className="brand">PAWS</p><h1>Account status</h1><p role="status">{profile?.approval_status === 'rejected' ? 'Your registration was rejected. Contact the clinic administrator for assistance.' : profile?.role === 'diagnostic_staff' ? 'Your diagnostic-center staff account is awaiting administrator approval and center assignment.' : 'Your account is awaiting administrator approval. Patient records are unavailable.'}</p><p className="auth-links"><button onClick={() => window.location.reload()}>Refresh status</button></p><button className="secondary-button" onClick={onLogout}>Log out</button></main></div>;
  return <section aria-labelledby="registration-review-heading">{embedded ? <div className="search-panel"><h2 id="registration-review-heading">Registration review</h2><p>Approve or reject membership requests.</p></div> : <header className="page-header"><div><p className="brand">PAWS</p><h1 id="registration-review-heading">Registration review</h1></div><button onClick={onLogout}>Log out</button></header>}<PharmacyAdmin profiles={rows} onChanged={load}/><DiagnosticCenterAdmin profiles={rows} onChanged={load}/>{error && <p role="alert" className="error-message">{error}</p>}<button className="secondary-button" disabled={busy} onClick={load}>Refresh registrations</button>{rows.filter(row => row.role !== 'admin').map(row => <section className="search-panel" key={row.id}><h2>{row.full_name || row.email}</h2><p>{row.email}</p><p>{row.region ? `${row.region}, ` : ''}{row.country}</p><p>Role: {roleLabels[row.role] || row.role}</p>{row.role === 'pharmacy' && !row.pharmacy_id && <p>Use Pharmacy administration above to assign and approve this staff account.</p>}{row.role === 'diagnostic_staff' && !row.diagnostic_center_id && <p>Use Diagnostic center administration above to assign and approve this staff account.</p>}<p>Status: {row.approval_status}</p><div className="appointment-actions"><button disabled={busy || row.approval_status === 'approved' || (row.role === 'pharmacy' && !row.pharmacy_id) || (row.role === 'diagnostic_staff' && !row.diagnostic_center_id)} onClick={() => review(row.id, 'approved')}>Approve</button><button className="secondary-button" disabled={busy || row.approval_status === 'rejected'} onClick={() => review(row.id, 'rejected')}>Reject</button></div></section>)}{!rows.length && <p role="status">No registrations loaded.</p>}</section>;
}
