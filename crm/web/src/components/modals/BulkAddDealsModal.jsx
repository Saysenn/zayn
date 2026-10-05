import { useMemo, useState } from 'react';
import Modal from './Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import MultiPicker from '../forms/MultiPicker';
import { PlusIcon } from '../icons';
import { usePeople, usePeopleFilters } from '../../hooks/usePeople';
import { useCompanyNames } from '../../hooks/useCompanies';
import useBulkActions, { DEAL_TOUCHES } from '../../hooks/useBulkActions';
import { apiService } from '../../configs/api.config';
import { countOf } from '../../helpers/pluralNoun';

// ***************************************************
// * Many deals in one go, from either side
// ***************************************************

/**
 * THE BULK BAR'S ADD: companies for the ticked people (People), or
 * handlers for the ticked companies (Companies). Same form both ways,
 * because it is the same act: a deal per pair.
 *
 * Pick SEVERAL in one dropdown, each with its own role, amount and group
 * set right there in the dropdown's side panel. Two people ticked and three
 * companies picked is six deals, listed underneath, where any one pair can
 * still be changed on its own.
 *
 * Through the company's own add-handlers route, the one Manage uses, so
 * someone already on a company is skipped and said, never doubled. Nothing
 * waits: Add closes the dialog and the toast reports.
 *
 *   subjects:  [{ id, name, group }]   the ticked rows
 *   direction: 'toCompany' (subjects are people) | 'toPerson' (subjects are companies)
 */
const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'crypto', label: 'Crypto' },
];

