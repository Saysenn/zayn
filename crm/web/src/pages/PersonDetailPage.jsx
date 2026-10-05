import { useState } from 'react';
import { formatDate as date } from '../helpers/formatDate';
import { formatMoney as money, formatTotals as totals } from '../helpers/formatMoney';

// The API validates the method against this closed set.
const PAYMENT_METHODS = ['cash', 'bank', 'crypto'];

// Raw buttons that edit in place still need a visible keyboard focus.
const FOCUS = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent';
import { Link, useParams } from 'react-router-dom';
import { usePerson, useUpdatePerson, usePeopleFilters } from '../hooks/usePeople';
import { useMasterSheetCellEdit, useUpdateMasterSheetRow } from '../hooks/useMasterSheet';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { DEAL_TOUCHES, bulkMessage, patchQueries } from '../hooks/useBulkActions';
import { countOf } from '../helpers/pluralNoun';
import { apiService } from '../configs/api.config';
import { useNotifications } from '../hooks/useNotifications';
import { useSettings } from '../hooks/useSettings';
// THE RATES ARE ON THE MONTHLY AMOUNT, so a deal card must show the same
// figure the master sheet and the export do. Mirror of the API's helper.
import { withRates } from '../helpers/rates';

import Button from '../components/buttons/Button';
import Breadcrumb from '../components/layout/Breadcrumb';
import PageHeader from '../components/layout/PageHeader';
import { DetailGrid, DetailCard, Stat } from '../components/layout/DetailLayout';
import EditableCell from '../components/forms/EditableCell';
import PercentField from '../components/forms/PercentField';
import FloatingField from '../components/forms/FloatingField';
import StatusBadge from '../components/badges/StatusBadge';
import PaymentPeriod from '../components/badges/PaymentPeriod';
import PaydayIndicator from '../components/badges/PaydayIndicator';
import ManagePersonModal from '../components/modals/ManagePersonModal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { confirm } from '../configs/confirms.config';
import HistoryModal from '../components/modals/HistoryModal';
import Select from '../components/forms/Select';
import { Skeleton } from '../components/display/Skeleton';
import RecordCard, { CardList } from '../components/display/RecordCard';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import SelectAll from '../components/forms/SelectAll';
import BulkBar, { BulkAction, BulkMenu } from '../components/layout/BulkBar';
import BulkFieldModal from '../components/modals/BulkFieldModal';
import { RestoreIcon, EditIcon, StopHandIcon, BuildingIcon } from '../components/icons';
import { INTERNAL, NEVER_BANK, IN_PERSON } from '../configs/sheetValues';

/**
 * One person, everything about them.
 *
 * This is why the People list can stay thin. Every field here comes from a
 * column the boss's sheet already has — nothing is invented, and nothing
 * is a second copy: the deals table below is the same rows the Master
 * Sheet page shows, filtered to this person.
 *
 * EVERYTHING ON THIS PAGE IS EDITABLE IN PLACE. Click a value, change it,
 * press Enter. The write is optimistic and toasts on both outcomes, so
 * there is no Save button to hunt for and no modal to open for a one-word
 * correction. Editing a deal column here also claims it against the next
 * uploaded sheet, exactly as it does on the Master Sheet page.
 *
 * FIELDS THAT VARY PER DEAL ARE SHOWN AS SETS and edited ACROSS ALL OF
 * THEM. Phone, postcode and bank details legitimately differ between one
 * person's deals in the real sheet, so the card shows every distinct value
 * — but "Abe's phone number" is one fact about Abe, so changing it here
 * writes to every company he handles rather than making you find the
 * right row. When the values differ, the field says so before you
 * overwrite them.
 */



/**
 * A field that lives on the deals, edited here across all of them.
 *
 * Shows every distinct value the person's companies carry. Editing writes
 * the new value to all of them — which is what someone means by "change
 * his phone number" — and the warning appears only when there was more
 * than one value to begin with, because that is the only case where
 * saving actually loses something.
 */
