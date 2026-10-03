const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAmbiguity, claimsOne, toolSawOne } = require('./checkAmbiguity');

/**
 * ***************************************************
 * * THE RICHARD TURN, the worst half
 * ***************************************************
 *
 * "There are several Richards on the sheet." One Richard, one row, and
 * `resolvePerson` returns ambiguous false for every sentence in that
 * conversation. Verified against the live sheet, not assumed.
 */
const THE_REPLY = 'There are several Richards on the sheet. Could you please tell me which one '
  + 'you mean by giving me their full name, group, or company?';

// What find_and_show_details really returns for a name that resolved.
const RESOLVED = {
  summary: 'name: Richard\npayable days: 30',
  cards: [{ id: 91, name: 'Richard', groups: [] }],
  rows: [{ id: 91, personName: 'Richard' }],
};

// And what it returns when the name really does reach two people.
const AMBIGUOUS = {
  summary: '"Gloria" matches 2 different people: Gloria; Gloria difference.',
  ambiguous: true,
  rows: [{ id: 1, personName: 'Gloria' }, { id: 2, personName: 'Gloria difference' }],
};

test('the invented refusal is caught', () => {
  const check = checkAmbiguity(THE_REPLY, [RESOLVED]);
  assert.equal(check.ok, false);
  assert.equal(check.invented, true);
});

test('a real one passes, because a tool reported it', () => {
  const reply = '"Gloria" is two people: Gloria and Gloria difference. Which one do you mean?';
  const check = checkAmbiguity(reply, [AMBIGUOUS]);
  assert.equal(check.ok, true);
  assert.equal(check.invented, false);
});

test('one ambiguous result among several is enough', () => {
  assert.equal(toolSawOne([RESOLVED, AMBIGUOUS]), true);
  assert.equal(checkAmbiguity(THE_REPLY, [RESOLVED, AMBIGUOUS]).ok, true);
});

// ===============================
// * WHAT MUST NOT FIRE
// ===============================
test('asking which COMPANY is a real question about a row', () => {
  const reply = 'Richard holds deals on Workforce and Acqua. Which company did you mean?';
  assert.equal(checkAmbiguity(reply, [RESOLVED]).ok, true);
});

test('an ordinary answer with a plural in it is not a refusal', () => {
  const reply = 'Richard has three deals and they are all on screen.';
  assert.equal(checkAmbiguity(reply, [RESOLVED]).ok, true);
});

test('a turn with no tool call at all is left alone', () => {
  // She is answering their own follow up about a list she already offered.
  assert.equal(checkAmbiguity(THE_REPLY, []).ok, true);
});

test('the shapes she actually used are the ones recognised', () => {
  assert.equal(claimsOne('There are several Richards on the sheet.'), true);
  assert.equal(claimsOne('That matches more than one person.'), true);
  assert.equal(claimsOne('Which one do you mean?'), true);
  assert.equal(claimsOne('Which of them did you want?'), true);
  assert.equal(claimsOne('Richard is on GBP 500 a month.'), false);
});
