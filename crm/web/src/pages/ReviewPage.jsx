import { useMemo, useState } from 'react';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import HistoryModal from '../components/modals/HistoryModal';
import Button from '../components/buttons/Button';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import UnderlineTabs from '../components/layout/UnderlineTabs';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import SelectAll from '../components/forms/SelectAll';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import useRowSelection from '../hooks/useRowSelection';
import {
  CheckIcon, HourglassIcon, RestoreIcon, SearchIcon, StopHandIcon,
} from '../components/icons';
import { TableSkeleton } from '../components/display/Skeleton';
import { useMonthlyReview } from '../hooks/useMonthlyReview';
import useBulkActions, { DEAL_TOUCHES, bulkMessage, patchQueries } from '../hooks/useBulkActions';
import { apiService } from '../configs/api.config';
import { countOf } from '../helpers/pluralNoun';
import { formatMoney } from '../helpers/formatMoney';
import { reviewReason, countByReason, REVIEW_TABS } from '../helpers/reviewReason';
import { formatDate } from '../helpers/formatDate';
import { confirm } from '../configs/confirms.config';
import {
  REVIEW_ANSWER, REVIEW_ANSWER_LABEL, REVIEW_WAITING_LABEL,
  REVIEW_ANSWER_TONE, REVIEW_WAITING_TONE, REVIEW_ANSWER_LOG_FIELD, REVIEW_ANSWER_LEAVES_LIST, monthLabel,
} from '../configs/monthlyReview';

/**
 * ***************************************************
 * * Is this deal still running this month?
 * ***************************************************
 *
 * Past its end date a deal stops being automatic. This is the screen that
 * asks, once a month, and two of the three answers stop somebody being
 * paid. See docs/closure.md section 5.
 *
 * A PAGE, NOT A MODAL. His call 2026-09-29. It was reached by a button that
 * only appeared while something was waiting, so the one screen in the CRM
 * whose job is asking a question could not be opened to check it had been
 * answered. A dialog is also the wrong shape for a nine column table with a
 * search over it, and nothing here is a step inside another task.
 *
 * THE MONTH IS NOT A CONTROL. The subtitle names the month because an answer
 * is stored per month and a screen that does not say which is a screen two
 * people answer differently across a boundary. There is no picker: the
 * server decides from the business timezone.
 */

/**
 * ===============================
 * * A CHECKBOX, THE SAME ONE THE MASTER SHEET SELECTS ROWS WITH
 * ===============================
 * This was `forms/Toggle`, which is red when OFF by design: it is a yes/no
 * FACT about a deal (should be paid, paid), and the red means no. On a
 * selection column that made thirty three unselected rows read as thirty
 * three alarms, on the one screen whose job is telling you what needs
 * attention.
 *
 * Selection is not a fact about the deal. It is "is this row in the batch
 * I am about to answer", which is what a checkbox means everywhere else in
 * the CRM, and it matches the Select all above it.
 */
function ReviewRow({ row, selected, onToggle }) {
  return (
    <tr className={`border-b border-border last:border-0 hover:bg-surface-sunken ${selected ? 'row-selected' : ''}`}>
      <td className="td w-8">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row.id)}
          aria-label={`Select ${row.person_name ?? 'this deal'}`}
        />
      </td>
      <td className="td text-text-muted">{row.group_name}</td>
      <td className="td font-medium text-text">{row.person_name ?? '(no handler)'}</td>
      {/* NO REASON BADGE ANY MORE: the TAB is the reason, and saying it
          again on every row of a tab called Liquidation is noise. */}
      <td className="td">{row.company ?? '(no company)'}</td>
      <td className="td text-text-muted">{row.role_label}</td>
      <td className="td text-right tabular-nums">{formatMoney(row.monthly_amount, row.currency)}</td>
      <td className="td whitespace-nowrap text-text-muted">{formatDate(row.payment_start_on)}</td>
      {/* HIS WORDS, NOT A DASH, and not a BADGE either. A reviewed monthly
          deal has no end date by definition, so the column printed "—" on
          the one row whose reason for being here IS the phrase in that cell.
          The master sheet draws it as a badge because it is one row among
          ninety six; here every row of a tab carries the same phrase, so
          eleven amber pills down the page said nothing eleven times. Same
          argument as the reason badge above, and his call 2026-09-29. */}
      <td className="td whitespace-nowrap text-text-muted">
        {row.end_note || formatDate(row.end_on)}
      </td>
      <td className="td">
        <span className={`badge badge-${REVIEW_ANSWER_TONE[row.answer] ?? REVIEW_WAITING_TONE}`}>
          {REVIEW_ANSWER_LABEL[row.answer] ?? REVIEW_WAITING_LABEL}
        </span>
      </td>
    </tr>
  );
}

