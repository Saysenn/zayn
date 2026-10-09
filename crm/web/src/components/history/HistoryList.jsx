import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { REVIEW_KEY } from '../../hooks/useMonthlyReview';
import useRowSelection from '../../hooks/useRowSelection';
import useBulkActions, { bulkMessage, patchQueries } from '../../hooks/useBulkActions';
import Pagination from '../layout/Pagination';
import BulkBar, { BulkAction } from '../layout/BulkBar';
import SelectAll from '../forms/SelectAll';
import RecordCard from '../display/RecordCard';
import { Skeleton } from '../display/Skeleton';
import { EmptyState, ErrorState } from '../display/StateBlocks';
import { RestoreIcon, UndoIcon } from '../icons';
import { REVIEW_ANSWER_LABEL, REVIEW_ANSWER_LOG_FIELD } from '../../configs/monthlyReview';

/**
 * ***************************************************
 * * What changed recently, and the way back out of it
 * ***************************************************
 *
 * Every cell in this CRM is editable in place, which is fast and is also
 * one keystroke away from a wrong figure on a payout sheet. This is the
 * safety net: the field, the value before, the value now, who did it, and
 * Undo on the bulk bar for whatever you tick.
 *
 * UNDO IS ITSELF AN EDIT, not a deletion. Reverting writes the old value
 * back through the normal update path, which logs a fresh entry, so "who
 * undid that" stays answerable. The original entry is marked reverted
 * rather than removed, because an audit trail that erases its own history
 * to look tidier is not an audit trail.
 *
 * THE LIST, NOT THE FRAME. Two things draw it: `modals/HistoryModal` on a
 * person, a company or one deal, and `pages/HistoryPage` on everything.
 * They were one file and the page would have been a second copy of the
 * labels, the revert hook and both layouts.
 *
 * `rowId` narrows to one deal. `personId` and `company` follow every current
 * deal in that detail page's scope. `field` narrows to one column, which is
 * how the Review page shows its own answers. All four off is the global
 * history.
 */

// 'sync' is whatbot pushing its copy back; 'upload' is a human putting a
// file in. They were both called "by an upload" while only one of them
// could actually happen, and since migration 033 both can.
const VIA_LABELS = {
  admin: 'by an admin',
  diane: 'by Diane',
  sync: 'by whatbot',
  import: 'by an import',
};

// Field keys are camelCase in the log (that is what update() records).
// This turns them into what the column is actually called on screen.
export const FIELD_LABELS = {
  // Not a column. A delete is one fact about a whole row, so it is one
  // entry rather than thirty-one saying a column went to nothing.
  deleted: 'the whole row',
  personName: 'name', groupName: 'group', roleLabel: 'role', company: 'company',
  monthlyAmount: 'monthly amount', payableAmount: 'payable amount', payableDays: 'payable days',
  currency: 'currency', paymentMethod: 'payment method', phone: 'phone',
  paymentStartOn: 'payment start date', presetOn: 'preset date', endOn: 'end date',
  assignedOn: 'appointment date', location: 'location', doorNumber: 'door number',
  postcode: 'postcode', acceptingPostals: 'accepting postals', bankDetails: 'bank',
  accountNumber: 'account number', sortCode: 'sort code', label: 'label',
  shouldBePaid: 'should be paid', paid: 'paid', notes: 'notes', status: 'status',
  needsReview: 'needs review', paymentOutcome: 'payment received', specialCaseDeal: 'special case',
  stoppedOn: 'stopped on',
  overrideShouldBePaid: 'should be paid', overridePaid: 'paid',
  // Set on the PERSON and logged on every deal it reaches, so the label
  // has to say which level. Undo puts the PROFILE back, on every deal.
  personAddonPercent: 'add on % (profile)', personFeePercent: 'fee % (profile)',
  // Set on the COMPANY, logged on each of its deals. Undo puts the COMPANY back.
  companyTier: 'tier (company)', companyOldGroup: 'old group (company)',
  companyNotes: 'notes (company)', companyLiquidationTotal: 'liquidation total (company)',
  [REVIEW_ANSWER_LOG_FIELD]: 'monthly review answer',
};

// A logged value that is a code on the wire, shown as its label. Empty stays empty.
const VALUE_LABELS = {
  [REVIEW_ANSWER_LOG_FIELD]: REVIEW_ANSWER_LABEL,
  // The payday outcome, in the words Payment received shows. See PaymentReceived.
  paymentOutcome: { confirmed: 'Paid', not_received: 'Unpaid', partial: 'Portion', sent: 'Awaiting', no_response: 'Awaiting' },
};
const shown = (field, value) => VALUE_LABELS[field]?.[value] ?? value;

