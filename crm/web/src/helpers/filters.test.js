import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countFilters } from './filters.js';

/**
 * ***************************************************
 * * A CLEARED FILTER THAT STILL COUNTED
 * ***************************************************
 *
 * Unticking "Active only" on Companies left the badge reading 1 and the
 * Clear button on screen with nothing left to clear.
 *
 * Every toggle clears itself by setting the key to `undefined`, which is
 * deliberate: the filter has to disappear rather than invert, and
 * `toQueryString` omits undefined so the request was always right. But the
 * KEY survives, and two pages counted `Object.keys(...).length`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(here, '..', 'pages');

test('an undefined filter does not count', () => {
  assert.equal(countFilters({ status: undefined }), 0);
  assert.equal(countFilters({ status: 'active' }), 1);
  assert.equal(countFilters({ status: undefined, group: 'INDIGO' }), 1);
});

test('a cleared Select does not count either', () => {
  // "All" writes an empty string rather than removing itself.
  assert.equal(countFilters({ group: '' }), 0);
  assert.equal(countFilters({ group: null }), 0);
  assert.equal(countFilters({}), 0);
  assert.equal(countFilters(undefined), 0);
});

test('NO PAGE COUNTS KEYS, which is what shipped the bug', () => {
  // The two pages that got it right used `.filter(Boolean).length` on an
  // array; the two that got it wrong counted the object's keys. One helper
  // now, so the next filtered page cannot pick the broken half.
  for (const file of fs.readdirSync(PAGES)) {
    if (!file.endsWith('.jsx')) continue;
    const source = fs.readFileSync(path.join(PAGES, file), 'utf8');
    assert.doesNotMatch(
      source,
      /filtersCount=\{Object\.keys\(/,
      `${file} counts filter KEYS, so a cleared filter still counts`,
    );
  }
});

test('EVERY FILTERED PAGE REMEMBERS WHETHER THE PANEL WAS OPEN', () => {
  // The values were sticky and the panel showing them was not, so every
  // reload collapsed the row and you reopened it by hand to reach controls
  // you had just been using.
  //
  // A LITERAL OR A CONST. This read `storageKey="` and failed a page that
  // passes the same name it gives useStickyState, which is the better
  // shape: one definition of the page's key instead of two.
  //
  // A TOOLBAR WITH NO `filters` HAS NO PANEL. The Review page uses the
  // toolbar for its search and its four answer buttons; its tabs are the
  // filter, so there is nothing to open and a storageKey would be a name
  // for a panel that cannot exist.
  const missing = [];
  for (const file of fs.readdirSync(PAGES)) {
    if (!file.endsWith('.jsx')) continue;
    const source = fs.readFileSync(path.join(PAGES, file), 'utf8');
    if (!source.includes('<Toolbar')) continue;
    if (!/filters=\{/.test(source)) continue;
    if (!/storageKey=(?:"|\{)/.test(source)) missing.push(file);
  }
  assert.deepEqual(missing, [], `these forget their filter panel on reload: ${missing.join(', ')}`);
});
