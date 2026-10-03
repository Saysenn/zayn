import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useOptimisticUpdate } from '../../hooks/useOptimisticUpdate';
import { REVIEW_KEY } from '../../hooks/useMonthlyReview';
import Button from '../buttons/Button';
import Pagination from '../layout/Pagination';
import RecordCard from '../display/RecordCard';
import { Skeleton } from '../display/Skeleton';
import { RestoreIcon } from '../icons';
import { REVIEW_ANSWER_LABEL, REVIEW_ANSWER_LOG_FIELD } from '../../configs/monthlyReview';

/**
 * ***************************************************
 * * What changed recently, and the way back out of it
 * ***************************************************
 *
 * Every cell in this CRM is editable in place, which is fast and is also
 * one keystroke away from a wrong figure on a payout sheet. This is the
 * safety net: the field, the value before, the value now, who did it, and
 * an Undo per entry.
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
  needsReview: 'needs review', paymentOutcome: 'payday outcome',
  overrideShouldBePaid: 'should be paid (override)', overridePaid: 'paid (override)',
  // Set on the PERSON and logged on every deal it reaches, so the label
  // has to say which level. Undo puts the PROFILE back, on every deal.
  personAddonPercent: 'add on % (profile)', personFeePercent: 'fee % (profile)',
  // Set on the COMPANY, logged on each of its deals. Undo puts the COMPANY back.
  companyTier: 'tier (company)', companyOldGroup: 'old group (company)',
  companyNotes: 'notes (company)', companyLiquidationTotal: 'liquidation total (company)',
  [REVIEW_ANSWER_LOG_FIELD]: 'monthly review answer',
};

// A logged value that is a code on the wire, shown as its label. Empty stays empty.
const VALUE_LABELS = { [REVIEW_ANSWER_LOG_FIELD]: REVIEW_ANSWER_LABEL };
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

// The undo, painted before the server answers: the entry greys out, and a
// review answer goes back on the review page's row too.
function paintRevert(old, change) {
  if (old?.changes) {
    const at = new Date().toISOString();
    return { ...old, changes: old.changes.map((c) => (c.id === change.id ? { ...c, reverted_at: at } : c)) };
  }
  if (old?.rows && change.field === REVIEW_ANSWER_LOG_FIELD) {
    return {
      ...old,
      rows: old.rows.map((row) => (row.id === change.row_id ? { ...row, answer: change.old_value ?? null } : row)),
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

// Honest about why the button is not there, rather than offering one that
// would fail. A field no form writes came back 409 every time.
function UndoCell({ change, onUndo }) {
  if (change.reverted_at) return <span className="text-xs text-text-faint">Undone</span>;
  if (!change.row_exists) return <span className="text-xs text-text-faint">Deal deleted</span>;
  if (!change.revertible) return <span className="text-xs text-text-faint">Not hand editable</span>;
  return (
    <Button
      onClick={() => onUndo(change)}
      aria-label={`Undo change to ${FIELD_LABELS[change.field] ?? change.field}`}
    >
      <RestoreIcon width={14} height={14} />
      Undo
    </Button>
  );
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

  const { data, isLoading, error } = useQuery({
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

  // OPTIMISTIC: the whole change goes in, so the field is known before the server answers.
  const revert = useOptimisticUpdate({
    queryKey: [['history'], REVIEW_KEY],
    mutationFn: (change) => apiService.history.revert(change.id),
    applyToCache: paintRevert,
    describe: (change) => FIELD_LABELS[change.field] ?? change.field,
    verb: () => 'put back',
    failVerb: () => 'undo',
    successIcon: 'restore',
    // The undo changed a deal, so every view of that deal is stale.
    alsoInvalidate: [['master-sheet'], ['people'], ['person'], ['companies'], ['company']],
    successKey: 'history-revert',
  });

  const changes = data?.changes ?? [];
  const total = data?.total ?? 0;
  const undo = (change) => revert.mutate(change);

  return (
    <div className="space-y-3">
      {/* THE TOTAL IS IN THE SENTENCE, not left to the pager, which hides
          itself on a single page. "Edits from the last 7 days" over a cut
          list is the same lie the 200 row cap used to tell. */}
      <p className="text-sm text-text-muted">
        {total > 0 && <span className="font-semibold text-text">{total} </span>}
        {total === 1 ? 'edit' : 'edits'} from the last 7 days. Undo puts the old value back and
        records that it happened, nothing is erased from the history.
      </p>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && (
        <p className="bg-danger-tint px-3 py-2 text-sm text-danger">
          {error.message}
        </p>
      )}

      {!isLoading && changes.length === 0 && (
        <p className="border border-border bg-surface-sunken px-3 py-6 text-center text-sm text-text-muted">
          Nothing has been changed in the last 7 days.
        </p>
      )}

      {/* On a phone each change is a card. Six columns of "was" and "now"
          inside a dialog is the narrowest thing in the app, and Undo is the
          point of the whole list, so it has to be reachable rather than
          scrolled to sideways. */}
      {changes.length > 0 && (
        <div className={`flex flex-col gap-2 overflow-y-auto md:hidden ${maxHeight}`}>
          {changes.map((c) => (
            <RecordCard
              key={`${c.id}-card`}
              title={c.person_name}
              subtitle={[c.company, FIELD_LABELS[c.field] ?? c.field].filter(Boolean).join(' · ')}
              facts={[
                { label: 'Was', value: <Value>{shown(c.field, c.old_value)}</Value> },
                { label: 'Now', value: <Value>{shown(c.field, c.new_value)}</Value> },
                {
                  label: 'When',
                  value: `${when(c.changed_at)} · ${VIA_LABELS[c.changed_via] ?? c.changed_via}`,
                  wide: true,
                },
              ]}
              actions={<UndoCell change={c} onUndo={undo} />}
            />
          ))}
        </div>
      )}

      {changes.length > 0 && (
        // overflow-x as well as y, like every other table in the app. A
        // long old value (a note, a joined company list) pushed this one
        // wider than its frame with nothing to scroll it.
        <div className={`hidden overflow-auto rounded-lg border border-border md:block ${maxHeight}`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Who</th>
                <th className="px-3 py-2 font-semibold">Field</th>
                <th className="px-3 py-2 font-semibold">Was</th>
                <th className="px-3 py-2 font-semibold">Now</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id} className={`border-b border-border last:border-0 ${c.reverted_at ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted" title={new Date(c.changed_at).toLocaleString('en-GB')}>
                    {when(c.changed_at)}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{VIA_LABELS[c.changed_via] ?? c.changed_via}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{c.person_name}</span>
                    {c.company && <span className="text-text-muted"> · {c.company}</span>}
                    <br />
                    <span className="text-xs text-text-muted">{FIELD_LABELS[c.field] ?? c.field}</span>
                  </td>
                  <td className="px-3 py-2"><Value>{shown(c.field, c.old_value)}</Value></td>
                  <td className="px-3 py-2"><Value>{shown(c.field, c.new_value)}</Value></td>
                  <td className="px-3 py-2 text-right"><UndoCell change={c} onUndo={undo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hides itself on a single page, so a person with four edits sees
          no furniture. The sentence above still carries the count. */}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  );
}
