# Todo

What is still open. Tick items off in the change that finishes them.

Completed work is not kept here — `state.md` describes what the system now
is, and git history has the rest. Only the last few days' shipping is listed
at the foot, as a short ledger.

---

## 0. Diane on data nobody has seen yet

The question behind this section: is her accuracy STRUCTURAL or
COINCIDENTAL? Wipe the sheet, load new groups, names and companies. A guard
that only works because somebody is called Gloria is not a guard.

Audited 2026-09-03. Already structural, verified, nothing to do: the row
caps (a total REFUSES rather than under-reporting), currency (not an enum),
tier (open prose set), the arithmetic helpers (pure), and every guard
(they compare her reply to tool output and name nobody).

Phase 6 shipped with this audit. It was the only item that did not require
having seen the failure first.

- [x] **PHASE 1. An unknown GROUP returns a bare zero.** `notAPerson`
      catches "NEXUS is a group, not a missing person"; nothing does the
      same for a group. Name a group the data does not have and SQL returns
      nothing, the zero notes only cover month, filter and dropped people,
      and she reports zero. Zero reads as a fact about the business.
      **Fix:** `notAGroup.js` mirroring `notAPerson.js`, fired ONLY on zero
      rows so the normal path costs nothing. Does the group exist? If not,
      say so and name the ones that do. If it does, say the real reason and
      never claim it is missing. Eight tools take `group`, so ONE function
      called from one place: `resolvePerson` was written out four times and
      the fourth copy forgot half of it. Company gets the same treatment in
      the same change. Test BOTH directions.
- [x] **PHASE 2. `checkFigures` ignores anything under 100.** The real
      sheet already holds 80.65, so this is open today, before any reset.
      **Fix, and it needs a decision:** count a number as a figure when it
      carries decimals or a currency marker, at any size. `checkCounts`
      already owns the counted-noun class so the two compose. **Watch the
      interaction:** "2.5% fee" has a decimal, so it must exclude anything
      `checkPercents` already matched or the two guards fight.
- [x] **PHASE 3. Her prompts name real people and groups.** Gloria, Nicola,
      Zayn, Paddy, Abe, INDIGO, MILKMAN, NEXUS and Acqua sit in the system
      prompt and tool descriptions as EXAMPLES. After a reset they are
      fiction in her context, and she has already been caught producing
      invented identifiers under pressure.
      **Fix:** a fixed placeholder set, plus a test that fails on any
      capitalised name outside it. Rejected: deriving examples from live
      data, which adds a query to every prompt build and drifts.
- [x] **PHASE 5. Sentinels are literal strings** (`Will never be bank`,
      `Handled internally` in `canonical.js`). Reworded in a new sheet they
      are read as prose. **Fix:** an upload PREVIEW warning on an
      unrecognised repeated non-numeric value in those columns. Nothing
      automatic is safe. Upload side, not Diane. **Confirm it is in scope.**
- [x] **PHASE 6. Diane states typed claims beside her prose.** The
      `state_claims` metadata tool records totals, figures, counts and
      percentages before the final answer. `checkClaims` compares those
      values with this turn's tool results. The completed SSE response and
      `AgentOverlay` carry the claims beside the prose. The four prose
      guards remain as the fallback when metadata is omitted.
- [x] **Stale comment.** `masterSheet.js` near the totals cap says 500. The
      constant is 2000.

**Not a fault, listed so it is not re-argued:** `TYPO_LIMIT` is 0 under 12
characters, so a misspelt SHORT name matches nobody. It fails SAFE. She
asks instead of guessing, which is the behaviour we want.

**And a distinction worth keeping:** she can be perfectly accurate about
WRONG DATA. The September zero below is the rule working correctly on rows
that say August. It is experienced as her being wrong and it is a different
layer. Do not hunt it in the agent.

---
## 0b. PHASE 4. Diane, plural questions

Closed already: `people` and `months` on the totals, `months` on
`active_companies`, `people` on `check_rates` and
`recall_past_conversations`. `v1/agent/tools/pluralAsks.test.js` enforces
the class and lists what follows, so this section and that file must agree.

- [x] **`groups` on the six read tools** (`filter_master_sheet`,
      `total_master_sheet`, `active_companies`, `check_rates`,
      `recall_past_conversations`, `list_concerns`). "INDIGO and MILKMAN" is
      a normal sentence and each can answer only half of it. `export_sheet`
      already takes `groups`, which is the proof it gets asked.
      **A decision first:** two groups as two answers, like `months`, or one
      combined figure? Omitting the group already gives the combined figure
      across all of them, so the recommendation is two answers. Mechanical
      once decided: `listAsked` plus `answerEach`, same as the others.
- [x] **Plural FILTER VALUES need `= ANY($n)`, not `answerEach`.**
      `paymentMethod`, `currency`, `status`, `searchField`, `presetWhen`,
      `paymentStartWhen`, `endWhen`, `source`. "Cash and bank" is ONE total
      over a wider filter, so looping would answer a question nobody asked.
      Repo work, not tool work.
- [x] **Three dimensions have no read filter at all: `company`, `role`,
      `tier`.** Not a plural gap, a missing one, and the worse fault: she
      does not refuse, she reaches for the nearest column. A company is
      now an exact filter rather than only `q` + `searchField: 'company'`.

---
## 1. Before the next deploy

- [x] **Migration runner and current schema.** Migrations through 058 are
      written: 055 expenses, 056 stopped deals, 057 the monthly review, 058
      liquidation. Run `npm run migrate` on each deployment to apply any
      pending files; the applied count is environment-specific.
- [x] **Closure drill run, 47/47, 2026-09-16.** `node scripts/closureDrill.js`
      after any change to stopping, the Archive, the review or liquidation:
      every unit test for those stubs the pool, so this is the only thing
      that touches the constraints and the cascade. It writes only to
      `ZZTEST` with `scratchOnly` armed, and clears its own leftovers first.
- [x] **One ZZTEST company row is left and it is invisible.** Checked
      2026-09-16: `zz closing co` has no deals, and every company read
      starts from the deals, so it is on no page and in no picker. Nothing
      deletes a company, the drill reuses the name, so it never piles up.
- [x] **Her recap framed the last 24 hours as "what I changed"**, closed
      2026-09-16. It returned three MILKMAN rows somebody else had edited.
      `recent_master_sheet_changes` now says in its own summary that the
      window includes other admins, whatbot and imports, and that she must
      not call it "this conversation": it cannot know what this one did.
- [x] **The presets are on September.** Checked 2026-09-16: all 96 live
      rows are `2026-09`, none old and none future, and the business month
      is `2026-09`. The £0 entry here described the state on 2026-09-01 and
      had gone stale; the rows were rolled at some point after it.
- [ ] **Set `TIMEZONE` in `crm/api/.env` on the server PC.** Unset it
      becomes that machine's own zone (`Europe/Vilnius`), while the Electron
      frontend reads the admin's clock: 10 hours apart, so at a month
      boundary the two name different months. Whose month is the business
      month is a decision. See `feature.md` item 3.

- [x] **Monthly snapshots.** `tb_month_snapshots` is immutable and read by
      Diane's history and forecast tools. The API scheduler checks the final
      day of each business month; `run-it.md` has the manual command.
- [x] **Verified Postgres backups.** The external custom-format dump,
      checksum manifest, verification, restore confirmation, and 24-hour
      scheduler are implemented. Configure `BACKUP_DIR` and
      `BACKUP_INTERVAL_HOURS` in `crm/api/.env` before deployment.
- [ ] **Decide whether the database moves local** or only the API does. It
      is Supabase in `ap-south-1` today and the plan says local. See
      `feature.md` item 3.

## 1b. Security, from `sec-audit.md` (2026-08-25)

Full findings and fixes are in that file. The two that should not wait:

- [x] **Redact the session cookie from the logs.** DONE 2026-08-27. `redact`
      list in `configs/logger.js`: cookie, authorization, `x-api-key`,
      `set-cookie`, plus password / secretCode / token / apiKey in both bare
      and one-level-nested form. Tested: the bare form is needed, `*.password`
      alone does not match a top-level key.
- [x] **Rotate the Cerebras key.** SKIPPED 2026-08-27, the provider is no
      longer used. The commented line is deleted from `crm/api/.env`. **The
      key was still exposed before deletion**, so rotate or revoke it at
      Cerebras if that account still exists.
- [x] **Add a root `.gitignore` before `git init`.** DONE 2026-08-27, and
      tested in a throwaway repo: `.env`, `*.xlsx`, `docs/boss/`,
      `docs/downloads/`, the server notes and `_*.js` are ignored, while
      `.env.example`, `docs/`, `.claude/` and source are not.
      **Note:** `crm/` and `whatbot/` are already separate repos with their
      own ignore files. `docs/` is in no repo, so this only takes effect on
      a root `git init`.

## 2. Money at risk

- [x] **THE THREE FAILING TESTS WERE ONE BUG, and it shipped in an export.**
      Closed 2026-09-16. `paymentBreakdown` ACCEPTED `rates` and
      `cryptoPercent` and USED NEITHER: it reads the rates back off
      `row.rate_parts`, which `withRates` puts there. Two callers passed
      them instead of rating the rows first, and both were silently short
      by every add on and every crypto charge.
      1. Diane's `historicalBreakdown` answered 1,000 where the sheet
         beside her said 1,050.
      2. **`buildDivisionSheet` shipped the same gap in a real payout
         file.** Found while fixing 1. The month sheet was correct
         throughout, because `buildWorkbook` rates at the top of its build,
         so one export was right and the other wrong off the same rows.
      **Both options are gone from the signature**, so the wrong call is an
      unknown option rather than a quiet zero, and
      `masterSheet/ratedBeforeBreakdown.test.js` pins the order for both
      callers. Nothing needs re-issuing unless a Division Sheet was sent
      out: any that was is short by the add ons on it.

- [ ] **DIANE'S WRITES SKIP THE ROUTE'S VALUE GUARDS. Parked 2026-09-17,
      his call: she has never written one out of range.** Her tools call
      `repo.update` directly, so `masterSheet.js`'s own validation never
      runs on anything she writes.
      1. **Payable days.** The route refuses anything but a whole 0 to 31
         (`parseDays`). Her single tool declares `integer, 0, 31` in its
         SCHEMA, which is model side only, and the bulk `set.payableDays` is
         a bare `number` with no bounds. `payable_days` has no CHECK and
         `payableFromDays` does not clamp, so 45 days on a 30 day month
         writes 150% of the monthly amount.
      2. **The two percentages.** The route checks `MAX_PERCENT` and
         `update_person` re-checks it in its handler, with a comment saying
         why. `update_master_sheet_row`, `add_deal` and the bulk `set` check
         nothing.
      **Fix, when it is worth doing:** lift `parseDays` into `shared/`, call
      it and the percent check from `normalizeFields`, and give the bulk
      `set` the bounds the single tool already declares. One place, three
      doors inherit it.

- [ ] **`docs/boss/knowledge.md` DOES NOT EXIST, and four places quote it.**
      Found 2026-09-14 while checking whether the boss ever said the first
      90 days are cash. He did not: that quote is in none of his three
      documents, and `closure.md` §10 is corrected.
      The same check found `knowledge.md` missing from `docs/boss/`, cited by
      `calculator/buildBreakdowns.js` (lines 9, 108, 239) and
      `repos/burn.repo.js:5`. Two of its quoted lines are in none of the
      surviving sources either.
      **`burn.repo.js` is the one that matters:** its quote is the stated
      justification for a `TRUNCATE` of four tables.
      **Fix:** ask him to re-send whatever `knowledge.md` summarised, or
      confirm the retention rule directly. Until then the quotes stay as
      they are, marked: they may be real notes from a conversation nobody
      kept, and rewriting them would replace one unsourced claim with
      another. Do NOT change what the code does on the strength of this.

## 2b. Money at risk, older

- **PARKED 2026-08-25.** 25 rows where he typed 31 payable days and the CRM
  computes £0. It only bites against `master.xlsx`'s own July preset:
  against his real August drafts we match 28 of 29 MILKMAN rows and 29 of 31
  INDIGO. Totals now count current-month presets only and nothing is set to
  August, so it is moot until he uploads an August sheet. Revisit then.
- **NOT OURS, 2026-09-01.** The 9 bank rows with no details and the 3 rows
  with payable days but no monthly amount are both handled off system. The
  arithmetic is right in each case. Do not raise them again.
- [x] **Anteep Sourcing's preset.** FIXED. Both rows now read `2026-09-01`,
      £1,800 and £700.
- **PARKED 2026-08-25.** Dates may be stored a day early, not just rendered
  so. The renderer is fixed, which is the part anybody sees. To check the
  data:
  `SELECT person_name, assigned_on FROM tb_mastersheet WHERE company ILIKE 'anteep%';`
  `master.xlsx` says `2026-03-11`; `2026-03-10` would mean a re-upload.

## 3. Bugs

- [x] **FIXED 2026-09-25**, and the detail pages' Monthly total was unrated
      too. Both now rate through `rates.helper`. See `state.md`.
      **A LIST'S MONTHLY TOTAL IGNORES BOTH RATES.** Found 2026-09-24,
      beside the detail page fix. `people.repo.findAll` and
      `companies.repo.findAll` sum `monthly_amount` in SQL, so the People
      and Companies LISTS show the raw wage while the person's own page,
      the Master Sheet and every export show it rated. One person reads
      4,000 on one screen and 4,200 on the next.
      **Fix:** the arithmetic is ordered, add on first and the fee off the
      total after it, so it cannot stay a plain SUM. Either carry
      `personRatesSql` into the two list CTEs and do both steps there, or
      return the parts and let `helpers/rates.js` do it per row the way the
      detail pages do. The second keeps ONE definition of the order and is
      the one to take unless a page of 25 makes it slow.

- [ ] **~30,300 TOKENS GO OUT ON EVERY MODEL CALL**, before a word of the
      conversation: 45,392 characters of system prompt plus 75,643 of tool
      schemas across 38 tools. Measured 2026-09-21. That prefill is the wait
      before any text appears, and it is paid again every round.
      **The fix is prompt caching.** `AI_PROVIDER=openai`, the prompt and
      the schemas are byte identical on every call and sit first in the
      message array, which is the shape caching needs. It changes no
      wording, no behaviour and no tool reach. Trimming the schemas is the
      second lever and is far more work for less: the heaviest three are
      `bulk_update_master_sheet` 10.7k characters, `total_master_sheet` 9.8k
      and `filter_master_sheet` 8.1k.
      The speaking half of that wait is fixed, see `state.md`.

