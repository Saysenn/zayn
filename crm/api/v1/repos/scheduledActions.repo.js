const pool = require('../../configs/db');

/**
 * ***************************************************
 * * THE PARKED WORK QUEUE
 * ***************************************************
 *
 * One row per month per action. "The next 3 months" is three rows, not one
 * row run three times: each month's application is its own fact, with its
 * own outcome, and a December that was skipped must not hide behind a
 * November that worked.
 *
 * NOTHING HERE DECIDES WHAT IS SAFE TO RUN. This stores and claims; the
 * preconditions, the allow list and the writes live in agent/scheduled/.
 */

const RUNNABLE = 'parked';

// A claim older than this was left behind by a crash, not by a live run.
// Reclaiming is only safe because an absolute field set replays as a no-op
// (masterSheetRows.repo.js: unchanged values are not even logged).
const LEASE_MINUTES = 5;

const COLUMNS = `id, due_month, tool, args, expect, target_ids, said,
  parked_at, parked_via, status, attempts, claimed_at, ran_at, batch_id, outcome`;

/**
 * Park one action for one month.
 *
 * Supersedes an earlier park for the same month and the same target, so
 * saying it twice does not apply it twice or report it twice. Matched on
 * the tool and the ids rather than on the sentence: the same change asked
 * for in two different ways is still the same change.
 */
async function park({
  dueMonth, tool, args, expect = {}, targetIds = [], said, parkedVia = 'diane',
  companies = null, anyMonth = false,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tb_scheduled_actions
         (due_month, tool, args, expect, target_ids, said, parked_via)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::int[], $6, $7)
       RETURNING ${COLUMNS}`,
      [dueMonth, tool, JSON.stringify(args), JSON.stringify(expect), targetIds, said, parkedVia],
    );
    const saved = rows[0];

    /**
     * ===============================
     * * WHAT A NEW PARK REPLACES, 2026-10-04
     * ===============================
     * A COMPANY closure has no row ids, so "same tool, same month, same
     * ids" matched EVERY company closure that month: closing Harbor Nine
     * and then Quarry Lane for November would have dropped Harbor Nine.
     * And "close it at the end of next month instead" kept the November one
     * beside the new December one. So:
     *   - a company act replaces an earlier one for the SAME companies, in
     *     any month (a company closes once);
     *   - a deal change replaces the same deal's in the same month, or in
     *     any month when they said "instead" (anyMonth);
     *   - nothing with no ids and no companies replaces anything.
     */
    if (Array.isArray(companies) && companies.length > 0) {
      const key = (list) => [...list].map((c) => String(c).trim().toLowerCase()).sort().join('|');
      const { rows: same } = await client.query(
        `SELECT id, args FROM tb_scheduled_actions
          WHERE id <> $1 AND status = 'parked' AND tool = $2`,
        [saved.id, tool],
      );
      const ids = same.filter((r) => key([].concat(r.args?.companies ?? r.args?.company ?? [])) === key(companies)).map((r) => r.id);
      if (ids.length) {
        await client.query(
          `UPDATE tb_scheduled_actions
              SET status = 'superseded', superseded_by = $1, outcome = 'Replaced by a later instruction.'
            WHERE id = ANY($2::bigint[])`,
          [saved.id, ids],
        );
      }
    } else if (targetIds.length > 0) {
      await client.query(
        `UPDATE tb_scheduled_actions
            SET status = 'superseded', superseded_by = $1,
                outcome = 'Replaced by a later instruction.'
          WHERE id <> $1
            AND status = 'parked'
            AND ($5 OR due_month = $2)
            AND tool = $3
            AND target_ids = $4::int[]`,
        [saved.id, dueMonth, tool, targetIds, anyMonth],
      );
    }

    await client.query('COMMIT');
    return saved;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Everything still waiting for this month, oldest first. */
function dueFor(month) {
  return pool
    .query(
      `SELECT ${COLUMNS} FROM tb_scheduled_actions
        WHERE due_month = $1 AND status = $2
        ORDER BY parked_at ASC`,
      [month, RUNNABLE],
    )
    .then((r) => r.rows);
}

/**
 * CLAIM ONE ROW, or find out somebody else has it.
 *
 * The compare-and-swap is the whole duplicate guard: two tabs booting at
 * the same second both run this, and exactly one gets a row back. A row
 * already 'done' can never be claimed again by anyone.
 */
function claim(id) {
  return pool
    .query(
      `UPDATE tb_scheduled_actions
          SET status = 'running', claimed_at = now(), attempts = attempts + 1
        WHERE id = $1
          AND (status = 'parked'
               OR (status = 'running' AND claimed_at < now() - ($2 || ' minutes')::interval))
        RETURNING ${COLUMNS}`,
      [id, LEASE_MINUTES],
    )
    .then((r) => r.rows[0] ?? null);
}

/** How it ended. `outcome` is the sentence the welcome page reads out. */
function finish(id, { status, outcome = null, batchId = null }) {
  return pool
    .query(
      `UPDATE tb_scheduled_actions
          SET status = $2, outcome = $3, batch_id = $4, ran_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, status, outcome, batchId],
    )
    .then((r) => r.rows[0] ?? null);
}

/** Back to the queue for another sign in, up to `maxAttempts`. */
function release(id, maxAttempts) {
  return pool
    .query(
      `UPDATE tb_scheduled_actions
          SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'parked' END,
              outcome = CASE WHEN attempts >= $2 THEN $3 ELSE NULL END,
              claimed_at = NULL
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, maxAttempts, `Tried ${maxAttempts} times and could not be applied.`],
    )
    .then((r) => r.rows[0] ?? null);
}

/**
 * Anything whose month has passed, closed off without running.
 *
 * NEVER RUN LATE, his call: a rate change meant for November, applied in
 * December, is a change nobody asked for in the month it lands in. It is
 * reported instead, so the decision to redo it is his.
 */
function expireBefore(month) {
  return pool
    .query(
      `UPDATE tb_scheduled_actions
          SET status = 'expired', ran_at = now(),
              outcome = 'Its month passed without a sign in, so it was not applied.'
        WHERE status IN ('parked', 'running') AND due_month < $1
        RETURNING ${COLUMNS}`,
      [month],
    )
    .then((r) => r.rows);
}

/** The standing list on the welcome page: what is coming, and when. */
function upcoming(fromMonth, limit = 50) {
  return pool
    .query(
      `SELECT ${COLUMNS} FROM tb_scheduled_actions
        WHERE status = 'parked' AND due_month >= $1
        ORDER BY due_month ASC, parked_at ASC
        LIMIT $2`,
      [fromMonth, limit],
    )
    .then((r) => r.rows);
}

/** What a finished run did, for the report. */
function ranIn(month) {
  return pool
    .query(
      `SELECT ${COLUMNS} FROM tb_scheduled_actions
        WHERE due_month = $1 AND status IN ('done', 'skipped', 'failed', 'expired')
        ORDER BY ran_at ASC`,
      [month],
    )
    .then((r) => r.rows);
}

/** Called off by hand from the welcome page. Only ever a parked row. */
function cancel(id) {
  return pool
    .query(
      `UPDATE tb_scheduled_actions
          SET status = 'superseded', ran_at = now(), outcome = 'Cancelled.'
        WHERE id = $1 AND status = 'parked'
        RETURNING ${COLUMNS}`,
      [id],
    )
    .then((r) => r.rows[0] ?? null);
}

module.exports = {
  park, dueFor, claim, finish, release, expireBefore, upcoming, ranIn, cancel,
  LEASE_MINUTES, RUNNABLE,
};
