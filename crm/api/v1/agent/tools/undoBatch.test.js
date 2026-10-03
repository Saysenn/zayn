const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * "put that back" after a mass edit
 * ***************************************************
 *
 * Undo took one change id. A bulk update writes one per field per row, so
 * putting back a 96 row edit was two hundred confirmations: in practice the
 * mass edit had no way back at all.
 *
 * A batch is RECOVERED from the log, not stored, and it is not partitioned
 * by field: one call setting the preset AND the payable days is ONE act,
 * and splitting it put half of it back.
 *
 * THEN IT FAILED ANYWAY, live. She carried a change id from earlier in a
 * long conversation, that change had already been put back, and the answer
 * was "the bulk change is no longer undoable" plus an offer to do 96 rows
 * one at a time. So "undo that" now needs NO id, and a revert narrows by
 * `group` and `except` exactly as the bulk edit does, because an admin
 * thinks in groups and people and never in change ids.
 */

const undo = masterSheetTools.find((t) => t.name === 'undo_master_sheet_change');

// Two groups, so narrowing is a real test rather than a no-op.
const CHANGES = [
  { id: 292, rowId: 7, person: 'Abe', group: 'MILKMAN', field: 'presetOn' },
  { id: 293, rowId: 7, person: 'Abe', group: 'MILKMAN', field: 'payableDays' },
  { id: 294, rowId: 8, person: 'Dewell', group: 'MILKMAN', field: 'presetOn' },
  { id: 295, rowId: 8, person: 'Dewell', group: 'MILKMAN', field: 'payableDays' },
  { id: 296, rowId: 9, person: 'Drew', group: 'NEXUS', field: 'presetOn' },
  { id: 297, rowId: 9, person: 'Drew', group: 'NEXUS', field: 'payableDays' },
];

const BATCH = {
  changed_via: 'diane',
  rows: CHANGES.length,
  deals: 3,
  changed_at: new Date().toISOString(),
  ids: CHANGES.map((c) => c.id),
  changes: CHANGES,
  fields: ['payableDays', 'presetOn'],
  groups: ['MILKMAN', 'NEXUS'],
  people: ['Abe', 'Dewell', 'Drew'],
  field_values: [
    { field: 'presetOn', value: '2026-09-01' },
    { field: 'payableDays', value: '30' },
  ],
};

const withRepo = (over, run) => {
  const saved = {};
  for (const k of Object.keys(over)) { saved[k] = repo[k]; repo[k] = over[k]; }
  return run().finally(() => Object.assign(repo, saved));
};

const call = (args, over = {}) => withRepo({
  peekFieldChange: async (id) => CHANGES.find((c) => c.id === Number(id)) ?? null,
  findChangeBatches: async () => [BATCH],
  revertChangeBatch: async (ids) => ({ done: ids.map((id) => ({ ok: true, id })), failed: [] }),
  ...over,
}, () => undo.handler({ batch: true, ...args }));

test('IT NAMES THE BATCH BEFORE IT TOUCHES IT', async () => {
  let wrote = false;
  const out = await call({ changeId: 292 }, {
    revertChangeBatch: async () => { wrote = true; return { done: [], failed: [] }; },
  });

  assert.equal(wrote, false, 'a batch undo wrote before it was confirmed');
  assert.match(out.summary, /3 deals/);
  assert.match(out.summary, /Abe/);
  // Each value against ITS OWN field. Flattened, three fields read as
  // "set to 1000, 2026-09-01, 30", which says nothing about which is which.
  assert.match(out.summary, /preset date from "2026-09-01" back to /);
  assert.match(out.summary, /payable days from "30" back to /);
});

test('NO ID AT ALL means the most recent change', async () => {
  // The live failure. She carried a stale id, it had already been put
  // back, and 96 rows became "name which one to start with".
  let seen = null;
  const out = await call({ confirmed: true }, {
    peekFieldChange: async () => { throw new Error('it went looking for an id it was not given'); },
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  });

  assert.deepEqual(seen, BATCH.ids);
  assert.match(out.summary, /Put back\./);
});

