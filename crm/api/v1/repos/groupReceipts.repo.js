const pool = require('../../configs/db');

// Every receipt on file, optionally scoped to one group — the Companies
// page only ever needs "this group's history", not a global list.
function findAll({ groupName } = {}) {
  const conditions = [];
  const params = [];
  if (groupName) {
    params.push(groupName);
    conditions.push(`group_name = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return pool
    .query(
      `SELECT group_name, period, currency, amount, received_at, note, updated_at
       FROM tb_group_receipts
       ${where}
       ORDER BY period DESC, currency`,
      params,
    )
    .then((result) => result.rows);
}

// One row per (group, period, currency) — acknowledging a group's payment
// in. `received_at` is set explicitly by the caller (not derived like
// calculator_overrides.paid_at) because this is a real-world event with
// its own date, not just "the moment someone ticked a box" — a group's
// payment might be acknowledged in the CRM days after it actually arrived.
function upsert({ groupName, period, currency, amount, receivedAt, note }) {
  return pool
    .query(
      `INSERT INTO tb_group_receipts (group_name, period, currency, amount, received_at, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (group_name, period, currency) DO UPDATE SET
         amount = EXCLUDED.amount,
         received_at = EXCLUDED.received_at,
         note = EXCLUDED.note,
         updated_at = now()
       RETURNING group_name, period, currency, amount, received_at, note, updated_at`,
      [groupName, period, currency, amount ?? null, receivedAt ?? null, note ?? null],
    )
    .then((result) => result.rows[0]);
}

module.exports = { findAll, upsert };
