const test = require('node:test');
const assert = require('node:assert/strict');

const {
  historicalBreakdown, requestedMonths, countedSnapshotRows, requestedGroups, requestedMethods,
  breakdownFor, recordText,
} = require('./historicalBreakdown');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const rowsRepo = require('../../repos/masterSheetRows.repo');

const row = (over = {}) => ({
  id: 1,
  person_id: 'nicola',
  person_name: 'Nicola',
  person_addon_percent: 5,
  person_fee_percent: 0,
  addon_percent: 0,
  fee_percent: 0,
  company: 'Acqua',
  group_name: 'MANBAT',
  role_label: 'Mid 1',
  currency: 'GBP',
  payable_amount: 1000,
  payment_method: 'cash',
  location: 'Main City',
  ...over,
});

test('a follow-up group keeps the month from the preceding question', () => {
  assert.deepEqual(requestedMonths({
    said: 'what about nexus?',
    saidRecent: 'what about nexus?\nwhat is milkman total last month?',
  }, '2026-09'), ['2026-08']);
});

test('the admin month words replace a year guessed by the model', () => {
  assert.deepEqual(requestedMonths({
    said: 'show all group breakdowns last August', month: '2023-08',
  }, '2026-09'), ['2026-08']);
});

test('a new question does not inherit an older month', () => {
  assert.deepEqual(requestedMonths({
    said: 'show me nexus people',
    saidRecent: 'show me nexus people\nwhat is milkman total last month?',
  }, '2026-09'), ['2026-09']);
});

test('snapshot selection uses the immutable counted deal list', () => {
  const snapshot = {
    rows: [row(), row({ id: 2, company: 'Later', payable_amount: 400 })],
    totals: { deals: [{ id: 1, personName: 'Nicola', company: 'Acqua', group: 'MANBAT', role: 'Mid 1', currency: 'GBP', amount: 1000 }] },
  };
  assert.deepEqual(countedSnapshotRows(snapshot).map((item) => item.id), [1]);
});

test('group names are exact and MANBAT is never silently changed to MILKMAN', () => {
  assert.deepEqual(
    requestedGroups({ group: 'MANBAT', said: 'show the MANBAT group breakdown' }, ['MANBAT', 'MILKMAN']),
    { groups: ['MANBAT'], missing: [] },
  );
  assert.deepEqual(
    requestedGroups({ group: 'MILKMAN', said: 'show the MANBAT group breakdown' }, ['MANBAT', 'MILKMAN']),
    { groups: ['MANBAT'], missing: [] },
  );
});

test('the literal ALL GROUPS group is distinct from every group', () => {
  const available = ['ALL GROUPS', 'INDIGO', 'NEXUS'];
  assert.deepEqual(requestedGroups({ group: 'ALL GROUPS', said: 'the all group breakdown' }, available).groups, ['ALL GROUPS']);
  assert.deepEqual(requestedGroups({ groups: ['ALL GROUPS'], said: 'the ALL GROUPS group breakdown' }, available).groups, ['ALL GROUPS']);
  assert.deepEqual(requestedGroups({ allGroups: true, said: 'all the groups' }, available).groups, available);
});

test('a follow-up preserves the immediately preceding group scope', () => {
  const available = ['MANBAT', 'MILKMAN', 'NEXUS'];
  const args = {
    said: 'and only cash?',
    saidRecent: 'and only cash?\nshow MANBAT and NEXUS breakdowns for August',
  };
  assert.deepEqual(requestedGroups(args, available).groups, ['MANBAT', 'NEXUS']);
});

test('group scope survives a chain of short follow-ups without model help', () => {
  const available = ['MANBAT', 'MILKMAN', 'NEXUS'];
  const args = {
    said: 'and September?',
    saidRecent: 'and September?\nwhat about bank and crypto?\nand only cash?\nshow MANBAT and NEXUS breakdowns for August',
  };
  assert.deepEqual(requestedGroups(args, available).groups, ['MANBAT', 'NEXUS']);
  assert.deepEqual(requestedMethods(args), ['bank', 'crypto']);
  assert.deepEqual(requestedMonths(args, '2026-09'), ['2026-09']);
  assert.deepEqual(requestedMonths({
    ...args,
    said: 'and those?',
    saidRecent: 'and those?\nwhat about bank and crypto?\nand only cash?\nshow MANBAT and NEXUS breakdowns for August',
  }, '2026-09'), ['2026-08']);
});

