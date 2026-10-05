/**
 * Every "are you sure" in the CRM: what it asks, and what it says survives.
 *
 * ONE FUNCTION PER CONFIRM. Call it and spread the result:
 *
 *   <ConfirmDialog
 *     {...confirm.deleteRow(row)}
 *     icon={<TrashIcon width={15} height={15} />}
 *     busy={deleteRow.isPending}
 *     onCancel={() => setDeleting(null)}
 *     onConfirm={() => …}
 *   />
 *
 * WORDS ONLY. `title`, `subject`, `detail`, `confirmLabel`, `busyLabel`.
 * The behaviour — `busy`, `onConfirm`, `onCancel` — and the `icon`, which
 * is JSX, stay at the call site. This file must never need a React import.
 *
 * ---- the rule every entry here follows ----
 * SAY WHAT SURVIVES, not "this cannot be undone". The second is true of
 * everything on this list and tells nobody anything; the first is the fact
 * somebody actually needs before pressing. Deleting a person keeps their
 * deals. Deleting a company keeps its deals. Deleting a deal keeps the
 * person and the company. If a new entry cannot answer "and what is left
 * afterwards", it is not finished.
 *
 * `detail` may be an ARRAY when the answer needs more than one paragraph:
 * what goes, then where it now needs attention, then the reversible
 * alternative if there is one.
 */

