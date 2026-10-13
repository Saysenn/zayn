# diane.md

## Planned (agreed 2026-10-12, not built yet)

### B. Payment labels for cash envelopes

- Diane makes many labels at once, for the envelopes in the payday cash delivery, following our label rules and codes.
- Data she has per deal (cash master sheet): name, role, company, payable amount and currency, location code name
  (Main City, Chip county, Geordie, Northern Dock, Strong man, South East…), door number, postcode, phone,
  accepting postals, or "In person meet" / "Handled internally".
- **Waiting on the owner's rules before building:**
  1. What is written on one label, line by line.
  2. The codes, and the rule for building each one.
  3. One label per person or per deal; are several deals in one envelope combined.
  4. Who gets one: cash only, posted too, "Handled internally".
  5. Label size and output: sticker sheet or printer, PDF or Word.

### C. Lawyer mode drafts documents

- In lawyer mode: "draft a letter to HMRC about…", "write a subcontractor agreement for…", or "reply to this" with
  a document attached.
- She drafts it in our house style from our playbook (company details, how we do things), shows it, and takes changes.
- A Download Word button exports it as `.docx`.
- A template saved as ours ("this is our standard contract") goes into the playbook and is reused.

### D. The Liquidations page (agreed 2026-10-13)

- The page lists every company whose status is Liquidation (`/liquidations`, migrations 084 and 086). Diane can
  already put a company into liquidation (`update_company`), which puts it on the page.
- She should be able to do on it what an admin can, by asking:
  1. **Read:** list them, filtered by stage, group or owner; one company's full row (director, mid, stage,
     instructions, deadline, next action, owner, blamed, liquidator, note, docs, settlement); its contact log and
     stage history; "what deadlines are due this week".
  2. **Update:** any of those fields ("set Acme to HMRC liq", "deadline 30 Nov", "owner is admin", "blamed yes").
     The stage never changes the company status; she says so if asked.
  3. **Log contact:** add a dated line to the communication log ("log: liquidator emailed for bank statements").
  4. **Documents:** list them and send one back on request; save a file attached in chat to a company's docs.
     Removing a document asks first, and moves it aside rather than deleting it.
  5. **Add and remove:** never on the page itself. A company comes on by setting its status to Liquidation and
     leaves when it is set back; she does that through `update_company`, which already asks.
- Every write asks first, like her other writes, and lands in the page's stage history with who asked.
- Tested with the Diane suite on `crm_suite` only when the owner says to run it (paid runs).

## This file

The handover between the CRM and Diane, the CRM's assistant. The CRM changes faster than her tools, so every CRM
feature added or changed gets an entry here. "Check diane.md, implement everything new" is a complete instruction.

- **A CRM feature is not finished until this file names it** (rule in `.claude/CLAUDE.md`).
- An OPEN entry is a proposal, not permission. **Never widen her reach without asking first.**
- An entry says what she should DO, not how; the tool shape is decided when it is built.
- A write that can touch more than one row takes the two call shape (`confirmed`), as `bulk_update_master_sheet` does.
- Related: `docs/diane-v2.md` (the v2 rebuild), `docs/diane-testing.md` (how to test her).

## Where the code lives

| What                         | Where                                                |
|------------------------------|------------------------------------------------------|
| The turn (v1)                | `crm/api/v1/agent/runAgent.js`                       |
| Tools                        | `crm/api/v1/agent/tools/` (most in `masterSheet.js`) |
| Prompt                       | `crm/api/v1/agent/prompts/`                          |
| Plan engine, routers         | `crm/api/v1/agent/engine/`                           |
| Reply guards                 | `crm/api/v1/agent/check*.js`                         |
| Turned off tools             | `crm/api/v1/agent/disabledTools.js`                  |
| Shared definitions (figures) | `crm/api/v1/shared/*.helper.js`                      |
| v2                           | `crm/api/v1/agent/v2/`                               |
| Her colours                  | `crm/web/src/configs/dianeTheme.js`                  |
| Sign-in speech cache         | `crm/web/src/components/agentOrb/speechCache.js`     |

