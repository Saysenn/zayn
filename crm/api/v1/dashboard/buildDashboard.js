const { projectMonth } = require('../masterSheet/projectMonth');
const { figuresFor } = require('../masterSheet/takeSnapshot');
const { totalInUsd } = require('../shared/toUsd.helper');
const { periodFor, PERIOD } = require('../shared/paymentPeriod.helper');
const { reconcileMonths } = require('../shared/monthReconcile.helper');
const {
  SNAPSHOT_MONTHS, DEFAULT_DASHBOARD_HISTORY, dashboardHistoryMonths,
} = require('../shared/snapshotWindow.helper');

// ***************************************************
// * Dashboard reporting contract
// ***************************************************

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DEFAULT_RANGE = 'last3';

/**
 * ===============================
 * * ONE MONTH AHEAD, AND IT IS NOT A CONTROL
 * ===============================
 * Fixed at 1, his call 2026-09-09. It was a 1/3/6/12 knob defaulting to 1,
 * and that knob is half of why the range was unreadable: "3 months" plus a
 * horizon nobody had looked at drew anywhere between four and fifteen
 * points. With the forward half constant, the backward half can finally
 * mean what it says.
 *
 * Three months ahead also put a quarter of invented figures on every chart
 * and made the trend look like it was mostly forecast.
 */
const FORECAST_MONTHS = 1;
const DEFAULT_FORECAST_HORIZON = FORECAST_MONTHS;
const FORECAST_HORIZONS = Object.freeze([FORECAST_MONTHS]);
const FORECAST_HORIZON_OPTIONS = Object.freeze(FORECAST_HORIZONS.map((value) => ({
  value: String(value),
  label: `${value} ${value === 1 ? 'month' : 'months'}`,
})));
/**
 * ===============================
 * * A RANGE IS MONTHS OF HISTORY, AND THIS MONTH IS ONE OF THEM
 * ===============================
 * REVERSED 2026-09-09, and it is not the old argument again.
 *
 * It used to mean months BACK, not counting this one, because "3 months"
 * plus a forecast horizon of 1, 3, 6 or 12 covered a span the words could
 * not describe. That was true while the forward half was a knob. It is
 * fixed at one month now, so the backward half can carry the whole meaning:
 *
 *     3 months = the two before this one, and this one
 *     + one forecast month, always
 *
 * Today September 2026 that is July, August, September, and an October
 * forecast: FOUR points, which is what the label plus the fixed horizon
 * says. Next month it is August, September, October and November, with no
 * setting touched.
 *
 * `1` is this month alone with next month's forecast, which is the smallest
 * honest window: a chart of one real point and one invented one.
 *
 * `yearToDate` and `custom` LEFT THE DROPDOWN and still resolve, so a saved
 * link keeps working. Extra options were half of what made this control
 * unreadable, and neither is expressible as "how many months of history".
 */
const RANGE_OPTIONS = Object.freeze([
  { value: 'last1', label: '1 month' },
  { value: 'last3', label: '3 months' },
  { value: 'last6', label: '6 months' },
  { value: 'last12', label: '12 months' },
]);

/**
 * HISTORY INCLUDING THIS MONTH, so the offset is one less than the count.
 * Reading these as "months back" is the bug this replaced.
 *
 * 12 is the ceiling because it is the ceiling: SNAPSHOT_MONTHS keeps twelve
 * and nothing older exists to draw.
 */
const MONTHS_OF_HISTORY = Object.freeze({
  last1: 1, last3: 3, last6: 6, last12: SNAPSHOT_MONTHS,
});

/** Still resolved for a saved link, never offered. */
const LEGACY_RANGES = Object.freeze(['yearToDate', 'custom']);
const CURRENCY_MODES = Object.freeze([
  { value: 'usd', label: 'Normalized USD' },
  { value: 'native', label: 'Native currencies' },
]);
const SOURCE_LABELS = Object.freeze({
  savedActual: 'Saved actual',
  liveEstimate: 'Live estimate',
  projectedForecast: 'Projected forecast',
  unavailable: 'Unavailable',
});
const MAX_TIMELINE_MONTHS = 36;
const RECENT_CHANGE_HOURS = 168;
const DEFAULT_RECENT_PAGE = 1;
const DEFAULT_RECENT_PAGE_SIZE = 10;
const MAX_RECENT_PAGE_SIZE = 50;

function monthIndex(month) {
  const [year, value] = month.split('-').map(Number);
  return (year * 12) + value - 1;
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function addMonths(month, amount) {
  return monthFromIndex(monthIndex(month) + amount);
}

function monthsBetween(fromMonth, toMonth) {
  const from = monthIndex(fromMonth);
  const to = monthIndex(toMonth);
  if (from > to) throw badRequest('fromMonth must not be after toMonth');
  if ((to - from) + 1 > MAX_TIMELINE_MONTHS) {
    throw badRequest(`Month range cannot exceed ${MAX_TIMELINE_MONTHS} months`);
  }
  return Array.from({ length: (to - from) + 1 }, (_, index) => monthFromIndex(from + index));
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function monthValue(value, name) {
  if (!MONTH.test(String(value ?? ''))) throw badRequest(`${name} must be YYYY-MM`);
  return String(value);
}

function positiveInteger(value, fallback, name, maximum = null) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || (maximum && number > maximum)) {
    throw badRequest(`${name} is not supported`);
  }
  return number;
}

