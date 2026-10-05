import { useEffect, useMemo, useState } from 'react';
// Filters survive leaving the page. See useStickyState.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { Link } from 'react-router-dom';
import { useConcerns, useConcernsForPerson, useUpdateConcernStatus } from '../hooks/useConcerns';
import { useGroups } from '../hooks/useChat';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { patchQueries } from '../hooks/useBulkActions';
import { apiService } from '../configs/api.config';
import Modal from '../components/modals/Modal';
import StatusBadge from '../components/badges/StatusBadge';
import Select from '../components/forms/Select';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import DateRangeFilter, { toDateInput, firstOfThisMonth } from '../components/filters/DateRangeFilter';
import Pagination from '../components/layout/Pagination';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import SelectAll from '../components/forms/SelectAll';
import { LinkButton } from '../components/buttons/Button';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import ViewToggle from '../components/layout/ViewToggle';
import { CardSkeleton, Skeleton, TableSkeleton } from '../components/display/Skeleton';
import RecordCard, { CardList, ClampedText } from '../components/display/RecordCard';
import { ChatIcon, CheckCircleIcon, FlagIcon, HourglassIcon, SearchIcon } from '../components/icons';

const STATUSES = ['open', 'in_progress', 'resolved'];
// Sentence case, the way every status reads: "In progress", not "in progress".
const statusLabel = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));

// A Flagged row is a person in a group, with no id of its own. The pair is
// the key, packed so it can go back out as { group, personId }.
const rowKey = (row) => JSON.stringify([row.group_name, row.person_id]);
const fromKey = (key) => { const [group, personId] = JSON.parse(key); return { group, personId }; };
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

// With the time, which helpers/formatDate leaves out on purpose: a flag is
// an event in a day, not a date column, so these two stay local.
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
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
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
          options={STATUS_OPTIONS}
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

        {isLoading && (
          <div className="flex flex-col gap-2" aria-label="Loading">
            <Skeleton className="h-20 !rounded-lg" />
            <Skeleton className="h-20 !rounded-lg" />
          </div>
        )}
        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
          {concerns?.map((c) => (
            <ConcernEntry
              key={c.id}
              concern={c}
              onStatusChange={(id, status) => updateStatus({ id, status })}
            />
          ))}
        </div>

        {/* LinkButton as a router Link: the button's look, without a full
            page reload. */}
        <LinkButton
          as={Link}
          size="md"
          variant="primary"
          className="mt-2"
          to={`/chat?group=${encodeURIComponent(row.group_name)}&personId=${encodeURIComponent(row.person_id)}`}
        >
          <ChatIcon width={16} height={16} /> Message {displayName(row)} in Chat
        </LinkButton>
      </div>
    </Modal>
  );
}

function FlaggedRow({ row, onOpen, selected, onToggle }) {
  const open = () => onOpen(row);

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
      aria-label={`Open flags for ${displayName(row)}`}
    >
      <td className="td w-8" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={`Select ${displayName(row)}`}
        />
      </td>
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

  const visibleKeys = useMemo(() => (rows ?? []).map(rowKey), [rows]);
  const sel = useRowSelection(visibleKeys);
  const { run } = useBulkActions();
  /**
   * On screen at once. A bulk status sets EVERY flag the ticked people
   * have, so the card's derived status is simply the new one. A list
   * filtered to another status loses those cards, the same as a refetch
   * would show; the person modal's own flags move too.
   */
  const bulkStatus = (status, verb) => {
    const keys = sel.ids;
    const n = keys.length;
    const people = `${n} ${n === 1 ? 'person' : 'people'}`;
    const ticked = new Set(keys);
    const now = new Date().toISOString();
    run({
      call: () => apiService.concerns.bulkStatus(keys.map(fromKey), status),
      invalidates: [['concerns']],
      optimistic: (qc) => patchQueries(qc, [['concerns']], (data, key) => {
        if (!Array.isArray(data?.concerns)) return data;
        const filter = key[1];
        const hides = filter && filter !== 'all' && filter !== 'person' && filter !== status;
        let gone = 0;
        const concerns = [];
        for (const c of data.concerns) {
          if (!ticked.has(rowKey(c))) { concerns.push(c); continue; }
          if (hides) { gone += 1; continue; }
          concerns.push(c.status === status ? c : { ...c, status, status_changed_at: now });
        }
        return { ...data, concerns, total: typeof data.total === 'number' ? Math.max(0, data.total - gone) : data.total };
      }),
      // The count is PEOPLE, what was ticked. The server answers in flags,
      // and one person can carry several.
      toast: { message: `${people} ${verb}` },
      failure: `Couldn't update ${people}`,
    });
    sel.clear();
  };

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
    <div className="space-y-4">
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
            options={STATUS_OPTIONS}
            placeholder="All statuses"
          />
          <Select
            size="sm" className="w-44"
            value={group} onChange={(v) => setGroup(v ?? '')}
            options={groups ?? []}
            placeholder="All groups"
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

      <ErrorState error={error} title="Couldn't load flags" />

      {!isLoading && rows && rows.length === 0 && (
        <EmptyState
          icon={FlagIcon}
          title={query ? 'No one matches that search' : 'Nothing flagged'}
          hint={query ? undefined : 'People Diane flags in Chat show up here.'}
        />
      )}

      {view === 'grid' && (isLoading || (rows && rows.length > 0)) && (
        <CardList columns>
          {isLoading
            ? Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)
            : rows.map((r) => (
              // The tint reaches the card, the same look a ticked row has.
              <div key={`${r.group_name}-${r.person_id}`} className={`h-full ${sel.has(rowKey(r)) ? '[&>div]:!bg-accent-tint' : ''}`}>
              <RecordCard
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
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-faint">
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
                actions={
                  <label className="flex items-center gap-2 text-xs text-text-muted">
                    <input type="checkbox" checked={sel.has(rowKey(r))} onChange={() => sel.toggle(rowKey(r))} />
                    Select
                  </label>
                }
              />
              </div>
            ))}
        </CardList>
      )}

      {view === 'rows' && (isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr>
                <th className="th w-8"><SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} /></th>
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
              {isLoading && <TableSkeleton rows={8} columns={8} />}
              {!isLoading && rows.map((row) => (
                <FlaggedRow
                  key={`${row.group_name}-${row.person_id}`}
                  row={row}
                  onOpen={setViewing}
                  selected={sel.has(rowKey(row))}
                  onToggle={() => sel.toggle(rowKey(row))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      {viewing && <PersonModal row={viewing} onClose={() => setViewing(null)} />}

      <BulkBar count={sel.count} noun="person" onClear={sel.clear}>
        <BulkAction icon={HourglassIcon} onClick={() => bulkStatus('in_progress', 'marked in progress')}>
          Mark in progress
        </BulkAction>
        <BulkAction icon={CheckCircleIcon} onClick={() => bulkStatus('resolved', 'resolved')}>
          Resolve
        </BulkAction>
      </BulkBar>
    </div>
  );
}
