import { useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const empty = { chip_id: '', name: '', animal: '', species: '', age: '', sex: '', notes: '' };
export default function CreateAnimal({ onCreated, onCancel }) {
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    for (const key of ['chip_id', 'name', 'animal', 'species']) {
      if (!form[key].trim()) return setError('Enter a Chip ID, name, animal type, and breed / species.');
    }
    if (form.age !== '' && (!/^\d+$/.test(form.age) || !Number.isSafeInteger(Number(form.age)))) return setError('Age must be a nonnegative whole number of years.');
    submitting.current = true; setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_animal', { details: Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) }).single();
      if (error) throw error;
      onCreated(data);
    } catch (problem) {
      if (problem.code === '23505') setError('That identifier is already registered. Search for the existing animal or enter a different Chip ID.');
      else if (problem.code === '42501') setError('Your account does not have permission to create animals. Check your approval status or contact an administrator.');
      else if (['23514', '22023', '22P02', '22003'].includes(problem.code)) setError('Check the required fields and age, then try again.');
      else setError('The animal could not be saved. Your entries have been kept. Search by Chip ID before retrying if the connection was interrupted.');
    } finally { submitting.current = false; setSaving(false); }
  }
  return <section className="search-panel" aria-labelledby="create-animal-heading"><h2 id="create-animal-heading">Create animal</h2>
    <p className="muted">A unique Global ID is generated when the animal is saved. Fields marked * are required.</p>
    <form className="treatment-form" onSubmit={submit}><fieldset disabled={saving}>
      {[[ 'chip_id', 'Chip ID *', 128 ], ['name', 'Animal name *', 100], ['animal', 'Animal type *', 100], ['species', 'Breed / species *', 100]].map(([key, label, max]) => <div className="form-group" key={key}><label htmlFor={`animal-${key}`}>{label}</label><input id={`animal-${key}`} required maxLength={max} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}/></div>)}
      <div className="form-group"><label htmlFor="animal-age">Age in years (optional)</label><input id="animal-age" type="number" min="0" step="1" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })}/></div>
      <div className="form-group"><label htmlFor="animal-sex">Sex (optional)</label><select id="animal-sex" value={form.sex} onChange={e => setForm({ ...form, sex: e.target.value })}><option value="">Not recorded</option><option value="F">Female</option><option value="M">Male</option><option value="U">Unknown</option></select></div>
      <div className="form-group"><label htmlFor="animal-notes">Notes (optional)</label><textarea id="animal-notes" rows={4} maxLength={5000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="appointment-actions"><button type="submit">{saving ? 'Saving...' : 'Save animal'}</button><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button></div>
    </fieldset></form>
  </section>;
}
