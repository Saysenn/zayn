const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * "update zayn, paddy, gloria" as ONE act
 * ***************************************************
 *
 * Every filter on the bulk tool is a property of a ROW: a group, a
 * currency, a month. None of them is a list of people, so naming three had
 * no route and the only way through was three separate single row edits.
 * Three confirmations, three chances to stop half way, and no ONE act to
 * undo afterwards, which is how "revert that" ends up meaning nothing.
 *
 * GLORIA IS THE TEST THAT MATTERS. There are two of her, so a mass edit
 * that guessed would change the wrong person's money. It refuses.
 */

const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');
const undo = masterSheetTools.find((t) => t.name === 'undo_master_sheet_change');

const deal = (id, person, group) => ({
  id,
  person_id: person.trim().toLowerCase().replace(/\s+/g, '-'),
  person_name: person,
  company: 'Workforce',
  group_name: group,
  currency: 'GBP',
  payable_amount: 500,
  payable_days: 30,
  payment_method: 'cash',
});

const ROWS = [
  deal(1, 'Zayn', 'INDIGO'),
  deal(2, 'Zayn', 'MILKMAN'),
  deal(3, 'Paddy', 'ALL GROUPS'),
  deal(4, 'Gloria', 'INDIGO'),
  deal(5, 'Gloria', 'MILKMAN'),
  deal(6, 'Gloria difference', 'ALL GROUPS'),
  deal(7, 'Nathan', 'NEXUS'),
];

const withRepo = (run, over = {}) => {
  const saved = { findAll: repo.findAll, update: repo.update };
  const written = [];
  repo.findAll = async () => ({ rows: ROWS, total: ROWS.length });
  repo.update = async (id, patch) => { written.push({ id, patch }); return { id }; };
  Object.assign(repo, over);
  return run(written).finally(() => Object.assign(repo, saved));
};

test('THREE NAMES, ONE CALL, and only their rows', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({
      people: ['Zayn', 'Paddy', 'Gloria difference'],
      set: { endOn: '2026-12-31' },
      confirmed: true,
    });

    assert.deepEqual(written.map((w) => w.id).sort((a, b) => a - b), [1, 2, 3, 6]);
    assert.equal(written[0].patch.endOn, '2026-12-31');
    assert.match(out.summary, /Done\. 4 rows/);
    // Nathan was never named and must not appear.
    assert.equal(written.some((w) => w.id === 7), false);
  });
});

test('EVERY DEAL A NAMED PERSON HOLDS, not just their first', async () => {
  // Zayn has two. Changing one and reporting success is the failure that
  // hides in a count.
  await withRepo(async (written) => {
    await bulk.handler({ people: ['Zayn'], set: { payableDays: 31 }, confirmed: true });
    assert.deepEqual(written.map((w) => w.id), [1, 2]);
  });
});

test('AN EXACT NAME WINS, so "Gloria" is Gloria and not Gloria difference', async () => {
  // The exact-name rule, and it matters most here: without it, naming
  // Gloria in a mass edit would stop to ask every single time, and
  // answering "Gloria" would ask again. Gloria difference is untouched.
  await withRepo(async (written) => {
    await bulk.handler({ people: ['Gloria'], set: { payableDays: 31 }, confirmed: true });

    assert.deepEqual(written.map((w) => w.id), [4, 5]);
    assert.equal(written.some((w) => w.id === 6), false, "it changed Gloria difference's row");
  });
});

test('A PART OF A NAME REFUSES THE WHOLE CHANGE', async () => {
  // "Glori" is not either of them exactly, and it reaches two people.
  // Guessing changes the wrong person's money.
  await withRepo(async (written) => {
    const out = await bulk.handler({
      people: ['Zayn', 'Glori'], set: { endOn: '2026-12-31' }, confirmed: true,
    });

    assert.equal(written.length, 0, "it changed Zayn's rows while unsure about Glori");
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
    assert.match(out.summary, /Gloria difference/);
  });
});

test('A NAME THAT MATCHES NOBODY REFUSES TOO', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({
      people: ['Zayn', 'Priya'], set: { payableDays: 31 }, confirmed: true,
    });
    assert.equal(written.length, 0);
    assert.match(out.summary, /Priya/);
  });
});

test('the confirm NAMES THEM before anything is written', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({ people: ['Zayn', 'Paddy'], set: { endOn: '2026-12-31' } });

    assert.equal(written.length, 0, 'an unconfirmed named edit wrote');
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
    assert.match(out.summary, /Zayn/);
    assert.match(out.summary, /Paddy/);
    assert.match(out.summary, /on 3 rows/);
  });
});

test('people and except work TOGETHER, both against the named set', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({
      people: ['Zayn', 'Paddy'], except: ['Paddy'], set: { payableDays: 31 }, confirmed: true,
    });

    assert.deepEqual(written.map((w) => w.id), [1, 2]);
    assert.match(out.summary, /Paddy/);
  });
});

