const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('./testing/stubRepos');

/**
 * ***************************************************
 * * What the PATCH body is allowed to carry
 * ***************************************************
 *
 * A FIXED DESTRUCTURE THAT DID NOT GROW WITH ITS PAYLOAD has now caused
 * three faults: the payout template's `{ columns }` silently dropped the
 * end-date setting, the upload preview referenced `hasCompanyTable` it had
 * never pulled out, and this route would have ignored `oldGroup` while the
 * modal happily sent it and reported success.
 *
 * So the seam is pinned: what the body carries reaches the repo.
 */

function loadRoute({ update, findByKey, sent = [] }) {
  const routePath = require.resolve('./companies.js');
  const repoPath = require.resolve('./repos/companies.repo.js');
  const rowsPath = require.resolve('./repos/masterSheetRows.repo.js');
  const settingsPath = require.resolve('./repos/settings.repo.js');
  const socketsPath = require.resolve('./sockets/index.js');

  // THE CASCADE HELPER TOO. The route goes through it now, and it holds
  // its OWN reference to both repos: left cached it keeps real ones and
  // the stubs below are never reached.
  const helperPath = require.resolve('./shared/companyStatus.helper.js');
  for (const p of [routePath, helperPath, repoPath, rowsPath, settingsPath, socketsPath]) {
    delete require.cache[p];
  }


  require.cache[repoPath] = stub({
    update,
    findByKey,
    rename: async () => null,
    tiersInUse: async () => ['T2 for Reliapay'],
    oldGroups: async () => ['Milky', 'Wallaby 1'],
    findAll: async () => ({ rows: [], total: 0 }),
    // Explicit, not the Proxy fallback: that returns a PROMISE, which is
    // truthy, so every status would read as terminal.
    isTerminal: (status) => ['closed', 'dissolved'].includes(status),
    // Explicit for the same reason as isTerminal: the Proxy fallback hands
    // back a fresh promise per call, so two would never compare equal and
    // every status change would read as one that moved the review queue.
    isReviewedMonthly: (status) => status === 'liquidation',
    COMPANY_STATUS: {
      ACTIVE: 'active', LIQUIDATION: 'liquidation', DISSOLVED: 'dissolved', CLOSED: 'closed',
    },
  });
  require.cache[rowsPath] = stub({});
  require.cache[settingsPath] = stub({ get: async () => ({ color_uses_end_date: false }) });
  require.cache[socketsPath] = {
    id: 'x',
    filename: 'x',
    loaded: true,
    exports: { broadcast: (group, event, payload) => sent.push({ event, payload }) },
  };

  const { router } = require(routePath);
  return router;
}

function handlerFor(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} must be registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function call(handler, req) {
  let payload = null;
  let failure = null;
  const res = { json(p) { payload = p; return this; }, status() { return this; } };
  await handler({ params: {}, query: {}, body: {}, ...req }, res, (e) => { failure = e; });
  return { payload, failure };
}

// THE MONTH WE ARE IN: a fixed date stopped counting once the month turned.
const THIS_MONTH = `${require('./shared/presetMonth.helper').currentMonth()}-01`;
// 15 of this month's days of a 1000 monthly: 500 in a 30 day month, 483.87 in a 31.
const DAYS_NOW = new Date(Date.UTC(Number(THIS_MONTH.slice(0, 4)), Number(THIS_MONTH.slice(5, 7)), 0)).getUTCDate();
const HALF_MONTH = Math.round((1000 * 15 / DAYS_NOW) * 100) / 100;

test('oldGroup in the body reaches the repo', async () => {
  let got = null;
  const router = loadRoute({
    update: async (key, fields) => { got = { key, fields }; return { name: 'A J Rayson' }; },
    findByKey: async () => ({ name: 'A J Rayson' }),
  });

  const { failure } = await call(handlerFor(router, 'patch', '/companies/:key'), {
    params: { key: 'a j rayson' },
    body: { tier: 'T2 for Reliapay', oldGroup: 'Wallaby 1', notes: 'x' },
  });

  assert.equal(failure, null, failure && failure.message);
  assert.equal(got.fields.oldGroup, 'Wallaby 1');
  assert.equal(got.fields.tier, 'T2 for Reliapay');
});

test('a tier outside the seeded list is accepted, not rejected', async () => {
  // It was a closed set of two and this route 400'd on anything else, while
  // the upload's own writer validated nothing: a tier the CRM had stored
  // itself could not be edited by hand.
  let got = null;
  const router = loadRoute({
    update: async (key, fields) => { got = fields; return { name: 'Reliapay' }; },
    findByKey: async () => ({ name: 'Reliapay' }),
  });

  for (const tier of ['T2', 'TBC', 'Benched', 'In prep', 'T1 with capilano']) {
    const { failure } = await call(handlerFor(router, 'patch', '/companies/:key'), {
      params: { key: 'reliapay' }, body: { tier },
    });
    assert.equal(failure, null, `"${tier}" must be accepted`);
    assert.equal(got.tier, tier);
  }
});

