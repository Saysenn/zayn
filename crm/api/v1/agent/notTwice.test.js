const test = require('node:test');
const assert = require('node:assert/strict');

const { saidAlready } = require('./notTwice');

/**
 * ***************************************************
 * * She must not say the same sentence twice
 * ***************************************************
 *
 * From the transcript: asked "are you sure that is correct?" she repeated
 * her previous line word for word. Re-running the tool and getting the same
 * figure is RIGHT; saying it identically is what reads as a broken machine.
 */

const TOTAL = 'Nicola is owed GBP 2,900 for this month, and nothing from Social work partners PR.';

test('the same line twice in a row is caught', () => {
  assert.equal(saidAlready(TOTAL, [{ role: 'assistant', content: TOTAL }]), true);
});

test('punctuation, case and spacing are not the sentence', () => {
  const loud = 'NICOLA is owed GBP 2,900 for this month and nothing from Social work partners PR!!';
  assert.equal(saidAlready(loud, [{ role: 'assistant', content: TOTAL }]), true);
});

test('the same FACTS in different words are fine', () => {
  // This is the whole point: she may confirm, she may not parrot.
  const reworded = 'I have checked again and it is still 2,900 GBP, with nothing owed on the Social work partners row.';
  assert.equal(saidAlready(reworded, [{ role: 'assistant', content: TOTAL }]), false);
});

test('only the MOST RECENT assistant turn counts', () => {
  // Coming back to a figure later and stating it the same way is ordinary.
  const history = [
    { role: 'assistant', content: TOTAL },
    { role: 'user', content: 'and Gloria?' },
    { role: 'assistant', content: 'Gloria is owed GBP 1,000 for this month.' },
  ];
  assert.equal(saidAlready(TOTAL, history), false);
});

test('a short reply may repeat', () => {
  // "Yes." and "Done, that is saved." are the whole reply and are fine
  // twice. Flagging them would make her invent variation for its own sake.
  assert.equal(saidAlready('Done.', [{ role: 'assistant', content: 'Done.' }]), false);
  assert.equal(saidAlready('Yes, that is right.', [{ role: 'assistant', content: 'Yes, that is right.' }]), false);
});

test('an empty history is never a repeat', () => {
  assert.equal(saidAlready(TOTAL, []), false);
  assert.equal(saidAlready(TOTAL, undefined), false);
});

test('the user saying it does not make it a repeat', () => {
  // Only her own last turn. An admin quoting her back is not her repeating.
  assert.equal(saidAlready(TOTAL, [{ role: 'user', content: TOTAL }]), false);
});

test('the repeated question from the Gloria loop is caught', () => {
  const asked = 'There are two Glorias in the sheet: Gloria and Gloria difference. Which one would you like the total for?';
  const again = 'There are two people named Gloria: one is just Gloria, and the other is Gloria difference. Could you please confirm which Gloria you want the total for?';
  // Not word for word, so the wording guard alone would miss it. The real
  // fix for that loop is the exact-name rule in totalFor; this only stops
  // the verbatim case.
  assert.equal(saidAlready(again, [{ role: 'assistant', content: asked }]), false);
  assert.equal(saidAlready(asked, [{ role: 'assistant', content: asked }]), true);
});

/* ===============================
 * * Nearly the same is the same
 * =============================== */

const REAL_LOOP = [
  'I found five rows close to "Gloria Difference": #93 in ALL GROUPS, plus Gloria four deals in INDIGO, MILKMAN, NEXUS and MANBAT. Which one do you want details for?',
  'I found five rows close to "Gloria Diference": #93 in ALL GROUPS, plus Gloria four deals in INDIGO, MILKMAN, NEXUS and MANBAT. Which one do you want details for?',
];

test('THE REAL LOOP: one typo apart is still the same question', () => {
  // A byte comparison saw two different sentences and the loop ran on.
  // What the admin saw was the identical question twice.
  const [first, second] = REAL_LOOP;
  assert.equal(saidAlready(second, [{ role: 'assistant', content: first }]), true);
});

test('two REAL answers about different people are not a repeat', () => {
  const a = 'Gloria is owed GBP 2,000 for August 2026. That is GBP 2,000 owed plus GBP 100 in add ons, so GBP 2,100 to find.';
  const b = 'Nathan is owed GBP 5,000 for August 2026. That is GBP 5,000 owed plus GBP 250 in add ons, so GBP 5,250 to find.';
  assert.equal(saidAlready(b, [{ role: 'assistant', content: a }]), false);
});

test('the same person in a different month is not a repeat either', () => {
  const a = 'Gloria is owed GBP 2,000 for August 2026 plus GBP 100 in add ons, so GBP 2,100 to find.';
  const b = 'Gloria is owed GBP 1,500 for September 2026 plus GBP 75 in add ons, so GBP 1,575 to find.';
  assert.equal(saidAlready(b, [{ role: 'assistant', content: a }]), false);
});

test('"I checked again" is a legitimate near-repeat and must pass', () => {
  // Re-running the tool and getting the same figure is exactly right.
  const a = 'Gloria is owed GBP 2,000 for August 2026.';
  const b = 'I checked again and it is unchanged: Gloria is owed GBP 2,000 for August 2026, dear.';
  assert.equal(saidAlready(b, [{ role: 'assistant', content: a }]), false);
});

test('THE GAP IS WIDE, so the threshold is not delicately placed', () => {
  // A threshold that only just separates the two cases is one reply away
  // from flagging an honest answer.
  const { sameness, fold, NEARLY } = require('./notTwice');
  const loop = sameness(fold(REAL_LOOP[0]), fold(REAL_LOOP[1]));
  const honest = sameness(
    fold('Gloria is owed GBP 2,000 for August 2026 plus GBP 100 in add ons.'),
    fold('Gloria is owed GBP 1,500 for September 2026 plus GBP 75 in add ons.'),
  );

  assert.ok(loop >= NEARLY, `the loop scores ${loop.toFixed(3)}`);
  assert.ok(honest < NEARLY - 0.1, `an honest pair scores ${honest.toFixed(3)}, well clear`);
  assert.ok(loop - NEARLY > 0.05, `and the loop clears it by ${(loop - NEARLY).toFixed(3)}`);
});

test('the retry tells her to ACT, not just to rephrase', () => {
  // Told only to say it differently, she asked the same question in fresh
  // words and the loop carried on looking new.
  const src = require('node:fs').readFileSync(require.resolve('./runAgent.js'), 'utf8');
  assert.match(src, /you have now asked twice and been answered/i);
  assert.match(src, /Do not ask a third time/);
  assert.match(src, /Their reply is the choice/);
});
