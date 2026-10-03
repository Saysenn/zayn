import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unionOptions } from './optionList.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

// ===============================
// * A UNION, NEVER A REPLACEMENT
// ===============================
// Swapping a hardcoded list out for the derived one costs two things a
// control cannot afford: it is empty while the query is in flight or if it
// fails, and it silently drops any value nobody currently uses.

test('a currency the deals carry is offered, and the seeded ones survive', () => {
  assert.deepEqual(
    unionOptions(['GBP', 'PHP'], ['GBP', 'AED', 'EURO', 'USD']),
    ['GBP', 'PHP', 'AED', 'EURO', 'USD'],
  );
});

test('nothing is lost when the derived list has not arrived', () => {
  const seeded = ['GBP', 'AED', 'EURO', 'USD'];
  for (const missing of [undefined, null, []]) {
    assert.deepEqual(unionOptions(missing, seeded), seeded, `derived ${JSON.stringify(missing)}`);
  }
});

test('a field with only one of the two is unchanged', () => {
  assert.deepEqual(unionOptions(['INDIGO', 'MILKMAN'], undefined), ['INDIGO', 'MILKMAN']);
  assert.deepEqual(unionOptions([], ['bank', 'cash']), ['bank', 'cash']);
  assert.deepEqual(unionOptions(undefined, undefined), []);
});

test('a value is never listed twice', () => {
  assert.deepEqual(unionOptions(['GBP', 'GBP'], ['GBP']), ['GBP']);
});

// ===============================
// * THE TWO CONTROLS THAT CREATE A CURRENCY READ THE DATA
// ===============================
// The row editor and the master sheet cell are where a human CHOOSES a
// currency, and the upload diff is where one is set for rows whose column
// the file did not carry. All three offered a fixed list, so a currency
// already on the sheet was not among the things the CRM said existed.
test('both currency pickers union the derived list over the seeded one', () => {
  const sheet = read('pages/MasterSheetPage.jsx');
  const modal = read('components/import/ImportDiffModal.jsx');

  // The row editor, through the generic option builder.
  assert.match(sheet, /options=\{unionOptions\(field\.from \? options\?\.\[field\.from\] : \[\], field\.suggest\)\}/);
  assert.match(sheet, /key: 'currency'[^}]*from: 'currencies', suggest: CURRENCIES, custom: true/);
  // The inline cell.
  assert.match(sheet, /suggestions=\{unionOptions\(options\?\.currencies, CURRENCIES\)\}/);
  // The upload diff's fill, alongside the groups that already read the data.
  assert.match(modal, /function fillOptionsFor\(column\)/);
  assert.match(modal, /if \(column === 'group_name'\) return preview\.knownGroups \?\? \[\]/);
  assert.match(modal, /if \(column === 'currency'\) return unionOptions\(filterOptions\?\.currencies, FILL_OPTIONS\.currency\)/);
  assert.match(modal, /const \{ data: filterOptions \} = usePeopleFilters\(\)/);

  // AND THE SEEDED LISTS STAY. They are the floor when the query has not
  // answered; deleting them is what would empty the control.
  assert.match(sheet, /const CURRENCIES = \['GBP', 'AED', 'EURO', 'USD'\]/);
  assert.match(modal, /currency: \['GBP', 'AED', 'EURO'\]/);
});

// The sentence that makes somebody conclude a new currency is impossible.
test('nothing in the master sheet claims currencies are a closed set', () => {
  const sheet = read('pages/MasterSheetPage.jsx');

  assert.doesNotMatch(sheet, /PAYMENT_METHODS and CURRENCIES[\s\S]{0,120}closed sets/);
  assert.match(sheet, /CURRENCIES IS NOT/);
  assert.match(sheet, /A FLOOR, NOT A WHITELIST/);
});
