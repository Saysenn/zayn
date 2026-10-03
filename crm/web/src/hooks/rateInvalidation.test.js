import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * A rate edited on a person changes the master sheet
 * ***************************************************
 *
 * THE BUG. Setting an add on or a fee on the person page left the master
 * sheet's stacking warning stale until a hard refresh: every deal row
 * carries the person's two rates so the cell can warn that the levels add
 * up, and nothing told that page anything had happened.
 *
 * Read as TEXT: these hooks pull in React and the query client, and what
 * is pinned is the wiring, not the component.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (name) => fs.readFileSync(path.join(here, name), 'utf8');

test('alsoInvalidate accepts a FUNCTION of what was edited', () => {
  // An array would invalidate the whole master sheet on every notes
  // keystroke: a refetch nobody asked for, on the largest query there is.
  const s = src('useOptimisticUpdate.js');
  assert.match(s, /typeof alsoInvalidate === 'function' \? alsoInvalidate\(variables\) : alsoInvalidate/);
  assert.match(s, /\(keys \?\? \[\]\)\.forEach/, 'a function returning nothing must not throw');
});

test('a RATE edit invalidates the master sheet, an ordinary field does not', () => {
  const s = src('usePeople.js');
  const block = s.slice(s.indexOf('export function useUpdatePerson'));

  assert.match(block, /alsoInvalidate: \(\{ fields \}\)/, 'it must depend on the fields');
  assert.match(block, /fields\?\.addonPercent !== undefined \|\| fields\?\.feePercent !== undefined/);
  assert.match(block, /\['master-sheet'\]/, 'the page holding the stale warning');
  // `!== undefined`, never a truthy check: setting a rate back to 0 is an
  // edit, and 0 is falsy.
  assert.ok(!/fields\?\.addonPercent \|\| fields\?\.feePercent/.test(block), 'zero is a real value');
});

test('the non-rate branch still invalidates people, and nothing more', () => {
  const s = src('usePeople.js');
  const block = s.slice(s.indexOf('export function useUpdatePerson'));
  const tail = block.slice(block.indexOf('alsoInvalidate'), block.indexOf('});'));
  const branches = tail.split(':').pop();
  assert.match(branches, /\[\['people'\]\]/);
  assert.ok(!branches.includes('master-sheet'), 'an email change must not refetch the sheet');
});

test('every other caller still passes an ARRAY, which must keep working', () => {
  for (const file of ['useCompanies.js', 'useMasterSheet.js']) {
    const s = src(file);
    for (const m of s.matchAll(/alsoInvalidate:\s*([^\n]+)/g)) {
      assert.match(m[1].trim(), /^\[/, `${file}: ${m[1]}`);
    }
  }
});

test('the master sheet listens for the broadcast that follows', () => {
  // The hook covers the tab that made the edit. The socket covers every
  // other tab and anyone else signed in, which is the other half of "real
  // time" and the half a cache invalidation cannot reach.
  assert.match(src('useMasterSheet.js'), /useSocketEvent\('master-sheet:changed'/);
});
// The temporal dead zone scan moved to helpers/renderSafety.test.js: it
// covers every component now, not this one file.

/**
 * ***************************************************
 * * A STATUS CHANGE MOVES THE MONTHLY REVIEW QUEUE
 * ***************************************************
 *
 * THE BUG, reported 2026-09-21 on A J Rayson. Putting a company into
 * liquidation puts every live deal on it into the monthly review, by status
 * alone, with no deal row changing. Nothing invalidated the review, so the
 * Master Sheet's Review button kept its old count until a hard refresh.
 *
 * The key is IMPORTED, never typed out again: a second array here would
 * still be right on the day it was written.
 */
test('a company write invalidates the monthly review', () => {
  const s = src('useCompanies.js');
  assert.match(s, /import \{ REVIEW_KEY \} from '\.\/useMonthlyReview'/);

  const block = s.slice(s.indexOf('export function useUpdateCompany'));
  assert.match(block, /alsoInvalidate: \[[\s\S]*?REVIEW_KEY[\s\S]*?\]/);
});

test('and the review hook exports that key rather than hiding it', () => {
  const s = src('useMonthlyReview.js');
  assert.match(s, /export const REVIEW_KEY = \['monthly-review'\]/);
  // The pending badge hangs off the same prefix, so invalidating the key
  // reaches it too.
  assert.match(s, /queryKey: \[\.\.\.KEY, 'pending'\]/);
});
