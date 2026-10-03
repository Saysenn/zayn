import { useState } from 'react';
import { useMasterSheetCellEdit, useDeleteMasterSheetRow } from '../../hooks/useMasterSheet';
import Button from '../buttons/Button';
import Select from './Select';
import FloatingField from './FloatingField';
import { PlusIcon, TrashIcon } from '../icons';

/**
 * Who works on what, edited in one place.
 *
 * ONE COMPONENT, BOTH DIRECTIONS. A person's companies and a company's
 * handlers are the same rows read from opposite ends, so this takes a
 * `mode` and swaps which side is the counterpart. Two components would
 * have been the same form twice, drifting apart the first time either
 * side gained a field.
 *
 *   mode="person"    the subject is a person, the counterpart is a company
 *   mode="company"   the subject is a company, the counterpart is a person
 *
 * ROLE AND GROUP ARE NOT SEPARATE LISTS. They live on the deal, so
 * "add a role" and "add a group" are not things you do to a person — they
 * are what a deal says. Showing them as their own add/remove lists
 * would invent a relationship the table does not have and let the two
 * lists disagree with the rows underneath. Here they are columns on the
 * row that carries them, editable in place.
 *
 * ONE CAPTION ROW, NOT A LABEL PER CONTROL. Every row is the same three
 * columns, so labelling each one stacked a caption above every dropdown
 * and made the block twice as tall as the information in it. The captions
 * sit once, at the top, and the columns line up under them.
 *
 * EXISTING ROWS SAVE ON CHANGE, new rows save on Add. An existing
 * deal is already real, so a Save button beside it would only add a
 * step and a way to lose the edit; a new one isn't real until it has a
 * counterpart, so it needs the explicit act.
 */

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'crypto', label: 'Crypto' },
];

const BLANK = {
  counterpart: '', groupName: '', roleLabel: '',
  monthlyAmount: '', currency: 'GBP', paymentMethod: 'cash',
};

// One grid definition, used by the caption row and every row under it, so
// the columns cannot drift apart.
const COLS = 'grid gap-2 sm:grid-cols-[1.6fr_1fr_1fr_2.25rem] items-center';

