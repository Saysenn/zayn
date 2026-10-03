import { useState } from 'react';
import { useFormDraft } from '../../hooks/useFormDraft';
import DraftNote from '../display/DraftNote';
import { useAddDeal, usePeopleFilters } from '../../hooks/usePeople';
import { useNotifications } from '../../hooks/useNotifications';
import Modal from './Modal';
import { popup } from '../../configs/popups.config';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import MultiRowToggle from '../forms/MultiRowToggle';
import FloatingField from '../forms/FloatingField';

/**
 * Assign a person to one or more companies.
 *
 * MULTIPLE ON PURPOSE. Nathan holds seven deals across seven companies in
 * the real sheet, and Drew five. Opening this dialog once per company was
 * five round trips to record one fact about one person.
 *
 * Each company still becomes its own DEAL — the same row the Companies
 * page creates from the other side, and the same row the Master Sheet
 * page shows. One table, three ways in.
 *
 * The amount is per person, not per company: 20 of the 28 multi-handler
 * companies in the real sheet pay their handlers different negotiated
 * amounts, so there is no company rate to inherit. When several companies
 * are picked at once they share the figures entered here, which is the
 * common case; anything that differs is corrected on the row afterwards.
 */
export default function AddDealModal({ personId, personName, onClose }) {
  const { data: options } = usePeopleFilters();
  const addDeal = useAddDeal();
  const { notify } = useNotifications();
  /**
   * ONE PIECE OF STATE, because it is one draft.
   *
   * Kept in localStorage as it is typed, so a click on the backdrop or an
   * accidental refresh does not throw away a filled-in form. Keyed by the
   * person, so a half-finished deal for Nathan does not reappear inside
   * Drew's dialog. See hooks/useFormDraft.js.
   */
  const [draft, setDraft, drafting] = useFormDraft(`add-deal:${personId}`, {
    companies: [],
    groups: [],
    // Several companies, and several groups: a row each, or one row
    // listing them all? See components/forms/MultiRowToggle.jsx.
    multiRow: true,
    multiRowGroups: true,
    roleLabel: '',
    monthlyAmount: '',
    currency: 'GBP',
    paymentMethod: 'cash',
  });
  const { companies, groups, multiRow, multiRowGroups } = draft;
  const form = draft;
  const setCompanies = (v) => setDraft((d) => ({ ...d, companies: v }));
  const setGroups = (v) => setDraft((d) => ({ ...d, groups: v }));
  const setMultiRow = (v) => setDraft((d) => ({ ...d, multiRow: v }));
  const setMultiRowGroups = (v) => setDraft((d) => ({ ...d, multiRowGroups: v }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Rows that already exist for a pairing we were about to create. Held
  // rather than thrown away so the person can see WHAT clashed and decide,
  // instead of being told "already exists" and left to go looking.
  const [clash, setClash] = useState(null);

  // OFF collapses the picks into ONE company cell, so several companies
  // stay a single deal whose amount is the total for the arrangement.
  const companyChoices = multiRow ? companies : (companies.length ? [companies.join(', ')] : []);
  // Groups collapse the same way companies do. OFF means one row whose
  // group cell lists them, which is why that switch is marked risky.
  const groupChoices = multiRowGroups ? groups : (groups.length ? [groups.join(', ')] : []);
  const total = companyChoices.length * groupChoices.length;

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit(e, { allowDuplicate = false } = {}) {
    e?.preventDefault?.();
    if (companies.length === 0) return setError('Pick at least one company.');
    if (groups.length === 0) return setError('Pick at least one group.');

    setBusy(true);
    setError(null);
    setClash(null);
    try {
      // Sequential rather than Promise.all: each write logs a change and
      // broadcasts, and firing eight at once against one Supabase pool
      // buys nothing at this size.
      // Every company in every group. One person genuinely handles the
      // same company under two different groups in the real sheet, so
      // this is a cross product rather than a pairing — and the button
      // says how many rows that comes to before you commit to it.
      for (const company of companyChoices) {
        for (const groupName of groupChoices) {
        await addDeal.mutateAsync({
          personId,
          deal: {
            personName,
            company,
            groupName,
            roleLabel: form.roleLabel || 'Other',
            monthlyAmount: Number(form.monthlyAmount) || 0,
            currency: form.currency,
            paymentMethod: form.paymentMethod,
            allowDuplicate,
          },
        });
        }
      }
      // COUNTED, because this modal is a cross product: two companies
      // across two groups is four rows, and the only way to check that is
      // to be told the number.
      const written = companyChoices.length * groupChoices.length;
      notify({
        level: 'success',
        message: `${personName} added to ${written === 1 ? companyChoices[0] : `${written} companies`}`,
        detail: written > 1 ? `${companyChoices.length} × ${groupChoices.length} groups.` : undefined,
      });
      drafting.clear();
      onClose();
    } catch (err) {
      // 409 means it is already there. The rows come back with it, so this
      // becomes a choice rather than a refusal — one person genuinely
      // holds the same role on one company twice (different payable days),
      // so blocking outright would break a real case.
      if (err.status === 409 && err.matches?.length) setClash(err.matches);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Assign ${personName} to a company`} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        {drafting.restored && <DraftNote onDiscard={drafting.discard} />}
        <Select
          size="form"
          multiple
          searchable
          allowCustom
          label="Companies"
          required
          hint={popup.dealCompaniesRows()}
          value={companies}
          onChange={setCompanies}
          options={options?.companies ?? []}
          placeholder=""
          emptyLabel="No companies yet"
        />

        <MultiRowToggle checked={multiRow} onChange={setMultiRow} count={companies.length} />

        <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
          <Select
            size="form"
            multiple
            allowCustom
            searchable
            label="Groups"
            required
            value={groups}
            onChange={setGroups}
            options={options?.groups ?? []}
            placeholder=""
          />
        </div>

        {/* THE SAME QUESTION FOR GROUPS, and a costlier answer.
            `risky`, because a group is not a label: it is matched EXACTLY
            by every group filter, it decides which tab a row lands on in
            the export, and it is how whatbot scopes a conversation. A cell
            reading "INDIGO, MILKMAN" is a group that exists nowhere. */}
        <MultiRowToggle
          checked={multiRowGroups}
          onChange={setMultiRowGroups}
          count={groups.length}
          noun="group"
          risky
          warning={(
            <>
              This writes one row whose group cell reads
              {' '}&ldquo;{groups.join(', ') || 'A, B'}&rdquo;, which is a group that exists
              nowhere. Group filters match exactly, so the row appears under none of them; the
              export writes a tab per group, so it lands on none of those either; and whatbot
              scopes every conversation by group, so it cannot see the row at all. Use it only
              when the sheet is meant to read that way.
            </>
          )}
        />

        <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">

          <Select
            size="form"
            searchable
            allowCustom
            label="Role"
            value={form.roleLabel}
            onChange={(v) => set('roleLabel', v)}
            options={options?.roles ?? []}
            placeholder=""
          />
        </div>

        {total > 1 && (
          <p className="bg-accent-tint px-3 py-2 text-sm">
            {total} rows will be created ({companies.length}{' '}
            {companies.length === 1 ? 'company' : 'companies'} × {groups.length}{' '}
            {groups.length === 1 ? 'group' : 'groups'}), all with the figures below. Adjust any
            that differ from {personName}&rsquo;s page afterwards.
          </p>
        )}

        <div className="grid gap-x-3 gap-y-5 sm:grid-cols-3">
          <FloatingField label="Monthly amount" filled={form.monthlyAmount !== ''}>
            <input
              className="form-control"
              type="number"
              min="0"
              step="0.01"
              value={form.monthlyAmount}
              onChange={(e) => set('monthlyAmount', e.target.value)}
              placeholder="Monthly amount"
            />
          </FloatingField>
          <Select
            size="form"
            allowCustom
            searchable
            label="Currency"
            value={form.currency}
            onChange={(v) => set('currency', v)}
            options={options?.currencies?.length ? options.currencies : ['GBP', 'AED', 'EURO']}
            placeholder=""
          />
          <Select
            size="form"
            label="Paid how"
            value={form.paymentMethod}
            onChange={(v) => set('paymentMethod', v)}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'bank', label: 'Bank transfer' },
              { value: 'crypto', label: 'Crypto' },
            ]}
            placeholder=""
          />
        </div>

        {error && (
          <p className="bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {clash && (
          <div className="bg-warning-tint px-3 py-2 text-sm">
            <p className="font-semibold">This already exists.</p>
            <ul className="mt-1 space-y-0.5 text-text-muted">
              {clash.map((m) => (
                <li key={m.id}>
                  {m.person_name} on {m.company} as {m.role_label} in {m.group_name}
                  {Number(m.monthly_amount) > 0 && ` · ${m.monthly_amount} ${m.currency} a month`}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => setClash(null)}>Cancel</Button>
              {/* Not a hard block: the same person on the same company in
                  the same role twice is real when the payable days differ.
                  Both rows survive, each with its own key. */}
              <Button variant="danger" onClick={(ev) => submit(ev, { allowDuplicate: true })} disabled={busy}>
                Add a second one anyway
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Assigning…' : total > 1 ? `Assign to ${total}` : 'Assign'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
