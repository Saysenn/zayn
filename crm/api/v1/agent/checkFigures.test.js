const test = require('node:test');
const assert = require('node:assert/strict');

const { checkFigures } = require('./checkFigures');

/**
 * ***************************************************
 * * A figure she did not get from a tool
 * ***************************************************
 *
 * The real incident: asked Nicola's August total she answered "owed
 * nothing, all her deals are marked for another month" off the cards she
 * had just shown, while total_master_sheet computes 2,900 from three of her
 * four deals.
 *
 * The prompt already forbade every part of that. Prompting is not a guard.
 */

const totalResult = {
  say: 'Nicola is owed GBP 2,900 for August 2026, and nothing from Social work partners PR.',
  total: { GBP: 2900 },
  rows: [
    { payable_amount: 700 },
    { payable_amount: 800 },
    { payable_amount: 1400 },
  ],
};

test('the computed total passes', () => {
  const out = checkFigures('Nicola is owed 2,900 GBP for August.', [totalResult]);
  assert.equal(out.ok, true);
});

test('the per-row amounts behind it pass too', () => {
  // "700 from Acqua and 800 from Leadstone" is a correct sentence built
  // from real values, and only the grand total is in `total`.
  const out = checkFigures('700 from Acqua, 800 from Leadstone, 1,400 from Ackerman.', [totalResult]);
  assert.equal(out.ok, true, JSON.stringify(out.unsupported));
});

test('an invented figure is caught', () => {
  const out = checkFigures('Nicola is owed 3,700 GBP for August.', [totalResult]);
  assert.equal(out.ok, false);
  assert.deepEqual(out.unsupported, [3700]);
});

test('decimals and thousands separators are one figure', () => {
  assert.equal(checkFigures('2900.00', [totalResult]).ok, true);
  assert.equal(checkFigures('2,900', [totalResult]).ok, true);
  assert.equal(checkFigures('GBP 1400.00', [totalResult]).ok, true);
});

test('small numbers are not figures', () => {
  // "4 deals", "31 days", "Mid 1". Treating those as money would flag every
  // honest sentence she writes.
  const out = checkFigures('She has 4 deals, all 31 payable days, in group 1.', [totalResult]);
  assert.equal(out.ok, true);
});

test('a decimal amount under 100 is still a checked figure', () => {
  const result = { total: { GBP: 80.65 } };
  assert.equal(checkFigures('The total is 80.65.', [result]).ok, true);
  assert.deepEqual(checkFigures('The total is 70.25.', [result]).unsupported, [70.25]);
});

test('a currency marker makes a small whole number a checked figure', () => {
  const result = { total: { GBP: 80 } };
  assert.equal(checkFigures('The total is GBP 80.', [result]).ok, true);
  assert.deepEqual(checkFigures('The total is £70.', [result]).unsupported, [70]);
});

test('a percentage is left to checkPercents even when it has decimals', () => {
  const result = { total: { GBP: 80.65 } };
  const out = checkFigures('The fee is 2.5% and the total is 80.65.', [result]);
  assert.equal(out.ok, true, JSON.stringify(out.unsupported));
});

test('with no tool figures at all the check stays silent', () => {
  // Nothing to check against, so a number in the reply is not evidence of
  // anything. Guessing here would block ordinary conversation.
  const out = checkFigures('That was around 5,000 last year I think.', [{ summary: 'no numbers' }]);
  assert.equal(out.had, false);
  assert.equal(out.ok, true);
});

test('figures written into a tool summary count as produced', () => {
  // Several tools format their own lines rather than returning `total`.
  const out = checkFigures(
    'Sean Mannings is owed 2,500.',
    [{ summary: 'Counted (1):\n  Reliapay in MILKMAN: GBP 2,500\n\nTOTAL: GBP 2,500' }],
  );
  assert.equal(out.ok, true);
});

test('several tools in one turn are pooled', () => {
  const out = checkFigures('700 and 4,500.', [totalResult, { total: { GBP: 4500 } }]);
  assert.equal(out.ok, true);
});

test('the reported figure is what to put in the retry', () => {
  const out = checkFigures('It is 9,999 for August.', [totalResult]);
  assert.deepEqual(out.unsupported, [9999]);
  assert.equal(out.had, true);
});

// ***************************************************
// * NOTHING RAN IS NOT A TOOL THAT COMPUTED NO FIGURE
// ***************************************************
//
// Live 2026-09-08: `Looking ahead to November 2026, the sheet projects AED
// 54,342.50` with no tool call. checkMonths could not see it either: its
// month is bound to `FOR <month>` and this said `to`, which is the
// precision that keeps THAT guard from crying wolf.
test('a figure with NO tool call at all is unsupported', () => {
  const check = checkFigures('Looking ahead to November 2026, the sheet projects AED 54,342.50.', []);

  assert.equal(check.ok, false);
  assert.equal(check.had, true);
  assert.deepEqual(check.unsupported, [54342.5]);
});

test('and a reply with no figures is still silent with no tools', () => {
  for (const honest of ['Hello, what can I help with?', 'I cannot rank people yet.']) {
    assert.equal(checkFigures(honest, []).ok, true, honest);
  }
});

test('a tool that ran but computed no figure stays exempt', () => {
  // Unchanged: reading a card back is legitimate.
  assert.equal(checkFigures('She is owed GBP 2,900.', [{ summary: 'a card', cards: [{ id: 1 }] }]).ok, true);
});


test('a figure after tools that REFUSED and showed nothing is unsupported', () => {
  const refused = [{ summary: 'NOTHING has been totalled. Call this again with people.' }];
  assert.equal(checkFigures('They are owed 6,000 for September.', refused).ok, false);
  // Rows on screen are something to read back, as before.
  assert.equal(checkFigures('Her deal is 3,000.', [{ summary: 'x', rows: [{ id: 1 }] }]).ok, true);
});
