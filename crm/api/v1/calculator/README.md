# calculator

Pure code (no LLM) for reading the boss's sheets and working out pay.

| File                   | Does                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `readSheets.js`        | Finds every table on a sheet, wherever it sits (used by import and Diane)     |
| `mapSheetRow.js`       | Maps a master sheet row to the CRM's shape (normalised header matching)       |
| `computePayable.js`    | Payable days and payable amount                                               |
| `paymentStartText.js`  | Reads words in the Payment start column ("Ongoing", "AUGUST END FULL")        |
| `buildBreakdowns.js`   | Expensing, Cash and Bank workbooks per group; nothing calls it now            |

## Key rules

- `payable_amount = monthly_amount / days_in_preset_month * payable_days`.
  The denominator is the **preset** month (the month being paid), in UTC.
- Payable figures are computed, never read from the sheet: its formula
  columns often fail to resolve.
- "Ongoing" means the full month is owed (same as blank). "<MONTH> END FULL"
  is a note, not a date: the real start is appointment + 90 days.
