// ***************************************************
// * Gridlines a person recognises
// ***************************************************
//
// A bar chart scaled to its own tallest bar has no axis at all: you can see
// which bar is biggest and nothing else. These round the top up to a step
// somebody reads at a glance (25K, not 23,417).

// 2.5 is in here for the 250/2,500/25,000 case, which is common in money and
// is the step a plain 1/2/5 ladder skips straight past.
const STEPS = [1, 2, 2.5, 5, 10];

const clean = (value) => Number(value.toFixed(6));

// ===============================
// * THE AXIS GUTTER FITS THE LABELS, NOT THE WIDEST ONE IMAGINABLE
// ===============================
// Both charts reserved a fixed gutter and right-aligned the ticks in it, so
// "$60,000" left a finger's width of blank card to its left and the plot
// started well inside the panel while the title sat on the edge.
//
// A digit at 10px in the app's stack is a little under 6px, and a comma or
// a currency symbol is narrower, so this over-estimates slightly. That is
// the safe direction: a tick with 2px spare beats a tick that wraps.
const CHAR_WIDTH = 5.8;
const AXIS_PADDING = 8;

/** How much room a column of right-aligned tick labels actually needs. */
export function axisGutter(labels, charWidth = CHAR_WIDTH, padding = AXIS_PADDING) {
  const longest = Math.max(0, ...labels.map((label) => String(label ?? '').length));
  return Math.round(longest * charWidth) + padding;
}

/** `[0, 25000, 50000, 75000, 100000]`. The last entry is the axis top. */
export function axisTicks(max, tickCount = 4) {
  const count = Math.max(1, Math.floor(tickCount));
  const peak = Number(max);
  if (!Number.isFinite(peak) || peak <= 0) return [0, 1];

  const rough = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = (STEPS.find((factor) => factor * magnitude >= rough) ?? 10) * magnitude;
  const top = Math.ceil(clean(peak / step)) * step;

  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(clean(value));
  return ticks;
}
