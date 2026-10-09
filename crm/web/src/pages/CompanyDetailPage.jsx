import { useMemo, useState } from 'react';
import { formatDate as date } from '../helpers/formatDate';
import { formatMoney as money, formatTotals as totals, totalsOf } from '../helpers/formatMoney';
import { useParams } from 'react-router-dom';
import { useCompany, useUpdateCompany } from '../hooks/useCompanies';
import { usePeopleFilters } from '../hooks/usePeople';
import { useSettings } from '../hooks/useSettings';
// THE RATES ARE ON THE MONTHLY AMOUNT, so a handler row must show the same
// figure the master sheet and the export do. Mirror of the API's helper.
import { withRates } from '../helpers/rates';
import { useMasterSheetCellEdit } from '../hooks/useMasterSheet';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { DEAL_TOUCHES, bulkMessage, patchQueries } from '../hooks/useBulkActions';
import { countOf } from '../helpers/pluralNoun';
import { apiService } from '../configs/api.config';
import { popup } from '../configs/popups.config';
import { confirm } from '../configs/confirms.config';
import Button from '../components/buttons/Button';
import Breadcrumb from '../components/layout/Breadcrumb';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import SelectAll from '../components/forms/SelectAll';
import Modal from '../components/modals/Modal';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import PageHeader from '../components/layout/PageHeader';
import { DetailGrid, DetailCard, Stat } from '../components/layout/DetailLayout';
import EditableCell from '../components/forms/EditableCell';
import StatusBadge from '../components/badges/StatusBadge';
import PaymentPeriod from '../components/badges/PaymentPeriod';
import PaymentReceived, { dealReceived } from '../components/badges/PaymentReceived';
import DealReceivedCell from '../components/forms/DealReceivedCell';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import HistoryModal from '../components/modals/HistoryModal';
import ManageCompanyModal from '../components/modals/ManageCompanyModal';
import LiquidationPanel from '../components/modals/LiquidationPanel';
import CompanyStatusPicker from '../components/modals/CompanyStatusPicker';
import DealChecklist from '../components/forms/DealChecklist';
import {
  COMPANY_STATUS, COMPANY_STATUS_LABEL, isTerminalStatus,
  asksDeals,
} from '../configs/companyStatus';
// His word. The tick IS this string, so the seed reads the same constant
// the cell tag and the server both use.
import { GOING_CONCERN } from '../configs/sheetValues';
import Select from '../components/forms/Select';
import FloatingField from '../components/forms/FloatingField';
import { Skeleton } from '../components/display/Skeleton';
import RecordCard, { CardList } from '../components/display/RecordCard';
import { RestoreIcon, EditIcon, StopHandIcon, BuildingIcon, UsersIcon } from '../components/icons';

/**
 * One company, and everyone paid through it.
 *
 * Mirror of PersonDetailPage, and the same rows underneath — this page,
 * that page and the Master Sheet page are three groupings of
 * tb_mastersheet. So yes: everything here comes from the master sheet, and
 * an edit made here IS an edit to the master sheet. There is no separate
 * company record holding a copy of any of it.
 *
 * The only fields that belong to the COMPANY rather than to a deal are its
 * name, status and notes. Everything else in the table below belongs to
 * the deal and is edited on its own row, because it legitimately differs
 * between handlers on the same company.
 */



/**
 * Patches the ticked deals on this company's cached page. Returns the rollback.
 */
function patchCompanyDeals(queryClient, companyKey, ids, fn) {
  const want = new Set(ids.map(String));
  return patchQueries(queryClient, [['company', companyKey]], (data) => (
    data?.company?.deals
      ? { ...data, company: { ...data.company, deals: data.company.deals.map((d) => (want.has(String(d.id)) ? fn(d) : d)) } }
      : data
  ));
}

