import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { COMPANY_STATUS, COMPANY_STATUS_OPTIONS, COMPANY_STATUS_MEANS, asksMonthly } from '../../configs/companyStatus';
// His word, from the one file that spells his phrases. The tick IS this
// string, so the checklist reads the same constant the cell tag does.
import { GOING_CONCERN } from '../../configs/sheetValues';
import DealChecklist from '../forms/DealChecklist';

/**
 * ***************************************************
 * * THE STATUS, AND WHAT IT DOES TO THE DEALS UNDER IT
 * ***************************************************
 *
 * A SELECT WAS THE WRONG SHAPE. Six statuses, each with a different
 * consequence for money, and a dropdown shows one at a time with its
 * meaning underneath. You had to open it, read, close, open again.
 *
 * ONE ROW, AND ONE SENTENCE. Stacked cards with a meaning each made a half
 * column of the modal taller than everything beside it and asked you to
 * read six consequences to pick one. The row is the control, the sentence
 * under it is the consequence OF THE CHOICE, and it changes as the choice
 * does.
 *
 * AND TWO OF THEM ASK A SECOND QUESTION. Liquidation and review are both
 * where somebody decides, per deal, which ones this actually touches. It
 * appears in place, under the row, only where the caller can save it: pass
 * `onReviewIds` and it is asked, leave it out and it is not.
 *
 * IN THIS MODAL, NOT A SECOND ONE. A popup that opens a popup is where a
 * decision gets made twice and saved once.
 */

/**
 * ===============================
 * * THREE STATUSES ASK ABOUT THEIR DEALS, AND NOT ALL THE SAME QUESTION
 * ===============================
 * Liquidation and Review ask WHICH ARE REVIEWED every month. Going concern
 * asks WHICH HAVE NO END DATE, and writes his word into the cell.
 *
 * Two lists, never one. Folding them together would put Going concern
 * deals into the monthly review, which is the one thing his word must not
 * do: a blank end date is what it already means.
 */
const ASKS = [
  {
    key: 'review',
    when: asksMonthly,
    label: 'Reviewed monthly',
    // What a stored deal looks like when it is already ticked.
    ticked: (d) => Boolean(d.review_monthly),
    note: (
      <>
        Ticked deals join the Review list every month and their end date reads
        {' '}
        <em>Reviewed monthly</em>
        {' '}
        instead of a date.
      </>
    ),
  },
  {
    key: 'goingConcern',
    when: (status) => status === COMPANY_STATUS.GOING_CONCERN,
    label: 'Deals with no end date',
    ticked: (d) => d.end_note === GOING_CONCERN,
    note: (
      <>
        Ticked deals read
        {' '}
        <em>Going concern</em>
        {' '}
        instead of a date, and
        {' '}
        <strong>their end dates are cleared</strong>
        . Unticking puts the word back to blank; it cannot bring a date back.
      </>
    ),
  },
];

export default function CompanyStatusPicker({
  value,
  onChange,
  deals,
  reviewIds,
  onReviewIds,
  // The Going concern answer. Same shape as the pair above, and absent on
  // callers that cannot save it.
  goingConcernIds,
  onGoingConcernIds,
  // Anything true of THIS company beyond what the status means, e.g. the
  // date it closed. Sits with the meaning, because both answer "and so?".
  note,
  className = '',
  disabled = false,
}) {
  // One group per instance, so two pickers on one screen cannot steal each
  // other's selection through a shared radio name.
  const group = useId();
  const live = useMemo(() => (deals ?? []).filter((d) => !d.stopped_on), [deals]);
  const [touched, setTouched] = useState(false);

  // Which question this status asks, if any. The caller only gets asked
  // one it can save the answer to.
  const handlers = { review: onReviewIds, goingConcern: onGoingConcernIds };
  const chosen = { review: reviewIds, goingConcern: goingConcernIds };
  const ask = ASKS.find((a) => a.when(value) && typeof handlers[a.key] === 'function');
  const onIds = ask ? handlers[ask.key] : null;

  /**
   * ===============================
   * * SEEDED FROM WHAT IS ACTUALLY TICKED, NEVER FROM "ALL"
   * ===============================
   * It read the company's STATUS to decide: already Liquidation or Review
   * meant "read the deals", anything else meant "tick everything". So a
   * company sitting on Active with two deals ticked by the import opened
   * showing all five, and Save turned two into five with nobody choosing
   * the other three. A deal in that queue is one somebody can answer "no"
   * to, which stops paying them. Found 2026-09-22.
   *
   * The deals themselves are the answer, and they always were. If ANY is
   * ticked, that is what somebody decided; "all of them" is only the
   * default when nobody has decided anything yet.
   *
   * Once, not on every render, or it would fight an untick.
   */
  useEffect(() => {
    if (!ask || touched) return;
    const already = live.filter(ask.ticked);
    onIds((already.length > 0 ? already : live).map((d) => d.id));
  }, [ask, live, touched, onIds]);

  // Any tick at all, including a select all, ends the defaulting above.
  const choose = useCallback((ids) => {
    setTouched(true);
    if (onIds) onIds(ids);
  }, [onIds]);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-semibold text-text-muted">Status</span>

      {/* ALL OF THEM ON ONE ROW, wrapping rather than scrolling: six short
          words fit a modal column and a detail card at any width. */}
      <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1">
        {COMPANY_STATUS_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-md border px-2 py-1 text-xs transition
              focus-within:ring-1 focus-within:ring-accent
              ${value === o.value
                ? 'border-accent bg-accent-tint font-semibold text-accent-strong'
                : 'border-border text-text-muted hover:bg-surface-sunken'}
              ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          >
            {/* The pill IS the control, so the dot is hidden rather than
                drawn beside a word that already says it is chosen. */}
            <input
              type="radio"
              name={group}
              className="sr-only"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              disabled={disabled}
            />
            {o.label}
          </label>
        ))}
      </div>

      {/* THE CHOSEN ONE'S CONSEQUENCE, under the row, not in a tooltip: which
          of them still pays is what somebody needs before clicking. */}
      <p className="text-xs leading-4 text-text-faint">
        {COMPANY_STATUS_MEANS[value]}
        {note ? ` ${note}` : ''}
      </p>

      {/* APPEARS WITH THE CHOICE, in place, live. Not a second modal.
          ONE checklist at a time: a status asks one question, and two lists
          on screen would ask somebody to hold two meanings of a tick. */}
      {ask && (
        <DealChecklist
          label={ask.label}
          deals={live}
          chosen={chosen[ask.key]}
          onChosen={choose}
          disabled={disabled}
          note={ask.note}
        />
      )}
    </div>
  );
}
