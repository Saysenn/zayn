import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BAR_TONES } from '../../configs/dashboardTheme';
import { axisGutter, axisTicks } from '../../helpers/chartScale';
import ChartTooltip from './ChartTooltip';

// ***************************************************
// * The dashboard's bar charts
// ***************************************************
//
// Both group panels positioned their axis captions with a hand-measured
// absolute offset in pixels, so a caption drifted off its bar the moment a
// panel changed height. Nothing here is measured by hand: the bars and their
// captions are two flex rows sharing one gap, and the plot GROWS to whatever
// height the panel has rather than leaving white space under itself.
//
// IT TAKES AS MANY BARS AS IT IS GIVEN. Columns share the room down to a
// floor; past that the plot scrolls sideways while the y axis stays put, so
// a month-by-month comparison stays readable instead of being sliced away.

const TICK_COUNT = 4;
// A bar for a real but tiny amount still has to be visible, or zero and
// "almost nothing" look the same.
const MIN_BAR = 4;
// Past this many columns the labels above the bars run into each other.
const VALUE_LABEL_MAX = 6;
// The narrowest a single bar may be squeezed before the plot scrolls.
const MIN_BAR_SLOT = 14;
// ===============================
// * AND THE WIDEST IT MAY GROW
// ===============================
// A bar takes its share of the column, so three groups on a wide panel gave
// each one a slab. It was capped at 32 and still read as blocks. The chart
// is a row of thin markers to compare heights across: past this the width
// starts carrying a meaning it does not have.
const MAX_BAR_SLOT = 18;
const COLUMN_GAP = 8;
// The gutter is MEASURED from the ticks (see axisGutter), not fixed: at 74
// a "$60,000" axis left a finger's width of blank card to its left and the
// plot started well inside the panel while the title sat on the edge.
const AXIS_GAP = 8;
// The caption row is a fixed height so the axis column can reserve exactly
// as much, which is what keeps a tick level with the gridline it names.
const CAPTION_HEIGHT = 18;
const STAGGER_MS = 40;

function Bars({ values, heightFor, delay }) {
  return (
    <span className="flex h-full w-full items-end justify-center gap-1">
      {values.map((entry, index) => (
        <span
          key={entry.key ?? index}
          className={`chart-bar w-full rounded-t-md transition-[filter] group-hover:brightness-95 ${BAR_TONES[entry.tone] ?? BAR_TONES.soft}`}
          style={{
            height: heightFor(entry.value), minHeight: MIN_BAR, maxWidth: MAX_BAR_SLOT, animationDelay: `${delay}ms`,
          }}
        />
      ))}
    </span>
  );
}

export default function BarChart({ bars, formatValue, showValues = false, legend, caption, renderTooltip }) {
  const [active, setActive] = useState(null);
  const values = bars.flatMap((bar) => bar.values.map((entry) => Number(entry.value) || 0));
  const ticks = axisTicks(Math.max(...values, 0), TICK_COUNT);
  const top = ticks.at(-1);
  const heightFor = (value) => `${(Math.max(0, Number(value) || 0) / top) * 100}%`;
  const labelValues = showValues && bars.length <= VALUE_LABEL_MAX;
  const axisWidth = axisGutter(ticks.map(formatValue));
  const perColumn = Math.max(...bars.map((bar) => bar.values.length), 1);
  // A floor, not a width: while the panel is wider than this the columns
  // share the room as before, and only past it does anything scroll.
  const minWidth = bars.length * (perColumn * MIN_BAR_SLOT + COLUMN_GAP);

  const hovered = active && bars.find((bar) => bar.key === active.key);
  const show = (key) => (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive({ key, x: box.left + box.width / 2, y: box.bottom });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onMouseLeave={() => setActive(null)}>
      {/* The row is as short as its type: it sits between the panel title
          and the plot, and every 6px it takes comes off the chart. */}
      {legend && <div className="mb-1.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] leading-none text-text-muted">{legend}</div>}
      {hovered && renderTooltip && <ChartTooltip at={active}>{renderTooltip(hovered)}</ChartTooltip>}

      <div className="flex min-h-0 flex-1" style={{ gap: AXIS_GAP }}>
        <div className="relative shrink-0" style={{ width: axisWidth, paddingBottom: CAPTION_HEIGHT }} aria-hidden="true">
          <div className="relative h-full">
            {ticks.map((tick) => (
              <span key={tick} className="absolute right-0 translate-y-1/2 text-[10px] tabular-nums text-text-faint" style={{ bottom: `${(tick / top) * 100}%` }}>
                {formatValue(tick)}
              </span>
            ))}
          </div>
        </div>

        <div className="scroll-slim min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full flex-col" style={{ minWidth }}>
            <div className="relative min-h-0 flex-1">
              {ticks.map((tick) => (
                <span key={tick} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(tick / top) * 100}%` }} aria-hidden="true" />
              ))}
              <div className="relative flex h-full items-end" style={{ gap: COLUMN_GAP }}>
                {bars.map((bar, index) => {
                  const body = (
                    <>
                      {labelValues && (
                        <span className="mb-1.5 whitespace-nowrap text-[9px] font-semibold tabular-nums text-text">
                          {formatValue(bar.values[0]?.value)}
                        </span>
                      )}
                      <Bars values={bar.values} heightFor={heightFor} delay={index * STAGGER_MS} />
                    </>
                  );
                  // `key` stays out of the spread: React warns when one is
                  // spread in from a props object rather than written on the tag.
                  const props = {
                    className: 'group flex h-full min-w-0 flex-1 flex-col items-center justify-end no-underline',
                    onMouseEnter: show(bar.key),
                    onFocus: show(bar.key),
                    onBlur: () => setActive(null),
                  };
                  return bar.to
                    ? <Link key={bar.key} {...props} to={bar.to}>{body}</Link>
                    : <div key={bar.key} {...props} tabIndex={0}>{body}</div>;
                })}
              </div>
            </div>

            <div className="flex items-center" style={{ height: CAPTION_HEIGHT, gap: COLUMN_GAP }}>
              {bars.map((bar) => (
                <span key={bar.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-text-muted">{bar.label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.key}>
              <th>{bar.label}</th>
              {bar.values.map((entry, index) => <td key={entry.key ?? index}>{entry.label ? `${entry.label}: ` : ''}{formatValue(entry.value)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
