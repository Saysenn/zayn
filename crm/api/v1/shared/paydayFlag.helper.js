/**
 * ===============================
 * * WHICH PAYDAY ANSWERS WAIT FOR AN ADMIN
 * ===============================
 * His call 2026-10-08. Two do:
 *
 *   partial   some of it arrived. Which deals were paid is for an admin to
 *             mark, deal by deal, by setting Payment received.
 *   changed   a real answer replaced by a different one, e.g. an
 *             accidental yes taken back.
 *
 * The reason starts "payday" and holds no comma: review_reason is a comma
 * list, and the repo's SQL and web helpers/reviewFields.js find it by that
 * word. Only setting Payment received clears it (repo clearPaydayFlag); an
 * upload and "Save and mark it sorted" both leave it.
 */
const PAYDAY_ANSWERED = { confirmed: 'Paid', not_received: 'Unpaid', partial: 'Portion' };
const PAYDAY_REASON = /payday[^,]*/i;

function paydayFlag(was, now) {
  // PART PAID FIRST. whatbot's own follow up to a "no" ("nothing at all, or
  // the amount wrong?") turns not_received into partial, which is the answer
  // getting more precise, not somebody changing their mind.
  if (now === 'partial' && was !== 'partial') return 'payday says only part of the pay arrived';
  if (was && PAYDAY_ANSWERED[was] && PAYDAY_ANSWERED[now] && was !== now) {
    return `payday answer changed from ${PAYDAY_ANSWERED[was]} to ${PAYDAY_ANSWERED[now]}`;
  }
  return null;
}

/**
 * What an upload's needs_review / review_reason becomes once the old row's
 * payday reason is carried over. Every other column passes through.
 */
function keepingPayday(column, next, old) {
  const payday = String(old?.review_reason ?? '').match(PAYDAY_REASON)?.[0];
  if (!payday) return next;
  if (column === 'needs_review') return true;
  if (column === 'review_reason') return next ? `${next}, ${payday}` : payday;
  return next;
}

module.exports = { PAYDAY_REASON, paydayFlag, keepingPayday };
