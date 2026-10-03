const test = require('node:test');
const assert = require('node:assert/strict');

const { ratesFor, amountWithRates } = require('./rates.helper');

/**
 * ***************************************************
 * * Add ons and fees, opposite directions
 * ***************************************************
 *
 * The one definition every total reads. Swapping the directions, or
 * applying the fee before the add on, is money.
 */

const deal = (over = {}) => ({
  person_id: 'gloria', payable_amount: 500, addon_percent: 0, fee_percent: 0, ...over,
});
const person = (addon, fee) => new Map([['gloria', { addon, fee }]]);

test('an ADD ON is added', () => {
  const { addon, net } = amountWithRates(deal(), person(5, 0));
  assert.equal(addon, 25);
  assert.equal(net, 525, '500 plus 5%');
});

test('a FEE is deducted', () => {
  const { fee, net } = amountWithRates(deal(), person(0, 5));
  assert.equal(fee, 25);
  assert.equal(net, 475, '500 less 5%');
});

test('ADD ON FIRST: the fee comes off the amount PLUS the add on', () => {
  // 500 + 8% = 540, then 2% of 540 = 10.80, so 529.20. Taking the fee off
  // 500 instead gives 529.00, and the gap grows with the figures.
  const { addon, fee, net } = amountWithRates(deal({ addon_percent: 3 }), person(5, 2));
  assert.equal(addon, 40, '5% person + 3% deal');
  assert.equal(fee, 10.8, '2% of 540, not of 500');
  assert.equal(net, 529.2);
});

test('person and deal rates STACK, neither overrides the other', () => {
  const r = ratesFor(deal({ addon_percent: 3, fee_percent: 4 }), person(5, 2));
  assert.deepEqual(r, { addon: 8, crypto: 0, fee: 6 });
});

test('a deal rate alone works with no person row at all', () => {
  const r = ratesFor(deal({ addon_percent: 7, fee_percent: 1 }), new Map());
  assert.deepEqual(r, { addon: 7, crypto: 0, fee: 1 });
});

test('no rates anywhere leaves the amount untouched', () => {
  const { addon, fee, net } = amountWithRates(deal(), null);
  assert.equal(addon, 0);
  assert.equal(fee, 0);
  assert.equal(net, 500);
});

test('a bare number in the map is an ADD ON, which is what it always was', () => {
  // The old fee map held one number per person and that number was added.
  // Reading it as a deduction would invert every stored value.
  const { addon, fee, net } = amountWithRates(deal(), new Map([['gloria', 5]]));
  assert.equal(addon, 25);
  assert.equal(fee, 0);
  assert.equal(net, 525);
});

test('a missing or unparseable amount is 0, never NaN', () => {
  // NaN spreads through every sum it touches and prints as a blank cell.
  for (const payable_amount of [null, undefined, '', 'n/a']) {
    const { net } = amountWithRates(deal({ payable_amount }), person(5, 2));
    assert.equal(net, 0, JSON.stringify(payable_amount));
  }
});

test('a string amount from pg numeric still computes', () => {
  const { net } = amountWithRates(deal({ payable_amount: '500.00' }), person(5, 0));
  assert.equal(net, 525);
});

test('100% fee leaves nothing, and does not go negative', () => {
  const { net } = amountWithRates(deal(), person(0, 100));
  assert.equal(net, 0);
});

/* ===============================
 * * THE RATE LIVES ON THE MONTHLY AMOUNT, AND IS APPLIED ONCE
 * =============================== */

const { withRates, hasRates } = require('./rates.helper');

const row = (over = {}) => ({
  person_id: 'maid', person_name: 'Maid', payment_method: 'cash',
  monthly_amount: 4700, payable_amount: 4700, ...over,
});

test('his own figure: 4,700 at 5% reads 4,935', () => {
  const out = withRates(row(), new Map([['maid', { addon: 5, fee: 0 }]]));
  assert.equal(out.monthly_amount, 4935);
  assert.equal(out.monthly_amount_raw, 4700, 'the wage is never overwritten');
});

test('THE ORDER COMMUTES, so a part month is the same to the penny', () => {
  // 12 days of a 30 day month. Rating then pro-rating must equal
  // pro-rating then rating, or moving the rate onto Monthly would change
  // what somebody is paid.
  const people = new Map([['maid', { addon: 5, fee: 0 }]]);
  const prorated = withRates(row({ payable_amount: 1880 }), people);
  assert.equal(prorated.payable_amount, 1974, '1,880 + 5%');

  const full = withRates(row(), people);
  assert.equal(Math.round((full.monthly_amount / 30) * 12 * 100) / 100, 1974);
});