test('a group narrows the named set further', async () => {
  await withRepo(async (written) => {
    await bulk.handler({
      people: ['Zayn'], group: 'INDIGO', set: { payableDays: 31 }, confirmed: true,
    });
    // findAll is stubbed to ignore the group, so this pins that `people`
    // narrows what came back rather than replacing it.
    assert.deepEqual(written.map((w) => w.id), [1, 2]);
  });
});

test('`people` never reaches the repo as a query filter', async () => {
  let seen = null;
  await withRepo(async () => {
    await bulk.handler({ people: ['Zayn'], set: { payableDays: 31 }, confirmed: true });
  }, {
    findAll: async (f) => { seen = f; return { rows: ROWS, total: ROWS.length }; },
  });
  assert.equal(seen.people, undefined);
});

/* ===============================
 * * And the way back out of it
 * =============================== */

const CHANGES = [
  { id: 90, rowId: 1, person: 'Zayn', group: 'INDIGO', field: 'endOn' },
  { id: 91, rowId: 2, person: 'Zayn', group: 'MILKMAN', field: 'endOn' },
  { id: 92, rowId: 3, person: 'Paddy', group: 'ALL GROUPS', field: 'endOn' },
];

const BATCH = {
  changed_via: 'diane',
  rows: 3,
  deals: 3,
  changed_at: new Date().toISOString(),
  ids: CHANGES.map((c) => c.id),
  changes: CHANGES,
  fields: ['endOn'],
  groups: ['INDIGO', 'MILKMAN', 'ALL GROUPS'],
  people: ['Zayn', 'Paddy'],
  field_values: [{ field: 'endOn', value: '2026-12-31' }],
};

const withBatch = (over, run) => {
  const saved = { findChangeBatches: repo.findChangeBatches, revertChangeBatch: repo.revertChangeBatch };
  repo.findChangeBatches = async () => [BATCH];
  repo.revertChangeBatch = async (ids) => ({ done: ids.map((id) => ({ ok: true, id })), failed: [] });
  Object.assign(repo, over);
  return run().finally(() => Object.assign(repo, saved));
};

test('IT REVERTS BY NAME TOO, and leaves everyone else alone', async () => {
  let seen = null;
  const out = await withBatch({
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  }, () => undo.handler({ people: ['Zayn'], confirmed: true }));

  assert.deepEqual(seen, [90, 91], "it put back Paddy's row as well");
  assert.match(out.summary, /Put back\./);
});

test('naming people is enough: no batch flag, no change id', async () => {
  // Narrowing across a set is meaningless on one row, so asking for it IS
  // asking for the batch.
  let seen = null;
  await withBatch({
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  }, () => undo.handler({ people: ['Paddy'], confirmed: true }));

  assert.deepEqual(seen, [92]);
});

test('AN UNKNOWN NAME REFUSES THE REVERT, in its own words', async () => {
  let wrote = false;
  const out = await withBatch({
    revertChangeBatch: async () => { wrote = true; return { done: [], failed: [] }; },
  }, () => undo.handler({ people: ['Priya'], confirmed: true }));

  assert.equal(wrote, false);
  assert.match(out.summary, /NOTHING HAS BEEN PUT BACK/);
  assert.match(out.summary, /Priya/);
});

test('THE SENTENCE MUST NOT OVERRIDE A LIST OF NAMES', async () => {
  // `said` recovers a name she SHORTENED by taking the longest one in the
  // sentence. With a LIST every entry is already whole, so applying it
  // overrides them all with the same name.
  //
  // Live: "set payable days to 25 for zayn and paddy" resolved BOTH to
  // Paddy, because "paddy" is one letter longer than "zayn". The tool
  // offered "2 rows: Paddy, Paddy" and Zayn was not in it.
  //
  // The identical fault was fixed in total_master_sheet's people loop and
  // this call site was missed. Pinned on both now.
  await withRepo(async (written) => {
    await bulk.handler({
      people: ['Zayn', 'Paddy'],
      set: { payableDays: 25 },
      said: 'set payable days to 25 for zayn and paddy',
      confirmed: true,
    });

    const names = written.map((w) => ROWS.find((r) => r.id === w.id).person_name);
    assert.ok(names.includes('Zayn'), 'Zayn was resolved away by the sentence');
    assert.ok(names.includes('Paddy'), 'Paddy was lost');
    assert.equal(new Set(written.map((w) => w.id)).size, written.length, 'a row was written twice');
  });
});

test('and ONE name still gets the sentence, which is what it is for', async () => {
  // "show me gloria difference" must still beat a shortened "Gloria".
  await withRepo(async (written) => {
    await bulk.handler({
      people: ['Gloria'],
      set: { payableDays: 25 },
      said: 'set gloria difference to 25 payable days',
      confirmed: true,
    });
    assert.deepEqual(written.map((w) => w.id), [6], 'the longer name in the sentence must win');
  });
});
