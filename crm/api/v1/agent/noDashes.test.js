const test = require('node:test');
const assert = require('node:assert/strict');

const { noDashes } = require('./noDashes');

/**
 * ***************************************************
 * * A DASH INSIDE DATA IS NOT PUNCTUATION
 * ***************************************************
 *
 * This file's own comment said "MODEL PROSE ONLY, never run it over a
 * code-built value", and `runAgent` ran it over the whole reply, which is
 * full of values she has just quoted.
 */

test('A SORT CODE SURVIVES, which is the one that costs money', () => {
  // The sheet writes every sort code as "30 - 97 - 90". Stripping those
  // dashes reads a WRONG SORT CODE back to somebody about to pay.
  assert.equal(noDashes('sort code 30 - 97 - 90'), 'sort code 30 - 97 - 90');
  assert.equal(
    noDashes('Her account is 12362560 and sort code 30 - 97 - 90.'),
    'Her account is 12362560 and sort code 30 - 97 - 90.',
  );
});

test('a company with a dash stays ONE company', () => {
  // "Gloria - Workforce" became "Gloria, Workforce", which is how a SIX row
  // group got read back as an eight item list.
  assert.equal(noDashes('Pino - Workforce in NEXUS'), 'Pino - Workforce in NEXUS');
  assert.equal(noDashes('Gloria - Workforce'), 'Gloria - Workforce');
});

test('GUARDS THE GUARD: prose dashes still go', () => {
  // Protecting data must not quietly turn this into a no-op. An em dash is
  // the tell that a machine wrote the sentence, and removing it is the
  // whole job.
  assert.equal(noDashes('Hi — tell me what to change'), 'Hi, tell me what to change');
  assert.equal(noDashes('she is owed 500 - which is right'), 'she is owed 500, which is right');
  assert.equal(noDashes('- first item'), 'first item');
});

test('several protected values in one sentence all come back', () => {
  const line = 'Pino - Workforce pays into 20 - 82 - 23, and Gloria - Workforce into 09 - 01 - 28.';
  assert.equal(noDashes(line), line);
});
