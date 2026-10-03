import StatusBadge from './StatusBadge';

/**
 * A deal's payment period: `active` or `ended`.
 *
 * This is about the PERSON on the row, never the company. It comes from
 * the sheet's own "Provisional payment end date", a formula giving one
 * year after that row's payment start date, so two handlers on one company
 * legitimately end on different dates. It used to be called Status and sat
 * a few inches from the company's own active/closed Status, which is what
 * made everyone read it as company life.
 *
 * Worked out server-side rather than read from the stored column, which
 * only updated on upload and went stale the day an end date passed. It ends
 * against the ROW'S OWN MONTH, not against today: a deal ending on the 26th
 * is still paid the whole month, and reading Ended beside 31 payable days
 * is what that replaced. See v1/shared/paymentPeriod.helper.js.
 *
 * NOTHING SETS IT BY HAND ANY MORE, 2026-09-09. There was an override, and
 * a "Set by hand" icon explaining the contradiction it created. Both are
 * gone: the badge now always agrees with the payment start cell beside it,
 * so there is nothing left to explain. To change the period, change the
 * payment start, the preset or the end date.
 *
 * The remaining props are the row's dates. They stay because callers pass
 * them and because the day this needs to say something about a date again,
 * it will have them.
 */
export default function PaymentPeriod({ period }) {
  if (!period) return <span className="text-text-faint">—</span>;
  return <StatusBadge status={period} />;
}

