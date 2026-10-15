import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCompany } from '../hooks/useCompanies';
import { apiService } from '../configs/api.config';
import Breadcrumb from '../components/layout/Breadcrumb';
import PageHeader from '../components/layout/PageHeader';
import { DetailCard, Stat } from '../components/layout/DetailLayout';
import { Skeleton } from '../components/display/Skeleton';
import { ErrorState, EmptyState } from '../components/display/StateBlocks';
import Button from '../components/buttons/Button';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { ResumeIcon, BuildingIcon } from '../components/icons';
import { useReportingMutation } from '../hooks/useReportingMutation';
import { formatMoney, formatTotals, totalsOf, NO_VALUE } from '../helpers/formatMoney';
import { formatDate } from '../helpers/formatDate';
import { STOPPED_REASON_LABEL } from '../configs/stoppedReason';
import { stageLabel } from '../configs/liquidationStages';
import { isTerminalStatus } from '../configs/companyStatus';

// ***************************************************
// * ONE DISSOLVED COMPANY (his call 2026-10-15)
// ***************************************************
// Read only, from the Archive: who ran it, what it paid, and every deal
// that ended with it. Its people open their own page, or their dead
// person page once nothing of theirs is left. Restore is the one write:
// it sets the company back to active and brings back what dissolving it
// stopped, the same as reopening it always did.

const ARCHIVE_CRUMBS = [{ label: 'Archive', to: '/archive?tab=companies' }, { label: 'Companies', to: '/archive?tab=companies' }];

export default function DissolvedCompanyPage() {
  const { key } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company, isLoading, error } = useCompany(key);
  const [restoring, setRestoring] = useState(false);

  const restore = useReportingMutation(() => apiService.companies.update(key, { status: 'active' }), {
    describe: () => company?.name ?? 'Company', verb: 'restored',
    invalidates: [['company', key], ['companies'], ['master-sheet'], ['people'], ['dead-people']],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton pill className="h-3 w-40" />
        <Skeleton pill className="h-7 w-56" />
        <Skeleton className="h-64 !rounded-lg" />
      </div>
    );
  }
  if (error || !company) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[...ARCHIVE_CRUMBS, { label: 'Not found' }]} />
        {error
          ? <ErrorState error={error} title="Couldn't load this company" />
          : <EmptyState icon={BuildingIcon} title="That company was not found" hint="Look for it on the Archive's Companies tab." />}
      </div>
    );
  }

  const deals = company.deals ?? [];
  // WHAT IT WAS PAYING when it was dissolved: the deals dissolving it stopped.
  const ended = deals.filter((d) => d.stopped_reason === 'company_closed');
  const people = (role) => [...new Set(deals.filter((d) => role(String(d.role ?? '').toLowerCase())).map((d) => d.person_name))].join(', ') || NO_VALUE;
  const groups = [...new Set(deals.map((d) => d.group_name).filter(Boolean))];
  const winding = company.winding?.stage ? stageLabel(company.winding.stage, company.winding.stage_kind) : null;
  // Back on the Companies page once it is not dissolved any more.
  const live = !isTerminalStatus(company.status);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[...ARCHIVE_CRUMBS, { label: company.name }]} />
      <PageHeader
        title={company.name}
        subtitle={live
          ? 'Restored. It is on the Companies page again.'
          : `Dissolved${company.closed_on ? ` ${formatDate(company.closed_on)}` : ''}${winding ? ` · ${winding}` : ''}`}
        actions={live
          ? <Button variant="secondary" size="sm" onClick={() => navigate(`/companies/${encodeURIComponent(key)}`)}>Open its page</Button>
          : (
            <Button variant="accent" size="sm" disabled={restore.isPending} onClick={() => setRestoring(true)}>
              <ResumeIcon width={15} height={15} /> Restore company
            </Button>
          )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DetailCard title="Who ran it" fill>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Director" value={people((r) => r === 'director')} lead />
            <Stat label="Mid" value={people((r) => r.startsWith('mid'))} lead />
            <Stat label="Groups" value={groups.join(', ') || NO_VALUE} />
            <Stat label="Tier" value={company.tier || NO_VALUE} />
          </div>
        </DetailCard>
        <DetailCard title="When it ended" fill>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Dissolved" value={company.closed_on ? formatDate(company.closed_on) : NO_VALUE} lead />
            <Stat label="How it ended" value={winding ?? NO_VALUE} lead />
            <Stat label="Deals" value={deals.length} />
            <Stat label="People" value={new Set(deals.map((d) => d.person_id)).size} />
          </div>
        </DetailCard>
        <DetailCard title="What it was paying" fill>
          <div className="space-y-3">
            <Stat label="A month, when dissolved" value={ended.length ? formatTotals(totalsOf(ended)) : NO_VALUE} lead />
            <Stat label="Paid now" value="Nothing: every deal on it has ended." />
            {company.notes && <Stat label="Notes" value={company.notes} />}
          </div>
        </DetailCard>
      </div>

      <DetailCard title={`Deals that ended with it (${deals.length})`} flush>
        <div className="table-wrap">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Role</th>
                <th className="th">Group</th>
                <th className="th text-right tabular-nums">Monthly</th>
                <th className="th">Started</th>
                <th className="th">Ended</th>
                <th className="th">Why it ended</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface-sunken">
                  <td className="td font-medium">
                    {/* Their own page: the People page sends a person with nothing live to Dead people. */}
                    {d.person_id
                      ? <Link className="text-text hover:text-accent hover:underline" to={`/people/${encodeURIComponent(d.person_id)}`}>{d.person_name}</Link>
                      : (d.person_name ?? '(no handler)')}
                  </td>
                  <td className="td">{d.role_label || d.role || NO_VALUE}</td>
                  <td className="td text-text-muted">{d.group_name || NO_VALUE}</td>
                  <td className="td text-right tabular-nums">{formatMoney(d.monthly_amount, d.currency)}</td>
                  <td className="td whitespace-nowrap">{formatDate(d.payment_start_on ?? d.assigned_on)}</td>
                  <td className="td whitespace-nowrap">{d.stopped_on ? formatDate(d.stopped_on) : NO_VALUE}</td>
                  <td className="td text-text-muted">{d.stopped_reason ? (STOPPED_REASON_LABEL[d.stopped_reason] ?? d.stopped_reason) : NO_VALUE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailCard>

      {restoring && (
        <ConfirmDialog
          title={`Restore ${company.name}?`}
          subject={`${ended.length} ${ended.length === 1 ? 'deal comes' : 'deals come'} back.`}
          detail={[
            'It is set back to active and goes back on the Companies page.',
            'The deals dissolving it stopped start again; a deal stopped by hand before stays stopped.',
          ]}
          confirmLabel="Restore company"
          busyLabel="Restoring…"
          onCancel={() => setRestoring(false)}
          onConfirm={() => {
            setRestoring(false);
            restore.mutate(undefined, {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ['companies'] });
                navigate(`/companies/${encodeURIComponent(key)}`);
              },
            });
          }}
        />
      )}
    </div>
  );
}
