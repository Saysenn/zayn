const test = require('node:test');
const assert = require('node:assert/strict');
const { asksRateCheck } = require('./askShapes');
const { rateVerdict } = require('./rateChange');
const { checkVerdict } = require('./checkVerdict');

// "Is Dov on a 1% add on?" was answered with his rates and never "no".
// The verdict is worked out in code and her answer has to open with it.

test('A YES OR NO ABOUT ONE FIGURE is recognised, and nothing else is', () => {
  assert.deepEqual(asksRateCheck('is dov ashgrove on a 5% fee?'), { percent: 5, kind: 'fee' });
  assert.deepEqual(asksRateCheck('are dov and bram on a 2% add-on?'), { percent: 2, kind: 'addon' });
  assert.deepEqual(asksRateCheck("is dov's fee 5%?"), { percent: 5, kind: 'fee' });
  assert.deepEqual(asksRateCheck('is suki on 5%?'), { percent: 5, kind: null });
  for (const other of ['what is dov on?', 'set dov fee to 5%', 'is dov paid this month?', 'give dov 5%']) {
    assert.equal(asksRateCheck(other), null, other);
  }
});

const deal = (company, addonPercent, feePercent) => ({ company, addonPercent, feePercent });
const dov = { name: 'Dov', person: { addon: 0, fee: 2 } };

test('NO names the figure they are actually on', () => {
  const out = rateVerdict({ ...dov, asked: { percent: 5, kind: 'fee' }, deals: [deal('Co B', 0, 2)] });
  assert.equal(out.word, 'No');
  assert.equal(out.line, 'No. Dov is on 2% fee, not 5%.');
});

test('YES when every deal carries it', () => {
  const out = rateVerdict({ ...dov, asked: { percent: 2, kind: 'fee' }, deals: [deal('Co B', 0, 2), deal('Co C', 0, 2)] });
  assert.equal(out.word, 'Yes');
});

test('PARTLY when a deal rate stacks it there and not elsewhere', () => {
  const out = rateVerdict({ ...dov, asked: { percent: 6, kind: 'fee' }, deals: [deal('Co B', 0, 6), deal('Co C', 0, 2)] });
  assert.equal(out.word, 'Partly');
  assert.match(out.line, /at Co B/);
  assert.match(out.line, /but 2% at Co C/);
});

test('NO KIND NAMED: whichever kind matches, else both are said', () => {
  const suki = { name: 'Suki', person: { addon: 5, fee: 0 }, deals: [deal('Co A', 5, 0)] };
  assert.equal(rateVerdict({ ...suki, asked: { percent: 5, kind: null } }).word, 'Yes');
  assert.match(rateVerdict({ ...suki, asked: { percent: 3, kind: null } }).line, /5% add on and 0% fee.*not 3%/);
});

const tool = (...lines) => [{ summary: lines.map((l) => `OPEN YOUR ANSWER WITH THIS SENTENCE, word for word: "${l}"`).join('\n') }];

test('A REPLY WITHOUT THE NO IS CAUGHT', () => {
  const results = tool('No. Dov Ashgrove is on 0% add on, not 1%.');
  assert.equal(checkVerdict('Dov holds 2 deals with 0% add on and a 2% fee.', results).ok, false);
  assert.equal(checkVerdict('No. Dov Ashgrove is on 0% add on, not 1%. His fee is 2%.', results).ok, true);
  assert.equal(checkVerdict('No, sweetie, he is on 0% add on.', results).ok, true);
});

test('SEVERAL PEOPLE: each needs their own word, beside their name', () => {
  const results = tool('No. Dov Ashgrove is on 0% add on, not 2%.', 'Yes. Bram Tevish is on 2% add on.');
  assert.equal(checkVerdict('No, Dov is on 0%. Bram is on 2%.', results).ok, false);
  assert.equal(checkVerdict('No, Dov is on 0%. Yes, Bram is on 2%.', results).ok, true);
});

test('no yes or no question, nothing to check', () => {
  assert.equal(checkVerdict('Dov carries a 2% fee.', [{ summary: 'Dov carries 0% add on' }]).ok, true);
});

test('A YES OR NO ANSWERED WITH NO TOOL AT ALL is sent back to look', () => {
  const out = checkVerdict("Dov's fee is 2%, yes.", [], { said: "is dov's fee 2%?" });
  assert.equal(out.ok, false);
  assert.equal(out.noTool, true);
  // A tool that answered without a verdict (nobody matches) stands.
  assert.equal(checkVerdict('Nobody called Zed.', [{ summary: 'Nobody matches "Zed".' }], { said: 'is zed on 2%?' }).ok, true);
  assert.equal(checkVerdict('Hello.', [], { said: 'hi' }).ok, true);
});
