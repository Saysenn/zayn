const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');
const { currentMonth } = require('../../shared/presetMonth.helper');

// ***************************************************
// * Several NAMED deals' money in one act
// ***************************************************
//
// Asked for 2026-09-25: "make Orla's Co B deal and Bram's Co B deal a special
// case", "add 500 on Suki's payable amount and 750 on Ines's". Each deal is
// its own line with its figure from and to; over a filter both stay refused.

const MONTH = currentMonth();
const [Y, M] = MONTH.split('-').map(Number);
const NEXT = M === 12 ? `${Y + 1}-01-01` : `${Y}-${String(M + 1).padStart(2, '0')}-01`;

const deal = (id, person, company, over = {}) => ({
  id,
  person_id: person.toLowerCase(),
  person_name: person,
  company,
  group_name: 'ZZTEST',
  currency: 'GBP',
  monthly_amount: '1000',
  payable_amount: '1000',
  payable_days: 30,
  preset_on: `${MONTH}-01`,
  payment_start_on: `${Y - 1}-01-01`,
  special_case_deal: false,
  ...over,
});

const FUTURE = { payment_start_on: NEXT, payable_days: 0, payable_amount: '0' };
const ROWS = [
  deal(1, 'Orla Quennell', 'Co A'),
  deal(2, 'Orla Quennell', 'Co B', FUTURE),
  deal(3, 'Bram Tevish', 'Co B', { ...FUTURE, monthly_amount: '500' }),
  deal(4, 'Suki Varnell', 'Co A', { monthly_amount: '3000', payable_amount: '3000' }),
  deal(5, 'Ines Pardew', 'Co A', { monthly_amount: '1100', payable_amount: '1100' }),
  deal(6, 'Ines Pardew', 'Close Co', { monthly_amount: '400', payable_amount: '400' }),
];

/**
 * ===============================
 * * AUTO MODE IS PINNED OFF, and that is not tidiness
 * ===============================
 * `invokeTool` reads `agent_auto_confirm` before it runs an allow listed
 * write, so with auto mode ON in whatever database the suite happens to
 * point at, the two call flow legitimately does not happen and every test
 * that asserts a pending fails.
 *
 * It caught this on 2026-09-29, the day the switch was built: the suite
 * went red the moment he turned it on in the browser. A test whose outcome
 * depends on a row somebody toggled is not a test, so the setting is
 * stubbed here and the confirm flow is asserted against a known answer.
 */
function pinAutoConfirmOff() {
  const settingsPath = require.resolve('../../repos/settings.repo.js');
  const real = require(settingsPath);
  require.cache[settingsPath].exports = { ...real, agentAutoConfirm: async () => false };
}

function loadTool() {
  pinAutoConfirmOff();
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  for (const p of [toolPath, repoPath]) delete require.cache[p];
  const wrote = [];
  require.cache[repoPath] = stub({
    async findAll() { return { rows: ROWS, total: ROWS.length }; },
    async update(id, fields) { wrote.push({ id, fields }); return { id }; },
    async updateMany(changes) { for (const c of changes) wrote.push(c); return changes.map(({ id }) => ({ id })); },
    async searchFuzzy({ q }) { return ROWS.filter((r) => r.person_name.toLowerCase().includes(String(q).toLowerCase())); },
    async findById(id) { return ROWS.find((r) => r.id === Number(id)) ?? null; },
  });
  const tool = require(toolPath).masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');
  return { tool, wrote };
}

test('TWO NAMED DEALS BECOME SPECIAL CASES, each line naming what it adds', async () => {
  const { tool, wrote } = loadTool();
  const perPerson = [
    { person: 'Orla Quennell', company: 'Co B', set: { specialCaseDeal: true } },
    { person: 'Bram Tevish', company: 'Co B', set: { specialCaseDeal: true } },
  ];
  const out = await tool.handler({ perPerson, said: 'make orla co b and bram co b special cases' });
  assert.equal(out.pending, true);
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /Orla Quennell at Co B in ZZTEST: special case ON for \w+ \d{4}, adding GBP 1,000/);
  assert.match(out.summary, /Bram Tevish at Co B in ZZTEST: special case ON for \w+ \d{4}, adding GBP 500/);
  assert.doesNotMatch(out.summary, /Orla Quennell at Co A/, 'her other deal was reached');

  await tool.handler({ perPerson, confirmed: true, said: 'yes' });
  assert.deepEqual(wrote.map((w) => w.id).sort(), [2, 3]);
  // The payable follows: a special case pays the full month.
  assert.equal(Number(wrote.find((w) => w.id === 2).fields.payableAmount), 1000);
});

