const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, loadWith } = require('../../testing/stubRepos');
const { unknownArgs } = require('../knownArgs');
const { percentsFrom } = require('../checkPercents');

// ***************************************************
// * A profile rate, end to end: level, log, undo
// ***************************************************
//
// Found talking to her 2026-09-25. "give bram another 2% add on" was asked
// "which company?", her correct "2% add on" was refused as unsupported, and
// the change could not be undone. No database: every repo is stubbed.

const TOOL = require.resolve('./masterSheet.js');
const ROWS_REPO = require.resolve('../../repos/masterSheetRows.repo.js');
const PEOPLE_REPO = require.resolve('../../repos/people.repo.js');
const SOCKETS = require.resolve('../../sockets/index.js');
const DB = require.resolve('../../../configs/db');
const CACHE = require.resolve('../../shared/cache.helper');

const deal = (id, person, over = {}) => ({
  id,
  person_id: person.toLowerCase(),
  person_name: person,
  company: `Co ${id}`,
  group_name: 'ALPHA',
  currency: 'GBP',
  monthly_amount: 1000,
  payable_amount: 1000,
  addon_percent: 0,
  fee_percent: 0,
  person_addon_percent: 0,
  person_fee_percent: 0,
  ...over,
});

const ROWS = [deal(1, 'Bram Tevish'), deal(2, 'Bram Tevish'), deal(3, 'Dov Ashgrove', { person_fee_percent: 2 })];
const fold = (s) => String(s ?? '').toLowerCase();

// The name contained in the query, as a plain search finds it.
const plainSearch = (q) => ROWS.filter((r) => fold(r.person_name).includes(fold(q)));

function loadTools(search = plainSearch) {
  const seen = { upserts: [], updates: [] };
  for (const p of [TOOL, ROWS_REPO, PEOPLE_REPO, SOCKETS]) delete require.cache[p];
  require.cache[ROWS_REPO] = stub({
    async searchFuzzy({ q }) { return search(q); },
    async findById(id) { return ROWS.find((r) => r.id === Number(id)) ?? null; },
    async update(id, fields) { seen.updates.push({ id, fields }); return ROWS[0]; },
  });
  require.cache[PEOPLE_REPO] = stub({
    async findById() { return null; },
    async upsert(fields, stamp) {
      seen.upserts.push({ fields, stamp });
      // As the real upsert: the whole row, kept values included.
      const held = ROWS.find((r) => r.person_id === fields.personId);
      return {
        display_name: fields.personId,
        addon_percent: fields.addonPercent ?? held.person_addon_percent,
        fee_percent: fields.feePercent ?? held.person_fee_percent,
      };
    },
  });
  require.cache[SOCKETS] = { id: SOCKETS, filename: SOCKETS, loaded: true, exports: { broadcast() {} } };
  const { masterSheetTools } = require(TOOL);
  const tool = (name) => masterSheetTools.find((t) => t.name === name);
  return { tool, seen };
}

test('A PERSON\'S RATE WITH NO DEAL NAMED GOES TO THE PROFILE, never "which company?"', async () => {
  const { tool, seen } = loadTools();
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'Bram Tevish', addonPercentDelta: 2, said: 'give bram tevish another 2% add on',
  });
  // HANDED OVER as the profile preview, remembered as update_person.
  assert.ok(out.pending);
  assert.equal(out.redirect.name, 'update_person');
  assert.match(out.summary, /PROFILE, which is all 2 of their deals: add on 0% to 2%/);
  assert.doesNotMatch(out.reply ?? '', /which company/i);
  assert.equal(seen.updates.length, 0);
});

test('a non rate edit on a person with several deals still asks which one', async () => {
  const { tool } = loadTools();
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'Bram Tevish', payableDays: 19, said: 'set bram tevish payable days to 19',
  });
  assert.match(out.reply, /which company/i);
});

test('ONE ACT ACROSS SEVERAL PEOPLE IS ONE BATCH, logged as hers', async () => {
  const { tool, seen } = loadTools();
  await tool('update_person').handler({
    people: ['Bram Tevish', 'Dov Ashgrove'], addonPercent: 2, confirmed: true, said: 'yes',
  });
  assert.equal(seen.upserts.length, 2);
  const [a, b] = seen.upserts.map((u) => u.stamp);
  assert.equal(a.via, 'diane');
  assert.ok(a.batchId, 'no batch id, so undo cannot find the whole act');
  assert.equal(a.batchId, b.batchId, 'two batch ids is two acts to undo');
});

