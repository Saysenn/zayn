const pool = require('../../configs/db');
const { currentMonth, lastDayOf } = require('../shared/presetMonth.helper');
const { personRatesSql } = require('../shared/personRates.helper');
const { REVIEW_ANSWER_FIELD } = require('../shared/reviewAnswerLog.helper');
// The reasons and the deal cache both belong to that repo. Imported, not
// restated: both halves live in this codebase, so a second copy is a second
// thing to keep in step. The api/web mirror rule is about the OTHER repo.
const { STOPPED_REASON, invalidateCache } = require('./masterSheetRows.repo');

// ***************************************************
// * The only place tb_monthly_review is touched
// ***************************************************
//
// Once a month the CRM asks, per deal past its term, whether it is still
// running. The answer moves money: two of the three write `stopped_on`.
// See docs/closure.md section 5.

/**
 * ===============================
 * * WHAT PUTS A DEAL IN THE QUEUE
 * ===============================
 * Its end date has PASSED and nobody has stopped it. That is the whole
 * rule, and it is the boss's own correction: the end date is not a rule and
 * not decoration, it is a TRIGGER FOR A QUESTION.
 *
 * THIS IS NOT `owedThisMonth`. Nothing here decides what a month owes, and
 * this predicate must never be reached for by anything that does: an
 * unanswered deal is still PAID (see below), so "due for review" and "out
 * of the total" are opposite facts about the same row.
 *
 * `end_on < first of the period` rather than `<=`: a deal ending on the
 * 31st is running all month, and asking about it before it has finished is
 * asking about a month that is not over.
 */
/**
 * ===============================
 * * THE COMPANY'S STATUS, CARRIED SO THE ROW CAN SAY WHY IT IS HERE
 * ===============================
 * This used to be `EXISTS (… status = 'liquidation')` and it was ORed into
 * the predicate below, so EVERY live deal on a liquidating company was in
 * the queue. The checklist on the status screen promised "ticked deals
 * join the Review list every month" and unticking one removed nothing.
 *
 * HIS CALL 2026-09-21: he marks a company and then chooses which of its
 * deals it actually touches. So the tick decides, and this is no longer a
 * reason at all: it is the row saying which STATUS its company holds, so
 * the panel can group liquidation apart from review.
 *
 * Matched on the folded name, like everything else here: "Relia PA" and
 * "Relia Pa" are one company and both spellings are live.
 */
const COMPANY_STATUS_SQL = `
  (SELECT c.status FROM tb_companies c
    WHERE lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(m.company), '\\s+', ' ', 'g'))
    LIMIT 1)
`;

/**
 * ===============================
 * * TWO THINGS PUT A DEAL HERE, AND BOTH ARE FACTS ABOUT THE DEAL
 * ===============================
 * A date that has passed, or somebody having ticked it. Nothing about the
 * COMPANY is in this predicate any more.
 *
 * It used to hold a third clause, "is this company in liquidation", which
 * swept in every live deal on it. That made the checklist a lie: it says
 * "ticked deals join the Review list every month" and unticking one
 * removed nothing. His call 2026-09-21: he marks a company and then
 * chooses which of its deals it actually touches.
 *
 * SO THE TICK IS THE ONLY WAY IN besides a date, and it is set three ways:
 * the import (his sheet writes "Reviewed monthly" on 12 rows), the
 * liquidation checklist, and the review checklist. Which of those it was
 * decides which TAB the row appears under, never whether it appears.
 */
// ===============================
// * FINAL MONTH STAYS ON SCREEN, ALREADY ENDED LEAVES
// ===============================
// His call 2026-09-29. `final` is still paid in full for this month, so it
// belongs on this month's list. `no` stops at the end of LAST month, so it
// is out of the month entirely and the list is not where it is read. The way
// back is History, which is why the panel's Undo answer button went with it.
//
// CONTRACT with web/src/configs/monthlyReview.js REVIEW_ANSWER_LEAVES_LIST.
const STAYS_AFTER_STOP = [STOPPED_REASON.REVIEW_FINAL];

const STAYS_ON_SCREEN_SQL = `
  m.stopped_reason IN (${STAYS_AFTER_STOP.map((reason) => `'${reason}'`).join(', ')})
  AND r.answer IS NOT NULL
`;

const DUE_SQL = `
  (m.stopped_on IS NULL OR (${STAYS_ON_SCREEN_SQL}))
  AND (
    (m.end_on IS NOT NULL AND m.end_on < ($1::text || '-01')::date)
    OR m.review_monthly = true
  )
`;

