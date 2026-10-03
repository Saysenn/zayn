# Ending a deal, reviewing it, and closing a company

Designed 2026-09-11. **ALL THREE PHASES SHIPPED**, 1b, 2 and 3 on
2026-09-16, and Diane's half on 2026-09-17. Written to be deleted section by
section as each part ships; what is left here is the reasoning, which
`state.md` points back to. `feature.md` entry 1 points here.

**The drill is what makes it true, not the unit tests.** Every test here is
deliberately DB free, so `scripts/closureDrill.js` is the only thing that
touches the CHECK constraints, the pair constraint, the generated queue and
the company cascade. Last full run 2026-09-16, 47/47. **It has not been run
since the 2026-09-17 changes** (Diane's tools, the bulk close, the bulk
reopen), so those are unit tested and not yet database tested.

The brief came from the boss on 2026-09-10 and again on 2026-09-11. His
words are quoted where they decide something, because half of this plan is
an argument about what he actually said.

---

## 1. Why this exists: nothing has ever ended a deal

All verified, and together they are the whole reason.

| Fact | Where |
|---|---|
| His sheet CANNOT end a deal. Column I returns 0 only for "payment has not started". There is no branch for finished | `docs/boss/references/master.xlsx` |
| The end date column is written by 73 formulas and read by ZERO. It is a leaf | same file |
| His own doc calls it "provisional as sometimes job finish early and or they last longer" | `shared/fromAppointment.helper.js` |
| The CRM's `ended` is unreachable: `color_uses_end_date` defaults false, so the end date branch never fires | migration 042 |
| `tb_companies.status` is a list filter and a display field. It enters no money rule | `repos/companies.repo.js` |

**So every deal ever opened still counts, forever.** Totals only grow. The
Close button changes no figure.

---

## 2. The rule

> A deal ends because something or someone SAID SO, with a date.
> Never because a formula worked out that a year had passed.

**THE END DATE IS NOT A RULE AND NOT DECORATION. IT IS A TRIGGER FOR A
QUESTION.** That is his correction, 2026-09-11, and it is better than what
this document said first:

| | What the end date does |
|---|---|
| Considered | ends the deal automatically. Wrong, he keeps paying past it |
| Considered | nothing at all. Wrong, then nothing ever prompts |
| **Decided** | **raises a question a human answers, every month** |

His case: AJ Rayson passed its year and is now reviewed monthly.

> "is AJR still ongoing payment for this month? Then we can reply with yes,
> no or yes but it is the final payment."

---

## 3. Three phases, named by what you can do after each

| Phase | After it, you can | State |
|---|---|---|
| **1a** | end one deal by hand | **SHIPPED 2026-09-16** |
| **1b** | the Archive page and the Stop button | **SHIPPED 2026-09-16** |
| **2** | be asked every month, and have Diane answer in bulk | **SHIPPED 2026-09-16** |
| **3** | put a company into liquidation, then close or dissolve it | **SHIPPED 2026-09-16** |

**NOTHING CHANGES THE MONEY RULE.** `owedThisMonth` stays a boolean
throughout. An earlier draft had phase 3 widening it to a factor; his own
description of liquidation killed that, see section 6.

### Run against Postgres, 2026-09-16. 47/47.

`scripts/closureDrill.js`, on four fake ZZTEST deals across two fake
companies. Every unit test here is deliberately DB free (the pool is
stubbed, the SQL is read as text), so the drill is the only thing that
touches the CHECK constraints, the pair constraint, the generated queue and
the company cascade.

**What the drill found, and none of it was in the code:**

| Found | Was |
|---|---|
| `role` is NOT NULL and the drill never set it | the drill's fault, now through `parseRole` |
| `changed_via` is a closed set and `'drill'` is not in it | the drill's fault |
| It read 7 rows where it seeded 4, and resumed a deal it had not closed | **not isolated.** An earlier run's rows joined every group scoped count. It clears ZZTEST first now |
| "a stop today is out of the month" went red | **the drill was wrong.** A stop on the 16th was paid to the 16th, so the month IS owed and the cell is amber. Only a stop before the month drops it |
| "the closure's reason" read `review_final` | **the drill picked by position.** The Archive is newest first, and a review's final month is dated the month END while a closure is dated today. It finds by reason now, and pins that a review stop KEEPS its own reason through a closure |

### What was found while building it, 2026-09-16

