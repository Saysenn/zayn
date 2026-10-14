const pool = require('../../configs/db');

// ***************************************************
// * WHAT DIANE'S CHANGES REPLACED (migration 087)
// ***************************************************
//
// One row per act on the Liquidations page, the flags or the rates: what it
// replaced, so "undo that" can put it back. Only repos touch the database.

async function record(kind, summary, restore, byUser = null) {
  const { rows } = await pool.query(
    'INSERT INTO tb_agent_undo (kind, summary, restore, by_user) VALUES ($1, $2, $3, $4) RETURNING id',
    [kind, summary, JSON.stringify(restore), byUser],
  );
  return rows[0].id;
}

/** The newest act of this kind not yet undone, or null. */
async function latest(kind) {
  const { rows } = await pool.query(
    'SELECT * FROM tb_agent_undo WHERE kind = $1 AND undone_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1',
    [kind],
  );
  return rows[0] ?? null;
}

async function markUndone(id) {
  await pool.query('UPDATE tb_agent_undo SET undone_at = now() WHERE id = $1', [id]);
}

module.exports = { record, latest, markUndone };
