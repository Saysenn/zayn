const test = require('node:test');
const assert = require('node:assert');

const {
  startFromAppointment, endFromAppointment, stillTheFormulasAnswer,
  PAYMENT_START_OFFSET_DAYS,
} = require('./fromAppointment.helper');
const { recomputePayable } = require('./recomputePayable.helper');

/**
 * ***************************************************
 * * The appointment date drives four cells
 * ***************************************************
 *
 * Verified against docs/boss/references/master.xlsx: column F is `=E2+90`
 * on 78 of 96 rows, column H is `=DATE(YEAR(E9)+1,...)` on 73, and I and L
 * read F. The CRM stored the appointment and let it drive nothing.
 *
 * The row used throughout is row 12 of that file, Thomas Snelling, INDIGO:
 * appointment 2026-01-20, preset July 2026, monthly 1000.
 */

const D = (iso) => new Date(`${iso}T00:00:00.000Z`);
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

const ROW_12 = () => ({
  assigned_on: D('2026-01-20'),
  payment_start_on: D('2026-04-20'), // 2026-01-20 + 90
  end_on: D('2027-01-20'), // 2026-01-20 + 1 year
  preset_on: D('2026-07-01'),
  monthly_amount: 1000,
  payable_days: 31,
  payable_amount: 1000,
});

test('the offset is the sheet, not the documents', () => {
  // His two written documents say 12 weeks and "84 days from incorporation".
  // His spreadsheet says 90 on all 78 formula rows, and the money was paid
  // against the spreadsheet. Decided 2026-09-08.
  assert.equal(PAYMENT_START_OFFSET_DAYS, 90);
});

test('the two derivations match his own formulas', () => {
  assert.equal(day(startFromAppointment(D('2026-01-20'))), '2026-04-20');
  assert.equal(day(endFromAppointment(D('2026-01-20'))), '2027-01-20');
});

test('no appointment derives nothing, rather than guessing from the epoch', () => {
  assert.equal(startFromAppointment(null), null);
  assert.equal(endFromAppointment('Ongoing'), null);
});

test('29 February rolls to 1 March, the way Excel DATE does', () => {
  // =DATE(YEAR(E)+1, MONTH(E), DAY(E)) on 2028-02-29 gives 2029-03-01.
  assert.equal(day(endFromAppointment(D('2028-02-29'))), '2029-03-01');
});

/**
 * ===============================
 * * THE CASCADE'S GUARD
 * ===============================
 */

test('an empty cell has nothing to protect', () => {
  assert.equal(stillTheFormulasAnswer(null, D('2026-01-20'), 'start'), true);
});

test('a cell still equal to the old formula is the formula', () => {
  assert.equal(stillTheFormulasAnswer(D('2026-04-20'), D('2026-01-20'), 'start'), true);
  assert.equal(stillTheFormulasAnswer(D('2027-01-20'), D('2026-01-20'), 'end'), true);
});

test('a cell a human typed over is not', () => {
  // The Indigo pair: he used 2026-08-01 where the formula gives 2026-08-26.
  assert.equal(stillTheFormulasAnswer(D('2026-08-01'), D('2026-05-28'), 'start'), false);
});

test('with no old appointment, a stored date was not derived from one', () => {
  assert.equal(stillTheFormulasAnswer(D('2026-04-20'), null, 'start'), false);
});

/**
 * ===============================
 * * THE CASCADE, END TO END
 * ===============================
 */

/**
 * ===============================
 * * THE CASCADE WRITES STRINGS, AND THAT IS NOT A DETAIL
 * ===============================
 * A `date` column is written as `YYYY-MM-DD`, the same shape the route's
 * own parseDate produces.
 *
 * It shipped as a Date for an hour and the fault it caused is the reason
 * these exist. `pg` serialises a Date in LOCAL time, so a UTC midnight
 * Date leaves a Pacific machine as `2026-07-13T17:00:00-07:00`, and
 * Postgres casts that to a date using the SESSION timezone: correct in a
 * UTC session, a day early in a Pacific one. Diane's `formatValue` reads
 * the same Date with local getters and said 13 July for a start of the
 * 14th, which is how it was caught.
 */

test('the derived dates are YYYY-MM-DD strings, not Date objects', () => {
  const fields = { assignedOn: D('2026-04-15') };
  recomputePayable(ROW_12(), fields);
  assert.equal(typeof fields.paymentStartOn, 'string');
  assert.equal(typeof fields.endOn, 'string');
  assert.equal(fields.paymentStartOn, '2026-07-14');
  assert.equal(fields.endOn, '2027-04-15');
});

test('and they say the same day the arithmetic meant, in any timezone', () => {
  // The exact failure: a Date read with local getters, west of UTC.
  const fields = { assignedOn: D('2026-04-15') };
  recomputePayable(ROW_12(), fields);
  // READ AS A PACIFIC MACHINE WOULD, whatever this one is: local getters on
  // a Dubai or London machine show no drift, and the example proved nothing
  // there. 2026-10-04.
  const asDiaineWouldSay = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  // A plain string never reaches that formatter as a Date at all, which is
  // the whole point: there is no local/UTC question left to get wrong.
  assert.equal(fields.paymentStartOn, '2026-07-14');
  assert.notEqual(asDiaineWouldSay('2026-07-14T00:00:00.000Z'), fields.paymentStartOn,
    'this is the drift a Date would have carried, kept here as the reason');
});

