const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * ANY COLUMN A SET OF ROWS CAN SHARE
 * ***************************************************
 *
 * `set` was a short list, and the missing columns were not merely absent:
 * `normalizeFields` drops a key it does not know, so "put this appointment
 * date on the whole group" came back as "nothing to set" on a request that
 * made perfect sense. The admin cannot tell a misunderstanding from a
 * refusal.
 *
 * So every column is now either OFFERED or REFUSED BY NAME WITH A REASON.
 * The refusals are the point: a bank account written to thirty rows is
 * thirty people paid into one account.
 */

const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');
const SET = bulk.parameters.properties.set.properties;

const ROWS = [
  { id: 1, person_name: 'Alpha', company: 'Fake Co', group_name: 'ZZTEST' },
  { id: 2, person_name: 'Beta', company: 'Fake Co', group_name: 'ZZTEST' },
];

const withRepo = (run) => {
  const saved = { findAll: repo.findAll, update: repo.update };
  const written = [];
  repo.findAll = async () => ({ rows: ROWS, total: ROWS.length });
  repo.update = async (id, patch) => { written.push({ id, patch }); return { id }; };
  return run(written).finally(() => Object.assign(repo, saved));
};

test('EVERY COLUMN IS ACCOUNTED FOR, offered or refused', () => {
  // The real failure was a column that was neither: silently unreachable.
  const src = fs.readFileSync(path.join(__dirname, 'masterSheet.js'), 'utf8');
  const names = (block) => [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);

  const known = names(src.match(/const ROW_FIELDS = \{[\s\S]*?\n\};/)[0]);
  const refused = [
    ...names(src.match(/const PER_PERSON = \{[\s\S]*?\n\};/)[0]),
    // Per NAMED deal through perPerson, never over a filter (2026-09-25).
    ...names(src.match(/const NAMED_DEALS_ONLY = \{[\s\S]*?\n\};/)[0]),
  ];
  const offered = Object.keys(SET);

  const orphans = known.filter((k) => !offered.includes(k) && !refused.includes(k));
  assert.deepEqual(orphans, [], `neither offered nor explained: ${orphans.join(', ')}`);
});

test('the columns that were missing are reachable now', async () => {
  for (const field of ['assignedOn', 'roleLabel', 'notes', 'addonPercent', 'feePercent', 'label']) {
    assert.ok(SET[field], `${field} is still unreachable`);
  }
});

test('status LEFT this list on purpose, and is not coming back', async () => {
  // It was widened in with the rest, then taken out again 2026-09-09. The
  // payment period is worked out from the payment start, the preset and
  // the end date on every read, so a stored value won over the formula and
  // the badge contradicted the cell colour beside it. Gloria read Ended on
  // two of four identical deals with her money still in the total.
  assert.equal(SET.status, undefined, 'the period is derived, never set');
});

test('a widened column ACTUALLY WRITES, not just appears in the schema', async () => {
  await withRepo(async (written) => {
    await bulk.handler({ set: { notes: 'checked by hand' }, confirmed: true });
    assert.equal(written.length, 2);
    assert.equal(written[0].patch.notes, 'checked by hand');
  });
});

test('BANK DETAILS ARE REFUSED, and the reason is the money', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({ set: { accountNumber: '12345678' }, confirmed: true });

    assert.equal(written.length, 0, 'it wrote one account number onto every row');
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
    assert.match(out.summary, /wrong person/);
  });
});

test('A NAME AND A PHONE ARE REFUSED, because they belong to one person', async () => {
  for (const set of [{ personName: 'Nathan' }, { phone: '07000 000000' }, { postcode: 'M1 1AA' }]) {
    // eslint-disable-next-line no-await-in-loop
    await withRepo(async (written) => {
      const out = await bulk.handler({ set, confirmed: true });
      assert.equal(written.length, 0, `${Object.keys(set)[0]} was written to every row`);
      assert.match(out.summary, /one person/);
    });
  }
});

test("the boss's own columns point at the switches instead", async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({ set: { paid: 'yes' }, confirmed: true });
    assert.equal(written.length, 0);
    assert.match(out.summary, /switch/);
  });
});

test('MOVING ROWS BETWEEN GROUPS IS REFUSED: it changes their identity', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({ set: { groupName: 'NEXUS' }, confirmed: true });
    assert.equal(written.length, 0);
    assert.match(out.summary, /identity/);
  });
});