Model: `AI_MODEL` (default `gpt-4.1`) and `AI_MODEL_LIGHT` (default `gpt-4.1-mini`, `off` keeps every turn on the full
model), in `crm/api/.env`.

## How she works: the rules

1. **Figures are code, never the model.** A tool hands back the finished sentence; `computedReply: true` returns it
   verbatim with no model round.
2. **One definition.** Every figure she gives comes from the same helper the page or export uses, so she and the
   screen cannot disagree. A second definition of a formula is the bug.
3. **A guard is code, not a prompt line.** A sentence in a description is not a guard.
4. **Writes are previewed.** Risky or multi-row writes take the two call shape (`confirmFirst`): the first call writes
   nothing and says what would change (FROM and TO, the level, the figure, the month). A yes applies exactly what was
   shown, only on the next message.
5. **Ambiguity is about which PERSON, not how many rows.** `resolvePerson.js` resolves on an exact match; more than one
   person stops her. `tools/whichDeal.js` (`whatSeparates`) picks what tells deals apart: company, group or role, never
   a field they share.
6. **Never a total across currencies.** One figure per currency; a group at zero is said, not left out.
7. **A cap says when it cut.** Forty pending and ten listed means saying forty and that it was cut. A total over a
   page is refused.
8. **Name the month**, never "last month" when the compared month is not the previous one.
9. **The sentence they typed wins** over an argument she left out or invented (month, `convertTo`, `only`, scope).
10. **She suggests, the admin decides.** She never invents a value, never answers a review on her own.
11. **She points, she does not offer** what she cannot do: she names a real button the admin presses.

## Her window

Four months: the two before this one, this one and next, the same as the dashboard. `tools/monthHistory.js`:
`MAX_HISTORY_MONTHS` is 3, `MAX_FORECAST_MONTHS` is 1.

- Past months come only from saved snapshots, the current month from live rows, next month from `projectMonth`
  (shared with the dashboard). Every line names its source.
- A gap is never bridged; a month with no snapshot is skipped and named.
- A saved month converts at its saved rate, a live or projected one at today's.
- `compare_months` prints what moved, deal by deal (`shared/monthReconcile.helper`, shared with the dashboard):
  added, removed, ended, not counted this month, changed (which part). Per currency. It balances, or a warning line
  says it does not.
- She cannot create a snapshot.

## What she can do

**Reads**
- Totals, filters, breakdowns, people, companies, deal cards. `summarize_deals`: average, sum, min, max, count, per
  person / company / group / role / currency / method, with `atLeast` / `atMost`. Held until their words ask
  (`ASKS_FOR_HELD` in `runAgent.js`).
- Ordering: `sortBy`, `sortOrder`, `limit` on the filter, sorted in USD, ties named.
- Deal Status (`dealStatus` filter, "Deal status" cell) from `dealStatusSql` / `dealStatusOf`. The monthly review
  QUEUE (`list_monthly_review`) and the STATUS are different numbers.
- Rates: `check_rates` (also by `company`). A yes/no rate question opens with a verdict (`rateChange.rateVerdict`, Yes,
  No or Partly), checked by `checkVerdict.js`.
- Archive: `list_stopped_deals`, read only. Resume is the page's.
- Dead list: `list_dead_people`, `dead_person_details` (`tools/deadPeople.js`, figures from
  `deadPersonJourney.helper.js`). Read only.
- Company settlement: shown on the company list, read only.
- WhatsApp concerns: `list_concerns`, only when asked.

**Rates**
- An add on, crypto charge and fee are inside the Monthly amount (`shared/rates.helper` `withRates`, once). Maid's
  4,700 on 5% reads 4,935. **Never add a rate to a figure she was handed.** The raw wage is `monthly_amount_raw`.