test('a follow-up preserves payment scope unless it names a new method', () => {
  assert.deepEqual(requestedMethods({
    said: 'and September?',
    saidRecent: 'and September?\nshow the cash breakdown for August',
  }), ['cash']);
  assert.deepEqual(requestedMethods({
    said: 'what about bank and crypto?',
    saidRecent: 'what about bank and crypto?\nshow the cash breakdown for August',
    paymentMethod: 'cash',
  }), ['bank', 'crypto']);
});

test('the report reuses workbook arithmetic for stacked rates and UK cash', () => {
  const built = breakdownFor([row()], {
    group: 'MANBAT',
    rates: new Map([['nicola', { addon: 5, fee: 0 }]]),
    cryptoPercent: 0,
    fx: { usdPerGbp: 1.2, perUsd: {}, source: 'snapshot' },
    localLocations: ['Abu Dhabi'],
  });
  assert.deepEqual(built.breakdown.grand, [{ currency: 'GBP', total: 1050 }]);
  assert.equal(built.converted.awayUsd, 1260);
  assert.equal(built.converted.localUsd, 0);
  assert.equal(built.converted.awayGbp, 1050);
});

test('the report keeps auditable FX precision and names the AED peg when used', () => {
  const built = breakdownFor([row({ currency: 'AED', payable_amount: 367.25 })], {
    group: 'MANBAT', rates: new Map(), cryptoPercent: 0,
    fx: { usdPerGbp: 1.348492, perUsd: { AED: 3.6725 }, source: 'saved snapshot' },
    localLocations: ['Abu Dhabi'],
  });
  const text = recordText({
    month: '2026-08', group: 'MANBAT', source: 'saved actual',
    fx: { usdPerGbp: 1.348492, perUsd: { AED: 3.6725 }, source: 'saved snapshot' },
    ...built,
  });
  assert.match(text, /1 GBP = 1\.348492 USD/);
  assert.match(text, /1 USD = 3\.6725 AED, fixed peg/);
});

test('an unavailable currency rate is never displayed as USD zero', () => {
  const built = breakdownFor([row({ currency: 'EURO', payment_method: 'crypto', payable_amount: 1010 })], {
    group: 'MANBAT', rates: new Map(), cryptoPercent: 0,
    fx: { usdPerGbp: 1.348492, perUsd: {}, source: 'workbook' },
    localLocations: ['Abu Dhabi'],
  });
  const text = recordText({
    month: '2026-08', group: 'MANBAT', source: 'saved actual',
    fx: { usdPerGbp: 1.348492, perUsd: {}, source: 'workbook' },
    ...built,
  });
  assert.match(text, /Total Crypto: not converted, no USD rate for EUR/);
  assert.match(text, /Those amounts are excluded from USD totals/);
  assert.doesNotMatch(text, /Total Crypto: USD 0/);
});

test('a past multi-group breakdown reads only the saved snapshot', async () => {
  const originalFindMany = snapshotsRepo.findMany;
  const originalFindAllRows = rowsRepo.findAllRows;
  let liveRead = false;
  snapshotsRepo.findMany = async () => [{
    month: '2026-08',
    rows: [
      row(),
      row({ id: 2, person_id: 'zayn', person_name: 'Zayn', person_addon_percent: 0, group_name: 'NEXUS', company: 'A J Rayson', payable_amount: 500, payment_method: 'bank', location: 'Abu Dhabi' }),
    ],
    totals: {
      deals: [
        { id: 1, personName: 'Nicola', company: 'Acqua', group: 'MANBAT', role: 'Mid 1', currency: 'GBP', amount: 1000, addon: 50, crypto: 0, fee: 0, net: 1050 },
        { id: 2, personName: 'Zayn', company: 'A J Rayson', group: 'NEXUS', role: 'Mid 1', currency: 'GBP', amount: 500, addon: 0, crypto: 0, fee: 0, net: 500 },
      ],
      settings: { cryptoPercent: 0, localLocations: ['Abu Dhabi'] },
      fx: { usdPerGbp: 1.2, perUsd: {}, source: 'workbook' },
    },
  }];
  rowsRepo.findAllRows = async () => { liveRead = true; return []; };

  try {
    const out = await historicalBreakdown.handler({
      month: '2026-08', groups: ['MANBAT', 'NEXUS'], said: 'show MANBAT and NEXUS August breakdowns',
    });
    assert.equal(liveRead, false);
    assert.match(out.summary, /August 2026, MANBAT, saved actual/);
    assert.match(out.summary, /Total: GBP 1,050/);
    assert.match(out.summary, /Of which UK: USD 1,260/);
    assert.match(out.summary, /August 2026, NEXUS, saved actual/);
    assert.match(out.summary, /Total bank: USD 600/);
    assert.deepEqual(out.computedMonths, ['2026-08']);
  } finally {
    snapshotsRepo.findMany = originalFindMany;
    rowsRepo.findAllRows = originalFindAllRows;
  }
});

