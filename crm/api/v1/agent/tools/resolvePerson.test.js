const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePerson, peopleIn, personMentionedIn } = require('./resolvePerson');

/**
 * ***************************************************
 * * THE EXIT IS THE POINT
 * ***************************************************
 *
 * A question with no answer that resolves it is worse than the dead end it
 * replaced. These pin that every branch she can ask from can be answered.
 *
 * The deadlock these were written for is DATA SHAPED, not code shaped: the
 * offer deduped by NAME while ambiguity counts PEOPLE, so two different
 * `person_id`s sharing a display name made her ask "which one: James
 * Smith?" and answering it asked again, forever. Nothing in the real sheet
 * hit it. Renaming anybody would.
 */

const peopleCount = (r) => new Set(r.rows.map((x) => x.person_id)).size;

/* ---- two people, one name ---- */

const SAME_NAME = [
  { person_id: 'p1', person_name: 'James Smith', company: 'Acqua' },
  { person_id: 'p2', person_name: 'James Smith', company: 'Leadstone' },
];

test('two people sharing a name are offered apart, not as one name twice', () => {
  const asked = resolvePerson(SAME_NAME, 'James Smith');
  assert.equal(asked.ambiguous, true);
  assert.equal(asked.names.length, 2, 'one label per PERSON, never one per name');
  assert.equal(new Set(asked.names).size, 2, 'the two labels must differ or neither resolves');
});

test('ANSWERING one of them resolves it, which is the whole point', () => {
  const asked = resolvePerson(SAME_NAME, 'James Smith');
  for (const label of asked.names) {
    const back = resolvePerson(SAME_NAME, label);
    assert.equal(back.ambiguous, false, `answering "${label}" asked again`);
    assert.equal(peopleCount(back), 1);
  }
  // And they are not the same person twice.
  const [a, b] = asked.names.map((n) => resolvePerson(SAME_NAME, n).rows[0].person_id);
  assert.notEqual(a, b);
});

test('same name AND same company still has a way out', () => {
  const worst = [
    { person_id: 'p1', person_name: 'James Smith', company: 'Acqua' },
    { person_id: 'p2', person_name: 'James Smith', company: 'Acqua' },
  ];
  const asked = resolvePerson(worst, 'James Smith');
  assert.equal(new Set(asked.names).size, 2);
  for (const label of asked.names) {
    assert.equal(resolvePerson(worst, label).ambiguous, false, `answering "${label}" asked again`);
  }
});

/* ---- and none of the settled behaviour moved ---- */

const GLORIA = [
  { person_id: 'g1', person_name: 'Gloria', company: 'Acqua' },
  { person_id: 'g2', person_name: 'Gloria difference', company: 'Leadstone' },
];

test('distinct names are still offered BARE, with no company bolted on', () => {
  const asked = resolvePerson(GLORIA, 'Glori');
  assert.equal(asked.ambiguous, true);
  assert.deepEqual(asked.names, ['Gloria', 'Gloria difference']);
});

test('an exact name still wins outright over a fuzzier neighbour', () => {
  const back = resolvePerson(GLORIA, 'Gloria');
  assert.equal(back.ambiguous, false);
  assert.equal(back.rows[0].person_id, 'g1');
});

test('one person on several companies is several rows and no question', () => {
  const back = resolvePerson([
    { person_id: 'z', person_name: 'Zayn', company: 'A' },
    { person_id: 'z', person_name: 'Zayn', company: 'B' },
  ], 'Zayn');
  assert.equal(back.ambiguous, false);
  assert.equal(back.rows.length, 2);
  assert.equal(peopleCount(back), 1);
});

test('a short name must be a real word, not two letters across a word boundary', () => {
  const rows = [
    { person_id: 'ad', person_name: 'Ad', company: 'A' },
    { person_id: 'nicola', person_name: 'Nicola', company: 'B' },
  ];

  assert.deepEqual(peopleIn(rows, 'show me nicola details'), ['Nicola']);
  assert.equal(personMentionedIn('show me nicola details', 'Ad'), false);
  assert.equal(personMentionedIn('show me Ad details', 'Ad'), true);
});
