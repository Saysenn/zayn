const settingsRepo = require('../repos/settings.repo');
const peopleRepo = require('../repos/people.repo');
const { withRates } = require('../shared/rates.helper');
const { rowsFor, monthValue } = require('./exportQuery');
const {
  SHEET_PRESETS, MASTER_SHEET_COLUMNS, pickColumns, toRow, byCompany, sortGroupNames, totalsByCurrency,
} = require('./buildWorkbook');

// ***************************************************
// * A SHEET PRESET AS PLAIN ROWS, FOR A PICTURE
// ***************************************************
//
// His call 2026-10-07: "who's paid by cash" as a picture that matches the
// export's Cash file, column for column. So this reads exactly what the
// export reads: the same rows (rowsFor), the same rates (withRates, with
// the crypto charge), the same value map (toRow), the same columns in the
// same order (pickColumns), the same group then company order, and the same
// totals (totalsByCurrency). Nothing here writes a file.
//
// Standard, Bank, Cash and Crypto only: All is too wide for a phone (his
// call). Bank includes the bank details: this CRM is local (his call).

const PICTURE_PRESETS = ['standard', 'bank', 'cash', 'crypto'];

const DATE = /^\d{4}-\d{2}-\d{2}/;
function shown(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return DATE.test(String(v)) ? String(v).slice(0, 10) : String(v);
}

/**
 * @param {'standard'|'bank'|'cash'|'crypto'} id
 * @param {{ group?: string, month?: string }} scope
 * @returns {Promise<{ preset, columns: {key, header}[], groups: {name, rows: string[][]}[], totals: Map, count: number }>}
 */
async function presetTable(id, { group, month: asked = 'current' } = {}) {
  // this month's file unless they named another, as the export does
  const month = monthValue(asked);
  const preset = SHEET_PRESETS.find((p) => p.id === id);
  if (!preset || !PICTURE_PRESETS.includes(id)) throw new Error(`no picture for the ${id} preset`);
  const [{ rows: raw }, rates, cryptoPercent] = await Promise.all([
    rowsFor({ method: preset.method, group, month: asked, preset: 'expensing' }),
    peopleRepo.rateMap(),
    settingsRepo.cryptoPercent(),
  ]);
  const rows = raw.map((r) => withRates(r, rates, { cryptoPercent }));
  const columns = pickColumns(MASTER_SHEET_COLUMNS, preset.columns).map((c) => ({ key: c.key, header: c.header }));
  const byGroup = new Map();
  for (const r of rows) {
    const key = r.group_name || 'UNKNOWN';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(r);
  }
  const groups = sortGroupNames(byGroup.keys()).map((name) => ({
    name,
    rows: byCompany(byGroup.get(name)).flat().map((r) => {
      const v = { group_name: r.group_name, ...toRow(r) };
      return columns.map((c) => shown(v[c.key]));
    }),
    totals: totalsByCurrency(byGroup.get(name), { month }),
  }));
  return {
    preset, month, columns, groups, totals: totalsByCurrency(rows, { month }), count: rows.length,
    // which deals it holds, so a list of the very same deals can be drawn as this sheet
    ids: rows.map((r) => r.id),
  };
}

module.exports = { presetTable, PICTURE_PRESETS };
