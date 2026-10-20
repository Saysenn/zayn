# State

How the CRM works and connects, as of 2026-10-20. Every line was checked in the
code. Short on purpose; deeper docs are linked at the end. Update this file
when any of it changes.

## Parts

| Part | Where | What |
|---|---|---|
| CRM API | `crm/api` | Express + Postgres. |
| CRM web | `crm/web` | React + Vite admin app. |
| Diane | `crm/api/v1/agent` | The CRM's AI admin (OpenAI, `AI_MODEL=gpt-4.1`). |
| WhatBot | `whatbot/` | WhatsApp bot (Baileys, BullMQ, Redis). |

Local only, never deployed.

## Databases and running

- **Live:** Supabase (`aws-0-ap-south-1` pooler), migrated to **091**.
  **Clone:** Docker `crm-clone`, `127.0.0.1:54329/crm_clone`, a copy of live
  with test leftovers (four deals stopped 14 Oct). Test on the clone first.
- `crm/api/.env` points at **live** now; the clone line is kept as `# CLONE:`.
- API: `cd crm/api && PORT=3001 npm run dev` (3000 is taken by another app).
  Web: `cd crm/web && VITE_API_URL=http://localhost:3001 npm run dev` → :5173.
- Login: username + password → a 2 minute ticket → secret code → 12 h session
  (`v1/auth.js`).
- Live today: 98 deals, 90 not archived, 64 people. Groups NEXUS, INDIGO,
  MILKMAN, MANBAT, ALL GROUPS (the standing Workforce roster, a real group).

## The core: one deal row

Everything reads `tb_mastersheet` through `repos/masterSheetRows.repo.js`.
`findAllRows()` returns **only rows not stopped**, each with a computed
`payment_period`.

**The money rule** is `isOwedThisMonth` (`shared/owedThisMonth.helper.js`),
asked in this order:

1. Company closed → owed nothing (even that month).
2. Stopped before the month → nothing.
3. **Special Case** → the whole month (31 in October).
4. **First week appointment, month 3** → the whole month.
5. Payment start after the month → nothing (**Not yet paying**).
6. End date passed → nothing, **only if "end date decides" is on**. It is off.
7. Otherwise owed.

`countsTowardTotal` = owed **and** the row is for that month. Every total,
colour and badge comes from this rule. `paymentPeriodSql` is the same rule in
SQL, giving **Active / Not yet paying / Ended**.

**Rules on top:**
- **A deal ends only when stopped** (`stopped_on`, Archive). The end date is
  information. It only puts the deal in the monthly review.
- **The stored `status` column is stale.** It is written from the end date at
  upload and on end-date edits. CRM pages and exports use `payment_period`.
  WhatBot still reads the stored one (see Open).
- **Payment start:** appointment + 90, or for a first week appointment the last
  Friday of month 3.
- **Rates:** add on / fee per person (`tb_people`) and crypto % (Settings) are
  applied by `withRates` before any total or file.
- **A CRM edit wins:** editing a cell claims it in `manually_overridden_fields`.
  The import still overwrites claimed cells you tick in its review.

## Pages