test('a string still feeds the day count correctly', () => {
  const fields = { assignedOn: D('2026-04-15') };
  recomputePayable(ROW_12(), fields);
  assert.equal(fields.payableDays, 18, 'the string was read back as a real date');
  assert.equal(fields.payableAmount, 580.65);
});

test('moving the appointment moves start, end, days and amount', () => {
  const fields = { assignedOn: D('2026-04-15') };
  const derived = recomputePayable(ROW_12(), fields);

  assert.equal(day(fields.paymentStartOn), '2026-07-14');
  assert.equal(day(fields.endOn), '2027-04-15');
  assert.equal(fields.payableDays, 18, '14 July to 31 July inclusive');
  assert.equal(fields.payableAmount, 580.65, '1000 / 31 * 18');
  assert.deepEqual(derived, ['paymentStartOn', 'endOn', 'payableDays', 'payableAmount']);
});

test('an appointment that pushes the start past the month owes nothing', () => {
  const fields = { assignedOn: D('2026-05-20') };
  recomputePayable(ROW_12(), fields);
  assert.equal(day(fields.paymentStartOn), '2026-08-18');
  assert.equal(fields.payableDays, 0);
  assert.equal(fields.payableAmount, 0);
});

test('A SECOND APPOINTMENT EDIT STILL CASCADES', () => {
  // The case the whole guard design turns on. The first edit writes the
  // payment start, so if the cascade tested `manually_overridden_fields`
  // it would be blocked by its own output and work exactly once per row.
  const row = ROW_12();
  const first = { assignedOn: D('2026-04-15') };
  recomputePayable(row, first);

  // The row as it now stands, after that first edit landed.
  const after = {
    ...row,
    assigned_on: first.assignedOn,
    payment_start_on: first.paymentStartOn,
    end_on: first.endOn,
    payable_days: first.payableDays,
    payable_amount: first.payableAmount,
  };

  const second = { assignedOn: D('2026-01-20') };
  const derived = recomputePayable(after, second);
  assert.equal(day(second.paymentStartOn), '2026-04-20', 'back where it started');
  assert.equal(second.payableDays, 31);
  assert.equal(second.payableAmount, 1000);
  assert.ok(derived.includes('paymentStartOn'));
});

test('a hand typed payment start survives an appointment edit', () => {
  const row = ROW_12();
  row.payment_start_on = D('2026-08-01'); // typed, not appointment + 90
  const fields = { assignedOn: D('2026-04-15') };
  const derived = recomputePayable(row, fields);

  assert.equal(fields.paymentStartOn, undefined, 'left out of the patch entirely');
  assert.ok(!derived.includes('paymentStartOn'));
  // The end date WAS still the formula's, so it moves.
  assert.equal(day(fields.endOn), '2027-04-15');
});

test('clearing the appointment does not null the dates it drove', () => {
  const fields = { assignedOn: null };
  const derived = recomputePayable(ROW_12(), fields);
  assert.equal(fields.paymentStartOn, undefined);
  assert.equal(fields.endOn, undefined);
  assert.ok(!derived.includes('paymentStartOn'));
});

test('an explicit payment start in the same patch is the admin, not the formula', () => {
  const fields = { assignedOn: D('2026-04-15'), paymentStartOn: D('2026-06-01') };
  recomputePayable(ROW_12(), fields);
  assert.equal(day(fields.paymentStartOn), '2026-06-01');
});

/**
 * ===============================
 * * ON CREATE, BLANK IS ABSENT
 * ===============================
 * The POST route builds a full field set, so every unfilled cell arrives as
 * null. Without onCreate the guard read those nulls as deliberate blanks
 * and a new deal landed with four empty cells.
 */

const NEW_DEAL = () => ({
  assignedOn: D('2026-01-20'),
  paymentStartOn: null,
  endOn: null,
  presetOn: D('2026-07-01'),
  monthlyAmount: 1000,
  payableDays: null,
  payableAmount: null,
});

test('a new deal fills its own dates from the appointment', () => {
  const fields = NEW_DEAL();
  recomputePayable({}, fields, { onCreate: true });
  assert.equal(day(fields.paymentStartOn), '2026-04-20');
  assert.equal(day(fields.endOn), '2027-01-20');
  assert.equal(fields.payableDays, 31);
  assert.equal(fields.payableAmount, 1000);
});

test('without onCreate the same patch derives nothing, which was the bug', () => {
  const fields = NEW_DEAL();
  recomputePayable({}, fields);
  assert.equal(fields.paymentStartOn, null);
  assert.equal(fields.payableAmount, null);
});

test('a new deal with a typed payment start keeps it', () => {
  const fields = { ...NEW_DEAL(), paymentStartOn: D('2026-06-01') };
  recomputePayable({}, fields, { onCreate: true });
  assert.equal(day(fields.paymentStartOn), '2026-06-01');
  assert.equal(fields.payableDays, 31, '1 June is before July, so the whole of July');
});

test('a new deal with no appointment derives no dates', () => {
  const fields = { ...NEW_DEAL(), assignedOn: null };
  recomputePayable({}, fields, { onCreate: true });
  assert.equal(fields.paymentStartOn, null);
  assert.equal(fields.endOn, null);
});
