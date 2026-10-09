const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { unknownArgs, INJECTED } = require('./knownArgs');
const { masterSheetTools, ORDERING_KEYS } = require('./tools/masterSheet');

/**
 * ***************************************************
 * * A FILTER SHE DOES NOT HAVE IS REFUSED, NEVER IGNORED
 * ***************************************************
 *
 * Every handler spreads its arguments into a repo call and a repo
 * destructures the keys it knows, so a parameter that does not exist is
 * dropped in SILENCE. The query then runs unfiltered and the rows that come
 * back are the whole sheet, described as the answer to a narrower question:
 *
 *   filter_master_sheet({ location: 'Manchester' })  ->  all 96 rows
 *   "here are the rows in Manchester"
 *
 * Same fault as the missing `endWhen`, one layer down. She does not refuse
 * when a filter is absent; she reaches for something that exists.
 */

const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');
const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');

test('THE ACTUAL FAILURE: an invented filter is refused', () => {
  const out = unknownArgs(filter, { location: 'Manchester' });
  assert.ok(out, 'an invented filter was accepted and would be ignored');
  assert.match(out, /NOTHING WAS SEARCHED/);
  assert.match(out, /"location" is not a filter/);
});

test('IT NAMES WHAT SHE COULD HAVE USED, or she invents the same name again', () => {
  // `location` is reachable, through searchField. A bare refusal would
  // leave her with no second attempt.
  const out = unknownArgs(filter, { location: 'Manchester' });
  assert.match(out, /searchField/);

  // A near miss on a real name.
  assert.match(unknownArgs(filter, { method: 'cash' }), /paymentMethod/);
  assert.match(unknownArgs(filter, { end: 'soon' }), /endWhen/);
});

test('REAL ARGUMENTS PASS, every one of them', () => {
  // If this ever fails the guard has started refusing honest calls, which
  // is worse than the fault it prevents.
  for (const tool of masterSheetTools) {
    const real = Object.keys(tool.parameters?.properties ?? {});
    assert.equal(unknownArgs(tool, Object.fromEntries(real.map((k) => [k, 1]))), null, tool.name);
    assert.equal(unknownArgs(tool, {}), null, `${tool.name} refused an empty call`);
  }
});

test('THE INJECTED ONES PASS, because runAgent adds them and she cannot', () => {
  const injected = Object.fromEntries(INJECTED.map((k) => [k, 'x']));
  assert.equal(unknownArgs(filter, { group: 'INDIGO', ...injected }), null);
  // And the list is deliberate, not open ended.
  assert.deepEqual(INJECTED, ['said', 'saidRecent', 'priorAnswer', 'open', 'onProgress', 'turn', 'approvedNewGroup']);
});

test('a tool that declares NO parameters refuses nothing', () => {
  // `audit_master_sheet` and friends take none, and several are called with
  // an empty object.
  const none = masterSheetTools.find((t) => Object.keys(t.parameters?.properties ?? {}).length === 0);
  assert.ok(none, 'expected at least one tool with no parameters');
  assert.equal(unknownArgs(none, {}), null);
});

