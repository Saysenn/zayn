/**
 * ===============================
 * * A PERSON'S PAY STATE, READ OFF THEIR LIVE DEALS
 * ===============================
 * His call 2026-10-08. Should be paid, Paid and Payment received are set
 * and read PER PERSON on the People pages, but they are still stored on
 * each deal. The People pages are a summary of the deals, so these are
 * aggregates, never a second copy that could drift.
 *
 * LIVE DEALS ONLY. A stopped deal is owed nothing, and the bulk bar skips
 * it on write, so counting it here would show "mixed" for a person nobody
 * can change.
 *
 * The aggregates expect a GROUP BY over one person's deals; `t` is the
 * deals' alias.
 */

/**
 * 'yes', 'no' or 'mixed' for one of the two switches. An undecided deal
 * reads as the switch's default, the same fallback every switch renders.
 */
function toggleStateSql(t, column, fallback) {
  const v = `COALESCE(${t}.${column}, ${fallback})`;
  return `CASE WHEN BOOL_AND(${v}) THEN 'yes'
               WHEN NOT BOOL_OR(${v}) THEN 'no'
               ELSE 'mixed' END`;
}

/**
 * What the person said on payday, across their deals.
 *
 *   paid      every answered deal was received in full
 *   unpaid    every answered deal was not received
 *   portion   part paid on any deal, or a mix of the two
 *   awaiting  asked ('sent', 'no_response'), no deal answered yet
 *   null      never asked
 *
 * A part-paid deal shows Unpaid on the master sheet until an admin marks
 * which deals were paid; the PERSON stays Portion until then.
 */
function paymentReceivedSql(t) {
  const n = (outcomes) => `COUNT(*) FILTER (WHERE ${t}.payment_outcome IN (${outcomes}))`;
  return `CASE WHEN ${n("'confirmed', 'partial', 'not_received'")} = 0
                 THEN CASE WHEN ${n("'sent', 'no_response'")} > 0 THEN 'awaiting' END
               WHEN ${n("'partial'")} > 0 THEN 'portion'
               WHEN ${n("'not_received'")} = 0 THEN 'paid'
               WHEN ${n("'confirmed'")} = 0 THEN 'unpaid'
               ELSE 'portion' END`;
}

/** All three, ready to drop into a SELECT grouped by person. */
function personPayStateSql(t) {
  return `${toggleStateSql(t, 'override_should_be_paid', 'true')} AS should_be_paid_state,
          ${toggleStateSql(t, 'override_paid', 'false')} AS paid_state,
          ${paymentReceivedSql(t)} AS payment_received`;
}

const PAY_STATES = ['yes', 'no', 'mixed'];
const RECEIVED_STATES = ['paid', 'unpaid', 'portion', 'awaiting'];

module.exports = { personPayStateSql, PAY_STATES, RECEIVED_STATES };
