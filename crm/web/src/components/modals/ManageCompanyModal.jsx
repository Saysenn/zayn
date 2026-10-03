import { useState } from 'react';
import { useCompany, useUpdateCompany, useAddHandlers } from '../../hooks/useCompanies';
import { usePeople, usePeopleFilters } from '../../hooks/usePeople';
import { useNotifications } from '../../hooks/useNotifications';
import Modal from './Modal';
import FloatingField from '../forms/FloatingField';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import DealsEditor from '../forms/DealsEditor';
import { Skeleton } from '../display/Skeleton';
import ConfirmDialog from './ConfirmDialog';
import { confirm } from '../../configs/confirms.config';
import { formatTotals, totalsOf } from '../../helpers/formatMoney';
import DealChecklist from '../forms/DealChecklist';
import { COMPANY_STATUS, isTerminalStatus, asksMonthly } from '../../configs/companyStatus';
import CompanyStatusPicker from './CompanyStatusPicker';

/**
 * One company, everything an admin changes about it, in one modal.
 *
 * The mirror of ManagePersonModal, sharing DealsEditor with it —
 * a company's handlers and a person's companies are the same rows read
 * from opposite ends.
 *
 * MANAGE, NOT "ADD HANDLERS". The old dialog could only append: it showed
 * blank rows to fill in and no sign of who was already on the company, so
 * taking somebody off meant leaving here, finding the company's page and
 * removing the row there. Adding and removing are the same job and belong
 * behind the same button.
 */
