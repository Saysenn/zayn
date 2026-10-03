const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * ONE MESSAGE, DIFFERENT VALUES, ONE CONFIRMATION
 * ***************************************************
 *
 * "Gloria 10 days, Paddy 0, Nathan's preset to September" is three
 * different values. The bulk tool set ONE value across many rows and the
 * single tool did one row per call, so this was three writes, three
 * confirmations, three chances to stop half way, and no single act to undo
 * afterwards. The admin dictates like this constantly.
 */

const deal = (over = {}) => ({
  id: 1,
  person_id: 'gloria',
  person_name: 'Gloria',
  company: 'Acqua',
  group_name: 'INDIGO',
  role_label: 'Mid 1',
  monthly_amount: '1000',
  payable_days: 30,
  preset_on: null,
  payment_start_on: null,
  ...over,
});

const ROWS = [
  deal({ id: 1, person_id: 'gloria', person_name: 'Gloria' }),
  deal({ id: 2, person_id: 'paddy', person_name: 'Paddy', company: 'Leadstone' }),
  deal({ id: 3, person_id: 'nathan', person_name: 'Nathan', company: 'Relia' }),
];

function loadTool({ rows = ROWS, fail = [] } = {}) {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  for (const p of [toolPath, repoPath]) delete require.cache[p];

  const wrote = [];
  require.cache[repoPath] = stub({
    async findAll() { return { rows, total: rows.length }; },
    async update(id, fields) {
      if (fail.includes(id)) throw new Error('nope');
      wrote.push({ id, fields });
      return { id };
    },
    async updateMany(changes) { for (const c of changes) wrote.push(c); return changes; },
    async searchFuzzy() { return rows; },
  });

  const tool = require(toolPath).masterSheetTools
    .find((t) => t.name === 'bulk_update_master_sheet');
  return { tool, wrote };
}

const THREE = [
  { person: 'Gloria', set: { payableDays: 10 } },
  { person: 'Paddy', set: { payableDays: 0 } },
  { person: 'Nathan', set: { monthlyAmount: 750 } },
];

test('THE FIRST CALL WRITES NOTHING and lists a line PER PERSON', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({ perPerson: THREE, said: 'gloria 10 days, paddy 0, nathan 750' });

  assert.equal(wrote.length, 0);
  assert.equal(out.pending, true);
  // A count on its own hides that they are DIFFERENT changes, so nobody
  // could tell one wrong value from the rest.
  // One line per DEAL, from and to (2026-09-25).
  assert.match(out.summary, /Gloria at Acqua: payable days \d+ to 10/);
  assert.match(out.summary, /Paddy at Leadstone: payable days \d+ to 0/);
  assert.match(out.summary, /Nathan at Relia: monthly amount GBP [\d,]+ to GBP 750/);
});

test('CONFIRMED, each person gets their OWN value', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({ perPerson: THREE, confirmed: true, said: 'go ahead' });

  assert.equal(wrote.length, 3);
  assert.equal(wrote.find((w) => w.id === 1).fields.payableDays, 10);
  assert.equal(wrote.find((w) => w.id === 2).fields.payableDays, 0);
  assert.equal(wrote.find((w) => w.id === 3).fields.monthlyAmount, 750);
});

// The same recompute every other door does, or the row stops following
// from its own inputs: 10 payable days on 1,000 a month, payable 0.
test('the payable amount follows the days, per person', async () => {
  const { tool, wrote } = loadTool({
    rows: [deal({ id: 1, preset_on: '2026-09-01', monthly_amount: '3000' })],
  });
  await tool.handler({
    perPerson: [{ person: 'Gloria', set: { payableDays: 10 } }], confirmed: true, said: 'go',
  });
  assert.equal(wrote[0].fields.payableAmount, 1000);
});

// ===============================
// * EVERY GUARD THE OTHER PATH HAS
// ===============================
test('a per person column is refused BY NAME, on any entry', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [
      { person: 'Gloria', set: { payableDays: 10 } },
      { person: 'Paddy', set: { bankDetails: 'Barclays' } },
    ],
    confirmed: true,
    said: 'go',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /paying many people into one account/);
});

test('a derived field is refused with its REAL reason', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Gloria', set: { status: 'ended' } }], confirmed: true, said: 'go',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /worked out from the payment start/);
});

test('a name that matches nobody refuses the WHOLE change', async () => {
  // A name that misses is invisible in a count, so nobody would know
  // somebody had been left out.
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [
      { person: 'Gloria', set: { payableDays: 10 } },
      { person: 'Wilhelmina', set: { payableDays: 0 } },
    ],
    confirmed: true,
    said: 'go',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /Wilhelmina/);
});

