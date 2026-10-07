# Backlog

Designed and deliberately NOT started, and it MIGHT NOT BE. What is
intended to be built lives in `feature.md`. Move an item to `todo.md` when
it is picked up, and delete it from here once it ships: what the system IS
lives in `state.md`, not in this file.

Each entry: what it is, why it is parked, what unblocks it. Ordered by what
matters, not by when it was written.

**Numbers are stable identifiers, so 0 to 5 are missing rather than
renumbered.** They moved to `feature.md` on 2026-09-14 keeping their
numbers, because `closure.md`, `deployment.md`, `sec-audit.md` and
migration 049 cite them.

---

## 6. Rolling the presets to the new month, on a pipeline

Every month the whole sheet's preset moves to the 1st. Today a human asks
Diane, group by group. It is the same act every month, so it should not be a
conversation.

- **THE PRESET IS HIS.** A pipeline that moves it every month IS the CRM
  rewriting his marker, so **this needs his word before it is built.**
- A row he set by hand is not rolled: the roll skips a claimed `preset_on`
  exactly as an upload does.
- **Only roll rows on LAST month.** Two MILKMAN rows sit on `2024-09-01`; a
  blanket roll would quietly repair a row somebody should be looking at.
- Logged `changed_via='pipeline'`, and it says how many rolled, how many
  skipped and why.

**Nothing technical blocks it.** `bulk_update_master_sheet` already does the
write. The decision is his: does the sheet roll itself, or does he say when.

## 7. Releasing a cell back to the formula

**Parked 2026-09-08.** `manually_overridden_fields` is APPEND ONLY for
anything a human types: no `array_remove`, no clear route, no button. Edit a
monthly amount once and it is protected from every future upload for the
life of the row, with no way back.

Two of the three original faults are fixed: the appointment cascade uses its
own guard rather than this array, and a derived value no longer claims its
column. What is left is the human's own typed values.

**The claim is INVISIBLE.** Only `status` is surfaced. Every other claimed
column looks ordinary, so nobody knows a row stopped following the sheet.

Two halves, and the second is harder: **release** is one repo function;
**showing the claim** is the real work, because releasing something
invisible is not a feature.

**Decide first:** does release recompute or just unlock; is a claim per
column or per row; and does Diane get it (she can claim one and cannot say
so).

## 8. Group managers on the Cash sheet

He asked for each group's manager named. **Groups have no storage at all**:
first class in the UI and in whatbot's scoping, but only text on
`tb_mastersheet.group_name`. Needs `tb_groups`, which item 4's "own group"
scoping probably needs anyway.

## 9. Diane loses CREATE. Read, update and delete only

**Parked 2026-09-08, user's call. Decided, not yet done.** She keeps READ,
UPDATE and DELETE on the sheet, loses ADD entirely, and the Add deal form
goes with it. After this she can change and remove what exists and cannot
bring anything new into being.

**The stated reasoning was lost** when this entry was written; only the
decision survived. Worth re-confirming the why before building.

## 10. A table of its own for expenses

Money going OUT that is not a payout. Nowhere to put it today.

## 11. A History page, with Recover on every row

Every in, out and edit on the master sheet, each row recoverable. Parked
because the recovery rule is easy to get wrong: recovering a row whose
person or company has since gone, or whose sync key now belongs to another
deal, is how a delete becomes a duplicate.

## 12. Rolling xlsx backup, every 5 minutes

**Survival of the CRM, not version history.** If it is down he opens the
latest file in Excel and carries on, so the file must be a real working
sheet rather than a dump.

## 13. Diane: what is actually still open

Recall and forecasting are otherwise done. **The current month comes first**
(his words, 2026-09-07): no further recall or forecast work starts until
this month is right.

- **No ceiling on how far she projects** through `compare_months` (36 today),
  and a projection never says what it EXCLUDES: no new deals, no unrecorded
  ends, no rate change.
- **Money loses its pence** in `amountText` (`AED 54,342.5`). It formats
  money AND percentages and feeds `checkFigures`; read that guard first.
