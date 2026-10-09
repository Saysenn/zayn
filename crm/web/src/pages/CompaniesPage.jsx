import { useMemo, useState } from 'react';
// Filters survive leaving the page. See useStickyState.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { useNavigate } from 'react-router-dom';
import { useCompanies } from '../hooks/useCompanies';
import { usePeopleFilters } from '../hooks/usePeople';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { patchQueries, mapCachedRows, rollbackAll } from '../hooks/useBulkActions';
import { countOf } from '../helpers/pluralNoun';
import { apiService } from '../configs/api.config';
import { countFilters } from '../helpers/filters';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import Pagination from '../components/layout/Pagination';
import BulkBar, { BulkAction, BulkMenu } from '../components/layout/BulkBar';
import BulkAddDealsModal from '../components/modals/BulkAddDealsModal';
import SelectAll from '../components/forms/SelectAll';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import ViewToggle from '../components/layout/ViewToggle';
import RecordCard, { CardList } from '../components/display/RecordCard';
import MoneyTotals from '../components/display/MoneyTotals';
import { formatTotalsWhole } from '../helpers/formatMoney';
import Select from '../components/forms/Select';
import StatusBadge from '../components/badges/StatusBadge';
import { COMPANY_STATUS, COMPANY_STATUS_OPTIONS, isTerminalStatus } from '../configs/companyStatus';
import { CardSkeleton, TableSkeleton } from '../components/display/Skeleton';
import { BuildingIcon, SearchIcon, StarIcon, UserIcon } from '../components/icons';

const GRID_PAGE_SIZE = 16;
const ROW_PAGE_SIZE = 25;

// What a bulk write on companies changes: the lists, the open company, and
// the deals and people that read their company's tier and status.
const COMPANY_TOUCHES = [['companies'], ['company'], ['master-sheet'], ['people']];

// The bar only sets a status that keeps the deals running. Closed and
// dissolved stop every deal, which is one company at a time on purpose.
const BULK_STATUS_OPTIONS = COMPANY_STATUS_OPTIONS.filter((o) => !isTerminalStatus(o.value));

/**
 * The bar's tier/status write, put on every cached Companies page and on
 * each open company before the server answers. A status filter the row no
 * longer matches drops it. Returns the rollback.
 */
function patchCompanies(queryClient, keys, fields) {
  const want = new Set(keys.map(String));
  const lists = patchQueries(queryClient, [['companies']], (data, key) => mapCachedRows(data, (row) => {
    if (!want.has(String(row.ckey))) return row;
    if (fields.status && key[1]?.status && key[1].status !== fields.status) return null;
    return { ...row, ...fields };
  }));
  const detail = patchQueries(queryClient, [['company']], (data, key) => (
    want.has(String(key[1])) && data?.company ? { ...data, company: { ...data.company, ...fields } } : data
  ));
  return rollbackAll(lists, detail);
}

/**
 * Companies — the other side of the same act as People.
 *
 * Its job, in the user's words: "assigning and cleaning the datas, and
 * ensuring the exports can identify which companies pay this person and
 * how much". So exactly two things happen here:
 *
 *   ASSIGN   attach one or many handlers (each becomes a deal)
 *   CLEAN    rename, so spellings collapse into one company
 *
 * No merging. Rename does the job anyway — "Relia Pa" renamed to
 * "Relia PA" IS the merge, because the grouping key is the normalized
 * name and both spellings then land on one row.
 */

/**
 * ONE COMPANY, AS A CARD, at every width.
 *
 * This was a phone's copy of a table row. It is the list now: a company is
 * a small set of facts you scan for and open, not eleven columns you read
 * across, and the table was six columns of which two were one word each.
 *
 * THE TIER IS READ HERE, SET FROM THE BAR: tick the thirty companies and
 * Set tier once. It sits in `actions` beside the tick, the row that stops
 * a click reaching the card behind it.
 */
