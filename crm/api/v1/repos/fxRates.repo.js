const pool = require('../../configs/db');

// ***************************************************
// * The rates an admin set by hand
// ***************************************************
//
// See migrations/051_manual_fx_rates.sql for why they exist. This is the
// only place that touches the table; `shared/fxRates.helper` is the only
// thing that reads it, so every consumer still asks one question of one
// helper and cannot pick a different rate.
//
// ===============================
// * ONE DIRECTION, ALL THE WAY THROUGH. Migration 065.
// ===============================
// `per_usd` is how many of the currency one dollar buys: 3.6725 for AED.
// It is what the Settings box takes, what a rate site prints, and what
// `toUsd` divides by. This file used to store the inverse and flip it back
// here, which meant a typed rate could not survive the round trip:
// numeric(18, 8) turned 3.75 into 3.74999995 on the way home.

const CODE = /^[A-Z]{2,8}$/;

/** `{ GBP: 0.75, AED: 3.6725 }`, units per one dollar. */
async function all() {
  const { rows } = await pool.query(
    'SELECT code, per_usd, updated_at, updated_by FROM tb_fx_rates ORDER BY code',
  );
  return rows.map((row) => ({
    code: row.code,
    perUsd: Number(row.per_usd),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

/**
 * A rate map in the shape the converter already speaks.
 *
 * NO INVERSION LEFT. The column is units per dollar and so is this, which
 * is the whole of migration 065.
 */
async function perUsd() {
  const out = {};
  for (const rate of await all()) {
    if (rate.perUsd > 0) out[rate.code] = rate.perUsd;
  }
  return out;
}

/**
 * Set one rate. Upsert, because "the euro rate" is one fact and a second
 * row for it would be a second answer.
 */
async function set(code, rate, by = null) {
  const upper = String(code ?? '').trim().toUpperCase();
  if (!CODE.test(upper)) throw new Error(`${code} is not a currency code`);
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${rate} is not a usable rate`);

  const { rows } = await pool.query(
    `INSERT INTO tb_fx_rates (code, per_usd, updated_at, updated_by)
          VALUES ($1, $2, now(), $3)
     ON CONFLICT (code) DO UPDATE
            SET per_usd = EXCLUDED.per_usd,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by
      RETURNING code, per_usd, updated_at, updated_by`,
    [upper, value, by],
  );
  const row = rows[0];
  return {
    code: row.code, perUsd: Number(row.per_usd), updatedAt: row.updated_at, updatedBy: row.updated_by,
  };
}

async function remove(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  const { rowCount } = await pool.query('DELETE FROM tb_fx_rates WHERE code = $1', [upper]);
  return rowCount > 0;
}

module.exports = { all, perUsd, set, remove };
