// ***************************************************
// * Every colour and surface the dashboard draws with
// ***************************************************
//
// The page carried raw hex in six places and wrote the card's shadow out in
// two files, so one change of green meant hunting for them. Tailwind classes
// where a class works; a real value only where SVG or a gradient needs one.

// The card every KPI, panel and modal tile stands on. One definition, so a
// panel and a modal tile cannot drift apart. The app's own card: rounded-lg,
// a hairline and at most shadow-sm, the same as every other page's.
export const DASH_SURFACE = 'rounded-lg border border-border bg-surface shadow-sm';

export const DASH_LIFT = 'transition duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none';

// The four icon tiles on the KPI row. THEME TOKENS, not hex gradients with
// white glyphs: a tint fill with its own ink on top, the way every badge in
// the CRM is drawn, so the tiles follow light and dark with everything else.
export const KPI_TONES = Object.freeze({
  green: 'bg-success-tint text-success-strong',
  amber: 'bg-warning-tint text-warning-strong',
  blue: 'bg-metric-blue text-metric-blue-ink',
  violet: 'bg-metric-violet text-metric-violet-ink',
});

// ===============================
// * EACH KPI CARD IS TINTED AND CARRIES ITS OWN ARTWORK
// ===============================
// Four white cards in a row read as one block, and the eye has to read the
// label to tell them apart. A wash and a drawing make each one findable
// from across the screen. Both are FAINT on purpose: the figure is the
// thing, and artwork that competes with a total is worse than none. The
// wash ends on the same tint token as the card's tile.
export const KPI_SURFACES = Object.freeze({
  green: 'bg-gradient-to-br from-surface via-surface to-success-tint',
  amber: 'bg-gradient-to-br from-surface via-surface to-warning-tint',
  blue: 'bg-gradient-to-br from-surface via-surface to-metric-blue',
  violet: 'bg-gradient-to-br from-surface via-surface to-metric-violet',
});

// The ink the artwork is drawn in, one per tone. SVG cannot read a Tailwind
// token, so the values sit here with everything else the dashboard draws in.
export const KPI_ART_INK = Object.freeze({
  green: '#16c477',
  amber: '#efa900',
  blue: '#2788db',
  violet: '#805ddd',
});

// ===============================
// * A STAGE IS THE SAME COLOUR WHEREVER IT IS DRAWN
// ===============================
// These mirror .badge-paying, .badge-ended and .badge-not_started in
// index.css. The donut used green/blue/amber, so Ended read as blue in the
// ring and grey on the table two panels below it.
export const STAGE_TONES = Object.freeze({
  paying: '#14764a',
  ended: '#94a39a',
  not_started: '#d99e12',
  not_paying_yet: '#d99e12',
});

// Bars, as classes: the leader, the rest, and the dashed previous period.
export const BAR_TONES = Object.freeze({
  strong: 'bg-accent-strong',
  soft: 'bg-accent',
  ghost: 'border border-dashed border-accent-strong bg-accent-tint',
});

// ===============================
// * A SWATCH IS A SQUARE, WHEREVER IT IS DRAWN
// ===============================
// The key drew one and the two chart popups drew a 2px RULE instead, so the
// same currency was a box above the chart and a dash inside it. A shape is a
// decision, not a detail of whoever happens to render it.
export const CHART_SWATCH = 'h-2.5 w-2.5 shrink-0 rounded-[3px]';

// The two chart fills follow the theme: configs/themes.js `chart`, through useTheme().

// ===============================
// * ONE LINE PER CURRENCY NEEDS ONE COLOUR PER CURRENCY
// ===============================
// Only reached when the amount toggle is RAW and the picker says All. The
// green leads because it is the CRM's own colour and the biggest currency
// earns it; the rest are chosen to stay apart at a 2px stroke rather than
// to be decorative. Assigned by position, so a currency keeps its colour
// for as long as it keeps its rank.
export const SERIES_INK = Object.freeze([
  '#14764a',
  '#2788db',
  '#c2670c',
  '#805ddd',
  '#0f8f8f',
  '#b3261e',
]);

// ===============================
// * AND IT DOES NOT RUN OUT
// ===============================
// The inks were read as `SERIES_INK[i % length]`, so a SEVENTH currency was
// drawn in the first one's green with a key claiming the two differ. A
// currency arrives by turning up on a sheet, so the list cannot be the
// limit. Past the chosen six the hue steps by the golden angle, which is
// what keeps generated hues apart rather than clustering; saturation and
// lightness are fixed, so a generated ink carries the same weight on a 2px
// stroke as a chosen one.
const GOLDEN_ANGLE = 137.508;
const GENERATED = { saturation: 62, lightness: 38 };

export function seriesInk(index) {
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0) return SERIES_INK[0];
  if (at < SERIES_INK.length) return SERIES_INK[at];
  const hue = ((at - SERIES_INK.length + 1) * GOLDEN_ANGLE) % 360;
  return `hsl(${hue.toFixed(1)} ${GENERATED.saturation}% ${GENERATED.lightness}%)`;
}

// Dark, like the reference: a tooltip is an overlay on the chart, not
// another white card sitting on top of a white card.
// Tokens both ways: the text colour as the fill, the surface as the ink.
export const CHART_TOOLTIP = 'rounded-lg border border-border bg-text/95 text-surface shadow-md backdrop-blur-sm';
