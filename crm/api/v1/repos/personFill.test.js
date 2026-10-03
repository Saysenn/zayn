const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PERSON_FILL_COLUMNS } = require('./masterSheetRows.repo');

/**
 * ***************************************************
 * * WHAT A PERSON'S OTHER DEALS MAY HAND A NEW ONE
 * ***************************************************
 *
 * His call 2026-09-23. The edit form offers to fill its blanks from a deal
 * the same person already holds, live or archived.
 *
 * THIS IS THE SERVER'S HALF OF THE CONTRACT. `crm/web` pins what the form
 * does with whatever it is handed, in
 * `components/forms/copyPersonDetails.test.js`. Neither side reads the
 * other's file: they share none.
 *
 * NO DATABASE. The query is asserted as SQL, the way every other repo
 * shape in this suite is, because what has to hold is which columns it
 * names and which row it picks.
 */

const SRC = fs.readFileSync(path.join(__dirname, 'masterSheetRows.repo.js'), 'utf8');
const BODY = SRC.slice(SRC.indexOf('async function personFill('), SRC.indexOf('function findAllRows('));

test('PERSON FACTS ONLY, and the money is the point of the list', () => {
  assert.deepEqual(PERSON_FILL_COLUMNS, [
    'phone', 'location', 'door_number', 'postcode', 'accepting_postals',
    'bank_details', 'account_number', 'sort_code',
  ]);
  /**
   * 20 of the 28 multi-handler companies pay their handlers different
   * negotiated amounts, so a copied wage is silently wrong on the row
   * nobody re-reads. The dates decide what a month owes and belong to the
   * deal, not the person.
   */
  for (const banned of [
    'monthly_amount', 'payable_amount', 'payable_days', 'payment_start_on',
    'preset_on', 'end_on', 'assigned_on', 'currency', 'payment_method',
    'company', 'group_name', 'role_label', 'person_name',
  ]) {
    assert.ok(!PERSON_FILL_COLUMNS.includes(banned), `${banned} reached the copy`);
  }
});

test('THE ROW BEING EDITED CANNOT FILL ITSELF', () => {
  // On a complete row it would otherwise always be the best donor, and the
  // form would offer to fill nothing.
  assert.match(BODY, /AND \(\$2::int IS NULL OR id <> \$2::int\)/);
});

test('THE DONOR IS THE MOST COMPLETE, then the most recently updated', () => {
  assert.match(BODY, /ORDER BY filled DESC, updated_at DESC NULLS LAST/);
});

test('ONE LIVE AND ONE ARCHIVED, split rather than filtered', () => {
  // Filtered to live deals, somebody whose other deals have all ended
  // would be offered nothing at all, and the archive is the last thing
  // anybody knew about them.
  assert.match(BODY, /PARTITION BY \(stopped_on IS NULL\)/);
  assert.match(BODY, /const pick = \(live\) =>/);
});

test('A ROW WITH NOTHING TO GIVE IS NOT A CANDIDATE', () => {
  assert.match(BODY, /WHERE filled > 0/);
});

test('NO PERSON IS NOT A QUERY', () => {
  // Called with nothing it would count every deal in the table as a
  // candidate. It answers before it asks.
  assert.match(BODY, /if \(!personId\) return \{ live: null, archive: null \}/);
});

test('EVERY COLUMN NAME IN THE SQL COMES FROM THE ALLOW LIST', () => {
  /**
   * A column name interpolated into SQL is never a caller's string. Three
   * things reach this query's template and all three come off the frozen
   * list above:
   *
   *   ${c}                              the loop variable over it
   *   ${PERSON_FILL_COLUMNS.join(...)}  the list itself
   *   ${filled}                         the sum built from ${c}
   *
   * Asserted as the WHOLE SET rather than as a few allowed names, so a
   * fourth one added later fails here instead of passing unnoticed.
   */
  const seen = [...BODY.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(seen)].sort(), [
    '${PERSON_FILL_COLUMNS.join(\', \')}', '${c}', '${filled}',
  ].sort());
  // And `c` is that list and nothing else.
  assert.match(BODY, /PERSON_FILL_COLUMNS\s*\n?\s*\.map\(\(c\) =>/);
});

test('IT HANDS BACK camelCase, through the repo\'s own map', () => {
  // The API speaks camelCase and the form takes it straight. A second
  // mapping here would be a second answer to what a column is called.
  assert.match(BODY, /FIELD_FOR_COLUMN\[c\]/);
});

test('AND IT LEAVES OUT WHAT IT HAS NOTHING FOR', () => {
  // A donor field sent as empty would land in the form as a "fill" that
  // blanks nothing and reads as a value.
  assert.match(BODY, /String\(row\[c\] \?\? ''\)\.trim\(\) !== ''/);
});