- Answer shape: one headline with the net, one arithmetic line ("GBP 2,000 Workforce + GBP 100 add on (5%)"). A per
  person line only for groups. No line restates a total. Wording: "in total", "plus", "less".
- The fee is deducted. `RATE_DIRECTIONS` is the one sentence for direction.
- Rate changes take the two call shape at both levels through `settleRates`. "Add another 3%" uses
  `addonPercentDelta`. "Take 5% off" is a 5% fee. A person's rate with no deal named is their profile. Profile changes
  are logged as `personAddonPercent` and can be undone.

**Writes**
- Row edits: `update_master_sheet_row`, `edit_deal_form`, `fill_form` (only while a form is open).
- Bulk: `bulk_update_master_sheet` on any column; `add: { payableAmount: N }` (also `monthlyAmount`, `payableDays`).
- Several people: `update_person` takes `people`; one confirmation, all names resolved first, one bad name stops all.
  `confirmReplay.recallAll` applies every remembered call one yes covers.
- Special case (`special_case_deal`, migrations 064-065): forces the WHOLE preset month to pay. Only through
  `confirmSpecialCaseDeal`; the preview names the figure and month. She asks off the row state
  (`specialCaseDealAsk`), never a phrase. Never because a figure looks wrong to her. Name in `shared/specialCase.js`
  and `web` `configs/specialCase.js`.
- Special case and payable amount: **named deals only, never over a filter** (`NAMED_DEALS_ONLY`).
- Monthly review: `answer_monthly_review`, `bulk_answer_monthly_review` (`entries`, keyed on the deal). Answers in
  their words (`ANSWER_WORDS`: continue, ongoing, ended, stop, done, close). A scope word is tried as company OR group.
  No or final sets `stopped_on` and moves the deal to the Archive. Same route as the page; refuses a deal not in the
  queue. All review tools read `shared/reviewQueue.helper.js`.
- Stop and resume one deal: `stop_deal`, `resume_deal`, no confirm (one row, resume puts it back). Ending a deal is
  never a payment switch (`bulkIntent.endingNotSwitch`).
- Companies: `update_company`, `rename_company`, `bulk_update_companies`, `bulk_close_companies`.
- Undo: `undo_master_sheet_change`. `isUndoableField` on the repo decides what can be undone.

**Conversations and scheduling**
- `recall_past_conversations`, `show_past_conversation`, `delete_past_conversations` (lists first, a yes deletes
  exactly those, held until their words ask). "Today", "last week", a month with no year are read in code.
- `park_for_month`, `list_parked_work`, `cancel_parked_work`. "Cancel that" after parking cancels the parked work. A
  company closure replaces only an earlier one for the same company.

**Sign-in briefing**
- Computed in `shared/briefing.helper.js`, never composed by her. Eight topics: winding down, past a year, review this
  month, not marked paid, whatbot flagged, import checks, special case on, payable over monthly.
- A count per topic, then the card read aloud (`briefingAnswer.cardEntries`). Nothing to report means no orb. Off in
  Settings (Whatbot section, migration 060). HUD colour is `dianeTheme.JARVIS_HUD`.

## Turned off

- **`export_sheet`** refuses, no panel. Off, not removed: re-enable by deleting its entry from `DISABLED` in
  `agent/disabledTools.js` (also `CANNOT` and `POINTS_AT` there). `add_deal` is back on.
- The handler refuses; she points to the **Export** button on the **Master sheet** page. Button and page names are
  constants in `disabledTools.js` (`EXPORT_BUTTON`, `ADD_BUTTON`, `SHEET_PAGE`); rename them there when `crm/web`
  renames them.
- **The payment period (`status`) is derived**, not settable. It is not in `ROW_FIELDS`; asking hits `NOT_SETTABLE`
  in `tools/masterSheet.js`, which says nothing changed and to change the payment start, preset or end date. Her card
  reads `payment_period`.
- Her card shows both switches: Should be paid (yes green, no red) and Paid (yes green, no amber), both behind
  `payableThisMonth`.

## Key guards