function CompanyCard({ company, onView, selected, onToggle }) {
  return (
    // The tint reaches the card itself, the same `.row-selected` look a
    // ticked table row has.
    <div className={`h-full ${selected ? '[&>div]:!bg-accent-tint' : ''}`}>
    <RecordCard
      interactive
      icon={BuildingIcon}
      title={company.name}
      subtitle={(company.groups || []).join(', ')}
      lead={<MoneyTotals totals={company.monthly_totals} label="Monthly, every currency" />}
      leadLabel="Monthly"
      onOpen={() => onView(company.ckey)}
      badges={(company.status !== COMPANY_STATUS.ACTIVE || company.missing_handler) ? (
        <>
          {company.status !== COMPANY_STATUS.ACTIVE && <StatusBadge status={company.status} />}
          {/* The old row's CellInfo, said plainly. A hover tooltip is not
              reachable on a phone, and there is room on a card for the
              sentence itself. */}
          {company.missing_handler && (
            <span className="badge badge-in_progress">
              {company.missing_handler_count}{' '}
              {company.missing_handler_count === 1 ? 'deal has' : 'deals have'} no handler
            </span>
          )}
        </>
      ) : null}
      facts={[
        { label: 'Handlers', value: company.handler_count },
        { label: 'Old group', value: company.old_group || '—' },
      ]}
      actions={
        <>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${company.name}`}
          />
          {/* The tier as text. Setting it is the bulk bar's Set tier. */}
          <span className="text-xs text-text-muted">
            Tier: {company.tier ? <span className="text-text">{company.tier}</span> : <span className="text-text-faint">—</span>}
          </span>
        </>
      }
    />
    </div>
  );
}

function CompanyRow({ company, onView, selected, onToggle }) {
  const open = () => onView(company.ckey);
  return (
    <tr
      className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-sunken ${selected ? 'row-selected' : ''}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      }}
      tabIndex={0}
      role="link"
      aria-label={`Open ${company.name}`}
    >
      <td className="td w-8" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${company.name}`} />
      </td>
      <td className="px-3 py-2.5 font-medium text-text">{company.name}</td>
      <td className="px-3 py-2.5 text-text-muted">{(company.groups || []).join(', ') || '—'}</td>
      {/* The column has room, so the table prints every currency. Only the
          card hides them behind an icon. */}
      <td className="px-3 py-2.5 text-right tabular-nums">{formatTotalsWhole(company.monthly_totals)}</td>
      <td className="px-3 py-2.5 text-text-muted">
        {/* ANY status that is not active, not just closed. There are four
            now, and printing liquidation or dissolved as "Active" is the
            column saying the opposite of the truth. */}
        {company.status === COMPANY_STATUS.ACTIVE
          ? 'Active'
          : <StatusBadge status={company.status} />}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{company.handler_count}</td>
      <td className="px-3 py-2.5 text-text-muted">{company.old_group || '—'}</td>
      {/* Plain text: Set tier on the bulk bar is how it changes. */}
      <td className="px-3 py-2.5 text-text-muted">{company.tier || <span className="text-text-faint">—</span>}</td>
    </tr>
  );
}