test('WHAT EACH PROFILE NOW HOLDS COMES BACK AS DATA, so a true rate is not refused', async () => {
  const { tool } = loadTools();
  const out = await tool('update_person').handler({
    people: ['Bram Tevish', 'Dov Ashgrove'], addonPercent: 2, confirmed: true, said: 'yes',
  });
  const found = percentsFrom(out);
  assert.ok(found.byKind.addon.has(2), 'her "2% add on" would be refused');
  assert.ok(found.byKind.fee.has(2), 'Dov keeps his 2% fee');
});

test('A DELTA ON THE BULK TOOL NAMES update_person', () => {
  const { tool } = loadTools();
  const refusal = unknownArgs(tool('bulk_update_master_sheet'), { people: ['bram'], addonPercentDelta: 2 });
  assert.match(refusal, /"addonPercentDelta" belongs to update_person/);
});

/* ===============================
 * * THE REPO HALF, stubbed pool
 * =============================== */

function loadPeopleRepo(answers) {
  const ran = [];
  const client = {
    async query(sql, params) {
      ran.push({ sql, params });
      const hit = answers.find(([re]) => re.test(sql));
      return { rows: hit ? hit[1] : [] };
    },
    release() {},
  };
  const repo = loadWith(PEOPLE_REPO, { [DB]: { query: client.query, connect: async () => client } });
  return { repo, ran };
}

const CHANGE = { id: 90, row_id: 1, field: 'personAddonPercent', old_value: '0', new_value: '5' };

test('UNDO PUTS THE PROFILE BACK and closes every entry of the same act', async () => {
  const { repo, ran } = loadPeopleRepo([
    [/SELECT person_id FROM tb_mastersheet/, [{ person_id: 'bram tevish' }]],
    [/FOR UPDATE/, [{ addon_percent: '5', fee_percent: '0' }]],
    [/UPDATE tb_people/, [{ addon_percent: '0', fee_percent: '0' }]],
    [/UPDATE tb_mastersheet_changes/, [{ id: 90 }, { id: 91 }]],
  ]);
  const out = await repo.revertProfileRate(CHANGE);
  assert.equal(out.ok, true);
  assert.deepEqual(out.covers, [90, 91]);
  const write = ran.find((q) => /UPDATE tb_people/.test(q.sql));
  assert.match(write.sql, /SET addon_percent = \$2/);
  assert.deepEqual(write.params, ['bram tevish', 0]);
  // The act's time is read in SQL by id: a JS Date loses the microseconds.
  const close = ran.find((q) => /UPDATE tb_mastersheet_changes/.test(q.sql));
  assert.match(close.sql, /changed_at = \(SELECT changed_at FROM tb_mastersheet_changes WHERE id = \$3\)/);
  assert.ok(ran.some((q) => /INSERT INTO tb_mastersheet_changes/.test(q.sql)), 'the undo itself was not logged');
});

test('A PROFILE THAT MOVED SINCE IS NOT PUT BACK over the later change', async () => {
  const { repo, ran } = loadPeopleRepo([
    [/SELECT person_id FROM tb_mastersheet/, [{ person_id: 'bram tevish' }]],
    [/FOR UPDATE/, [{ addon_percent: '8', fee_percent: '0' }]],
  ]);
  const out = await repo.revertProfileRate(CHANGE);
  assert.equal(out.ok, false);
  assert.match(out.reason, /8%/);
  assert.ok(!ran.some((q) => /UPDATE tb_people/.test(q.sql)));
});

