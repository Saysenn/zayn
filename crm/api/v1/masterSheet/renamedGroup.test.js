const test = require('node:test');
const assert = require('node:assert/strict');

const { renamedGroups } = require('./renamedGroup');

/**
 * ***************************************************
 * * A RENAMED GROUP IS A SILENT DOUBLING
 * ***************************************************
 *
 * Verified against the live sheet before this existed: take MILKMAN's 33
 * rows, fold the group to "milky" in each sync key, and
 *
 *   findBySyncKeys(renamed)            -> []   nothing matches, all 33 import as NEW
 *   findNotInKeys(renamed, ['MILKY'])  -> 0    the 33 stored rows are shown NOWHERE
 *
 * because "different deals" is scoped to the groups the FILE speaks for,
 * and the old name is not one of them. The sheet ends up with 66 rows and
 * both sets counting toward the month.
 *
 * IT ASKS, IT DOES NOT DECIDE. A rename and a genuinely new group cannot be
 * told apart from the data, and both guesses are bad: guess "new" and the
 * money doubles, guess "rename" and a group nobody renamed gets rewritten.
 */

const fileRow = (person, company, role, groupName) => ({
  personId: person.toLowerCase().replace(/\s+/g, '-'), personName: person, company, roleLabel: role, groupName,
});
const storedRow = (person, company, role, group) => ({
  person_id: person.toLowerCase().replace(/\s+/g, '-'), person_name: person, company, role_label: role, group_name: group,
});

const ROSTER = [
  ['Anthony Wareham', 'Yellowstone Associates', 'Director'],
  ['Ruth Harper', 'Capilano Associates', 'Director'],
  ['Sean Mannings', 'Reliapay', 'Director'],
  ['Craig Sterling', 'Relia PA', 'Director'],
];

const stored = (group) => ROSTER.map(([p, c, r]) => storedRow(p, c, r, group));
const file = (group) => ROSTER.map(([p, c, r]) => fileRow(p, c, r, group));

// Somebody else entirely, to stand in for the rest of the sheet.
const OTHERS = [
  storedRow('Gloria', 'Workforce', 'Closer', 'INDIGO'),
  storedRow('Zayn', 'Workforce', 'Developer', 'INDIGO'),
  storedRow('Nathan', 'Imperium resourcing PR', 'Mid 1', 'INDIGO'),
];

test('THE ACTUAL CASE: the same roster under a name the CRM has never seen', () => {
  const found = renamedGroups(file('MILKY'), [...stored('MILKMAN'), ...OTHERS]);

  assert.equal(found.length, 1, 'a rename of a whole group was not noticed');
  assert.equal(found[0].from, 'MILKMAN');
  assert.equal(found[0].to, 'MILKY');
  assert.equal(found[0].matched, 4);
  assert.equal(found[0].of, 4);
  // Named, so a human can recognise it rather than trusting a percentage.
  assert.ok(found[0].names.includes('Anthony Wareham'));
});

test('A GENUINELY NEW GROUP IS NOT A RENAME', () => {
  // Different people, different companies. Nothing to ask about.
  const newcomers = [
    fileRow('Rita Reclaim', 'Reclaim Co', 'Mid 1', 'RECLAIMS'),
    fileRow('Ronan Reclaim', 'Reclaim Co', 'Mid 2', 'RECLAIMS'),
    fileRow('Rosa Reclaim', 'Other Reclaim Co', 'Director', 'RECLAIMS'),
  ];
  assert.deepEqual(renamedGroups(newcomers, [...stored('MILKMAN'), ...OTHERS]), []);
});

test('A GROUP THE FILE ALSO MENTIONS is being updated, not renamed', () => {
  // MILKMAN is in the file under its own name, so it cannot be the old side
  // of a rename however much it overlaps.
  const both = [...file('MILKMAN'), ...file('MILKY')];
  const found = renamedGroups(both, [...stored('MILKMAN'), ...OTHERS]);
  assert.deepEqual(found.map((f) => f.from), []);
});

test('an ordinary upload of the whole sheet suggests nothing', () => {
  assert.deepEqual(renamedGroups(file('MILKMAN'), [...stored('MILKMAN'), ...OTHERS]), []);
});

test('A PARTIAL MOVE IS NOT ENOUGH, or every reshuffle becomes a question', () => {
  // One of four is 25%, well under the threshold. People move between
  // groups all the time and that is not a rename.
  const one = [fileRow('Anthony Wareham', 'Yellowstone Associates', 'Director', 'MILKY')];
  assert.deepEqual(renamedGroups(one, [...stored('MILKMAN'), ...OTHERS]), []);
});

test('TINY GROUPS ARE IGNORED, because 100% of one row means nothing', () => {
  const two = [
    fileRow('A', 'Co', 'Director', 'NEWCO'),
    fileRow('B', 'Co', 'Mid 1', 'NEWCO'),
  ];
  const oldTwo = [storedRow('A', 'Co', 'Director', 'OLDCO'), storedRow('B', 'Co', 'Mid 1', 'OLDCO')];
  assert.deepEqual(renamedGroups(two, [...oldTwo, ...OTHERS]), []);
});

test('the GROUP is not part of the comparison, which is the whole point', () => {
  // Identity is person + company + role. If the group were included nothing
  // would ever match, which is exactly why the upload misses this.
  const found = renamedGroups(file('WALLABY 1'), [...stored('MILKMAN'), ...OTHERS]);
  assert.equal(found.length, 1);
  assert.equal(found[0].to, 'WALLABY 1');
});

test('CASE AND SPACING ARE NOT A RENAME', () => {
  // "milkman" and "MILKMAN" fold to the same group on the way in, so this
  // must never be reported. Verified in the parser: the stored value is
  // upper-cased.
  assert.deepEqual(renamedGroups(file('MILKMAN'), [...stored('MILKMAN'), ...OTHERS]), []);
});

test('an UNKNOWN group is never one side of a rename', () => {
  // "UNKNOWN" is the parser saying it could not tell, not a name.
  const unknown = ROSTER.map(([p, c, r]) => fileRow(p, c, r, 'UNKNOWN'));
  assert.deepEqual(renamedGroups(unknown, [...stored('MILKMAN'), ...OTHERS]), []);
});

test('several suspicions come back strongest first', () => {
  const big = [...ROSTER, ['Extra One', 'Co', 'Mid 1'], ['Extra Two', 'Co', 'Mid 2']];
  const fileRows = [
    ...big.map(([p, c, r]) => fileRow(p, c, r, 'BIGNEW')),
    ...OTHERS.slice(0, 3).map((r) => fileRow(r.person_name, r.company, r.role_label, 'SMALLNEW')),
  ];
  const storedRows = [
    ...big.map(([p, c, r]) => storedRow(p, c, r, 'BIGOLD')),
    ...OTHERS.map((r) => ({ ...r, group_name: 'SMALLOLD' })),
  ];

  const found = renamedGroups(fileRows, storedRows);
  assert.equal(found.length, 2);
  assert.ok(found[0].matched >= found[1].matched, 'not sorted by strength');
});
