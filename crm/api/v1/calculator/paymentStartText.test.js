const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { readPaymentStart } = require('./paymentStartText');
const { payableDaysFor, payableAmountFor } = require('./computePayable');
const { parseMasterSheetImport } = require('../masterSheet/parseImport');
const { rollToMonth } = require('../masterSheet/rollToMonth');

/**
 * WORDS IN THE PAYMENT START COLUMN.
 *
 * The rule, checked against the boss's own August drafts rather than
 * against a reading of the words: the words are a note over the column's own
 * formula, and the formula is APPOINTMENT + 90 DAYS.
 *
 *   Monument Marketing  "AUGUST END FULL"   -> 2026-08-03, 29 days, £1,169.35
 *   Social work ptnrs   "OCTOBER END FULL"  -> 2026-11-03, nothing in August
 *
 * Both of those are his figures, from
 * docs/boss/MILKMAN boy august unpaid.xlsx and
 * docs/boss/August send for Indigo 1 unpaid draft 1.xlsx.
 */

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

test('the column only tells us WHICH KIND of words it is', () => {
  assert.equal(readPaymentStart('Ongoing'), 'ongoing');
  assert.equal(readPaymentStart('AUGUST END FULL'), 'prose');
  assert.equal(readPaymentStart('TBC'), 'prose');
  // Not words at all: an ordinary row, and every ordinary row.
  assert.equal(readPaymentStart(utc(2026, 8, 3)), null);
  assert.equal(readPaymentStart(''), null);
  assert.equal(readPaymentStart(null), null);
});

test('nothing is read out of the words themselves', () => {
  // It used to return a date and a "pay a full month" flag from these, and
  // both were wrong. The signature cannot express either any more.
  assert.equal(typeof readPaymentStart('AUGUST END FULL'), 'string');
});

test('there is no pay-a-full-month escape hatch left', () => {
  const start = utc(2026, 8, 31);
  const preset = utc(2026, 7, 1);
  assert.equal(payableDaysFor(start, preset), 0);
  // The old `fullMonth` option is gone: an unknown option changes nothing.
  assert.equal(payableDaysFor(start, preset, { fullMonth: true }), 0);
  assert.equal(
    payableAmountFor({ monthlyAmount: 1200, paymentStartOn: start, presetOn: preset, fullMonth: true }),
    0,
  );
});

/** A one-row sheet with whatever the payment start cell should hold. */
async function upload(startCell, appointment) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MILKMAN');
  ws.addRow(['Group', 'Role:', 'Name of individual', 'Company in question',
    'Appointment date', 'Payment start date', 'Preset date', 'Monthly amount']);
  ws.addRow(['MILKMAN', 'Director', 'James King', 'Monument Marketing',
    appointment, startCell, utc(2026, 8, 1), 1250]);
  const { rows } = await parseMasterSheetImport(Buffer.from(await wb.xlsx.writeBuffer()));
  return rows[0];
}

test('prose falls back to the column own formula, appointment plus 90', async () => {
  // His draft for this exact row: start 2026-08-03, 29 days, 1,169.35.
  const row = await upload('AUGUST END FULL', utc(2026, 5, 5));
  assert.equal(row.paymentStartOn, '2026-08-03');
  assert.equal(row.payableDays, 29);
  assert.equal(row.payableAmount, 1169.35);
});

/**
 * ===============================
 * * THE FIGURE STANDS. THE WORDS GO WITH IT.
 * ===============================
 * This asserted needsReview false and empty notes, on the reading that
 * appointment + 90 was his rule and so nothing needed a human.
 *
 * It is not a rule. He resolved `AUGUST END FULL` two ways in the SAME
 * month: MILKMAN's James King and Drew at appointment + 90 (2026-08-03,
 * 29 days, 1,169.35 each, the row above), and INDIGO's Lucy Okenabirhie
 * and Nicola at a start of 2026-08-01 and the whole month, 1,200 and 800.
 * Appointment + 90 for that pair is 2026-08-26, which is 6 days and
 * 232.26 and 154.84. The CRM would have paid them 1,612.90 short and said
 * nothing. Verified in docs/boss/references/indigo 1 august.xlsx.
 *
 * So the computed figure is unchanged and the row is FLAGGED, with his
 * own words kept, for a human to settle. See docs/state.md.
 */
test('prose is flagged for a human, and his words are kept', async () => {
  const row = await upload('AUGUST END FULL', utc(2026, 5, 5));
  assert.equal(row.needsReview, true);
  assert.match(row.reviewReason, /AUGUST END FULL/);
  assert.match(row.reviewReason, /appointment \+ 90 days/);
  assert.equal(row.notes, 'Payment start: AUGUST END FULL');
});

test('Ongoing is a blank cell, not prose, so it is never flagged for it', async () => {
  // Twelve rows of the live sheet say Ongoing. It means no recorded start,
  // full month, and flagging every one of them each upload would make the
  // review list useless.
  const row = await upload('Ongoing', utc(2026, 5, 5));
  assert.equal(row.paymentStartOn, null);
  assert.equal(row.notes, '');
  assert.ok(!/Ongoing/.test(row.reviewReason ?? ''));
});

test('a real date always wins over the formula', async () => {
  // He hand-set Leadstone to the 1st. An upload of that file must take it.
  const row = await upload(utc(2026, 8, 1), utc(2026, 5, 28));
  assert.equal(row.paymentStartOn, '2026-08-01');
  assert.equal(row.payableDays, 31);
  assert.equal(row.payableAmount, 1250);
});

test('Ongoing is no recorded start, so a full month and no flag', async () => {
  const row = await upload('Ongoing', utc(2025, 1, 1));
  assert.equal(row.paymentStartOn, null);
  assert.equal(row.payableDays, 31);
  assert.equal(row.payableAmount, 1250);
  assert.equal(row.needsReview, false);
});

test('prose with no appointment to fall back on stays unknown and flags', async () => {
  // Unknown is a real answer. A guess here pro-rates somebody's pay against
  // a date nobody wrote.
  const row = await upload('TBC', 'Ongoing');
  assert.equal(row.paymentStartOn, null);
  assert.match(row.reviewReason, /payment start reads "TBC", not a date/);
  assert.equal(row.needsReview, true);
});

test('the figures are computed once, at upload, against the row own preset', async () => {
  // Appointed 5 Aug, which is inside the first week (August's first Friday
  // is the 7th), so the start is the last Friday of month 3 rather than
  // +90. It was 2026-11-03 until that rule landed.
  const row = await upload('OCTOBER END FULL', utc(2026, 8, 5));
  assert.equal(row.paymentStartOn, '2026-10-30');
  // Preset 2026-08-01, so August is month 1 and nothing is forced: the
  // start is still after August ends, nothing is owed, and his INDIGO
  // August draft leaves this pair blank too.
  assert.equal(row.payableDays, 0);
  assert.equal(row.payableAmount, 0);

  // And an export never touches either of them again. See rollToMonth.
  const db = [{
    group_name: 'MILKMAN', person_name: row.personName, company: row.company,
    payment_start_on: row.paymentStartOn, preset_on: row.presetOn,
    payable_days: row.payableDays, payable_amount: row.payableAmount,
    monthly_amount: row.monthlyAmount, currency: 'GBP', status: 'active',
  }];
  for (const month of ['2026-08', '2026-11', '2027-02']) {
    const out = rollToMonth(db, month).rows[0];
    assert.equal(out.preset_on, '2026-08-01', month);
    assert.equal(out.payable_days, 0, month);
    assert.equal(out.payable_amount, 0, month);
  }
});