function valuesOf(raw) {
  const values = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [raw]);
  return [...new Set(values.flatMap((value) => String(value).split(','))
    .map((value) => value.trim()).filter(Boolean))];
}

function parseFilters(query, currentMonth) {
  const range = query.range ?? DEFAULT_RANGE;
  // A legacy range still resolves so a saved link keeps working, it is just
  // no longer offered. See LEGACY_RANGES.
  if (!RANGE_OPTIONS.some((option) => option.value === range) && !LEGACY_RANGES.includes(range)) {
    throw badRequest('range is not supported');
  }

  const forecastHorizon = Number(query.forecastHorizon ?? DEFAULT_FORECAST_HORIZON);
  if (!FORECAST_HORIZONS.includes(forecastHorizon)) {
    throw badRequest('forecastHorizon is not supported');
  }

  const currencyMode = query.currencyMode ?? 'usd';
  if (!CURRENCY_MODES.some((option) => option.value === currencyMode)) {
    throw badRequest('currencyMode is not supported');
  }

  let fromMonth;
  let toMonth;
  if (range === 'custom') {
    fromMonth = monthValue(query.fromMonth, 'fromMonth');
    toMonth = monthValue(query.toMonth, 'toMonth');
    if (monthIndex(toMonth) > monthIndex(addMonths(currentMonth, forecastHorizon))) {
      throw badRequest('toMonth exceeds the selected forecast horizon');
    }
  } else {
    // MINUS ONE, because the count INCLUDES this month. `3` reaching back
    // three whole months is the bug this replaced: the label said 3 and the
    // chart drew June, July, August, September and October.
    const history = MONTHS_OF_HISTORY[range] ?? MONTHS_OF_HISTORY.last3;
    fromMonth = range === 'yearToDate'
      ? `${currentMonth.slice(0, 4)}-01`
      : addMonths(currentMonth, -(history - 1));
    toMonth = addMonths(currentMonth, forecastHorizon);
  }

  const months = monthsBetween(fromMonth, toMonth);
  const dashboardMonth = monthValue(query.month ?? currentMonth, 'month');
  if (!months.includes(dashboardMonth)) throw badRequest('month must be inside the selected range');

  return {
    range,
    fromMonth,
    toMonth,
    forecastHorizon,
    dashboardMonth,
    groups: valuesOf(query.group),
    company: String(query.company ?? '').trim() || null,
    person: String(query.person ?? '').trim() || null,
    paymentMethod: String(query.paymentMethod ?? '').trim() || null,
    currency: String(query.currency ?? '').trim().toUpperCase() || null,
    currencyMode,
    months,
    recentQ: String(query.q ?? '').trim(),
    recentPage: positiveInteger(query.page, DEFAULT_RECENT_PAGE, 'page'),
    recentPageSize: positiveInteger(query.pageSize, DEFAULT_RECENT_PAGE_SIZE, 'pageSize', MAX_RECENT_PAGE_SIZE),
  };
}

function sameText(left, right) {
  return String(left ?? '').trim().toLocaleLowerCase() === String(right ?? '').trim().toLocaleLowerCase();
}

function rowMatches(row, filters) {
  if (filters.groups.length && !filters.groups.some((group) => sameText(row.group_name, group))) return false;
  if (filters.company && !sameText(row.company, filters.company)) return false;
  if (filters.person && String(row.person_id ?? '') !== filters.person) return false;
  if (filters.paymentMethod && !sameText(row.payment_method, filters.paymentMethod)) return false;
  if (filters.currency && !sameText(row.currency || 'GBP', filters.currency)) return false;
  return true;
}

function dataFiltersActive(filters) {
  return Boolean(filters.groups.length || filters.company || filters.person || filters.paymentMethod || filters.currency);
}

