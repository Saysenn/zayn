const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('./testing/stubRepos');

/**
 * ***************************************************
 * * A write that changes another page must say so
 * ***************************************************
 *
 * THE BUG. An add on or fee set on a person did not reach the Master Sheet
 * page until a hard refresh. Every deal row carries the person's two rates
 * so the cell can warn that the levels stack, and the PATCH broadcast
 * `people:changed` alone.
 *
 * The cache invalidation in usePeople covers the tab that made the edit.
 * This covers every OTHER tab and anyone else signed in, which is the half
 * no client-side hook can reach.
 */

function loadRoute({
  upsert = async (a) => ({ ...a, display_name: 'X' }),
  findById = async () => null,
} = {}) {
  const routePath = require.resolve('./people.js');
  const peoplePath = require.resolve('./repos/people.repo.js');
  const rowsPath = require.resolve('./repos/masterSheetRows.repo.js');
  const settingsPath = require.resolve('./repos/settings.repo.js');
  const socketsPath = require.resolve('./sockets/index.js');
  for (const p of [routePath, peoplePath, rowsPath, settingsPath, socketsPath]) delete require.cache[p];

  const sent = [];

  require.cache[peoplePath] = stub({ upsert, findById });
  require.cache[rowsPath] = stub({});
  require.cache[settingsPath] = stub({ get: async () => ({ color_uses_end_date: false }) });
  require.cache[socketsPath] = {
    id: 'x',
    filename: 'x',
    loaded: true,
    exports: { broadcast: (_room, event, payload) => sent.push({ event, payload }) },
  };

  const mod = require(routePath);
  return { router: mod.router ?? mod, sent };
}

function handlerFor(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} must be registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function patch(body) {
  const { router, sent } = loadRoute();
  const handler = handlerFor(router, 'patch', '/:personId');
  let failure = null;
  const res = { json() { return this; }, status() { return this; } };
  await handler({ params: { personId: 'gloria' }, query: {}, body }, res, (e) => { failure = e; });
  return { sent, failure, events: sent.map((s) => s.event) };
}

test('a rate change broadcasts for the MASTER SHEET as well as people', async () => {
  for (const body of [{ addonPercent: 5 }, { feePercent: 2 }, { addonPercent: 0, feePercent: 3 }]) {
    const { events, failure } = await patch(body);
    assert.equal(failure, null, JSON.stringify(body));
    assert.ok(events.includes('people:changed'), JSON.stringify(body));
    assert.ok(events.includes('master-sheet:changed'), `${JSON.stringify(body)} must reach the sheet`);
  }
});

test('setting a rate back to ZERO still broadcasts', async () => {
  // Removing a rate changes the sheet exactly as much as adding one, and 0
  // is falsy: a truthy check here would have left the warning on screen.
  const { events } = await patch({ addonPercent: 0 });
  assert.ok(events.includes('master-sheet:changed'));
});

test('an ordinary field broadcasts for people ONLY', async () => {
  const { events } = await patch({ notes: 'called him' });
  assert.deepEqual(events, ['people:changed'], 'a note changes nothing on the sheet');
});

test('both rates reach the repo, and the body cannot silently drop one', async () => {
  let got = null;
  const { router } = loadRoute({ upsert: async (a) => { got = a; return { display_name: 'X' }; } });
  const handler = handlerFor(router, 'patch', '/:personId');
  const res = { json() { return this; }, status() { return this; } };
  await handler(
    { params: { personId: 'gloria' }, query: {}, body: { addonPercent: 5, feePercent: 2 } },
    res, () => {},
  );
  assert.equal(got.addonPercent, 5);
  assert.equal(got.feePercent, 2);
});

test('each rate is validated under its OWN name', async () => {
  for (const [field, label] of [['addonPercent', 'Add on'], ['feePercent', 'Fee']]) {
    const { failure } = await patch({ [field]: 101 });
    assert.ok(failure, `${field} over 100 must be refused`);
    assert.match(failure.message, new RegExp(label), 'the message must name the right field');
  }
});

test('the person detail total is recalculated from preset days, not stored payable', async () => {
  const { router } = loadRoute({
    findById: async () => ({
      person_id: 'gloria',
      monthly_totals: { GBP: 99999 },
      deals: [{
        monthly_amount: 1000,
        payable_days: 15,
        payable_amount: 99999,
        currency: 'GBP',
        preset_on: '2026-09-01',
        payment_start_on: '2026-09-01',
      }],
    }),
  });
  const handler = handlerFor(router, 'get', '/:personId');
  let payload = null;
  await handler(
    { params: { personId: 'gloria' }, query: {}, body: {} },
    { json(p) { payload = p; return this; }, status() { return this; } },
    (e) => { throw e; },
  );

  assert.deepEqual(payload.person.monthly_totals, { GBP: 500 });
});
