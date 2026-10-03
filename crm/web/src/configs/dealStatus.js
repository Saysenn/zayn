import { GOING_CONCERN, REVIEWED_MONTHLY } from './sheetValues.js';

/**
 * ***************************************************
 * * CONTRACT: the three deal statuses
 * ***************************************************
 *
 * MIRRORED, NEVER IMPORTED. The server's half is
 * api/v1/shared/dealStatus.helper.js. The two codebases share no file, so
 * each states the set and pins its own half.
 *
 * ===============================
 * * IT IS NOT A STORED COLUMN
 * ===============================
 * Deal Status is a NAME for two facts the row already carries:
 *
 *   review_monthly  the tick, set by the import from his sheet and by the
 *                   Liquidation and Review checklists on the status screen
 *   end_note        his word, "Going concern", meaning there is no end date
 *
 * His call 2026-09-22: the tick and the deal status are THE SAME FACT.
 * Stored twice they can disagree, and then the company's checklist and
 * this column say different things about one deal.
 *
 * So setting it to Active takes the deal out of the review AND shows it
 * unticked in the company's checklist next visit, because there is only
 * one fact underneath.
 *
 * NOT A STOP. Ending a deal is the Stop button: we do not dissolve a deal,
 * we end it. NOT THE PAYMENT PERIOD either, which is derived from the
 * payment start and is settable by nobody.
 */

export const DEAL_STATUS = Object.freeze({
  ACTIVE: 'active',
  GOING_CONCERN: 'going_concern',
  REVIEW: 'review',
});

/**
 * THE SAME WORDS COMPANY STATUS USES for the three that describe a LIVE
 * arrangement. Two vocabularies for one idea is how "assignment" and
 * "appointment" both survived for a month.
 */
export const DEAL_STATUS_OPTIONS = Object.freeze([
  {
    value: DEAL_STATUS.ACTIVE,
    label: 'Active',
    // The tone drives the badge class, so it is a KEY and never the words.
    tone: 'active',
    means: 'Ordinary. Not in the monthly review.',
  },
  {
    value: DEAL_STATUS.GOING_CONCERN,
    label: GOING_CONCERN,
    tone: 'going_concern',
    means: 'No end date, paying in full. Choosing this CLEARS the end date.',
  },
  {
    value: DEAL_STATUS.REVIEW,
    label: REVIEWED_MONTHLY,
    tone: 'review_monthly',
    means: 'In the monthly review, asked about every month.',
  },
]);

export const DEAL_STATUS_LABEL = Object.freeze(
  Object.fromEntries(DEAL_STATUS_OPTIONS.map((o) => [o.value, o.label])),
);

export const DEAL_STATUS_MEANS = Object.freeze(
  Object.fromEntries(DEAL_STATUS_OPTIONS.map((o) => [o.value, o.means])),
);

const TONE_FOR = Object.freeze(
  Object.fromEntries(DEAL_STATUS_OPTIONS.map((o) => [o.value, o.tone])),
);

/**
 * What a row's Deal Status IS.
 *
 * HIS WORD FIRST, the same priority `endCellTag` uses, so the column and
 * the exported cell can never disagree. A row can hold both: the import
 * never writes that combination, but the review checklist can tick a deal
 * that already carried his word.
 */
export function dealStatusOf(row) {
  if (String(row?.end_note ?? '').trim() === GOING_CONCERN) return DEAL_STATUS.GOING_CONCERN;
  if (row?.review_monthly) return DEAL_STATUS.REVIEW;
  return DEAL_STATUS.ACTIVE;
}

/** The badge tone for a row's status. Active draws nothing: see the page. */
export const dealStatusTone = (status) => TONE_FOR[status] ?? 'active';
