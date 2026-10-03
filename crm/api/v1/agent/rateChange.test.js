const test = require('node:test');
const assert = require('node:assert/strict');

const {
  asksForMore, overwroteAnIncrement, applyDelta, rateChangeLines, settleRates,
} = require('./rateChange');

/**
 * ***************************************************
 * * "ADD 3%" WAS WRITTEN AS "SET TO 3"
 * ***************************************************
 *
 * Live 2026-09-24. Zayn carried a 5% add on.
 *
 *   admin  "add 3% on Zayn's add-on, on the Master Sheet add-on column"
 *   Diane   update_person({ addonPercent: 3 })
 *           "Zayn's add-on percentage is now 3%."
 *
 * September fell from AED 8,400 to AED 8,240 and nothing said so. Every
 * sentence below is from that transcript.
 */

const SAID = "add 3% on Zayn's add-on, on the Master Sheet add-on column";

/* ===============================
 * * DID THEY ASK FOR MORE, OR FOR A VALUE
 * =============================== */

test('the incident sentence asks for MORE', () => {
  assert.equal(asksForMore(SAID), true);
});

test('every wording of it that was actually said', () => {
  for (const said of [
    'I want you to add another 5% on Zane',
    'add another 3%',
    'increase it by 2',
    'bump it 5%',
    'put 2% on top of what he has',
    '3% more please',
  ]) assert.equal(asksForMore(said), true, said);
});

test('a plain SET is not an increment, and must not be refused', () => {
  // Being refused for phrasing it correctly is worse than the guard is
  // worth, so this half matters as much as the other.
  for (const said of [
    'set his add on to 3%',
    'his add on should be 3',
    'change the fee to 2%',
    'what is his add on',
  ]) assert.equal(asksForMore(said), false, said);
});

/* ===============================
 * * AN INCREMENT WRITTEN AS THE INCREMENT ITSELF
 * =============================== */

test('THE INCIDENT IS REFUSED, and the refusal does the arithmetic', () => {
  const out = overwroteAnIncrement({
    field: 'addonPercent', value: 3, current: 5, said: SAID,
  });
  assert.ok(out);
  assert.match(out, /OVERWRITE, NOT ADD/);
  assert.match(out, /It is 5% now/);
  assert.match(out, /CUT of 2%/);
  // It names the way to comply, or she tries the same call again.
  assert.match(out, /addonPercentDelta: 3/);
  // And forbids the mental arithmetic that caused it.
  assert.match(out, /NEVER work the new total out yourself/);
});

test('FROM ZERO the two are the same write', () => {
  // "Add 3" and "set 3" agree at zero, so refusing would be noise.
  assert.equal(overwroteAnIncrement({
    field: 'addonPercent', value: 3, current: 0, said: 'add 3%',
  }), null);
});

test('a plain set, and setting it to what it already is, both pass', () => {
  assert.equal(overwroteAnIncrement({
    field: 'addonPercent', value: 3, current: 5, said: 'set it to 3%',
  }), null);
  assert.equal(overwroteAnIncrement({
    field: 'addonPercent', value: 5, current: 5, said: 'add 5%',
  }), null);
});

test('a number they never said is not the increment', () => {
  // "add 3%" with a call carrying 9 is a different fault, and this is not
  // the guard for it.
  assert.equal(overwroteAnIncrement({
    field: 'addonPercent', value: 9, current: 5, said: 'add 3%',
  }), null);
});

/* ===============================
 * * THE DELTA, AND ITS EDGES
 * =============================== */

test('a delta adds to what is there', () => {
  assert.deepEqual(applyDelta(5, 3, 100), { value: 8, from: 5 });
  assert.deepEqual(applyDelta(null, 3, 100), { value: 3, from: 0 });
});

test('a delta may take away, but not below zero', () => {
  assert.deepEqual(applyDelta(5, -3, 100), { value: 2, from: 5 });
  assert.match(applyDelta(2, -5, 100).error, /below zero/);
});

test('and not past the cap', () => {
  assert.match(applyDelta(99, 5, 100).error, /over the 100% cap/);
});

test('pennies do not accumulate', () => {
  assert.deepEqual(applyDelta(0.1, 0.2, 100), { value: 0.3, from: 0.1 });
});

/* ===============================
 * * THE LINE THE ADMIN READS
 * =============================== */

test('it names the LEVEL, the FROM and the TO', () => {
  // All three. "is now 3%" never said it had been 5%, which is the whole
  // of how a 5% vanished in silence.
  const [line] = rateChangeLines({
    level: 'profile', who: 'Zayn', fields: { addonPercent: 3 }, current: { addonPercent: 5 }, deals: 2,
  });
  assert.match(line, /PROFILE/);
  assert.match(line, /all 2 of their deals/);
  assert.match(line, /5% to 3%/);
  // No "(added)": read as done before the yes. 2026-09-25.
  assert.doesNotMatch(line, /((?:added|deducted))/);
});

