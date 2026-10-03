import { useId, useState } from 'react';
import { BAR_TONES, seriesInk } from '../../configs/dashboardTheme';
import { useTheme } from '../../hooks/useTheme';
import { axisGutter, axisTicks } from '../../helpers/chartScale';
import { smoothArea, smoothPath } from '../../helpers/curve';
import { formatMoney, formatMoneyWhole } from '../../helpers/formatMoney';
import { finite, lineRuns, scaleFor } from '../../helpers/sourceTrend';
import ChartLegend from './ChartLegend';
import ChartTooltip from './ChartTooltip';

const WIDTH = 720;
const HEIGHT = 196;
// NO LEFT PADDING HERE. The gutter is measured from the ticks actually
// drawn (axisGutter), because a tick is a whole amount now and the widest
// one it might ever have to fit is not the width it needs today. Fixed at
// 78 it left a finger's width of blank card between the panel's edge and
// the first tick, so the chart sat inboard of its own title.
const PAD = { top: 12, right: 14, bottom: 28 };
const TICK_COUNT = 4;
const FORECAST_DASH = '7 5';
// What an unlit line fades to while another is hovered. Faint enough to
// step back, never gone: dimming a line to nothing loses the comparison.
const DIMMED = 0.16;
// Lighter where several lines share the plot: at the single line's weight
// three of them read as bands rather than as a trend.
//
// THE SINGLE LINE IS THE PANEL'S SUBJECT, so it carries weight. At 2.25 on
// a 720 unit box it read as a hairline diagram beside the axis rules it
// crosses; the curve itself is unchanged. Round caps and joins are on the
// path, and they only show at this weight.
const STROKE = { single: 3, multi: 2.25 };
// How solid the wash is where it meets the line. Lighter with several of
// them, because they overlap and the sum is what the eye reads.
const AREA_FADE = { single: 0.32, multi: 0.16 };

// A month carries exactly one of these, and the dot says which. The LINE is
// one series across all of them: see lineRuns in helpers/sourceTrend.
//
// `swatch` is the bars' own three marks, imported rather than written
// again: the two charts sit side by side, so solid, pale and dashed have to
// mean the same thing on both.
//
// ===============================
// * THE KEY SAYS WHICH MONTH, NOT WHERE THE FIGURE CAME FROM
// ===============================
// "Actual, Live estimate, Forecast" named our own plumbing. A reader wants
// to know which mark is which MONTH, and the key beside it in Group
// Overview already answers that. No date on any of them, so neither key
// rolls out of true.
const SOURCES = [
  { key: 'actual', label: 'Past months', className: 'stroke-accent-strong', swatch: BAR_TONES.strong },
  { key: 'estimate', label: 'Current month', className: 'stroke-accent', swatch: BAR_TONES.soft },
  { key: 'forecast', label: 'Next month', className: 'stroke-accent-strong', swatch: BAR_TONES.ghost },
];

// The key of the month the page is reporting. Named, because `estimate` is
// where the figure comes FROM and this is about which month it IS.
const CURRENT_MONTH = 'estimate';

// The one mark a bar has no name for: a month with no saved snapshot. The
// sunken fill is #f3f6f4 on white, which at 24px wide read as a band and at
// 10px reads as nothing. It keeps a hairline so the box has an edge.
//
// THE MONTH MARKS ARE THE SAME IN BOTH VIEWS, `swatch` off SOURCES. They
// were greyed under All, on the grounds that the line's colour there is the
// currency; two keys naming the same three months in two palettes was the
// worse trade, user's call. What separates them on screen is the row: the
// currency chips are boxed and sit above, the month marks are plain text
// below, and each row carries its own label.
const MARK = {
  unavailable: 'bg-surface-sunken border border-border-strong',
};

const sourceOf = (row) => SOURCES.find((source) => finite(row[source.key]));
const valueOf = (row) => SOURCES.map(({ key }) => row[key]).find(finite);

/**
 * ===============================
 * * ONE SERIES, OR ONE PER CURRENCY
 * ===============================
 * `rows` draws a single line coloured by what each month IS: saved, live or
 * forecast. `series` draws one line per currency instead, each in its own
 * ink, for the raw toggle's All. Every series shares the month axis, so
 * they are given ALREADY TRIMMED TO THE SAME LENGTH.
 *
 * The forecast stays dashed either way: what a month is does not stop being
 * true because the chart is now about currency.
 */