function Facts({ label, values, options, searchable, allowCustom, quickFill, onSave }) {
  const list = (values || []).filter(Boolean);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function commit(value) {
    setEditing(false);
    const current = list.length === 1 ? list[0] : '';
    if (value !== undefined && value !== current) onSave(value);
  }

  return (
    <div>
      {!editing && (
        <dt className="text-xs font-semibold uppercase tracking-wide text-text-faint">{label}</dt>
      )}
      <dd className={editing ? '' : 'mt-0.5 text-xs'}>
        {editing ? (
          <>
            {options ? (
              <Select
                label={label}
                size="detail"
                // Opens on the same click that revealed it, and collapses
                // back to the read view when it closes — with or without a
                // pick. Without onOpenChange the field stayed a dropdown
                // forever once opened, while the plain text field beside
                // it collapsed on blur. Same control, same behaviour.
                autoOpen
                onOpenChange={(open) => { if (!open) setEditing(false); }}
                searchable={searchable}
                allowCustom={allowCustom}
                value={draft}
                onChange={commit}
                options={options}
                placeholder="Pick one"
              />
            ) : (
              <>
                <FloatingField label={label} filled={Boolean(draft)}>
                  <input
                    autoFocus
                    className="w-full text-xs"
                    aria-label={label}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(draft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditing(false);
                    }}
                  />
                </FloatingField>
                {/* onMouseDown, not onClick: the input's own blur fires
                    first and would commit the half-typed value before the
                    click ever landed. */}
                {(quickFill ?? []).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); commit(q); }}
                    className={`mt-1 min-h-0 border-0 bg-transparent p-0 text-xs text-text-muted underline hover:text-text ${FOCUS}`}
                  >
                    {q}
                  </button>
                ))}
              </>
            )}
            {list.length > 1 && (
              <span className="mt-1 block text-xs text-warning">
                {list.length} different values across their companies. Saving replaces all of them.
              </span>
            )}
          </>
        ) : (
          <button
            type="button"
            title={'Click to change ' + label.toLowerCase() + ' on every company'}
            onClick={() => { setDraft(list.length === 1 ? list[0] : ''); setEditing(true); }}
            className={`min-h-0 w-full justify-start border-0 border-b border-dashed border-border bg-transparent p-0 text-left text-xs hover:border-accent ${FOCUS}`}
          >
            {list.length === 0 ? <span className="text-text-faint">—</span> : list.join(', ')}
          </button>
        )}
      </dd>
    </div>
  );
}

// A read only pair, for a fact that belongs to the person and is derived
// rather than typed: their roles, their groups. Editing either means
// editing the deals that produce them.
function Read({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || <span className="text-text-faint">—</span>}</dd>
    </div>
  );
}

/**
 * Patches the ticked deals on this person's cached page, the instant a
 * bulk action is confirmed. Returns the rollback.
 */
function patchPersonDeals(queryClient, personId, ids, fn) {
  const want = new Set(ids.map(String));
  return patchQueries(queryClient, [['person', personId]], (data) => (
    data?.person?.deals
      ? { ...data, person: { ...data.person, deals: data.person.deals.map((d) => (want.has(String(d.id)) ? fn(d) : d)) } }
      : data
  ));
}

