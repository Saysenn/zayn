/**
 * Every icon popup in the CRM: its tone, its label, its words.
 *
 *   <CellInfo {...popup.orphanCompany(count)} />
 *
 * Entries that feed a `hint=` return the string alone, because
 * FloatingField builds the icon itself:
 *
 *   <Field label="Name" hint={popup.companyName()} />
 *
 */

// Green is context nobody has to act on. Gold means somebody does. Same
// split CellInfo has always drawn; named so entries read as intent.
const INFO = 'info';
const WARNING = 'warning';

// THE THIRD TONE, and only forms/CellSuggestion draws it: a cell that is
// EMPTY and can be filled from what the row already holds. Gold like a
// warning, because it is something to do, but a CIRCLE rather than a
// triangle, because nothing is wrong. CellInfo has no case for it and
// falls through to info, which is the harmless reading.
const ACTION = 'action';

export const popup = {

  // ── uploading a sheet ────────────────────────────────────────────────

  groupFromFilename: ({ rows, reason }) => ({
    tone: INFO,
    label: 'Why the file name',
    body: `${rows} ${rows === 1 ? 'row has' : 'rows have'} no Group column, no `
        + `recoverable header and no group-named tab, so ${reason}. Only a group the `
        + `CRM already has can be matched this way, never a new one.`,
  }),

  noGroupAtAll: (reason) => ({
    tone: WARNING,
    label: 'Why this matters',
    body: `${reason}. A deal's identity contains its group, so these will not match `
        + `the same deals stored under a real one and will import as duplicates. Add a `
        + `Group column, or name the file after the group.`,
  }),

  columnsNotRead: (columns) => ({
    tone: WARNING,
    label: 'Which columns were not read',
    body: `${columns.join(', ')}. The rows still import. Nothing in the CRM stores `
        + `${columns.length === 1 ? 'this column' : 'these columns'} yet, so say if `
        + `${columns.length === 1 ? 'it' : 'they'} should be kept.`,
  }),

  columnsLeftAlone: (columns) => ({
    tone: INFO,
    label: 'Which columns were left alone',
    body: `${columns.join(', ')}. A column the file does not have is not the same as `
        + `one whose cells are empty, so the import had no opinion on these and did `
        + `not write them.`,
  }),

  /**
   * WHY THE CRM DISAGREES WITH THE SHEET on this one cell.
   *
   * A column somebody typed into used to be hidden from the diff entirely,
   * so the file's version was never shown and never written. It is offered
   * now, which only helps if the reader can see WHEN it was set and WHAT it
   * replaced; without those the note says "somebody typed this" and leaves
   * them exactly as stuck.
   *
   * The two facts are missing on an edit made before the change log existed.
   * The mark still shows: that it was typed in is the important half.
   */
  changedByHand: ({ claimedAt, claimedFrom }) => ({
    tone: WARNING,
    label: 'You changed this by hand',
    body: [
      claimedAt
        ? `Set on ${new Date(claimedAt).toLocaleString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}${claimedFrom ? `, replacing "${claimedFrom}"` : ''}.`
        : 'Set by hand at some point before the history was kept.',
      'The file disagrees. Pick whichever side is right; the CRM keeps yours '
        + 'unless you choose the file.',
    ],
  }),

  clearingACell: () => ({
    tone: WARNING,
    label: 'The incoming cell is empty',
    body: 'The file HAS this column and left the cell empty, so accepting removes the '
        + 'value the CRM holds. A column the file does not have at all is never offered '
        + 'here: the import has no opinion on those.',
  }),

  clearingSummary: () => ({
    tone: WARNING,
    label: 'What clearing means',
    body: 'The file has the column and left the cell empty, so accepting removes what '
        + 'the CRM holds rather than replacing it. Marked amber on each row.',
  }),

  // ── what a deal is ───────────────────────────────────────────────────

  askedOnce: () => ({
    tone: INFO,
    label: 'Why this is asked once',
    body: [
      '**Shared by everyone on this deal.**',
      'A deal IS a company in a group, so every handler below gets the same two. On the '
      + 'live sheet 32 of the 33 companies sit in exactly one group, and inside every '
      + 'company and group block every handler shares both.',
      'Everything else is asked per person, because those columns genuinely differ: of '
      + 'the 31 deals with more than one handler, 25 differ on postcode, 23 on monthly '
      + 'amount and 23 on bank details.',
    ],
  }),

  // THE TWO LEVELS STACK. Typing 3 here on a person already carrying 5
  // costs 8, and the number nobody expects is the one they typed.
  rateStacks: ({ kind, personPercent, dealPercent }) => ({
    tone: WARNING,
    label: `${kind === 'addon' ? 'Add on' : 'Fee'} set on the person too`,
    body: [
      `This person carries **${personPercent}%** on their profile, for every deal they hold.`,
      `The two ADD UP: ${personPercent}% + ${dealPercent}% = **${personPercent + dealPercent}%** on this row.`,
      kind === 'addon'
        ? 'Added on top of the payable amount.'
        : 'Deducted from the total, after any add ons.',
    ],
  }),

  /**
   * WHY THIS FIGURE IS HIGHER THAN THE AGREED WAGE.
   *
   * The rates live ON the Monthly amount now, the way his own sheet writes
   * them: a 4,700 wage on 5% reads 4,935. That is the number everyone sees,
   * so this is where the sum is shown rather than in a block at the foot of
   * an export somebody may never open.
   *
   * INFO, not warning. Nobody has to act on it; it is the arithmetic behind
   * a figure that is correct. See CellInfo for the rule.
   */
  rateBreakdown: ({ parts, percent, currency, money }) => {
    const raw = parts.net - parts.addon - parts.crypto + parts.fee;
    return {
      tone: INFO,
      label: 'How this figure is made up',
      body: [
        {
          rows: [
            ['Raw', money(raw, currency)],
            ...(percent.addon > 0 ? [[`Add on ${percent.addon}%`, money(parts.addon, currency)]] : []),
            ...(percent.crypto > 0 ? [[`Crypto ${percent.crypto}%`, money(parts.crypto, currency)]] : []),
            ...(percent.fee > 0 ? [[`Fee ${percent.fee}%`, money(-parts.fee, currency)]] : []),
          ],
          total: ['Total', money(parts.net, currency)],
        },
        ...(percent.fee > 0 ? ['The fee comes off the raw plus the add ons.'] : []),
      ],
    };
  },

  sheetSays: (sheetText) => ({
    tone: INFO,
    label: 'What the sheet says',
    body: [
      `The sheet's own column says **${sheetText}**.`,
      "The switch is the admin's decision and never overwrites it.",
    ],
  }),

  // `paymentPeriodByHand` was here and is gone, 2026-09-09. It explained a
  // badge that disagreed with the payment start cell beside it, which is a
  // contradiction that no longer exists: the period is derived and nothing
  // can set it. An explanation with nothing left to explain is the kind of
  // entry that teaches people to stop opening the ones that matter.

  multiRow: ({ noun, plural, count }) => ({
    tone: INFO,
    label: 'A row for each, or one row',
    body: [
      `**On** creates one row per ${noun}${count > 1 ? ` (${count} rows)` : ''}. `
      + 'The amount is what they earn from each.',
      `**Off** creates a single row whose ${noun} cell lists all of them, the way the `
      + 'sheet writes "SG, CKA, CKU, Umbrella co". That is one arrangement covering '
      + `several ${plural}, and the amount is the total for it.`,
    ],
  }),

  // ── orphans ──────────────────────────────────────────────────────────

  orphanCompany: (count) => ({
    tone: WARNING,
    label: 'A company was removed',
    body: [
      `**${count} ${count === 1 ? 'deal has' : 'deals have'} no company**`,
      'A company they handled was deleted. The deals were kept because they are still '
      + 'owed for them. Open this person and pick a new company on each, or delete the '
      + 'row on the Master Sheet page.',
    ],
  }),

  orphanHandler: (count) => ({
    tone: WARNING,
    label: 'A handler was removed',
    body: [
      `**${count} ${count === 1 ? 'deal has' : 'deals have'} no handler**`,
      'Somebody who worked on this company was deleted. The deals were kept because the '
      + 'role, terms and money on them still stand. Assign a new handler on the Master '
      + 'Sheet page, or delete the row there.',
    ],
  }),

  // Label AND body come from the same input. Worth seeing: `label` is not
  // a constant on every entry.
  orphanNotices: (notices) => ({
    tone: WARNING,
    label: notices.map((n) => n.title).join('. '),
    body: notices.flatMap((n) => [`**${n.title}**`, n.body]),
  }),

  // A prose payment start already reaches the cell through
  // helpers/reviewFields.js, which maps the importer's review_reason onto
  // the columns it is about and draws a ReviewFlag there. No entry here:
  // one marker per fact, and that one is already the marker.

  // ── the three dates ──────────────────────────────────────────────────
  //
  // The one place an empty cell has a right answer the CRM already knows.
  // These three feed forms/CellSuggestion, which unlike CellInfo can write
  // what it proposes. See helpers/dateNotices.js for which cell gets which.

  // FORWARD: his own formula, restated. Nothing is invented, so it is not a
  // warning, but the cell is EMPTY and one press fills it, so it is not
  // passive context either. That is what ACTION is for.
  /**
   * WHY THE DAY COUNT DOES NOT FOLLOW THE START DATE ON THIS ONE ROW.
   *
   * A first week appointment stores the last Friday of month 3, the day
   * the money lands, and is owed the whole month. Counted from that date
   * it would be two days, so anyone checking the row against the sheet's
   * formula needs the reason in front of them rather than in a document.
   *
   * INFO, not warning: nothing is wrong and nobody has to act.
   */
  firstWeekFullMonth: ({ month, days, paidOn }) => ({
    tone: INFO,
    label: `${month} is the third month`,
    body: [
      `Appointed in the first week, so the whole of ${month} is owed and payable days is **${days}**, this month's length.`,
      `It is not counted from the payment start: that holds **${paidOn}**, the day the money is handed over.`,
      'From the fourth month on, this row counts like any other.',
    ],
  }),

  dateFromAppointment: ({ label, value, formula, also }) => ({
    tone: ACTION,
    label: `${label} follows the appointment`,
    body: [
      `This cell is empty. The sheet's own formula, ${formula}, makes it **${value}**.`,
      also ? `Accepting fills the ${also} with it too.` : null,
      'The payable days and amount follow from it, on screen straight away.',
    ].filter(Boolean),
  }),

  // BACKWARD: amber, because this one is a guess about a real event and
  // the verb is the whole message.
  appointmentGuessed: ({ value, from, also }) => ({
    tone: WARNING,
    label: 'No appointment date',
    body: [
      `Working back from the ${from} gives **${value}**.`,
      'An appointment is a real event, the day somebody was onboarded, so arithmetic '
      + 'cannot recover it. Nothing writes this by itself.',
      also ? `Accept only if that date is right. It fills the ${also} too.` : 'Accept only if that date is right.',
    ],
  }),

  // WHAT THE TOGGLE IS COSTING, said on the cell it is about.
  //
  // With the end date out of the paying decision, a deal that finished
  // months ago still reads Active, still tints green and its amount is
  // still in the month's figure. That is correct and it is also invisible,
  // which is how somebody ends up paying a finished deal. So the end date
  // cell says it, and says where the switch is.
  /**
   * WHY THE END DATE CELL IS BLANK, in his own words.
   *
   * 31 of 92 rows on his September sheet hold a phrase here rather than a
   * date, and the CRM used to drop every one of them in silence. Two
   * phrases, opposite meanings, so two popups.
   *
   * INFO: no end date, and that is correct. Nobody has to act.
   */
  goingConcern: ({ companyStatus }) => ({
    tone: INFO,
    label: 'No end date',
    body: [
      'His sheet says **Going concern** here, so this deal has no end date and runs until somebody stops it.',
      companyStatus ? `Its company is marked ${companyStatus}.` : null,
    ].filter(Boolean),
  }),

  /**
   * WARNING, because somebody must answer it this month. That is the line
   * this codebase already draws: warning means act, info is context.
   */
  reviewedMonthly: ({ companyStatus, answered }) => ({
    tone: WARNING,
    label: 'Up for review this month',
    body: [
      'His sheet says **Reviewed monthly**, so this deal is decided month by month rather than by an end date.',
      answered
        ? `It has been answered this month: **${answered}**.`
        : 'It is in the Review list now, unanswered.',
      companyStatus ? `Its company is ${companyStatus}.` : null,
    ].filter(Boolean),
  }),

  /** A phrase nobody has taught it. The words are kept; the date is empty. */
  endNoteUnknown: ({ note }) => ({
    tone: WARNING,
    label: 'End date is not a date',
    body: [
      `His sheet says **${note}** here, which the CRM does not recognise, so this deal has no end date.`,
      'Type a date if it has one, or tell somebody to add the phrase.',
    ],
  }),

  /**
   * ===============================
   * * A PASSED END DATE IS A REVIEW, NOT A CLOSURE
   * ===============================
   * It used to say the row was still counting and point at a Settings
   * toggle. Wrong on both counts now: the end date NEVER ends a deal.
   * A company's life is its status, and a deal's is decided by answering
   * it in the Review list, by us or by Diane.
   *
   * So the popup says what actually happened to this row: the sheet's own
   * appointment plus one year has run out, and it is in the Review list
   * this month waiting for somebody to say what happens next.
   *
   * `monthlyReview.repo.js` DUE_SQL is the other half: an end date before
   * the month starts is the FIRST of the queue's three reasons.
   */
  endDatePassed: ({ endOn, amount }) => ({
    tone: WARNING,
    label: 'Up for review this month',
    body: [
      `The sheet's end date, appointment plus one year, ran out on **${endOn}**.`,
      'That does not end anything by itself, so this deal is in the Review list now'
      + `${amount ? ` and its ${amount} is still in the total` : ' and its amount is still in the total'}`
      + ', waiting for an answer.',
      'Answer it in Review to keep it running or stop it. Its company keeps its own status.',
    ],
  }),

  // A stored date that is not what the appointment implies. Reported, never
  // corrected: his August send paid the INDIGO pair a whole month where the
  // formula gives six days.
  dateSetByHand: ({ label, is, formula }) => ({
    tone: INFO,
    label: `${label} was set by hand`,
    body: [
      `This says **${is}**, where the appointment date makes it **${formula}**.`,
      'Kept as it is. Moving the appointment will not change it back.',
    ],
  }),

  // ── export ───────────────────────────────────────────────────────────

  exportToggle: ({ name, on, off }) => ({
    tone: INFO,
    label: name,
    body: [`**On** · ${on}`, `**Off** · ${off}`],
  }),

  currenciesPerGroup: (groups) => ({
    tone: INFO,
    label: 'Which currencies, per group',
    body: [
      ...groups.map((g) => `**${g.group}**: ${g.currencies.join(', ')}`),
      "Each tab's breakdown carries a line per currency, and no total ever adds two "
      + 'currencies together.',
    ],
  }),

  // ── form hints: a string, handed to `hint=`, never spread ────────────

  // THE DUPLICATE THIS DELETES. Identical text sat in AddPersonWizard and
  // MasterSheetPage, already drifting in whitespace.
  dealCompaniesJoined: () =>
    'Pick as many companies as this deal covers. They go in one cell, the way the sheet '
    + 'writes "SG, CKA, CKU, Umbrella co", and the amount is the total for the whole '
    + 'arrangement. For a row per company, add them one at a time. Leave it empty for a '
    + 'deal that pays against the group instead.',

  // NOT a duplicate of the one above, and the difference is the point: this
  // is the ROWS case, that is the JOIN case. See MultiRowToggle.
  dealCompaniesRows: () =>
    'Pick as many companies as this person handles. Each one becomes its own row on the '
    + 'master sheet, so they show up as a handler on every company picked, and each '
    + 'company gains them. Leave it empty for a deal that pays against the group instead.',

  companyName: () => 'Renaming updates this company everywhere it appears.',

  companyTier: () =>
    "What kind of company this is. Pick one or type a new one. Shown on each group's "
    + 'tab in the export.',

  // WHICH COLUMNS CANNOT GO, read off the served list rather than written
  // out here. It is four on the two master-sheet layouts and one on the
  // payout sheets, and a hardcoded sentence about "the four" was going to be
  // a lie on three tabs the moment they got a picker.
  exportColumns: (required) => {
    const head = "Written in the sheet's own order, not the order they are picked.";
    if (required.length === 0) return head;
    const is = required.length === 1 ? 'is' : 'are';
    return `${head} ${required.join(', ')} ${is} always written and ${is} not on this `
      + `list. ${required.length > 1
        ? 'A file without them cannot be imported back: a row with no name is discarded, '
          + "and the other three are what a deal's identity is built from."
        : 'A payout line that identifies nobody is not a payout line. Everything else on '
          + 'this file, bank details included, is yours to drop.'}`;
  },

  // Add a person, one per step of the wizard.
  personWho: () => 'Who they are. Only the name is required.',
  personDeal: () => 'Which company, in which group.',
  personMoney: () => 'The payable amount is worked out from these, never typed.',
  personPreset: () => 'The month being paid for',
  personPost: () => 'Where post goes, if it goes anywhere.',
  personBank: () => 'Text, not numbers. The sheet writes words here as often as digits.',
  personDecision: () => 'The payment decision, and anything worth writing down.',
};