test('an omitted field stays undefined, so a patch cannot blank what it did not mention', async () => {
  let got = null;
  const router = loadRoute({
    update: async (key, fields) => { got = fields; return { name: 'Gab' }; },
    findByKey: async () => ({ name: 'Gab' }),
  });

  await call(handlerFor(router, 'patch', '/companies/:key'), {
    params: { key: 'gab' }, body: { notes: 'just the notes' },
  });

  assert.equal(got.notes, 'just the notes');
  assert.equal(got.tier, undefined);
  assert.equal(got.oldGroup, undefined);
});

test('the detail route serves the suggestion lists both pickers need', async () => {
  const router = loadRoute({
    update: async () => ({}),
    findByKey: async () => ({ name: 'A J Rayson', tier: 'Top co', old_group: 'Milky' }),
  });

  const { payload } = await call(handlerFor(router, 'get', '/companies/:key'), {
    params: { key: 'a j rayson' },
  });

  // Seeded tiers PLUS what the sheet has actually written, so a kind he
  // invents next month is offered without anyone editing a list.
  assert.ok(payload.tiers.includes('Top co'));
  assert.ok(payload.tiers.includes('T2 for Reliapay'));
  assert.deepEqual(payload.oldGroups, ['Milky', 'Wallaby 1']);
});

test('the list route passes oldGroup through as a filter', async () => {
  let got = null;
  const router = loadRoute({ update: async () => ({}), findByKey: async () => ({}) });
  const repo = require.cache[require.resolve('./repos/companies.repo.js')].exports;
  repo.findAll = async (args) => { got = args; return { rows: [], total: 0 }; };

  await call(handlerFor(router, 'get', '/companies'), { query: { oldGroup: 'Milky' } });
  assert.equal(got.oldGroup, 'Milky');
});

test('the company detail total is recalculated from preset days, not stored payable', async () => {
  const router = loadRoute({
    update: async () => ({}),
    findByKey: async () => ({
      name: 'A J Rayson',
      monthly_totals: { GBP: 99999 },
      deals: [{
        monthly_amount: 1000,
        payable_days: 15,
        payable_amount: 99999,
        currency: 'GBP',
        preset_on: THIS_MONTH,
        payment_start_on: THIS_MONTH,
      }],
    }),
  });

  const { payload } = await call(handlerFor(router, 'get', '/companies/:key'), {
    params: { key: 'a j rayson' },
  });

  assert.deepEqual(payload.company.monthly_totals, { GBP: HALF_MONTH });
});

/**
 * ===============================
 * * LIQUIDATION MOVES THE REVIEW QUEUE, AND THE PAGES HAVE TO BE TOLD
 * ===============================
 * Every live deal on a company in liquidation joins the monthly review by
 * STATUS ALONE, with no row on tb_mastersheet changing. So the cascade
 * returns no deals, the checklist can return no changes, and both of the
 * things this route broadcast on stayed empty: the Review button kept its
 * old count until somebody reloaded. Reported 2026-09-21 on A J Rayson.
 */
test('ENTERING LIQUIDATION BROADCASTS, though it stops no deal', async () => {
  const sent = [];
  const router = loadRoute({
    sent,
    update: async () => ({ name: 'A J Rayson', status: 'liquidation' }),
    findByKey: async () => ({ name: 'A J Rayson', status: 'active' }),
  });

  await call(handlerFor(router, 'patch', '/companies/:key'), {
    params: { key: 'a j rayson' }, body: { status: 'liquidation' },
  });

  const toTheSheet = sent.filter((s) => s.event === 'master-sheet:changed');
  assert.equal(toTheSheet.length, 1, 'the Review button is never told the queue moved');
  assert.equal(toTheSheet[0].payload.action, 'company-status');
});

test('AND LEAVING IT BROADCASTS TOO, or the count never comes back down', async () => {
  const sent = [];
  const router = loadRoute({
    sent,
    update: async () => ({ name: 'A J Rayson', status: 'active' }),
    findByKey: async () => ({ name: 'A J Rayson', status: 'liquidation' }),
  });

  await call(handlerFor(router, 'patch', '/companies/:key'), {
    params: { key: 'a j rayson' }, body: { status: 'active' },
  });

  assert.equal(sent.filter((s) => s.event === 'master-sheet:changed').length, 1);
});

test('A NOTES EDIT BROADCASTS NOTHING TO THE SHEET', async () => {
  // The guard the two above must not trade away: a save that asks no
  // status question refreshes no other page.
  const sent = [];
  const router = loadRoute({
    sent,
    update: async () => ({ name: 'A J Rayson', status: 'liquidation' }),
    findByKey: async () => ({ name: 'A J Rayson', status: 'liquidation' }),
  });

  await call(handlerFor(router, 'patch', '/companies/:key'), {
    params: { key: 'a j rayson' }, body: { notes: 'just the notes' },
  });

  assert.deepEqual(sent.filter((s) => s.event === 'master-sheet:changed'), []);
});

test('AND SAVING LIQUIDATION AGAIN BROADCASTS NOTHING: the queue did not move', async () => {
  const sent = [];
  const router = loadRoute({
    sent,
    update: async () => ({ name: 'A J Rayson', status: 'liquidation' }),
    findByKey: async () => ({ name: 'A J Rayson', status: 'liquidation' }),
  });

  await call(handlerFor(router, 'patch', '/companies/:key'), {
    params: { key: 'a j rayson' }, body: { status: 'liquidation' },
  });

  assert.deepEqual(sent.filter((s) => s.event === 'master-sheet:changed'), []);
});