// What the panel and Diane both read. The deal's own columns, plus this
// period's answer if there is one. No join to tb_people: the deal carries
// the name, and the queue is a list of DEALS.
const QUEUE_COLUMNS = `
  m.id, m.person_id, m.person_name, m.group_name, m.company, m.role_label,
  m.monthly_amount, m.currency, m.payment_start_on, m.preset_on, m.end_on,
  -- NOT why it is here: the company's status is what GROUPS it. A deal
  -- whose end date is months away is here because somebody ticked it, and
  -- its company's status says whether that was a wind down or a review.
  ${COMPANY_STATUS_SQL} AS company_status,
  -- WHY IT IS HERE. His own word on the deal, so the list can say "he
  -- asked for this one" rather than implying a date passed.
  m.review_monthly, m.end_note, m.stopped_on,
  -- ===============================
  -- * THE RATE COLUMNS, because a queue prints money
  -- ===============================
  -- Without them the queue could not apply the rates even if it wanted to,
  -- so it printed the RAW wage: Zayn read AED 3,809.52 where he is paid
  -- 4,000. Reported 2026-09-21. The payment method is here for the same
  -- reason: the crypto rail's own charge is one of the three rates.
  m.addon_percent, m.fee_percent, m.payment_method, m.payable_amount,
  ${personRatesSql('m')},
  r.answer, r.answered_by, r.answered_at
`;

/**
 * The queue for a period.
 *
 * UNANSWERED FIRST, because that is the work. Within that, oldest end date
 * first: the deal that has been past its term longest is the one somebody
 * has been quietly paying for the longest.
 *
 * @param {string} period 'YYYY-MM'. Defaults to the month the BUSINESS is
 *   in, never the host's. There is no picker anywhere in the UI.
 */
async function queue(period = currentMonth(), { group, personId, company, answered } = {}) {
  const params = [period];
  const where = [DUE_SQL];

  if (group) {
    params.push(group);
    where.push(`upper(m.group_name) = upper($${params.length})`);
  }
  if (personId) {
    params.push(personId);
    where.push(`m.person_id = $${params.length}`);
  }
  if (company) {
    params.push(company);
    where.push(`lower(btrim(m.company)) = lower(btrim($${params.length}))`);
  }
  // Three states, and the default is ALL of them: the panel shows what has
  // been decided beside what has not, or answering something makes it
  // vanish and there is no way to see you answered it wrong.
  if (answered === true) where.push('r.answer IS NOT NULL');
  if (answered === false) where.push('r.answer IS NULL');

  const result = await pool.query(
    `SELECT ${QUEUE_COLUMNS}
       FROM tb_mastersheet m
       LEFT JOIN tb_monthly_review r
         ON r.deal_id = m.id AND r.period = $1
      WHERE ${where.join(' AND ')}
      ORDER BY (r.answer IS NOT NULL), m.end_on, m.group_name, m.person_name`,
    params,
  );
  return result.rows;
}

/**
 * How many are waiting, and how much money they carry.
 *
 * THE MONEY IS THE POINT. "6 deals to review" is a nudge; "6 deals,
 * 4,300 a month" is why the export warning exists at all.
 */
async function pending(period = currentMonth()) {
  const result = await pool.query(
    `SELECT count(*)::int AS count,
            COALESCE(sum(m.monthly_amount), 0)::float AS amount
       FROM tb_mastersheet m
       LEFT JOIN tb_monthly_review r
         ON r.deal_id = m.id AND r.period = $1
      WHERE ${DUE_SQL} AND r.answer IS NULL`,
    [period],
  );
  return result.rows[0];
}

/** Is this deal actually being asked about? The guard every write shares. */
async function isDue(dealId, period) {
  const result = await pool.query(
    `SELECT 1 FROM tb_mastersheet m
       LEFT JOIN tb_monthly_review r ON r.deal_id = m.id AND r.period = $1
      WHERE ${DUE_SQL} AND m.id = $2`,
    [period, dealId],
  );
  return result.rowCount > 0;
}

/** The same guard for a whole selection, in ONE query rather than one per deal. */
async function dueIds(ids, period) {
  const result = await pool.query(
    `SELECT m.id FROM tb_mastersheet m
       LEFT JOIN tb_monthly_review r ON r.deal_id = m.id AND r.period = $1
      WHERE ${DUE_SQL} AND m.id = ANY($2::int[])`,
    [period, ids],
  );
  return result.rows.map((row) => row.id);
}

/**
 * ===============================
 * * WHAT EACH ANSWER DOES TO THE DATE
 * ===============================
 *   yes    nothing. The deal runs on and is asked again next month.
 *   final  paid in full this month, stops at the END OF THIS MONTH.
 *   no     it has already ended, so it stops at the END OF LAST MONTH.
 *
 * The difference between the last two is one month's money for one person,
 * which is why they are two buttons and not a checkbox.
 */
const STOPS_AT = {
  yes: () => null,
  final: (period) => lastDayOf(period),
  no: (period) => {
    const [y, m] = period.split('-').map(Number);
    // Day 0 of this month is the last day of the previous one, so the
    // January case needs no special handling.
    return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  },
};