| Found | Fixed |
|---|---|
| `resolvePerson` hands back the WHOLE list when a name matches nobody, flagged `matched: false`. These tools pass it a QUEUE, not a fuzzy search, so "mark Nathan no" came back "Nathan matches 2 different people: Gloria; Paddy" | `narrowToPerson` narrows the pool BEFORE the resolver sees it, the same reach test the resolver uses |
| `scratchOnly` never guarded **`updateMany`**, a bulk write Diane reaches directly. The guard written after a bulk update hit three real INDIGO rows did not cover the other bulk update | Guarded, plus a test that reads the real `WRITES` list so the next write cannot be forgotten |
| `stop` threw synchronously, so a bad reason escaped a caller's `.catch` | `async`, so it rejects like every other failure |
| `Number(null)` is `0` and `Number.isInteger(0)` is true, so a null in `stopMany` became an UPDATE against id 0 | `id > 0` |
| `useOptimisticUpdate` said "Couldn't update X" on a failed DELETE | `failVerb`, which fixes the delete wording too |

### What TALKING TO HER found, 2026-09-16

Three randomised conversations against the real model,
`scripts/randomReviewScenario.js`. Every one of these was already a rule in
the prompt and she did it anyway, which is the whole of why
**PROMPTING IS NOT A GUARD**.

| She did | Now |
|---|---|
| "Alex is still going, mark it yes" reached the BULK tool, previewing FOUR deals. A yes to a sentence about one person would have answered four | `bulk_answer_monthly_review` REFUSES a single named person with one deal and names the other tool. The mirror of the single tool refusing two |
| The queue printed 36 lines against the real sheet and she relayed every one | Capped at 12, and **the cut says it cut**. The total and the money stay true, and `dealIds` is never cut |
| Asked when "final" would stop somebody, she answered **"the end of August" in SEPTEMBER**, with no tool call | The queue states BOTH dates every time it runs, off the server's clock. There was no tool that could answer it, so she answered from memory |
| "Deleting a deal wipes out all its records" | Prompt: stopping keeps the row, REMOVE is the word, and neither erases the change log |
| "X is not up for review" with no tool call | Prompt, and `dianeChat`'s audit now catches review claims that do not happen to say "deal" |

---

## 4. Phase 1: end one deal by hand

### Data

```
tb_mastersheet  stopped_on      date     migration 056
                stopped_reason  text
```

The next number is 056: 055 is `tb_expenses`, 2026-09-14.

**`stopped_reason` IS NOT DECORATION.** The Archive page has to say why each
row is there, and three different things stop a deal: a hand stop, a monthly
review answered No or Final, and a company being dissolved. Only the second
leaves a row in the review table, so deriving the reason would leave the
other two blank on the one page whose whole job is explaining them.

A closed set, one const at the head of the repo file:
`stopped_by_hand`, `review_no`, `review_final`, `company_closed`.

### Changes

### THE END DATE STAYS. His call, 2026-09-16.

An earlier draft had a phase 1c: delete the `end_on` branch, drop
`color_uses_end_date`, and take `useEndDate` out of all **39 files**.
**That is struck.** Nothing about the end date changed and nothing will.

```
end_on       counts ONLY when color_uses_end_date is on   his provisional formula
stopped_on   counts ALWAYS                                somebody said it is over
```

**They are different kinds of thing and the difference is the point.**
`end_on` is the sheet's guess, appointment plus a year, and his own doc
calls it "provisional as sometimes job finish early and or they last
longer". It raises a question. `stopped_on` answers one.

A test pins the contrast: if the two ever start behaving alike, one of them
has lost its meaning and it goes red.

### What 1a actually changed, 2026-09-16

1. `stopped_on` excludes a deal **from the month after the stop**, and the
   month it stops IN is amber, a part month, exactly as an end date would
   be. `endsWithinMonth` was not reused; `stopsWithinMonth` sits beside it.
2. **NOT behind `useEndDate`.** The plan originally said "reads
   `stopped_on` where it read `end_on`", which would have put the stop
   behind a setting that defaults FALSE: a deal answered "stop paying"
   would have carried on being paid.
3. All three consumers together, the colour, the total and the SQL badge.
   Breaking the rule turns **four tests red across all three**, which is
   also the proof they are still one condition.
4. The settings toggle, its route and its preview table are all untouched.

### It overlaps `feature.md` item 6, and they must not blur

That item deletes a deal's person or company when the deleted row was their
last. It is a different act from Stop and the two have to stay different:

| | Subject | The row |
|---|---|---|
| **Stop** | one DEAL is over | **stays**, `stopped_on` set |
| **Delete** | a row that should not exist | **goes**, and may take a person or company with it |

