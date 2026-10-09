/**
 * ***************************************************
 * * EVERY KIND OF BADGE, AND THE CLASS NAMES THEY BUILD
 * ***************************************************
 *
 * A COMPOSED CLASS NAME IS INVISIBLE TO TAILWIND. `StatusBadge` builds
 * `badge-${status}`, so the literal `badge-going_concern` appears nowhere
 * in `src`. Tailwind's content scan reads source text, and a
 * `@layer components` rule whose class it never sees is dropped from the
 * build: no error, no warning, a badge that renders as bare text.
 *
 * ELEVEN OF THE TWENTY WERE DEAD IN PRODUCTION, found 2026-09-21 by
 * reading `getComputedStyle` off the live page. Only `badge-liquidation`
 * survived, and only because two files happen to spell it out in full.
 * The end date pill, the fifth company status and every payment outcome
 * were among the dead.
 *
 * This had been "fixed" once before by writing the missing CSS (see the
 * dissolved and liquidation comment in index.css). The CSS was never
 * missing. The class name was never scanned.
 *
 * So the keys live here, `tailwind.config.js` reads them into `safelist`,
 * and a new badge is styled by adding it to this map. Pinned by
 * badgeKinds.test.js, which compares this map against the rules in
 * index.css in both directions.
 */

export const BADGE_LABELS = Object.freeze({
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  active: 'Active',
  // A payment PERIOD, not a company. 'ended' is the deal's own end date
  // having passed; 'paying' is the person-level roll-up of it.
  //
  // 'not_started' is the third state, and it exists because these two used
  // to share a word: a deal starting in November read Ended in August.
  // A DELIBERATE MIRROR of PERIOD_LABEL in
  // api/v1/shared/paymentPeriod.helper.js.
  ended: 'Ended',
  not_started: 'Not yet paying',
  paying: 'Paying',
  newly_opened: 'Newly opened',
  closing: 'Closing',
  closed: 'Closed',
  // The other two COMPANY statuses. Liquidation is still paying, reduced;
  // dissolved is terminal like closed and differs only in what it says
  // happened. A DELIBERATE MIRROR of configs/companyStatus.js.
  liquidation: 'Liquidation',
  dissolved: 'Dissolved',
  // The fifth COMPANY status, and his own word. Trading and expected to
  // keep trading, so it reads green like active and NOT grey like closed:
  // it means the opposite of an ending.
  going_concern: 'Going concern',
  // Not a status. A DEAL that his sheet marks as decided month by month,
  // shown on the end date cell in place of a date. Here because it is the
  // same kind of thing a badge is for: one small fact, read at a glance.
  review_monthly: 'Reviewed monthly',
  end_note_unknown: 'Not a date',
  // THE PAYDAY OUTCOMES, in Payment received's words (his call 2026-10-08).
  // PaymentReceived passes its own label; these are the fallback.
  confirmed: 'Paid',
  not_received: 'Unpaid',
  no_response: 'No response',
  sent: 'Awaiting',
  // The money came, but short. The person reads Portion and each deal is
  // flagged until an admin marks it Paid or Unpaid.
  partial: 'Portion',
  // AN EXPENSE REFUNDED OR NOT (migration 078). Refunded is done and green;
  // not refunded is waiting and grey; late is carried over from an earlier
  // month (information, the accent); unpaid and needs review want someone
  // to act (warning); overdue is 2 paydays gone (red).
  settle_settled: 'Refunded',
  settle_open: 'Not refunded',
  settle_late: 'Late',
  settle_unpaid: 'Unpaid',
  settle_review: 'Needs review',
  settle_overdue: 'Overdue',
});

/** What the build has to keep, whether or not any file spells it out. */
export const BADGE_CLASSES = Object.freeze(
  Object.keys(BADGE_LABELS).map((kind) => `badge-${kind}`),
);
