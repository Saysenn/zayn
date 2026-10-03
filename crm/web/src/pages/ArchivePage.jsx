import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMasterSheet, useResumeMasterSheetRow } from '../hooks/useMasterSheet';
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
import ConfirmDialog from '../components/modals/ConfirmDialog';
import CellInfo from '../components/display/CellInfo';
import { TableSkeleton } from '../components/display/Skeleton';
import { confirm } from '../configs/confirms.config';
import { formatMoney, NO_VALUE } from '../helpers/formatMoney';
import { formatDate } from '../helpers/formatDate';
import { STOPPED_REASON_LABEL, REOPEN_THE_COMPANY } from '../configs/stoppedReason';
import { RestoreIcon, SearchIcon, BuildingIcon } from '../components/icons';
import Button, { LinkButton } from '../components/buttons/Button';

/**
 * ***************************************************
 * * THE ARCHIVE. Deals that are over, and nothing else.
 * ***************************************************
 *
 * NOT A SECOND TABLE. It is the master sheet's own list with one flag
 * flipped (`stopped: true`), so a deal is one row with one history rather
 * than a live copy and an archived copy that disagree from the first edit.
 *
 * READ ONLY BY DESIGN, with RESUME as the only write. Every editable cell
 * the master sheet has is deliberately absent: a finished deal's figures
 * are what was actually paid, and the point of moving it here is that
 * nobody edits it by accident while working through the live sheet.
 */

const PAGE_SIZE = 25;

// Two readings of the same stopped deals: one deal at a time, or one person
// whose every deal is here. Not under 'archive.', so Clear keeps the tab.
const ARCHIVE_TAB = Object.freeze({ deals: 'deals', dead: 'dead' });
const TABS = [
  { key: ARCHIVE_TAB.deals, label: 'Deals' },
  { key: ARCHIVE_TAB.dead, label: 'Dead persons' },
];

export default function ArchivePage() {
  const [tab, setTab] = useStickyState('archiveView.tab', ARCHIVE_TAB.deals);
  return (
    <div>
      <PageHeader title="Archive" />
      <UnderlineTabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mt-3">
        {tab === ARCHIVE_TAB.dead ? <DeadPersonsTab /> : <ArchiveDeals />}
      </div>
    </div>
  );
}