export default function SourceTrendChart({ rows, series, currency, title, tooltip, height = HEIGHT }) {
  // SVG cannot read a token, so the theme's value. See configs/themes.js.
  const areaInk = useTheme().theme.chart.area;
  const id = useId().replace(/:/g, '');
  const [active, setActive] = useState(null);
  // The legend is the hover target, not the line: the month hit rects sit
  // over the whole plot, so a line can never receive the pointer itself.
  const [lit, setLit] = useState(null);
  const multi = Array.isArray(series) && series.length > 0;
  const sets = multi ? series : [{ code: currency, rows }];
  const months = sets[0].rows;
  const values = sets.flatMap((set) => set.rows.flatMap((row) => SOURCES.map(({ key }) => row[key]))).filter(finite).map(Number);
  const hasValues = values.length > 0;
  const chartTitle = title ?? (currency ? `Monthly payment trend in ${currency}` : 'Monthly payment trend');
  // Never index the ink list here: see seriesInk. Taken modulo its length,
  // a seventh currency came out in the first one's colour.
  const inkFor = (index) => seriesInk(index);
  // Whole pounds or dollars on the axis, never an abbreviated magnitude.
  // With several currencies on it no symbol is true, so the axis is bare.
  const tick = (value) => (multi || !currency ? Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 }) : formatMoneyWhole(value, currency));
  if (months.length === 0) {
    return <p className="py-12 text-center text-sm text-text-muted">No payable history is available for this range.</p>;
  }

  // ROUND GRIDLINES WHEN NOTHING IS NEGATIVE. The axis was drawn straight
  // off the tallest value, so the top of the chart read "$145,053", which is
  // a data point pretending to be a scale. A negative total still needs a
  // scale around zero, which axisTicks does not do, so it keeps the old one.
  const { min: rawMin, max: rawMax } = scaleFor(values);
  const ticks = rawMin >= 0 ? axisTicks(rawMax, TICK_COUNT) : [rawMin, rawMin + ((rawMax - rawMin) / 2), rawMax];
  const min = rawMin >= 0 ? 0 : rawMin;
  const max = rawMin >= 0 ? ticks.at(-1) : rawMax;
  // In viewBox units, which the svg scales to the panel. Close enough to
  // px: the box is 720 wide and the panel is rarely far off that.
  const padLeft = axisGutter(ticks.map(tick));
  const innerWidth = WIDTH - padLeft - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const x = (index) => padLeft + (months.length === 1 ? innerWidth / 2 : (index * innerWidth) / (months.length - 1));
  const y = (value) => PAD.top + ((max - Number(value)) / (max - min)) * innerHeight;
  const baseline = PAD.top + innerHeight;

  const drawn = sets.map((set, order) => {
    const plotted = set.rows.flatMap((row, index) => {
      const source = row.unavailable ? null : sourceOf(row);
      if (!source) return [];
      return [{ index, row, source, forecast: source.key === 'forecast', x: x(index), y: y(row[source.key]) }];
    });
    return { ...set, order, ink: multi ? inkFor(order) : null, plotted, runs: lineRuns(plotted) };
  });
  const fade = (code) => (lit !== null && lit !== code ? DIMMED : 1);

  // ===============================
  // * THE KEY NAMES WHAT IS DRAWN, NOTHING ELSE
  // ===============================
  // It listed all four every time, so a chart with no gap still explained
  // what a gap looks like and a range with no forecast still had a dashed
  // entry. Built from the points actually plotted instead.
  const present = new Set(drawn.flatMap((set) => set.plotted.map((point) => point.source.key)));

  // ===============================
  // * TWO KEYS UNDER ALL, ONE EVERYWHERE ELSE
  // ===============================
  // A currency and a month are two questions, and on one row the dashed
  // month mark read as a fourth currency sitting beside GBP, AED and EURO.
  // The currencies go on top, because they are the entries that light a
  // line; what each mark MEANS goes underneath.
  const currencyKey = multi
    ? drawn.map((set) => ({ key: set.code, label: set.code, ink: set.ink, lights: true, opacity: fade(set.code) }))
    : [];
  const monthKey = [
    ...SOURCES.filter((source) => present.has(source.key)).map(({ key, label, swatch }) => ({ key, label, swatch })),
    ...(months.some((row) => row.unavailable) ? [{ key: 'unavailable', label: 'Unavailable', swatch: MARK.unavailable }] : []),
  ];

  const show = (index, code = null) => (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive({ index, code, x: box.left + box.width / 2, y: box.bottom });
  };

  // ===============================
  // * A LINE IS A CURRENCY, SO THE POINTER PICKS A LINE
  // ===============================
  // One hit rect per month meant three lines shared one popup, and it said
  // the same thing wherever the pointer was. The column is cut into LANES
  // instead, one per series, divided at the midpoint between two lines:
  // every pixel belongs to the nearest line, so there is no dead ground and
  // never a question about which currency was asked about.
  const hitWidth = innerWidth / Math.max(months.length, 1);
  const hitLeft = (index) => Math.max(padLeft, x(index) - hitWidth / 2);
  const lanesAt = (index) => {
    const lanes = drawn
      .map((set) => ({ code: set.code, point: set.plotted.find((plot) => plot.index === index) }))
      .filter((lane) => lane.point)
      .sort((a, b) => a.point.y - b.point.y);
    const edge = (i) => (lanes[i].point.y + lanes[i + 1].point.y) / 2;
    return lanes.map((lane, i) => ({
      code: lane.code,
      top: i === 0 ? PAD.top : edge(i - 1),
      bottom: i === lanes.length - 1 ? baseline : edge(i),
    }));
  };

  return (
    <div>
      {/* ONE ROW: what the marks mean on the left, the currencies that light
          a line on the right. Two stacked rows cost the chart a line of its
          own height for a key that fits beside itself. Same shape as the bar
          chart's legend, `mr-auto` on the left half so the right half stays
          right when a narrow panel wraps it.

          `onLight` goes to the currency key alone; the month marks are text. */}
      {(monthKey.length > 0 || currencyKey.length > 0) && (
        <div className="mb-1.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {monthKey.length > 0 && <ChartLegend items={monthKey} label="Month legend" className="mr-auto" />}
          {currencyKey.length > 0 && <ChartLegend items={currencyKey} onLight={setLit} label="Currency legend" />}
        </div>
      )}

      {/* The tooltip is PORTALLED (see ChartTooltip). It was clipped twice
          over in here: by the box that lets a narrow chart scroll, and by
          the panel's own overflow-hidden. */}
      {/* `active.code` is the series the pointer is on, or null where the
          whole month was asked about. The caller decides what each means. */}
      {active !== null && tooltip && <ChartTooltip at={active}>{tooltip(months[active.index], active.index, active.code)}</ChartTooltip>}

      <div className="scroll-slim overflow-x-auto" onMouseLeave={() => setActive(null)}>
        {/* NO SVG TITLE ELEMENT ANYWHERE IN HERE. The browser renders one as
            a native tooltip, so hovering the chart popped a grey "Payment
            Overview" box on top of the real one. aria-label says the same
            thing to a screen reader and draws nothing. */}
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full min-w-[360px]" role="img" aria-label={chartTitle} aria-describedby={`${id}desc`}>
          <desc id={`${id}desc`}>{multi ? 'One line per currency, dashed where the month is a forecast. Shaded months have no available data.' : 'Past months, the current month, and next month projected. Shaded months have no available data.'}</desc>
          <defs>
            {/* ONE WASH PER LINE, IN THAT LINE'S OWN COLOUR. Every series
                fades to nothing at the baseline, the way the KPI cards are
                drawn. Faint, because several of them overlap. */}
            {drawn.map((set) => (
              <linearGradient key={`grad-${set.order}`} id={`${id}area${set.order}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={set.ink ?? areaInk} stopOpacity={multi ? AREA_FADE.multi : AREA_FADE.single} />
                <stop offset="100%" stopColor={set.ink ?? areaInk} stopOpacity="0.01" />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((tickValue) => {
            const tickY = y(tickValue);
            return (
              <g key={tickValue}>
                <line x1={padLeft} x2={WIDTH - PAD.right} y1={tickY} y2={tickY} className="stroke-border" />
                {hasValues && <text x={padLeft - 8} y={tickY + 4} textAnchor="end" className="fill-text-faint text-[10px]">{tick(tickValue)}</text>}
              </g>
            );
          })}

          {/* A PLAIN WASH, NOT A HATCH. Diagonal stripes at full height made
              a month with no snapshot the loudest thing on the chart. */}
          {months.map((row, index) => {
            const slotWidth = innerWidth / Math.max(months.length - 1, 1);
            return row.unavailable ? (
              <rect key={row.label} x={Math.max(padLeft, x(index) - slotWidth / 2)} y={PAD.top} width={slotWidth} height={innerHeight} className="fill-surface-sunken" opacity="0.6" />
            ) : null;
          })}

          <g className="chart-in">
            {/* EVERY WASH FIRST, THEN EVERY LINE. Grouped per series, the
                second currency's fill was painted over the first one's line
                and tinted it. Only the earned part is filled: a forecast is
                a dashed line over nothing, which is what it is worth. */}
            {drawn.map((set) => set.runs.filter((run) => !run.forecast).map((run) => (
              <path
                key={`area-${set.order}-${run.points[0].index}`}
                d={smoothArea(run.points, baseline)}
                fill={`url(#${id}area${set.order})`}
                opacity={fade(set.code)}
                className="transition-opacity"
              />
            )))}
            {drawn.map((set) => (
              <g key={`series-${set.code ?? 'one'}`} style={{ opacity: fade(set.code) }} className="transition-opacity">
                {set.runs.map((run) => (
                  <path
                    key={`line-${run.forecast}-${run.points[0].index}`}
                    d={smoothPath(run.points)}
                    fill="none"
                    strokeWidth={multi ? STROKE.multi : STROKE.single}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={run.forecast ? FORECAST_DASH : undefined}
                    stroke={set.ink ?? undefined}
                    className={set.ink ? undefined : 'stroke-accent-strong'}
                  />
                ))}
                {/* PALE GREEN INSIDE THE RING, not white. A white centre on
                    a white card cut a hole in the line. Single series only:
                    the multi lines are blue, violet and orange, and a green
                    centre on one of those claims the wrong series.

                    UNDER ALL THE CENTRE SAYS WHICH MONTH. Every dot was
                    hollow, so the line could not tell a past month from the
                    current one and the key was not allowed to name them.
                    Filled is the current month, hollow is a past one.
                    `fill` as an attribute and `fill-surface` as a class
                    never on the same circle: the class would win. */}
                {set.plotted.map((point) => (
                  <circle
                    key={`dot-${point.index}`}
                    cx={point.x}
                    cy={point.y}
                    r={multi ? 3 : 3.5}
                    stroke={set.ink ?? undefined}
                    fill={set.ink && point.source.key === CURRENT_MONTH ? set.ink : undefined}
                    className={set.ink
                      ? (point.source.key === CURRENT_MONTH ? undefined : 'fill-surface')
                      : `fill-accent-tint-strong ${point.source.className}`}
                    strokeWidth="2"
                  />
                ))}
              </g>
            ))}
          </g>

          {/* THE COLUMN IS THE KEYBOARD'S TARGET and, with one line, the
              pointer's too. Under All the lanes below cover it completely,
              so a tab still reaches the month's summary while the pointer
              always lands on a currency. */}
          {months.map((row, index) => (
            <rect
              key={`hit-${row.label}`}
              x={hitLeft(index)}
              y={PAD.top}
              width={hitWidth}
              height={innerHeight}
              fill="transparent"
              tabIndex="0"
              role="button"
              aria-label={`Show ${row.label} payment details`}
              onMouseEnter={show(index)}
              onFocus={show(index)}
              onBlur={() => setActive(null)}
            />
          ))}

          {/* Pointer only, and unfocusable: the column above already
              announces the month, and one tab stop per line per month would
              be seventy two of them across a year in three currencies. */}
          {multi && months.map((row, index) => lanesAt(index).map((lane) => (
            <rect
              key={`lane-${row.label}-${lane.code}`}
              x={hitLeft(index)}
              y={lane.top}
              width={hitWidth}
              height={Math.max(lane.bottom - lane.top, 0)}
              fill="transparent"
              aria-hidden="true"
              onMouseEnter={show(index, lane.code)}
            />
          )))}

          {months.map((row, index) => (
            <text key={`label-${row.label}`} x={x(index)} y={height - 10} textAnchor="middle" className="fill-text-muted text-[10px]">{row.label}</text>
          ))}
        </svg>
      </div>

      <table className="sr-only">
        <caption>{chartTitle}</caption>
        <thead><tr><th>Month</th>{multi ? sets.map((set) => <th key={set.code}>{set.code}</th>) : SOURCES.map((source) => <th key={source.key}>{source.label}</th>)}</tr></thead>
        <tbody>
          {months.map((row, index) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              {multi
                ? sets.map((set) => {
                  const cell = valueOf(set.rows[index]);
                  return <td key={set.code}>{finite(cell) ? formatMoney(cell, set.code) : row.unavailable ? 'Unavailable' : 'None'}</td>;
                })
                : SOURCES.map((source) => <td key={source.key}>{finite(row[source.key]) ? (currency ? formatMoney(row[source.key], currency) : String(row[source.key])) : row.unavailable ? 'Unavailable' : 'Not this source'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
