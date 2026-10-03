import { monthLabel } from '../../helpers/monthLabel';
import { trendDirection, trendPercentText } from '../../helpers/trend';

// The same fact as TrendBadge, in the shape a KPI card needs: a line under
// the figure, not a pill beside it. Both read the comparison through
// helpers/trend, so they cannot round it differently.
const ARROWS = { higher: '↑', lower: '↓', unchanged: '', unavailable: '' };
const INKS = {
  higher: 'text-accent-strong',
  lower: 'text-danger',
  unchanged: 'text-text-muted',
  unavailable: 'text-text-faint',
};

// `lg` is for a card that leads with the CHANGE rather than with a figure,
// where this is the biggest thing on it. Same reading, same rounding, same
// two colours: only the type grows.
const SIZES = { sm: 'text-[11px]', lg: 'text-4xl leading-none tracking-tight' };

// ===============================
// * IT NAMES THE MONTH IT ACTUALLY USED
// ===============================
// This said "vs last month" whatever it was comparing to. A past month is
// only ever read from a saved snapshot, so a month with none is SKIPPED and
// the comparison walks further back: with no September snapshot the card
// would have said "vs last month" about August, while the panel under it
// correctly named August. `comparedMonth` is on every comparison; it is now
// what the label is made of, and the fixed string is the fallback for a
// comparison that carries no month at all.
function saidAgainst(against, comparison) {
  if (against === null) return null;
  if (against !== undefined) return against;
  return comparison?.comparedMonth ? `vs ${monthLabel(comparison.comparedMonth)}` : 'vs last month';
}

/**
 * `against` takes null where the caller already says what the change is
 * measured against: the raw card puts one of these on each currency's row
 * and captions the three of them once, underneath. A string overrides it.
 */
export default function TrendText({ comparison, against, size = 'sm' }) {
  const direction = trendDirection(comparison);
  if (!comparison || direction === 'unavailable') {
    return <span className="text-[11px] text-text-faint">No previous comparison</span>;
  }
  const percent = trendPercentText(comparison);
  const said = saidAgainst(against, comparison);
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${SIZES[size] ?? SIZES.sm}`}>
      <strong className={INKS[direction]}>
        {ARROWS[direction] && `${ARROWS[direction]} `}
        {percent ?? direction}
      </strong>
      {said && <span className="text-[11px] text-text-faint">{said}</span>}
    </span>
  );
}
