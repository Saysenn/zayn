import { useMemo, useState } from 'react';
// Filters survive leaving the page. See useStickyState.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { useStickyColumns } from '../hooks/useStickyColumns';
import { useNavigate } from 'react-router-dom';
import PeopleExportModal from '../components/export/PeopleExportModal';
import { usePeople, usePeopleFilters } from '../hooks/usePeople';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import Button from '../components/buttons/Button';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import BulkAddDealsModal from '../components/modals/BulkAddDealsModal';
import Select from '../components/forms/Select';
import Pagination from '../components/layout/Pagination';
import ViewToggle from '../components/layout/ViewToggle';
import { CardSkeleton, TableSkeleton } from '../components/display/Skeleton';
import ReviewFlag from '../components/badges/ReviewFlag';
import RecordCard, { CardList } from '../components/display/RecordCard';
import MoneyTotals from '../components/display/MoneyTotals';
import { formatTotalsWhole } from '../helpers/formatMoney';
import CellInfo from '../components/display/CellInfo';
import { popup } from '../configs/popups.config';
import { BuildingIcon, SearchIcon, DownloadIcon, UsersIcon, StopHandIcon, EditIcon } from '../components/icons';
import { countFilters } from '../helpers/filters';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import SelectAll from '../components/forms/SelectAll';
import BulkBar, { BulkAction, BulkMenu } from '../components/layout/BulkBar';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import BulkFieldModal from '../components/modals/BulkFieldModal';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { DEAL_TOUCHES, bulkMessage, patchQueries, mapCachedRows, rollbackAll } from '../hooks/useBulkActions';
import { countOf } from '../helpers/pluralNoun';
import { apiService } from '../configs/api.config';

const GRID_PAGE_SIZE = 16;
const ROW_PAGE_SIZE = 25;

/**
 * People — the CRM's operations page.
 *
 * ONE ROW PER HUMAN, 67 of them where the master sheet has 96 deals. That
 * is the entire difference between this page and the Master Sheet page:
 * same table underneath, grouped differently. The detail page behind each
 * row is where the substance lives, so this list stays deliberately thin.
 *
 * The rows are never merged. A person holding seven deals across seven
 * companies is the data working correctly, and all seven are visible on
 * their detail page — this page just doesn't repeat their name seven
 * times to say so.
 */

// HIDDEN, NOT DELETED. The modal, its hook and the print route are all
// untouched; this is the one switch, so it comes back by flipping it.
const SHOW_EXPORT = false;

// Money is summed per currency and NEVER blended. The roster is paid in
// GBP, AED and EURO; one added-up number across the three would be a number
// that means nothing. This page and Companies each had their own copy of
// the formatting, identical, and `formatMoney` held a third spelling of it.
// See totalsList.

// The API validates the method against this closed set.
const PAYMENT_METHODS = ['cash', 'bank', 'crypto'];

/**
 * THE BAR WORKS ON DEALS, the list shows people. A person row is a sum of
 * deals, so "stop these people" means "stop every live deal they hold",
 * and only the person's own record knows which deals those are. One read
 * per ticked person, then one bulk write: a page is at most 25 people.
 */
async function liveDealIdsOf(personIds) {
  const answers = await Promise.all(personIds.map((id) => apiService.people.get(id)));
  return answers.flatMap((a) => (a?.person?.deals ?? []).filter((d) => !d.stopped_on).map((d) => d.id));
}

// Snake-case deal column for each Edit field the bar offers.
const DEAL_COLUMN = { groupName: 'group_name', location: 'location', paymentMethod: 'payment_method' };

/**
 * ON SCREEN BEFORE THE SERVER ANSWERS. The People list and every cached
 * person page are patched the moment Stop or Edit is confirmed; the ids of
 * the deals behind them are only fetched afterwards, in the background.
 * Returns the rollback.
 *
 * `onRow(row, key)` → patched person row, or null to drop it from that list.
 * `onDeal(deal)` → patched deal on a cached person page (live deals only).
 */
function patchPeople(queryClient, personIds, onRow, onDeal) {
  const want = new Set(personIds.map(String));
  const list = patchQueries(queryClient, [['people']], (data, key) => mapCachedRows(data, (row) => (
    want.has(String(row.person_id)) ? onRow(row, key) : row
  )));
  const detail = patchQueries(queryClient, [['person']], (data, key) => {
    if (!want.has(String(key[1])) || !data?.person?.deals) return data;
    return { ...data, person: { ...data.person, deals: data.person.deals.map((d) => (d.stopped_on ? d : onDeal(d))) } };
  });
  return rollbackAll(list, detail);
}

