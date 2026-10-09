import { payableFromDays, PAYABLE_INPUTS } from '../../helpers/payable';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../../configs/api.config';
import { popup } from '../../configs/popups.config';
import { useNotifications } from '../../hooks/useNotifications';
import { useFormDraft } from '../../hooks/useFormDraft';
import DraftNote from '../display/DraftNote';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import FloatingField from '../forms/FloatingField';
import Toggle from '../forms/Toggle';
import { ChevronIcon, CheckCircleIcon } from '../icons';
import { INTERNAL, NEVER_BANK } from '../../configs/sheetValues';

/**
 * Adding a person, one step at a time.
 *
 * SIX STEPS, EVERY ONE SKIPPABLE — the user's explicit shape. Only step 1
 * has anything required, because a person with a name is already a useful
 * record and demanding their sort code before they can be saved would
 * mean the messy real cases never get entered at all.
 *
 * Every field maps to a column the boss's sheet already has, so a person
 * added here and a person imported from the xlsx are the same shape. The
 * grouping into steps is the only thing invented, and it follows how the
 * sheet reads left to right.
 *
 * EVERY FIELD OFFERS WHAT IT KNOWS. Roles, groups, companies and
 * currencies all come from the uploaded document, so the common case is
 * picking rather than typing — and typing still works where a genuinely
 * new value is legitimate (a new company, a role nobody has used yet).
 */

// Offering these as options rather than making someone retype "Handled
// internally" on every third row is most of what makes this form bearable.

const STEPS = [
  {
    title: 'Person',
    hint: popup.personWho(),
    fields: [
      { key: 'personName', label: 'Full name', required: true, placeholder: 'As it appears on the sheet' },
      { key: 'phone', label: 'Phone number', placeholder: '+447911123456', suggest: [INTERNAL] },
      // SINGLE. A person holds one role on a given company, and picking
      // three here quietly produced three rows of the same person, which
      // is not what "they do a few things" means. Somebody genuinely
      // holding two roles gets a second deal, added deliberately.
      { key: 'roleLabel', label: 'Role', from: 'roles', searchable: true, custom: true,
        placeholder: 'Director, Mid 1, KP 1…' },
    ],
  },
  {
    title: 'Company',
    hint: popup.personDeal(),
    fields: [
      // MULTIPLE, and they land in ONE cell: "SG, CKA, CKU, Umbrella co",
      // which is how the sheet writes it and what Add deal settled on. A
      // toggle offering the other reading meant the same two picks made a
      // different number of rows depending on which dialog you opened.
      { key: 'company', label: 'Companies', from: 'companies', searchable: true, custom: true,
        multiple: true, placeholder: 'Pick one or more, or type a new one',
        hint: popup.dealCompaniesJoined() },
      { key: 'groupName', label: 'Group', from: 'groups', searchable: true, custom: true },
      { key: 'assignedOn', label: 'Appointment date', type: 'date' },
    ],
  },
  {
    title: 'Money',
    hint: popup.personMoney(),
    fields: [
      { key: 'monthlyAmount', label: 'Monthly amount', type: 'number' },
      // The other half of the arithmetic. Without it the payable amount
      // could only ever be the full monthly one, so the step's own promise
      // that the figure is "worked out from these" was only true for rows
      // with no preset month.
      { key: 'payableDays', label: 'Payable days this month', type: 'number' },
      { key: 'currency', label: 'Currency', from: 'currencies', fallback: ['GBP', 'AED', 'EURO'], custom: true },
      { key: 'paymentMethod', label: 'Payment method',
        options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank transfer' }, { value: 'crypto', label: 'Crypto' }] },
      { key: 'paymentStartOn', label: 'Payment start date', type: 'date' },
      { key: 'presetOn', label: 'Preset date', type: 'date', hint: popup.personPreset() },
      { key: 'endOn', label: 'Provisional end date', type: 'date' },
    ],
  },
  {
    title: 'Address',
    hint: popup.personPost(),
    // Every one of these takes a typed value as well as a picked one. The
    // sheet writes real postcodes AND "Handled internally" in the same
    // column, and door numbers that are sentences, so a closed list here
    // would block the exact rows that need entering by hand.
    fields: [
      { key: 'location', label: 'Location', from: 'locations', searchable: true, custom: true },
      { key: 'doorNumber', label: 'Door number', suggest: [INTERNAL, 'In person meet'],
        custom: true, searchable: true, placeholder: 'Type a door number, or pick one' },
      { key: 'postcode', label: 'Postcode', suggest: [INTERNAL],
        custom: true, searchable: true, placeholder: 'Type a postcode, or pick one' },
      { key: 'acceptingPostals', label: 'Accepting postals', custom: true,
        options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }, { value: INTERNAL, label: INTERNAL }] },
    ],
  },
  {
    title: 'Banking',
    hint: popup.personBank(),
    banking: true,
  },
  {
    title: 'Admin',
    hint: popup.personDecision(),
    fields: [
      { key: 'label', label: 'Label' },
      // SWITCHES, and they write the `override_*` booleans rather than the
      // sheet's own free-text should_be_paid / paid columns.
      //
      // That is what a switch already means everywhere else in the CRM:
      // the same two columns the People pages toggle (per person since
      // 2026-10-08). The free-text pair holds whatever the boss typed into the
      // xlsx ("yes", "n/a", a sentence), and a row added here has no sheet
      // behind it, so there are no words of the boss's to record. Wiring
      // these switches to the text columns instead would give the same
      // control two different meanings depending on where you found it.
      // ONE ENTRY, TWO SWITCHES, side by side. They are two halves of the
      // same question ("is this person owed, and did it arrive"), and the
      // two-column grid was splitting them across separate rows with an
      // unrelated field between — you had to hunt for the second one.
      //
      // "Paid" means the money arrived, not that it was sent, matching the
      // rule the payday answer follows in agent.js.
      { toggles: [
        { key: 'overrideShouldBePaid', label: 'Should be paid', fallback: true },
        { key: 'overridePaid', label: 'Paid', fallback: false },
      ] },
      { key: 'notes', label: 'Notes', textarea: true },
    ],
  },
];

