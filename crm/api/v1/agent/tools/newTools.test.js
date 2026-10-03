const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');
const { currentMonth } = require('../../shared/presetMonth.helper');

// RELATIVE, never a literal date. A preset far from the business month is
// now refused as a guessed year, so a hardcoded `2026-08-01` passes today
// and fails the moment `npm run test:drift` runs the suite two years on.
// That is the drift suite doing its job, and the fix is to stop pinning a
// year rather than to widen the guard.
const PRESET = `${currentMonth()}-01`;
// The month after this one, for the "narrows by preset" case.
const NEXT_PRESET = (() => { const [y,m]=currentMonth().split("-").map(Number); return m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,"0")}-01`; })();

/**
 * ***************************************************
 * * The capabilities added 2026-08-28
 * ***************************************************
 *
 *   bulk_update_master_sheet   one change over a filtered set, in two calls
 *   explain_preset_rules       why a figure is what it is, and the setting
 *   list_concerns              what people raised, ONLY when asked
 *   undo_master_sheet_change   put one field back, ONLY when asked
 *   update_person              their profile, and the two percentages
 *   rename_company             which IS the merge
 *   update_company             tier, old group, notes, active or closed
 *
 * Every repo is stubbed, so this needs no database. What is pinned is the
 * shape of each answer and, for the two writes, that nothing lands until it
 * is meant to.
 */

function load({
  rows = [], total = null, concerns = [], revert = { ok: true, row: null }, endDate = false,
  rename = { renamed: 'X', dealsUpdated: 0 }, company = { name: 'X' }, peek = null,
  person = { display_name: 'X' },
  tiers = new Map(), plain = [], changes = [], options = null,
} = {}) {
  const toolPath = require.resolve('./masterSheet.js');
  const paths = {
    rowsRepo: require.resolve('../../repos/masterSheetRows.repo.js'),
    people: require.resolve('../../repos/people.repo.js'),
    companies: require.resolve('../../repos/companies.repo.js'),
    concerns: require.resolve('../../repos/concerns.repo.js'),
    settings: require.resolve('../../repos/settings.repo.js'),
    sockets: require.resolve('../../sockets/index.js'),
  };
  // THE CASCADE HELPER TOO. update_company goes through it now, and it
  // holds its OWN reference to the companies repo: left cached it keeps a
  // real one and the stub below is never reached.
  const helper = require.resolve('../../shared/companyStatus.helper.js');
  // AND THE NEAR MISS GUARD, for the same reason: it holds its own people
  // repo, and the company writes ask it "did you mean" since 2026-09-30.
  const nearMiss = require.resolve('./notAGroup.js');
  for (const p of [toolPath, helper, nearMiss, ...Object.values(paths)]) delete require.cache[p];

  const seen = {
    updated: [], reverted: null, findAll: null, findAllCalls: [], renamed: null,
    companyUpdate: null, upsert: null, batches: [], revertedAll: [], changeQuery: null,
  };

  require.cache[paths.rowsRepo] = stub({
    async findAll(args) {
      // EVERY CALL, not the last one. `filter_master_sheet` asks twice now:
      // once for the matches and once for the scope they came out of, so
      // "did the filter reach the query" has to look at the filtering call.
      seen.findAllCalls.push(args);
      seen.findAll = args;
      return { rows, total: total ?? rows.length };
    },
    async update(id, fields) {
      seen.updated.push({ id, fields });
      return { id, person_name: 'X' };
    },
    async updateMany(changes) {
      seen.batches.push(changes);
      return changes.map(({ id }) => ({ id, person_name: 'X' }));
    },
    async peekFieldChange() { return peek; },
    async revertFieldChange(id) { seen.reverted ??= id; seen.revertedAll.push(id); return revert; },
    async findFieldChanges(args) { seen.changeQuery = args; return changes; },
    async searchFuzzy() { return rows; },
  });
  require.cache[paths.people] = stub({
    async rateMap() { return new Map(); },
    async upsert(args) { seen.upsert = args; return person; },
    // Empty unless a test gives the lists, which is what every other test here was written against.
    async filterOptions() { return options ?? []; },
  });
  require.cache[paths.companies] = stub({
    async tierMap() { return tiers; },
    async findAllPlain() { return plain; },
    async rename(from, to) { seen.renamed = { from, to }; return rename; },
    async update(ckey, fields) { seen.companyUpdate = { ckey, fields }; return company; },
    // update_company READS THE COMPANY FIRST now, to tell a status that
    // ENDS it from one that does not: closing stops every deal on it, and
    // that needs a confirm the description alone was never giving.
    async findByKey() { return company; },
    // The cascade's own check. Nothing here is terminal unless a test says.
    isTerminal(status) { return ['closed', 'dissolved'].includes(status); },
    // All six, as the repo has them: update_company reads its enum off this.
    COMPANY_STATUS: {
      ACTIVE: 'active', GOING_CONCERN: 'going_concern', REVIEW: 'review',
      LIQUIDATION: 'liquidation', DISSOLVED: 'dissolved', CLOSED: 'closed',
    },
    isReviewedMonthly(status) { return ['liquidation', 'review'].includes(status); },
  });
  require.cache[paths.concerns] = stub({
    async listGrouped() { return { rows: concerns, total: concerns.length }; },
  });
  require.cache[paths.settings] = stub({ async get() { return { color_uses_end_date: endDate }; } });
  require.cache[paths.sockets] = { id: 'x', filename: 'x', loaded: true, exports: { broadcast() {} } };

  const { masterSheetTools } = require(toolPath);
  return { tool: (n) => masterSheetTools.find((t) => t.name === n), seen };
}

const row = (n, over = {}) => ({
  id: n, person_name: `P${n}`, company: 'Workforce', group_name: 'INDIGO', currency: 'GBP', ...over,
});

/* ===============================
 * * bulk update
 * =============================== */

test('the first call writes NOTHING and says what it would do', async () => {
  const { tool, seen } = load({ rows: [row(1), row(2), row(3)] });
  const out = await tool('bulk_update_master_sheet').handler({
    group: 'INDIGO', set: { presetOn: PRESET },
  });

  assert.equal(seen.updated.length, 0, 'nothing may be written before confirming');
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /3 rows/);
  assert.match(out.summary, /confirmed true/);
});

// 2026-09-25: unmarked, the runtime could not replay a "yes" to it, and a
// confirm she sent herself could not be checked against what was shown.
test('THE FIRST CALL IS A PENDING THE RUNTIME CAN RECOGNISE', async () => {
  const { tool } = load({ rows: [row(1), row(2), row(3)] });
  const out = await tool('bulk_update_master_sheet').handler({
    group: 'INDIGO', set: { presetOn: PRESET },
  });
  assert.equal(out.pending, true);
  assert.match(out.confirming, new RegExp(PRESET));
});

test('the second call writes every matching row', async () => {
  const { tool, seen } = load({ rows: [row(1), row(2), row(3)] });
  await tool('bulk_update_master_sheet').handler({
    group: 'INDIGO', set: { presetOn: PRESET }, confirmed: true,
  });

  assert.equal(seen.updated.length, 3);
  assert.deepEqual(seen.updated.map((u) => u.id), [1, 2, 3]);
  for (const u of seen.updated) assert.equal(u.fields.presetOn, PRESET);
});

test('a large confirmed change is one atomic repository batch', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => row(index + 1));
  const { tool, seen } = load({ rows });
  const out = await tool('bulk_update_master_sheet').handler({
    set: { presetOn: PRESET }, confirmed: true,
  });

  assert.equal(seen.updated.length, 0);
  assert.equal(seen.batches.length, 1);
  assert.equal(seen.batches[0].length, 20);
  assert.match(out.summary, /20 rows/);
});

test('the filter is passed to the repo, and `set` never leaks into it', async () => {
  const { tool, seen } = load({ rows: [row(1)] });
  await tool('bulk_update_master_sheet').handler({
    group: 'INDIGO', paymentMethod: 'cash', set: { presetOn: PRESET },
  });

  assert.equal(seen.findAll.group, 'INDIGO');
  assert.equal(seen.findAll.paymentMethod, 'cash');
  assert.equal(seen.findAll.set, undefined, 'the change is not a filter');
  assert.equal(seen.findAll.confirmed, undefined);
});

test('too many rows REFUSES rather than doing the first sixty', async () => {
  // A partial mass edit is worse than none: nobody can tell which half ran.
  const { tool, seen } = load({ rows: [row(1), row(2)], total: 400 });
  const out = await tool('bulk_update_master_sheet').handler({
    set: { presetOn: PRESET }, confirmed: true,
  });

  assert.equal(seen.updated.length, 0);
  assert.match(out.summary, /more than I change in one go/);
});

test('an empty change asks rather than writing nothing quietly', async () => {
  const { tool, seen } = load({ rows: [row(1)] });
  const out = await tool('bulk_update_master_sheet').handler({ group: 'INDIGO', set: {}, confirmed: true });
  assert.equal(seen.updated.length, 0);
  assert.match(out.summary, /Nothing to set/);
});

test('no match is said plainly, not treated as an error', async () => {
  const { tool } = load({ rows: [] });
  const out = await tool('bulk_update_master_sheet').handler({ group: 'NEXUS', set: { presetOn: PRESET } });
  assert.match(out.summary, /nothing to change/);
});

/* ===============================
 * * PAYMENT START IS NOT THE PRESET
 * =============================== */

test('the two date filters are DIFFERENT, and read differently', () => {
  // Asked which MILKMAN people have a payment start in a future month she
  // had no filter for it, improvised with presetWhen and answered ONE,
  // improvised again and answered TEN. The truth was EIGHT.
  const { tool } = load();
  const props = tool('filter_master_sheet').parameters.properties;

  assert.ok(props.paymentStartWhen, 'there is still no payment start filter');
  assert.deepEqual(props.paymentStartWhen.items.enum, ['past', 'this-month', 'future']);
  assert.deepEqual(props.presetWhen.items.enum, ['current', 'old', 'future']);
  // Named apart on purpose: "marked for a later month" and "not starting
  // until a later month" are two facts, and one wording for both is how
  // they got confused.
  assert.match(props.paymentStartWhen.description, /NOT the same as presetWhen/);
});

test('the filter reaches the repo rather than being dropped', async () => {
  const { tool, seen } = load({ rows: [row(1)] });
  await tool('filter_master_sheet').handler({ group: 'MILKMAN', paymentStartWhen: 'future' });
  assert.ok(
    seen.findAllCalls.some((c) => c.paymentStartWhen === 'future'),
    'it never got to the query',
  );
  // And the SCOPE call deliberately drops it, or the denominator would
  // equal the numerator and "30 of 30" would confirm anything.
  assert.ok(
    seen.findAllCalls.some((c) => c.paymentStartWhen === undefined && c.group === 'MILKMAN'),
    'the denominator applied the filter too',
  );
});

/* ===============================
 * * explain_preset_rules
 * =============================== */

test('the rules name the CURRENT end-date setting, both ways', async () => {
  const off = await load({ endDate: false }).tool('explain_preset_rules').handler({});
  assert.match(off.summary, /END DATE SETTING IS CURRENTLY OFF/);
  assert.match(off.summary, /NEVER drops a row/);
  assert.equal(off.endDateCounts, false);

  const on = await load({ endDate: true }).tool('explain_preset_rules').handler({});
  assert.match(on.summary, /END DATE SETTING IS CURRENTLY ON/);
  assert.equal(on.endDateCounts, true);
});

test("the colour rule is the boss's two cells, and says so", async () => {
  const out = await load().tool('explain_preset_rules').handler({});
  assert.match(out.summary, /Only two cells\s+decide it, the payment start and the preset/);
  assert.match(out.summary, /Not the amount, not the payable days/);
  for (const colour of ['RED', 'AMBER', 'GREEN']) assert.ok(out.summary.includes(colour));
});

test('the two rates are described in OPPOSITE directions', async () => {
  // Swapping them is the one mistake that turns income into a deduction.
  const out = await load().tool('explain_preset_rules').handler({});
  assert.match(out.summary, /AN ADD ON IS ADDED to what is owed/);
  assert.match(out.summary, /A FEE IS DEDUCTED/);
  assert.match(out.summary, /stacks/);
});

/* ===============================
 * * concerns, reactive only
 * =============================== */

test('concerns come back as a count and who, not a wall', async () => {
  const { tool } = load({
    concerns: [{
      person_id: 'p1', person_name: 'Nicola', group_name: 'INDIGO', concern_count: 2, latest_category: 'pay', latest_message: 'Not received',
    }],
  });
  const out = await tool('list_concerns').handler({});
  assert.match(out.summary, /1 person has something open/);
  assert.match(out.summary, /Nicola/);
  assert.match(out.summary, /Say the COUNT and who/);
});

test('nothing open is a plain sentence with no offer attached', async () => {
  const out = await load({ concerns: [] }).tool('list_concerns').handler({ group: 'INDIGO' });
  assert.match(out.summary, /Nothing open in INDIGO/);
  assert.match(out.summary, /Do not offer to look at anything else/);
});

test('she is told she cannot resolve a concern', async () => {
  const { tool } = load({
    concerns: [{ person_id: 'p1', person_name: 'A', group_name: 'INDIGO', concern_count: 1 }],
  });
  const out = await tool('list_concerns').handler({});
  assert.match(out.summary, /cannot resolve these/);
});

/* ===============================
 * * undo, reactive only
 * =============================== */

/**
 * UNDO NAMES THE ROW BEFORE IT TOUCHES IT.
 *
 * A live run reverted the wrong deal: asked to undo the last change in a
 * scratch group, she passed a change id belonging to a REAL row, and
 * Pino's preset moved from August to July. Silently out of the August
 * payout, with nothing on screen to say so.
 *
 * An id is the one argument she cannot sanity check, so the admin does.
 */
const PEEK = {
  id: 42, row_id: 73, field: 'presetOn', old_value: '2026-07-01', new_value: '2026-08-01',
  reverted_at: null, row_exists: true,
  person_name: 'Pino', company: 'Pino - Workforce', group_name: 'NEXUS',
};

test('UNDO ASKS FIRST, and names the person and the group', async () => {
  const { tool, seen } = load({ peek: PEEK, revert: { ok: true, row: { id: 73, person_name: 'Pino' } } });
  const out = await tool('undo_master_sheet_change').handler({ changeId: 42 });

  assert.equal(seen.reverted, null, 'it reverted on the FIRST call');
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /Pino/, 'the person must be named, or a wrong id is invisible');
  assert.match(out.summary, /NEXUS/, 'and the group');
  assert.match(out.summary, /2026-08-01.*2026-07-01/s, 'and both values');
});

test('undo puts one change back once CONFIRMED, and says what went where', async () => {
  const { tool, seen } = load({ peek: PEEK, revert: { ok: true, row: { id: 7, person_name: 'Nicola' } } });
  const out = await tool('undo_master_sheet_change').handler({ changeId: 42, confirmed: true });
  assert.equal(seen.reverted, 42);
  assert.match(out.summary, /Put back/);
  assert.match(out.summary, /Nicola/);
});

test('a refusal is an answer, never a failure', async () => {
  const { tool } = load({
    peek: { ...PEEK, reverted_at: '2026-08-31T00:00:00Z' },
    revert: { ok: false, reason: 'already undone' },
  });
  const out = await tool('undo_master_sheet_change').handler({ changeId: 42, confirmed: true });
  assert.match(out.summary, /already been undone/);
  assert.match(out.summary, /Say so plainly/);
});

test('a change id that does not exist is said, not reverted', async () => {
  const { tool, seen } = load({ peek: null });
  const out = await tool('undo_master_sheet_change').handler({ changeId: 999, confirmed: true });
  assert.equal(seen.reverted, null);
  assert.match(out.summary, /no change #999/);
});

test('both reactive tools tell her never to offer them', async () => {
  const { tool } = load();
  assert.match(tool('list_concerns').description, /ONLY when the admin asks/);
  assert.match(tool('list_concerns').description, /Never bring it up unprompted/);
  assert.match(tool('undo_master_sheet_change').description, /ONLY\s+when the admin asks/);
  assert.match(tool('undo_master_sheet_change').description, /Never suggest it/);
});

/* ===============================
 * * the active company list, asked for out loud
 * =============================== */

// `payment_period` is DERIVED BY THE REPO on every read, so a fixture
// without it is not a row this code ever sees: `isPeriodEnded` would find
// nothing to read and call every company live. Derived here with the same
// helper the SQL mirrors.
const { periodEnded } = require('../../shared/paymentPeriod.helper');

const dealOn = (company, over = {}) => {
  const r = row(1, {
    company, role: 'director', person_name: 'Dee', preset_on: '2026-08-01', end_on: null, ...over,
  });
  return { ...r, payment_period: periodEnded(r) ? 'ended' : 'active' };
};

// A CLIENT COMPANY, not Workforce: that is internal staff and groupTables
// keeps it off this table entirely. See INTERNAL_COMPANY.
const CLIENT = 'Souracore';

test('a company row carries director, mid, tier and old group', async () => {
  const { tool } = load({
    rows: [
      dealOn(CLIENT, { id: 1, role: 'director', person_name: 'Zayn' }),
      dealOn(CLIENT, { id: 2, role: 'mid', person_name: 'Abe' }),
    ],
    tiers: new Map([[CLIENT.toLowerCase(), 'Top co']]),
    plain: [{ name: CLIENT, old_group: 'Milky' }],
  });
  const out = await tool('active_companies').handler({ group: 'INDIGO' });

  // One list in the sheet check's format, never a card per company. 2026-09-30.
  assert.equal(out.cards, undefined);
  assert.equal(out.list.kind, 'companies');
  const [c] = out.list.rows;
  assert.equal(c.name, CLIENT);
  assert.match(c.dealsText, /director Zayn/);
  assert.match(c.dealsText, /mid Abe/);
  assert.equal(c.tier, 'Top co');
  assert.equal(c.oldGroup, 'Milky');
});

test('a company is live while ANY one deal is', async () => {
  // NOT LIVE means the preset formula says nothing is owed, which with the
  // end-date setting off is a payment start AFTER the preset month. An end
  // date on its own ends nothing, which is the whole correction.
  const { tool } = load({
    rows: [
      dealOn(CLIENT, { id: 1, payment_start_on: '2026-11-01' }),
      dealOn(CLIENT, { id: 2, payment_start_on: '2025-04-01' }),
      dealOn('Gone Ltd', { id: 3, payment_start_on: '2026-11-01' }),
    ],
  });
  const out = await tool('active_companies').handler({ group: 'INDIGO' });
  assert.deepEqual(out.list.rows.map((c) => c.name), [CLIENT]);
});

test('Diane leaves Workforce off it too, bare or prefixed', async () => {
  // She shares activeCompanies with the workbook builder rather than
  // copying it, so the one rule reaches both. That is what this pins.
  const { tool } = load({
    rows: [
      dealOn(CLIENT, { id: 1 }),
      dealOn('Workforce', { id: 2, person_name: 'Zayn' }),
      dealOn('Pino - Workforce', { id: 3, person_name: 'Pino' }),
    ],
  });
  const out = await tool('active_companies').handler({ group: 'NEXUS' });
  assert.deepEqual(out.list.rows.map((c) => c.name), [CLIENT]);
});

test('a month narrows by the row own preset', async () => {
  const { tool } = load({
    rows: [
      dealOn('August Co', { id: 1, preset_on: PRESET }),
      dealOn('September Co', { id: 2, preset_on: NEXT_PRESET }),
    ],
  });
  const out = await tool('active_companies').handler({ group: 'INDIGO', month: currentMonth() });
  assert.deepEqual(out.list.rows.map((c) => c.name), ['August Co']);
});

test('more than a dozen is still drawn, all of them in one list', async () => {
  const many = Array.from({ length: 15 }, (_, i) => dealOn('Co ' + String(i).padStart(2, '0'), { id: i + 1 }));
  const { tool } = load({ rows: many });
  const out = await tool('active_companies').handler({ group: 'INDIGO' });
  assert.equal(out.list.rows.length, 15);
  assert.match(out.summary, /15 active companies/);
});

test('no deals at all is said plainly, never an empty card list', async () => {
  const { tool } = load({ rows: [] });
  const out = await tool('active_companies').handler({ group: 'NEXUS' });
  assert.equal(out.cards, undefined);
  assert.match(out.summary, /No deals in NEXUS/);
});

test('every company finished says so, and offers the list anyway', async () => {
  const { tool } = load({ rows: [dealOn('Gone Ltd', { payment_start_on: '2026-11-01' })] });
  const out = await tool('active_companies').handler({ group: 'INDIGO' });
  assert.match(out.summary, /has finished its payment period/);
  assert.match(out.summary, /offer to list them anyway/);
});

test('she is told to ask for the group first', async () => {
  const { tool } = load();
  assert.match(tool('active_companies').description, /ASK FOR THE GROUP/);
});

/* ===============================
 * * correcting a person
 * =============================== */

const nic = (over = {}) => row(1, { person_id: 'nicola', person_name: 'Nicola', ...over });

test('a profile field is written against the resolved person id', async () => {
  const { tool, seen } = load({ rows: [nic()] });
  await tool('update_person').handler({ person: 'Nicola', email: 'n@x.com' });

  assert.equal(seen.upsert.personId, 'nicola');
  assert.equal(seen.upsert.email, 'n@x.com');
});

test('a fee percentage is validated here, not only at the route', async () => {
  // This does not go through the route that guards it, and a typo lands in
  // every export's breakdown.
  for (const bad of [-1, 101, Number.NaN, 'lots']) {
    const { tool, seen } = load({ rows: [nic()] });
    const out = await tool('update_person').handler({ person: 'Nicola', feePercent: bad });
    assert.equal(seen.upsert, null, `${bad} must not be written`);
    assert.match(out.summary, /between 0 and 100/);
  }
});

test('0 and 100 are both allowed', async () => {
  for (const ok of [0, 5, 100]) {
    // FROM 7%, so every one of the three is a real change. A rate that is
    // already the value asked for writes nothing and says so, which is a
    // different test.
    const { tool, seen } = load({ rows: [nic({ person_fee_percent: 7 })] });
    // CONFIRMED, because a rate takes the two call shape now. "Add 3%" was
    // written as "set to 3" over a 5% and reported as "is now 3%", which
    // never said it had been 5%. See rateChange.js.
    await tool('update_person').handler({ person: 'Nicola', feePercent: ok, confirmed: true });
    assert.equal(seen.upsert.feePercent, ok);
  }
});

test('A RATE ASKS FIRST, and the first call writes NOTHING', async () => {
  const { tool, seen } = load({ rows: [nic()] });
  const out = await tool('update_person').handler({ person: 'Nicola', feePercent: 9 });
  assert.equal(out.pending, true);
  assert.equal(seen.upsert, null, 'the unconfirmed call wrote');
});

test('THE PREVIEW NAMES THE LEVEL, THE FROM AND THE TO', async () => {
  // All three are the sentence that would have caught the incident:
  // "Zayn's PROFILE add on 5% to 3%".
  const { tool } = load({ rows: [nic()] });
  const out = await tool('update_person').handler({ person: 'Nicola', addonPercent: 9 });
  const line = (out.lines ?? []).join(' ');
  assert.match(line, /PROFILE/);
  assert.match(line, /add on .*% to 9%/);
});

test('the reply says a display name does NOT rewrite the sheet', async () => {
  // The company rename is the opposite and DOES rewrite every row. Saying
  // both the same way is how somebody thinks the sheet was corrected.
  const { tool } = load({ rows: [nic()], person: { display_name: 'Nicola Wong' } });
  const out = await tool('update_person').handler({ person: 'Nicola', displayName: 'Nicola Wong' });
  assert.match(out.summary, /master sheet rows still carry the old one/);
});

test('changing only the email says nothing about the sheet', async () => {
  const { tool } = load({ rows: [nic()] });
  const out = await tool('update_person').handler({ person: 'Nicola', email: 'n@x.com' });
  assert.ok(!/master sheet rows still carry/.test(out.summary));
});

test('two different people stop it before anything is written', async () => {
  const { tool, seen } = load({
    rows: [nic(), row(2, { person_id: 'nicolawong', person_name: 'Nicola Wong' })],
  });
  const out = await tool('update_person').handler({ person: 'Nic', email: 'x@y.com' });
  assert.equal(seen.upsert, null);
  assert.match(out.summary, /more than one person/);
  assert.match(out.summary, /Change nothing yet/);
});

test('an exact name ends the question, as everywhere else', async () => {
  const { tool, seen } = load({
    rows: [nic(), row(2, { person_id: 'nicolawong', person_name: 'Nicola Wong' })],
  });
  await tool('update_person').handler({ person: 'Nicola', email: 'x@y.com' });
  assert.equal(seen.upsert.personId, 'nicola');
});

test('nobody matching is said plainly', async () => {
  const { tool, seen } = load({ rows: [] });
  const out = await tool('update_person').handler({ person: 'Nobody', email: 'x@y.com' });
  assert.equal(seen.upsert, null);
  assert.match(out.summary, /Nobody on the sheet matches/);
});

test('updating nothing asks rather than writing', async () => {
  const { tool, seen } = load({ rows: [nic()] });
  const out = await tool('update_person').handler({ person: 'Nicola' });
  assert.equal(seen.upsert, null);
  assert.match(out.summary, /Nothing to change/);
});

test('she is told which rate goes which way, and that she cannot create a person', async () => {
  const { tool } = load();
  // PINNED TO THE ONE DEFINITION, not to its wording. This spelled the
  // sentence out, so the tool and the prompt could drift apart without
  // going red, which is exactly what they had done: her prompt still said
  // "THE FEE IS ADDED, NEVER DEDUCTED", the pre-047 meaning.
  const { RATE_DIRECTIONS } = require('../../shared/rates.helper');
  assert.ok(tool('update_person').description.includes(RATE_DIRECTIONS));
  assert.match(RATE_DIRECTIONS, /ADD ON is income on top/);
  assert.match(RATE_DIRECTIONS, /FEE is taken off after it/);
  assert.match(tool('update_person').description, /cannot create a person/);
  const { masterSheetTools } = require('./masterSheet.js');
  assert.ok(!masterSheetTools.some((t) => /create_person|add_person/.test(t.name)));
});

/* ===============================
 * * correcting a company, never inventing one
 * =============================== */

test('A RENAME ASKS FIRST, because it rewrites every deal carrying the name', async () => {
  // "Always confirm first" lived in the description and was not a guard.
  // Real transcript: she asked, was never answered, and then described the
  // deals as already carrying the new name. They did not.
  const { tool, seen } = load({ rename: { renamed: 'Relia PA', dealsUpdated: 4 } });
  const out = await tool('rename_company').handler({ name: 'Relia Pa', newName: 'Relia PA' });

  // `null` is the untouched value the harness starts it at, not undefined.
  assert.equal(seen.renamed, null, 'it renamed on the FIRST call');
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /DO NOT describe it as done/);
  assert.equal(out.pending, true);
});

test('a rename carries onto every deal once CONFIRMED, and the count is reported', async () => {
  const { tool, seen } = load({ rename: { renamed: 'Relia PA', dealsUpdated: 4 } });
  const out = await tool('rename_company')
    .handler({ name: 'Relia Pa', newName: 'Relia PA', confirmed: true });

  assert.deepEqual(seen.renamed, { from: 'Relia Pa', to: 'Relia PA' });
  assert.match(out.summary, /Renamed "Relia Pa" to "Relia PA"/);
  assert.match(out.summary, /4 deals now carry/);
});

test('a CASE-ONLY rename still runs, because that is the merge', async () => {
  // "Relia Pa" to "Relia PA" is the commonest real rename there is. A guard
  // that folded case refused exactly the case it exists for.
  const { tool, seen } = load({ rename: { renamed: 'Relia PA', dealsUpdated: 2 } });
  await tool('rename_company')
    .handler({ name: 'Relia Pa', newName: 'Relia PA', confirmed: true });
  assert.deepEqual(seen.renamed, { from: 'Relia Pa', to: 'Relia PA' });
});

test('renaming to the IDENTICAL name changes nothing', async () => {
  const { tool, seen } = load();
  const out = await tool('rename_company').handler({ name: 'Workforce', newName: ' Workforce ' });
  assert.equal(seen.renamed, null, 'nothing may be written');
  assert.match(out.summary, /already spelled that way/);
});

test('an empty new name is refused rather than written', async () => {
  const { tool, seen } = load();
  const out = await tool('rename_company').handler({ name: 'Workforce', newName: '  ' });
  assert.equal(seen.renamed, null);
  assert.match(out.summary, /cannot be empty/);
});

test('she is told she cannot create a company', async () => {
  const { tool } = load();
  assert.match(tool('rename_company').description, /cannot create a company/);
  assert.match(tool('rename_company').description, /use add_deal/);
  // And there is no tool that would let her.
  const { masterSheetTools } = require('./masterSheet.js');
  assert.ok(!masterSheetTools.some((t) => /create_company|add_company/.test(t.name)));
});

test('tier and old group are updated, and an empty string CLEARS', async () => {
  const { tool, seen } = load({ company: { name: 'Reliapay' } });
  await tool('update_company').handler({ name: 'Reliapay', tier: 'T2', oldGroup: '' });

  assert.equal(seen.companyUpdate.ckey, 'reliapay', 'matched on the folded name');
  assert.equal(seen.companyUpdate.fields.tier, 'T2');
  assert.equal(seen.companyUpdate.fields.oldGroup, '', 'empty means clear it, not "not mentioned"');
});

test('a field not mentioned is not sent at all', async () => {
  // undefined is "leave it alone" and the repo keeps that apart from ''.
  //
  // A TIER, NOT A STATUS. This used 'closed', which now needs a confirm
  // before anything is written, so it was testing the guard rather than
  // the field filtering it is about.
  const { tool, seen } = load({ company: { name: 'Reliapay' } });
  await tool('update_company').handler({ name: 'Reliapay', tier: 'T2' });
  assert.deepEqual(Object.keys(seen.companyUpdate.fields), ['tier']);
});

test('CLOSING A COMPANY WRITES NOTHING WITHOUT A CONFIRM', async () => {
  // Its only guard was the words "Confirm before closing" in a parameter
  // description. The route cascades now, so that sentence stood between a
  // typo and everybody on the company being stopped.
  const { tool, seen } = load({ company: { name: 'Reliapay', status: 'active' } });
  const out = await tool('update_company').handler({ name: 'Reliapay', status: 'closed' });
  assert.equal(seen.companyUpdate, null, 'nothing may be written on the first call');
  assert.equal(out.pending, true);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /STOP/);
});

test('AND WRITES ONCE CONFIRMED', async () => {
  const { tool, seen } = load({ company: { name: 'Reliapay', status: 'active' } });
  await tool('update_company').handler({ name: 'Reliapay', status: 'closed', confirmed: true });
  assert.equal(seen.companyUpdate.fields.status, 'closed');
});

test('LIQUIDATION NEEDS NO CONFIRM. It stops nothing', async () => {
  // A confirm on a harmless change is the click that teaches people not to
  // read them. Liquidation keeps paying, at amounts set per deal.
  const { tool, seen } = load({ company: { name: 'Reliapay', status: 'active' } });
  const out = await tool('update_company').handler({ name: 'Reliapay', status: 'liquidation' });
  assert.notEqual(seen.companyUpdate, null, 'it writes straight away');
  assert.notEqual(out.pending, true);
});

test('AND NEITHER DOES A NOTE ON AN ALREADY CLOSED COMPANY', async () => {
  // Only on the way IN. Re-asking about a cascade that already happened is
  // a dialog that means nothing.
  const { tool, seen } = load({ company: { name: 'Reliapay', status: 'closed' } });
  await tool('update_company').handler({ name: 'Reliapay', notes: 'gone in June' });
  assert.notEqual(seen.companyUpdate, null);
});

test('updating nothing asks rather than writing', async () => {
  const { tool, seen } = load({ company: { name: 'Reliapay' } });
  const out = await tool('update_company').handler({ name: 'Reliapay' });
  assert.equal(seen.companyUpdate, null);
  assert.match(out.summary, /Nothing to change/);
});

// 2026-09-30: the enum was four values written out while the repo had six.
test('update_company TAKES EVERY STATUS THE REPO HAS', () => {
  const { tool } = load();
  assert.deepEqual(
    tool('update_company').parameters.properties.status.enum,
    ['active', 'going_concern', 'review', 'liquidation', 'dissolved', 'closed'],
  );
});

test('GOING CONCERN AND REVIEW STOP NOTHING, so they write without a confirm', async () => {
  for (const status of ['going_concern', 'review']) {
    const { tool, seen } = load({ company: { name: 'Reliapay', status: 'active' } });
    const out = await tool('update_company').handler({ name: 'Reliapay', status });
    assert.equal(seen.companyUpdate.fields.status, status);
    assert.notEqual(out.pending, true, status);
  }
});

test('A LIQUIDATION TOTAL IS PREVIEWED, naming the figure and what it does NOT do', async () => {
  const { tool, seen } = load({ company: { name: 'Reliapay', status: 'liquidation', monthly_totals: { GBP: 900 } } });
  const out = await tool('update_company').handler({ name: 'Reliapay', liquidationTotal: '12,500' });
  assert.equal(seen.companyUpdate, null, 'nothing before the yes');
  assert.equal(out.pending, true);
  assert.match(out.summary, /liquidation total to GBP 12,500.00/);
  assert.match(out.summary, /does NOT change any per deal amount/);

  const yes = load({ company: { name: 'Reliapay', status: 'liquidation' } });
  await yes.tool('update_company').handler({ name: 'Reliapay', liquidationTotal: '12,500', confirmed: true });
  assert.equal(yes.seen.companyUpdate.fields.liquidationTotal, '12500');
});

test('A LIQUIDATION TOTAL THAT IS NOT A NUMBER IS REFUSED', async () => {
  const { tool, seen } = load({ company: { name: 'Reliapay' } });
  const out = await tool('update_company').handler({ name: 'Reliapay', liquidationTotal: 'about 12k', confirmed: true });
  assert.equal(seen.companyUpdate, null);
  assert.match(out.summary, /not an amount/);
});

test('A MISSPELT COMPANY GETS "DID YOU MEAN", on update and on rename', async () => {
  const options = { groups: [], companies: ['Reliapay', 'Workforce'] };
  const { tool, seen } = load({ company: null, options });
  const out = await tool('update_company').handler({ name: 'Reliapy', tier: 'T2', said: 'set Reliapy to T2' });
  assert.match(out.summary, /closest is "Reliapay"/);
  assert.equal(seen.companyUpdate, null);

  const renamed = await tool('rename_company').handler({ name: 'Workforse', newName: 'Workforce Ltd', said: 'rename Workforse to Workforce Ltd' });
  assert.match(renamed.summary, /closest is "Workforce"/);
  assert.equal(seen.renamed, null);
});

test('an unknown company is said plainly', async () => {
  const { tool } = load({ company: null });
  const out = await tool('update_company').handler({ name: 'Nowhere Ltd', tier: 'T2' });
  assert.match(out.summary, /No company called "Nowhere Ltd"/);
});

/* ===============================
 * * the filters she was missing
 * =============================== */

test('currency, method and a named search column reach the repo', async () => {
  const { tool, seen } = load({ rows: [row(1)] });
  await tool('filter_master_sheet').handler({
    group: 'MILKMAN', currency: 'AED', paymentMethod: 'crypto', q: 'Manchester', searchField: 'location',
  });

  // The FILTERING call, not the scope call the denominator makes.
  const filtered = seen.findAllCalls.find((c) => c.currency === 'AED');
  assert.ok(filtered, 'the currency never got to the query');
  assert.equal(filtered.paymentMethod, 'crypto');
  assert.equal(filtered.searchField, 'location');
  assert.equal(filtered.q, 'Manchester');
});

test('the spoken sentence names the column that was searched', async () => {
  // "matching Manchester" is a different claim from "with Manchester in
  // the location", and she says one of them out loud.
  const { tool } = load({ rows: Array.from({ length: 9 }, (_, i) => row(i + 1)) });
  const out = await tool('filter_master_sheet').handler({
    group: 'MILKMAN', q: 'Manchester', searchField: 'location',
  });
  assert.match(out.summary, /with "Manchester" in the location/);
});

/* ===============================
 * * WHY, not just whether
 * =============================== */

// "Why is Richard not payable this month" was answered with the general
// rule, word for word, twice in one conversation. It is not a computed
// reply any more: the general paragraph is one option in the summary, and
// a question about ONE ROW is explicitly not what it answers.
test('the rules are no longer the terminal reply', async () => {
  const out = await load().tool('explain_preset_rules').handler({});
  assert.equal(out.computedReply, undefined, 'a rule is not a finished sentence for every question');
  assert.equal(out.reply, undefined);
});

test('the general answer is offered, and named as the GENERAL one', async () => {
  const out = await load().tool('explain_preset_rules').handler({});
  assert.match(out.summary, /IF THEY ASKED THE GENERAL QUESTION/);
  assert.match(out.summary, /What goes into a month's total, both must be true/);
});

test('and a question about ONE ROW is told that is not the answer', async () => {
  const out = await load().tool('explain_preset_rules').handler({});
  assert.match(out.summary, /IF THEY ASKED ABOUT ONE ROW OR ONE PERSON/);
  assert.match(out.summary, /NOT the answer/);
});

/**
 * ===============================
 * * A TOOL THAT CAN SAY "PENDING" MUST BE ABLE TO HEAR "CONFIRMED"
 * ===============================
 * Live 2026-09-24. The rate confirm was added to `update_person` and the
 * `confirmed` parameter was not. So the first call came back pending, she
 * called it again with confirmed, `knownArgs` refused the argument as a
 * filter that does not exist, and she told the admin it was done.
 *
 * Nothing was written and nothing could have been. The two halves of the
 * two call shape have to ship together, so this reads the SOURCE for the
 * pairing rather than trusting anyone to remember.
 */
test('`confirmed` is never written as a column', () => {
  // Left in the rest spread it reaches the repo as a field to save.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'masterSheet.js'), 'utf8');
  // Only the schema's own fields are read, so no argument the runtime adds can leak in.
  assert.match(src, /const NOT_FIELDS = new Set\(\['person', 'people', 'group', 'confirmed'\]\);/);
  assert.match(src, /Object\.keys\(updatePerson\.parameters\.properties\)/);
});

/**
 * ===============================
 * * A GROUP NAME SENT AS THE COMPANY
 * ===============================
 * Live 2026-09-24. Zayn holds two deals, BOTH on the company "Workforce",
 * one in INDIGO and one in MILKMAN. So the only way to name one of them
 * is by its GROUP, which is exactly what the admin did.
 *
 *   admin  "on Zayn's deal on milkman, at 3%"
 *   Diane  targetCompany: "MILKMAN"
 *          "There is no deal for Zayn with the company named MILKMAN
 *           exactly. There might be a slight difference in spelling."
 *
 * There was no spelling difference, and her prompt already says to check
 * the group name before the company. Asked twice, she sent it twice.
 */
test('a GROUP in the company slot finds the deal anyway', async () => {
  const zayn = [
    row(1, { person_name: 'Zayn', company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' }),
    row(2, { person_name: 'Zayn', company: 'Workforce', group_name: 'MILKMAN', role_label: 'Tech' }),
  ];
  const { tool, seen } = load({ rows: zayn });
  await tool('update_master_sheet_row').handler({
    targetPerson: 'Zayn', targetCompany: 'MILKMAN', payableDays: 3, said: 'zayn on milkman', saidRecent: 'set his payable days to 3', confirmed: true,
  });
  assert.deepEqual(seen.updated.map((u) => u.id), [2], 'the MILKMAN deal was not reached');
});

test('a real company name is untouched by that', async () => {
  const zayn = [
    row(1, { person_name: 'Zayn', company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' }),
    row(2, { person_name: 'Zayn', company: 'Acqua', group_name: 'MILKMAN', role_label: 'Tech' }),
  ];
  const { tool, seen } = load({ rows: zayn });
  await tool('update_master_sheet_row').handler({
    targetPerson: 'Zayn', targetCompany: 'Acqua', payableDays: 3, said: 'zayn on acqua', saidRecent: 'set his payable days to 3', confirmed: true,
  });
  assert.deepEqual(seen.updated.map((u) => u.id), [2]);
});

test('a word matching NOTHING names the deals they do hold', async () => {
  // "No deal matching NEXUS" alone left her asking about spelling, which
  // is a dead end: the company, the group and the role were all checked.
  const zayn = [
    row(1, { person_name: 'Zayn', company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' }),
  ];
  const { tool, seen } = load({ rows: zayn });
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'Zayn', targetCompany: 'NEXUS', payableDays: 3, said: 'zayn on nexus', saidRecent: 'set his payable days to 3',
  });
  assert.equal(seen.updated.length, 0);
  assert.match(out.summary, /Workforce · INDIGO · Tech/);
  assert.match(out.summary, /not a typo/);
});

// A bulk rate said "to 1" and never where each row stood: a row on 3% would
// have dropped to 1% unseen. The other two doors name FROM and TO. 2026-09-25.
test('A BULK RATE NAMES EACH ROW\'S FROM AND TO', async () => {
  const { tool } = load({ rows: [row(1, { addon_percent: 3 }), row(2, { addon_percent: 0 })] });
  const out = await tool('bulk_update_master_sheet').handler({
    group: 'INDIGO', set: { addonPercent: 1 },
  });
  assert.match(out.summary, /P1 · Workforce · INDIGO · DEAL add on 3% to 1%/);
  assert.match(out.summary, /P2 · Workforce · INDIGO · DEAL add on 0% to 1%/);
});

// 2026-09-28: setting a tier read back "said to ..., turn to [object Object]":
// every argument the runtime injects was taken as a field to change.
test('update_company CHANGES ONLY THE FIELDS IT DECLARES, never the runtime\'s', async () => {
  const { tool, seen } = load({ rows: [] });
  const out = await tool('update_company').handler({
    name: 'Workforce', tier: 'T3', said: 'set the tier to T3', saidRecent: 'x', turn: { wrote: new Map() }, onProgress: () => {},
  });
  assert.deepEqual(Object.keys(seen.companyUpdate?.fields ?? {}), ['tier']);
  assert.doesNotMatch(String(out.summary ?? '') + String(out.reply ?? ''), /said|saidRecent|onProgress|object Object/);
});

// Nothing deletes a person or a company (2026-09-14). "Delete the person Suki"
// was offered as deleting her deal. 2026-09-28.
test('DELETING A PERSON OR A COMPANY IS REFUSED, a deal is not', async () => {
  const { tool } = load({ rows: [row(1)] });
  for (const said of ['delete the person Suki Varnell', 'remove the company ZZ Close Co']) {
    const out = await tool('delete_master_sheet_row').handler({ people: ['Suki Varnell'], said });
    assert.match(out.summary, /Nothing in the CRM deletes a person or a company/, said);
  }
  const deal = await tool('delete_master_sheet_row').handler({ people: ['P1'], said: "remove P1's deal at Workforce" });
  assert.doesNotMatch(deal.summary, /deletes a person/);
});

// 2026-09-28: "undo the tier change" could not be done: company details were not
// logged. Now they are, and undo puts the COMPANY back after naming it.
const TIER_AT = '2026-09-28T10:00:00.000Z';
const COMPANIES = { groups: ['INDIGO'], companies: ['Workforce', 'Acqua'], people: [] };
const tierChange = (id, company, over = {}) => ({
  id, field: 'companyTier', company, old_value: 'T2', new_value: 'T3', changed_at: TIER_AT, ...over,
});

test('UNDOING A COMPANY DETAIL NAMES IT, THEN PUTS THE COMPANY BACK ONCE', async () => {
  // Two entries: one tier change logged on each of Workforce's two deals.
  const changes = [tierChange(7, 'Workforce'), tierChange(8, 'Workforce')];
  const first = load({ rows: [], changes, options: COMPANIES });
  const asked = await first.tool('undo_master_sheet_change').handler({ said: 'undo the tier change on Workforce' });
  assert.equal(asked.pending, true);
  assert.match(asked.summary, /Workforce: COMPANY tier back from "T3" to "T2"/);
  assert.equal(first.seen.reverted, null, 'nothing before the yes');

  // The "yes" carries no field: it is read from the message before it.
  const second = load({ rows: [], changes, options: COMPANIES });
  const done = await second.tool('undo_master_sheet_change').handler({
    said: 'yes', saidRecent: 'undo the tier change on Workforce. yes', confirmed: true,
  });
  assert.deepEqual(second.seen.revertedAll, [7], 'one revert per company, which covers its other deals');
  assert.match(done.reply, /Workforce: COMPANY tier is back to T2./);
});

// 2026-09-28: "give me the bank sheet for NEXUS" reached for special case on one
// row. A pay or special case switch nobody named is refused, on the single tool too.
test('THE SINGLE ROW TOOL REFUSES A MONEY SWITCH NOBODY NAMED', async () => {
  const { tool, seen } = load({ rows: [row(1)] });
  const out = await tool('update_master_sheet_row').handler({
    targetPerson: 'P1', specialCaseDeal: true, said: 'give me the bank sheet for NEXUS', saidRecent: 'give me the bank sheet for NEXUS',
  });
  assert.match(out.summary, /They never said to change special case deal/);
  assert.equal(seen.updated.length, 0);
});

// 2026-09-28: "undo the tier change" named no company, fell through, and proposed
// undoing two deals' stop dates. A tier lives only on a company.
test('UNDOING A TIER NEEDS NO COMPANY NAMED, and reaches every company in that act', async () => {
  const changes = [tierChange(3, 'Workforce'), tierChange(4, 'Acqua'), tierChange(2, 'Acqua', { changed_at: '2026-09-27T10:00:00.000Z' })];
  const { tool, seen } = load({ rows: [], changes, options: COMPANIES });
  const out = await tool('undo_master_sheet_change').handler({ said: 'undo the tier change', batch: true });
  assert.equal(seen.changeQuery.company, null);
  assert.match(out.summary, /Workforce: COMPANY tier/);
  assert.match(out.summary, /Acqua: COMPANY tier/);
  assert.match(out.summary, /2 companies/);
  assert.equal(seen.reverted, null, 'nothing put back');
  const yes = load({ rows: [], changes, options: COMPANIES });
  await yes.tool('undo_master_sheet_change').handler({ said: 'yes', saidRecent: 'undo the tier change. yes', confirmed: true });
  assert.deepEqual(yes.seen.revertedAll, [3, 4], 'the older act is left alone');
});

test('A COMPANY STATUS IS NOT UNDONE FROM THE LOG, and says what does', async () => {
  const { tool, seen } = load({ rows: [], options: COMPANIES });
  const out = await tool('undo_master_sheet_change').handler({ said: 'undo the status change on Workforce' });
  assert.match(out.summary, /STATUS is not undone/);
  assert.equal(seen.reverted, null);
});

test('NO SUCH CHANGE IS SAID, never put back from something else', async () => {
  const { tool, seen } = load({ rows: [], options: COMPANIES, changes: [{ id: 9, field: 'presetOn', company: 'Workforce', changed_at: TIER_AT }] });
  const out = await tool('undo_master_sheet_change').handler({ said: 'undo the tier change on Workforce' });
  assert.match(out.summary, /NOTHING HAS BEEN PUT BACK\. No COMPANY tier change on Workforce/);
  assert.equal(seen.reverted, null);
});

// 2026-09-28: a setting tool must not "undo" by guessing the old value. A status is
// not logged, so reopening a company stays with update_company.
test('UPDATE_COMPANY SENDS A LOGGED UNDO TO THE UNDO TOOL, never a status', async () => {
  const { tool, seen } = load({ rows: [] });
  const tier = await tool('update_company').handler({ name: 'Workforce', tier: '', said: 'undo the tier change on Workforce' });
  assert.match(tier.summary, /Call undo_master_sheet_change/);
  assert.equal(seen.companyUpdate, null);
  const reopen = await tool('update_company').handler({ name: 'Workforce', status: 'active', said: 'undo the closure of Workforce' });
  assert.doesNotMatch(reopen.summary ?? '', /Call undo_master_sheet_change/);
});