// 2026-09-30: the breakdown is DRAWN, a section for totals, USD and each
// method's places; the bubble keeps each heading and its total.
test('THE BREAKDOWN IS A CARD, the bubble its heading and total', async () => {
  const originalFindMany = snapshotsRepo.findMany;
  snapshotsRepo.findMany = async () => [{
    month: '2026-08',
    rows: [row()],
    totals: {
      deals: [{ id: 1, personName: 'Nicola', company: 'Acqua', group: 'MANBAT', role: 'Mid 1', currency: 'GBP', amount: 1000, addon: 50, crypto: 0, fee: 0, net: 1050 }],
      settings: { cryptoPercent: 0, localLocations: ['Abu Dhabi'] },
      fx: { usdPerGbp: 1.2, perUsd: {}, source: 'workbook' },
    },
  }];
  try {
    const out = await historicalBreakdown.handler({ month: '2026-08', group: 'MANBAT', said: 'MANBAT August breakdown' });
    assert.equal(out.list.kind, 'report');
    assert.deepEqual(out.list.sections.slice(0, 2).map((s) => s.label), ['Totals', 'In USD']);
    assert.match(out.reply, /^August 2026, MANBAT, saved actual: GBP 1,050\.$/);
  } finally {
    snapshotsRepo.findMany = originalFindMany;
  }
});

// 2026-09-30: a place's figure re-added the add on already inside it, so
// Abu Dhabi read AED 4,400 under a total of AED 4,200.
test('A PLACE ADDS UP TO THE TOTAL, the add on counted once', () => {
  const fx = { usdPerGbp: 1.2, perUsd: {}, source: 'workbook' };
  const built = breakdownFor([row()], { group: 'MANBAT', rates: new Map(), cryptoPercent: 0, fx, localLocations: ['Abu Dhabi'] });
  const text = recordText({ month: '2026-08', group: 'MANBAT', source: 'saved actual', fx, ...built });
  const total = /^Total: GBP ([\d,.]+)\./m.exec(text)[1];
  assert.match(text, new RegExp(`Payment detail: [^:]+: GBP ${total.replace('.', '\.')}\.`));
});

// 2026-09-30: "break that down by company" came back by payment method.
test('BY COMPANY IS ONE LINE PER COMPANY, off the same rated figures', async () => {
  const originalFindMany = snapshotsRepo.findMany;
  snapshotsRepo.findMany = async () => [{
    month: '2026-08',
    rows: [row(), row({ id: 2, person_id: 'bo', person_name: 'Bo', person_addon_percent: 0, company: 'Northstar Care', payable_amount: 400 })],
    totals: {
      deals: [
        { id: 1, personName: 'Nicola', company: 'Acqua', group: 'MANBAT', role: 'Mid 1', currency: 'GBP', amount: 1000, addon: 50, crypto: 0, fee: 0, net: 1050 },
        { id: 2, personName: 'Bo', company: 'Northstar Care', group: 'MANBAT', role: 'Mid 1', currency: 'GBP', amount: 400, addon: 0, crypto: 0, fee: 0, net: 400 },
      ],
      settings: { cryptoPercent: 0, localLocations: ['Abu Dhabi'] },
      fx: { usdPerGbp: 1.2, perUsd: {}, source: 'workbook' },
    },
  }];
  try {
    const out = await historicalBreakdown.handler({ month: '2026-08', group: 'MANBAT', said: 'break MANBAT august down by company' });
    const rows = out.list.sections[0].rows;
    assert.deepEqual(rows.map((r) => r.name), ['Acqua', 'Northstar Care']);
    assert.equal(rows[0].detail, 'GBP 1,050');
  } finally {
    snapshotsRepo.findMany = originalFindMany;
  }
});