export default function CompanyDetailPage() {
  const { key } = useParams();
  const { data: company, tiers, oldGroups, isLoading, error } = useCompany(key);
  const { data: options } = usePeopleFilters();
  const updateCompany = useUpdateCompany();
  const cellEdit = useMasterSheetCellEdit();
  const [showHistory, setShowHistory] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  /**
   * TICKED HANDLERS, for the bulk bar. Above the early returns: a hook
   * after them would be skipped while loading and React counts hooks.
   *
   * NO DELETE HERE. A deal is deleted on the Master Sheet and nowhere
   * else; this page stops them, which Resume on the Archive undoes.
   */
  const dealIds = useMemo(() => (company?.deals ?? []).map((d) => d.id), [company]);
  const sel = useRowSelection(dealIds);
  const { run } = useBulkActions();
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkStopping, setBulkStopping] = useState(false);

  // NEITHER WAITS. The ticked deals change on this page the moment the
  // dialog is confirmed, the dialog and the ticks go, and the toast (with
  // Undo) is already up. A failure puts the deals back. See useBulkActions.
  function editSelected(fields, label) {
    const ids = sel.ids;
    const cached = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v]));
    run({
      call: () => apiService.masterSheet.bulkUpdate(ids, fields),
      optimistic: (qc) => patchCompanyDeals(qc, key, ids, (d) => ({ ...d, ...cached })),
      invalidates: DEAL_TOUCHES,
      toast: bulkMessage(`given a new ${label}`, ids.length, 'deal'),
      report: (data) => bulkMessage(`given a new ${label}`, data.updated.length, 'deal', [
        [data.skipped?.same ?? 0, 'already set'], [data.skipped?.gone ?? 0, 'gone'],
      ]),
      undoBatch: (data) => data.batchId,
      failure: `Couldn't change the ${label} on ${countOf(ids.length, 'deal')}`,
    });
    setBulkEditing(false);
    sel.clear();
  }

  function stopSelected() {
    const ids = sel.ids;
    const today = new Date().toISOString().slice(0, 10);
    run({
      call: () => apiService.masterSheet.bulkStop(ids),
      optimistic: (qc) => patchCompanyDeals(qc, key, ids, (d) => (d.stopped_on ? d : { ...d, stopped_on: today })),
      invalidates: DEAL_TOUCHES,
      toast: bulkMessage('stopped', ids.length, 'deal'),
      report: (data) => bulkMessage('stopped', data.stopped.length, 'deal', [[data.skipped, 'already stopped']]),
      undoBatch: (data) => data.batchId,
      failure: `Couldn't stop ${countOf(ids.length, 'deal')}`,
      icon: 'stop',
    });
    setBulkStopping(false);
    sel.clear();
  }
  const [liquidating, setLiquidating] = useState(false);
  // Closing and dissolving stop every deal on the company, so they are the
  // only two status changes that go through a dialog.
  const [confirmingStatus, setConfirmingStatus] = useState(null);
  /**
   * THE DEAL QUESTION, on the page that writes on click.
   *
   * The manage modal asks in place and saves on its own press. This page
   * has no press, so the question goes in a confirm and the status and the
   * ids are written together. Without it the status changed and the
   * checklist never appeared at all.
   */
  const [askingStatus, setAskingStatus] = useState(null);
  const [askIds, setAskIds] = useState([]);
  // Which of them it stops. Seeded with all of them when the dialog opens,
  // never re-seeded, or unticking a row would fight the next render.
  const [stopIds, setStopIds] = useState([]);

  if (isLoading) {
    return (
      /* SHAPED LIKE WHAT ARRIVES: a breadcrumb, a title beside its actions,
         then the two column DetailGrid. Three full width slabs told you
         something was loading and nothing about what, so the page jumped
         into a different layout the moment it landed. */
      <div className="space-y-4">
        <Skeleton pill className="h-3 w-40" />
        <div className="flex items-center justify-between gap-4">
          <Skeleton pill className="h-7 w-56" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56 !rounded-lg lg:col-span-2" />
          <Skeleton className="h-56 !rounded-lg" />
        </div>
        <Skeleton className="h-64 !rounded-lg" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ label: 'Companies', to: '/companies' }, { label: 'Not found' }]} />
        {error
          ? <ErrorState error={error} title="Couldn't load this company" />
          : <EmptyState icon={BuildingIcon} title="That company was not found" hint="It may have been renamed. Search for it on Companies." />}
      </div>
    );
  }

  const deals = company.deals || [];

  // The hook reports it, from `name` and `label`. See useUpdateCompany.
  function saveCompany(fields, label) {
    updateCompany.mutate({ key, name: company.name, label, fields });
  }

  const liveDeals = deals.filter((deal) => !deal.stopped_on);

  /**
   * ===============================
   * * THE STATUS IS THE ONLY CONTROL ON THIS PAGE THAT STOPS MONEY
   * ===============================
   * Liquidation opens the panel, because the status alone sets no amounts
   * and a company in liquidation with nothing set is paying full price.
   * The two terminal ones ask first: they stop every live deal.
   */
  function pickStatus(next) {
    /**
     * SEEDED FROM WHAT IS ALREADY TICKED, never from "all of them", the
     * same rule the picker follows: a company with two deals ticked by the
     * import must not open showing five and save five.
     */
    if (asksDeals(next)) {
      const already = liveDeals.filter(
        next === COMPANY_STATUS.GOING_CONCERN
          ? (d) => d.end_note === GOING_CONCERN
          : (d) => d.review_monthly,
      );
      setAskIds((already.length > 0 ? already : liveDeals).map((d) => d.id));
      setAskingStatus(next);
      return;
    }
    if (isTerminalStatus(next)) {
      // Seeded HERE, at the one moment the dialog opens. An effect would
      // re-tick everything on the render after somebody unticked a row.
      setStopIds(liveDeals.map((deal) => deal.id));
      setConfirmingStatus(next);
      return;
    }
    saveCompany({ status: next }, 'Status');
  }

  // The panel writes the settlement and the amounts together: one
  // negotiation, one save, so a half applied wind down cannot exist.
  function saveLiquidation({ liquidationTotal, deals: changed }) {
    saveCompany({ liquidationTotal }, 'Settlement');
    changed.forEach(({ id, monthlyAmount }) => {
      const deal = deals.find((d) => d.id === id);
      cellEdit({
        id, fields: { monthlyAmount }, subject: deal?.person_name, label: 'monthly amount',
      });
    });
    setLiquidating(false);
  }

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Companies', to: '/companies' }, { label: company.name }]} />

      <PageHeader
        title={company.name}
        // ANY status that is not active. It named only 'closed', so a
        // company in liquidation or dissolved had no subtitle at all and
        // the page header read exactly like a trading one.
        subtitle={company.status === COMPANY_STATUS.ACTIVE
          ? undefined
          : COMPANY_STATUS_LABEL[company.status]}
        actions={
          <>
            {/* Two ways to change the same thing, on purpose. The fields
                below edit in place for a one word fix; this opens the lot
                at once, which is what you want when several are wrong. */}
            <Button onClick={() => setShowEdit(true)}>
              <EditIcon width={15} height={15} />
              Edit
            </Button>
            <Button onClick={() => setShowHistory(true)}>
              <RestoreIcon width={15} height={15} />
              History
            </Button>
          </>
        }
      />

      <p className="text-xs text-text-muted">
        Everything here is the master sheet. Click any value to change it, the same change shows
        on People and on the Master Sheet page.
      </p>

      {/*
        The same shell as a person: WHAT THIS IS and what it holds on the
        left, WHAT IT COMES TO on the right. The three stat tiles that ran
        across the top have gone into the side column, where the money
        belongs with the counts rather than above everything as a dashboard
        for one row.
      */}
      <DetailGrid
        overview={(
            <DetailCard title="Company">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Renaming rewrites the company on every deal naming it — that
              is the cleanup feature, and it is why "Relia Pa" renamed to
              "Relia PA" merges the two into one company. */}
          <NameField label="Name" hint={popup.companyName()} value={company.name}
            onSave={(v) => saveCompany({ name: v }, 'Company name')} />
          {/* FIVE VALUES NOW, and two of them end every deal. See
              configs/companyStatus.js: dissolved and closed are both
              terminal and differ only in what they SAY happened, which is
              the audit fact a single "closed" was losing.

              THE SAME ROW OF FIVE THE MODAL SHOWS. Two doors onto one
              decision cannot be a dropdown here and a row there.

              NO DEAL LIST HERE, deliberately: this page's liquidation flow
              is LiquidationPanel, which sets the amounts. Passing no
              `onReviewIds` is what leaves the question unasked. */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <CompanyStatusPicker
              value={company.status}
              onChange={pickStatus}
              note={company.closed_on ? `Closed ${date(company.closed_on)}.` : undefined}
              disabled={updateCompany.isPending}
            />
            {company.status === COMPANY_STATUS.LIQUIDATION && (
              <Button size="xs" variant="secondary" className="self-start" onClick={() => setLiquidating(true)}>
                {company.liquidation_total == null
                  ? 'Set the amounts'
                  : `Settlement ${money(company.liquidation_total, deals[0]?.currency)}`}
              </Button>
            )}
          </div>
          {/* TIER, and it is not a second Status. Status is active/closed,
              whether the CRM still deals with this company at all; tier is
              what kind of company it is, which the export's per-group
              summary table prints. Two facts about one company sharing the
              word Status is what made payment period read as company
              life. */}
          {/* TYPE A NEW ONE, not just pick from the two that exist. The
              options are whatever tiers the data already contains ("Top co",
              "Normal co"), which is a list the boss grows: it came off his
              own Status column and there is no closed set behind it. A
              dropdown that can only offer what has already been used cannot
              record the first company of a new kind. `allowCustom` implies
              searchable, so it filters as you type and offers what you typed
              when nothing matches. */}
          <Select
              label="Tier"
              size="detail"
              hint={popup.companyTier()}
              allowCustom
              value={company.tier ?? ''}
              onChange={(v) => saveCompany({ tier: v ?? '' }, 'Tier')}
              options={(tiers ?? []).map((t) => ({ value: t, label: t }))}
              placeholder="Not set"
            />
          {/* HIS OWN EARLIER NAME FOR THE GROUP, off the sheet's "Old group"
              column: Milky, Wallaby 1, V3, NA. NOT one of our groups, and
              never matched against them — "Milky" resembling "MILKMAN" is a
              coincidence to resist, not a mapping to build. A company's real
              groups come from its deals and are shown below. */}
          <Select
              label="Old group"
              size="detail"
              allowCustom
              value={company.old_group ?? ''}
              onChange={(v) => saveCompany({ oldGroup: v ?? '' }, 'Old group')}
              options={(oldGroups ?? []).map((g) => ({ value: g, label: g }))}
              placeholder="Not set"
            />
          <div className="sm:col-span-2">
            <NameField label="Notes" multiline value={company.notes}
              onSave={(v) => saveCompany({ notes: v }, 'Notes')} />
          </div>
        </div>
            </DetailCard>
        )}
        records={(
            <DetailCard title={`Handlers (${deals.length})`} flush>
              <div className="p-3 md:p-0">
                <CompanyHandlers
                  deals={deals}
                  options={options}
                  cellEdit={cellEdit}
                  sel={sel}
                />
              </div>
            </DetailCard>
        )}
        summary={(
          <DetailCard title="Breakdown" highlighted>
            <div className="space-y-3">
              <Stat lead label="Monthly total" value={totals(company.monthly_totals)} />
              <Stat label="Handlers" value={company.handler_count} />
              <Stat label="Groups" value={(company.groups || []).join(', ') || '—'} />
            </div>
          </DetailCard>
        )}
      />

      {/* The same modal the Companies list opens, so Edit here and Manage
          handlers there are one dialog rather than two that drift. Details
          AND handlers, because "who is on this company" is one of the
          things you open a company to change. */}
      {showEdit && <ManageCompanyModal companyKey={key} onClose={() => setShowEdit(false)} />}
      {showHistory && (
        <HistoryModal
          title={`Recent changes · ${company.name}`}
          company={company.name}
          onClose={() => setShowHistory(false)}
        />
      )}

      {liquidating && (
        <LiquidationPanel
          company={company}
          deals={deals}
          busy={updateCompany.isPending}
          onSave={saveLiquidation}
          onClose={() => setLiquidating(false)}
        />
      )}

      {/* The last act of a wind down. It stops every live deal by default,
          and the checklist is for the exception: one settled separately, or
          one somebody is keeping alive on purpose. The dialog says how many
          and what survives, because the rows are kept and the months
          already paid are untouched. */}
      {/* ===============================
          * THE DEAL QUESTION, ASKED WHERE IT CAN BE SAVED
          * ===============================
          Liquidation, Review and Going concern each ask which of the
          company's deals they touch. The modal asks in place; this page
          writes on click, so it asks here and saves both together. */}
      {askingStatus && (
        <ConfirmDialog
          {...confirm.companyDeals({
            status: askingStatus,
            companyName: company.name,
            count: askIds.length,
            total: liveDeals.length,
            clearsDates: askingStatus === COMPANY_STATUS.GOING_CONCERN,
          })}
          /**
           * RED ONLY WHERE SOMETHING IS LOST. Going concern CLEARS end
           * dates, so it earns the danger button. Review and Liquidation
           * only mark deals, and a red Save on those reads as a warning
           * about a write that takes nothing away. Seen in the browser
           * 2026-09-22.
           */
          confirmVariant={askingStatus === COMPANY_STATUS.GOING_CONCERN ? 'danger' : 'primary'}
          busy={updateCompany.isPending}
          onCancel={() => setAskingStatus(null)}
          onConfirm={() => {
            // ONE PRESS, BOTH DECISIONS. The status and the deals it
            // touches are written together or not at all.
            saveCompany({
              status: askingStatus,
              ...(askingStatus === COMPANY_STATUS.GOING_CONCERN
                ? { goingConcernDealIds: askIds }
                : { reviewMonthlyDealIds: askIds }),
            }, 'Status');
            setAskingStatus(null);
            // The settlement is a separate negotiation and keeps its own
            // panel: this dialog answered which deals, not what they pay.
            if (askingStatus === COMPANY_STATUS.LIQUIDATION) setLiquidating(true);
          }}
        >
          <DealChecklist
            label={askingStatus === COMPANY_STATUS.GOING_CONCERN
              ? 'Deals with no end date'
              : 'Reviewed monthly'}
            deals={liveDeals}
            chosen={askIds}
            onChosen={setAskIds}
            disabled={updateCompany.isPending}
          />
        </ConfirmDialog>
      )}

      {confirmingStatus && (
        <ConfirmDialog
          {...confirm.closeCompany({
            status: confirmingStatus,
            companyName: company.name,
            count: stopIds.length,
            total: liveDeals.length,
            money: totals(totalsOf(liveDeals.filter((d) => stopIds.includes(d.id)))),
          })}
          busy={updateCompany.isPending}
          onCancel={() => setConfirmingStatus(null)}
          onConfirm={() => {
            saveCompany({ status: confirmingStatus, stopDealIds: stopIds }, 'Status');
            setConfirmingStatus(null);
          }}
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
      {bulkEditing && (
        <BulkEditDeals
          count={sel.count}
          groups={options?.groups ?? []}
          onClose={() => setBulkEditing(false)}
          onApply={editSelected}
        />
      )}

      {bulkStopping && (
        <ConfirmDialog
          {...confirm.bulkStopRows(sel.count)}
          icon={<StopHandIcon width={15} height={15} />}
          confirmVariant="danger"
          onCancel={() => setBulkStopping(false)}
          onConfirm={stopSelected}
        />
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={EditIcon} onClick={() => setBulkEditing(true)}>Edit</BulkAction>
        <BulkAction icon={StopHandIcon} variant="danger" onClick={() => setBulkStopping(true)}>Stop</BulkAction>
      </BulkBar>
    </div>
  );
}

/**
 * ONE FIELD ONTO EVERY TICKED DEAL. Payment method, group or preset date:
 * the three a company's handlers are most often set to together. One
 * field per apply, so the toast and History each say exactly what moved.
 */
const BULK_FIELDS = [
  { value: 'paymentMethod', label: 'Payment method' },
  { value: 'groupName', label: 'Group' },
  { value: 'presetOn', label: 'Preset date' },
];
const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'crypto', label: 'Crypto' }];

