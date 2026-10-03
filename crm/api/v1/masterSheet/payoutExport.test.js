const test = require('node:test');
const assert = require('node:assert');
const { presetNow, presetOffset } = require('../testing/months');

const { buildPayoutWorkbook, listPayoutColumns } = require('./buildPayoutSheet');
const { exportFileName, exportScope } = require('../shared/exportFileName.helper');
const { templateFor, fileLabelOf } = require('../templates/xlsx');

/**
 * The bank file is the one transfers are made from, and the filenames are
 * how three payment runs for one group stay three files. Both were wrong at
 * once and both are cheap to pin.
 */

const bankRow = {
  group_name: 'NEXUS',
  person_name: 'Juan Estrada',
  phone: '+447480373790',
  company: 'A J Rayson',
  payable_amount: '500',
  currency: 'GBP',
  payment_method: 'bank',
  bank_details: 'Santander',
  account_number: '10942488',
  sort_code: '09 - 01 - 30',
};

const cashRow = {
  ...bankRow,
  person_name: 'Gloria',
  payment_method: 'cash',
  bank_details: 'Will never be bank',
  account_number: 'Will never be bank',
  sort_code: 'Will never be bank',
};

const headersOf = (sheet) => sheet.getRow(1).values.slice(1);
const rowValues = (sheet, n) => sheet.getRow(n).values.slice(1);

/** The headers a sheet writes when nobody picks columns. */
const defaultHeaders = (kind) =>
  buildPayoutWorkbook([bankRow], kind).getWorksheet('General').getRow(1).values.slice(1);

test('the bank sheet carries account number and sort code, not just the bank', () => {
  assert.deepStrictEqual(defaultHeaders('bank'), [
    'Name of individual',
    'Contact number',
    'Amount payable',
    'From Which company',
    'Bank details of the individual',
    'Account number',
    'Sort code',
    'Should be paid or not',
  ]);
});

test('picking no columns hands over the same document as before', () => {
  // The pool is twenty-four fields now. An export with no selection must
  // still be the boss's own file, not a dump of everything: a script or an
  // old saved link sends no columns.
  assert.deepStrictEqual(defaultHeaders('cash'), [
    'Name of individual', 'Contact number', 'Post code', 'Amount', 'Currency',
    'Label', 'Where', 'Status', 'Should be paid or not', 'Notes',
  ]);
  assert.deepStrictEqual(defaultHeaders('expensing'), [
    'Role', 'Name of individual', 'Company in question', 'Appointment date',
    'Payment start date', 'Preset date', 'Payable days this month',
    'Method of payment', 'Monthly amount', 'Payable amount', 'Currency',
    'Location generic', 'Should be paid or not',
  ]);
});

test('a chosen set narrows and adds, in the sheet own order', () => {
  const wb = buildPayoutWorkbook([bankRow], 'bank', {
    // Dropped: contact, company, bank details. Added: group and notes.
    columns: ['group_name', 'payable_amount', 'account_number', 'sort_code', 'notes'],
  });
  assert.deepStrictEqual(wb.getWorksheet('General').getRow(1).values.slice(1), [
    // Name of individual is required and comes back even though it was not
    // asked for. The order is the sheet's, never the pick order: the default
    // set keeps its own sequence at the front, and anything added lands
    // behind it, so a familiar document never reshuffles when one column is
    // switched on.
    'Name of individual', 'Amount payable', 'Account number', 'Sort code', 'Group', 'Notes',
  ]);
});

test('every payout sheet offers its pool, marking the default and the one that cannot go', () => {
  for (const kind of ['expensing', 'cash', 'bank']) {
    const cols = listPayoutColumns(kind);
    const required = cols.filter((c) => c.required).map((c) => c.key);
    assert.deepStrictEqual(required, ['person_name'], kind);
    assert.ok(cols.length > cols.filter((c) => c.inSend).length, `${kind} must offer more than it sends`);
    // The catalogue is one list, so every sheet can reach every field.
    assert.ok(cols.some((c) => c.key === 'account_number'), kind);
  }
  // A sheet's own vocabulary survives: same field, three headers.
  const headerOf = (kind, key) => listPayoutColumns(kind).find((c) => c.key === key).header;
  assert.deepStrictEqual(
    ['expensing', 'cash', 'bank'].map((k) => headerOf(k, 'payable_amount')),
    ['Payable amount', 'Amount', 'Amount payable'],
  );
});

test('an account number stays text, so a leading zero survives', () => {
  const wb = buildPayoutWorkbook([{ ...bankRow, account_number: '00942488' }], 'bank');
  const general = wb.getWorksheet('General');
  const at = headersOf(general).indexOf('Account number');
  assert.strictEqual(rowValues(general, 2)[at], '00942488');
});

