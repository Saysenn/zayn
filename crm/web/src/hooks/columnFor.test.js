import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: the page's editable columns and the cache's map agree
 * ***************************************************
 *
 * TWO MAPS, ONE FACT, AND THEY DRIFTED TWICE.
 *
 *   MasterSheetPage's EDITABLE   column -> [field, label]   what a cell sends
 *   useMasterSheet's COLUMN_FOR  field  -> column           what the patch writes
 *
 * The API is camelCase and the cache is snake_case, so an optimistic patch
 * has to translate. A field missing from COLUMN_FOR falls through as its own
 * name, and `{ ...row, addonPercent: 3 }` lands beside an untouched
 * `addon_percent`. The row keeps rendering its old value while the toast
 * says the write succeeded, which is the exact lag the optimistic path
 * exists to remove.
 *
 * It happened to the two payment toggles, and then to the two rates, where
 * it also froze the MONEY: the figure is computed from them.
 *
 * PLAIN string work, never a built regex. A previous guard in this codebase
 * escaped \b into a literal backspace and passed against a broken file.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, ...p), 'utf8');

/** `{ field: column }` from the hook's COLUMN_FOR literal. */
function cacheMap() {
  const src = read('useMasterSheet.js');
  const from = src.indexOf('const COLUMN_FOR = {');
  const to = src.indexOf('\n};', from);
  assert.ok(from > 0 && to > from, 'COLUMN_FOR must be findable');
  return Object.fromEntries(
    [...src.slice(from, to).matchAll(/(\w+):\s*'([\w]+)'/g)].map((m) => [m[1], m[2]]),
  );
}

/** `{ column: field }` from the page's EDITABLE literal. */
function pageMap() {
  const src = read('..', 'pages', 'MasterSheetPage.jsx');
  const from = src.indexOf('const EDITABLE = {');
  const to = src.indexOf('\n};', from);
  assert.ok(from > 0 && to > from, 'EDITABLE must be findable');
  return Object.fromEntries(
    [...src.slice(from, to).matchAll(/(\w+):\s*\['(\w+)'/g)].map((m) => [m[1], m[2]]),
  );
}

test('every editable column has a matching cache mapping, both ways', () => {
  const cache = cacheMap();
  const page = pageMap();
  const columns = Object.keys(page);
  assert.ok(columns.length >= 15, `expected the page's whole column list, saw ${columns.length}`);

  for (const [column, field] of Object.entries(page)) {
    assert.ok(
      cache[field] !== undefined,
      `the page can edit "${column}" as "${field}", but COLUMN_FOR has no entry for it: `
      + 'the optimistic patch will write a key the row never reads',
    );
    assert.equal(
      cache[field], column,
      `"${field}" maps to "${cache[field]}" in the cache but the page edits "${column}"`,
    );
  }
});

test('the two rates in particular, because the money is computed from them', () => {
  const cache = cacheMap();
  assert.equal(cache.addonPercent, 'addon_percent');
  assert.equal(cache.feePercent, 'fee_percent');
});

test('and nothing is mapped that the page cannot edit, so the map cannot rot', () => {
  // The mirror image. A COLUMN_FOR entry with no editable column is either
  // a field that moved and left its mapping behind, or a typo nobody will
  // ever see fail: the patch simply never uses it.
  const cache = cacheMap();
  // KEYS, not values: pageMap is keyed BY COLUMN. Reading the values gave
  // the field names and flagged all twenty mappings as orphans.
  const columns = new Set(Object.keys(pageMap()));
  // Set by a hook rather than a cell: the two payment switches, the payday
  // outcome whatbot mirrors in, and the review flag the parser writes.
  const NOT_A_CELL = new Set([
    // Set by a switch or a hook rather than by editing a cell.
    'override_should_be_paid', 'override_paid', 'payment_outcome',
    'needs_review', 'status',
    // The special case switch, migration 064. It lives in the payment
    // start cell's own notice panel, not in a column: ninety one rows out
    // of ninety two would carry a control that says the same thing.
    'special_case_deal',
    // THE SHEET'S OWN FREE TEXT, and the page writes neither. Whatever the
    // boss typed arrives on import and stays; the admin's answer goes to
    // the two override columns above, which is why those are the switches.
    'should_be_paid', 'paid',
  ]);
  const orphans = Object.entries(cache)
    .filter(([, column]) => !columns.has(column) && !NOT_A_CELL.has(column))
    .map(([field]) => field);
  assert.deepEqual(orphans, [], `mapped but not editable: ${orphans.join(', ')}`);
});
