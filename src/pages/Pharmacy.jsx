import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import Account from './Account';
import FulfillmentDetails from '../components/FulfillmentDetails';
import { fulfillmentError, safeTrackingUrl } from '../lib/fulfillment';

function PharmacyOrder({ order, onUpdated }) {
  const options = order.fulfillment_status === 'awaiting_acceptance' ? [['processing', 'Accept and process'], ['declined', 'Decline order']] : order.fulfillment_status === 'processing' ? [['shipped', 'Ship order'], ['declined', 'Release to veterinarian']] : order.fulfillment_status === 'shipped' ? [['shipped', 'Update shipment tracking'], ['delivered', 'Mark delivered']] : [];
  const [status, setStatus] = useState(options[0]?.[0] || '');
  const [carrier, setCarrier] = useState(order.carrier || '');
  const [number, setNumber] = useState(order.tracking_number || '');
  const [url, setUrl] = useState(order.tracking_url || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const shipping = ['shipped', 'delivered'].includes(status);
  async function submit(event) {
    event.preventDefault(); if (saving.current) return; setError('');
    if (status === 'declined' && !note.trim()) return setError('Enter a decline or release reason.');
    if (shipping && (!carrier.trim() || !number.trim())) return setError('Carrier and tracking number are required.');
    if (shipping && url.trim() && !safeTrackingUrl(url.trim())) return setError('Tracking link must be an HTTPS URL without a username or password.');
    saving.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.rpc('update_medication_fulfillment', {
        order_id: order.id, next_status: status, expected_version: order.fulfillment_version,
        shipping_carrier: shipping ? carrier.trim() : '', shipping_number: shipping ? number.trim() : '', shipping_url: shipping ? url.trim() : '', note: note.trim(),
      }).single();
      if (error) throw error; onUpdated(data);
    } catch (error) { setError(fulfillmentError(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <article className="treatment-panel" aria-label={`Order ${order.id}`}><h2>{order.medication_name}</h2>
    <p><strong>Order ID:</strong> {order.id}</p><p><strong>Animal Global ID:</strong> {order.animal_global_id}</p>
    <p><strong>Dosage:</strong> {order.dosage}</p><p><strong>Frequency:</strong> {order.frequency}</p><p><strong>Reason:</strong> {order.reason}</p><p><strong>Prescriber ID:</strong> {order.prescriber_id}</p><p><strong>Order status:</strong> {order.order_status}</p>
    <FulfillmentDetails order={order}/>
    {options.length > 0 && order.order_status === 'pending' && <form className="medication-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="form-group"><label htmlFor={`status-${order.id}`}>Fulfillment action</label><select id={`status-${order.id}`} value={status} onChange={event => setStatus(event.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {shipping && <><div className="form-group"><label htmlFor={`carrier-${order.id}`}>Carrier</label><input id={`carrier-${order.id}`} required maxLength={100} value={carrier} onChange={event => setCarrier(event.target.value)}/></div>
      <div className="form-group"><label htmlFor={`tracking-${order.id}`}>Tracking number</label><input id={`tracking-${order.id}`} required maxLength={200} value={number} onChange={event => setNumber(event.target.value)}/></div>
      <div className="form-group"><label htmlFor={`url-${order.id}`}>Tracking link (optional, HTTPS)</label><input id={`url-${order.id}`} type="url" maxLength={1000} value={url} onChange={event => setUrl(event.target.value)}/></div></>}
      <div className="form-group"><label htmlFor={`note-${order.id}`}>{status === 'declined' ? 'Decline / release reason' : 'Pharmacy note (optional)'}</label><textarea id={`note-${order.id}`} required={status === 'declined'} maxLength={1000} value={note} onChange={event => setNote(event.target.value)}/></div>
      {error && <p className="error-message" role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Saving...' : 'Save fulfillment update'}</button>
    </fieldset></form>}
  </article>;
}
export default function Pharmacy({ profile, onLogout, authError }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [account, setAccount] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const [{ data: pharmacyId, error: membershipError }, { data, error }] = await Promise.all([
          supabase.rpc('paws_pharmacy_id'), supabase.from('medication_orders').select('*').order('created_at', { ascending: false }),
        ]);
        if (!active) return;
        if (error || membershipError) throw error || membershipError;
        if (!pharmacyId) { setOrders([]); setError('Your pharmacy is suspended or your account is not linked to an approved pharmacy. Contact an administrator.'); }
        else setOrders(data || []);
      } catch { if (active) { setOrders([]); setError('Assigned orders could not be loaded. Please refresh orders.'); } }
      finally { if (active) setLoading(false); }
    }
    load(); return () => { active = false; };
  }, [refresh]);
  return <main className="SearchRoot"><header className="page-header"><div><p className="brand">PAWS</p><h1>Pharmacy fulfillment</h1><p className="muted">Orders assigned to your pharmacy</p></div><nav className="appointment-actions" aria-label="Account navigation"><button className="secondary-button" aria-pressed={!account} onClick={() => setAccount(false)}>Assigned Orders</button><button className="secondary-button" aria-pressed={account} onClick={() => setAccount(true)}>Account</button><button className="secondary-button" onClick={onLogout}>Log Out</button></nav></header>
    {authError && <p className="error-message" role="alert">{authError}</p>}
    {account ? <Account profile={profile} onLogout={onLogout} embedded/> : <><button className="secondary-button" disabled={loading} onClick={() => { setMessage(''); setRefresh(value => value + 1); }}>Refresh orders</button>
    {loading && <p role="status">Loading assigned orders...</p>}{error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
    {!loading && !error && !orders.length && <p>No prescriptions are assigned to your pharmacy.</p>}
    {!loading && !error && orders.map(order => <PharmacyOrder key={`${order.id}-${order.fulfillment_version}`} order={order} onUpdated={updated => { setOrders(previous => previous.map(item => item.id === updated.id ? updated : item)); setMessage('Fulfillment updated. The veterinarian can see the new status and tracking information.'); }}/>)}</>}
  </main>;
}
