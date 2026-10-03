// The extension is required: node loads this file directly in the tests.
import { PERIOD } from './paymentPeriod.js';

const CURRENCY_MODES = new Set(['native', 'usd']);

// ===============================
// * A STAGE KEY IS NOT A PERIOD VALUE
// ===============================
// Deals by Stage counts `paying`; the master sheet filters on `active`. A
// link from the ring has to say it in the sheet's own words, and `paying`
// arriving there would filter to nothing at all.
export const PERIOD_FOR_STAGE = Object.freeze({
  paying: PERIOD.ACTIVE,
  ended: PERIOD.ENDED,
  not_started: PERIOD.NOT_STARTED,
  not_paying_yet: PERIOD.NOT_STARTED,
});

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const list = (value) => (Array.isArray(value) ? value : []);

function option(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return { value: String(value), label: String(label ?? value) };
}

function normalizeOptions(values) {
  return list(values).map((entry) => (
    typeof entry === 'object'
      ? option(
        entry.value ?? entry.personId ?? entry.companyKey ?? entry.id ?? entry.key ?? entry.name,
        entry.label ?? entry.name,
      )
      : option(entry)
  )).filter(Boolean);
}

function normalizeMonthOptions(values) {
  return list(values).map((entry) => ({
    value: String(entry.value),
    label: String(entry.label ?? entry.value),
    source: entry.source,
    sourceLabel: entry.sourceLabel,
  })).filter((entry) => entry.value);
}

function normalizeCurrencyMap(value) {
  const source = value?.native ?? value?.byCurrency ?? value?.currencies ?? value;
  if (Array.isArray(source)) {
    return Object.fromEntries(source.map((entry) => [
      entry.currency,
      numberOrNull(entry.amount ?? entry.value),
    ]).filter(([currency, amount]) => currency && amount !== null));
  }
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(Object.entries(source).map(([currency, amount]) => [
    currency,
    numberOrNull(amount),
  ]).filter(([currency, amount]) => (
    amount !== null && !['usd', 'usdAmount', 'normalizedUsd', 'missingFx', 'missingCurrencies'].includes(currency)
  )));
}

export function normalizeDashboardMoney(value) {
  const object = value && typeof value === 'object' ? value : {};
  const native = normalizeCurrencyMap(value);
  const missingFx = list(
    object.normalization?.missingCurrencies
      ?? object.unconvertible
      ?? object.missingFx
      ?? object.missingCurrencies,
  ).map((entry) => String(entry?.currency ?? entry?.code ?? entry));
  const suppliedUsd = numberOrNull(object.normalizedUsd?.amount ?? object.normalizedUsd ?? object.usd ?? object.usdAmount);
  const nonzeroNativeCurrencies = Object.entries(native)
    .filter(([, amount]) => amount !== 0)
    .map(([currency]) => currency);
  const entirelyUnconvertible = object.normalization?.status === 'unavailable'
    || (nonzeroNativeCurrencies.length > 0
      && nonzeroNativeCurrencies.every((currency) => missingFx.includes(currency)));
  return {
    native,
    usd: entirelyUnconvertible ? null : suppliedUsd,
    usdPartial: Boolean(object.normalizedUsd?.partial || (suppliedUsd !== null && missingFx.length > 0)),
    missingFx,
  };
}

function normalizeTrendPoint(point) {
  const source = point.source;
  const totals = normalizeDashboardMoney(point.totals);
  const empty = normalizeDashboardMoney(null);
  const groupValues = point.groupTotals ?? point.groups ?? point.paymentsByGroup;
  return {
    month: String(point.month ?? point.label ?? ''),
    actual: source === 'savedActual' ? totals : normalizeDashboardMoney(point.actual ?? point.savedActual ?? empty),
    estimate: source === 'liveEstimate' ? totals : normalizeDashboardMoney(point.estimate ?? point.liveEstimate ?? empty),
    forecast: source === 'projectedForecast' ? totals : normalizeDashboardMoney(point.forecast ?? point.projectedForecast ?? empty),
    unavailable: source === 'unavailable' || point.available === false || point.unavailable === true,
    source,
    sourceLabel: point.sourceLabel,
    reason: point.reason,
    drivers: point.changeDrivers ?? point.drivers ?? null,
    groups: list(groupValues).map(normalizeGroup),
  };
}

function normalizeComparison(value) {
  if (!value || typeof value !== 'object') return null;
  const rawDifference = value.difference ?? value.delta ?? value.amount;
  const differenceMoney = rawDifference && typeof rawDifference === 'object'
    ? normalizeDashboardMoney(rawDifference)
    : null;
  const difference = numberOrNull(rawDifference) ?? differenceMoney?.usd ?? null;
  const percentage = numberOrNull(value.percentage ?? value.percent ?? value.changePercent);
  const direction = value.direction
    ?? (difference === null ? null : difference > 0 ? 'higher' : difference < 0 ? 'lower' : 'unchanged');
  return {
    direction,
    difference,
    percentage,
    comparedMonth: value.comparedMonth ?? value.previousMonth ?? value.fromMonth ?? null,
    label: value.label ?? value.comparedSourceLabel ?? null,
    differenceMoney,
  };
}

