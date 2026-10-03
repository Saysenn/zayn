const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * DELETING BY NAME, AND SEVERAL AT ONCE
 * ***************************************************
 *
 * It took a row ID ONLY, so deleting somebody meant a lookup first and a
 * number copied between turns, and five rows was five confirmations with
 * nothing tying them together. An id is precisely the argument she cannot
 * sanity check: the wrong one deletes somebody's payroll history and there
 * is no undo for it here.
 */

const deal = (over = {}) => ({
  id: 1,
  person_id: 'gloria',
  person_name: 'Gloria',
  company: 'Acqua',
  group_name: 'INDIGO',
  role_label: 'Mid 1',
  ...over,
});

const ROWS = [
  deal({ id: 1 }),
  deal({ id: 2, person_id: 'paddy', person_name: 'Paddy', company: 'Leadstone' }),
  deal({ id: 3, person_id: 'zayn', person_name: 'Zayn', company: 'Relia' }),
];

function loadTool({ rows = ROWS, removed = null } = {}) {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  for (const p of [toolPath, repoPath]) delete require.cache[p];

  const gone = [];
  require.cache[repoPath] = stub({
    async findAll() { return { rows, total: rows.length }; },
    async findById(id) { return rows.find((r) => r.id === id) ?? null; },
    async remove(id) { gone.push(id); return { id }; },
    async removeMany(ids) {
      const taken = removed ?? ids;
      gone.push(...taken);
      return taken.map((id) => ({ id }));
    },
    async searchFuzzy() { return rows; },
  });

  const tool = require(toolPath).masterSheetTools
    .find((t) => t.name === 'delete_master_sheet_row');
  return { tool, gone };
}

test('a NAME is enough, and the first call deletes nothing', async () => {
  const { tool, gone } = loadTool();
  const out = await tool.handler({ people: ['Gloria'], said: 'delete gloria' });

  assert.equal(gone.length, 0);
  assert.equal(out.pending, true);
  assert.match(out.summary, /Gloria · Acqua · INDIGO · #1/);
  assert.match(out.summary, /CANNOT BE UNDONE/);
});

test('several names are ONE act, and every row is named', async () => {
  const { tool, gone } = loadTool();
  const out = await tool.handler({ people: ['Gloria', 'Paddy'], said: 'delete gloria and paddy' });

  assert.equal(gone.length, 0);
  assert.match(out.summary, /#1/);
  assert.match(out.summary, /#2/);
  assert.doesNotMatch(out.summary, /#3/, 'Zayn was not named');
});

test('CONFIRMED, it goes in one call', async () => {
  const { tool, gone } = loadTool();
  const out = await tool.handler({
    people: ['Gloria', 'Paddy'], confirmed: true, said: 'yes',
  });
  assert.deepEqual(gone.sort(), [1, 2]);
  assert.match(out.summary, /Deleted 2 rows/);
});

// A name that misses is invisible in a count, so nobody would know
// somebody had been left out.
test('a name that matches nobody refuses the WHOLE delete', async () => {
  const { tool, gone } = loadTool();
  const out = await tool.handler({
    people: ['Gloria', 'Wilhelmina'], confirmed: true, said: 'delete them',
  });
  assert.equal(gone.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN DELETED/);
  assert.match(out.summary, /Wilhelmina/);
});

// Ids carried over from an earlier answer are how the wrong row goes.
test('an id that is not in scope refuses, and says why', async () => {
  const { tool, gone } = loadTool();
  const out = await tool.handler({ ids: [99], confirmed: true, said: 'delete 99' });
  assert.equal(gone.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN DELETED/);
  assert.match(out.summary, /carried over from an earlier answer/);
});

test('a person named AND their id passed is ONE row, not two', async () => {
  const { tool, gone } = loadTool();
  await tool.handler({ people: ['Gloria'], ids: [1], confirmed: true, said: 'yes' });
  assert.deepEqual(gone, [1]);
});

test('nothing named at all asks WHOSE, rather than deleting', async () => {
  const { tool, gone } = loadTool();
  const out = await tool.handler({ said: 'delete it' });
  assert.equal(gone.length, 0);
  assert.match(out.summary, /Ask WHOSE deal is going/);
});

test('a row that did not go is NAMED, never averaged into a count', async () => {
  const { tool } = loadTool({ removed: [1] });
  const out = await tool.handler({ people: ['Gloria', 'Paddy'], confirmed: true, said: 'yes' });
  assert.match(out.summary, /DID NOT GO/);
  assert.match(out.summary, /#2/);
  assert.match(out.summary, /Do NOT report this as done/);
});

test('one id still reads as ONE row, with the person and the group', async () => {
  // The single path is kept: it names that one row and reads more plainly.
  const { tool, gone } = loadTool();
  const out = await tool.handler({ id: 3, said: 'delete row 3' });
  assert.equal(gone.length, 0);
  assert.match(out.summary, /Zayn/);
  assert.match(out.summary, /INDIGO/);
});

test('too many is REFUSED, never silently capped', async () => {
  const many = Array.from({ length: 40 }, (_, i) => deal({
    id: i + 1, person_id: `p${i}`, person_name: `Person ${i}`,
  }));
  const { tool, gone } = loadTool({ rows: many });
  const out = await tool.handler({
    people: many.map((r) => r.person_name), confirmed: true, said: 'delete them all',
  });
  assert.equal(gone.length, 0);
  assert.match(out.summary, /40 rows/);
  assert.match(out.summary, /narrow it/);
});
