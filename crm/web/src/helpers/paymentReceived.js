/**
 * A deal's stored payday outcome, as its Payment received tag. His call
 * 2026-10-08: a deal is Paid or Unpaid (a portion reads Unpaid, flagged,
 * until an admin marks it), asked-but-silent is Awaiting, never asked is
 * null. See components/badges/PaymentReceived.jsx.
 */
export function dealReceived(outcome) {
  if (outcome === 'confirmed') return 'paid';
  if (outcome === 'not_received' || outcome === 'partial') return 'unpaid';
  if (outcome === 'sent' || outcome === 'no_response') return 'awaiting';
  return null;
}

/** What an admin can set a deal to. Stored as the payday outcomes. */
export const DEAL_RECEIVED_OPTIONS = [
  { value: 'confirmed', label: 'Paid' },
  { value: 'not_received', label: 'Unpaid' },
];
