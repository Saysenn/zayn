# Exports

State as of 2026-10-20, from a full audit of every export against the clone DB.
Read this before touching anything under `crm/api/v1/masterSheet/` or
`crm/api/v1/templates/xlsx/`.

## The rules

1. **A deal is ended only when it is stopped** (`stopped_on` set, Archive page).
   Archived deals are in no export. The end date column is information only:
   "end date decides" (`color_uses_end_date`) stays off.
2. **Status = the live period** (`payment_period`: Active / Not yet paying /
   Ended), never the stored `tb_mastersheet.status`. That column is written once
   at upload from the end date and goes stale. Nothing reads it except WhatBot
   (`toAgentRow`), which writes it back on save, so leave WhatBot alone.
3. **Two payment start formulas:** appointment + 90, or for an appointment in the
   month's first week, the last Friday of month 3 (month 3 paid in full).
4. **Special Case** pays the whole month (31 in October, 30 in September) whatever
   the dates say. Its days and amount are kept, never replaced by a formula.
5. **Add on / fee** (per person, `tb_people`) and **crypto %** (settings) are
   applied by `withRates` before any builder runs. Every builder must rate first.
6. **Never change the default columns** of the Cash / Bank / Crypto presets. The
   boss set them; check `docs/boss/references` docx files first.
7. **"Should be paid" off = out of every payment document** (`override_should_be_paid
   = false`, set per person on the People page). Left out of Generate for month,
   Division, Earnings breakdown, the master sheet's Bank / Cash / Crypto runs and
   Drivers. The **Master sheet itself keeps them** (it is the active deals list and
   is uploaded back). Hidden payouts keep the row marked "no", out of the total.
   The export modal still warns about them (`isPaymentRun`, `exportQuery.js`).
8. **Monthly review:** No / Final month stop the deal (archive), so it leaves
   every export. Unanswered counts as Yes and stays paid, with an export warning
   (`unanswered-review`), which also covers "Reviewed monthly" deals with no end
   date (`unansweredIn`, `exportQuery.js`).
9. **No cell value on live is touched** by an export fix. A value present is good;
   only blanks are issues.

## The exports

Visible tabs in the Export modal: **Master sheet**, **Generate for {month}**,
**Drivers**. Hidden (built, not offered): Division, Expensing, Cash, Bank,
Bank details. The Earnings breakdown is the one person / Diane layout.

| Export | Template | Notes |
|---|---|---|
| Master sheet | `master-sheet` | Tab per group by default; one-book and zip also. Presets Standard/Bank/Cash/Crypto send their own `columns` from the browser. One-book is the only one with live formulas. |
| Generate for month | `monthly-sheet` | Rolled to the month; breakdown per method → location → currency. Default design has no USD. |
| Drivers | `drivers` | Tabs: Area split, UK cash, Outside UK (USD + rate table), Mid split. Places go on runs by drag and drop on the Drivers tab. |
| Division | `division-sheet` | Breakdown only, per group. |
| Earnings breakdown | `breakdown` | Per person, with add ons and live Status. |
| Payouts | `expensing` / `cash` / `bank` / `bank-details` | Hidden. Totals sit in columns A–C (known, not fixed since unused). |

"ALL GROUPS" is a real group (the standing Workforce roster, 10 deals), not a
roll-up.

## Exchange rate

Pulled automatically: at boot, then hourly checks, refetched when the last pull
is 23 h old (`fxRates.helper.js`). Openexchangerates first, open.er-api second.
A rate set by hand wins only if saved after the last pull. AED falls back to the
3.6725 peg. Only the Drivers sheet prints the rates.

## Fixed 2026-10-20

1. Earnings breakdown now applies add ons and crypto % (was 1,310 AED / €10 short).
2. Dates are written as real Excel dates (`withExcelDates`, `shared/sheetFormats.js`),
   so formulas survive a recalculation in Excel.
3. Generate for month shows the last Friday start on first week deals
   (`shownPaymentStart`, rolled rows only: the working file must round trip).
4. Special Case keeps its days and amount in the formula file (`sheetFormulas.js`).
5. Drivers run totals are one number per currency, not text.
6. Locations group ignoring case in the month and division breakdown.
7. Earnings breakdown and Diane's row summary read the live Status.

## Open

1. **Live DB URL in `crm/api/.env` is dead** (Supabase: tenant/user not found).
   Everything above was tested on `crm_clone`.
2. Drew (NEXUS, Black country) is left out of the Drivers sheet until that place
   is dragged onto a run. The file does not say he was left out.
3. Liam Edwards (Fostabam) has no contact or bank details in the CRM or in any
   boss file. "Liam LevelUp" on the manual driver sheet is a different person.
4. Not checked in real Excel (no LibreOffice); the XML holds real dates.
5. The OpenAI account has no credits (429 at API boot), so Diane is down.

## Manual driver sheet vs ours

Reference: `docs/boss/references/manually copied driver sheet.xlsx` (a September
file). Where a deal is unchanged, values match.

| Tab | Can we build it? | Missing |
|---|---|---|
| Mid split | Yes | Nothing |
| Area split | Lists yes | Additions block, Original / Total now, 4.5% line, "Being held" |
| Outside UK | Mostly | USD summary per group, a working "Done?" column, RC people abroad |
| UK CASH | Table yes | RC group and its ~20 people, labels (54/63 blank), "US" column, money in / paid / shortfall block |

## How to re-run the audit

On the clone only (`crm/api/.env` → `crm_clone`). Mount `v1/export.js`'s router
in a small express app, call `/api/v1/export/xlsx` per template/preset, and save
to `docs/downloads`. Compare a new set against the last cell by cell; only the
intended change should differ. Related tests:
`node --test --test-force-exit` on `v1/masterSheet/*Export*.test.js`,
`sheetFormulas`, `driverSheet`, `groupLayout`, and `v1/agent/engine/sheetCheck` /
`anyFile` (these catch a working file that no longer round trips).
