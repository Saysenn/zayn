import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMasterSheet } from '../hooks/useMasterSheet';
import { useDeadPeople } from '../hooks/useDeadPeople';
import UnderlineTabs from '../components/layout/UnderlineTabs';
import { useGroups } from '../hooks/useChat';
import { usePeopleFilters } from '../hooks/usePeople';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
// Filters survive leaving the page, and Clear FORGETS as well as resets.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import Select from '../components/forms/Select';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import DateRangeFilter, { toDateInput, firstOfThisMonth } from '../components/filters/DateRangeFilter';
import Pagination from '../components/layout/Pagination';
import CellInfo from '../components/display/CellInfo';
import { TableSkeleton } from '../components/display/Skeleton';
import { formatMoney, NO_VALUE } from '../helpers/formatMoney';
import { formatDate } from '../helpers/formatDate';
import { STOPPED_REASON_LABEL, REOPEN_THE_COMPANY } from '../configs/stoppedReason';
import { ResumeIcon, SearchIcon, ArchiveIcon, UsersIcon } from '../components/icons';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import SelectAll from '../components/forms/SelectAll';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { DEAL_TOUCHES, bulkMessage, patchRows } from '../hooks/useBulkActions';
import { apiService } from '../configs/api.config';
import { countOf } from '../helpers/pluralNoun';

/**
 * ***************************************************
 * * THE ARCHIVE. Deals that are over, and nothing else.
 * ***************************************************
 *
 * NOT A SECOND TABLE. It is the master sheet's own list with one flag
 * flipped (`stopped: true`), so a deal is one row with one history rather
 * than a live copy and an archived copy that disagree from the first edit.
 *
 * READ ONLY BY DESIGN, with RESUME (the bulk bar's) as the only write. Every editable cell
 * the master sheet has is deliberately absent: a finished deal's figures
 * are what was actually paid, and the point of moving it here is that
 * nobody edits it by accident while working through the live sheet.
 */

const PAGE_SIZE = 25;

/**
 * One toast for every Resume from here, one deal or a whole person's.
 * A deal its company's closure stopped is REFUSED, not skipped: the way
 * back is reopening the company, so the toast names them.
 */
function resumeReport(data) {
  const report = bulkMessage('resumed', data.resumed.length, 'deal', [[data.skipped, 'already live']]);
  if (!data.refused?.length) return report;
  const refused = `Closed with their company: ${data.refused.join(', ')}. Reopen the company to bring them back.`;
  return { ...report, detail: report.detail ? `${report.detail} · ${refused}` : refused };
}

// Two readings of the same stopped deals: one deal at a time, or one person
// whose every deal is here. Not under 'archive.', so Clear keeps the tab.
const ARCHIVE_TAB = Object.freeze({ deals: 'deals', dead: 'dead' });
const TABS = [
  { key: ARCHIVE_TAB.deals, label: 'Deals' },
  { key: ARCHIVE_TAB.dead, label: 'Dead people' },
];

export default function ArchivePage() {
  // `?tab=dead` is how a dead person's breadcrumb lands back on their list.
  // useStickyState reads it once and strips it from the address bar.
  const [tab, setTab] = useStickyState('archiveView.tab', ARCHIVE_TAB.deals, 'tab');

  // Each tab reports its own count; the header says the one on screen.
  const [counts, setCounts] = useState({ deals: 0, dead: 0 });
  const onTotal = (key) => (n) => setCounts((c) => (c[key] === n ? c : { ...c, [key]: n }));
  const subtitle = tab === ARCHIVE_TAB.dead
    ? `${counts.dead} ${counts.dead === 1 ? 'person has' : 'people have'} no live deal left`
    : `${counts.deals} ${counts.deals === 1 ? 'deal' : 'deals'} ended`;

  return (
    <div className="space-y-4">
      <PageHeader title="Archive" subtitle={subtitle} />
      <UnderlineTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === ARCHIVE_TAB.dead
        ? <DeadPeopleTab onTotal={onTotal('dead')} />
        : <ArchiveDeals onTotal={onTotal('deals')} />}
    </div>
  );
}

