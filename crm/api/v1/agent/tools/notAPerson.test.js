const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * "NEXUS" IS NOT A MISSING PERSON, IT IS A GROUP
 * ***************************************************
 *
 * Live transcript, twice in one session:
 *
 *   "There are no deals for Nexus on the master sheet. Would you like me
 *    to add a deal for Nexus?"
 *
 * NEXUS is a group with six rows. Offering to CREATE something that
 * already exists tells the boss his data is missing, which is the worst
 * reply available.
 */

function load() {
  const path = require.resolve('./notAPerson.js');
  const people = require.resolve('../../repos/people.repo.js');
  for (const p of [path, people]) delete require.cache[p];

  require.cache[people] = stub({
    async filterOptions() {
      return {
        groups: ['ALL GROUPS', 'INDIGO', 'MANBAT', 'MILKMAN', 'NEXUS'],
        companies: ['Workforce', 'Kryptonia', 'Gloria - Workforce', 'A J Rayson'],
      };
    },
  });
  return require(path).notAPerson;
}

test('a GROUP is named as a group, and nothing is offered to be added', async () => {
  const notAPerson = load();
  const out = await notAPerson('nexus');

  assert.match(out, /IS NOT A PERSON/);
  assert.match(out, /GROUP NEXUS/);
  assert.match(out, /do NOT offer to add anything/);
  assert.match(out, /Nothing is missing from the sheet/);
});

test('a COMPANY is named as a company', async () => {
  const notAPerson = load();
  assert.match(await notAPerson('Kryptonia'), /COMPANY Kryptonia/);
});

test('a TYPO still lands: "exus" reaches NEXUS', async () => {
  // Same session: "show me those paid in bank in exus" got "did you mean
  // EXUS?", echoing the typo back instead of matching the group.
  const notAPerson = load();
  const out = await notAPerson('exus');
  assert.match(out, /GROUP NEXUS/);
  assert.match(out, /do NOT offer to add anything/);
});

test('GUARDS THE GUARD: a real person is left alone', async () => {
  // "Gloria" sits inside the company "Gloria - Workforce" and is a real
  // handler. Matching on containment would tell somebody their own person
  // is a company, which is the same fault in the other direction.
  const notAPerson = load();
  for (const name of ['Gloria', 'Nathan', 'Zayn', 'Zzqqxx', '']) {
    assert.equal(await notAPerson(name), null, name || '(empty)');
  }
});

test('an AMBIGUOUS near match says nothing, so she asks', async () => {
  // Two candidates in reach is a real question, not a correction to make
  // on somebody's behalf.
  const notAPerson = load();
  // "MANBAT" and "MILKMAN" are both far from this; nothing should fire.
  assert.equal(await notAPerson('MAN'), null);
});
