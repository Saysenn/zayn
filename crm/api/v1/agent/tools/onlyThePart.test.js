const test = require('node:test');
const assert = require('node:assert/strict');

const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * "Give me only the usd value" was impossible
 * ***************************************************
 *
 * runAgent returns a COMPUTED reply without a model round, which is what
 * keeps every figure out of the model's hands. With nobody there to trim,
 * she replayed the whole block and `saidAlready` stamped "I ran it again
 * and it has not moved" on top of it. Both guards were right. The contract
 * had no way to say WHICH PART was wanted, so the answer is a shape on the
 * tool rather than a licence for the model to rewrite money.
 *
 * Live 2026-09-09, on Nathan's eight deals.
 */

const totals = masterSheetTools.find((t) => t.name === 'total_master_sheet');
const shape = totals.parameters.properties.only;

test('the shape is a parameter, and it is a closed set', () => {
  assert.ok(shape, '`only` is how a subset is asked for');
  assert.deepEqual(shape.enum, ['converted', 'headline', 'figures']);
});

test('IT SAYS IT CHANGES NO FIGURE, so she never reaches for it to fix a number', () => {
  assert.match(shape.description, /never changes a figure/i);
  assert.match(shape.description, /OMIT IT for the full answer/);
});

test('the default is still everything', () => {
  // `all` is the order the parts are pushed in, so an ordinary answer is
  // byte for byte what it always was.
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet'), 'utf8');
  assert.match(src, /all: \['headline', 'breakdown', 'excluded', 'converted'\]/);
  assert.match(src, /SHAPES\[args\.only\] \?\? SHAPES\.all/);
});

test('AN EMPTY SHAPE FALLS BACK to everything, never to silence', () => {
  // Asking for only the USD on an answer that was never converted would
  // return no lines at all, and a blank reply reads as a broken agent.
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet'), 'utf8');
  assert.match(src, /picked\.length > 0 \? picked : SHAPES\.all/);
});

/**
 * ===============================
 * * The guard, because prompting is not one
 * ===============================
 * She will not reliably pass `only`. The same file already forces
 * `convertTo` off what they actually said; this rides the same rail.
 */

const { ASKED_FOR_ONLY, ASKED_FOR_TOTAL } = (() => {
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet'), 'utf8');
  const grab = (name) => {
    const m = new RegExp(`const ${name} = (/.*/[a-z]*);`).exec(src);
    // eslint-disable-next-line no-eval
    return eval(m[1]);
  };
  return { ASKED_FOR_ONLY: grab('ASKED_FOR_ONLY'), ASKED_FOR_TOTAL: grab('ASKED_FOR_TOTAL') };
})();

test('a NARROWING is caught', () => {
  for (const said of [
    'can you give me only the usd converted value for nathan?',
    'just the usd please',
    'the total alone',
    'nothing but the figure',
    'without the breakdown',
  ]) {
    assert.ok(ASKED_FOR_ONLY.test(said), said);
  }
});

test('A WHOLE QUESTION IS NOT A NARROWING, or every currency ask loses its breakdown', () => {
  // This is the half that would do damage if the regex were widened to any
  // mention of usd.
  for (const said of [
    'how much is nathan owed in usd',
    'and converted to usd?',
    'what is the september total in dollars',
    'convert that to usd',
  ]) {
    assert.equal(ASKED_FOR_ONLY.test(said), false, said);
  }
});

test('a narrowing with no currency named means the headline', () => {
  assert.ok(ASKED_FOR_TOTAL.test('just the total'));
  assert.ok(ASKED_FOR_TOTAL.test('only the figure'));
  // And a narrowing that names neither falls through to the full answer
  // rather than guessing which part they meant.
  assert.equal(ASKED_FOR_TOTAL.test('only that'), false);
});