| Guard                          | Stops                                                             |
|--------------------------------|-------------------------------------------------------------------|
| `checkFigures`                 | a figure no tool returned                                         |
| `checkCounts`                  | a count that drifted from the queue                               |
| `checkMonths`, `checkQuestion` | money claims about the wrong month or question                    |
| `checkClaimedWrite`            | saying stopped, archived or done with no write behind it          |
| `checkEmptyClaim.js`           | "Nobody" with no tool behind it                                   |
| `checkUnbackedAsk.js`          | "shall I?" with nothing prepared                                  |
| `checkRateDirection`           | a rate said to move the wrong way                                 |
| `checkRelayed`                 | a deal dropped from a list to relay verbatim                      |
| `checkVerdict.js`              | a rate yes/no answer with no verdict                              |
| `setIntent.js`                 | an instruction answered with a lookup (tools flag `writes: true`) |
| `interimLine.js`               | a lone or question-ending `say` line                              |
| `confirmReplay.nextTurn`       | a proposal applied to any message but the next                    |
| `alreadyDone`, `notTwice`      | a bare yes redoing a finished write                               |
| `splitPersonAndGroup`          | "zayn milkman" read as one name (`tools/notAGroup.js`)            |
| `wrongMonthAsked`              | "for October only" on a field that has no per month value         |
| `guessedDeal`, `namedBy`       | picking a deal or person they did not name                        |

## What she deliberately cannot do

| What                                         | Why                                                                   |
|----------------------------------------------|-----------------------------------------------------------------------|
| Create a person or a company                 | One exists because a deal names it (`add_deal`).                      |
| Guess which row                              | `find_and_show_details` resolves a name; two people stop her.         |
| Total over a page                            | A capped total looks right and is not. Refused.                       |
| Upload a sheet, edit settings, read logs     | Not hers. She says so.                                                |
| Change a global rate or set an FX rate       | A Settings decision with an author and a date.                        |
| Delete a person or a company                 | Nothing in the CRM can. Never `delete_master_sheet_row` in its place. |
| Write an expense                             | The page's.                                                           |
| Special case without a confirm               | It moves a total. `confirmSpecialCaseDeal`.                           |
| Special case or payable amount over a filter | The admin would agree to a count, not to deals. Named deals only.     |
| Set `end_note` or `review_monthly`           | Not in `COLUMN_FOR`; the import writes them.                          |
| Resume an archived deal                      | One deliberate act on the page.                                       |
| Decide a review answer                       | Yes, no and final are the admin's.                                    |
| Take someone off the dead list               | That is a deal added back.                                            |

## Open (proposals, not permission)

**The review page**
- No answer removes the deal from the queue (`STAYS_AFTER_STOP` keeps only `review_final`). After a bulk no she should
  say those rows left the review and are on the Archive.
- She cannot undo a review answer (read `tb_mastersheet_changes` for `field = 'reviewAnswer'` plus
  `monthlyReview.revertAnswer`, two call shape). Widens reach: needs a yes.
- `POST /monthly-review/clear` is gone; she must never offer to put a deal back to Waiting.
- `checkCounts`: a count taken before a no and quoted after is a real drift.

**Set Deal Status.** Writing is `dealStatusWrites` (both columns, always), two call shape, one row at a time. "Going
concern" clears the end date, so the confirm must say so. Name the deals it touches first.

**Say "not undoable" at the ask.** `findFieldChanges` carries `revertible`; `peekFieldChange` should carry it and
`undo_master_sheet_change` refuse before the two call shape.

**Export, if turned back on**
- Name the presets from `listSheetPresets()` (All, Standard, Bank, Cash, Crypto), columns AND method filter
  together. Never a list of column keys in a prompt.
- `perGroupTabs` only on the master sheet template.
- Say the real filename (`fileLabelOf(template, method)`, e.g. `MASTER SHEET - BANK`).
- On the master sheet tab, Payable amount is rated and Monthly amount is the stored wage (the upload reads Monthly as
  the wage).
