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
import Select from '../components/forms/Select';
import FilterCheckbox from '../components/filters/FilterCheckbox';
import Pagination from '../components/layout/Pagination';
import ViewToggle from '../components/layout/ViewToggle';
import { CardSkeleton, TableSkeleton } from '../components/display/Skeleton';
import ReviewFlag from '../components/badges/ReviewFlag';
import RecordCard, { CardList } from '../components/display/RecordCard';
import MoneyTotals from '../components/display/MoneyTotals';
import { formatTotalsWhole } from '../helpers/formatMoney';
import CellInfo from '../components/display/CellInfo';
import { popup } from '../configs/popups.config';
import ManagePersonModal from '../components/modals/ManagePersonModal';
import { SearchIcon, DownloadIcon, UsersIcon, BuildingIcon } from '../components/icons';
import { countFilters } from '../helpers/filters';

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
function PersonRow({ person, onOpen, onManage }) {
  return (
    <tr
      className="border-b border-border last:border-0 hover:bg-surface-sunken cursor-pointer"
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
      <td className="px-3 py-2.5 sticky-col sticky-edge">
        <span className="font-medium text-text">{person.display_name}</span>
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
      <td className="px-3 py-2.5 text-text-muted">{summarizeList(person.roles)}</td>
      <td className="px-3 py-2.5 text-text-muted">{summarizeList(person.groups)}</td>
      {/* DEALS, so it counts deals. `active_count` / `deal_count`, not the
          company counts beside them: a company in a group is one company
          however many roles a person holds on it, and this column no
          longer claims to be about companies.

          One column, not two. "COMPANIES 1" beside "ACTIVE 0/1" made the
          reader work out that the 1 and the 1 were the same thing and the
          0 was something else. This says it outright. */}
      <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">
        {person.active_count === person.deal_count
          ? person.deal_count
          : `${person.active_count} of ${person.deal_count}`}
      </td>
      {/* NO Pay COLUMN. `pay_status` was exactly `active_count > 0`, so the
          badge restated the number immediately to its left. */}
      {/* The column has room, so the table prints every currency. Only the
          card hides them behind an icon. */}
      <td className="px-3 py-2.5 text-right tabular-nums">{formatTotalsWhole(person.monthly_totals)}</td>
      {/* Companies, roles and groups without leaving the list. Opening
          the person first, changing one company and coming back is three
          navigations for one edit, and this list is where an admin
          notices the problem. stopPropagation because the row itself is
          a link to the person. */}
      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        {/* The same action as the card's, so it wears the same colour.
            One button reading two ways depending on the view toggle is
            worse than either choice. */}
        <Button variant="primary" onClick={() => onManage(person.person_id)}>
          <BuildingIcon width={15} height={15} />
          Manage
        </Button>
      </td>
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
function PersonCard({ person, onOpen, onManage }) {
  return (
    <RecordCard
      interactive
      icon={UsersIcon}
      title={person.display_name}
      subtitle={summarizeList(person.roles)}
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
      actions={
        // GREEN. It is the card's one action, and `quiet` is transparent
        // with muted ink: on a card that is already a click target it read
        // as a caption rather than a button.
        // MANAGE, AND A BUILDING. It opens ManagePersonModal, and on screen
        // a person has COMPANIES: "Assign" is also the dead word from the
        // dropped assignments table. The company card's Manage carries
        // UsersIcon because a company has HANDLERS, so the two say which
        // way round they are rather than being one icon twice.
        <Button variant="primary" onClick={() => onManage(person.person_id)}>
          <BuildingIcon width={15} height={15} />
          Manage
        </Button>
      }
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
  // A person_id, when the Assign modal is open on that row.
  const [managing, setManaging] = useState(null);

  const navigate = useNavigate();
  const query = useDebouncedValue(search, 300);
  const pageSize = view === 'grid' ? GRID_PAGE_SIZE : ROW_PAGE_SIZE;
  // Freezes the name column, so scrolling right to reach Monthly does not
  // take the name with it. Re-measures whenever the rows change. Declared
  // after `query`, not beside the other state: reading it above its own
  // const is a temporal-dead-zone crash, not a lint warning.
  const tableRef = useStickyColumns(1, [page, filters, query]);
  const openPerson = (personId) => navigate(`/people/${encodeURIComponent(personId)}`);
  const { data: filterOptions } = usePeopleFilters();

  // Every filter is a server-side param. Client-side .filter() would only
  // ever see the 25 rows this page happened to load, which is silently
  // wrong the moment there is more than one page.
  const params = useMemo(
    () => ({ ...filters, q: query || undefined, page, pageSize }),
    [pageSize, page, filters, query],
  );
  const { data: people, total, isLoading, error } = usePeople(params);

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
  // Only the dropdown filters decide whether the panel springs open. A
  // ticked checkbox is already visible, so opening the panel for it would
  // reveal controls nobody asked about.
  const panelActive = ['role', 'group', 'company', 'method', 'currency'].some((k) => filters[k]);

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
        inline={
          /* One click each with no menu behind them, so they sit beside
             the search rather than under a disclosure icon. */
          <>
            <FilterCheckbox
              label="Active only"
              value={filters.status === 'active' ? 'true' : undefined}
              onChange={(v) => setFilter('status', v ? 'active' : undefined)}
            />
            <FilterCheckbox
              label="Flagged only"
              value={filters.needsReview}
              onChange={(v) => setFilter('needsReview', v)}
            />
          </>
        }
        filtersActive={panelActive}
        filtersCount={countFilters(filters)}
        storageKey="people.panel"
        onClearFilters={() => { setFilters({}); setSearch(''); setPage(1); forgetFilters(); }}
        filters={
          <>
            {/* Every option comes from the uploaded document. A role the
                boss invents next month shows up here on its own. */}
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

      {error && (
        <p className="rounded-md border border-danger/30 bg-danger-tint px-4 py-2.5 text-sm text-danger">
          {error.message}
        </p>
      )}

      {/* CARDS ON A PHONE, the table from md up. Not a narrower table:
          five columns at 375px is unreadable however they are trimmed. */}
      {view === 'grid' && (
      <CardList columns>
        {isLoading && Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}
        {!isLoading && people?.length === 0 && (
          <p className="border border-dashed border-border px-3 py-8 text-center text-sm text-text-muted">
            {filterActive || query
              ? 'No people match those filters.'
              : 'No people yet. Import a master sheet to get started.'}
          </p>
        )}
        {!isLoading && people?.map((p) => (
          <PersonCard key={p.person_id} person={p} onOpen={openPerson} onManage={setManaging} />
        ))}
      </CardList>
      )}

      {view === 'rows' && (
      <div className="table-wrap">
        <table ref={tableRef} className="w-full min-w-[760px] text-sm">
          <thead>
            <tr >
              <th className="th sticky-col sticky-edge">Name</th>
              <th className="th">Roles</th>
              <th className="th">Groups</th>
              <th className="th text-right">Active deals</th>
              <th className="th text-right">Monthly</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={8} columns={7} />}
            {!isLoading && people?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-text-muted">
                  {filterActive || query
                    ? 'No people match those filters.'
                    : 'No people yet. Import a master sheet to get started.'}
                </td>
              </tr>
            )}
            {!isLoading && people?.map((p) => (
              <PersonRow key={p.person_id} person={p} onOpen={openPerson} onManage={setManaging} />
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
      {managing && <ManagePersonModal personId={managing} onClose={() => setManaging(null)} />}
    </div>
  );
}