// A week, not a day: an edit made last Friday is exactly the one somebody
// wants back on Monday.
const WINDOW_HOURS = 168;

// ===============================
// * PAGED, BECAUSE A CAP YOU CANNOT SEE IS THE BUG
// ===============================
// It fetched a flat 200 with no total, so a busy week cut silently and the
// list looked complete. Paging is also what makes the unscoped PAGE usable:
// the modal is a scroll box, a page is the whole audit trail.
const PAGE_SIZE = 25;

// Only a change Undo could actually put back can be ticked: an undone one,
// one whose deal is gone, or a field no form writes would only come back
// in the toast as "failed".
const canUndo = (c) => !c.reverted_at && c.row_exists && c.revertible;

// What a bulk undo leaves stale: the deal it changed, everywhere it shows.
const UNDO_TOUCHES = [
  ['history'], ['master-sheet'], ['people'], ['companies'], ['company'], ['person'], ['monthly-review'],
];

// The undo, painted before the server answers: the entries grey out and
// say Undone, and a review answer goes back on the review page's row too.
function paintRevert(old, changes) {
  const byId = new Map(changes.map((c) => [c.id, c]));
  if (old?.changes) {
    const at = new Date().toISOString();
    return { ...old, changes: old.changes.map((c) => (byId.has(c.id) ? { ...c, reverted_at: at } : c)) };
  }
  const answers = new Map(changes.filter((c) => c.field === REVIEW_ANSWER_LOG_FIELD).map((c) => [c.row_id, c]));
  if (old?.rows && answers.size) {
    return {
      ...old,
      rows: old.rows.map((row) => (answers.has(row.id) ? { ...row, answer: answers.get(row.id).old_value ?? null } : row)),
    };
  }
  return old;
}

function when(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Value({ children }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <span className={empty ? 'text-text-faint' : 'font-semibold'}>{empty ? 'empty' : children}</span>
  );
}

// Why a change cannot be ticked, said beside its value rather than left
// as a mystery disabled checkbox. Undone is the common one: the entry
// stays in the trail, faint, marked as put back.
function UndoNote({ change }) {
  let text = null;
  if (change.reverted_at) text = 'Undone';
  else if (!change.row_exists) text = 'Deal deleted';
  else if (!change.revertible) text = 'Not hand editable';
  if (!text) return null;
  return <span className="badge badge-sm ml-1.5 whitespace-nowrap bg-surface-sunken text-text-faint">{text}</span>;
}

/**
 * `maxHeight` is the frame's call, not the list's: inside a dialog the
 * table has to stay within it, on a page the page itself scrolls.
 */