- The file is live (`masterSheet/sheetFormulas.js`): she should say dates and payable figures follow the appointment
  date. She must not offer to change which columns are formulas.
- `showRates` (words from `shared/rateText.helper.js`, never her own), `primaryColor` (from `listPaletteColors`),
  narrowing to a person (`personId`).
- Two more designs exist: `Converted to USD + Add ons table` and named adjustment rows.

**Suggest fixes for the sheet (largest entry).** Sweep for faults, each with its fix, narrowable like any read;
explain the formula on the row; apply a fix behind the two call shape through the SAME route the page uses; say what
it does to the money. Fault rules already in code:

| Fault                                   | Rule                                                        |
|-----------------------------------------|-------------------------------------------------------------|
| Dates disagree with appointment + 90    | `shared/fromAppointment.helper.js`, `repairFromAppointment` |
| A date missing the other two imply      | `shared/suggestDates.helper.js`                             |
| Payable days outlived their dates       | the dates win                                               |
| Payable days but no monthly, or reverse | `computePayable`                                            |
| Preset disagrees with the sheet         | `shared/presetMonth.helper.js`                              |
| Bank method with no account number      | the upload's `review_reason`                                |
| A row with no group                     | `masterSheet/dealKey.js`                                    |
| A rate on the person AND the deal       | they stack, `shared/rates.helper.js`                        |
| A row not counting this month           | `shared/owedThisMonth.helper.js`                            |

Guards: never a second formula; suggest, never decide; never invent a value (say what is missing); every suggestion
carries row, column, now, would be, and rule; a backward derivation is marked a guess and never batched; no health
score; never volunteered unasked. Hooks: `audit_master_sheet`, `crm/web/src/helpers/dateNotices.js`, `ExportWarnings`.

**Missing and mismatched dates.** Answer "what is missing on this row" and "which rows have dates that disagree", read
only. Say forward or backward (backward invents an appointment date). Never apply one; never offer to correct a
mismatch (the stored value is what was paid).

**Expenses** (`tb_expenses`, `/expenses`, see `docs/expense.md`). Read only: a month's or a group's total
(`SUM(aed_amount)`), a handful of rows, and rows with no `exchange_rate` (out of every total). Never add an expense to a
payout figure, never convert one herself, report how many rows a total left out.

**FX rates** (`tb_fx_rates`, migration 051, `shared/fxRates.helper`). Say where a rate came from ("the rate you set on
…" when `saved`), answer one currency's rate, refuse a rate she cannot source.

**Data checks.** "Who still has special case on?" and "who is paid more than their monthly?" from
`shared/briefing.helper.js` (`specialCase`, `payableOver`), each deal with both amounts. Read only.

**Briefing on request.** "What needs doing" mid-session, read only, over the same helper.

**Month on month.** "How are we doing against last month": change and difference from the panel's two figures
(`changeBetween`). Refuse a ratio across currencies; never cap a percentage.

**Stage lists.** "Which ones" after a stage count, from the same predicate (`PERIOD_FOR_STAGE` in
`crm/web/src/helpers/dashboard.js`). Words: paying, ended, not paying yet.

**Day level date range.** Every date filter buckets by month; the page has no day range either.

**Command center**
- `agent_vitals`: read only, so "are you alright" and "how long are you taking" can be answered from what the panel
  shows.
- A theme colour from Settings for the orb, command center, login and loading pages. All colours come from
  `dianeTheme.js`; `ParticleOrb` and `LoginOrb` need the resolved value at init.

**Screen pointers.** Deal lists are chips that open the full card; `#47` row ids in her prose are clickable (keep
them). A person's add on and fee sit in a Breakdown card; People's Export button is hidden (`SHOW_EXPORT`).

## Decided against for now

- **Arithmetic on figures she already has** ("difference between his INDIGO and MILKMAN totals"). She says she has no
  tool for it. A `compare_totals` returning the finished sentence would close it; new reach, waits for a yes.