// "Indigo, Milkman" up to two, then "+2" — a person on five groups would
// otherwise push every other column off the row.
function summarizeList(items, max = 2) {
  const list = items || [];
  if (list.length === 0) return '—';
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} +${list.length - max}`;
}


/**
 * The whole row opens the person. No chevron on the right — that arrow
 * reads as a breadcrumb separator or a disclosure toggle, and it was
 * neither; the row itself is the affordance, which is what a table of
 * links should be.
 *
 * Still a real keyboard target: tabbable, and Enter opens it, so this
 * doesn't become a mouse-only page.
 */
function PersonRow({ person, onOpen, selected, onSelect }) {
  return (
    <tr
      className={`border-b border-border last:border-0 hover:bg-surface-sunken cursor-pointer ${selected ? 'row-selected' : ''}`}
      onClick={() => onOpen(person.person_id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(person.person_id);
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`Open ${person.display_name}`}
    >
      <td className="td sticky-col w-8" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${person.display_name}`} />
      </td>
      <td className="td sticky-col sticky-edge">
        <span className="font-medium text-text">{person.display_name}</span>
        {/* HER DIFFERENCE IS HERS (his call 2026-10-07): "Gloria difference"
            is listed under Gloria, and says so in small print. */}
        {person.includes?.length > 0 && (
          <span className="block text-[11px] text-text-muted">incl. {person.includes.join(', ')}</span>
        )}
        {/* An icon, not a "REVIEW" chip. A chip is a word with no
            explanation behind it, and it changes the column's width row by
            row, which is the same thing that pushed the master sheet's
            switches out of line. This says WHY on hover and on click, the
            one way extra information goes in a cell here. See CellInfo. */}
        {/* "One or more of their companies was removed." Separate from the
            import flag beside it: this one is a deal waiting to be pointed
            at a new company, not a value to correct, and it is the only
            place a deletion made elsewhere becomes visible from the
            person's side. */}
        {person.missing_company && (
          <span className="ml-1.5 align-middle">
            <CellInfo {...popup.orphanCompany(person.missing_company_count)} />
          </span>
        )}
        {person.needs_review && (
          <span className="ml-1.5 align-middle">
            <ReviewFlag
              reason={
                person.review_reasons?.length
                  ? person.review_reasons.join('; ')
                  : 'One of this person’s rows came in messy. Open them to see which.'
              }
            />
          </span>
        )}
      </td>
      <td className="td text-text-muted">{summarizeList(person.roles)}</td>
      <td className="td text-text-muted">{summarizeList(person.groups)}</td>
      {/* DEALS, so it counts deals. `active_count` / `deal_count`, not the
          company counts beside them: a company in a group is one company
          however many roles a person holds on it, and this column no
          longer claims to be about companies.

          One column, not two. "COMPANIES 1" beside "ACTIVE 0/1" made the
          reader work out that the 1 and the 1 were the same thing and the
          0 was something else. This says it outright. */}
      <td className="td text-right tabular-nums text-text-muted">
        {person.active_count === person.deal_count
          ? person.deal_count
          : `${person.active_count} of ${person.deal_count}`}
      </td>
      {/* NO Pay COLUMN. `pay_status` was exactly `active_count > 0`, so the
          badge restated the number immediately to its left. */}
      {/* The column has room, so the table prints every currency. Only the
          card hides them behind an icon. */}
      <td className="td text-right tabular-nums">{formatTotalsWhole(person.monthly_totals)}</td>
    </tr>
  );
}

/**
 * The same person as a card, for phones.
 *
 * The question a phone gets asked about a person is "what do they earn and
 * are they flagged", so those two lead. Roles and groups are the facts you
 * check second, and the company count is what tells you whether the number
 * covers one arrangement or six.
 */
