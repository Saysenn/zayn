import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardQueryParams, normalizeDashboard, normalizeDashboardMoney, PERIOD_FOR_STAGE } from './dashboard.js';
import { PERIOD, PERIOD_FILTER_OPTIONS } from './paymentPeriod.js';

// ===============================
// * A STAGE KEY IS NOT A PERIOD VALUE
// ===============================
// The ring counts `paying`, the master sheet filters on `active`. A link
// carrying the ring's own word filters the sheet to nothing, silently.
test('every stage the ring can draw translates to a period the sheet filters on', () => {
  const drawn = ['paying', 'ended', 'not_started', 'not_paying_yet'];
  const filterable = new Set(PERIOD_FILTER_OPTIONS.map((option) => option.value));

  for (const key of drawn) {
    const period = PERIOD_FOR_STAGE[key];
    assert.ok(period, `${key} has no period, so its link would filter to nothing`);
    assert.ok(filterable.has(period), `${key} maps to ${period}, which the sheet does not offer`);
  }
  // The two names for one state must land on the same filter.
  assert.equal(PERIOD_FOR_STAGE.not_started, PERIOD_FOR_STAGE.not_paying_yet);
  assert.equal(PERIOD_FOR_STAGE.paying, PERIOD.ACTIVE);
});

test('dashboard query sends the complete server filter contract', () => {
  assert.deepEqual(dashboardQueryParams({
    range: 'custom',
    fromMonth: '2026-01',
    toMonth: '2026-06',
    forecastHorizon: '6',
    month: '2026-04',
    groups: ['Indigo', 'Milkman'],
    company: 'acme',
    person: 'person-4',
    paymentMethod: 'bank',
    currencyMode: 'usd',
    q: 'amount',
    page: 2,
    pageSize: 10,
  }), {
    range: 'custom',
    fromMonth: '2026-01',
    toMonth: '2026-06',
    forecastHorizon: '6',
    month: '2026-04',
    group: 'Indigo,Milkman',
    company: 'acme',
    person: 'person-4',
    paymentMethod: 'bank',
    currencyMode: 'usd',
    q: 'amount',
    page: 2,
    pageSize: 10,
  });
});

test('preset ranges omit custom month bounds', () => {
  const params = dashboardQueryParams({
    range: 'last3', forecastHorizon: '3', groups: [], currencyMode: 'native', page: 1, pageSize: 10,
  });
  assert.equal(params.fromMonth, undefined);
  assert.equal(params.toMonth, undefined);
  assert.equal(params.group, '');
  assert.equal('groups' in params, false);
});

