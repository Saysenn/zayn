const test = require('node:test');
const assert = require('node:assert/strict');
const { forMonthsIn, monthNumberOf } = require('../checkMonths');

/**
 * ***************************************************
 * * A CHANGE ASKED FOR ONE MONTH, LANDING ON ANOTHER
 * ***************************************************
 *
 * Live 2026-09-29, and the worst shape a write can take: she agreed to do
 * something other than what was asked and printed a month to prove it.
 *
 *   admin: "okay for october only please add an additional 100 aed"
 *   Diane: "this would change Zayn's deal for September 2026,
 *           touching 1 deal. Shall I go ahead?"
 *
 * TWO FAULTS, and the second is the dangerous half:
 *
 *   1. The month was read off the ROW'S preset and never compared with the
 *      one they said.
 *   2. There is no per month amount to set. `monthly_amount` belongs to the
 *      DEAL, so "October only" cannot be honoured by it at all, and a yes
 *      would have written something nobody asked for.
 *
 * `confirmAmounts` refuses now rather than previewing, and returns no
 * `pending`, so a later "yes" has nothing to replay.
 *
 * THE UNIT HALF is the sentence rule. The SOURCE half is the one that
 * cannot rot: it fails if the guard is dropped out of the write path.
 */

const read = () => require('node:fs').readFileSync(require.resolve('./masterSheet.js'), 'utf8');

/* ---- what counts as a month they asked FOR ---- */

const askedIn = (said) => [...forMonthsIn(said)].map(monthNumberOf).filter(Boolean);

test('THE REAL SENTENCE NAMES OCTOBER', () => {
  assert.deepEqual(askedIn('okay for october only please add an additional 100 aed'), [10]);
});

test('AND A MONTH THAT IS NOT WHAT THE CHANGE IS FOR IS NOT AN ASK', () => {
  // The same precision `checkMonths` uses on her replies. A guard that
  // cried wolf on "he started in October" is one somebody widens away.
  assert.deepEqual(askedIn('add 100 to zayn, he started in october'), []);
  assert.deepEqual(askedIn('add 100 to zayn'), []);
  assert.deepEqual(askedIn(''), []);
  assert.deepEqual(askedIn(undefined), []);
});

test('A YEAR SAID OR NOT, the month is the same number', () => {
  assert.deepEqual(askedIn('for october 2026 add 100'), [10]);
  assert.equal(monthNumberOf('2026-10'), 10);
  assert.equal(monthNumberOf('october'), 10);
  assert.equal(monthNumberOf('nonsense'), null);
});

/* ---- and the write path actually consults it ---- */

test('THE AMOUNT WRITE REFUSES A MONTH IT CANNOT REACH', () => {
  const src = read();
  const guard = src.slice(src.indexOf('function wrongMonthAsked'), src.indexOf('function patchFor'));
  assert.ok(guard.length > 0, 'the guard is in the write path');

  // It reads THEIR words, not her arguments: the one copy she cannot edit.
  assert.match(guard, /wrongMonthAsked\(args\.said, actingOn\)/);
  // Exactly one month asked for, and different from the one being written.
  assert.match(guard, /asked\.length !== 1 \|\| asked\[0\] === on/);
  // NOTHING IS PENDING. A refusal that armed a confirm could be said yes to.
  assert.match(guard, /NOTHING HAS BEEN CHANGED/);
  assert.doesNotMatch(
    guard.slice(guard.indexOf('function confirmAmounts')),
    /pending: true/,
    'a refusal must not arm a confirm',
  );
});

test('AND IT REFUSES BEFORE IT BUILDS THE PREVIEW', () => {
  // Order matters. Naming a month in the preview and refusing afterwards
  // still shows the admin the wrong month once.
  const src = read();
  const fn = src.slice(src.indexOf('function confirmAmounts'), src.indexOf('function patchFor'));
  const refusal = fn.indexOf('wrongMonthAsked');
  const preview = fn.indexOf('confirmFirst(');
  assert.ok(refusal > -1 && preview > refusal, 'the refusal comes first');
});

test('IT SAYS WHY, not just no', () => {
  const src = read();
  const guard = src.slice(src.indexOf('function wrongMonthAsked'), src.indexOf('function confirmAmounts'));
  // The two facts the admin needs: which month the deal is marked for, and
  // that no per month amount exists to set.
  assert.match(guard, /marked for \$\{monthName\(actingOn\)\}/);
  assert.match(guard, /not stored `\s*\+ 'per month/);
  assert.match(guard, /ask what they want instead/);
});

/**
 * ***************************************************
 * * "1k" IS THE SAME FIGURE, WRITTEN SHORT
 * ***************************************************
 *
 * 2026-09-29, and the one case on the whole sweep that could WRITE a wrong
 * figure rather than simply fail to act. The unit guard looked for the
 * digits of the value in their sentence, so "deduct 1k" against a value of
 * 1000 matched nothing, the guard stayed silent, and 1000 went into a
 * percent field.
 *
 * AND A `k` IS NEVER A PERCENTAGE. Nobody writes "1k%", so the shorthand
 * does not merely let the guard see the number: it settles the unit, and
 * the refusal says which reading was wrong rather than asking again.
 */
const { unitNotSaid } = require('../rateChange');

const onFee = (value, said) => unitNotSaid({ field: 'feePercent', value, said });

test('A SHORTHAND AMOUNT IS REFUSED ON A RATE, not written as a percentage', () => {
  for (const [value, said] of [
    [-1000, 'deduct 1k from zayn'],
    [-4500, 'deduct 4.5k from zayn'],
    [100000, 'add 100k to zayn'],
  ]) {
    const out = onFee(value, said);
    assert.ok(out, said);
    assert.match(out, /AMOUNT AND NOT A PERCENTAGE/, said);
    assert.match(out, /NOTHING HAS BEEN CHANGED/, said);
  }
});

test('AND A COMMA GROUPED ONE IS SEEN, where it used to be invisible', () => {
  // "1,000" and "1000" are one number typed two ways.
  assert.ok(onFee(-1000, 'deduct 1,000 from zayn'));
});

test('A SHORTHAND WITH NO SHORT FORM IS NOT INVENTED', () => {
  // 1234 is not "1.234k". Reading one would be the guessing this refuses.
  assert.equal(onFee(-1234, 'deduct something from zayn'), null);
});

test('AND NOTHING ELSE MOVED', () => {
  // A bare number is still the ambiguous ask, not the shorthand refusal.
  assert.match(onFee(-100, 'deduct 100 to zayn milkman'), /no percent sign/);
  // A unit they gave is still silence.
  assert.equal(onFee(-100, 'deduct 100% from zayn'), null);
  assert.equal(onFee(-5, 'take 5 off his fee'), null);
  // A figure SHE worked out is some other guard's business.
  assert.equal(onFee(7, 'deduct 100 to zayn'), null);
  // And an amount field is where 1k belongs.
  assert.equal(unitNotSaid({ field: 'payableAmount', value: 1000, said: 'deduct 1k from zayn' }), null);
});