function PersonCard({ person, onOpen, selected, onSelect }) {
  return (
    <RecordCard
      interactive
      selected={selected}
      onSelect={onSelect}
      selectLabel={`Select ${person.display_name}`}
      icon={UsersIcon}
      title={person.display_name}
      subtitle={person.includes?.length ? `${summarizeList(person.roles)} · incl. ${person.includes.join(', ')}` : summarizeList(person.roles)}
      lead={<MoneyTotals totals={person.monthly_totals} label="A month, every currency" />}
      leadLabel="a month"
      onOpen={() => onOpen(person.person_id)}
      badges={
        <>
          {/* No pay badge, for the same reason the column went: the Deals
              fact below already says "0 of 2 active". */}
          {person.missing_company && (
            <span className="badge badge-in_progress">Company removed</span>
          )}
          {person.needs_review && <span className="badge badge-in_progress">Needs a check</span>}
        </>
      }
      facts={[
        { label: 'Groups', value: summarizeList(person.groups) },
        {
          // The same fact as the table's column, so the phone and the
          // desktop cannot say different things about one person.
          label: 'Deals',
          value: person.active_count === person.deal_count
            ? person.deal_count
            : `${person.active_count} of ${person.deal_count} active`,
        },
      ]}
    />
  );
}

export default function PeoplePage() {
  const [page, setPage] = useState(1);
  // ALWAYS OPENS AS THE LIST, his call 2026-09-30. See CompaniesPage.
  const [view, setView] = useState('rows');
  const forgetFilters = useClearSticky('people.');
  const [search, setSearch] = useStickyState('people.search', '');
  const [filters, setFilters] = useStickyState('people.filters', {});
  const [showExport, setShowExport] = useState(false);

  const navigate = useNavigate();
  const query = useDebouncedValue(search, 300);
  const pageSize = view === 'grid' ? GRID_PAGE_SIZE : ROW_PAGE_SIZE;
  // Freezes the name column, so scrolling right to reach Monthly does not
  // take the name with it. Re-measures whenever the rows change. Declared
  // after `query`, not beside the other state: reading it above its own
  // const is a temporal-dead-zone crash, not a lint warning.
  // Two: the tick and the name travel together.
  const tableRef = useStickyColumns(2, [page, filters, query]);
  const openPerson = (personId) => navigate(`/people/${encodeURIComponent(personId)}`);
  const { data: filterOptions } = usePeopleFilters();

  // Every filter is a server-side param. Client-side .filter() would only
  // ever see the 25 rows this page happened to load, which is silently
  // wrong the moment there is more than one page.
  const params = useMemo(
    () => ({ ...filters, q: query || undefined, page, pageSize }),
    [pageSize, page, filters, query],
  );
  const { data: people, total, isLoading, error, refetch } = usePeople(params);

  // The bulk bar. Ticks are cut back to what is on screen, so a page turn
  // or a filter can never leave someone ticked you cannot see.
  const sel = useRowSelection((people ?? []).map((p) => p.person_id));
  const [addingTo, setAddingTo] = useState(false);
  const { run } = useBulkActions();
  const [confirmStop, setConfirmStop] = useState(false);
  // The deal field the Edit menu picked, while its value modal is open.
  const [editField, setEditField] = useState(null);

  // Neither waits. The bar is cleared and the rows change on the click;
  // the deal ids are fetched and written behind it. See patchPeople.
  function stopAll() {
    const ids = sel.ids;
    const today = new Date().toISOString().slice(0, 10);
    run({
      call: async () => {
        const dealIds = await liveDealIdsOf(ids);
        return dealIds.length ? apiService.masterSheet.bulkStop(dealIds) : { stopped: [], skipped: 0, batchId: null };
      },
      optimistic: (qc) => patchPeople(
        qc, ids,
        // "Active only" no longer holds them; elsewhere they stay, at zero.
        (row, key) => (key[1]?.status === 'active' ? null : { ...row, active_count: 0, monthly_totals: {} }),
        (d) => ({ ...d, stopped_on: today }),
      ),
      invalidates: DEAL_TOUCHES,
      toast: { message: `Every live deal of ${countOf(ids.length, 'person')} stopped` },
      report: (data) => bulkMessage('stopped', data.stopped.length, 'deal', [[data.skipped, 'already stopped']]),
      undoBatch: (data) => data.batchId,
      failure: `Couldn't stop the deals of ${countOf(ids.length, 'person')}`,
      icon: 'stop',
    });
    sel.clear();
    setConfirmStop(false);
  }

  function editAll(value) {
    const ids = sel.ids;
    const field = editField;
    const column = DEAL_COLUMN[field.key];
    run({
      call: async () => {
        const dealIds = await liveDealIdsOf(ids);
        return dealIds.length
          ? apiService.masterSheet.bulkUpdate(dealIds, { [field.key]: value })
          : { updated: [], skipped: {}, batchId: null };
      },
      optimistic: (qc) => patchPeople(
        qc, ids,
        // Only Group shows on the row; the rest live on the deals.
        (row) => (field.key === 'groupName' ? { ...row, groups: [value] } : row),
        (d) => ({ ...d, [column]: value }),
      ),
      invalidates: DEAL_TOUCHES,
      toast: { message: `${field.label} set to ${value} for ${countOf(ids.length, 'person')}` },
      report: (data) => bulkMessage(`set to ${value}`, data.updated.length, 'deal', [
        [data.skipped?.same ?? 0, 'already set'], [data.skipped?.gone ?? 0, 'gone'],
      ]),
      undoBatch: (data) => data.batchId,
      failure: `Couldn't change ${field.label.toLowerCase()} for ${countOf(ids.length, 'person')}`,
    });
    sel.clear();
    setEditField(null);
  }

  const editFields = [
    { key: 'groupName', label: 'Group', options: filterOptions?.groups ?? [], allowCustom: true },
    { key: 'location', label: 'Location', options: filterOptions?.locations ?? [], allowCustom: true },
    { key: 'paymentMethod', label: 'Payment method', options: PAYMENT_METHODS, allowCustom: false },
  ];

  function setFilter(key, value) {
    setFilters((f) => {
      const next = { ...f };
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(1);
  }

  const filterActive = Object.keys(filters).length > 0;
  // One wording for both views, so the grid and the table cannot disagree.
  const empty = filterActive || query
    ? { title: 'No people match those filters', hint: 'Clear a filter or the search to see more.' }
    : { title: 'No people yet', hint: 'Import a master sheet to get started.' };
  // Only the dropdown filters decide whether the panel springs open. A
  // ticked checkbox is already visible, so opening the panel for it would
  // reveal controls nobody asked about.
  const panelActive = ['role', 'group', 'company', 'method', 'currency', 'status', 'needsReview'].some((k) => filters[k]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="People"
        subtitle={`${total} ${total === 1 ? 'person' : 'people'}`}
        actions={
          <>
            <ViewToggle
              value={view}
              onChange={(nextView) => { setView(nextView); setPage(1); }}
            />
            {/* ADD PERSON IS HIDDEN, not deleted. `AddPersonWizard` is
                still in components/ and still works.

                A person does not exist on their own: they exist because a
                row names them, so "add a person" was always really "add a
                deal that happens to be their first". Two doors onto one
                act is the thing this CRM keeps having to undo, and the two
                had drifted into different rules for the same fields.
                Add deal on the Master Sheet page is the one door. See
                docs/backlog.md for what it would take to bring this back.

                Upload is also not here: it lives on Settings and the
                Master Sheet page, and three doors was two too many. */}
            {/* EXPORT IS HIDDEN, not deleted. `PeopleExportModal` is still
                in components/ and still wired: the button below is all that
                went, so putting it back is one line.

                It was seeded from this page's filters, which is the only
                reason it lived here rather than in the app header. That
                still holds if it comes back. */}
            {SHOW_EXPORT && (
              <Button variant="primary" onClick={() => setShowExport(true)}>
                <DownloadIcon width={15} height={15} />
                Export
              </Button>
            )}
          </>
        }
      />


      <Toolbar
        search={
          <SearchInput
            icon={SearchIcon}
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        }
        filtersActive={panelActive}
        filtersCount={countFilters(filters)}
        storageKey="people.panel"
        onClearFilters={() => { setFilters({}); setSearch(''); setPage(1); forgetFilters(); }}
        filters={
          <>
            {/* Every option comes from the uploaded document. A role the
                boss invents next month shows up here on its own. */}
            {/* ACTIVE AND FLAGGED, IN THE PANEL. Two switches beside the search
                read as actions on the ticked rows once the bulk bar arrived. */}
            <Select size="sm" className="w-40"
              value={filters.status ?? ''} onChange={(v) => setFilter('status', v || undefined)}
              options={[{ value: 'active', label: 'Active only' }]} placeholder="Active or not" />
            <Select size="sm" className="w-40"
              value={filters.needsReview ?? ''} onChange={(v) => setFilter('needsReview', v || undefined)}
              options={[{ value: 'true', label: 'Flagged only' }]} placeholder="Flagged or not" />
            <Select size="sm" className="w-44" searchable={filterOptions?.roles?.length > 12}
              value={filters.role ?? ''} onChange={(v) => setFilter('role', v)}
              options={filterOptions?.roles ?? []} placeholder="All roles" />
            <Select size="sm" className="w-44"
              value={filters.group ?? ''} onChange={(v) => setFilter('group', v)}
              options={filterOptions?.groups ?? []} placeholder="All" />
            <Select size="sm" className="w-44" searchable
              value={filters.company ?? ''} onChange={(v) => setFilter('company', v)}
              options={filterOptions?.companies ?? []} placeholder="All companies" />
            <Select size="sm" className="w-44"
              value={filters.method ?? ''} onChange={(v) => setFilter('method', v)}
              options={filterOptions?.methods ?? []} placeholder="All payment methods" />
            <Select size="sm" className="w-44"
              value={filters.currency ?? ''} onChange={(v) => setFilter('currency', v)}
              options={filterOptions?.currencies ?? []} placeholder="All currencies" />
          </>
        }
      />

      <ErrorState error={error} title="Couldn't load people" onRetry={refetch} />

      {/* CARDS ON A PHONE, the table from md up. Not a narrower table:
          five columns at 375px is unreadable however they are trimmed. */}
      {view === 'grid' && !isLoading && people?.length === 0 && <EmptyState icon={UsersIcon} {...empty} />}
      {view === 'grid' && (isLoading || people?.length > 0) && (
      <CardList columns>
        {isLoading && Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}
        {!isLoading && people?.map((p) => (
          <PersonCard
            key={p.person_id} person={p} onOpen={openPerson}
            selected={sel.has(p.person_id)} onSelect={() => sel.toggle(p.person_id)}
          />
        ))}
      </CardList>
      )}

      {view === 'rows' && (
      <div className="table-wrap">
        <table ref={tableRef} className="w-full min-w-[760px] text-sm">
          <thead>
            <tr>
              <th className="th sticky-col w-8">
                <SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} />
              </th>
              <th className="th sticky-col sticky-edge">Name</th>
              <th className="th">Roles</th>
              <th className="th">Groups</th>
              <th className="th text-right">Active deals</th>
              <th className="th text-right">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={8} columns={6} />}
            {!isLoading && people?.length === 0 && (
              <EmptyState asRow colSpan={6} icon={UsersIcon} {...empty} />
            )}
            {!isLoading && people?.map((p) => (
              <PersonRow
                key={p.person_id} person={p} onOpen={openPerson}
                selected={sel.has(p.person_id)} onSelect={() => sel.toggle(p.person_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      {/* `filters`, not `params` — params also carries page and pageSize,
          which are about this table's paging and have no business being
          counted as filters or sent to the export API. */}
      {showExport && (
        <PeopleExportModal
          filters={{ ...filters, q: query || undefined }}
          onClose={() => setShowExport(false)}
        />
      )}

      {confirmStop && (
        <ConfirmDialog
          title={`Stop every live deal of ${sel.count} ${sel.count === 1 ? 'person' : 'people'}?`}
          detail={[
            'Each of their live deals moves to the Archive, out of the master sheet and out of every month from today onward.',
            'Months already paid are untouched. Undo, or Resume on the Archive, puts them back.',
          ]}
          confirmLabel="Stop all deals"
          confirmVariant="danger"
          icon={<StopHandIcon width={15} height={15} />}
          onCancel={() => setConfirmStop(false)}
          onConfirm={stopAll}
        />
      )}
      {editField && (
        <BulkFieldModal
          title={`Set ${editField.label.toLowerCase()} on every live deal`}
          label={editField.label}
          options={editField.options}
          allowCustom={editField.allowCustom}
          onApply={editAll}
          onClose={() => setEditField(null)}
        />
      )}

      {/* No Export here: the page's own export is switched off
          (SHOW_EXPORT), and it exports by filter, not by tick. */}
      <BulkBar count={sel.count} noun="person" onClear={sel.clear}>
        <BulkAction icon={StopHandIcon} variant="danger" onClick={() => setConfirmStop(true)}>
          Stop all deals
        </BulkAction>
        <BulkAction icon={BuildingIcon} onClick={() => setAddingTo(true)}>
          Add companies
        </BulkAction>
        <BulkMenu
          icon={EditIcon}
          label="Edit"
          hint="Sets it on every live deal they hold"
          options={editFields.map((f) => ({ label: f.label, onSelect: () => setEditField(f) }))}
        />
      </BulkBar>

      {addingTo && (
        <BulkAddDealsModal
          direction="toCompany"
          subjects={(people ?? [])
            .filter((p) => sel.has(p.person_id))
            .map((p) => ({ id: p.person_id, name: p.display_name, group: p.groups?.[0] }))}
          onClose={() => setAddingTo(false)}
          onDone={sel.clear}
        />
      )}
    </div>
  );
}