test('AN AMOUNT ADDED to each named deal\'s payable, from and to', async () => {
  const { tool, wrote } = loadTool();
  const perPerson = [
    { person: 'Suki Varnell', add: { payableAmount: 500 } },
    { person: 'Ines Pardew', company: 'Co A', add: { payableAmount: 750 } },
  ];
  const out = await tool.handler({ perPerson, said: 'add 500 to suki payable and 750 to ines' });
  assert.match(out.summary, /Suki Varnell at Co A in ZZTEST: payable amount GBP 3,000 to GBP 3,500/);
  assert.match(out.summary, /Ines Pardew at Co A in ZZTEST: payable amount GBP 1,100 to GBP 1,850/);

  await tool.handler({ perPerson, confirmed: true, said: 'yes' });
  assert.equal(wrote.find((w) => w.id === 4).fields.payableAmount, 3500);
  assert.equal(wrote.find((w) => w.id === 5).fields.payableAmount, 1850);
  assert.equal(wrote.some((w) => w.id === 6), false, 'her other deal moved');
});

test('A PERSON WITH SEVERAL DEALS IS ASKED WHICH, and nothing is written for anyone', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [
      { person: 'Suki Varnell', add: { payableAmount: 500 } },
      { person: 'Ines Pardew', add: { payableAmount: 750 } },
    ],
    confirmed: true,
    said: 'add 500 to suki and 750 to ines',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /Ines Pardew holds 2 deals: Co A.*Close Co/);
});

test('a company they hold no deal on is named back with the ones they do', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Suki Varnell', company: 'Co Z', set: { specialCaseDeal: true } }],
    said: 'make suki at co z a special case',
  });
  assert.match(out.summary, /holds no deal on Co Z\. Their deals are: Co A/);
});

