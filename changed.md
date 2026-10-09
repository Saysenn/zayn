# changed.md: what changed, why, and how (2026-10-08 → 2026-10-09)

Written for another Claude (or a person) picking this work up cold. It covers one long Claude Code
session (it spanned two days and one context compaction) plus a note of what OTHER sessions changed
in the same files at the same time. Nothing here is committed: every change is in the working tree
of `C:\Users\yatsen\Documents\diane` on branch `main` (uncommitted, some staged by earlier sessions).

Read in this order: §1 (state of the machine), §2 (the rules the owner set), then the area you need.

---

## 0. Contents

1. State of the machine and the environments right now
2. The owner's standing rules and decisions (dated, with reasons)
3. Expense bot (CRM brain + WhatsApp + Diane): the 7 phases
4. Expenses check (refunds): migration 078, repo, routes, UI, whatbot
5. Diane: conversation fixes (routing, read router, forced routes, history, totals)
6. Diane: reading an uploaded sheet (groups, AI judgement, renames, merges, splits, trust)
7. CRM web UI / UX changes
8. Whatbot changes
9. Infrastructure: DB pool, local Redis, DEV database, test runners
10. Tests: unit tests added/changed, suite cases added, test tools
11. Test results (before / after, every number measured)
12. Bugs found and fixed (root causes), in one list
13. Known issues and work NOT done
14. Clean-up still to do
15. Changes made by OTHER Claude sessions in the same period (not described here in detail)
16. File index (every file this session touched, one line each)

---

## 1. State of the machine and the environments right now

