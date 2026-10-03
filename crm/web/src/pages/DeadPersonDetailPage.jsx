import { useParams } from 'react-router-dom';
import { useDeadPerson } from '../hooks/useDeadPeople';
import Breadcrumb from '../components/layout/Breadcrumb';
import PageHeader from '../components/layout/PageHeader';
import { DetailCard, Stat } from '../components/layout/DetailLayout';
import { Skeleton } from '../components/display/Skeleton';
import { formatMoney, formatTotals, NO_VALUE } from '../helpers/formatMoney';
import { formatDate } from '../helpers/formatDate';
import { STOPPED_REASON_LABEL } from '../configs/stoppedReason';

// ***************************************************
// * One dead person: who they are, and their journey company by company
// ***************************************************
// Read only. Every figure comes from the server (deadPersonJourney.helper):
// "owed a month" is rated, "recorded" is what the kept months held.

const ARCHIVE_CRUMBS = [{ label: 'Archive', to: '/archive' }, { label: 'Dead persons', to: '/archive' }];

// A set that legitimately differs between their deals: one value, or all of them.
const listed = (values) => ((values ?? []).length > 0 ? values.join(', ') : NO_VALUE);

function Field({ label, values }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="break-words">{listed(values)}</span>
    </div>
  );
}

export default function DeadPersonDetailPage() {
  const { personId } = useParams();
  const { data: person, isLoading, error } = useDeadPerson(personId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton pill className="h-3 w-40" />
        <Skeleton pill className="h-7 w-56" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48 !rounded-lg" />
          <Skeleton className="h-48 !rounded-lg" />
          <Skeleton className="h-48 !rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !person) {
    return (
      <div className="space-y-3">
        <Breadcrumb items={[...ARCHIVE_CRUMBS, { label: 'Not found' }]} />
        <p className="bg-danger-tint px-4 py-2.5 text-sm text-danger">
          {error?.message || 'Not on the dead list. They may hold a live deal again.'}
        </p>
      </div>
    );
  }

  const recorded = person.earnings?.months?.length > 0
    ? `${formatTotals(person.earnings.byCurrency)} over ${person.earnings.months.length} kept ${person.earnings.months.length === 1 ? 'month' : 'months'}`
    : 'No kept month recorded anything';

  return (
    <div className="space-y-4">
      <Breadcrumb items={[...ARCHIVE_CRUMBS, { label: person.display_name }]} />
      <PageHeader
        title={person.display_name}
        subtitle={`No live deal. ${formatDate(person.firstStarted)} to ${formatDate(person.lastStopped)}`}
      />

      {/* Three short cards in one row: stacked two over one, they left half of every card empty. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DetailCard title="Contact" fill>
          <Field label="Email" values={person.email ? [person.email] : []} />
          <Field label="Phone" values={person.phones} />
          <Field label="Door number" values={person.door_numbers} />
          <Field label="Postcode" values={person.postcodes} />
          <Field label="Location" values={person.locations} />
          {person.notes && <Field label="Notes" values={[person.notes]} />}
        </DetailCard>
        <DetailCard title="Banks" fill>
          <Field label="Bank" values={person.bank_details} />
          <Field label="Account number" values={person.account_numbers} />
          <Field label="Sort code" values={person.sort_codes} />
          <Field label="Paid by" values={person.payment_methods} />
        </DetailCard>
        <DetailCard title="Their history" fill>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Deals" value={person.deal_count} lead />
            <Stat label="Companies" value={person.companyCount} lead />
            <Stat label="First started" value={formatDate(person.firstStarted)} />
            <Stat label="Last stopped" value={formatDate(person.lastStopped)} />
          </div>
          <div className="mt-3 space-y-2">
            <Stat label="Recorded as owed" value={recorded} />
            {(person.addon_percent > 0 || person.fee_percent > 0) && (
              <Stat label="Their own rates" value={`add on ${person.addon_percent}%, fee ${person.fee_percent}%`} />
            )}
          </div>
        </DetailCard>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-muted">Journey, company by company</h2>
        {person.companies.map((c) => (
          <DetailCard
            key={`${c.group}|${c.company}`}
            title={`${c.company || '(no company)'} · ${c.group}`}
            action={<span className="text-xs text-text-muted">{`${formatDate(c.startedOn)} to ${formatDate(c.stoppedOn)}`}</span>}
            flush
          >
            <div className="table-wrap">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr>
                    <th className="th">Role</th>
                    <th className="th">Appointed</th>
                    <th className="th">Started</th>
                    <th className="th">Stopped</th>
                    <th className="th">Months</th>
                    <th className="th">Owed a month</th>
                    <th className="th">Why it ended</th>
                  </tr>
                </thead>
                <tbody>
                  {c.deals.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="td font-semibold">{d.role || NO_VALUE}</td>
                      <td className="td whitespace-nowrap">{formatDate(d.appointedOn)}</td>
                      <td className="td whitespace-nowrap">{formatDate(d.startedOn)}</td>
                      <td className="td whitespace-nowrap">{formatDate(d.stoppedOn)}</td>
                      <td className="td tabular-nums">{d.monthsActive}</td>
                      <td className="td tabular-nums">{formatMoney(d.owedMonthly, d.currency)}</td>
                      <td className="td text-text-muted">{STOPPED_REASON_LABEL[d.stoppedReason] ?? d.stoppedReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        ))}
      </div>
    </div>
  );
}