test('AN ALREADY REVERTED ID SAYS SO, and offers the way on', async () => {
  // "Not undoable" covered both this and an id that never existed, and
  // they need different answers.
  const out = await call({ changeId: 292, confirmed: true }, {
    peekFieldChange: async () => ({ id: 292, reverted_at: new Date().toISOString() }),
    findChangeBatches: async () => [],
  });

  assert.match(out.summary, /already been put back/);
  assert.match(out.summary, /no changeId/);
});

test('BOTH FIELDS GO BACK, because one call was one act', async () => {
  const out = await call({ changeId: 292, confirmed: true });
  assert.match(out.summary, /Put back\./);
  assert.match(out.summary, /3 deals/);
  // BOTH named, or half the edit silently stays put.
  assert.match(out.summary, /preset date/);
  assert.match(out.summary, /payable days/);
});

test('EVERY ID IN THE BATCH IS REVERTED, not just the one asked about', async () => {
  let seen = null;
  await call({ changeId: 292, confirmed: true }, {
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  });
  assert.deepEqual(seen, BATCH.ids);
});

/* ===============================
 * * Narrowed the way a bulk edit is
 * =============================== */

test('ONE GROUP puts back only that group', async () => {
  let seen = null;
  const out = await call({ group: 'MILKMAN', confirmed: true }, {
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  });

  assert.deepEqual(seen, [292, 293, 294, 295], 'it reverted rows outside the group asked for');
  assert.match(out.summary, /2 deals/);
  assert.match(out.summary, /MILKMAN only/);
  assert.doesNotMatch(out.summary, /Drew/, 'it named a person it did not touch');
});

test('the confirm says what STAYS when a group is named', async () => {
  const out = await call({ group: 'MILKMAN' });
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /Only MILKMAN goes back/);
  assert.match(out.summary, /NEXUS/, 'it does not say which groups stay as they are');
});

test('A GROUP NOT IN THE CHANGE REFUSES, and says which were', async () => {
  let wrote = false;
  const out = await call({ group: 'INDIGO', confirmed: true }, {
    revertChangeBatch: async () => { wrote = true; return { done: [], failed: [] }; },
  });

  assert.equal(wrote, false, 'it reverted something after being given a group that was not in it');
  assert.match(out.summary, /Nothing in that change touched INDIGO/);
  assert.match(out.summary, /MILKMAN and NEXUS/);
});

test('EXCEPT holds a person back, and names them', async () => {
  let seen = null;
  const out = await call({ except: ['Dewell'], confirmed: true }, {
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  });

  assert.deepEqual(seen, [292, 293, 296, 297], "it put back a row it was told to leave");
  assert.match(out.summary, /Dewell left as it was/);
});

test('AN EXCEPTION THAT MISSES REFUSES THE WHOLE REVERT', async () => {
  // Silently ignoring it reverts the row they were protecting, and the
  // count still reads as a success.
  let wrote = false;
  const out = await call({ except: ['Priya'], confirmed: true }, {
    revertChangeBatch: async () => { wrote = true; return { done: [], failed: [] }; },
  });

  assert.equal(wrote, false);
  assert.match(out.summary, /NOTHING HAS BEEN PUT BACK/);
  assert.match(out.summary, /Priya/);
});

test('everything excepted writes nothing and says why', async () => {
  let wrote = false;
  const out = await call({ except: ['Abe', 'Dewell', 'Drew'], confirmed: true }, {
    revertChangeBatch: async () => { wrote = true; return { done: [], failed: [] }; },
  });
  assert.equal(wrote, false);
  assert.match(out.summary, /nothing left to put back/i);
});

