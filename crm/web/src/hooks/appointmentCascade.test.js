import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startFromAppointment, endFromAppointment, stillTheFormulasAnswer, asColumnDate,
} from '../helpers/fromAppointment.js';
import { payableFromDays, payableDaysFor, PAYABLE_INPUTS, DAY_COUNT_INPUTS } from '../helpers/payable.js';

/**
 * ***************************************************
 * * Five cells move on one typed date
 * ***************************************************
 *
 * The optimistic patch painted only the column that was edited, so typing
 * an appointment date changed one cell and left the payment start, end
 * date, payable days and payable amount on their old values until the
 * refetch landed. On a table with no Save button that reads as a failed
 * edit.
 *
 * The hook needs React, so the two derived steps are rebuilt here and the
 * WIRING is asserted against the source, the same arrangement
 * patchDeal.test.js already uses.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, f), 'utf8');

// withDerivedDates and withPayable, rebuilt without React. Kept identical
// to useMasterSheet.js: the assertions at the bottom are what stop this
// copy drifting from the real one.
function withDerivedDates(row, fields, oldRow, skipped) {
  if (fields.assignedOn === undefined) return row;
  if (!fields.assignedOn) return row;
  const out = { ...row };
  const pairs = [
    ['paymentStartOn', 'payment_start_on', 'start', startFromAppointment],
    ['endOn', 'end_on', 'end', endFromAppointment],
  ];
  for (const [key, column, kind, derive] of pairs) {
    if (fields[key] !== undefined) continue;
    if (!stillTheFormulasAnswer(oldRow[column], oldRow.assigned_on, kind)) { skipped?.add(column); continue; }
    out[column] = asColumnDate(derive(fields.assignedOn));
  }
  return out;
}

function withPayable(row, fields) {
  if (fields.payableAmount !== undefined) return row;
  if (!PAYABLE_INPUTS.some((k) => fields[k] !== undefined)) return row;
  const movedDates = DAY_COUNT_INPUTS.some((k) => fields[k] !== undefined);
  const payableDays = movedDates && fields.payableDays === undefined
    ? payableDaysFor(row.payment_start_on, row.preset_on)
    : row.payable_days;
  return {
    ...row,
    payable_days: payableDays,
    payable_amount: payableFromDays({
      monthlyAmount: row.monthly_amount, presetOn: row.preset_on, payableDays,
    }),
  };
}

const COLUMN_FOR = {
  assignedOn: 'assigned_on', paymentStartOn: 'payment_start_on', endOn: 'end_on',
  payableDays: 'payable_days', payableAmount: 'payable_amount', monthlyAmount: 'monthly_amount',
};
const toColumns = (f) => Object.fromEntries(
  Object.entries(f).map(([k, v]) => [COLUMN_FOR[k] ?? k, v]),
);

const editedDeal = (row, fields) => withPayable(
  withDerivedDates({ ...row, ...toColumns(fields) }, fields, row), fields,
);

// Row 12 of master.xlsx: Thomas Snelling, INDIGO, preset July 2026.
const ROW_12 = () => ({
  id: 12,
  assigned_on: '2026-01-20',
  payment_start_on: '2026-04-20',
  end_on: '2027-01-20',
  preset_on: '2026-07-01',
  monthly_amount: 1000,
  payable_days: 31,
  payable_amount: 1000,
});

test('one typed appointment date paints all five cells', () => {
  const out = editedDeal(ROW_12(), { assignedOn: '2026-04-15' });
  assert.equal(out.assigned_on, '2026-04-15');
  assert.equal(out.payment_start_on, '2026-07-14');
  assert.equal(out.end_on, '2027-04-15');
  assert.equal(out.payable_days, 18);
  assert.equal(out.payable_amount, 580.65);
});

test('an appointment past the month paints zero, not a stale figure', () => {
  const out = editedDeal(ROW_12(), { assignedOn: '2026-05-20' });
  assert.equal(out.payment_start_on, '2026-08-18');
  assert.equal(out.payable_days, 0);
  assert.equal(out.payable_amount, 0);
});

test('a second appointment edit still cascades', () => {
  const once = editedDeal(ROW_12(), { assignedOn: '2026-04-15' });
  const twice = editedDeal(once, { assignedOn: '2026-01-20' });
  assert.equal(twice.payment_start_on, '2026-04-20');
  assert.equal(twice.payable_amount, 1000);
});

test('a hand typed payment start is not overwritten', () => {
  const row = { ...ROW_12(), payment_start_on: '2026-08-01' };
  const out = editedDeal(row, { assignedOn: '2026-04-15' });
  assert.equal(out.payment_start_on, '2026-08-01', 'left where the human put it');
  assert.equal(out.end_on, '2027-04-15', 'the end date was still the formula, so it moves');
});

test('clearing the appointment leaves the dates it drove', () => {
  const out = editedDeal(ROW_12(), { assignedOn: null });
  assert.equal(out.payment_start_on, '2026-04-20');
  assert.equal(out.end_on, '2027-01-20');
});

test('THE STALE DAY COUNT BUG: a date edit recomputes days before the amount', () => {
  // Editing the payment start alone used to reuse row.payable_days, the
  // count from before the edit, so 1000 was painted where 580.65 was owed.
  const out = editedDeal(ROW_12(), { paymentStartOn: '2026-07-14' });
  assert.equal(out.payable_days, 18);
  assert.equal(out.payable_amount, 580.65);
});

test('a RATE edit leaves a hand set day count alone', () => {
  const row = { ...ROW_12(), payable_days: 10 };
  const out = editedDeal(row, { monthlyAmount: 2000 });
  assert.equal(out.payable_days, 10, 'not re-derived from the dates');
  assert.equal(out.payable_amount, 645.16, '2000 / 31 * 10');
});

test('an explicit amount in the same edit wins over the formula', () => {
  const out = editedDeal(ROW_12(), { assignedOn: '2026-04-15', payableAmount: 42 });
  assert.equal(out.payable_amount, 42);
});

/**
 * ===============================
 * * The hook really is wired this way
 * ===============================
 * The rebuild above proves the arithmetic. These prove the real hook calls
 * it, in the order that matters: the dates before the amount.
 */