export const confirm = {

  // ── one row ────────────────────────────────────────────────────────────

  deleteRow: ({ personName, company, groupName, roleLabel, money, fromSheet }) => ({
    title: 'Delete this row?',
    subject: `${personName ?? '(no handler)'} on ${company ?? groupName} as ${roleLabel}, `
      + `${money} a month.`,
    // The one confirm whose consequence depends on where the row came from.
    // A hand-added row is held nowhere else; a synced one comes back.
    detail: fromSheet
      ? 'It comes back on the next imported sheet, unless that sheet dropped it too.'
      : 'Added here by an admin, so nothing else holds it. Gone for good.',
    confirmLabel: 'Delete row',
  }),

  // ===============================
  // * STOP IS THE REVERSIBLE ONE, AND THE CONFIRM HAS TO SAY SO
  // ===============================
  // Beside Delete on the same row, so the difference is the only thing
  // worth reading: Delete takes the row away, Stop keeps every figure it
  // ever carried and moves it to the Archive.
  stopRow: ({ personName, company, groupName, roleLabel, money }) => ({
    title: 'Stop this deal?',
    subject: `${personName ?? '(no handler)'} on ${company ?? groupName} as ${roleLabel}, `
      + `${money} a month.`,
    detail: [
      'The row stays. It moves to the Archive, out of the master sheet and out of '
      + 'every month from today onward.',
      'Months already paid are untouched. Resume on the Archive puts it back.',
    ],
    confirmLabel: 'Stop deal',
    busyLabel: 'Stopping…',
    // RED, like Delete (his call, reversing the quiet Stop): it ends
    // somebody's pay, so it reads as an act that counts. The palm icon,
    // not the colour, tells it apart from the bin.
    confirmVariant: 'danger',
  }),

  bulkStopRows: (count) => ({
    title: `Stop ${count} ${count === 1 ? 'deal' : 'deals'}?`,
    detail: [
      'They move to the Archive, out of the master sheet and out of every month from today onward.',
      'Months already paid are untouched. Undo, or Resume on the Archive, puts them back.',
    ],
    confirmLabel: `Stop ${count === 1 ? 'deal' : 'deals'}`,
    busyLabel: 'Stopping…',
    // Red, the same as one row's Stop above.
    confirmVariant: 'danger',
  }),

  resumeRow: ({ personName, company, groupName, stoppedOn }) => ({
    title: 'Put this deal back?',
    subject: `${personName ?? '(no handler)'} on ${company ?? groupName}, stopped ${stoppedOn}.`,
    detail: 'It returns to the master sheet and counts toward this month again.',
    confirmLabel: 'Resume deal',
    busyLabel: 'Resuming…',
  }),

  // ===============================
  // * ANSWERING THE MONTHLY REVIEW. TWO OF THE THREE STOP MONEY.
  // ===============================
  // Only reached for `final` and `no`. Yes stops nothing, so a dialog on it
  // would be the click that teaches people not to read these.
  //
  // It NAMES THE PEOPLE, up to a point. "6 deals" is a number; "Gloria,
  // Nathan, Paddy and 3 more" is the thing somebody can actually check
  // before pressing.
  answerReview: ({ answer, count, names, money, month }) => ({
    title: answer === 'no' ? 'Mark these as already ended?' : 'Make this their final month?',
    subject: `${count} ${count === 1 ? 'deal' : 'deals'}, ${money} a month: `
      + `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.`,
    detail: [
      // "no" also takes the row OFF the review list, so the dialog says it.
      // A row vanishing with nothing having said it would is the moment
      // somebody decides the button did more than they asked.
      answer === 'no'
        ? `Each one stops at the end of last month, so nothing is owed for ${month}, `
          + 'and it leaves this list.'
        : `Each one is paid in full for ${month}, then stops at the end of it.`,
      'The rows are kept and move to the Archive. Every month already paid is untouched, '
      + 'and Resume on the Archive puts any of them back.',
    ],
    confirmLabel: answer === 'no' ? `Stop ${count}` : `Set ${count} final`,
    busyLabel: 'Saving…',
  }),

  /**
   * A TYPED PAYABLE AMOUNT IS ABOUT TO BE RECOMPUTED.
   *
   * NOT a destructive confirm, so it does not read like one. Two real
   * answers, both valid, and the figures are named on both sides: "will
   * recompute" is abstract and "5,000 becomes 1,935.48" is a decision.
   *
   * It says the dates move EITHER WAY, because they do. Somebody choosing
   * "keep" would otherwise expect the appointment edit to be cancelled too.
   */
  payableWouldRecompute: ({ columns, was, willBe }) => ({
    title: 'This will recompute the payable amount',
    subject: `Payable amount is ${was}, set by hand.`,
    detail: [
      `Changing ${columns.join(' and ')} works it out again from the formula`
        + `${willBe ? `, which gives ${willBe}` : ''}.`,
      'The other dates on the row update either way. Only the payable amount is in question.',
    ],
    confirmLabel: 'Recompute it',
    busyLabel: 'Saving…',
  }),

  // ── several rows ───────────────────────────────────────────────────────

  bulkDeleteRows: (count) => ({
    title: 'Delete these deals?',
    subject: `${count} ${count === 1 ? 'deal' : 'deals'} selected on this page.`,
    detail: 'The rows go, for good. Every person and company on them stays, along with '
      + 'every other deal they hold. A synced row comes back on the next imported sheet '
      + 'unless that sheet dropped it too.',
    confirmLabel: `Delete ${count}`,
    busyLabel: 'Deleting…',
  }),

  // Off the upload diff's delete tabs. Says the thing that is NOT true of
  // the bulk delete above: this one writes before the upload is confirmed,
  // so closing the modal does not take it back.
  deleteFromDiff: (count) => ({
    title: 'Delete these deals?',
    subject: `${count} ${count === 1 ? 'deal' : 'deals'} the file did not mention`,
    detail: 'The row goes, for good. The people and companies on it stay, along with '
      + 'every other deal they hold. This happens now, on its own: closing this import '
      + 'will not bring them back, and nothing else on the sheet is written.',
    confirmLabel: `Delete ${count}`,
    busyLabel: 'Deleting…',
  }),

  /**
   * ===============================
   * * CLOSING OR DISSOLVING A COMPANY, AND WHICH DEALS IT STOPS
   * ===============================
   * The two terminal statuses. They do the same thing and differ only in
   * what they say happened, so the dialog says which word it is writing.
   *
   * ALL OF THEM IS THE DEFAULT and the normal case: a closure is the last
   * act of a wind down. The checklist in the dialog is for the exception,
   * so the copy follows the TICK COUNT and says plainly when some are being
   * left running, which is a state somebody should have meant.
   *
   * `count` is what is ticked, `total` what the company has.
   */
  /**
   * ===============================
   * * THE STATUSES THAT ASK ABOUT THEIR DEALS, ON THE DETAIL PAGE
   * ===============================
   * The manage modal asks in place and saves on its own press. The detail
   * page writes the moment you click a status, so it has no press to hang
   * the answer on: without this it changed the status and asked nothing,
   * and the checklist the feature is FOR never appeared. Found 2026-09-22.
   *
   * ONE PRESS, BOTH DECISIONS, the same rule the modal follows. The status
   * and the deals it touches are written together or not at all.
   */
  companyDeals: ({ status, companyName, count, total, clearsDates }) => ({
    title: status === 'going_concern'
      ? `Set ${companyName} to going concern?`
      : `Set ${companyName} to ${status === 'review' ? 'review' : 'liquidation'}?`,
    subject: `${count} of ${total} ${total === 1 ? 'deal' : 'deals'} ticked.`,
    detail: [
      clearsDates
        ? 'Each ticked deal reads "Going concern" instead of a date, and ITS END DATE IS '
          + 'CLEARED. Unticking later puts the word back to blank; it cannot bring a date back.'
        : 'Each ticked deal joins the Review list every month and its end date reads '
          + '"Reviewed monthly" instead of a date.',
      count === 0
        ? 'Nothing is ticked, so the status changes and no deal is touched.'
        : 'Anything left unticked keeps exactly what it has now.',
      clearsDates
        ? 'The dates are kept in History, so this can be undone in one press.'
        : 'This can be undone in one press from History.',
    ],
    confirmLabel: 'Save status',
    busyLabel: 'Saving…',
  }),

  closeCompany: ({ status, companyName, count, total, money }) => ({
    title: status === 'dissolved' ? `Dissolve ${companyName}?` : `Close ${companyName}?`,
    subject: count === total
      ? `${count} ${count === 1 ? 'deal' : 'deals'} still running on it, ${money} a month.`
      : `${count} of ${total} deals, ${money} a month.`,
    detail: [
      status === 'dissolved'
        ? 'Dissolved means the company is legally gone. Closed means we ended it. Both stop the '
          + 'deals; the word is what an audit reads later.'
        : 'Closed means we ended it. Dissolved is the word for a company that is legally gone.',
      count === 0
        ? 'No deal is ticked, so the status changes and nothing stops. Every deal keeps running '
          + 'and keeps costing what it costs.'
        : `${count === total ? 'Every deal' : 'Each ticked deal'} stops today and moves to the `
          + 'Archive. The rows are kept, every month already paid is untouched, and the people '
          + 'stay along with their other deals.',
      count === total
        ? 'Setting the company back to active brings these deals back together.'
        : 'Setting the company back to active brings back only what this stops. Anything left '
          + 'ticked off keeps running in the meantime.',
    ],
    confirmLabel: status === 'dissolved' ? 'Dissolve company' : 'Close company',
    busyLabel: 'Saving…',
  }),

  // ── one side of a deal ─────────────────────────────────────────────────

  removeHandlerFromCompany: ({ personName, roleLabel, companyName, money }) => ({
    title: 'Remove this handler?',
    subject: `${personName ?? '(no handler)'} as ${roleLabel} on ${companyName}, ${money} a month.`,
    detail: 'This deletes that one row, on this page, on People and on the master sheet. '
      + `The company keeps its other handlers and ${personName ?? 'the handler'} keeps every `
      + 'other company they hold. Nothing restores it except re-importing a sheet that '
      + 'contains it.',
    confirmLabel: 'Remove',
    busyLabel: 'Removing…',
  }),

  removeCompanyFromPerson: ({ personName, company, groupName, roleLabel, money }) => ({
    title: 'Remove this company?',
    subject: `${personName} on ${company ?? groupName} as ${roleLabel}, ${money} a month.`,
    detail: 'This deletes that one row, on this page, on Companies and on the master sheet. '
      + `${personName} keeps their other companies and ${company ?? 'the group'} keeps its `
      + 'other handlers. Nothing restores it except re-importing a sheet that contains it.',
    confirmLabel: 'Remove',
    busyLabel: 'Removing…',
  }),

  // A handler on a deal being BUILT, not one already saved. Nothing has
  // reached the database, which is the whole difference and why it is a
  // separate entry rather than a variant of the one above.
  removeUnsavedHandler: (name) => ({
    title: 'Remove this handler?',
    subject: name,
    detail: 'Everything typed on their tab goes with them, and none of it has been saved '
      + 'anywhere yet. The rest of the deal and every other handler are untouched.',
    confirmLabel: 'Remove',
  }),

  // ── not a deletion ─────────────────────────────────────────────────────

  // Writes to rows rather than removing them, and the surprise is that it
  // touches the CRM at all when it was reached from an export dialog.
  bulkFixFromExport: ({ label, count, group }) => ({
    title: label,
    subject: `${count} rows in ${group}`,
    detail: 'This changes the rows themselves, not just this export. Their payable days '
      + 'and amounts are recalculated to match, and every change is in History.',
    confirmLabel: `Set ${count}`,
  }),

  // FORWARD ONLY, and the count says so. A backward suggestion invents an
  // appointment date, which is a real day somebody was onboarded, so it is
  // never applied in bulk. Those stay for a human to accept one at a time.
  acceptAllDates: ({ count, group, skipped }) => ({
    title: 'Fill these dates?',
    subject: `${count} ${count === 1 ? 'row' : 'rows'} in ${group}`,
    detail: `Each date is worked out from the appointment on its own row, using the sheet's `
      + 'own formulas. This changes the rows themselves, not just this export, and every '
      + `change is in History.${skipped
        ? ` ${skipped} guessed ${skipped === 1 ? 'date is' : 'dates are'} left alone: an `
          + 'appointment worked backwards from a payment date is never filled in in bulk.'
        : ''}`,
    confirmLabel: `Fill ${count}`,
  }),

  clearLogs: ({ scope, progress }) => ({
    title: 'Clear logs?',
    subject: null,
    detail: `This permanently deletes every stored log matching the current filter (${scope}), `
      + 'not just the ones shown on this page. Nothing else in the CRM is touched.',
    confirmLabel: 'Clear logs',
    busyLabel: `Clearing… ${progress}%`,
  }),
};