test('IT IS WIRED INTO runAgent, before the handler runs', () => {
  // Read as text: the check sits inside the tool loop, which needs a live
  // provider to exercise. Same approach as lengthRetry.test.js.
  const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  assert.match(SRC, /const refusal = unknownArgs\(tool, args\);/);
  assert.match(SRC, /if \(refusal\) \{/);
  // Refused, not run. A handler that ran would have already ignored it.
  assert.match(SRC, /return \{ summary: refusal \};/);
  // And it is evidence, so the Logs page has the invented filter.
  assert.match(SRC, /Diane used a filter that does not exist on/);
});

/* ===============================
 * * The sweep: the page's filters against her tools
 * =============================== */

test('SHE CAN REACH EVERY FILTER THE PAGE HAS', () => {
  // The page's own list, written here as a CONTRACT rather than imported:
  // crm/web and crm/api share no file. If the page gains a filter, this
  // list and her tool both change, and this test is what says so.
  //
  // From MasterSheetPage.jsx's useMasterSheet call.
  const PAGE_FILTERS = [
    'group', 'source', 'needsReview', 'status', 'shouldBePaid', 'paid',
    'presetWhen', 'amountField', 'amountMin', 'amountMax', 'q', 'searchField',
    'currency', 'paymentMethod',
  ];

  const hers = Object.keys(filter.parameters.properties);
  const missing = PAGE_FILTERS.filter((f) => !hers.includes(f));
  assert.deepEqual(missing, [], `the page can filter by these and she cannot: ${missing.join(', ')}`);
});

test('AND A TOTAL NARROWS THE SAME WAY A LIST DOES', () => {
  // "What are we paying the cash people in INDIGO" had no tool: the list
  // had seventeen ways to narrow and the figure had two. On a total, a
  // missing filter is money.
  const listing = Object.keys(filter.parameters.properties);
  const totalling = Object.keys(total.parameters.properties);

  // ORDERING IS NOT NARROWING: "lowest", "top 3" order the LIST. A total of
  // every deal does not change with the order it is added up in. 2026-10-03.
  const missing = listing.filter((k) => !totalling.includes(k) && !ORDERING_KEYS.includes(k));
  assert.deepEqual(missing, [], `the list can narrow by these and the total cannot: ${missing.join(', ')}`);
});

test('EVERY FILTER SHE HAS IS ONE THE REPO ACTUALLY READS', () => {
  // The other direction, and the quiet one: a parameter the repo does not
  // destructure is accepted, ignored, and answered as though it applied.
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'),
    'utf8',
  );
  const signature = SRC.slice(SRC.indexOf('async function findAll({'), SRC.indexOf('} = {}) {'));

  /**
   * CONSUMED BEFORE THE REPO EVER SEES IT, which is not the same as
   * ignored. `perGroup` turns `groups` into `group` and CLEARS it, so
   * `findAll` is never handed one.
   *
   * The exemption is only as good as that guarantee, so the guarantee is
   * pinned separately: `pluralAsks.test.js` asserts the wrapper hands its
   * inner handler `groups: undefined`. Nothing goes in this set without a
   * test proving the argument cannot reach the repo.
   */
  const HANDLED_BEFORE_THE_REPO = new Set(['groups', ...ORDERING_KEYS]);

  for (const key of Object.keys(filter.parameters.properties)) {
    if (HANDLED_BEFORE_THE_REPO.has(key)) continue;
    assert.match(
      signature,
      new RegExp(`\\b${key}\\b`),
      `filter_master_sheet offers "${key}" and repo.findAll never reads it`,
    );
  }
});

// 2026-09-28: "show me nexus deals" sent `q` to a tool that calls it `name`, was
// refused, and she asked the admin what Nexus is.
test('THE SEARCH WORD IS MOVED TO THE TOOL\'S OWN NAME FOR IT, never refused', () => {
  const { foldSearchWord } = require('./knownArgs');
  const tool = { parameters: { properties: { name: {}, groupName: {} } } };
  assert.deepEqual(foldSearchWord(tool, { q: 'nexus' }), { name: 'nexus' });
  // A tool that takes q keeps it; a name already given is not overwritten.
  assert.deepEqual(foldSearchWord({ parameters: { properties: { q: {}, name: {} } } }, { q: 'x' }), { q: 'x' });
  assert.deepEqual(foldSearchWord(tool, { q: 'x', name: 'y' }), { q: 'x', name: 'y' });
});

// THE GUARANTEE BEHIND THE ORDERING EXEMPTION above: the filter sorts and
// cuts in code, and the repo is never handed sortBy, sortOrder or limit.
test('ORDERING NEVER REACHES THE REPO, the filter sorts in code', async () => {
  const repo = require('../repos/masterSheetRows.repo');
  const real = repo.findAll;
  const seen = [];
  repo.findAll = async (args) => {
    seen.push(args);
    return {
      rows: [
        { id: 1, person_name: 'A', group_name: 'G', assigned_on: '2026-01-05' },
        { id: 2, person_name: 'B', group_name: 'G', assigned_on: '2026-03-01' },
      ],
      total: 2,
    };
  };
  try {
    const out = await filter.handler({ sortBy: 'assignedOn', sortOrder: 'lowest', limit: 1 });
    assert.match(out.reply, /\bA\b/);
    assert.ok(seen.length > 0, 'the repo was read');
    for (const args of seen) for (const key of ORDERING_KEYS) assert.ok(!(key in args), `${key} reached findAll`);
  } finally {
    repo.findAll = real;
  }
});
