const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExpenseSheet } = require('./buildExpenseSheet');
const { parseExpenses } = require('./parseExpenses');
const { diffExpenses } = require('./diffExpenses');
const { HEADERS } = require('./expenseColumns');

/**
 * ***************************************************
 * * A FILE THIS CRM WROTE IS A FILE IT CAN READ
 * ***************************************************
 *
 * The export and the import share one column list, and this is what stops
 * them drifting: a round trip that loses a column loses it silently, and
 * the row comes back looking complete.
 */

const ROWS = [
  {
    id: 1,
    spent_on: '2026-09-12',
    description: 'Taxi to the airport',
    payee: 'Careem',
    group_name: 'MILKMAN',
    spent_by: 'Gloria',
    currency: 'PHP',
    raw_amount: '5000.00',
    exchange_rate: '0.06443000',
    aed_amount: '322.15',
    sync_key: 'k1',
  },
  {
    id: 2,
    spent_on: '2026-09-14',
    description: 'Office rent',
    payee: 'Landlord',
    group_name: null,
    spent_by: 'Drew',
    currency: 'AED',
    raw_amount: '3000.00',
    exchange_rate: '1.00000000',
    aed_amount: '3000.00',
    sync_key: 'k2',
  },
];

const roundTrip = async (rows = ROWS) => {
  const workbook = buildExpenseSheet(rows, { month: '2026-09' });
  const buffer = await workbook.xlsx.writeBuffer();
  return parseExpenses(Buffer.from(buffer), { filename: 'expenses-2026-09.xlsx' });
};

test('the sheet carries every column the parser knows', async () => {
  const workbook = buildExpenseSheet(ROWS, { month: '2026-09' });
  const header = workbook.worksheets[0].getRow(1);
  const written = [];
  header.eachCell((cell) => written.push(cell.text));
  assert.deepEqual(written, HEADERS);
});

test('EVERY FIELD SURVIVES A ROUND TRIP', async () => {
  const { rows } = await roundTrip();
  assert.equal(rows.length, 2);

  assert.equal(rows[0].spentOn, '2026-09-12');
  assert.equal(rows[0].description, 'Taxi to the airport');
  assert.equal(rows[0].payee, 'Careem');
  assert.equal(rows[0].groupName, 'MILKMAN');
  assert.equal(rows[0].spentBy, 'Gloria');
  assert.equal(rows[0].currency, 'PHP');
  assert.equal(rows[0].rawAmount, 5000);
  assert.equal(rows[0].exchangeRate, 0.06443);
});

test('THE TOTAL ROW IS NOT IMPORTED AS AN EXPENSE', async () => {
  // The export writes one. Imported, it books the month's own total as a
  // spend and the next round trip doubles it again.
  //
  // WHAT ACTUALLY DROPS IT is the required pair below, not a rule about
  // the word "Total": the row carries neither a date nor a raw amount. A
  // guard naming the word was written first, and this test passed with it
  // disabled, which is how it was found to be doing nothing.
  const { rows } = await roundTrip();
  assert.ok(!rows.some((r) => r.description === 'Total'));
  assert.ok(!rows.some((r) => r.rawAmount === 3322.15));
});

test('a rate keeps its eight decimals, or the re-import is a different rate', async () => {
  const { rows } = await roundTrip();
  assert.equal(rows[0].exchangeRate, 0.06443);
});

test('an empty group comes back empty, not as the string "null"', async () => {
  const { rows } = await roundTrip();
  assert.equal(rows[1].groupName, null);
});

test('a currency is uppercased on the way in', async () => {
  const { rows } = await roundTrip([{ ...ROWS[0], currency: 'php' }]);
  assert.equal(rows[0].currency, 'PHP');
});

test('a row with no date or no amount is not an expense', async () => {
  const { rows } = await roundTrip([
    { ...ROWS[0], spent_on: null },
    { ...ROWS[1], raw_amount: null },
  ]);
  assert.equal(rows.length, 0);
});

test('the parse says which columns the FILE carried', async () => {
  const { columns } = await roundTrip();
  for (const field of ['spentOn', 'description', 'currency', 'rawAmount', 'exchangeRate']) {
    assert.ok(columns.includes(field), `${field} must be reported`);
  }
  // The derived one is written and never read back.
  assert.ok(!columns.includes('aedAmount'));
});

// ===============================
// * WHAT THE EXPORT MODAL PICKS
// ===============================