export default function DealsEditor({
  mode,
  subjectName,
  deals = [],
  options,
  people = [],
  onAdd,
  adding = false,
  defaultGroup = '',
}) {
  const isPerson = mode === 'person';
  const cellEdit = useMasterSheetCellEdit();
  const removeDeal = useDeleteMasterSheetRow();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);

  // The one thing that differs between the two directions.
  const counterpart = {
    caption: isPerson ? 'Company' : 'Name',
    field: isPerson ? 'company' : 'personName',
    value: (d) => (isPerson ? d.company : d.person_name),
    options: isPerson ? (options?.companies ?? []) : people,
    placeholder: isPerson ? 'Search or type a company' : 'Search or type a name',
  };

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  function submitDraft() {
    if (!draft?.counterpart?.trim()) {
      return setError(`A ${counterpart.caption.toLowerCase()} is required.`);
    }
    if (!draft.groupName) return setError('A group is required.');
    setError(null);
    onAdd(
      {
        [counterpart.field]: draft.counterpart.trim(),
        groupName: draft.groupName,
        roleLabel: draft.roleLabel || 'Other',
        monthlyAmount: Number(draft.monthlyAmount) || 0,
        currency: draft.currency,
        paymentMethod: draft.paymentMethod,
      },
      {
        onDone: () => { setDraft(null); setError(null); },
        onFail: (message) => setError(message),
      },
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {isPerson ? 'Companies' : 'Handlers'}
          <span className="ml-1.5 font-normal text-text-faint">{deals.length}</span>
        </h3>
        {!draft && (
          <Button onClick={() => { setDraft({ ...BLANK, groupName: defaultGroup }); setError(null); }}>
            <PlusIcon width={14} height={14} />
            Add {isPerson ? 'company' : 'handler'}
          </Button>
        )}
      </div>

      {deals.length === 0 && !draft && (
        <p className="border border-dashed border-border px-3 py-5 text-center text-sm text-text-muted">
          {isPerson
            ? `${subjectName} is not on any company yet.`
            : `Nobody is paid through ${subjectName} yet.`}
        </p>
      )}

      {deals.length > 0 && (
        <div className="border border-border">
          <div className={`${COLS} border-b border-border bg-surface-sunken px-2.5 py-1.5`}>
            <span className="form-caption">{counterpart.caption}</span>
            <span className="form-caption">Group</span>
            <span className="form-caption">Role</span>
            <span />
          </div>

          <div className="divide-y divide-border">
            {deals.map((d) => (
              <div key={d.id} className={`${COLS} px-2.5 py-2`}>
                {/* Read-only on purpose. Changing it would silently turn
                    this deal into a different one, which is two acts
                    (remove, add) wearing one control. */}
                <span className="truncate text-sm font-medium">
                  {counterpart.value(d) ?? <span className="text-text-faint">(none)</span>}
                </span>

                <Select
                  size="form" searchable allowCustom
                  value={d.group_name ?? ''}
                  options={options?.groups ?? []}
                  placeholder="Group"
                  onChange={(v) =>
                    cellEdit({ id: d.id, fields: { groupName: v }, subject: subjectName, label: 'group' })}
                />

                <Select
                  size="form" searchable allowCustom
                  value={d.role_label ?? ''}
                  options={options?.roles ?? []}
                  placeholder="Role"
                  onChange={(v) =>
                    cellEdit({ id: d.id, fields: { roleLabel: v }, subject: subjectName, label: 'role' })}
                />

                {/* Confirms in place rather than in a second modal stacked
                    on this one, which is where people lose track of what
                    they were removing. */}
                {confirming === d.id ? (
                  <div className="col-span-full flex items-center justify-end gap-2 pt-1">
                    <span className="text-xs text-text-muted">
                      Remove {counterpart.value(d) ?? 'this row'}? The other side keeps its rows.
                    </span>
                    <Button onClick={() => setConfirming(null)}>Cancel</Button>
                    <Button
                      variant="danger"
                      disabled={removeDeal.isPending}
                      onClick={() =>
                        removeDeal.mutate(
                          {
                            id: d.id,
                            subject: `${counterpart.value(d) ?? 'That row'} from ${subjectName}`,
                          },
                          { onSuccess: () => setConfirming(null) },
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    variant="danger"
                    aria-label={`Remove ${counterpart.value(d) ?? 'this row'} from ${subjectName}`}
                    onClick={() => setConfirming(d.id)}
                  >
                    <TrashIcon width={14} height={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {draft && (
        <div className="border border-accent bg-accent-tint/40 p-2.5">
          <div className="grid gap-x-3 gap-y-5 sm:grid-cols-3">
            <Select
              size="form" searchable allowCustom autoOpen
              label={counterpart.caption}
              required
              value={draft.counterpart}
              onChange={(v) => set('counterpart', v)}
              options={counterpart.options}
              placeholder=""
            />
            <Select
              size="form" searchable allowCustom
              label="Group"
              required
              value={draft.groupName}
              onChange={(v) => set('groupName', v)}
              options={options?.groups ?? []}
              placeholder=""
            />
            <Select
              size="form" searchable allowCustom
              label="Role"
              value={draft.roleLabel}
              onChange={(v) => set('roleLabel', v)}
              options={options?.roles ?? []}
              placeholder=""
            />
            {/* Every company pays its handlers differently in the real
                sheet, so there is no rate to inherit and the amount is
                entered per row. */}
            <FloatingField label="Monthly amount" filled={draft.monthlyAmount !== ''}>
              <input
                className="form-control" type="number" min="0" step="0.01"
                placeholder="Monthly amount"
                value={draft.monthlyAmount}
                onChange={(e) => set('monthlyAmount', e.target.value)}
              />
            </FloatingField>
            <Select
              size="form" allowCustom
              label="Currency"
              value={draft.currency}
              onChange={(v) => set('currency', v)}
              options={options?.currencies?.length ? options.currencies : ['GBP', 'AED', 'EURO']}
              placeholder=""
            />
            <Select
              size="form"
              label="Paid how"
              value={draft.paymentMethod}
              onChange={(v) => set('paymentMethod', v)}
              options={METHODS}
              placeholder=""
            />
          </div>

          <div className="mt-2.5 flex justify-end gap-2">
            <Button onClick={() => { setDraft(null); setError(null); }}>Cancel</Button>
            <Button variant="primary" onClick={submitDraft} disabled={adding}>
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="bg-danger-tint px-2.5 py-2 text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