**A finished deal is STOPPED, never deleted:** its history is payroll.

**So a stopped deal is not deletable by that cascade.** If Stop set
`stopped_on` and something later removed the row, the record of what was
paid would go with it. Whichever is built second inherits this rule.

### The Archive page

**Where the deals that truly ended go.** `/archive`, in the nav beside
Master sheet, because it is the same rows read a different way.

**A FILTER ON `stopped_on`, NEVER A COPIED ROW.** Copying makes two records
of one deal and they drift on the first edit. The page is a view of
`tb_mastersheet` exactly as People and Companies are, so nothing is mirrored
and nothing can fall out of step.

| | |
|---|---|
| Rows | `stopped_on IS NOT NULL`, newest stop first |
| Columns | the master sheet's, plus **Stopped on** and **Why** |
| Why | `stopped_reason` in words: by hand, answered No, final month, company closed |
| Filters | group, person, company, and a **date range on `stopped_on`**, all server side |
| Search | the master sheet's own field picker |
| Row action | **Resume**, and nothing else |

**Ended deals are OUT of every figure**, and the page says so: its total is
what these rows were worth when they stopped, labelled as history, never
added to a month.

**RESUME IS THE ONLY WRITE ON THIS PAGE.** No editing, no deleting. A
stopped row is a record of what was paid, and a page for reading history is
not a place to change it. To edit one, resume it and edit it on the master
sheet.

**Resume refuses on a deal stopped by its company being dissolved**
(`company_closed`) and says reopen the company instead. Two levels must not
disagree.

**It is not the master sheet with a filter on.** The master sheet shows what
is live; putting stopped rows behind one more filter there is how they get
looked at by accident. Separate page, separate question.

### Resume cannot rewrite history

Clearing the stop date brings the row back into the current month and
touches no past one: `tb_month_snapshots` keeps each month's rows as they
stood, figures stored rather than recomputed, read only forever
(migration 049).

---

## 5. Phase 2: the CRM asks you every month

The core of what he asked for. Past its term a deal stops being automatic.

### The record

```
deal_id | period  | answer
--------+---------+--------
 412    | 2027-01 | yes
 412    | 2027-02 | final
```

**PER MONTH, NOT A COLUMN ON THE DEAL.** The same deal is asked again next
month, so one column would overwrite January with February and lose the
history of a decision that moved money. `period` is the CRM's existing
`2026-08` convention.

### Two things put a deal in the queue, since 2026-09-17

His call. The end date passing was the only trigger, so a company wound
down in month 3 of a twelve month deal was never asked about.

| Reason | Rule |
|---|---|
| Past its term | `end_on < first of the period` |
| **Winding down** | **its company is `liquidation`, end date or not** |

**`OR`, NEVER `AND`.** The second narrows nothing: `AND` would have asked
about fewer deals than before, which is the opposite feature.

**BOTH SIT UNDER `stopped_on IS NULL`**, so neither can put a finished deal
back in front of somebody.

**EVERY ROW SAYS WHICH.** `liquidation` comes back on the row and the panel
badges it. A deal whose end date is months away is in the queue only
because its company is winding down, and unmarked that row reads as a
mistake. Diane says "company in liquidation, ends X" rather than "ended X",
which would claim a future date had passed.

### The three answers

| Answer | Writes | Button |
|---|---|---|
| Yes | the answer, nothing else | `primary` |
| Yes, final month | paid this month, `stopped_on` = end of this month | `warning` |
| No | `stopped_on` = end of last paid month | `danger` |

**"Yes, final month" is a SCHEDULED stop.** Neither a button nor a date
expresses that, which is why the feature is worth building.

### The panel

- A table in the master sheet's design. Columns: Group, Name, Company, Role,
  Monthly amount, Payment start, End date.
- **A `forms/Toggle` per row, NOT `FilterCheckbox`.** That one's `onChange`
  sends `undefined` so a filter disappears rather than inverting, which is
  the wrong contract for row selection.
- **A STICKY HEADER carrying the three buttons**, so you scroll, toggle and
  click without leaving the top.
- All three act on the selection. Yes applies with a toast; **No and Final
  go through `ConfirmDialog`** naming the deals, their amounts, what stops
  and what survives.

### Diane answers it too, including in BULK

**A WIDENING OF HER REACH, asked for 2026-09-16.** Her full entry is in
`docs/diane.md`; this is the half the plan depends on.

