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

// ===============================
// * AND TYPED THE OTHER WAY ROUND. Migration 085.
// ===============================
// Settings now takes what ONE of the currency is worth in dollars, the way
// xe.com prints it (1 GBP = 1.36 USD). That number is stored exactly, in
// `usd_per_unit`, and `per_usd` is worked out from it on save, so every
// reader above keeps dividing by the same column it always has.

const CODE = /^[A-Z]{2,8}$/;

/** `{ GBP: 0.75, AED: 3.6725 }`, units per one dollar. */
async function all() {
  const { rows } = await pool.query(
    'SELECT code, per_usd, usd_per_unit, updated_at, updated_by FROM tb_fx_rates ORDER BY code',
  );
  return rows.map((row) => ({
    code: row.code,
    perUsd: Number(row.per_usd),
    // As typed: 1.36 for GBP. Null only on a row nothing has migrated.
    usdPerUnit: row.usd_per_unit == null ? null : Number(row.usd_per_unit),
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
/**
 * A rate set by hand: what ONE `code` is worth in US dollars (1.36 for GBP).
 * Kept exactly as typed; units per dollar worked out from it, in SQL, so
 * the division is numeric's and not a float's.
 */
async function set(code, usdPerUnit, by = null) {
  const upper = String(code ?? '').trim().toUpperCase();
  if (!CODE.test(upper)) throw new Error(`${code} is not a currency code`);
  const typed = String(usdPerUnit ?? '').trim();
  const value = Number(typed);
  if (!/^\d*\.?\d+$/.test(typed) || !Number.isFinite(value) || value <= 0) throw new Error(`${usdPerUnit} is not a usable rate`);

  const { rows } = await pool.query(
    `INSERT INTO tb_fx_rates (code, usd_per_unit, per_usd, updated_at, updated_by)
          VALUES ($1, $2::numeric, round(1 / $2::numeric, 8), now(), $3)
     ON CONFLICT (code) DO UPDATE
            SET usd_per_unit = EXCLUDED.usd_per_unit,
                per_usd = EXCLUDED.per_usd,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by
      RETURNING code, per_usd, usd_per_unit, updated_at, updated_by`,
    [upper, typed, by],
  );
  const row = rows[0];
  return {
    code: row.code,
    perUsd: Number(row.per_usd),
    usdPerUnit: Number(row.usd_per_unit),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

async function remove(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  const { rowCount } = await pool.query('DELETE FROM tb_fx_rates WHERE code = $1', [upper]);
  return rowCount > 0;
}

// ***************************************************
// * TODAY'S PULLED RATES (migration 085), never the hand set ones
// ***************************************************

/** The day's pulled rates: { perUsd: {code: n}, fetchedAt, asOf, source } or null. */
async function daily() {
  const { rows } = await pool.query('SELECT code, per_usd, source, fetched_at, as_of FROM tb_fx_rates_daily');
  if (!rows.length) return null;
  const perUsd = {};
  for (const r of rows) if (Number(r.per_usd) > 0) perUsd[r.code] = Number(r.per_usd);
  const newest = rows.reduce((a, b) => (a.fetched_at > b.fetched_at ? a : b));
  return { perUsd, fetchedAt: newest.fetched_at, asOf: newest.as_of, source: newest.source };
}

/** Replaces the day's pulled rates, in one transaction. Touches nothing in tb_fx_rates. */
async function saveDaily(perUsdMap, { source, asOf = null }) {
  const entries = Object.entries(perUsdMap)
    .map(([code, n]) => [String(code).toUpperCase(), Number(n)])
    .filter(([code, n]) => CODE.test(code) && Number.isFinite(n) && n > 0);
  if (!entries.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tb_fx_rates_daily (code, per_usd, source, fetched_at, as_of)
       SELECT code, per_usd, $3, now(), $4
         FROM unnest($1::text[], $2::numeric[]) AS t(code, per_usd)
       ON CONFLICT (code) DO UPDATE
         SET per_usd = EXCLUDED.per_usd, source = EXCLUDED.source,
             fetched_at = EXCLUDED.fetched_at, as_of = EXCLUDED.as_of`,
      [entries.map(([c]) => c), entries.map(([, n]) => n), source, asOf],
    );
    await client.query('COMMIT');
    return entries.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { all, perUsd, set, remove, daily, saveDaily };
