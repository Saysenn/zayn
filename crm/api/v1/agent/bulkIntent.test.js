const test = require('node:test');
const assert = require('node:assert/strict');

const { fieldNotNamed, endingNotSwitch, scopeMissesNamed, MUST_BE_NAMED } = require('./bulkIntent');

/**
 * ***************************************************
 * * SHE PICKED THE FIELD THEY NEVER NAMED
 * ***************************************************
 *
 * Live 2026-09-24, one yes away from writing. She asked "which field and
 * what value", was answered with a LIST OF DEALS, and filled the
 * unanswered half in herself: `overrideShouldBePaid = false`, which takes
 * a row out of every payout total.
 */

const LABELS = {
  overrideShouldBePaid: 'should be paid (admin override)',
  overridePaid: 'paid (admin override)',
  specialCaseDeal: 'special case',
  presetOn: 'preset date',
  payableDays: 'payable days',
  monthlyAmount: 'monthly amount',
};

// Their actual sentence, which named five deals and no field.
const NAMED_ONLY_DEALS = 'update the past a year deals like the Reliapay from Milkman that ended '
  + 'March 1 2025 FB Mid one, Sean Mannings director, KP Manbat ended July 7 2026 its Gary, and '
  + 'then the Kryptonia Manbat Gary Mid one and then James Heath director';

test('THE INCIDENT IS REFUSED', () => {
  const out = fieldNotNamed(NAMED_ONLY_DEALS, ['overrideShouldBePaid'], LABELS);
  assert.ok(out);
  assert.match(out, /They never said to change override should be paid/);
  assert.match(out, /a list of deals is neither/);
});

test('a field they DID name goes through', () => {
  assert.equal(fieldNotNamed('mark them as should be paid no', ['overrideShouldBePaid'], LABELS), null);
  assert.equal(fieldNotNamed('turn the special case off', ['specialCaseDeal'], LABELS), null);
});

/**
 * ===============================
 * * ONLY THE FIELDS THAT DECIDE WHETHER SOMEBODY IS PAID
 * ===============================
 * The first version refused ANY unnamed field and went red on every
 * ordinary instruction. "Set them all to September 2026" names a VALUE
 * and no field; "roll them forward" names neither. Both are unambiguous,
 * because a preset is the only thing you roll.
 */
test('an ordinary instruction that names no field is NOT refused', () => {
  for (const [said, keys] of [
    ['set them all to september 2026 please', ['presetOn']],
    ['roll them forward', ['presetOn']],
    ['make them all 10', ['payableDays']],
    ['put them on 500 a month', ['monthlyAmount']],
  ]) assert.equal(fieldNotNamed(said, keys, LABELS), null, said);
});

test('the guarded set is the payment decisions, and nothing else', () => {
  // Widening this list is a decision about money, so it is stated here
  // rather than discovered from behaviour.
  assert.deepEqual([...MUST_BE_NAMED].sort(), [
    'overridePaid', 'overrideShouldBePaid', 'paid', 'shouldBePaid', 'specialCaseDeal',
  ]);
});

test('when they named a DIFFERENT field, the refusal says which', () => {
  // A bare "you invented it" left her inventing a second one.
  const out = fieldNotNamed('change their payable days to 10', ['overrideShouldBePaid'], LABELS);
  assert.match(out, /They said "payable days"/);
});

test('an empty sentence checks nothing, rather than refusing everything', () => {
  assert.equal(fieldNotNamed('', ['overrideShouldBePaid'], LABELS), null);
  assert.equal(fieldNotNamed(null, ['overrideShouldBePaid'], LABELS), null);
});

/* ===============================
 * * A SCOPE NARROWER THAN WHAT THEY NAMED
 * =============================== */

const KNOWN = ['Reliapay', 'Kryptonia', 'Workforce', 'Competex pro'];

test('a scope short of what they named is refused', () => {
  const out = scopeMissesNamed(
    'the Reliapay deals and Kryptonia too',
    [{ company: 'Reliapay' }, { company: 'Reliapay' }],
    KNOWN,
  );
  assert.ok(out);
  assert.match(out, /Kryptonia is not in it/);
});

test('THE SHEET\'S OWN SPELLING, never the folded one', () => {
  // "reaches only reliapay" reads as a different company from the one on
  // their screen.
  const out = scopeMissesNamed('Reliapay and Kryptonia', [{ company: 'Reliapay' }], KNOWN);
  assert.match(out, /reaches only Reliapay/);
  assert.doesNotMatch(out, /reliapay/);
});

test('a scope covering everything they named passes', () => {
  assert.equal(
    scopeMissesNamed(
      'the Reliapay deals and Kryptonia too',
      [{ company: 'Reliapay' }, { company: 'Kryptonia' }],
      KNOWN,
    ),
    null,
  );
});

test('naming no company at all is not a short scope', () => {
  assert.equal(scopeMissesNamed('set them all to 10 days', [{ company: 'Reliapay' }], KNOWN), null);
});

test('a two letter name is skipped, because it lives inside ordinary words', () => {
  // "KP" matches inside prose too easily to accuse on.
  assert.equal(scopeMissesNamed('the KP deals', [{ company: 'Reliapay' }], ['KP', 'Reliapay']), null);
});

test('no list to check against means silence', () => {
  assert.equal(scopeMissesNamed('Reliapay', [{ company: 'Reliapay' }], null), null);
  assert.equal(scopeMissesNamed('', [], KNOWN), null);
});

// 2026-09-28: "stop Suki's deal" became Should be paid = No. Ending a deal is stop_deal.
test('ENDING A DEAL IS NEVER A PAYMENT SWITCH', () => {
  for (const said of ["stop Suki Varnell's deal at ZZ Rate Co A", 'end her deal', 'her deal is over']) {
    assert.match(endingNotSwitch(said, ['overrideShouldBePaid']) ?? '', /stop_deal/, said);
  }
  // A switch they asked for by its own words is left alone.
  assert.equal(endingNotSwitch("don't pay Suki this month", ['overrideShouldBePaid']), null);
  // An ending with no payment field in the call is not this guard's business.
  assert.equal(endingNotSwitch('stop her deal', ['roleLabel']), null);
});

// 2026-09-28: "mark Dov paid", "which deal?", "both of them" was refused as a
// field never named. The field was in the message before; the guard reads two.
test('THE FIELD MAY BE NAMED ONE MESSAGE BACK, the answer to "which deal?"', () => {
  const labels = { overridePaid: 'paid (admin override)' };
  assert.equal(fieldNotNamed('mark Dov Ashgrove as paid this month\nboth of them', ['overridePaid'], labels), null);
  const src = require('node:fs').readFileSync(require.resolve('./tools/masterSheet'), 'utf8');
  assert.match(src, /fieldNotNamed\(args\.saidRecent \?\? said, Object\.keys\(fields\), FIELD_LABELS\)/);
  /**
   * THE RULE IS THAT "BOTH" IS OFFERED, not the words around it.
   *
   * This pinned the whole sentence, including "Which company", and that
   * half was a bug: two deals at the same company made it a question whose
   * answer narrows nothing. The question asks on the field that DIFFERS
   * now (`resolveRequest`), and what this test is about survives the
   * change: an answer of "both of them" has to be a thing he was offered.
   * Repinned 2026-09-29.
   */
  assert.match(src, /const all = sorted\.length === 2 \? 'both' : 'all of them';/);
  assert.match(src, /changing \? `Which \$\{by\}, or \$\{all\}\?`/);
  assert.doesNotMatch(src, /`Which company, or/, 'the shared field is never the question');
});