export default function ManageCompanyModal({ companyKey, onClose }) {
  const { data: company, tiers, oldGroups, isLoading } = useCompany(companyKey);
  const { data: options } = usePeopleFilters();
  const updateCompany = useUpdateCompany();
  const addHandlers = useAddHandlers();
  const { notify } = useNotifications();

  // Names of everyone already in the system, so assigning an existing
  // person is a pick rather than a retype (and doesn't create a second
  // "Nathan " with a trailing space).
  const { data: peopleRows } = usePeople({ page: 1, pageSize: 500 });
  const people = (peopleRows ?? []).map((p) => p.display_name);

  const [form, setForm] = useState(null);
  const [confirmingStatus, setConfirmingStatus] = useState(null);
  // Which of this company's deals are reviewed month by month from now on.
  // Only asked under liquidation, and saved in the same press as the status.
  const [reviewIds, setReviewIds] = useState([]);
  // And which carry his word "Going concern". A separate list because it is
  // a separate question: not which are reviewed, but which have no end date.
  const [goingConcernIds, setGoingConcernIds] = useState([]);
  // And which a closure stops. Seeded with all of them when the dialog opens.
  const [stopIds, setStopIds] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  if (company && form === null) {
    // tier defaults to '' rather than a tier, because NULL means nobody has
    // said what kind of company this is. Seeding a value here would record
    // that decision the first time somebody opened this to fix a typo.
    setForm({
      name: company.name ?? '',
      status: company.status ?? 'active',
      tier: company.tier ?? '',
      oldGroup: company.old_group ?? '',
      notes: company.notes ?? '',
    });
  }

  const deals = company?.deals ?? [];
  // Only the LIVE ones: the confirm says how many a closure would stop, and
  // a deal already stopped is not stopped again.
  const liveDeals = deals.filter((d) => !d.stopped_on);

  function saveDetails(stopDealIds) {
    /**
     * ONE PRESS, BOTH DECISIONS. The status and which deals it puts into
     * the monthly review are one act: saving the status and then asking
     * about the deals is how half of it gets written and the other half
     * abandoned when somebody closes the modal.
     *
     * Sent ONLY under liquidation. Under the other four the question was
     * never asked, so an empty array there would read as "none of them"
     * and quietly clear flags the import set.
     *
     * `stopDealIds` arrives the same way from the closure dialog, and is
     * undefined on every other save: absent means all of them, which is the
     * behaviour every caller without a checklist has.
     */
    const fields = {
      ...form,
      ...(asksMonthly(form.status) ? { reviewMonthlyDealIds: reviewIds } : {}),
      // Sent ONLY under Going concern, for the same reason: under anything
      // else the question was never asked, and an empty array there reads
      // as "none of them" and would clear his word off every deal.
      ...(form.status === COMPANY_STATUS.GOING_CONCERN
        ? { goingConcernDealIds: goingConcernIds }
        : {}),
      ...(Array.isArray(stopDealIds) ? { stopDealIds } : {}),
    };
    updateCompany.mutate(
      { key: companyKey, fields },
      {
        // The hook reports it, from `fields.name`. See useUpdateCompany.
        onSuccess: onClose,
      },
    );
  }

  /**
   * ===============================
   * * SAVING A TERMINAL STATUS STOPS EVERY DEAL, AND THIS ASKED NOTHING
   * ===============================
   * The detail page has confirmed it since phase 3; this modal writes the
   * same column through the same route and did not, so Save details on a
   * company set to closed cascaded in silence. Found 2026-09-17.
   *
   * Only on the way IN. Reopening brings the deals back, so it needs no
   * dialog, and a company already closed being saved for a notes edit must
   * not ask again about a cascade that already happened.
   */
  const becomingTerminal = form
    && isTerminalStatus(form.status)
    && !isTerminalStatus(company?.status);

  function pressSave() {
    if (becomingTerminal) {
      // Seeded HERE, at the one moment the dialog opens. An effect would
      // re-tick everything on the render after somebody unticked a row.
      setStopIds(liveDeals.map((deal) => deal.id));
      setConfirmingStatus(form.status);
      return;
    }
    saveDetails();
  }

  return (
    <Modal wide title={company ? `Manage ${company.name}` : 'Manage company'} onClose={onClose}>
      {isLoading || !form ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2.5 text-sm font-semibold">Details</h3>
            <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
              {/* Renaming rewrites the company on every deal naming it.
                  That is the cleanup feature, and it is why renaming
                  "Relia Pa" to "Relia PA" merges the two into one. */}
              <FloatingField label="Company name" required filled={Boolean(form.name)}>
                <input className="form-control" placeholder="Company name" value={form.name}
                  onChange={(e) => set('name', e.target.value)} />
              </FloatingField>
              {/* ===============================
                  * A ROW OF FIVE, NOT A DROPDOWN
                  * ===============================
                  Each status does something different to the money, and a
                  select shows one meaning at a time. Liquidation also asks
                  a second question, per deal, and it appears in place
                  rather than as a modal over a modal.

                  BOTH COLUMNS: five words on one row need the full width,
                  and the per deal list under it is a panel, not a field. */}
              <CompanyStatusPicker
                className="sm:col-span-2"
                value={form.status}
                onChange={(v) => set('status', v)}
                deals={deals}
                reviewIds={reviewIds}
                onReviewIds={setReviewIds}
                goingConcernIds={goingConcernIds}
                onGoingConcernIds={setGoingConcernIds}
                disabled={updateCompany.isPending}
              />
              {/* TIER, not a second Status. Status is active/closed, the
                  Close button; this is what kind of company it is. The
                  export's per-group summary table is what reads it.

                  `allowCustom`, same as the detail page. The values are
                  prose he writes ("T2 for Reliapay"), so a list that can
                  only offer what already exists cannot record the first
                  company of a new kind. */}
              <Select
                size="form"
                label="Tier"
                allowCustom
                value={form.tier}
                onChange={(v) => set('tier', v ?? '')}
                options={(tiers ?? []).map((t) => ({ value: t, label: t }))}
                placeholder="Not set"
              />
              {/* HIS OWN EARLIER NAME FOR THE GROUP, off the sheet's "Old
                  group" column: Milky, Wallaby 1, V3. Never one of ours —
                  a company's real groups come from its deals. */}
              <Select
                size="form"
                label="Old group"
                allowCustom
                value={form.oldGroup}
                onChange={(v) => set('oldGroup', v ?? '')}
                options={(oldGroups ?? []).map((g) => ({ value: g, label: g }))}
                placeholder="Not set"
              />
              <FloatingField label="Notes" filled={Boolean(form.notes)} className="sm:col-span-2">
                <textarea className="form-textarea" rows={2} placeholder="Notes"
                  value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </FloatingField>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <DealsEditor
              mode="company"
              subjectName={company.name}
              deals={deals}
              options={options}
              people={people}
              adding={addHandlers.isPending}
              defaultGroup={company.groups?.[0] ?? ''}
              onAdd={(handler, { onDone, onFail }) =>
                addHandlers.mutate(
                  { key: companyKey, handlers: [handler] },
                  {
                    // The batch route skips anyone already on the company
                    // rather than failing, so a skip has to be reported as
                    // one — closing silently would look like it worked.
                    onSuccess: (res) => {
                      if (res?.skipped?.length) {
                        onFail(`${handler.personName} is already on ${company.name}.`);
                        return;
                      }
                      notify({ level: 'success', message: `${handler.personName} added to ${company.name}` });
                      onDone();
                    },
                    onError: (err) => onFail(err.message),
                  },
                )
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-text-muted">
              Handler changes above are saved already.
            </p>
            <div className="flex gap-2">
              <Button onClick={onClose}>Close</Button>
              <Button
                variant="primary"
                onClick={pressSave}
                disabled={!form.name.trim() || updateCompany.isPending}
              >
                {updateCompany.isPending ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* The same dialog the detail page shows, from the same words and the
          same checklist: one company status, one set of consequences, said
          once. */}
      {confirmingStatus && (
        <ConfirmDialog
          {...confirm.closeCompany({
            status: confirmingStatus,
            companyName: company.name,
            count: stopIds.length,
            total: liveDeals.length,
            money: formatTotals(totalsOf(liveDeals.filter((d) => stopIds.includes(d.id)))),
          })}
          busy={updateCompany.isPending}
          onCancel={() => setConfirmingStatus(null)}
          onConfirm={() => { setConfirmingStatus(null); saveDetails(stopIds); }}
        >
          <DealChecklist
            label="Deals to stop"
            deals={liveDeals}
            chosen={stopIds}
            onChosen={setStopIds}
            disabled={updateCompany.isPending}
            empty="Nothing is running on this company, so nothing stops."
          />
        </ConfirmDialog>
      )}
    </Modal>
  );
}
