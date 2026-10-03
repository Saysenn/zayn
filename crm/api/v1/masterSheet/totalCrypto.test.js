const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMasterSheetWorkbook } = require('./buildWorkbook');
const { currentMonth } = require('../shared/presetMonth.helper');

/**
 * ***************************************************
 * * THE ANSWER BLOCK NAMES EVERY RAIL, INCLUDING CRYPTO
 * ***************************************************
 *
 * The left pivot printed "Crypto $1,160.90" and the answer block beside it
 * named only bank and cash. So the one place somebody reads before paying
 * was short by a whole method, and nothing on the page said so.
 *
 * "Of which UK" and "Of which other" split the CASH total and must still
 * sum back to it. Crypto is not cash and never was, which is why it goes
 * ABOVE them rather than between them: the split is untouched.
 *
 * Built as a real xlsx and read back, because what is under test is what
 * lands in the file.
 */

// Relative, so this does not rot into a fixture that only passes in 2026.
const MONTH = currentMonth();

const deal = (over) => ({
  group_name: 'MILKMAN', company: 'Whitestone Swan', person_name: 'Neo',
  person_id: 'neo', role: 'mid', seat: 1, role_label: 'Mid 1',
  currency: 'GBP', payment_method: 'cash', payable_amount: 1000,
  monthly_amount: 1000, preset_on: `${MONTH}-01`, payable_days: 30,
  location: 'Abu Dhabi', status: 'active',
  addon_percent: 0, fee_percent: 0, ...over,
});

function blockFor(rows, breakdownDesign = 'with-usd') {
  const wb = buildMasterSheetWorkbook(rows, { month: MONTH, breakdownDesign });
  const WANT = /^(Total bank|Total Cash|Total Crypto|Of which UK|Of which other|UK send in GBP)$/;
  const out = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell, col) => {
        const text = typeof cell.value === 'string' ? cell.value.trim() : '';
        if (WANT.test(text)) out.push({ label: text, value: Number(row.getCell(col + 1).value) || 0 });
      });
    });
  });
  return out;
}

const MIXED = [
  deal({ person_id: 'a', person_name: 'A', payment_method: 'cash', payable_amount: 1000 }),
  deal({ person_id: 'b', person_name: 'B', payment_method: 'bank', payable_amount: 2000 }),
  deal({ person_id: 'c', person_name: 'C', payment_method: 'crypto', payable_amount: 3000 }),
];

const NO_CRYPTO = [
  deal({ person_id: 'a', person_name: 'A', payment_method: 'cash', payable_amount: 1000 }),
  deal({ person_id: 'b', person_name: 'B', payment_method: 'bank', payable_amount: 2000 }),
];

test('A GROUP PAID IN COIN GETS A TOTAL CRYPTO ROW', () => {
  const labels = blockFor(MIXED).map((x) => x.label);
  assert.ok(labels.includes('Total Crypto'), `no crypto row: ${labels.join(', ')}`);
});

test('and it carries the crypto figure, not a zero', () => {
  const crypto = blockFor(MIXED).find((x) => x.label === 'Total Crypto');
  assert.ok(crypto.value > 0, `Total Crypto came out ${crypto.value}`);
});

test('THE ORDER IS BANK, CASH, CRYPTO, THEN THE CASH SPLIT', () => {
  // The split belongs UNDER the rails, because it divides one of them.
  const labels = blockFor(MIXED).map((x) => x.label);
  const at = (l) => labels.indexOf(l);

  assert.ok(at('Total bank') < at('Total Cash'), 'bank must come first');
  assert.ok(at('Total Cash') < at('Total Crypto'), 'crypto sits under cash');
  assert.ok(at('Total Crypto') < at('Of which UK'), 'the cash split must come after the rails');
  assert.ok(at('Of which other') < at('UK send in GBP'), 'the GBP send is last');
});

test('THE CASH SPLIT IS UNTOUCHED, and still sums back to the cash total', () => {
  // The whole point: crypto is not cash, so adding its row must not move
  // either half of the split.
  const block = blockFor(MIXED);
  const val = (l) => block.find((x) => x.label === l).value;

  assert.ok(
    Math.abs((val('Of which UK') + val('Of which other')) - val('Total Cash')) < 0.02,
    `${val('Of which UK')} + ${val('Of which other')} != ${val('Total Cash')}`,
  );
});

test('A GROUP WITH NO CRYPTO GETS NO ROW, not a zero to read past', () => {
  const labels = blockFor(NO_CRYPTO).map((x) => x.label);
  assert.equal(labels.includes('Total Crypto'), false);
  // The rest of the block is still there.
  assert.ok(labels.includes('Total bank'));
  assert.ok(labels.includes('Total Cash'));
});

test('BOTH USD DESIGNS get it, since one draws the other', () => {
  // `with-usd-table` is `with-usd` with one option flipped, and a copy of
  // this block in either would drift the first time one was touched.
  for (const design of ['with-usd', 'with-usd-table']) {
    const labels = blockFor(MIXED, design).map((x) => x.label);
    assert.ok(labels.includes('Total Crypto'), `${design} has no crypto row`);
  }
});

/**
 * ===============================
 * * CONTRACT: the answer block, row for row
 * ===============================
 *
 * The export writes this block and `crm/web`'s `breakdownPreviews.jsx`
 * draws a sample of it. The two went out of step the moment Total Crypto
 * was added here: the preview kept naming only bank and cash, so it showed
 * a document this builder no longer produces.
 *
 * WRITTEN TWICE, NEVER READ ACROSS. The two codebases share no file, and a
 * test reaching over the boundary is not an exemption: either side must
 * build and test on a machine holding only itself. The web half is
 * `components/export/breakdownPreviews.test.js`, which asserts the sample
 * draws exactly these labels in exactly this order.
 *
 * Adding a row means editing this list and that one.
 */
const ANSWER_BLOCK = [
  'Total bank',
  'Total Cash',
  // ABOVE the split: "Of which" divides the CASH total and must still sum
  // back to it. Crypto is not cash and never was.
  'Total Crypto',
  'Of which UK',
  'Of which other',
  'UK send in GBP',
];

test('THE ANSWER BLOCK IS WRITTEN IN FULL, and in order', () => {
  const labels = blockFor(MIXED).map((x) => x.label);
  assert.deepEqual(labels, ANSWER_BLOCK, 'the file no longer matches the contract');
});