export default function PersonDetailPage() {
  const { personId } = useParams();
  const { data: person, isLoading, error } = usePerson(personId);
  const { data: options } = usePeopleFilters();
  const updatePerson = useUpdatePerson();
  const cellEdit = useMasterSheetCellEdit();
  // Silent: saveAcrossDeals writes one field to every company this person
  // handles and reports the batch once. See useUpdateMasterSheetRow.
  const updateDeal = useUpdateMasterSheetRow({ silent: true });
  const { notify } = useNotifications();
  const [showHistory, setShowHistory] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // The bulk bar over their deals. Declared above the early returns: a hook
  // after one is a different number of hooks on the loading render.
  // NO REMOVE in the bar or on a row: deleting a deal is the Master Sheet's
  // alone. Stop is how a deal ends here.
  const sel = useRowSelection((person?.deals ?? []).map((d) => d.id));
  const { run } = useBulkActions();
  const [confirmStop, setConfirmStop] = useState(false);
  const [editField, setEditField] = useState(null);

  // Neither waits for the server: the deals change on screen, the bar is
  // cleared and the toast (with Undo) is up on the click. See useBulkActions.
  function stopSelected() {
    const ids = sel.ids;
    const today = new Date().toISOString().slice(0, 10);
    run({
      call: () => apiService.masterSheet.bulkStop(ids),
      optimistic: (qc) => patchPersonDeals(qc, personId, ids, (d) => (d.stopped_on ? d : { ...d, stopped_on: today })),
      invalidates: DEAL_TOUCHES,
      toast: bulkMessage('stopped', ids.length, 'deal'),
      report: (data) => bulkMessage('stopped', data.stopped.length, 'deal', [[data.skipped, 'already stopped']]),
      undoBatch: (data) => data.batchId,
      failure: `Couldn't stop ${countOf(ids.length, 'deal')}`,
      icon: 'stop',
    });
    sel.clear();
    setConfirmStop(false);
  }

  function editSelected(value) {
    const ids = sel.ids;
    const field = editField;
    const column = field.key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    // A month picker answers "2026-10"; the cached column is a date.
    const cached = field.type === 'month' && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
    run({
      call: () => apiService.masterSheet.bulkUpdate(ids, { [field.key]: value }),
      optimistic: (qc) => patchPersonDeals(qc, personId, ids, (d) => ({ ...d, [column]: cached })),
      invalidates: DEAL_TOUCHES,
      toast: bulkMessage(`${field.label.toLowerCase()} changed`, ids.length, 'deal'),
      report: (data) => bulkMessage(`${field.label.toLowerCase()} changed`, data.updated.length, 'deal', [
        [data.skipped?.same ?? 0, 'already set'], [data.skipped?.gone ?? 0, 'gone'],
      ]),
      undoBatch: (data) => data.batchId,
      failure: `Couldn't change ${field.label.toLowerCase()} on ${countOf(ids.length, 'deal')}`,
    });
    sel.clear();
    setEditField(null);
  }

  if (isLoading) {
    return (
      /* The same shape as CompanyDetailPage, because it is the same page
         with different contents: breadcrumb, title beside its actions, the
         two column DetailGrid, then the deals table. */
      <div className="space-y-4">
        <Skeleton pill className="h-3 w-40" />
        <div className="flex items-center justify-between gap-4">
          <Skeleton pill className="h-7 w-56" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
        {/* DetailGrid's own shape, so nothing jumps when it lands:
            overview beside summary, two supporting cards, then the deals. */}
        <div className="grid items-start gap-3 xl:grid-cols-4">
          <Skeleton className="h-64 !rounded-lg xl:col-span-3" />
          <Skeleton className="h-64 !rounded-lg" />
          <div className="grid gap-3 md:grid-cols-2 xl:col-span-4">
            <Skeleton className="h-48 !rounded-lg" />
            <Skeleton className="h-48 !rounded-lg" />
          </div>
          <Skeleton className="h-64 !rounded-lg xl:col-span-4" />
        </div>
      </div>
    );
  }

  if (error || !person) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ label: 'People', to: '/people' }, { label: 'Not found' }]} />
        <ErrorState
          title="Couldn't open this person"
          error={error ?? { message: 'That person was not found.' }}
        />
      </div>
    );
  }

  const deals = person.deals || [];
  // How many of their rows carry a rate of their own. The two levels STACK,
  // so the person field says so rather than looking like the only one.
  const dealRates = {
    addon: deals.filter((d) => Number(d.addon_percent) > 0).length,
    fee: deals.filter((d) => Number(d.fee_percent) > 0).length,
  };

  // The hook reports it. `name` and `label` are what it words the toast
  // from — "Drew's email updated" — so they travel with the write rather
  // than being restated in an onSuccess here.
  function saveProfile(field, label, value) {
    updatePerson.mutate({
      personId,
      name: person.display_name,
      label,
      fields: { [field]: value },
    });
  }

  /**
   * Writes one field to every company this person handles.
   *
   * No bulk endpoint: seven deals for the busiest person in the real
   * sheet, so seven PATCHes is cheaper than a route needing its own
   * validation, change-log handling and tests. Each goes through the same
   * path the Master Sheet page uses, so it is logged and it claims the
   * column against the next upload exactly as a manual edit should.
   */
  function saveAcrossDeals(field, label, value) {
    if (deals.length === 0) return;
    Promise.all(
      deals.map(
        (d) =>
          new Promise((resolve, reject) => {
            updateDeal.mutate(
              { id: d.id, fields: { [field]: value } },
              { onSuccess: resolve, onError: reject },
            );
          }),
      ),
    )
      .then(() =>
        notify({
          level: 'success',
          message:
            deals.length === 1
              ? label + ' updated'
              : label + ' updated on all ' + deals.length + ' companies',
        }),
      )
      .catch((err) =>
        notify({ level: 'error', message: "Couldn't update " + label.toLowerCase(), detail: err.message }),
      );
  }

  return (
    <div className="space-y-4">
      {/* "People › Drew" rather than a back arrow. The arrow said "back"
          but not back to what, and it duplicated the browser's own. */}
      <Breadcrumb items={[{ label: 'People', to: '/people' }, { label: person.display_name }]} />

      {/* The person_id used to sit here as a subtitle. It said the same
          thing as the title, slugified, which is a duplicate rather than
          information — it lives on the Profile card instead, where it
          reads as the identifier it is. */}
      <PageHeader
        title={person.display_name}
        actions={
          <>
            {/* Two ways to change the same thing, on purpose. The fields
                below edit in place for a one word fix; this opens the lot
                at once — details AND companies — which is what you want
                when several are wrong. "Assign to company" used to sit
                beside it as its own button; it is inside here now. */}
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
        Click any value to change it. Changes save as you go.
      </p>

      {/*
        WHO THEY ARE and WHAT THEY HOLD on the left, WHAT IT COMES TO on the
        right. The four stat tiles that used to run across the top are gone
        into those two: the money belongs with the rates that change it, and
        the roles and groups belong with the person they describe. A strip
        of totals above everything read as a dashboard for one row.
      */}
      <DetailGrid
        overview={(
            <DetailCard title="Person">
              {/* The only fields that belong to the PERSON rather than to a
                  deal. Everything else on this page varies per deal. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <ProfileField label="Display name" value={person.display_name}
                  onSave={(v) => saveProfile('displayName', 'Display name', v)} />
                <ProfileField label="Email" value={person.email} type="email"
                  onSave={(v) => saveProfile('email', 'Email', v)} />
                <div className="sm:col-span-2">
                  <ProfileField label="Notes" value={person.notes} textarea
                    onSave={(v) => saveProfile('notes', 'Notes', v)} />
                </div>
                {/* Derived from the deals below, so read only here: these
                    change by changing a row, not by typing over a summary. */}
                <Read label="Roles" value={(person.roles || []).join(', ')} />
                <Read label="Groups" value={(person.groups || []).join(', ')} />
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-text-faint">Identifier</dt>
                  <dd className="mt-0.5 font-mono text-xs text-text-faint">{person.person_id}</dd>
                </div>
              </div>
            </DetailCard>
        )}
        records={(
            <DetailCard title={`Companies (${deals.length})`} flush>
              {/* On a phone these are cards. The table is eleven columns
                  wide, and the reason you opened a person on a phone is to
                  see what they earn where, which is three of them.

                  Read only here, deliberately: correcting a figure is what
                  the Master Sheet page is for, and an inline editor inside a
                  card at 375px is a worse version of it. Ending a deal
                  here is Stop, from the bulk bar; deleting one is the
                  Master Sheet's alone. */}
              <div className="p-3 md:p-0">
                <PersonDeals
                  deals={deals}
                  options={options}
                  cellEdit={cellEdit}
                  sel={sel}
                />
              </div>
            </DetailCard>
        )}
        summary={(
          <>
            {/* The money, and the two rates that decide it. They were in a
                "Profile" card with the name and the notes, which put the
                add on percentage next to the display name. */}
            <DetailCard title="Breakdown" highlighted>
              <div className="space-y-3">
                <Stat lead label="Monthly total" value={totals(person.monthly_totals)} />
                <Stat
                  label="Companies"
                  value={`${person.active_company_count} active of ${person.company_count}`}
                />
                <div className="space-y-3 border-t border-border pt-3">
                  <PercentField
                    label="Add on percentage"
                    hint="Added on top of every amount they are owed. 0 means none."
                    value={person.addon_percent}
                    warning={dealRates.addon > 0
                      ? `${dealRates.addon} of their deals set an add on of their own. Those STACK with this one.`
                      : null}
                    onSave={(v) => saveProfile('addonPercent', 'Add on percentage', v)}
                  />
                  <PercentField
                    label="Fee percentage"
                    hint="Deducted from their total, after add ons. 0 means none."
                    value={person.fee_percent}
                    warning={dealRates.fee > 0
                      ? `${dealRates.fee} of their deals set a fee of their own. Those STACK with this one.`
                      : null}
                    onSave={(v) => saveProfile('feePercent', 'Fee percentage', v)}
                  />
                  {/* VIEW ONLY, and only when it applies to them. The
                      exchange's cut belongs to the payment rail, not to this
                      person, so it is set once in Settings and shown here. */}
                  <CryptoRates deals={deals} />
                </div>
              </div>
            </DetailCard>
          </>
        )}
        supporting={(
          <>
            <DetailCard title="Contact">
              <dl className="space-y-3">
                <Facts label="Phone" values={person.phones} quickFill={['Handled Internally']}
                  onSave={(v) => saveAcrossDeals('phone', 'Phone', v)} />
                <Facts label="Location" values={person.locations} searchable allowCustom options={options?.locations ?? []}
                  onSave={(v) => saveAcrossDeals('location', 'Location', v)} />
                <Facts label="Door number" values={person.door_numbers}
                  quickFill={[INTERNAL, IN_PERSON]}
                  onSave={(v) => saveAcrossDeals('doorNumber', 'Door number', v)} />
                <Facts label="Postcode" values={person.postcodes} quickFill={[INTERNAL]}
                  onSave={(v) => saveAcrossDeals('postcode', 'Postcode', v)} />
                <Facts label="Accepting postals" values={person.accepting_postals} allowCustom
                  options={['Yes', 'No', INTERNAL]}
                  onSave={(v) => saveAcrossDeals('acceptingPostals', 'Accepting postals', v)} />
              </dl>
              <p className="mt-3 border-t border-border pt-2 text-xs text-text-faint">
                Changing one of these updates it on every company they handle.
              </p>
            </DetailCard>

            <DetailCard title="Banking">
              <dl className="space-y-3">
                <Facts label="Bank" values={person.bank_details} quickFill={[NEVER_BANK]}
                  onSave={(v) => saveAcrossDeals('bankDetails', 'Bank', v)} />
                <Facts label="Account number" values={person.account_numbers} quickFill={[NEVER_BANK]}
                  onSave={(v) => saveAcrossDeals('accountNumber', 'Account number', v)} />
                <Facts label="Sort code" values={person.sort_codes} quickFill={[NEVER_BANK]}
                  onSave={(v) => saveAcrossDeals('sortCode', 'Sort code', v)} />
              </dl>
            </DetailCard>
          </>
        )}
      />

      {/* ONE MODAL, not an Edit dialog and an Assign dialog. Both were
          answering "what is wrong about this person", and which one held
          the field you wanted was something you had to know before you
          could go looking. */}
      {showEdit && <ManagePersonModal personId={personId} onClose={() => setShowEdit(false)} />}
      {showHistory && (
        <HistoryModal
          title={`Recent changes · ${person.display_name}`}
          personId={personId}
          onClose={() => setShowHistory(false)}
        />
      )}

      {confirmStop && (
        <ConfirmDialog
          {...confirm.bulkStopRows(sel.count)}
          icon={<StopHandIcon width={15} height={15} />}
          confirmVariant="danger"
          onCancel={() => setConfirmStop(false)}
          onConfirm={stopSelected}
        />
      )}
      {editField && (
        <BulkFieldModal
          title={`Set ${editField.label.toLowerCase()} on ${sel.count} ${sel.count === 1 ? 'deal' : 'deals'}`}
          label={editField.label}
          type={editField.type}
          options={editField.options}
          allowCustom={editField.allowCustom}
          onApply={editSelected}
          onClose={() => setEditField(null)}
        />
      )}

      <BulkBar count={sel.count} noun="deal" onClear={sel.clear}>
        <BulkMenu
          icon={EditIcon}
          label="Edit"
          options={[
            { label: 'Payment method', onSelect: () => setEditField({ key: 'paymentMethod', label: 'Payment method', options: PAYMENT_METHODS }) },
            { label: 'Group', onSelect: () => setEditField({ key: 'groupName', label: 'Group', options: options?.groups ?? [], allowCustom: true }) },
            { label: 'Preset month', onSelect: () => setEditField({ key: 'presetOn', label: 'Preset month', type: 'month' }) },
          ]}
        />
        <BulkAction icon={StopHandIcon} variant="danger" onClick={() => setConfirmStop(true)}>
          Stop
        </BulkAction>
      </BulkBar>
    </div>
  );
}

