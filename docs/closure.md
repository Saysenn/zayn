# Ending a deal, the monthly review, and closing a company

All built. This is how it works now.

## The rule

A deal ends only because someone said so, with a date. Never because a
formula decided a year had passed.

- `end_on` is the sheet's guess (appointment plus a year; the boss calls it
  "provisional"). It counts only when `color_uses_end_date` is on, and it
  raises a question.
- `stopped_on` answers it. It counts always, not behind `useEndDate`.
- `owedThisMonth` stays a boolean. Nothing multiplies an amount.
- A finished deal is stopped, never deleted: its history is payroll.

## Words

| Word   | Means                               | Reverse |
| ------ | ----------------------------------- | ------- |
| Stop   | this deal is over, the row stays    | Resume  |
| Remove | this pairing is over, the row goes  | none    |
| Close  | the company is closed               | reopen  |

No Delete: person and company DELETE routes are gone, so nothing can be
orphaned.

## Stopping a deal

- Columns: `tb_mastersheet.stopped_on` and `stopped_reason` (migration 056).
- Reasons (closed set, `STOPPED_REASON` in `repos/masterSheetRows.repo.js`):
  `stopped_by_hand`, `review_no`, `review_final`, `company_closed`.
- A stopped deal drops out from the month after the stop; the month it stops
  in is amber (part month). `stopsWithinMonth` in
  `shared/owedThisMonth.helper.js`, shared by the colour, the total and the
  SQL badge.
- Routes: `POST /master-sheet/:id/stop`, `/:id/resume`, `/bulk-stop`,
  `/bulk-resume` (`v1/masterSheet.js`).
- Resume clears the stop and touches no past month: `tb_month_snapshots`
  stores each month's figures, read only (migration 049).
- Resume refuses a `company_closed` stop: reopen the company instead.

## Archive page

`/archive` (`web/src/pages/ArchivePage.jsx`).

- A filter on `stopped_on IS NOT NULL`, newest first. Never a copied row.
- Columns: the master sheet's plus Stopped on and Why.
- Filters: group, person, company, a date range on `stopped_on`; server side.
- Only write: Resume. To edit, resume and edit on the master sheet.
- Its total is history, labelled so, never added to a month.

## Monthly review

`/review` (`web/src/pages/ReviewPage.jsx`), repo
`repos/monthlyReview.repo.js`, migrations 057, 059, 061.

- One answer per deal per period (`2026-08` style), so history is kept.
- In the queue when not stopped and either:
  - `end_on` is before the first of the period, or
  - `review_monthly` is ticked: by the import ("Reviewed monthly"), the
    liquidation checklist or the review checklist.
- Company status no longer puts deals in by itself: the per-deal tick
  decides. The row carries its company's status so the page can group
  liquidation apart from review.
- Always the current month (`currentMonth()`, business timezone); no picker.
  The header names the month.
- An unanswered deal counts as Yes, and is flagged.

| Answer           | Writes                                    | Button    |
| ---------------- | ----------------------------------------- | --------- |
| Yes              | the answer only                           | `primary` |
| Yes, final month | paid this month, `stopped_on` = month end | `warning` |
| No               | `stopped_on` = end of last paid month     | `danger`  |

- No and Final go through `ConfirmDialog`. A Final row stays on this month's
  list; a No row leaves it (the way back is History).
- Other doors: a line in `ExportWarnings` (`unanswered-review`) before a
  payout file is built; the end date cell's `CellInfo`; Row History.
- The sheet's own words are read as answers: `Ongoing` = yes,
  `AUGUST END FULL` style = final. `end_note` keeps the text; `notes` keeps
  his prose.

### Diane

Tools in `v1/agent/tools/monthlyReview.js`, through the same route:

| Tool                         | Does                               | Guard          |
| ---------------------------- | ---------------------------------- | -------------- |
| `list_monthly_review`        | the queue, by person or group      | read only      |
| `answer_monthly_review`      | one deal, one answer               | exact match    |
| `bulk_answer_monthly_review` | one answer across a named set      | `confirmFirst` |

- She cannot answer for a deal not in the queue.
- The bulk tool refuses a single named person with one deal.
- The queue lists at most 12 lines and says when it cut; `dealIds` is never
  cut. It states the dates off the server clock.
- She reports the count and what it stopped.

## Companies: liquidation and closing

`tb_companies.status` (migrations 058, 059, 061):

| Status          | Means                                  | Paying           |
| --------------- | -------------------------------------- | ---------------- |
| `active`        | trading                                | full             |
| `going_concern` | trading, expected to keep trading      | full             |
| `review`        | ask about it monthly                   | full             |
| `liquidation`   | winding down, negotiated               | reduced, by hand |
| `dissolved`     | legally gone                           | nothing          |
| `closed`        | we ended it                            | nothing          |

- Also `closed_on` (set on either terminal value) and `liquidation_total`
  (the agreed settlement, a reference only).
- Sequence: set liquidation → set each deal's amount by hand on the
  liquidation panel (`components/modals/LiquidationPanel.jsx`) → dissolve or
  close → every deal stops with `company_closed` and goes to the Archive.
- The panel checks allocated against the settlement and warns, never
  refuses.
- Reopening brings back only the deals the closure stopped.
- A status change across a company is one History row and one Undo
  (migration 062).
- No automatic closure anywhere: every terminal state is a button.
- On the master sheet liquidation is a badge by the company name, not a
  status, and does not move the payment start tint.
- Old amounts are in `tb_mastersheet_changes` (History).

## Testing

Unit tests stub the database. `node scripts/closureDrill.js` (in
`crm/api`) is the only check against Postgres: constraints, the queue and
the company cascade. It writes only to `ZZTEST` with `scratchOnly` armed and
clears its own leftovers first. Run it after any change here.

## Open

- Who fronted cash at the start of a deal, and whether they were repaid, is
  not recorded. Ask the boss for the period and scale before building.
