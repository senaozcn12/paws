import { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { appUrl, minimumLength, characterRules, passwordError } from '../lib/auth';

export default function Recovery({ reset = false, valid = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  async function finishSignOut() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setSignedOut(true); setError('');
    } catch { setError('Your password was updated, but sign out failed. Retry signing out before continuing.'); }
    finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (reset) {
      const problem = passwordError(password, confirmation);
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      if (reset) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        // Only the password is updated; profile role/status are never submitted.
        setDone(true);
        await finishSignOut();
        setMessage('Your password has been updated. Sign in with your new password.');
      } else {
        // Identical response for unknown addresses, rate limits and delivery failures.
        await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${appUrl}/reset-password` });
        setMessage('If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder. You can try again later if it does not arrive.');
      }
    } catch (problem) {
      if (reset) setError(problem.message || 'The password could not be updated. Request another link and try again.');
      else setMessage('If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder. You can try again later if it does not arrive.');
    } finally { setBusy(false); }
  }
  return <div className="login-page"><main className="login-container">
    <p className="brand">PAWS</p><h1>{reset ? 'Reset password' : 'Forgot password?'}</h1>
    {reset && !valid && !done ? <><p role="alert" className="error-message">This recovery link is invalid or expired. Request a new link to reset your password.</p><a href="/forgot-password">Request another link</a></> : !done && <form onSubmit={submit}>
      {reset ? <><p className="muted">Use at least {minimumLength} characters.{characterRules && ` Required character types: ${characterRules}.`}</p>
        <div className="form-group"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={minimumLength} value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></div>
        <div className="form-group"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></div></> : <div className="form-group"><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/></div>}
      {error && <p className="error-message" role="alert">{error} <a href="/forgot-password">Request another link</a></p>}
      <button disabled={busy}>{busy ? 'Please wait...' : reset ? 'Update password' : 'Send reset link'}</button>
    </form>}
    {message && <p className="success-message" role="status">{message}</p>}
    {done && error && <p className="error-message" role="alert">{error}</p>}
    {done && !signedOut ? <button disabled={busy} onClick={finishSignOut}>Retry sign out</button> : <p className="auth-links"><a href="/">Back to sign in</a></p>}
  </main></div>;
}
