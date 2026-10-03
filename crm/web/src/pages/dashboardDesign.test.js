import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('dashboard is authenticated, and is the landing route', () => {
  const app = read('../App.jsx');
  const layout = read('../components/layout/Layout.jsx');

  assert.match(app, /<RequireAuth>[\s\S]*?<Layout \/>[\s\S]*?<Route index element=\{<Navigate to="\/dashboard" replace \/>\}/);
  assert.match(app, /<Route path="dashboard" element=\{<DashboardPage \/>\} \/>/);
  // THE NAV MOVED to configs/navigation.js, 2026-09-17, and its own test
  // asserts the order and the grouping BY VALUE rather than by reading
  // source text. Two copies of that would be one to forget. All that is
  // left here is that the layout draws what the config says.
  assert.match(layout, /NAV_TOP\.map/);
  assert.match(layout, /VISIBLE_GROUPS\.map/);
  assert.match(layout, /NAV_ITEMS\.map/);
});

// The pages the nav points at have to EXIST. Where they sit in the menu is
// configs/navigation.test.js, which also proves every path is a real route.
test('Expenses has a route', () => {
  const app = read('../App.jsx');
  assert.match(app, /<Route path="expenses" element=\{<ExpensesPage \/>\} \/>/);
  assert.match(app, /import ExpensesPage from '\.\/pages\/ExpensesPage'/);
});

test('Archive has a route', () => {
  const app = read('../App.jsx');
  assert.match(app, /<Route path="archive" element=\{<ArchivePage \/>\} \/>/);
  assert.match(app, /import ArchivePage from '\.\/pages\/ArchivePage'/);
});

test('dashboard endpoint uses the shared API helper and React Query', () => {
  const config = read('../configs/api.config.js');
  const hook = read('../hooks/useDashboard.js');

  assert.match(config, /dashboard[\s\S]*?api\.get\(`\$\{apiPath\}\/dashboard\$\{toQueryString\(params\)\}`\)/);
  assert.match(hook, /queryKey: \['dashboard', params\]/);
  assert.match(hook, /select: normalizeDashboard/);
});

test('dashboard filters persist, survive the page, and clear by forgetting', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /useStickyState\(FILTER_KEY, \{\}\)/);
  assert.match(page, /useClearSticky\('dashboard\.'\)/);
  assert.match(page, /label="Groups"[\s\S]*?multiple searchable/);
  assert.match(page, /forget\(\)/);
});

// ===============================
// * A STORED FILTER MUST NOT OUTLIVE A CHANGED DEFAULT
// ===============================
// The whole object was stored, so a horizon of 3 saved before the default
// became 1 kept forecasting to December for anyone who had opened the page.
test('only filters the user changed are remembered', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /function changedOnly/);
  assert.match(page, /const filters = \{ \.\.\.initialFilters\(\), \.\.\.changed \}/);
  assert.match(page, /const next = changedOnly\(draft\)/);
  assert.match(page, /const activeCount = Object\.keys\(changed\)\.length/);
});

// ===============================
// * NOTHING APPLIES UNTIL APPLY
// ===============================
// Every change refetched on its own, so setting three filters was three
// round trips and two answers nobody wanted to see.
test('the filter panel edits a draft and commits it only on Apply', () => {
  const page = read('./DashboardPage.jsx');
  const panel = page.match(/function FilterPanel\([\s\S]*?\n\}/)[0];

  assert.match(panel, /const \[draft, setDraft\] = useState\(filters\)/);
  assert.match(panel, /onClick=\{\(\) => onApply\(draft\)\}/);
  assert.match(panel, /onClick=\{onCancel\}/);
  assert.match(panel, /disabled=\{!dirty\}/);
  // Every control reads the DRAFT. One left on `filters` would look set and
  // apply nothing.
  assert.doesNotMatch(panel, /value=\{filters\./);
  assert.equal((panel.match(/value=\{draft\./g) ?? []).length, 6);
  // Closing any other way discards, so Escape and an outside click cannot
  // half commit a draft.
  assert.match(page, /onCancel=\{\(\) => setShowFilters\(false\)\}/);
  assert.match(page, /applyFilters[\s\S]*?setShowFilters\(false\)/);
});

// A past month is only ever drawn from a saved snapshot, so a range that
// reaches beyond them draws nothing new and reads as a broken filter.
test('the panel says how much saved history there actually is', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /function historyNote\(health\)/);
  assert.match(page, /health\?\.availableMonths/);
  assert.match(page, /health\?\.missingMonths/);
  assert.match(page, /Saved history starts at/);
  assert.match(page, /history=\{historyNote\(data\?\.health\)\}/);
  assert.match(page, /\{history && <p/);
});

// ===============================
// * THE HEADER HOLDS ONE CONTROL
// ===============================
// The month picker scoped every figure to a month nobody had asked about
// (it opened on October because a stored filter said so). Clear moved into
// the panel it belongs to, and Add deal belongs on the master sheet.
test('the dashboard header carries no month picker, no Clear and no Add deal', () => {
  const page = read('./DashboardPage.jsx');

  assert.doesNotMatch(page, /label="Reporting month"/);
  assert.doesNotMatch(page, /label="Selected month"/);
  assert.doesNotMatch(page, /Add deal/);
  assert.doesNotMatch(page, /LinkButton/);
  // Clear is inside the filter panel, beside the filters it clears, and it
  // resets the draft rather than acting behind the Apply button.
  assert.match(page, /onClick=\{\(\) => setDraft\(initialFilters\(\)\)\}>Clear/);
});

// It read "Forecasting Oct 2026" and looked like the page's whole scope, so
// a dashboard drawing three months appeared to be showing one. Then it named
// the projected months a second time, which the dashed run and its key
// already do. One faint caption now: the span, and whether it reaches past
// today.
test('the header caption is the span, faint, and only says forecast when there is one', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /function ForecastNote\(\{ points, range \}\)/);
  assert.match(page, /const forecasting = points\.some\(\(point\) => point\.source === 'projectedForecast'\)/);
  assert.match(page, /<ForecastNote points=\{data\.trend\} range=\{rangeLabel\} \/>/);
  // Faint, and no bold half.
  assert.match(page, /<p className="text-\[11px\] text-text-faint">\{range\}\{forecasting \? ' forecast' : ''\}<\/p>/);
  // At a horizon of nothing there is no forecast in the range, and a caption
  // is not allowed to be the one thing on the page claiming otherwise.
  assert.match(page, /forecasting \? ' forecast' : ''/);
  // The RENDERED word, not the prose: the comments explaining the history
  // are allowed to say it.
  assert.doesNotMatch(page, />Forecasting<\/span>/);
  // The months are not listed a second time, so nothing collapses a list.
  assert.doesNotMatch(page, /FORECAST_LISTED/);
});

// ===============================
// * A DRAFT IS NOT THROWN AWAY BY A STRAY CLICK
// ===============================
// The panel commits on Apply, so an outside click discarding a half set
// filter is a worse accident than a panel left open. Picking a group shut
// the panel it was being picked in, which is what proved it.
test('the filter panel closes on Escape, never on an outside click', () => {
  const page = read('./DashboardPage.jsx');
  const hook = read('../hooks/useDismissable.js');
  const select = read('../components/forms/Select.jsx');

  assert.match(page, /useDismissable\(showFilters, \(\) => setShowFilters\(false\), \{ outsideClick: false \}\)/);
  assert.match(page, /<div className="relative" ref=\{filterRef\}>/);
  assert.match(hook, /if \(outsideClick\) document\.addEventListener\('pointerdown'/);
  assert.match(hook, /event\.key !== 'Escape'/);
  // A dropdown open on top of the panel owns the Escape: it shuts, the
  // panel behind it stays.
  assert.match(hook, /document\.querySelector\('\[data-portal-panel\]'\)/);
  assert.match(hook, /event\.target\.closest\?\.\('\[data-portal-panel\]'\)/);
  assert.match(select, /data-portal-panel=""/);
});

// A filter is a READ. Nobody can know what a different set of filters totals
// to, and inventing one would be a made up figure on a money screen. The
// last answer stays on screen while the new one is fetched.
test('changing a filter keeps the old figures up and says it is updating', () => {
  const page = read('./DashboardPage.jsx');
  const hook = read('../hooks/useDashboard.js');

  assert.match(hook, /placeholderData: \(previous\) => previous/);
  assert.match(page, /isFetching \? 'transition-opacity duration-200 opacity-60'/);
  assert.match(page, /Updating dashboard/);
  assert.match(page, /isFetching && \(/);
});

// One goes back, one goes forward. Both were named as if they set the same
// span, and the options repeated the word the label should have carried.
/**
 * "How far back" and "How far ahead" were an improvement on "Months shown"
 * and "Forecast horizon", and they still described a range that meant
 * something else: `last3` drew June, July, August, September and October.
 *
 * The range counts THIS MONTH as one of its own now and the forecast is
 * fixed, so neither control is a direction any more. One is the history,
 * one is a constant, and the months are named under the first.
 */
test('the span controls name what they are, not which way they point', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /label="History"/);
  assert.match(page, /label="Forecast" size="detail" disabled/);
  assert.doesNotMatch(page, /label="Months shown"/);
  assert.doesNotMatch(page, /label="Forecast horizon"/);
  assert.doesNotMatch(page, /label="How far back"/, 'the range is not a direction');
  assert.doesNotMatch(page, /label: 'Past \d+ months'/);
});

test('THE MONTHS ARE NAMED UNDER THE CONTROL, which is what settles it', () => {
  // Whatever number sits in the dropdown, the line beneath shows the window
  // you actually get and updates itself every month. It was the label
  // alone, and the label was wrong.
  const page = read('./DashboardPage.jsx');
  assert.match(page, /function windowLabel\(range\)/);
  assert.match(page, /and \$\{at\(1\)\} forecast/);
  assert.match(page, /\{windowLabel\(draft\.range\)\}/);
});

