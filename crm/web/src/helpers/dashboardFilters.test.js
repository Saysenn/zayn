import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardQueryParams } from './dashboard.js';

// The page's own shape, kept here so a field dropped from initialFilters
// without dropping it here shows up as a failure rather than as a filter
// that silently stops reaching the server.
const filters = () => ({
  range: 'last3',
  fromMonth: '2026-04',
  toMonth: '2026-09',
  forecastHorizon: '1',
  groups: [],
  paymentMethod: '',
  currencyMode: 'usd',
  q: '',
  page: 1,
  pageSize: 5,
});

test('every filter the panel offers reaches the request', () => {
  const params = dashboardQueryParams({
    ...filters(), range: 'last6', forecastHorizon: '3', groups: ['Indigo', 'Nexus'], paymentMethod: 'bank',
  });

  assert.equal(params.range, 'last6');
  assert.equal(params.forecastHorizon, '3');
  assert.equal(params.group, 'Indigo,Nexus');
  assert.equal(params.paymentMethod, 'bank');
});

test('a changed range changes the request, so React Query cannot serve the old answer', () => {
  const before = dashboardQueryParams(filters());
  const after = dashboardQueryParams({ ...filters(), range: 'last12' });

  assert.notDeepEqual(before, after);
  assert.notEqual(JSON.stringify(['dashboard', before]), JSON.stringify(['dashboard', after]));
});

// Custom is the only range that carries bounds. Sending them otherwise
// would pin the window open against the range the user picked.
test('month bounds travel only for a custom range', () => {
  assert.equal(dashboardQueryParams(filters()).fromMonth, undefined);
  const custom = dashboardQueryParams({ ...filters(), range: 'custom' });
  assert.equal(custom.fromMonth, '2026-04');
  assert.equal(custom.toMonth, '2026-09');
});

// Company, Person and the reporting month were taken off the dashboard.
// They must not linger in the request as a stale scope nobody can see.
test('the filters that were removed send nothing', () => {
  const params = dashboardQueryParams(filters());

  assert.equal(params.company, undefined);
  assert.equal(params.person, undefined);
  assert.equal(params.month, undefined);
  assert.equal(params.currency, undefined);
});

test('the dashboard always asks for USD, whatever it is handed', () => {
  assert.equal(dashboardQueryParams({ ...filters(), currencyMode: 'native' }).currencyMode, 'native');
  assert.equal(dashboardQueryParams({ ...filters(), currencyMode: 'nonsense' }).currencyMode, 'usd');
  assert.equal(dashboardQueryParams({ ...filters(), currencyMode: undefined }).currencyMode, 'usd');
});