test('add on and deal rate are ADDITIVE, never compounding', () => {
  // 5% on the person plus 3% on the deal is 8% of 1,000. Baking the first
  // in would compound to 8.15%, which is the reason the raw is kept.
  const out = withRates(
    row({ monthly_amount: 1000, payable_amount: 1000, addon_percent: 3 }),
    new Map([['maid', { addon: 5, fee: 0 }]]),
  );
  assert.equal(out.monthly_amount, 1080, 'not 1081.50');
});

test('the fee comes off the raw PLUS the add ons', () => {
  // The popup's own worked example: 4,700 with 5% add on, 1% crypto rail
  // and a 5% fee is 4,732.90, not 4,747.
  const out = withRates(
    row({ payment_method: 'crypto', fee_percent: 5 }),
    new Map([['maid', { addon: 5, fee: 0 }]]),
    { cryptoPercent: 1 },
  );
  assert.deepEqual(out.rate_parts.monthly, {
    addon: 235, crypto: 47, fee: 249.1, net: 4732.9,
  });
});

test('a row with no rate is returned UNTOUCHED, not rebuilt', () => {
  // Rebuilding would round figures nobody rated and hang `rate_parts` on
  // rows with nothing to explain. It is also the info icon's condition.
  const clean = row();
  assert.equal(withRates(clean, null), clean, 'the same object, not a copy');
  assert.equal(hasRates(clean, null), false);
  assert.equal(hasRates(row({ addon_percent: 5 }), null), true);
});

/**
 * ===============================
 * * THE TWO DIRECTIONS, SAID ONCE
 * ===============================
 * `fee_percent` kept its name and inverted its meaning at migration 047.
 * Her prompt was still teaching the old one a year later: "THE FEE IS
 * ADDED, NEVER DEDUCTED. 5% on 2,900 owed is 3,045", beside a tool that
 * deducts it and arithmetic here that deducts it. Found 2026-09-24.
 *
 * The sentence is checked against the SUM, so a reword that inverts it
 * goes red rather than shipping.
 */
test('the sentence agrees with the arithmetic it describes', () => {
  const { RATE_DIRECTIONS, amountWithRates } = require('./rates.helper');

  // The add on: 5% on 2,900 is 3,045 to find.
  const added = amountWithRates({ payable_amount: 2900, addon_percent: 5, fee_percent: 0 });
  assert.equal(added.net, 3045);
  assert.ok(RATE_DIRECTIONS.includes('3,045'), 'the add on example left the sentence');
  assert.match(RATE_DIRECTIONS, /ADD ON is income on top/);

  // The fee: 5% on 2,900 is 2,755 to hand over.
  const taken = amountWithRates({ payable_amount: 2900, addon_percent: 0, fee_percent: 5 });
  assert.equal(taken.net, 2755);
  assert.ok(RATE_DIRECTIONS.includes('2,755'), 'the fee example left the sentence');
  assert.match(RATE_DIRECTIONS, /FEE is taken off after it/);
});

test('anything that explains the rates reads the one sentence', () => {
  // Three copies is how the prompt and the tool came to disagree.
  const fs = require('node:fs');
  const path = require('node:path');
  const { RATE_DIRECTIONS } = require('./rates.helper');
  const agent = path.join(__dirname, '..', 'agent');

  for (const file of ['prompts/masterSheet.js', 'tools/masterSheet.js']) {
    const src = fs.readFileSync(path.join(agent, file), 'utf8');
    assert.match(src, /RATE_DIRECTIONS/, `${file} spells the directions out again`);
  }

  /**
   * CHECKED ON WHAT SHE READS, not on the source.
   *
   * The first version of this scanned the file for the old sentence and
   * went red on the COMMENT above the import, which quotes it to say what
   * was wrong. A guard that matches its own explanation is a guard nobody
   * can keep.
   */
  const { MASTER_SHEET_PROMPT } = require('../agent/prompts/masterSheet');
  assert.ok(MASTER_SHEET_PROMPT.includes(RATE_DIRECTIONS), 'the sentence never reached her');
  assert.doesNotMatch(
    MASTER_SHEET_PROMPT,
    /FEE IS ADDED, NEVER DEDUCTED/,
    'her prompt still teaches the pre-047 meaning',
  );

  const { masterSheetTools } = require('../agent/tools/masterSheet');
  const person = masterSheetTools.find((t) => t.name === 'update_person');
  assert.ok(person.description.includes(RATE_DIRECTIONS), 'the tool never reached it either');
});
