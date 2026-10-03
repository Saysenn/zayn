const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseMasterSheetImport } = require('./parseImport');
const { diffCompanies } = require('./diffCompanies');

/**
 * ***************************************************
 * * The Active company list, end to end
 * ***************************************************
 *
 * Against his own files, because every rule here came off one of them:
 * the duplicate row, the Old group column, and the tier values no closed
 * list would have accepted.
 */

const REFS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'boss', 'references');
const read = (name) => fs.promises.readFile(path.join(REFS, name));
const parse = async (name) => parseMasterSheetImport(await read(name), {
  filename: name, knownGroups: ['INDIGO', 'MILKMAN', 'NEXUS', 'MANBAT', 'ALL BOOKS'],
});

test('a company listed twice in one file is ONE row carrying both tiers', async () => {
  // "im certain theyre always like one row per comapny" — indigo 1 august
  // lists "Social work partners PR" twice, T2 under one director and TBC
  // under another. One row in tb_companies, so one row here, flagged.
  const { companies } = await parse('indigo 1 august.xlsx');
  const dupes = companies.filter((c) => /social work partners/i.test(c.company));
  assert.equal(dupes.length, 1, 'one row per company, whatever the file did');
  assert.deepEqual(dupes[0].conflict, ['T2', 'TBC']);
});

test('a conflicted row is flagged and starts with NO tier chosen', async () => {
  const { companies } = await parse('indigo 1 august.xlsx');
  const { rows } = diffCompanies(companies, []);
  const row = rows.find((r) => /social work partners/i.test(r.company));
  assert.equal(row.state, 'flagged');
  assert.equal(row.reason, 'two tiers in this file');
  // Both offered, so the tab can refuse to preselect either.
  assert.deepEqual(row.tierOptions, ['T2', 'TBC']);
});

test('the Old group column is read, and is never one of our groups', async () => {
  // His own earlier naming: Milky, Wallaby 1, V3, NA. Only milkman carries
  // the column at all.
  const { companies } = await parse('milkman august.xlsx');
  const byName = new Map(companies.map((c) => [c.company, c]));
  assert.equal(byName.get('Reliapay').oldGroup, 'Wallaby 1');
  assert.equal(byName.get('Monument marketing').oldGroup, 'V3');
  assert.equal(byName.get('Yellowstone Associates').oldGroup, 'Milky');

  const { oldGroups } = diffCompanies(companies, []);
  assert.deepEqual(oldGroups, ['Milky', 'NA', 'V3', 'Wallaby 1']);
  for (const g of oldGroups) {
    assert.ok(!['INDIGO', 'MILKMAN', 'NEXUS', 'MANBAT', 'ALL BOOKS'].includes(g.toUpperCase()));
  }
});

test('a file with no Old group column reports none, and can never clear one', async () => {
  // ABSENT COLUMN IS NOT AN EMPTY CELL, the same rule importColumns follows.
  const { companies } = await parse('indigo 1 august.xlsx');
  assert.ok(companies.every((c) => c.oldGroup === ''));

  const existing = [{ company_id: 1, name: 'Gab', tier: 'Visa co', old_group: 'Milky' }];
  const { rows } = diffCompanies(companies, existing);
  const gab = rows.find((r) => r.company === 'Gab');
  assert.equal(gab.state, 'unchanged', 'the file says nothing about the old group');
  assert.equal(gab.currentOldGroup, 'Milky');
});

test('every company in the file gets a row, not only the actionable ones', async () => {
  // The tab used to hide unchanged rows, so a name you wanted to correct
  // was only reachable if the diff had already called it a problem.
  const { companies } = await parse('milkman august.xlsx');
  const existing = companies.map((c, i) => ({
    company_id: i + 1, name: c.company, tier: c.tier, old_group: c.oldGroup,
  }));
  const diff = diffCompanies(companies, existing);
  assert.equal(diff.rows.length, companies.length);
  assert.equal(diff.actionable, 0, 'nothing to do');
  assert.equal(diff.unchanged.length, companies.length);
});