test('dashboard response normalizes the final web contract', () => {
  const dashboard = normalizeDashboard({
    dashboardMonth: '2026-09',
    filters: {
      options: {
        months: [{ value: '2026-09', label: 'September 2026', source: 'liveEstimate', sourceLabel: 'Live estimate' }],
        groups: ['Indigo'],
        companies: [{ value: 'acme', label: 'Acme' }],
        people: [{ personId: 'person-1', name: 'Ada' }],
        paymentMethods: ['bank'],
      },
    },
    kpis: {
      liveMonth: '2026-09',
      liveDeals: 12,
      distinctPeople: 8,
      distinctCompanies: 5,
      monthlyPayable: {
        month: '2026-09',
        source: 'liveEstimate',
        sourceLabel: 'Live estimate',
        native: [{ currency: 'GBP', amount: 1000 }],
        normalizedUsd: { amount: 1300, source: 'saved', asOf: '2026-09-01', partial: false },
        normalization: { status: 'complete', missingCurrencies: [] },
      },
      openFlaggedCount: 3,
    },
    timeline: [
      { month: '2026-08', source: 'savedActual', sourceLabel: 'Saved actual', totals: { native: [{ currency: 'GBP', amount: 900 }] } },
      { month: '2026-09', source: 'liveEstimate', sourceLabel: 'Live estimate', totals: { native: [{ currency: 'GBP', amount: 1000 }] } },
      { month: '2026-10', source: 'projectedForecast', sourceLabel: 'Projected forecast', totals: { native: [{ currency: 'GBP', amount: 1100 }] } },
      { month: '2026-11', source: 'unavailable', sourceLabel: 'Unavailable', reason: 'No snapshot' },
    ],
    groupTotals: [{ group: 'Indigo', deals: 7, totals: { native: [{ currency: 'GBP', amount: 700 }] } }],
    paymentMethodSplit: [{ paymentMethod: 'bank', deals: 6, totals: { native: [{ currency: 'GBP', amount: 600 }] } }],
    recentChanges: { rows: [{ id: 1, personId: 'person-1', oldValue: '10', newValue: '20' }], total: 1, page: 1, pageSize: 10, q: '' },
    snapshotHealth: { status: 'healthy', availableMonths: ['2026-08'], missingMonths: [], invalidMonths: [], latestTakenAt: '2026-09-01T12:00:00Z' },
  });

  assert.equal(dashboard.dashboardMonth, '2026-09');
  assert.equal(dashboard.summary.liveMonth, '2026-09');
  assert.equal(dashboard.summary.companies, 5);
  assert.equal(dashboard.summary.monthlySource, 'liveEstimate');
  assert.deepEqual(dashboard.summary.monthlyPayable.native, { GBP: 1000 });
  assert.equal(dashboard.summary.monthlyPayable.usd, 1300);
  assert.equal(dashboard.options.months[0].source, 'liveEstimate');
  assert.deepEqual(dashboard.options.people[0], { value: 'person-1', label: 'Ada' });
  assert.equal(dashboard.trend[0].actual.native.GBP, 900);
  assert.equal(dashboard.trend[1].estimate.native.GBP, 1000);
  assert.equal(dashboard.trend[2].forecast.native.GBP, 1100);
  assert.equal(dashboard.trend[3].unavailable, true);
  assert.equal(dashboard.groups[0].liveDeals, 7);
  assert.equal(dashboard.paymentMethods[0].count, 6);
  assert.equal(dashboard.recentChanges.total, 1);
  assert.equal(dashboard.health.status, 'healthy');
});

test('USD stays unavailable when every native currency is unconvertible', () => {
  const money = normalizeDashboardMoney({
    native: [{ currency: 'AED', amount: 500 }],
    normalizedUsd: { amount: 0, partial: true },
    normalization: { status: 'unavailable', missingCurrencies: ['AED'] },
  });
  assert.equal(money.usd, null);
  assert.equal(money.usdPartial, true);
  assert.deepEqual(money.native, { AED: 500 });
  assert.deepEqual(money.missingFx, ['AED']);
});

test('USD stays unavailable even if an invalid source supplies a zero placeholder', () => {
  const money = normalizeDashboardMoney({
    native: [{ currency: 'AED', amount: 500 }],
    normalizedUsd: { amount: 42, partial: false },
    normalization: { status: 'unavailable', missingCurrencies: ['AED'] },
  });
  assert.equal(money.usd, null);
});

test('USD keeps a server supplied converted subtotal when only some FX is missing', () => {
  const money = normalizeDashboardMoney({
    native: [{ currency: 'GBP', amount: 100 }, { currency: 'AED', amount: 500 }],
    normalizedUsd: { amount: 130, partial: true },
    normalization: { status: 'partial', missingCurrencies: ['AED'] },
  });
  assert.equal(money.usd, 130);
  assert.equal(money.usdPartial, true);
});

test('saved actual change drivers are read from the API contract', () => {
  const dashboard = normalizeDashboard({
    timeline: [{
      month: '2026-08',
      source: 'savedActual',
      // THE API'S FIVE BUCKETS. `ended` used to carry all three ways a deal
      // can leave a month; removed, ended and notCounted are separate facts.
      changeDrivers: {
        available: true, added: [], removed: [], ended: [], notCounted: [], changed: [],
      },
    }],
  });
  assert.equal(dashboard.trend[0].drivers.available, true);
  assert.deepEqual(dashboard.trend[0].drivers.changed, []);
  assert.deepEqual(dashboard.trend[0].drivers.notCounted, []);
});