function filterOptions(rows, historyMonths = DEFAULT_DASHBOARD_HISTORY) {
  const unique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value).trim()))]
    .sort((a, b) => a.localeCompare(b));
  const people = new Map();
  for (const row of rows) {
    if (row.person_id && !people.has(row.person_id)) {
      people.set(row.person_id, { personId: row.person_id, name: row.person_name || row.person_id });
    }
  }
  return {
    // CAPPED BY THE SETTING, never validated against it. Offering 6 when
    // only 3 are drawable is a chart of empty points; refusing a saved link
    // that names 12 after somebody lowered the setting is worse. A range
    // outside the cap still resolves, exactly like a legacy one.
    //
    // The cap is a DISPLAY rule. Retention keeps SNAPSHOT_MONTHS whatever
    // this says, which is what makes raising it instant: the months were
    // never deleted.
    ranges: RANGE_OPTIONS.filter((option) => MONTHS_OF_HISTORY[option.value] <= historyMonths),
    forecastHorizons: FORECAST_HORIZON_OPTIONS,
    currencyModes: CURRENCY_MODES,
    groups: unique(rows.map((row) => row.group_name)),
    companies: unique(rows.map((row) => row.company)),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    paymentMethods: unique(rows.map((row) => row.payment_method)),
    currencies: unique(rows.map((row) => row.currency || 'GBP')),
  };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function nativeList(byCurrency = {}) {
  return Object.entries(byCurrency).filter(([, amount]) => Number.isFinite(Number(amount)))
    .map(([currency, amount]) => ({ currency, amount: round(amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function money(byCurrency, currencyMode, fx) {
  const native = nativeList(byCurrency);
  const result = { native };
  if (currencyMode !== 'usd') return result;
  if (!fx || !Number.isFinite(Number(fx.usdPerGbp))) {
    result.normalization = {
      status: 'unavailable',
      missingCurrencies: native.map((item) => item.currency),
    };
    return result;
  }

  const converted = totalInUsd(new Map(native.map((item) => [item.currency, item.amount])), fx.usdPerGbp, fx.perUsd);
  const missingCurrencies = converted.unconvertible.map((item) => item.currency);
  // An available calculation with no native entries is a genuine zero.
  // Unavailable months never call this helper, so this cannot turn missing
  // history into a made-up USD zero.
  if (converted.converted.length > 0 || native.length === 0) {
    result.normalizedUsd = {
      amount: converted.usd,
      source: fx.source,
      asOf: fx.asOf ?? null,
      partial: missingCurrencies.length > 0,
    };
  }
  result.normalization = {
    status: missingCurrencies.length === 0 ? 'complete' : (converted.converted.length ? 'partial' : 'unavailable'),
    missingCurrencies,
  };
  return result;
}

function currencyTotals(items, valueFor) {
  const totals = {};
  for (const item of items ?? []) {
    const amount = Number(valueFor(item));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const currency = item.currency || 'GBP';
    totals[currency] = round((totals[currency] ?? 0) + amount);
  }
  return Object.fromEntries(Object.entries(totals).filter(([, amount]) => amount !== 0));
}

function frozenParts(deals) {
  return {
    rawPayable: currencyTotals(deals, (deal) => deal.amount),
    addOns: currencyTotals(deals, (deal) => deal.addon),
    crypto: currencyTotals(deals, (deal) => deal.crypto),
    fees: currencyTotals(deals, (deal) => deal.fee),
    adjustedNet: currencyTotals(deals, (deal) => deal.net),
  };
}

function figuresParts(figures) {
  return {
    rawPayable: figures?.grand ?? {},
    addOns: figures?.addon ?? {},
    crypto: figures?.crypto ?? {},
    fees: figures?.fee ?? {},
    adjustedNet: figures?.net ?? {},
  };
}

function paymentBreakdown(parts, currencyMode, fx) {
  return {
    rawPayable: money(parts.rawPayable, currencyMode, fx),
    addOns: money(parts.addOns, currencyMode, fx),
    crypto: money(parts.crypto, currencyMode, fx),
    fees: money(parts.fees, currencyMode, fx),
    adjustedNet: money(parts.adjustedNet, currencyMode, fx),
  };
}

function netForFigures(figures) {
  return figures?.net ?? {};
}

function snapshotRows(snapshot) {
  return Array.isArray(snapshot?.rows) ? snapshot.rows : [];
}

function frozenDeals(snapshot, filters) {
  const deals = snapshot?.totals?.deals;
  const rows = snapshotRows(snapshot);
  if (!Array.isArray(deals)) return null;
  if (!dataFiltersActive(filters)) return deals;
  if (rows.length === 0) return null;

  const allowed = new Set(rows.filter((row) => rowMatches(row, filters)).map((row) => String(row.id)));
  return deals.filter((deal) => allowed.has(String(deal.id)));
}

function sumFrozenDeals(deals) {
  const totals = {};
  for (const deal of deals ?? []) {
    const amount = Number(deal.net);
    if (!Number.isFinite(amount)) continue;
    const currency = deal.currency || 'GBP';
    totals[currency] = round((totals[currency] ?? 0) + amount);
  }
  return totals;
}

function snapshotMoney(snapshot, filters, currencyMode) {
  const deals = frozenDeals(snapshot, filters);
  if (deals === null) return null;
  const byCurrency = dataFiltersActive(filters) ? sumFrozenDeals(deals) : (snapshot.totals?.net ?? sumFrozenDeals(deals));
  return money(byCurrency, currencyMode, snapshot.totals?.fx);
}

function sourcePoint(month, source, totals, extra = {}) {
  return { month, source, sourceLabel: SOURCE_LABELS[source], totals, ...extra };
}

function livePoint(month, source, rows, context, previousSnapshot = null) {
  const projected = source === 'projectedForecast' ? projectMonth(rows, month) : rows;
  const figures = figuresFor(projected, month, context.figureOptions);
  return sourcePoint(month, source, money(netForFigures(figures), context.filters.currencyMode, context.fx), {
    deals: figures.counted,
    paymentBreakdown: paymentBreakdown(
      figuresParts(figures), context.filters.currencyMode, context.fx,
    ),
    // Declared on every point, saved or live, so a reader never has to know
    // which kind it is holding before asking what moved.
    changeDrivers: liveDrivers(previousSnapshot, month, projected, figures.deals, context),
    figures,
    rows: projected,
  });
}

function unavailablePoint(month, reason) {
  return sourcePoint(month, 'unavailable', { native: [] }, { reason });
}

/**
 * ===============================
 * * WHY A MONTH MOVED IS ONE DEFINITION, IN shared/
 * ===============================
 * This used to compute it here, with THREE buckets, and everything missing
 * from the later month landed in `ended`. A live deal with an October
 * preset was reported as ENDED on this page. `monthReconcile.helper` splits
 * removed, ended and not-counted-this-month and makes the arithmetic
 * BALANCE, so the difference is accounted for rather than described.
 *
 * It lives in shared/ for the same reason `owedThisMonth` does: what moved
 * a month is a business question, and Diane answers it off the same
 * function rather than a second opinion that can disagree with this page.
 */
function snapshotSide(snapshot) {
  return {
    month: snapshot.month,
    rows: snapshotRows(snapshot),
    deals: snapshot?.totals?.deals ?? [],
  };
}

// One predicate for both maps: the deals map has a row to test, the rows
// map is the row itself. No filters means everything matches and the
// snapshot's stored rows are never needed.
function matcherFor(filters) {
  if (!dataFiltersActive(filters)) return () => true;
  return (deal, row) => Boolean(row) && rowMatches(row, filters);
}

function snapshotDrivers(previous, current, filters) {
  if (!previous) return { available: false, reason: 'Previous saved snapshot is unavailable' };
  if (!Array.isArray(previous?.totals?.deals) || !Array.isArray(current?.totals?.deals)) {
    return { available: false, reason: 'Stored deal detail is unavailable' };
  }
  // A filter needs the stored ROWS to apply. An older snapshot without them
  // cannot be narrowed, and an empty answer would read as "nothing changed".
  if (dataFiltersActive(filters)
    && (snapshotRows(previous).length === 0 || snapshotRows(current).length === 0)) {
    return { available: false, reason: 'Stored deal detail is unavailable' };
  }
  return reconcileMonths(snapshotSide(previous), snapshotSide(current), {
    matches: matcherFor(filters),
    useEndDate: Boolean(current?.totals?.settings?.useEndDate),
  });
}

/**
 * THE LIVE MONTH HAS NO SNAPSHOT OF ITS OWN, and it is the one anybody
 * actually asks about: this month against last. Its figures were just
 * computed, so they stand in for the later side unchanged.
 */
function liveDrivers(previousSnapshot, month, rows, deals, context) {
  if (!previousSnapshot) {
    return { available: false, reason: 'No saved snapshot for the month before this one' };
  }
  if (!Array.isArray(previousSnapshot?.totals?.deals)) {
    return { available: false, reason: 'Stored deal detail is unavailable' };
  }
  if (dataFiltersActive(context.filters) && snapshotRows(previousSnapshot).length === 0) {
    return { available: false, reason: 'Stored deal detail is unavailable' };
  }
  return reconcileMonths(
    snapshotSide(previousSnapshot),
    { month, rows, deals },
    // One predicate over both sides. The live rows are already narrowed, so
    // re-testing them changes nothing; the stored side genuinely needs it.
    {
      matches: matcherFor(context.filters),
      useEndDate: Boolean(context.figureOptions?.useEndDate),
    },
  );
}

function snapshotPoint(snapshot, previous, filters) {
  const totals = snapshotMoney(snapshot, filters, filters.currencyMode);
  if (!totals) return unavailablePoint(snapshot.month, 'Stored deal detail cannot support these filters');
  const deals = frozenDeals(snapshot, filters);
  const stored = snapshot.totals ?? {};
  const savedParts = frozenParts(deals);
  const parts = dataFiltersActive(filters) ? savedParts : {
    rawPayable: stored.grand ?? savedParts.rawPayable,
    addOns: stored.addon ?? savedParts.addOns,
    crypto: stored.crypto ?? savedParts.crypto,
    fees: stored.fee ?? savedParts.fees,
    adjustedNet: stored.net ?? savedParts.adjustedNet,
  };
  return sourcePoint(snapshot.month, 'savedActual', totals, {
    deals: deals.length,
    takenAt: snapshot.taken_at,
    changeDrivers: snapshotDrivers(previous, snapshot, filters),
    paymentBreakdown: paymentBreakdown(parts, filters.currencyMode, stored.fx),
    snapshot,
  });
}

function groupFrozen(deals) {
  const groups = new Map();
  for (const deal of deals ?? []) {
    const group = deal.group || 'UNKNOWN';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(deal);
  }
  return groups;
}

function methodFrozen(snapshot, deals) {
  const rows = new Map(snapshotRows(snapshot).map((row) => [String(row.id), row]));
  const methods = new Map();
  for (const deal of deals ?? []) {
    const method = rows.get(String(deal.id))?.payment_method || 'Unspecified';
    if (!methods.has(method)) methods.set(method, []);
    methods.get(method).push(deal);
  }
  return methods;
}

function frozenSplit(items, keyName, currencyMode, fx) {
  return [...items.entries()].map(([key, deals]) => ({
    [keyName]: key,
    deals: deals.length,
    totals: money(sumFrozenDeals(deals), currencyMode, fx),
  })).sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function liveSplit(rows, keyFor, keyName, month, context) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFor(row) || 'Unspecified';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.entries()].map(([key, itemRows]) => {
    const figures = figuresFor(itemRows, month, context.figureOptions);
    return {
      [keyName]: key,
      deals: figures.counted,
      totals: money(netForFigures(figures), context.filters.currencyMode, context.fx),
    };
  }).filter((item) => item.deals > 0)
    .sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function selectedSplits(point, context) {
  if (point.source === 'unavailable') return { groupTotals: [], paymentMethodSplit: [] };
  if (point.source === 'savedActual') {
    const deals = frozenDeals(point.snapshot, context.filters);
    const fx = point.snapshot.totals?.fx;
    return {
      groupTotals: frozenSplit(groupFrozen(deals), 'group', context.filters.currencyMode, fx),
      paymentMethodSplit: frozenSplit(methodFrozen(point.snapshot, deals), 'paymentMethod', context.filters.currencyMode, fx),
    };
  }
  return {
    groupTotals: liveSplit(point.rows, (row) => row.group_name || 'UNKNOWN', 'group', point.month, context),
    paymentMethodSplit: liveSplit(point.rows, (row) => row.payment_method || 'Unspecified', 'paymentMethod', point.month, context),
  };
}

function knownGroupNames(liveRows, snapshots, filters) {
  const names = new Set();
  const remember = (name) => names.add(name || 'UNKNOWN');
  liveRows.filter((row) => rowMatches(row, filters)).forEach((row) => remember(row.group_name));
  for (const snapshot of snapshots) {
    const deals = frozenDeals(snapshot, filters);
    if (deals) deals.forEach((deal) => remember(deal.group));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function fxForPoint(point, context) {
  return point.source === 'savedActual' ? point.snapshot?.totals?.fx : context.fx;
}

function groupPaymentsForPoint(point, context, knownGroups) {
  if (!point || point.source === 'unavailable') return [];
  const split = selectedSplits(point, context).groupTotals;
  const byGroup = new Map(split.map((item) => [item.group, item]));
  const fx = fxForPoint(point, context);
  return knownGroups.map((group) => {
    const existing = byGroup.get(group);
    return {
      group,
      label: group,
      month: point.month,
      source: point.source,
      sourceLabel: point.sourceLabel,
      deals: existing?.deals ?? 0,
      totals: existing?.totals ?? money({}, context.filters.currencyMode, fx),
    };
  });
}

function nativeDifference(current, previous) {
  const amounts = new Map();
  for (const item of previous?.native ?? []) amounts.set(item.currency, -Number(item.amount));
  for (const item of current?.native ?? []) {
    amounts.set(item.currency, (amounts.get(item.currency) ?? 0) + Number(item.amount));
  }
  return nativeList(Object.fromEntries(amounts));
}

function moneyDifference(current, previous, currencyMode) {
  const difference = { native: nativeDifference(current, previous) };
  if (currencyMode !== 'usd') return difference;

  const currentUsd = Number(current?.normalizedUsd?.amount);
  const previousUsd = Number(previous?.normalizedUsd?.amount);
  const statuses = [current?.normalization?.status, previous?.normalization?.status];
  const missingCurrencies = [...new Set([
    ...(current?.normalization?.missingCurrencies ?? []),
    ...(previous?.normalization?.missingCurrencies ?? []),
  ])].sort();
  const canSubtract = Number.isFinite(currentUsd) && Number.isFinite(previousUsd);
  if (canSubtract) {
    difference.normalizedUsd = {
      amount: round(currentUsd - previousUsd),
      source: 'comparison',
      asOf: null,
      partial: statuses.some((status) => status === 'partial'),
    };
  }
  difference.normalization = {
    status: !canSubtract
      ? 'unavailable'
      : (statuses.every((status) => status === 'complete') ? 'complete' : 'partial'),
    missingCurrencies,
  };
  return difference;
}

function comparisonFor(point, previousPoint, currencyMode) {
  const previousMonth = addMonths(point.month, -1);
  const available = point.source !== 'unavailable'
    && previousPoint?.source !== 'unavailable';
  const previous = available ? previousPoint.totals : null;
  const difference = available ? moneyDifference(point.totals, previous, currencyMode) : null;
  let percentage = null;
  let direction = 'unavailable';

  const completeUsd = currencyMode === 'usd'
    && point.totals?.normalization?.status === 'complete'
    && previous?.normalization?.status === 'complete';
  if (completeUsd) {
    const currentUsd = Number(point.totals.normalizedUsd?.amount);
    const previousUsd = Number(previous.normalizedUsd?.amount);
    if (Number.isFinite(currentUsd) && Number.isFinite(previousUsd)) {
      const delta = round(currentUsd - previousUsd);
      direction = delta > 0 ? 'higher' : (delta < 0 ? 'lower' : 'unchanged');
      // UNROUNDED: the client rounds once for display. Rounding here too
      // made the card read 1.3% where the panel read 1.2% for one move.
      if (previousUsd !== 0) percentage = ((currentUsd - previousUsd) / Math.abs(previousUsd)) * 100;
    }
  } else if (currencyMode === 'native') {
    const native = difference?.native ?? [];
    const currentCurrencies = point.totals?.native ?? [];
    const previousCurrencies = previous?.native ?? [];
    if (native.length === 1 && currentCurrencies.length === 1 && previousCurrencies.length === 1
      && currentCurrencies[0].currency === previousCurrencies[0].currency) {
      const delta = Number(native[0].amount);
      const before = Number(previousCurrencies[0].amount);
      direction = delta > 0 ? 'higher' : (delta < 0 ? 'lower' : 'unchanged');
      if (before !== 0) percentage = (delta / Math.abs(before)) * 100; // unrounded, as above
    }
  }

  return {
    month: point.month,
    source: point.source,
    sourceLabel: point.sourceLabel,
    current: point.totals,
    previous,
    difference,
    percentage,
    direction,
    previousMonth,
    available,
    previousSource: previousPoint?.source ?? 'unavailable',
    previousSourceLabel: previousPoint?.sourceLabel ?? SOURCE_LABELS.unavailable,
  };
}

function selectedGroupPayments(point, previousPoint, context, knownGroups) {
  const current = groupPaymentsForPoint(point, context, knownGroups);
  const previous = new Map(
    groupPaymentsForPoint(previousPoint, context, knownGroups).map((item) => [item.group, item]),
  );
  return current.map((item) => ({
    ...item,
    comparison: comparisonFor(
      { ...point, totals: item.totals },
      previous.has(item.group) ? { ...previousPoint, totals: previous.get(item.group).totals } : previousPoint,
      context.filters.currencyMode,
    ),
  }));
}

const PAYMENT_STAGES = Object.freeze([
  { stage: 'paying', label: 'Paying' },
  { stage: 'ended', label: 'Ended' },
  { stage: 'notPayingYet', label: 'Not paying yet' },
]);

function paymentStage(row, useEndDate, frozen = false) {
  // Snapshot rows retain the payment period that was present when the
  // immutable snapshot was taken. Prefer it to applying today's rules to
  // a historical row, with the shared helper as the legacy fallback.
  const period = frozen && Object.values(PERIOD).includes(row?.payment_period)
    ? row.payment_period
    : periodFor(row, { useEndDate });
  if (period === PERIOD.ENDED) return 'ended';
  if (period === PERIOD.NOT_STARTED) return 'notPayingYet';
  return 'paying';
}

function rowsForPointStages(point, filters) {
  if (!point || point.source === 'unavailable') return null;
  if (point.source !== 'savedActual') return projectMonth(point.rows, point.month);
  const rows = snapshotRows(point.snapshot);
  if (rows.length === 0 && Number(point.snapshot?.row_count) > 0) return null;
  return rows.filter((row) => rowMatches(row, filters));
}

function stageData(point, context) {
  const rows = rowsForPointStages(point, context.filters);
  const available = rows !== null;
  const useEndDate = point.source === 'savedActual'
    ? Boolean(point.snapshot?.totals?.settings?.useEndDate)
    : context.figureOptions.useEndDate;
  const counts = { paying: 0, ended: 0, notPayingYet: 0 };
  if (available) {
    for (const row of rows) counts[paymentStage(row, useEndDate, point.source === 'savedActual')] += 1;
  }
  return {
    totals: Object.fromEntries(PAYMENT_STAGES.map(({ stage }) => [stage, available ? counts[stage] : null])),
    aggregates: PAYMENT_STAGES.map(({ stage, label }) => ({
      stage,
      name: stage === 'notPayingYet' ? 'not_paying_yet' : stage,
      label,
      deals: available ? counts[stage] : null,
      available,
      month: point.month,
      source: point.source,
      sourceLabel: point.sourceLabel,
    })),
  };
}

function recentDeals(rows, month, context, limit = 10) {
  const projected = projectMonth(rows, month);
  const figures = figuresFor(projected, month, context.figureOptions);
  const payments = new Map(figures.deals.map((deal) => [String(deal.id), deal]));
  const original = new Map(rows.map((row) => [String(row.id), row]));
  const sorted = [...projected].sort((left, right) => {
    const leftAt = new Date(original.get(String(left.id))?.updated_at ?? 0).getTime() || 0;
    const rightAt = new Date(original.get(String(right.id))?.updated_at ?? 0).getTime() || 0;
    return rightAt - leftAt;
  });
  return sorted.slice(0, limit).map((row) => {
    const live = original.get(String(row.id)) ?? row;
    const payment = payments.get(String(row.id));
    return {
      id: row.id,
      personId: row.person_id ?? null,
      personName: row.person_name ?? null,
      company: row.company ?? null,
      group: row.group_name ?? null,
      role: row.role_label ?? row.role ?? null,
      currency: row.currency || 'GBP',
      amount: payment ? round(payment.amount) : 0,
      payable: payment ? round(payment.net) : 0,
      totals: money(
        payment ? { [row.currency || 'GBP']: payment.net } : {},
        context.filters.currencyMode,
        context.fx,
      ),
      updatedAt: live.updated_at ?? live.created_at ?? null,
      paymentStage: paymentStage(row, context.figureOptions.useEndDate),
    };
  });
}

function openFlaggedCount(openPairs, filteredRows, filters) {
  const qualifyingPairs = new Set(filteredRows.map((row) => `${row.group_name}\u0000${row.person_id}`));
  return openPairs.filter((pair) => {
    if (filters.groups.length && !filters.groups.some((group) => sameText(pair.group_name, group))) return false;
    if (filters.person && String(pair.person_id ?? '') !== filters.person) return false;
    if ((filters.company || filters.paymentMethod) && !qualifyingPairs.has(`${pair.group_name}\u0000${pair.person_id}`)) return false;
    return true;
  }).length;
}

function snapshotHealth(pastMonths, snapshots) {
  if (pastMonths.length === 0) {
    return { status: 'notApplicable', availableMonths: [], missingMonths: [], invalidMonths: [], latestTakenAt: null };
  }
  const available = snapshots.filter((snapshot) => pastMonths.includes(snapshot.month));
  const availableMonths = available.map((snapshot) => snapshot.month).sort();
  const missingMonths = pastMonths.filter((month) => !availableMonths.includes(month));
  const invalidMonths = available.filter((snapshot) => (
    !Array.isArray(snapshot.rows) || Number(snapshot.row_count) !== snapshot.rows.length || !Array.isArray(snapshot.totals?.deals)
  )).map((snapshot) => snapshot.month);
  const status = missingMonths.length === 0 && invalidMonths.length === 0
    ? 'healthy'
    : (availableMonths.length === 0 ? 'unavailable' : 'partial');
  const latestTakenAt = available.map((snapshot) => snapshot.taken_at).filter(Boolean).sort().at(-1) ?? null;
  return { status, availableMonths, missingMonths, invalidMonths, latestTakenAt };
}

function recentChanges(rows) {
  return rows.map((change) => ({
    id: change.id,
    rowId: change.row_id,
    personId: change.person_id,
    personName: change.person_name,
    company: change.company,
    group: change.group_name,
    field: change.field,
    oldValue: change.old_value,
    newValue: change.new_value,
    changedVia: change.changed_via,
    changedAt: change.changed_at,
    rowExists: change.row_exists,
  }));
}

function timelineMonthOptions(timeline) {
  const labels = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return timeline.map((point) => ({
    value: point.month,
    label: `${labels[Number(point.month.slice(5, 7)) - 1]} ${point.month.slice(0, 4)} (${point.sourceLabel})`,
    source: point.source,
    sourceLabel: point.sourceLabel,
  }));
}

async function buildDashboard(query, dependencies) {
  const {
    currentMonth,
    rowsRepo,
    snapshotsRepo,
    settingsRepo,
    peopleRepo,
    concernsRepo,
    fxRates,
  } = dependencies;
  const filters = parseFilters(query, currentMonth);
  const liveRows = await rowsRepo.findAllRows();
  const filteredRows = liveRows.filter((row) => rowMatches(row, filters));
  const pastMonths = filters.months.filter((month) => monthIndex(month) < monthIndex(currentMonth));
  const comparisonMonth = pastMonths.length ? addMonths(pastMonths[0], -1) : null;
  const selectedPreviousMonth = addMonths(filters.dashboardMonth, -1);
  const snapshotMonths = new Set(pastMonths);
  if (comparisonMonth) snapshotMonths.add(comparisonMonth);
  if (monthIndex(selectedPreviousMonth) < monthIndex(currentMonth)) snapshotMonths.add(selectedPreviousMonth);

  const [settings, rates, snapshots, openPairs, fx] = await Promise.all([
    settingsRepo.get(),
    peopleRepo.rateMap(),
    snapshotsRepo.findMany([...snapshotMonths].sort()),
    concernsRepo.listOpenPairs(),
    fxRates.usdPerGbp(),
  ]);
  const snapshotByMonth = new Map(snapshots.map((snapshot) => [snapshot.month, snapshot]));
  const context = {
    filters,
    fx,
    figureOptions: {
      useEndDate: Boolean(settings?.color_uses_end_date),
      rates,
      cryptoPercent: Number(settings?.crypto_percent ?? 0),
      fx,
    },
  };

  const pointForMonth = (month) => {
    if (monthIndex(month) < monthIndex(currentMonth)) {
      const snapshot = snapshotByMonth.get(month);
      if (!snapshot) return unavailablePoint(month, 'No saved snapshot');
      return snapshotPoint(snapshot, snapshotByMonth.get(addMonths(month, -1)), filters);
    }
    const before = snapshotByMonth.get(addMonths(month, -1)) ?? null;
    if (month === currentMonth) return livePoint(month, 'liveEstimate', filteredRows, context, before);
    return livePoint(month, 'projectedForecast', filteredRows, context, before);
  };
  const timeline = filters.months.map(pointForMonth);

  const selectedPoint = timeline.find((point) => point.month === filters.dashboardMonth);
  const previousPoint = timeline.find((point) => point.month === selectedPreviousMonth)
    ?? pointForMonth(selectedPreviousMonth);
  const split = selectedSplits(selectedPoint, context);
  const knownGroups = knownGroupNames(liveRows, snapshots, filters);
  const groupPayments = selectedGroupPayments(selectedPoint, previousPoint, context, knownGroups);
  const comparison = comparisonFor(selectedPoint, previousPoint, filters.currencyMode);
  const stages = stageData(selectedPoint, context);
  const timelineWithGroups = timeline.map((point) => {
    const publicPoint = (({ figures, rows, snapshot, ...value }) => value)(point);
    if (point.source === 'unavailable') return publicPoint;
    const pointGroups = groupPaymentsForPoint(point, context, knownGroups);
    const allGroups = {
      group: 'allGroups',
      label: 'All groups',
      month: point.month,
      source: point.source,
      sourceLabel: point.sourceLabel,
      deals: point.deals,
      totals: point.totals,
    };
    return { ...publicPoint, allGroups, groupPayments: pointGroups, groups: pointGroups };
  });
  const rowIds = dataFiltersActive(filters) ? filteredRows.map((row) => row.id) : null;
  const changesPage = await rowsRepo.findFieldChanges({
    hours: RECENT_CHANGE_HOURS,
    limit: filters.recentPageSize,
    offset: (filters.recentPage - 1) * filters.recentPageSize,
    rowIds,
    q: filters.recentQ,
    withTotal: true,
  });

  return {
    dashboardMonth: filters.dashboardMonth,
    filters: {
      applied: {
        range: filters.range,
        fromMonth: filters.fromMonth,
        toMonth: filters.toMonth,
        forecastHorizon: filters.forecastHorizon,
        groups: filters.groups,
        company: filters.company,
        person: filters.person,
        paymentMethod: filters.paymentMethod,
        currency: filters.currency,
        currencyMode: filters.currencyMode,
        q: filters.recentQ,
        page: filters.recentPage,
        pageSize: filters.recentPageSize,
      },
      options: { ...filterOptions(liveRows, dashboardHistoryMonths(settings.dashboard_history_months)), months: timelineMonthOptions(timeline) },
    },
    kpis: {
      liveMonth: currentMonth,
      liveDeals: filteredRows.length,
      distinctPeople: new Set(filteredRows.map((row) => row.person_id).filter(Boolean)).size,
      distinctCompanies: new Set(filteredRows.map((row) => String(row.company ?? '').trim().toLocaleLowerCase()).filter(Boolean)).size,
      monthlyPayable: {
        month: selectedPoint.month,
        source: selectedPoint.source,
        sourceLabel: selectedPoint.sourceLabel,
        ...selectedPoint.totals,
      },
      openFlaggedCount: openFlaggedCount(openPairs, filteredRows, filters),
    },
    totalPayments: {
      month: selectedPoint.month,
      source: selectedPoint.source,
      sourceLabel: selectedPoint.sourceLabel,
      ...selectedPoint.totals,
      current: selectedPoint.totals,
      breakdown: selectedPoint.paymentBreakdown ?? null,
      comparison,
    },
    paymentComparison: comparison,
    forecastPerformance: comparison,
    timeline: timelineWithGroups,
    groupTotals: split.groupTotals.map((item) => ({
      ...item,
      comparison: groupPayments.find((group) => group.group === item.group)?.comparison ?? null,
    })),
    groupPayments,
    paymentMethodSplit: split.paymentMethodSplit,
    dealStageTotals: stages.totals,
    stageAggregates: stages.aggregates,
    recentDeals: recentDeals(filteredRows, filters.dashboardMonth, context),
    recentChanges: {
      rows: recentChanges(changesPage.rows),
      total: changesPage.total,
      page: filters.recentPage,
      pageSize: filters.recentPageSize,
      q: filters.recentQ,
    },
    snapshotHealth: snapshotHealth(pastMonths, snapshots),
  };
}

module.exports = {
  buildDashboard,
  parseFilters,
  snapshotDrivers,
  SOURCE_LABELS,
  RANGE_OPTIONS,
  FORECAST_HORIZONS,
  FORECAST_HORIZON_OPTIONS,
  CURRENCY_MODES,
  DEFAULT_RANGE,
  DEFAULT_FORECAST_HORIZON,
  MAX_TIMELINE_MONTHS,
  RECENT_CHANGE_HOURS,
  DEFAULT_RECENT_PAGE,
  DEFAULT_RECENT_PAGE_SIZE,
  MAX_RECENT_PAGE_SIZE,
};