test('a DEAL rate says deal, because that is the half she got wrong', () => {
  const [line] = rateChangeLines({
    level: 'deal', who: 'Zayn at Workforce', fields: { feePercent: 2 }, current: { feePercent: 0 },
  });
  assert.match(line, /DEAL/);
  assert.match(line, /fee 0% to 2%$/);
});

test('a rate that is not moving produces no line, so nothing is confirmed', () => {
  assert.deepEqual(rateChangeLines({
    level: 'deal', who: 'x', fields: { addonPercent: 5 }, current: { addonPercent: 5 },
  }), []);
});

/* ===============================
 * * ONE ENTRY POINT, BOTH LEVELS
 * =============================== */

test('settleRates resolves the delta and removes it', () => {
  // A key that is not a column must never reach the repo.
  const fields = { addonPercentDelta: 3 };
  const out = settleRates({
    fields, current: { addonPercent: 5, feePercent: 0 }, said: 'add 3%', max: 100, level: 'deal', who: 'x',
  });
  assert.equal(fields.addonPercent, 8);
  assert.equal('addonPercentDelta' in fields, false);
  assert.equal(out.lines.length, 1);
});

test('SET and ADD together is a contradiction, not something to resolve', () => {
  const out = settleRates({
    fields: { addonPercent: 3, addonPercentDelta: 3 },
    current: { addonPercent: 5, feePercent: 0 },
    said: 'x',
    max: 100,
    level: 'deal',
    who: 'x',
  });
  assert.match(out.error, /cannot both be right/);
});

test('the incident cannot get through settleRates either', () => {
  const out = settleRates({
    fields: { addonPercent: 3 },
    current: { addonPercent: 5, feePercent: 0 },
    said: SAID,
    max: 100,
    level: 'profile',
    who: 'Zayn',
  });
  assert.match(out.error, /OVERWRITE, NOT ADD/);
});

// "all 1 of their deals" was read as a count and she told the admin 3.
test('a profile on one deal says so in words, several say how many', () => {
  const one = rateChangeLines({ level: 'profile', who: 'Ines', fields: { addonPercent: 3 }, current: {}, deals: 1 });
  const two = rateChangeLines({ level: 'profile', who: 'Orla', fields: { addonPercent: 3 }, current: {}, deals: 2 });
  assert.match(one[0], /Ines's PROFILE, which is their only deal: add on 0% to 3%/);
  assert.match(two[0], /all 2 of their deals/);
});

// 2026-09-25: "take 5% off bram" was read as lowering his fee by 5.
test('"TAKE 5% OFF" A PERSON IS A FEE, never a lower rate or an add on', () => {
  const { misreadTakeOff } = require('./rateChange');
  const said = 'take 5% off bram tevish';
  assert.ok(misreadTakeOff({ field: 'feePercent', value: 0, current: 2, said }));
  assert.ok(misreadTakeOff({ field: 'addonPercent', value: 5, current: 0, said }));
  assert.equal(misreadTakeOff({ field: 'feePercent', value: 5, current: 0, said }), null);
  // A rate named IS a lower rate.
  assert.equal(misreadTakeOff({ field: 'feePercent', value: 1, current: 2, said: 'take 1% off his fee' }), null);
});

test('"take 1% off" as a MINUS DELTA with no fee yet IS the 1% fee preview', () => {
  const fields = { feePercentDelta: -1 };
  const out = settleRates({
    fields, current: { addonPercent: 0, feePercent: 0 }, said: 'take 1% off suki varnell', max: 100, level: 'profile', who: 'Suki',
  });
  assert.equal(out.error, undefined);
  assert.deepEqual(fields, { feePercent: 1 });
  assert.match(out.lines[0], /fee 0% to 1%/);
});

test('"take 1% off" someone ALREADY on a fee still asks, replace or on top', () => {
  const out = settleRates({
    fields: { addonPercentDelta: -1 }, current: { addonPercent: 0, feePercent: 2 }, said: 'take 1% off dov', max: 100, level: 'profile', who: 'Dov',
  });
  assert.match(out.error, /IS A FEE OF 1%/);
});

test('their own figure as the fee passes, even over a higher fee', () => {
  const { misreadTakeOff } = require('./rateChange');
  assert.equal(misreadTakeOff({ field: 'feePercent', value: 1, current: 2, said: 'take 1% off dov' }), null);
});
