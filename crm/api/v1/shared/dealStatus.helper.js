const { GOING_CONCERN, REVIEWED_MONTHLY } = require('./endNote.helper');

/**
 * ***************************************************
 * * DEAL STATUS: a name for two columns, never a third one
 * ***************************************************
 *
 * His call 2026-09-22. He wanted a per deal status he could set from the
 * master sheet, which also decides whether the deal is in the monthly
 * review.
 *
 * ===============================
 * * IT IS NOT A STORED COLUMN, AND THAT IS THE POINT
 * ===============================
 * The two facts already exist on the row:
 *
 *   review_monthly  the tick. Set by the import from his sheet, and by the
 *                   Liquidation and Review checklists on the status screen.
 *   end_note        his word, "Going concern", meaning there is no end date.
 *
 * His own words: the tick and the deal status are THE SAME FACT. Stored
 * twice they can disagree, and then the company's checklist and the master
 * sheet column say different things about one deal. So this names the pair
 * rather than adding a third place for it to drift.
 *
 *   set it to Active            it leaves the review AND the checklist
 *                               shows it unticked on the next visit
 *   tick it in the checklist    its Deal Status reads Reviewed monthly
 *
 * ===============================
 * * READ BY PRIORITY, WRITTEN AS A PAIR
 * ===============================
 * A row can already hold BOTH: the import never writes that combination,
 * but the review checklist can tick a deal that already carried his word.
 * The dropdown cannot express it, so reading resolves it (his word wins,
 * the same priority the end date tag has always used) and writing sets
 * both columns, so a row that anybody touches can never be mixed again.
 *
 * NOT A STOP. Closing or dissolving a deal is the Stop button and
 * `stopped_on`; his call, because we do not dissolve a deal, we end it.
 * This says what a LIVE deal is, never whether it is still running.
 *
 * NOT THE PAYMENT PERIOD either. That is derived from the payment start
 * and is not settable by anybody. See paymentPeriod.helper.
 */

const DEAL_STATUS = Object.freeze({
  ACTIVE: 'active',
  GOING_CONCERN: 'going_concern',
  REVIEW: 'review',
});

/**
 * THE SAME THREE WORDS COMPANY STATUS USES, deliberately. A company is
 * `active | going_concern | review | liquidation | dissolved | closed`, and
 * the three that describe a LIVE arrangement mean the same thing one level
 * down. Two vocabularies for one idea is how "assignment" and "appointment"
 * both survived for a month.
 */
const DEAL_STATUS_VALUES = Object.freeze(Object.values(DEAL_STATUS));

/** The words on screen. His, where he has a word for it. */
const DEAL_STATUS_LABEL = Object.freeze({
  [DEAL_STATUS.ACTIVE]: 'Active',
  [DEAL_STATUS.GOING_CONCERN]: GOING_CONCERN,
  [DEAL_STATUS.REVIEW]: REVIEWED_MONTHLY,
});

/**
 * What a stored row's Deal Status IS.
 *
 * HIS WORD FIRST. It is the most specific answer there is, because he
 * wrote it about that row, and it is the same priority `endCellTag` uses
 * on both sides so the column and the exported cell can never disagree.
 */
function dealStatusOf(row) {
  if (String(row?.end_note ?? '').trim() === GOING_CONCERN) return DEAL_STATUS.GOING_CONCERN;
  if (row?.review_monthly) return DEAL_STATUS.REVIEW;
  return DEAL_STATUS.ACTIVE;
}

/**
 * What writing a Deal Status does to the two columns.
 *
 * BOTH, ALWAYS. Setting one and leaving the other is how the mixed state
 * gets made in the first place.
 *
 * `clearsEndDate` is separate because it is the one destructive part:
 * "Going concern" means there IS no end date, so the date goes, and only
 * History can bring it back. The caller confirms it; this only says so.
 */
function dealStatusWrites(status) {
  if (!DEAL_STATUS_VALUES.includes(status)) return null;
  return {
    endNote: status === DEAL_STATUS.GOING_CONCERN ? GOING_CONCERN : null,
    reviewMonthly: status === DEAL_STATUS.REVIEW,
    clearsEndDate: status === DEAL_STATUS.GOING_CONCERN,
  };
}

/**
 * ===============================
 * * THE SAME PRIORITY, AS A WHERE FRAGMENT
 * ===============================
 * `dealStatusOf` reads one row in JavaScript. A filter has to ask the same
 * question of every row at once, and a second reading of the pair would
 * disagree with the first the day his word and the tick both land on a row.
 * So it is written once here, branch for branch, like `paymentPeriodSql`.
 *
 * Diane could not answer "how many deals are reviewed monthly" at all: she
 * reached for the monthly review QUEUE and gave its 17 unanswered against
 * the 12 rows that actually carry the status. Found 2026-09-24.
 *
 * THE WORD IS A CODE CONSTANT, not input, so it is inlined. `status` is
 * checked against the closed set first, so neither can carry a quote.
 *
 * @returns {string|null} the fragment, or null for an unknown status
 */
function dealStatusSql(status, alias = '') {
  if (!DEAL_STATUS_VALUES.includes(status)) return null;
  const a = alias ? `${alias}.` : '';
  const his = `btrim(coalesce(${a}end_note, '')) = '${GOING_CONCERN}'`;
  const ticked = `coalesce(${a}review_monthly, false)`;

  // HIS WORD FIRST, exactly as dealStatusOf resolves it: a row carrying
  // both is Going concern, never Reviewed monthly.
  if (status === DEAL_STATUS.GOING_CONCERN) return his;
  if (status === DEAL_STATUS.REVIEW) return `NOT (${his}) AND ${ticked}`;
  return `NOT (${his}) AND NOT ${ticked}`;
}

module.exports = {
  DEAL_STATUS,
  DEAL_STATUS_VALUES,
  DEAL_STATUS_LABEL,
  dealStatusOf,
  dealStatusWrites,
  dealStatusSql,
};
