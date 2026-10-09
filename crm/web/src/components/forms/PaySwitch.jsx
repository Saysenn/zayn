import Toggle from './Toggle';

/**
 * A person's Should be paid or Paid, read off their live deals.
 *
 *   yes / no  the switch, on or off
 *   mixed     their deals disagree. Faded and off, the same look an
 *             undecided switch has always had; one press sets every deal on.
 *   null      no live deals, so nothing to set: a dash
 */
export default function PaySwitch({ state, label, onChange }) {
  if (!state) return <span className="text-text-faint">—</span>;
  const mixed = state === 'mixed';
  return (
    <span
      className={`inline-flex ${mixed ? 'opacity-60' : ''}`}
      title={mixed ? 'Mixed: some of their deals are yes, some no. Switch on to set them all.' : undefined}
    >
      <Toggle checked={state === 'yes'} onChange={onChange} label={label} />
    </span>
  );
}