test('a group OR an except means the batch, whatever the flag says', async () => {
  // Narrowing across a set is meaningless on one row, so asking for it is
  // asking for the batch.
  let seen = null;
  await withRepo({
    findChangeBatches: async () => [BATCH],
    revertChangeBatch: async (ids) => { seen = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  }, () => undo.handler({ group: 'NEXUS', confirmed: true }));

  assert.deepEqual(seen, [296, 297]);
});

/* ===============================
 * * The refusals
 * =============================== */

test('A HALF UNDONE BATCH IS NEVER REPORTED AS DONE', async () => {
  const out = await call({ changeId: 292, confirmed: true }, {
    revertChangeBatch: async () => ({
      done: [{ ok: true }, { ok: true }],
      failed: [{ id: 294, reason: 'the deal it belonged to has been deleted' }],
    }),
  });

  assert.match(out.summary, /DID NOT/);
  assert.match(out.summary, /#294/);
  assert.doesNotMatch(out.summary, /^Put back/);
});

test('a DELETION cannot be put back, and says so once', async () => {
  const out = await call({ confirmed: true }, {
    findChangeBatches: async () => [{ ...BATCH, fields: ['deleted'] }],
  });
  assert.match(out.summary, /deletion/i);
});

test('a batch whose deals are all gone refuses before writing', async () => {
  let wrote = false;
  const out = await call({ confirmed: true }, {
    findChangeBatches: async () => [{ ...BATCH, deals: 0 }],
    revertChangeBatch: async () => { wrote = true; return { done: [], failed: [] }; },
  });
  assert.equal(wrote, false);
  assert.match(out.summary, /deleted/i);
});

test('nothing undoable at all says so, and does not offer to retry', async () => {
  const out = await call({ confirmed: true }, { findChangeBatches: async () => [] });
  assert.match(out.summary, /Nothing has been changed/i);
});

test('WITHOUT `batch` it is still the single row undo', async () => {
  let batchCalled = false;
  const out = await withRepo({
    peekFieldChange: async () => ({
      id: 292, row_id: 7, field: 'presetOn', old_value: '2026-08-01', new_value: '2026-09-01',
      person_name: 'Abe', company: 'Acme', group_name: 'NEXUS', row_exists: true,
    }),
    findChangeBatches: async () => { batchCalled = true; return [BATCH]; },
  }, () => undo.handler({ changeId: 292 }));

  assert.equal(batchCalled, false, 'a single undo went looking for a batch');
  assert.match(out.summary, /Abe/);
});

test('a single row undo with NO id asks for one rather than guessing', async () => {
  const out = await undo.handler({});
  assert.match(out.summary, /needs its change id/);
  assert.match(out.summary, /batch true/);
});

// ===============================
// * "UNDO IT FOR INES ONLY" FINDS THE CHANGE INES IS IN
// ===============================
// 2026-09-25: the newest change was Dov's, so she told the admin Ines was not
// on the sheet. A named person picks the newest change that HOLDS them.
test('a named person reaches past a newer change they are not in', async () => {
  const NEWER = {
    ...BATCH,
    deals: 1,
    ids: [400],
    changes: [{ id: 400, rowId: 20, person: 'Dov', group: 'ZZTEST', field: 'personAddonPercent' }],
    fields: ['personAddonPercent'],
    people: ['Dov'],
  };
  let reverted = null;
  const out = await call({ people: ['Drew'], confirmed: true }, {
    findChangeBatches: async () => [NEWER, BATCH],
    revertChangeBatch: async (ids) => { reverted = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  });
  assert.deepEqual(reverted, [296, 297], `it answered: ${out.summary}`);
});

test('a named person\'s EDIT is put back before a newer deletion of theirs', async () => {
  const DELETED = {
    ...BATCH, ids: [500], changes: [{ id: 500, rowId: null, person: 'Drew', group: null, field: 'deleted' }], fields: ['deleted'],
  };
  let reverted = null;
  await call({ people: ['Drew'], confirmed: true }, {
    findChangeBatches: async () => [DELETED, BATCH],
    revertChangeBatch: async (ids) => { reverted = ids; return { done: ids.map((id) => ({ ok: true, id })), failed: [] }; },
  });
  assert.deepEqual(reverted, [296, 297]);
});

test('undoing it for NAMED people never calls it the whole change', async () => {
  const out = await call({ people: ['Drew'] });
  assert.match(out.summary, /Drew's part of change/);
  assert.doesNotMatch(out.summary, /the whole change/);
});
