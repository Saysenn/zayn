import { CheckCircleIcon, WarningIcon } from '../icons';

/**
 * The payday-check verdict, as one icon beside the Paid toggle.
 *
 * Shown on both People and the master sheet, which is why it's a component
 * rather than markup pasted twice.
 *
 * Derived from the outcome, never stored separately. "Needs review" isn't
 * a fourth thing to keep in step with the other three — it's what `partial`
 * and `not_received` MEAN, so a stored flag could only ever drift out of
 * agreement with the outcome sitting next to it.
 *
 * Silent for `sent` and `no_response` and for no check at all: the icon
 * answers "is this person's pay settled", and "nobody has told us yet" is
 * not a finding. An icon there would put a mark against every row in the
 * table on the day the checks go out.
 */
const VERDICTS = {
  confirmed: {
    Icon: CheckCircleIcon,
    className: 'text-accent',
    title: 'Received in full. Nothing to look at.',
  },
  partial: {
    Icon: WarningIcon,
    className: 'text-warning',
    title: 'Received, but not the full amount. Needs a look, see the notes for what arrived.',
  },
  not_received: {
    Icon: WarningIcon,
    className: 'text-warning',
    title: 'Says nothing arrived. Needs a look.',
  },
};

export default function PaydayIndicator({ outcome, size = 15 }) {
  const verdict = VERDICTS[outcome];
  if (!verdict) return null;

  const { Icon, className, title } = verdict;
  return (
    // The title lives on a wrapper rather than the svg, because the icons
    // are aria-hidden and a tooltip on a hidden element is a tooltip
    // nobody gets.
    <span className={`inline-flex shrink-0 ${className}`} title={title} role="img" aria-label={title}>
      <Icon width={size} height={size} />
    </span>
  );
}
