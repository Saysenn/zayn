import Button from '../buttons/Button';
import { GridViewIcon, RowsViewIcon } from '../icons';

const OPTIONS = [
  { value: 'grid', label: 'Grid view', Icon: GridViewIcon },
  { value: 'rows', label: 'Row view', Icon: RowsViewIcon },
];

/**
 * ONE TOGGLE, TWO JOBS. It was grid/rows only and the dashboard needed the
 * same pill for raw/converted amounts. Extended with its own options rather
 * than copied: a second one drifts, and this already carries the pressed
 * state, the sizing and the labels every other pill in the CRM uses.
 */
export default function ViewToggle({ value, onChange, options = OPTIONS, label = 'View' }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-surface p-0.5" role="group" aria-label={label}>
      {options.map(({ value: option, label: optionLabel, Icon }) => (
        <Button
          key={option}
          size="icon"
          variant={value === option ? 'primary' : 'quiet'}
          className="h-7 w-7 min-h-0 p-0"
          aria-label={optionLabel}
          aria-pressed={value === option}
          title={optionLabel}
          onClick={() => onChange(option)}
        >
          <Icon width={15} height={15} />
        </Button>
      ))}
    </div>
  );
}
