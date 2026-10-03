const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDashboard,
  parseFilters,
  snapshotDrivers,
  FORECAST_HORIZON_OPTIONS,
} = require('./buildDashboard');

const CURRENT_MONTH = '2026-09';

function snapshot(month, amount, net = amount, overrides = {}) {
  return {
    month,
    taken_at: `${month}-30T23:00:00.000Z`,
    row_count: 1,
    rows: [{
      id: 1,
      sync_key: 'g1-company-role-seat-person-1',
      person_id: 'person-1',
      person_name: 'Alex',
      group_name: 'G1',
      company: 'Company One',
      payment_method: 'bank',
      monthly_amount: 999999,
      payable_amount: 999999,
      ...overrides.row,
    }],
    totals: {
      net: { GBP: net },
      deals: [{
        id: 1,
        personId: 'person-1',
        personName: 'Alex',
        company: 'Company One',
        group: 'G1',
        role: 'Director',
        currency: 'GBP',
        amount,
        addon: net - amount,
        crypto: 0,
        fee: 0,
        net,
        ...overrides.deal,
      }],
      fx: { usdPerGbp: 2, perUsd: { GBP: 0.5 }, source: 'saved', asOf: '2026-08-31' },
      ...overrides.totals,
    },
  };
}

function dependencies({ snapshots = [], rows, openPairs = [] } = {}) {
  const liveRows = rows ?? [{
    id: 1,
    person_id: 'person-1',
    person_name: 'Alex',
    group_name: 'G1',
    company: 'Company One',
    role_label: 'Director',
    payment_method: 'bank',
    currency: 'GBP',
    monthly_amount: 310,
    payable_amount: 100,
    payable_days: 30,
    payment_start_on: '2026-09-01',
    preset_on: '2026-09-01',
  }];
  const calls = { snapshotMonths: null, changeArgs: null };
  return {
    calls,
    values: {
      currentMonth: CURRENT_MONTH,
      rowsRepo: {
        findAllRows: async () => liveRows,
        findFieldChanges: async (args) => {
          calls.changeArgs = args;
          return { total: 1, rows: [{
            id: 9,
            row_id: 1,
            person_name: 'Alex',
            company: 'Company One',
            group_name: 'G1',
            field: 'monthlyAmount',
            old_value: '90',
            new_value: '100',
            changed_via: 'admin',
            changed_at: '2026-09-03T10:00:00.000Z',
            row_exists: true,
            person_id: 'person-1',
          }] };
        },
      },
      snapshotsRepo: {
        findMany: async (months) => {
          calls.snapshotMonths = months;
          return snapshots.filter((item) => months.includes(item.month));
        },
      },
      settingsRepo: { get: async () => ({ color_uses_end_date: false, crypto_percent: 0 }) },
      peopleRepo: { rateMap: async () => new Map([['person-1', { addon: 10, fee: 0 }]]) },
      concernsRepo: { listOpenPairs: async () => openPairs },
      fxRates: {
        usdPerGbp: async () => ({ usdPerGbp: 1.5, perUsd: { GBP: 2 / 3 }, source: 'live', asOf: 'today' }),
      },
    },
  };
}