test('unticking a column leaves it out, and the file still re-imports', async () => {
  const workbook = buildExpenseSheet(ROWS, {
    month: '2026-09',
    columns: ['spentOn', 'description', 'currency', 'rawAmount', 'exchangeRate'],
  });
  const written = [];
  workbook.worksheets[0].getRow(1).eachCell((cell) => written.push(cell.text));
  assert.deepEqual(written, ['Date', 'Description', 'Currency', 'Raw amount', 'AED per unit']);

  const buffer = await workbook.xlsx.writeBuffer();
  const { rows } = await parseExpenses(Buffer.from(buffer));
  assert.equal(rows.length, 2, 'a narrowed file is still a file this CRM can read');
  assert.equal(rows[0].payee, null, 'a column left out is absent, not guessed');
});

test('THE DATE AND THE DESCRIPTION CANNOT BE UNTICKED', () => {
  // A list of amounts belonging to nothing is not an expenses sheet.
  const { columnsFrom, REQUIRED_FIELDS } = require('./expenseColumns');
  const fields = columnsFrom(['rawAmount']).map((c) => c.field);
  for (const required of REQUIRED_FIELDS) assert.ok(fields.includes(required));
});

test('no columns asked for means every column, not an empty sheet', () => {
  const { columnsFrom, PICKABLE } = require('./expenseColumns');
  assert.equal(columnsFrom([]).length, PICKABLE.length);
  assert.equal(columnsFrom(undefined).length, PICKABLE.length);
});

test('an unknown palette falls back rather than writing an undefined colour', () => {
  const { paletteFor, PALETTE } = require('./expenseColumns');
  assert.equal(paletteFor('nonsense').id, PALETTE[0].id);
  assert.equal(paletteFor('plain').fill, null, 'plain writes no fill at all');
  // The swatch's own words, so the shared Swatches control needs no second
  // shape to translate.
  for (const skin of PALETTE) {
    assert.match(skin.strong, /^#[0-9a-f]{6}$/i, `${skin.id} needs a css strong`);
    assert.match(skin.soft, /^#[0-9a-f]{6}$/i, `${skin.id} needs a css soft`);
  }
});

test('the Total row only appears when the AED column was picked', async () => {
  const workbook = buildExpenseSheet(ROWS, {
    month: '2026-09', columns: ['spentOn', 'description', 'rawAmount'],
  });
  const texts = [];
  workbook.worksheets[0].eachRow((row) => row.eachCell((cell) => texts.push(cell.text)));
  assert.ok(!texts.includes('Total'), 'nothing to total without the AED column');
});

// ===============================
// * THE DIFF
// ===============================

test('a file of new spends is all NEW', async () => {
  const { rows } = await roundTrip();
  const { diff, counts } = diffExpenses(rows, []);
  assert.equal(counts.new, 2);
  assert.equal(counts.duplicate, 0);
  assert.equal(diff.new[0].description, 'Taxi to the airport');
});

test('A ROW ALREADY RECORDED IS A QUESTION, NEVER A MERGE', async () => {
  const { rows } = await roundTrip();
  const existing = [{
    id: 9,
    spent_on: '2026-09-12',
    description: 'Taxi to the airport',
    payee: 'Careem',
    currency: 'PHP',
    raw_amount: '5000.00',
    sync_key: rows[0].syncKey,
  }];

  const { diff, counts } = diffExpenses(rows, existing);
  assert.equal(counts.duplicate, 1);
  assert.equal(counts.new, 1);
  // It shows WHAT it looks like, so the answer is not a guess.
  assert.equal(diff.duplicate[0].matches.length, 1);
  assert.equal(diff.duplicate[0].matches[0].id, 9);
});

test('the same fare twice IN ONE FILE is the same question', async () => {
  const { rows } = await roundTrip([ROWS[0], ROWS[0]]);
  const { counts, diff } = diffExpenses(rows, []);
  assert.equal(counts.new, 1, 'the first one is new');
  assert.equal(counts.duplicate, 1, 'the second is asked about');
  assert.equal(diff.duplicate[0].alsoInFile, 1);
});

test('NO RATE IS ITS OWN TAB, and the importer never invents one', async () => {
  const { rows } = await roundTrip([{ ...ROWS[0], exchange_rate: null, aed_amount: null }]);
  const { counts, diff } = diffExpenses(rows, []);
  assert.equal(counts.noRate, 1);
  assert.equal(counts.new, 0);
  assert.equal(diff.noRate[0].exchangeRate, null);
});