test('the range counts THIS MONTH as one of its own', () => {
  const page = read('./DashboardPage.jsx');
  assert.match(page, /const MONTHS_OF_HISTORY = \{ last1: 1, last3: 3, last6: 6, last12: 12 \}/);
  // `1 month` is this month alone plus the forecast: the smallest honest
  // window, one real point and one invented one.
  assert.match(page, /\{ value: 'last1', label: '1 month' \}/);
  // yearToDate and custom left the dropdown. They still resolve server side
  // so a saved link keeps working, but neither is expressible as "how many
  // months of history".
  assert.doesNotMatch(page, /\{ value: 'yearToDate'/);
});

test('THE FORECAST IS A CONSTANT, and is shown anyway', () => {
  // A value that never moves still has to be visible: the forecast month is
  // on every chart, and a reader who cannot see where it comes from reads
  // it as real.
  const page = read('./DashboardPage.jsx');
  assert.match(page, /const FORECAST_OPTIONS = \[\{ value: '1', label: '1 month' \}\]/);
  assert.match(page, /FILTER_HINTS[\s\S]*?forecastHorizon: 'Always next month, and it cannot be changed/);
});

// ===============================
// * EVERY FILTER SAYS WHAT IT MOVES
// ===============================
// Two of the four change every figure on the page and two change only the
// panels that span months, and nothing on the control said which.
test('each filter carries a hint naming what it changes', () => {
  const page = read('./DashboardPage.jsx');
  const field = read('../components/forms/FloatingField.jsx');

  assert.match(field, /hint && \(/);
  assert.match(field, /<CellInfo label=\{`About \$\{label\}`\}>\{hint\}<\/CellInfo>/);
  for (const key of ['range', 'forecastHorizon', 'groups', 'paymentMethod']) {
    assert.match(page, new RegExp(`hint=\\{FILTER_HINTS\\.${key}\\}`), `${key} has no hint on its control`);
    assert.match(page, new RegExp(`${key}: '[^']{40,}'`), `FILTER_HINTS.${key} says nothing useful`);
  }
  // The hint reaches CellInfo as children, which renders no markup.
  // Read the BLOCK, not the file. A loose scan for `**` after the name
  // matched the banner comments further down and failed on its own asterisks.
  const hints = page.match(/const FILTER_HINTS = Object\.freeze\(\{[\s\S]*?\n\}\);/)[0];
  assert.doesNotMatch(hints, /\*\*/);
});

// ===============================
// * AN SVG IGNORES left/right WHEN ITS WIDTH IS AUTO
// ===============================
// It is a replaced element: given a definite height and no width it takes
// its width from the viewBox ratio. At 120px tall that came out 192px on a
// 320px card, which is the hard vertical edge two thirds across the card.
test('a drawing that spans the card actually spans it', () => {
  const art = read('../components/display/KpiArt.jsx');
  const wide = art.match(/(green|violet): \{[^}]*\}/g) ?? [];

  assert.equal(wide.length, 2);
  for (const entry of wide) {
    assert.match(entry, /inset-x-0/, entry);
    assert.match(entry, /w-full/, `${entry} sets no width, so the viewBox ratio decides it`);
    assert.match(entry, /fit: 'none'/, entry);
  }
  // Smooth, and one continuous curve: it was a jagged polyline.
  assert.match(art, /const TREND = 'M0 \d+ C[^']*S[^']*'/);

  // ===============================
  // * NOTHING IS EVER SLICED
  // ===============================
  // `slice` scales a drawing to COVER whatever shape the card happens to be
  // and cuts the overflow. A KPI card stretches to the tallest in its row,
  // so at two columns the People card sits beside the money card, three
  // lines tall in the raw view: the crowd was blown up and cut down its
  // left edge, half a head on the wrong side of a hard vertical line.
  // The `fit` VALUES, not the prose: the comment above them is allowed to
  // say the word it is explaining.
  assert.doesNotMatch(art, /fit: '[^']*slice'/, 'a drawing that covers the card gets cut when the card grows');
  const cornered = art.match(/(amber|blue): \{[^}]*\}/g) ?? [];
  assert.equal(cornered.length, 2);
  for (const entry of cornered) {
    assert.match(entry, /fit: 'xMaxYMax meet'/, entry);
  }
});

// The floor and the ceiling both bite. Below the floor a drawing vanishes
// against white; above the ceiling a full width wash is a coloured card
// rather than a texture behind a figure.
test('every card drawing lands between seen and shouting', () => {
  const art = read('../components/display/KpiArt.jsx');
  const MIN_VISIBLE = 0.045;
  const MAX_SUBTLE = 0.21;
  const tones = ['green', 'amber', 'blue', 'violet'];

  const groups = Object.fromEntries(tones.map((tone) => {
    const entry = art.match(new RegExp(`${tone}: \\{[^}]*\\}`))[0];
    const opacity = Number(entry.match(/opacity: ([\d.]+)/)[1]);
    assert.ok(Number.isFinite(opacity), `${tone} has no opacity of its own`);
    return [tone, opacity];
  }));

  // A wide drawing must never be denser than a cornered one.
  assert.ok(groups.green < groups.amber && groups.violet < groups.amber);

  for (const [tone, group] of Object.entries(groups)) {
    assert.ok(group <= MAX_SUBTLE, `${tone} is ${group}`);
    for (const fill of art.match(/opacity="([\d.]+)"/g) ?? []) {
      const value = Number(fill.match(/[\d.]+/)[0]);
      const effective = value * group;
      assert.ok(effective >= MIN_VISIBLE, `a fill at ${value} in ${tone} works out at ${effective.toFixed(3)} against white`);
      assert.ok(effective <= MAX_SUBTLE, `a fill at ${value} in ${tone} works out at ${effective.toFixed(3)}, which is not texture`);
    }
  }
  // The shoulders were an arc whose sweep curved below the baseline, so all
  // three figures were drawn off the bottom of the card.
  assert.doesNotMatch(art, /a\$\{r \* 1\.5\}/);
});

// ===============================
// * A PANEL IS WHITE BEHIND ITS FIGURE
// ===============================
// Faint concentric arcs were drawn behind Monthly Comparison and Deals by
// Stage to fill them, and they read as noise behind the figure. The KPI
// cards keep their drawings: those sit on a tint and tell four cards apart.
test('no artwork sits behind a panel', () => {
  const page = read('./DashboardPage.jsx');
  const theme = read('../configs/dashboardTheme.js');
  const panel = page.match(/function Panel\(\{[\s\S]*?\n\}/)[0];

  assert.doesNotMatch(page, /PanelArt/);
  assert.doesNotMatch(theme, /PANEL_ART_INK/);
  assert.doesNotMatch(panel, /relative/);
  assert.doesNotMatch(panel, /\bart\b/);
  // The KPI row is a different question and keeps its own.
  assert.match(page, /<KpiArt tone=\{tone\} \/>/);
});

// The boss's words, not ours. A silent rename would be a different report
// wearing the same page. `Group Comparison` became `Group Overview` on the
// user's instruction, so the two panels that span the range now share a
// suffix and only the thing they are about differs.
test('the panels and the fourth card keep the names they were given', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /title="Payment Overview"/);
  assert.match(page, /title="Group Overview"/);
  assert.match(page, /label=\{`Total payments, \$\{thisMonth\}`\}/);
  assert.doesNotMatch(page, /Group Comparison/);
  assert.doesNotMatch(page, /Income Overview/);
  assert.doesNotMatch(page, /Potential [Ii]ncome/);
});

// "Payment vs Previous" and "Forecast Performance" both compared this month
// with last month and neither said so, so one read as a forecast. The group
// panel that drew the same bars a second time is gone.
//
// "Month on month" was banned here as a title once, for saying what it
// measured without naming a month. It is back, user's own call, and it earns
// it: the note under it now spans every month the panel draws.
test('every comparison panel names the months it is comparing', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /title="Month on month Overview"/);
  assert.doesNotMatch(page, /Forecast Performance/);
  assert.doesNotMatch(page, /Monthly Comparison/);
  // Two months in raw, three where the horizon reaches one, never "vs".
  assert.match(page, /const monthSpan = mode === RAW \|\| !nextMonth/);
  assert.match(page, /`\$\{lastMonth\} to \$\{thisMonth\}`/);
  assert.match(page, /`\$\{lastMonth\} to \$\{nextMonth\.label\}`/);
  assert.doesNotMatch(page, /\{thisMonth\} vs \{lastMonth\}/);
  // The group panel spans the range now, so it names the range instead.
  assert.match(page, /const rangeLabel = /);
  assert.match(page, /title="Group Overview"[\s\S]*?note=\{rangeLabel\}/);
});

// Past months, this month, next month. Three months ahead put a quarter of
// invented figures on every chart.
// MOVED TO helpers/dashboard.js, so DianeBoot's prefetch asks for exactly
// what this page asks for: a key that differs by one field warms a cache
// entry nobody reads. The value is pinned where it now lives.
test('the forecast reaches one month past this one', () => {
  const helper = read('../helpers/dashboard.js');
  assert.match(helper, /export const DEFAULT_FORECAST = '1'/);
  // And the page still reads it rather than keeping a second copy.
  assert.match(read('./DashboardPage.jsx'), /DEFAULT_FORECAST = SHARED_DEFAULT_FORECAST/);
});

// ===============================
// * A PANEL BODY FILLS ITS PANEL
// ===============================
// The grid stretches every panel in a row to the tallest, and a body sized
// to its content left the difference as white space under the chart.
test('nothing on the dashboard leaves a gap under itself', () => {
  const page = read('./DashboardPage.jsx');
  const bars = read('../components/display/BarChart.jsx');

  assert.match(page, /function Panel[\s\S]*?flex min-w-0 flex-col/);
  assert.match(page, /function Panel[\s\S]*?flex min-h-0 flex-1 flex-col/);
  assert.match(page, /const CHART_FILL = '[^']*flex-1/);
  assert.match(bars, /flex h-full min-h-0 flex-col/);
  assert.doesNotMatch(bars, /style=\{\{ height \}\}/);
});