test('saved actuals stay frozen while live and forecast points use their own contracts', async () => {
  const deps = dependencies({
    snapshots: [snapshot('2026-07', 50, 55), snapshot('2026-08', 70, 77)],
    openPairs: [{ person_id: 'person-1', group_name: 'G1' }],
  });
  const result = await buildDashboard({
    range: 'custom',
    fromMonth: '2026-08',
    toMonth: '2026-10',
    month: '2026-08',
    group: 'G1',
    company: 'Company One',
    person: 'person-1',
    paymentMethod: 'bank',
    currencyMode: 'usd',
    q: 'monthly',
    page: '1',
    pageSize: '10',
  }, deps.values);

  assert.deepEqual(result.timeline.map((point) => [point.month, point.source]), [
    ['2026-08', 'savedActual'],
    ['2026-09', 'liveEstimate'],
    ['2026-10', 'projectedForecast'],
  ]);
  assert.deepEqual(result.timeline.map((point) => point.sourceLabel), [
    'Saved actual', 'Live estimate', 'Projected forecast',
  ]);
  assert.deepEqual(result.timeline[0].totals.native, [{ currency: 'GBP', amount: 77 }]);
  assert.equal(result.timeline[0].totals.normalizedUsd.amount, 154);
  assert.deepEqual(result.timeline[1].totals.native, [{ currency: 'GBP', amount: 110 }]);
  assert.equal(result.timeline[1].totals.normalizedUsd.amount, 165);
  assert.deepEqual(result.timeline[2].totals.native, [{ currency: 'GBP', amount: 341 }]);
  assert.equal(result.timeline[2].totals.normalizedUsd.amount, 511.5);

  assert.equal(result.timeline[0].changeDrivers.available, true);
  assert.deepEqual(result.timeline[0].changeDrivers.changed.map((deal) => ({
    was: deal.was,
    now: deal.now,
  })), [{ was: 55, now: 77 }]);
  assert.deepEqual(result.groupTotals.map(({ group, deals, totals }) => ({ group, deals, totals })), [{
    group: 'G1', deals: 1, totals: result.timeline[0].totals,
  }]);
  // groupTotals carries the SAME comparison groupPayments computed, never a
  // second one. Two answers to "is this group up on last month" is how the
  // panel and the modal beside it disagreed.
  assert.deepEqual(result.groupTotals[0].comparison, result.groupPayments[0].comparison);
  assert.equal(result.groupTotals[0].comparison.available, true);
  assert.deepEqual(result.paymentMethodSplit, [{
    paymentMethod: 'bank', deals: 1, totals: result.timeline[0].totals,
  }]);
  assert.deepEqual(result.kpis, {
    liveMonth: '2026-09',
    liveDeals: 1,
    distinctPeople: 1,
    distinctCompanies: 1,
    monthlyPayable: {
      month: '2026-08',
      source: 'savedActual',
      sourceLabel: 'Saved actual',
      ...result.timeline[0].totals,
    },
    openFlaggedCount: 1,
  });
  assert.deepEqual(deps.calls.snapshotMonths, ['2026-07', '2026-08']);
  assert.deepEqual(deps.calls.changeArgs.rowIds, [1]);
  assert.equal(result.recentChanges.rows[0].changedVia, 'admin');
  assert.equal(result.recentChanges.rows[0].personId, 'person-1');
  assert.equal(result.recentChanges.total, 1);
  assert.equal(result.recentChanges.q, 'monthly');
  assert.equal(deps.calls.changeArgs.q, 'monthly');
  assert.equal(deps.calls.changeArgs.offset, 0);
  assert.equal(deps.calls.changeArgs.withTotal, true);
  assert.deepEqual(result.filters.options.months.map((option) => option.source), [
    'savedActual', 'liveEstimate', 'projectedForecast',
  ]);
  assert.equal(result.snapshotHealth.status, 'healthy');
});

test('a missing historical month is unavailable and is never estimated from live rows', async () => {
  const deps = dependencies();
  const result = await buildDashboard({
    range: 'custom', fromMonth: '2026-08', toMonth: '2026-09',
  }, deps.values);

  assert.deepEqual(result.timeline[0], {
    month: '2026-08',
    source: 'unavailable',
    sourceLabel: 'Unavailable',
    totals: { native: [] },
    reason: 'No saved snapshot',
  });
  assert.deepEqual(result.snapshotHealth.missingMonths, ['2026-08']);
  assert.equal(result.snapshotHealth.status, 'unavailable');
});

test('USD normalization is omitted when any native currency has no valid rate', async () => {
  const deps = dependencies({ rows: [{
    id: 2,
    person_id: 'person-2',
    person_name: 'Bailey',
    group_name: 'G2',
    company: 'Company Two',
    payment_method: 'cash',
    currency: 'XYZ',
    monthly_amount: 20,
    payable_amount: 20,
    preset_on: '2026-09-01',
  }] });
  const result = await buildDashboard({
    range: 'custom', fromMonth: '2026-09', toMonth: '2026-09', currencyMode: 'usd',
  }, deps.values);

  assert.deepEqual(result.kpis.monthlyPayable.native, [{ currency: 'XYZ', amount: 20 }]);
  assert.equal('normalizedUsd' in result.kpis.monthlyPayable, false);
  assert.deepEqual(result.kpis.monthlyPayable.normalization, {
    status: 'unavailable',
    missingCurrencies: ['XYZ'],
  });
});

