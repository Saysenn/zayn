import { BADGE_LABELS } from '../../configs/badgeKinds';

/**
 * @param {string} status  keys the colour AND the label
 * @param {string} [label] OVERRIDES the word, never the colour. The end
 *   date cell shows HIS phrase rather than ours, and an unrecognised one
 *   has to print verbatim; the class still has to come from a known key,
 *   or arbitrary text would build class names with spaces in them.
 * @param {'sm'} [size]    smaller, for inside a table cell
 */
export default function StatusBadge({ status, label, size }) {
  return (
    <span className={`badge badge-${status}${size === 'sm' ? ' badge-sm' : ''}`}>
      {label ?? BADGE_LABELS[status] ?? status}
    </span>
  );
}
