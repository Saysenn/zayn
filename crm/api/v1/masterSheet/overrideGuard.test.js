const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * The guard steps aside for a reviewed upload, and nowhere else
 * ***************************************************
 *
 * TWO MECHANISMS STOPPED AN UNWANTED OVERWRITE, and the invisible one ran
 * first: a column anybody had typed into was dropped from the diff, so the
 * modal that exists to ask never got to. A correction could never be
 * revisited and nothing said why.
 *
 * The rule now: a human decides ONCE. Either the diff asks or the guard
 * decides, and the diff wins wherever there is a human in the loop.
 *
 * `respectOverrides` defaults to TRUE, so a path that forgets it is safe.
 * Only the commit of a reviewed upload passes false.
 */

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const REPO = src('repos/masterSheetRows.repo.js');
const ROUTES = src('masterSheet.js');
const AGENT = src('agent.js');

test('the guard is ON unless a caller says otherwise', () => {
  assert.match(REPO, /respectOverrides = true/, 'defaulting to false would fail open');
});

test('the CASE is built only when the guard is on', () => {
  assert.match(REPO, /respectOverrides\s*\n?\s*\?\s*`\$\{c\} = CASE WHEN/);
  assert.match(REPO, /:\s*`\$\{c\} = EXCLUDED\.\$\{c\}`/);
});

test('ONLY the commit turns it off', () => {
  // One call site, and it is the one that runs after a human ticked each
  // cell beside the value it replaces.
  const offs = [...ROUTES.matchAll(/respectOverrides:\s*false/g)];
  assert.equal(offs.length, 1, 'exactly one path may skip the guard');

  const commit = ROUTES.slice(ROUTES.indexOf("router.post('/master-sheet/import/commit'"));
  assert.match(commit, /respectOverrides:\s*false/, 'and it is the commit');
});

test('the one-shot upload keeps the guard', () => {
  // It parses and writes with no preview, so there is no human to have
  // decided anything. It is slated for deletion; until then it is safe.
  const oneShot = ROUTES.slice(
    ROUTES.indexOf("router.post('/master-sheet/import'"),
    ROUTES.indexOf("router.post('/master-sheet/import/preview'"),
  );
  // `unrated`, not `rows`: the export writes rated figures, so an imported
  // one has its rates taken back off before anything stores it. See
  // masterSheet/reverseRates.
  assert.match(oneShot, /syncUpsert\(unrated, 'import', \{ columns \}\)/);
  assert.ok(!oneShot.includes('respectOverrides'), 'it must not opt out');
});

test("whatbot's sync keeps the guard", () => {
  // No human, no diff. The guard is the only thing between a sync and a
  // correction somebody typed in.
  assert.match(AGENT, /syncUpsert\(rows\.map\(fromAgentRow\), origin\)/);
  assert.ok(!AGENT.includes('respectOverrides'));
});

test('the change log follows the same flag', () => {
  // With the guard off a claimed column DOES change, so skipping it in the
  // log would write a change History cannot show and Undo cannot reach.
  assert.match(REPO, /if \(respectOverrides && claimed\.has\(col\)\) continue;/);
});

test('the preview fetches what each claimed field was set from', () => {
  assert.match(ROUTES, /repo\.claimedFieldEdits\(/);
  assert.match(ROUTES, /claims,/);
});

test('and that function actually EXISTS on the repo', async () => {
  // Matching the call site proved the route asks for it, not that anything
  // answers. It was written and never exported, so every upload died on
  // "repo.claimedFieldEdits is not a function" and lost the whole preview.
  // eslint-disable-next-line global-require
  const repo = require('../repos/masterSheetRows.repo');
  assert.equal(typeof repo.claimedFieldEdits, 'function');
  // No ids is no query, so this needs no database.
  const empty = await repo.claimedFieldEdits([]);
  assert.ok(empty instanceof Map);
  assert.equal(empty.size, 0);
});

test('every repo function a route calls is exported', () => {
  // The same class of fault, caught for all of them rather than one.
  // eslint-disable-next-line global-require
  const repo = require('../repos/masterSheetRows.repo');
  const called = new Set([...ROUTES.matchAll(/\brepo\.(\w+)\s*\(/g)].map((m) => m[1]));
  const missing = [...called].filter((fn) => typeof repo[fn] !== 'function');
  assert.deepEqual(missing, [], `masterSheet.js calls these and the repo has none: ${missing}`);
});

test('a claim is a HUMAN edit, never an upload', () => {
  // An upload writing a column is exactly what the claim resists, so
  // counting one would say "you set this by hand" about a value from a file.
  assert.match(REPO, /changed_via <> 'import'/);
  // One row per field: the latest edit is where the current value came from.
  assert.match(REPO, /SELECT DISTINCT ON \(row_id, field\)/);
});
