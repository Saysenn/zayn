const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * SHE STOPPED READING AFTER "DARLING"
 * ***************************************************
 *
 * Asked what changed in the last 24 hours she wrote five bullets: "preset
 * dates cycling through August to October", "quite a dance of adjustments".
 * The dates the question was about were gone.
 *
 * SHE WAS NOT CUT OFF. The tool handed her 24,165 characters and 676 lines
 * with "Relay EVERY line below", and she did the only thing a model does
 * with that: she summarised. `finish_reason` was `stop`, so the length
 * retry never fired, and no amount of "do NOT compress this" was going to
 * change it. PROMPTING IS NOT A GUARD.
 *
 * Above `LIST_FROM` the rows go ON SCREEN, exactly as a big filter result
 * does, and she gets one SHORT computed sentence instead. Under it,
 * relaying verbatim is right for three rows and stays.
 */

const recent = masterSheetTools.find((t) => t.name === 'recent_master_sheet_changes');

const row = (id, person, group) => ({
  id, person_name: person, company: 'Workforce', group_name: group,
  source: 'sheet', was_edited: true, updated_at: new Date().toISOString(),
});

const change = (id, rowId, field, from, to) => ({
  id, row_id: rowId, field, old_value: from, new_value: to,
});

const withRows = (rows, changes, run) => {
  const saved = { findRecentlyUpdated: repo.findRecentlyUpdated, findFieldChanges: repo.findFieldChanges };
  repo.findRecentlyUpdated = async () => ({ rows, total: rows.length });
  repo.findFieldChanges = async () => changes;
  return run().finally(() => Object.assign(repo, saved));
};

const many = Array.from({ length: 40 }, (_, i) => row(i + 1, `Person ${i + 1}`, i % 2 ? 'NEXUS' : 'MILKMAN'));
const manyChanges = many.flatMap((r) => [
  change(r.id * 10, r.id, 'presetOn', '2026-09-01', '2026-10-01'),
  change(r.id * 10 + 1, r.id, 'payableDays', '30', '31'),
]);

test('A BIG SET GOES ON SCREEN, and her line stays short', async () => {
  await withRows(many, manyChanges, async () => {
    const out = await recent.handler({ hours: 24 });

    assert.ok(out.list, 'nothing was rendered, so she is being asked to read it out');
    assert.equal(out.list.rows.length, 40);
    // The number that made her summarise. Well under any reply budget now.
    assert.ok(out.summary.length < 1200, `still ${out.summary.length} characters to relay`);
    assert.doesNotMatch(out.summary, /Relay EVERY line/);
  });
});

test('THE COUNTS ARE COMPUTED, not left for her to characterise', async () => {
  // "A dance of adjustments" is what she says when nothing hands her the
  // real shape of it.
  await withRows(many, manyChanges, async () => {
    const out = await recent.handler({ hours: 24 });

    assert.match(out.summary, /preset date on 40/);
    assert.match(out.summary, /payable days on 40/);
    assert.match(out.summary, /MILKMAN 20/);
    assert.match(out.summary, /NEXUS 20/);
  });
});

test('EVERY ROW CARRIES ITS OWN DIFF, with both values', async () => {
  await withRows(many, manyChanges, async () => {
    const out = await recent.handler({ hours: 24 });
    const first = out.list.rows[0];

    assert.match(first.role, /preset date 2026-09-01 → 2026-10-01/);
    assert.match(first.role, /payable days 30 → 31/);
    // The diff is the point of this list, so the money column is not.
    assert.equal(first.amount, null);
  });
});

test('a row with many edits is CAPPED, so the newest is not pushed off', async () => {
  const one = [row(1, 'Pino', 'NEXUS')];
  const five = Array.from({ length: 5 }, (_, i) => change(i, 1, 'presetOn', `2026-0${i + 1}-01`, `2026-0${i + 2}-01`));

  await withRows(one, five, async () => {
    // One row is under the threshold, so force the list with more rows.
    const out = await recent.handler({ hours: 24 });
    assert.equal(out.list, undefined, 'a handful of rows should still be relayed verbatim');
  });

  const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, `P${i}`, 'NEXUS'));
  const lots = [...five, ...rows.slice(1).map((r) => change(r.id * 10, r.id, 'presetOn', 'a', 'b'))];
  await withRows(rows, lots, async () => {
    const out = await recent.handler({ hours: 24 });
    const pino = out.list.rows.find((r) => r.id === 1);
    assert.match(pino.role, /\+2 more/, 'five edits on one line would truncate the newest away');
  });
});

test('A SMALL SET IS STILL RELAYED VERBATIM, which is right for three rows', async () => {
  const few = [row(1, 'Abe', 'NEXUS'), row(2, 'Dewell', 'NEXUS')];
  const diffs = [change(10, 1, 'presetOn', '2026-09-01', '2026-10-01')];

  await withRows(few, diffs, async () => {
    const out = await recent.handler({ hours: 24 });

    assert.equal(out.list, undefined, 'two rows do not need a panel');
    assert.match(out.summary, /Relay EVERY line/);
    assert.match(out.summary, /"2026-09-01" -> "2026-10-01"/);
  });
});

test('nothing changed says so, either way', async () => {
  await withRows([], [], async () => {
    const out = await recent.handler({ hours: 24 });
    assert.match(out.summary, /Nothing's been added or edited/);
    assert.equal(out.list, undefined);
  });
});

// 2026-09-25: "17 rows changed" sat beside "PROFILE add on % on 91", because
// the counts were log entries. One deal edited thirty times is one deal.
test('A FIELD COUNT IS DEALS, never log entries', async () => {
  const edits = many.flatMap((r) => [0, 1, 2].map((n) => change(r.id * 100 + n, r.id, 'presetOn', '2026-09-01', '2026-10-01')));
  const gone = [change(9001, null, 'deleted', null, null), change(9002, null, 'deleted', null, null)];
  await withRows(many, [...edits, ...gone], async () => {
    const out = await recent.handler({ hours: 24 });
    assert.match(out.summary, /preset date on 40/);
    // REMOVED DEALS ARE SAID APART, never as a field of the listed ones. 2026-09-25.
    assert.doesNotMatch(out.summary, /deleted on/);
    assert.match(out.summary, /Separately, 2 deals were removed from the sheet/);
    assert.match(out.list.subtitle, /2 removed/);
  });
});

test('an edit on a deal that has since been deleted is not counted as a deal', async () => {
  const edits = [change(1, 1, 'presetOn', 'a', 'b'), change(2, null, 'personAddonPercent', '0', '5')];
  await withRows(many, edits, async () => {
    const out = await recent.handler({ hours: 24 });
    assert.doesNotMatch(out.summary, /PROFILE add on/);
  });
});