test('USD mode keeps a valid converted subtotal and names missing currencies', async () => {
  const deps = dependencies({ rows: [
    {
      id: 1,
      person_id: 'person-1',
      person_name: 'Alex',
      group_name: 'G1',
      company: 'Company One',
      payment_method: 'bank',
      currency: 'GBP',
      monthly_amount: 100,
      payable_amount: 100,
      preset_on: '2026-09-01',
    },
    {
      id: 2,
      person_id: 'person-2',
      person_name: 'Bailey',
      group_name: 'G2',
      company: 'Company Two',
      payment_method: 'cash',
      currency: 'XYZ',
      monthly_amount: 20,
      payable_amount: 20,
      preset_on: '2026-09-01',
    },
  ] });
  const result = await buildDashboard({
    range: 'custom', fromMonth: '2026-09', toMonth: '2026-09', currencyMode: 'usd',
  }, deps.values);

  assert.deepEqual(result.kpis.monthlyPayable.normalizedUsd, {
    amount: 165,
    source: 'live',
    asOf: 'today',
    partial: true,
  });
  assert.deepEqual(result.kpis.monthlyPayable.normalization, {
    status: 'partial',
    missingCurrencies: ['XYZ'],
  });
});

test('a deal that is added, and one whose ROW is gone, by stored stable identity', () => {
  const before = snapshot('2026-07', 50, 50);
  const after = snapshot('2026-08', 80, 80, {
    row: { id: 2, sync_key: 'new-deal' },
    deal: { id: 2, personId: 'person-2', personName: 'Bailey' },
  });
  const filters = parseFilters({
    range: 'custom', fromMonth: '2026-07', toMonth: '2026-09',
  }, CURRENT_MONTH);
  const drivers = snapshotDrivers(before, after, filters);

  assert.equal(drivers.available, true);
  assert.deepEqual(drivers.added.map((deal) => deal.key), ['sync:new-deal']);
  // REMOVED, not ended. The fixture takes the row off the sheet entirely,
  // and this used to be reported as an ending, which is a different fact.
  assert.deepEqual(drivers.removed.map((deal) => deal.key), ['sync:g1-company-role-seat-person-1']);
  assert.deepEqual(drivers.ended, []);
});

/**
 * ===============================
 * * THREE WAYS TO LEAVE A MONTH, AND THEY ARE NOT THE SAME FACT
 * ===============================
 * Everything absent from the later month used to land in `ended`, so a live
 * deal marked for October was reported as ENDED, here and to Diane. Asked
 * why a person is down this month, that is the wrong answer given
 * confidently.
 */
test('removed, ended and another month are THREE different answers', () => {
  const dealFor = (id, net) => ({
    id, personId: `p${id}`, personName: `Person ${id}`, company: 'Company One',
    group: 'G1', role: 'Director', currency: 'GBP', amount: net, addon: 0, crypto: 0, fee: 0, net,
  });
  const rowFor = (id, extra = {}) => ({
    id, sync_key: `k${id}`, person_id: `p${id}`, person_name: `Person ${id}`,
    group_name: 'G1', company: 'Company One', ...extra,
  });
  const side = (month, rows, deals) => ({
    month, taken_at: `${month}-30T23:00:00.000Z`, row_count: rows.length, rows, totals: { net: {}, deals },
  });

  const before = side('2026-07', [rowFor(1), rowFor(2), rowFor(3), rowFor(4)],
    [dealFor(1, 100), dealFor(2, 200), dealFor(3, 300), dealFor(4, 400)]);
  // 1 stays. 2's row is gone. 3 was stopped. 4 is marked for another month.
  const after = side('2026-08',
    [rowFor(1), rowFor(3, { stopped_on: '2026-07-31' }), rowFor(4, { preset_on: '2026-10-01' })],
    [dealFor(1, 100)]);

  const filters = parseFilters({
    range: 'custom', fromMonth: '2026-07', toMonth: '2026-09',
  }, CURRENT_MONTH);
  const drivers = snapshotDrivers(before, after, filters);

  assert.deepEqual(drivers.removed.map((d) => d.key), ['sync:k2']);
  assert.deepEqual(drivers.ended.map((d) => d.key), ['sync:k3']);
  assert.deepEqual(drivers.notCounted.map((d) => d.key), ['sync:k4']);
  assert.match(drivers.ended[0].reason, /stopped 2026-07-31/);
  assert.match(drivers.notCounted[0].reason, /2026-10/);

  // AND IT BALANCES. 1,000 down to 100 is -900, and the three departures
  // are exactly that. A residual here would mean a deal went missing from
  // the account, which is the one thing this must never hide.
  const gbp = drivers.currencies.GBP;
  assert.equal(gbp.from, 1000);
  assert.equal(gbp.to, 100);
  assert.equal(gbp.delta, -900);
  assert.equal(gbp.accounted, -900);
  assert.equal(gbp.residual, 0);
  assert.equal(gbp.balances, true);
});

