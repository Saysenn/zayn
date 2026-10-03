// ***************************************************
// * One reading of a comparison
// ***************************************************
//
// TrendBadge and TrendText say the same thing in two shapes, a pill and a
// line of text. They were also rounding the percentage in two places, so
// the modal and the card behind it could disagree on the same figure.

const DIRECTIONS = ['higher', 'lower', 'unchanged'];

/** Always one of higher / lower / unchanged / unavailable. */
export function trendDirection(comparison) {
  const direction = comparison?.direction;
  return DIRECTIONS.includes(direction) ? direction : 'unavailable';
}

/** `12.4%`, or null when there is no percentage to show. */
export function trendPercentText(comparison) {
  const percent = Number(comparison?.percentage);
  if (!Number.isFinite(percent)) return null;
  return `${Math.abs(percent).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}