function ArchiveDeals({ onTotal }) {
  const [group, setGroup] = useStickyState('archive.group', '');
  const [company, setCompany] = useStickyState('archive.company', '');
  const [reason, setReason] = useStickyState('archive.reason', '');
  const [query, setQuery] = useStickyState('archive.query', '');
  const [from, setFrom] = useStickyState('archive.from', '');
  const [to, setTo] = useStickyState('archive.to', '');
  const [page, setPage] = useState(1);
  const forgetFilters = useClearSticky('archive.');

  const { data: groups } = useGroups();
  const { data: filterOptions } = usePeopleFilters();
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => setPage(1), [group, company, reason, from, to, debouncedQuery]);

  const { data: rows, total, isLoading, error, refetch } = useMasterSheet({
    stopped: true,
    group: group || undefined,
    company: company || undefined,
    stoppedReason: reason || undefined,
    stoppedFrom: from || undefined,
    stoppedTo: to || undefined,
    q: debouncedQuery || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  // `onTotal` is a fresh function each parent render; the count is what matters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onTotal(total), [total]);

  const filtersCount = [group, company, reason, from || to ? 'date' : ''].filter(Boolean).length;

  const sel = useRowSelection((rows ?? []).map((r) => r.id));
  const { run } = useBulkActions();

  /**
   * GONE FROM THE ARCHIVE THE MOMENT YOU CLICK. A deal its company's
   * closure stopped stays put: the server refuses it, and the toast says
   * to reopen the company instead.
   */
  function resumeSelected() {
    const ids = sel.ids;
    const picked = (rows ?? []).filter((r) => sel.has(r.id));
    const willResume = picked.filter((r) => r.stopped_reason !== REOPEN_THE_COMPANY).map((r) => r.id);
    run({
      call: () => apiService.masterSheet.bulkResume(ids),
      invalidates: DEAL_TOUCHES,
      optimistic: (qc) => patchRows(qc, [['master-sheet']], willResume, (r) => (r.stopped ? null : r)),
      toast: bulkMessage('resumed', willResume.length, 'deal'),
      report: resumeReport,
      undoBatch: (data) => data.batchId,
      failure: `Couldn't resume ${countOf(ids.length, 'deal')}`,
    });
    sel.clear();
  }

  // A TOGGLE, not a one way switch, the same shape Flagged uses: pressing
  // an obviously-on button again has to turn it off.
  const monthStart = toDateInput(firstOfThisMonth());
  const today = toDateInput(new Date());
  const thisMonthActive = from === monthStart && to === today;

  function applyThisMonth() {
    if (thisMonthActive) { setFrom(''); setTo(''); return; }
    setFrom(monthStart);
    setTo(today);
  }

  return (
    <div className="space-y-4">
      <Toolbar
        filtersActive={filtersCount > 0}
        filtersCount={filtersCount}
        storageKey="archive.panel"
        search={
          <SearchInput
            icon={SearchIcon}
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        onClearFilters={() => {
          setGroup(''); setCompany(''); setReason('');
          setQuery(''); setFrom(''); setTo('');
          forgetFilters();
        }}
        filters={
          <>
            <Select
              size="sm" className="w-44"
              value={group} onChange={(v) => setGroup(v ?? '')}
              options={groups ?? []}
              placeholder="All groups"
            />
            <Select
              size="sm" className="w-52"
              value={company} onChange={(v) => setCompany(v ?? '')}
              options={filterOptions?.companies ?? []}
              placeholder="All companies"
            />
            {/* WHY it ended, which is the question the Archive exists to
                answer. The four are a closed set the database also checks. */}
            <Select
              size="sm" className="w-52"
              value={reason} onChange={(v) => setReason(v ?? '')}
              options={Object.entries(STOPPED_REASON_LABEL)
                .map(([value, label]) => ({ value, label }))}
              placeholder="Any reason"
            />
            {/* On the STOP date, not the end date. "This month" is the
                question the monthly review leaves behind: what did we end
                this month, and was any of it a mistake. */}
            <DateRangeFilter
              from={from}
              to={to}
              onFrom={setFrom}
              onTo={setTo}
              thisMonthActive={thisMonthActive}
              onThisMonth={applyThisMonth}
            />
          </>
        }
      />

      <ErrorState error={error} title="Couldn't load the archive" onRetry={refetch} />

      {!error && !isLoading && rows && rows.length === 0 && (
        <EmptyState
          icon={ArchiveIcon}
          {...(filtersCount > 0 || query
            ? { title: 'No ended deals match that', hint: 'Clear a filter or the search to see more.' }
            : { title: 'Nothing has been stopped yet', hint: 'Stopping a deal on the master sheet moves it here.' })}
        />
      )}

      {(isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr>
                <th className="th w-8">
                  <SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} />
                </th>
                <th className="th">Name</th>
                <th className="th">Group</th>
                <th className="th">Role</th>
                <th className="th">Company</th>
                <th className="th text-right tabular-nums">Monthly</th>
                <th className="th">Stopped on</th>
                <th className="th">Why</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={8} />}
              {!isLoading && rows.map((row) => (
                <ArchiveRow
                  key={row.id} row={row}
                  selected={sel.has(row.id)} onSelect={() => sel.toggle(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      {/* No Delete: deleting a deal is the Master Sheet's alone. */}
      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={ResumeIcon} variant="accent" onClick={resumeSelected}>
          Resume
        </BulkAction>
      </BulkBar>
    </div>
  );
}

function ArchiveRow({ row, selected, onSelect }) {
  // A company closure stopped this one, so resuming it alone would put the
  // deal back on a company that is gone. The reason itself is the way there.
  const closedWithCompany = row.stopped_reason === REOPEN_THE_COMPANY;
  const reason = STOPPED_REASON_LABEL[row.stopped_reason] ?? row.stopped_reason;

  return (
    <tr className={`border-b border-border last:border-0 hover:bg-surface-sunken ${selected ? 'row-selected' : ''}`}>
      <td className="td w-8">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${row.person_name ?? 'this deal'}`} />
      </td>
      <td className="td font-medium text-text">{row.person_name ?? '(no handler)'}</td>
      <td className="td text-text-muted">{row.group_name}</td>
      <td className="td text-text-muted">{row.role_label}</td>
      <td className="td">{row.company ?? '(no company)'}</td>
      <td className="td text-right tabular-nums">{formatMoney(row.monthly_amount, row.currency)}</td>
      <td className="td whitespace-nowrap">{formatDate(row.stopped_on)}</td>
      <td className="td text-text-muted">
        {closedWithCompany && row.company ? (
          // A LINK, not a button: reopening the company is how this comes
          // back, and it is one click from the words that say so.
          <span className="inline-flex items-center gap-1">
            <Link
              to={`/companies/${encodeURIComponent(row.company)}`}
              className="text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded"
            >
              {reason}
            </Link>
            <CellInfo label="Why this cannot resume here">
              The company is closed. Reopening it brings back every deal its
              closure stopped, together.
            </CellInfo>
          </span>
        ) : reason}
      </td>
    </tr>
  );
}

/**
 * ***************************************************
 * * DEAD PEOPLE: everyone whose every deal is stopped
 * ***************************************************
 * Worked out on the server from the same rows, so a deal added back takes
 * them off at once. A row opens their journey, company by company.
 */
function DeadPeopleTab({ onTotal }) {
  const [group, setGroup] = useStickyState('archiveDead.group', '');
  const [query, setQuery] = useStickyState('archiveDead.query', '');
  const [page, setPage] = useState(1);
  const forgetFilters = useClearSticky('archiveDead.');
  const navigate = useNavigate();
  const { data: groups } = useGroups();
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => setPage(1), [group, debouncedQuery]);

  const { data: rows, total, isLoading, error, refetch } = useDeadPeople({
    group: group || undefined, q: debouncedQuery || undefined, page, pageSize: PAGE_SIZE,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onTotal(total), [total]);

  const sel = useRowSelection((rows ?? []).map((p) => p.person_id));
  const { run } = useBulkActions();
  const open = (personId) => navigate(`/archive/people/${encodeURIComponent(personId)}`);

  /**
   * RESTORE IS RESUME, for every deal they hold. The list row is a person;
   * only their own record lists the deals, so one read each, then one
   * bulk write. A deal closed with its company is refused and named.
   */
  function restoreSelected() {
    const personIds = sel.ids;
    // Off the dead list at once; the reads and the write follow behind.
    run({
      call: async () => {
        const answers = await Promise.all(personIds.map((id) => apiService.deadPeople.get(id)));
        const ids = answers.flatMap((a) => (a?.person?.companies ?? []).flatMap((c) => c.deals.map((d) => d.id)));
        return ids.length
          ? apiService.masterSheet.bulkResume(ids)
          : { resumed: [], skipped: 0, refused: [], batchId: null };
      },
      invalidates: DEAL_TOUCHES,
      optimistic: (qc) => patchRows(qc, [['dead-people']], personIds, () => null, (p) => p.person_id),
      toast: bulkMessage('restored', personIds.length, 'person'),
      report: resumeReport,
      undoBatch: (data) => data.batchId,
        failure: `Couldn't restore ${countOf(personIds.length, 'person')}`,
    });
    sel.clear();
  }

  return (
    <div className="space-y-4">
      <Toolbar
        filtersActive={Boolean(group)}
        filtersCount={group ? 1 : 0}
        storageKey="archiveDead.panel"
        search={(
          <SearchInput
            icon={SearchIcon}
            placeholder="Search by name or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        onClearFilters={() => { setGroup(''); setQuery(''); forgetFilters(); }}
        filters={(
          <Select
            size="sm" className="w-44"
            value={group} onChange={(v) => setGroup(v ?? '')}
            options={groups ?? []}
            placeholder="All groups"
          />
        )}
      />

      <ErrorState error={error} title="Couldn't load dead people" onRetry={refetch} />

      {!error && !isLoading && rows && rows.length === 0 && (
        <EmptyState
          icon={UsersIcon}
          {...(group || query
            ? { title: 'Nobody on the dead list matches that', hint: 'Clear a filter or the search to see more.' }
            : { title: 'Nobody yet', hint: 'A person lands here when every one of their deals is stopped.' })}
        />
      )}

      {(isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr>
                <th className="th w-8">
                  <SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} />
                </th>
                <th className="th">Name</th>
                <th className="th">Groups</th>
                <th className="th text-right tabular-nums">Deals</th>
                <th className="th text-right tabular-nums">Companies</th>
                <th className="th">Phone</th>
                <th className="th">Bank</th>
                <th className="th">First started</th>
                <th className="th">Last stopped</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={9} />}
              {!isLoading && rows.map((p) => (
                <tr
                  key={p.person_id}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open ${p.display_name}`}
                  onClick={() => open(p.person_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); open(p.person_id); }
                  }}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-sunken ${
                    sel.has(p.person_id) ? 'row-selected' : ''
                  }`}
                >
                  <td className="td w-8" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox" checked={sel.has(p.person_id)} onChange={() => sel.toggle(p.person_id)}
                      aria-label={`Select ${p.display_name}`}
                    />
                  </td>
                  <td className="td font-medium text-text">{p.display_name}</td>
                  <td className="td text-text-muted">{(p.groups ?? []).join(', ')}</td>
                  <td className="td text-right tabular-nums">{p.deal_count}</td>
                  <td className="td text-right tabular-nums">{p.company_count}</td>
                  <td className="td">{(p.phones ?? []).join(', ') || NO_VALUE}</td>
                  <td className="td">{(p.bank_details ?? []).join(', ') || NO_VALUE}</td>
                  <td className="td whitespace-nowrap">{formatDate(p.first_started)}</td>
                  <td className="td whitespace-nowrap">{formatDate(p.last_stopped)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={ResumeIcon} variant="accent" onClick={restoreSelected}>
          Restore
        </BulkAction>
      </BulkBar>
    </div>
  );
}
