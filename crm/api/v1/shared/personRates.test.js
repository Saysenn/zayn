const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const { personRatesSql } = require('./personRates.helper');

/**
 * ***************************************************
 * * BOTH LEVELS TRAVEL WITH THE ROW, OR HALF THE RATE IS APPLIED
 * ***************************************************
 *
 * A rate on the PERSON and a rate on the DEAL stack. A reader that fetches
 * only the deal's own applies half of it and says nothing: 5% on the person
 * plus 3% on the row shows as 3%.
 *
 * It has now happened twice. The review queue printed Zayn's raw wage on
 * 2026-09-21, and on 2026-09-24 the person and company detail pages showed
 * the deal's half while the Master Sheet showed the whole. Both times the
 * SQL was written out by hand in one query and missing from another.
 */

const REPOS = [
  // Every query that feeds a surface which rates a figure.
  '../repos/masterSheetRows.repo.js',
  '../repos/monthlyReview.repo.js',
  '../repos/people.repo.js',
  '../repos/companies.repo.js',
];

test('EVERY READER THAT RATES A FIGURE CARRIES BOTH LEVELS', () => {
  for (const file of REPOS) {
    const src = readFileSync(require.resolve(file), 'utf8');
    assert.match(src, /personRatesSql\(/, `${file} must carry the person's own rates`);
  }
});

test('and nobody writes the columns out by hand any more', () => {
  // Two hand written copies is how the third and fourth reader came to be
  // missing them. The helper is the only place this SQL exists.
  for (const file of REPOS) {
    const src = readFileSync(require.resolve(file), 'utf8');
    assert.doesNotMatch(
      src,
      /SELECT p\.(addon|fee)_percent FROM tb_people/,
      `${file} spells the subselect out instead of using the helper`,
    );
  }
});

test('the helper names both columns, against any alias', () => {
  for (const alias of ['tb_mastersheet', 'm', 'd']) {
    const sql = personRatesSql(alias);
    assert.match(sql, /AS person_addon_percent/);
    assert.match(sql, /AS person_fee_percent/);
    // The correlation is what makes it the ROW's person, not any person.
    assert.match(sql, new RegExp(`p\\.person_id = ${alias}\\.person_id`, 'g'));
  }
});

test('an absent profile is 0%, never null', () => {
  // NULL reaching the arithmetic is a rate that silently disappears, and
  // most people have no tb_people row until somebody edits them.
  assert.match(personRatesSql(), /COALESCE\(\(SELECT p\.addon_percent[\s\S]*?, 0\)::float/);
  assert.match(personRatesSql(), /COALESCE\(\(SELECT p\.fee_percent[\s\S]*?, 0\)::float/);
});