**THREE TOOLS, ONE JOB EACH, IN THEIR OWN FILE.**
`v1/agent/tools/monthlyReview.js`, never folded into `tools/masterSheet.js`:
that file is already 5,000 lines, and a review tool buried in it is a review
tool nobody can find or test on its own.

| Tool | Does | Guard |
|---|---|---|
| `list_monthly_review` | the queue for a period, narrowable to a person or a group | read only |
| `answer_monthly_review` | one deal, one answer | `resolvePerson`, exact match |
| `bulk_answer_monthly_review` | one answer across a named set | **`confirmFirst`** |

**Separate, not one tool with a mode.** A single tool that answers one deal
or forty depending on an argument is one mistyped argument away from the
wrong one, and the guards the two need are different.

**THE SAME ROUTE, NEVER HER OWN.** A second way to write an answer is a
second place for the rule to live, and this one sets `stopped_on`.

**THE TWO CALL SHAPE IS MANDATORY**, `confirmFirst`, the same guard
`bulk_update_master_sheet` and `rename_company` carry. The first call writes
nothing and says what it would do. **A bulk No stops paying real people**,
and "always confirm first" in a description is not a guard: she asked, was
not answered, and reported the change as done. That is the incident that
put `confirmFirst` there.

**SHE CANNOT ANSWER FOR A DEAL THAT IS NOT IN THE QUEUE.** The route
refuses a deal with no review due for that period rather than creating one.
Otherwise "mark them all no" reaches deals nobody was being asked about.

**She reports the count and what it stopped**, because the count is the
surprise: "answered No for 6, four of them stop at the end of August."

### Where the answer shows elsewhere

| Place | What |
|---|---|
| End date cell | `CellInfo`. Warning when unanswered, info when final |
| Row History | the trail, in the existing `HistoryModal` |
| Archive page | the ones answered No |

Not a column. A flag belongs on the column that caused it, and extra
information in a cell is an icon.

### His spreadsheet: he already invented the answer

No new column there either. He has been answering this by hand, in prose,
in the wrong column:

| His words | In the file | Means |
|---|---|---|
| `Ongoing` | 22 in end date, 12 in payment start | yes, still paying |
| `AUGUST END FULL`, `OCTOBER END FULL` | 6 in payment start | yes, final, and names the month |

Read in as the answer, written back to the same cell. `notes` keeps the
prose exactly as today (`uploadColumns.js`), because his sentinels are data:
readers translate, writers leave them alone.

---

## 6. Phase 3: liquidation, and closing a company

### Status carries it, and DISSOLVED is its own value

`tb_companies.status`, four values. The fourth is his, 2026-09-16, and it is
there for AUDIT: "we closed it" and "it ceased to exist" are different facts
and a single `closed` loses which.

| Status | Means | Paying |
|---|---|---|
| `active` | trading | full |
| `liquidation` | winding down, negotiated | **reduced, per deal** |
| `dissolved` | legally gone | nothing |
| `closed` | we ended it | nothing |

`dissolved` and `closed` are both terminal and both stop every deal. They
differ only in what they say happened, which is the whole point of having
two.

```
tb_companies  status             active | liquidation | dissolved | closed
              closed_on          date, set on either terminal value
              liquidation_total  numeric, nullable. The settlement
```

**Three columns. `owedThisMonth` does not change.** It stays a boolean.

### `liquidation_total` is a REFERENCE, never a rule

Added 2026-09-16, and the reason is worth keeping: an earlier draft left it
out to keep this to two columns, and **the panel then had nothing to check
against**. It could say "was 2,000, now 1,150" and not that 1,150 is 150
over a settlement of 1,000.

| It is | a number to compare against, and the record of what was agreed |
| It is NOT | a multiplier. Nothing computes a deal's amount from it |

It also answers an audit question the two column version could not: **"what
did we actually agree to pay Relia PA?"** The deals say what they say; the
settlement that produced them was nowhere.

**WARN, NEVER REFUSE**, on both over and under:

1. The CRM holds the settlement SECOND HAND, typed from a phone call.
   Refusing on a figure that may itself be wrong stops real work.
2. Legitimate mismatches exist: a rounding, a side agreement, a deal
   outside the settlement.
3. A refusal nobody can override gets worked around by typing a fake
   settlement, which is worse than the warning it replaced.

**Warned in two places**, so it cannot be clicked past and forgotten: live
on the panel as the amounts are typed, and in `ExportWarnings`, so a payout
file cannot be built over an over-allocated company silently.

### LIQUIDATION IS A PERIOD, NOT AN INSTANT

