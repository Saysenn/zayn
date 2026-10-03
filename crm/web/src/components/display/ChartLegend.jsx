import { CHART_SWATCH } from '../../configs/dashboardTheme';

// ***************************************************
// * The key above a chart
// ***************************************************
//
// A SQUARE, NOT A RULE. Every chart drew its own key out of 24px lines, so
// four entries ran halfway across the panel and the row stood taller than
// the axis labels under it. A box says the same thing in a third of the
// width, and one row height means the three panels line up.
//
// One component, because the trend chart's key and the bar chart's key are
// the same object: a colour, a word, and sometimes a hover that lights the
// series it names.

// The whole point of the rewrite. `leading-none` matters as much as the
// size: the row was 10px type in a 16px line box, so it cost more height
// than the swatch it carried.
//
// The SHAPE is CHART_SWATCH, shared with the chart popups: the same
// currency was a box up here and a 2px dash inside the tooltip.
const ENTRY = 'inline-flex items-center gap-1.5 leading-none';

// ===============================
// * A LIT ENTRY IS A CHIP, NOT A FORM CONTROL
// ===============================
// `button` in index.css carries px-4 py-2 and min-h-10, which is right for a
// real button and drew three 40px boxes on a key whose whole point is to
// cost one line's height. Undone here, once, rather than by anyone who
// happens to put a button in a legend.
const LIT = 'rounded-md border-border px-1.5 py-1 min-h-0';

/**
 * `items` are `{ key, label, swatch, ink, lights }`. `swatch` is classes,
 * for a colour the palette already names; `ink` is a value, for the per
 * currency inks that no class exists for. An entry is a BUTTON only where
 * it lights something, so the static ones stay unfocusable.
 */
export default function ChartLegend({ items, onLight, label, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-none text-text-muted ${className}`} aria-label={label}>
      {items.map((item) => {
        const swatch = (
          <i
            aria-hidden="true"
            className={`${CHART_SWATCH} ${item.swatch ?? ''}`}
            style={item.ink ? { background: item.ink } : undefined}
          />
        );
        const style = { opacity: item.opacity ?? 1 };
        if (!onLight || !item.lights) {
          return <span key={item.key} className={ENTRY} style={style}>{swatch}{item.label}</span>;
        }
        return (
          <button
            key={item.key}
            type="button"
            className={`${ENTRY} ${LIT} transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-strong`}
            style={style}
            onMouseEnter={() => onLight(item.key)}
            onMouseLeave={() => onLight(null)}
            onFocus={() => onLight(item.key)}
            onBlur={() => onLight(null)}
          >
            {swatch}{item.label}
          </button>
        );
      })}
    </div>
  );
}
