# Unwire the end date from the tint

**Designed, not started.** Written 2026-09-21.

Closure is built, so the end date no longer needs a vote in what a month
owes. The Settings toggle `color_uses_end_date` goes, and with it the end
date's part in the colour, the total and the active/ended badge.

**A deal ends by being stopped.** The end date stays stored, stays on the
sheet, stays editable and stays reported by the import diff and the cell
notices. It simply decides no money.

## Two answers first

1. **Saved snapshots carry the flag.** `takeSnapshot` writes
   `totals.settings.useEndDate`, and every past month was computed with
   whatever the toggle was that day. Recompute history as if it had always
   been off, which MOVES published figures, or keep reading the stored flag
   for saved snapshots alone and drop it only for live reads?
2. **The End date column in exports is toggle led.** `buildWorkbook`
   `SETTING_LED_COLUMNS = { end_on: 'useEndDate' }` hides the column unless
   the toggle is on. Always show it now, or never show it?

Neither is a code question. Nothing starts until both are answered.

## 1. Settings, which is where it starts

| file | what goes |
|---|---|
| `web/pages/SettingsPage.jsx` | the switch, `colorUsesEndDate`, the card description's last sentence |
| `web/components/settings/PaymentStartRules.jsx` | the End date column, and the preview's reason for existing halves |
| `web/helpers/presetSamples.js` | rows 4 and 5, which exist only to move when the toggle flips |
| `api/v1/settings.js` | the field in GET and PATCH, and its boolean check |
| `api/v1/repos/settings.repo.js` | `setColorUsesEndDate`, the column in the SELECT, the default |
| migration 060 | drops `tb_settings.color_uses_end_date` |

`PaymentStartRules` survives. A worked example of what colours the cell is
still worth having; it loses one column and two rows.

## 2. The predicate, which is where it actually lives

**`shared/owedThisMonth.helper.js` is the one definition.** Remove the
`useEndDate` argument, and take `endedBeforeMonth` and `endsWithinMonth`
out of `isOwedThisMonth` and `paymentStartState`.

**Both functions stay exported.** The import diff and `dateNotices` still
ask whether an end date has passed. They just no longer decide money.

`web/helpers/paymentStartState.js` is the mirror and loses the same:
the `endOn` and `useEndDate` arguments, `ifToggled` entirely, and the two
extra entries in `paymentStartRules`.

## 3. Then every caller that threads the argument

**32 source files.** Each one only passes it along, so each is a deletion,
not a rewrite.

1. **Exports.** `buildWorkbook`, `buildPayoutSheet`, `buildDivisionSheet`,
   `rollToMonth`, `exportQuery`, `workbookSnapshot`, `export.js`,
   `agent/exportDraft.js`, `templates/xlsx/payout.js`.
2. **Figures.** `dashboard/buildDashboard.js`,
   `shared/detailMonthlyTotals.helper.js`, `shared/paymentPeriod.helper.js`,
   `shared/monthReconcile.helper.js`, `masterSheet/takeSnapshot.js`.
3. **Diane.** `tools/masterSheet.js`, `tools/monthHistory.js`,
   `tools/historicalBreakdown.js`, `tools/exportSheet.js`.
4. **Routes.** `people.js`, `companies.js`.
5. **Web.** `hooks/useMasterSheet.js`, `pages/MasterSheetPage.jsx`,
   `helpers/paymentPeriod.js`, `helpers/dateNotices.js`.
6. **Script.** `scripts/closureDrill.js`.

## 4. And the copy, which is half the work

1. **`popups.config.js` `endDatePassed`** drops its last line, "turn on the
   end date in the preset formula in Settings". The notice itself becomes
   PERMANENT rather than toggle led, and that is correct: a row whose end
   date has passed and which nobody stopped is exactly what somebody should
   be told about.
2. **`PaymentStartWhy.jsx`** the end date wording and the `useEndDate` prop.
3. **Diane's prompt block** in `tools/masterSheet.js`: `endDateLine`, the
   "THE END DATE SETTING IS CURRENTLY ON/OFF" paragraph, and `endDateCounts`
   in what she hands back.
4. **`dateNotices.js`** guard at line 143 reads `!useEndDate`. With the
   toggle gone the condition is just "the end date has passed".

## 5. Tests

**34 files assert on the toggle**, including `paymentPeriod.test.js`,
`sheetFormulas.test.js`, `payoutExport.test.js`, `buildDashboard.test.js`,
`takeSnapshot.test.js`, `presetSamples.test.js` and nine of Diane's.

Most pass `{ useEndDate: false }` already and only lose an argument. The
ones that assert the ON behaviour are the real work: each is a decision
about what that case means now, not a find and replace.

**A new test is owed:** that nothing anywhere reads `end_on` to decide a
colour, a total or a badge. Deleting an argument from thirty files is
exactly the change where one caller keeps its own copy.

## What must NOT change

1. **`stopped_on` was never behind the setting** and stays exactly as it is.
   A stop is somebody saying this deal is over.
2. **`end_note` and `review_monthly`** are untouched. His words in the end
   date column, and the per deal review flag, are about what the cell SAYS,
   not about what it decides.
3. **The end date stays a column**: stored, editable, exported, and read by
   the import diff. This removes its vote, not the data.