| Page | What it does | Connects to |
|---|---|---|
| **Dashboard** | Deals, people, companies, monthly payable, splits, recent changes. | Live month and forecast through `isOwedThisMonth`; past months from snapshots. |
| **Master sheet** | Live deals, 50 a page, every cell editable. Payment start colour, Status badge, bulk Edit / Special case / Stop / Delete, Review button, Export, Import. | Stop archives (`stopped_by_hand`). Import below. |
| **People** / person | People with a live deal. **Should be paid**, **Paid** (set on all their live deals), Payment received (from WhatBot's payday), add on / fee %. | Should be paid decides payment files. Payment received comes from WhatBot. |
| **Companies** / company | Status: active, going concern, review, **winding down** (`liquidation`), **closed** (shown "Dissolved"). Tiers. | Review, going concern and winding down open a checklist that ticks deals `review_monthly`. Closing stops the deals (`company_closed`); reopening resumes only those. |
| **Winding down** | One row per company in `liquidation`: stage, deadline, owner, liquidator, contact log, docs. | Stage "Dissolved" closes the company and stops its deals. Diane reads the docs and deadlines. |
| **Review** | This month's queue: deals with a passed end date or a `review_monthly` tick. | **Still running** = paid. **Final month** = stopped at month end. **Already ended** = stopped at last month end. Unanswered = paid, warned on export. |
| **Archive** | Stopped deals, dead people, dissolved companies. Resume / Restore. | A `company_closed` row comes back only by reopening its company. |
| **Expenses** | Separate ledger (`tb_expenses`), its own rates. | WhatBot and Diane add expenses through one brain (`expenseBot.js`). |
| **Chat** | WhatsApp threads from `tb_messages`; admin replies. | Replies go to WhatBot's webhook (`localhost:3002`). |
| **Flagged** | WhatBot concerns (dispute, distress, legal…). | WhatBot posts them. |
| **Logs** / **History** | Logs (developer mode only); History = last 7 days of changes with Undo. | |
| **Settings** | End date decides, crypto %, local locations, FX rates (set + Pull now), WhatBot writes on/off, briefing, Diane auto confirm, expense admins, WhatBot numbers, upload, BURN THIS MONTH, reset. | Driver runs are on the Export modal's Drivers tab, not here. |

## Import (upload)

Upload the boss's xlsx → preview (`parseImport` → `diffImport`) → review tabs
(update, new, potentially ended, companies) → nothing is written until
**commit**. Columns the file lacks are never written, rows it omits are never
deleted, and `stopped_on` is never touched. The "Potentially ended deals" tab's
action is a **hard delete**, not a stop.

## Exports

Modal tabs: **Master sheet**, **Generate for {month}**, **Drivers** (Division,
Expensing, Cash, Bank and Bank details are built but hidden; PDF is off).

The chain:

1. The modal sends preset + template (+ method, columns, month, shape).
2. `exportQuery.rowsFor`: live rows → filters → preset → **Should be paid off
   is held out of payment documents** → month roll (`rollToMonth`).
3. `previewExport` counts and warns (bank details, other month, **unanswered
   review**, **switched off**…), from the same rows.
4. `/export/xlsx` adds FX (`fxRates.usdPerGbp`), tiers, rates and the driver
   setup → template → builder → file or zip.
5. Builders apply `withRates` first. Real Excel dates. The one-book master sheet
   has live formulas (Special Case keeps its values). A generated month shows
   the true first week start date.

| Document | Who is in it |
|---|---|
| Master sheet (working file) | Every live deal, switched off included. Uploaded back, so nothing is dropped. |
| Master sheet Bank / Cash / Crypto runs | That method, switched off left out. Default columns are the boss's; never change them. |
| Generate for month, Division | Owed that month, switched off left out, totals per currency. |
| Drivers | UK cash by run (places set on the map, Drivers tab), Outside UK in USD, Mid split. Owed, switched on, above 0. |
| Earnings breakdown (one person) | Their deals with rates and live Status, switched off left out. |

**FX:** pulled daily from openexchangerates (fallback open.er-api) into
`tb_fx_rates_daily`. A rate set by hand wins only if saved after the pull. AED
is pegged at 3.6725. Only the Drivers sheet prints the rates.

**Diane cannot export** (`export_sheet` is off); she sends people to the
Export button. Full detail: `exports.md`.

## Month end

- `snapshotScheduler` saves the month on its last day (catches up on the 1st)
  into `tb_month_snapshots`, read only, last 12 kept. The dashboard reads them.
- **BURN THIS MONTH** (Settings) snapshots, then **truncates all of
  `tb_mastersheet`, archive included**. The next month starts from a new
  upload.

## Diane

- A turn: `POST /master-sheet/agent` (streamed). A router sorts the message
  (edit, bulk, multi step, question, undo, chat), then plan steps or a tool
  loop (max 10 rounds) and guards. Contexts: Master sheet, Expenses, HMRC & CIS.
- Reads deals, totals, people, companies, review, winding down, flags, rates
  and past chats. Writes deals, people, companies, review answers, winding
  down, flags and rates.
- **Anything touching many rows asks first.** Auto confirm (Settings) skips
  that only for single row, person and winding down edits.
- Undo: deal changes from `tb_mastersheet_changes`, the rest from
  `tb_agent_undo`. Diane can park an action for a later month (it runs on the
  first sign in that month).
- HMRC mode searches GOV.UK and HMRC manuals and works out CIS in code.

## WhatBot ↔ CRM

- **Roster:** every 5 minutes WhatBot pulls `GET /api/v1/agent/master-sheet`
  (`toAgentRow`) into Redis (`whatbot-redis`, :6390). A failed pull keeps the
  last roster. It never edits the sheet.
- **Who may message it:** a phone with an *active* assignment
  (`whatbot/src/employee/access.js`). Each bot number maps to a group.
- **Pay it tells people:** the stored `payable_amount`, totalled per currency.
- **Writes to the CRM** (`x-api-key` = CRM `AGENT_API_KEY`): messages (Chat),
  concerns (Flagged), logs, payday answers (`PATCH /payment-status` → Payment
  received; confirmed sets Paid yes, not received sets it no), expenses. The
  setting **WhatBot writes** off blocks payday writes.
- **Payday check:** last Friday, 16:00 UTC: "did you receive your pay?"
  `PAYDAY_DRY_RUN=true` (sends nothing). A real send needs `--only <number>`.
- **CRM → WhatBot:** admin replies from Chat go to `/webhook/admin-reply`.
- Models: OpenAI (`gpt-4.1-mini`; v2 `gpt-5.4-mini` behind `PAYMENTS_V2=1`).
- More: `whatbot-crm-expenses.md`.

## Open

1. **OpenAI has no credits** (429): Diane and WhatBot's model calls fail.
2. **WhatBot reads the stale stored status**, so Gary (both deals), James
   Heath and FB count as inactive there while the CRM pays them.
3. **WhatBot's pay figure is raw:** no add on or crypto %, no Special Case, no
   Should be paid. It can differ from the exported files.
4. **WhatBot's `CRM_API_URL` is `localhost:3000`**, but the CRM runs on 3001.
5. **A Final month deal drops out of this month's exports and dashboard.** It
   is stopped at month end, and every reader loads only rows not stopped. No
   live deal is affected today.
6. **Burn deletes the archive too** (truncates every deal row).
7. **The Payment start colour on the page lacks two server rules** (closed
   company, first week month 3), so it can disagree with the Status badge.
8. The boss reference xlsx files in `docs/9v8uhjns1bgiauap` are gone (not in
   git), and so is the `docs/boss/references` link.
9. Liam Edwards (Fostabam) has no contact or bank details anywhere. Drew
   (Black country) needs a run on the Drivers tab.
10. `closure.md` is partly stale: it still lists "dissolved" as a status and
    "Yes / No" review buttons (now Still running / Already ended).

## Docs

`exports.md` · `closure.md` · `flow.md` · `whatbot-crm-expenses.md` ·
`expense.md` · `diane.md` · `run-it.md` · `todo.md`
