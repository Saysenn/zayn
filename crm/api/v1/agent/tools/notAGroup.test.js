const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { masterSheetTools } = require('./masterSheet');
const { groupsMentionedIn } = require('./notAGroup');

/**
 * ***************************************************
 * * A ZERO FOR A GROUP THAT WAS NEVER REAL
 * ***************************************************
 *
 * Filter on a group the sheet does not have and SQL returns nothing, so
 * she says "nothing owed". Nothing owed is indistinguishable from a fact
 * about the business.
 *
 * This is the fault that bites on data nobody has seen: today's group names
 * are in her prompt and in the admin's head, and the first wrong answer
 * after a new sheet is a confident zero for a group that was renamed.
 *
 * The unit half needs `filterOptions`, so it is loaded with a stub. The
 * SOURCE half needs nothing and is the one that cannot rot: it reads every
 * tool that takes a group and fails when one of them can still report a
 * bare zero.
 */

/* ---- every group-taking tool must consult it ---- */

const propsOf = (tool) => tool.parameters?.properties ?? {};

// A WRITE does not report a zero, it refuses or it writes, and each already
// has its own confirmation path. Reads are what state a figure.
const WRITES = new Set([
  'bulk_update_master_sheet',
  'update_person',
  'undo_master_sheet_change',
  // It gained `group` and `company` when it learned to take NAMES instead
  // of a row id. Still a write, and its confirmation names every row.
  'delete_master_sheet_row',
]);