/**
 * The companies this person is on: cards on a phone, the table from md up.
 *
 * Lifted out of the page so the layout above reads as a layout. Every cell
 * is the same EditableCell the Master Sheet page uses, writing to the same
 * row, so a correction here is a correction there and it claims the column
 * against the next uploaded sheet.
 */
function PersonDeals({ deals, options, cellEdit, sel }) {
  // The rail charge, one number for the whole system, so a card shows the
  // same figure the master sheet and the export do.
  const { data: settings } = useSettings();
  const cryptoPercent = Number(settings?.cryptoPercent) || 0;

  return (
    <>
        {deals.length === 0 && (
          <div className="md:hidden">
            <EmptyState icon={BuildingIcon} title="Not on any company yet" hint="Open Edit to add one." />
          </div>
        )}
        <CardList>
          {deals.map((d) => (
            <RecordCard
              key={d.id}
              selected={sel.has(d.id)}
              onSelect={() => sel.toggle(d.id)}
              selectLabel={`Select ${d.company ?? d.group_name}`}
              title={d.company ?? d.group_name}
              subtitle={[d.group_name, d.role_label].filter(Boolean).join(' · ')}
              lead={money(withRates(d, { cryptoPercent }).payable_amount, d.currency)}
              leadLabel="payable"
              badges={
                <>
                  <PaymentPeriod period={d.payment_period} />
                  {d.payment_outcome && <PaydayIndicator outcome={d.payment_outcome} />}
                </>
              }
              facts={[
                { label: 'Monthly', value: money(withRates(d, { cryptoPercent }).monthly_amount, d.currency) },
                { label: 'Days', value: d.payable_days },
                { label: 'Method', value: d.payment_method },
                { label: 'Preset', value: date(d.preset_on) },
              ]}
            />
          ))}
        </CardList>

        <div className="table-wrap is-nested hidden md:block">
          <table className="detail-table w-full min-w-[900px] text-xs">
            <thead>
              <tr>
                <th className="th w-8">
                  <SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} />
                </th>
                <th className="th">Group</th>
                <th className="th">Company</th>
                <th className="th">Role</th>
                <th className="th text-right">Monthly</th>
                <th className="th text-right">Days</th>
                <th className="th text-right">Payable</th>
                <th className="th">Method</th>
                <th className="th">Preset</th>
                <th className="th">Payment period</th>
                <th className="th">Payday</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 && (
                <EmptyState asRow colSpan={11} icon={BuildingIcon} title="Not on any company yet" hint="Open Edit to add one." />
              )}
              {deals.map((d) => {
                // THE FIGURE SHOWN IS RATED, THE VALUE EDITED IS THE WAGE.
                // Same rule the Master Sheet's own table follows, and the
                // table read the raw wage while the cards above it read the
                // rated one: a person's 5% was missing here alone.
                const rated = withRates(d, { cryptoPercent });
                return (
                <tr key={d.id} className={`border-b border-border last:border-0 hover:bg-surface-sunken ${sel.has(d.id) ? 'row-selected' : ''}`}>
                  <td className="td w-8">
                    <input type="checkbox" checked={sel.has(d.id)} onChange={() => sel.toggle(d.id)}
                      aria-label={`Select ${d.company ?? d.group_name}`} />
                  </td>
                  {/* Every cell is the same EditableCell the Master Sheet
                      page uses, writing to the same row. A correction here
                      is a correction there, and it claims the column
                      against the next uploaded sheet. */}
                  <td className="td">
                    <EditableCell value={d.group_name} type="combo" suggestions={options?.groups ?? []}
                      onSave={(v) => cellEdit({ id: d.id, fields: { groupName: v }, subject: d.person_name, label: 'group' })} />
                  </td>
                  <td className="td">
                    <EditableCell value={d.company} type="combo" suggestions={options?.companies ?? []}
                      display={d.company || '—'}
                      onSave={(v) => cellEdit({ id: d.id, fields: { company: v }, subject: d.person_name, label: 'company' })} />
                  </td>
                  <td className="td text-text-muted">
                    <EditableCell value={d.role_label} type="combo" suggestions={options?.roles ?? []}
                      onSave={(v) => cellEdit({ id: d.id, fields: { roleLabel: v }, subject: d.person_name, label: 'role' })} />
                  </td>
                  <td className="td text-right">
                    <EditableCell value={d.monthly_amount} type="number"
                      display={money(rated.monthly_amount, d.currency)} className="text-right tabular-nums"
                      onSave={(v) => cellEdit({ id: d.id, fields: { monthlyAmount: v }, subject: d.person_name, label: 'monthly amount' })} />
                  </td>
                  <td className="td text-right">
                    <EditableCell value={d.payable_days} type="number" className="text-right tabular-nums"
                      onSave={(v) => cellEdit({ id: d.id, fields: { payableDays: v }, subject: d.person_name, label: 'payable days' })} />
                  </td>
                  <td className="td text-right">
                    <EditableCell value={d.payable_amount} type="number"
                      display={money(rated.payable_amount, d.currency)} className="text-right tabular-nums"
                      onSave={(v) => cellEdit({ id: d.id, fields: { payableAmount: v }, subject: d.person_name, label: 'payable amount' })} />
                  </td>
                  <td className="td text-text-muted">
                    <EditableCell value={d.payment_method} type="select"
                      options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'crypto', label: 'Crypto' }]}
                      onSave={(v) => cellEdit({ id: d.id, fields: { paymentMethod: v }, subject: d.person_name, label: 'payment method' })} />
                  </td>
                  <td className="td text-text-muted">
                    <EditableCell value={d.preset_on} type="date" display={date(d.preset_on)}
                      onSave={(v) => cellEdit({ id: d.id, fields: { presetOn: v }, subject: d.person_name, label: 'preset date' })} />
                  </td>
                  {/* READ ONLY, 2026-09-09. This was the ONE cell in the
                      CRM that could set the payment period, and a stored
                      value won over the formula on every later read: the
                      badge said Ended while the payment start cell beside
                      it stayed green and the amount stayed in the month's
                      total. The period is worked out from the payment
                      start, the preset and the end date, so those are what
                      you change. See docs/state.md. */}
                  <td className="td">
                    <PaymentPeriod
                      period={d.payment_period}
                      endOn={d.end_on}
                      presetOn={d.preset_on}
                      paymentStartOn={d.payment_start_on}
                    />
                  </td>
                  <td className="td">
                    {d.payment_outcome
                      ? <PaydayIndicator outcome={d.payment_outcome} />
                      : <span className="text-xs text-text-faint">Not checked</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
    </>
  );
}