// Clipped TWICE: by the box that lets a narrow chart scroll (overflow-x
// makes the other axis auto too) and by the panel's own overflow-hidden.
// No z-index fixes either, so both chart popups are portalled.
test('both chart popups are portalled out of the panel that clips them', () => {
  const tooltip = read('../components/display/ChartTooltip.jsx');
  const trend = read('../components/display/SourceTrendChart.jsx');
  const bars = read('../components/display/BarChart.jsx');

  assert.match(tooltip, /createPortal\([\s\S]*?document\.body/);
  assert.match(tooltip, /z-\[58\]/);
  assert.match(tooltip, /fixed/);
  assert.match(trend, /<ChartTooltip at=\{active\}>/);
  assert.match(bars, /<ChartTooltip at=\{active\}>/);
});

// ===============================
// * A POPUP IS PLACED BY WHAT IT MEASURES, NOT WHAT IT GUESSES
// ===============================
// The height was a fixed 260 and only ever chose which side to flip to. A
// group broken down by month AND currency runs past 500, so it hung off the
// bottom of the screen with its totals unreadable.
test('a popup too tall to flip steps out beside its chart', () => {
  const tooltip = read('../components/display/ChartTooltip.jsx');
  const page = read('./DashboardPage.jsx');

  assert.match(tooltip, /useLayoutEffect/);
  assert.match(tooltip, /box\.current\?\.getBoundingClientRect\(\)\.height/);
  assert.match(tooltip, /if \(measured\) setHeight\(measured\)/);
  // Below, then above, then BESIDE IT AT THE TOP.
  assert.match(tooltip, /if \(height > room\.down\) \{/);
  assert.match(tooltip, /if \(height <= room\.up\) \{/);
  assert.match(tooltip, /at\.x \+ SIDE_GAP/);
  // And a hard stop, so nothing a caller puts in it can outgrow the screen.
  assert.match(tooltip, /maxHeight: window\.innerHeight - MARGIN \* 2/);
  // The list that caused it is bounded too, and says what it left out.
  assert.match(page, /const MONTHS_IN_POPUP = \d+/);
  assert.match(page, /bar\.values\.slice\(0, MONTHS_IN_POPUP\)/);
  assert.match(page, /more \{hidden === 1 \? 'month' : 'months'\}, counted below/);
});

// A month carries exactly one source, so a polyline per source was a
// polyline of one point, and one point draws nothing: the chart was dots.
test('the trend is one line across every month, dashed only where it is forecast', () => {
  const chart = read('../components/display/SourceTrendChart.jsx');
  const helper = read('../helpers/sourceTrend.js');

  assert.match(helper, /export function lineRuns/);
  assert.match(chart, /runs: lineRuns\(plotted\)/);
  assert.match(chart, /strokeDasharray=\{run\.forecast \? FORECAST_DASH : undefined\}/);
  assert.doesNotMatch(chart, /segmentsFor/);
  assert.doesNotMatch(helper, /export function segmentsFor/);

  // ===============================
  // * AND IT IS A CURVE, NOT A ZIGZAG
  // ===============================
  // Straight segments meeting at hard corners read as a diagram, not as the
  // soft wave the KPI cards are drawn with. The fill uses the same helper,
  // so the top of the wash and the line over it cannot disagree.
  assert.match(chart, /d=\{smoothPath\(run\.points\)\}/);
  assert.match(chart, /d=\{smoothArea\(run\.points, baseline\)\}/);
  assert.doesNotMatch(chart, /<polyline|<polygon/);

  // EVERY line gets the soft fill under it, one gradient per series in that
  // series' own colour, and all of them painted before any line: grouped
  // per series, the second currency's wash tinted the first one's line.
  assert.match(chart, /id=\{`\$\{id\}area\$\{set\.order\}`\}/);
  assert.match(chart, /stopColor=\{set\.ink \?\? areaInk\}/);
  assert.match(chart, /const AREA_FADE = \{ single: [\d.]+, multi: [\d.]+ \}/);
  assert.match(chart, /\{drawn\.map\(\(set\) => set\.runs\.filter\(\(run\) => !run\.forecast\)/);
});

test('the charts animate in, and stop when motion is not wanted', () => {
  const css = read('../index.css');
  const bars = read('../components/display/BarChart.jsx');
  const donut = read('../components/display/Donut.jsx');
  const trend = read('../components/display/SourceTrendChart.jsx');

  assert.match(css, /@keyframes chart-rise/);
  assert.match(css, /@keyframes chart-draw/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.chart-bar, \.chart-in, \.chart-ring \{ animation: none/);
  assert.match(bars, /chart-bar/);
  assert.match(bars, /animationDelay/);
  assert.match(donut, /chart-ring/);
  assert.match(trend, /<g className="chart-in">/);
});

// "US$" on a dashboard that is entirely USD is two letters of noise.
test('a dollar is a dollar sign', () => {
  const money = read('../helpers/formatMoney.js');

  assert.match(money, /currencyDisplay: 'narrowSymbol'/);
  assert.equal((money.match(/\.\.\.SYMBOL/g) ?? []).length, 2);
});

// Slicing to seven meant a group with real money in it silently vanished.
// Past a floor width the plot scrolls instead, and the y axis stays put.
test('the group chart takes as many bars as it is given and scrolls past a floor', () => {
  const page = read('./DashboardPage.jsx');
  const bars = read('../components/display/BarChart.jsx');

  assert.doesNotMatch(page, /GROUPS_SHOWN/);
  assert.doesNotMatch(page, /\.slice\(0, COMPARISON_SHOWN\)/);
  assert.match(bars, /const VALUE_LABEL_MAX/);
  assert.match(bars, /const MIN_BAR_SLOT/);
  // A bar takes its share of the column, so three groups on a wide panel
  // gave each one a slab. Capped, and by a named value rather than a
  // Tailwind class buried in the className.
  assert.match(bars, /const MAX_BAR_SLOT = \d+/);
  assert.match(bars, /maxWidth: MAX_BAR_SLOT/);
  assert.doesNotMatch(bars, /max-w-8/);
  // ===============================
  // * THE AXIS GUTTER FITS ITS OWN LABELS
  // ===============================
  // Both charts reserved a fixed gutter and right-aligned the ticks in it,
  // so a short axis left blank card to its left and the plot started
  // inboard of the panel title.
  assert.match(bars, /const axisWidth = axisGutter\(ticks\.map\(formatValue\)\)/);
  assert.doesNotMatch(bars, /const AXIS_WIDTH = \d+/);
  assert.match(bars, /const minWidth = bars\.length \* \(perColumn \* MIN_BAR_SLOT \+ COLUMN_GAP\)/);
  assert.match(bars, /scroll-slim min-w-0 flex-1 overflow-x-auto/);
  assert.match(page, /<GroupTooltip bar=\{bar\} unit=\{unit\} \/>/);
});

// ===============================
// * ONE BAR PER MONTH, PER GROUP
// ===============================
// The range asks for a comparison across months, so that is what the chart
// draws. It was this month against last month, in a panel that sat beside a
// near identical one.
test('the group chart spans every month in the range', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /const MONTH_TONE = \{ savedActual: 'soft', liveEstimate: 'strong', projectedForecast: 'ghost' \}/);
  assert.match(page, /function PaymentGroupBars\(\{ points, groups, mode, picked, currencies \}\)/);
  assert.match(page, /values: months\.map\(\(point\)/);
  assert.match(page, /<PaymentGroupBars points=\{data\.trend\} groups=\{groups\} mode=\{mode\} picked=\{barPicked\} currencies=\{currencies\} \/>/);
});

// "Past 3 months" asks for three whether a snapshot was ever saved for
// them, so the chart opened on two full height grey blocks and no data.
test('months with nothing in them are dropped from the ends, softened in the middle', () => {
  const page = read('./DashboardPage.jsx');
  const chart = read('../components/display/SourceTrendChart.jsx');
  const helper = read('../helpers/sourceTrend.js');

  assert.match(helper, /export function trimEdges/);
  assert.match(page, /const rows = trimEdges\(all\)/);
  assert.match(page, /trimEdges\(points\)\.filter\(\(point\) => !point\.unavailable\)/);
  // And it SAYS it dropped them, or reaching back past the snapshots looks
  // like the filter has stopped working.
  // Counted against what the RANGE asked for, not against one currency's
  // rows: under All the series are trimmed together and `rows` is not drawn.
  assert.match(page, /const dropped = points\.length - drawn\.length/);
  assert.match(page, /no saved snapshot/);
  // The heavy diagonal hatch is gone: it made an empty month the loudest
  // thing on the chart.
  assert.doesNotMatch(chart, /patternUnits/);
  assert.match(chart, /className="fill-surface-sunken" opacity="0\.6"/);
});

// A fixed gutter is sized for the widest label that might ever appear, so
// every narrower axis pays for it in blank card on the left.
test('both charts start where the panel title starts', () => {
  const chart = read('../components/display/SourceTrendChart.jsx');
  const bars = read('../components/display/BarChart.jsx');
  const scale = read('../helpers/chartScale.js');

  assert.match(scale, /export function axisGutter/);
  assert.match(chart, /const padLeft = axisGutter\(ticks\.map\(tick\)\)/);
  assert.doesNotMatch(chart, /const PAD = \{[^}]*left:/);
  assert.doesNotMatch(chart, /PAD\.left/);
  assert.doesNotMatch(bars, /AXIS_WIDTH/);
});

test('the dashboard filters on the whole book, not one company or one person', () => {
  const page = read('./DashboardPage.jsx');

  assert.doesNotMatch(page, /label="Company"/);
  assert.doesNotMatch(page, /label="Person"/);
  assert.doesNotMatch(page, /filters\.company/);
  assert.doesNotMatch(page, /filters\.person/);
  assert.match(page, /label="Groups"/);
  assert.match(page, /label="Payment method"/);
});

// A placeholder standing in for content has to be seen. `surface-sunken` is
// a 4% wash and was invisible on a white card.
test('the loading skeleton can actually be seen', () => {
  // The tone moved into `.skeleton` (index.css) with the sweep, 2026-09-09,
  // because the look is one decision and a component reimplementing any of
  // it would drift. The guard is unchanged: `surface-sunken` is a 4% wash
  // meant for a strip BEHIND content, and a placeholder standing IN for
  // content was invisible on a white card.
  const css = read('../index.css');
  const block = /\.skeleton \{([\s\S]*?)\n  \}/.exec(css);
  assert.ok(block, '.skeleton is where the look lives');
  assert.match(block[1], /bg-border-strong/);
  assert.doesNotMatch(block[1], /bg-surface-sunken/);
});

test('a placeholder SWEEPS rather than blinking, and stops for reduced motion', () => {
  // Eight pulsing rows breathe in unison and read as the page flickering.
  // A sweep travels, which says loading is arriving left to right.
  const css = read('../index.css');
  assert.match(css, /animation: skeleton-sweep/);
  assert.match(css, /@keyframes skeleton-sweep/);
  // Still visibly a placeholder when still. `animation: none` alone would
  // freeze the gradient mid sweep and leave one row lighter than the rest.
  assert.match(css, /\.skeleton \{ animation: none; background-image: none; \}/);
  // And the component no longer carries its own look.
  const skeleton = read('../components/display/Skeleton.jsx');
  assert.doesNotMatch(skeleton, /animate-pulse/);
});

test('placeholders are ROUNDED, and the round ones match what they stand in for', () => {
  const css = read('../index.css');
  assert.match(/\.skeleton \{([\s\S]*?)\n  \}/.exec(css)[1], /rounded/);
  const skeleton = read('../components/display/Skeleton.jsx');
  // A 6px radius on a 10px text bar still looks square, so short lines are
  // pills; a chat bubble is the roundest thing in the app.
  assert.match(skeleton, /pill \? '!rounded-full' : ''/);
  assert.match(skeleton, /!rounded-xl/);
});

// The card opened a modal of per group cards. Removed 2026-09-06 at the
// user's call: the four cards report the current month and the range lives
// on the two panels that span months, so a modal repeating one of them was
// a third place to read the same figure.
test('the total payments card opens nothing', () => {
  const page = read('./DashboardPage.jsx');

  assert.doesNotMatch(page, /TotalPaymentsModal|showPayments/);
  // And with nowhere to go it draws no arrow: a control that opens
  // nothing is worse than no control.
  assert.match(page, /const goes = Boolean(to || onClick)/);
});

// One currency on the page, decided by the page. A filter that could put it
// back into native amounts is how the card and the chart disagreed before.
test('every figure on the dashboard is converted to USD', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /const CURRENCY = 'USD'/);
  assert.match(page, /currencyMode: CURRENCY_MODE/);
  assert.match(page, /function usdText/);
  assert.doesNotMatch(page, /options\.currencyModes/);
  assert.doesNotMatch(page, /label="Source currency"/);
});

// ===============================
// * NO FIGURE ON THIS PAGE IS ABBREVIATED
// ===============================
// "US$13.7k" is a magnitude, not a figure, and these are read against the
// sheet. The only thing dropped is the pence, and only on a chart label.
test('money is never shown as a rounded magnitude', () => {
  const page = read('./DashboardPage.jsx');
  const money = read('../helpers/formatMoney.js');
  const chart = read('../components/display/SourceTrendChart.jsx');

  assert.doesNotMatch(money, /notation: 'compact'/);
  assert.doesNotMatch(money, /formatMoneyCompact/);
  assert.doesNotMatch(page, /formatMoneyCompact/);
  assert.doesNotMatch(chart, /formatMoneyCompact/);
  assert.match(money, /export function formatMoneyWhole/);
  assert.match(money, /maximumFractionDigits: 0/);
});

// The browser draws an SVG <title> as a native tooltip, so hovering the
// chart popped a grey "Payment Overview" box over the real one.
test('the trend chart has no svg title to pop a second tooltip', () => {
  const chart = read('../components/display/SourceTrendChart.jsx');

  assert.doesNotMatch(chart, /<title/);
  assert.match(chart, /role="img" aria-label=\{chartTitle\}/);
  assert.match(chart, /<table className="sr-only">/);
});

test('the shell names the workspace once and never repeats the page title', () => {
  const layout = read('../components/layout/Layout.jsx');

  // ONCE means once in the codebase, not once in this file. The account
  // menu says it too, so the name is configs/navigation's and both read it.
  assert.match(layout, /\{WORKSPACE_NAME\}/);
  assert.match(read('../configs/navigation.js'), /WORKSPACE_NAME = 'Admin workspace'/);
  assert.doesNotMatch(layout, /WHATBOT/);
  assert.doesNotMatch(layout, /pageLabel/);
  assert.doesNotMatch(layout, /PAGE_LABELS/);
});

// One column on a phone, two from sm, six from lg, twelve from xl. The
// skeleton has to carry the same spans or the page jumps when data lands.
test('the dashboard has a layout between one column and twelve', () => {
  const page = read('./DashboardPage.jsx');
  const skeleton = page.match(/function LoadingDashboard\(\) \{[\s\S]*?\n\}/)[0];
  const panels = page.slice(page.indexOf('export default function DashboardPage'));

  assert.equal((page.match(/lg:grid-cols-6 xl:grid-cols-12/g) ?? []).length, 2);
  assert.equal((skeleton.match(/lg:col-span-\d/g) ?? []).length, 5);
  assert.equal((panels.match(/lg:col-span-\d/g) ?? []).length, 5);
  assert.equal((page.match(/sm:grid-cols-2 xl:grid-cols-4/g) ?? []).length, 2);
});

test('the month tooltip lists every group in USD under a Total', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /Income in {unit}/);
  assert.match(page, /row\.groups\.map/);
  assert.match(page, /<span>Total<\/span>/);
});

// CONTRACT, pinned on this side only. crm/api pins the same three stage keys
// in its own tests; neither folder may read the other's files.
test('deals by stage is paying, ended and not paying yet, and nothing else', () => {
  const helper = read('../helpers/dashboard.js');
  const theme = read('../configs/dashboardTheme.js');

  assert.match(helper, /\['paying', 'ended', 'not_started', 'not_paying_yet'\]\.includes\(stage\.key\)/);
  assert.match(helper, /'Not paying yet'/);
  assert.match(helper, /'Paying'/);
  assert.match(helper, /'Ended'/);
  for (const key of ['paying', 'ended', 'not_started', 'not_paying_yet']) {
    assert.match(theme, new RegExp(`${key}: '#`), `STAGE_TONES has no colour for ${key}`);
  }
});

// ===============================
// * A SKIPPED MONTH IS SAID OUT LOUD
// ===============================
// A past month is read from a saved snapshot or not at all, so a month with
// none is skipped and every comparison on the page quietly measures against
// an older one. It was findable only in small print under the trend chart.
test('the page says when a comparison walked past a month', () => {
  const page = read('./DashboardPage.jsx');
  const trend = read('../components/badges/TrendText.jsx');

  // Detected from the CONSEQUENCE: the point before this month is not the
  // one that was compared against.
  assert.match(page, /const priorPoint = selectedIndex > 0 \? data\?\.trend\[selectedIndex - 1\] : null/);
  assert.match(page, /priorPoint && previousPoint && priorPoint\.month !== previousPoint\.month/);
  assert.match(page, /No saved snapshot for \{skippedMonth\}/);
  // Above the figures it is about, and a status rather than an alert.
  assert.match(page, /\{skippedMonth && \([\s\S]*?role="status"[\s\S]*?\)\}\s*<div className="grid gap-3 sm:grid-cols-2/);

  // And the trend line names the month it USED, not a fixed "last month".
  assert.match(trend, /function saidAgainst\(against, comparison\)/);
  assert.match(trend, /comparison\?\.comparedMonth \? `vs \$\{monthLabel\(comparison\.comparedMonth\)\}` : 'vs last month'/);
  // null still suppresses it; a string still overrides it.
  assert.match(trend, /if \(against === null\) return null/);
  assert.match(trend, /if \(against !== undefined\) return against/);
  // One month formatter, so a badge does not have to import a page for one.
  assert.match(trend, /from '\.\.\/\.\.\/helpers\/monthLabel'/);
  assert.doesNotMatch(page, /^function monthLabel/m);
});

// ===============================
// * A CAP YOU CANNOT SEE IS THE BUG
// ===============================
// The ring it replaced could not draw past full, so the ratio was clamped to
// 100 to fit one. September beat August and the card said "100% of last
// month" over a difference of +$4,635.79. Bars have no cap to hit.
test('Monthly Comparison leads with the change, and it is never clamped', () => {
  const page = read('./DashboardPage.jsx');

  // Built like Deals by Stage: one figure on top, the rows it is made of
  // underneath. What the ring's place holds is the CHANGE, not a total.
  assert.match(page, /<TrendText comparison=\{headline\} against=\{null\} size="lg" \/>/);
  assert.match(page, /const derived = changeBetween\(current, previous, lastMonth\)/);
  // One percentage for the card and the panel: the server's.
  assert.match(page, /const serverPercentage = performance\.comparison\?\.percentage;/);
  assert.match(page, /const months = \[[\s\S]*?key: 'last'[\s\S]*?key: 'this'[\s\S]*?key: 'next'[\s\S]*?\]/);
  assert.match(page, /tone: next\.forecast \? 'ghost' : 'soft'/);
  // The same three words the group key uses, and no date on any row: the
  // note above the panel already carries the span. Keyed by which month the
  // row IS, because an unprojected next month is drawn `soft`.
  assert.match(page, /const WORD_FOR = Object\.fromEntries\(MONTH_BARS_KEY\.map\(\(item\) => \[item\.key, item\.label\]\)\)/);
  assert.match(page, /key: 'last', label: WORD_FOR\.saved/);
  assert.match(page, /key: 'this', label: WORD_FOR\.thisMonth/);
  assert.match(page, /key: 'next', label: WORD_FOR\.forecast/);
  // Raw lists the same two rows and must not go back to its own wording.
  assert.match(page, /<dt className="text-\[10px\] text-text-faint">\{WORD_FOR\.thisMonth\}<\/dt>/);
  assert.match(page, /<dt className="text-\[10px\] text-text-faint">\{WORD_FOR\.saved\}<\/dt>/);
  const panel = page.match(/function MonthOnMonth\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(panel, /label: thisMonth|label: lastMonth|label: next\.label/);
  // A month with no figure is dropped, never listed as a zero.
  assert.match(page, /\]\.filter\(\(month\) => finite\(month\.value\)\)/);
  // The month after this one exists only as far as the horizon reaches.
  assert.match(page, /const nextPoint = selectedIndex >= 0 \? \(data\?\.trend\[selectedIndex \+ 1\] \?\? null\) : null/);

  // Each row against the row ABOVE it, so the forecast says what it adds to
  // this month rather than repeating this month's own rise.
  assert.match(page, /change: index === 0 \? null : changeBetween\(month\.value, months\[index - 1\]\.value, months\[index - 1\]\.label\)/);
  // Through TrendText, because a bare "3.8%" does not say which way it went.
  assert.match(page, /\{row\.change && <TrendText comparison=\{row\.change\} against=\{null\} \/>\}/);
  // The ratio it replaced was clamped to 100 so a ring could draw it, and
  // September beating August read as exactly 100%.
  assert.doesNotMatch(page, /Math\.min\(100/);

  // It is the RING that went, not the donut: Deals by Stage still draws one.
  assert.doesNotMatch(page, /total=\{100\}/);
  assert.match(page, /<Donut\s+segments=\{available\.map/);
  // The dots are the same three marks the bars and the keys use.
  assert.match(page, /const SWATCH_FOR = Object\.fromEntries\(MONTH_BARS_KEY\.map/);
  assert.match(page, /rounded-sm \$\{SWATCH_FOR\[row\.tone\]\}/);
});

// ===============================
// * A KEY IS A ROW OF SMALL BOXES, NOT A ROW OF RULES
// ===============================
// Each chart drew its own out of 24px lines, so four entries ran halfway
// across the panel and the row stood taller than the axis under it.
test('one legend, small square swatches, one short row', () => {
  const legend = read('../components/display/ChartLegend.jsx');
  const chart = read('../components/display/SourceTrendChart.jsx');
  const bars = read('../components/display/BarChart.jsx');
  const page = read('./DashboardPage.jsx');

  // ONE SHAPE, one definition. The key drew a box and the two chart popups
  // drew a 2px rule, so the same currency was a box above the chart and a
  // dash inside it.
  const theme = read('../configs/dashboardTheme.js');
  assert.match(theme, /export const CHART_SWATCH = 'h-2\.5 w-2\.5 shrink-0 rounded-\[3px\]'/);
  assert.match(legend, /import \{ CHART_SWATCH \} from '\.\.\/\.\.\/configs\/dashboardTheme'/);
  assert.match(legend, /className=\{`\$\{CHART_SWATCH\} \$\{item\.swatch \?\? ''\}`\}/);
  assert.equal((page.match(/<i className=\{CHART_SWATCH\}/g) ?? []).length, 2, 'both chart popups draw the shared swatch');
  assert.doesNotMatch(page, /h-0\.5 w-4/, 'no popup draws a rule for a currency any more');
  // The row costs its LINE height, not its type size: 10px type in a 16px
  // line box was taller than the swatch it carried.
  assert.match(legend, /leading-none/);
  // BOTH keys share ONE row, the same shape the bar chart's legend uses.
  assert.match(chart, /mb-1\.5 flex flex-wrap items-center justify-end/);
  assert.match(bars, /mb-1\.5 flex flex-wrap items-center justify-end/);

  // Nobody draws their own key any more.
  assert.match(chart, /<ChartLegend/);
  assert.match(page, /<ChartLegend items=\{monthBarsKey\(months\)\}/);
  assert.doesNotMatch(chart, /<svg width="24" height="8"/);
  assert.doesNotMatch(page, /<i className="h-2 w-4 rounded-sm/);

  // A swatch naming a colour it does not share is worse than no swatch, so
  // every key is built from the tones the marks are actually drawn with.
  assert.match(chart, /swatch: BAR_TONES\.strong/);
  assert.match(chart, /swatch: BAR_TONES\.ghost/);
  assert.match(page, /swatch: BAR_TONES\[item\.tone\]/);

  // Every source is still named where a screen reader can reach it.
  assert.match(chart, /<table className="sr-only">[\s\S]*?SOURCES\.map\(\(source\) => <th/);
  // And the point marker is a pale green ring, not a hole cut in the line.
  assert.match(chart, /fill-accent-tint-strong \$\{point\.source\.className\}/);
});

// It listed all four every time, so a chart with no gap in it still
// explained what a gap looks like, and a range with no forecast still
// carried a dashed entry.
test('the key names only what the chart actually drew', () => {
  const legend = read('../components/display/ChartLegend.jsx');
  const chart = read('../components/display/SourceTrendChart.jsx');

  assert.match(chart, /const present = new Set\(drawn\.flatMap/);
  assert.match(chart, /SOURCES\.filter\(\(source\) => present\.has\(source\.key\)\)/);
  assert.match(chart, /months\.some\(\(row\) => row\.unavailable\)/);
  // Only a currency lights a line, so the static entries stay unfocusable,
  // and `onLight` reaches the currency key ALONE.
  assert.match(chart, /lights: true/);
  assert.match(legend, /if \(!onLight \|\| !item\.lights\)/);
  assert.match(chart, /<ChartLegend items=\{currencyKey\} onLight=\{setLit\}/);
  assert.match(chart, /<ChartLegend items=\{monthKey\} label="Month legend" className="mr-auto"/);
  // ONE ROW, marks left and currencies right. `mr-auto` on the left half
  // rather than `justify-between`, so the right half stays right when a
  // narrow panel wraps it onto a line of its own.
  assert.match(chart, /mb-1\.5 flex flex-wrap items-center justify-end/);
  assert.doesNotMatch(chart, /justify-between[^"]*">\s*\{monthKey/);
});

// ===============================
// * A LIT ENTRY IS A CHIP, NOT A FORM CONTROL
// ===============================
// `button` in index.css carries px-4 py-2 and min-h-10, right for a real
// button and wrong for a key whose whole point is to cost one line's height:
// three currencies came out as three 40px boxes over the chart.
test('a legend entry that lights a line is chip sized, not button sized', () => {
  const legend = read('../components/display/ChartLegend.jsx');
  const css = read('../index.css');

  // The base rule is real, so the override has to be too.
  assert.match(css, /button \{\s*@apply[^}]*px-4 py-2 min-h-10/);
  assert.match(legend, /const LIT = '[^']*px-1\.5 py-1 min-h-0'/);
  assert.match(legend, /className=\{`\$\{ENTRY\} \$\{LIT\} transition-opacity/);
  // A utility beats a bare element selector, so nothing needs `!`.
  assert.doesNotMatch(legend, /!px-|!py-|!min-h-/);
  // The static entries are spans and never paid for any of it.
  assert.match(legend, /return <span key=\{item\.key\} className=\{ENTRY\}/);
});

// ===============================
// * TWO KEYS UNDER ALL, ONE EVERYWHERE ELSE
// ===============================
// A currency and a month are two questions. On one row the dashed month
// mark read as a fourth currency sitting beside GBP, AED and EURO.
test('under All the currencies key sits above the months key, and both are real', () => {
  const chart = read('../components/display/SourceTrendChart.jsx');

  assert.match(chart, /const currencyKey = multi\s*\?\s*drawn\.map/);
  assert.match(chart, /: \[\];/);
  assert.match(chart, /const monthKey = \[/);

  // ===============================
  // * ONE PALETTE FOR THE MONTHS, BOTH VIEWS
  // ===============================
  // They were greyed under All, on the grounds that a line's colour there
  // is its currency. Two keys naming the same three months in two palettes
  // was the worse trade, user's call 2026-09-10. The rows are what keeps
  // them apart: boxed chips above, plain marks below, a label on each.
  assert.match(chart, /SOURCES\.filter\(\(source\) => present\.has\(source\.key\)\)\.map\(\(\{ key, label, swatch \}\) => \(\{ key, label, swatch \}\)\)/);
  assert.doesNotMatch(chart, /MONTH_MARK/);
  assert.doesNotMatch(chart, /text-faint bg-surface'|current: 'bg-text-faint'/);

  // ===============================
  // * THE CHART STILL HAS TO SAY WHICH MONTH IS WHICH
  // ===============================
  // Every dot under All was hollow, so a past month and the current one
  // were identical on the plot. The centre carries it: filled is current.
  assert.match(chart, /const CURRENT_MONTH = 'estimate'/);
  assert.match(chart, /fill=\{set\.ink && point\.source\.key === CURRENT_MONTH \? set\.ink : undefined\}/);
  // `fill` as an attribute and `fill-surface` as a class never on the same
  // circle: the class wins and the dot would stay hollow.
  assert.match(chart, /point\.source\.key === CURRENT_MONTH \? undefined : 'fill-surface'/);
});

test('money sources, unavailable months, and accessible chart data remain distinct', () => {
  const chart = read('../components/display/SourceTrendChart.jsx');
  const money = read('../components/display/NormalizedMoney.jsx');

  // The three marks say WHICH MONTH, the same words the group key uses, and
  // carry no date. "Actual, Live estimate, Forecast" named our own plumbing.
  assert.match(chart, /label: 'Past months'/);
  assert.match(chart, /label: 'Current month'/);
  assert.match(chart, /label: 'Next month'/);
  const sources = chart.match(/const SOURCES = \[[\s\S]*?\];/)[0];
  assert.doesNotMatch(sources, /Actual|Live estimate|'Forecast'|\d{4}/);
  // Said once, and both keys are built from it: nothing names a month twice.
  assert.equal((chart.match(/label: '(Past months|Current month|Next month)'/g) ?? []).length, 3);
  // The description a screen reader gets says the same three things.
  assert.match(chart, /Past months, the current month, and next month projected/);
  assert.match(chart, /Unavailable/);
  assert.match(chart, /role="img"/);
  assert.match(chart, /<table className="sr-only">/);
  assert.match(money, /Converted subtotal: /);
  assert.match(money, /Converted subtotal excludes /);
});

// ===============================
// * A CHART THAT NEEDS A SCROLLBAR IS NOT A CHART YOU CAN GLANCE AT
// ===============================
test('the group charts fit their panel and no panel body scrolls sideways', () => {
  const page = read('./DashboardPage.jsx');
  const bars = read('../components/display/BarChart.jsx');

  assert.doesNotMatch(bars, /min-w-\[/);
  assert.doesNotMatch(page, /bodyClassName="overflow-x-auto/);
  assert.match(page, /className="scroll-slim overflow-x-auto"/);
});

// ===============================
// * `@apply` DROPS PSEUDO-ELEMENTS ON THE FLOOR
// ===============================
// `@apply scroll-slim` copies the two declarations and silently leaves
// every ::-webkit-scrollbar rule behind, so a table styled that way was
// thin in Firefox and untouched in Chrome. Both classes are named on one
// selector list instead.
test('every scrollbar in a card is the slim one, tables included', () => {
  const css = read('../index.css');
  const chart = read('../components/display/SourceTrendChart.jsx');

  assert.match(css, /\.scroll-slim, \.table-wrap \{/);
  assert.doesNotMatch(css, /@apply[^;]*\bscroll-slim\b/);
  for (const part of ['', '-track', '-thumb']) {
    assert.match(
      css,
      new RegExp(`\\.table-wrap::-webkit-scrollbar${part}[,\\s]`),
      `tables have no ::-webkit-scrollbar${part} rule`,
    );
  }
  assert.match(chart, /scroll-slim overflow-x-auto/);
});

// A flex item does not shrink below its own content, so five labels held
// the phone's bar wider than the phone and pushed Flagged off the end.
test('the phone nav is icons only, and every item can shrink', () => {
  const layout = read('../components/layout/Layout.jsx');

  assert.match(layout, /const bottomLink[\s\S]*?min-w-0 flex-1/);
  // sr-only, not hidden: the name is still announced at every width.
  assert.match(layout, /<span className="sr-only truncate sm:not-sr-only[^"]*">\{label\}<\/span>/);
  assert.match(layout, /fixed bottom-0 left-0 right-0[^"]*max-w-full overflow-hidden/);
});

// ===============================
// * NOTHING SCROLLS THE PAGE SIDEWAYS
// ===============================
// A page-level horizontal scrollbar takes the layout with it: the phone's
// bar is fixed to the viewport, so scrolling right slides the content out
// from under it. `clip` and not `hidden`, because hidden forces the other
// axis to auto and would break `position: sticky` for the header above it
// and the settings sidebar inside it.
test('the app shell cannot grow a horizontal page scrollbar', () => {
  const layout = read('../components/layout/Layout.jsx');

  assert.match(layout, /flex-1 min-w-0 overflow-x-clip/);
  assert.doesNotMatch(layout, /flex-1 min-w-0 overflow-x-hidden/);
  // The header and the settings sidebar both rely on sticky resolving
  // against the viewport, which a scroll container would take away.
  assert.match(layout, /sticky top-0 z-20/);
});

// ===============================
// * THE TYPE SCALE ITSELF IS FLUID
// ===============================
// 271 elements set an explicit size, so a smaller body size alone changed
// almost nothing and a `sm:` variant on each was 271 chances to miss one.
// Every step ramps between 375px and 640px instead, in one place.
test('every type step shrinks on a phone, and none of them by hand', () => {
  const config = read('../../tailwind.config.js');
  const css = read('../index.css');
  const scale = config.match(/fontSize: \{[\s\S]*?\n      \},/)[0];

  for (const step of ['xs', 'sm', 'base', 'lg', 'xl', "'2xl'", "'3xl'"]) {
    assert.match(scale, new RegExp(`${step}: \\['clamp\\(`), `${step} is not fluid`);
  }
  // A bare string drops Tailwind's line height and the headings run
  // together, so every step keeps its pair.
  assert.equal((scale.match(/\['clamp\([^\]]*', '[\d.]+rem'\]/g) ?? []).length, 7);
  // ONE mechanism. A breakpoint variant on the body as well would be a
  // second answer to the same question.
  assert.match(css, /body \{\s*@apply[^;]*font-sans text-base antialiased/);
  // iOS Safari zooms the page on any field under 16px. This one is in px
  // on purpose and stays out of the scale.
  assert.match(css, /text-\[16px\] sm:text-base/);
});

test('the page headings step down on a phone', () => {
  const header = read('../components/layout/PageHeader.jsx');
  const page = read('./DashboardPage.jsx');

  assert.match(header, /text-lg font-bold[^"]*sm:text-xl md:text-2xl/);
  assert.match(page, /text-lg font-bold[^"]*sm:text-xl md:text-2xl/);
  // The money card steps down again when it is showing SEVERAL currencies,
  // or three stacked lines stretch the whole row.
  assert.match(page, /dense \? 'text-\[13px\] sm:text-sm' : 'text-base sm:text-xl'/);
  assert.match(page, /dense=\{mode === RAW\}/);
});

// Both were positioned with a hand-measured `top-[184px]`, so a caption came
// off its bar whenever a panel changed height.
test('no chart caption is placed by a hand-measured offset', () => {
  const page = read('./DashboardPage.jsx');
  const bars = read('../components/display/BarChart.jsx');

  assert.doesNotMatch(page, /absolute top-\[\d+px\]/);
  assert.doesNotMatch(bars, /top-\[\d+px\]/);
  assert.match(bars, /axisTicks/);
});

test('a stage is the same colour in the donut as it is on the table badge', () => {
  const theme = read('../configs/dashboardTheme.js');
  const page = read('./DashboardPage.jsx');

  assert.match(theme, /STAGE_TONES = Object\.freeze\(\{[\s\S]*?paying:[\s\S]*?ended:[\s\S]*?not_paying_yet:/);
  assert.match(page, /STAGE_TONES\[stage\.key\]/);
  assert.doesNotMatch(page, /conic-gradient/);
});

test('one definition of the card surface, the tiles and the chart inks', () => {
  const page = read('./DashboardPage.jsx');
  const art = read('../components/display/KpiArt.jsx');

  assert.match(page, /import \{[\s\S]*?DASH_SURFACE[\s\S]*?\} from '\.\.\/configs\/dashboardTheme'/);
  assert.match(art, /KPI_ART_INK/);
  // Raw hex on the page is what the config exists to stop.
  assert.doesNotMatch(page, /#[0-9a-fA-F]{6}/);
});

// A control that opens nothing is worse than no control: the reference has a
// real card menu, we have none, and the glyph was drawn anyway.
test('the kpi cards carry no dead menu affordance', () => {
  const page = read('./DashboardPage.jsx');
  assert.doesNotMatch(page, /⋮/);
});

// ===============================
// * THE CARD ARTWORK IS DRAWN, NOT LOADED
// ===============================
// Four PNGs would be four requests, four files to keep in step with the
// palette, and four things that go soft on a retina screen.
test('each kpi card is tinted and carries its own vector artwork', () => {
  const page = read('./DashboardPage.jsx');
  const art = read('../components/display/KpiArt.jsx');
  const theme = read('../configs/dashboardTheme.js');

  for (const tone of ['green', 'amber', 'blue', 'violet']) {
    assert.match(theme, new RegExp(`${tone}: 'bg-gradient-to-br from-surface`), `KPI_SURFACES has no wash for ${tone}`);
    assert.match(theme, new RegExp(`${tone}: '#`), `KPI_ART_INK has no ink for ${tone}`);
    assert.match(art, new RegExp(`${tone}:`), `KpiArt draws nothing for ${tone}`);
  }
  assert.match(art, /<svg/);
  assert.doesNotMatch(art, /<img|\.png|\.jpg|url\(/);
  assert.match(art, /pointer-events-none absolute/);
  assert.match(art, /aria-hidden="true"/);
  assert.match(page, /<KpiArt tone=\{tone\} \/>/);
  assert.match(page, /KPI_SURFACES\[tone\]/);
  // The artwork must not paint over the figure it stands behind.
  assert.match(page, /<KpiArt tone=\{tone\} \/>\s*\{\/\*[\s\S]*?\*\/\}\s*<div className="relative">/);
});

test('a card that goes somewhere says so, and one that does not stays quiet', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /const goes = Boolean\(to \|\| onClick\)/);
  assert.match(page, /\{goes && \(/);
  assert.match(page, /aria-hidden="true"[\s\S]*?<ChevronIcon width=\{14\}/);
});

test('the skeleton is the shape of the page it stands in for', () => {
  const page = read('./DashboardPage.jsx');
  const skeleton = page.match(/function LoadingDashboard\(\) \{[\s\S]*?\n\}/)[0];

  assert.equal((skeleton.match(/xl:col-span-/g) ?? []).length, 5);
  assert.match(skeleton, /length: 4/);
});

// ***************************************************
// * RAW AND CONVERTED
// ***************************************************
//
// Both shapes already travel in every response: `money()` builds `native`
// unconditionally and adds `normalizedUsd` on top. So this is a display
// switch, not a refetch, and it must stay one.
test('the toggle is a display switch, not a filter', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /const CONVERTED = 'usd'/);
  assert.match(page, /const RAW = 'native'/);
  // The requested mode moved to helpers/dashboard.js with the rest of the
  // defaults, so the boot screen's prefetch cannot drift from the page.
  assert.match(read('../helpers/dashboard.js'), /currencyMode: 'usd'/);
  // Still requested in usd mode, because that is the response carrying BOTH.
  assert.match(page, /currencyMode: CURRENCY_MODE/);
  // The literal lives in helpers/dashboard.js now; the page reads it.
  assert.match(page, /const CURRENCY_MODE = DASHBOARD_REQUEST.currencyMode/);
  // Beside Filters, never inside the panel that needs Apply.
  assert.match(page, /<ViewToggle label="Amounts" value=\{mode\} onChange=\{setMode\} options=\{AMOUNT_OPTIONS\} \/>/);
  // Read the PANEL, not the rest of the file: an open ended scan from
  // `function FilterPanel` reaches the header below it and always matches.
  const panel = page.match(/function FilterPanel\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(panel, /AMOUNT_OPTIONS|ViewToggle/);
});

// A preference is not a filter. A filter is invisible state and dies with
// the tab; this names itself on the control and labels every figure.
test('the amount preference outlives the tab, and lives outside the filter store', () => {
  const page = read('./DashboardPage.jsx');
  const durable = read('../hooks/useDurableState.js');
  const sticky = read('../hooks/useStickyState.js');

  assert.match(page, /useDurableState\('dashboard\.amounts', CONVERTED\)/);
  assert.match(durable, /window\.localStorage/);
  assert.match(durable, /crm\.prefs\./);
  // The filter store keeps its own doctrine: no localStorage in that file.
  assert.doesNotMatch(sticky, /window\.localStorage/);
});

// ===============================
// * NO RATIO SURVIVES INTO RAW
// ===============================
// "up 3.2%" and "100% of last month" are one figure over another. In raw
// there are three of each in three units, so there is no honest ratio to
// draw and inventing one would be the worst of the options.
test('every ratio is hidden in raw rather than faked', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /comparison=\{mode === CONVERTED \? totalComparison : null\}/);
  assert.match(page, /note=\{mode === CONVERTED \? missingFxOf\(data\.summary\.monthlyPayable\) : null\}/);

  // ===============================
  // * BUT A CURRENCY AGAINST ITS OWN LAST MONTH IS ONE FIGURE OVER ONE
  // ===============================
  // The rule is about a ratio ACROSS currencies. Raw reports the same rise
  // the converted card shows, once per currency, which needs no rate.
  assert.match(page, /function compareNative\(current, previous, comparedMonth\)/);
  assert.match(page, /const nativeComparison = compareNative\(data\?\.summary\.monthlyPayable/);
  assert.match(page, /<NativeTotals money=\{data\.summary\.monthlyPayable\} changes=\{nativeComparison\} \/>/);
  // Both readings round the same move through one function.
  assert.match(page, /function changeBetween\(now, before, comparedMonth\)/);
  assert.match(page, /function compareMoney\(current, previous, comparedMonth\) \{[\s\S]*?return changeBetween\(current\.usd, previous\.usd, comparedMonth\)/);
  // Everything over nothing is not a rise of any size.
  assert.match(page, /percentage: Number\(before\) === 0 \? null/);

  // ===============================
  // * CODE, AMOUNT AND CHANGE ON ONE ROW
  // ===============================
  // The codes were printed twice, once beside the totals and once beside the
  // percentages, and "vs last month" wrapped onto a line of its own.
  assert.match(page, /grid grid-cols-\[auto_1fr_auto\] items-baseline/);
  // The amount is bare, because the row already says which currency it is.
  assert.match(page, /<span className="text-right tabular-nums">\{bareIn\(money, code\)\}<\/span>/);
  // And the caption sits in the same slot the other three cards use.
  // Named, not "last month": with a month skipped it is not last month.
  assert.match(page, /detail=\{mode === RAW \? `vs \$\{lastMonth\}` : undefined\}/);
  assert.match(page, /function MonthOnMonth\(\{ performance, mode, lastMonth, next \}\)/);
  assert.match(page, /if \(mode === RAW\) \{/);
  // The RAW branch returns before the headline, so nothing leads with one
  // percentage across three currencies.
  assert.match(page, /if \(mode === RAW\) \{[\s\S]*?\n  \}\n\n  \/\/ ===============================\n  \/\/ \* THE CHANGE ON TOP, THE MONTHS UNDER IT/);
  // The DIFFERENCE survives into raw, per currency, because that is the one
  // subtraction that needs no rate. Only the ratio is dropped.
  assert.match(page, /const deltas = codes\.map/);
  assert.match(page, /\{delta > 0 \? '\+' : ''\}\{formatMoneyCode\(delta, code\)\}/);
});

// Only a CONVERTED total can be short. Raw never converts, so the missing
// rate warning would be a lie there.
test('the missing rate warning belongs to the converted view only', () => {
  const page = read('./DashboardPage.jsx');
  assert.match(page, /mode === CONVERTED && missingFx\.length > 0/);
});

// ===============================
// * AN AXIS CARRIES ONE UNIT
// ===============================
// GBP 80,850, AED 54,342 and EURO 3,510 cannot share a scale, a bar or a
// percentage, so raw plots ONE currency and the panel says which.
test('a chart in raw names the currency it is drawing and lets it be changed', () => {
  const page = read('./DashboardPage.jsx');

  assert.match(page, /function ChartUnit/);
  assert.match(page, /if \(mode === CONVERTED\) return <PanelNote>\{note\}, USD<\/PanelNote>/);
  assert.match(page, /function currenciesIn/);
  assert.match(page, /currencies\.includes\(currency\) \? currency : currencies\[0\]/);
  // Both range panels get the picker, and both charts plot the same pick.
  assert.equal((page.match(/<ChartUnit mode=\{mode\}/g) ?? []).length, 2);
  assert.match(page, /<PaymentOverview points=\{data\.trend\} groups=\{groups\} mode=\{mode\} picked=\{picked\} currencies=\{currencies\} \/>/);
  assert.match(page, /<PaymentGroupBars [^>]*mode=\{mode\} picked=\{barPicked\} currencies=\{currencies\} \/>/);

  // ===============================
  // * TWO PICKERS, TWO STATES, TWO OPTION LISTS
  // ===============================
  // They were two controls on screen wired to ONE piece of state, so they
  // looked independent and moved together. Separate now, which is also the
  // only honest way to offer All on the lines and refuse it on the bars.
  assert.match(page, /function ChartUnit\(\{ mode, note, currencies, picked, onPick, allowAll = true \}\)/);
  assert.match(page, /allowAll \? \[\{ value: ALL, label: 'All' \}\] : \[\]/);
  assert.match(page, /onPick=\{setBarCurrency\} allowAll=\{false\}/);
  assert.match(page, /useStickyState\('dashboard\.barCurrency', ''\)/);
  // It resolves to a real currency or the biggest one, never to ALL.
  assert.match(page, /const barPicked = currencies\.includes\(barCurrency\) \? barCurrency : currencies\[0\]/);
});

// ===============================
// * ALL IS NOT A CURRENCY
// ===============================
// The picker's one non currency value, and the reason every reader has to
// ask `everyCurrency` before passing `picked` to `valueIn`: as a code it
// would look up `native['*all']`, find nothing, and print "No *all".
test('All draws one line per currency and is never treated as a code', () => {
  const page = read('./DashboardPage.jsx');
  const chart = read('../components/display/SourceTrendChart.jsx');
  const theme = read('../configs/dashboardTheme.js');

  assert.match(page, /const ALL = '\*all'/);
  assert.match(page, /allowAll \? \[\{ value: ALL, label: 'All' \}\] : \[\]/);
  // Offered only beside two or more currencies, so a stored All can never
  // resolve to one line calling itself every one. AND ONLY IN RAW: without
  // the mode it drew three raw lines under a header saying USD.
  assert.match(page, /mode === RAW && currency === ALL && currencies\.length > 1/);
  assert.match(page, /const everyCurrency = picked === ALL/);
  assert.match(page, /const series = everyCurrency \? currencySeries\(points, currencies\) : null/);

  // ONE TRIM ACROSS EVERY SERIES. Trimmed separately, a currency starting a
  // month later would draw its first point over the wrong month.
  assert.match(page, /function currencySeries\(points, currencies\)/);
  assert.match(page, /const first = filled\.indexOf\(true\)/);
  assert.match(page, /rows\.slice\(first, filled\.lastIndexOf\(true\) \+ 1\)/);

  // One ink per line, and the popup names them with the same ink or the
  // legend and the tooltip disagree about which line is which.
  assert.match(theme, /export const SERIES_INK = Object\.freeze\(\[/);
  assert.match(chart, /const multi = Array\.isArray\(series\) && series\.length > 0/);
  assert.match(chart, /const sets = multi \? series : \[\{ code: currency, rows \}\]/);
  assert.match(chart, /stroke=\{set\.ink \?\? undefined\}/);
  assert.match(page, /background: seriesInk\(order\)/);
});

// ===============================
// * A STACK OF CURRENCIES NAMES THEM ALL THE SAME WAY
// ===============================
// Intl gives GBP a symbol and AED a code, so the card read "AED 54,342.50 /
// EURO 3,510.00 / £80,850.00": two lines naming their currency and one not.
test('stacked currencies all lead with their code', () => {
  const money = read('../helpers/formatMoney.js');
  const stack = read('../components/display/NormalizedMoney.jsx');
  const page = read('./DashboardPage.jsx');

  assert.match(money, /export function formatMoneyCode/);
  assert.match(stack, /formatMoneyCode\(amount, currency\)/);
  // The Difference rows stack under those same figures.
  assert.match(page, /formatMoneyCode\(delta, code\)/);
  // A SINGLE amount keeps its symbol. This is about stacks, not about
  // deleting the pound sign from the CRM.
  assert.match(money, /export function formatMoney\(/);
  assert.match(money, /currencyDisplay: 'narrowSymbol'/);
  // And where the code is already the row's label the amount is bare, or
  // the line reads "EURO   EURO 3,510".
  assert.match(page, /function bareIn\(money, code, whole = false\)/);
  assert.match(page, /\{bareIn\(row\.total, code, true\)\}/);
});

// ===============================
// * THE BARS CARRY ONE CURRENCY, THE POPUP CARRIES ALL OF THEM
// ===============================
// An axis has one unit; a list does not. Five groups over three months in
// three currencies is forty five bars, which is not a comparison.
test('a group breaks down in the popup, never in the bars', () => {
  const page = read('./DashboardPage.jsx');

  // ONE UNIT, ALWAYS: the picker offers no All, so nothing falls back to a
  // currency nobody chose and reports it in a caption under the chart.
  assert.match(page, /const unit = mode === CONVERTED \? CURRENCY : picked/);
  assert.doesNotMatch(page, /Bars in \{unit\}/, 'a caption reporting a default is not a control');
  const bars = page.match(/function PaymentGroupBars\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(bars, /everyCurrency|=== ALL/, 'the bars never see All');

  assert.match(page, /function GroupBreakdownTooltip\(\{ bar, currencies \}\)/);
  assert.match(page, /mode === CONVERTED\s*\?\s*<GroupTooltip bar=\{bar\} unit=\{unit\} \/>\s*:\s*<GroupBreakdownTooltip bar=\{bar\} currencies=\{currencies\} \/>/);
  assert.match(page, /breakdown: mode === CONVERTED \? null : breakdownFor\(point, name\)/);
  // A group paid only in EURO must not vanish from a panel drawn in GBP: its
  // bar is flat, its popup has the figures, and dropping it says it does not
  // exist. So visibility asks every currency, not the bar height.
  assert.match(page, /Object\.values\(breakdownFor\(point, name\)\)\.some\(\(amount\) => amount > 0\)/);
  assert.match(page, /One line per currency on a shared scale/);

  // EVERY CURRENCY, ZERO INCLUDED, dimmed rather than dropped. The same rule
  // the group rows in CurrencyGroupsTooltip already follow.
  const popup = page.match(/function GroupBreakdownTooltip\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(popup, /\.filter\(/, 'a currency at zero is dimmed, never filtered out');
  assert.match(popup, /amount === 0 \? 'opacity-45' : ''/);
  assert.match(popup, /total === 0 \? 'opacity-45' : ''/);
});

// ===============================
// * "TOTAL", NOT "ALL GROUPS"
// ===============================
// There is a real group CALLED `ALL GROUPS` (the twelve NA roster rows), so
// a total row of that name sat among the group rows it was summing. The
// export modal already carries this rule; both popups were breaking it.
test('a total row is never named after a real group', () => {
  const page = read('./DashboardPage.jsx');
  const modal = read('../components/export/MasterSheetExportModal.jsx');

  assert.match(modal, /There\s*\n?\s*\/\/?\s*is a real group CALLED "ALL GROUPS"|is a real group CALLED "ALL GROUPS"/);
  assert.doesNotMatch(page, /All [Gg]roups</, 'a total row must not wear a group name');
  assert.equal((page.match(/<span>Total<\/span>|<dt>Total<\/dt>/g) ?? []).length, 2);
});

// ===============================
// * ONE LINE IS ONE CURRENCY, SO ITS POPUP IS THAT CURRENCY BY GROUP
// ===============================
// One hit rect per month meant three lines shared one popup and it said the
// same three currency totals wherever the pointer was, so none of them said
// which groups the figure was made of.
test('under All the pointer picks a line, and the popup breaks that currency down', () => {
  const page = read('./DashboardPage.jsx');
  const chart = read('../components/display/SourceTrendChart.jsx');

  // Every pixel of the column belongs to the NEAREST line: no dead ground,
  // and never a question about which currency was asked about.
  assert.match(chart, /const lanesAt = \(index\) =>/);
  assert.match(chart, /\.sort\(\(a, b\) => a\.point\.y - b\.point\.y\)/);
  assert.match(chart, /const edge = \(i\) => \(lanes\[i\]\.point\.y \+ lanes\[i \+ 1\]\.point\.y\) \/ 2/);
  assert.match(chart, /top: i === 0 \? PAD\.top : edge\(i - 1\)/);
  assert.match(chart, /bottom: i === lanes\.length - 1 \? baseline : edge\(i\)/);
  assert.match(chart, /\{multi && months\.map\(\(row, index\) => lanesAt\(index\)\.map\(\(lane\) => \(/);
  assert.match(chart, /onMouseEnter=\{show\(index, lane\.code\)\}/);
  // The lanes are POINTER ONLY. One tab stop per line per month is
  // seventy two across a year in three currencies, and the column above
  // already announces the month.
  const lanes = chart.match(/\{multi && months\.map\(\(row, index\) => lanesAt[\s\S]*?\)\)\}/)[0];
  assert.doesNotMatch(lanes, /tabIndex|onFocus|role=/);
  assert.match(lanes, /aria-hidden="true"/);
  // The column keeps the keyboard, and the lanes cover it for the pointer.
  assert.match(chart, /aria-label=\{`Show \$\{row\.label\} payment details`\}/);
  assert.match(chart, /onFocus=\{show\(index\)\}/);

  // The series reaches the caller, which decides what a line means.
  assert.match(chart, /const show = \(index, code = null\) =>/);
  assert.match(chart, /setActive\(\{ index, code, x: box\.left \+ box\.width \/ 2, y: box\.bottom \}\)/);
  assert.match(chart, /tooltip\(months\[active\.index\], active\.index, active\.code\)/);
  assert.match(page, /if \(!code\) return <AllMonthsTooltip row=\{row\} currencies=\{currencies\} \/>/);
  assert.match(page, /return <CurrencyGroupsTooltip row=\{row\} code=\{code\} names=\{names\} ink=\{inkFor\(code\)\}/);

  // EVERY GROUP, ZERO INCLUDED. A group left out is impossible to tell from
  // a group that earned nothing, and which of the two it is is the question.
  assert.match(page, /function groupNamesIn\(groups, points\)/);
  assert.match(page, /const names = groupNamesIn\(groups, points\)/);
  assert.match(page, /const names = groupNamesIn\(groups, months\)/);
  assert.match(page, /function CurrencyGroupsTooltip\(\{ row, code, names, ink \}\)/);
  assert.match(page, /names\.map\(\(name\) => \(\{[\s\S]*?valueIn\(row\.groups\.find\(\(group\) => group\.name === name\)\?\.payable, RAW, code\) \?\? 0/);
  assert.match(page, /entry\.value === 0 \? 'opacity-45' : ''/);
  const popup = page.match(/function CurrencyGroupsTooltip\([\s\S]*?\n\}/)[0];
  // Dimmed, never dropped.
  assert.doesNotMatch(popup, /\.filter\(/);
  // EVERY AMOUNT NAMES ITS CURRENCY. The rows are labelled by GROUP, so a
  // bare figure had nothing on its line saying what it was. The symbol where
  // Intl knows one, the code where it does not: the sheet's own `EURO` is
  // not an ISO code and comes back as `EURO 1,510`.
  assert.match(popup, /\{formatMoneyWhole\(entry\.value, code\)\}/);
  assert.match(popup, /\{formatMoneyWhole\(total, code\)\}/);
  assert.doesNotMatch(popup, /formatNumber/, 'a group row has no code of its own to lean on');
  // The other two popups label their rows BY CODE, so they stay bare.
  assert.match(page, /\{bareIn\(row\.total, code, true\)\}/);
  // The swatch is the line's own ink, off the same ordered list.
  assert.match(page, /const inkFor = \(code\) => seriesInk\(Math\.max\(currencies\.indexOf\(code\), 0\)\)/);
});

// ===============================
// * THE CURRENCY INKS DO NOT RUN OUT
// ===============================
// Read as `SERIES_INK[i % length]`, a SEVENTH currency was drawn in the
// first one's green with a key claiming the two differ. A currency arrives
// by turning up on a sheet, so the list cannot be the limit.
test('a seventh currency gets a colour of its own', () => {
  const theme = read('../configs/dashboardTheme.js');
  const chart = read('../components/display/SourceTrendChart.jsx');
  const page = read('./DashboardPage.jsx');

  assert.match(theme, /export function seriesInk\(index\)/);
  assert.match(theme, /if \(at < SERIES_INK\.length\) return SERIES_INK\[at\]/);
  assert.match(theme, /const GOLDEN_ANGLE = 137\.508/);
  assert.match(theme, /hsl\(\$\{hue\.toFixed\(1\)\} \$\{GENERATED\.saturation\}% \$\{GENERATED\.lightness\}%\)/);
  // Nobody indexes the list by hand any more, which is the whole point.
  for (const [name, source] of [['the chart', chart], ['the page', page]]) {
    assert.doesNotMatch(source, /SERIES_INK\[/, `${name} still indexes the ink list itself`);
  }
  assert.match(chart, /const inkFor = \(index\) => seriesInk\(index\)/);
});

// ===============================
// * THE KEY SAYS WHICH MONTH, NOT WHICH KIND OF MONTH
// ===============================
// "Saved, This month, Forecast" left the reader working out which bar was
// August, and naming the months outright dated a key sitting beside a panel
// note that already carries the range.
test('the group key reads last, current and next month, with no date on it', () => {
  const page = read('./DashboardPage.jsx');
  const marks = page.match(/const MONTH_BARS_KEY = \[[\s\S]*?\]\.map/)[0];

  assert.match(marks, /label: 'Last month'/);
  assert.match(marks, /label: 'Current month'/);
  assert.match(marks, /label: 'Next month'/);
  assert.doesNotMatch(marks, /Saved|This month|Forecast/);
  // No month name and no year anywhere in the key's own words.
  assert.doesNotMatch(marks, /monthLabel|\d{4}/);

  assert.match(page, /function monthBarsKey\(points\)/);
  assert.match(page, /MONTH_TONE\[point\.source\] === item\.tone/);
  // "Last month" has to BE last month: three months of history draws two
  // saved bars, and a gap in the range draws one older than it looks.
  assert.match(page, /function monthOffset\(month, offset\)/);
  assert.match(page, /months\[0\] === monthOffset\(current, item\.step\)/);
  assert.match(page, /adjacent \|\| !item\.plural \? item\.label : item\.plural/);
  assert.match(marks, /plural: 'Earlier months', step: -1/);
  assert.match(marks, /plural: 'Later months', step: 1/);
  // A tone with no month in the range drops out rather than naming nothing.
  assert.match(page, /\.filter\(\(item\) => item\.label\)/);
});

// ===============================
// * A STAGE COUNT IS A LINK TO THE ROWS IT COUNTED
// ===============================
// The ring reported 19 deals nobody could get to, so "which 19" meant
// filtering the master sheet by hand and hoping it agreed.
test('every slice and every row of Deals by Stage opens the sheet filtered', () => {
  const page = read('./DashboardPage.jsx');
  const donut = read('../components/display/Donut.jsx');
  const css = read('../index.css');

  assert.match(page, /function stageLink\(key\)/);
  assert.match(page, /const period = PERIOD_FOR_STAGE\[key\]/);
  assert.match(page, /`\/master-sheet\?\$\{LINK_FILTER\.period\}=\$\{encodeURIComponent\(period\)\}`/);
  // An unmapped stage gets NO link, never one that filters to nothing.
  assert.match(page, /period \? `\/master-sheet[^`]*` : null/);

  // The rows are real links and the name underlines on hover.
  assert.match(page, /<Link\s+key=\{stage\.key\}\s+to=\{stageLink\(stage\.key\) \?\? '\/master-sheet'\}/);
  assert.match(page, /group-hover:underline">\{stage\.name\}<\/span>/);

  // The arc is the pointer shortcut. The svg is aria-hidden, so nothing
  // focusable may go inside it: the rows carry the keyboard.
  assert.match(page, /onSelect=\{\(segment\) => \{ const to = stageLink\(segment\.key\); if \(to\) navigate\(to\); \}\}/);
  assert.match(page, /const navigate = useNavigate\(\)/);
  assert.match(donut, /aria-hidden="true"/);
  assert.doesNotMatch(donut, /tabIndex|role="button"/);

  // It GLOWS rather than grows: a thicker stroke slides the arc under the
  // cursor and lights the neighbour instead.
  assert.match(donut, /chart-ring\$\{onSelect \? ' chart-slice' : ''\}/);
  assert.match(donut, /\{ color: segment\.color \}/);
  // AND THE CENTRE BOX LETS THE POINTER THROUGH. It is `inset-0`, so it
  // covers the ring as well as the hole and swallowed every click.
  assert.match(donut, /<div className="pointer-events-none absolute inset-0 grid place-items-center/);
  assert.match(css, /\.chart-slice:hover \{ filter: drop-shadow\(0 0 4px currentColor\)/);
  assert.match(css, /\.chart-slice:active \{ filter: drop-shadow/);
  assert.match(css, /\.chart-slice \{ transition: none; \}/);
});

// One definition of the query string key, because the writer and the reader
// are in different files and a typo between them fails silently: the page
// opens unfiltered and looks perfectly fine.
test('a link seeds the master sheet filter it names, then stops naming it', () => {
  const config = read('../configs/linkFilters.js');
  const sheet = read('./MasterSheetPage.jsx');
  const sticky = read('../hooks/useStickyState.js');
  const page = read('./DashboardPage.jsx');

  assert.match(config, /export const LINK_FILTER = Object\.freeze\(\{\s*group: 'group',\s*period: 'period',/);
  // `period`, never `status`: status is the company's own and nothing else.
  assert.doesNotMatch(config, /status:/);

  assert.match(sheet, /useStickyState\('masterSheet\.group', '', LINK_FILTER\.group\)/);
  assert.match(sheet, /useStickyState\('masterSheet\.status', '', LINK_FILTER\.period\)/);
  assert.match(sheet, /import \{ LINK_FILTER \} from '\.\.\/configs\/linkFilters'/);

  // Read in the initialiser, so the page's FIRST request is the filtered
  // one rather than a wasted round trip.
  assert.match(sticky, /const seeded = param \? readParam\(param\) : undefined/);
  assert.match(sticky, /seeded === undefined \? read\(key, initial\) : seeded/);
  // And stripped, or Clear would work until the next refresh put it back.
  assert.match(sticky, /function stripParam\(param\)/);
  assert.match(sticky, /window\.history\.replaceState/);
  assert.match(sticky, /useEffect\(\(\) => \{ if \(param\) stripParam\(param\); \}, \[param\]\)/);

  // The group bars were already writing this link and nothing read it.
  assert.match(page, /`\/master-sheet\?\$\{LINK_FILTER\.group\}=\$\{encodeURIComponent\(name\)\}`/);
});

// A hairline on a 720 unit box reads as a diagram beside the axis rules it
// crosses. The CURVE is untouched: monotone cubic, so a month is never
// drawn below the value it earned. See helpers/curve.js.
test('the trend line carries the weight of the panel it is the subject of', () => {
  const chart = read('../components/display/SourceTrendChart.jsx');
  const curve = read('../helpers/curve.js');

  const stroke = chart.match(/const STROKE = \{ single: ([\d.]+), multi: ([\d.]+) \}/);
  assert.ok(Number(stroke[1]) >= 3, `the single line is ${stroke[1]}`);
  assert.ok(Number(stroke[2]) < Number(stroke[1]), 'several lines stay lighter than one');
  assert.match(chart, /strokeLinecap="round"/);
  assert.match(chart, /strokeLinejoin="round"/);
  // The monotone guard is what stops a smoother curve being an option.
  assert.match(curve, /if \(slopes\[i - 1\] \* slopes\[i\] <= 0\) return 0/);
});

test('ViewToggle carries a second pair without becoming a second component', () => {
  const toggle = read('../components/layout/ViewToggle.jsx');
  const cards = read('./cardDesign.test.js');

  assert.match(toggle, /options = OPTIONS, label = 'View'/);
  assert.match(toggle, /\{options\.map\(/);
  assert.match(toggle, /aria-label=\{label\}/);
  // The grid/rows default has to survive, or three pages change silently.
  assert.match(toggle, /GridViewIcon/);
  assert.match(toggle, /RowsViewIcon/);
  assert.match(cards, /ViewToggle/);
});
