import StatusBadge from './StatusBadge';

/**
 * ===============================
 * * PAYMENT RECEIVED, ONE TAG ON EVERY PAGE
 * ===============================
 * His call 2026-10-08. What the person said on payday.
 *
 *   A DEAL is Paid or Unpaid. A portion shows Unpaid, flagged, until an
 *   admin marks which deals were paid.
 *   A PERSON is Paid, Unpaid or Portion, summed from their live deals by
 *   the API (shared/personPayState.helper.js).
 *
 * Asked but not answered ('sent', 'no_response') is a grey Awaiting, so
 * "we asked, they have not said" reads differently from never asked, which
 * is a dash. The colours borrow the payment outcome badges: green, red,
 * amber and grey.
 */
const TAG = {
  paid: { badge: 'confirmed', label: 'Paid' },
  unpaid: { badge: 'not_received', label: 'Unpaid' },
  portion: { badge: 'partial', label: 'Portion' },
  awaiting: { badge: 'sent', label: 'Awaiting' },
};

// Plain JS, so the rule can be tested without JSX. Re-exported for callers.
export { dealReceived, DEAL_RECEIVED_OPTIONS } from '../../helpers/paymentReceived';

/** @param {'paid'|'unpaid'|'portion'|'awaiting'|null} value */
export default function PaymentReceived({ value }) {
  const tag = TAG[value];
  if (!tag) return <span className="text-text-faint">—</span>;
  return <StatusBadge status={tag.badge} label={tag.label} />;
}
