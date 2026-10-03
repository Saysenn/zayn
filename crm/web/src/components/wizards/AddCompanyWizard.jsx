import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../../configs/api.config';
import { usePeopleFilters } from '../../hooks/usePeople';
import { useNotifications } from '../../hooks/useNotifications';
import { useFormDraft } from '../../hooks/useFormDraft';
import DraftNote from '../display/DraftNote';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import { COMPANY_STATUS_OPTIONS } from '../../configs/companyStatus';
import FloatingField from '../forms/FloatingField';
import HandlerRows from '../forms/HandlerRows';
import DealPreview from '../display/DealPreview';
import { ChevronIcon, CheckCircleIcon } from '../icons';

/**
 * Adding a company, step by step, the same shape as adding a person.
 *
 * Two steps, and only the first is required. A company with a name is
 * already a useful record; its handlers can be attached now or later.
 *
 * A COMPANY IS NOT A TABLE ROW OF ITS OWN. It exists because rows name
 * it, so creating one with no handlers would create something invisible
 * everywhere. Step 2 exists for that reason: at least one handler is what
 * makes the company appear on the master sheet, on People and on
 * Companies, all three at once.
 */
export default function AddCompanyWizard({ onClose }) {
  const navigate = useNavigate();
  const { data: options } = usePeopleFilters();
  const { notify } = useNotifications();
  const [step, setStep] = useState(0);
  // ONE DRAFT: the company, its handlers and their terms are one answer,
  // kept as it is typed so a click on the backdrop does not lose it.
  // See hooks/useFormDraft.js.
  const [draft, setDraft, drafting] = useFormDraft('add-company', {
    company: { name: '', status: 'active', notes: '' },
    // A HANDLER IS A NAME, A ROLE AND A GROUP. It used to be a list of
    // names plus one shared role and group, so a Director and a Mid could
    // not be added together at all: both came out in whichever single role
    // was picked, which is the commonest arrangement a company has.
    handlers: [{ personName: '', roleLabel: '', groupName: '' }],
  });
  const { company, handlers } = draft;
  const setCompany = (v) => setDraft((d) => ({ ...d, company: typeof v === 'function' ? v(d.company) : v }));
  const setHandlers = (v) => setDraft((d) => ({ ...d, handlers: typeof v === 'function' ? v(d.handlers) : v }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // A blank trailing row is normal, so the empty ones are dropped rather
  // than written as a handler with no name.
  const filled = handlers.filter((h) => String(h.personName ?? '').trim());

  async function save() {
    const name = company.name.trim();
    if (!name) { setStep(0); return setError('A company name is required.'); }
    if (filled.length === 0) { setStep(1); return setError('Add at least one handler, or the company will not appear anywhere.'); }
    // Every handler, not one shared answer. The route refuses a blank
    // group and defaulting it to UNKNOWN would create rows needing cleanup.
    const ungrouped = filled.find((h) => !String(h.groupName ?? '').trim());
    if (ungrouped) { setStep(1); return setError(`${ungrouped.personName} needs a group.`); }

    setSaving(true);
    setError(null);
    try {
      // The company row itself first, so its status and notes exist before
      // anything points at it. Keyed on the normalized name, so this is an
      // upsert: naming a company that already exists reuses it rather than
      // failing.
      await apiService.companies.update(name, { status: company.status, notes: company.notes });

      const { skipped } = await apiService.companies.addHandlers(
        name,
        filled.map((h) => ({
          personName: h.personName,
          roleLabel: h.roleLabel || 'Other',
          groupName: h.groupName,
          // The money is not asked here: it is set per row afterwards or
          // through Add deal, which is the form built for it. The route
          // applies these same defaults either way.
          monthlyAmount: 0,
          currency: 'GBP',
          paymentMethod: 'cash',
        })),
      );

      notify({
        level: 'success',
        message: skipped?.length
          ? `${name} created. ${skipped.length} handler${skipped.length === 1 ? '' : 's'} were already on it.`
          : `${name} created with ${filled.length} handler${filled.length === 1 ? '' : 's'}.`,
      });
      drafting.clear();
      onClose();
      navigate(`/companies/${encodeURIComponent(name.toLowerCase())}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const STEPS = ['Company', 'Handlers'];

  return (
    <Modal wide title="Add a company" onClose={onClose}>
      <div className="space-y-5">
        {drafting.restored && <DraftNote onDiscard={drafting.discard} />}
        <ol className="flex flex-wrap gap-1">
          {STEPS.map((label, i) => (
            <li key={label}>
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
                {label}
                {i < step && <CheckCircleIcon width={12} height={12} className="text-accent" />}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-xs text-text-muted">
              Naming a company that already exists reuses it rather than creating a second one.
            </p>
            <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
              <Select
                size="form"
                searchable
                allowCustom
                label="Company name"
                required
                className="sm:col-span-2"
                value={company.name}
                onChange={(v) => setCompany((c) => ({ ...c, name: v }))}
                options={options?.companies ?? []}
                placeholder=""
              />
              <Select
                size="form"
                label="Status"
                value={company.status}
                onChange={(v) => setCompany((c) => ({ ...c, status: v }))}
                // The same four the other two pickers offer. It is a NEW
                // company here, so nothing cascades and no confirm is
                // needed: there are no deals on it yet to stop.
                options={COMPANY_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                placeholder=""
              />
              <FloatingField label="Notes" filled={Boolean(company.notes)} className="sm:col-span-2">
                <textarea
                  className="form-textarea" rows={3} placeholder="Notes"
                  value={company.notes}
                  onChange={(e) => setCompany((c) => ({ ...c, notes: e.target.value }))}
                />
              </FloatingField>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-text-muted">
              Everyone who works on this company, each in their own role and group. The money,
              the address and the banking are set per row afterwards or through Add deal, which
              is the form built for them.
            </p>

            <HandlerRows handlers={handlers} onChange={setHandlers} options={options} />

            {/* THE ROWS THEMSELVES, not a count and a promise. Same panel
                the Master Sheet's Add deal uses, so what a form is about
                to write looks the same wherever you are standing. */}
            <DealPreview
              rows={filled.map((h) => ({
                person: h.personName,
                role: h.roleLabel,
                group: h.groupName,
                company: company.name.trim(),
                amount: '',
                currency: '',
                method: '',
              }))}
            />
          </div>
        )}

        {error && (
          <p className="bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button onClick={() => setStep(0)} disabled={step === 0}>
            <ChevronIcon width={14} height={14} className="rotate-180" />
            Back
          </Button>
          <div className="flex gap-2">
            {step === 0 ? (
              <Button variant="primary" onClick={() => setStep(1)} disabled={!company.name.trim()}>
                Next
                <ChevronIcon width={14} height={14} />
              </Button>
            ) : (
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Creating…' : 'Create company'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
