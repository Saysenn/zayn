const test = require('node:test');
const assert = require('node:assert/strict');
const { readRequest, pickDeal, whichQuestion } = require('./resolveRequest');

/**
 * ***************************************************
 * * HIS SESSION, 2026-09-29, PINNED SENTENCE BY SENTENCE
 * ***************************************************
 *
 * Five failures in one conversation, each found live and each patched on
 * whichever door it happened to surface on. These are the sentences
 * themselves.
 *
 * THE POINT OF THIS FILE is that the next one is found HERE and not by him.
 * Every case below is a real thing he typed and the answer it should have
 * had; a new shape of request gets added to the list rather than argued
 * about after it has already moved somebody's money.
 *
 * No database: `readRequest` takes the sheet's own lists and `pickDeal`
 * takes the rows, so what a sentence MEANS can be asked without one.
 */

const OPTIONS = {
  groups: ['INDIGO', 'MILKMAN', 'NEXUS', 'MANBAT'],
  companies: ['Workforce', 'A J Rayson', 'Competex pro'],
  people: [
    { personId: 'zayn', name: 'Zayn' },
    { personId: 'gloria', name: 'Gloria' },
    { personId: 'mj', name: 'Milkman Jones' },
  ],
};

// His two real Zayn rows: ONE company, TWO groups. This pair is the whole
// reason "which company?" was the wrong question to ask.
const ZAYN = [
  { id: 1, person_name: 'Zayn', company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' },
  { id: 2, person_name: 'Zayn', company: 'Workforce', group_name: 'MILKMAN', role_label: 'Tech' },
];

// The master sheet's own row matcher, in the shape the write door injects.
const narrow = (rows, args) => {
  const want = [
    ['company', args.targetCompany],
    ['group_name', args.targetGroup],
    ['role_label', args.targetRole],
  ].filter(([, v]) => v);
  if (want.length === 0) return { rows, targeted: false, missing: null };
  const hit = rows.filter(
    (r) => want.every(([f, v]) => String(r[f]).toLowerCase() === String(v).toLowerCase()),
  );
  return {
    rows: hit,
    targeted: true,
    missing: hit.length === 0 ? want.map(([, v]) => v).join(', ') : null,
  };
};

const resolve = (args) => {
  const read = readRequest(args, OPTIONS);
  return { read, picked: pickDeal(ZAYN, { ...args, targetGroup: read.group }, narrow) };
};

/* ---- 1. "add 100 to zayn milkman" ---- */

test('A PERSON AND A GROUP GLUED INTO ONE ARGUMENT COME APART', () => {
  // She reported one of his own handlers missing: "I couldn't find anyone
  // named Zayn Milkman."
  const said = 'add 100 to zayn milkman';
  const { read, picked } = resolve({ targetPerson: 'Zayn Milkman', said, saidRecent: said });

  assert.equal(read.person, 'Zayn');
  assert.equal(read.group, 'MILKMAN');
  assert.equal(read.isChange, true);
  // AND IT RESOLVES TO ONE DEAL, so no chooser and no card.
  assert.equal(picked.deal?.id, 2, 'the MILKMAN one');
  assert.equal(picked.ask, undefined);
});

test('A WHOLE NAME IS NEVER TAKEN APART, even with a group inside it', () => {
  // Somebody really called Milkman Jones survives a group called MILKMAN.
  const { read } = resolve({ targetPerson: 'Milkman Jones', said: 'add 100 to milkman jones' });
  assert.equal(read.person, 'Milkman Jones');
  assert.equal(read.group, undefined);
});

test('AND A SCOPE HE PASSED HIMSELF IS NEVER OVERWRITTEN', () => {
  const { read } = resolve({
    targetPerson: 'Zayn Milkman', targetGroup: 'INDIGO', said: 'add 100 to zayn milkman',
  });
  assert.equal(read.group, 'INDIGO', 'his own scope wins, untouched');
});

/* ---- 2. "100 aed", the value handed back ---- */

test('A VALUE HANDED BACK KEEPS THE SCOPE FROM THE LINE BEFORE IT', () => {
  // "deduct 100 to zayn milkman", then asked what he meant, "100 aed".
  // The amount is on this line and the deal was on the one before it.
  const { read, picked } = resolve({
    targetPerson: 'Zayn',
    said: '100 aed',
    saidRecent: '100 aed\ndeduct 100 to zayn milkman',
  });
  assert.equal(read.group, 'MILKMAN');
  assert.equal(picked.deal?.id, 2);
});

test('AND IT IS STILL THE CHANGE HE ASKED FOR, not a new question', () => {
  // This is what drew every field of both deals: "100 aed" is no
  // imperative, and the instruction test only ever saw the last line.
  const { read } = resolve({
    targetPerson: 'Zayn', said: '100 aed', saidRecent: '100 aed\ndeduct 100 to zayn milkman',
  });
  assert.equal(read.isChange, true);
});

test('BUT A QUESTION ENDS IT, whatever came before', () => {
  const { read } = resolve({
    targetPerson: 'Zayn',
    said: 'what is his monthly?',
    saidRecent: 'what is his monthly?\ndeduct 100 to zayn milkman',
  });
  assert.equal(read.isChange, false, 'or a real question is answered with no card');
});

test('THIS TURN BEATS THE LAST ONE', () => {
  // Naming a different group MOVES the scope rather than fighting one two
  // turns old.
  const { read } = resolve({
    targetPerson: 'Zayn',
    said: 'the indigo one',
    saidRecent: 'the indigo one\ndeduct 100 to zayn milkman',
  });
  assert.equal(read.group, 'INDIGO');
});

/* ---- 3. "which company?" over two deals at the same company ---- */

test('IT ASKS ON THE FIELD THAT DIFFERS, never the one they share', () => {
  // "Zayn has 2 deals. Which company, or both?" Both are Workforce.
  const { picked } = resolve({ targetPerson: 'Zayn', said: 'add 100 to zayn' });

  assert.equal(picked.ask, 'which');
  assert.equal(picked.by, 'group', 'the company is what they SHARE');
  assert.equal(picked.rows.length, 2);
  // The list says both halves, or it reads as a list of groups.
  assert.equal(picked.where, 'Workforce in INDIGO; Workforce in MILKMAN');
  assert.match(whichQuestion('Zayn', picked), /ask which GROUP they mean/);
});

test('AND ASKS NOTHING ONCE THE REQUEST HAS NAMED ITS TARGET', () => {
  // A group or company he said IS the answer to "which one".
  const { picked } = resolve({
    targetPerson: 'Zayn', targetGroup: 'MILKMAN', said: 'add 100 to zayn in milkman',
  });
  assert.equal(picked.deal?.id, 2);
  assert.equal(picked.ask, undefined, 'asking again is a question with no work in it');
});

test('A NAMED TARGET THAT MATCHES NOTHING IS SAID, not treated as a typo', () => {
  const { picked } = resolve({
    targetPerson: 'Zayn', targetGroup: 'NEXUS', said: 'add 100 to zayn in nexus',
  });
  assert.equal(picked.ask, 'missing');
  assert.equal(picked.missing, 'NEXUS');
});

/* ---- 4. a COMPANY glued into the name, which is the riskier list ---- */

test('A PERSON AND A COMPANY COME APART TOO', () => {
  // "zayn workforce" is the same fault as "zayn milkman" with a different
  // list. It was left out of the first fix on purpose and is in now.
  const { read } = resolve({ targetPerson: 'Zayn Workforce', said: 'add 100 to zayn workforce' });
  assert.equal(read.person, 'Zayn');
  assert.equal(read.company, 'Workforce');
  assert.equal(read.group, undefined, 'a company is not a group');
});

test('BUT A COMPANY NAMED AFTER A PERSON IS NEVER TAKEN OUT', () => {
  // The reason companies needed a third guard the groups did not: on this
  // sheet a company can BE a handler's name. Splitting on that list would
  // take a real person apart.
  const options = {
    ...OPTIONS,
    companies: [...OPTIONS.companies, 'Gloria - Workforce'],
  };
  const read = readRequest({ targetPerson: 'Gloria - Workforce', said: 'add 100 to gloria' }, options);
  assert.equal(read.person, 'Gloria - Workforce', 'Gloria is a real handler');
  assert.equal(read.company, undefined);
});

test('AND A COMPANY HE PASSED HIMSELF IS NEVER OVERWRITTEN', () => {
  const { read } = resolve({
    targetPerson: 'Zayn Workforce', targetCompany: 'A J Rayson', said: 'add 100 to zayn workforce',
  });
  assert.equal(read.company, 'A J Rayson');
});

/* ---- and the shapes that must keep working ---- */

test('NO GROUP ANYWHERE LEAVES THE SCOPE ALONE', () => {
  const { read } = resolve({
    targetPerson: 'Zayn', said: 'add 100 to zayn', saidRecent: 'add 100 to zayn',
  });
  assert.equal(read.group, undefined);
});

test('TWO GROUPS IS A QUESTION, never a scope', () => {
  const { read } = resolve({ targetPerson: 'Zayn', said: 'add 100 to zayn in milkman and indigo' });
  assert.equal(read.group, undefined, 'one of them picked silently is the wrong deal');
});

test('A PERSON WITH ONE DEAL NEEDS NO QUESTION AT ALL', () => {
  assert.equal(pickDeal([ZAYN[0]], { said: 'add 100 to zayn' }, narrow).deal?.id, 1);
});

test('AND NOBODY AT ALL IS NOT A CHOOSER', () => {
  assert.equal(pickDeal([], { said: 'add 100 to nobody' }, narrow).ask, 'missing');
});

test('IT TAKES NO DATABASE AND HOLDS NO STATE', () => {
  // Called twice with the same request it answers the same. The turn's
  // bookkeeping belongs to the caller: this answers what they MEANT, which
  // does not depend on what happened last turn.
  const args = { targetPerson: 'Zayn Milkman', said: 'add 100 to zayn milkman' };
  assert.deepEqual(readRequest(args, OPTIONS), readRequest(args, OPTIONS));
});