export default function ReviewPage() {
  const { data: rows, period, isLoading, error, refetch } = useMonthlyReview();
  const { run } = useBulkActions();
  const [query, setQuery] = useState('');
  /**
   * ===============================
   * * ONE TAB PER REASON, and the answers act on the tab
   * ===============================
   * His call 2026-09-21. Thirty deals in one list is one screen about
   * three different situations: a company winding down, one he has put
   * under review, and a deal past its year. They need different answers,
   * and "yes to all" over the lot is the bulk act nobody meant.
   *
   * THE ORDER AND THE RULE ARE helpers/reviewReason's, mirroring the
   * server's, so the tab a row lands on is the heading Diane reads it out
   * under.
   */
  const [tab, setTab] = useState(REVIEW_TABS[0].key);
  // Only no and final get a dialog. Yes changes nothing and stops nothing,
  // so a confirm on it is the click that teaches people not to read them.
  const [confirming, setConfirming] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // FILTERED IS THE LIST EVERYTHING ELSE READS, so Select all, the count
  // beside it and the three buttons all act on what is actually on screen.
  // A search that narrows the table but not the button is a bulk act over
  // rows you cannot see.
  const list = useMemo(() => {
    const all = (rows ?? []).filter((row) => reviewReason(row) === tab);
    const want = query.trim().toLowerCase();
    if (!want) return all;
    return all.filter((row) => (
      `${row.person_name ?? ''} ${row.company ?? ''} ${row.group_name ?? ''}`
        .toLowerCase().includes(want)
    ));
  }, [rows, query, tab]);

  // Across the WHOLE queue, never the current tab: a tab showing its own
  // count would read as the number left to do rather than what is in it.
  const counts = useMemo(() => countByReason(rows), [rows]);

  const waiting = useMemo(() => list.filter((row) => !row.answer), [list]);
  // The shared selection, cut back to what is on screen: a search or a tab
  // change can never leave a hidden row in the batch.
  const listIds = useMemo(() => list.map((row) => row.id), [list]);
  const sel = useRowSelection(listIds);
  const chosen = useMemo(() => list.filter((row) => sel.has(row.id)), [list, sel]);
  const chosenTotal = chosen.reduce((sum, row) => sum + Number(row.monthly_amount ?? 0), 0);

  // OPTIMISTIC: the badge moves now, an answer that ends the deal takes
  // the row off the list now, and the toast says so at once. A failure
  // puts every row back and says why. Nothing waits for the server.
  function apply(value) {
    const dealIds = chosen.map((row) => row.id);
    const ids = new Set(dealIds);
    run({
      call: () => apiService.monthlyReview.answer(dealIds, value),
      invalidates: DEAL_TOUCHES,
      optimistic: (qc) => patchQueries(qc, [['monthly-review']], (old) => {
        // The pending query has no rows and is left alone.
        if (!Array.isArray(old?.rows)) return old;
        return {
          ...old,
          rows: old.rows
            .map((row) => (ids.has(row.id) ? { ...row, answer: value } : row))
            .filter((row) => !REVIEW_ANSWER_LEAVES_LIST.includes(row.answer)),
        };
      }),
      toast: bulkMessage('answered', dealIds.length, 'deal'),
      report: (data) => bulkMessage('answered', data?.answered?.length ?? dealIds.length, 'deal'),
      failure: `Couldn't answer ${countOf(dealIds.length, 'deal')}`,
    });
    sel.clear();
    setConfirming(null);
  }

  function press(value) {
    if (chosen.length === 0) return;
    // Yes applies straight away. The other two stop money, so they go
    // through a dialog that names the deals and says what survives.
    if (value === REVIEW_ANSWER.YES) { apply(value); return; }
    setConfirming(value);
  }

  return (
    <div className="space-y-4">
      {/* ===============================
           * ONE BLOCK OF WORDS, NOT THREE
           * ===============================
           * It was a title, a subtitle AND a paragraph, his call 2026-09-29:
           * overwhelming before a single row had been read. The three
           * reasons a deal is here are what the TABS say and where an
           * answered row goes is what the CONFIRM says, so neither needs
           * prose repeating it.
           *
           * What is left is the question and the one fact nothing else on
           * screen carries: doing nothing is not neutral.
           *
           * THE MONTH IS HERE, not in the title. The sidebar says Review and
           * the heading has to say the same word, or the page you landed on
           * is not the one you pressed. */}
      <PageHeader
        title="Review"
        subtitle={(
          <>
            Is this deal still running in {monthLabel(period)}?{' '}
            <span className="font-semibold text-text">Nothing stops on its own:</span>{' '}
            an unanswered deal keeps being paid.
          </>
        )}
      />

      {/* ===============================
           * ONE TAB PER REASON, ABOVE THE TOOLBAR
           * ===============================
           * Underline tabs, the one place a thick accent edge is allowed
           * (CLAUDE.md). A tab with nothing in it is still shown, with a
           * zero: hiding it would move the tabs under somebody's hand as
           * they answer rows.
           *
           * Switching tabs CLEARS THE SELECTION. Carrying ticks across would
           * mean "yes to all" acting on rows from a tab nobody is looking
           * at, which is the bulk act this split exists to prevent. */}
      <UnderlineTabs
        tabs={REVIEW_TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        active={tab}
        onChange={(key) => { setTab(key); sel.clear(); }}
        action={(
          /* ===============================
             * THE WAY BACK, ON THE TAB ROW
             * ===============================
             * It was fourth in a row of three coloured answers, which put a
             * harmless reading control inside a group that stops people
             * being paid. Then it was a page header action, which is where
             * page level actions go but left it a long way from the rows.
             * His call 2026-09-29: the end of the tab rule, which is the
             * most reachable empty space on the page and the one place that
             * belongs to the whole list rather than to a selection.
             *
             * `accent`, SOFT. Quiet grey read as decoration up here; a solid
             * green would read as a fourth answer. The app's own colour at
             * tint strength says "this belongs to the CRM" and nothing more.
             */
          <Button
            variant="accent"
            onClick={() => setShowHistory(true)}
            aria-label="History of review answers"
          >
            <RestoreIcon width={15} height={15} />
            History
          </Button>
        )}
      />

      <div className="space-y-3">
        {/* THE PAGE'S OWN TOOLBAR, the one every list page uses. It was a
            hand rolled sticky row because a modal has no toolbar; on a page
            a second idea of where the search goes is the thing `Toolbar`
            exists to stop. No filter row: the tabs are the filter. */}
        {/* NO `count` ON IT. His call 2026-09-17: the waiting count is the
            line under the table, and the money it carries is a figure
            nobody acts on from this row. The confirm names both for the
            rows actually selected, which is where it decides anything. */}
        <Toolbar
          search={(
            <SearchInput
              icon={SearchIcon}
              placeholder="Search people or companies…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        />

        <ErrorState error={error} title="Couldn't load the review" onRetry={refetch} />

        {!isLoading && !error && list.length === 0 && (
          <EmptyState
            icon={CheckIcon}
            title={query ? 'No deal under review matches that' : 'Nothing is up for review'}
            hint={query ? undefined : 'A deal joins this list when its end date passes, or when somebody ticks it.'}
          />
        )}

        {(isLoading || list.length > 0) && (
          <div className="table-wrap">
            <table className="w-full min-w-[900px] text-sm">
              {/* STICKY, because the select all lives in it and a control
                  that scrolls out of reach on row twelve is a control you
                  have to scroll back for. z-20 is the sticky header layer
                  (CLAUDE.md). */}
              <thead className="sticky top-0 z-20 bg-surface">
                <tr>
                  {/* SELECT ALL SITS IN THE HEADER, over the column it acts
                      on, the way the master sheet does it. It was in the
                      toolbar with a label, which put it a row away from the
                      boxes it ticks and spent width saying what its position
                      already says. */}
                  <th className="th w-8">
                    <SelectAll
                      count={sel.count}
                      total={sel.total}
                      onChange={sel.setAll}
                      ariaLabel="Select all deals under review"
                    />
                  </th>
                  <th className="th">Group</th>
                  <th className="th">Name</th>
                  <th className="th">Company</th>
                  <th className="th">Role</th>
                  <th className="th text-right tabular-nums">Monthly</th>
                  <th className="th">Payment start</th>
                  <th className="th">End date</th>
                  <th className="th">Answer</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableSkeleton rows={8} columns={9} />}
                {!isLoading && list.map((row) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    selected={sel.has(row.id)}
                    onToggle={sel.toggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The consequence moved to the TOP, where it is read. This is just
            the count, and only while there is one. */}
        {waiting.length > 0 && (
          <p className="mt-2 text-xs text-text-faint">
            {waiting.length} of the {list.length} shown still waiting.
          </p>
        )}
      </div>

      {showHistory && (
        <HistoryModal
          title="Recent review answers"
          field={REVIEW_ANSWER_LOG_FIELD}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ===============================
           * THE ANSWERS ONLY EXIST ONCE THERE IS SOMETHING TO ANSWER
           * ===============================
           * His call 2026-09-29: three answers always on screen, disabled
           * until a tick, were a traffic light with every lamp lit. They
           * live in the bulk bar now, which only rises once a row is
           * ticked, and it carries the count they act on.
           *
           * THREE ANSWERS, THREE SHAPES. A tick runs on, the hourglass is
           * paid in full and then time is up, the palm stops, the same palm
           * the master sheet uses, and red like it: No ends somebody's
           * pay. Final and No still confirm first. */}
      <BulkBar count={sel.count} noun="deal" onClear={sel.clear}>
        <BulkAction icon={CheckIcon} onClick={() => press(REVIEW_ANSWER.YES)}>
          {REVIEW_ANSWER_LABEL[REVIEW_ANSWER.YES]}
        </BulkAction>
        <BulkAction icon={HourglassIcon} onClick={() => press(REVIEW_ANSWER.FINAL)}>
          {REVIEW_ANSWER_LABEL[REVIEW_ANSWER.FINAL]}
        </BulkAction>
        <BulkAction icon={StopHandIcon} variant="danger" onClick={() => press(REVIEW_ANSWER.NO)}>
          {REVIEW_ANSWER_LABEL[REVIEW_ANSWER.NO]}
        </BulkAction>
      </BulkBar>

      {confirming && (
        <ConfirmDialog
          {...confirm.answerReview({
            answer: confirming,
            count: chosen.length,
            names: chosen.map((row) => row.person_name ?? '(no handler)'),
            money: formatMoney(chosenTotal, chosen[0]?.currency),
            month: monthLabel(period),
          })}
          onCancel={() => setConfirming(null)}
          onConfirm={() => apply(confirming)}
        />
      )}
    </div>
  );
}
