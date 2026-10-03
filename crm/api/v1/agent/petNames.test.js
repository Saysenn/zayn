const test = require('node:test');
const assert = require('node:assert/strict');

const { easeOffPetNames, hasPetName, stripPetNames } = require('./petNames');

/**
 * ***************************************************
 * * A pet name in every reply is a tic, not affection
 * ***************************************************
 *
 * Live transcript, five replies running: darling, sweetie, honey, darling,
 * lovely. The prompt said "one per reply, and cycle through them", which is
 * exactly what it got. Rewriting it to "roughly one in three" changed
 * nothing, because a FREQUENCY is not something a prompt can hold.
 *
 * PROMPTING IS NOT A GUARD. Same lesson as "Awww" on every reply.
 */

test('the address comes out and the sentence does not', () => {
  const cases = [
    ['Gloria is owed 2,000, darling.', 'Gloria is owed 2,000.'],
    ['Darling, the sheet is ready.', 'The sheet is ready.'],
    ['Feeling bright and ready, sweetie! What next?', 'Feeling bright and ready! What next?'],
    ['NEXUS is owed 4,750, honey, for August.', 'NEXUS is owed 4,750, for August.'],
  ];
  for (const [before, after] of cases) {
    assert.equal(stripPetNames(before), after);
  }
});

test('THE FIGURE SURVIVES INTACT, which is the only thing that must', () => {
  const out = stripPetNames('Gloria is owed GBP 2,000 for August 2026, sweetheart.');
  assert.match(out, /GBP 2,000/);
  assert.match(out, /August 2026/);
  assert.ok(!/sweetheart/i.test(out));
});

test('a word that is not an address is left alone', () => {
  // "What a lovely surprise" is not her calling them lovely, and
  // "the honey account" would be a company.
  for (const kept of [
    'What a lovely surprise!',
    'That is a lovely clean sheet.',
    'Nathan is owed 3,000 for August.',
  ]) {
    assert.equal(stripPetNames(kept), kept, kept);
    assert.equal(hasPetName(kept), false, kept);
  }
});

test('ONE IN A ROW, NEVER TWO', () => {
  const warm = [{ role: 'assistant', content: 'Hi there, darling!' }];
  const plain = [{ role: 'assistant', content: 'All done.' }];

  assert.equal(easeOffPetNames('All set, sweetie!', warm), 'All set!');
  assert.equal(easeOffPetNames('All set, sweetie!', plain), 'All set, sweetie!');
  // Nothing to compare against yet, so the first one stands.
  assert.equal(easeOffPetNames('All set, sweetie!', []), 'All set, sweetie!');
});

test('GUARDS THE GUARD: the check is stateless', () => {
  // A `g` regex carries lastIndex between calls, so `.test()` on a shared
  // one returns true, then false, then true on the SAME string. The guard
  // silently did nothing every other reply until this caught it.
  const line = 'All set, sweetie!';
  for (let i = 0; i < 6; i += 1) {
    assert.equal(hasPetName(line), true, `call ${i + 1} disagreed with the last`);
  }

  const warm = [{ role: 'assistant', content: 'Hi, darling!' }];
  for (let i = 0; i < 6; i += 1) {
    assert.equal(easeOffPetNames(line, warm), 'All set!', `call ${i + 1} let one through`);
  }
});

test('only the MOST RECENT reply decides', () => {
  // Coming back to a warm word after a few exchanges is ordinary. Doing it
  // every single time is the fault, so only the last turn counts.
  const history = [
    { role: 'assistant', content: 'Morning, lovely!' },
    { role: 'user', content: 'what is Gloria owed' },
    { role: 'assistant', content: 'Gloria is owed 2,000 for August.' },
  ];
  assert.equal(easeOffPetNames('All set, honey!', history), 'All set, honey!');
});