function ArchiveDeals() {
  const [group, setGroup] = useStickyState('archive.group', '');
  const [company, setCompany] = useStickyState('archive.company', '');
  const [reason, setReason] = useStickyState('archive.reason', '');
  const [query, setQuery] = useStickyState('archive.query', '');
  const [from, setFrom] = useStickyState('archive.from', '');
  const [to, setTo] = useStickyState('archive.to', '');
  const [page, setPage] = useState(1);
  const [resuming, setResuming] = useState(null);
  const forgetFilters = useClearSticky('archive.');

  const { data: groups } = useGroups();
  const { data: filterOptions } = usePeopleFilters();
  const debouncedQuery = useDebouncedValue(query);
  const resume = useResumeMasterSheetRow();

  useEffect(() => setPage(1), [group, company, reason, from, to, debouncedQuery]);

  const { data: rows, total, isLoading, error } = useMasterSheet({
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

  const filtersCount = [group, company, reason, from || to ? 'date' : ''].filter(Boolean).length;

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
    <div>
      <p className="mb-2 text-sm text-text-muted">{`${total} ${total === 1 ? 'deal' : 'deals'} ended`}</p>

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

      {error && <div className="p-8 text-center text-text-muted text-sm">{error.message}</div>}

      {!isLoading && rows && rows.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          {filtersCount > 0 || query
            ? 'No ended deals match that.'
            : 'Nothing has been stopped yet. Stopping a deal on the master sheet moves it here.'}
        </div>
      )}

      {(isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Group</th>
                <th className="th">Role</th>
                <th className="th">Company</th>
                <th className="th">Monthly</th>
                <th className="th">Stopped on</th>
                <th className="th">Why</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={8} />}
              {!isLoading && rows.map((row) => (
                <ArchiveRow key={row.id} row={row} onResume={setResuming} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      {resuming && (
        <ConfirmDialog
          {...confirm.resumeRow({
            personName: resuming.person_name,
            company: resuming.company,
            groupName: resuming.group_name,
            stoppedOn: formatDate(resuming.stopped_on),
          })}
          icon={<RestoreIcon width={15} height={15} />}
          onCancel={() => setResuming(null)}
          onConfirm={() => {
            resume.mutate({
              id: resuming.id,
              subject: resuming.person_name,
              group: resuming.group_name,
            });
            setResuming(null);
          }}
        />
      )}
    </div>
  );
}

function ArchiveRow({ row, onResume }) {
  // A company closure stopped this one, so resuming it alone would put the
  // deal back on a company that is gone. The button says where to go.
  const closedWithCompany = row.stopped_reason === REOPEN_THE_COMPANY;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-sunken">
      <td className="td font-semibold">{row.person_name ?? '(no handler)'}</td>
      <td className="td text-text-muted">{row.group_name}</td>
      <td className="td text-text-muted">{row.role_label}</td>
      <td className="td">{row.company ?? '(no company)'}</td>
      <td className="td tabular-nums">{formatMoney(row.monthly_amount, row.currency)}</td>
      <td className="td whitespace-nowrap">{formatDate(row.stopped_on)}</td>
      <td className="td text-text-muted">
        {STOPPED_REASON_LABEL[row.stopped_reason] ?? row.stopped_reason}
      </td>
      <td className="td">
        {closedWithCompany ? (
          // Not a disabled button with a tooltip: the useful thing is the
          // way to actually do it, which is one click from here. Same tone
          // as Resume — both are this row's one action, and a grey one
          // beside a coloured one reads as disabled rather than different.
          <span className="inline-flex items-center gap-1">
            <LinkButton
              as={Link}
              to={`/companies/${encodeURIComponent(row.company ?? '')}`}
              variant="accent"
              size="xs"
            >
              <BuildingIcon width={14} height={14} />
              Open company
            </LinkButton>
            <CellInfo label="Why this cannot resume here">
              The company is closed. Reopening it brings back every deal its
              closure stopped, together.
            </CellInfo>
          </span>
        ) : (
          // `accent`, not `primary`: a solid green on every row of a table
          // claims to be the main act on the screen eight times over. The
          // soft accent is the app's own "this is the action here".
          <Button variant="accent" size="xs" onClick={() => onResume(row)}>
            <RestoreIcon width={14} height={14} />
            Resume
          </Button>
        )}
      </td>
    </tr>
  );
}

/**
 * ***************************************************
 * * DEAD PERSONS: everyone whose every deal is stopped
 * ***************************************************
 * Worked out on the server from the same rows, so a deal added back takes
 * them off at once. A row opens their journey, company by company.
 */
function DeadPersonsTab() {
  const [group, setGroup] = useStickyState('archiveDead.group', '');
  const [query, setQuery] = useStickyState('archiveDead.query', '');
  const [page, setPage] = useState(1);
  const forgetFilters = useClearSticky('archiveDead.');
  const navigate = useNavigate();
  const { data: groups } = useGroups();
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => setPage(1), [group, debouncedQuery]);

  const { data: rows, total, isLoading, error } = useDeadPeople({
    group: group || undefined, q: debouncedQuery || undefined, page, pageSize: PAGE_SIZE,
  });

  return (
    <div>
      <p className="mb-2 text-sm text-text-muted">
        {`${total} ${total === 1 ? 'person has' : 'people have'} no live deal left`}
      </p>
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

      {error && <div className="p-8 text-center text-text-muted text-sm">{error.message}</div>}

      {!isLoading && rows && rows.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          {group || query
            ? 'Nobody on the dead list matches that.'
            : 'Nobody yet. A person lands here when every one of their deals is stopped.'}
        </div>
      )}

      {(isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Groups</th>
                <th className="th">Deals</th>
                <th className="th">Companies</th>
                <th className="th">Phone</th>
                <th className="th">Bank</th>
                <th className="th">First started</th>
                <th className="th">Last stopped</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} columns={8} />}
              {!isLoading && rows.map((p) => (
                <tr
                  key={p.person_id}
                  onClick={() => navigate(`/archive/people/${encodeURIComponent(p.person_id)}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-sunken"
                >
                  <td className="td font-semibold">{p.display_name}</td>
                  <td className="td text-text-muted">{(p.groups ?? []).join(', ')}</td>
                  <td className="td tabular-nums">{p.deal_count}</td>
                  <td className="td tabular-nums">{p.company_count}</td>
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
    </div>
  );
}