His own description, 2026-09-16: a negotiation lands at say 50%, £2,000
becomes £1,000, and **that £1,000 is distributed to selected people only**.
Some deals go to zero, some stay exactly as they were, some halve, some land
on a number nobody could derive.

**So there is no factor.** A multiplier cannot express a director going to
zero while a mid stays at 750. An earlier draft of this plan had
`owedThisMonth` returning a factor; that was wrong and it is deleted.

**The admin sets each deal's amount by hand**, which the CRM already does
with inline cells. Liquidation adds the STATUS, not the arithmetic.

**The original amounts are not lost:** `tb_mastersheet_changes` records every
edit with its previous value, so "what was Nicola on before" is a History
question, which is where it belongs.

**No envelope check for now.** Nothing will notice if the parts add to
£1,150 out of a £1,000 settlement. That is a real gap and it is addable
later as one warning. A guard with no incident behind it reads as an
opinion, and the next person argues with it.

### The sequence

```
1  Company -> liquidation      still paying, reduced
2  Admin sets each deal        zero, unchanged, anything
3  Company -> dissolved | closed
4  Every deal stops            stopped_reason = company_closed -> Archive
```

Step 3 is a terminal act at the END of the period. Closing on day one and
then paying reduced amounts for three months is not a thing, so the button
that ends it is not the button that starts it.

### The panel, which is how the amounts get set

**ONE SCREEN, ON THE COMPANY PAGE.** Setting a company into liquidation
opens it, and it can be reopened from the status badge afterwards.

| | |
|---|---|
| Rows | every deal on the company, live ones first |
| Columns | person, role, **current amount**, **new amount** |
| Header | the settlement, typed as a figure or a percent of the old total |
| Running total | allocated against settlement, **live**, with the gap named either way |
| Save | writes them all, once |

**NOT A FLAG PER ROW SCATTERED ACROSS THE MASTER SHEET.** Chasing eight
warnings across a table is the mess this avoids: the decision is one
negotiation, so it is one screen and one pass.

**The safety net stays.** A company in liquidation whose deals have not been
through this panel gets a line in `ExportWarnings`, so a payout file cannot
be generated over un-set amounts without somebody being told.

### On the master sheet

**A BADGE, NEVER A STATUS.** There are already three things called status
(payment period, pay status, company status) and `CLAUDE.md` is strict about
it. Liquidation on a deal row is a fact about its COMPANY, so it reads as a
badge beside the company name.

**IT DOES NOT MOVE THE PAYMENT START TINT.** That tint answers one question,
is payment running this month, and in liquidation it is, just for less. His
three conditional formats stay exactly as they are, which matters because
that export is his document.

A filter for it on both pages: Companies by status, and the master sheet by
"company in liquidation", so "what have I still to set" is one click.

## 7. Vocabulary. None of these share a word.

| Word | Means | Reverse |
|---|---|---|
| **Stop** | this deal is over, the row stays | **Resume** |
| **Remove** | this pairing is over, the row goes | none |
| **Close** | the company is closed | reopen |

Stop and Resume are new. Remove and Close keep their existing meanings.

**DELETE IS GONE FROM THIS TABLE, 2026-09-14.** It used to mean "the person
or company goes and their deals survive blanked", and nothing does that any
more: both DELETE routes, `peopleRepo.remove`, `companiesRepo.remove`,
`rowsRepo.orphanPerson`, `rowsRepo.orphanCompany` and Diane's two tools were
all removed. **Detaching is impossible**, so no new orphan can be created.
See `state.md` "Delete versus Remove".

The replacement is `feature.md` item 6, deletion derived from the deals, and
§4 above says how it and Stop stay apart.

**Not Restore, Retrieve or Transfer to master sheet.** All three imply the
row moved and came back. It never moved, so the word would send people
looking for where it went.

---

## 8. Was blocked on him. ALL FOUR ARE ANSWERED, 2026-09-16.

Nothing in this plan is waiting on anybody now.

1. ~~**Liquidation is half of WHAT?**~~ **The company's envelope, and then
   it is redistributed by hand.** £2,000 becomes £1,000 and that £1,000 goes
   to selected people only. It is not a multiplier on a row, so the question
   dissolves: see section 6.
2. ~~**Does the clock pause during liquidation?**~~ **No, it keeps
   running.** His reasoning: they are still being paid. A deal in
   liquidation reaches its year on the same date it always would.
3. ~~**Who absorbs the cut?**~~ **Nobody, by rule.** It is negotiated per
   person, which is exactly why no pattern was findable in the sheet: the
   mid earns more than the director on four companies. The admin types each
   figure.