test('THE FIRST EDIT NAMES THEM FROM THEIR DEALS, and never overwrites a chosen name', async () => {
  const { repo, ran } = loadPeopleRepo([[/INSERT INTO tb_people/, [{ display_name: 'Bram Tevish' }]]]);
  await repo.upsert({ personId: 'bram tevish', addonPercent: 2 }, { via: 'diane', batchId: 'b1' });
  const insert = ran.find((q) => /INSERT INTO tb_people/.test(q.sql));
  assert.match(insert.sql, /COALESCE\(\$2::text, \(SELECT person_name FROM tb_mastersheet/);
  assert.match(insert.sql, /display_name {2}= COALESCE\(\$2::text, tb_people\.display_name\)/);
  assert.equal(insert.params[1], null, 'the slug is sent as the name again');
});

test('the rate log carries who did it and the batch', async () => {
  const { repo, ran } = loadPeopleRepo([
    [/SELECT addon_percent, fee_percent FROM tb_people/, [{ addon_percent: '0', fee_percent: '0' }]],
    [/INSERT INTO tb_people/, [{ addon_percent: '2', fee_percent: '0' }]],
  ]);
  await repo.upsert({ personId: 'bram tevish', addonPercent: 2 }, { via: 'diane', batchId: 'b1' });
  const log = ran.find((q) => /INSERT INTO tb_mastersheet_changes/.test(q.sql));
  assert.deepEqual(log.params, ['bram tevish', 'personAddonPercent', '0', '2', 'diane', 'b1']);
});

test('A BATCH UNDO COUNTS A COVERED SIBLING AS DONE, not as a failure', async () => {
  let reverts = 0;
  const repo = loadWith(ROWS_REPO, {
    [DB]: {
      async query(sql) {
        if (/FROM tb_mastersheet_changes c/.test(sql)) {
          return { rows: [{ ...CHANGE, reverted_at: null, row_exists: true }] };
        }
        return { rows: [ROWS[0]] };
      },
    },
    [CACHE]: { createCache: () => ({ wrap: (k, fn) => fn(), invalidate() {} }) },
    [PEOPLE_REPO]: {
      async revertProfileRate() { reverts += 1; return { ok: true, covers: [90, 91, 92] }; },
    },
  });
  const { done, failed } = await repo.revertChangeBatch([90, 91, 92]);
  assert.equal(reverts, 1, 'the profile was put back more than once');
  assert.equal(done.length, 3);
  assert.equal(failed.length, 0);
});

// "add 3% to orla and ines" put Ines, on ONE deal, on the deal level.
test('ONE DEAL OR NINE, a person\'s rate with no deal named is their profile', async () => {
  const { tool, seen } = loadTools();
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'Dov Ashgrove', addonPercentDelta: 3, said: 'add 3% to dov ashgrove',
  });
  assert.equal(out.redirect.name, 'update_person');
  assert.match(out.summary, /PROFILE/);
  assert.equal(seen.updates.length, 0);
});

test('a deal named, by argument or in their own words, stays on the deal', async () => {
  const { tool } = loadTools();
  const byArg = await tool('update_master_sheet_row').handler({
    targetPerson: 'Bram Tevish', targetCompany: 'Co 1', addonPercent: 3, said: 'set it to 3%',
  });
  const bySaid = await tool('update_master_sheet_row').handler({
    targetPerson: 'Bram Tevish', addonPercent: 3, said: 'set bram tevish add on on co 1 to 3%',
  });
  for (const out of [byArg, bySaid]) {
    assert.doesNotMatch(out.summary, /update_person/);
  }
  assert.match(byArg.summary, /DEAL: add on 0% to 3%/);
});

test('a delta alone is a change, never "what should change?"', async () => {
  const { tool } = loadTools();
  const out = await tool('update_master_sheet_row').handler({
    id: 3, feePercentDelta: 1, said: 'add 1% to the fee on this deal',
  });
  assert.doesNotMatch(out.reply ?? out.summary, /what should change/);
  assert.match(out.summary, /fee 0% to 1%/);
});

test('"people" on the one deal tool names both tools that take several', () => {
  const { tool } = loadTools();
  const refusal = unknownArgs(tool('update_master_sheet_row'), { people: ['a', 'b'], addonPercentDelta: 3 });
  assert.match(refusal, /RATE for them is update_person with people/);
  assert.match(refusal, /bulk_update_master_sheet with people/);
});

/* ===============================
 * * A NAME SHE MADE UP IS NOBODY
 * ===============================
 * 2026-09-25. "set the add on for bram and orla quennell to 2%" was sent as
 * "Bram Quennell" and "Orla Quennell"; the sentence's longest name overrode
 * the first, and Orla was in the preview twice. */

function loadWithOrla(search) {
  const loaded = loadTools(search);
  ROWS.push(deal(9, 'Orla Quennell'));
  return { ...loaded, done: () => ROWS.pop() };
}

// As the live search did: the surname's trigrams reach Orla and nobody else.
const bySurname = (q) => ROWS.filter((r) => r.person_name.split(' ').slice(1).some((w) => q.includes(w)));

test('a name she made up is nobody, even when the search finds one person', async () => {
  const { tool, done } = loadWithOrla(bySurname);
  try {
    const out = await tool('update_person').handler({ person: 'Bram Quennell', addonPercent: 2, said: 'give bram quennell 2%' });
    assert.doesNotMatch(out.summary, /Orla Quennell/);
  } finally { done(); }
});

test('a name with a word the person does not have resolves to nobody', async () => {
  const { tool, seen, done } = loadWithOrla(bySurname);
  try {
    const out = await tool('update_person').handler({
      people: ['Bram Quennell', 'Orla Quennell'], addonPercent: 2,
      said: 'set the add on for bram and orla quennell to 2%',
    });
    assert.doesNotMatch(out.summary, /Orla Quennell's PROFILE[\s\S]*Orla Quennell's PROFILE/);
    assert.match(out.summary, /Bram Quennell/);
    // Orla WAS found, and saying nothing let her report Orla missing too.
    assert.match(out.summary, /Orla Quennell was found/);
    assert.equal(seen.upserts.length, 0);
  } finally { done(); }
});