export default function CompaniesPage() {
  const [page, setPage] = useState(1);
  // ALWAYS OPENS AS THE LIST, his call 2026-09-30. The toggle still works;
  // it just is not remembered between visits.
  const [view, setView] = useState('rows');
  const forgetFilters = useClearSticky('companies.');
  const [search, setSearch] = useStickyState('companies.search', '');
  const [filters, setFilters] = useStickyState('companies.filters', {});
  const pageSize = view === 'grid' ? GRID_PAGE_SIZE : ROW_PAGE_SIZE;
  const changeView = (nextView) => {
    setView(nextView);
    setPage(1);
  };

  const navigate = useNavigate();
  const query = useDebouncedValue(search, 300);
  const { data: options } = usePeopleFilters();
  const { data: companies, total, tiers, oldGroups, isLoading, error } = useCompanies({
    ...filters, q: query || undefined, page, pageSize,
  });

  const visibleKeys = useMemo(() => (companies ?? []).map((c) => c.ckey), [companies]);
  const sel = useRowSelection(visibleKeys);
  const [addingHandler, setAddingHandler] = useState(false);
  const { run } = useBulkActions();
  // On screen at once: every cached Companies page shows the new tier or
  // status the moment it is picked. A status filter that no longer holds
  // the row drops it. The bar is cleared without waiting.
  const bulkSet = (fields, verb) => {
    const keys = sel.ids;
    run({
      call: () => apiService.companies.bulk(keys, fields),
      optimistic: (qc) => patchCompanies(qc, keys, fields),
      invalidates: COMPANY_TOUCHES,
      toast: { message: `${countOf(keys.length, 'company')} ${verb}` },
      report: (data) => {
        const n = data?.updated?.length ?? 0;
        return { message: n ? `${countOf(n, 'company')} ${verb}` : `No companies ${verb}` };
      },
      failure: `Couldn't update ${countOf(keys.length, 'company')}`,
    });
    sel.clear();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Companies"
        subtitle={`${total} ${total === 1 ? 'company' : 'companies'}`}
        actions={<ViewToggle value={view} onChange={changeView} />}
        /* ADD COMPANY IS HIDDEN, not deleted. `AddCompanyWizard` is
           still in components/ and still works.

           A company is not a row of its own: it exists because deals name
           it, so creating one always meant creating a deal underneath. Add
           deal on the Master Sheet page does that in one act, and two
           doors onto it had already drifted into different rules for the
           same fields. See docs/backlog.md. */
      />

      <Toolbar
        search={
          <SearchInput
            icon={SearchIcon}
            placeholder="Search companies…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        }
        filtersActive={Boolean(filters.group || filters.oldGroup || filters.status)}
        filtersCount={countFilters(filters)}
        storageKey="companies.panel"
        onClearFilters={() => { setFilters({}); setSearch(''); setPage(1); forgetFilters(); }}
        filters={
          <>
            {/* THE COMPANY STATUS, Active among them. "Active only" was a
                switch beside the search, and beside the bulk bar a switch
                read as an action on the ticked rows; it lives here now. */}
            <Select
              size="sm"
              className="w-48"
              value={filters.status ?? ''}
              onChange={(v) => { setFilters((f) => ({ ...f, status: v || undefined })); setPage(1); }}
              options={COMPANY_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              placeholder="Any status"
            />
            <Select
              size="sm"
              className="w-44"
              value={filters.group ?? ''}
              onChange={(v) => { setFilters((f) => ({ ...f, group: v || undefined })); setPage(1); }}
              options={options?.groups ?? []}
              placeholder="All groups"
            />
            {/* HIS OWN EARLIER NAME FOR THE GROUP, off the sheet's Old group
                column. Never one of ours: the values are Milky, Wallaby 1,
                V3. Only shown once some company carries one, so a CRM that
                has never seen the column gets no empty control. */}
            {(oldGroups ?? []).length > 0 && (
              <Select
                size="sm"
                className="w-44"
                value={filters.oldGroup ?? ''}
                onChange={(v) => { setFilters((f) => ({ ...f, oldGroup: v || undefined })); setPage(1); }}
                options={oldGroups.map((g) => ({ value: g, label: g }))}
                placeholder="Any old group"
              />
            )}
          </>
        }
      />

      <ErrorState error={error} title="Couldn't load companies" />

      {/* A GRID OF CARDS, at every width. `columns` is what makes CardList
          the list itself rather than a phone's version of a table, so this
          is one view to maintain instead of a row component and a card
          component that had already drifted over the tier. */}
      {view === 'grid' && (
      <CardList columns>
        {isLoading && Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}
        {!isLoading && companies?.map((c) => (
          <CompanyCard
            key={c.ckey}
            company={c}
            onView={(k) => navigate(`/companies/${encodeURIComponent(k)}`)}
            selected={sel.has(c.ckey)}
            onToggle={() => sel.toggle(c.ckey)}
          />
        ))}
      </CardList>
      )}

      {view === 'rows' && (
        <div className="table-wrap">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr>
                <th className="th w-8"><SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} /></th>
                <th className="th">Name</th>
                <th className="th">Groups</th>
                <th className="th text-right">Monthly</th>
                <th className="th">Company status</th>
                <th className="th text-right">Handlers</th>
                <th className="th">Old group</th>
                <th className="th">Tier</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={8} />}
              {!isLoading && companies?.length === 0 && (
                <EmptyState asRow colSpan={8} icon={BuildingIcon} title="No companies match" hint="Try another search or clear the filters." />
              )}
              {!isLoading && companies?.map((company) => (
                <CompanyRow
                  key={company.ckey}
                  company={company}
                  onView={(companyKey) => navigate(`/companies/${encodeURIComponent(companyKey)}`)}
                  selected={sel.has(company.ckey)}
                  onToggle={() => sel.toggle(company.ckey)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'grid' && !isLoading && companies?.length === 0 && (
        <EmptyState icon={BuildingIcon} title="No companies match" hint="Try another search or clear the filters." />
      )}

      {!isLoading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={UserIcon} onClick={() => setAddingHandler(true)}>
          Add handlers
        </BulkAction>
        <BulkMenu
          icon={StarIcon}
          label="Set tier"
          options={[
            ...(tiers ?? []).map((t) => ({ label: t, onSelect: () => bulkSet({ tier: t }, `set to ${t}`) })),
            { label: 'No tier', onSelect: () => bulkSet({ tier: '' }, 'cleared of a tier') },
          ]}
        />
        <BulkMenu
          icon={BuildingIcon}
          label="Set status"
          hint="Closed and dissolved are set one company at a time"
          options={BULK_STATUS_OPTIONS.map((o) => ({
            label: o.label,
            onSelect: () => bulkSet({ status: o.value }, `set to ${o.label.toLowerCase()}`),
          }))}
        />
      </BulkBar>

      {addingHandler && (
        <BulkAddDealsModal
          direction="toPerson"
          subjects={(companies ?? [])
            .filter((c) => sel.has(c.ckey))
            .map((c) => ({ id: c.ckey, name: c.name, group: c.groups?.[0] }))}
          onClose={() => setAddingHandler(false)}
          onDone={sel.clear}
        />
      )}
    </div>
  );
}
