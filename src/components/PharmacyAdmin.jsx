import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
export default function PharmacyAdmin({ profiles, onChanged }) {
  const [pharmacies, setPharmacies] = useState([]);
  const [name, setName] = useState('');
  const [member, setMember] = useState('');
  const [pharmacy, setPharmacy] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    supabase.from('pharmacies').select('*').order('name').then(({ data, error }) => {
      if (active) { if (error) setError('Pharmacies could not be loaded. Apply the pharmacy migration and refresh.'); else setPharmacies(data || []); }
    }).catch(() => { if (active) setError('Pharmacies could not be loaded. Please refresh.'); });
    return () => { active = false; };
  }, [refresh]);
  async function run(action, success) {
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await action(); if (error) throw error;
      setMessage(success); setRefresh(value => value + 1); await onChanged();
    } catch (error) { setError(error.code === '23505' ? 'That pharmacy name already exists.' : error.message || 'The change could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="search-panel" aria-labelledby="pharmacy-admin-heading"><h2 id="pharmacy-admin-heading">Pharmacy administration</h2>
    <p>Add approved pharmacies, then associate registered staff accounts with them. Staff must confirm their email before signing in.</p>
    <form className="medication-form" onSubmit={event => { event.preventDefault(); if (!name.trim()) return setError('Enter a pharmacy name.'); run(() => supabase.rpc('save_pharmacy', { pharmacy_name: name.trim() }), 'Approved pharmacy saved.'); }}>
      <fieldset disabled={busy}><div className="form-group"><label htmlFor="new-pharmacy-name">Pharmacy name</label><input id="new-pharmacy-name" required maxLength={150} value={name} onChange={event => setName(event.target.value)}/></div><button>Add approved pharmacy</button></fieldset>
    </form>
    <form className="medication-form" onSubmit={event => { event.preventDefault(); run(() => supabase.rpc('assign_pharmacy_member', { member_id: member, target_pharmacy: pharmacy }), 'Pharmacy staff account approved and assigned.'); }}>
      <fieldset disabled={busy}><div className="form-group"><label htmlFor="pharmacy-member">Registered staff account</label><select id="pharmacy-member" required value={member} onChange={event => setMember(event.target.value)}><option value="">Select an account</option>{profiles.filter(row => row.role !== 'admin').map(row => <option key={row.id} value={row.id}>{row.email} ({row.role})</option>)}</select></div>
      <div className="form-group"><label htmlFor="member-pharmacy">Staff pharmacy</label><select id="member-pharmacy" required value={pharmacy} onChange={event => setPharmacy(event.target.value)}><option value="">Select an approved pharmacy</option>{pharmacies.filter(row => row.approval_status === 'approved').map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div>
      <p className="muted">This changes the selected account to an approved pharmacy role. It will no longer have veterinarian access.</p><button>Approve and assign pharmacy staff</button></fieldset>
    </form>
    <ul className="treatment-list">{pharmacies.map(row => <li key={row.id}><strong>{row.name}</strong><p>Status: {row.approval_status}</p><button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => supabase.rpc('save_pharmacy', { pharmacy_name: row.name, target_id: row.id, decision: row.approval_status === 'approved' ? 'rejected' : 'approved' }), 'Pharmacy approval updated.')}>{row.approval_status === 'approved' ? 'Suspend' : 'Approve'} {row.name}</button></li>)}</ul>
    {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(''); setRefresh(value => value + 1); }}>Refresh pharmacies</button>
  </section>;
}