test('OVER A FILTER, both stay refused and point at the named path', async () => {
  const { tool, wrote } = loadTool();
  for (const set of [{ specialCaseDeal: true }, { payableAmount: 500 }]) {
    // eslint-disable-next-line no-await-in-loop
    const out = await tool.handler({ group: 'ZZTEST', set, confirmed: true });
    assert.match(out.summary, /perPerson`, one entry per deal/);
  }
  assert.equal(wrote.length, 0);
});

test('an add on something that cannot be added to is refused by name', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({ perPerson: [{ person: 'Suki Varnell', add: { presetOn: 1 } }], said: 'x' });
  assert.match(out.summary, /"presetOn" cannot be added to/);
});

// "add 500 on suki's payable" was written as payable SET to 500, at once.
test('AN AMOUNT TO ADD, SENT AS A SET, IS REFUSED on every door', async () => {
  const { tool, wrote } = loadTool();
  const said = 'add 500 on suki varnell payable amount this month';
  const bulkOut = await tool.handler({
    perPerson: [{ person: 'Suki Varnell', set: { payableAmount: 500 } }], confirmed: true, said,
  });
  assert.match(bulkOut.summary, /THAT WOULD OVERWRITE, NOT ADD/);
  assert.match(bulkOut.summary, /add: \{ payableAmount: 500 \}/);
  assert.equal(wrote.length, 0);
});

test('the single deal tool refuses it too, and a payable SET asks first', async () => {
  const { wrote } = loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const refused = await one.handler({ id: 4, payableAmount: 500, said: 'add 500 on suki payable', confirmed: true });
  assert.match(refused.summary, /THAT WOULD OVERWRITE, NOT ADD/);
  const asks = await one.handler({ id: 4, payableAmount: 3500, said: 'set suki payable to 3500' });
  assert.equal(asks.pending, true);
  assert.match(asks.summary, /payable amount GBP 3,000 to GBP 3,500/);
  assert.equal(wrote.length, 0);
});

test('A PAYABLE PREVIEW NAMES EVERY FIELD IT MOVES, never "untouched" when it is not', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const out = await one.handler({ id: 4, monthlyAmount: 3150, payableAmount: 3150, said: 'the co a one', saidRecent: 'set her monthly and payable to 3150' });
  assert.match(out.summary, /monthly amount GBP 3,000 to GBP 3,150/);
  assert.match(out.summary, /payable amount GBP 3,000 to GBP 3,150/);
  assert.doesNotMatch(out.summary, /not touched/);
});

test('an amount ADDED sent to the one deal tool is shown its door', () => {
  const { unknownArgs } = require('../knownArgs');
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  assert.match(unknownArgs(one, { id: 4, payableAmountDelta: 500 }), /add: \{ monthlyAmount: N \}.*payableAmount only when they said payable.*It can be done/);
});

test('A SECOND PERSON ON THE ONE DEAL TOOL IS HANDED THE FINISHED CALL', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const turn = { wrote: new Map(), claims: [] };
  const said = 'make orla quennell co b and bram tevish co b special cases';
  await one.handler({ targetPerson: 'Orla Quennell', targetCompany: 'Co B', specialCaseDeal: true, said, turn });
  const out = await one.handler({ targetPerson: 'Bram Tevish', targetCompany: 'Co B', specialCaseDeal: true, said, turn });
  // THE RUNTIME builds the combined preview; she is never trusted to.
  assert.equal(out.pending, true);
  assert.deepEqual(out.lines.map((l) => l.split(':')[0]), ['Orla Quennell at Co B in ZZTEST', 'Bram Tevish at Co B in ZZTEST']);
  assert.equal(out.redirect.name, 'bulk_update_master_sheet');
  assert.deepEqual(out.redirect.args.perPerson.map((e) => [e.person, e.company, e.set.specialCaseDeal]), [
    ['Orla Quennell', 'Co B', true], ['Bram Tevish', 'Co B', true],
  ]);
});

test('AN ANSWER WITH NO FIGURE carries the "add" from the turn before', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const out = await one.handler({
    id: 4,
    payableAmount: 500,
    said: 'the ZZ Rate Co A one',
    saidRecent: 'the ZZ Rate Co A one\nadd 500 on suki varnell payable amount this month',
  });
  assert.match(out.summary, /THAT WOULD OVERWRITE, NOT ADD/);
});

test('THE PER DEAL LINES GO OUT AS A LIST the relay guard can hold her to', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Suki Varnell', add: { payableAmount: 500 } }], said: 'add 500 to suki payable',
  });
  assert.deepEqual(out.lines, ['Suki Varnell at Co A in ZZTEST: payable amount GBP 3,000 to GBP 3,500']);
});

test('her OWN SUM of an add, sent as a set, goes to `add` too', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const out = await one.handler({ id: 4, payableAmount: 3500, said: 'add 500 on suki varnell payable and 750 on ines' });
  assert.match(out.summary, /add: \{ payableAmount: 500 \}/);
});

// "NEXT MONTH" IS A MONTH THE CODE KNOWS: since 2026-10-06 the guessed year
// is corrected in place and shown in the preview, not refused (farOffPreset).
test('"next month" sent with a guessed year is corrected to the month they meant', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Suki Varnell', set: { presetOn: '2023-10-01' } }],
    said: 'move suki preset to next month',
  });
  assert.equal(out.pending, true);
  assert.deepEqual(out.lines, [`Suki Varnell at Co A in ZZTEST: preset date to "${NEXT}"`]);
});

test('the bulk identity names the people they named', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({ people: ['Suki Varnell'], set: { overridePaid: true }, said: 'mark suki paid' });
  assert.match(out.confirming, /for Suki Varnell/);
});

test('A CONFIRMED BULK CALL IS NOT REFUSED because its sentence is only "yes"', async () => {
  const { tool, wrote } = loadTool();
  const args = { people: ['Suki Varnell'], set: { overridePaid: true } };
  const first = await tool.handler({ ...args, said: 'mark suki varnell as paid' });
  assert.equal(first.pending, true);
  const out = await tool.handler({ ...args, confirmed: true, said: 'yes' });
  assert.doesNotMatch(out.summary, /never said to change/);
  assert.deepEqual(wrote.map((w) => w.id), [4]);
});

test('THE ONE DEAL TOOL TAKES AN ADD: the tool does the sum, and it asks first', async () => {
  const { wrote } = loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const said = 'add 500 on suki varnell payable amount this month';
  const asks = await one.handler({ id: 4, add: { payableAmount: 500 }, said });
  assert.equal(asks.pending, true);
  assert.match(asks.summary, /payable amount GBP 3,000 to GBP 3,500/);
  assert.equal(wrote.length, 0);
  await one.handler({ id: 4, add: { payableAmount: 500 }, said: 'yes', confirmed: true });
  assert.equal(wrote[0].fields.payableAmount, 3500);
});

test('a second person with an ADD is handed the finished perPerson call, add included', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const turn = { wrote: new Map(), claims: [] };
  const said = 'add 500 to suki and 750 to ines co a';
  await one.handler({ targetPerson: 'Suki Varnell', add: { payableAmount: 500 }, said, turn });
  const out = await one.handler({ targetPerson: 'Ines Pardew', targetCompany: 'Co A', add: { payableAmount: 750 }, said, turn });
  assert.deepEqual(out.lines, [
    'Suki Varnell at Co A in ZZTEST: payable amount GBP 3,000 to GBP 3,500',
    'Ines Pardew at Co A in ZZTEST: payable amount GBP 1,100 to GBP 1,850',
  ]);
  assert.deepEqual(out.redirect.args.perPerson.map((e) => [e.person, e.company, e.add.payableAmount]), [
    ['Suki Varnell', 'Co A', 500], ['Ines Pardew', 'Co A', 750],
  ]);
});

test('"mark suki and ines paid": Ines\'s two deals are handed over, never "which company?"', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const turn = { wrote: new Map(), claims: [] };
  const said = 'mark suki varnell and ines pardew as paid';
  await one.handler({ targetPerson: 'Suki Varnell', overridePaid: true, said, turn });
  const out = await one.handler({ targetPerson: 'Ines Pardew', overridePaid: true, said, turn });
  assert.doesNotMatch(out.summary, /Which company/);
  assert.equal(out.pending, true);
  // All three of their deals: Suki's one and both of Ines's.
  assert.equal(out.lines.length, 3);
  assert.deepEqual(out.redirect.args.perPerson.map((e) => e.person), ['Suki Varnell', 'Ines Pardew']);
});

test('A THIRD PERSON JOINS THE FIRST TWO, never replaces the second', async () => {
  loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const turn = { wrote: new Map(), claims: [] };
  const said = 'mark suki, orla and bram tevish paid';
  await one.handler({ targetPerson: 'Suki Varnell', overridePaid: true, said, turn });
  await one.handler({ targetPerson: 'Orla Quennell', targetCompany: 'Co A', overridePaid: true, said, turn });
  const out = await one.handler({ targetPerson: 'Bram Tevish', overridePaid: true, said, turn });
  assert.deepEqual(out.redirect.args.perPerson.map((e) => e.person), ['Suki Varnell', 'Orla Quennell', 'Bram Tevish']);
});

test('A HAND OVER IS REMEMBERED AS THE PER PERSON CALL, so "yes" re-runs that', async () => {
  const { invokeTool } = require('../runAgent');
  const { recallAll, forget } = require('../confirmReplay');
  loadTool();
  const tools = require('./masterSheet').masterSheetTools;
  const turn = { wrote: new Map(), claims: [] };
  const history = [{ role: 'user', content: 'mark suki varnell and ines pardew as paid' }];
  await invokeTool(tools, 'update_master_sheet_row', JSON.stringify({ targetPerson: 'Suki Varnell', overridePaid: true }), history, null, turn);
  await invokeTool(tools, 'update_master_sheet_row', JSON.stringify({ targetPerson: 'Ines Pardew', overridePaid: true }), history, null, turn);
  const held = recallAll('yes', 'Suki Varnell at Co A, Ines Pardew at Co A and Ines Pardew at Close Co: paid. Shall I?');
  assert.deepEqual(held.map((h) => h.name), ['bulk_update_master_sheet'], 'the single Suki pending was superseded');
  held.forEach(forget);
});

test('"WHICH DEAL?" ANSWERED THROUGH THE ONE DEAL TOOL completes the whole plan', async () => {
  const { tool } = loadTool();
  const one = require('./masterSheet').masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const asked = await tool.handler({
    perPerson: [
      { person: 'Suki Varnell', add: { payableAmount: 500 } },
      { person: 'Ines Pardew', add: { payableAmount: 750 } },
    ],
    said: 'add 500 on suki and 750 on ines',
  });
  assert.match(asked.summary, /Ines Pardew holds 2 deals/);
  const out = await one.handler({ targetPerson: 'Ines Pardew', targetCompany: 'Co A', said: 'the co a one', turn: { wrote: new Map() } });
  assert.deepEqual(out.lines, [
    'Suki Varnell at Co A in ZZTEST: payable amount GBP 3,000 to GBP 3,500',
    'Ines Pardew at Co A in ZZTEST: payable amount GBP 1,100 to GBP 1,850',
  ]);
  assert.equal(out.redirect.name, 'bulk_update_master_sheet');
});

/* ===============================
 * * HER GUESS IS NOT THEIR ANSWER, 2026-09-25
 * =============================== */

test('A COMPANY THEY NEVER SAID, on someone holding several deals, is asked', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Ines Pardew', company: 'Co A', add: { payableAmount: 750 } }],
    said: 'add 750 on ines pardew payable amount',
    saidRecent: 'add 750 on ines pardew payable amount',
  });
  assert.match(out.summary, /did not say which/);
  assert.equal(out.pending, undefined);
  assert.equal(wrote.length, 0);
});

test('A PERSON THEY NEVER NAMED gets no special case', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Suki Varnell', set: { specialCaseDeal: true } }],
    said: 'make every ZZTEST deal a special case',
    saidRecent: 'make every ZZTEST deal a special case',
  });
  assert.match(out.summary, /did not name Suki Varnell/);
});

test('a CONFIRMED replay stands on the lines agreed, not on words two turns back', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    perPerson: [{ person: 'Ines Pardew', company: 'Co A', add: { payableAmount: 750 } }],
    confirmed: true,
    said: 'yes',
    saidRecent: 'yes\nthe co a one',
  });
  assert.equal(wrote.find((w) => w.id === 5).fields.payableAmount, 1850);
});

test('"DEDUCT 500" WITH NO FIELD IS THE MONTHLY, and the payable follows it; "payable" said keeps it there', async () => {
  const { invokeTool } = require('../runAgent');
  const { recallAll, forget } = require('../confirmReplay');
  // Written straight away in auto mode, previewed otherwise: either way it names the field it moved.
  const run = async (said) => {
    const { wrote } = loadTool();
    const tools = require('./masterSheet').masterSheetTools;
    const out = await invokeTool(tools, 'update_master_sheet_row', JSON.stringify({ id: 4, add: { payableAmount: -500 } }),
      [{ role: 'user', content: said }], null, { wrote: new Map(), claims: [] });
    recallAll('yes', out.summary ?? '').forEach(forget);
    const fields = wrote.find((w) => w.id === 4)?.fields;
    return fields
      ? { monthly: fields.monthlyAmount === 2500, payable: fields.payableAmount === 2500 }
      : { monthly: /monthly amount GBP 3,000 to GBP 2,500/i.test(out.summary), payable: /payable amount GBP 3,000 to GBP 2,500/i.test(out.summary) };
  };
  assert.deepEqual(await run('deduct 500 to suki varnell'), { monthly: true, payable: false });
  assert.deepEqual(await run('deduct 500 from suki varnell payable'), { monthly: false, payable: true });
});