export default function HistoryList({
  rowId, personId, company, field, maxHeight = '',
}) {
  const [page, setPage] = useState(1);

  // Back to page one whenever the SCOPE changes, or a narrower list opens
  // on page four of a wider one and reads as empty.
  useEffect(() => setPage(1), [rowId, personId, company, field]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['history', {
      rowId: rowId ?? null, personId: personId ?? null, company: company ?? null, field: field ?? null,
      page,
    }],
    queryFn: () => apiService.history.list({
      hours: WINDOW_HOURS, page, pageSize: PAGE_SIZE, rowId, personId, company, field, includeReverted: true,
    }),
    // The page you are on stays drawn while the next one loads, so paging
    // does not blink back to a skeleton on every press.
    placeholderData: (prev) => prev,
  });

  const changes = data?.changes ?? [];
  const total = data?.total ?? 0;

  // One row is one change id, so the ticked ids ARE the change ids.
  const sel = useRowSelection(changes.filter(canUndo).map((c) => c.id));
  const { run } = useBulkActions();

  // Greyed and marked Undone at once; back as they were if it fails.
  function undoSelected() {
    const ticked = changes.filter((c) => sel.has(c.id));
    const n = ticked.length;
    run({
      call: () => apiService.history.revertMany({ ids: ticked.map((c) => c.id) }),
      invalidates: UNDO_TOUCHES,
      optimistic: (qc) => patchQueries(qc, [['history'], REVIEW_KEY], (old) => paintRevert(old, ticked)),
      icon: 'undo',
      toast: bulkMessage('undone', n, 'change'),
      failure: `Couldn't undo ${n} ${n === 1 ? 'change' : 'changes'}`,
      report: (res) => {
        const failed = Array.isArray(res?.failed) ? res.failed.length : Number(res?.failed) || 0;
        return bulkMessage('undone', res?.reverted ?? 0, 'change', [[failed, 'could not be put back']]);
      },
    });
    sel.clear();
  }

  return (
    <div className="space-y-3">
      {/* THE TOTAL IS IN THE SENTENCE, not left to the pager, which hides
          itself on a single page. "Edits from the last 7 days" over a cut
          list is the same lie the 200 row cap used to tell. */}
      <p className="text-sm text-text-muted">
        {total > 0 && <span className="font-semibold text-text">{total} </span>}
        {total === 1 ? 'edit' : 'edits'} from the last 7 days. Tick one and Undo puts the old value back and
        records that it happened, nothing is erased from the history.
      </p>

      {isLoading && <Skeleton className="h-40 w-full" />}
      <ErrorState error={error} title="Couldn't load the history" onRetry={refetch} />

      {!isLoading && !error && changes.length === 0 && (
        <EmptyState icon={RestoreIcon} title="Nothing has been changed in the last 7 days" />
      )}

      {/* On a phone each change is a card. Six columns of "was" and "now"
          inside a dialog is the narrowest thing in the app. */}
      {changes.length > 0 && (
        <div className={`flex flex-col gap-2 overflow-y-auto md:hidden ${maxHeight}`}>
          {changes.map((c) => (
            <RecordCard
              key={`${c.id}-card`}
              title={c.person_name}
              subtitle={[c.company, FIELD_LABELS[c.field] ?? c.field].filter(Boolean).join(' · ')}
              selected={sel.has(c.id)}
              onSelect={canUndo(c) ? () => sel.toggle(c.id) : undefined}
              selectLabel="Select change"
              facts={[
                { label: 'Was', value: <Value>{shown(c.field, c.old_value)}</Value> },
                { label: 'Now', value: <><Value>{shown(c.field, c.new_value)}</Value><UndoNote change={c} /></> },
                {
                  label: 'When',
                  value: `${when(c.changed_at)} · ${VIA_LABELS[c.changed_via] ?? c.changed_via}`,
                  wide: true,
                },
              ]}
            />
          ))}
        </div>
      )}

      {changes.length > 0 && (
        // overflow-x as well as y, like every other table in the app. A
        // long old value (a note, a joined company list) pushed this one
        // wider than its frame with nothing to scroll it.
        <div className={`table-wrap hidden overflow-auto md:block ${maxHeight}`}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th w-8"><SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} /></th>
                <th className="th">When</th>
                <th className="th">Who</th>
                <th className="th">Field</th>
                <th className="th">Was</th>
                <th className="th">Now</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr
                  key={c.id}
                  className={`hover:bg-surface-sunken ${sel.has(c.id) ? 'row-selected' : ''} ${c.reverted_at ? 'opacity-50' : ''}`}
                >
                  <td className="td w-8">
                    <input
                      type="checkbox"
                      checked={sel.has(c.id)}
                      disabled={!canUndo(c)}
                      onChange={() => sel.toggle(c.id)}
                      aria-label={`Select change to ${FIELD_LABELS[c.field] ?? c.field}`}
                    />
                  </td>
                  <td className="td whitespace-nowrap text-text-muted" title={new Date(c.changed_at).toLocaleString('en-GB')}>
                    {when(c.changed_at)}
                  </td>
                  <td className="td text-text-muted">{VIA_LABELS[c.changed_via] ?? c.changed_via}</td>
                  <td className="td whitespace-normal">
                    <span className="font-medium text-text">{c.person_name}</span>
                    {c.company && <span className="text-text-muted"> · {c.company}</span>}
                    <br />
                    <span className="text-xs text-text-muted">{FIELD_LABELS[c.field] ?? c.field}</span>
                  </td>
                  <td className="td whitespace-normal"><Value>{shown(c.field, c.old_value)}</Value></td>
                  <td className="td whitespace-normal">
                    <Value>{shown(c.field, c.new_value)}</Value>
                    <UndoNote change={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hides itself on a single page, so a person with four edits sees
          no furniture. The sentence above still carries the count. */}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={UndoIcon} onClick={undoSelected}>Undo</BulkAction>
      </BulkBar>
    </div>
  );
}