test('a changed deal names WHICH PART moved, not just the total', () => {
  const before = snapshot('2026-07', 50, 55);
  const after = snapshot('2026-08', 50, 65);
  const filters = parseFilters({
    range: 'custom', fromMonth: '2026-07', toMonth: '2026-09',
  }, CURRENT_MONTH);
  const drivers = snapshotDrivers(before, after, filters);

  assert.deepEqual(drivers.changed.map((deal) => ({
    currency: deal.currency, was: deal.was, now: deal.now,
  })), [{ currency: 'GBP', was: 55, now: 65 }]);
  // The wage did not move, the ADD ON did. Reporting only the net would
  // have her say his amount went up, which is a different conversation.
  assert.deepEqual(drivers.changed[0].parts, { addon: 10 });
  assert.equal(drivers.currencies.GBP.residual, 0);
});

/**
 * ===============================
 * * FOUR POINTS, AND THE LABEL SAYS SO
 * ===============================
 * `last3` used to draw FIVE: three whole months back, this month, and the
 * forecast. The label said 3. Reversed 2026-09-09 once the forecast became
 * a constant, so the range can carry the whole meaning:
 *
 *     3 months of history, THIS MONTH INCLUDED, plus one forecast month
 */
test('THE DEFAULT IS FOUR MONTHS: two past, this one, and next', () => {
  const defaults = parseFilters({}, CURRENT_MONTH);
  assert.equal(defaults.range, 'last3');
  assert.equal(defaults.fromMonth, '2026-07', 'not June: the count includes September');
  assert.equal(defaults.toMonth, '2026-10');
  assert.equal(defaults.dashboardMonth, CURRENT_MONTH);
  assert.deepEqual(defaults.months, ['2026-07', '2026-08', '2026-09', '2026-10']);
});

test('the window SLIDES with the month, with no setting touched', () => {
  // His own example: in October it is August, September, October, November.
  const october = parseFilters({}, '2026-10');
  assert.deepEqual(october.months, ['2026-08', '2026-09', '2026-10', '2026-11']);
});

test('every range counts this month as one of its own', () => {
  assert.equal(parseFilters({ range: 'last1' }, CURRENT_MONTH).fromMonth, '2026-09', 'this month alone');
  assert.equal(parseFilters({ range: 'last6' }, CURRENT_MONTH).fromMonth, '2026-04');
  assert.equal(parseFilters({ range: 'last12' }, CURRENT_MONTH).fromMonth, '2025-10');
  // Twelve is the ceiling because twelve is what is kept.
  assert.equal(parseFilters({ range: 'last12' }, CURRENT_MONTH).months.length, 13, '12 history + 1 forecast');
});

test('THE FORECAST IS FIXED AT ONE and is no longer a control', () => {
  // It was 1/3/6/12 defaulting to 1, and that knob is half of why the range
  // was unreadable: "3 months" plus an unread horizon drew anywhere between
  // four and fifteen points.
  assert.deepEqual(FORECAST_HORIZON_OPTIONS, [{ value: '1', label: '1 month' }]);
  assert.equal(parseFilters({}, CURRENT_MONTH).forecastHorizon, 1);
  assert.equal(parseFilters({ forecastHorizon: 1 }, CURRENT_MONTH).forecastHorizon, 1);
  assert.throws(() => parseFilters({ forecastHorizon: 3 }, CURRENT_MONTH), /forecastHorizon is not supported/);
});

test('a saved link on a retired range still resolves', () => {
  // `yearToDate` and `custom` left the dropdown and still work. Dropping
  // them outright would 400 every bookmark anyone had made.
  assert.equal(parseFilters({ range: 'yearToDate' }, CURRENT_MONTH).fromMonth, '2026-01');
  assert.equal(
    parseFilters({ range: 'custom', fromMonth: '2026-08', toMonth: '2026-09' }, CURRENT_MONTH).fromMonth,
    '2026-08',
  );
});

test('query options and bounds are validated before any repo call', () => {
  assert.throws(
    () => parseFilters({ range: 'custom', fromMonth: '2026-09', toMonth: '2027-01' }, CURRENT_MONTH),
    /forecast horizon/,
  );
  assert.throws(() => parseFilters({ range: 'unknown' }, CURRENT_MONTH), /range is not supported/);
  assert.throws(() => parseFilters({ range: 'custom', fromMonth: 'September' }, CURRENT_MONTH), /YYYY-MM/);
  assert.throws(() => parseFilters({ pageSize: 51 }, CURRENT_MONTH), /pageSize is not supported/);
});
