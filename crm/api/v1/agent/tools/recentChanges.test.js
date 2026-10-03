const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * ***************************************************
 * * Reading a long day back, without shortening it
 * ***************************************************
 *
 * Asked what changed, Diane reported twenty-five rows of forty and wrote
 * the dates as prose ("into March and beyond", "of that year"), which loses
 * the only thing the question was about.
 *
 * Three faults, one symptom: a silent row cap, a count taken from the
 * capped page, and a reply budget that truncated the relay with no retry.
 * The third is pinned in runAgent's own test; these two are here.
 */

function loadTool({ rows, total, fieldChanges = [] }) {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  const seen = {};

  for (const p of [toolPath, repoPath]) delete require.cache[p];
  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: new Proxy({
      async findRecentlyUpdated(args) { seen.rowArgs = args; return { rows, total }; },
      async findFieldChanges(args) { seen.changeArgs = args; return fieldChanges; },
    }, { get: (t, k) => (k in t ? t[k] : async () => []) }),
  };

  const { masterSheetTools } = require(toolPath);
  const tool = masterSheetTools.find((t) => t.name === 'recent_master_sheet_changes');
  assert.ok(tool, 'the tool must still be registered');
  return { tool, seen };
}

const row = (n) => ({
  id: n,
  person_name: `Person ${n}`,
  company: 'Relia PA',
  group_name: 'MILKMAN',
  source: 'import',
  was_edited: true,
  updated_at: new Date().toISOString(),
});

test('the count is the TRUE total, never the capped page', async () => {
  const { tool } = loadTool({ rows: Array.from({ length: 200 }, (_, i) => row(i)), total: 240 });
  const { summary } = await tool.handler({});
  // Either wording: past a dozen rows the list renders on screen and the
  // sentence reads "240 rows changed", under it "240 row(s) changed". The
  // COUNT is what this pins, and it must be the true total not the page.
  assert.match(summary, /^240 rows? ?(\(s\))? ?changed/, 'it must report what actually changed');
});

test('a truncated list SAYS so, and names how many are missing', async () => {
  const { tool } = loadTool({ rows: Array.from({ length: 200 }, (_, i) => row(i)), total: 240 });
  const { summary } = await tool.handler({});
  assert.match(summary, /40 more/);
  assert.match(summary, /TELL THE ADMIN/);
});

test('nothing is said about a cap when nothing was cut', async () => {
  const { tool } = loadTool({ rows: [row(1), row(2)], total: 2 });
  const { summary } = await tool.handler({});
  assert.match(summary, /^2 row\(s\) changed/);
  assert.ok(!summary.includes('more and offer'), 'no phantom truncation notice');
});

test('the caps are generous enough for a real day', async () => {
  const { tool, seen } = loadTool({ rows: [row(1)], total: 1 });
  await tool.handler({});
  // Was 25 rows. A busy day runs past that and used to do it silently.
  assert.ok(seen.rowArgs.limit >= 200, 'the row cap must clear a busy day');
  assert.ok(seen.changeArgs.limit >= 1000, 'a bulk edit writes many changes per row');
});

test('the relay instruction forbids rewording a date', async () => {
  // "extended into March and beyond in March and April of following years
  // respectively" is what she wrote instead of the dates themselves.
  const { tool } = loadTool({
    rows: [row(1)],
    total: 1,
    fieldChanges: [{
      row_id: 1, field: 'endOn', old_value: '2026-09-30', new_value: '2027-08-05',
    }],
  });
  const { summary } = await tool.handler({});
  assert.match(summary, /never as "that year", "next year" or "following years"/);
  // And the real values are in the payload for her to copy.
  assert.ok(summary.includes('"2026-09-30" -> "2027-08-05"'));
  assert.ok(summary.includes('end date'), 'named the way a human says it');
});

test('the hours argument reaches both queries', async () => {
  const { tool, seen } = loadTool({ rows: [row(1)], total: 1 });
  await tool.handler({ hours: 72 });
  assert.equal(seen.rowArgs.hours, 72);
  assert.equal(seen.changeArgs.hours, 72);
});

test('a named person scopes both the changed deals and their field diffs', async () => {
  const { tool, seen } = loadTool({ rows: [], total: 0 });
  const out = await tool.handler({ person: ' Nicola ' });
  assert.match(out.summary, /for Nicola/);
  assert.equal(seen.rowArgs.person, 'Nicola');
  assert.equal(seen.changeArgs.person, 'Nicola');
});

test('a named person keeps even a small result in the searchable card list', async () => {
  const { tool } = loadTool({ rows: [row(7)], total: 1 });
  const out = await tool.handler({ person: 'Nicola' });
  assert.ok(out.list);
  assert.equal(out.list.kind, 'recent-changes');
});

test('an empty day says so plainly', async () => {
  const { tool } = loadTool({ rows: [], total: 0 });
  const { summary } = await tool.handler({});
  assert.match(summary, /Nothing's been added or edited/);
});

// 2026-09-28: "fee: 0 -> 3" had no %, so her correct "3%" read as invented and
// the rate guard sent her off to answer a question nobody asked.
test('A RATE IN THE CHANGE LOG IS WRITTEN AS A RATE', async () => {
  const { tool } = loadTool({
    rows: [row(1)],
    total: 1,
    fieldChanges: [{ row_id: 1, field: 'fee_percent', old_value: '0', new_value: '3' }],
  });
  const { summary } = await tool.handler({});
  assert.match(summary, /"0%" -> "3%"/);
  const { percentsIn } = require('../checkPercents');
  assert.ok(percentsIn(summary).has(3), 'the rate guard reads it from the tool');
});
