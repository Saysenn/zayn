const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isOwedThisMonth, paymentStartState, countsTowardTotal, START_STATE,
} = require('./owedThisMonth.helper');
const { periodFor, PERIOD } = require('./paymentPeriod.helper');
const { payableDaysFor, payableFromDays } = require('../calculator/computePayable');
const { recomputePayable } = require('./recomputePayable.helper');

/**
 * ***************************************************
 * * PAY THIS DEAL THIS MONTH, WHATEVER THE START SAYS
 * ***************************************************
 *
 * Migration 064, his call 2026-09-23. Mayah's appointment is 13 Jul 2026,
 * so the formula derives a payment start of 11 Oct and September owes her
 * nothing. September pays her anyway.
 *
 * THE TWO WORKAROUNDS IT REPLACES, both of which somebody had to undo by
 * hand the following month: faking the payment start, and overriding the
 * day count and the amount.
 *
 * NOT `manually_overridden_fields`. An upload, the appointment cascade and
 * Diane can all add to that list without anybody deciding anything, and
 * nothing that happens by accident may move a total.
 *
 * One condition, three consumers, and all three are pinned here.
 */

const SEPTEMBER = '2026-09-01';
// Her row: the start the formula derives lands after the month ends.
const mayah = (over = {}) => ({
  preset_on: SEPTEMBER,
  payment_start_on: '2026-10-11',
  monthly_amount: 1000,
  payable_days: 0,
  payable_amount: 0,
  end_on: '2027-07-13',
  stopped_on: null,
  special_case_deal: false,
  for_this_month: true,
  ...over,
});

const on = (over = {}) => mayah({ special_case_deal: true, ...over });

// ===============================
// * THE PREDICATE
// ===============================

test('WITHOUT IT SHE IS OUT, which is the fault', () => {
  assert.equal(isOwedThisMonth(mayah()), false);
  assert.equal(paymentStartState(mayah()), START_STATE.NOT_STARTED);
  assert.equal(periodFor(mayah()), PERIOD.NOT_STARTED);
});

test('WITH IT SHE IS OWED, and the start date never moved', () => {
  const row = on();
  assert.equal(isOwedThisMonth(row), true);
  // The cell still holds 11 Oct. The switch changes what the month owes,
  // never what the sheet says about her.
  assert.equal(row.payment_start_on, '2026-10-11');
});

test('A STOP STILL BEATS IT. Over is over', () => {
  // Somebody saying the deal is finished outranks somebody saying this
  // month pays it, which is the whole of the branch order.
  assert.equal(isOwedThisMonth(on({ stopped_on: '2026-07-31' })), false);
  // And the WORD is still "not yet paying", because a row that has not
  // begun cannot also have finished.
  assert.equal(periodFor(on({ stopped_on: '2026-07-31' })), PERIOD.NOT_STARTED);
});

test('THE END DATE SETTING CANNOT TAKE HER BACK OUT', () => {
  // The end date decides no total, his call 2026-09-23, and the switch is
  // asked before it either way.
  assert.equal(isOwedThisMonth(on({ end_on: '2026-01-01' }), { useEndDate: true }), true);
});

// ===============================
// * THE THREE CONSUMERS
// ===============================

test('THE TOTAL COUNTS HER', () => {
  assert.equal(countsTowardTotal(mayah()), false);
  assert.equal(countsTowardTotal(on()), true);
});

test('ANOTHER MONTH IS STILL ANOTHER MONTH', () => {
  // The switch answers "is anything owed", never "which month is this row
  // for". A row marked October stays out of September's figure.
  assert.equal(countsTowardTotal(on({ for_this_month: false })), false);
});

test('THE CELL IS GREEN, NOT AMBER, because it is a WHOLE month', () => {
  assert.equal(paymentStartState(on()), START_STATE.RUNNING);
  // Even when the start lands inside the month, which would otherwise read
  // as a part month and pay a fraction.
  assert.equal(paymentStartState(on({ payment_start_on: '2026-09-15' })), START_STATE.RUNNING);
});

test('THE BADGE READS ACTIVE, so it cannot contradict the money', () => {
  assert.equal(periodFor(on()), PERIOD.ACTIVE);
});

// ===============================
// * THE FIGURES, or the switch puts her in the total for nothing
// ===============================

test('IT FORCES THE WHOLE MONTH', () => {
  const preset = new Date('2026-09-01T00:00:00Z');
  const start = new Date('2026-10-11T00:00:00Z');
  assert.equal(payableDaysFor(start, preset), 0);
  assert.equal(payableDaysFor(start, preset, { specialCaseDeal: true }), 30);
});

test('AND THE AMOUNT FOLLOWS, so she lands at her full monthly', () => {
  const preset = new Date('2026-09-01T00:00:00Z');
  const days = payableDaysFor(new Date('2026-10-11T00:00:00Z'), preset, { specialCaseDeal: true });
  assert.equal(payableFromDays({ monthlyAmount: 1000, presetOn: preset, payableDays: days }), 1000);
});

