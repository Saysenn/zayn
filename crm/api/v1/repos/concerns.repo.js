const pool = require('../../configs/db');

const ROW = 'id, person_id, group_name, category, message, status, created_at, status_changed_at';

function create({ personId, groupName, category, message }) {
  return pool
    .query(
      `INSERT INTO tb_concerns (person_id, group_name, category, message)
       VALUES ($1, $2, $3, $4)
       RETURNING ${ROW}`,
      [personId, groupName, category, message],
    )
    .then((result) => result.rows[0]);
}

// The stamp only moves when the status actually moves. Re-picking the
// value a flag already has is not a change, and letting it bump the date
// would make "resolved 3 days ago" become "resolved just now" because
// somebody opened the dropdown and closed it on the same option.
function updateStatus(id, status) {
  return pool
    .query(
      `UPDATE tb_concerns
       SET status = $2,
           status_changed_at = CASE WHEN status = $2 THEN status_changed_at ELSE now() END
       WHERE id = $1
       RETURNING ${ROW}`,
      [id, status],
    )
    .then((result) => result.rows[0] ?? null);
}

// The flagged queue: one row per person per group, not per concern — a
// person with three complaints is one thing to review, not three rows to
// scroll past. Aggregate status is worst-first (any 'open' beats any
// 'in_progress' beats all-'resolved'), so a person needing attention never
// hides behind an already-resolved one. from/to filter on when each
// underlying concern was raised — "this month", typically.
//
// Paginated after grouping — LIMIT/OFFSET and the COUNT(*) OVER() both
// apply to the grouped (person, group) rows, not the raw concerns, which is
// what a "page" means on this queue. `q` matches on the joined person_name,
// available in WHERE like any other per-row column since it comes from the
// LATERAL join, not an aggregate.
function listGrouped({ status, from, to, groupName, q, limit = 50, offset = 0 } = {}) {
  const statuses = Array.isArray(status)
    ? [...new Set(status.map((value) => String(value ?? '').trim()).filter(Boolean))]
    : (status ? [status] : null);
  return pool
    .query(
      `SELECT c.person_id, a.person_name, c.group_name,
              COUNT(*)::int AS concern_count,
              MAX(c.created_at) AS latest_at,
              -- The most recent status change across this person's flags,
              -- which is what "last update" means on a card that stands
              -- for all of them.
              MAX(c.status_changed_at) AS status_changed_at,
              (array_agg(c.category ORDER BY c.created_at DESC))[1] AS latest_category,
              (array_agg(c.message ORDER BY c.created_at DESC))[1] AS latest_message,
              CASE
                WHEN bool_or(c.status = 'open') THEN 'open'
                WHEN bool_or(c.status = 'in_progress') THEN 'in_progress'
                ELSE 'resolved'
              END AS status,
              COUNT(*) OVER()::int AS total_count
       FROM tb_concerns c
       LEFT JOIN LATERAL (
         SELECT person_name FROM tb_mastersheet
         WHERE tb_mastersheet.group_name = c.group_name AND tb_mastersheet.person_id = c.person_id
         LIMIT 1
       ) a ON true
       WHERE ($1::date IS NULL OR c.created_at >= $1::date)
         AND ($2::date IS NULL OR c.created_at < $2::date + interval '1 day')
         AND ($4::text IS NULL OR c.group_name = $4)
         AND ($5::text IS NULL OR COALESCE(a.person_name, c.person_id) ILIKE $5)
       GROUP BY c.person_id, a.person_name, c.group_name
       HAVING (
         $3::text[] IS NULL OR
         (CASE
            WHEN bool_or(c.status = 'open') THEN 'open'
            WHEN bool_or(c.status = 'in_progress') THEN 'in_progress'
            ELSE 'resolved'
          END) = ANY($3::text[])
       )
       ORDER BY (
         CASE
           WHEN bool_or(c.status = 'open') THEN 0
           WHEN bool_or(c.status = 'in_progress') THEN 1
           ELSE 2
         END
       ), latest_at DESC
       LIMIT $6 OFFSET $7`,
      [from ?? null, to ?? null, statuses?.length ? statuses : null, groupName ?? null, q ? `%${q}%` : null, limit, offset],
    )
    .then((result) => ({
      rows: result.rows.map(({ total_count, ...row }) => row),
      total: result.rows[0]?.total_count ?? 0,
    }));
}

// Full history for one person's detail modal — never date-filtered, unlike
// the overview: once you're looking at someone specifically, their older
// concerns are exactly the context worth having.
function listForPerson(groupName, personId) {
  return pool
    .query(
      `SELECT ${ROW} FROM tb_concerns
       WHERE group_name = $1 AND person_id = $2
       ORDER BY created_at DESC`,
      [groupName, personId],
    )
    .then((result) => result.rows);
}

function listOpenPairs() {
  return pool
    .query(
      `SELECT DISTINCT person_id, group_name
       FROM tb_concerns
       WHERE status = 'open'
       ORDER BY group_name, person_id`,
    )
    .then((result) => result.rows);
}

module.exports = { create, updateStatus, listGrouped, listForPerson, listOpenPairs };