test('the sentinels are written verbatim, never blanked', () => {
  // "Will never be bank" is a real statement (canonical.js names it as a
  // sentinel): this person is never paid by transfer. An empty cell would
  // read as details somebody has to chase.
  const wb = buildPayoutWorkbook([cashRow], 'bank');
  const general = wb.getWorksheet('General');
  const headers = headersOf(general);
  for (const header of ['Bank details of the individual', 'Account number', 'Sort code']) {
    assert.strictEqual(rowValues(general, 2)[headers.indexOf(header)], 'Will never be bank');
  }
});

/**
 * A payout file is the document the money goes out from, so a row it says
 * "no" beside must not be in the figure somebody draws.
 */
const payoutRow = (person, extra) => ({
  group_name: 'MANBAT', person_name: person, company: 'Workforce',
  currency: 'GBP', payment_method: 'cash', payable_amount: 500,
  status: 'active', ...extra,
});

const totalOf = (sheet) => {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const v = sheet.getRow(r).values.slice(1);
    if (v[0] === 'Total') return { currency: v[1], amount: v[2] };
  }
  return null;
};

for (const kind of ['cash', 'bank', 'expensing']) {
  test(`${kind} shows Should be paid or not, and leaves a no out of the total`, () => {
    const wb = buildPayoutWorkbook([
      payoutRow('Gloria', { override_should_be_paid: true }),
      payoutRow('Smurf', { override_should_be_paid: false }),
      // NULL is "nobody decided", which the CRM resolves to yes, so it counts.
      payoutRow('Nobody', { override_should_be_paid: null }),
    ], kind);
    const sheet = wb.getWorksheet('General');
    const headers = sheet.getRow(1).values.slice(1);
    const at = headers.indexOf('Should be paid or not');
    assert.notStrictEqual(at, -1, `${kind} must carry the column`);

    assert.deepStrictEqual(
      [2, 3, 4].map((r) => sheet.getRow(r).values.slice(1)[at]),
      ['yes', 'no', 'yes'],
    );
    // 500 + 500, not 1500. Smurf's is on the page and out of the figure.
    assert.deepStrictEqual(totalOf(sheet), { currency: 'GBP', amount: 1000 });
  });
}

test('green for yes, red for no, on the cell and not the row', () => {
  const wb = buildPayoutWorkbook([
    payoutRow('Gloria', { override_should_be_paid: true }),
    payoutRow('Smurf', { override_should_be_paid: false }),
  ], 'cash');
  const sheet = wb.getWorksheet('General');
  const at = sheet.getRow(1).values.slice(1).indexOf('Should be paid or not') + 1;

  assert.strictEqual(sheet.getRow(2).getCell(at).fill.fgColor.argb, 'FFE7F3EC');
  assert.strictEqual(sheet.getRow(3).getCell(at).fill.fgColor.argb, 'FFFBE4E4');
  // The rest of the row is untouched: the deal is still real and still read.
  assert.strictEqual(sheet.getRow(3).getCell(1).fill, undefined);
});

test('an ended period alone does not drop a row from a payout total', () => {
  // THE RULE THIS FILE USED TO HAVE, now deliberately gone. An end date on
  // its own excluded the row, which dropped ten MILKMAN deals and 6,500 the
  // boss's own August sheet pays: two of them ended on the 26th and are
  // still paid the whole month.
  const wb = buildPayoutWorkbook([
    payoutRow('Gloria', { payment_period: 'active' }),
    payoutRow('Klaud', { payment_period: 'ended', end_on: presetOffset(-12) }),
  ], 'cash');
  assert.deepStrictEqual(totalOf(wb.getWorksheet('General')), { currency: 'GBP', amount: 1000 });
});

test('with the setting on, a deal that ended before its month leaves the payout total', () => {
  // The end date takes part ONLY through the setting, and then through the
  // same predicate the colour uses. One rule, three exports.
  const rows = [
    payoutRow('Gloria', { preset_on: presetNow(), end_on: presetOffset(12) }),
    payoutRow('Klaud', { preset_on: presetNow(), end_on: presetOffset(-12) }),
  ];
  const off = buildPayoutWorkbook(rows, 'cash');
  const on = buildPayoutWorkbook(rows, 'cash', { colorUsesEndDate: true });
  assert.deepStrictEqual(totalOf(off.getWorksheet('General')), { currency: 'GBP', amount: 1000 });
  assert.deepStrictEqual(totalOf(on.getWorksheet('General')), { currency: 'GBP', amount: 500 });
});

