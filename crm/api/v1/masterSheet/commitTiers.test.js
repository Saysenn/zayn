const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * ***************************************************
 * * Accepting ONLY the company statuses
 * ***************************************************
 *
 * The commit route returned early on an empty `accept` and so never reached
 * the tiers block below it: rejecting every deal change and ticking two
 * company statuses reported success and wrote nothing at all.
 *
 * TWO DECISIONS ON ONE SCREEN. An empty list of one says nothing about the
 * other, and neither may swallow the other's write.
 *
 * The route is mounted on a stub router with the two repos faked, so this
 * needs no database. What is pinned is the ORDER OF THE GUARDS, which is
 * the whole bug.
 */

// A tiny express-less harness: capture the handler the router registers.
function loadCommitHandler({ setTiers, syncUpsert }) {
  const path = require.resolve('../masterSheet.js');
  const repoPath = require.resolve('../repos/masterSheetRows.repo.js');
  const companiesPath = require.resolve('../repos/companies.repo.js');
  const socketsPath = require.resolve('../sockets/index.js');

  for (const p of [path, repoPath, companiesPath, socketsPath]) delete require.cache[p];

  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: new Proxy({ syncUpsert }, {
      get: (t, k) => (k in t ? t[k] : () => Promise.resolve([])),
    }),
  };
  require.cache[companiesPath] = {
    id: companiesPath,
    filename: companiesPath,
    loaded: true,
    exports: new Proxy({ setTiers }, {
      get: (t, k) => (k in t ? t[k] : () => Promise.resolve([])),
    }),
  };
  require.cache[socketsPath] = {
    id: socketsPath,
    filename: socketsPath,
    loaded: true,
    exports: { broadcast() {}, initSockets() {} },
  };

  const { router } = require(path);
  const layer = router.stack.find(
    (l) => l.route?.path === '/master-sheet/import/commit' && l.route.methods.post,
  );
  assert.ok(layer, 'the commit route must be registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function callCommit(handler, body) {
  let payload = null;
  let failure = null;
  const res = {
    json(p) { payload = p; return this; },
    status() { return this; },
  };
  await handler({ body }, res, (err) => { failure = err; });
  return { payload, failure };
}

const ROWS = [{ syncKey: 'nexus|ajrayson|admin|-|gloria' }];

test('accepting only the company statuses still writes them', async () => {
  const wrote = [];
  const handler = loadCommitHandler({
    setTiers: async (pairs) => { wrote.push(...pairs); },
    syncUpsert: async () => ({ written: 0, received: 0 }),
  });

  const { payload, failure } = await callCommit(handler, {
    rows: ROWS,
    columns: ['tier'],
    // EVERY DEAL CHANGE REJECTED. This is the case that wrote nothing.
    accept: [],
    companies: [
      { company: 'A J Rayson', tier: 'Top co' },
      { company: 'Nuvanta Resourcing', tier: 'Normal co' },
    ],
  });

  assert.equal(failure, null, failure && failure.message);
  assert.deepEqual(
    wrote.map((p) => [p.company, p.tier]),
    [['A J Rayson', 'Top co'], ['Nuvanta Resourcing', 'Normal co']],
  );
  assert.equal(payload.tiersWritten, 2);
  assert.equal(payload.written, 0, 'and no deal was written, which is what was asked');
});

test('the old group travels with the tier to the writer', async () => {
  const wrote = [];
  const handler = loadCommitHandler({
    setTiers: async (pairs) => { wrote.push(...pairs); },
    syncUpsert: async () => ({ written: 0, received: 0 }),
  });

  await callCommit(handler, {
    rows: ROWS,
    columns: ['tier'],
    accept: [],
    companies: [
      { company: 'Reliapay', tier: 'T1 with capilano', oldGroup: 'Wallaby 1' },
      // A file with no Old group column sends nothing for it. EMPTY, not
      // absent, so the writer can tell "he cleared it" from "not mentioned"
      // — the repo turns this into NULL and COALESCE keeps what is stored.
      { company: 'Gab', tier: 'Visa co' },
    ],
  });

  assert.deepEqual(wrote, [
    { company: 'Reliapay', tier: 'T1 with capilano', oldGroup: 'Wallaby 1' },
    { company: 'Gab', tier: 'Visa co', oldGroup: '' },
  ]);
});

test('rejecting everything, statuses included, is still not an error', async () => {
  let called = false;
  const handler = loadCommitHandler({
    setTiers: async () => { called = true; },
    syncUpsert: async () => ({ written: 0, received: 0 }),
  });

  const { payload, failure } = await callCommit(handler, {
    rows: ROWS, columns: ['tier'], accept: [], companies: [],
  });

  assert.equal(failure, null);
  assert.equal(called, false, 'nothing ticked means nothing written');
  assert.equal(payload.written, 0);
  assert.equal(payload.tiersWritten, 0);
});
