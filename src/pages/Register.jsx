import { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import LocationFields from '../components/LocationFields';
import { validLocation } from '../lib/location';
import { appUrl, passwordError, minimumLength } from '../lib/auth';
export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmation: '', country: '', region: '', accountType: 'veterinarian' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    const problem = passwordError(form.password, form.confirmation);
    if (problem) return setError(problem);
    if (!validLocation(form.country, form.region)) return setError('Select a country and a valid subdivision from the suggestions.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({ email: form.email.trim(), password: form.password, options: { emailRedirectTo: appUrl, data: { full_name: form.name.trim(), country: form.country, region: form.region.trim(), account_type: form.accountType } } });
      if (error) throw error;
      setMessage('Check your email to confirm your account. Your registration must also be approved. Pharmacy staff must be linked to an approved pharmacy before accessing assigned orders. Diagnostic-center staff must be linked to an approved diagnostic center.');
    } catch (problem) { setError(problem.message || 'Registration failed. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><main className="login-container"><p className="brand">PAWS</p><h1>PAWS registration</h1>
    {message ? <p className="success-message" role="status">{message}</p> : <form onSubmit={submit}><fieldset disabled={busy} className="auth-fieldset">
      <div className="form-group"><label htmlFor="account-type">Account type</label><select id="account-type" value={form.accountType} onChange={event => setForm({ ...form, accountType: event.target.value })}><option value="veterinarian">Veterinarian</option><option value="pharmacy">Pharmacy staff</option><option value="diagnostic_staff">Diagnostic-center staff</option></select></div>
      {[[ 'name', 'Full name', 'text', 'name' ], ['email', 'Email', 'email', 'email'], ['password', 'Password', 'password', 'new-password'], ['confirmation', 'Confirm password', 'password', 'new-password']].map(([key, label, type, autoComplete]) => <div className="form-group" key={key}><label htmlFor={key}>{label}</label><input id={key} type={type} autoComplete={autoComplete} required minLength={type === 'password' ? minimumLength : undefined} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}/></div>)}
      <LocationFields country={form.country} region={form.region} onChange={(country, region) => setForm({ ...form, country, region })}/>
      {error && <p className="error-message" role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Registering...' : 'Register'}</button>
    </fieldset></form>}<p className="auth-links"><a href="/">Back to sign in</a></p></main></div>;
}