const ANSWERS = Object.freeze(Object.keys(STOPS_AT));

// Which stop reason each answer writes.
const REASON_FOR = {
  final: STOPPED_REASON.REVIEW_FINAL,
  no: STOPPED_REASON.REVIEW_NO,
};

/**
 * Answer for one deal, or clear its answer (`answer` null), and write or
 * lift the stop that implies. ONE TRANSACTION: an answer without its stop
 * is a deal that reads finished on the panel and is still paid on the sheet.
 *
 * RE-ANSWERABLE AND CLEARABLE, because the commonest correction is a
 * misclick on a row that pays somebody. Every change is logged for History.
 */
async function setAnswer(dealId, period, answer, { by = 'admin', batchId = null } = {}) {
  if (answer !== null && !ANSWERS.includes(answer)) throw new Error(`${answer} is not an answer`);

  // This writes tb_mastersheet from outside the repo that owns it, so its
  // read cache has to be dropped here.
  invalidateCache();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: before } = await client.query(
      'SELECT answer FROM tb_monthly_review WHERE deal_id = $1 AND period = $2 FOR UPDATE',
      [dealId, period],
    );
    const was = before[0]?.answer ?? null;

    if (answer === null) {
      await client.query(
        'DELETE FROM tb_monthly_review WHERE deal_id = $1 AND period = $2',
        [dealId, period],
      );
    } else {
      await client.query(
        `INSERT INTO tb_monthly_review (deal_id, period, answer, answered_by)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (deal_id, period) DO UPDATE
            SET answer = EXCLUDED.answer,
                answered_by = EXCLUDED.answered_by,
                answered_at = now()`,
        [dealId, period, answer, by],
      );
    }

    const stopsAt = answer ? STOPS_AT[answer](period) : null;
    if (stopsAt) {
      await client.query(
        `UPDATE tb_mastersheet
            SET stopped_on = $2, stopped_reason = $3, updated_at = now()
          WHERE id = $1`,
        [dealId, stopsAt, REASON_FOR[answer]],
      );
    } else {
      // Lifts a stop this review wrote, and only one it wrote. A deal
      // stopped by hand or by its company closing is not undone here.
      await client.query(
        `UPDATE tb_mastersheet
            SET stopped_on = NULL, stopped_reason = NULL, updated_at = now()
          WHERE id = $1 AND stopped_reason IN ($2, $3)`,
        [dealId, STOPPED_REASON.REVIEW_FINAL, STOPPED_REASON.REVIEW_NO],
      );
    }

    if (was !== answer) {
      await client.query(
        `INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, $2, $3, $4, $5, $6::uuid FROM tb_mastersheet WHERE id = $1`,
        [dealId, REVIEW_ANSWER_FIELD, was, answer, by, batchId],
      );
    }

    const result = await client.query(
      `SELECT ${QUEUE_COLUMNS}
         FROM tb_mastersheet m
         LEFT JOIN tb_monthly_review r ON r.deal_id = m.id AND r.period = $2
        WHERE m.id = $1`,
      [dealId, period],
    );
    await client.query('COMMIT');
    return { row: result.rows[0] ?? null, stoppedOn: stopsAt };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Diane's and the route's door, unchanged in shape.
function answerOne(dealId, period, answer, answeredBy = 'admin', { batchId = null } = {}) {
  return setAnswer(dealId, period, answer, { by: answeredBy, batchId });
}

/**
 * History's undo of a logged answer: puts the OLD answer back, stop and all,
 * for the month it was given in. Refuses if the answer has moved since.
 */
async function revertAnswer(change, { via = 'admin' } = {}) {
  const period = currentMonth(new Date(change.changed_at));
  const { rows } = await pool.query(
    'SELECT answer FROM tb_monthly_review WHERE deal_id = $1 AND period = $2',
    [change.row_id, period],
  );
  const now = rows[0]?.answer ?? null;
  if (now !== (change.new_value ?? null)) {
    return { ok: false, reason: `the answer has changed since: it is ${now ?? 'unanswered'} now` };
  }
  const { row } = await setAnswer(change.row_id, period, change.old_value ?? null, { by: via });
  return { ok: true, row, field: change.field, value: change.old_value };
}

/** Every answer ever given for one deal, newest first. For the row history. */
async function forDeal(dealId) {
  const result = await pool.query(
    `SELECT period, answer, answered_by, answered_at
       FROM tb_monthly_review WHERE deal_id = $1 ORDER BY period DESC`,
    [dealId],
  );
  return result.rows;
}

module.exports = {
  queue, pending, isDue, dueIds, answerOne, setAnswer, revertAnswer, forDeal, ANSWERS, STOPS_AT,
};
