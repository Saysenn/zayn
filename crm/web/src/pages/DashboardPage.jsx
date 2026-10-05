import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TrendText from '../components/badges/TrendText';
import Button from '../components/buttons/Button';
import BarChart from '../components/display/BarChart';
import ChartLegend from '../components/display/ChartLegend';
import Donut from '../components/display/Donut';
import NormalizedMoney from '../components/display/NormalizedMoney';
import KpiArt from '../components/display/KpiArt';
import SourceTrendChart from '../components/display/SourceTrendChart';
import { Skeleton } from '../components/display/Skeleton';
import FloatingField from '../components/forms/FloatingField';
import Select from '../components/forms/Select';
import ViewToggle from '../components/layout/ViewToggle';
import PageHeader from '../components/layout/PageHeader';
import { ErrorState } from '../components/display/StateBlocks';
import {
  BriefcaseIcon, BuildingIcon, ChevronIcon, CoinsIcon, DollarIcon, FilterIcon, ReceiptIcon,
  UsersIcon, WalletIcon,
} from '../components/icons';
import {
  BAR_TONES, CHART_SWATCH, DASH_LIFT, DASH_SURFACE, KPI_SURFACES, KPI_TONES, seriesInk, STAGE_TONES,
} from '../configs/dashboardTheme';
import { LINK_FILTER } from '../configs/linkFilters';
import {
  PERIOD_FOR_STAGE, defaultDashboardFilters, DASHBOARD_REQUEST,
  DEFAULT_RANGE as SHARED_DEFAULT_RANGE, DEFAULT_FORECAST as SHARED_DEFAULT_FORECAST,
} from '../helpers/dashboard';
import {
  formatMoney, formatMoneyCode, formatMoneyWhole, formatNumber,
} from '../helpers/formatMoney';
import { monthLabel } from '../helpers/monthLabel';
import { finite, trimEdges } from '../helpers/sourceTrend';
import { useDashboard } from '../hooks/useDashboard';
import useDismissable from '../hooks/useDismissable';
import { useDurableState } from '../hooks/useDurableState';
import { useClearSticky, useStickyState } from '../hooks/useStickyState';
import { FIELD_LABELS } from '../components/history/HistoryList';

/**
 * ===============================
 * * A RANGE IS MONTHS OF HISTORY, AND THIS MONTH IS ONE OF THEM
 * ===============================
 * It meant months BACK, so "3 months" drew June, July, August, September
 * and October: five points under a label saying three. Reversed 2026-09-09
 * once the forecast became a constant.
 *
 *     3 months = the two before this one, and this one
 *     + one forecast month, always
 *
 * A DELIBERATE MIRROR of RANGE_OPTIONS and MONTHS_OF_HISTORY in
 * api/v1/dashboard/buildDashboard.js. The server is authoritative and
 * serves its own list; this is what the control draws before the first
 * response lands. `yearToDate` and `custom` left both lists and still
 * resolve, so a saved link keeps working.
 */
const RANGE_OPTIONS = [
  { value: 'last1', label: '1 month' },
  { value: 'last3', label: '3 months' },
  { value: 'last6', label: '6 months' },
  { value: 'last12', label: '12 months' },
];
const MONTHS_OF_HISTORY = { last1: 1, last3: 3, last6: 6, last12: 12 };

// FIXED AT ONE, so it is not a control. It was a 1/3/6/12 knob, and that
// knob is half of why the range was unreadable: a label saying 3 beside a
// horizon nobody had looked at drew anywhere between four and fifteen
// points. See the server's FORECAST_MONTHS.
const FORECAST_OPTIONS = [{ value: '1', label: '1 month' }];
const EMPTY_OPTIONS = { months: [], ranges: [], forecastHorizons: [], groups: [], paymentMethods: [] };

/**
 * THE WINDOW IN REAL MONTH NAMES, e.g. "Jul, Aug, Sep, and Oct forecast".
 *
 * Computed from today rather than from the response, so it is right before
 * the first request lands and while a draft filter is being changed but not
 * yet applied.
 */
function windowLabel(range) {
  const history = MONTHS_OF_HISTORY[range];
  if (!history) return '';
  const now = new Date();
  const at = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const past = Array.from({ length: history }, (_, i) => at(i - (history - 1)));
  return `${past.join(', ')}, and ${at(1)} forecast`;
}
const DEFAULT_RANGE = SHARED_DEFAULT_RANGE;
// ONE MONTH AHEAD. Forecasting is the past months, this one, and next. It
// was three, which put a quarter of invented months on every chart and made
// the trend look like it was mostly forecast.
const DEFAULT_FORECAST = SHARED_DEFAULT_FORECAST;
// The dollar, for every figure the CONVERTED view writes. The request is
// always made in usd mode, because that is the one that returns BOTH shapes.
const CURRENCY = 'USD';
const CURRENCY_MODE = DASHBOARD_REQUEST.currencyMode;
// ===============================
// * TWO WAYS TO READ THE SAME MONEY
// ===============================
// CONVERTED is one figure everything can be compared on. RAW is what is
// actually owed, in the currencies it is owed in, and it is the view that
// is always complete: a missing rate silently shortens a converted total
// and can never shorten this one.
//
// Both shapes already travel in every response, so this is a display switch
// and not a refetch. See `money()` in buildDashboard.
const CONVERTED = 'usd';
const RAW = 'native';
const AMOUNT_OPTIONS = [
  { value: RAW, label: 'Show each currency', Icon: CoinsIcon },
  { value: CONVERTED, label: 'Convert to USD', Icon: DollarIcon },
];
// ===============================
// * ALL IS NOT A CURRENCY
// ===============================
// The raw picker's one non currency value. It draws every currency at once
// rather than one, so it can never be passed to `valueIn` as a code: guard
// with `everyCurrency` first. Not a code any sheet could carry, so it can
// never collide with one.
const ALL = '*all';
// The months a group's All breakdown lists before it stops and counts the
// rest into the range total. Three currencies over a year is 36 rows.
const MONTHS_IN_POPUP = 4;
const RECENT_DEALS_SHOWN = 6;
// FOUR, and it sets the row's height. Recent Changes is the tallest panel in
// its row, so the fifth line was paid for twice: once here and again as blank
// card above and below Payment Overview's chart beside it. It is also the
// request's `pageSize`, so a row dropped here is a row not fetched.
const RECENT_CHANGES_SHOWN = DASHBOARD_REQUEST.pageSize;
// Every panel body starts flush under its own header, so the panels in a row
// line their content up instead of each choosing a top padding.
const PANEL_BODY = 'px-4 pb-4 pt-0';
const CHART_FILL = 'min-h-[168px] flex-1 justify-center';
const DONUT_SIZE = 112;
// The trend chart keeps its aspect ratio, so this is the viewBox height that
// makes it sit near the height of the panels beside it.
const TREND_HEIGHT = 210;
const FILTER_KEY = 'dashboard.filters.v3';

// ===============================
// * WHAT EACH FILTER ACTUALLY MOVES
// ===============================
// Two of the four change every figure on the page; two change only the
// panels that span months. Nobody could tell which from the controls, so
// each one says so on its own info icon.
// Plain strings: FloatingField passes a hint to CellInfo as children, and
// only its `body` prop reads markup.
const FILTER_HINTS = Object.freeze({
  range: 'Months of history on Payment Overview and Group Overview, THIS MONTH INCLUDED. Next month is always drawn on top as a forecast, so 3 months is four points. Reaching further back than the saved snapshots go draws those months as a gap rather than hiding them. The four cards always report the current month.',
  forecastHorizon: 'Always next month, and it cannot be changed. One month of forecast keeps the invented figure to a corner of the chart; at three it was a quarter of the line and the trend read as mostly forecast.',
  groups: 'Restricts the whole page: all four cards, every panel and the deal list.',
  paymentMethod: 'Restricts the whole page to deals paid this way: all four cards, every panel and the deal list.',
});

// MOVED TO helpers/dashboard.js, so DianeBoot's prefetch asks for exactly
// what this page asks for. A key that differs by one field warms a cache
// entry nobody reads.
const initialFilters = defaultDashboardFilters;

// ===============================
// * ONLY WHAT DIFFERS FROM THE DEFAULTS IS REMEMBERED
// ===============================
// The whole filter object used to be stored, so a stored horizon of 3
// outlived the day the default became 1: the dashboard kept forecasting to
// December for anyone who had opened it before. A session now remembers
// what it CHANGED, and inherits every default it never touched.
function changedOnly(filters) {
  const defaults = initialFilters();
  return Object.fromEntries(Object.entries(filters).filter(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(defaults[key]),
  ));
}

