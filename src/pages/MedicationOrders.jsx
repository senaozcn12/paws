
import { useEffect, useRef, useState } from "react";
import FulfillmentDetails from '../components/FulfillmentDetails';
import OrderAssignment from '../components/OrderAssignment';
import { supabase } from "../services/supabaseClient";

function MedicationOrders({ animal, profile }) {
  const canPrescribe = profile?.role === 'veterinarian';
  const [pharmacies, setPharmacies] = useState([]);
  const [pharmaciesError, setPharmaciesError] = useState('');
  const [loadingPharmacies, setLoadingPharmacies] = useState(true);
  const [pharmacy, setPharmacy] = useState('');
  const [address, setAddress] = useState('');
  const submitting = useRef(false);
  const [medication, setMedication] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [reason, setReason] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const currentUserId = profile?.id;
  const [cancellingId, setCancellingId] = useState(null);
  const [confirmOrderId, setConfirmOrderId] = useState(null);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    let active = true;
    supabase.from('pharmacies').select('id, name').eq('approval_status', 'approved').order('name').then(({ data, error }) => {
      if (!active) return;
      if (error) { setPharmacies([]); setPharmaciesError('Approved pharmacies could not be loaded. Refresh medication orders.'); }
      else { setPharmacies(data || []); setPharmaciesError(''); }
      setLoadingPharmacies(false);
    }).catch(() => { if (active) { setPharmaciesError('Approved pharmacies could not be loaded. Refresh medication orders.'); setLoadingPharmacies(false); } });
    return () => { active = false; };
  }, [refreshKey]);

  // Load medication orders for the selected animal.
  useEffect(() => {
    let active = true;

    async function loadOrders() {
      setLoadingOrders(true);
      setOrdersError("");
      setOrders([]);

      if (!animal.global_id) {
        setOrdersError("This animal does not have a Global ID.");
        setLoadingOrders(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("medication_orders")
        .select('*')
        .eq("animal_global_id", animal.global_id)
        .order("created_at", { ascending: false });

      if (!active) return;

      if (fetchError) {
        console.error("Could not load medication orders:", fetchError);
        setOrdersError("Could not load medication orders.");
      } else {
        setOrders(data ?? []);
      }

      setLoadingOrders(false);
    }

    loadOrders().catch(() => { if (active) { setOrdersError('Could not load medication orders. Refresh medication orders to try again.'); setLoadingOrders(false); } });

    return () => {
      active = false;
    };
  }, [animal.global_id, refreshKey]);

  // Save a new medication order.
  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting.current) return;

    setError("");
    setMessage("");

    if (
      !medication.trim() ||
      !dosage.trim() ||
      !frequency.trim() ||
      !reason.trim()
    ) {
      setError("Please complete all required fields.");
      return;
    }

    if (!animal.global_id) {
      setError("This animal does not have a Global ID.");
      return;
    }

    if (!pharmacies.some(item => item.id === pharmacy) || address.trim().length < 5) {
      setError('Select an approved pharmacy and enter clinic delivery details.'); return;
    }
    submitting.current = true;
    setSaving(true);

    try {
      const { error: saveError } = await supabase
        .from("medication_orders")
        .insert({
          animal_global_id: animal.global_id,
          medication_name: medication.trim(),
          dosage: dosage.trim(),
          frequency: frequency.trim(),
          reason: reason.trim(),
          assigned_pharmacy_id: pharmacy,
          delivery_address: address.trim(),
        });

      if (saveError) throw saveError;

      setMedication("");
      setDosage("");
      setFrequency("");
      setReason("");

      setMessage(
        `Medication order saved for ${animal.name || animal.chip_id}.`
      );

      setRefreshKey((previous) => previous + 1);
    } catch (err) {
      console.error("Medication order save failed:", err);
      setError("Medication order could not be saved.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  // Cancel an existing medication order.
  async function handleCancel(orderId) {
    if (cancellingId) return;

    setCancellingId(orderId);
    setCancelError("");
    setMessage("");

    try {
      const { error: rpcError } = await supabase.rpc(
        "cancel_medication_order",
        { order_id: orderId }
      );

      if (rpcError) throw rpcError;

      setConfirmOrderId(null);
      setMessage("Medication order cancelled successfully.");
      setRefreshKey((previous) => previous + 1);
    } catch (err) {
      console.error("Medication cancellation failed:", err);
      setCancelError(
        "Could not cancel this order. An accepted order must be released by the pharmacy first. Refresh medication orders to check its status."
      );
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section
      className="medications-page"
      aria-labelledby="medication-heading"
    >
      <h2 id="medication-heading">{canPrescribe ? 'Create Medication Order' : 'Medication orders'}</h2>

      <p className="muted">
        Medication orders for {animal.name} ({animal.chip_id}).
      </p>

      {loadingPharmacies && <p role="status">Loading approved pharmacies...</p>}
      {pharmaciesError && <p className="error-message" role="alert">{pharmaciesError}</p>}
      {!loadingPharmacies && !pharmaciesError && !pharmacies.length && <p className="muted">No approved pharmacies are available. An administrator must add a pharmacy before a prescription can be routed.</p>}
      {canPrescribe && <form className="medication-form" onSubmit={handleSubmit}>
        <fieldset disabled={saving || loadingPharmacies || Boolean(pharmaciesError) || !pharmacies.length}>
          <div className="form-group">
            <label htmlFor="medication-name">Medication</label>
            <input
              id="medication-name"
              type="text"
              value={medication}
              onChange={(event) => setMedication(event.target.value)}
              placeholder="e.g. Amoxicillin"
              maxLength={150}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="medication-dosage">Dosage</label>
            <input
              id="medication-dosage"
              type="text"
              value={dosage}
              onChange={(event) => setDosage(event.target.value)}
              placeholder="e.g. 250 mg"
              maxLength={100}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="medication-frequency">Frequency</label>
            <input
              id="medication-frequency"
              type="text"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
              placeholder="e.g. Twice daily"
              maxLength={100}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="medication-reason">Reason</label>
            <textarea
              id="medication-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for prescribing this medication"
              rows={3}
              maxLength={1000}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="medication-prescriber">Prescriber</label>
            <input
              id="medication-prescriber"
              type="text"
              value="Current signed-in veterinarian"
              readOnly
            />
          </div>

          <div className="form-group"><label htmlFor="medication-pharmacy">Pharmacy</label><select id="medication-pharmacy" required value={pharmacy} onChange={event => setPharmacy(event.target.value)}><option value="">Select an approved pharmacy</option>{pharmacies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="form-group"><label htmlFor="medication-delivery">Clinic delivery address and recipient</label><textarea id="medication-delivery" required minLength={5} maxLength={2000} value={address} onChange={event => setAddress(event.target.value)} placeholder="Clinic name, recipient, full address, and delivery instructions"/></div>
          <button type="submit">
            {saving ? "Saving..." : "Save Medication Order"}
          </button>
        </fieldset>
      </form>}

      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="medication-history">
        <h2>Medication Order History</h2>
        <button type="button" className="secondary-button" disabled={loadingOrders || saving || Boolean(cancellingId)} onClick={() => { setMessage(''); setRefreshKey(value => value + 1); }}>Refresh medication orders</button>

        {loadingOrders && (
          <p className="muted">Loading medication orders...</p>
        )}

        {ordersError && (
          <p className="error-message" role="alert">
            {ordersError}
          </p>
        )}

        {cancelError && (
          <p className="error-message" role="alert">
            {cancelError}
          </p>
        )}

        {!loadingOrders &&
          !ordersError &&
          orders.length === 0 && (
            <p className="muted">
              No medication orders have been recorded for this animal.
            </p>
          )}

        {!loadingOrders &&
          !ordersError &&
          orders.map((order) => {
            const canCancel =
              canPrescribe && order.order_status === "pending" &&
              ['unassigned','awaiting_acceptance','declined'].includes(order.fulfillment_status) &&
              order.prescriber_id === currentUserId;

            return (
              <div className="treatment-panel" key={order.id}>
                <h3>{order.medication_name}</h3>

                <p>
                  <strong>Dosage:</strong> {order.dosage}
                </p>

                <p>
                  <strong>Frequency:</strong> {order.frequency}
                </p>

                <p>
                  <strong>Reason:</strong> {order.reason}
                </p>

                <p>
                  <strong>Prescriber ID:</strong>{" "}
                  {order.prescriber_id}
                </p>

                <p>
                  <strong>Order Status:</strong>{" "}
                  {order.order_status}
                </p>

                <p>
                  <strong>Created:</strong>{" "}
                  {new Date(order.created_at).toLocaleString()}
                </p>

                <FulfillmentDetails order={order}/>
                {order.order_status === 'pending' && !order.fulfillment_status && <p className="error-message" role="alert">Pharmacy assignment is not set up in this database yet. Apply the pharmacy fulfillment migration, then refresh medication orders.</p>}
                {order.order_status === 'pending' && ['unassigned','awaiting_acceptance','declined'].includes(order.fulfillment_status) && !canCancel && <p className="muted">Only the original prescribing veterinarian can assign this prescription to a pharmacy and enter clinic delivery details. Sign in with that veterinarian account; administrator accounts can manage pharmacy organizations and staff through Account.</p>}
                {canCancel && <OrderAssignment key={`${order.id}-${order.fulfillment_version}`} order={order} pharmacies={pharmacies} onAssigned={() => { setMessage('Pharmacy assignment saved.'); setRefreshKey(value => value + 1); }}/>}
                {canCancel && (
                  <div className="medication-cancel-actions">
                    {confirmOrderId === order.id ? (
                      <>
                        <p>
                          Are you sure you want to cancel this order?
                        </p>

                        <button
                          type="button"
                          className="cancel-order-button"
                          disabled={cancellingId !== null}
                          onClick={() => handleCancel(order.id)}
                        >
                          {cancellingId === order.id
                            ? "Cancelling..."
                            : "Yes, Cancel Order"}
                        </button>

                        <button
                          type="button"
                          disabled={cancellingId !== null}
                          onClick={() => setConfirmOrderId(null)}
                        >
                          Keep Order
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="cancel-order-button"
                        onClick={() => {
                          setCancelError("");
                          setConfirmOrderId(order.id);
                        }}
                      >
                        Cancel Order
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </section>
  );
}

export default MedicationOrders;
