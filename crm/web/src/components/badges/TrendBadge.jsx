import { trendDirection, trendPercentText } from '../../helpers/trend';

const SKINS = {
  higher: 'bg-accent-tint text-accent-strong',
  lower: 'bg-danger-tint text-danger',
  unchanged: 'bg-surface-sunken text-text-muted',
  unavailable: 'bg-surface-sunken text-text-faint',
};

export default function TrendBadge({ comparison, compact = false }) {
  const direction = trendDirection(comparison);
  const percentText = trendPercentText(comparison);
  const label = direction === 'unchanged'
    ? 'Unchanged'
    : direction === 'unavailable'
      ? 'No comparison'
      : `${percentText ? `${percentText} ` : ''}${direction}`;

  return (
    <span className={`badge ${SKINS[direction]} ${compact ? 'px-2 py-0 text-[10px]' : ''}`}>
      {label}
    </span>
  );
}
