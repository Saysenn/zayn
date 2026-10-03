import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { paymentPeriodOf } from '../helpers/paymentPeriod.js';

/**
 * ***************************************************
 * * One row, three caches
 * ***************************************************
 *
 * The master sheet holds `{ rows }`; a person holds `{ person: { deals } }`
 * and a company `{ company: { deals } }`. All three are the SAME deal.
 *
 * The optimistic patch reached only the first, so every inline cell on the
 * Person and Company pages sat unchanged until the socket refetch landed
 * and read as an edit that had failed.
 *
 * The hook itself needs React, so what is exercised here is the reshaping
 * and the derived fields; the wiring is asserted against the source.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, f), 'utf8');

// The same three shapes, rebuilt so the mapping can run without React.
const editedDeal = (row, fields) => {
  const next = { ...row, ...fields };
  return { ...next, payment_period: paymentPeriodOf(next) };
};
function patchDeal(old, id, fields) {
  if (Array.isArray(old?.rows)) {
    return { ...old, rows: old.rows.map((r) => (r.id === id ? editedDeal(r, fields) : r)) };
  }
  for (const side of ['person', 'company']) {
    if (Array.isArray(old?.[side]?.deals)) {
      return {
        ...old,
        [side]: {
          ...old[side],
          deals: old[side].deals.map((d) => (d.id === id ? editedDeal(d, fields) : d)),
        },
      };
    }
  }
  return old;
}

// NOT OWED is a payment start after the preset month, which holds whether
// or not the end-date setting is on. An end date alone no longer ends
// anything, so a fixture built on one would prove nothing.
const deal = (over) => ({
  id: 1, payment_start_on: '2026-10-01', preset_on: '2026-08-01', end_on: null,
  payment_period: 'ended', ...over,
});

test('the master sheet shape is patched', () => {
  const out = patchDeal({ rows: [deal()], total: 1 }, 1, { payment_start_on: '2025-04-01' });
  assert.equal(out.rows[0].payment_period, 'active');
  assert.equal(out.total, 1, 'the rest of the payload survives');
});

test("a person's deals are patched, and the person's own fields survive", () => {
  const old = { person: { person_id: 'nicola', display_name: 'Nicola', deals: [deal()] } };
  const out = patchDeal(old, 1, { payment_start_on: '2025-04-01' });
  assert.equal(out.person.deals[0].payment_period, 'active');
  assert.equal(out.person.display_name, 'Nicola');
});

test("a company's deals are patched the same way", () => {
  const old = { company: { name: 'Workforce', deals: [deal()] } };
  const out = patchDeal(old, 1, { payment_start_on: '2025-04-01' });
  assert.equal(out.company.deals[0].payment_period, 'active');
  assert.equal(out.company.name, 'Workforce');
});

test('only the edited row moves', () => {
  const old = { rows: [deal({ id: 1 }), deal({ id: 2 })] };
  const out = patchDeal(old, 1, { payment_start_on: '2025-04-01' });
  assert.equal(out.rows[0].payment_period, 'active');
  assert.equal(out.rows[1].payment_period, 'ended', 'row 2 was not edited');
});

test('an unrecognised shape is returned untouched', () => {
  // setQueriesData runs this over every query under the three prefixes,
  // including ones that hold something else entirely.
  const other = { tiers: ['T2'], oldGroups: [] };
  assert.equal(patchDeal(other, 1, { payment_start_on: '2025-04-01' }), other);
  assert.equal(patchDeal(undefined, 1, {}), undefined);
  assert.equal(patchDeal(null, 1, {}), null);
});

test('the cell edit really is wired to all three caches', () => {
  const s = src('useMasterSheet.js');
  assert.match(s, /queryKey: \[KEY, \['person'\], \['company'\]\]/);
  // The SUBSTANCE, not the exact line. This matched one literal
  // expression, so `applyToCache` gaining a block body (to record what the
  // appointment cascade declined to overwrite) failed a test about caches
  // for a reason that had nothing to do with caches.
  const apply = s.match(/applyToCache: [\s\S]*?\n {4}\},?\n/)[0];
  assert.match(apply, /patchDeal\(/, 'the patch has to go through the one shared shaper');
  assert.match(apply, /useEndDate/, 'and the setting has to reach it');
  // The setting has to reach the recompute, or the badge this patch writes
  // disagrees with the one the server derives.
  assert.match(s, /const useEndDate = Boolean\(settings\?\.colorUsesEndDate\)/);
});

test('the hook accepts a LIST of keys, not just one', () => {
  const s = src('useOptimisticUpdate.js');
  // Discriminated by the first element being an array, so a single key
  // still works unchanged for every other caller.
  assert.match(s, /Array\.isArray\(queryKey\?\.\[0\]\) \? queryKey : \[queryKey\]/);
  // And every one of the four places must loop, or a cache is patched and
  // never rolled back, or snapshotted and never restored.
  for (const call of ['cancelQueries', 'getQueriesData', 'setQueriesData', 'invalidateQueries']) {
    assert.match(s, new RegExp(`${call}\\(\\{ queryKey: k`), `${call} must use the loop`);
  }
});