test('an entry with nothing to set asks, rather than writing the rest', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [
      { person: 'Gloria', set: { payableDays: 10 } },
      { person: 'Paddy', set: {} },
    ],
    confirmed: true,
    said: 'go',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /Nothing was given to set on Paddy/);
});

// A preset in a past year is never counted, so the row owes nothing for
// ever and nothing on screen says so.
test('a guessed year on ONE entry stops the lot', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    perPerson: [{ person: 'Gloria', set: { presetOn: '2024-09-01' } }],
    confirmed: true,
    said: 'set gloria to september',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /2024/);
});

test('a row that DID NOT TAKE is named, never averaged into a count', async () => {
  const { tool } = loadTool({ fail: [2] });
  const out = await tool.handler({ perPerson: THREE, confirmed: true, said: 'go' });
  assert.match(out.summary, /DID NOT TAKE/);
  assert.match(out.summary, /Do NOT\s+report this as done/);
});

test('the single value path is untouched by any of this', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({ set: { payableDays: 5 }, confirmed: true, said: 'all of them' });
  assert.equal(wrote.length, 3, 'every row, one value');
  assert.match(out.summary, /Done/);
});

/**
 * ===============================
 * * AND SHE HAS TO REACH IT
 * ===============================
 * Live 2026-09-17: "set gloria to 10 payable days and paddy to 0" was
 * answered with TWO single row edits. The feature existed and she went
 * past it, which is the same shape as `list_companies`: built, not routed.
 *
 * A description is not a route, so the SECOND person in one turn is turned
 * back with the tool that does both at once.
 */
test('a second person by NAME in one turn is sent to perPerson', async () => {
  const { tool: update } = (() => {
    const toolPath = require.resolve('./masterSheet.js');
    const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
    for (const p of [toolPath, repoPath]) delete require.cache[p];
    const wrote = [];
    require.cache[repoPath] = stub({
      async findAll() { return { rows: ROWS, total: ROWS.length }; },
      async findById(id) { return ROWS.find((r) => r.id === id) ?? null; },
      async searchFuzzy({ q }) {
        return ROWS.filter((r) => r.person_name.toLowerCase().includes(String(q).toLowerCase()));
      },
      async update(id, fields) { wrote.push({ id, fields }); return { id }; },
    });
    return {
      tool: require(toolPath).masterSheetTools.find((t) => t.name === 'update_master_sheet_row'),
      wrote,
    };
  })();

  const t = { wrote: new Map(), claims: [] };
  const first = await update.handler({ targetPerson: 'Gloria', payableDays: 10, confirmed: true, turn: t, said: 'gloria 10 paddy 0' });
  assert.doesNotMatch(first.summary ?? '', /perPerson/, 'the first one is what they asked for');

  // The runtime builds the per person preview itself now (2026-09-25). Gloria
  // was already written, so she is named as saved, not proposed again.
  const second = await update.handler({ targetPerson: 'Paddy', payableDays: 0, turn: t, said: 'gloria 10 paddy 0' });
  assert.equal(second.pending, true);
  assert.equal(second.redirect.name, 'bulk_update_master_sheet');
  assert.deepEqual(second.lines.map((l) => l.split(':')[0]), ['Paddy at Leadstone']);
  assert.match(second.summary, /ALREADY SAVED THIS TURN, not part of this: Gloria/);
});

// A phone number belongs to one person and `perPerson` refuses it, so
// redirecting it would be a dead end: turned back here and refused there.
test('but a PER PERSON fact is still one row at a time', async () => {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  for (const p of [toolPath, repoPath]) delete require.cache[p];
  const wrote = [];
  require.cache[repoPath] = stub({
    async findAll() { return { rows: ROWS, total: ROWS.length }; },
    async findById(id) { return ROWS.find((r) => r.id === id) ?? null; },
    async searchFuzzy({ q }) {
      return ROWS.filter((r) => r.person_name.toLowerCase().includes(String(q).toLowerCase()));
    },
    async update(id, fields) { wrote.push({ id, fields }); return { id }; },
  });
  const update = require(toolPath).masterSheetTools.find((t) => t.name === 'update_master_sheet_row');

  const t = { wrote: new Map(), claims: [] };
  await update.handler({ targetPerson: 'Gloria', phone: '07700900001', turn: t, said: 'their numbers' });
  const second = await update.handler({ targetPerson: 'Paddy', phone: '07700900002', turn: t, said: 'their numbers' });
  assert.doesNotMatch(second.summary ?? '', /perPerson/);
});
