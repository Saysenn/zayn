import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH_FIELDS, SEARCH_ANY, searchPlaceholder } from './searchFields.js';

/**
 * ***************************************************
 * * The dropdown, on its own side of the wall
 * ***************************************************
 *
 * THIS TEST USED TO READ crm/api. It built a path into
 * `api/v1/repos/masterSheetRows.repo.js` and matched its `SEARCH_COLUMNS`
 * out of the source, to prove the two lists agreed.
 *
 * That is a leak. The two are SEPARATELY DEPLOYED: a web test that fails
 * because a file in the api folder moved is a build coupled to a codebase
 * it does not ship with, and on a machine holding only one of them the
 * check would either crash or quietly prove nothing.
 *
 * So the shared fact is written down HERE, as the contract the API is
 * expected to honour, and the API pins its own half in
 * `masterSheet/searchField.test.js` ("every offered field maps to a real
 * column"). Two tests, one on each side, neither reaching across.
 */

/**
 * WHAT THE API PROMISES TO SEARCH. Mirrors `SEARCH_COLUMNS` in
 * masterSheetRows.repo.js. An unknown key there falls back to searching
 * everything rather than erroring, so drift degrades the answer silently:
 * picking Postcode would quietly return name and company matches too.
 */
const CONTRACT = [
  'location', 'postcode', 'bankDetails', 'accountNumber', 'sortCode', 'notes', 'doorNumber',
];

const named = SEARCH_FIELDS.filter((f) => f.value !== SEARCH_ANY);

test('every field the dropdown offers is one the API promises to search', () => {
  assert.ok(named.length > 0, 'the dropdown must offer something');
  for (const f of named) {
    assert.ok(CONTRACT.includes(f.value), `"${f.value}" is offered but not in the contract`);
  }
});

test('the dropdown offers everything the contract allows', () => {
  // The other direction, so a column the API can search is not left
  // unreachable because nobody added it to the picker.
  for (const key of CONTRACT) {
    assert.ok(named.some((f) => f.value === key), `"${key}" is searchable but not offered`);
  }
});

test('Anything is first and is the empty value', () => {
  // The default, so nobody's existing habit breaks, and an empty value is
  // what makes `searchField || undefined` drop the param entirely.
  assert.equal(SEARCH_ANY, '');
  assert.equal(SEARCH_FIELDS[0].value, SEARCH_ANY);
  assert.equal(SEARCH_FIELDS[0].label, 'Anything');
});

test('every option carries its own placeholder', () => {
  // Missing one would show the previous field's, which is a label that
  // lies about what the box is pointed at.
  for (const f of SEARCH_FIELDS) {
    assert.ok(f.placeholder && f.placeholder.trim(), `${f.label} needs a placeholder`);
    assert.equal(searchPlaceholder(f.value), f.placeholder);
  }
});

test('an unknown field falls back to the Anything placeholder', () => {
  assert.equal(searchPlaceholder('nonsense'), SEARCH_FIELDS[0].placeholder);
});

test('nothing already reachable by a filter is offered twice', () => {
  // Group, payment period, preset month and the three amounts have controls
  // in the panel. A second way to ask one question is two to keep in step.
  const filtered = ['group', 'status', 'presetWhen', 'monthlyAmount', 'payableAmount', 'payableDays'];
  const offered = new Set(named.map((f) => f.value));
  for (const key of filtered) {
    assert.ok(!offered.has(key), `"${key}" is already a filter`);
  }
});

test('no two options share a value or a label', () => {
  assert.equal(new Set(SEARCH_FIELDS.map((f) => f.value)).size, SEARCH_FIELDS.length);
  assert.equal(new Set(SEARCH_FIELDS.map((f) => f.label)).size, SEARCH_FIELDS.length);
});
