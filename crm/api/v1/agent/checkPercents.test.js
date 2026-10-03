const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPercents, percentsIn, percentsFrom } = require('./checkPercents');

/**
 * ***************************************************
 * * THE GLORIA DIFFERENCE TURN
 * ***************************************************
 *
 * Asked what percentage was on Gloria Difference she said there was none,
 * then said 5% when pushed. The deal's add on is 0, the person's is 5, and
 * the two stack. Every percentage in the system is under `checkFigures`'
 * floor of 100, and the first answer had no digits in it at all, so nothing
 * was looking.
 */

// The shape `check_rates` really returns. Copied from its handler, not
// imagined: a guard tested against a shape the code does not produce passes
// its own tests and catches nothing.
const RATES_RESULT = {
  summary: 'Gloria difference carries 5% add on and 0% fee on their PROFILE.',
  person: { name: 'Gloria difference', addon: 5, fee: 0 },
  deals: [{
    company: 'Acqua',
    group: 'INDIGO',
    method: 'bank',
    addonPercent: 5,
    feePercent: 0,
    cryptoPercent: 0,
    dealAddonPercent: 0,
    dealFeePercent: 0,
  }],
  cryptoPercent: 1,
};

/* ---- reading rates out of prose ---- */

test('a rate is read however she writes it', () => {
  assert.deepEqual([...percentsIn('5% add on')], [5]);
  assert.deepEqual([...percentsIn('5 % add on')], [5]);
  assert.deepEqual([...percentsIn('5 percent')], [5]);
  assert.deepEqual([...percentsIn('5 per cent')], [5]);
  assert.deepEqual([...percentsIn('2.5% fee')], [2.5]);
});

test('a number with no percent sign is not a rate', () => {
  assert.equal(percentsIn('2,900 owed across 4 deals').size, 0);
});

/* ---- what the tools produced ---- */

test('every part of the answer counts, not just the stacked figure', () => {
  const { all, byKind } = percentsFrom(RATES_RESULT);
  // The profile rate, the stacked rate, the deal's own half, the crypto
  // charge. She may legitimately name any of them.
  assert.ok(all.has(5), 'the profile and stacked add on');
  assert.ok(all.has(0), "the deal's own half");
  assert.ok(all.has(1), 'the crypto charge');
  assert.ok(byKind.addon.has(5));
});

test('the system crypto charge is real to quote but does not APPLY', () => {
  // `cryptoPercent` comes back on every call whether or not a row is paid
  // in coin. She may say "the charge is 1%"; she is not wrong to say it
  // does not apply here.
  const { all, byKind } = percentsFrom(RATES_RESULT);
  assert.ok(all.has(1), 'she may quote the system charge');
  assert.ok(![...byKind.crypto].some((n) => n > 0), 'no deal of hers is paid in coin');
});

test('a money field is never mistaken for a rate', () => {
  // total_master_sheet returns `addon` and `fee` as AMOUNTS per currency.
  // Only a key naming percent counts, or 145.50 becomes a 145.5% add on.
  const { all } = percentsFrom({ total: { GBP: 2900 }, addon: { GBP: 145.5 }, fee: { GBP: 0 } });
  assert.equal(all.size, 0);
});

/* ---- the fault itself ---- */

test('DENYING a rate that exists is caught', () => {
  const bad = checkPercents(
    'Gloria difference does not have a percentage on her deal, hun.',
    [RATES_RESULT],
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.denied.length, 1);
});

test('STATING a rate no tool produced is caught', () => {
  const bad = checkPercents('She is on 12% add on.', [RATES_RESULT]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unsupported, [12]);
});

/* ---- and the sentences that must NOT be flagged ---- */

test('the correct answer passes', () => {
  const good = checkPercents(
    'Gloria difference is on 5% add on, which is added, and 0% fee.',
    [RATES_RESULT],
  );
  assert.equal(good.ok, true);
});

test('a denial BESIDE a real figure is a distinction, not a contradiction', () => {
  // This is the right answer to the question that caused the guard. It
  // must not cost a retry.
  const good = checkPercents(
    'The deal itself carries no add on, but Gloria difference is on 5% at profile level.',
    [RATES_RESULT],
  );
  assert.equal(good.ok, true);
});

test('a denial about a DIFFERENT rate is not a denial of this one', () => {
  // The tool orders her to say this whenever nothing is paid in coin, and
  // the crypto charge is 1%, so a kind-blind check would flag her for
  // obeying it.
  const good = checkPercents(
    'None of her deals is paid in coin, so there is no crypto charge to worry about.',
    [{ ...RATES_RESULT, deals: [{ ...RATES_RESULT.deals[0], cryptoPercent: 0 }] }],
  );
  assert.equal(good.ok, true);
});

test('no rate from any tool means nothing to check', () => {
  const quiet = checkPercents('She has no percentage at all.', [{ summary: '4 rows, 2,900 owed.' }]);
  assert.equal(quiet.had, false);
  assert.equal(quiet.ok, true);
});

test('a denial of something that IS zero is the truth', () => {
  const good = checkPercents(
    'She carries no fee at all.',
    [{ person: { name: 'X', addon: 0, fee: 0 }, deals: [], cryptoPercent: 0 }],
  );
  assert.equal(good.ok, true);
});

// 2026-09-25. "give everyone at ZZ Rate Co B a 1% add on": she said the 1%
// back while proposing it, no tool had produced it yet, and the retry sent
// her into three lookups and a change to one deal of the three.
test('THEIR OWN FIGURE, IN AN INSTRUCTION, may be said back', () => {
  const tools = [{ rows: [{ addonPercent: 0, feePercent: 2 }] }];
  const reply = 'That would give each of them a 1% add on. Shall I?';
  assert.equal(checkPercents(reply, tools).ok, false, 'without the instruction it is unsupported');
  assert.equal(checkPercents(reply, tools, { told: 'give everyone at co b a 1% add on' }).ok, true);
});