- **The month on month percentage is rounded twice**, hers to two decimals
  and the CRM's `trendPercentText` to one. A cross boundary contract, so it
  is written twice and pinned each side.

**The ceiling is not engineering.** `projectMonth` is a RUN RATE. A trend or
a confidence range needs history to fit to and there is one saved snapshot.
You cannot fit a line to one point. Build nothing that claims to predict
until the scheduler has accrued more.

## 14. Compacting Diane's memory when it goes out of date

Ten summaries about one person, nine describing reversed decisions, makes
search worse every month. **The reason is recall quality, not space.**

**MARK, DO NOT DELETE.** A `superseded_by` column excluded from search by
default. "Superseded" is a judgement and the thing being judged is evidence;
two summaries can both be true, and the older half is often what explains
the newer. `tb_mastersheet_changes` is the one tiebreaker that is not a
guess: if a summary describes a value the change log shows was later edited,
that is evidence rather than opinion.

**Parked because nothing needs it yet** at forty conversations a month.

## 15. Where the dashboard's filters live

**Parked 2026-09-06.** The filter panel sits at PAGE level, which reads as
though it scopes the whole page. It does not: the two range controls move
only Payment Overview and Group Comparison, while Groups and Payment method
move everything.

Three shapes, undecided: ranges into the card and the other two stay at page
level (two filter homes); everything into the card (page filtering goes); or
ranges into BOTH cards that use them (most honest, most work, two ranges can
then disagree).

**Related, same refactor:** the four cards, Monthly Comparison and Deals by
Stage report the CURRENT MONTH only, so a range filter looks inert on most
of the page. Scope and placement are one job.

## 16. Diane's draft is shown as final before the guards have judged it

**Parked 2026-09-06, his words: "i dont understand this, put it in backlog
for now."** Nothing is wrong with her figures; it is about what the screen
shows before the guards have finished.

## 17. The Company status tab does two jobs, and only one was asked for

The fifth upload tab is meant to be **tiers**: the file says `Top Co`, we
hold `T2`, accept and it changes. That is the 11 of 16 case. It also carries
active/closed, which nobody asked for and which is the Close button's job.

## 29. Unwire the end date from the tint

Closure is built, so the end date no longer needs a vote in what a month
owes. The Settings toggle `color_uses_end_date` goes, and with it the end
date's part in the colour, the total and the active/ended badge. The column
itself stays: stored, editable, exported, read by the import diff.

**The whole plan is `unwire-end-date.md`**: 32 source files, 34 test files,
and the two answers it needs first (what happens to saved snapshots, and
whether the End date column still appears in exports).

## 18. A "Show fees" toggle on the export

Two states, and the difference is what is PRINTED, never what is counted.
Both rates are inside every subtotal either way.

## 19. A DRIVER SHEET

Asked for by name alongside bank, cash and expensing. **Nothing in the sheet
identifies a driver**: the twenty roles do not include one, so the export tab
is disabled. Ask how a driver reaches the sheet at all.

## 20. Money received in

A group paying its collected total back into the business, the reverse of
payroll. Built once as group level and **pulled back out** rather than ship
the wrong granularity. **Open: per group or per company.**

## 21. 12-month forward mapping

A person's earnings across the next twelve months. Parked because the sheet
gives this month's figure only, so months 2 to 12 would be the first real
forecast. Same ceiling as item 13.

## 22. "We need to export" costs two turns before the panel opens

A live run: "we need to export" gets a question, "yeah I want the bank
sheet" gets another, and only the third turn opens the panel.

## 23. Document upload, and the offline round trip

Two related asks, neither started:

- Hand her a scan or a contract and have her apply what it implies. Open
  whether the model accepts image or PDF input at all.
- She exports a slice, he edits it in Excel, she applies it back. The export
  half exists; the re-import and diff do not.

## 24. Pick who the assistant IS, and how she sounds

One setting changing the name, the voice and the colour scheme together, so
it feels like a different assistant rather than the same one renamed.

