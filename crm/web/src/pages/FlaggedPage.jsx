import { useEffect, useState } from 'react';
// Filters survive leaving the page. See useStickyState.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { Link } from 'react-router-dom';
import { useConcerns, useConcernsForPerson, useUpdateConcernStatus } from '../hooks/useConcerns';
import { useGroups } from '../hooks/useChat';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import Modal from '../components/modals/Modal';
import StatusBadge from '../components/badges/StatusBadge';
import Select from '../components/forms/Select';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import DateRangeFilter, { toDateInput, firstOfThisMonth } from '../components/filters/DateRangeFilter';
import Pagination from '../components/layout/Pagination';
import ViewToggle from '../components/layout/ViewToggle';
import { CardSkeleton, TableSkeleton } from '../components/display/Skeleton';
import RecordCard, { CardList, ClampedText } from '../components/display/RecordCard';
import { ChatIcon, FlagIcon, SearchIcon } from '../components/icons';

const STATUSES = ['open', 'in_progress', 'resolved'];
const GRID_PAGE_SIZE = 16;
const ROW_PAGE_SIZE = 20;

const CATEGORY_LABELS = {
  dispute: 'Dispute',
  distress: 'Distress',
  legal: 'Legal',
  'wrong-recipient': 'Wrong recipient',
  'wants-human': 'Wants a person',
  anger: 'Anger',
  'data-request': 'Data request',
};