| Thing | State |
|---|---|
| Repo | `C:\Users\yatsen\Documents\diane`, branch `main`, **nothing committed** by this session. Some files were already staged by earlier sessions (git shows `M`/`A` in the first column). `.gitignore` and `LICENSE` show as **deleted and staged**; that was NOT this session, check before committing. |
| DEV database | Supabase project `ekjbnhbhphrkyuojprjo` (eu-west-1 pooler, port 5432, session mode, **15 clients max**). Named in `crm/api/.env` as `TEST_DATABASE_URL`; `DATABASE_URL` in that `.env` is the SAME DEV DB (the local dev API runs on DEV). |
| LIVE database | `LIVE_URL` in `crm/api/.env` (project `nswpkezvjdfiqsquvcsb`, ap-south-1). Only ever READ (to refresh DEV). `scripts/testDb.js` refuses LIVE as a test target. |
| DEV contents | Last left as a copy of live (refresh `npm run refresh:dev` in `crm/api`). Other sessions' suite runs wipe DEV for fake data while they run, so check before relying on it. Migration 078 is applied on DEV (`schema_migrations` last = `078_expense_check.sql`). **Not applied on LIVE.** |
| Test logins/rows left on DEV | `claude-test-admin` CRM admin (created with `scripts/seedAdmin.js`; credentials in the session scratch file `test-admin.json`, NOT in the repo; a DEV refresh removes it). Expense admin row `Sim Admin`, phone `+447700900077`, group `NEXUS` in `tb_expense_admins` (for the two agent simulator). |
| Local Redis | NEW. Portable Redis 8.10.2 for Windows (project github.com/redis-windows/redis-windows, MSYS2 build, sha256 `7c8cebd5…ee85` matched GitHub's digest) in `C:\Users\yatsen\redis` (outside the repo). Config `C:\Users\yatsen\redis\whatbot-dev.conf`: bind 127.0.0.1, port 6379, **maxmemory 64mb, maxmemory-policy noeviction** (BullMQ needs noeviction), `save ""`, `appendonly no`, maxclients 64. Start after a reboot: double click `C:\Users\yatsen\redis\start-redis.cmd`. Stop: `redis-cli shutdown nosave`. |
| whatbot `.env` | `REDIS_URL=redis://127.0.0.1:6379` (local). The old Upstash URL is kept on the line above, commented out. A backup of the previous `.env` is `C:\Users\yatsen\redis\whatbot.env.backup-upstash` (moved OUT of the repo because it holds the Upstash password). |
| Upstash | The old whatbot Redis (`above-gobbler-211011.upstash.io`) hit its plan limit: `ERR max requests limit exceeded. Limit: 500000, Usage: 500005` (2026-10-08). Cause: 5 idle BullMQ workers polling. **Unknown whether the LIVE whatbot uses the same Upstash DB**; if it does, live was affected too. |
| Processes I may have left | A CRM API on **port 3200** (pid 13572 at last check) started by me for the two agent simulator; stop it. Port 3000 is the owner's dev API: never killed or used by tests. |
| Scratch (outside repo) | `C:\Users\yatsen\AppData\Local\Temp\claude\C--Users-yatsen-Documents-diane\4e2e1b70-ac9d-4034-88f4-cb4e71103fbd\scratchpad\` holds the test tools (§10.4), logs (`all/`), and `head/` = a git worktree of HEAD (commit `67b6439`) used as "before"; **`head/crm/api/.env` and `head/whatbot/.env` are copies of the real `.env` files**, and `head/*/node_modules` are junctions to the real ones. Remove the worktree with `git worktree remove` AFTER deleting the junctions (`rmdir` them), or node_modules gets deleted too. |
| Machine | Windows 11, **4 GB RAM** (often < 400 MB free). Heavy parallel runs crash things: run tests one at a time, stop VS Code/Brave, stop the dev API and the whatbot worker during long runs. |

---

## 2. The owner's standing rules and decisions

Project `CLAUDE.md` (verbatim intent): don't auto build/test/document unless asked; answer short, in
numbered lists; test on the cloned/DEV DB first; colour buttons properly; keep UI/UX consistent;
list what you'll do first unless told to proceed. Memory note: don't run ad-hoc test snippets unless
asked (relaxed later: the owner explicitly asked for full testing with a $20 then $50 budget).

Decisions made in this session (dates 2026-10-08/09):

1. **Expense bot picks**: "1-3", "5-6 only", "not 2" must work on any numbered list or preview.
2. **BulkBar**: "Clear" renamed **"Clear selection"**.
3. **Voice notes** on the expense bot: on hold (logged in `docs/feature.md` item 15).
4. **No mixed language**: British English only. Dropped: daily summary, mixed language.
5. **Expenses are separate from pay**: they get their own **settled / unsettled / review** check
   ("settledExpenses"), sent on payday, and are never mixed into the master sheet totals. Payment
   and expenses live on the Expenses page + Flagged page only.
6. **"yes" to the expenses check is final**; "no", "partial" or "sorry / mistake" → admin review on the
   **Flagged** page (category "Expense refund") plus a badge on the Expenses page.
7. **Only the CRM admin settles/unsettles** (Expenses page bottom bar, or Diane). Nothing auto-settles.
8. **Expenses page** defaults to the current month **plus anything unsettled** from earlier months.
   Settled ones from the past 2 months are view only (history/audit).
9. **Late / unpaid / overdue** are derived, not stored; weekly alerts from the 1st to the CRM admin.
10. Expense page operations go in the **bottom bar**.
11. **Diane reading a sheet must be smart, case by case**: ask only when genuinely unclear, never
    always; be short, direct, easy to confirm (groups first, then changes); never long paragraphs.
12. **"Isn't AI going to help with classification?"** → group identification is judged by the AI from
    facts code gathers, not by a growing list of name rules. Code holds her to the facts (§6.4).
13. **"Can we trust it without double checking?"** → the bar: apply a sheet, upload it again, and
    nothing is left to change (the trust test, §11.3).
14. **Images in Diane's chat**: arrow keys and on screen arrows to move between pictures; when a turn
    has a picture, hide the long text/list for that turn (Diane still reads it in history).
15. **Tests must be unbiased**: blind randomised batteries with the truth written by the generator,
    the same battery run on the old code and the new.
16. **Nightly runner (Windows task)**: dropped ("very costly").
17. **Local Redis instead of Docker** (Docker Desktop + WSL2 would cost 1.5–2 GB RAM on a 4 GB PC).
    Minimal caching: 64 MB cap, nothing on disk.
18. **Two simulated agents** must chat with whatbot (expenses + payments), randomised, exchanges printed,
    to find breaks and duplicate sends.

---

## 3. Expense bot (CRM brain, used by WhatsApp and by Diane)

Architecture recap: `crm/api/v1/expenses/bot/brain.js` is the brain for both WhatsApp (per group
number) and Diane (`channel: 'diane'`, group `'*'` = `find.ALL`). Messages are read in code first
(`reply.js` `readReply`, `quick.js` `quickRoute`, `brain.js` `codeFirst`) before the OpenAI planner
(`planner.js`, strict json_schema through `ai.js ask()`). Pending draft kinds: add, edit (items +
removes + `item.splits`), remove, pick, undo, either, and NEW `settle`. Undo uses `tb_expense_actions`
(jsonb `changes`).

The original bug (owner's report): "show me all expenses" → "update spent by to gloria" (6 suggested)
→ "pls only 1-3" was refused ("say yes or cancel"). Root cause: `readReply` returned null for
edit/remove pendings and preview lines were not numbered.

### 3.1 Phase 1: lists and picks
- `reply.js`: NEW `numberSet(s)` (reads "1-3", "1 to 3, 5 and 7", "#2 & #4") and
  `linesPicked(bare, count, {removeWords})` → `{keep, out, said}` / `{bad}` / null. Keep forms: only,
  just, "X only", first/last N, "(change|remove) only". Out forms: not, except, skip, drop, leave out,
  without, all but, don't change. In the edit/remove block: `yes N` → `{kind:'yes', n}`; picks →
  `{kind:'lines', keep, byLines}` / `{kind:'lineOut'}`. In the add block: `{kind:'only'|'skip', which,
  byLines}`. Typos: YES adds yse/yess+/yeas/yea; NO adds cancle/cancell/cansel/cacnel/canel. Exports
  `numberSet, linesPicked`.
- `format.js`: `PICK_HINT(n)`; `effectLines(items, removes)` (per person deltas "📊 Gloria +AED…",
  total "Total X ➜ Y"); `paged(lines, all)` (PAGE_AT 15, PAGE 10, "reply *show all*");
  `editsPreview(items, {group, removes, all})` rewritten: numbered lines when >1, split sub lines,
  effect lines, footer "Reply *yes* … · pick some (_only 1-N_ · _not N_)"; `removePreview` numbered +
  paged; `changedMany` numbered + "or *undo only 2*"; saved/removed numbered.
- `find.js`: `between()` on a group adds `AND (spent_on >= $4 OR settle_status <> 'settled')` (current
  month start; Diane `'*'` sees all); `answer()` gets `overlay` (`withOverlay`), `sortRows`, numbered
  lines, a 'No.' table column, `out.listIds`, "reply *show all*". Exports `sortRows`.
- `brain.js`: regexes SHOW_ALL, SORT, SORT_SHORT, LIST_ONLY, LIST_HIDE, FIND_ASK, MISSING_ASK,
  SETTLE_ASK, AS_IF, UNDO_SOME, WHAT_DONE, WHO_DID (+ maps CATEGORY_SAID, SORT_KEY, MISSING_FIELD,
  MONTH_NO, SETTLE_WORDS); the early `readReply` byLines intercept then `codeFirst()`; a list stays "on
  screen" for 6 h (`LIST_MS`, `listOnScreen`, `showList`) instead of 6 turns; list sort/only/hide.

### 3.2 Phase 2: changes
- `planner.js`: KINDS + 'split'; op schema gets `filter` (anyOf object|null: spent_by, category,
  payee, words, min/max_amount, from, to, except), `clear` (payee|spent_by|category), `shift_months`,
  `parts` [{spent_by, amount}]. Prompt rules: clear, shift months, copy a value, split, "only X",
  waiting numbers = P1.., "add 7 too", swap, a set by its rule (filter), positions, THE CONVERSATION
  (last value wins, "do the same" = last change saved, "the rest" = left out, "wrong one" = swap, a
  short reply answers the bot's question, no value → ask only for it). `contextText` adds talk /
  lastChange / leftOut. `needsCare` more trigger words.
- `brain.js`: `changesForOp` adds shift_months (addMonths) and clear → null; `idsByFilter(f, ctx)`;
  `splitFor(op,row)` → `{changes, splits}`; `applyPlan` handles split ops, rule based ids, sorts by list
  order, `ctx.splitNow`; `saveEdit` creates split rows (`createMany`, `fromId`) and records
  `{created, from}`; `rememberChange` (lastChange; leftOut); `keepLines` sets `state.leftOut`; the "run of
  numbers" block ("1-3 gloria, 4-6 zayn") moved BEFORE the planner.

### 3.3 Phase 3: safety
- Warnings (`warningsFor`/`withWarnings`): 10× amount jump, future date, new payee, duplicate; grouped
  by message, inserted above "Reply *yes*".
- Big change check: `BIG_LINES 20`, `BIG_AED 10000`, `bigDraft(p)`; yes requires "yes N"
  ("That's *N expenses*, moving AED …. To be sure, reply *yes N*").
- Stale check flags settled rows; settled rows are locked (`ctx.locked`, "🔒 Settled (refunded), so
  left out: …").

### 3.4 Phase 4: the Expenses check (see §4)

### 3.5 Phase 5: smarter talk
Name suggestions, ask only for the missing detail, mixed actions, questions answered "as if saved"
(AS_IF overlay "As if your N changes were saved…"), learned habits (`payeeHabits()` → category note).

### 3.6 Phase 6: recap and history
Totals in previews + a recap after saving ("X now has N expenses this month (AED …)"); partial undo
(`startUndo(ctx, said)`: some lines `only`, the last N `actionIds`, or a words search covering after
values; `undoOne(actionId, ctx, only)` with per change `undone` flags; `undone_at` only when all are
undone; a created split is removed with its line); "what did you change" / "who changed 4" (`whoDid`,
jsonb query on `tb_expense_actions` joined to admin names).

### 3.7 Phase 7: finding
Search (92 days), missing info sweep with "fill by number" (`state.awaiting='fill:field'`, "1 careem, 2
zuma", "all careem"), receipt by list number (`receiptFor`).

### 3.8 Fixes in this session (two agent test, 2026-10-09)
- `reply.js` `spenderAnswer`: **a named field is never a spender's name.** "1-2 paid to Taxii" (the
  bot's own suggested reply) was saved as `spentBy: "paid to Taxii"` when "who spent it" was also
  missing. Now returns null if the text starts with any `FIELD_WORDS` pattern. Test in `bot.test.js`.
- `find.js` `wordsOf` stop list: "logged", "log", "recorded", "entered", "saved", "added", "far",
  "total", "all", "show", "list", "month", "week", "until", "now", "got", "have", "there", "any", "how",
  "much", "many", "what", "tell" are no longer search words ("total expenses logged this month so far"
  searched for "logged" and found nothing).
- `brain.js` NEW `HOW_TO` + `howToAnswer(t, pending)` at the top of `codeFirst`: fixed one line
  answers for "can I send the receipt first?", "can I add/change it later?", "how do I log/start?",
  "how do I remove/change?", "can I undo?" (with the waiting preview line when one waits). Before: the
  hello menu three times, or a receipt lookup.
- `brain.js` undo by words: with no actions at all → "There is nothing of yours to undo." (same as
  plain undo); with actions but no match → "None of your recent changes is about that. Your last one:
  … Say *undo* to take it back." Before: "I couldn't find a recent change of yours about _name gloria
  not spent gloria_".
- `brain.js` `WHAT_DONE` widened: "show me my last changes (for …)", "my recent edits", "show me the
  last 3 changes", "what were my last changes?" → change history (not an expense search).
- `bot.test.js`: the "1-6 SPENT BY ZAYN" source assertion updated (the run block is now before the
  planner; asserts index order instead of `&& !run`).
- `receipts.test.js`: assertion uses `[...new Set(marked)].sort()`.
- `receipts.js` `clearOld`: keeps receipt files of unsettled rows (`settle_status <> 'settled'`).

---

## 4. Expenses check (refunds)

- `crm/api/v1/migrations/078_expense_check.sql` (NEW): `tb_expenses` + `settle_status`
  (unsettled|settled|review, default unsettled), `settled_at`, `settled_by`, `settle_check_id`, index;
  NEW `tb_expense_checks` (period, group_name, person_id, phone, name, expense_ids int[], total_aed,
  status sent|settled|review, answer, note, sent_at, replied_at, UNIQUE(period, group_name, person_id));
  NEW `tb_expense_settle_log` (expense_id, from_status, to_status, by_who, via check|crm|diane|whatbot,
  check_id, note, created_at); `tb_settings.expense_check_enabled` (default false); drops the
  `tb_concerns` category CHECK(s) in a DO block and re-adds `tb_concerns_category_check` including
  `'expense-refund'`.
- `crm/api/v1/repos/expenseChecks.repo.js` (NEW): STATUSES, monthStarts, `tagOf(row, month)` →
  settled/review/overdue/unpaid/late/null, fromMonth, `setStatus(ids, to, {by, via, checkId, note,
  only})` (transaction + log), openFor, switchOn/setSwitch, questionText, `startCheck({period, personId,
  group, phone, name})`, `answerCheck(checkId, yes|no|partial|mistake, note)` → `{reply}`, flag (creates
  a concern category 'expense-refund'), `raiseUnpaid()` (weekly, via a 7 day NOT EXISTS), logFor.
- `crm/api/v1/expenses/unpaidAlerts.js` (NEW): `startUnpaidAlerts()` hourly when the switch is on →
  `raiseUnpaid`. Started in `app.js` after `startReceiptsKeeper`.
- `crm/api/v1/expenseBot.js`: agent `POST /check` (verifies the person is on the master sheet with that
  phone and group) → `{check:{id,count}, text}` or `{check:null}`; `POST /check/answer` → `{reply}` +
  broadcast; `/mine` rows get `settle_tag` and `from_month`.
- `crm/api/v1/repos/expenses.repo.js`: `spentByPerson` includes earlier month unsettled rows;
  `buildWhere` gets `carry` (current month OR earlier not settled) and a `settle` filter (unsettled /
  settled / review / late / unpaid / overdue). **Bug fixed this session**: the `$` signs of `$1/$2` had
  been stripped by a shell edit (`spent_on >= 1 AND spent_on < 2`), which broke every Expenses page
  read; rewritten with literal `$1`/`$2`, and the late/unpaid/overdue bounds are parameters now (overdue
  pushes its own param). Caught by `expenseFilters.test.js`.
- `crm/api/v1/expenses.js`: `filtersFrom` settle; `GET /expenses` carry (current month unless
  `carry=0`), rows with settle_tag/from_month; LOCKED 409 on PATCH/DELETE of settled rows;
  bulk-update/delete skip settled and return `locked`; NEW `POST /expenses/:action(settle|unsettle|
  review)` (via 'crm', by sessionUser) → `{moved, unchanged}`; NEW `GET /expenses/:id/settle-log`.
- `crm/api/v1/settings.js`: GET returns `expenseCheck`; PATCH validates boolean → `setSwitch`.
- Diane (`brain.js`): `startSettle` / `settlePreview` / `saveSettle` (Diane only; WhatsApp gets "Only
  the CRM admin can settle expenses: on the Expenses page, or with Diane."; another pending → waiting
  line + "Then ask me to settle").
- Whatbot (`whatbot/src/expenses/expenseCheck.js`, NEW): Redis keys `expcheck:open:<group>:<phone>`
  and `expcheck:last:...` (14 days, `withRedisTimeout`); YES/NO/PARTIAL/MISTAKE/ABOUT_EXPENSES words;
  `expenseAnswer`, `expenseCheckAfterPayday(person, group, phone, period)`,
  `answerExpenseCheckIfOpen(group, phone, text)` (a "mistake" needs MISTAKE + expense words or within
  24 h, or REOPEN_INTENT + expense words). **Send timing**: the check is sent only as a follow up right
  after the person answers their payday check (never cold), which keeps the "never message first except
  the paced payday check" rule.
- `whatbot/src/conversation/handleMessage.js`: `withExpenseCheck(reply, person, group, phone, period)`
  adds `more: [text]` after a payday "yes" and after a clarify answer; `answerExpenseCheckIfOpen` runs
  before the REOPEN_INTENT block.
- `whatbot/src/system/crmClient.js`: `startExpenseCheck`, `answerExpenseCheck`.
- `whatbot/src/expenses/myExpenses.js`: per line status, a refund summary line, a "Refunded" picture
  column.
- The master sheet, the payday check and the Review page are unchanged by this.

---

## 5. Diane: conversation fixes (all `crm/api/v1/agent/...`)

Context: the main suite (88 cases) was 80.7% and the library (81 then) 72.8% on 2026-10-08.

- `runAgent.js`, **routing to the plan engine** (`toEngine`): since 2026-10-06 any router `bulk_edit`
  went to the plan engine, which has no percentage and wrote nothing ("Done 0 of 1"). Now:
  `multi_step` goes to the engine only when the words also show several changes
  (`looksMultiStep` or a `;`/newline list); `bulk_edit` goes to the engine only for a LIST of deals
  (`;`/newline). Everything else uses the bulk tool (percent, fee, two people). Stops "on a later day"
  ("end of this month", "on the 15th", a date) no longer count as `endsADeal`, so the stop tool PARKS
  them instead of the engine stopping today.
- `runAgent.js`, **forced route for a percentage on monthly/payable** ("otter monthly +10% pls") →
  `bulk_update_master_sheet` (was read as a 10% add-on rate for a person called Otter). Excludes
  add-on/fee/rate/crypto and later months.
- `runAgent.js`, **read router stands aside when a forced route owns the question**
  (`ownedElsewhere`): "what have we got scheduled?" was read as a sheet filter → "which schedule?".
- `runAgent.js`, `approvedNewGroup` is deleted from tool args unless `turn.planRun` (only a plan the
  admin said yes to can create a group; §6.6). The **payment method "nobody said" guard is skipped on
  plan runs** (the method comes from their file; six new deals were saved as cash).
- `engine/readRouter.js`: one name in `people` is the person (`people: ["Otto Fenn"], person: ""`
  totalled the whole sheet); **"owed … in usd" is `convertTo: 'USD'`, never a USD currency filter**
  (only "paid in usd"/"usd deals" filter); an ask with export/download is not a sheet read (returns
  null so the export-off reply names the Export button).
- `tools/masterSheet.js` `recent_master_sheet_changes`: a first name only one person has is that
  person ("has felix's pay changed" found nothing for "Felix").
- `tools/monthHistory.js` `compareHandler`: first name resolution moved AFTER the snapshot read and uses
  the snapshot's names + live rows only when live months are asked (a past month never reads live
  deals; a unit test enforced that).
- `tools/masterSheet.js` `add_deal`: honours `approvedNewGroup` (skips the "unknown group → ask / slip
  to nearest group" logic only when `confirmed` and the name matches). Before: "INDIGO 2" was
  "corrected" to INDIGO and 6 deals landed in the wrong group.
- `knownArgs.js`: `approvedNewGroup` added to `INJECTED` (so it is not refused as an unknown filter).
- `prompts/persona.js`: new rule "NEVER A WALL OF TEXT: at most two sentences together. Three or more
  facts, people or steps are a one line headline, then one '• ' line each. A question goes last, on its
  own line."
- Suite case `cases.mjs` "adds several deals from one line with mixed separators": the payment method
  is now said in the sentence (since 2026-10-07, commit `874880c`, a new deal's method is asked, never
  assumed). This is a test correction, not a guard weakened.
- Suite runner `run.mjs` rows check: when no list is drawn, cards and her reply count as "shown" (the
  `shows()` helper always said so; "show me kiran vale" draws cards).

---

## 6. Diane: reading an uploaded sheet (the file check)

Files: `crm/api/v1/agent/engine/intake.js`, `sheetCheck.js`, `runPlan.js`, `planSteps.js`, NEW
`groupJudge.js`, plus `tools/masterSheet.js`, `runAgent.js`, `knownArgs.js`.

### 6.1 Reading the file
- `intake.js` `tablesIn`: **a blank line is not a new table.** A data row of plain words after a blank
  line looked like a header, started a "table" and was eaten as its header; 4 INDIGO deals were unread
  and offered as STOPS. Now a found table whose "header" shares no label with the previous table's
  header (same columns ±1) is merged into it.
- `sheetCheck.js` `dateIn`: reads month words ("1-Oct-26", "1 Oct 2026", "01 October 2026").
- `runPlan.js` `sheetTurn`: the 📎 attachment line (the file NAME) is stripped from what they said
  ("📎 s5-missing-group.xlsx" read as "missing" and narrowed the plan to stops only).

### 6.2 Facts the comparison gathers (`sheetCheck.compare`)
New options: `{ notRenamed, dropGroups, aliases, renames }` (the admin's answers or her judgement).
New outputs: `unfamiliar` (each of their groups not ours by name: people, `newcomers`, rows, `shares`
with each of our groups, `looksLike` {group, kind: 'a slip of the same name' | 'a different name built
on it'}), `ourSizes`, `inFile`, `newGroupInfo`, and on renamed entries `shared`, `of`, `extra`
(newcomers in PEOPLE), `gone` (names not carried), `alsoFrom` (merges).
- `groupOf`: exact, then the same name with a tag (`bare()` drops group/grp/groups/ltd/limited/team/
  the/co: "Milkman Group" = MILKMAN), then one slip, **never a different number** ("INDIGO 2" ≠ INDIGO).
- A person in two of our groups is counted once, for the group this name takes most of (Gloria in
  MANBAT and NEXUS made "all of NEXUS" look like a merge).
- Rows under our own group names are matched FIRST, then rows under new names (order independent).
- A deal of ours under a new group's name is a **move** there (`movedToNew`), so a split moves people.
- A renamed name may also match deals from our groups absent from the file (`absentOurs`), told apart by
  role and pay; those become moves (Pino on 1,250 and 1,750 were paired crossed).
- Identical deals (same person, company, role) within the row's group(s) pair in order, the one with
  the row's own monthly first; a row with NO group stays "unclear".
- **Never a stop for someone the file still lists** (a person with an unmatched row is excluded from
  stops). People in a dropped group are never offered as stops elsewhere.
- A rename decided by the admin or her judgement covers its group (missing people are offered as
  stops, by name).
- New deals carry `assignedOn`, `paymentStartOn`, `phone`, `location` from the file; a new deal with no
  start date "still needs: appointment date (or "from this month")"; `newGroup: true` when its group is
  new (passed to `add_deal` as `approvedNewGroup`).

### 6.3 What is asked, and how (`runPlan.js`)
- **Groups first, only when in doubt.** `sheetTurn` asks her judgement (§6.4); sure verdicts are
  applied; unsure ones become numbered questions with her guess (`groupQs`, status `asking`, steps
  empty, `sheetInput: { read, readout }` kept on the card so answers need no re-read). Reply shape:
  "Checked N rows. One question before I plan the changes: 1. … Clear already: • … Reply "yes" to go
  with my guess, or answer by number (e.g. "1 new"). Nothing has changed."
- `planTurn`: group answers are read BEFORE the plan's own "no = cancel" (only cancel/never mind
  cancels). `readGroupAnswers(said, qs, base)`: "yes" takes every guess; "1 new, 2 yes, 3 leave it out";
  "summit is new"; a stray number answers nothing; a bare "no" answers a single question; for her
  questions also "it's MANBAT renamed", "merged manbat and nexus", "same as INDIGO", "split from
  MILKMAN" (any of our group names said). "and" splits answers only before a number.
- Then `sheetTurn` re-runs with `readGiven` + `decided` and shows the plan.
- **Report format** (`groupLines`): "Groups" block, one line each: "• MANBAT → SUMMIT: renamed (all 5
  people, +5 new)", "• MANBAT + NEXUS → UNITED: merged (5 + 6 people, +2 new)", "• New: HALCYON (20),
  HARBOUR (7, 4 from MILKMAN)", "• Not in your file, left alone: NEXUS" (never for a group being asked
  about or merged); then "Changes" block; stops are named when ≤ 3 ("2 to stop, not in your file:
  Klaud, Smurf").
- New deals with no start date: "from this month" / "ongoing" / "this month" sets `paymentStartOn` to
  the 1st of this month for every such deal (in code; the model's reading looped).
- `NEED_WORDS`: needs are said in words (role, monthly amount, appointment date), never field names.

### 6.4 Her judgement (`engine/groupJudge.js`, NEW)
One model call per file (`env.openaiModel`, temperature 0, strict json_schema): for each unfamiliar
group → `kind` ours | renamed | merged | split | new, `ours` (our groups), `sure`, `question`. Prompt:
judge by MOST of the people; 1–2 shared people is noise; a slip of our name holding that group's people
is OURS, never a rename to the typo; a number or extra word is a different name ("MANBAT 2" with
MANBAT's people and MANBAT gone is renamed); sure only at ~3/4+; question shape "<NAME>: <fact>. I'd
<guess>. Right, or <other>?" (≤30 words, British English).
Held to the facts in code after the call: unknown names dropped; our group names validated; skipped
groups asked; **a slip holding ≥60% of a missing group → ours (sure)**; **"new" in silence while it
holds ≥50% of a missing group → asked**; **"renamed" in silence with <75% → asked**. `decisionOf` /
`otherOf` / `mergeDecisions` turn verdicts and "no" into compare options (`judged: true` makes her
judgement the whole word on renames; without it the 60% rule still applies). If the model can't be
reached, the code rules (`sheetCheck.groupDoubts`) decide.

### 6.5 The plan card (`planSteps.js`)
- `planCard`: while group questions wait, title "Checked N rows · K questions first", note "Nothing
  has changed yet", NO sections (the questions are in her reply; drawing them twice was noise).
- `understood()`: renames say "rename MANBAT → SUMMIT, NEXUS → Ridgeline"; moves say "move 4 deals for
  Ad, Craig … to HARBOUR" (before: "change 13 deals for Abe Lincoln").
- `callsFor` `add_deal`: passes `approvedNewGroup: step.group` when `step.newGroup`.

---

## 7. CRM web UI / UX changes (`crm/web/src/...`)

- `components/layout/BulkBar.jsx`: "Clear" → **"Clear selection"** (`<span className="hidden sm:inline">`).
- `pages/ExpensesPage.jsx`: imports StatusBadge, CheckIcon, FlagIcon, UndoIcon; SETTLE_FILTERS,
  `isSettled`, `RefundBadge`; sticky `settle` filter in filters/filterCount/clearFilters with a Select;
  a **"Refund" column** after AED amount (skeleton/colSpan 14); every EditableCell `editable={!isSettled
  (row)}`; settled rows don't open, have a title and default cursor; bottom bar: **Settle** (primary),
  **Needs review** (warning), **Unsettle** (quiet); Edit/Delete disabled when any selected row is
  settled; `bulkSettle(action)` optimistic; a settle ConfirmDialog (`confirmVariant="primary"`).
- `pages/SettingsPage.jsx`: new **"Expenses check"** card with a SettingSwitch (on: "WhatBot asks about
  expense refunds on payday", off: "Expenses are settled by hand only").
- `pages/FlaggedPage.jsx`: CATEGORY_LABELS `'expense-refund': 'Expense refund'`.
- `configs/api.config.js`: expenses.settle / unsettle / review.
- `configs/badgeKinds.js` + `index.css`: settle_settled 'Refunded' (success), settle_open 'Not refunded'
  (sunken), settle_late 'Late' (accent), settle_unpaid 'Unpaid' (warning), settle_review 'Needs review'
  (warning), settle_overdue 'Overdue' (danger). BADGE_LABELS and `.badge-*` must match both ways.
- `components/agentOrb/ImageViewer.jsx` (rewritten): **← / → keys and on screen arrows** between all
  pictures in the conversation, "N of M" counter, Escape closes; download name `diane-<id>.png`.
- `components/agentOrb/AgentOverlay.jsx`: passes `images` (every `m.image` in history) and
  `onMove={setViewing}` to ImageViewer.
- `components/agentOrb/Messages.jsx`: `picturedTurns(history)` + `shortOf(text)`: **in a turn that has
  a picture, the long list card is not drawn and her reply keeps only its first line and last
  paragraph**; history still holds every word.

---

## 8. Whatbot changes (`whatbot/...`)

- Expenses check: `src/expenses/expenseCheck.js` (NEW), `src/conversation/handleMessage.js`,
  `src/system/crmClient.js`, `src/expenses/myExpenses.js` (see §4).
- `src/expenses/myExpenses.test.js`: the two picture tests get a 20 s timeout (the first picture loads
  fonts: ~3 s alone, more in the full run; it timed out at 5 s under load).
- `src/payments/quick.js` `ANOTHER_MONTH`: **whole month words only** (jan|january … dec|december;
  "may" not when followed by i/we/you/be/have/ask/know). Before, any word starting with a month
  ("maybe", "market", "decide", "janitor", "october" ok) counted, so "this month's pay status … maybe
  the weather" got "I can't show you past months".
- `.env`: `REDIS_URL` → local Redis (§1). Not in git.
- `scripts-local/twoAgents.js` (NEW, not committed, folder not git-ignored): two simulated people (an
  employee in payments mode, an expense admin in expenses mode), AI written randomised messages
  (gpt-4.1-mini), whatbot answers through the real `handleMessage`; the reply is turned into WhatsApp
  messages with the same rules as `worker.js` and printed; flags DUPLICATE, REPEAT, ERROR, SLOW,
  REDELIVERY. Refuses Upstash. Usage:
  `DATA_SOURCE=fake node scripts-local/twoAgents.js payments 3 8 <seed>`;
  `CRM_API_URL=http://localhost:3200 TWO_AGENTS_ADMIN=+447700900077 TWO_AGENTS_GROUP=NEXUS DATA_SOURCE=fake node scripts-local/twoAgents.js expenses 3 7 <seed>`.
  (`.env`'s `EXCEL_PATH` points to a folder that no longer exists, hence `DATA_SOURCE=fake`.)

---

## 9. Infrastructure

- `crm/api/configs/db.js`: `idleTimeoutMillis: 30000` (was 0 = never close). pg-pool only closes idle
  clients ABOVE `min`, so the 2 warm ones stay; the dev API had kept 9 of DEV's 15 pooler clients and
  suites stopped on "max clients reached in session mode".
- Local Redis set up (§1). Upstash out of requests (§1).
- Test runners (scratch, §10.4) run one step at a time, wait for DEV between steps, never touch port 3000.

---

## 10. Tests

### 10.1 Unit tests added or changed (all pass)
- `crm/api/v1/agent/engine/sheetCheck.test.js`: + clear rename / clear new (never asked); partial
  rename asked naming who's not there; numbered sibling "MILKMAN 2" never silently MILKMAN (and the
  "it is MILKMAN" alias); split asked then deals MOVE, dropped group stops nobody; answers read in code
  (yes, numbers, stray number, bare no); a blank line is not a new table; group names of any length
  ("Milkman Group"/"Ltd"/"Team" = ours, "MILKMAN 2"/"Milkman North East"/"NEXUS Health Care Services" =
  siblings, "MILKMNA" = typo); merge asked and moves; THE PLAN needs wording updated (role, appointment).
- `crm/api/v1/agent/engine/groupJudge.test.js` (NEW, stubbed model, free): held to the facts (no made up
  group, none of ours that is not ours, none skipped); null when the model is down; decisions; answers
  (yes/no/leave it out/hmm); fact checks (slip → ours, half a missing group never "new" in silence,
  renamed under 75% asked, "no" means renamed).
- `crm/api/v1/agent/engine/anyFile.test.js`: answers-fill test now includes an appointment date.
- `crm/api/v1/agent/knownArgs.test.js`: INJECTED includes `approvedNewGroup`.
- `crm/api/v1/expenses/bot/bot.test.js`: run-before-planner assertion; "1-2 PAID TO TAXII" test.
- `crm/api/v1/expenses/expenseIsolation.test.js`: `res.json({ ...result, (rows, )?month` regex.
- `crm/api/v1/expenses/expenseFilters.test.js`: unchanged, it caught the `$` bug.
- `whatbot/src/expenses/myExpenses.test.js`: timeouts (§8).

### 10.2 Suite cases added (`crm/api/scripts/dianeSuite/library/regression.mjs`)
REG-0016 (one person read as a list of one), REG-0017 (first name in a change question), REG-0018
(export ask while export is off), REG-0019 ("owed in usd" is said in USD), REG-0020 (what is
scheduled is the parked list), REG-0021 a/b/c (percentage raise on a group, applied and undone),
REG-0022 a/b (stop at the end of the month is parked), REG-0023 a/b (a change with a question in one
line). Library: 107 → 129 cases.

### 10.3 Suite runner changes (`crm/api/scripts/dianeSuite/run.mjs`)
- `SUITE_AUTO=on` runs every case with auto accept on (saved as its own card, e.g. `main-auto`).
- Rows check accepts cards and her reply when no list is drawn.

### 10.4 Test tools (in the session scratch folder, NOT in the repo; copy them in if wanted)
- `blindBattery.js <outDir> [count] [seed]`: random messy master sheets from DEV with the TRUTH
  (`truth.json`): per group fate (keep 55%, rename 15%, partial 7%, absent 7%, merge, split, tagged/typo),
  0–3 new groups of 1–25 deals, 1–4 word names, "X 2" siblings, pay edits, removed deals, mixed date
  formats, blank lines, shuffles. Bugs fixed in the tool: `slice(-0)`; the made up names ran out over 40
  files (now reset per file).
- `blindScore.js <apiRoot> <batteryDir> <label>`: read only scoring against the truth; answers her
  questions as the truth says; works on any code tree (the `head/` worktree = before).
- `applyProbe.mjs <file> "<group answer>"`: the TRUST test through the real HTTP route (port 3000 API,
  as `claude-test-admin`): upload, answer, yes, then upload the same file again and expect nothing left.
- `sheetProbe.js`, `sheetDebug.js`, `makeScenarios.js` (6 hand scenarios s1–s6 in `docs/test/sheets/`),
  `runAll.sh` / `runRest.sh` / `runPaid.sh` / `runExpenses.sh` (sequential runners), `reseed.js`
  (refresh DEV + re-seed the test admin), `expenseOne.js` (one message to the expense brain).
- Test files in the repo: `docs/test/messy-october-8-groups.xlsx`, `docs/test/sheets/s1…s6.xlsx` +
  `scenarios.json`, `docs/test/blind{,2,3,4}/` (24/30/30/40 files + truth + score json).

---

## 11. Test results

### 11.1 Diane conversation suites (DEV, gpt-4.1, 2026-10-09)
| Set | Before (2026-10-08) | After | Notes |
|---|---|---|---|
| main (88) | 71/88 **80.7%** | 84/88 **95.5%** | 13 newly passing; newly failing 1 ("a change finds the deal by one word of its company"); still failing: mixed separators add, "take N days off", "a total asked in usd" (read router took "whole sheet" as the Standard sheet preset). Median 5.3 s, invented 0%. |
| library | 59/81 **72.8%** (unsafe 11.1%) | 122/129 **94.6%** (unsafe **0%**, calc +23.9 pts) | Failing: TRU-001 a/b (her wording "not found on the sheet" not in the case's regex: case too strict), HIS-001-b (flaky, passes alone), REG-0010-b ("who hasn't replied to payday" listed unpaid too), CON-010, REG-0015, REG-0021-c (undo didn't restore every deal). |
| main, auto ON forced | n/a | 65/88 (73.9%) | NOT a fair score: most cases expect preview + yes; with auto on she rightly applies at once ("wrote before yes", "nothing waiting on a yes") and the un-undone changes cascade into later cases. Real items to look at: a crash "Cannot read properties of undefined (reading 'stopped_on')", "add 100 to all of a person's deals" applied nothing, two schedulings not parked. |
| library, auto ON forced | n/a | 119/129 | 3 by design (written before yes), real: PAY-010 marked 1 of Kiran's 3 deals. |
| eval / eval2 / eval3 / eval4 / eval5 / eval6 | | 22/23 · 22/22 · 15/17 · 14/15 · 9/10 · 13/13 | held out wordings |
| wander | | 12/12 | |
| messy, bulk | | not run by this session | another session ran messy at 12:42 |
| CRM unit (`npm test`) | 2454 pass / 16 fail | **2470 pass / 12 fail** | the 12 are tests reading the owner's reference xlsx files in `docs/boss/references` (not on this PC). The 4 real failures were fixed. |

### 11.2 Diane sheet reading, blind batteries (read only, truth from the generator)
| Battery | Code | Groups right | Files fully right | Wrong stops | Questions | Median |
|---|---|---|---|---|---|---|
| blind4, 40 brand new files (seed 9001) | before (HEAD) | 70/120 (58%) | 1/40 | 81 | 0 | 4.4 s |
| blind4 | after | **120/120 (100%)** | **40/40** | **0** | 15 | 2.7 s |
| blind2, 30 files (seed 777) | before | 50/86 (58%) | 2/30 | 59 | 0 | 4.2 s |
| blind2 | after | 84/86 (98%) | 28/30 | 0 | 11 | 2.5 s |
| blind3, 30 files (seed 4242) | after | 102/102 (100%) | 30/30 | 0 | 8 | 2.8 s |
| blind, 24 files (seed 2026) | after | 64/64 (100%) | 24/24 | 0 | 8 | 2.7 s |
"Fully right" = every group verdict right AND new deals, stops and pay changes exactly as the truth.
blind2's 2 misses ("MIKLMAN" typo judged as a rename; "MANBAT 2" partial judged new in silence) are
what the fact checks in §6.4 now handle; blind/blind2 were not re-scored after those checks.

### 11.3 Trust test (applied for real on DEV, then the same file uploaded again)
| File | Applied | Left over |
|---|---|---|
| s1: 5 groups, 2 renamed (+5 new each), 3 new groups of 20 | 72/72 | nothing |
| s2: partial rename (3 of 5 + 8 new), asked once | 11/11 | nothing |
| s3: "INDIGO 2" new + HARBOUR split from MILKMAN, asked twice | 13/13 | nothing |
Earlier failed attempts that led to fixes: 9 new deals refused (no appointment date), 6 deals into the
wrong group (INDIGO 2 → INDIGO), 6 saved as cash.

### 11.4 Whatbot
| | Before (HEAD) | After |
|---|---|---|
| Unit tests (vitest) | 530/530 | **544/544** (14 new) |
| Expense harness (243 / 199 conversations) | INVALID | INVALID: the harness's test admin (+447700900001, MANBAT) is not on the live copy, every message got `registered: false`; HEAD's harness refuses DEV (wants a DB named `crm_clone`). The fix (insert the admin, run `harness-dev.js` copy on HEAD) is in `runExpenses.sh` but was never run. |
| Payments eval | not runnable (needs a throwaway Redis) | not run |

### 11.5 Two agent conversations (whatbot, 2026-10-09)
7 conversations (2 payments on the fake roster, 5 expenses on DEV via a port 3200 CRM API).
Worked: refusing someone else's pay, the breakdown picture, previews asking only for what is missing,
save then undo, "can't save yet, 1 still needs an answer". Found (and fixed unless noted):
"1-2 paid to Taxii" → spentBy; "logged" as a search word; how-to questions → hello menu; undo-by-words
reply; "show me my last changes"; "maybe" read as May; NOT fixed: "just this month pay status" →
end dates (`get_my_dates`); duplicate sends on worker retry (§13).

---

## 12. Bugs found and fixed (root causes)

1. Expense picks "only 1-3" refused: `readReply` null for edit/remove pendings; previews unnumbered.
2. `expenses.repo.js` `$1/$2` stripped by a shell edit → every Expenses page read wrong.
3. Dev API kept 9/15 DEV pooler clients forever (`idleTimeoutMillis: 0`).
4. `bulk_edit` routed to the plan engine (no percentage) since 2026-10-06.
5. "stop … end of this month" stopped TODAY via the engine.
6. Read router: one person in `people` → whole sheet total; "owed in usd" → USD filter; export ask →
   sheet read; forced routes ignored by the read router.
7. Percent on a group read as an add-on rate for a person named after the group.
8. First names not resolved in the change log and in month history (and history read live deals).
9. Blank line in a sheet ate the next row (false stops).
10. File name read as the admin's words.
11. Renames/new groups planned silently; "I understood" mislabelled renames.
12. "INDIGO 2" slipped into INDIGO (in compare AND in `add_deal`).
13. New deals: appointment date dropped; payment method dropped by a "nobody said it" guard.
14. Splits didn't move people; merges paired twins crossed; identical deals unmatched → false stops.
15. Expense "1-2 paid to Taxii" → spentBy.
16. Expense search words included "logged"/"total".
17. Expense how-to questions got the hello menu / a receipt lookup.
18. Whatbot `ANOTHER_MONTH` matched word beginnings ("maybe" = May).
19. Whatbot picture test timeout under load.

---

## 13. Known issues and work NOT done

1. **Duplicate sends (whatbot)**: `defaultJobOptions.attempts: 3` (`src/config/queue.js`). If anything
   throws after the first message has gone out (WhatsApp not connected mid reply; the post reply
   `identify()`/`recordMessage()` bookkeeping, e.g. a Redis timeout; a stalled job on a slow PC), BullMQ
   re-runs the job and the whole reply is sent again. Evidence in `tb_logs` 2026-10-09 02:11–02:13
   ("whatsapp not connected for group MILKMAN", "redis operation timed out", "job stalled more than
   allowable limit"). **Proposed, NOT done** (needs the owner's OK; another session edits `worker.js`):
   a per part send key `sent:<messageId>:<n>` (SET NX, 1 day, `withRedisTimeout`, built with
   `system/jobId`) so a retry skips parts already sent; wrap the post reply bookkeeping in try/catch so
   it can never fail the job.
2. Whatbot payments: "just this month pay status" → end dates. Not traced.
3. Diane main: 4 failures (§11.1); library: 7 (§11.1); auto on items (crash `stopped_on`, "add 100 to
   all of a person's deals" applied nothing with auto on, PAY-010 1 of 3 deals).
4. Suite cases: TRU-001 regex should accept "not found on the sheet".
5. Expense harness old vs new never validly run (§11.4).
6. Re-score blind and blind2 after the §6.4 fact checks; messy and bulk wording sets; final DEV refresh.
7. The Diane "box" phase 4 items were never started: selective undo (tick boxes, "undo 2 and 5"), one
   batch across deals and expenses, a Retry failed button, size limits (summary >50, narrow >500), cost
   limits per box, never in whatbot employee chats, library cases for each. The "I understood" / "Check
   first" / 30 minute idle close / routing logs exist but were only partly shown.
8. Migration 078 is not applied on LIVE.
9. Docs (whatbot `docs/features.md`, README) not updated for these changes.
10. Whatbot `.env` `EXCEL_PATH` points to a missing folder (`C:\Users\yatsen\Documents\system\...`).

---

## 14. Clean-up still to do

1. Stop the CRM API on port 3200 (pid 13572 at last check).
2. DEV: delete `tb_expense_admins` row `+447700900077` "Sim Admin"; the `claude-test-admin` login
   disappears on the next `npm run refresh:dev`.
3. Remove the scratch `head/` worktree (it contains `.env` copies): first `rmdir` the two
   `node_modules` junctions, then `git worktree remove --force <path>`.
4. Decide what to keep of `docs/test/` (sheets, blind batteries, score json) and `whatbot/scripts-local/`
   (not git-ignored).
5. `crm/api/scripts/dianeSuite/runs/*.json` from 2026-10-09 are untracked scorecards (some from other
   sessions: `pick-v2-*`, `pick2-*`).

---

## 15. Changes made by OTHER Claude sessions in the same period

At least two other Claude Code sessions (one in VS Code, one with folder id `6d20fb0f…`) worked in this
repo at the same time, ran suites/harnesses on DEV (wiping it), and changed files. Not described here;
read their diffs. Seen:
- `crm/api/v1/agent/v2/` (box.js, index.js, prompt.js, tools.js), `whatbot/src/agent/v2/askModel.js`,
  `docs/diane-v2.md`, `docs/diane-testing.md`, `ecosystem.config.cjs`,
  `crm/api/scripts/nightly/install-windows.ps1`.
- `whatbot/src/worker.js` ("QUIET WHILE IDLE": `drainDelay: 30`, `stalledInterval`, `lockDuration
  60_000` for the inbound worker), `whatbot/src/system/redis.js`, `whatbot/src/config/env.js`,
  `whatbot/src/config/openai.js`, `whatbot/src/agent/askModel.js`, `whatbot/src/agent/evals/runEvals.js`,
  `whatbot/src/pictures/table.js`, `crm/api/v1/expenses/bot/ai.js`, `crm/api/v1/pictures/table.js`,
  `crm/api/v1/agent/fieldAsked.js` (+test), `crm/api/v1/agent/tools/resolvePerson.js`, `docs/how-to.md`.
- Earlier sessions (before this one, already staged): the Diane library suite and scorecards, people /
  pay state work (`tools/people.js`, `personPayState.helper.js`, `paydayFlag.helper.js`, People page,
  PaySwitch, PaymentReceived, DealReceivedCell…), the nightly scripts, `testDb.js`, `refreshDev.js`,
  the payday reply table, `docs/9v8uhjns1bgiauap/*.xlsx`. Also `.gitignore` and `LICENSE` staged as
  deleted and `yeahyeah.md.txt` deleted: verify before committing.

---

## 16. File index (touched by THIS session)

CRM API
- `configs/db.js`: idle timeout 30 s.
- `v1/app.js`: start unpaid alerts.
- `v1/expenseBot.js`: /check, /check/answer, /mine settle tags.
- `v1/expenses.js`: carry, settle routes, settle log, locks.
- `v1/expenses/unpaidAlerts.js`: NEW.
- `v1/expenses/bot/brain.js`: phases 1–7, settle, HOW_TO, undo wording, WHAT_DONE.
- `v1/expenses/bot/reply.js`: numberSet, linesPicked, typos, spenderAnswer field guard.
- `v1/expenses/bot/format.js`: numbered previews, paging, effect lines, PICK_HINT.
- `v1/expenses/bot/find.js`: carry in between(), overlay, sortRows, numbered list, stop words.
- `v1/expenses/bot/planner.js`: split/filter/clear/shift_months/parts, conversation rules.
- `v1/expenses/bot/receipts.js`: keep unsettled receipts.
- `v1/expenses/bot/bot.test.js`, `receipts.test.js`, `v1/expenses/expenseIsolation.test.js`: tests.
- `v1/migrations/078_expense_check.sql`: NEW.
- `v1/repos/expenseChecks.repo.js`: NEW.
- `v1/repos/expenses.repo.js`: carry, settle filter, `$` fix.
- `v1/settings.js`: expenseCheck switch.
- `v1/agent/runAgent.js`: routing, forced percent route, ownedElsewhere, approvedNewGroup strip, method guard on plan runs.
- `v1/agent/engine/readRouter.js`: people of one, USD convertTo, export ask.
- `v1/agent/engine/intake.js`: blank line merge.
- `v1/agent/engine/sheetCheck.js`: compare facts/options, doubts, dates, moves, pairing, stops.
- `v1/agent/engine/runPlan.js`: groups first, readGroupAnswers, groupLines, report format, needs, from this month, file name strip.
- `v1/agent/engine/planSteps.js`: card for questions, understood(), approvedNewGroup.
- `v1/agent/engine/groupJudge.js` (+ `.test.js`): NEW.
- `v1/agent/engine/sheetCheck.test.js`, `anyFile.test.js`: tests.
- `v1/agent/tools/masterSheet.js`: first name in change log, add_deal approvedNewGroup.
- `v1/agent/tools/monthHistory.js`: first name after the snapshot.
- `v1/agent/knownArgs.js` (+ test): INJECTED approvedNewGroup.
- `v1/agent/prompts/persona.js`: no wall of text.
- `scripts/dianeSuite/run.mjs`: SUITE_AUTO, rows check.
- `scripts/dianeSuite/cases.mjs`: mixed separators case.
- `scripts/dianeSuite/library/regression.mjs`: REG-0016..0023.
- `scripts/expenseHarness/scenarios.js`: ~40 scenarios (pick:, list:, change:, safety:, talk:, after:, find:, settle:).

CRM web
- `components/layout/BulkBar.jsx`, `pages/ExpensesPage.jsx`, `pages/SettingsPage.jsx`,
  `pages/FlaggedPage.jsx`, `configs/api.config.js`, `configs/badgeKinds.js`, `index.css`,
  `components/agentOrb/ImageViewer.jsx`, `components/agentOrb/AgentOverlay.jsx`,
  `components/agentOrb/Messages.jsx`.

Whatbot
- `src/expenses/expenseCheck.js` (NEW), `src/conversation/handleMessage.js`, `src/system/crmClient.js`,
  `src/expenses/myExpenses.js` (+ test timeouts), `src/payments/quick.js`, `scripts-local/twoAgents.js`
  (NEW, local), `.env` (local Redis, not in git).

Docs
- `docs/feature.md` (voice notes on hold, item 15), this file `changed.md`.

Outside the repo
- `C:\Users\yatsen\redis\` (Redis, config, start script, env backup).