test('the payout template forwards the setting rather than dropping it', () => {
  // Destructured to `{ columns }`, the template threw colorUsesEndDate away
  // and the payout files totalled on the default while the master sheet
  // obeyed the setting.
  const rows = [
    payoutRow('Gloria', { preset_on: presetNow(), end_on: presetOffset(12) }),
    payoutRow('Klaud', { preset_on: presetNow(), end_on: presetOffset(-12) }),
  ];
  const wb = templateFor('cash').build(rows, { colorUsesEndDate: true });
  assert.deepStrictEqual(totalOf(wb.getWorksheet('General')), { currency: 'GBP', amount: 500 });
});

test('a row left out of the total is marked on its amount', () => {
  // It was marked on Status, which the bank and expensing default sets do
  // not carry: an excluded row sat on those files with its amount out of
  // the figure and nothing at all saying so.
  const rows = [
    payoutRow('Gloria', { preset_on: presetNow(), end_on: presetOffset(12) }),
    payoutRow('Klaud', { preset_on: presetNow(), end_on: presetOffset(-12) }),
  ];
  const sheet = buildPayoutWorkbook(rows, 'cash', { colorUsesEndDate: true }).getWorksheet('General');
  const at = sheet.getRow(1).values.slice(1).indexOf('Amount') + 1;
  assert.strictEqual(sheet.getRow(2).getCell(at).fill, undefined);
  // READ OFF THE PALETTE, never typed. The mark follows the picked
  // secondary now, and it was a beige spelled out here and again in
  // buildWorkbook, so the two files marked one fact in two colours.
  const { fillsFor } = require('./breakdowns/palette');
  assert.strictEqual(sheet.getRow(3).getCell(at).fill.fgColor.argb, fillsFor().tint.fgColor.argb);
});

test('every export names its own document', () => {
  const labels = [
    'master-sheet', 'monthly-sheet', 'breakdown', 'expensing', 'cash', 'bank', 'bank-details',
  ].map((id) => fileLabelOf(templateFor(id)));
  assert.deepStrictEqual(labels, [
    'MASTER SHEET', 'MONTH SHEET', 'BREAKDOWN', 'EXPENSING', 'CASH', 'BANK', 'BANK DETAILS',
  ]);
});

test('bank details draws the bank columns, under a name of its own', () => {
  // Same shape, different document. Sharing the builder is what stops the
  // two files drifting apart in a column; the separate id is what stops
  // them landing on the same filename.
  const bank = templateFor('bank').build([bankRow]);
  const details = templateFor('bank-details').build([bankRow, cashRow]);
  const headers = (wb) => wb.getWorksheet('General').getRow(1).values.slice(1);
  assert.deepStrictEqual(headers(details), headers(bank));
  assert.notStrictEqual(fileLabelOf(templateFor('bank-details')), fileLabelOf(templateFor('bank')));
});

test('a run narrowed to people is named for them, not for the group', () => {
  // Three of NEXUS's rows in a file called "NEXUS - BANK" is a file that
  // lies about itself, so the people win.
  assert.strictEqual(exportScope(['gary'], ['NEXUS']), 'gary');
  assert.strictEqual(exportScope(['gary', 'zayn', 'pino'], ['NEXUS']), '3 people');
  assert.strictEqual(exportScope([], ['NEXUS']), 'NEXUS');
  assert.strictEqual(exportScope([], ['NEXUS', 'INDIGO']), null);
  assert.strictEqual(exportScope([], []), null);
});

test('a slice and the whole run never share a filename', () => {
  const whole = exportFileName(exportScope([], ['NEXUS']), 'BANK', '2026-08-24');
  const slice = exportFileName(exportScope(['a', 'b'], ['NEXUS']), 'BANK', '2026-08-24');
  const widened = exportFileName(exportScope([], ['NEXUS']), 'BANK DETAILS', '2026-08-24');
  assert.deepStrictEqual([whole, slice, widened], [
    'NEXUS - BANK - 2026-08-24',
    '2 people - BANK - 2026-08-24',
    'NEXUS - BANK DETAILS - 2026-08-24',
  ]);
  assert.strictEqual(new Set([whole, slice, widened]).size, 3);
});

test('three runs for one group are three filenames', () => {
  const names = ['bank', 'cash', 'expensing']
    .map((id) => exportFileName('NEXUS', fileLabelOf(templateFor(id)), '2026-08-24'));
  assert.deepStrictEqual(names, [
    'NEXUS - BANK - 2026-08-24',
    'NEXUS - CASH - 2026-08-24',
    'NEXUS - EXPENSING - 2026-08-24',
  ]);
  assert.strictEqual(new Set(names).size, 3);
});

test('no single group leaves the scope off rather than naming nothing', () => {
  assert.strictEqual(exportFileName(null, 'BANK', '2026-08-24'), 'BANK - 2026-08-24');
});

test('a scope that cannot be a filename is spaced, not stripped', () => {
  assert.strictEqual(exportFileName('SG/CKA', 'CASH', '2026-08'), 'SG CKA - CASH - 2026-08');
});