function BulkEditDeals({ count, groups, onApply, onClose }) {
  const [field, setField] = useState('paymentMethod');
  const [value, setValue] = useState('');
  const pick = (next) => { setField(next ?? 'paymentMethod'); setValue(''); };
  const label = BULK_FIELDS.find((f) => f.value === field)?.label.toLowerCase();

  return (
    <Modal title={`Edit ${count} ${count === 1 ? 'deal' : 'deals'}`} onClose={onClose}>
      <div className="space-y-3">
        <Select label="Field" size="form" value={field} onChange={pick} options={BULK_FIELDS} />
        {field === 'paymentMethod' && (
          <Select label="Payment method" size="form" value={value} onChange={(v) => setValue(v ?? '')}
            options={METHODS} placeholder="Pick a method" />
        )}
        {field === 'groupName' && (
          <Select label="Group" size="form" searchable value={value} onChange={(v) => setValue(v ?? '')}
            options={groups.map((g) => (typeof g === 'string' ? { value: g, label: g } : g))} placeholder="Pick a group" />
        )}
        {field === 'presetOn' && (
          <FloatingField label="Preset date" filled>
            <input type="date" className="form-control" value={value} onChange={(e) => setValue(e.target.value)} />
          </FloatingField>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="md" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="md"
            variant="primary"
            disabled={!value}
            onClick={() => onApply({ [field]: value }, label)}
          >
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Everyone paid through this company: cards on a phone, the table from md
 * up. Lifted out of the page so the layout above reads as a layout.
 *
 * Every cell is the same EditableCell the Master Sheet page uses, writing
 * to the same row, so an edit here IS an edit to the master sheet.
 */
function CompanyHandlers({ deals, options, cellEdit, sel }) {
  // The rail charge, one number for the whole system, so a card shows the
  // same figure the master sheet and the export do.
  const { data: settings } = useSettings();
  const cryptoPercent = Number(settings?.cryptoPercent) || 0;

  return (
    <>
        <CardList>
          {deals.length === 0 && (
            <EmptyState icon={UsersIcon} title="Nobody is paid through this company yet" />
          )}
          {deals.map((d) => (
            // The tint reaches the card, the same look a ticked row has.
            <div key={d.id} className={sel.has(d.id) ? '[&>div]:!bg-accent-tint' : ''}>
            <RecordCard
              title={d.person_name ?? '(no handler)'}
              subtitle={[d.group_name, d.role_label].filter(Boolean).join(' · ')}
              lead={money(withRates(d, { cryptoPercent }).payable_amount, d.currency)}
              leadLabel="payable"
              badges={
                <>
                  <PaymentPeriod period={d.payment_period} />
                  {dealReceived(d.payment_outcome) && <PaymentReceived value={dealReceived(d.payment_outcome)} />}
                </>
              }
              facts={[
                { label: 'Monthly', value: money(withRates(d, { cryptoPercent }).monthly_amount, d.currency) },
                { label: 'Days', value: d.payable_days },
                { label: 'Method', value: d.payment_method },
                { label: 'Preset', value: date(d.preset_on) },
              ]}
              actions={
                <label className="flex items-center gap-2 text-xs text-text-muted">
                  <input type="checkbox" checked={sel.has(d.id)} onChange={() => sel.toggle(d.id)} />
                  Select
                </label>
              }
            />
            </div>
          ))}
        </CardList>

        <div className="table-wrap is-nested hidden md:block">
          <table className="detail-table w-full min-w-[900px] text-xs">
            <thead>
              <tr>
                <th className="th w-8"><SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} /></th>
                <th className="th">Name</th>
                <th className="th">Role</th>
                <th className="th">Group</th>
                <th className="th text-right">Monthly</th>
                <th className="th text-right">Days</th>
                <th className="th text-right">Payable</th>
                <th className="th">Method</th>
                <th className="th">Preset</th>
                <th className="th">Payment period</th>
                <th className="th">Payment received</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 && (
                <EmptyState asRow colSpan={11} icon={UsersIcon} title="Nobody is paid through this company yet" />
              )}
              {deals.map((d) => (
                <tr key={d.id} className={`border-b border-border last:border-0 hover:bg-surface-sunken ${sel.has(d.id) ? 'row-selected' : ''}`}>
                  <td className="td w-8">
                    <input
                      type="checkbox"
                      checked={sel.has(d.id)}
                      onChange={() => sel.toggle(d.id)}
                      aria-label={`Select ${d.person_name ?? 'this handler'}`}
                    />
                  </td>
                  {/* ===============================
                      * EditableCell IS THE <td>. It must not be wrapped.
                      * ===============================
                      Each of these sat inside a <td> of its own, so the
                      DOM held a td inside a td: invalid, and React said so
                      twice per render in the console. Seen in the browser
                      2026-09-22, on this page.

                      Alignment moves ONTO the cell, which takes a className
                      for exactly this. Padding is the detail table's own. */}
                  <EditableCell value={d.person_name} className="font-medium text-text"
                    onSave={(v) => cellEdit({ id: d.id, fields: { personName: v }, subject: d.person_name, label: 'name' })} />
                  <EditableCell value={d.role_label} type="combo" suggestions={options?.roles ?? []}
                    className="text-text-muted"
                    onSave={(v) => cellEdit({ id: d.id, fields: { roleLabel: v }, subject: d.person_name, label: 'role' })} />
                  <EditableCell value={d.group_name} type="combo" suggestions={options?.groups ?? []}
                    className="text-text-muted"
                    onSave={(v) => cellEdit({ id: d.id, fields: { groupName: v }, subject: d.person_name, label: 'group' })} />
                  {/* VALUE is the wage, DISPLAY is the rated figure. Open the
                      cell and you edit 4,700; closed it reads 4,935. */}
                  <EditableCell value={d.monthly_amount} type="number"
                    display={money(withRates(d, { cryptoPercent }).monthly_amount, d.currency)}
                    className="text-right tabular-nums"
                    onSave={(v) => cellEdit({ id: d.id, fields: { monthlyAmount: v }, subject: d.person_name, label: 'monthly amount' })} />
                  <EditableCell value={d.payable_days} type="number"
                    className="text-right tabular-nums"
                    onSave={(v) => cellEdit({ id: d.id, fields: { payableDays: v }, subject: d.person_name, label: 'payable days' })} />
                  <EditableCell value={d.payable_amount} type="number"
                    display={money(withRates(d, { cryptoPercent }).payable_amount, d.currency)}
                    className="text-right tabular-nums"
                    onSave={(v) => cellEdit({ id: d.id, fields: { payableAmount: v }, subject: d.person_name, label: 'payable amount' })} />
                  <EditableCell value={d.payment_method} type="select"
                    options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'crypto', label: 'Crypto' }]}
                    className="text-text-muted"
                    onSave={(v) => cellEdit({ id: d.id, fields: { paymentMethod: v }, subject: d.person_name, label: 'payment method' })} />
                  <EditableCell value={d.preset_on} type="date" display={date(d.preset_on)}
                    className="text-text-muted"
                    onSave={(v) => cellEdit({ id: d.id, fields: { presetOn: v }, subject: d.person_name, label: 'preset date' })} />
                  {/* READ ONLY, 2026-09-09. The period is worked out from
                      the payment start, the preset and the end date, so it
                      is those you change. A stored value used to win over
                      the formula and left the badge disagreeing with the
                      tint beside it. See docs/state.md. */}
                  <td className="td">
                    <PaymentPeriod
                      period={d.payment_period}
                      endOn={d.end_on}
                      presetOn={d.preset_on}
                      paymentStartOn={d.payment_start_on}
                    />
                  </td>
                  <DealReceivedCell deal={d}
                    onSave={(v) => cellEdit({ id: d.id, fields: { paymentOutcome: v }, subject: d.person_name, label: 'payment received' })} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </>
  );
}

// Commits on blur and on Enter, reverts on Escape, never fires when
// nothing changed.
//
// `multiline` is Notes: a small textarea, where Enter is a new line and
// leaving the field is what saves.
function NameField({ label, hint, value, onSave, multiline = false }) {
  const [draft, setDraft] = useState(value ?? '');
  const Field = multiline ? 'textarea' : 'input';
  return (
    <FloatingField label={label} hint={hint} filled={Boolean(draft)} textarea={multiline}>
      <Field
        className={multiline ? 'form-textarea' : 'w-full text-xs'}
        rows={multiline ? 3 : undefined}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if ((draft ?? '') !== (value ?? '')) onSave(draft); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !multiline) e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur(); }
        }}
      />
    </FloatingField>
  );
}