test('EVERY READ TOOL THAT TAKES A GROUP CHECKS THE GROUP IS REAL', () => {
  const sources = {
    'masterSheet.js': fs.readFileSync(require.resolve('./masterSheet.js'), 'utf8'),
    'recall.js': fs.readFileSync(require.resolve('./recall.js'), 'utf8'),
    'monthHistory.js': fs.readFileSync(require.resolve('./monthHistory.js'), 'utf8'),
    'historicalBreakdown.js': fs.readFileSync(require.resolve('./historicalBreakdown.js'), 'utf8'),
  };

  const takesGroup = masterSheetTools
    .filter((t) => propsOf(t).group && !WRITES.has(t.name))
    .map((t) => t.name);

  // The list itself is worth pinning: a tool that loses `group` silently
  // would make this test pass by covering nothing.
  assert.deepEqual(takesGroup.sort(), [
    'active_companies',
    'breakdown_master_sheet',
    'check_rates',
    'compare_months',
    'filter_master_sheet',
    'list_concerns',
    'recall_past_conversations',
    'total_master_sheet',
  ], 'the set of group-taking read tools changed');

  // MATCHED ON THE ACT. Every one of these lives in a file that must call
  // the guard; counting call sites is what catches a tool wired without it.
  const calls = Object.values(sources)
    .reduce((n, src) => n + (src.match(/await notAGroup\(/g) || []).length, 0);

  // The historical breakdown checks against the groups stored in that
  // month's immutable snapshot. Checking it against today's notAGroup list
  // would reject a group that was renamed after month close.
  assert.match(sources['historicalBreakdown.js'], /requestedGroups\(args, available\)/);
  assert.ok(
    calls >= takesGroup.length - 1,
    `${takesGroup.length - 1} live read tools need notAGroup and only ${calls} calls exist. `
    + 'The snapshot read has its own exact historical group guard.',
  );
});

test('both company read paths check that a zero is not an invented company', () => {
  const source = fs.readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  const guard = (source.match(/await notACompany\(/g) || []).length;
  const calls = (source.match(/await unknownCompanyFilter\(/g) || []).length;
  // THREE: the shared read guard, and the not-found paths of update_company
  // and rename_company, which asked no "did you mean" until 2026-09-30.
  assert.equal(guard, 3, 'the read guard plus the two single company writes');
  assert.ok(calls >= 2, `filter and total need the shared company guard; found ${calls} calls`);
});

/* ---- what it says, with the repo stubbed ---- */

const GROUPS = ['INDIGO', 'MILKMAN', 'NEXUS'];

function loadWith(options) {
  const repoPath = require.resolve('../../repos/people.repo');
  const guardPath = require.resolve('./notAGroup');
  const before = require.cache[repoPath];
  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: { filterOptions: async () => options } };
  delete require.cache[guardPath];
  const mod = require('./notAGroup');
  delete require.cache[guardPath];
  if (before) require.cache[repoPath] = before; else delete require.cache[repoPath];
  return mod;
}

test('a REAL group returns null, so a true zero keeps its real reason', () => {
  const { notAGroup } = loadWith({ groups: GROUPS, companies: [] });
  return notAGroup('INDIGO').then((out) => {
    assert.equal(out, null, 'claiming a real group is missing is the same fault reversed');
  });
});

test('an INVENTED group is named as not existing, and the real ones are listed', async () => {
  const { notAGroup } = loadWith({ groups: GROUPS, companies: [] });
  const out = await notAGroup('WALLABY 7');
  assert.match(out, /NO GROUP called "WALLABY 7"/);
  assert.match(out, /do NOT report a zero/);
  assert.match(out, /INDIGO, MILKMAN, NEXUS/);
});

// ***************************************************
// * A NAME SHE WAS NEVER HANDED CANNOT BE ECHOED
// ***************************************************
//
// Live 2026-09-07. "break that down by group" sent three invented names.
// The correction said `YOU INVENTED THE GROUP "ALPHA"` and told her not to
// repeat it; she answered "The groups ALPHA, BETA and GAMMA do not exist on
// the sheet". An instruction not to say a word, with the word supplied, is
// prompting doing a guard's job.
test('a name the admin never said is kept OUT of the correction', async () => {
  const { notAGroup } = loadWith({ groups: GROUPS, companies: [] });
  const out = await notAGroup('ALPHA', 'break that down by group');

  assert.doesNotMatch(out, /ALPHA/, 'she cannot echo what she was not given');
  assert.match(out, /THEY NEVER SAID IT/);
  assert.match(out, /Ask which they meant/);
  // The REAL ones still travel: the next question is built from them.
  assert.match(out, /INDIGO, MILKMAN, NEXUS/);
});

// And a name they DID say keeps it, because that is a typo to correct and
// the admin has to see which word was wrong.
test('a name the admin DID say is still quoted back', async () => {
  const { notAGroup } = loadWith({ groups: GROUPS, companies: [] });
  const out = await notAGroup('WALLABY 7', 'how did wallaby 7 do');
  assert.match(out, /NO GROUP called "WALLABY 7"/);
});

test('a near miss is OFFERED, never applied', async () => {
  const { notAGroup } = loadWith({ groups: GROUPS, companies: [] });
  const out = await notAGroup('INDIG0');
  assert.match(out, /closest is "INDIGO"/);
  assert.match(out, /Ask whether they meant/);
  // She cannot guess, structurally. The answer waits for the admin.
  assert.match(out, /answer\s+nothing until they say/);
});

test('several near misses ask WHICH, with the names exactly as written', async () => {
  const { notAGroup } = loadWith({ groups: ['MILKMAN 1', 'MILKMAN 2'], companies: [] });
  const out = await notAGroup('MILKMAN X');
  assert.match(out, /MILKMAN 1, MILKMAN 2/);
  assert.match(out, /Ask which one/);
});

test('NO LIST IS NOT AN EMPTY LIST, so an unreadable lookup stays silent', async () => {
  // It accused on this and turned every legitimate zero into "the sheet is
  // empty". Nothing to check against means silent, never guess.
  assert.equal(await loadWith({ groups: [], companies: [] }).notAGroup('INDIGO'), null);
  assert.equal(await loadWith({}).notAGroup('INDIGO'), null);
  assert.equal(await loadWith(null).notAGroup('INDIGO'), null);
});

test('a lookup that THROWS never breaks the read it was hinting about', async () => {
  const repoPath = require.resolve('../../repos/people.repo');
  const guardPath = require.resolve('./notAGroup');
  const before = require.cache[repoPath];
  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: { filterOptions: async () => { throw new Error('db down'); } },
  };
  delete require.cache[guardPath];
  const { notAGroup } = require('./notAGroup');
  delete require.cache[guardPath];
  if (before) require.cache[repoPath] = before; else delete require.cache[repoPath];

  assert.equal(await notAGroup('INDIGO'), null);
});

test('a long list REPORTS that it cut, because a cap you cannot see is the bug', async () => {
  const many = Array.from({ length: 60 }, (_, i) => `G${i}`);
  const { notAGroup, NAMED_MAX } = loadWith({ groups: many, companies: [] });
  const out = await notAGroup('NOPE');
  assert.match(out, new RegExp(`${NAMED_MAX} of ${many.length} listed`));
});

test('a blank name is not a missing group', async () => {
  const { notAGroup } = loadWith({ groups: GROUPS, companies: [] });
  assert.equal(await notAGroup(''), null);
  assert.equal(await notAGroup(null), null);
});

test('companies get the identical treatment', async () => {
  const { notACompany } = loadWith({ groups: [], companies: ['Acqua', 'Leadstone'] });
  assert.equal(await notACompany('Acqua'), null);
  assert.match(await notACompany('Zzzz'), /NO COMPANY called "Zzzz"/);
});

test('deal scope checks groups before treating the name as a company', async () => {
  const { resolveDealScope } = loadWith({
    groups: GROUPS,
    companies: ['Acqua resourcing', 'Workforce'],
  });
  const out = await resolveDealScope({ company: ['Nexus'], said: 'show me all nexus deals' });

  assert.equal(out.question, null);
  assert.equal(out.args.group, 'NEXUS');
  assert.equal(out.args.company, undefined);
});

test('the same group-first rule repairs a free-text deal lookup', async () => {
  const { resolveDealScope } = loadWith({ groups: GROUPS, companies: ['Workforce'] });
  const out = await resolveDealScope({ q: 'Nexus', said: 'show me all nexus deals' });

  assert.equal(out.args.group, 'NEXUS');
  assert.equal(out.args.q, undefined);
});

test('a name shared by a group and company asks which scope they mean', async () => {
  const { resolveDealScope } = loadWith({ groups: ['NEXUS'], companies: ['Nexus'] });
  const out = await resolveDealScope({ company: ['Nexus'], said: 'show me nexus deals' });

  assert.match(out.question, /group or the company/i);
  assert.equal(out.args, null);
});

test('saying group or company resolves a shared scope without asking', async () => {
  const { resolveDealScope } = loadWith({ groups: ['NEXUS'], companies: ['Nexus'] });

  const group = await resolveDealScope({ company: ['Nexus Group'], said: 'show me the nexus group deals' });
  assert.equal(group.args.group, 'NEXUS');
  assert.equal(group.args.company, undefined);

  const company = await resolveDealScope({ company: ['Nexus'], said: 'show me the nexus company deals' });
  assert.deepEqual(company.args.company, ['Nexus']);
  assert.equal(company.args.group, undefined);
});

test('the admin exact group name outranks a different valid model argument', async () => {
  const { exactGroupsMentioned } = loadWith({ groups: ['MANBAT', 'MILKMAN'], companies: [] });
  assert.deepEqual(await exactGroupsMentioned('how much does the MANBAT group owe?'), ['MANBAT']);
});

test('the literal ALL GROUPS name stays distinct from every group', async () => {
  const groups = ['ALL GROUPS', 'INDIGO'];
  assert.deepEqual(groupsMentionedIn('show every group', groups), []);
  assert.deepEqual(groupsMentionedIn('show the all group breakdown', groups), ['ALL GROUPS']);
});

test('both deal-list and total paths use the shared scope resolver', () => {
  const source = fs.readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  const calls = source.match(/await resolveDealScope\(/g) ?? [];
  assert.ok(calls.length >= 2, 'filter and total must both resolve group versus company');
});

/**
 * ===============================
 * * A PLURAL FILTER REACHED A CHECK WRITTEN FOR ONE NAME
 * ===============================
 * Live 2026-09-24. `group` is plural, so a list arrived as an ARRAY and
 * "MILKMAN,MANBAT" folded to "milkmanmanbat": a name that exists nowhere.
 * The correction said the group was missing and listed the real ones, and
 * she relayed it as:
 *
 *   "You mentioned MILKMAN and MANBAT groups, but only MANBAT and MILKMAN
 *    exist exactly like that."
 *
 * A sentence saying the same two names both do and do not exist.
 */
test('TWO REAL GROUPS SAY NOTHING, exactly as one real group does', async () => {
  const { notAGroup } = loadWith({ groups: ['MILKMAN', 'MANBAT', 'INDIGO'], companies: [] });
  assert.equal(await notAGroup(['MILKMAN', 'MANBAT'], 'the milkman and manbat deals'), null);
});

test('one real and one fake answers for the FAKE one', async () => {
  const { notAGroup } = loadWith({ groups: ['MILKMAN', 'MANBAT'], companies: [] });
  const out = await notAGroup(['MILKMAN', 'ALPHA'], 'milkman and alpha');
  assert.ok(out);
  assert.match(out, /ALPHA/);
  assert.doesNotMatch(out, /MILKMAN"/, 'it accused a group that exists');
});

test('a list of one behaves exactly like a bare string', async () => {
  const { notAGroup } = loadWith({ groups: ['MILKMAN'], companies: [] });
  assert.equal(await notAGroup(['MILKMAN'], 'milkman'), null);
  assert.ok(await notAGroup(['ALPHA'], 'alpha'));
});

// "what is the total for ZZTEST this month" came back for the whole sheet: the
// group was in the sentence and not in the call. 2026-09-28.
test('A GROUP NAMED IN THE SENTENCE AND DROPPED FROM THE CALL IS PUT BACK', async () => {
  const { resolveDealScope } = loadWith({ groups: ['ZZTEST', 'MILKMAN'], companies: [] });
  const out = await resolveDealScope({ said: 'what is the total for ZZTEST this month?' });
  assert.equal(out.args.group, 'ZZTEST');
  // Two groups is not one: left as sent, because picking one silently is
  // the wrong answer dressed as a narrower one.
  const two = await resolveDealScope({ said: 'total for ZZTEST and MILKMAN' });
  assert.equal(two.args.group, undefined);

  /**
   * ===============================
   * * AND A PERSON DOES NOT MAKE THE GROUP REDUNDANT
   * ===============================
   * This used to assert `undefined` here, on the reasoning that "a person
   * already scopes it". His session on 2026-09-29 is the counter example:
   * Zayn holds two deals at the SAME company in two different groups, so
   * the person scopes nothing at all and the group is the only thing that
   * tells them apart.
   *
   * They said "in ZZTEST", so ZZTEST is the answer to a question the tool
   * would otherwise have to ask. `readRequest` puts it back for every
   * door, read and write alike.
   */
  const person = await resolveDealScope({ person: 'Suki', said: 'what does Suki get in ZZTEST' });
  assert.equal(person.args.group, 'ZZTEST');
  assert.equal(person.args.person, 'Suki', 'and their name is untouched');
});

test('THE GROUP REPEATED AS A COMPANY IS DROPPED, not refused as a missing company', async () => {
  const { resolveDealScope } = loadWith({ groups: ['ZZTEST'], companies: ['ZZ Rate Co A'] });
  const out = await resolveDealScope({ group: 'ZZTEST', company: ['ZZTEST'], said: 'total for ZZTEST' });
  assert.equal(out.args.group, 'ZZTEST');
  assert.equal(out.args.company, undefined);
  // A real company beside it stays.
  const both = await resolveDealScope({ group: 'ZZTEST', company: ['ZZTEST', 'ZZ Rate Co A'], said: 'x' });
  assert.deepEqual(both.args.company, ['ZZ Rate Co A']);
});

// 2026-09-28: "milman total last august" answered for the whole sheet.
test('A ONE LETTER SLIP IN A GROUP NAME IS THAT GROUP, when no other is as close', async () => {
  const { resolveDealScope } = loadWith({ groups: ['MILKMAN', 'MANBAT', 'NEXUS'], companies: [] });
  const out = await resolveDealScope({ said: 'milman total last august' });
  assert.equal(out.args.group, 'MILKMAN');
  // Two letters out is not a slip, and a short word never is.
  const far = await resolveDealScope({ said: 'milmun totl last august' });
  assert.equal(far.args.group, undefined);
});

test('ONE DEFINITION OF A GROUP NAMED, and the month path reads it', () => {
  const { groupsHeardIn } = require('./notAGroup');
  assert.deepEqual(groupsHeardIn('milman total last august', ['MILKMAN', 'MANBAT']), ['MILKMAN']);
  assert.deepEqual(groupsHeardIn('milkman total', ['MILKMAN', 'MANBAT']), ['MILKMAN']);
  const src = fs.readFileSync(require.resolve('./monthHistory'), 'utf8');
  assert.match(src, /const heard = await groupsHeard\(args\.said\);/, 'the month path drops only a group nobody named');
});

// 2026-09-28: she SENT group "milman"; it matched nothing and was dropped.
test('A SENT GROUP ONE SLIP FROM A REAL ONE IS THE REAL ONE', async () => {
  const { resolveDealScope } = loadWith({ groups: ['MILKMAN', 'MANBAT'], companies: [] });
  const out = await resolveDealScope({ group: 'milman', said: 'milman total last august' });
  assert.equal(out.args.group, 'MILKMAN');
});

// 2026-09-28: "milman total last august" sent company "milman" and answered "For milman".
test('A GROUP ONE SLIP AWAY, SENT AS A COMPANY, IS THE GROUP', async () => {
  const { resolveDealScope } = loadWith({ groups: ['MILKMAN', 'NEXUS'], companies: ['Acqua'] });
  const out = await resolveDealScope({ company: ['milman'], said: 'total for milman company last august' });
  assert.equal(out.args.group, 'MILKMAN');
  assert.equal(out.args.company, undefined);
  // A real company of that spelling stays the company.
  const { resolveDealScope: real } = loadWith({ groups: ['MILKMAN'], companies: ['Milman'] });
  const kept = await real({ company: ['Milman'], said: 'total for milman company' });
  assert.deepEqual(kept.args.company, ['Milman']);
  assert.equal(kept.args.group, undefined);
});

// 2026-09-28: the same sentence arrived again as person "milman".
test('A GROUP SENT AS A PERSON NOBODY IS, IS THE GROUP THEY NAMED', async () => {
  const people = [{ personId: 1, name: 'Gloria Hart' }];
  const { resolveDealScope } = loadWith({ groups: ['MILKMAN', 'NEXUS'], companies: [], people });
  const out = await resolveDealScope({ person: 'milman', said: 'milman total last august' });
  assert.equal(out.args.group, 'MILKMAN');
  assert.equal(out.args.person, undefined);
  // A real person the word reaches keeps it.
  const { resolveDealScope: real } = loadWith({ groups: ['MILKMAN'], companies: [], people: [{ personId: 2, name: 'Nat Milmann' }] });
  assert.equal((await real({ person: 'milman', said: 'milman total last august' })).args.person, 'milman');
  // A person their sentence names as no group is left alone.
  assert.equal((await resolveDealScope({ person: 'Gloria', said: 'gloria total' })).args.person, 'Gloria');
});

/**
 * ***************************************************
 * * A PERSON AND THEIR GROUP GLUED INTO ONE ARGUMENT
 * ***************************************************
 *
 * Live 2026-09-29. "add 100 to zayn milkman" arrived as person
 * "Zayn Milkman", nobody is called that, and she told the admin one of his
 * own handlers did not exist. "zayn from milkman" in the next breath
 * worked, because the preposition kept the two words apart.
 */

const PEOPLE = [
  { personId: 'zayn', name: 'Zayn' },
  { personId: 'ajr', name: 'Anthony Wareham' },
  { personId: 'mk', name: 'Milkman Jones' },
];

const withRoster = (extra = {}) => loadWith({ groups: GROUPS, companies: [], people: PEOPLE, ...extra });

test('A PERSON AND A GROUP IN ONE VALUE COME APART', () => {
  const { splitPersonAndGroup } = withRoster();
  assert.deepEqual(
    splitPersonAndGroup('Zayn Milkman', { groups: GROUPS, people: PEOPLE }),
    { person: 'Zayn', group: 'MILKMAN' },
  );
  // Either order, and the case is the sheet's, never what they typed.
  assert.deepEqual(
    splitPersonAndGroup('milkman zayn', { groups: GROUPS, people: PEOPLE }),
    { person: 'zayn', group: 'MILKMAN' },
  );
});

test('AND BOTH HALVES HAVE TO BE REAL, or nothing is split', () => {
  const { splitPersonAndGroup } = withRoster();
  const options = { groups: GROUPS, people: PEOPLE };
  // A group with nobody attached is `personSentAsGroup`'s case, not this one.
  assert.equal(splitPersonAndGroup('MILKMAN', options), null);
  // A remainder nobody is called is not a person, so the value stands.
  assert.equal(splitPersonAndGroup('Quentin Milkman', options), null);
  // No group in it at all.
  assert.equal(splitPersonAndGroup('Zayn', options), null);
  // Two groups is a question, never a split.
  assert.equal(splitPersonAndGroup('Zayn MILKMAN NEXUS', options), null);
});

test('A WHOLE NAME IS NEVER SPLIT, even with a group name inside it', () => {
  // Somebody really called Milkman Jones must survive a group called
  // MILKMAN. They were precise; taking their name apart is the same fault
  // as inventing one.
  const { splitPersonAndGroup } = withRoster();
  assert.equal(
    splitPersonAndGroup('Milkman Jones', { groups: GROUPS, people: PEOPLE }),
    null,
  );
});

test('THE SCOPE RESOLVER APPLIES IT, so the search never sees the glued value', async () => {
  const { resolveDealScope } = withRoster();
  const { args } = await resolveDealScope({ person: 'Zayn Milkman', said: 'add 100 to zayn milkman' });
  assert.equal(args.person, 'Zayn');
  assert.equal(args.group, 'MILKMAN');
});

test('AND A GROUP THEY ALREADY PASSED IS NEVER OVERWRITTEN', async () => {
  const { resolveDealScope } = withRoster();
  const { args } = await resolveDealScope({ person: 'Zayn Milkman', group: 'INDIGO', said: 'x' });
  assert.equal(args.group, 'INDIGO');
  assert.equal(args.person, 'Zayn Milkman', 'their own scope wins, untouched');
});

test('NOT A PERSON SAYS WHAT THE TWO HALVES ARE, rather than reporting a gap', async () => {
  const { notAPerson } = (() => {
    const repoPath = require.resolve('../../repos/people.repo');
    const before = require.cache[repoPath];
    require.cache[repoPath] = {
      id: repoPath,
      filename: repoPath,
      loaded: true,
      exports: { filterOptions: async () => ({ groups: GROUPS, companies: [], people: PEOPLE }) },
    };
    for (const p of [require.resolve('./notAPerson'), require.resolve('./notAGroup')]) delete require.cache[p];
    const mod = require('./notAPerson');
    for (const p of [require.resolve('./notAPerson'), require.resolve('./notAGroup')]) delete require.cache[p];
    if (before) require.cache[repoPath] = before; else delete require.cache[repoPath];
    return mod;
  })();

  const out = await notAPerson('Zayn Milkman');
  assert.match(out, /IS TWO THINGS/);
  assert.match(out, /person Zayn/);
  assert.match(out, /GROUP MILKMAN/);
  // The whole point: she must not report a missing handler.
  assert.match(out, /Do NOT say anyone was not found/);
});