function categoryLabel(c) {
  return CATEGORY_LABELS[c] ?? c;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function formatFull(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function displayName(row) {
  return row.person_name || row.person_id;
}

// "Resolved at" and "last updated" are the same stored moment: when the
// status last moved. Only the word in front of it changes, so there is one
// column and this decides how to read it.
function statusDateLabel(status) {
  if (status === 'resolved') return 'Resolved';
  if (status === 'in_progress') return 'Picked up';
  return 'Last update';
}

function ConcernEntry({ concern, onStatusChange }) {
  return (
    <div className="border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-text-muted">
          {categoryLabel(concern.category)} · {formatFull(concern.created_at)}
          {/* Only when something has actually happened to it. On an
              untouched flag the stamp equals the moment it was raised, and
              printing the same date twice under two labels reads as two
              events. */}
          {new Date(concern.status_changed_at) > new Date(concern.created_at) && (
            <>
              {' · '}
              {statusDateLabel(concern.status)} {formatFull(concern.status_changed_at)}
            </>
          )}
        </span>
        {/* The shared Select, not a bare <select>: this was the one
            dropdown in the CRM that did not look like the others.
            Not disabled while saving, either. The value changes on the
            click now, so greying it out would hide the very thing the
            optimistic update exists to show. */}
        <Select
          size="sm" className="w-36"
          value={concern.status}
          onChange={(v) => onStatusChange(concern.id, v)}
          options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
        />
      </div>
      <p className="text-sm whitespace-pre-wrap">{concern.message}</p>
    </div>
  );
}

function PersonModal({ row, onClose }) {
  const { data: concerns, isLoading } = useConcernsForPerson(row.group_name, row.person_id);
  const { mutate: updateStatus } = useUpdateConcernStatus();

  return (
    <Modal title={displayName(row)} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">{row.group_name}</p>

        {isLoading && <p className="text-sm text-text-faint">Loading…</p>}
        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
          {concerns?.map((c) => (
            <ConcernEntry
              key={c.id}
              concern={c}
              onStatusChange={(id, status) => updateStatus({ id, status })}
            />
          ))}
        </div>

        <Link
          to={`/chat?group=${encodeURIComponent(row.group_name)}&personId=${encodeURIComponent(row.person_id)}`}
          // A router <Link>, so the base `button {}` rule does not apply
          // and btn-primary alone rendered it as an unpadded sliver of
          // green. Not LinkButton, which is a plain <a> and would trigger
          // a full page navigation.
          className="btn-primary flex items-center justify-center gap-2 no-underline mt-2 border border-accent px-4 py-2 min-h-10"
        >
          <ChatIcon /> Message {displayName(row)} in Chat
        </Link>
      </div>
    </Modal>
  );
}

function FlaggedRow({ row, onOpen }) {
  const open = () => onOpen(row);

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
      aria-label={`Open flags for ${displayName(row)}`}
    >
      <td className="px-3 py-2.5 font-medium text-text">{displayName(row)}</td>
      <td className="px-3 py-2.5 text-text-muted">{row.group_name}</td>
      <td className="max-w-sm px-3 py-2.5">
        <ClampedText lines={2} infoLabel="Full latest message" className="text-xs leading-4 text-text">
          {row.latest_message}
        </ClampedText>
      </td>
      <td className="px-3 py-2.5 text-text-muted">{categoryLabel(row.latest_category)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <StatusBadge status={row.status} />
          {row.concern_count > 1 && (
            <span className="text-xs text-text-muted">{row.concern_count} flagged</span>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-muted">{formatTime(row.latest_at)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-muted">
        {formatTime(row.status_changed_at)}
      </td>
    </tr>
  );
}

export default function FlaggedPage() {
  const [statusFilter, setStatusFilter] = useStickyState('flagged.status', '');
  const [group, setGroup] = useStickyState('flagged.group', '');
  const [query, setQuery] = useStickyState('flagged.query', '');
  // ALWAYS OPENS AS THE LIST, his call 2026-09-30. See CompaniesPage.
  const [view, setView] = useState('rows');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [from, setFrom] = useState(toDateInput(firstOfThisMonth()));
  const [to, setTo] = useState(toDateInput(new Date()));
  const [filterByDate, setFilterByDate] = useStickyState('flagged.byDate', false);
  const forgetFilters = useClearSticky('flagged.');

  const { data: groups } = useGroups();
  const debouncedQuery = useDebouncedValue(query);
  const pageSize = view === 'grid' ? GRID_PAGE_SIZE : ROW_PAGE_SIZE;

  useEffect(() => setPage(1), [statusFilter, group, filterByDate, from, to, debouncedQuery]);

  const { data: rows, total, isLoading, error } = useConcerns({
    status: statusFilter || undefined,
    group: group || undefined,
    from: filterByDate ? from : undefined,
    to: filterByDate ? to : undefined,
    q: debouncedQuery || undefined,
    page,
    pageSize,
  });

  const thisMonthActive =
    filterByDate && from === toDateInput(firstOfThisMonth()) && to === toDateInput(new Date());

  // A toggle, not a one way switch. It is the page's one binary filter, so
  // pressing it again has to turn it off — otherwise the only way out of a
  // green, obviously-on button is the Clear at the other end of the row.
  function applyThisMonth() {
    if (thisMonthActive) {
      setFilterByDate(false);
      return;
    }
    setFrom(toDateInput(firstOfThisMonth()));
    setTo(toDateInput(new Date()));
    setFilterByDate(true);
  }

  return (
    <div>
      <PageHeader
        title="Flagged"
        subtitle={`${total} ${total === 1 ? 'person' : 'people'}`}
        actions={(
          <ViewToggle
            value={view}
            onChange={(nextView) => { setView(nextView); setPage(1); }}
          />
        )}
      />

      {/* THE FILTER BUTTON IS BACK, on the user's call, so every list page
          has the same control in the same place.

          It was dropped because three controls fit on one row, so the
          button cost a click to reach things that would have fitted anyway,
          and it let the page sit filtered with the controls that did it
          hidden. Neither holds now: the row REMEMBERS whether it was open
          (`storageKey`), and it opens itself whenever a filter is on, so
          nothing can be filtered with the reason out of sight.

          ONE Clear, not three. It was the toolbar's Clear beside the
          filter button and DateRangeFilter's own "Clear dates" two
          controls along, which left you guessing which one undid what. The
          single Clear undoes everything, and it is the only control on the
          page whose job is to undo. */}
      <Toolbar
        filtersActive={Boolean(statusFilter || group || filterByDate)}
        search={
          <SearchInput
            icon={SearchIcon}
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        filtersCount={[statusFilter, group, filterByDate ? 'date' : ''].filter(Boolean).length}
        storageKey="flagged.panel"
        onClearFilters={() => {
          setStatusFilter('');
          setGroup('');
          setQuery('');
          setFilterByDate(false);
          // Resetting alone leaves the old values in storage, so they
          // would come back the next time this page was opened.
          forgetFilters();
        }}
        filters={
          <>
          <Select
            size="sm" className="w-44"
            value={statusFilter} onChange={(v) => setStatusFilter(v ?? '')}
            options={STATUSES.map((x) => ({ value: x, label: x.replace('_', ' ') }))}
            placeholder="All statuses"
          />
          <Select
            size="sm" className="w-44"
            value={group} onChange={(v) => setGroup(v ?? '')}
            options={groups ?? []}
            placeholder="All"
          />
          <DateRangeFilter
            from={from}
            to={to}
            onFrom={(v) => { setFrom(v); setFilterByDate(true); }}
            onTo={(v) => { setTo(v); setFilterByDate(true); }}
            thisMonthActive={thisMonthActive}
            onThisMonth={applyThisMonth}
          />
          </>
        }
      />

      {error && <div className="p-8 text-center text-text-muted text-sm">{error.message}</div>}

      {!isLoading && rows && rows.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          {query ? 'No one matches that search.' : 'Nothing flagged.'}
        </div>
      )}

      {view === 'grid' && (isLoading || (rows && rows.length > 0)) && (
        <CardList columns>
          {isLoading
            ? Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)
            : rows.map((r) => (
              <RecordCard
                key={`${r.group_name}-${r.person_id}`}
                interactive
                icon={FlagIcon}
                title={displayName(r)}
                subtitle={r.group_name}
                onOpen={() => setViewing(r)}
                badges={
                  <>
                    <StatusBadge status={r.status} />
                    {r.concern_count > 1 && (
                      <span className="badge badge-in_progress">{r.concern_count} flagged</span>
                    )}
                  </>
                }
                body={
                  <div>
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-faint">
                      Latest message
                    </p>
                    <ClampedText
                      lines={2}
                      infoLabel="Full latest message"
                      className="text-xs leading-4 text-text"
                    >
                      {r.latest_message}
                    </ClampedText>
                  </div>
                }
                facts={[
                  { label: 'Category', value: categoryLabel(r.latest_category) },
                  { label: 'Last flagged', value: formatTime(r.latest_at) },
                  {
                    label: statusDateLabel(r.status),
                    value: formatTime(r.status_changed_at),
                  },
                ]}
              />
            ))}
        </CardList>
      )}

      {view === 'rows' && (isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Group</th>
                <th className="th">Latest message</th>
                <th className="th">Category</th>
                <th className="th">Status</th>
                <th className="th">Last flagged</th>
                <th className="th">Status changed</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={7} />}
              {!isLoading && rows.map((row) => (
                <FlaggedRow
                  key={`${row.group_name}-${row.person_id}`}
                  row={row}
                  onOpen={setViewing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      {viewing && <PersonModal row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
