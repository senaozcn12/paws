import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

export default function DiagnosticCenterAdmin({ profiles, onChanged }) {
  const [centers, setCenters] = useState([]);
  const [name, setName] = useState('');
  const [member, setMember] = useState('');
  const [center, setCenter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase.from('diagnostic_centers').select('*').order('name');
        if (error) throw error;
        if (active) setCenters(data || []);
      } catch { if (active) { setCenters([]); setError('Diagnostic centers could not be loaded. Check the diagnostic-center setup and refresh.'); } }
      finally { if (active) setLoading(false); }
    }
    load(); return () => { active = false; };
  }, [refresh]);
  async function run(action, success) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await action(); if (error) throw error;
      setMessage(success); setRefresh(value => value + 1); await onChanged();
    } catch (error) { setError(error.code === '23505' ? 'That diagnostic-center name already exists.' : error.message || 'The change could not be saved.'); }
    finally { setBusy(false); }
  }
  const approved = centers.filter(item => item.approval_status === 'approved');
  return <section className="search-panel" aria-labelledby="diagnostic-admin-heading">
    <h2 id="diagnostic-admin-heading">Diagnostic center administration</h2>
    <p>Add approved diagnostic centers, then link registered staff accounts. Verify each staff member’s affiliation before approving access.</p>
    <form className="medication-form" onSubmit={event => {
      event.preventDefault();
      if (!name.trim()) return setError('Enter a diagnostic-center name.');
      run(() => supabase.rpc('save_diagnostic_center', { center_name: name.trim() }), 'Approved diagnostic center saved.');
    }}><fieldset disabled={busy}>
      <div className="form-group"><label htmlFor="diagnostic-center-name">Diagnostic center name</label><input id="diagnostic-center-name" required maxLength={150} value={name} onChange={event => setName(event.target.value)}/></div>
      <button>Add approved diagnostic center</button>
    </fieldset></form>
    <form className="medication-form" onSubmit={event => {
      event.preventDefault();
      run(() => supabase.rpc('assign_diagnostic_center_member', { member_id: member, target_center: center }), 'Diagnostic-center staff account approved and assigned.');
    }}><fieldset disabled={busy || loading || !approved.length}>
      <div className="form-group"><label htmlFor="diagnostic-staff-account">Registered diagnostic staff account</label><select id="diagnostic-staff-account" required value={member} onChange={event => setMember(event.target.value)}><option value="">Select a registered account</option>{profiles.filter(item => item.role !== 'admin').map(item => <option key={item.id} value={item.id}>{item.email} ({item.role})</option>)}</select></div>
      <div className="form-group"><label htmlFor="diagnostic-staff-center">Staff diagnostic center</label><select id="diagnostic-staff-center" required value={center} onChange={event => setCenter(event.target.value)}><option value="">Select an approved center</option>{approved.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <p className="muted">This approves the selected account as diagnostic-center staff. It replaces any veterinarian or pharmacy access.</p>
      <button>Approve and assign diagnostic staff</button>
    </fieldset></form>
    {loading && <p role="status">Loading diagnostic centers...</p>}
    {!loading && !centers.length && <p>No diagnostic centers have been added.</p>}
    <ul className="treatment-list">{centers.map(item => <li key={item.id}><strong>{item.name}</strong><p>Status: {item.approval_status}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => supabase.rpc('save_diagnostic_center', { center_name: item.name, target_id: item.id, decision: item.approval_status === 'approved' ? 'rejected' : 'approved' }), 'Diagnostic-center approval updated.')}>{item.approval_status === 'approved' ? 'Suspend' : 'Approve'} {item.name}</button>
    </li>)}</ul>
    {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
    <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => { setError(''); setRefresh(value => value + 1); }}>Refresh diagnostic centers</button>
  </section>;
}