test('the payable amount points at what it is worked out from', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({ set: { payableAmount: 500 }, confirmed: true });
    assert.equal(written.length, 0);
    // Per NAMED deal now, never over a filter (2026-09-25).
    assert.match(out.summary, /perPerson`, one entry per deal/);
  });
});

test('ONE REFUSED FIELD REFUSES THE WHOLE CALL', async () => {
  // Writing the legal half and dropping the rest would be a partial edit
  // reported as a success, which is the thing every guard here prevents.
  await withRepo(async (written) => {
    const out = await bulk.handler({ set: { presetOn: '2026-10-01', sortCode: '04-00-04' }, confirmed: true });
    assert.equal(written.length, 0, 'it applied the half it was willing to do');
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  });
});

test('a field that is not a column at all says SO, rather than "nothing to set"', async () => {
  await withRepo(async () => {
    const out = await bulk.handler({ set: { favouriteColour: 'green' }, confirmed: true });
    assert.match(out.summary, /not a column/);
    assert.match(out.summary, /favouriteColour/);
  });
});

/**
 * ===============================
 * * SHE COULD DESCRIBE A SET SHE COULD NOT CHANGE
 * ===============================
 * `bulk_update_master_sheet` declared its own shorter filter list, so "set
 * payable days to 0 for everyone at Northstar Care" had no company filter,
 * and neither did an amount range, an end month, a tier or a role. The
 * answer was to go row by row, which is the loop every guard here exists to
 * stop.
 *
 * ONE DEFINITION NOW. Both tools take `FILTER_PARAMS`, which mirrors
 * `repo.findAll`, so a filter added once reaches all three tools.
 */
test('the bulk tool takes every filter the lookup takes', () => {
  const { masterSheetTools } = require('./masterSheet.js');
  const paramsOf = (name) => Object.keys(
    masterSheetTools.find((t) => t.name === name).parameters.properties,
  );

  const find = paramsOf('filter_master_sheet');
  const bulk = paramsOf('bulk_update_master_sheet');

  // `groups` is the lookup's own: it reads several groups at once, and the
  // bulk tool covers the whole sheet by leaving `group` out instead.
  const missing = find.filter((k) => !bulk.includes(k) && k !== 'groups');
  assert.deepEqual(missing, [], `the bulk tool cannot narrow by ${missing.join(', ')}`);
});

test('the filters that were missing are the ones the example needed', () => {
  const { masterSheetTools } = require('./masterSheet.js');
  const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');
  for (const key of ['company', 'roleLabel', 'tier', 'amountField', 'amountMin', 'amountMax', 'endWhen']) {
    assert.ok(key in bulk.parameters.properties, `${key} is how a set gets named`);
  }
});

// The repo has taken this since the closure work and no tool offered it.
// liquidation is STILL PAYING, which is exactly the set somebody asks for.
test('a company status filter exists, and its values come from the repo', () => {
  const { masterSheetTools } = require('./masterSheet.js');
  const { COMPANY_STATUS } = require('../../repos/companies.repo');
  const find = masterSheetTools.find((t) => t.name === 'filter_master_sheet');

  assert.deepEqual(
    find.parameters.properties.companyStatus.items.enum,
    Object.values(COMPANY_STATUS),
  );
});

// ===============================
// * THE SEVEN COLUMNS THAT HAD NO FILTER
// ===============================
// Each was a question she could not answer and would not refuse: a filter
// that does not exist is IGNORED by the query, so the answer came back as
// the whole sheet described as something narrower.
test('every column that had no filter has one now, on both tools', () => {
  const { masterSheetTools } = require('./masterSheet.js');
  const paramsOf = (name) => masterSheetTools
    .find((t) => t.name === name).parameters.properties;

  const added = [
    'appointmentWhen', 'acceptingPostals', 'label',
    'paymentOutcome', 'oldGroup', 'sheetShouldBePaid', 'sheetPaid',
  ];
  for (const key of added) {
    assert.ok(key in paramsOf('filter_master_sheet'), `${key} cannot be asked about`);
    assert.ok(key in paramsOf('bulk_update_master_sheet'), `${key} cannot be changed by`);
  }
});

/**
 * ===============================
 * * THE VALUES ARE THE REPO'S OWN KEYS
 * ===============================
 * `AMOUNT_COLUMNS` in the repo is keyed camelCase and the page sends
 * camelCase. This tool declared `payable_days`, which is on no allow list,
 * so the lookup returned undefined and THE RANGE WAS SILENTLY DROPPED: the
 * query ran unfiltered and the whole sheet came back as the answer to "who
 * is on 0 payable days".
 */
test('the amount field values match the repo allow list exactly', () => {
  const { masterSheetTools } = require('./masterSheet.js');
  const declared = masterSheetTools
    .find((t) => t.name === 'filter_master_sheet')
    .parameters.properties.amountField.enum;

  const src = fs.readFileSync(require.resolve('../../repos/masterSheetRows.repo.js'), 'utf8');
  const block = src.match(/const AMOUNT_COLUMNS = \{[\s\S]*?\n {2}\};/)[0];
  const allowed = [...block.matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]);

  assert.deepEqual(declared.slice().sort(), allowed.slice().sort());
  // The two RATES are figures too, so "an add on over 5%" is a range like
  // any other rather than a filter of its own.
  assert.ok(declared.includes('addonPercent'));
  assert.ok(declared.includes('feePercent'));
});
