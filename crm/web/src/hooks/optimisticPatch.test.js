import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// THE REAL ONE, not a restatement. It was copied out into this file so the
// mapping could be exercised without loading React, which meant breaking
// either hook's own copy left this green.
import { patchRow } from '../helpers/patchRow.js';

/**
 * ***************************************************
 * * The API is camelCase, the cache is snake_case
 * ***************************************************
 *
 * A cached row came out of Postgres, so it says `old_group` and
 * `fee_percent`; the PATCH body is camelCase. `{ ...row, ...fields }` then
 * writes a key nothing renders and leaves the visible one stale, so an
 * optimistic edit LOOKS like it failed and corrects itself on the refetch.
 *
 * The MAPS are read as text, because these hooks pull in React and the
 * query client. The FUNCTION is imported for real.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (name) => fs.readFileSync(path.join(here, name), 'utf8');

/** The COLUMN_FOR map a hook file declares. */
function columnMap(file) {
  const m = src(file).match(/const COLUMN_FOR = \{([^}]*)\}/);
  assert.ok(m, `${file} must declare COLUMN_FOR`);
  return Object.fromEntries(
    [...m[1].matchAll(/(\w+):\s*'([^']+)'/g)].map((x) => [x[1], x[2]]),
  );
}

test('a camelCase field lands on its snake_case column, not beside it', () => {
  const map = columnMap('useCompanies.js');
  const row = { name: 'Reliapay', tier: 'TBC', old_group: 'Milky' };
  const out = patchRow(row, { oldGroup: 'Wallaby 1' }, map);

  assert.equal(out.old_group, 'Wallaby 1', 'the rendered key must change');
  assert.ok(!('oldGroup' in out), 'and no shadow key may appear');
});

test('a field already spelled the same is passed straight through', () => {
  const map = columnMap('useCompanies.js');
  const out = patchRow({ tier: 'TBC' }, { tier: 'T2' }, map);
  assert.equal(out.tier, 'T2');
});

test("the person hook maps every field its own page sends", () => {
  const map = columnMap('usePeople.js');
  const row = { display_name: 'Drew', fee_percent: 0, email: '', notes: '' };
  const out = patchRow(row, {
    displayName: 'Drew Smith', feePercent: 12, email: 'a@b.c', notes: 'hi',
  }, map);

  assert.equal(out.display_name, 'Drew Smith');
  assert.equal(out.fee_percent, 12);
  assert.equal(out.email, 'a@b.c');
  assert.equal(out.notes, 'hi');
  for (const shadow of ['displayName', 'feePercent']) {
    assert.ok(!(shadow in out), `${shadow} must not survive as its own key`);
  }
});

test('the profile and company writes are optimistic, not plain reporting', () => {
  // Left as reporting mutations, every inline field edit on the two detail
  // pages sat unchanged until the refetch landed.
  //
  // THE BODY, NOT THE FIRST LINE. It required `return useOptimisticUpdate`
  // adjacent to the brace, so reading the settings before returning looked
  // like a regression. What matters is which hook it ends up calling.
  for (const [file, name] of [
    ['usePeople.js', 'useUpdatePerson'],
    ['useCompanies.js', 'useUpdateCompany'],
  ]) {
    const body = new RegExp(`export function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src(file))?.[1] ?? '';
    assert.match(body, /return useOptimisticUpdate\(/, `${name} must be optimistic`);
    assert.doesNotMatch(body, /useReportingMutation\(/, `${name} went back to reporting`);
  }
});

test('there is ONE hook for a person update, not a second for one field', () => {
  // useSetFeePercent did the same PATCH as useUpdatePerson. Two hooks for
  // one job is the failure; the moment the general one became optimistic
  // the special one had no reason left to exist.
  assert.ok(!src('usePeople.js').includes('useSetFeePercent'));
});
