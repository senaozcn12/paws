import { fulfillmentLabels, safeTrackingUrl } from '../lib/fulfillment';
export default function FulfillmentDetails({ order }) {
  const link = safeTrackingUrl(order.tracking_url);
  return <div className="fulfillment-details">
    <p><strong>Pharmacy:</strong> {order.pharmacy_name || 'Not assigned'}</p>
    <p><strong>Fulfillment:</strong> {fulfillmentLabels[order.fulfillment_status] || 'Needs pharmacy assignment'}</p>
    {order.delivery_address && <p className="delivery-address"><strong>Clinic delivery:</strong> {order.delivery_address}</p>}
    {order.fulfillment_note && <p><strong>Pharmacy note:</strong> {order.fulfillment_note}</p>}
    {order.carrier && <p><strong>Carrier:</strong> {order.carrier}</p>}
    {order.tracking_number && <p><strong>Tracking number:</strong> {order.tracking_number}</p>}
    {link && <p><a href={link} target="_blank" rel="noopener noreferrer">Track shipment</a></p>}
  </div>;
}