export default function AddPersonWizard({ onClose, filterOptions }) {
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const [step, setStep] = useState(0);
  /**
   * ONE DRAFT, kept as it is typed.
   *
   * This is the longest form in the CRM: six steps, and losing it to a
   * click on the backdrop meant typing all of it again. `neverBank` is in
   * here too, because a switch flipped on step five is as much of the
   * answer as anything typed on step one.
   *
   * `step` deliberately is NOT: coming back to the field you were in is
   * useful, but coming back to a review screen for a form you have not
   * looked at since is not. It reopens at the start with the answers
   * intact. See hooks/useFormDraft.js.
   */
  // roleLabel is an array: several roles means several rows. The two
  // override switches start at the same defaults an untouched row resolves
  // to on every other page, so the form opens showing the truth rather
  // than a third "unset" state nobody can act on.
  const [draft, setDraft, drafting] = useFormDraft('add-person', {
    currency: 'GBP',
    paymentMethod: 'cash',
    roleLabel: '',
    // null, not a boolean: an untouched new row is UNDECIDED, the same as
    // one that came off a sheet. The switch shows the fallback; the column
    // only records a decision once somebody moves it.
    overrideShouldBePaid: null,
    overridePaid: null,
    neverBank: false,
  });
  const form = draft;
  const setForm = setDraft;
  const { neverBank } = draft;
  const setNeverBank = (v) => setDraft((d) => ({ ...d, neverBank: typeof v === 'function' ? v(d.neverBank) : v }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  /**
   * PAYABLE AMOUNT FOLLOWS ITS INPUTS.
   *
   * The Money step's own hint already promises "the payable amount is
   * worked out from these, never typed" — and then nothing worked it out
   * until the row was saved. The server recomputes on save either way and
   * stays the authority; this is so the figure is visible while the form
   * is still open, using the same helper the inline cells and Add deal use
   * so the three cannot disagree.
   */
  function set(key, value) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (!PAYABLE_INPUTS.includes(key)) return next;
      const amount = payableFromDays(next);
      return amount === null ? next : { ...next, payableAmount: String(amount) };
    });
  }

  /**
   * One switch that fills all three banking columns at once.
   *
   * "Will never be bank" appears in 40-odd rows of the real sheet, across
   * bank details, account number and sort code together — it is one fact
   * about a person, not three separate strings to retype. Off, the fields
   * come back empty and editable.
   */
  function toggleNeverBank(on) {
    setNeverBank(on);
    setForm((f) => ({
      ...f,
      bankDetails: on ? NEVER_BANK : '',
      accountNumber: on ? NEVER_BANK : '',
      sortCode: on ? NEVER_BANK : '',
    }));
  }

  // One row per role. A row carries exactly one role_label, so two roles
  // is two rows, and they are created sequentially rather than in parallel
  // because each one logs a change and broadcasts.
  const asList = (v) => (Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean));
  const roles = asList(form.roleLabel);
  const companies = asList(form.company);

  /**
   * SEVERAL COMPANIES IS ONE CELL, and there is no switch offering the
   * other reading.
   *
   * "SG, CKA, CKU, Umbrella co" is how the sheet writes it, and it is the
   * rule Add deal settled on. A toggle here meant the same two picks
   * produced a different number of rows depending on which dialog you
   * happened to open, which is the drift the shared components exist to
   * prevent. Somebody who wants a row per company adds them one at a time,
   * or uses Assign on the person's page.
   *
   * A blank company is legitimate: those rows pay against the group.
   */
  const combos = (roles.length ? roles : ['Other'])
    .map((roleLabel) => ({ roleLabel, company: companies.join(', ') }));
  const rowCount = combos.length;

  async function save() {
    if (!form.personName?.trim()) {
      setStep(0);
      return setError('A name is required.');
    }
    setSaving(true);
    setError(null);
    try {
      let first = null;
      // Sequential: each create logs a change and broadcasts.
      for (const combo of combos) {
        const { row } = await apiService.masterSheet.create({
          ...form,
          ...combo,
          personName: form.personName.trim(),
          groupName: form.groupName || 'UNKNOWN',
          monthlyAmount: Number(form.monthlyAmount) || 0,
        });
        first ??= row;
      }
      // Named and counted. Landing on the person's page proves ONE row
      // was written; this wizard writes one per group/company combination,
      // and "3 rows" is the number worth seeing when you picked two
      // companies across two groups and expected four.
      notify({
        level: 'success',
        message: `${form.personName.trim()} added`,
        detail: combos.length > 1
          ? `${combos.length} rows, one per company and group.`
          : undefined,
      });
      drafting.clear();
      onClose();
      if (first?.person_id) navigate(`/people/${encodeURIComponent(first.person_id)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function optionsFor(f) {
    if (f.options) return f.options;
    if (f.from) {
      const list = filterOptions?.[f.from];
      return list?.length ? list : (f.fallback ?? []);
    }
    return f.suggest ?? [];
  }

  return (
    <Modal wide title="Add a person" onClose={onClose}>
      <div className="space-y-5">
        {drafting.restored && <DraftNote onDiscard={drafting.discard} />}
        {/* Every step is reachable directly. Skipping forward is the point,
            so making someone click Next five times to reach Banking would
            defeat it. */}
        <ol className="flex flex-wrap gap-1">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={`min-h-0 gap-1.5 px-2.5 py-1 text-xs ${
                  i === step
                    ? 'border-accent bg-accent-tint font-semibold text-text'
                    : 'border-transparent text-text-muted hover:bg-surface-sunken'
                }`}
              >
                <span className="tabular-nums">{i + 1}</span>
                {s.title}
                {i < step && <CheckCircleIcon width={12} height={12} className="text-accent" />}
              </button>
            </li>
          ))}
        </ol>

        <div>
          <h3 className="text-sm font-semibold">{current.title}</h3>
          <p className="text-xs text-text-muted">{current.hint}</p>
        </div>

        {current.banking ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 border border-border bg-surface-sunken px-3 py-2.5">
              <Toggle checked={neverBank} onChange={toggleNeverBank} label="Will never be bank" />
              <div>
                <p className="text-sm font-semibold">Will never be bank</p>
                <p className="text-xs text-text-muted">
                  Paid outside the banking system. Fills all three fields at once.
                </p>
              </div>
            </div>

            <div className="grid gap-x-3 gap-y-5 sm:grid-cols-3">
              <FloatingField label="Bank" filled={Boolean(form.bankDetails)}>
                <input className="form-control" disabled={neverBank} placeholder="Bank"
                  value={form.bankDetails ?? ''} onChange={(e) => set('bankDetails', e.target.value)} />
              </FloatingField>
              {/* Text, not a number: the sheet writes words here as often
                  as digits, which is why it is not type="number". */}
              <FloatingField label="Account number" filled={Boolean(form.accountNumber)}>
                <input className="form-control" disabled={neverBank} placeholder="Account number"
                  value={form.accountNumber ?? ''} onChange={(e) => set('accountNumber', e.target.value)} />
              </FloatingField>
              <FloatingField label="Sort code" filled={Boolean(form.sortCode)}>
                <input className="form-control" disabled={neverBank} placeholder="Sort code"
                  value={form.sortCode ?? ''} onChange={(e) => set('sortCode', e.target.value)} />
              </FloatingField>
            </div>
          </div>
        ) : (
          <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
            {current.fields.map((f) =>
              // A switch pair is its own row, spanning both columns, so the
              // two stay beside each other however the grid wraps.
              f.toggles ? (
                <div key={f.toggles[0].key} className="flex flex-wrap gap-x-8 gap-y-3 sm:col-span-2">
                  {f.toggles.map((t) => {
                    const decided = form[t.key] === true || form[t.key] === false;
                    return (
                      <label key={t.key} className="flex items-center gap-2.5">
                        <span
                          className={decided ? '' : 'opacity-60'}
                          title={decided ? undefined : 'No decision recorded yet, showing the default'}
                        >
                          <Toggle
                            checked={decided ? form[t.key] : t.fallback}
                            onChange={(v) => set(t.key, v)}
                            label={t.label}
                          />
                        </span>
                        <span className="field-label">{t.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
              /* FLOATING LABEL. The label sits where the placeholder
                 would be and lifts onto the border once the field is
                 focused or filled, so a filled control still says what it
                 is without a caption doubling the grid's height. */
              f.options || f.from || f.suggest ? (
                /* Select carries its own FloatingField. */
                <div key={f.key}>
                  <Select
                    size="form"
                    label={f.label}
                    required={f.required}
                    hint={f.hint}
                    multiple={f.multiple}
                    value={f.multiple ? (form[f.key] ?? []) : (form[f.key] ?? '')}
                    onChange={(v) => set(f.key, v)}
                    options={optionsFor(f)}
                    searchable={f.searchable}
                    allowCustom={f.custom ?? Boolean(f.suggest)}
                    placeholder=""
                  />
                </div>
              ) : (
                <FloatingField
                  key={f.key}
                  label={f.label}
                  required={f.required}
                  /* A date input paints its own dd/mm/yyyy, which would sit
                     underneath a resting label, so those float from the
                     start. */
                  filled={Boolean(form[f.key]) || f.type === 'date'}
                  className={f.textarea ? 'sm:col-span-2' : ''}
                >
                  {f.textarea ? (
                    <textarea className="form-textarea" rows={3} placeholder={f.label}
                      value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                  ) : (
                    <input
                      className="form-control"
                      type={f.type ?? 'text'}
                      placeholder={f.label}
                      value={form[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                </FloatingField>
              )))}
          </div>
        )}

        {/* THE FIGURE THE STEP PROMISES, actually shown.
            "The payable amount is worked out from these, never typed" was
            true of the save and invisible in the form, so the one number
            somebody wants to check before pressing Add was the one number
            they could not see. Read-only on purpose: typing it is what the
            hint says nobody does, and the server recomputes it on save
            from the same formula. */}
        {current.title === 'Money' && form.payableAmount && (
          <p className="flex flex-wrap items-baseline gap-2 border border-border bg-surface-sunken px-3 py-2 text-sm">
            <span className="text-text-muted">Payable amount this month</span>
            <span className="font-semibold tabular-nums">
              {form.currency} {form.payableAmount}
            </span>
            <span className="text-xs text-text-faint">
              {form.presetOn
                ? 'monthly ÷ days in the preset month × payable days'
                : 'no preset month, so the full monthly amount'}
            </span>
          </p>
        )}

        {/* Say the consequence before the button is pressed, the same way
            Add deal does for companies × groups. Picking three roles
            quietly creating three rows is the kind of surprise you only
            find out about on the People page afterwards. */}
        {rowCount > 1 && (
          <p className="bg-accent-tint px-3 py-2 text-sm">
            {rowCount} rows will be created
            ({combos.map((c) => [c.roleLabel, c.company].filter(Boolean).join(' · ')).join(', ')}),
            all with the figures entered here.
          </p>
        )}

        {error && (
          <p className="bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronIcon width={14} height={14} className="rotate-180" />
            Back
          </Button>

          <div className="flex gap-2">
            {/* Save is available on every step, not just the last — the
                whole point of skippable steps is that a half-filled record
                is a legitimate thing to keep. */}
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save now'}
            </Button>
            {!isLast ? (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                Next
                <ChevronIcon width={14} height={14} />
              </Button>
            ) : (
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save person'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
