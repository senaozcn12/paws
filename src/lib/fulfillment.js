export const fulfillmentLabels = {
  unassigned: 'Needs pharmacy assignment', awaiting_acceptance: 'Awaiting pharmacy acceptance',
  processing: 'Processing', declined: 'Declined / released', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};
export function safeTrackingUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
export function fulfillmentError(error) {
  if (error?.code === '40001') return 'This order changed in another session. Refresh orders before trying again.';
  if (error?.code === '42501') return 'You do not have permission to update this order. Check your pharmacy assignment and approval.';
  return error?.code === '22023' ? error.message : 'The update could not be saved. Your entries have been kept. Refresh orders to check its current status before retrying.';
}
