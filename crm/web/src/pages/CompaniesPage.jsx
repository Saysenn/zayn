import { useState } from 'react';
// Filters survive leaving the page. See useStickyState.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { useNavigate } from 'react-router-dom';
import { useCompanies, useCompanyCellEdit } from '../hooks/useCompanies';
import { usePeopleFilters } from '../hooks/usePeople';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { countFilters } from '../helpers/filters';
import Button from '../components/buttons/Button';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import Pagination from '../components/layout/Pagination';
import ViewToggle from '../components/layout/ViewToggle';
import RecordCard, { CardList } from '../components/display/RecordCard';
import MoneyTotals from '../components/display/MoneyTotals';
import { formatTotalsWhole } from '../helpers/formatMoney';
import ManageCompanyModal from '../components/modals/ManageCompanyModal';
import Select from '../components/forms/Select';
import FilterCheckbox from '../components/filters/FilterCheckbox';
import StatusBadge from '../components/badges/StatusBadge';
import { COMPANY_STATUS, COMPANY_STATUS_OPTIONS } from '../configs/companyStatus';
import { CardSkeleton, TableSkeleton } from '../components/display/Skeleton';
import { BuildingIcon, SearchIcon, UsersIcon } from '../components/icons';

const GRID_PAGE_SIZE = 16;
const ROW_PAGE_SIZE = 25;

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
 * THE TIER STAYS EDITABLE IN PLACE, which is the whole reason that column
 * exists: setting it on thirty companies is exactly the pass a dialog per
 * row makes unbearable. It sits in `actions` rather than among the facts
 * because that row already stops a click reaching the card behind it, and
 * without that every attempt to open the dropdown would open the company.
 */
function CompanyCard({ company, tiers, onSaveTier, onOpen, onView }) {
  return (
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
          <Select
            label="Tier"
            size="detail"
            className="min-w-0 flex-1"
            options={['', ...(tiers ?? [])]}
            value={company.tier ?? ''}
            placeholder="Set tier"
            hint="What kind of company this is. Shown on each group's tab in the export."
            onChange={(v) => onSaveTier(company, v ?? '')}
          />
          {/* GREEN. It is the card's one action, and `quiet` is transparent
              with muted ink: on a card that is already a click target it
              read as a caption rather than a button. */}
          <Button variant="primary" size="sm" className="ml-auto" onClick={() => onOpen(company)}>
            <UsersIcon width={14} height={14} />
            Manage
          </Button>
        </>
      }
    />
  );
}

function CompanyRow({ company, tiers, onSaveTier, onOpen, onView }) {
  const open = () => onView(company.ckey);
  return (
    <tr
      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-sunken"
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
      <td className="w-44 px-3 py-2" onClick={(event) => event.stopPropagation()}>
        <Select
          size="sm"
          className="w-40"
          options={['', ...(tiers ?? [])]}
          value={company.tier ?? ''}
          placeholder="Set tier"
          onChange={(value) => onSaveTier(company, value ?? '')}
        />
      </td>
      <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
        {/* The same action as the card's, so it wears the same colour.
            One button reading two ways depending on the view toggle is
            worse than either choice. */}
        <Button variant="primary" onClick={() => onOpen(company)}>
          <UsersIcon width={14} height={14} />
          Manage
        </Button>
      </td>
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
  const [open, setOpen] = useState(null);
  const pageSize = view === 'grid' ? GRID_PAGE_SIZE : ROW_PAGE_SIZE;
  const changeView = (nextView) => {
    setView(nextView);
    setPage(1);
  };

  const navigate = useNavigate();
  const query = useDebouncedValue(search, 300);
  const { data: options } = usePeopleFilters();
  const cellEdit = useCompanyCellEdit();
  // The toast names the company and the field, the same as every other
  // inline edit: "Relia PA's tier updated". With optimism the value has
  // already moved on screen, so a bare "Saved" would leave you hunting for
  // which row it meant if it were rolled back.
  const saveTier = (company, tier) => cellEdit.mutate({
    key: company.ckey, fields: { tier }, name: company.name, label: 'tier',
  });

  const { data: companies, total, tiers, oldGroups, isLoading, error } = useCompanies({
    ...filters, q: query || undefined, page, pageSize,
  });

  const filterActive = Object.keys(filters).length > 0;

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
        inline={
          <FilterCheckbox
            label="Active only"
            value={filters.status === 'active' ? 'true' : undefined}
            onChange={(v) => { setFilters((f) => ({ ...f, status: v ? 'active' : undefined })); setPage(1); }}
          />
        }
        filtersActive={Boolean(filters.group || filters.oldGroup || filters.status)}
        filtersCount={countFilters(filters)}
        storageKey="companies.panel"
        onClearFilters={() => { setFilters({}); setSearch(''); setPage(1); forgetFilters(); }}
        filters={
          <>
            {/* FOUR NOW, so "Active only" beside the search cannot answer
                "which are winding down". That checkbox stays: it is the
                common case, and it writes the same one field this does. */}
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
              placeholder="All"
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

      {error && <p className="bg-danger-tint px-4 py-2.5 text-sm text-danger">{error.message}</p>}

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
            tiers={tiers}
            onSaveTier={saveTier}
            onOpen={setOpen}
            onView={(k) => navigate(`/companies/${encodeURIComponent(k)}`)}
          />
        ))}
      </CardList>
      )}

      {view === 'rows' && (
        <div className="table-wrap">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Groups</th>
                <th className="th text-right">Monthly</th>
                <th className="th">Company Status</th>
                <th className="th text-right">Handlers</th>
                <th className="th">Old group</th>
                <th className="th">Tier</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={8} />}
              {!isLoading && companies?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-text-muted">No companies match.</td>
                </tr>
              )}
              {!isLoading && companies?.map((company) => (
                <CompanyRow
                  key={company.ckey}
                  company={company}
                  tiers={tiers}
                  onSaveTier={saveTier}
                  onOpen={setOpen}
                  onView={(companyKey) => navigate(`/companies/${encodeURIComponent(companyKey)}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'grid' && !isLoading && companies?.length === 0 && (
        <p className="border border-dashed border-border px-3 py-10 text-center text-sm text-text-muted">
          No companies match.
        </p>
      )}

      {!isLoading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      {open && <ManageCompanyModal companyKey={open.ckey} onClose={() => setOpen(null)} />}
    </div>
  );
}