export default function BulkAddDealsModal({ direction, subjects, onClose, onDone }) {
  const toCompany = direction === 'toCompany';
  const { data: options } = usePeopleFilters();
  const { data: companyNames } = useCompanyNames();
  const { data: peopleRows } = usePeople({ page: 1, pageSize: 500 });
  const { run } = useBulkActions();

  const [picks, setPicks] = useState([]);
  const [shared, setShared] = useState({ currency: 'GBP', paymentMethod: 'cash' });
  // A single pair changed by hand, keyed "subject|pick".
  const [own, setOwn] = useState({});
  const [error, setError] = useState(null);

  const choices = useMemo(() => (toCompany
    ? (companyNames ?? []).map((c) => ({ value: c.ckey, label: c.name }))
    : (peopleRows ?? []).map((p) => ({ value: p.person_id, label: p.display_name }))), [toCompany, companyNames, peopleRows]);

  const defaultGroup = subjects.find((s) => s.group)?.group ?? '';
  const pairs = subjects.flatMap((s) => picks.map((p) => {
    const key = `${s.id}|${p.value}`;
    return {
      key,
      subject: s,
      pick: p,
      roleLabel: own[key]?.roleLabel ?? p.roleLabel ?? '',
      monthlyAmount: own[key]?.monthlyAmount ?? p.monthlyAmount ?? '',
      groupName: p.groupName || defaultGroup,
    };
  }));
  const setPair = (key, field, value) => setOwn((o) => ({ ...o, [key]: { ...o[key], [field]: value } }));

  const one = subjects.length === 1 ? subjects[0].name : null;
  const title = toCompany
    ? `Add companies for ${one ?? countOf(subjects.length, 'person')}`
    : `Add handlers to ${one ?? countOf(subjects.length, 'company')}`;

  function submit() {
    if (picks.length === 0) return setError(toCompany ? 'Pick at least one company.' : 'Pick at least one person.');
    const noGroup = pairs.find((p) => !p.groupName);
    if (noGroup) return setError(`${noGroup.pick.label} needs a group.`);
    setError(null);

    const handlerOf = (pair) => {
      const person = toCompany ? pair.subject : { id: pair.pick.value, name: pair.pick.label };
      return {
        personId: person.id,
        personName: person.name,
        groupName: pair.groupName,
        roleLabel: pair.roleLabel || 'Other',
        monthlyAmount: Number(pair.monthlyAmount) || 0,
        currency: shared.currency,
        paymentMethod: shared.paymentMethod,
      };
    };
    // The route is the COMPANY's, so the pairs go out grouped by company.
    const byCompany = new Map();
    for (const pair of pairs) {
      const companyKey = toCompany ? pair.pick.value : pair.subject.id;
      byCompany.set(companyKey, [...(byCompany.get(companyKey) ?? []), handlerOf(pair)]);
    }
    const call = () => Promise.all([...byCompany].map(([key, handlers]) => apiService.companies.addHandlers(key, handlers)))
      .then((rs) => ({
        added: rs.reduce((n, r) => n + (r?.deals?.length ?? 0), 0),
        skipped: rs.reduce((n, r) => n + (r?.skipped?.length ?? 0), 0),
      }));

    run({
      call,
      invalidates: DEAL_TOUCHES,
      toast: { message: `${countOf(pairs.length, 'deal')} added` },
      report: (r) => ({
        message: r.added > 0 ? `${countOf(r.added, 'deal')} added` : 'Nothing new added',
        detail: r.skipped ? `${r.skipped} already there, skipped` : undefined,
      }),
      failure: `Couldn't add ${countOf(pairs.length, 'deal')}`,
    });
    onDone?.();
    onClose();
    return null;
  }

  return (
    <Modal title={title} wide onClose={onClose}>
      <div className="space-y-4">
        <MultiPicker
          label={toCompany ? 'Companies' : 'People'}
          placeholder={toCompany ? 'Search and tick companies…' : 'Search and tick people…'}
          options={choices}
          picks={picks}
          onChange={setPicks}
          defaults={{ roleLabel: '', monthlyAmount: '', groupName: defaultGroup }}
          roleOptions={options?.roles ?? []}
          groupOptions={options?.groups ?? []}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            size="form" allowCustom
            label="Currency"
            value={shared.currency}
            onChange={(v) => setShared((f) => ({ ...f, currency: v ?? 'GBP' }))}
            options={options?.currencies?.length ? options.currencies : ['GBP', 'AED', 'EURO']}
            placeholder=""
          />
          <Select
            size="form"
            label="Paid how"
            value={shared.paymentMethod}
            onChange={(v) => setShared((f) => ({ ...f, paymentMethod: v ?? 'cash' }))}
            options={METHODS}
            placeholder=""
          />
        </div>

        {/* EVERY DEAL THIS WILL MAKE, each still changeable on its own. */}
        {pairs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem] gap-2 border-b border-border bg-surface-sunken px-3 py-1.5">
              <span className="form-caption">{countOf(pairs.length, 'deal')}</span>
              <span className="form-caption">Role</span>
              <span className="form-caption text-right">Monthly</span>
            </div>
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {pairs.map((pair) => (
                <div key={pair.key} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem] items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-medium text-text">{toCompany ? pair.subject.name : pair.pick.label}</span>
                    <span className="text-text-faint"> → </span>
                    <span className="text-text">{toCompany ? pair.pick.label : pair.subject.name}</span>
                    <span className="ml-1.5 text-xs text-text-faint">{pair.groupName}</span>
                  </span>
                  <Select
                    size="sm" searchable allowCustom
                    value={pair.roleLabel}
                    onChange={(v) => setPair(pair.key, 'roleLabel', v ?? '')}
                    options={options?.roles ?? []}
                    placeholder="Role"
                  />
                  <input
                    className="form-control h-8 text-right tabular-nums" type="number" min="0" step="0.01"
                    aria-label={`Monthly amount, ${pair.subject.name} and ${pair.pick.label}`}
                    value={pair.monthlyAmount}
                    onChange={(e) => setPair(pair.key, 'monthlyAmount', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">Anyone already on a company is skipped, never doubled.</p>
          <div className="flex justify-end gap-2">
            <Button size="md" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button size="md" variant="primary" onClick={submit}>
              <PlusIcon width={16} height={16} />
              {pairs.length ? `Add ${countOf(pairs.length, 'deal')}` : 'Add'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
