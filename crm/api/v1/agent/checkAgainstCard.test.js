const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAgainstCard, lastCard } = require('./checkAgainstCard');

/**
 * ***************************************************
 * * "AND HIS ROLE?" ANSWERED WITHOUT LOOKING
 * ***************************************************
 *
 * Live 2026-09-17. Two short follow ups, no tool call on either, both
 * invented:
 *
 *   "and his role?"           -> "Richard's role is Mid 1."       it is Loss lead
 *   "and company he handles?" -> "Richard handles Northstar Care." it is Workforce
 *
 * `checkFigures` only sees numbers over 100 or carrying a decimal, and
 * `checkClaims` needs a numeric value, so an invented ROLE or COMPANY NAME
 * was invisible to every guard in this folder.
 *
 * The card shape below is `dealCard`'s real one, and the history entry is
 * what AgentOverlay commits when a card is drawn. Copied from both rather
 * than imagined: a guard tested against a shape the code does not produce
 * passes its own tests and catches nothing.
 */
const CARD = {
  id: 91,
  name: 'Richard',
  groups: [
    {
      title: 'The deal',
      cells: [
        { label: 'Role', value: 'Loss lead', editField: 'roleLabel' },
        { label: 'Company', value: 'Workforce', editField: 'company' },
        { label: 'Status', value: 'Active', editField: 'status' },
      ],
    },
    {
      title: 'Contact and bank',
      cells: [{ label: 'Phone', value: null, editField: 'phone' }],
    },
  ],
};

const history = (said) => [
  { role: 'user', content: 'show his details' },
  { role: 'assistant', content: "[showed Richard's deal #91]", card: CARD },
  { role: 'user', content: said },
];

test('the invented role is caught', () => {
  const out = checkAgainstCard("Richard's role is Mid 1.", 'and his role?', [], history('and his role?'));
  assert.equal(out.ok, false);
  assert.equal(out.label, 'Role');
  assert.equal(out.value, 'Loss lead');
  assert.equal(out.who, 'Richard');
});

test('the invented company is caught', () => {
  const said = 'and company he handles?';
  const out = checkAgainstCard('Richard handles Northstar Care.', said, [], history(said));
  assert.equal(out.ok, false);
  assert.equal(out.value, 'Workforce');
});

test('the right answer passes', () => {
  const out = checkAgainstCard("Richard's role: Loss lead.", 'and his role?', [], history('and his role?'));
  assert.equal(out.ok, true);
});

// ===============================
// * WHAT MUST NOT FIRE
// ===============================
test('a turn where a tool ran is left to the other guards', () => {
  const out = checkAgainstCard(
    "Richard's role is Mid 1.", 'and his role?', [{ summary: 'anything' }], history('and his role?'),
  );
  assert.equal(out.ok, true);
});

test('a card about somebody else is not evidence', () => {
  // A follow up can move to another person, and comparing their answer
  // against the last person's card would flag a correct reply.
  const out = checkAgainstCard("Gloria's role is Mid 1.", 'and gloria?', [], history('and gloria?'));
  assert.equal(out.ok, true);
});

test('no card in the conversation means nothing to check against', () => {
  const out = checkAgainstCard("Richard's role is Mid 1.", 'and his role?', [], [
    { role: 'user', content: 'and his role?' },
  ]);
  assert.equal(out.ok, true);
});

test('a question naming no field is left alone', () => {
  const said = 'how is he doing';
  assert.equal(checkAgainstCard('Richard is fine.', said, [], history(said)).ok, true);
});

test('an empty cell has no wrong answer', () => {
  const said = 'whats his phone';
  const out = checkAgainstCard('Richard has no phone on file.', said, [], history(said));
  assert.equal(out.ok, true);
});

test('lastCard takes the NEWEST card, not the first', () => {
  const older = { id: 1, name: 'Gloria', groups: [] };
  const found = lastCard([
    { role: 'assistant', content: 'a', card: older },
    { role: 'assistant', content: 'b', card: CARD },
  ]);
  assert.equal(found.name, 'Richard');
});

test('an entry with no card at all is skipped', () => {
  assert.equal(lastCard([{ role: 'assistant', content: 'just words' }]), null);
  // A malformed one too: `groups` is what every reader here walks.
  assert.equal(lastCard([{ role: 'assistant', content: 'x', card: { name: 'Richard' } }]), null);
});
