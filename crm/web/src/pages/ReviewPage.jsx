import { useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import HistoryModal from '../components/modals/HistoryModal';
import Button from '../components/buttons/Button';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import UnderlineTabs from '../components/layout/UnderlineTabs';
import {
  CheckIcon, HourglassIcon, RestoreIcon, SearchIcon, StopHandIcon,
} from '../components/icons';
import { TableSkeleton } from '../components/display/Skeleton';
import { useMonthlyReview, useAnswerReview } from '../hooks/useMonthlyReview';
import { formatMoney } from '../helpers/formatMoney';
import { reviewReason, countByReason, REVIEW_TABS } from '../helpers/reviewReason';
import { formatDate } from '../helpers/formatDate';
import { confirm } from '../configs/confirms.config';
import {
  REVIEW_ANSWER, REVIEW_ANSWER_LABEL, REVIEW_WAITING_LABEL,
  REVIEW_ANSWER_TONE, REVIEW_WAITING_TONE, REVIEW_ANSWER_LOG_FIELD, monthLabel,
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
    <tr className="border-b border-border last:border-0 hover:bg-surface-sunken">
      <td className="td">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row.id)}
          aria-label={`Select ${row.person_name ?? 'this deal'}`}
        />
      </td>
      <td className="td text-text-muted">{row.group_name}</td>
      <td className="td font-semibold">{row.person_name ?? '(no handler)'}</td>
      {/* NO REASON BADGE ANY MORE: the TAB is the reason, and saying it
          again on every row of a tab called Liquidation is noise. */}
      <td className="td">{row.company ?? '(no company)'}</td>
      <td className="td text-text-muted">{row.role_label}</td>
      <td className="td tabular-nums">{formatMoney(row.monthly_amount, row.currency)}</td>
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
  const { data: rows, period, isLoading } = useMonthlyReview();
  const answer = useAnswerReview();
  const [selected, setSelected] = useState(() => new Set());
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
  const selectAllRef = useRef(null);

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
  const chosen = useMemo(() => list.filter((row) => selected.has(row.id)), [list, selected]);
  const chosenTotal = chosen.reduce((sum, row) => sum + Number(row.monthly_amount ?? 0), 0);

  // A DOM property, not an attribute, so it needs the ref. The third state
  // is what says "some of them", which two buttons cannot express.
  const allSelected = list.length > 0 && chosen.length === list.length;
  if (selectAllRef.current) {
    selectAllRef.current.indeterminate = chosen.length > 0 && !allSelected;
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // OPTIMISTIC: the badge moves now and the hook rolls it back on failure,
  // so the selection and the dialog close without waiting.
  function apply(value) {
    answer.mutate({ dealIds: chosen.map((row) => row.id), answer: value });
    setSelected(new Set());
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
    <div>
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
        onChange={(key) => { setTab(key); setSelected(new Set()); }}
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

      <div className="mt-3">
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
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          /**
           * ===============================
           * * THE ANSWERS ONLY EXIST ONCE THERE IS SOMETHING TO ANSWER
           * ===============================
           * They sat there permanently, three saturated colours side by
           * side, disabled for as long as nothing was ticked. His call
           * 2026-09-29, and he is right: a traffic light showing all three
           * lamps at once is not a signal, it is noise you have to learn to
           * ignore, on the one screen that must not be ignored.
           *
           * Ticking a row is what arms them, so that is when they appear,
           * and the colour then MEANS something. It also puts the count
           * they act on next to them, which no disabled button could say.
           *
           * NOT THE WAITING COUNT AND NOT THE MONEY (his call 2026-09-17).
           * This is how many rows the button in front of it will touch; the
           * waiting count is still the line under the table and the money is
           * still the confirm's.
           */
          actions={chosen.length > 0 ? (
            <>
              <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-text-muted">
                {chosen.length} selected
              </span>
              {/* ===============================
                   * THREE ANSWERS, THREE SHAPES
                   * ===============================
                   * Colour alone was carrying the difference, and two of the
                   * three are a tint apart: at a glance amber and red on the
                   * same row is one decision made by hue. The shape says it
                   * before the colour does, the way the master sheet's row
                   * actions do (a palm is an ending, a bin is a deletion).
                   *
                   *   tick       it runs on, nothing happens
                   *   hourglass  it is paid in full, then time is up
                   *   palm       it stops, and the same palm the sheet uses
                   */}
              <Button variant="primary" onClick={() => press(REVIEW_ANSWER.YES)}>
                <CheckIcon width={15} height={15} />
                {REVIEW_ANSWER_LABEL[REVIEW_ANSWER.YES]}
              </Button>
              <Button variant="warning" onClick={() => press(REVIEW_ANSWER.FINAL)}>
                <HourglassIcon width={15} height={15} />
                {REVIEW_ANSWER_LABEL[REVIEW_ANSWER.FINAL]}
              </Button>
              <Button variant="danger" onClick={() => press(REVIEW_ANSWER.NO)}>
                <StopHandIcon width={15} height={15} />
                {REVIEW_ANSWER_LABEL[REVIEW_ANSWER.NO]}
              </Button>
            </>
          ) : null}
        />

        {!isLoading && list.length === 0 && (
          <p className="p-8 text-center text-sm text-text-muted">
            {query
              ? 'No deal under review matches that.'
              : 'Nothing is up for review. A deal joins this list when its end date passes, '
                + 'or when somebody ticks it.'}
          </p>
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
                  <th className="th w-10">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(
                        allSelected ? new Set() : new Set(list.map((r) => r.id)),
                      )}
                      aria-label="Select all deals under review"
                    />
                  </th>
                  <th className="th">Group</th>
                  <th className="th">Name</th>
                  <th className="th">Company</th>
                  <th className="th">Role</th>
                  <th className="th">Monthly</th>
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
                    selected={selected.has(row.id)}
                    onToggle={toggle}
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