test('FLIPPING IT ON RE-DERIVES BOTH FIGURES, with nothing else typed', () => {
  // The switch alone has to be enough. Asking somebody to type 30 beside
  // it is the override workaround with an extra step.
  const fields = { specialCaseDeal: true };
  const derived = recomputePayable(mayah(), fields);
  assert.equal(fields.payableDays, 30);
  assert.equal(fields.payableAmount, 1000);
  // DERIVED, not claimed. A value this function worked out is not a
  // human's claim on the column, or the next upload is frozen out of it.
  assert.deepEqual(derived.sort(), ['payableAmount', 'payableDays']);
});

test('AND FLIPPING IT OFF PUTS THEM BACK, so nothing has to be undone', () => {
  const fields = { specialCaseDeal: false };
  recomputePayable(on({ payable_days: 30, payable_amount: 1000 }), fields);
  assert.equal(fields.payableDays, 0);
  assert.equal(fields.payableAmount, 0);
});

// ===============================
// * DIANE READS IT AND CANNOT SET IT
// ===============================

/** One cell off her deal card, by its label. */
function cardCell(row, label) {
  const { dealCard } = require('../agent/tools/masterSheet');
  for (const group of dealCard(row).groups ?? []) {
    const hit = (group.cells ?? []).find((c) => c.label === label);
    if (hit) return hit;
  }
  return null;
}

test('HER CARD CARRIES IT, and read only', () => {
  const base = { payment_period: 'active', payable_amount: 1000, monthly_amount: 1000 };
  // THE LABEL IS NOT SPELLED HERE. It was, and the rename left this test
  // green against a card nobody sees any more. See shared/specialCase.js.
  const { SPECIAL_CASE_LABEL: LABEL } = require('./specialCase');
  assert.equal(cardCell({ ...base, special_case_deal: true }, LABEL).value, 'Yes');
  assert.equal(cardCell(base, LABEL).value, 'No');
  // No editField is what makes it read only on the card itself, beside the
  // allow list below. Both, because either alone is one mistake from a write.
  assert.equal(cardCell(base, LABEL).editField, null);
});

test('SHE SAYS WHY IT COUNTS, rather than a bare Yes', () => {
  // A "Yes" beside a payment start in the future reads as a bug in her
  // card. The reason is the decision, not the arithmetic.
  const base = {
    payment_period: 'active', payable_amount: 1000, monthly_amount: 1000,
    payment_start_on: '2026-10-11', preset_on: SEPTEMBER,
  };
  const reason = (row) => cardCell(row, 'Payable this month')?.value;
  assert.equal(reason({ ...base, special_case_deal: true }), 'Yes, set to special case by hand');
  assert.equal(reason(base), 'Yes');
});

// ===============================
// * SHE MAY SET IT, AND ONLY THROUGH THE TWO CALL SHAPE
// ===============================
// His call 2026-09-23. An ask she cannot act on is worse than no ask, so
// the field is hers; it moves a TOTAL, so it is the only field on her edit
// list carrying a confirm of its own.

const updateRow = () => require('../agent/tools/masterSheet')
  .masterSheetTools.find((t) => t.name === 'update_master_sheet_row');

test('IT IS ON HER EDIT LIST', () => {
  assert.equal(updateRow().parameters.properties.specialCaseDeal.type, 'boolean');
});