- [x] **TWO GREETINGS FOR ONE "hi". Reported live and FIXED 2026-09-18**,
      `v1/agent/interimLine.js`. Both halves below are built: a lone `say`
      and a `say` that asks are never emitted, and a refused line is
      reported to her as NOT DELIVERED so the answer does not vanish
      instead of doubling. A third door was found and closed in the same
      change: `state_claims` is metadata, so `say` beside it is still a
      lone line. Detail in `state.md`.

      ```
      hi
      The master sheet is looking ready for your commands, darling. What shall we do today?
      Hello there! What can I help you with in the master sheet today?
      ```

      The first bubble on screen ("Hi, I'm Diane! ...") is the static
      welcome in `AgentOverlay.jsx` and is correct. The two after it are
      both hers, for one word.
      **Cause:** the `say` tool. It puts a line on screen MID-TURN and
      carries on, so a four second lookup is not four seconds of silence.
      She called it with a greeting, then the round ended with a reply that
      was the same greeting again.
      **Its description already forbids exactly this** ("NEVER USE IT TO
      ASK A QUESTION... asking through it and then asking again in your
      reply is the same question twice, which is what it looks like on
      screen"). It is a sentence, so it was ignored. **PROMPTING IS NOT A
      GUARD**, and this is the third time that rule has been paid for.
      **Fix, two halves, both in code and both permanent:**
      1. **A LONE `say` IS NEVER EMITTED.** `say` exists to cover work
         happening beside it. `runAgent` already counts interim calls
         (`interimCount`), so when the round holds no NON-interim call
         there is nothing to wait for and the line is a duplicate of the
         reply that follows. Drop it and let the reply stand.
      2. **A `say` THAT ASKS IS NOT AN INTERIM LINE.** She cannot ask and
         work at the same time. If the text ends in a question mark, it is
         the answer, not a line before one, and it must not be emitted as
         an interim.
      Both are structural: neither names a phrase, a greeting or a word, so
      they hold for a sentence nobody has seen yet. Test the lone case and
      the question case separately, and prove each red first.

- [x] **SHE NAMED A GROUP THE FILE DID NOT CONTAIN.** Fixed 2026-09-06.
      "Give me the bank sheet for Nexus" ended with a built file of 21
      rows, every group's bank rows, handed over as "the bank sheet for
      Nexus with 21 deals". NEXUS has 2. Reproduced in 2 of 3 live runs.
      Two causes, both closed, and the second is the guard:
      1. The continuation guard refused the rescope, because
         `REPORTING_BREAKDOWN` carries the bare word `bank`. The sheet type
         already chosen is now removed before the sentence is judged, so
         "the bank sheet for Nexus" rescopes. "how much bank do we have"
         still refuses, because `how much` survives the removal.
      2. `checkExportScope.js`, new. Nothing checked her DESCRIPTION of a
         REAL build: `wantsPanelAct` is skipped the moment a tool ran, so a
         genuine build described with the wrong group passed everything.
         It compares the groups named in her reply against `draft.groups`
         and retries on a mismatch, the way `checkFigures` compares
         figures. A MENTION IS NOT A SCOPE CLAIM: an all groups file really
         does contain NEXUS rows, so "including NEXUS" passes and "for
         NEXUS" does not. A file scoped to one group is wrong the moment
         she names another, preposition or not.
      Verified live three runs out of three: the card rescopes to
      `NEXUS - BANK, 2 rows` and she says 2 deals, 2 people.
      **Still worth doing separately:** she sometimes answers the GROUPS
      step herself, unasked ("Switched the document to Bank for every
      group"), which skips a question the admin never answered. Harmless
      now that the scope is checked, but it is still her inventing an
      answer.
- **MOVED TO `backlog.md` 2026-09-06.** Diane's draft is shown as final
  before the guards have judged it, so a rejected answer visibly rewrites
  itself. Measured at about one turn in 17. Parked: the fix is in
  `agentOrb/`.
- [x] **`scratchOnly` was skipped entirely by `--live`.** Reopened and
      FIXED 2026-09-06. `scripts/dianeChat.js` was `if (!LIVE)
      require(...).arm()`, so the one flag you needed to read real figures
      back also turned the write guard OFF, and nothing else refused a
      write. The comment above it read "It still refuses every write".
      Both halves were wrong: the flag was never needed for reads either,
      because `scratchOnly` patches `create`, `update`, `remove` and
      `removeMany` and touches no read path. Proved by a `--live` run of
      `full-sweep.txt`, whose later turns write: it added row 286 (ZZTEST,
      Testy McTest, Fake Co) and set `payableDays` 0 to 25, `endOn` to
      2026-12-31. Contained to the fake group, no real row touched. Row
      286 removed 2026-09-06 through `repo.remove`, so the deletion is in
      the change log and recoverable; the sheet is back to 96.
      **Fixed by DELETING the flag, not mending it.** A flag that does
      nothing is a worse trap than one that does the wrong thing. Reads
      are always live because they always were; writes are always confined
      to `ZZTEST`, which is what every write scenario already targets.
      Verified both directions: a read scenario still answers from the
      real sheet, and `repo.update` on a real INDIGO row now throws
      "SCRATCH ONLY: refused to update #3 a row in INDIGO" with the value
      unchanged.
- **PARKED 2026-08-25, until the exports are otherwise settled.** `pg` has
  no `setTypeParser` for the date type (OID 1082), so a `date` column
  returns a JS Date at the SERVER's local midnight. Returning `YYYY-MM-DD`
  strings fixes it for good, but `buildWorkbook`'s `toRow` hands those
  values straight to exceljs: as strings every date column in every export
  becomes TEXT, the date formats break, and a re-upload reads them as prose.
  One change across the parser and all five builders, with a round trip.
- **PARKED 2026-08-25, moved to `backlog.md`.** A History page with Recover
  on every row. The recovery rule greys out older entries as you use it,
  which can read as the page breaking, and reinstating a deleted row needs
  a row snapshot the log does not store.
- [x] **`PeoplePage.jsx`'s dead `uploadState`.** Gone already, checked
      2026-09-01.
- [x] **`RowModal`'s unused `startInDelete` prop.** Removed 2026-09-01.
- [x] **TESTING WROTE TO THREE REAL ROWS.** Re-ticked 2026-09-06: the guard
      is right and the one way past it is gone, see above. 2026-09-01: a Diane test set
      Abe Lincoln, BYG and Byron (INDIGO) to preset `2023-09-01` with 0 days
      and £0, quietly taking £2,700 out of September. Caught by a preset
      spread query, put back with the batch undo. FIXED same day:
      `v1/testing/scratchOnly.js` `arm()` throws on any write outside
      `ZZTEST`. Arm it first in every write test.

## 4. Waiting on the boss

- [x] ~~Which wins when a typed Payable days disagrees with the dates.~~
      **THE DATES WIN. Decided 2026-09-08.** A hand set day count survives an
      UPLOAD (it is a claim) but is re-derived whenever a date moves on the
      row. A count that outlived its own dates is the inconsistency this was
      asked about in the first place.
- [ ] **Group managers on the Cash sheet.** He asked for it; no row carries a
      manager and there is no `tb_groups` table. Designed in `backlog.md`.
- [ ] **Drivers.** No row carries a driver role, so the Driver export tab is
      disabled. Ask how a driver reaches the sheet at all.
- [x] ~~**84 or 90 days** for the payment start offset.~~ **90. Decided
      2026-09-08.** His two written documents say 12 weeks and "84 days from
      incorporation"; master.xlsx says 90 on all 78 of its formula rows, and
      the money was paid against the spreadsheet. One definition,
      `shared/fromAppointment.helper.js`, pinned on both sides. Still worth
      confirming with him, but nothing is blocked on it.
- [ ] **Is "money received in" per group or per company?** Built once as
      per-group, pulled back out rather than ship the wrong granularity.

## 5. Gaps and polish

- [x] **The History page showed 7 days capped at 200, with no paging.**
      Closed 2026-09-29: `page`/`pageSize` on the route, `Pagination` in
      `HistoryList`, and the total in the sentence above it. Both frames
      page, modal included.
- [x] **The account menu had no arrow key navigation.** Closed 2026-09-29:
      Up/Down/Escape and wrap, focus on the first item when it opens.

### From the Diane transcript, 2026-09-29

- [ ] **A person and their COMPANY glued into one argument is not split.**
      `splitPersonAndGroup` handles "Zayn Milkman" because MILKMAN is a
      group; "zayn workforce" would still miss. **Deliberately left:** a
      company name can BE a person's name ("Gloria - Workforce"), so the
      same split on the company list is a different risk. **Fix when it
      bites:** the same function with the company list, plus a refusal to
      split where the remainder is itself a real person.
- [ ] **`wrongMonthAsked` guards the AMOUNT write only.** Any other write
      that prints a month and takes none (a preset move, a date edit) can
      still be asked for October and land on September. **Fix:** lift the
      check to wherever `args.said` and the row's month meet, once there is
      a second door that has actually been asked.

### From the write audit, 2026-09-29

The three patterns are `useOptimisticUpdate` (paint now, roll back),
`useReportingMutation` (wait, then say so) and a plain `useMutation`. The
audit was for writes on the third that should be on one of the first two,
and for writes whose FAILURE says nothing.

- [ ] **`POST /settings/reset-master-sheet` has no caller at all.** The
      Danger zone became one button ("Burn now clears the deals as well")
      and the second one's hook and api entry were left behind; both are
      removed now, the route is not. **Fix:** delete the route, `burnRepo.
      resetMasterSheet` and its test, OR put the button back. **ASK FIRST:**
      it is a destructive route and which of the two he wants is his call.
- [ ] **Both wizards call `apiService` directly and invalidate nothing.**
      `AddCompanyWizard` writes through `companies.update` +
      `addHandlers`, `AddPersonWizard` through `masterSheet.create`. They
      navigate afterwards so the page you land on is fresh, but every other
      cached list (People, Companies, the master sheet, the review queue)
      keeps the old rows until a socket event or a refetch. **Fix:** route
      them through `useAddHandlers` / `useUpdateCompany` /
      `useCreateMasterSheetRow`, which already carry the right
      `invalidates` lists. Their inline errors stay: `silent: true` is what
      those hooks are for.
- [ ] **`useImportExpenses` hand rolls the upload triple.** Its own
      `phase`, its own promise chain, its own commit. Deliberately not
      `useImportFlow` (a different parser), but the SHAPE is the same
      three beats and the two will drift. **Fix:** give `useImportFlow` the
      parser and the endpoints as arguments, then both doors share it.
- [ ] **Six forms hold a local `busy`/`saving` boolean** beside a mutation
      that already exposes `isPending`: `AddDealModal`, `AddExpense`, both
      wizards, `LocalLocations` (fixed), `MasterSheetExportModal`. Two
      sources of truth for "is this in flight". **Fix:** read `isPending`
      off the hook wherever the hook is the one doing the work.
- [ ] **Expenses: bulk acts over SELECTED ROWS.** The only part of R2 left.
      Row checkboxes, a select all with an indeterminate third state, and
      `bulk-update` / `bulk-delete` sharing one id validator. **Fix:** bulk
      set the rate first; it is the one that saves the most typing. Bulk
      ADDITION already shipped twice, as "Save and add another" and as the
      import.
- [ ] **Expenses R4: `tb_expenses_changes`, History and undo.** Same shape
      as the master sheet's change log.
- [ ] **Nothing records who fronted a cash expense.** `spent_by` is free
      text, so "what is Gloria owed" has no answer. **Fix when it lands:** a
      NULLABLE `spent_by_person_id` BESIDE the text, never replacing it.
      Text stays the display, the id becomes the join.
      **ASK HIM FIRST.** `closure.md` §10 used to call this "the first 90
      days, roughly £6,000 per company"; corrected 2026-09-14, neither is in
      any source we hold. The scale is unknown, so do not size it yet.
- [ ] **`awayGbp` counts GBP only.** `breakdowns/withUsd.js`: away cash in
      any other currency lands in `awayUsd` and never in `awayGbp`. The
      figure is named for pounds so this looks deliberate, but it is the one
      arithmetic line where adding a currency changes what a number means.
      **Fix, and it needs the boss:** if "of which away" is meant to be
      pounds only, close this. If it is meant to be all cash carried
      abroad, it needs to be per currency like every other total.
- [ ] **A currency spelled two ways is two currencies.** `CURRENCY_ALIASES`
      in `shared/toUsd.helper.js` is what makes the sheet's `EURO` mean
      `EUR`. Nothing else joins spellings, so `PESO` beside `PHP` would be
      two rate boxes, two totals and two lines.
      **Fix when it appears, not before:** one entry in that map. It is a
      judgement about the business, not a code question: `PESO` could as
      easily mean MXN, and an alias merges two currencies silently.

- [ ] **The two dashboard keys say "Current month" in opposite tones.**
      Group Overview draws a past month `soft` and the current one `strong`;
      the trend line's dots are the other way round (`MONTH_TONE` in
      `DashboardPage.jsx` against `SOURCES` in `SourceTrendChart.jsx`). It
      was invisible while the keys read "Saved" and "Actual" and is not now
      that both read the same three words.
      **Fix, and it needs a call:** flip `SOURCES` so the current month is
      the strongest mark on both, because the whole page reports the current
      month. Flipping the BARS instead would make the month everything else
      is about the palest bar in the panel. Either way a chart changes on
      sight, which is why it is not done.

- [x] ~~**Export warnings are HIDDEN, not deleted.**~~ **Back on 2026-09-08.**
      The row fixes go through `useMasterSheetCellEdit`, which paints and
      rolls back, so the panel no longer waits on the server. It also gained
      a `derivable-dates` kind: a row missing one of the three dates is shown
      what the others say it would be, with Accept per row and **Accept N**
      on the group line. Backward suggestions (an appointment date worked
      back from a payment date) are marked as guesses, are excluded from the
      batch and are never applied by a rule.
      An accepted row leaves the list on the PRESS: the panel reads
      `['export-count']`, a different query from the one the optimistic
      write patches, so `ExportWarnings` holds its own accepted set rather
      than the cell-edit hook invalidating that query for every inline edit
      on the page. Pinned by `acceptAllDates.test.js`.
      **The PANEL lives in the Export modal only, his call 2026-09-08.** A
      second mount on the Master Sheet toolbar was planned and dropped: the
      panel's warnings are computed for an export SELECTION and the page has
      no selection, so it would print "rows affect this total" on a page with
      no total. Closed in `backlog.md` under Settled NO. The master sheet
      instead marks the same three dates PER CELL, `helpers/dateNotices.js`,
      2026-09-08. Same suggestion, no total to lie about.
- [x] **`npm test` hung and it was the pg pool after all**, closed
      2026-09-16. Not `askedForUsd.test.js`: it is whichever file finishes
      last. Any test that requires `configs/db` creates a real Pool, whose
      handle keeps the event loop open; `blockA` and `newTools` "exited
      fine" because something else was still holding it when they ran.
      The handle is legitimate and nothing here needs a database, so
      `--test-force-exit` is in the npm script rather than in everyone's
      shell history.
- [ ] **Flag contradictions on upload** rather than letting someone find them
      later. `parseUpload` already builds `review_reason`; two patterns
      worth adding, each of which has already cost money once: a preset that
      disagrees with the rest of the sheet, and a Bank method with no
      account number. (A typed Payable days that disagrees with the dates is
      no longer one of them: the dates win and re-derive it. §4.)
      (The third case, a stored date that disagrees with the appointment
      formula, now shows on the cell: `mismatchedDates` has a caller.
      Nothing flags it at UPLOAD time yet, which is what this item is about.)
- [x] ~~**Diane's two refusals OFFER something she cannot do.**~~ **Reworded
      2026-09-09.** Both lines said she could show the CRM's export modal or
      add deal form; she can open neither, and the second promised back the
      very form that had just been disabled. They name a real button on the
      Master sheet toolbar now and describe what the ADMIN does. Pinned in
      `disabledTools.test.js`.
- [ ] **`trimEdges` keeps a middle gap and both callers then delete it.**
      `DashboardPage.jsx:666` and `:1102` run
      `.filter((point) => !point.unavailable)` right after it, which undoes
      the one thing that helper exists to preserve: "a gap in the MIDDLE
      stays, between two real months it is a fact about the history, and the
      line is meant to break there." Leading empties are trimmed and that is
      correct, which is why the dashboard starts at August with no snapshot
      before it. Fix: drop the two filters and draw a break. Not done
      2026-09-09 because only the leading behaviour was asked for.
- [ ] **DIANE SUGGESTS FIXES FOR THE SHEET.** Asked for 2026-09-17, not
      started. She answers what the sheet says; this is her saying what is
      WRONG with it and offering to put it right: dates that contradict the
      appointment formula, a value the rest of the row already implies, a
      row that will drop out of a total unnoticed. The full entry, the nine
      fault classes and the seven guards are in `diane.md` under OPEN.
      **The one that decides whether it is safe:** every suggestion must
      come from the helper the page and the export already use. A second
      definition of a formula means she and the screen disagree about the
      same row with no way to tell which is right.
      **Decide before any code:** applying a fix writes through the SAME
      route the export panel uses, not its own.
- [ ] **Diane's forecasting.** Her recall is 3 months and she cannot look
      forward at all. The dashboard projects one month; she has no
      equivalent. Backlogged at his call 2026-09-09.
- [ ] **The month sheet and the payout files are still FLAT**, while the
      single-tab master sheet export is now live. Deliberate, not an
      oversight: those tabs write totals as static values in column C through
      `countsTowardTotal`, which reads the colour setting, and no Excel
      formula can reach a settings row. Making them live means making every
      total and the whole breakdown live too, and that one rule cannot be
      expressed in Excel. Fix, if it is ever wanted: `SUMIF` per currency per
      block, with the toggle's state baked in at export time and a note in
      the file saying so.
- [ ] **Nothing tells the reader the exported master sheet is live.** The
      four formula columns recalculate and the file says nothing about it.
      Fix: one line on the export card and in Diane's summary, per
      `docs/diane.md`.
- [ ] **No "add a company manually"** for one not in the sheet.
- [ ] **Copy a deal into another group** — requested, not built.
- [ ] **Group and role cells in the table are still single-select**, though
      several groups are legitimate per person.
- [ ] **`last_seen_upload_at` and a "not in the last upload" filter**, so a
      row the sheets stopped mentioning is findable.
- [ ] **Remember the header mapping between uploads.**
- [ ] **`useOptimisticUpdate` still builds its own messages** instead of
      going through `helpers/toastMessage.js`, and hardcodes "update" in the
      failure path, so a delete failing through it reads "Couldn't update X".
      Left alone in the toast pass on purpose: it also owns the collapse key
      and the snapshot rollback, so merging it is its own change rather than
      a rename.
- **MOVED to `feature.md` item 3**, 2026-09-01: rate limiting beyond `/login`, the
  SSE heartbeat and the secure-cookie question all belong to how this ships
  (one PC, an Electron .exe, no internet), not to the CRM itself.
- [x] **Dashboard.** Shipped 2026-09-04 as the authenticated landing page.
      KPI counts, selected-month payable semantics, source labels, filters,
      snapshots, change drivers, and test/build evidence are in `state.md`.
- [x] **THREE PLURAL GAPS IN DIANE'S TOOLS.** Closed 2026-09-03.
      `active_companies` takes `months`; `check_rates` and
      `recall_past_conversations` take `people`. `KNOWN_GAPS` is empty and
      `pluralAsks.test.js` pins all three schemas and their shared execution
      path.

      Deliberately singular and listed there with their reasons:
      `export_sheet:month` (one file, one month, its own guided step) and
      `update_person:person` (a plural WRITE needs the two call `confirmed`
      shape, so it is wanted WITH that, not instead of it).

- [x] **A GUARD ON PERCENTAGES.** Closed 2026-09-03. `checkPercents`
      compares percentage claims with the tool output, and typed
      `state_claims` provide the structured path. `checkFigures` deliberately
      leaves percentages to this guard so the two checks cannot fight.

- [ ] **A THEME SETTING for Diane's colour**, asked for in `diane.md`. The
      blocker is gone: every colour she uses is in
      `web/src/configs/dianeTheme.js`, and `tailwind.config.js` and
      `index.css` both read it. Fix: a `tb_settings` value for the signal
      hue, applied as CSS variables over that module's defaults at boot.
      The canvas needs the hexes at init, so `ParticleOrb` and `LoginOrb`
      have to read the resolved value rather than the module constant.
- [ ] **Diane's speech is not streamed**, so there is a ~2.4s gap between her
      text finishing and her voice starting. The route buffers the whole mp3
      because `useOpenaiSpeech` plays it from a blob URL; making it stream
      means `MediaSource` on the frontend, not just piping the response.

## 6. whatbot side, out of current scope

Work is scoped to `crm/`. These are logged, not planned.

- [ ] `src/tools/index.test.js` hangs intermittently.
- [ ] `parseRows`'s `lenient` mode is dead code.
- [ ] `docs/sheet/` and `docs/sheet-format.md` describe the retired local
      xlsx path.
- [ ] A reopened payday answer leaves no history in whatbot.
- [ ] The `no_response` sweep only runs when the report is run.
- [ ] `employee_id` column removal, confirmed dead.

---

## Recently shipped

**2026-09-25 (5)** The Archive's dead persons list: live, indexed (067),
cached, a journey page per person, and Diane can read it. Detail in
`state.md`.

**2026-09-25 (4)** Rates said the right way round, "take N% off" over a fee
asks and holds the answer, removed deals said apart, the mic no longer
opens while she answers. Detail in `state.md`.

**2026-09-25 (3)** Diane takes her time, in code. Detail in `state.md`.
1. **A YES APPLIES ONLY WHAT THE LAST ANSWER SHOWED**, and a "no" ends it.
2. **NO GUESSED DEAL, PERSON, TOTAL OR "DONE"**, each held by a guard.
3. **UNDO FINDS THE RIGHT CHANGE** after a partial undo, and never undoes an undo.
4. **PHONE: THE BOTTOM BAR NO LONGER COVERS THE PAGE.**

**2026-09-25 (2)** Diane's bulk acts, tested end to end on ZZTEST. Detail in
`state.md` and `diane.md`.
1. **SEVERAL NAMED DEALS IN ONE ACT**: special cases, amounts added, paid,
   review stops and closures, each shown from and to and applied once.
2. **"ADD 500" WAS WRITTEN AS 500, AND ONCE TWICE.** Both closed.
3. **A YES OR NO ABOUT A RATE OPENS WITH YES, NO OR PARTLY**, worked in code.
4. **FIVE WAYS A "YES" FAILED OR MISFIRED**, among them every two person bulk
   call reading as the same call. Closed in `confirmReplay.js`.

**2026-09-25** Diane's rate work, audited by talking to her. Detail in
`state.md` and `diane.md`.
1. **A PROFILE RATE IS UNDOABLE**, one press for the whole act.
2. **EVERY TOTAL IS RATED**: the two lists and the two detail pages.
3. **SHE CANNOT CONFIRM WHAT WAS NOT SHOWN**, nor call a question "done".
4. **THE FIRST PROFILE EDIT WROTE THE SLUG AS THE NAME.** Migration 066
   repairs the 9 real people it reached. **Not yet run:** `run-it.md`.

**2026-09-24** Her deal card is `label: value` lines two up, contact and
bank opens open, the pills sit beside the name, and the two rate cells are
the person's plus the deal's already added up. Her deal list is one lit row
per deal with the search on the title. Every modal wears the app's slim
scrollbar. `personRatesSql` carries both levels of a rate to the four
readers that rate a figure; the person and company detail pages were
showing half of one. One agreement now applies EVERY pending call it
covers, the value a change is coming FROM no longer has to appear in her
answer, and `update_person` takes `people` so several people is one act.
Esc closes the sign-in briefing. Detail in `state.md`.

**2026-09-21, later** Five faults found by DRIVING THE BROWSER over the
batch below. Detail in `state.md`.
1. **ELEVEN OF THE TWENTY BADGE COLOURS WERE DEAD IN PRODUCTION.** The
   class is composed (`badge-${status}`), so Tailwind's content scan never
   sees it and purges the rule. The end date pill, `going_concern` and
   every payment outcome printed as bare text. `configs/badgeKinds.js` is
   now the one list and `tailwind.config.js` safelists it.
2. **`colourTokens.test.js` was green through all of it.** It asks whether
   a token exists, not whether the class survives the build. Two different
   questions, and now two tests.
3. **A saved end date kept showing the old phrase** until a refetch. The
   server clears `end_note`, the optimistic patch did not. Covers the
   appointment cascade too, which the server also clears on.
4. **History offered Undo on fields the route refuses**, so every press was
   a 409. The list carries `revertible` and the panel says why instead.
5. **The liquidation checklist re-ticked what somebody had unticked**,
   because it defaulted to all even on a company already in liquidation.
6. Verified by rebuilding and reading the generated CSS back: all 20 badge
   rules present with real colours. 609 web tests, 1661 api tests, 0
   failing. Every fix was broken on purpose first and watched go red.

- [ ] **The running dev server has to be restarted to pick the safelist
      up.** It was started before `configs/badgeKinds.js` existed, so the
      config's new import is outside the graph it watches and the CSS it
      serves is still missing 10 of the 20. A fresh `vite build` has all
      20, so this is the running process, not the fix. `npm run dev` in
      `crm/web`.

**2026-09-24** Eight faults in Diane, seven found by TALKING to her in
`scripts/dianeChat.js`. Detail in `state.md` and `diane.md`.
1. **AN INSTRUCTION WAS ANSWERED WITH A LOOKUP.** "make bram a special case
   deal" came back "Bram Oakhurst's special case: No". The hole was the
   computed reply shortcut, which ends a turn on a tool's own sentence and
   so reaches no reply guard. `setIntent.js`, and `writes: true` on the
   eight tools that change data.
2. **A CONFIRMATION COULD NOT BE COMPLETED.** She asked, the admin agreed,
   she asked again. The runtime now applies the pending call and she
   narrates it, only ever for a change her previous answer described.
3. **DEAL STATUS WAS NEVER WIRED TO HER**, so "how many are reviewed
   monthly" got the review queue's 17 against the real 12. Read only:
   `dealStatus` on `filter_master_sheet` and a card cell.
4. **THE FEE WENT THE WRONG WAY IN HER PROMPT**, the pre-047 meaning,
   beside a tool that deducts it. One sentence now, pinned against the
   arithmetic.
5. **THE SPECIAL CASE SWITCH HAD THREE NAMES** and the admin's was none of
   them. One per codebase, each pinning the literal.
6. **A BARE "YES" REDID A FINISHED WRITE.** Identical values, so no figure
   moved, which was luck.
7. **SHE PROMISED AN EXPORT THAT IS TURNED OFF**, in detail, one turn after
   being told nothing was on screen.
8. **TWO GUARDS READ ROW COUNTS AS VALUES.** "(1 row)" and "on 2 deals".
   One definition, `countNoun.js`.

**2026-09-24 (4)** **A GROUP NAME COULD NOT PICK A DEAL.** Zayn's two
deals are both on "Workforce", so its group is the only way to name one.
"There is no deal with the company named MILKMAN, there might be a
spelling difference" was a dead end with no spelling difference in it.
Re-homed onto the field that matches, and a word matching nothing now
names the deals they do hold. Detail in `state.md`.

**2026-09-24 (3)** Ten faults from a live transcript, and four more found
while testing the fixes. Detail in `state.md`.
1. **"ADD 3%" WAS WRITTEN AS "SET TO 3"**, on the wrong LEVEL, with no
   from value. Rates now confirm, naming level, from and to; deltas for
   "add another".
2. **A PROFILE RATE CHANGE WAS LOGGED NOWHERE.** One entry per deal now,
   under `personAddonPercent`, not undoable by design.
3. **UNDO CALLED SIX FIELD EDITS DELETIONS**, including the appointment
   date. It was using a LABEL map to decide undoability.
4. **SHE PICKED THE FIELD THEY NEVER NAMED** on a bulk write, and reached
   three deals fewer than they listed.
5. **FIVE ANSWERS ABOUT THE WRONG QUESTION**: a rule answered with a
   total, a panel drawn twice, a count borrowed from another group, two
   real groups reported as not existing, and a malformed refusal.
6. **FOUR MORE, FOUND TESTING**: a write reported as a lookup, a pending
   tool that could not be confirmed, an opener that defeated the
   instruction guard, and the tool's own instructions read out loud.
7. **`tb_people` WAS OUTSIDE THE SCRATCH GUARD**, so a rate test could
   have moved a real month.

**2026-09-24 (2)** The three open items closed. Detail in `state.md`.
1. **THE THREE DELETED DEALS ARE BACK**, archived, from the August
   snapshot. Live stayed 91 and September did not move.
2. **THE MASTER SHEET PAGE NARROWS BY DEAL STATUS**, through the same repo
   param Diane uses. Both status filters now say which status they mean.
3. **THE TWO `ZZ` COMPANIES STAY.** Not leftover test data: the closure
   drill leaves them deliberately and reuses the names. Verified invisible,
   the Companies page reads from the deals and they have none.

**2026-09-23 (2)** Configuring the working file. Detail in `state.md`
and `diane.md`.
1. **THE HEADER BAND TAKES A COLOUR** on the master sheet tab, which is the
   one document that could never be coloured. Shared `Swatches`, sent on
   its own because this file has no breakdown to carry it.
2. **`blue-white` IS THE ONE COLOUR WITH A SHEEN.** A two stop gradient on
   the header alone, both stops dark enough for white type.
3. **A "RATES APPLIED" COLUMN, IN WORDS**: `added 5% · 1% fx fee`. The one
   opt in column: a switch owns it, it is not in the picker or any preset,
   and it is written last.
4. **PER PERSON EXPORT** on that tab. The picker already existed on the
   payout tabs; `people: true` on the mode is the whole change. Groups
   still split per tab or per file, and person and method stack.

**2026-09-23** Four loose ends. Detail in `state.md`.
1. **MAYAH CLOSED.** INDIGO and MILKMAN are a full match against his two
   images: 41 and 41, 27 and 27, nothing missing, nothing extra, no cell
   mismatch.
2. **A SWITCH NEEDS THE COLUMN IT WRITES INTO.** "Include tags" is hidden
   and unsent when the end date column is not picked. It was doing nothing
   on four of the five presets.
3. **DEV MODE NOW CARRIES THE REFERENCE TOO.** It showed the driver's own
   message and dropped the six characters that find it on the Logs page.
4. **THREE ROWS TO RECOVER, NOT FIVE.** Four of the seven deleted on the
   20th were replacements the same upload had just inserted.
   `scripts/recoverFromSnapshot.js` reads the August snapshot and inserts
   them ARCHIVED. **Dry run verified, the write itself is still to run:**
   the command is in `run-it.md`.

**2026-09-22** The export's four documents, and three crashes. Detail in
`state.md` and `diane.md`.
1. **THE COLUMN DROPDOWN GAINED A FIXED RAIL**: All / Standard / Bank /
   Cash / Crypto. Bank, cash and crypto also FILTER THE ROWS to that
   payment method, through the `method` filter `applyFilters` already had.
   `COLUMN_PRESETS` became `SHEET_PRESETS`, since it stopped being only
   about columns.
2. **A FILTERED RUN IS A DIFFERENT FILE.** `MASTER SHEET - BANK`, and the
   three places that predict a filename all pass the method. Without it the
   four came down as one name and overwrote each other in his folder.
3. **ONE WORKBOOK, A TAB PER GROUP IS THE DEFAULT**, and gated to the one
   template that can build one. It was offered on six tabs and honoured by
   one, so picking it on Cash promised five tabs and gave a single sheet.
4. **THE WORKING FILE CARRIES THE RATES ON PAYABLE, NOT ON MONTHLY.** It
   forwarded neither `rates` nor `cryptoPercent`, so person level add ons
   reached no figure in it. Monthly stays the stored wage because the
   upload READS it, and a rated wage returns as a raise and compounds.
5. **ARCHIVING TOOK A DEAL OFF THE PAGE AND OFF NOTHING ELSE.**
   `findAllRows()` had no `stopped_on` filter, so the export, the
   dashboard, whatbot's pull and Diane all still carried it. Found on a
   file holding 43 INDIGO rows against his 41.
6. **TWO CRASHES.** A tag with no column threw `Out of bounds` and lost the
   whole export; a failed day count written into a NOT NULL column threw
   and rolled back the whole edit.

**2026-09-21** His end date words, and a fifth company status. Detail in
`state.md` and `diane.md`.
1. **31 OF 92 ROWS HELD PROSE IN THE END DATE COLUMN AND WERE DROPPED IN
   SILENCE.** `Going concern` on 19, `Reviewed monthly` on 12. Migration
   059 adds `end_note` (his words) and `review_monthly` (behaviour), two
   columns because a queue driven off free text empties itself on a typo.
2. **"Reviewed monthly" meant the OPPOSITE of what he wrote.** The queue
   asked whether the end date had passed, so a null kept those 12 out of
   the screen meant to ask about them. It is a third reason now, and the
   only one that is per deal: Richard and Klaud sit on Workforce and no
   company status could ever have reached them.
3. **A third phrase keeps its words, sets no flag, and flags the row.** The
   two he already uses do not: a third of the sheet on the review list
   every month is a list nobody reads.
4. **`going_concern` is the fifth company status.** Not terminal, so it
   pays like active. Green, never grey.
5. **The status screen is one ROW of five**, `CompanyStatusPicker`, and
   BOTH doors use it: the Manage modal and the company detail page, which
   still had the dropdown. One sentence under the row, the chosen status's.
   A live per deal checklist appears under liquidation in the modal, where
   one Save writes both; the detail page has no press to attach it to, so
   it does not ask and its amounts stay with `LiquidationPanel`.
6. **The cell says why it is blank**: a 10px pill where the date would be.
   The deal's note beats the company's status, because Workforce carries
   both phrases and two real dates at once.
7. **Neither column is hand writable.** Typing a real end date clears the
   note; the flag is left alone, since a deal can have both.
8. **Three invented Tailwind tokens were rendering nothing**, found while
   fixing the picker: `bg-surface-subtle`, `hover:bg-surface-hover`,
   `border-line`. All three are plausible siblings of real tokens, which is
   why the diff read fine. `configs/colourTokens.test.js` now checks every
   colour class in `src` against `tailwind.config.js`.
9. **A passed end date is a REVIEW, not a closure.** The popup said the row
   was still counting and pointed at a Settings toggle. It reads "Up for
   review this month" now and names the real reason: appointment plus one
   year ran out, and that is the first of the queue's three reasons.
10. **A closure now paints its deals, not just its word.** The two id lists
    are instructions and were being written onto the cached company as junk
    keys, so every deal a closure stopped read Active until the refetch.
    `web/helpers/companyCascade.js`, tested for real rather than as text.
11. **One `today()`**, in `helpers/formatDate.js`. AddExpense had its own.
12. **The review queue printed the RAW wage.** Zayn read AED 3,809.52 where
    he is paid 4,000. Its SELECT did not carry the rate columns, so it could
    not have rated a row if it had tried. `shared/reviewQueue.helper.js` is
    the one reader now: Diane's four tools, the panel's route and the export
    warning. `pendingThisMonth` replaces the repo's SQL `pending`, which
    cannot see a rate.
13. **A typed base rule outscored `sr-only`.** `input[type='checkbox']` is
    (0,1,1), so `FilterCheckbox` and the login's Remember me each grew a
    16px box in front of the switch they draw. `:where()` puts it at
    (0,0,1).
14. **Diane briefs you at sign-in.** Orb full bleed and scattered, speaking,
    no transcript. Four counts in one request, each a finished sentence
    computed server side. The same lines as plain words down the side, each
    a link to the data. Skip bottom right, voice only for the yes or no.
    Nothing to report means no orb at all. Off in Settings, migration 060.
15. **The orb gained `spread`**, and rotation now follows her voice while
    speaking. `density` finally has a caller.
16. **A near miss: a new settings column in the hot path.** `get()` is read
    on nearly every request, so `login_briefing` in its SELECT would have
    500'd exports, totals and Diane on a forgotten migration. Read on its
    own now, with only undefined_column caught.
17. **She starts speaking before the whole answer is synthesised.** The
    review block was one 1,696 character request, so nothing was heard
    until all of it came back. Now 3 parts of 159, 879 and 650, with the
    next one fetched while the current plays. Muting mutes a part in
    flight too.
12. 626 web tests, 0 failing. Compiled to a scratch dir and read the
    generated CSS back: every picker class is present with a real colour.

- [x] **MIGRATION 059 HAS BEEN RUN.** `end_note` and `review_monthly` are
      both on `tb_mastersheet`, confirmed against the database 2026-09-21.
- [ ] **MIGRATION 060 HAS NOT.** `tb_settings.login_briefing`, the switch
      for Diane's sign-in briefing. `npm run migrate` in `crm/api`.
      **Safe to forget by design:** the flag is read on its own query and an
      undefined_column means it takes its default, ON. Nothing else reads
      it, so no other page can break on it. See `repos/settingsColumns.test.js`.
- [ ] **Decide whether `going_concern` counts as trading everywhere
      `active` does**: the Active company list, the totals. `isTerminal` is
      the only test that branches on status and it names dissolved and
      closed alone, so it behaves like active today by default. Probably
      right, worth confirming rather than discovering.

**2026-09-18, later** The first week rule, the review session, and the
recompute dialog. Detail in `state.md` and `diane.md`.
1. **A FIRST WEEK APPOINTMENT IS PAID IN MONTH 3.** His call: +90 tips them
   past it in eleven months out of twelve, so they waited four months.
   Week 1 is up to and including the first Friday; the start becomes the
   last Friday of month 3 and the whole month is owed.
2. **The stored date is the PAYDAY, so the day count does not follow it.**
   Forced to the month's own length, and ONLY in month 3. From month 4 his
   own formula returns a full month unaided.
3. **The export carries HIS expression**, `=DAY(EOMONTH(G,0))`, the middle
   branch of his own formula. Still live. Without it the file would
   recalculate to two days on open and undo the rule where he reads it.
3b. **The START cell needed the same and nearly shipped without it.** Found
   by building the file and reading it back: a cached 30 October under a
   formula saying 1 November. The money was right and the date was wrong,
   which is the harder kind to notice. Unit tests on the formula builder
   had passed; only the round trip caught it.
4. **No new column.** A `CellInfo` explains why 31 sits beside 30 October.
5. **Re-derived all 32 existing week 1 rows.** Verified: September's total
   does not move, because all 32 were appointed in 2024 and 2025.
6. **The review takes `entries`**: any scope, any answer, one message, one
   confirmation, one undo. A scope word is tried as a company OR a group.
7. **The review list groups by company AND group**, and
   `answer_monthly_review` gained `group`. Four identical Workforce lines
   were unreachable by any tool.
8. **The recompute dialog**, only on a hand typed payable amount.
9. **Found by talking to her**, nine in all and every one against a green
   suite: the scope word in the wrong field, "everything has been answered"
   when the scope missed, the first week rule absent from
   `explain_preset_rules`, "show both" answering for one person, a scope
   hiding inside the NAME (which resolved to a stranger and tried to write
   there), "ended" refused by one tool and accepted by the other, two
   instructions becoming two writes, a group name refused as a missing
   company, and `stop_deal` asking "which company" about four deals that
   all share one.
9b. **A COMPANY IS A COMPANY IN A GROUP, and that was missing in FOUR
   places**: the review list, the review's ambiguity message, `stop_deal`
   and `resume_deal`. Each printed one name several times and asked a
   question with no answerable form. Worth checking the next list of one
   person's deals before writing it.
10. **`say` was dead** on three tools and the speech cap cut silently.

**2026-09-18** A month's difference is an ACCOUNT, and two greetings for one
"hi". Detail in `state.md` and `diane.md`.
1. **`shared/monthReconcile.helper.js`.** Five buckets: added, removed,
   ended, not counted this month, changed. They must ADD UP to the
   difference, per currency, and an unexplained remainder is a warning, not
   a rounding.
2. **`snapshotDrivers` had three buckets and it was a live fault.**
   Everything absent from the later month was "ended", so a live deal
   marked for October was reported as finished, on the dashboard too.
3. **A change names WHICH PART moved**: amount, add on, crypto, fee. On the
   net alone an add on rising reads as the wage rising.
4. **The live current month has drivers now.** It had none, and this month
   against last is the only comparison anybody asks for.
5. **Diane prints the account under the step**, off the same helper, so she
   cannot disagree with the dashboard about the same month.
6. **`interimLine.js`**: a lone `say`, or one ending in a question, never
   reaches the screen. Its description already forbade both.
7. 1,567 API tests and 555 web tests, 0 failing. The reconciliation split
   was proved red first by lumping the three buckets back into one.

**2026-09-17, last batch.** Bulk by name, delete by name, and seven filters
that did not exist. Detail in `state.md` and `diane.md`.
1. **`amountField` was snake_case, a LIVE BUG.** `payable_days` is on no
   allow list, so the range was silently dropped and "who is on 0 payable
   days" answered with the whole sheet. 24 rows against 100 after the fix.
2. **Seven columns gained a filter**: `appointmentWhen`,
   `acceptingPostals`, `label`, `paymentOutcome`, `oldGroup`,
   `sheetShouldBePaid`, `sheetPaid`. The two rates went to `amountField`
   instead, because a percentage is a figure.
3. **`perPerson` on the bulk tool.** One sentence, a different value each,
   one preview with a line per person, one confirmation. `saidFor` settles
   the names, which is the third time that same fault has been found.
4. **And she has to REACH it.** She went past it live and did two single
   edits. The second name-addressed edit of a shareable column in one turn
   is turned back with the tool that does both.
5. **Delete takes names, groups and companies**, `DELETE_MAX` 25, refused
   rather than capped. A name that misses refuses the whole delete.
6. **The same call twice in one round serves the first result.** Within one
   round only. **No unit test**: it is in the turn loop, live audit only.
7. Closure drill re-run against Postgres, **47/47**, then `--clean`.
8. **The placeholder guard caught my own prompt text.** Two of the new
   descriptions named live people. `parse.test.js` fired, both replaced.
9. 1,566 API tests, 0 failing.

**2026-09-17, audited by TALKING to her.** Every fault here came out of a
live conversation while the unit tests were green. Detail in `diane.md`.
1. `checkAgainstCard.js`: she answered "and his role?" and "and company he
   handles?" with no tool call and invented both. Text was invisible to
   every guard; the card already drawn is the evidence. It fired three
   times in the next audit and corrected each one.
2. `list_companies`: "which companies are in liquidation" was answered in
   DEALS, so she never named a company. The deals tool now redirects.
3. `explain_preset_rules` is no longer a computed reply: it recited the
   general rule to "why is RICHARD not payable this month". The card
   carries the reason in words instead.
4. The matcher learned stems, values and vocabulary, all from real turns:
   "where is he located", "is he active", "is his company liquidating".
5. `shared/money.helper.js`: three identical copies existed and a fourth
   was about to be written.

**2026-09-17, later** Answering a question about one column, and one filter
definition. Detail in `state.md` and `diane.md`.
1. The card carried 19 of a deal's 33 columns, so 14 were unanswerable and
   fell through to drawing everything. All 14 reachable now.
2. A label is matched by its WORDS, so "accept postals" finds "Accepting
   postals", and `End` no longer matches inside "weekend".
3. Naming a field answers the value and draws no card.
4. `bulk_update_master_sheet` takes the same filters as the lookup, so a set
   she can describe is a set she can change. `companyStatus` came with it.
5. She reads her whole reply aloud, and the browser voice chunks so it is
   not abandoned part way.
6. Nothing reaches the screen until the turn commits, and the auto scroll
   was fixed to match.

**2026-09-17** The Richard turn: three guards, a bulk reopen, and the
scenario that would have caught them. Detail in `state.md` and `diane.md`.
1. `checkAmbiguity.js`, the first guard on what she claims she CANNOT do.
   She invented "there are several Richards" on a name one person holds.
2. `checkDays.js`. She invented "from 31 to 0" on a row holding 30. Day
   counts sit under `checkFigures`' floor of 100, like percentages.
3. `fieldAsked.js`. Asked for a field she answered with a total, because
   the details reply was "the full details are on screen" whatever was
   asked, and that reply is terminal.
4. `bulk_close_companies` takes `active`, so a bulk close has a bulk undo.
5. `randomReviewScenario.js` covers both company bulk tools, closing and
   reopening the same company so it leaves the data as it found it.

**2026-09-16** Closure phases 1b, 2 and 3. The whole feature.
1. **1b, the Stop button and the Archive.** `/archive` is the master sheet's
   own list with `stopped: true`, not a second table: one deal, one row, one
   history. READ ONLY, with Resume as its only write, and Resume REFUSES a
   deal a company closure stopped (in the SQL, not only the route) because
   putting it back on a company that is gone is the one resume that makes
   the sheet wrong.
2. **2, the monthly review.** Migration 057, `tb_monthly_review`, one answer
   per deal per month. `yes` stops nothing, `final` stops at the end of THIS
   month, `no` at the end of LAST. Two doors: a `Review N` button on the
   sheet header, and a line in `ExportWarnings` so a payout file cannot be
   built over unanswered deals. No month picker anywhere.
3. **Diane answers it**, three tools in their own file, bulk behind
   `confirmFirst`. See `diane.md`.
4. **3, liquidation.** Migration 058. Four company statuses; liquidation
   STILL PAYS at amounts set by hand on a panel. No multiplier anywhere.
   Closing or dissolving stops every deal on the company; reopening brings
   back only the ones the closure stopped.
5. **Found while building:** `scratchOnly` never guarded `updateMany`, a
   bulk write Diane reaches directly. Guarded, with a test that reads the
   real `WRITES` list so the next one cannot be forgotten.
6. **NOT YET RUN AGAINST POSTGRES.** Every test is DB free by design.
   `scripts/closureDrill.js` is the drill; it needs migrations 056-058.

**2026-09-16** Closure phase 1a: a deal can END.
1. **Migration 056**, `stopped_on` + `stopped_reason`. A CHECK pins the four
   reasons and a second one pins **both or neither**: a date with no reason
   is a row the Archive cannot explain, a reason with no date never left
   the sheet.
2. **A STOP IS NOT BEHIND `color_uses_end_date`.** The plan said "the money
   rule reads `stopped_on` where it read `end_on`", which would have put it
   behind a setting that defaults FALSE: a deal answered "stop paying" would
   have carried on being paid. `end_on` keeps its toggle, the stop never had
   one.
3. All three consumers updated together: the colour, the total and the SQL
   badge. Breaking the rule turns **4 tests red across all three**, which is
   also the proof they are still wired to one condition.
4. **No preset is the standing roster, unless stopped.** "Always counted" is
   a default for rows nobody spoke about; a stop is somebody speaking.
5. Both web mirrors carry it. `stoppedOn` is the LAST and OPTIONAL argument
   to `paymentStartState`, so the twenty existing call sites are untouched.
6. **Nothing can set it yet.** No Stop button, no route, no review: that is
   1b and 2. The column and the rule are in place and inert.

**2026-09-14** Diane says the rate, and the rate spelling gained a colon.
1. "to find" is "in total" everywhere: the sentence, two prompt lines and
   two guard regexes. Both regexes already carried `total`, so the new
   wording still arms them.
2. **She names the percentage now, once.** The headline states the NET and
   one arithmetic line underneath says where it came from. A single deal
   folds its company into that line; a group gets one line per person
   carrying a rate, and none restates a total. `owed` means the net
   throughout, so the second line carries no noun. See `diane.md`.
3. **`adjustmentLabel` writes a colon**, "Gloria: 5% add on", on screen and
   in the exported workbook.
4. **The workbook reader had to learn both.** `RATE_LINE` in
   `workbookSnapshot.js` matched the dash only. Files already written are
   never rewritten, so a colon-only reader would have recovered a month with
   every rate silently missing. It reads `-` or `:` now, and its test
   carries one of each in one workbook.

**2026-09-14** The master sheet import diff modal, three changes.
1. **The notes fold away**, closed, with a count. A real file put nine of
   them above the tabs (a line per repeated bank name, a line per repeated
   Yes/No) and pushed the decisions below the fold, which is the one thing
   the modal exists to show. Counted per LINE, so the sentinel warnings do
   not hide inside one entry.
2. **Only the first tab says Accept all.** The rest say Select all: over a
   list of deals you are about to delete, "Accept all" reads as agreeing to
   the file rather than choosing what goes.
3. **Similar deals is HIDDEN, not removed**, his call. It deletes nothing
   on its own and the file never writes through it, so dropping `hidden`
   brings it back with no other change. Its data and delete path are
   untouched, and a test pins that.

**2026-09-14** The two export modals share their controls, and form widths.
1. `SettingRow`, `Choice` and `Swatches` moved to
   `components/export/ExportControls.jsx`. Both export modals and
   `BreakdownPicker` import them; a test refuses a private copy in any of
   the three.
2. The expenses export now draws Files as a two state Choice, Groups and
   Columns as `Select multiple` with the count in the label and an All
   button, and Colour as swatch dots. Same idioms as the master sheet's.
3. **Every raw `<input>` in the add form was missing `form-control`**, so it
   sized to its own content and sat narrower AND shorter than the Select
   opposite it. That class exists to match `Select size="form"` exactly.
4. The expenses palette carries `strong`/`soft` in css alongside its ARGB,
   so the shared `Swatches` needs no second shape to translate.

**2026-09-14** The expenses export modal, one button row, shorter search.
1. **Four questions, no tabs**: one file or one per group as a zip, columns,
   groups, colour. Everything served from `/expenses/export/options`.
2. **The import error was the master sheet's**, telling somebody importing
   expenses to check for Group/Role/Name columns. It has its own now, and
   NO HEADER and NO ROWS are told apart: one is the wrong file, the other is
   an exported empty month, and "zero rows" for both sends you to the wrong
   half.
3. **Master sheet buttons are one row**: Export, Import, Add deal, primary
   last. Add deal moved up from the toolbar, which had split three acts of
   the same kind across two rows.
4. **Search placeholders shortened.** "Search description, payee or spent b"
   was cut off mid word in a 16rem box, which reads as a broken field. The
   picker beside it already says what is being searched.
5. `zipBuffer` moved to `shared/`, used by both exports. It takes named
   buffers and knows no format, so it cannot let one read the other's file.
6. The `4e-8` in the rate box was `step="0.00000001"` driving the spinner.
   One shared `NUMBER_INPUT` now, which also removed `ConversionRates`'s
   private copy of the same negative blocking.

**2026-09-14** Expenses import, export, and one form for add and edit.
1. `GET /expenses/download` writes the month as a flat sheet; the import
   reads it back. ONE column list, `expenses/expenseColumns.js`, so a round
   trip cannot lose a column silently.
2. Two requests, the first writes nothing. Three tabs: new, **looks already
   recorded (NOT ticked)**, needs a rate. The importer never invents a rate.
   The commit is one transaction: half an imported file is worse than none.
3. **Its own everything**: routes, multer, parser, builder, diff modal.
   Pinned both ways, because a deals file reaching the expenses parser reads
   zero rows and reports an EMPTY file rather than a wrong one.
4. `AddExpense` takes an `expense` and becomes the edit form. **Save and add
   another** keeps the date, currency, rate, group and spent by.
5. **A guard that did nothing, found by breaking it.** `parseExpenses` had a
   rule about the word "Total"; the test passed with it disabled, because
   what actually drops the export's total row is the required date and
   amount. Rule deleted, test's comment corrected to say what protects it.

**2026-09-14** Expenses is ONE MONTH AT A TIME.
1. No month picker, no date range, no archiving. The route scopes every
   read to `currentMonth()` and `buildWhere` THROWS without a valid month,
   so an unscoped read cannot quietly total every month at once.
2. The month is the SERVER's, never the query string's: the admin's clock
   and the server's are ten hours apart.
3. Archive and Restore removed entirely, buttons, route, repo and hook.
   Removing only the filter would have stranded every archived row, since
   Restore lives on the row and the row would be unreachable.
4. `archived_at` stays on the table, written by nothing, for the burn in
   `feature.md` item 0. **Open:** use it there or drop it in a migration.

**2026-09-14** Expenses R1, and deletion taken off people and companies.
1. `tb_expenses` (migration 055), `/expenses` with CRUD, server side
   filters, a search box with a field picker, and pagination. `aed_amount`
   is a GENERATED column, so every row converts at its own stored rate and
   nothing in Settings can move it. `state.md` has the rules.
2. Expenses import nothing from `fxRates`, pinned by a guard rather than by
   a comment.
3. **Nothing deletes a person or a company any more.** The buttons, both
   routes, four repo functions and Diane's two tools are gone. See
   `state.md` "Delete versus Remove", and `feature.md` item 6 for the
   replacement.
4. `patchRow` was written out three times, including inside its own test,
   which meant breaking either hook left the test green. One copy now in
   `helpers/patchRow.js`; each hook keeps its own `COLUMN_FOR`.
5. The filter panel guard accepted `storageKey="` only, so it failed a page
   passing the same const it gives `useStickyState`. Widened to accept both.

**2026-09-07** Dashboard second pass, and the tab.
1. The browser tab is `Admin Workspace`, with a description and
   `noindex, nofollow`. Diane names the command center, never the app.
2. The sign-in welcome screen is gone. A sign-in lands in the CRM, always.
3. `Monthly Comparison` is `Month on month Overview`: the change on top, the
   preceding, current and forecast months listed under it, each measured
   against the row above. Its ratio was clamped to 100 for a ring to draw;
   it is not clamped now.
4. One legend component, small square swatches, one short row, shared by
   both month charts. The panel textures tried behind the quiet cards came
   back out.
5. Raw reports each currency against its OWN last month, on one aligned row
   per currency. A ratio across currencies is still refused.
6. A skipped month is said out loud: a status strip when a comparison walked
   past a month with no snapshot, and every trend line names the month it
   used instead of the fixed "vs last month".
7. The nav count caps at 99, not 9, and is a pill rather than a red square.
8. Recent Changes shows four, which is also its `pageSize`.
9. The header note is one faint caption, the span plus `forecast` when the
   range reaches past today. "Forecasting Oct 2026" was true and read as the
   page's whole scope; naming the projected months again only repeated what
   the dashed run already draws.
10. `Group Comparison` is `Group Overview`, so the two panels that span the
    range share a suffix and only their subject differs.

**2026-09-03** Company, Flagged and detail page refinement.
1. Company cards have a compact scan order, an inline Tier control and a
   Manage action. Active is quiet; only Closed is badged.
2. Flagged messages stop at two lines and reveal the complete text through
   the information popup. Seeded concern data verifies the card mix.
3. People and Company details share compact typography, floating labels and
   a full width records table after their supporting cards.
4. Breakdown card headers use the solid mint action colour while their content
   stays white. Percentage fields no longer collide at narrow widths and block
   negative typed or pasted values.
5. Interactive cards lift and scale under a stronger shadow instead of changing
   their border colour.
6. The duplicate Close action is gone from Company details. Status remains
   editable through its labelled dropdown.
7. Both navigation sidebars share the mint active state. Settings actions
   use the common button shape and meaningful icons.
8. Diane answers plural people, groups and months structurally. Percentage,
   figure, count and typed claim checks validate what she says.
9. Floating labels use only their field layer, so labels from every CRM page
   remain behind the full screen Command Center.
10. Pagination Prev and Next use the visible shared secondary button surface.
11. People and Company detail totals are recomputed for the current business
    month from monthly amount, preset days and payable days, with currencies
    kept separate. Stored payable amounts and stored aggregate totals cannot
    make the summary stale.
12. Diane's export setup now shows a small question and option card over the
    orb while stages remain, then changes into the complete preview only after
    every step is settled. Live figure refreshes preserve the served stages and
    options. The conversation keeps only an On Diane reference.
13. Diane's first export step now offers Master sheet, Sheet for a month, Bank,
    Cash and Expensing. Division Sheet is visible but disabled as Coming soon;
    Breakdown, Bank details and Driver are not offered.
14. Export stages now advance from Groups to Breakdown when "all of them" is
    selected. Diane cannot skip the current server-declared step to ask about
    Colour or another later setting.
15. The completed export card no longer renders sample rows, and build progress
    reads the download event's numeric percentage instead of displaying the
    event object. Detail-card dates are explicitly not computed total months,
    so they cannot support a false zero for August or September.
16. Diane now calls sheet records deals and returns compact, deterministic money
    answers with one readable deal per line. Multi-month totals keep every requested
    month; combined people show each adjustment before the converted total.
    Deal lookups resolve live groups before companies, `NEXUS deals` reaches the
    NEXUS group, short names cannot leak out of neighbouring words, and an
    exchange-rate follow-up lists only currencies used in the prior conversion.
17. Companies now shows at most 16 records per page. Shared pagination lists all
    pages through 10; larger sets compress around the current page with first and
    last destinations, ellipses and an inline Go-to-page field. The complete
    control stays on one horizontally scrollable row.
18. Recent changes on Person details is scoped by the selected person's stable
    id across all their current deals; Company details uses the matching company
    scope through the same shared history contract. Unprovable deleted records
    stay in global History instead of leaking into the wrong detail page. The
    one-person Export action is hidden.
19. People and Companies now share a persistent Grid/Rows switch. Both views use
    the same fetched page and actions; People gains a full desktop card grid and
    Companies gains a plain editable row table. Each page remembers its own view
    across reloads without coupling it to Clear filters. People Grid requests at
    most 16 cards while Rows retains 25 records; changing views returns to page 1
    so a table page cannot strand the smaller card result set.
20. Flagged uses the same persistent Grid/Rows switch. Grid shows at most 16
    cards and Rows shows 20 compact records with the message, category, status
    and dates visible; either view opens the same person's concern detail. A
    layout change returns to page 1.
21. Diane's person totals now put owed deals first and finish with zero-value
    deals plus their exact preset, payment-period, amount or payable-days cause.
    Compact money answers are spoken in full without bullet characters. "Show
    both/all" repeats the live name lookup, stale multi-person ids are refused,
    and the same deal card is emitted only once per turn. A completed export
    preview disappears only after the file is successfully saved.
22. Diane's details lookup now ends the turn without inheriting an older month
    or total, resolves every explicitly named person before fuzzy matching, and
    orders payable cards before zero value cards. Repeated exclusions collapse
    by reason, duplicate company names include their group, and an explicit USD
    request always completes its conversion. Payment pills use distinct expected
    and received language. Rate replies use plain lines, clear cache wording and
    full speech. Conversation downloads carry a UTF-8 marker for Windows readers.
23. Diane now resolves one person's deal by company, group and role for reads
    and edits. A company named in the sentence narrows the live rows even when
    the model omits it. Vague edits show a compact chooser and ask for the deal
    and field. Successful edits and single undo confirmations refetch the deal
    first, preserving its stored company casing and current value.
24. Deal ordering is stable, requested people retain their spoken order, and
    "totals" is recognised as a money request. Rate follow ups reject ordinary
    words misread as currency codes. The preset explanation reads the current
    setting and states the unchanged payable formula directly. Company Grid is
    capped at 16 and Rows at 25, with page 1 restored on a view change.

**2026-09-02** The command centre is an orb and a conversation.
1. **Both side panels are gone.** `WorkspacePanel` was a chooser with ONE
   option, `CommandStrip` was a menu of sentences you could already type,
   and between them the orb had a strip down the middle. Files deleted, not
   just unmounted. `WORKSPACES` went with them; `setContext` stays for the
   day there is a second one.
2. **The conversation is the right half and starts open**, remembered by
   `useStickyState`. Still collapsible and still `position: fixed`, so
   toggling it cannot remount the input and lose anything half typed.
3. **The orb has the left half**, 44vh up to 560px.
4. **The stage options moved into the panel**, under the question that
   prompted them, instead of being pinned above the input on the far side
   of the screen.
5. **The panel width and the space beside it are ONE pair of numbers**,
   `--convo-width` / `--convo-clearance` in `index.css`. The breakpoint has
   to live there: an inline style cannot hold a media query.
6. **The breakdown step is text, not a gallery.** Four scaled samples
   growing on hover read as a picture gallery mid conversation, and the
   server's `DEFAULT_ID` is already the USD + add ons table, so the card
   arrives set to it. Names and descriptions now; a plain chip may be a
   real `<button>` again with no `<table>` inside it.

**2026-09-02** Three from one transcript, all about what she asserts.
0. **One row's amount quoted as the person's TOTAL.** "Show me gloria" drew
   four cards at GBP 500 and she said "Gloria is owed 500 GBP". She is owed
   2,000. Neither guard could see it: 500 is a real figure off a real row,
   and it is a figure, not a count. `find_and_show_details` adds nothing up
   by design, so with several rows it now says so and points at
   `total_master_sheet` instead of letting her pick a card.

**2026-09-02** Two false claims about herself.
1. **Forecasting is now available through `monthHistory`.** Past months
   read immutable snapshots, the current month reads live rows, and future
   months use `projectMonth` with the unchanged preset formula. Missing
   snapshots are reported instead of being guessed.
2. **She claimed a check nobody asked for.** "Convert it to usd" got "I
   double-checked and the numbers are steady as ever. Nothing has shifted!"
   The repeat retry told her to say that "if they asked whether you are
   sure", leaving the condition to her. It is decided in code now.
3. Two bugs in my own guards, caught by their tests: a bare `which` matched
   "which is why nothing is owed", and a trailing `\b` after `really\?`
   could never match, so "really?" never read as doubt.
4. 714 API tests, green at +1 through +60 months.

**2026-09-02** The filter sweep, and seven faults an adversarial pass found.
1. **A filter she does not have is now REFUSED, not ignored.**
   `agent/knownArgs.js`, one check for every tool. An invented parameter was
   dropped in silence and the query ran unfiltered.
2. **The sweep.** `source` was the only page filter she could not reach.
   `FILTER_PARAMS` is now one vocabulary spread into the list AND the total,
   so "what are we paying the cash people in INDIGO" has a tool. Pinned
   three ways: page filters ⊆ hers, list filters ⊆ total's, hers ⊆ the repo.
3. **A filtered count carries its denominator.** "30 of 39, the other 9 do
   not match", so "are they all cash" cannot be answered with the matches.
4. **And filtering on nothing is not a YES.** My first version of 3
   confirmed "everyone in MILKMAN is on GBP right" with "all 33".
5. **Companies cannot be generalised over.** "25 active companies, each with
   a director" over a list saying "not held" twice.
6. **People are not rows.** "36 people in INDIGO on GBP" over 36 rows held
   by 28. `checkCounts` was blind to it: it read `person_name` and the rows
   carry `personName`.
7. **"Whose" is answered with names.** Withheld, she invented row ids and
   named the wrong two people.
8. **The two people guard had an exit, twice**: the other single name, then
   the list path one name at a time. Both closed.
9. 704 API tests, green at +1, +5, +12, +25 and +60. Every fix proved red
   first, and every figure checked against SQL rather than read.

**OPEN, and deliberate:** she has no arithmetic (a difference, a percentage)
and no ordering ("who has the biggest amount"). She says so now rather than
answering, but both are new reach and need a decision. A referring phrase
with no antecedent ("the second one") still gets a confident answer.

**2026-09-02** Five wrong answers from one transcript, four causes.
1. **"Whose deals are ending soon" had NO FILTER.** She answered "no deals
   are marked as ended", off `status`, while rows ending this month sat on
   the sheet. `endWhen` added (`soon` / `this-month` / `future` / `past` /
   `none`), by month, `ENDING_SOON_MONTHS = 3` named once and read by both
   the SQL and the tool description. Verified: 23 past, 1 this month, 35
   future, 37 with no end date, 96 total.
2. **"august" was answered as September**, then she asked "did you mean
   August 2024?". `repairMonth` takes the month they NAMED in the nearest
   year; dropping is now only for a month she invented whole. Reads only,
   never a write.
3. **Last turn's people leaked into this turn's answer.** "nicola total for
   august" then "add gloria and gloria difference" totalled all three. A
   name the current sentence does not mention is dropped, but only when the
   sentence named somebody, so "add those two up" still carries them.
4. **And last turn's MONTH leaked with them**, so the answer was "owed
   nothing" for a month nobody had named. The month stays, because a follow
   up needs it, but a zero that is only a zero because of the month now says
   so and offers the current one.
5. **"Double check" dropped the USD conversion** and she offered to convert
   what she had just converted. Intent reads the last two user turns
   (`saidRecent`); `said` stays one turn so names cannot leak.
6. Not a bug: the Gloria combine in that transcript was the `saidFor` fix
   not yet restarted on the server. Correct in source, verified live.
7. 671 API tests, green at +1, +5, +12, +25 and +60 months. Every new test
   proved red first.

**2026-09-01** A COUNT IS A CLAIM, and the bug that produced a false one.
1. **She said "two rows for Zayn and TWO for Paddy ... all FOUR rows".**
   Paddy has one. `checkFigures` ignores anything under 100 on purpose and
   every other guard counts digits, so a fabricated count spelled as a WORD
   passed both. `agent/checkCounts.js` reads words and digits, only in front
   of a counted noun (row, person, group, company, change, month, file,
   column), compares against what the tools actually returned, and retries
   once on its own flag. It reports; it never rewrites.
2. **And the tool really had returned two Paddys.** `rowsForNames` passed
   the whole sentence to `resolvePerson` for EVERY name in a list, so the
   longest name in it won each time: "zayn and paddy" resolved both to
   Paddy and Zayn was silently dropped from a change he was named in. The
   identical fault was fixed in `total_master_sheet` and missed here, so it
   is one function now, `saidFor` in `tools/resolvePerson.js`.
3. Verified live: the same turn now offers three rows, two for Zayn and one
   for Paddy, and writes nothing until confirmed.
4. 633 API tests, green at +1, +5, +12, +25 and +60 months. Both new tests
   proved red first.

**2026-09-01** The whole sheet in one call, and a way back out of it.
1. `bulk_update_master_sheet` covers every group with NO `group`, and a
   guard reading the admin's own sentence refuses a single group call when
   they said all of them.
2. `except` holds named people back, resolved like any other name; a name
   that misses refuses the change instead of being ignored.
3. `undo_master_sheet_change` takes `batch`: one mass edit undoes as one
   act, across every field it set.
4. **`TIMEZONE`**: the month is the business's, not UTC's. On Pacific time
   the last seven hours of every month read as the next one.
5. The conversation drawer opens on every reply, so a panel is never left
   below the fold of the inline strip.
6. `delete_master_sheet_row` names its row before deleting; `add_deal`
   answers "already on that company" instead of a constraint violation.
7. Combined totals: naming two people no longer answers for one, and the
   percentages behind an add on are reported.
8. The export session is answerable from beside the input, with the
   tracker in the drawer header and previews on the colours and shapes.
9. `scratchOnly.arm()`: a write test cannot touch a row outside ZZTEST.
10. A reset button in the conversation drawer: saves the transcript, then
    starts again. Takes a half built export with it.
11. TIMEZONE: no SQL asks what day it is any more. The Supabase pooler
    swallows the session zone, so the month is a bound parameter.
12. EVERY EXPORT WAS 500ing on an undeclared `preset`. Fixed and pinned
    by a route test that builds a real workbook.
13. The Save dialogue picks the folder, with one saver instead of three.
14. A revert takes no id, narrows by group, and holds people back with
    except. The stale id was why a live revert failed.
15. A progress bar while a file builds, and while it saves.
16. Bulk edit reaches every shareable column; the rest refuse by name.
17. Recent changes render as a list past 12 rows, so she is no longer
    asked to read out 24,000 characters and summarise instead.
18. 518 API tests, 134 web tests.

**2026-08-29** Diane: the raw search retired, and loops caught.
1. `search_master_sheet` deleted. It listed candidates and never resolved,
   so answering its question re-ran the same search.
2. `filter_master_sheet` gained `company`, the one job only the raw search
   could do.
3. `notTwice` now catches NEARLY identical replies (0.878 loop against
   0.684 honest, threshold 0.8), and the retry tells her to act rather
   than rephrase.
4. Persona: sweet and gentle throughout, honey/dear/sweetheart, gentlest
   when she cannot help. Figures stay exact and unhedged.
5. 336 API tests, 77 web tests.

**2026-09-01** Five fixes from a live session. Two figures, three answers.
1. **SHE ANSWERED "1", THEN "10". THE TRUTH WAS 8.** There was no filter
   for a PAYMENT START in a future month: `presetWhen` is the month a row
   is FOR, a different column. So she improvised twice and differently, the
   second time with a "still running" filter that has nothing to do with
   the question. `paymentStartWhen: past | this-month | future` added, by
   MONTH, and named apart from the preset in the description and in her
   own words ("not starting until a later month" vs "marked for a later
   month"). Verified 8, and 8 again on re-asking.
2. **"Nexus" read as a missing person**, twice, with an offer to ADD it.
   NEXUS is a group with six rows; telling the boss his data is missing is
   the worst reply available. `notAPerson()` is one shared helper: groups
   and companies are closed lists off `filterOptions`, so it names what the
   word actually IS and forbids offering to add it. Typo tolerant, so
   "exus" reaches NEXUS. Wired into all four name lookups AND the filter's
   empty path, because that is where it actually happened: the group name
   went into free text and she reported the sheet as empty.
   **Guarded the other way too**: "Gloria" sits inside the company
   "Gloria - Workforce", so a typo now has to be a similar LENGTH, not a
   containment, or a real handler would be called a company.
3. **Crypto offered to a group with none.** The per-person fix did not
   cover the group branch, which returned the charge unconditionally.
4. **My own phrasing repaired.** "nothing from 1 row (X) nothing owed for
   that month" had no joining word.
5. Not a bug: the NEXUS preset update DID land. The screenshots were
   MILKMAN and MANBAT, correctly still August at the time.
6. 438 API tests, 108 web tests, green at +60 months.

**2026-09-01** A whole sheet change is a real request, and it SHOWS ITSELF.
The bulk cap was 60, which refused the one job done every month: rolling
every preset to the new month. "96 rows, too many" twice, for something
ordinary.
The old reason was sound and the fix was wrong. "A partial mass edit is
worse than none because nobody can tell which half ran" is true, so the
answer is to SHOW which half ran. Cap raised to 500, every row reports
itself as it writes, and a row that does NOT take is named rather than
averaged into a success count. All 96 presets rolled to 2026-09-01 in one
confirmed pass.

**2026-09-01** The card OFFERS the choices, and she stopped inventing them.
1. **She named breakdown designs that do not exist**: "none, simple,
   detailed, full". The real four are none, Standard, Converted to USD,
   Converted to USD + Add ons table. Third time this class has bitten,
   after the groups and the columns: nothing had ever given her the list.
   Designs, colours, groups and templates are all SERVED now.
2. **The palette was announced and never drawn.** She said "five colours on
   screen to choose from" and there were none.
3. **The card offers the OUTSTANDING STEP'S choices**, and only that step:
   group chips, designs with their real one line descriptions, colour
   swatches, delivery, columns. Every one sends the sentence they could
   have typed, so there is one path through the tool. It is not the form
   coming back: one question is on the table at a time.
4. **A floating pill brings the card back.** It sat in the transcript, so
   three replies later the only way to it was scrolling. The pill shows how
   far in, what is outstanding, and scrolls it into view. Only while a
   session is open and only once the card is off screen.
5. Both the pill and the conversation carry a live glow, and both stop
   under `prefers-reduced-motion`.
6. 418 API tests, 108 web tests.

**2026-09-01** The export asks WHICH GROUP. Picking people is gone.
1. **A capability removed on purpose.** She can no longer build a sheet from
   a hand picked set of names across groups. Two reasons:
   **THE AND TRAP.** `applyFilters` INTERSECTS group and personId, so
   "everyone in INDIGO plus Gloria from MILKMAN" matched nothing. One
   question, two ways to answer it, and one of those quietly handed over an
   empty file.
   **AND A WHOLE CLASS OF GUESSWORK.** Every name went through
   `resolvePerson`, which can refuse the export, ask which Gloria, or be
   handed a name she had shortened. A group is a closed list off
   `filterOptions`: picked, never resolved, never ambiguous.
2. `people` is KEPT on the tool purely so a named set is refused OUT LOUD,
   with the groups those people are in offered instead. Removing it left
   her improvising.
3. `resolveNames` deleted, `personIds` out of the draft and the query, the
   "N people only" chip off the card, step 2 renamed Groups.
4. **The export MODAL still filters by person** and always will: it is a
   form, so the AND is visible and an empty result is obviously the
   filter's doing. She points them there.
5. Verified live: "export the bank sheet for gloria and byron" refuses and
   asks which group; "indigo then" builds it.
6. 418 API tests, 105 web tests.

**2026-09-01** A port already in use is not a crash.
`EADDRINUSE` came out as an eleven line stack ending in "app crashed",
which reads as a bug in the code. It is nearly always the last dev server
still running. `server.js` now names the port, the likely cause and the
command to find the process. Every other listen error still throws.

**2026-09-01** The export is a STEP FLOW, and two hallucinations behind it.
1. **THE SUITE BROKE AT MIDNIGHT** and nothing had changed. Thirteen tests
   pinned to August, and `countsTowardTotal` fell back to the month we are
   in NOW. Underneath was a real bug: `buildMasterSheetWorkbook` took a
   `month` option and IGNORED it, so a workbook built for August in
   September judged its own totals against September. Production masked it
   because rolled rows carry `for_this_month`.
   Fixed, and PROVED: `npm run test:drift` reruns everything at +1, +5,
   +12, +25 and +60 months. It would have failed again on 1 October.
2. **"Gloria difference" gave Gloria's four deals.** Two faults. The
   resolver compared byte for byte, so `gloria-difference` and
   `gloria - diference` were misses; it now folds punctuation and forgives
   a typo on a long name, and a typo landing on TWO people still asks.
   But she never sent the full name: `difference` reads as the English
   word. So `resolvePerson` reads the admin's OWN sentence, injected by
   runAgent, and takes the longest name actually in it.
3. **She invented the group list** ("INDIGO, MILKMAN, V3"). The real ones
   now travel with the tool result.
4. **Told "carry on" she narrowed the sheet to INDIGO herself**, 21 rows
   to 9, unasked. A group must be in what they SAID or already on the
   card, or it is dropped and she has to say she dropped it.
5. **Step flow.** The tool derives which of the five steps is outstanding
   and names the ONE question to ask. The card draws a tracker; Build is
   disabled until every step is settled.
6. **An interruption parks it and says so**, appended in code: a reminder
   the model must remember is the one that goes missing.
7. Orb holds `building`, the conversation carries a travelling light, and
   an open card survives a reload (config only, figures refetched).
8. 420 API tests, 105 web tests, green at five future months.

**2026-08-31** THE WRITING TOOLS, tested on fake data. One reached a real row.
Two passes of `scenarios/capabilities-write*.txt` against ZZTEST, two
invented people, with a read-only fingerprint of all 96 real rows before
and after.

1. **UNDO REVERTED THE WRONG DEAL, and it was a real one.** Asked to undo
   the last change in the scratch group she passed a change id belonging
   to row 73, and PINO'S PRESET MOVED FROM AUGUST TO JULY: silently out of
   the August payout, with nothing on screen to say so. Restored to
   `2026-08-01`; the snapshot now matches the original exactly.
   **An id is the one argument she cannot sanity check**, so the admin
   does: `peekFieldChange` reads the change without touching it, and undo
   asks first, naming the PERSON, the GROUP, the field and both values.
2. **`rename_company`, `delete_person` and `delete_company` had no confirm
   step.** Their descriptions said "ALWAYS confirm first", which is not a
   guard: she asked, was never answered, then described the deals as
   already renamed. They now use `confirmFirst`, whose first call cannot
   change anything and says so, so there is nothing to misreport.
3. **`delete_company` was claimed and never called**, with a wrong count.
   The harness detector missed it because "deleted" was not in its list.
4. **`delete_person` crashed** on a row id passed as a person id. It now
   says that is what happened and deletes nothing.
5. **`add_deal` reports a zero it caused.** `payableDays` defaults to 0 by
   design, so a new deal owes nothing; she reported "owed GBP 0" flatly
   and an admin reads that as the add having failed. It now has to say why.
6. Passed unchanged: `add_deal`, `update_master_sheet_row`, `update_person`,
   `update_company`, `delete_master_sheet_row`, and `bulk_update` which was
   correctly scoped to the three scratch rows.
7. 402 API tests, 107 web tests.

**2026-08-31** Pause and cancel were BUTTONS ONLY, so she pretended.
Found by running `scenarios/export-pause.txt` against the real model.
1. "Hold on, park that" reached no tool: she answered "the sheet is paused
   and waiting for you" and the panel sat there open. "Forget it, drop the
   export" said cancelled and it was not. Same fault as claiming to
   uncheck a column, in a place nobody had looked.
2. `export_sheet` gained `pause` and `cancel`. They SHORT CIRCUIT: neither
   recounts, neither rebuilds, and both refuse when no panel is open.
   PAUSE KEEPS, CANCEL DROPS, and she must not guess between them.
3. **ADDING THE ARGUMENTS WAS NOT ENOUGH, AND NEITHER WAS THE PROMPT.**
   Pause reads to the model as a conversational acknowledgement rather
   than an act, and it claimed both again. `runAgent` now checks: the
   ADMIN asked for a panel act, a panel is open, no export tool ran, so
   retry once. It fired both times and both then worked.
4. Resume needed nothing: a normal call finds the paused panel and brings
   it back with its hidden columns intact.
5. Two harness faults of my own. It read `card.title` where the field is
   `name`, and the placeholder lines then tripped the repeat check into
   four flags that never happened. Its claim detector also flagged "the
   panel is closed now", which is her reading the transcript and is
   correct: an ACT she performed is the fault, a STATE she reports is not.
6. 399 API tests, 107 web tests.

**2026-08-31** SHE CAN SEE AND CHANGE HER OWN PANEL. Four faults, one cause.
From a live transcript. Every one of these came from the panel being client
state the server never saw.
1. **She said she had unchecked three columns and called NO TOOL.** She
   could not: `columns` was an INCLUDE list, so hiding three meant naming
   the other twenty three, which she had never fetched. The draft now
   carries `hiddenColumns` and `columns` is DERIVED from it, mirrored on
   both sides. `hideColumns` / `showColumns` take the words a human says
   ("door number") and match them against that template's own list.
2. **"Go export it", three times, and she just described the panel back.**
   Building was a button she could not press. `build: true` ends the
   session and the browser downloads.
3. **"Bank sheet for Nexus" was read as a COMPANY** and refused as
   non-existent while NEXUS sat there as a group. Corrected in code, and
   she has to SAY she corrected it. Left alone when the name is a real
   company.
4. **The open panel travels with every call**, injected by `runAgent` from
   the transcript, never a model parameter. The client keeps that entry in
   step with the screen, so what she reads is what they see.
5. **A hang, not a failure.** The new group check called an unstubbed
   `peopleRepo.filterOptions()` and the suite reached for a real Postgres
   and sat there. Stubbed.
6. 395 API tests, 107 web tests.

**2026-08-30** The export panel's three gaps, and a bug behind them.
1. **The warnings rendered BLANK.** Her panel was written against guessed
   field names (`title`, `message`, `rowIds`); the server emits `text`,
   `group`, `severity`, `kind`, `ids`, `count`. Now a CONTRACT with a test
   each side, and each asserts the guessed names are not real so the pair
   cannot pass vacuously.
2. **Scope is visible and editable.** A panel filtered to two people looked
   identical to one covering everybody, and a wrong month had to be fixed
   by saying so out loud. Month, group and per person chips, plus a tap to
   clear method, currency, status, company or needs-a-check.
   The tool sends each person's NAME with their id: an id is not something
   anybody can recognise, let alone decide about. The name never enters the
   query, which narrows on id as it always has.
3. **The sample is limited server side.** `/export/rows` takes `?limit=`
   and still reports the TRUE total, so a sample can never read as the
   whole file. It was pulling all 96 rows to show three, on every tick.
4. **Dates read like the file.** Detected by VALUE, not by column name: the
   columns payload carries no type, and a list of date keys in the panel is
   exactly the hardcoding its contract test bans.
5. 386 API tests, 104 web tests.

**2026-08-30** Diane exports. She builds the sheet with you.
1. **She produces the LINK, never the file.** `/export/xlsx` is a GET whose
   whole input is the query string, so there is no storage, no expiry and
   no cleanup, and her file is the modal's file.
2. **`masterSheet/exportQuery.js`**: the presets, filters, month and count
   lifted out of `export.js`, which was their only reader. All three export
   routes now go through `rowsFor` / `previewExport`, and so does she.
   `/export/count` went from thirty lines to one.
3. **Her UI is hers, the backend is shared.** `ExportSession.jsx` shares no
   component with the modal. One rule holds them apart, and it is a test:
   the panel may draw anything, it may not KNOW anything. No template,
   column, design, colour or default is written into it.
4. **It opens a panel, it builds nothing.** Six defaults were chosen for
   them and they have seen none, so the panel is the answer to "give me a
   sheet". Sample is three REAL rows and redraws as you tick.
5. **A real bug the tests caught: two method filters cancelled out.** The
   bank template derives the bank preset, so "the crypto sheet" matched
   nothing. An explicit method now wins and the preset steps back.
6. Guards: an unresolvable name refuses the WHOLE export, nothing matching
   is a stop with a reason rather than an empty file, the month is never
   carried forward silently, required columns are locked, and the link
   carries the exact query that was counted.
7. **A fifth orb mode, `building`**, held through her silences. It is the
   one time she is building rather than answering.
8. `resolvePerson` moved to its own file; its guard test now also asserts
   the 2,600 line tools file has no second copy.
9. 382 API tests, 100 web tests.

**2026-08-30** Not started is not ended, and three fixes around it.
1. **A third payment period state.** A payment start after the month said
   `ended`, so a deal that had not begun read as one that was over. Every
   Ended badge on page one of the live sheet was one of these: eleven rows
   starting in October or November, not one with an end date. With the end
   date setting off, `ended` could ONLY ever have meant "not started".
2. **The money did not move.** `isOwedThisMonth` excludes both alike and
   still does. This splits the WORD, never the arithmetic, and the test
   asserts red still maps to exactly "not active" for every combination.
3. `isPeriodEnded` counts `not_started` as out of period, or eleven future
   deals would have gone live in the Active company list.
4. `payStatusSql` gained the same third state: somebody whose only deals
   start in November has not finished, they have not begun.
5. Labelled everywhere it is printed as text: Diane's card, the exported
   sheet, both PDF templates. A cell reading `not_started` is a variable
   name in a document somebody sends out.
6. Four pages held their own copy of the active/ended option pair and one
   rendered the labels lowercase. One `PERIOD_EDIT_OPTIONS` now, plus
   `PERIOD_FILTER_OPTIONS` which is the only one carrying the third state:
   a human SETS active or ended, never "not yet".
7. **People page Pay column removed.** `pay_status` was exactly
   `active_count > 0`, so it restated the column to its left. Companies
   Status stays: it is the Close button, and nothing else carries it.
8. **No character cap on what she reads.** 700 was the last of three (220,
   then 700). A cap on speech is invisible: the full text is on screen, so
   nothing shows the ear got less than the eye. Structure still decides,
   a list is for the eye, but prose is read whole however long. Longer than
   the provider's 4096 is SPLIT at sentence ends and queued, never trimmed;
   the server's silent 2000 slice is gone.
9. **She stopped reprinting a list to confirm it.** "Are you sure that's
   30?" redrew all thirty rows. `notTwice.list.js` compares against the
   `[listed N deals: …]` line the client already writes to history, and
   tells her to answer in one sentence. Re-running the tool stays right.
10. **Bank details nobody has** are one sentence, not seven cards. She drew
    the lot for three people and then said none of them had any.
11. 363 API tests, 85 web tests.

**2026-08-30** The crypto charge, only where it applies.
1. `check_rates` appended the crypto line to EVERY answer, so she raised it
   on a person paid entirely in cash. Told to stop she agreed and did it
   again next turn, because the tool handed it back each time. Prompting is
   not a guard, and neither is her word.
2. Now it goes in only when a deal is actually paid in coin, and says
   outright not to mention it otherwise. Off a failed search too.
3. `CompaniesPage` printed `{company.status}` raw, so the badge read
   lowercase "active" while every other page said "Active". It uses
   `StatusBadge` now, table and card.
4. `people.repo.js` hand copied `payStatusSql`'s CASE in `findOne`. It
   calls the helper, same SQL, one definition.
5. 348 API tests, 77 web tests.

**2026-08-29** Diane: sweet and flirty, and no longer a reflex.
1. **The reflex was the bug.** She opened every reply with "Awww",
   greetings included. Warmth was never the problem; sameness was. The
   rules are now about VARIETY: never open two replies alike, "Awww" only
   where earned, no sound at all on a greeting or a yes/no, pet names as a
   ROTATION (dear, sweetheart, lovely, sweetie, honey, darling).
2. Register: sweet, caring, flirty, excitable, anime-leaning. Flirting is
   fond and playful, explicitly never crude or suggestive.
3. Voice `nova`, the youngest and brightest. `instructions` steers delivery
   and NEVER timbre, so age and pitch are the voice you pick.
4. `prompts/voice.test.js`, 10 tests. What she is told to WRITE and what
   the voice is told to PLAY are one contract; either edited alone reads a
   sound out as a word. They pin wording, not behaviour.
5. Seeded copy is hers too and the model never sees it: greeting, working
   and error phrases in `AgentOverlay.jsx`, the two in `messages.js`.
6. Tool summaries left NEUTRAL on purpose. Tone belongs in the persona
   once, not repeated across eight tool strings where it becomes a tic.
7. Dead `OLD_VOICE` deleted, duplicate sound list folded into one.
8. 346 API tests, 77 web tests.

Detour, kept for the reason: an intermediate pass made her strong and a
little arrogant and it was reverted whole. Note what did NOT change back,
the anti-reflex rules, because they were the actual fault under both briefs.

**2026-08-29** Diane reads the whole message, however long.
1. The newest message is never trimmed and never dropped. It was cut at
   12,000 chars, so a 30,000 char paste lost 60% of itself silently.
2. Older messages keep the ceiling: one paste must not fill the window.
3. A reply still truncated after the 8,000 token retry now says so and
   carries `truncated: true`, instead of reading as a finished answer.
4. 326 API tests, 77 web tests.

**2026-08-29** Diane: custom totals, live conversion, the rate itself.
1. `total_master_sheet` takes `people: []` (several people, one sum) and
   `convertTo: USD` (live rate, source stated, unconvertible named).
2. New `exchange_rate` tool: six decimals, live or fallback, the AED peg.
3. `toUsd` lifted to `shared/toUsd.helper.js`, shared with the export.
4. `checkFigures` key list was stale (`totalWithFee`); add ons, crypto,
   the resolved total and the conversion now all count as known figures.
5. 319 API tests, 77 web tests.

**2026-08-29** "Gloria" matched "Gloria difference", forever.
1. `check_rates` had the ambiguity check WITHOUT the exact-name exit, so
   answering "Gloria" re-ran the same fuzzy search and asked again.
2. The exit was written out four times and the fourth copy had half of it.
   It is now one function, `resolvePerson`, used by every tool that takes
   a name: find_and_show_details, total_master_sheet, update_person,
   check_rates.
3. A test asserts the exact-match filter exists ONCE, so a fifth tool
   cannot repeat it.
4. NOT handed to the model to decide. She cannot guess, structurally, and
   a name is where guessing costs somebody else's money.
5. 308 API tests, 77 web tests.

**2026-08-29** Diane can read every rate, and send a card of what was asked.
1. `check_rates`: person rates, the effective rate per deal, and the
   crypto charge. Read only, and every line carries its direction.
2. `summarizeRow` and `DETAIL_FIELDS` carry both deal rates;
   `update_master_sheet_row` can set them, capped by the shared
   `MAX_PERCENT`.
3. `find_and_show_details` takes `show: bank | cash | expensing` and
   narrows the card to that payout sheet's columns. The sets are
   `buildPayoutSheet`'s `SEND`, exported rather than retyped. Crypto
   reuses `bank`. The name never drops; an unknown set shows the full card.
4. 13 new tests. 304 API, 77 web, clean build.

**2026-08-29** Crypto charges, set in Settings.
1. The boss's "1% fee" is an ADD ON in the CRM: fee means deduction.
2. Two legs, both from Settings, both compounding: turning money into
   coin, then sending the coin. Migration 048.
3. Replaces `CRYPTO_FEE_RATE`, a constant in withUsd.js. One rate as a
   constant was fine; two an exchange can renegotiate are config.
4. New Settings section, Global rates, with the arithmetic worked out
   under the two fields.
5. Person detail shows them READ ONLY, and only for somebody paid in
   crypto: it is a rate on a payment rail, not that person's terms.
6. `docs/diane.md` added, and CLAUDE.md now requires it be updated with
   every CRM feature.
7. 288 API tests, 75 web tests.

**2026-08-29** Active company list: ended is not the same as not started.
1. `rollToMonth` set `period_ended` from `!isOwedThisMonth`, which is false
   both when a period has finished AND when it has not begun.
2. INDIGO dropped Umbrella UK Holdings (starts Nov) and Churchill Knight
   (starts Oct), so his list had 17 rows and ours 12.
3. `period_ended` now means FINISHED only: the end date gated by the
   Settings toggle, or a hand-set status. Not-yet-started stays listed.
4. INDIGO now lands on 14, exactly his 16 distinct entries once CKU,
   CKAssociates and Umbrella Co UK fold into `SG, CKA, CKU, Umbrella co`.
5. No money moved: `countsTowardTotal` is untouched.
6. 280 API tests.

**2026-08-29** The Active company list ignored the end-date setting.
1. `rollToMonth` decided `period_ended` off `end_on` directly, so NEXUS's
   A J Rayson fell off the Active company list of the August sheet that
   pays it 1,000 on the same tab, with its payment start cells green.
2. It is the FOURTH consumer of `isOwedThisMonth` now, not a fourth copy.
   Colour, total, badge and this list are one predicate.
3. `applyMonth` in export.js is async so the Settings toggle reaches it.
4. A test pins that the list and the money agree at BOTH toggle states.
5. 274 API tests, 67 web tests.

**2026-08-29** Rates were not real time.
1. An add on or fee set on a person left the master sheet's stacking
   warning stale until a hard refresh.
2. `usePeople` invalidates the sheet, but only when a rate is in the patch.
3. `alsoInvalidate` now takes a function of the variables, so an email
   edit does not refetch the largest query there is.
4. The PATCH route broadcasts `master-sheet:changed` too, for every other
   tab. Both sides use `!== undefined`, since setting a rate to 0 is an edit.

**2026-08-29** Diane showed the wrong person's cards.
1. Asked for Gloria, she passed Zayn's ids from an earlier turn and
   narrated three strangers as Gloria's deals.
2. The tool warned in prose and returned the cards regardless. It now
   returns NO cards when the ids span several people.
3. Deliberate multi-person lookups are a second call with `severalPeople`.
4. The disambiguation now hands her the ids it just found and says never
   to reuse older ones.
5. Guard keyed on `person_id`, matching `find_and_show_details`.
6. 264 API tests.

**2026-08-29** Add ons and fees on the exported breakdown.
1. Rows are NAMED and RATED: `Gloria - 5% add on`, one per person per
   effective rate, replacing one aggregated `Fee` nobody could attribute.
2. New design `with-usd-table`, `Converted to USD + Add ons table`: the
   same pivot with the adjustments lifted out into `Add ons` and `Fees`
   blocks above the totals. It calls withUsd.write with one option, never
   a second copy of that layout.
3. Not a toggle. Shape is a choice in the design list, as
   breakdowns/index.js already argued for the old Include breakdown switch.
4. Fixed: withUsd's totals() read the gross line, so both USD designs
   printed an adjustment and then totalled without it. Now net.
5. Design ids pinned on BOTH sides as a contract, neither reading the
   other, so a design added without a preview fails twice.
6. 257 API tests, 62 web tests, clean build.

**2026-08-29** Add ons and fees, two rates in opposite directions.
1. `addon_percent` is ADDED, `fee_percent` is DEDUCTED after it.
2. Both on `tb_people` and `tb_mastersheet`, stacking, each cell warning
   when the other level is set.
3. One definition, `v1/shared/rates.helper.js`. Both are now inside every
   subtotal and grand total, which they were not before: the sheet printed
   a Fee row and totalled without it.
4. Migration 047 moved existing `fee_percent` values to `addon_percent`
   and zeroed the column, so a missed reader adds 0 rather than inverting
   a sign.
5. Workforce is off the Active company table in every group.
6. 248 API tests, 58 web tests, clean build. Migration 047 not yet run.

**2026-08-28** — Filters survive leaving the page. `hooks/useStickyState.js`
is a useState that remembers, in sessionStorage so it dies with the tab: a
filter is invisible state and localStorage would carry it to next week.
Master sheet, People, Companies and Flagged all use it, and every Clear
forgets as well as resets. The page number is deliberately not sticky, nor
are Flagged two dates. 227 API tests, 57 web tests.

**2026-08-28 (last)** — The upload diff decides per CELL, and the override
guard steps aside for it. A column anybody had ever typed into was dropped
from the diff entirely: never listed, never offered, never written, so the
invisible guard was removing the visible modal one job.

The hole underneath was granularity. The diff had a checkbox per ROW and a
column mask that applied to EVERY row, so rejecting one bad cell meant
losing the good ones beside it. Each changed field is a two-way choice now,
a tick each side, and a hand-edited field is marked with WHEN it was set and
WHAT it replaced. `respectOverrides` defaults to true; only the commit of a
reviewed upload passes false. 227 API tests, 46 web tests.

Found on the way: `claimedFieldEdits` was written and never exported, so
every upload died on "repo.claimedFieldEdits is not a function". A test now
checks every repo function the routes call is actually exported.

**2026-08-28 (last)** — The payment period IS the preset formula, not the end
date. `owedThisMonth` has three consumers now: the cell colour, the total and
the badge, so green or amber is Active and red is not, and the badge cannot
contradict the colour beside it.

It showed on NEXUS: six deals on one August preset read four Ended and two
Active purely because their end dates are appointment plus a year. All six
start before August, so all six are owed, and his own nexus august file has
no end dates on them at all. The end date takes part only through the
Settings toggle, which the SQL reads itself. 214 API tests, 45 web tests.

**2026-08-28 (latest)** — The payment period badge became optimistic: it is
derived in SQL, so the patch that copied only the edited column left it on
the server last answer and an edit read as not having taken.
`helpers/paymentPeriod.js` mirrors the rule for the browser. The override
popup was still comparing the end date with TODAY and is on the same mirror
now.

`active_companies` gives Diane a card per company with director, mid, tier
and old group, off the same helper the workbook prints. `DealCard` mapped
`card.switches` unguarded, so the first card without them took the overlay
down; guarded.

Chasing the badge turned up a wider fault: the cell edit patched only
`[master-sheet]`, so on the Person and Company pages NO inline edit was
optimistic. `useOptimisticUpdate` takes a LIST of key prefixes now and
`patchDeal` handles all three cache shapes. 212 API tests, 45 web tests.

Backlogged: a normalized `tb_expenses` table.

Backlogged: an AI identity setting, Diane / Baldy / Zetsu, each with its own
theme and voice.

**2026-08-28 (last)** — The payment period now ends against the ROW OWN
MONTH rather than against today. It compared the end date with CURRENT_DATE,
so A J Rayson read Ended on screen while being paid GBP 500 for 31 days of
August. `rollToMonth` had already decided this for the export and worked
around the SQL to do it, so the file and the screen disagreed about one deal.
A row with no preset keeps the old reading, having no month to judge against.

This is NOT the same question as what a month owes: a deal ending on the 26th
is ended for the next month and still paid in full for its own.

The upload diff tab "Company status" is now "Active Companies", after the
block in his own file that it reads. 204 API tests, 29 web tests.

**2026-08-28 (later)** — The master sheet export lost its title row and the
blank under it, so the headers are row 1 and the first deal row 2. The blank
was not decoration: it was the only thing stopping the title being read as
the header on re-upload, so both had to go together. The group comes from
the TAB NAME, verified by re-parsing a per-group file whose FILENAME names
no group and still landing all 40 rows in INDIGO. `HEADER_ROW` is one
constant now, because the repeated 3 is why it took four edits.

The person export pay box: the five facts saying how to pay somebody are a
bordered box with padding rather than loose rows running into the companies
below. One component, `templates/pdf/PayBox.jsx`, where both templates had
written the same five rows out. A value we do not hold says "not held"
instead of an em dash the house style forbids. 194 API tests, 29 web tests.

**2026-08-28** — Diane audited against the CRM's routes, and the four gaps
worth closing were closed.

`bulk_update_master_sheet`: one change over a filtered set, in TWO calls,
the first writing nothing. Takes a filter, never row ids. Refuses above 60
rows rather than doing the first sixty.

`explain_preset_rules`: why a figure is what it is, reading the CURRENT
end-date setting. She could total correctly and still not say why a row was
left out, because nothing told her the setting existed.

`list_concerns` and `undo_master_sheet_change`: both REACTIVE, answered when
asked and never offered. Her filter also gained currency, payment method and
the search-by-column dropdown, all three of which the page had and she did
not. Totals now add a person's fee percentage on top.

**The preset colour rule was verified against `master.xlsx` itself**: the
conditional formats were read out of the file and our implementation matched
on 78 of 78 dated rows.

`rename_company` and `update_company` followed: she could DELETE a company
and not fix one, and renaming is the Companies page own job. Renaming IS the
merge. She still cannot CREATE one, because a company exists only because a
deal names it.

`update_person` completes the pair: display name, email, notes and the fee
percentage. A profile name is NOT the sheet name, unlike a company rename
which rewrites every row, so her reply says which one happened.

`components/` has no loose files left: fifteen folders named for what a thing
IS, none for a page. 193 API tests, 29 web tests.

**2026-08-27 (latest)** — Diane reads a long day back in full. She reported
25 of 40 changed rows and wrote the dates as prose ("extended into March and
beyond in March and April of following years"), losing the only thing the
question was about.

Three faults, one symptom: a silent 25-row cap, a count taken from the
capped page rather than the query's own total, and a reply budget that
truncated the relay with NO retry. The retry only fired on an EMPTY reply,
so a reply cut off mid-list was handed over as if finished. It now fires on
`finish_reason: 'length'` whatever came back, `RETRY_MAX_TOKENS` is 8,000,
the tool reads 200 rows and reports the true total, and it says how many are
missing when it cuts.

Found on the way: `total_master_sheet` summed one page of 500 rows. The
sheet is 96 so it never bit, but a total computed over a page looks right
and is not, so past its limit it refuses and asks for a narrower question.

All writes became optimistic in the same pass (`useUpdatePerson`,
`useUpdateCompany`), with a `COLUMN_FOR` map per hook file because the API
is camelCase and the cache is snake_case. `useSetFeePercent` deleted: two
hooks for one PATCH.

And `find_and_show_details` counted ROWS where it should count PEOPLE, so
"show me all of Nicola details" came back "there are 4 Nicolas, which do you
mean?" for one Nicola on four companies.

And asked for Nicola August total she answered "owed nothing" off the cards,
where the tool computes 2,900. The arithmetic was never wrong and the prompt
already forbade every part of what she did, so the fix is structural:
`total_master_sheet` hands back the finished sentence, and
`agent/checkFigures.js` compares every figure in her reply against what the
tools returned, retrying once when one is unsupported. It never rewrites the
reply.

Then two conversation faults from the same transcript. `total_master_sheet`
asked which Gloria and answering "Gloria" re-ran the same fuzzy search, so the
question had no exit and repeated forever: it resolves on an exact match now,
the rule find_and_show_details always had. And she repeated her previous line
word for word when asked "are you sure?", so `agent/notTwice.js` catches a
verbatim repeat of her last turn and asks her to say it differently with every
figure unchanged. 152 API tests, 29 web tests.

**2026-08-27 (last)** — The Company status tab became an editable row list,
and `Old group` arrived. Every company the file lists now gets a row rather
than only the actionable ones; each row has a company picker on the left
(every company the CRM holds, near-misses first, typing allowed) and tier
plus old group on the right, both free text with suggestions.

Two of the assumptions behind the ask were wrong against his own files and
both are recorded in `state.md`: `indigo 1 august.xlsx` lists `Social work
partners PR` twice with two different tiers, so "one row per company" is not
true of the FILE; and `Old group` (`Milky`, `Wallaby 1`, `V3`) is his own
earlier naming, never one of our groups, so it is stored as its own free
text column and never matched against `group_name`.

Found on the way: `COMPANY_TIERS` was a closed set of two and the PATCH
route 400'd on anything else, while the upload's own writer validated
nothing. A tier the upload had just written could not be edited by hand. It
is a suggestion list now, served with the tiers actually in use.

Migration 044 adds `tb_companies.old_group`, editable on the company page,
in the Manage modal and filterable on Companies. 106 API tests, 24 web tests.

**Migration 045 undoes a data fault the old tab caused.** Its flagged row had
ONE "Pick one" dropdown, fed with near-matching COMPANY NAMES, whose onChange
wrote the TIER: answering "which company is this?" stored the name as the
kind. The tier picker was then offering `Umbrella company uk holdings`. The
row has two controls now and neither writes the other's column; 045 clears
any tier that exactly equals a company name we hold.

Also fixed: the Manage company modal had no Old group field and its Tier
picker was missing `allowCustom`, so a new tier could not be typed there
while the detail page allowed it.

**2026-08-27 (later)** — Upload preview fixed and the master sheet's search
aimed. `/upload/preview` destructured three of the parse's five fields and
used all five, so every upload died on `hasCompanyTable is not defined`.
Accepting ONLY the company statuses now works: Confirm was disabled on an
empty deal list and the commit route returned early on the same test before
writing the tiers, so the one path reported success having written nothing.

Search: a column picker beside the box, offering only what no filter
reaches (location, postcode, bank details, account number, sort code, notes,
door number). Allow-listed in the repo like `AMOUNT_COLUMNS`, unknown key
falls back to searching everything, and a web test reads the repo file to
fail on drift between the two lists.

Currency and method of payment became FILTERS in the same pass, which is
what the split turned up: closed sets of three or four, options derived from
the deals rather than hardcoded, both case folded. The upload diff's Company
status tab moved ahead of Similar deals: the first tabs are the upload's own
decisions and Similar deals is a reading, so appending the tab that writes
something after it put a decision behind a reference. 88 API tests, 24 web
tests.

**2026-08-27** — The totalling rule made one thing, in `shared/`.
`v1/shared/owedThisMonth.helper.js` is now the single definition of what a
month owes; the colour renders it and the total reads it, and neither reads
the other. Moved out of `buildWorkbook.js`, where a money question lived
inside an xlsx writer. `useEndDate` is an argument everywhere, no longer a
module-level `let` that one entry point set and the Division Sheet ignored.

Three readers had been missed when the end-date-direct exclusion was removed,
each disagreeing with the sheet beside it: `buildPayoutSheet.js` kept its own
copy, `templates/xlsx/payout.js` destructured `{ columns }` and threw the
setting away, and Diane totalled by `isPeriodEnded` and would have quoted a
figure 6,500 under MILKMAN's August. An excluded row is now marked on its
AMOUNT cell as well as Status, which the bank and expensing column sets do
not carry: those files had excluded rows with nothing marking them at all.

Also: `fee_percent` per person, set on their page under Profile,
optimistically, and ADDED to what the group sends us. `setFeePercent` was a
bare UPDATE that wrote nothing for a person with no `tb_people` row, so it is
folded into `upsert` and goes through the ordinary profile PATCH.
`components/` grouped into `buttons/`, `forms/` and `toasts/`. 73 API tests,
18 web tests, clean build.

**2026-08-25 (last)** — Copy centralised, in five steps.
`popups.config.js` (27 icon popups), `confirms.config.js` (10, after the six
hand-rolled `<Modal>` confirms became `ConfirmDialog`),
`api/v1/shared/messages.js` (server prose plus every message used twice), and
the toast pass: `useReportingMutation` lifted out of `useMasterSheet` so
People and Companies report from their own hooks, wording in
`helpers/toastMessage.js` under **18 tests, the first UI-side coverage in the
repo**. Call-site toasts went 39 to 17, every survivor a batch summary or a
case no hook can judge.

Found and fixed on the way, none of it the refactor's own doing: four
double-toasts (one action fired eight), "Their 1 deal stay", "the people on
them" for a single deal, a `parseIds` guard that turned `null` into row 0,
and a Settings card promising that uploads delete rows the CRM deliberately
keeps.

**2026-08-25 (later)** — Multi file export: a switch on every tab hands
over one xlsx per group in a zip instead of one tabbed workbook, shown only
when two or more groups (or none) are selected. `archiver` promoted from an
exceljs transitive dep to a declared one. Every group filter in the CRM now
says "All" rather than "All groups", which collided with the real group of
that name. Deleting from the upload diff is its own act: it
writes immediately via `bulk-delete` (`via='upload'`), re-reads the file so
all four tabs update, and no longer drags the upload's changes through with
it. The commit route's `deleteIds` path is gone rather than left as a second
way to delete. Diff tabs 3 and 4 swapped, so Different comes before Similar.
The export modal's month picker is removed: the run is always this month and
the tab names it, resolved at render. Groups and Columns now sit side by
side. Login gained a secret code step (migration 039, not yet run).

**2026-08-25** — Master sheet filters: preset month (this / future / old),
a reusable `NumberRangeFilter` on monthly amount, payable amount and payable
days, and the source dropdown replaced by clickable counts. Upload diff
gained a fourth tab and CRM-side names (Similar / Different deals), an
editable incoming value with Apply to all, multi-select "Apply only", and
deletion from either delete tab. Ended rows tint their Status cell on the
payout sheets. Phone search matches UK-format numbers. Fixed a CSS
specificity regression that put the login icons on their own placeholders.
Restored `.claude/CLAUDE.md`.

**2026-08-24** — Preset ownership: the CRM never rewrites it, on upload or
export, and a total counts only rows marked for that month. Ended is decided
against the month generated rather than today. Reverted the `FULL` misreading
(migration 038); prose in the payment start column now falls back to the
column's own formula, appointment + 90. Payout sheets gained "Should be paid
or not" on all three with a `no` excluded from the total, a column picker with
the old fixed shapes as defaults, and account number and sort code on Bank.
Group tabs are laid out one company at a time. Multi-currency breakdowns read
currency, method, that currency's total. Every export names its own document.
Deletion from the upload diff's third tab. Export warnings panel with in-place
fixes. Row count in the toolbar.

**2026-08-23** — Two-step upload (preview then commit), so nothing writes
before the diff is accepted. An upload deletes nothing.

**2026-08-22** — People's export and the Master Sheet's split into two
documents. Payment period replaced the deal "status".