4. ~~**Forced versus self closure.**~~ **It is the status, not a field.**
   `dissolved` is the company ceasing to exist; `closed` is us ending it.
   Both stop every deal and they differ only in what they record, which is
   the audit trail he asked for. **There is no automatic closure anywhere
   in this plan**: every terminal state is a button somebody presses.

---

## 9. Ours, not his. DECIDED 2026-09-16.

### TWO DOORS, and they do different jobs

- **A button with a count on the Master Sheet header**, `Review 6`. This is
  the door you walk through when you go looking.
- **A line in `ExportWarnings`**, naming the count and the money. This is
  the door that comes to find you, before a payout file is built over
  unanswered deals.

**Not the export modal alone.** "Is AJ Rayson still being paid" is a reading
question; needing to start an export to ask it is the wrong shape.

### THE CURRENT MONTH, ALWAYS. No picker.

His call, and the same rule the expenses page already follows:
`currentMonth()` from the business timezone, never the browser's and never
a control.

**AN EARLIER DRAFT SAID "the month being generated". That was wrong**, and
the reason it was wrong is the part worth keeping:

**The review writes a DATE, not a month.** An answer of No or Final sets
`stopped_on`. The export then reads that date against whatever month it is
building. **So the two never have to agree on which month it is**, because
they do not communicate through a month label at all.

Tying the review to the generated month would have created a second
definition of "now" for no gain, next to the one `presetMonth.helper`
already owns.

**Its header still says which month**, because an answer is stored per
month and a screen that does not name it is a screen two people answer
differently across a boundary.

### An unanswered deal counts as YES and shouts

Defaulting to no would silently stop paying real people, which is the worse
failure by a distance.

---

## 10. Not in scope, and he should be told why

**Cash at the start of a deal, and who fronts it.**

**CORRECTED 2026-09-14.** This section quoted him as saying "the first three
months are paid on a cash only basis" and put roughly £6,000 per company on
it. **Neither is in any source we hold.** All three of his documents were
searched: there is no "three months", no "90 days", no "cash only basis" and
no figure. Whoever wrote it either heard it somewhere not recorded or
invented it, and it was then quoted back as his words.

**What he did write**, `Structure for the maths.docx`:

> "Method of payment. So usually at the start its cash then one day it moves
> to bank when there is a sufficient flow, then after it will move to cash
> again at the end."

**Cash, then bank, then cash again. No duration and no figure.**

And on who carries it, `System for money V2.docx`:

> "there's no reason why SV should be covering costs solo and if anyone
> assumes such a role they deserve an interest on their money"

**The point survives the correction.** `tb_mastersheet.payment_method`
records that a deal is cash; nothing records WHO fronted it or whether they
were repaid. Real money, no ledger. It belongs with `docs/expense.md`.

**ASK HIM FOR THE PERIOD AND THE SCALE** before anybody builds to it. They
were treated as known and they are not.

**Diane.** Nothing here needs her. When she is given it she reads the same
queue and writes through the same route, and she changes nothing about
whether this is correct. Her entry is in `docs/diane.md`, marked blocked on
phase 2.

---

## 11. What the sheet actually says, for the argument about numbers

Read from `master.xlsx` on 2026-09-10. Thirty client companies, excluding
the internal Workforce payroll.

| Envelope | Companies |
|---|---|
| £2,500 | 11 |
| £2,000 | 8 |
| £1,500 | 3 |
| £1,000 | 3 |
| other (0, 4000, 4500, 6250) | 5 |

**His "typically £2,000" is the bottom of the band, not the typical value.**
The honest statement is £2,000 to £2,500, which covers 19 of 30. It is not
the director's wage either: directors cluster at £1,000 to £1,200.

**The envelope is disciplined. The split inside it has no rule.** The mid
earns more than the director on Ackerman Pearce (1100/1400), Diverse Rec
(1000/1500), Red Horizon (1200/1300) and RP Contractor (1200/1300). The
director takes everything on Reliapay (2500/0) and nothing on Gab (0/1000).

That is why question 3 in section 8 cannot be answered from the data. There
is no pattern to follow.

### Other things the file showed

- **A zero amount is NOT how he ends a deal.** The zeroed rows are mostly
  future starts. Only Reliapay's Mid 1 looks genuinely finished.
- `Relia Pa` and `Relia PA` are one company typed twice, splitting a £2,000
  envelope into 1875 and 125.
- Preset carries 12 `NA`.
