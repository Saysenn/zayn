import Select from './Select';
import Button from '../buttons/Button';
import { PlusIcon, CloseIcon } from '../icons';

/**
 * WHO WORKS ON THIS COMPANY, each in their own role and group.
 *
 * The Companies page used to pick a list of names and then apply ONE role
 * and ONE group to all of them, which meant a Director and a Mid could not
 * be added together at all: both came out with whichever single role was
 * picked. That is the commonest arrangement there is.
 *
 * THREE FIELDS, NOT TWENTY. The money, the address and the banking stay
 * out of this dialog on purpose: its job is to bring a company into
 * existence with its people attached, and those are set per row afterwards
 * or through Add deal, which is the form built for them. Twenty fields
 * per handler here would make this a second Add deal that has to be kept
 * in step with the first.
 *
 * ONE CAPTION ROW, not a label per cell: the house rule for a repeating
 * editor, and with four handlers a floating label on each of twelve fields
 * is more label than form.
 */

// One definition, shared by the caption row and every handler row. Two
// grids that must line up and are written twice stop lining up the first
// time a column is added.
const COLUMNS = 'sm:grid-cols-[1fr_1fr_1fr_auto]';

export default function HandlerRows({ handlers, onChange, options }) {
  const set = (i, key, value) => onChange(
    handlers.map((h, n) => (n === i ? { ...h, [key]: value } : h)),
  );

  return (
    <div className="space-y-2">
      {/* Desktop only: stacked on a phone each field carries its own
          placeholder and a three-column header lines up with nothing. */}
      <div className={`hidden gap-2 px-1 sm:grid ${COLUMNS}`}>
        {['Handler *', 'Role *', 'Group *'].map((label) => (
          <span key={label} className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">
            {label}
          </span>
        ))}
        <span className="w-8" />
      </div>

      {handlers.map((h, i) => (
        // Index as the key, deliberately: two blank rows are genuinely
        // indistinguishable, and keying on the typed name would remount
        // the field on every keystroke and lose focus.
        <div key={i} className={`grid grid-cols-1 items-center gap-2 ${COLUMNS}`}>
          <Select
            size="form" searchable allowCustom
            value={h.personName}
            onChange={(v) => set(i, 'personName', v ?? '')}
            options={(options?.people ?? []).map((p) => p.name)}
            placeholder="Pick or type a name"
          />
          <Select
            size="form" searchable allowCustom
            value={h.roleLabel}
            onChange={(v) => set(i, 'roleLabel', v ?? '')}
            options={options?.roles ?? []}
            placeholder="Director, Mid 1…"
          />
          {/* PER HANDLER, and single. A row belongs to exactly one group:
              the group filter matches it exactly, the export writes a tab
              per group, and whatbot scopes by it. A Director and a Mid on
              one company can legitimately sit in different groups. */}
          <Select
            size="form" searchable allowCustom
            value={h.groupName}
            onChange={(v) => set(i, 'groupName', v ?? '')}
            options={options?.groups ?? []}
            placeholder="Pick or type a group"
          />
          <Button
            size="icon"
            variant="danger"
            aria-label={`Remove ${h.personName || 'this handler'}`}
            disabled={handlers.length === 1}
            onClick={() => onChange(handlers.filter((_, n) => n !== i))}
          >
            <CloseIcon width={13} height={13} />
          </Button>
        </div>
      ))}

      <Button
        size="sm"
        onClick={() => onChange([
          ...handlers,
          // The group carried forward from the last row: handlers on one
          // company are usually in the same group, and retyping it on
          // every line is the work this saves. The role never is, because
          // two handlers in the same role is the case that does not happen.
          { personName: '', roleLabel: '', groupName: handlers[handlers.length - 1]?.groupName ?? '' },
        ])}
      >
        <PlusIcon width={14} height={14} />
        Add another handler
      </Button>
    </div>
  );
}