function normalizeGroup(group) {
  return {
    name: String(group.name ?? group.group ?? group.groupName ?? ''),
    liveDeals: numberOrNull(group.liveDeals ?? group.deals ?? group.count) ?? 0,
    payable: normalizeDashboardMoney(group.totals ?? group.payable ?? group.monthlyPayable ?? group.payment),
    comparison: normalizeComparison(group.comparison ?? group.change),
  };
}

function normalizeStage(stage) {
  const rawName = String(stage.name ?? stage.stage ?? stage.status ?? stage.key ?? '');
  const key = rawName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s-]+/g, '_');
  const count = numberOrNull(stage.count ?? stage.deals ?? stage.value);
  return {
    key,
    name: key === 'not_started' || key === 'not_paying_yet' ? 'Not paying yet'
      : key === 'paying' ? 'Paying'
        : key === 'ended' ? 'Ended' : rawName,
    count,
    available: stage.available !== false && count !== null,
  };
}

function normalizeRecentDeal(deal) {
  return {
    id: deal.id,
    personId: deal.personId ?? deal.person_id,
    personName: deal.personName ?? deal.person_name,
    companyName: deal.companyName ?? deal.company_name ?? deal.company,
    group: deal.group ?? deal.groupName ?? deal.group_name,
    role: deal.role ?? deal.roleLabel ?? deal.role_label,
    stage: normalizeStage({ stage: deal.stage ?? deal.paymentStage ?? deal.payment_period }).name,
    payment: normalizeDashboardMoney(deal.totals ?? deal.payable ?? deal.payment),
    changedAt: deal.changedAt ?? deal.changed_at ?? deal.updatedAt ?? deal.updated_at,
  };
}

function normalizeForecastPerformance(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    month: value.month ?? null,
    actual: normalizeDashboardMoney(value.actual ?? value.current ?? value.actualPayment),
    forecast: normalizeDashboardMoney(value.forecast ?? value.previous ?? value.compared ?? value.forecastPayment),
    comparison: normalizeComparison(value.comparison ?? value),
    sourceLabel: value.sourceLabel ?? value.actualSourceLabel ?? null,
    comparedSourceLabel: value.comparedSourceLabel ?? value.forecastSourceLabel ?? value.previousSourceLabel ?? null,
  };
}

function normalizeChange(change) {
  return {
    id: change.id,
    changedAt: change.changedAt ?? change.changed_at ?? change.createdAt ?? change.created_at,
    personId: change.personId ?? change.person_id,
    personName: change.personName ?? change.person_name,
    companyKey: change.companyKey ?? change.company_key ?? change.ckey,
    companyName: change.companyName ?? change.company_name ?? change.company,
    group: change.group ?? change.groupName ?? change.group_name,
    field: change.field ?? change.column ?? change.columnName ?? change.column_name,
    from: change.from ?? change.oldValue ?? change.old_value,
    to: change.to ?? change.newValue ?? change.new_value,
    via: change.via ?? change.changedVia ?? change.changed_via,
    summary: change.summary ?? change.description,
  };
}

function normalizeUpcoming(item) {
  return {
    id: item.id,
    date: item.date ?? item.startOn ?? item.start_on ?? item.endOn ?? item.end_on,
    personId: item.personId ?? item.person_id,
    personName: item.personName ?? item.person_name,
    companyName: item.companyName ?? item.company_name ?? item.company,
    group: item.group ?? item.groupName ?? item.group_name,
  };
}

