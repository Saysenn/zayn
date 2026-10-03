const pool = require('../../configs/db');
// A month kept or removed changes a dead person's recorded earnings, held in the rows cache.
const { invalidatingRows } = require('./invalidatingRows');

/**
 * ***************************************************
 * * A month, kept exactly as it stood
 * ***************************************************
 *
 * The only place that touches `tb_month_snapshots`, same rule as every
 * other repo.
 *
 * THREE PROMISES, and each one is here rather than in a caller:
 *
 *   IMMUTABLE   there is no update function, and the table refuses one
 *               anyway (migration 049). A figure that can move is not a
 *               record, and forecasting is only worth anything if last
 *               March still says what it said in March.
 *   WHOLE       the row exactly as the table held it, snake_case and all.
 *               No tidying: tidying is interpretation, and the tidying
 *               rules will themselves change.
 *   STORED      the figures are saved, never recomputed on read.
 *               Recomputing September under today's rules answers a
 *               different question.
 */

/**
 * Take the month. Idempotent: taking it twice is the same row, and the
 * SECOND ONE DOES NOT OVERWRITE.
 *
 * Deliberately not an upsert. "Take September again" after an edit would
 * silently replace the record somebody has already read and paid from, and
 * the whole point is that it cannot move. A caller that means to replace
 * must delete first, which is loud.
 *
 * @returns {{ month, taken_at, row_count, existed }} `existed` true when a
 *   snapshot was already there and this one was NOT written.
 */
async function take(month, rows, totals) {
  let out;
  try {
    ({ rows: out } = await pool.query(
      `INSERT INTO tb_month_snapshots (month, rows, totals, row_count)
       VALUES ($1, $2::jsonb, $3::jsonb, $4)
       RETURNING month, taken_at, row_count`,
      [month, JSON.stringify(rows), JSON.stringify(totals), rows.length],
    ));
  } catch (error) {
    // PostgreSQL forbids ON CONFLICT on a table with an UPDATE rule.
    // A duplicate month is the idempotent path; every other error remains an error.
    if (error.code !== '23505') throw error;
    out = [];
  }

  if (out.length > 0) return { ...out[0], existed: false };

  const kept = await findMeta(month);
  return { ...kept, existed: true };
}

/** The month itself: every row and the figures, as stored. */
async function find(month) {
  const { rows } = await pool.query(
    'SELECT month, taken_at, rows, totals, row_count FROM tb_month_snapshots WHERE month = $1',
    [month],
  );
  return rows[0] ?? null;
}

async function findMany(months) {
  if (!Array.isArray(months) || months.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT month, taken_at, rows, totals, row_count
       FROM tb_month_snapshots
      WHERE month = ANY($1::text[])
      ORDER BY month`,
    [months],
  );
  return rows;
}

/**
 * Just the header, without dragging the whole document out of the
 * database. "Which months do we have" must not cost 96 rows a month.
 */
async function findMeta(month) {
  const { rows } = await pool.query(
    'SELECT month, taken_at, row_count FROM tb_month_snapshots WHERE month = $1',
    [month],
  );
  return rows[0] ?? null;
}

/** Every month held, newest first. Headers only. */
function list({ limit = 36 } = {}) {
  return pool
    .query(
      `SELECT month, taken_at, row_count, totals
       FROM tb_month_snapshots ORDER BY month DESC LIMIT $1`,
      [limit],
    )
    .then((r) => r.rows);
}

/**
 * Removing one is allowed and updating one is not.
 *
 * A month taken by mistake, or taken before a correction, has to be
 * removable or the table becomes a trap. A DELETE is total and obvious
 * where an UPDATE is partial and quiet, and it leaves no half-corrected
 * record that still looks authoritative.
 */
function remove(month) {
  return pool
    .query('DELETE FROM tb_month_snapshots WHERE month = $1 RETURNING month', [month])
    .then((r) => r.rows[0] ?? null);
}

module.exports = {
  take: invalidatingRows(take), find, findMany, findMeta, list, remove: invalidatingRows(remove),
};
