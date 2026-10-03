const pool = require('../../configs/db');

// Shared by list/count/deleteWhere/deleteBatch so the four never drift out
// of sync on what "matching" means.
function whereFor({ source, level }) {
  const conditions = [];
  const params = [];
  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }
  if (level) {
    params.push(level);
    conditions.push(`level = $${params.length}`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function create({ source, level, message, detail }) {
  return pool
    .query(
      `INSERT INTO tb_logs (source, level, message, detail)
       VALUES ($1, $2, $3, $4)
       RETURNING id, source, level, message, detail, created_at`,
      [source, level, message, detail ? JSON.stringify(detail) : null],
    )
    .then((result) => result.rows[0]);
}

// Keeps the table self-bounding without a cron — cheap at this scale (1-3
// admins, dev-mode-only capture). Called after every insert.
function prune(keep = 1000) {
  return pool.query('DELETE FROM tb_logs WHERE id <= (SELECT COALESCE(MAX(id), 0) - $1 FROM tb_logs)', [keep]);
}

// Paginated for the Logs page's table, same total-via-window-function
// approach as companies/assignments/concerns.
function list({ source, level, limit = 20, offset = 0 } = {}) {
  const { where, params } = whereFor({ source, level });
  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;
  return pool
    .query(
      `SELECT id, source, level, message, detail, created_at, COUNT(*) OVER()::int AS total_count
       FROM tb_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    )
    .then((result) => ({
      rows: result.rows.map(({ total_count, ...row }) => row),
      total: result.rows[0]?.total_count ?? 0,
    }));
}

// How many logs match the filter, before a "clear logs" run starts — what
// the Logs page's progress bar measures itself against.
function count({ source, level } = {}) {
  const { where, params } = whereFor({ source, level });
  return pool
    .query(`SELECT COUNT(*)::int AS count FROM tb_logs ${where}`, params)
    .then((result) => result.rows[0].count);
}

// Deletes one batch (oldest-first) rather than everything at once, so the
// frontend can report real progress instead of an indeterminate spinner —
// see hooks/useLogs.js's clear(). Called in a loop until nothing's left.
function deleteBatch({ source, level, limit = 200 } = {}) {
  const { where, params } = whereFor({ source, level });
  params.push(limit);
  return pool
    .query(
      `DELETE FROM tb_logs WHERE id IN (
         SELECT id FROM tb_logs ${where} ORDER BY id LIMIT $${params.length}
       )`,
      params,
    )
    .then((result) => result.rowCount);
}

module.exports = { create, prune, list, count, deleteBatch };
