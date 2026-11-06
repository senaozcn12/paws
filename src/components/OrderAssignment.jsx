import { useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { fulfillmentError } from '../lib/fulfillment';
export default function OrderAssignment({ order, pharmacies, onAssigned }) {
  const [pharmacy, setPharmacy] = useState(order.assigned_pharmacy_id || '');
  const [address, setAddress] = useState(order.delivery_address || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  async function submit(event) {
    event.preventDefault(); if (saving.current) return; setError('');
    if (!pharmacies.some(item => item.id === pharmacy) || address.trim().length < 5) return setError('Select an approved pharmacy and enter clinic delivery details.');
    saving.current = true; setBusy(true);
    try {
      const { error } = await supabase.rpc('assign_medication_pharmacy', { order_id: order.id, target_pharmacy: pharmacy, clinic_address: address.trim(), expected_version: order.fulfillment_version }).single();
      if (error) throw error; onAssigned();
    } catch (error) { setError(fulfillmentError(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <form className="medication-form" aria-label="Pharmacy assignment" onSubmit={submit}><fieldset disabled={busy}>
    <div className="form-group"><label htmlFor={`assign-pharmacy-${order.id}`}>Assign pharmacy</label><select id={`assign-pharmacy-${order.id}`} required value={pharmacy} onChange={event => setPharmacy(event.target.value)}><option value="">Select an approved pharmacy</option>{pharmacies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div className="form-group"><label htmlFor={`assign-address-${order.id}`}>Clinic delivery address and recipient</label><textarea id={`assign-address-${order.id}`} required minLength={5} maxLength={2000} value={address} onChange={event => setAddress(event.target.value)}/></div>
    {error && <p className="error-message" role="alert">{error}</p>}<button disabled={busy || !pharmacies.length}>{busy ? 'Assigning...' : 'Save pharmacy assignment'}</button>
  </fieldset></form>;
}
