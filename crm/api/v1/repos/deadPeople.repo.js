// ***************************************************
// * The dead list: people whose every deal is stopped
// ***************************************************
//
// WORKED OUT LIVE, NEVER STORED. His call 2026-09-25. A person is on it
// when they hold at least one deal and none of them is live, so a deal
// added back under their person_id takes them off it at once, with nothing
// to keep in step. Indexed by migration 067, cached through the rows cache.

const pool = require('../../configs/db');
const rowsRepo = require('./masterSheetRows.repo');
const { personRatesSql } = require('../shared/personRates.helper');

// The people it is, as one SQL fragment both reads share. The anti join
// walks the live person index (067), the group walks the stopped one.
const DEAD_IDS_SQL = `
  SELECT m.person_id
    FROM tb_mastersheet m
   WHERE m.stopped_on IS NOT NULL
     AND m.person_id IS NOT NULL AND m.person_id <> ''
     AND NOT EXISTS (
       SELECT 1 FROM tb_mastersheet l
        WHERE l.person_id = m.person_id AND l.stopped_on IS NULL)
   GROUP BY m.person_id`;

// A display name equal to the person_id is the old slug default (066), never a choice.
// The distinct non blank values of a column across their deals.
const setOf = (col) => `ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(btrim(d.${col}), '')), NULL)`;

/**
 * The list: one row per dead person, their contacts and banks as sets
 * (they legitimately differ between deals), and how much history they have.
 */
async function findAll({ q, group, page = 1, pageSize = 25 } = {}) {
  const key = `dead:list:${q ?? ''}|${group ?? ''}|${page}|${pageSize}`;
  return rowsRepo.readThrough(key, async () => {
    const params = [];
    const where = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(d.person_name ILIKE $${params.length} OR d.phone ILIKE $${params.length})`);
    }
    if (group) {
      params.push(group);
      where.push(`upper(d.group_name) = upper($${params.length})`);
    }
    const filter = where.length ? `HAVING bool_or(${where.join(' AND ')})` : '';
    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `WITH dead AS (${DEAD_IDS_SQL}),
       agg AS (
         SELECT d.person_id,
                COALESCE(MAX(NULLIF(p.display_name, p.person_id)), MAX(d.person_name)) AS display_name,
                COALESCE(MAX(p.email), '') AS email,
                ${setOf('phone')} AS phones,
                ${setOf('bank_details')} AS bank_details,
                ${setOf('account_number')} AS account_numbers,
                ${setOf('sort_code')} AS sort_codes,
                ARRAY_AGG(DISTINCT d.group_name ORDER BY d.group_name) AS groups,
                COUNT(*)::int AS deal_count,
                COUNT(DISTINCT (lower(btrim(COALESCE(d.group_name, ''))), lower(btrim(COALESCE(d.company, '')))))::int AS company_count,
                MIN(COALESCE(d.payment_start_on, d.assigned_on)) AS first_started,
                MAX(d.stopped_on) AS last_stopped
           FROM tb_mastersheet d
           JOIN dead USING (person_id)
           LEFT JOIN tb_people p ON p.person_id = d.person_id
          GROUP BY d.person_id
          ${filter}
       )
       SELECT (SELECT COUNT(*)::int FROM agg) AS total,
              COALESCE((SELECT json_agg(a) FROM (
                SELECT * FROM agg ORDER BY last_stopped DESC NULLS LAST, display_name
                LIMIT $${params.length - 1} OFFSET $${params.length}) a), '[]') AS rows`,
      params,
    );
    return { rows: rows[0].rows, total: rows[0].total };
  });
}

/**
 * One dead person: their profile, every past deal with both rate levels,
 * and their rows from the month snapshots. Null when they are not dead,
 * including when a deal was added back.
 */
async function findById(personId) {
  return rowsRepo.readThrough(`dead:one:${personId}`, async () => {
    const { rows } = await pool.query(
      `WITH deals AS (
         SELECT *, ${personRatesSql('tb_mastersheet')}
           FROM tb_mastersheet WHERE person_id = $1
       )
       SELECT
         (SELECT COUNT(*) FROM deals WHERE stopped_on IS NULL)::int AS live_count,
         (SELECT COUNT(*) FROM deals)::int AS deal_count,
         COALESCE(NULLIF(p.display_name, p.person_id), (SELECT MAX(person_name) FROM deals)) AS display_name,
         COALESCE(p.email, '') AS email,
         COALESCE(p.notes, '') AS notes,
         COALESCE(p.addon_percent, 0)::float AS addon_percent,
         COALESCE(p.fee_percent, 0)::float AS fee_percent,
         (SELECT ${setOf('phone')} FROM deals d) AS phones,
         (SELECT ${setOf('location')} FROM deals d) AS locations,
         (SELECT ${setOf('door_number')} FROM deals d) AS door_numbers,
         (SELECT ${setOf('postcode')} FROM deals d) AS postcodes,
         (SELECT ${setOf('bank_details')} FROM deals d) AS bank_details,
         (SELECT ${setOf('account_number')} FROM deals d) AS account_numbers,
         (SELECT ${setOf('sort_code')} FROM deals d) AS sort_codes,
         (SELECT ${setOf('payment_method')} FROM deals d) AS payment_methods,
         COALESCE((SELECT json_agg(d ORDER BY COALESCE(d.payment_start_on, d.assigned_on), d.id) FROM deals d), '[]') AS deals,
         -- Their rows from every month kept, as kept. See month snapshots (049).
         COALESCE((SELECT json_agg(json_build_object('month', s.month, 'row', r))
                     FROM tb_month_snapshots s, jsonb_array_elements(s.rows) r
                    WHERE r->>'person_id' = $1), '[]') AS snapshot_rows
       FROM (SELECT 1) _
       LEFT JOIN tb_people p ON p.person_id = $1`,
      [personId],
    );
    const row = rows[0];
    if (!row || row.deal_count === 0 || row.live_count > 0) return null;
    return row;
  });
}

module.exports = {
  findAll, findById, DEAD_IDS_SQL,
};