test('useMasterSheet runs withDerivedDates before withPayable', () => {
  const s = src('useMasterSheet.js');
  assert.match(s, /function withDerivedDates\(/);
  const chain = s.match(/function editedDeal\([\s\S]*?\n}/)[0];
  assert.match(chain, /withDerivedDates\(/);
  assert.ok(
    chain.indexOf('withDerivedDates') < chain.indexOf('withPayable'),
    'the dates have to be patched before the amount is worked out from them',
  );
});

test('withPayable derives the day count rather than reusing the old one', () => {
  const s = src('useMasterSheet.js');
  const fn = s.match(/function withPayable\([\s\S]*?\n}/)[0];
  assert.match(fn, /payableDaysFor\(/, 'the whole point of the fix');
  assert.match(fn, /payable_days: payableDays/, 'and the new count is painted too');
});

test('assignedOn is in the inputs, or the cascade never fires', () => {
  assert.ok(PAYABLE_INPUTS.includes('assignedOn'));
  assert.ok(DAY_COUNT_INPUTS.includes('assignedOn'));
});

/**
 * ===============================
 * * A WRITE THAT DID LESS THAN YOU ASKED HAS TO SAY SO
 * ===============================
 * Normally the appointment moves the payment start and the end date with
 * it. When one of those was set by hand the cascade leaves it, and the row
 * simply does not move, which reads as a failed edit rather than a rule.
 */

test('the hook records which columns the cascade declined to touch', () => {
  const skipped = new Set();
  const row = { ...ROW_12(), payment_start_on: '2026-08-01' };
  withDerivedDates(
    { ...row, assigned_on: '2026-04-15' }, { assignedOn: '2026-04-15' }, row, skipped,
  );
  assert.deepEqual([...skipped], ['payment_start_on']);
});

test('and records nothing when it touched everything', () => {
  const skipped = new Set();
  const row = ROW_12();
  withDerivedDates(
    { ...row, assigned_on: '2026-04-15' }, { assignedOn: '2026-04-15' }, row, skipped,
  );
  assert.equal(skipped.size, 0, 'no detail line on the ordinary edit');
});

test('the toast says it, in words and not column names', () => {
  const s = src('useMasterSheet.js');
  assert.match(s, /successDetail:/, 'the success toast carries a second line');
  assert.match(s, /left as you set/i);
  // A toast must never print a database column at somebody.
  const labels = s.match(/const SKIPPED_LABELS = \{[\s\S]*?\};/)[0];
  assert.match(labels, /the payment start/);
  assert.match(labels, /the end date/);
});

test('useOptimisticUpdate only adds the line when there is one', () => {
  const s = fs.readFileSync(path.join(here, 'useOptimisticUpdate.js'), 'utf8');
  assert.match(s, /successDetail = \(\) => undefined/, 'silent by default');
  // A detail must not collapse into "(3×)": the count would throw away the
  // only part worth reading.
  assert.match(s, /key: detail \? undefined :/);
});
