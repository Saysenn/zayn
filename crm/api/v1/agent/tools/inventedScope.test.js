const test = require('node:test');
const assert = require('node:assert/strict');
const peopleRepo = require('../../repos/people.repo');
const { notAGroup } = require('./notAGroup');

/**
 * ***************************************************
 * * A NAME THEY NEVER SAID IS ONE SHE INVENTED
 * ***************************************************
 *
 * Live transcript 2026-09-06. Asked "which group grows the most next
 * month?" she answered "The groups ALPHA, BETA, and GAMMA do not exist on
 * the sheet." Nobody said those words. She made three names up, queried
 * them, and handed the refusal back as though it were a finding. She also
 * never answered the question.
 */
const GROUPS = ['ALL GROUPS', 'INDIGO', 'MANBAT', 'MILKMAN', 'NEXUS'];

const withGroups = (run) => {
  const saved = peopleRepo.filterOptions;
  peopleRepo.filterOptions = async () => ({ groups: GROUPS, companies: [] });
  return Promise.resolve(run()).finally(() => { peopleRepo.filterOptions = saved; });
};

// ===============================
// * THE NAME ITSELF IS NOT IN THE CORRECTION
// ===============================
// It opened `YOU INVENTED THE GROUP "ALPHA"` and told her not to repeat it.
// Live 2026-09-07, asked "break that down by group", she read that for
// three invented names and answered "The groups ALPHA, BETA and GAMMA do
// not exist on the sheet". An instruction not to say a word, with the word
// supplied, is prompting doing a guard's job. She cannot echo what she was
// never handed.
test('a name the admin never said is withheld, not repeated back', () => withGroups(async () => {
  const out = await notAGroup('ALPHA', 'which group grows the most next month?');

  assert.doesNotMatch(out, /ALPHA/);
  assert.match(out, /THEY NEVER SAID IT/);
  assert.match(out, /Do NOT name it back/);
  // The real ones are still offered, so she can ask a useful question.
  assert.match(out, /INDIGO/);
}));

test('a name they DID say is a correction, not an accusation', () => withGroups(async () => {
  const out = await notAGroup('INDIG0', 'what is INDIG0 owed this month');

  assert.doesNotMatch(out, /YOU INVENTED/);
  assert.match(out, /There is NO GROUP called "INDIG0"/);
  // A near miss is offered and never applied.
  assert.match(out, /closest is "INDIGO"/);
}));

test('with no sentence to check against it stays the old correction', () => withGroups(async () => {
  const out = await notAGroup('ALPHA');
  assert.doesNotMatch(out, /YOU INVENTED/);
  assert.match(out, /There is NO GROUP called "ALPHA"/);
}));

test('a real group is never accused of anything', () => withGroups(async () => {
  assert.equal(await notAGroup('NEXUS', 'what about nexus'), null);
  assert.equal(await notAGroup('NEXUS', 'which group grows the most'), null);
}));