function timestamp(value) {
  if (!value) return 'Recently';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const minutes = Math.floor(Math.max(0, Date.now() - parsed.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function pointMoney(point) {
  if (!point) return null;
  if (point.source === 'savedActual') return point.actual;
  if (point.source === 'liveEstimate') return point.estimate;
  if (point.source === 'projectedForecast') return point.forecast;
  return null;
}

// USD or nothing. `usd: null` means no rate was available, which is not the
// same as zero and must never print as one.
function usdText(money, whole = false) {
  const value = money?.usd;
  if (value === null || value === undefined) return 'USD unavailable';
  return whole ? formatMoneyWhole(value, CURRENCY) : formatMoney(value, CURRENCY);
}

/**
 * ===============================
 * * ONE PLACE DECIDES WHICH NUMBER A CHART IS PLOTTING
 * ===============================
 * Converted is one figure. RAW IS SEVERAL, and an axis carries one unit:
 * GBP 80,850, AED 54,342 and EURO 3,510 cannot share a scale, a bar or a
 * percentage. So raw plots ONE currency at a time and the panel says which.
 */
function valueIn(money, mode, picked) {
  if (mode === CONVERTED) return money?.usd ?? null;
  const amount = money?.native?.[picked];
  return Number.isFinite(Number(amount)) ? Number(amount) : null;
}

function textIn(money, mode, picked, whole = false) {
  if (mode === CONVERTED) return usdText(money, whole);
  const amount = valueIn(money, mode, picked);
  if (amount === null) return `No ${picked}`;
  return whole ? formatMoneyWhole(amount, picked) : formatMoney(amount, picked);
}

/**
 * Every currency present across the range, biggest first, so the picker
 * opens on the one that carries the money rather than alphabetically on the
 * one that carries 3,510.
 */
function currenciesIn(points) {
  const totals = new Map();
  for (const point of points) {
    for (const [code, amount] of Object.entries(point?.actual?.native ?? {})) {
      totals.set(code, (totals.get(code) ?? 0) + Math.abs(Number(amount) || 0));
    }
    for (const [code, amount] of Object.entries(point?.estimate?.native ?? {})) {
      totals.set(code, (totals.get(code) ?? 0) + Math.abs(Number(amount) || 0));
    }
    for (const [code, amount] of Object.entries(point?.forecast?.native ?? {})) {
      totals.set(code, (totals.get(code) ?? 0) + Math.abs(Number(amount) || 0));
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

// Where the CODE is already the row's own label, the amount is bare:
// "EURO   EURO 3,510" was the same word twice on one line.
function bareIn(money, code, whole = false) {
  const amount = valueIn(money, RAW, code);
  return amount === null ? 'None' : formatNumber(amount, whole ? 0 : 2);
}

function missingFxOf(money) {
  return money?.missingFx?.length ? `Excludes ${money.missingFx.join(', ')}: no exchange rate` : null;
}

// ===============================
// * ONE SHAPE FOR A CHANGE, WHATEVER THE TWO FIGURES ARE
// ===============================
// A converted total against a converted total, or one currency's column
// against its own. Written once, or the card and the panel round the same
// move differently. A previous of zero has no percentage: everything over
// nothing is not a rise of any size.
function changeBetween(now, before, comparedMonth) {
  if (!finite(now) || !finite(before)) return null;
  const difference = Number(now) - Number(before);
  return {
    direction: difference > 0 ? 'higher' : difference < 0 ? 'lower' : 'unchanged',
    difference,
    percentage: Number(before) === 0 ? null : (difference / Math.abs(Number(before))) * 100,
    comparedMonth,
  };
}

function compareMoney(current, previous, comparedMonth) {
  if (!current || !previous) return null;
  return changeBetween(current.usd, previous.usd, comparedMonth);
}

// ===============================
// * A PERCENTAGE PER CURRENCY IS EXACT, AND NEEDS NO RATE
// ===============================
// "No ratio survives into raw" is about a ratio ACROSS currencies: three
// numerators over three denominators in three units is not one figure. A
// currency against its own last month is one figure over another in the
// same unit, so raw can carry it, the way it already carries the per
// currency difference.
//
// A currency in one month and not the other is a real move from or to
// zero, so it is listed rather than skipped.
function compareNative(current, previous, comparedMonth) {
  const codes = [...new Set([
    ...Object.keys(current?.native ?? {}),
    ...Object.keys(previous?.native ?? {}),
  ])].sort();
  return codes
    .map((code) => ({
      code,
      change: changeBetween(current?.native?.[code] ?? 0, previous?.native?.[code] ?? 0, comparedMonth),
    }))
    .filter((row) => row.change);
}

// ===============================
// * ONE ROW PER CURRENCY, AND THE COLUMNS LINE UP
// ===============================
// Raw listed the three totals, then listed the three CODES again underneath
// to carry the percentages, and wrapped "vs last month" onto a line of its
// own. Code, amount and change belong on the same row: the code is said
// once, the amounts align on their digits rather than on their first
// letter, and the card gets its height back.
//
// The amount is BARE (`bareIn`): the code is already the row's own label,
// and "EURO  EURO 3,510.00" is the same word twice on one line.
function NativeTotals({ money, changes }) {
  const codes = Object.keys(money?.native ?? {}).sort((a, b) => a.localeCompare(b));
  if (codes.length === 0) return <span>Not available</span>;
  const changeFor = (code) => changes?.find((row) => row.code === code)?.change ?? null;
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2.5 gap-y-1">
      {codes.map((code) => (
        <Fragment key={code}>
          <span className="text-xs font-semibold uppercase text-text-muted">{code}</span>
          <span className="text-right tabular-nums">{bareIn(money, code)}</span>
          {/* Empty rather than "No previous comparison": in a column three
              rows tall that sentence is longer than the figures it sits by. */}
          <span className="justify-self-end">
            {changeFor(code) && <TrendText comparison={changeFor(code)} against={null} />}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

// ===============================
// * A KPI CARD IS SMALL AND QUIET
// ===============================
// The figure was 1.55rem and ran out of the card the moment a total passed
// six digits. The amounts are never abbreviated, so the type gives way
// instead of the number.
/**
 * `dense` is for the one card that shows SEVERAL figures.
 *
 * At the hero size three currencies stacked ran to three tall lines, and
 * because the grid stretches a row to its tallest card, the other three grew
 * with it. A figure among figures does not need to be the biggest thing on
 * the page: it needs to be readable and to leave the row alone.
 */
function KpiCard({ icon: Icon, tone, label, value, comparison, detail, note, dense, to, onClick }) {
  const goes = Boolean(to || onClick);
  const body = (
    <>
      <KpiArt tone={tone} />
      {/* `relative`, so the content sits over the artwork rather than under
          it. Everything below is the card as it was. */}
      <div className="relative">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${KPI_TONES[tone]}`}><Icon width={18} height={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text-muted">{label}</p>
            {/* No `title` attribute. The figure is fully visible, so the
                browser's own tooltip just repeated it under the number.
                A step down on a phone: "$128,156.82" at 20px does not fit
                a card that is now the full width of a 375px screen. */}
            <div className={`mt-0.5 truncate font-bold leading-tight tracking-tight tabular-nums text-text ${dense ? 'text-sm' : 'text-base sm:text-xl'}`}>{value}</div>
          </div>
        </div>
        <div className="mt-3 flex min-h-7 items-end justify-between gap-2">
          <span className="min-w-0">
            {comparison ? <TrendText comparison={comparison} /> : <span className="text-xs text-text-faint">{detail}</span>}
            {note && <span className="mt-1 block text-xs text-warning">{note}</span>}
          </span>
          {/* The whole card has always been clickable and nothing said so.
              Decorative: the card itself is the control. */}
          {goes && (
            <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition group-hover:translate-x-0.5 motion-reduce:transform-none ${KPI_TONES[tone]}`}>
              <ChevronIcon width={14} height={14} />
            </span>
          )}
        </div>
      </div>
    </>
  );
  const classes = `${DASH_SURFACE} ${DASH_LIFT} ${KPI_SURFACES[tone]} group relative block w-full overflow-hidden p-3.5 text-left no-underline`;
  if (onClick) return <button type="button" onClick={onClick} className={classes}>{body}</button>;
  if (to) return <Link to={to} className={classes}>{body}</Link>;
  return <article className={classes}>{body}</article>;
}

// A PANEL BODY FILLS THE PANEL. The grid stretches every panel in a row to
// the tallest one, and a body sized to its content left the difference as
// white space under the chart.
//
// NO BACKGROUND ARTWORK IN HERE. Faint concentric arcs were drawn behind the
// two quiet panels to fill them; they read as noise behind a figure and came
// straight back out. A panel is white. The KPI cards keep their drawings:
// those sit on a tint and exist to tell four cards apart.
function Panel({ title, action, children, className = '', bodyClassName = PANEL_BODY }) {
  return (
    <section className={`${DASH_SURFACE} flex min-w-0 flex-col overflow-hidden ${className}`}>
      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
        <h2 className="truncate text-sm font-bold text-text">{title}</h2>
        {action}
      </div>
      <div className={`flex min-h-0 flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  );
}

const PanelNote = ({ children }) => <span className="shrink-0 text-xs text-text-faint">{children}</span>;

/**
 * ===============================
 * * IN RAW, A CHART SAYS WHICH CURRENCY IT IS DRAWING
 * ===============================
 * An axis carries one unit. Rather than stack three incomparable scales or
 * quietly show one and let it be mistaken for the total, the panel names
 * the currency and lets it be changed. Converted needs no picker, so there
 * is none: it is one figure by definition.
 *
 * ===============================
 * * ONE PANEL CAN DRAW ALL, THE OTHER CANNOT, SO THEY DO NOT SHARE A LIST
 * ===============================
 * `allowAll` is off for the bars. Three lines share a plot honestly; five
 * groups over three months in three currencies is forty five bars on one
 * axis, and EURO at 3,510 beside GBP at 80,850 is a 2px stub in every
 * group. The panel used to offer All and then quietly fall back to the
 * biggest currency, reporting it in a caption underneath.
 */
function ChartUnit({ mode, note, currencies, picked, onPick, allowAll = true }) {
  if (mode === CONVERTED) return <PanelNote>{note}, USD</PanelNote>;
  if (currencies.length <= 1) return <PanelNote>{note}, {picked ?? 'no currency'}</PanelNote>;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <PanelNote>{note}</PanelNote>
      <Select
        size="sm"
        className="w-24"
        label="Currency"
        options={[
          ...(allowAll ? [{ value: ALL, label: 'All' }] : []),
          ...currencies.map((code) => ({ value: code, label: code })),
        ]}
        value={picked ?? ''}
        onChange={onPick}
      />
    </div>
  );
}

function chartRows(points, mode, picked) {
  return points.map((point) => ({
    label: monthLabel(point.month), month: point.month,
    actual: valueIn(point.actual, mode, picked),
    estimate: valueIn(point.estimate, mode, picked),
    forecast: valueIn(point.forecast, mode, picked),
    unavailable: point.unavailable, source: point.source, sourceLabel: point.sourceLabel,
    reason: point.reason, groups: point.groups, total: pointMoney(point),
  }));
}

/**
 * ===============================
 * * ALL: ONE SERIES PER CURRENCY, TRIMMED AS ONE
 * ===============================
 * Each currency is its own line, but they share the month axis, so the
 * empty ends are found across ALL of them and every series is cut at the
 * same two indexes. Trimming each on its own would slide the lines apart:
 * a EURO series starting a month later would draw its first point over
 * August while the GBP line drew July there.
 */
function currencySeries(points, currencies) {
  const sets = currencies.map((code) => ({ code, rows: chartRows(points, RAW, code) }));
  const filled = points.map((_, index) => sets.some(({ rows }) => finite(rows[index].actual) || finite(rows[index].estimate) || finite(rows[index].forecast)));
  const first = filled.indexOf(true);
  if (first === -1) return [];
  return sets.map(({ code, rows }) => ({ code, rows: rows.slice(first, filled.lastIndexOf(true) + 1) }));
}

// On the dark tooltip, so every ink here is light.
function MonthTooltip({ row, mode, picked }) {
  const unit = mode === CONVERTED ? 'USD' : picked;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-surface/15 pb-2">
        <div><p className="text-xs font-bold">{row.label}</p><p className="text-xs text-surface/60">Income in {unit}</p></div>
        <strong className="text-xs tabular-nums text-accent">{textIn(row.total, mode, picked, true)}</strong>
      </div>
      <div className="mt-2 space-y-1">
        {row.groups.map((group) => (
          <div key={group.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-surface/70">{group.name || 'No group'}</span>
            <span className="shrink-0 font-semibold tabular-nums">{textIn(group.payable, mode, picked, true)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-surface/15 pt-1.5 text-xs font-bold">
          {/* TOTAL, NOT "ALL GROUPS". There is a real group CALLED
              `ALL GROUPS` (the twelve NA roster rows), so a total row of
              that name sat among the group rows it was summing. Same rule
              the export modal already records. */}
          <span>Total</span><span className="tabular-nums">{textIn(row.total, mode, picked, true)}</span>
        </div>
      </div>
    </div>
  );
}

// The All popup. It names the LINES, not the groups: with three currencies
// across five groups the group list would be fifteen rows, and Group
// Comparison is the panel that breaks a month down by group.
function AllMonthsTooltip({ row, currencies }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-surface/15 pb-2">
        <p className="text-xs font-bold">{row.label}</p>
        <span className="shrink-0 text-xs text-surface/60">{row.sourceLabel ?? 'No data'}</span>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {currencies.map((code, order) => (
          <div key={code} className="flex items-center justify-between gap-3">
            <dt className="flex min-w-0 items-center gap-1.5 text-surface/70">
              <i className={CHART_SWATCH} style={{ background: seriesInk(order) }} />
              <span className="truncate">{code}</span>
            </dt>
            <dd className="shrink-0 font-semibold tabular-nums">{bareIn(row.total, code, true)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Every group the view knows about: the page's own list, plus any that only
// turn up on a month. One definition, because the bars and the popups have
// to agree about which groups exist.
function groupNamesIn(groups, points) {
  return [...new Set([
    ...groups.map((group) => group.name),
    ...points.flatMap((point) => point.groups.map((group) => group.name)),
  ])];
}

// ===============================
// * ONE LINE IS ONE CURRENCY, SO ITS POPUP IS THAT CURRENCY BY GROUP
// ===============================
// Under All the popup listed the same three currency totals whichever line
// the pointer was on, so three lines had one answer between them and none
// of them said which groups it was made of.
//
// EVERY GROUP IS LISTED, ZERO INCLUDED. A group left out is impossible to
// tell from a group that earned nothing, and which of the two it is happens
// to be the question. Zeros are dimmed, never dropped.
//
// EVERY AMOUNT NAMES ITS CURRENCY. The rows are labelled by GROUP, so a bare
// figure had nothing on its own line saying what it was and the header was
// the only place to find out. `formatMoneyWhole` gives the symbol where Intl
// knows one and the code where it does not, so GBP reads `£30,120` and the
// sheet's own `EURO`, which is not an ISO code, reads `EURO 1,510`.
//
// The other two popups label their rows BY CODE, so they stay bare: `EURO
// EURO 3,510` is what `bareIn` exists to stop.
function CurrencyGroupsTooltip({ row, code, names, ink }) {
  const rows = names.map((name) => ({
    name,
    value: valueIn(row.groups.find((group) => group.name === name)?.payable, RAW, code) ?? 0,
  }));
  const total = rows.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-surface/15 pb-2">
        <div><p className="text-xs font-bold">{row.label}</p><p className="text-xs text-surface/60">{row.sourceLabel ?? 'No data'}</p></div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold">
          <i className={CHART_SWATCH} style={{ background: ink }} />{code}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {rows.length === 0 && <p className="m-0 text-surface/50">No groups in this view</p>}
        {rows.map((entry) => (
          <div key={entry.name || 'no-group'} className={`flex items-center justify-between gap-3 ${entry.value === 0 ? 'opacity-45' : ''}`}>
            <dt className="truncate text-surface/70">{entry.name || 'No group'}</dt>
            <dd className="m-0 shrink-0 font-semibold tabular-nums">{formatMoneyWhole(entry.value, code)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-surface/15 pt-1.5 font-bold">
          {/* See MonthTooltip: `ALL GROUPS` is a real group name. */}
          <dt>Total</dt>
          <dd className="m-0 tabular-nums text-accent">{formatMoneyWhole(total, code)}</dd>
        </div>
      </dl>
    </div>
  );
}

// `trimEdges`: "Past 3 months" asks for three whether a snapshot was ever
// saved for them, so the chart opened on two full height grey blocks.
function PaymentOverview({ points, groups, mode, picked, currencies }) {
  const everyCurrency = picked === ALL;
  const all = chartRows(points, mode, everyCurrency ? currencies[0] : picked);
  const rows = trimEdges(all);
  const series = everyCurrency ? currencySeries(points, currencies) : null;
  const drawn = series ? (series[0]?.rows ?? []) : rows;
  // SAY WHAT THE RANGE ASKED FOR AND DID NOT GET. Reaching back further
  // than the snapshots go looked like the filter had stopped working.
  const dropped = points.length - drawn.length;
  const names = groupNamesIn(groups, points);
  // The same ink the line is drawn in, off the same ordered list, so the
  // popup's dash can never name a different line from the one hovered.
  const inkFor = (code) => seriesInk(Math.max(currencies.indexOf(code), 0));
  const missingFx = [...new Set(points.flatMap((point) => [...point.actual.missingFx, ...point.estimate.missingFx, ...point.forecast.missingFx]))];
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      {/* Only a CONVERTED total can be short. Raw never converts, so it
          can never silently drop a currency and the warning would be a lie. */}
      {mode === CONVERTED && missingFx.length > 0 && <p className="mb-1.5 rounded-md bg-warning-tint px-2.5 py-1.5 text-xs text-warning">USD subtotal excludes {missingFx.join(', ')}: no exchange rate is available.</p>}
      <SourceTrendChart
        rows={rows}
        series={series}
        currency={mode === CONVERTED ? CURRENCY : everyCurrency ? null : picked}
        title="Payment overview"
        height={TREND_HEIGHT}
        // `code` is the line the pointer is on. Without one the whole month
        // was asked about, which is where the keyboard lands.
        tooltip={(row, index, code) => {
          if (!everyCurrency) return <MonthTooltip row={row} mode={mode} picked={picked} />;
          if (!code) return <AllMonthsTooltip row={row} currencies={currencies} />;
          return <CurrencyGroupsTooltip row={row} code={code} names={names} ink={inkFor(code)} />;
        }}
      />
      {/* A SHARED AXIS IS THE PRICE OF ONE LINE PER CURRENCY. 3,510 beside
          80,850 is a flat line at the bottom, so say where to go instead. */}
      {everyCurrency && <p className="mt-1 text-xs text-text-faint">One line per currency on a shared scale. Pick a currency to read a small one on its own.</p>}
      {dropped > 0 && (
        <p className="mt-1 text-xs text-text-faint">
          Starts at {drawn[0]?.label ?? 'the first saved month'}: {dropped} earlier {dropped === 1 ? 'month has' : 'months have'} no saved snapshot.
        </p>
      )}
    </div>
  );
}

// A month is drawn in the colour of what it IS, the same three kinds the
// trend chart names: a saved month, this month, a forecast.
const MONTH_TONE = { savedActual: 'soft', liveEstimate: 'strong', projectedForecast: 'ghost' };

// And the key for them, read by BOTH month charts. The swatch is DERIVED
// from the tone rather than written beside it: a swatch naming a colour it
// does not share is worse than no swatch at all.
//
// `step` is where that word says the month SITS, against the current one.
// `plural` is what the entry falls back to when it covers more than that
// one month. See monthBarsKey.
const MONTH_BARS_KEY = [
  { key: 'saved', tone: 'soft', label: 'Last month', plural: 'Earlier months', step: -1 },
  { key: 'thisMonth', tone: 'strong', label: 'Current month' },
  { key: 'forecast', tone: 'ghost', label: 'Next month', plural: 'Later months', step: 1 },
].map((item) => ({ ...item, swatch: BAR_TONES[item.tone] }));

// The same three marks as a dot on a list row, so a month reads the same
// whether it is a bar, a swatch in a key, or a row in the month on month.
const SWATCH_FOR = Object.fromEntries(MONTH_BARS_KEY.map((item) => [item.tone, item.swatch]));

// And the same three WORDS, keyed by which month it is rather than by tone:
// an unprojected next month is drawn `soft` and would read "Last month".
const WORD_FOR = Object.fromEntries(MONTH_BARS_KEY.map((item) => [item.key, item.label]));

// ===============================
// * THE KEY SAYS WHICH MONTH, NOT WHICH KIND OF MONTH
// ===============================
// "Saved, This month, Forecast" left the reader working out which bar was
// August, and naming the months outright dated a key that sits beside a
// panel note already carrying the range. Last, current, next: it rolls with
// the calendar and needs nothing rewritten.
//
// A tone with no month in the range DROPS OUT rather than naming nothing.
function monthOffset(month, offset) {
  const [year, index] = String(month).split('-').map(Number);
  if (!year || !index) return null;
  return new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 7);
}

function monthBarsKey(points) {
  const current = points.find((point) => MONTH_TONE[point.source] === 'strong')?.month ?? null;
  return MONTH_BARS_KEY
    .map((item) => {
      const months = points.filter((point) => MONTH_TONE[point.source] === item.tone).map((point) => point.month);
      if (months.length === 0) return { ...item, label: null };
      // "LAST MONTH" HAS TO BE LAST MONTH. Three months of history draws two
      // saved bars, and a range with a gap in it draws one that is older
      // than it looks: both are earlier months, not the previous one.
      const adjacent = months.length === 1 && (!item.step || months[0] === monthOffset(current, item.step));
      return { ...item, label: adjacent || !item.plural ? item.label : item.plural };
    })
    .filter((item) => item.label);
}

// The dark popup a bar hangs off. It carries every month for that group, so
// a panel too narrow to caption them all is still readable one bar at a time.
function GroupTooltip({ bar, unit }) {
  const total = bar.values.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-surface/15 pb-2">
        <p className="truncate text-xs font-bold">{bar.label}</p>
        <span className="shrink-0 text-xs text-surface/60">{bar.detail.deals} {bar.detail.deals === 1 ? 'deal' : 'deals'}</span>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {bar.values.map((entry) => (
          <div key={entry.key} className="flex items-center justify-between gap-3">
            <dt className="truncate text-surface/70">{entry.label}</dt>
            <dd className="shrink-0 font-semibold tabular-nums">{formatMoney(entry.value, unit)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-surface/15 pt-1.5 font-bold">
          <dt>Across the range</dt>
          <dd className="tabular-nums text-accent">{formatMoney(total, unit)}</dd>
        </div>
      </dl>
    </div>
  );
}

// ===============================
// * THE POPUP CARRIES WHAT THE BARS CANNOT
// ===============================
// The bars stay in ONE currency. Five groups over three months in three
// currencies is forty five bars, which is not a comparison, so the height
// keeps meaning one thing and the popup does the breaking down: every month
// in every currency, then the range totalled per currency. Nothing is added
// across currencies anywhere in here.
//
// EVERY CURRENCY, ZERO INCLUDED, dimmed rather than dropped. A currency left
// out is impossible to tell from one that earned nothing, and the same rule
// already governs the group rows in CurrencyGroupsTooltip.
function GroupBreakdownTooltip({ bar, currencies }) {
  const totals = currencies.map((code) => ({
    code,
    total: bar.values.reduce((sum, entry) => sum + (entry.breakdown?.[code] ?? 0), 0),
  }));
  // A year of history in three currencies is thirty six rows, which is
  // taller than the screen. The months are the part that can be trimmed:
  // the range total below is what nobody can work out for themselves.
  const shown = bar.values.slice(0, MONTHS_IN_POPUP);
  const hidden = bar.values.length - shown.length;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-surface/15 pb-2">
        <p className="truncate text-xs font-bold">{bar.label}</p>
        <span className="shrink-0 text-xs text-surface/60">{bar.detail.deals} {bar.detail.deals === 1 ? 'deal' : 'deals'}</span>
      </div>
      <dl className="mt-2 space-y-2 text-xs">
        {shown.map((entry) => (
          <div key={entry.key}>
            <dt className="text-xs uppercase tracking-wide text-surface/50">{entry.label}</dt>
            {currencies.length === 0 && <dd className="text-surface/50">Nothing owed</dd>}
            {currencies.map((code) => {
              const amount = entry.breakdown?.[code] ?? 0;
              return (
                <dd key={code} className={`flex items-center justify-between gap-3 ${amount === 0 ? 'opacity-45' : ''}`}>
                  <span className="truncate text-surface/70">{code}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatNumber(amount)}</span>
                </dd>
              );
            })}
          </div>
        ))}
      </dl>
      {hidden > 0 && <p className="mt-1.5 text-xs text-surface/50">and {hidden} more {hidden === 1 ? 'month' : 'months'}, counted below</p>}
      <div className="mt-2 border-t border-surface/15 pt-1.5 text-xs">
        <p className="mb-1 font-bold">Across the range</p>
        {totals.length === 0
          ? <p className="text-surface/50">Nothing owed</p>
          : totals.map(({ code, total }) => (
            <p key={code} className={`flex items-center justify-between gap-3 ${total === 0 ? 'opacity-45' : ''}`}>
              <span className="text-surface/70">{code}</span>
              <span className="font-semibold tabular-nums text-accent">{formatNumber(total)}</span>
            </p>
          ))}
      </div>
    </div>
  );
}

// ===============================
// * ONE BAR PER MONTH, PER GROUP
// ===============================
// It was this month against last month only, in a panel that sat beside a
// near identical one. It is every month in the range now, so the comparison
// the range asks for is the comparison the chart draws. The plot scrolls
// sideways rather than squeezing a quarter's worth of bars into a card.
function PaymentGroupBars({ points, groups, mode, picked, currencies }) {
  // ONE UNIT, ALWAYS. The picker beside the title offers no All, so nothing
  // in here falls back to a currency nobody chose.
  const unit = mode === CONVERTED ? CURRENCY : picked;
  const months = trimEdges(points).filter((point) => !point.unavailable);
  const payableFor = (point, name) => point.groups.find((group) => group.name === name)?.payable;
  const valueFor = (point, name) => valueIn(payableFor(point, name), mode, unit) ?? 0;
  const breakdownFor = (point, name) => Object.fromEntries(currencies.map((code) => [code, valueIn(payableFor(point, name), RAW, code) ?? 0]));
  const names = groupNamesIn(groups, months);
  // A group paid only in EURO must not vanish from a panel drawn in GBP, so
  // in raw this asks EVERY currency. Its bar is flat and its popup carries
  // the figures; dropping the group entirely says it does not exist.
  const carries = (name) => months.some((point) => (mode === CONVERTED
    ? valueFor(point, name) > 0
    : Object.values(breakdownFor(point, name)).some((amount) => amount > 0)));
  const visible = names.filter(carries);
  if (months.length === 0 || visible.length === 0) return <Empty text="No group payment data is available." />;

  return (
    <div className="flex min-h-[190px] flex-1 flex-col">
      <BarChart
        showValues={months.length === 1}
        caption={`Each group's payment for every month in the range, in ${unit}`}
        formatValue={(value) => formatMoneyWhole(value, unit)}
        // THE BARS CARRY ONE CURRENCY, THE POPUP CARRIES ALL OF THEM. An
        // axis has one unit; a list does not. Converted is one figure by
        // definition, so it gets the plain months popup.
        renderTooltip={(bar) => (mode === CONVERTED
          ? <GroupTooltip bar={bar} unit={unit} />
          : <GroupBreakdownTooltip bar={bar} currencies={currencies} />)}
        // No "Bars in GBP" caption any more: the picker beside the panel
        // title says it, and a caption reporting a default is not a control.
        legend={<ChartLegend items={monthBarsKey(months)} label="Group bars legend" />}
        bars={visible.map((name) => ({
          key: name || 'no-group',
          label: name || 'No group',
          to: `/master-sheet?${LINK_FILTER.group}=${encodeURIComponent(name)}`,
          detail: { deals: groups.find((group) => group.name === name)?.liveDeals ?? 0 },
          values: months.map((point) => ({
            key: point.month,
            label: monthLabel(point.month),
            value: valueFor(point, name),
            breakdown: mode === CONVERTED ? null : breakdownFor(point, name),
            tone: MONTH_TONE[point.source] ?? 'soft',
          })),
        }))}
      />
    </div>
  );
}

function MonthOnMonth({ performance, mode, lastMonth, next }) {
  if (!performance) return <Empty text="A previous comparable month is not available." />;
  const current = performance.actual.usd;
  const previous = performance.forecast.usd;

  /**
   * ===============================
   * * NO RATIO ACROSS CURRENCIES, EVER
   * ===============================
   * The panel leads with one percentage, and in raw there is no single
   * change to lead with: three numerators over three denominators in three
   * units is not one figure. So raw lists the figures and the per currency
   * difference instead, which needs no rate. An invented percentage would
   * be the worst of the three options.
   */
  if (mode === RAW) {
    /**
     * THE DIFFERENCE IS PER CURRENCY, because that is the only subtraction
     * that means anything here. One combined figure would need a rate, and
     * needing a rate is the thing raw exists to avoid. A currency present in
     * one month and not the other is a real move from or to zero, so it is
     * listed rather than skipped.
     */
    const codes = [...new Set([
      ...Object.keys(performance.actual?.native ?? {}),
      ...Object.keys(performance.forecast?.native ?? {}),
    ])].sort();
    const deltas = codes.map((code) => ({
      code,
      delta: (Number(performance.actual?.native?.[code]) || 0) - (Number(performance.forecast?.native?.[code]) || 0),
    }));

    return (
      <div className={`flex ${CHART_FILL} flex-col justify-center gap-2`}>
        <dl className="space-y-2 text-xs">
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
            <dt className="text-xs text-text-faint">{WORD_FOR.thisMonth}</dt>
            <dd className="text-right font-bold text-accent-strong"><NormalizedMoney money={performance.actual} display={RAW} compact /></dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
            <dt className="text-xs text-text-faint">{WORD_FOR.saved}</dt>
            <dd className="text-right font-semibold text-text-muted"><NormalizedMoney money={performance.forecast} display={RAW} compact /></dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-text-faint">Difference</dt>
            <dd className="space-y-0.5 text-right tabular-nums">
              {deltas.length === 0 && <span className="text-text-faint">Nothing to compare</span>}
              {deltas.map(({ code, delta }) => (
                <div key={code} className={`font-bold ${delta > 0 ? 'text-accent-strong' : delta < 0 ? 'text-danger' : 'text-text-muted'}`}>
                  {delta > 0 ? '+' : ''}{formatMoneyCode(delta, code)}
                </div>
              ))}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  // ===============================
  // * THE CHANGE ON TOP, THE MONTHS UNDER IT
  // ===============================
  // Built like Deals by Stage: one figure in the middle and the rows it is
  // made of underneath. What goes where the ring would is the CHANGE, not a
  // total, because that is the only thing this panel is for and every total
  // it could show is in the list below it anyway.
  //
  // A month with no figure is DROPPED, never listed as zero: no previous
  // month and no exchange rate are both real states, and zero is a claim.
  // THE SAME THREE WORDS THE GROUP KEY USES, and no date on any of them:
  // the panel note above already carries the span, so the rows repeated it
  // three times over. Keyed by which month the row IS, because the last of
  // them is drawn `soft` when it is not projected and would read "Last".
  const months = [
    { key: 'last', label: WORD_FOR.saved, value: previous, tone: 'soft' },
    { key: 'this', label: WORD_FOR.thisMonth, value: current, tone: 'strong' },
    ...(next ? [{ key: 'next', label: WORD_FOR.forecast, value: next.value, tone: next.forecast ? 'ghost' : 'soft' }] : []),
  ].filter((month) => finite(month.value));

  // Each row against the row above it, so the forecast says what it adds to
  // this month rather than repeating what this month added to the last.
  const rows = months.map((month, index) => ({
    ...month,
    change: index === 0 ? null : changeBetween(month.value, months[index - 1].value, months[index - 1].label),
  }));

  // The headline is derived from the two figures the card itself lists, so
  // it can never disagree with them. Its PERCENTAGE is the server's, the
  // same one the Payment card shows, so the two never round apart (1.3 vs 1.2).
  const derived = changeBetween(current, previous, lastMonth);
  const serverPercentage = performance.comparison?.percentage;
  const headline = derived && serverPercentage != null ? { ...derived, percentage: serverPercentage } : derived;

  return (
    <div className={`flex ${CHART_FILL} flex-col items-center gap-3`}>
      {/* `flex-1` on the headline, not `mt-auto` on the list. An auto margin
          hands ALL the spare height to one gap, so the card grew a hole
          between the caption and the divider; this centres the headline in
          whatever room is left and keeps the divider on the bottom, level
          with Deals by Stage beside it. */}
      <div className="flex flex-1 flex-col justify-center text-center">
        <TrendText comparison={headline} against={null} size="lg" />
        <p className="m-0 mt-1.5 text-xs font-semibold tabular-nums text-text">
          {headline ? `${headline.difference > 0 ? '+' : ''}${formatMoney(headline.difference, CURRENCY)}` : 'Unavailable'}
        </p>
        <p className="m-0 text-xs text-text-faint">vs {lastMonth}</p>
      </div>

      <dl className="w-full space-y-2 border-t border-border pt-3">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[8px_1fr_auto] items-center gap-2 text-xs">
            <i className={`h-2 w-2 rounded-sm ${SWATCH_FOR[row.tone]}`} />
            <dt className="truncate text-text-muted">{row.label}</dt>
            {/* The change comes through TrendText like every other one on
                the page: a bare "3.8%" beside a figure does not say which
                way it went. */}
            <dd className="m-0 flex items-baseline gap-1.5 font-semibold tabular-nums text-text">
              {formatMoney(row.value, CURRENCY)}
              {row.change && <TrendText comparison={row.change} against={null} />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ===============================
// * A STAGE COUNT IS A LINK TO THE ROWS IT COUNTED
// ===============================
// The ring reported 19 deals nobody could get to, so the answer to "which
// 19" was to filter the master sheet by hand and hope it agreed. Both the
// arc and its row open the sheet with that payment period already set.
//
// The sheet speaks PERIOD, the ring speaks STAGE: PERIOD_FOR_STAGE is the
// one translation, and an unmapped stage gets no link rather than a link
// that filters to nothing.
function stageLink(key) {
  const period = PERIOD_FOR_STAGE[key];
  return period ? `/master-sheet?${LINK_FILTER.period}=${encodeURIComponent(period)}` : null;
}

function StageDonut({ stages }) {
  const navigate = useNavigate();
  const available = stages.filter((stage) => stage.available && Number.isFinite(stage.count));
  const total = available.reduce((sum, stage) => sum + stage.count, 0);
  if (!total) return <Empty text="Deal stages are unavailable for this month." />;
  // THE RING ON TOP, THE COUNTS UNDER IT. Side by side they wrapped anyway
  // at this panel's width, so the layout was decided by the breakpoint
  // rather than chosen. Stacked, it reads the way the month on month panel
  // does: the figure, then the detail behind it on one divided row.
  return (
    <div className={`flex ${CHART_FILL} flex-col items-center gap-3`}>
      {/* The arc is the POINTER shortcut and the rows below are the real
          links, so the keyboard reaches every destination in markup a
          screen reader can read. See Donut's onSelect. */}
      <Donut
        segments={available.map((stage) => ({ key: stage.key, value: stage.count, color: STAGE_TONES[stage.key] }))}
        size={DONUT_SIZE}
        onSelect={(segment) => { const to = stageLink(segment.key); if (to) navigate(to); }}
      >
        <div><strong className="block text-lg text-text">{total}</strong><span className="text-xs text-text-faint">Total deals</span></div>
      </Donut>
      <div className="mt-auto w-full space-y-2 border-t border-border pt-3">
        {available.map((stage) => (
          <Link
            key={stage.key}
            to={stageLink(stage.key) ?? '/master-sheet'}
            className="group grid grid-cols-[8px_1fr_auto] items-center gap-2 rounded text-xs no-underline"
          >
            <i className="h-2 w-2 rounded-sm" style={{ background: STAGE_TONES[stage.key] }} />
            <span className="truncate text-text-muted group-hover:underline">{stage.name}</span>
            <span className="font-semibold tabular-nums text-text">{stage.count} <span className="font-normal text-text-faint">({Math.round((stage.count / total) * 100)}%)</span></span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function changeTitle(change) {
  if (change.summary) return change.summary;
  // IN WORDS: it read "FB companyLiquidationTotal updated". 2026-09-30.
  const field = change.field
    ? (FIELD_LABELS[change.field] ?? change.field.replace(/([A-Z])/g, ' $1').toLowerCase())
    : 'record';
  return `${change.personName || change.companyName || 'Deal'} ${field} updated`;
}

function changeLink(change) {
  if (change.personId) return `/people/${encodeURIComponent(change.personId)}`;
  if (change.companyKey) return `/companies/${encodeURIComponent(change.companyKey)}`;
  return '/master-sheet';
}

function RecentChanges({ changes }) {
  const tones = ['bg-accent-tint text-accent-strong', 'bg-metric-blue text-metric-blue-ink', 'bg-metric-peach text-metric-peach-ink', 'bg-metric-violet text-metric-violet-ink'];
  if (changes.rows.length === 0) return <Empty text="No recent changes are available." />;
  return (
    <div className="scroll-slim min-h-0 flex-1 space-y-0.5 overflow-y-auto">
      {changes.rows.slice(0, RECENT_CHANGES_SHOWN).map((change, index) => (
        <Link key={change.id ?? index} to={changeLink(change)} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 no-underline transition hover:bg-surface-sunken">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tones[index % tones.length]}`}><ReceiptIcon width={14} height={14} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs text-text-faint">Deal updated</span><strong className="block truncate text-xs text-text">{changeTitle(change)}</strong></span>
          <span className="shrink-0 text-xs text-text-faint">{timestamp(change.changedAt)}</span>
        </Link>
      ))}
    </div>
  );
}

// The company's initial, so a row is found by shape before it is read.
function InitialChip({ name }) {
  const letter = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-tint text-xs font-bold text-accent-strong">{letter}</span>;
}

const STAGE_BADGE = { Paying: 'badge-paying', Ended: 'badge-ended' };

function RecentDeals({ deals, mode }) {
  if (deals.length === 0) return <Empty text="No recent deals match this view." />;
  return (
    // The app's table: .table-wrap, nested because the panel already draws
    // the card, and the value right-aligned like every money column.
    <div className="table-wrap is-nested shadow-none">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="th">Deal name</th>
            <th className="th">Company</th>
            <th className="th text-right tabular-nums">Value</th>
            <th className="th">Stage</th>
            <th className="th">Group</th>
            <th className="th">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {deals.slice(0, RECENT_DEALS_SHOWN).map((deal, index) => (
            <tr key={deal.id ?? index} className="hover:bg-surface-sunken">
              <td className="td font-medium text-text"><Link className="text-text no-underline hover:text-accent-strong" to={deal.personId ? `/people/${encodeURIComponent(deal.personId)}` : '/master-sheet'}>{deal.personName || 'Unnamed deal'}</Link></td>
              <td className="td text-text-muted"><span className="flex items-center gap-2"><InitialChip name={deal.companyName} /><span className="truncate">{deal.companyName || 'Not set'}</span></span></td>
              <td className="td text-right font-semibold tabular-nums text-text"><NormalizedMoney money={deal.payment} display={mode} compact /></td>
              <td className="td"><span className={`badge ${STAGE_BADGE[deal.stage] ?? 'badge-not_started'}`}>{deal.stage || 'Unknown'}</span></td>
              <td className="td text-text-muted">{deal.group || 'Not set'}</td>
              <td className="td text-text-faint">{timestamp(deal.changedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }) {
  return <p className="grid min-h-32 place-items-center text-center text-xs text-text-faint">{text}</p>;
}

// WHY "HOW FAR BACK" CAN LOOK BROKEN. A past month is only ever drawn from
// a saved snapshot, so a range that reaches beyond the snapshots draws
// nothing new. Reported by the API as snapshotHealth and said in the panel,
// where the range is actually being set.
function historyNote(health) {
  const available = health?.availableMonths ?? [];
  const missing = health?.missingMonths ?? [];
  if (missing.length === 0) return null;
  if (available.length === 0) {
    return 'No past month has a saved snapshot yet, so How far back has nothing older to draw.';
  }
  const earlier = missing.length === 1 ? '1 earlier month has' : `${missing.length} earlier months have`;
  return `Saved history starts at ${monthLabel(available[0])}. ${earlier} no snapshot, so reaching further back changes nothing.`;
}

// ===============================
// * ONE QUIET LINE: THE SPAN, AND WHETHER IT REACHES PAST TODAY
// ===============================
// The reporting month picker used to live here. It scoped every figure to a
// month nobody had asked about, so the page reports the current month and
// says how far it reaches instead.
//
// It has been "Forecasting Oct 2026" (read as the page's whole scope, so
// three months on screen looked like one) and then a two clause version
// that named the projected months a second time. Both said out loud what
// the chart already draws: the forecast is the dashed run, with a key over
// it. This is a caption now, faint, user's own call.
//
// The word is DROPPED when nothing is projected. At a horizon of nothing
// there is no forecast in the range, and a caption is not allowed to be the
// one thing on the page claiming otherwise.
function ForecastNote({ points, range }) {
  const forecasting = points.some((point) => point.source === 'projectedForecast');
  return <p className="text-xs text-text-faint">{range}{forecasting ? ' forecast' : ''}</p>;
}

// ===============================
// * NOTHING APPLIES UNTIL APPLY
// ===============================
// Every change used to refetch on its own, so setting three filters was
// three round trips and two answers nobody wanted to see. The panel edits a
// DRAFT; closing it any other way, Escape or a click outside included,
// discards that draft rather than half committing it.
function FilterPanel({ filters, options, history, onApply, onCancel }) {
  const [draft, setDraft] = useState(filters);
  const ranges = options.ranges.length ? options.ranges : RANGE_OPTIONS;
  const horizons = options.forecastHorizons.length ? options.forecastHorizons : FORECAST_OPTIONS;
  const onChange = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);
  const isDefault = Object.keys(changedOnly(draft)).length === 0;

  return (
    <div className="absolute right-0 top-[calc(100%+.5rem)] z-30 w-[min(620px,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-4 shadow-md">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-text">Dashboard filters</h3>
        <p className="text-xs text-text-faint">Nothing changes until you press Apply.</p>
      </div>
      {/* SAID HERE, NOT AFTER THE FACT. Reaching further back than the saved
          snapshots go draws nothing new, which reads as a broken filter
          unless the control says so where it is being set. */}
      {history && <p className="mb-3 rounded-md bg-warning-tint px-2.5 py-2 text-xs text-warning">{history}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* "Months shown" and "Forecast horizon" both sounded like they set
            the same span. One goes back, one goes forward, and the labels
            say only that. Each carries a hint saying what it MOVES, because
            two of the four change the whole page and two change two panels. */}
        {/* THE MONTHS ARE NAMED UNDER THE CONTROL, and that is what settles
            this for good. Whatever number sits in the dropdown, the line
            beneath shows the window you actually get and updates itself
            every month, so "3 months" can never again be read as three
            months BACK. It was the label alone, and the label was wrong. */}
        <div>
          <Select label="History" size="detail" hint={FILTER_HINTS.range} options={ranges} value={draft.range} onChange={(value) => onChange('range', value)} />
          {draft.range !== 'custom' && (
            <p className="mt-1 text-xs text-text-faint">{windowLabel(draft.range)}</p>
          )}
        </div>
        {/* FIXED AT ONE and shown anyway, because a value that never moves
            still has to be visible: the forecast month is on every chart and
            a reader who cannot see where it comes from reads it as real. */}
        <Select label="Forecast" size="detail" disabled hint={FILTER_HINTS.forecastHorizon} options={horizons} value={draft.forecastHorizon} onChange={(value) => onChange('forecastHorizon', value)} />
        {/* Company and Person are gone. A dashboard is a view of the whole
            book; one company or one person is what the master sheet, the
            company page and the person page are for. */}
        <Select label="Groups" size="detail" hint={FILTER_HINTS.groups} multiple searchable options={options.groups} value={draft.groups} onChange={(value) => onChange('groups', value)} />
        <Select label="Payment method" size="detail" hint={FILTER_HINTS.paymentMethod} options={options.paymentMethods} value={draft.paymentMethod} onChange={(value) => onChange('paymentMethod', value)} />
        {draft.range === 'custom' && <FloatingField label="From month" filled><input className="h-10 w-full py-0 text-xs" type="month" value={draft.fromMonth} onChange={(event) => onChange('fromMonth', event.target.value)} /></FloatingField>}
        {draft.range === 'custom' && <FloatingField label="To month" filled><input className="h-10 w-full py-0 text-xs" type="month" value={draft.toMonth} onChange={(event) => onChange('toMonth', event.target.value)} /></FloatingField>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        {isDefault ? <span /> : <Button variant="warning" onClick={() => setDraft(initialFilters())}>Clear</Button>}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} onClick={() => onApply(draft)}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

// The same panels the real page draws, so the layout does not jump the
// moment the data lands.
function LoadingDashboard() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[104px] rounded-lg" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-6 xl:grid-cols-12">
        <Skeleton className="h-72 rounded-lg lg:col-span-6 xl:col-span-7" />
        <Skeleton className="h-72 rounded-lg lg:col-span-6 xl:col-span-5" />
        <Skeleton className="h-64 rounded-lg lg:col-span-6 xl:col-span-5" />
        <Skeleton className="h-64 rounded-lg lg:col-span-3 xl:col-span-4" />
        <Skeleton className="h-64 rounded-lg lg:col-span-3 xl:col-span-3" />
      </div>
      <Skeleton className="h-56 rounded-lg" />
    </div>
  );
}

export default function DashboardPage() {
  const [changed, setChanged] = useStickyState(FILTER_KEY, {});
  // A PREFERENCE, not a filter, so it outlives the tab. See useDurableState.
  const [mode, setMode] = useDurableState('dashboard.amounts', CONVERTED);
  // Which currency the charts plot while raw. Held per sitting rather than
  // forever: it is about the range on screen, and the range is.
  const [currency, setCurrency] = useStickyState('dashboard.currency', '');
  // ===============================
  // * THE BARS KEEP THEIR OWN, BECAUSE THEY CANNOT DRAW ALL
  // ===============================
  // Two pickers were already on screen, one per panel, wired to one piece of
  // state: two controls that looked independent and moved together. They are
  // separate now, which is also the only honest way to offer All on the
  // lines and refuse it on the bars. See ChartUnit's allowAll.
  const [barCurrency, setBarCurrency] = useStickyState('dashboard.barCurrency', '');
  const [showFilters, setShowFilters] = useState(false);
  // Escape only. The panel holds a draft until Apply, so a stray click
  // outside must not throw that draft away, and a click on a portalled
  // dropdown option is not an outside click at all.
  const filterRef = useDismissable(showFilters, () => setShowFilters(false), { outsideClick: false });
  const forget = useClearSticky('dashboard.');
  const filters = { ...initialFilters(), ...changed };
  const { data, isLoading, isFetching, error, refetch } = useDashboard({ ...filters, currencyMode: CURRENCY_MODE, q: '', page: 1, pageSize: RECENT_CHANGES_SHOWN });
  const activeCount = Object.keys(changed).length;
  const applyFilters = (draft) => {
    const next = changedOnly(draft);
    if (Object.keys(next).length === 0) forget();
    setChanged(next);
    setShowFilters(false);
  };

  const selectedIndex = data?.trend.findIndex((point) => point.month === data.dashboardMonth) ?? -1;
  const selectedPoint = selectedIndex >= 0 ? data.trend[selectedIndex] : null;
  const previousPoint = selectedIndex > 0 ? [...data.trend.slice(0, selectedIndex)].reverse().find((point) => !point.unavailable && pointMoney(point)?.usd !== null) : null;
  const totalComparison = data?.paymentComparison ?? compareMoney(data?.summary.monthlyPayable, pointMoney(previousPoint), previousPoint?.month);
  // Computed here, not on the server: the same two money objects the
  // converted comparison reads, split by the column each currency owns.
  const nativeComparison = compareNative(data?.summary.monthlyPayable, pointMoney(previousPoint), previousPoint?.month);
  const groups = (data?.groups ?? []).map((group) => {
    if (group.comparison) return group;
    const previous = previousPoint?.groups.find((item) => item.name === group.name);
    return { ...group, comparison: compareMoney(group.payable, previous?.payable, previousPoint?.month) };
  });
  const monthOnMonth = data?.forecastPerformance ?? (selectedPoint && previousPoint ? { actual: pointMoney(selectedPoint), forecast: pointMoney(previousPoint), comparison: compareMoney(pointMoney(selectedPoint), pointMoney(previousPoint), previousPoint.month) } : null);
  const thisMonth = monthLabel(data?.dashboardMonth);
  const lastMonth = previousPoint ? monthLabel(previousPoint.month) : 'the previous month';
  // ===============================
  // * THE MONTH AFTER THIS ONE
  // ===============================
  // The month on month panel reads preceding, this, proceeding. Whether the
  // next month exists at all is the FORECAST HORIZON's answer, so a horizon
  // of nothing simply lists two months. Normally projected, hence the flag
  // that gets it the dashed mark rather than a solid one.
  const nextPoint = selectedIndex >= 0 ? (data?.trend[selectedIndex + 1] ?? null) : null;
  const nextMonth = nextPoint && !nextPoint.unavailable && finite(pointMoney(nextPoint)?.usd)
    ? {
      label: monthLabel(nextPoint.month),
      value: pointMoney(nextPoint).usd,
      forecast: nextPoint.source === 'projectedForecast',
    }
    : null;
  const drawn = trimEdges(data?.trend ?? []).filter((point) => !point.unavailable);
  const rangeLabel = drawn.length > 1 ? `${monthLabel(drawn[0].month)} to ${monthLabel(drawn.at(-1).month)}` : thisMonth;
  // ===============================
  // * A PANEL NAMES THE MONTHS IT ACTUALLY SHOWS
  // ===============================
  // The note read "Sept 2026 vs Aug 2026" after the panel had grown a third
  // row, so it named two of the three months on screen. It spans instead,
  // the way Group Overview does, and stops at this month in raw because
  // that is where the raw view stops.
  const monthSpan = mode === RAW || !nextMonth
    ? `${lastMonth} to ${thisMonth}`
    : `${lastMonth} to ${nextMonth.label}`;

  // ===============================
  // * A SKIPPED MONTH IS SAID OUT LOUD
  // ===============================
  // A past month is only ever read from a saved snapshot, and a month with
  // none is skipped: `previousPoint` walks further back and EVERY comparison
  // on the page quietly measures against an older month. It was findable
  // only in small print under the trend chart.
  //
  // Detected from the consequence, not from the health report: if the point
  // immediately before this month is not the one we compared against, the
  // walk-back happened, whatever the reason.
  const priorPoint = selectedIndex > 0 ? data?.trend[selectedIndex - 1] : null;
  const skippedMonth = priorPoint && previousPoint && priorPoint.month !== previousPoint.month
    ? monthLabel(priorPoint.month)
    : null;
  // Biggest first, so raw opens on the currency carrying the money rather
  // than on whichever one sorts first. A stored pick that is no longer on
  // the sheet falls back rather than plotting an empty chart.
  const currencies = currenciesIn(data?.trend ?? []);
  // ===============================
  // * ALL BELONGS TO RAW ALONE
  // ===============================
  // Converted is ONE figure by definition and has no picker. Resolved
  // without the mode, a stored All drew three raw currency lines under a
  // header that said USD and a warning about a USD subtotal.
  // Offered only beside two or more currencies, so it can never resolve to
  // one line calling itself every one.
  const picked = mode === RAW && currency === ALL && currencies.length > 1
    ? ALL
    : currencies.includes(currency) ? currency : currencies[0];
  // No ALL branch. It resolves to a real currency or to the biggest one,
  // which is the currency the bars already drew: the difference is that the
  // control now says so instead of a caption under the chart.
  const barPicked = currencies.includes(barCurrency) ? barCurrency : currencies[0];

  return (
    <div className="mx-auto max-w-[1540px] space-y-3">
      {/* The shared header. The dashboard's own controls ride in `actions`:
          the span caption, the amounts switch and Filters. */}
      <PageHeader
        title="Dashboard"
        subtitle={mode === CONVERTED ? 'Payment performance, converted to USD' : 'Payment performance, in the currencies owed'}
        actions={(
          <>
            {data && <ForecastNote points={data.trend} range={rangeLabel} />}
            {/* Beside Filters, never inside it. A filter refetches and waits
                for Apply; this is a display switch over data already here. */}
            <ViewToggle label="Amounts" value={mode} onChange={setMode} options={AMOUNT_OPTIONS} />
            {/* The ref wraps the trigger too, so the button's own click is
                "inside" and toggles rather than closing and reopening. */}
            <div className="relative" ref={filterRef}>
              <Button variant="secondary" size="sm" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>
                <FilterIcon width={16} height={16} />Filters
                {activeCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent text-xs font-bold text-accent-ink">{activeCount}</span>}
              </Button>
              {showFilters && (
                <FilterPanel
                  filters={filters}
                  options={data?.options ?? EMPTY_OPTIONS}
                  history={historyNote(data?.health)}
                  onApply={applyFilters}
                  onCancel={() => setShowFilters(false)}
                />
              )}
            </div>
          </>
        )}
      />

      <ErrorState error={error} title="Couldn't load the dashboard" onRetry={() => refetch()} />
      {isLoading && <LoadingDashboard />}

      {/* ===============================
          * A FILTER IS A READ, SO IT CANNOT BE OPTIMISTIC
          * ===============================
          An optimistic write paints the answer because the client already
          knows it. Nobody can know what a different set of filters totals
          to, and inventing one would be a made up figure on a money screen.
          What it does instead is keep the LAST answer on screen while the
          new one is fetched (placeholderData in useDashboard), so nothing
          blanks, and say plainly that it is updating. */}
      {!isLoading && data && (
        <div className={isFetching ? 'transition-opacity duration-200 opacity-60' : 'transition-opacity duration-200'}>
          <p className="sr-only" role="status">{isFetching ? 'Updating dashboard' : 'Dashboard up to date'}</p>
          {isFetching && (
            <span className="pointer-events-none fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full bg-text/90 px-3 py-1 text-xs font-semibold text-surface shadow-md" aria-hidden="true">
              Updating
            </span>
          )}
          <div className="space-y-3">
          {/* ABOVE THE FIGURES IT IS ABOUT. Every comparison on this page is
              measured against one month, so the page has to say when that is
              not the month before this one. `role="status"` rather than an
              alert: nothing is broken, the reading is just older than it
              looks. */}
          {skippedMonth && (
            <p role="status" className="m-0 rounded-lg bg-warning-tint px-3 py-2 text-xs text-warning">
              <strong className="font-semibold">No saved snapshot for {skippedMonth}.</strong>
              {' '}Every comparison here is measured against {lastMonth} instead. A past month is
              only ever read from a saved snapshot, so {skippedMonth} cannot be filled in afterwards.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={BriefcaseIcon} tone="green" label="Deals" value={data.summary.liveDeals.toLocaleString('en-GB')} detail="Live deals in this view" to="/master-sheet" />
            <KpiCard icon={BuildingIcon} tone="amber" label="Companies" value={data.summary.companies.toLocaleString('en-GB')} detail="Distinct companies" to="/companies" />
            <KpiCard icon={UsersIcon} tone="blue" label="People" value={data.summary.distinctPeople.toLocaleString('en-GB')} detail="Distinct people" to="/people" />
            <KpiCard
              icon={WalletIcon}
              tone="violet"
              label={`Total payments, ${thisMonth}`}
              // NO ratio ACROSS currencies in raw: "up 3.2%" would be three
              // figures over three others in three units. A currency against
              // its OWN last month is one over one, so raw reports the same
              // rise, once per currency, ON that currency's own row. The
              // missing rate note still goes: only a converted total can be
              // short. The bottom line says what the percentages are against,
              // in the same slot the other three cards put their caption.
              value={mode === RAW
                ? <NativeTotals money={data.summary.monthlyPayable} changes={nativeComparison} />
                : <NormalizedMoney money={data.summary.monthlyPayable} display={mode} compact />}
              dense={mode === RAW}
              comparison={mode === CONVERTED ? totalComparison : null}
              detail={mode === RAW ? `vs ${lastMonth}` : undefined}
              note={mode === CONVERTED ? missingFxOf(data.summary.monthlyPayable) : null}
            />
          </div>

          <div className="grid items-stretch gap-3 lg:grid-cols-6 xl:grid-cols-12">
            <Panel title="Payment Overview" className="lg:col-span-6 xl:col-span-7" action={<ChartUnit mode={mode} note={rangeLabel} currencies={currencies} picked={picked} onPick={setCurrency} />}><PaymentOverview points={data.trend} groups={groups} mode={mode} picked={picked} currencies={currencies} /></Panel>
            <Panel title="Recent Changes" className="lg:col-span-6 xl:col-span-5" action={<Link to="/master-sheet" className="shrink-0 text-xs font-semibold text-accent-strong no-underline">View all</Link>}><RecentChanges changes={data.recentChanges} /></Panel>
            <Panel title="Group Overview" className="lg:col-span-6 xl:col-span-5" action={<ChartUnit mode={mode} note={rangeLabel} currencies={currencies} picked={barPicked} onPick={setBarCurrency} allowAll={false} />}><PaymentGroupBars points={data.trend} groups={groups} mode={mode} picked={barPicked} currencies={currencies} /></Panel>
            <Panel title="Month on month Overview" className="lg:col-span-3 xl:col-span-4" action={<PanelNote>{monthSpan}</PanelNote>}><MonthOnMonth performance={monthOnMonth} mode={mode} lastMonth={lastMonth} next={nextMonth} /></Panel>
            <Panel title="Deals by Stage" className="lg:col-span-3 xl:col-span-3" action={<PanelNote>{thisMonth}</PanelNote>}><StageDonut stages={data.stages} /></Panel>
          </div>

          <Panel title="Recent Deals" action={<Link to="/master-sheet" className="shrink-0 text-xs font-semibold text-accent-strong no-underline">View all deals</Link>} bodyClassName="px-2 pb-2 pt-0"><RecentDeals deals={data.recentDeals} mode={mode} /></Panel>

          </div>
        </div>
      )}
    </div>
  );
}