export function normalizeDashboard(raw = {}) {
  const summary = raw.summary ?? raw.kpis ?? {};
  const totalPayments = raw.totalPayments ?? summary.monthlyPayable ?? summary.payable;
  const options = raw.filterOptions ?? raw.filters?.options ?? raw.filters ?? {};
  const changes = raw.recentChanges ?? raw.changes ?? {};
  const upcoming = raw.upcoming ?? {};
  const starts = upcoming.starts ?? raw.upcomingStarts;
  const ends = upcoming.ends ?? raw.upcomingEnds;

  return {
    generatedAt: raw.generatedAt ?? raw.generated_at ?? null,
    dashboardMonth: raw.dashboardMonth ?? null,
    summary: {
      liveMonth: summary.liveMonth ?? null,
      liveDeals: numberOrNull(summary.liveDeals ?? summary.live_deals) ?? 0,
      distinctPeople: numberOrNull(summary.distinctPeople ?? summary.people) ?? 0,
      companies: numberOrNull(summary.distinctCompanies ?? summary.companies ?? summary.companyCount) ?? 0,
      monthlyPayable: normalizeDashboardMoney(totalPayments),
      monthlySource: totalPayments?.source ?? summary.monthlyPayableSource ?? null,
      monthlySourceLabel: totalPayments?.sourceLabel ?? summary.monthlyPayableSourceLabel ?? null,
      paymentBreakdown: totalPayments?.breakdown ?? null,
      openFlaggedIssues: numberOrNull(summary.openFlaggedCount ?? summary.openFlaggedIssues ?? summary.openFlags) ?? 0,
    },
    trend: list(raw.timeline ?? raw.monthlyPayableTrend ?? raw.trend).map(normalizeTrendPoint),
    groups: list(raw.groupPayments ?? raw.groupTotals ?? raw.groupPerformance ?? raw.groups).map(normalizeGroup),
    stages: list(raw.stageAggregates ?? raw.dealsByStage ?? raw.stages).map(normalizeStage)
      .filter((stage) => ['paying', 'ended', 'not_started', 'not_paying_yet'].includes(stage.key)),
    paymentComparison: normalizeComparison(
      raw.paymentComparison ?? summary.monthlyPayable?.comparison ?? summary.paymentComparison,
    ),
    forecastPerformance: normalizeForecastPerformance(raw.forecastPerformance ?? raw.forecastComparison),
    paymentMethods: list(raw.paymentMethodSplit ?? raw.paymentMethods).map((method) => ({
      name: String(method.name ?? method.method ?? method.paymentMethod ?? ''),
      count: numberOrNull(method.count ?? method.deals) ?? 0,
      payable: normalizeDashboardMoney(method.totals ?? method.payable ?? method.monthlyPayable),
    })),
    health: raw.snapshotHealth ?? raw.dataHealth ?? raw.snapshot ?? {},
    options: {
      months: normalizeMonthOptions(options.months),
      ranges: normalizeOptions(options.ranges),
      forecastHorizons: normalizeOptions(options.forecastHorizons),
      currencyModes: normalizeOptions(options.currencyModes),
      groups: normalizeOptions(options.groups),
      companies: normalizeOptions(options.companies),
      people: normalizeOptions(options.people),
      paymentMethods: normalizeOptions(options.paymentMethods ?? options.methods),
      currencies: normalizeOptions(options.currencies),
    },
    upcoming: {
      returned: starts !== undefined || ends !== undefined,
      starts: list(starts).map(normalizeUpcoming),
      ends: list(ends).map(normalizeUpcoming),
    },
    recentChanges: {
      rows: list(Array.isArray(changes) ? changes : changes.rows ?? changes.items).map(normalizeChange),
      total: numberOrNull(changes.total) ?? list(Array.isArray(changes) ? changes : changes.rows ?? changes.items).length,
      page: numberOrNull(changes.page) ?? 1,
      pageSize: numberOrNull(changes.pageSize) ?? 10,
    },
    recentDeals: list(raw.recentDeals?.rows ?? raw.recentDeals?.items ?? raw.recentDeals).map(normalizeRecentDeal),
  };
}

export function dashboardQueryParams(filters) {
  const currencyMode = CURRENCY_MODES.has(filters.currencyMode) ? filters.currencyMode : 'usd';
  return {
    range: filters.range,
    fromMonth: filters.range === 'custom' ? filters.fromMonth : undefined,
    toMonth: filters.range === 'custom' ? filters.toMonth : undefined,
    forecastHorizon: filters.forecastHorizon,
    month: filters.month || undefined,
    group: list(filters.groups).join(','),
    company: filters.company || undefined,
    person: filters.person || undefined,
    paymentMethod: filters.paymentMethod || undefined,
    ...(filters.currency ? { currency: filters.currency } : {}),
    currencyMode,
    q: filters.q || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

// ***************************************************
// * THE DASHBOARD'S OWN DEFAULTS, so a prefetch cannot miss them
// ***************************************************
//
// The boot screen warms the first page of every page you land on, and a
// prefetch whose key differs by one field warms a cache entry the page
// never reads: the screen is slower for the work rather than faster, and
// nothing anywhere says so.
//
// The other three entries in DianeBoot's PREFETCH copy their defaults from
// the hooks and apologise for it in a comment. This one does not have to.

export const DEFAULT_RANGE = 'last3';
export const DEFAULT_FORECAST = '1';
// USD, because the four cards compare months and months hold different
// currencies. And four recent changes, which is what the panel shows.
export const DASHBOARD_REQUEST = Object.freeze({
  currencyMode: 'usd', q: '', page: 1, pageSize: 4,
});
const MONTHS_BACK = 5;

/** What the page asks for before anybody has changed a filter. */
export function defaultDashboardFilters(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_BACK, 1));
  return {
    range: DEFAULT_RANGE,
    fromMonth: from.toISOString().slice(0, 7),
    toMonth: now.toISOString().slice(0, 7),
    forecastHorizon: DEFAULT_FORECAST,
    groups: [],
    paymentMethod: '',
  };
}

/**
 * The cache key the page will ask for on a fresh sign-in.
 *
 * STORED FILTERS ARE A MISS, and deliberately: somebody who has narrowed
 * the dashboard to one group gets their own request when they land. The
 * prefetch is for the common case, not a guarantee.
 */
export function dashboardCacheKey() {
  return ['dashboard', dashboardQueryParams({ ...defaultDashboardFilters(), ...DASHBOARD_REQUEST })];
}