test('THE FIRST CALL CHANGES NOTHING, and the guard runs BEFORE the write', () => {
  // Not "her description says confirm first". She has invented both a
  // confirmation and its result before, which is why this is a shape and
  // not a sentence.
  //
  // READ FROM THE SOURCE, not by calling the handler: it reaches the repo,
  // and `npm test` pins this whole domain with NO DATABASE. The first
  // draft of this test called it and hung the suite.
  const { readFileSync } = require('node:fs');
  const src = readFileSync(require.resolve('../agent/tools/masterSheet'), 'utf8');
  const from = src.indexOf("name: 'update_master_sheet_row'");
  const guard = src.indexOf('confirmSpecialCaseDeal(args, before, fields)', from);
  const write = src.indexOf('repo.update(before.id', from);
  assert.ok(guard > from, 'the update tool does not gate the switch at all');
  assert.ok(guard < write, 'the confirm runs after the write, so it confirms nothing');
  // `confirmFirst` is what makes the first call inert. Written out here
  // rather than trusted, because reimplementing it inline is how the two
  // call shape quietly became a sentence again on rename_company.
  const body = src.slice(src.indexOf('function confirmSpecialCaseDeal('));
  assert.match(body.slice(0, body.indexOf('\n}')), /return confirmFirst\(args\.confirmed/);
});

test('AND THE PREVIEW NAMES THE MONTH AND THE FIGURE', () => {
  // A count is not the surprise here: one deal is always one deal. What
  // they are agreeing to is an amount landing in a named month.
  const { readFileSync } = require('node:fs');
  const src = readFileSync(require.resolve('../agent/tools/masterSheet'), 'utf8');
  const from = src.indexOf('function confirmSpecialCaseDeal(');
  const to = src.indexOf('\n}', src.indexOf('return confirmFirst', from));
  const body = src.slice(from, to);
  assert.match(body, /adding \$\{figure\} to that month/);
  assert.match(body, /taking \$\{figure\} back out of that month/);
  assert.match(body, /keeps:/, 'a confirm must say what survives');
});

test('SHE ASKS WHEN A ROW IS LEFT OWING NOTHING, off the STATE not a phrase', () => {
  const { readFileSync } = require('node:fs');
  const src = readFileSync(require.resolve('../agent/tools/masterSheet'), 'utf8');
  const from = src.indexOf('function specialCaseDealAsk(');
  const body = src.slice(from, src.indexOf('\n}', from));
  // The three conditions, and none of them is a word the admin typed.
  assert.match(body, /row\.special_case_deal/, 'it would ask about a row already switched on');
  assert.match(body, /Number\(row\.monthly_amount\) > 0/, 'it would ask about a row worth nothing');
  assert.match(body, /isOwedThisMonth\(row\)/, 'it would ask about a row already paying');
  assert.doesNotMatch(body, /special case/i, 'the trigger is a phrase');
});

/**
 * ===============================
 * * THE SWITCH'S NAME, SAID ONCE PER CODEBASE
 * ===============================
 * The column was `pay_this_month` until migration 065 and the toggle read
 * "Pay this deal for September 2026". After the rename her card still said
 * "Paid this month by hand" and her field description still led on "should
 * be paid this month", so "make Mayah a special case" matched nothing she
 * knew and the nearest field by words was `overrideShouldBePaid`, which
 * carries no month.
 *
 * `crm/web` pins its own half in configs/specialCase.js. This is a
 * CONTRACT, not a share: neither side may read the other's file.
 */
test('THE NAME ITSELF, which is the contract with crm/web', () => {
  /**
   * SPELLED OUT ON PURPOSE, and the only place in this repo that does.
   *
   * Every other assertion here reads the constant and compares it against
   * text built from the same constant, so renaming it kept them all green.
   * `crm/web` pins this same literal in configs/specialCase.js; the two
   * codebases share no file, so agreeing is the whole point.
   */
  const { SPECIAL_CASE_SWITCH, SPECIAL_CASE_LABEL } = require('./specialCase');
  assert.equal(SPECIAL_CASE_SWITCH, 'Make this deal Special Case');
  assert.equal(SPECIAL_CASE_LABEL, 'Special case');
});

test('her card and her tool read the name from one place', () => {
  const { SPECIAL_CASE_SWITCH, SPECIAL_CASE_LABEL } = require('./specialCase');
  const { masterSheetTools } = require('../agent/tools/masterSheet');
  const { MASTER_SHEET_PROMPT } = require('../agent/prompts/masterSheet');

  const row = masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const description = row.parameters.properties.specialCaseDeal.description;
  assert.ok(description.includes(SPECIAL_CASE_SWITCH), 'the tool does not know what it is called');

  // The card cell, and the prompt line that tells her what the card says.
  assert.equal(cardCell({ payment_period: 'active' }, SPECIAL_CASE_LABEL).value, 'No');
  assert.ok(MASTER_SHEET_PROMPT.includes(SPECIAL_CASE_SWITCH));
  assert.ok(MASTER_SHEET_PROMPT.includes(SPECIAL_CASE_LABEL));
});

test('the dead names are gone from everything she reads', () => {
  const { MASTER_SHEET_PROMPT } = require('../agent/prompts/masterSheet');
  const { masterSheetTools } = require('../agent/tools/masterSheet');
  // Checked on the RENDERED text, never the source: a comment naming the
  // old wording to explain the fix would fail a source scan.
  const everything = [
    MASTER_SHEET_PROMPT,
    ...masterSheetTools.map((t) => t.description ?? ''),
  ].join('\n');
  assert.doesNotMatch(everything, /Paid this month by hand/);
  assert.doesNotMatch(everything, /pay_this_month|payThisMonth/);
});

test('every way the admin says it is offered to her', () => {
  const { SPECIAL_CASE_PHRASES, quotedPhrases } = require('./specialCase');
  const { masterSheetTools } = require('../agent/tools/masterSheet');
  const row = masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  const description = row.parameters.properties.specialCaseDeal.description;

  assert.ok(description.includes(quotedPhrases()), 'the phrasings never reached the tool');
  for (const phrase of ['special case deal', 'special deal case', 'special deal']) {
    assert.ok(SPECIAL_CASE_PHRASES.includes(phrase), `"${phrase}" is not offered`);
  }
});