test('TWO NAMES THAT ARE ONE PERSON ARE ASKED ABOUT, never written twice', async () => {
  const { tool, seen, done } = loadWithOrla();
  try {
    const out = await tool('update_person').handler({
      people: ['Orla', 'Orla Quennell'], addonPercent: 2, confirmed: true, said: 'yes',
    });
    assert.match(out.summary, /are both Orla Quennell/);
    assert.equal(seen.upserts.length, 0);
  } finally { done(); }
});

test('a first name alone still finds the one person it belongs to', async () => {
  const { tool, done } = loadWithOrla();
  try {
    const out = await tool('update_person').handler({ person: 'orla', addonPercent: 2, said: 'give orla 2%' });
    assert.match(out.summary, /Orla Quennell's PROFILE/);
  } finally { done(); }
});

test('"take 2% off" sent to the one deal tool comes back as the profile FEE preview', async () => {
  const { tool } = loadTools();
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'Bram Tevish', feePercentDelta: -2, said: 'take 2% off bram tevish',
  });
  assert.equal(out.redirect.name, 'update_person');
  assert.match(out.summary, /fee 0% to 2%/);
  assert.doesNotMatch(out.summary, /below zero/);
});

test('"take 2% off" someone already on a fee asks, replace or on top', async () => {
  const { tool } = loadTools();
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'Dov Ashgrove', feePercentDelta: -2, said: 'take 2% off dov ashgrove',
  });
  assert.match(out.summary, /REPLACES it \(fee stays 2%, nothing changes\) or goes ON TOP \(fee 2% to 4%\)/);
});

// "Give everyone at ZZ Rate Co A a 5% fee" became a profile fee reaching
// their deals on other companies too.
test('A COMPANY NAMED IS NEVER A PROFILE RATE when they hold deals elsewhere', async () => {
  const { tool, seen } = loadTools();
  const out = await tool('update_person').handler({
    people: ['Bram Tevish'], feePercent: 5, said: 'give everyone at co 1 a 5% fee',
  });
  assert.match(out.summary, /bulk_update_master_sheet with company "Co 1"/);
  assert.equal(seen.upserts.length, 0);
});

test('"people" on a READ tool is not told it edits one deal', () => {
  const { tool } = loadTools();
  const refusal = unknownArgs(tool('filter_master_sheet'), { people: ['a', 'b'] });
  assert.doesNotMatch(refusal, /edits ONE deal/);
});

test('"people" on a read tool names the doors that do take a person', () => {
  const { tool } = loadTools();
  const refusal = unknownArgs(tool('filter_master_sheet'), { people: ['dov ashgrove'] });
  assert.match(refusal, /bulk_answer_monthly_review, both with person/);
});

test('"TAKE 2% OFF" IS REMEMBERED AS THE FEE SHOWN, so "yes" never cuts the add on', async () => {
  const { tool } = loadTools();
  const out = await tool('update_person').handler({
    person: 'Bram Tevish', addonPercentDelta: -2, said: 'take 2% off bram tevish',
  });
  assert.match(out.summary, /fee 0% to 2%/);
  assert.deepEqual(out.redirect, { name: 'update_person', args: { person: 'Bram Tevish', feePercent: 2 } });
});

test('"ON TOP" ANSWERS THE FEE QUESTION IN CODE, whatever figure she sends back', async () => {
  const { tool } = loadTools();
  const asked = await tool('update_person').handler({ person: 'Dov Ashgrove', feePercentDelta: -1, said: 'take 1% off dov ashgrove' });
  assert.match(asked.summary, /REPLACES it \(fee 2% to 1%\) or goes ON TOP \(fee 2% to 3%\)/);
  // She sends the replace figure; they said on top.
  const out = await tool('update_person').handler({ person: 'Dov Ashgrove', feePercent: 1, said: 'on top' });
  assert.match(out.summary, /fee 2% to 3%/);
  assert.deepEqual(out.redirect.args, { person: 'Dov Ashgrove', feePercentDelta: 1 });
});

test('"REPLACE IT" answers it the other way', async () => {
  const { tool } = loadTools();
  await tool('update_person').handler({ person: 'Dov Ashgrove', feePercentDelta: -1, said: 'take 1% off dov ashgrove' });
  const out = await tool('update_person').handler({ person: 'Dov Ashgrove', feePercentDelta: 1, said: 'replace it' });
  assert.match(out.summary, /fee 2% to 1%/);
});