test('a near-miss is flagged with the held name offered, never created', async () => {
  const { companies } = await parse('indigo 1 august.xlsx');
  const existing = [{ company_id: 1, name: 'Umbrella company uk holdings', tier: null, old_group: null }];
  const { rows } = diffCompanies(companies, existing);
  const row = rows.find((r) => r.company === 'Umbrella Co UK');
  assert.equal(row.state, 'flagged');
  assert.equal(row.reason, 'looks like a company we already have');
  assert.ok(row.nameOptions.includes('Umbrella company uk holdings'));
});

test('a punctuation variant matches in place rather than becoming a new company', async () => {
  const parsed = [{ company: 'Relia PA', tier: 'TBC', oldGroup: '', conflict: null }];
  const existing = [{ company_id: 7, name: 'Relia Pa.', tier: 'TBC', old_group: null }];
  const { rows } = diffCompanies(parsed, existing);
  assert.equal(rows[0].state, 'unchanged');
  assert.equal(rows[0].matchedName, 'Relia Pa.', 'it writes to the company we hold');
  assert.equal(rows[0].companyId, 7);
});

test('the pickers offer what the sheet writes, suggestions and not a whitelist', async () => {
  const { companies } = await parse('milkman august.xlsx');
  const existing = [{ company_id: 1, name: 'Souracore', tier: 'Top co', old_group: 'Legacy' }];
  const diff = diffCompanies(companies, existing);
  // His real values, none of which a closed set of two would have allowed.
  for (const t of ['T2 for Reliapay', 'T1 with capilano', 'In prep', 'Provider', 'TBC']) {
    assert.ok(diff.tierSuggestions.includes(t), `${t} should be offered`);
  }
  assert.ok(diff.tierSuggestions.includes('Top co'), 'and what the CRM already holds');
  assert.ok(diff.oldGroupSuggestions.includes('Legacy'));
  assert.deepEqual(diff.companyNames, ['Souracore']);
});

/**
 * ===============================
 * * A COMPANY NAME IS NEVER A TIER
 * ===============================
 * The flagged row's single "Pick one" dropdown was fed near-matching
 * COMPANY NAMES and its onChange wrote the TIER, so answering "which
 * company is this?" stored the company's name as its kind. Migration 045
 * clears what it wrote; these keep the two apart.
 */
test('the two pickers never share a source', async () => {
  const { companies } = await parse('indigo 1 august.xlsx');
  const existing = [
    { company_id: 1, name: 'Umbrella company uk holdings', tier: null, old_group: null },
    { company_id: 2, name: 'Churchill knight emplyment', tier: null, old_group: null },
  ];
  const { rows, tierSuggestions } = diffCompanies(companies, existing);

  // The near-miss names go to the NAME picker.
  const near = rows.find((r) => r.company === 'Umbrella Co UK');
  assert.ok(near.nameOptions.includes('Umbrella company uk holdings'));
  // And never to the tier picker: tierOptions is only ever a conflict.
  assert.equal(near.tierOptions, null);

  // No company name may reach the tier suggestions either.
  for (const name of existing.map((c) => c.name)) {
    assert.ok(!tierSuggestions.includes(name), `${name} must not be offered as a tier`);
  }
});

test('only a conflict ever fills tierOptions, and only with tiers', async () => {
  const { companies } = await parse('indigo 1 august.xlsx');
  const { rows } = diffCompanies(companies, []);
  const names = new Set(rows.map((r) => r.company));
  for (const row of rows) {
    for (const t of row.tierOptions ?? []) {
      assert.ok(!names.has(t), `"${t}" is a company name, not a tier`);
    }
  }
});

test('a changed old group counts as a change on its own', async () => {
  const parsed = [{ company: 'Reliapay', tier: 'TBC', oldGroup: 'Wallaby 1', conflict: null }];
  const same = diffCompanies(parsed, [{ company_id: 1, name: 'Reliapay', tier: 'TBC', old_group: 'Wallaby 1' }]);
  const moved = diffCompanies(parsed, [{ company_id: 1, name: 'Reliapay', tier: 'TBC', old_group: 'Milky' }]);
  assert.equal(same.rows[0].state, 'unchanged');
  assert.equal(moved.rows[0].state, 'changed');
});