**The voice ceiling is a vendor limit.** She reads in `nova` with
instructions directing the delivery; OpenAI's eleven voices are all adult
and none is the anime register that was asked for. Anything closer means a
different provider or a local model, which is a real dependency rather than
a setting.

Also open: **colour theme in Settings** for the orb, command centre, login
and loading screens. All currently green.

## 25. Small, and none of it blocking

1. **PDF layouts for the payout sheets.** Disabled on every export mode:
   `templateFor` falls back to the breakdown layout, which is the wrong
   shape.
2. **A period picker on People.** Payment status is always "this month". His
   call: month granularity, never an arbitrary range.
3. **The group name above the breakdown block**, with a blank row either
   side.
4. **"Remember me": hidden, not deleted** (`SHOW_REMEMBER` in
   `LoginForm.jsx`). It was component state that went nowhere. Bringing it
   back means deciding the session cookie's `maxAge`, currently 12 hours for
   everyone.
5. **Add person and Add company: hidden, not deleted.** Both wizards work.
   Neither a person nor a company is a row of its own, so both ended in
   creating deals, which Add deal does directly. Open: one door or none.
6. **Mobile beyond cards.** The Chat page's two pane layout does not
   collapse; inline tap targets are small.
7. **Page level field captions.** Detail pages use `<Field>` captions where
   modals use floating labels. Deliberate; revisit only if the two look
   inconsistent side by side.
8. **Remove the Chat page properly** rather than leaving it hidden, and
   clean up the socket layer with it.
9. **Partial payday answers.** A payday check is all or nothing per person
   per group, so one problem flags all four of somebody's companies.
10. **Self service dispute**, and later self correction: whatbot recognising
    "my payment is wrong" outside the yes/no menu.

## 26. SQLite instead of Postgres

**It would work.** 96 rows and one to three admins: volume was never the
reason. Every write funnels through `v1/repos/`. Parked as a real option to
weigh against item 3, not as a plan.

## 28. `tb_expenses.archived_at` is a column nothing writes

Archive and Restore were built on 2026-09-14 and taken back out the same
day, when expenses became ONE MONTH AT A TIME: a month ends, it does not
get tidied. The column survived because dropping it is a migration and the
burn in `feature.md` item 0 may want somewhere to mark a closed month.

**Hidden from the UI already.** No filter, no button, no hook, and the repo
does not read it.

**Decide it with the burn, not before.** If the burn deletes rows, as
`burnMonth` does for the master sheet, this column has no job and goes in
the same migration. If it marks them instead, it is already there.

Nothing is at risk either way: a nullable column nothing writes costs one
`IS NULL` nobody runs.

## 30. Stage 4: retire Diane's old one-off patches

`runAgent.js` still carries guards written for single incidents that the
plan engine, the router and the code-first edit reader (`directEdit.js`)
now handle. Removing them would tidy the code and make turns slightly
faster. Nothing new for the admin.

**Parked because it is risky (2026-10-07).** The file is very large and
some patches guard rare cases the free tests may not cover, so removing one
could quietly bring an old bug back. The benefit is small.

**What unblocks it, the safe way:** log which old patches are still reached,
let Diane run normally for a week or two, then remove only the ones never
hit, one at a time, with the free suite after each and a test on the clone.

## Settled NO. Closed, not deferred

Do not list these as open or unverified again.

- **`read_dashboard`.** Cancelled. The drift it was for is fixed, the one
  question only it could answer needs client filter state it would not have,
  and a twenty-first tool worsens the tool selection faults it was meant to
  help.
- **RANKING.** "Who earned the most this month" is not a request she should
  answer. `checkQuestion` exists to make her DECLINE it, never to become a
  ranking feature. The answer is "I cannot", not a better figure.
- **The export warnings panel stays in the Export modal only.** Decided
  2026-09-08. A page level mount would print "rows affect this total" on a
  page with no total, and the panel's other kinds are export scoped. The
  date suggestions are one click behind Export.