/**
 * The exchange's cut, shown only to somebody paid in crypto.
 *
 * READ ONLY. It is a rate on a payment rail, identical for everyone paid
 * that way, so it is set once in Settings. Editable here it would look like
 * this person's own terms, which is what addon_percent is for.
 */
function CryptoRates({ deals }) {
  const { data } = useSettings();
  const crypto = (deals ?? []).filter((d) => /crypto/i.test(String(d.payment_method ?? '')));
  if (crypto.length === 0) return null;

  const percent = Number(data?.cryptoPercent) || 0;

  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
        Crypto charge
      </span>
      <p className="mt-1 text-xs tabular-nums">{`${percent}%`}</p>
      <span className="mt-1 block text-xs text-text-muted">
        {`Added to ${crypto.length === 1 ? 'their crypto deal' : `their ${crypto.length} crypto deals`}, for the gas. Set in `}
        <Link to="/settings" className="underline">Settings, Global rates</Link>
        .
      </span>
    </div>
  );
}

// Commits on blur and on Enter, reverts on Escape, and never fires a
// request when nothing actually changed.
function ProfileField({ label, value, onSave, textarea, type = 'text' }) {
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    if ((draft ?? '') !== (value ?? '')) onSave(draft);
  };

      return (
        <FloatingField label={label} filled={Boolean(draft)} textarea={textarea}>
          {textarea ? (
            <textarea
              className="w-full text-xs" rows={2} aria-label={label} data-field={label} value={draft}
              onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            />
          ) : (
            <input
              className="w-full text-xs" type={type} aria-label={label} data-field={label} value={draft}
              onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur(); }
              }}
            />
          )}
        </FloatingField>
      );
}
