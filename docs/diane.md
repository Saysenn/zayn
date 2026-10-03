# diane.md

**What Diane needs to learn next.**

This file is the handover between the CRM and the agent. The CRM changes
faster than her tools do, so every feature added or changed here gets an
entry, and "check diane.md, implement everything new" is a complete
instruction on its own.

**The rule, in `.claude/CLAUDE.md`: a CRM feature is not finished until
this file names it.** A capability she cannot reach is a capability the
admin has to leave the conversation to use, which is the thing she exists
to prevent.

## How to use this file

1. **OPEN** is not built. **DONE** is built and tested, kept for one cycle
   so a reader can see what just landed, then deleted.
2. Each entry says what she should be able to DO, not how. The tool shape
   is a decision made when it is built.
3. An entry that only reads is cheap. An entry that WRITES needs the two
   call shape (`confirmed`) if it can touch more than one row, per
   `bulk_update_master_sheet`.
4. **Never widen her reach without asking first.** An entry here is a
   proposal, not permission.

---

## HER WINDOW IS THE DASHBOARD'S

Four months: the two before this one, this one, and next. His call
2026-09-09, so the same question answered on two screens cannot disagree
about how far anyone can see.

`monthHistory.js` caps the two halves apart, because one number could not
say it: `MAX_HISTORY_MONTHS` is 3 and `MAX_FORECAST_MONTHS` is 1. A single
"nearest 3" let her project three months ahead, three times what the
dashboard draws.

### "last month" answered THIS month

Live 2026-09-09: "show me nathan total last month" came back as September
2026, with a figure that looked right, which is the dangerous kind of wrong.

The model simply OMITS `month` for a relative word, so the totals tool's
`asked` was undefined and it fell through to the current month.
`compare_months` never had this because it reads the sentence through
`monthsInQuestion`, where "last month" and "last august" have always been
understood. The totals tool reads it too now, through that same helper
rather than a second parser.

Same rail as `convertTo` and `only`: the sentence they just typed outranks
an argument she left out. Only when exactly ONE month is named, since two is
a comparison and `months` already carries that, and only from the CURRENT
sentence, so a fresh question cannot inherit "last month" from an older
subject.

Pinned by `lastMonthRead.test.js`, which drives the handler with the live
failure's exact shape rather than testing the parser that was never broken.

## TURNED OFF

### The payment period, 2026-09-09

She could set it: `status` was in `ROW_FIELDS`, so `update_master_sheet_row`,
`fill_form` and `add_deal` all took it, and the bulk tool had it in its own
`set` block. A stored value then won over the formula on every read, and the
money never followed, so a card read "Not payable this month" over Â£500 that
was still in September's total.

It is derived now. `status` left `ROW_FIELDS` and the bulk block, and asking
for it hits `DERIVED_FIELDS`:

> NOTHING HAS BEEN CHANGED. The payment period is worked out from the payment
> start, the preset and the end date, every time it is read, so it cannot be
> set on its own. Change one of those three and it follows.

**The refusal exists because the schema cut alone lied.** Without it she fell
into "status is not a column on a deal", which is false: it IS a column, it
is just computed. A wrong reason is worse than none, because she repeats it.

**Filtering by it is untouched.** Reading was never the problem.

**Her card shows BOTH payment switches**, 2026-09-09. It filtered to
`overridePaid` alone and `Pill` hardcoded one pair of words, so a card said
a deal was unpaid without ever saying whether it was meant to be paid, and
the surviving pill could not have drawn the other correctly anyway. Words
and colour come from which switch it is:

| switch | yes | no |
|---|---|---|
| Should be paid | `Should be paid`, green | `Not to be paid`, **RED** |
| Paid | `Paid`, green | `Not paid`, amber |

Red on the decision, his call. Amber on unpaid, because most rows are unpaid
for most of a month and forty red pills would leave the one that matters the
same colour as the noise. Both stay behind `payableThisMonth`: on a row owed
nothing, "Not paid" is not a fact anybody has to act on.

**Her card reads `payment_period` alone now**, never `?? r.status`. With the
override gone `paymentPeriodSql` computes exactly what `isOwedThisMonth`
answers, setting included, so ACTIVE on a card is the same fact the total
uses. The stale fallback is what let the two disagree.

### Export and add a deal, 2026-09-09

His call. **Off, not removed**: every file, test, panel and prompt stays, and
re-enabling is deleting one entry from `agent/disabledTools.js`.

| tool | what happens now |
|---|---|
| `export_sheet` | refuses, no panel |
| `add_deal` | refuses, no row |
| `new_deal_checklist` | refuses, no form |

`new_deal_checklist` is in the set because it IS the add flow: on its own it
would put a form on screen that nothing can submit.

**Editing is untouched.** `edit_deal_form`, `fill_form` and
`update_master_sheet_row` all still work, so changing an existing row is
exactly as it was.

**THE HANDLER REFUSES, the prompt is only the cheap half.** A line telling
her not to export is the shape of every guard in `v1/agent/` that had to be
built afterwards. She can call these as often as she likes; nothing is
written and no card comes back, so she cannot claim she did it either.

**The words are his, handed back finished**, on the same rule a tool
computing a figure follows:

> I can't export a sheet for you honey, that one is not mine any more. Hit
> the Export button at the top of the Master sheet page and you will have
> your file faster than I could ever build it.

> I won't be able to add a deal for you dear. The Add deal button on the
> Master sheet page walks you through every field, and it will be quicker
> than telling me each one.

**SHE POINTS, SHE DOES NOT OFFER TO DO IT.** The first draft of both lines
said "I can show you the crm export modal" and "I can show you the crm add
deal form". She cannot open either, and the second promised back the exact
form `new_deal_checklist` had just been disabled from putting up: the admin
would have sat waiting for a screen that never came. These name a real
button and describe something the ADMIN does.

**They are pointers across the boundary, so nothing catches a rename.**
`Export` and `Add deal` are both on the Master sheet toolbar and `Master
sheet` is that page's nav label. Rename any of the three in `crm/web` and
rename it in `agent/disabledTools.js` too; its test pins the three strings.

## DONE 2026-09-29: one transcript, three faults, three guards

His session, in order. Every one is a code guard, because every one is a
place a sentence would have been ignored.

**1. "add 100 to zayn milkman" → "I couldn't find anyone named Zayn
Milkman."** A person and a GROUP glued into one argument. Nobody is called
that, the search found nothing, and she told him one of his own handlers
did not exist. "zayn from milkman" worked in the next breath, because the
preposition kept the two words apart.

`splitPersonAndGroup` in `tools/notAGroup.js`, one definition read by two
doors: `resolveDealScope` rewrites the arguments on the filter and bulk
paths, and `notAPerson` returns the correction on the read paths, which
have no scope step. **BOTH HALVES HAVE TO BE REAL** or nothing is split: one
group named as whole words, and a remainder that reaches somebody on the
roster. A value that IS somebody's whole name is never split, so a person
called Milkman Jones survives a group called MILKMAN.

**2. "for october only, add 100" → "this would change Zayn's deal for
September 2026."** Two faults in one sentence, and the second is the
dangerous half:

- The month was read off the ROW's preset and never compared with the one
  he said.
- **There is no per month amount to set.** `monthly_amount` belongs to the
  DEAL, so "October only" cannot be honoured by it at all, and a yes would
  have written something nobody asked for.

`wrongMonthAsked` refuses inside `confirmAmounts`, BEFORE the preview is
built, and returns no `pending`, so a later yes has nothing to replay. It
reads `args.said`, the one copy she cannot have edited, and only on "FOR
<month>" — the same precision `checkMonths` uses, so "he started in
October" is still a date and not an ask. `forMonthsIn` is now one
definition shared by both.

**3. "Zayn has 2 deals. Which company, or both?"** Both deals are on
Workforce, in MILKMAN and in INDIGO. The company is what they SHARE.

**Fourth time this shape has been found**, and the second door. `closure`
had the rule since 2026-09-18 and the card list did not. `tools/whichDeal.js`
is the one definition now: `whatSeparates` returns company, group, role or
null, and both doors read it. Its own file, like `resolvePerson`, so
`closure` never has to import a 7,800 line module to ask which deal.

---

## OPEN

### THE REVIEW IS A PAGE NOW, AND ONE ANSWER TAKES A ROW OFF IT, 2026-09-29

**A PROPOSAL, not permission.** Nothing of hers broke: her four review
tools read `shared/reviewQueue.helper.js`, which reads the repo's queue,
so the change reached her the moment it landed. What she says about it is
what is out of date.

**What changed.**

1. **`answer: 'no'` ("already ended") REMOVES THE DEAL FROM THE QUEUE.**
   `STAYS_AFTER_STOP` keeps only `review_final` on screen, because `final`
   is still paid in full this month and `no` stopped at the end of LAST
   month. So a deal she marks `no` is gone from `list_monthly_review` on
   the next call, and `isDue` refuses a second answer for it.
2. **`POST /monthly-review/clear` is gone.** Nothing of hers used it. The
   way back is History's undo (`revertAnswer`), which takes no queue guard.
3. **The panel is a PAGE, `/review`.** Her sign-in briefing's three review
   lines (`liquidating`, `pastYear`, `reviewMonthly`) already point there;
   `LINK_FILTER.reviewPanel` no longer exists.

**What she should be able to DO with it.**

1. **Say where a row went.** After a bulk `no` her confirmation should be
   able to add that those rows have left the review and are on the
   Archive, because the admin is about to look for them and not find them.
   Words only, no new tool.
2. **UNDO A REVIEW ANSWER.** She cannot, and with the Undo answer button
   gone she is the only other door. It would be a read of
   `tb_mastersheet_changes` for `field = 'reviewAnswer'` plus
   `monthlyReview.revertAnswer`, per deal, two call shape. **This is the
   one that widens her reach, so it needs a yes.**
3. **Do not let her offer `clear`.** If any prompt or description says she
   can put a deal back to Waiting, it is now false, and "she must not
   claim to have done what she did not do" applies.

**The guard to check first.** `checkCounts` compares her figure against the
queue. A row answered `no` mid-conversation now leaves the queue rather
than changing state inside it, so a count taken before and quoted after is
a real drift, not a rounding one.

### SHE READS DEAL STATUS AND CANNOT SET IT, 2026-09-24

**A PROPOSAL for the write half, not permission.** The read half is built.

**What it is.** Deal Status is the PAIR `end_note` and `review_monthly`,
read by priority, never a stored column. Shipped 2026-09-22 and never
reached her: asked "how many deals are reviewed monthly" she called
`list_monthly_review` and answered with its **17 unanswered** against the
**12 rows** that carry the status.

**What she has now.** `filter_master_sheet` takes `dealStatus`, one value
or a list, and the deal card carries a "Deal status" cell. Both read
`dealStatusSql` / `dealStatusOf`, so her answer and the column cannot
disagree. The master sheet page narrows by it too, through the same repo
param, so her answer and the screen cannot disagree either. Her description says plainly that `list_monthly_review` is the
QUEUE and this is the STATUS, because they are different numbers and she
reached for the wrong one.

**What she still cannot do, and what it would take.**

1. **Set it.** Writing is `dealStatusWrites`: BOTH columns, always, or the
   mixed state gets made. It would need the two call shape.
2. **"Going concern" CLEARS THE END DATE**, and only History brings it
   back. That is the one destructive part, so the confirm has to name it,
   not just the status.
3. It is a per deal decision, so it is a row at a time, like
   `specialCaseDeal`. A bulk path would need its own argument.

**Say which deals it would touch before anything else.** The status also
decides whether a deal is in the monthly review, so setting it moves a
screen the admin uses to chase money.

### A DEAL CAN BE PAID A MONTH ITS DATES SAY IT IS NOT IN, 2026-09-23

**HERS, his call 2026-09-23**, and gated. She was read only for a few
hours; an ask she cannot act on is worse than no ask, so the field is hers
through the two call shape.

**What it is.** `tb_mastersheet.special_case_deal`, migrations 064 and 065. The mirror
of `stopped_on`: that one says a deal is OVER and beats the derived end
date, this says a month PAYS and beats the derived payment start. Mayah's
appointment is 13 Jul 2026, so the formula derives a start of 11 Oct and
September owes her nothing. September pays her anyway.

**It forces the WHOLE month**, the same answer the first week rule gives in
month 3, and for the same reason: counted from a start after the month it
would be zero, so the switch would put a row in the total for nothing.

**What she has now.** The deal card carries "Special case", read only, and
`payableReason` says "Yes, set to special case by hand" rather
than a bare Yes beside a start date in the future. Her prompt tells her to
give that as the reason instead of the arithmetic.

**SHE ASKS, OFF THE STATE AND NEVER A PHRASE.** `specialCaseDealAsk`: after a
deal write, the row is marked for its month, worth something a month, and
still counts nothing toward it. Nothing else produces that shape, and it is
exactly what a payment start after the month looks like from the admin's
side. Keying it on somebody typing "special case" would fire when they said
it and miss every time they did not.

**AND SHE SETS IT, ONLY THROUGH THE TWO CALL SHAPE.** `confirmSpecialCaseDeal`
wraps `confirmFirst`, the same guard `rename_company` and the bulk writes
take. The first call cannot change anything, so there is nothing for her to
misreport: she has invented both a confirmation and its result before.

**The preview names the FIGURE, not the count.** One deal is always one
deal; what the admin agrees to is an amount landing in a named month. Both
directions are confirmed, because taking money back out moves a total too.

**Two rules that come with it:**

1. It is a FIGURE CHANGE. Flipping it re-derives the payable days and the
   payable amount, so she says what moved and to what, the same rule the
   appointment cascade already carries. `checkFigures` applies.
2. The month is the row's PRESET month, never "this month". A row marked
   October is not a September decision.

**What she still must not do:** set it because a figure looks wrong to her.
It is the admin saying this row is paid anyway, and only they can say it.

### THE WORKING FILE IS CONFIGURABLE NOW, 2026-09-23

**A PROPOSAL, not permission.** Three switches she cannot reach, and one
correction she needs before she is asked.

**1. She can already narrow an export to a person, and now it works on the
master sheet too.** `resolvePerson.js` is her one exit for "which person",
and it resolves on an EXACT match of a name offered exactly as written.
Nothing about that changes. What changes is that the master sheet template
now honours `personId`, so "export Johnathon's sheet" is a file she could
build rather than a request she has to redirect. Group segregation survives
the filter: one person across two groups is two tabs.

**AMBIGUITY IS STILL ABOUT WHICH PERSON, NOT HOW MANY ROWS.** A person with
one deal and a person with nine are the same question. Count distinct
`person_id`.

**2. `showRates` adds a "Rates applied" column, in words.**
`shared/rateText.helper.js` spells it: `added 5% · 1% fx fee · 2% fee off`.
If she is ever given this switch she must not spell it herself. The three
rates run in TWO DIRECTIONS and the words carry the direction; a sentence
she composed saying "5%" without saying added or off is the kind of figure
`checkFigures` exists to catch.

**3. `primaryColor` paints the header band, and `blue-white` is glossy.**
She already validates a colour against `listPaletteColors`, so the new id
is reachable the moment she is allowed to send it on this template.
`COLOR_IDS` in `exportDraft.js` reads that list, so nothing there needs a
new value typed in.

**4. THE CORRECTION.** The master sheet export now carries person level
rates on Payable and the opt in column can say so. Before today it carried
neither. If she is asked why a file she built last week said 4,700 where
the sheet says 4,935, the answer is that the export was missing the rate,
not that the wage changed.

**What she must NOT do.** She cannot invent a rate line, she cannot put the
rates column on a document that is not the master sheet, and she cannot
offer a colour that is not in the served list. A cap on a total is still
refused outright.

### THE EXPORT'S FOUR DOCUMENTS, AND WHAT SHE MUST NOT DO WITH THEM, 2026-09-22

**A PROPOSAL, not permission.** Three of these she has to KNOW so she stops
being wrong; one she would have to be GIVEN.

**1. The master sheet export now has four named documents, and three of
them filter the rows.** `listSheetPresets()` serves them beside the columns
they name, each with a `method` that is `null` on All and Standard.

| | columns | rows |
|---|---|---|
| All | every optional one | every row |
| Standard | payable days, method, payable amount, currency, location | every row |
| Bank | Standard less location, plus bank details, account number, sort code | `payment_method = bank` |
| Cash | Standard plus door number, postcode, phone, accepting postals | `payment_method = cash` |
| Crypto | payable days, method, payable amount, currency | `payment_method = crypto` |

**She already has the machinery.** Her export draft carries `method` and
`queryFor` sends it, and `columnKeysFor` picks columns. What she cannot do
is NAME one: "export the bank sheet" has to become the pair, columns AND
filter, never one of the two. **Reading the set from the same
`listSheetPresets()` the browser reads is the whole of the entry.** A list
of column keys written into a prompt is a second definition of them, and a
key that stopped matching would build a short file and say nothing.

**2. She must stop offering a tab per group where one cannot be built.**
Only the master sheet template reads `perGroupTabs`. It is now that tab's
DEFAULT and it is hidden everywhere else. Offering it on Cash or Bank
promises five tabs and hands back a single sheet, which is the thing
`checkFigures` exists to stop her doing with money.

**3. A filtered run is a DIFFERENT FILE and she must say its real name.**
`fileLabelOf(template, method)` appends the method, so the bank run of the
master sheet is `MASTER SHEET - BANK`. Her `fileNameFor` passes it now. She
announces the filename before the file exists, so a name she says and a
name that downloads must be the same string, or she has told the admin
something false about their own folder.

**4. THE WORKING FILE'S TWO MONEY COLUMNS NO LONGER AGREE, and she has to
know why before she is asked.** On the master sheet tab ONLY:

| column | what it holds |
|---|---|
| Payable amount | every rate applied, the figure he is owed |
| Monthly amount | the STORED WAGE, no rates |

Not an inconsistency to explain away. The upload READS Monthly as the wage
and IGNORES Payable, so a rated Monthly returns as a raise and compounds
every month. Asked "why does the Maid say 4,700 here and 4,935 there", the
answer is that one is the wage and the other is the month's money. **Every
other document she can build still rates both.**

**5. ARCHIVED DEALS ARE GONE FROM EVERY FIGURE SHE READS, and that is a
correction, not a change.** `findAllRows()` had no `stopped_on` filter, so
until today her breakdowns and her month history counted deals the admin
had archived. Any total she quoted for INDIGO or MILKMAN before 2026-09-22
was over by those rows. She has no tool that reads the Archive and **is not
being given one here**.

**What she must NOT do with any of it.** She cannot invent a fifth
document, she cannot pick a method the preset did not name, and she cannot
cap or round a total to make two of these files agree. A cap on a total is
refused outright, and that does not change because the file is narrower.

### SHE SUGGESTS FIXES FOR THE SHEET, 2026-09-17

**Asked for. Not built, not started, and it is the biggest entry in this
file.** A PROPOSAL, not permission.

Today she answers what the sheet SAYS. This is her answering what is WRONG
with it, and offering to put it right: the rows whose dates contradict the
formula, the ones missing a value the rest of the row already implies, the
ones that will fall out of a total without anybody noticing. A real
assistant on the sheet, not a lookup over it.

**What she should be able to DO:**

1. **Sweep the sheet and hand back a LIST OF FAULTS, each with its fix
   beside it.** Narrowable to a person, a company, a group or a month, the
   same way every other read is. The fault classes already exist in the CRM
   as rules; this is her reading them out.
2. **Explain the FORMULA behind any one of them.** "Why does this row say
   30 days" has to be answerable in words, on the row in front of her, not
   as the general rule recited. `explain_preset_rules` already learned that
   lesson once.
3. **Offer to APPLY a fix, one row or a named set**, behind the two call
   `confirmed` shape like every other bulk write.
4. **Say what a fix would DO TO THE MONEY** before it is applied. A
   corrected payment start moves a row in or out of this month's total, and
   that is the only part anybody actually cares about.

**The fault classes it should cover.** Each of these has cost money or time
at least once, and each already has a definition in the code:

| fault | the rule that decides it |
|---|---|
| Dates that disagree with appointment + 90 days | `shared/fromAppointment.helper.js`, `repairFromAppointment` |
| A date missing that the other two imply | the export panel's `derivable-dates`, already built |
| Payable days that outlived their own dates | THE DATES WIN, decided 2026-09-08 |
| Payable days but no monthly amount, or the reverse | `computePayable` |
| A preset that disagrees with the rest of the sheet | `shared/presetMonth.helper.js` |
| Bank method with no account number | the upload's `review_reason` |
| A row with no group, so it duplicates itself | `dealKey.js` |
| A rate on the person AND on the deal | they STACK, `shared/rates.helper.js` |
| A row that will not count this month, and why | `shared/owedThisMonth.helper.js` |

**The guards, and none of them is a sentence in a description:**

1. **NEVER A SECOND DEFINITION OF A FORMULA.** Every suggestion comes from
   the helper the page and the export already use. The moment she works one
   out herself, she and the screen disagree about the same row, and there is
   no way to tell which is right. This is the whole risk of the feature.
2. **SHE SUGGESTS, SHE NEVER DECIDES.** A fix is an offer. The three
   answers on the monthly review are the admin's and so are these.
3. **SHE MUST NOT INVENT THE VALUE.** Where a fix needs a number nobody
   holds, she says what is MISSING. A guessed date or amount written into
   the sheet is indistinguishable from a real one afterwards.
4. **A SUGGESTION CARRIES ITS EVIDENCE**: the row, the column, what it says
   now, what it would say, and which rule says so. Without the last one it
   is an opinion about somebody's payroll.
5. **A BACKWARD DERIVATION IS MARKED A GUESS** and is never applied in a
   batch. The export panel already draws this line; it does not get redrawn
   more loosely here.
6. **NO SCORE.** No "the sheet is 94% healthy", no ranking of the worst
   rows. A figure nobody can check is the one she must not produce.
7. **SHE DOES NOT VOLUNTEER IT EVERY TURN.** Asked a question about one
   person, she answers it. An audit nobody requested is noise, and noise is
   how a real warning gets ignored.

**Where it hooks in.** `audit_master_sheet` exists and does not answer this;
`helpers/dateNotices.js` marks the same three dates per cell and
`ExportWarnings` already fixes them per row with an Accept N on the group
line. So the CRM half is largely built and this is the conversational half
of the same question, the way the monthly review entry is. The tool shape is
a decision made when it is built.

**Decide first, before any code:** does applying a fix write through the
SAME route the panel uses, or its own? It must be the same one, for the same
reason the review answer is: a second door is a second place for the rule to
live, and this one moves money between months.

### What she still cannot answer, audited 2026-09-17

Every read filter and every bulk write this entry used to list has shipped;
see the DONE entries below. What is left:

- **NO DAY LEVEL DATE RANGE.** Every date filter buckets by MONTH, so
  "appointed between the 3rd and the 12th" has no answer. The page has no
  day range either, so this is a gap in both, not just in her.
- **No average, minimum or maximum**, and no ordering. Decided against
  below rather than missing by accident.

### She cannot read a settlement back, 2026-09-17

`update_company` can set `liquidation` and no tool returns
`liquidation_total`, so she puts a company into a wind down and can then say
nothing about it. "NOT the liquidation amounts" below refuses DECIDING them;
reading one back is explicitly allowed there and was never built.

- **"ZZ Closing Co is in liquidation, settlement 1,250, four deals
  allocating 1,150."** Read only, on the company card or beside the Archive.
- **Writing it stays out**, and so does any arithmetic off it. There is no
  multiplier and never will be. A PROPOSAL, not permission.

### Expenses exist now, and she cannot see them, 2026-09-14

R1 shipped: `tb_expenses`, `/expenses`, a standalone ledger of money going
OUT. She has no tool for it. A PROPOSAL, not permission: her reach widens
only when the user says so.

**What she should be able to DO:**

- **Total expenses for a month, and for a group.** `SUM(aed_amount)` over
  the live rows, the same figure the page shows.
- **Read a handful back**, filtered by group, currency, payee or who spent
  it, the way `find_and_show_details` reads deals.
- **Say what has no rate.** A row with no `exchange_rate` has no
  `aed_amount` and is out of every total. That is the one thing about this
  page somebody has to act on, so it is the one thing she should volunteer.

**What she must NEVER do, and these are the guards, not the prompt:**

1. **NEVER ADD AN EXPENSE TO A PAYOUT FIGURE.** They are two directions of
   money. An expenses total beside a payout total is fine; one number
   containing both is wrong, and nothing in the CRM produces it today.
   Whatever tool she gets must return expenses in their own named field so
   there is no shape she could sum them into by accident.
2. **NEVER CONVERT AN EXPENSE HERSELF.** Every row already carries its own
   AED figure, computed by the database from the rate the row was entered
   with. Reaching for `toUsd` or today's FX to "work out" an expense
   reproduces exactly the fault the generated column exists to prevent.
   Hand back `aed_amount`, never `raw_amount` times anything.
3. **A total that silently skipped the rateless rows is a cap she cannot
   see.** Report the true total AND how many rows were left out of it.

**Not hers at all:** creating, editing, archiving or deleting an expense.
Read only, the same way she cannot create a person or a company.

`docs/expense.md` has the data model. R2 to R4 are not built, so nothing
here depends on the import or the change log.

### The rates are ON the Monthly amount now, 2026-09-12

Built. An add on, a crypto charge and a fee are inside the figure a row
carries, the way his own sheet writes them: Maid's 4,700 wage on 5% reads
**4,935** everywhere, on screen and in the file. `shared/rates.helper`
`withRates` applies them once and nothing downstream adds them again.

**Her figures did NOT move, and that is the point.** She has always reported
the net through `amountWithRates`, so her answers were already 4,935 while
the screen said 4,700. The screen agrees with her now. What is new is that
the raw wage and the rated figure are two askable things.

- **She must never add a rate to a figure she was handed.** It is already
  in. "500 plus Gloria's 5%" is the old arithmetic and now double counts.
- **The raw wage is still there** as `monthly_amount_raw`, so she can answer
  "what is the agreed wage" and "what is it with her add on" as two
  different questions. Before, only the first existed.
- **She should be able to say WHY a figure is higher**, in the shape the
  cell's own popup uses: raw, then each rate named, then the paid figure,
  and that the fee comes off the raw plus the add ons.

  **DONE 2026-09-14, then simplified the same day.** His words on the first
  attempt: "three representations of the same data". The answer carried the
  same money in the headline, again in the clause explaining it, and again
  on the person's own line.

  **ONE FIGURE, ONE EXPLANATION.** `owed` now means the NET, so the headline
  IS the answer and the line beneath is arithmetic carrying no noun:

  ```
  Gloria is owed GBP 2,100 for August 2026.
  GBP 2,000 Workforce + GBP 100 add on (5%).
  ```

  - **The percent is in the arithmetic line**, and only when every row
    carrying that rate carries the same one. Mixed rates print no number
    rather than an average nobody agreed to.
  - **ONE DEAL FOLDS ITS COMPANY IN**, as above. Several deals list
    underneath instead, and a person with no rate at all still gets the
    list, or the answer never names the company.
  - **A PER PERSON LINE IS FOR GROUPS ONLY.** On a single person it would
    repeat the sentence above it. On a group it is the one thing the
    arithmetic line cannot say: whose rate it was.

  ```
  MANBAT is owed GBP 12,584 for August 2026.
  GBP 12,400 + GBP 205 add ons + GBP 10 crypto charges - GBP 31 fees.
  Nicola: GBP 2,900 + 5% add on (GBP 145)
  Drew: GBP 2,000 + 3% add on (GBP 60)
  ```

  - **No line restates a total.** "= GBP 3,045" after a sum the reader just
    watched being made is the duplication again. The exception is the PLURAL
    answer ("add Gloria and Nathan"), where each line IS that person's
    answer rather than an explanation of a headline, and keeps its total.
  - A person on nothing gets no line, and `0%` never appears.

- **"IN TOTAL", NEVER "TO FIND", 2026-09-14, his call.** `owed` still names
  the raw sum so the sentence keeps two distinguishable figures. The phrase
  was also vocabulary in two guards, `checkQuestion`'s `STATES_MONEY` and
  `checkMonths`'s `MONEY_CLAIM`; both already carried `total`, so "in total"
  still arms them and `to find` came out of both.
- **A rate set through her must repaint like any other write.** The web
  mirror is `web/src/helpers/rates.js`; her panel reads the same cache.
- **THE TOTALS DID NOT MOVE.** Pro-rating and a rate are both
  multiplications, so every figure is the penny it always was. If she ever
  reports a total that changed on the day this shipped, she is wrong.

### The monthly review: deals past their year, 2026-09-11

**Blocked until phase 2 of `docs/closure.md` exists.** She cannot review what
the CRM does not yet track.

**WIDENED 2026-09-16, his call: SHE MAY ANSWER, AND IN BULK.** The entry
below was read only. She can now write the answer, one deal or a named set,
and a No or a Final sets `stopped_on` and moves the deal to the Archive page.

Four guards, and none of them is a sentence in a description:

1. **`confirmFirst`, the two call shape, mandatory.** The first call writes
   nothing and says what it would do. **A bulk No stops paying real people.**
   This is the guard that exists because she once asked, was not answered,
   and reported a rename as done anyway.
2. **The SAME ROUTE the panel uses.** A second way to write an answer is a
   second place for the rule to live, and this one sets a stop date.
3. **She cannot answer for a deal that is not in the queue** for that
   period. The route refuses rather than creating a review nobody asked
   for, or "mark them all no" reaches deals nobody was being asked about.
4. **She reports the COUNT and what it stopped**, because the count is the
   surprise: "answered No for 6, four of them stop at the end of August."

**She still cannot decide.** Asked "should I stop these", she hands back the
list and the money at stake and says it is not hers to answer. The three
answers are the admin's.

**The Archive page is hers to READ, not to write.** She can say what ended,
when and why (`stopped_reason`), and total what a month lost. **Resume is
not hers**: bringing a deal back into a month's money is one deliberate act
on the page, in front of the row it changes.

A deal's obliged term is one year and many last longer, so past that point
it is decided month by month: is this still being paid for this month. Three
answers, yes, no, and yes but this is the final month. The CRM's home for it
is a panel with a sticky header; this entry is the conversational half of
the same question, writing the same record through the same route.

- **She should be able to hand back the list of deals awaiting this month's
  answer, narrowed to a PERSON or a GROUP.** Two shapes of one question, the
  same as every other list she serves.
- **TWO LISTS, NOT ONE.** "Past its year and unanswered" and "in its final
  month" are different questions. Merging them hands back deals nobody has
  to decide about beside deals somebody must.
- **The count and the list come from the SAME predicate as the panel.** If
  she ever counts one way and lists another, the second one is wrong. Same
  rule as the stage ring above.
- **Answering is a WRITE that can touch many rows, so it takes the two call
  shape** (`confirmed`), per `bulk_update_master_sheet`. Yes on twelve deals
  is twelve rows changed.
- **"No" and "final" STOP MONEY, so the first call says what stops, for whom
  and from when**, and what survives. The panel confirms the same way.
- **SHE MAY NEVER ANSWER ON HER OWN.** Yes, no and final are the admin's
  decision, never an inference from how long a deal has run. With no answer
  given there is nothing to write, and handing back the list is the whole
  job.
- **A cap she cannot see is the bug.** Forty pending and ten listed means
  saying forty and saying it cut.
- **Ambiguity is about WHICH PERSON, not how many rows.** `resolvePerson`
  already, unchanged.
- **One route, not a second path.** She writes the answer the panel writes,
  or the two disagree about what a month was told.

### One currency, every group, one month, 2026-09-10

Payment Overview's All view now breaks a hovered line down by group in that
line's own currency, every group listed including the ones at zero.

- **She should be able to answer "what did each group pay in GBP in
  September" without converting anything.** The figures are per currency
  already; it is a read, not arithmetic across rates.
- **A group at zero must be SAID, not omitted.** Silence reads as "that
  group is not in this view", which is a different fact and the one the
  admin is usually checking.
- **Never a total across currencies.** GBP 80,850, AED 54,343 and EURO 3,510
  is three answers, and adding them needs a rate the raw view exists to
  avoid.

### Deals by Stage is a filter now, 2026-09-10

The dashboard's ring and its three rows open the master sheet already
filtered to that payment period. `PERIOD_FOR_STAGE` translates the ring's
stage key into the sheet's period value, one definition in
`web/src/helpers/dashboard.js`.

- **She should be able to answer "which ones" after any stage count.** She
  already has the counts; what she cannot do is hand back the LIST. "19 not
  paying yet" and then a named list is the same question the ring now
  answers with a click.
- **The three words must match the screen**: paying, ended, not paying yet.
  Not active/inactive, and never "status": that is the company's own.
- **A count and a list must come from the same predicate**, the same way the
  colour, the total and the badge do. If she ever counts one way and lists
  another, the second one is wrong.

### The master sheet she exports is now a LIVE workbook

Built 2026-09-09. `masterSheet/sheetFormulas.js` writes four of the
single-tab export's columns as Excel formulas, so the file recalculates when
the boss edits it: appointment date drives payment start and end date,
those drive payable days, and that drives payable amount. The month tabs and
every payout template stay flat. See `state.md`.

**Her default columns already follow the setting.** `defaultHiddenFor` takes
`useEndDate` and `exportSheet.js` reads it once, so her panel and the export
modal preselect the same set. That was threaded rather than left to drift,
because a file whose payment start is red with no end date column beside it
explains nothing.

- **She should be able to SAY the file is live**, in one sentence, when she
  hands over a master sheet: that the dates and the payable figures follow
  the appointment date, and that typing over a cell breaks that link for
  that cell only. Nothing in her card says it today, so the boss gets a
  spreadsheet whose best feature is invisible.
- **She must NOT offer to change which columns are formulas.** The set is a
  decision recorded in `state.md`, not a preference: the three input columns
  stay literal because they are the ones he types into.
- **She must never describe the file as matching his own formulas.** It
  matches the CORRECTED ones. If she is ever asked why a figure differs, the
  answer is the preset month versus the end month, and it is worth up to
  Â£160 a head across 17 people.

### The dates a row is missing, and which of them are guesses

`shared/suggestDates.helper.js` works out what a missing appointment,
payment start or end date would be from whichever of the three the row
has, and marks each answer `forward` or `backward`. Nothing writes it by
rule. The Export modal offers it per row with Accept, and since 2026-09-08
so does the master sheet cell itself (`web/src/helpers/dateNotices.js`).
She still cannot see it at all.

- **Answer "what is missing on this row".** Read only, cheap, and it is
  already computed. She would say which date is missing and what the other
  two make it.
- **FORWARD AND BACKWARD ARE NOT THE SAME OFFER and she must say which.**
  Forward restates his own formula. Backward INVENTS an appointment date,
  which is a real day somebody was onboarded and not something arithmetic
  can recover. If she ever offers a backward one without that sentence,
  she has handed the admin a made up onboarding date as a fact.
- **She must not APPLY one.** `edit_deal` could write those fields today,
  so the guard is her prompt, and prompting is not a guard. If she is ever
  given this, the accept path needs to be a tool of its own that refuses
  the backward direction outright, not a sentence telling her to be
  careful.

0 of the 202 rows across his four reference files need the backward case.
It exists because it was asked for, and that is exactly why it is a
suggestion.

### `mismatchedDates` shows on the cell now, and she still cannot say it

Same helper. A row carrying an appointment where a stored date disagrees
with the formula: his own file has the INDIGO pair, paid a whole month
where appointment + 90 gives six days. It is not an error and is never
corrected, but it is the difference between a decision somebody made and
one nobody noticed. **The master sheet marks it on the cell as of
2026-09-08, with no Accept button.** She has no way to mention it.

- **Answer "which rows have dates that disagree".** Read only. One
  sentence per row: what it says, what the formula says.
- **NEVER OFFER TO CORRECT ONE.** The stored value is the money that was
  actually paid. The formula is the guess.

### A month on month answer, and never "last month" when it was not

The dashboard panel is now `Month on month Overview`: it leads with the
CHANGE (`â†‘ 3.8%`, `+$4,635.79`) and lists the preceding month, this one and
the forecast, each measured against the row above it. Nothing on the server
changed, so this is about what she SAYS.

- **Answer "how are we doing against last month".** The change and the
  difference, in one sentence, from the same two figures the panel lists.
  `changeBetween` is the one shape for a change; a tool that computes one
  hands back the finished sentence.
- **NAME THE MONTH, never "last month".** A past month is read from a saved
  snapshot or not at all, so a month with none is SKIPPED and the comparison
  walks further back. The CRM had exactly this bug: the card printed "vs
  last month" while comparing against August. She must say "vs August 2026",
  and say that September has no snapshot when that is why.
- **Refuse a ratio across currencies.** One percentage over three currencies
  is three numerators over three denominators in three units. Per currency
  it is exact and needs no rate, which is what the raw card now shows.
- **Never cap a percentage to make it fit.** The ratio this replaced was
  clamped to 100 so a ring could draw it, and a month that beat the one
  before read as exactly 100%.

She should not be able to CREATE a snapshot in conversation. That is the
scheduler's, or the typed-confirmation burn in Settings.

### Forecasting: what she HAS, and what it still gets wrong

Audited 2026-09-07. **She can already forecast**, and the `cannotYet` guard
that said otherwise is retired: it names `compare_months` as the tool that
would spend it, and that tool exists and is registered
(`tools/masterSheet.js`, `perGroup(compareMonths)`). The comment in
`cannotYet.js` still calls it "deliberately not built" and is now WRONG.

Already right, and not to be undone:

- `compare_months` covers past, current and future in one tool. Past months
  come only from snapshots, the current month from live rows, a future month
  from `projectMonth`.
- **`projectMonth` is SHARED with the dashboard.** She and Payment Overview
  project a month the same way, so they cannot disagree about the same
  future money. Adding a second projection anywhere is the bug.
- Every line labels its source: `saved actual`, `live current estimate`,
  `projected from current deals`, or `unavailable because no month snapshot
  was saved`.
- **FX is honest about which rate.** A saved month converts at that month's
  saved rate, a live or projected one at today's, and the line says which.
- Deltas are per currency, consecutive pairs, and name the currency even
  when nothing moved.
- She reaches it two ways: directly, and `total_for` hands any non-current
  month to it rather than answering from live rows.

Fixed 2026-09-07, and pinned:

- **A GAP IS NEVER BRIDGED.** `deltaLines` dropped the unusable months FIRST
  and paired what was left, so August, no September, October came back as
  "From August 2026 to October 2026: up GBP X, 1.9%": two months of movement
  reported as one step. Pairs are taken in the order asked now, and a pair
  with a hole in it is not drawn. Adjacency in the LIST, not the calendar:
  asked for January and June alone, those two are the step.
- **THE CAP SAYS WHEN IT CUT.** `MAX_MONTHS` was a silent `.slice()` inside
  `monthsRequested`, so a forty month ask came back as thirty six and said
  nothing. The ask is gathered whole and cut in the handler, which leads the
  reply with "Answering the first 36 of the 48 months asked for."
  `RANGE_LIMIT` only stops `rangeOf` looping over a two century range.
- **HER FORECAST AND RECALL ANSWERS ARE SHORT BY CONSTRUCTION.**
  `computedReply: true` returns the tool's own text verbatim with no model
  round, so the tool's terseness IS hers. One line per STEP with every
  currency named on it, rather than one line per currency per step: three
  months over three currencies was nine delta lines, six of them saying
  nothing had happened. What stays on every line is the figure, its
  currency, and its source, because a projected figure has to announce
  itself.

**The direction guard and the span total SHIPPED** on 2026-09-07/08, with
the pence and the percentage contract. `read_dashboard` is cancelled. What
is left is forecast work and is PARKED behind the current month: see
`backlog.md` item 13, and `state.md` for what shipped.

**HER HOME IS THE CURRENT MONTH**, user's own call: accuracy work goes
there and recall arrives little by little. No new recall or forecast
feature starts until the current month is right.

Her home is the CURRENT month. Recall and forecast are one bounded
extension on top of it, and ambiguity resolves to now.

### The conversion rates are ours to set now

`tb_fx_rates` (migration 051) holds a rate per currency, set in Settings,
and `shared/fxRates.helper` reads it whenever the live feed serves nothing.
She already converts through that helper, so her dollar figures follow it
with no change. What she cannot do yet:

- **Say where a rate came from.** `exchange_rate` reports the figure and its
  provenance for the live feed. It should say "the rate you set on 6
  September" when the source is `saved`, because a rate with an author is a
  different kind of fact from one off a feed.
- **Answer "what rate are we using for euros".** One currency, not the pair.
- **Refuse to quote a rate she cannot source.** A currency with nothing
  saved and no feed is unconvertible, and she should say so rather than
  reach for the peg.

She must never SET one. That is a Settings decision with an author and a
date on it, and a rate changed in conversation has neither.

### What changed in the CRM she has not caught up with

One left. The rest of this list is now in DONE.

- **Two more export designs**, `Converted to USD + Add ons table` and the
  named adjustment rows. Nothing to do until she can export, listed so
  whoever builds that knows the shapes exist.

### Her command center went gold, and the palette became one file

The screen she lives on was rebuilt to the user's reference: gold on near
black, a nav rail, a measured telemetry column, a projector plate and one
command bar across the foot. Nothing about her TOOLS changed, so there is
no new reach to ask for. Two things follow from it that are hers:

- **She should be able to say what state she is in and how she is doing**,
  because the panel beside her already reports it: last round trip, turns
  answered over turns attempted, live signal. Today only the screen knows.
  A read only `agent_vitals` tool would let "are you alright" and "how long
  are you taking" be answered instead of deflected. Cheap, reads nothing
  from the database.
- **A THEME SETTING FOR HER COLOUR, asked for and not built.** The orb, the
  command center, the login page and the loading page are all green today;
  a colour picked in Settings should become theirs. Every colour she uses
  comes from `web/src/configs/dianeTheme.js`, so this is one edit rather
  than hunting 177 literals: read that module's shape and override it. The
  canvas needs the hexes at init, so `ParticleOrb` and `LoginOrb` read the
  resolved value, not the module constant. Still a proposal, not
  permission.

### Her panels were compressed, and a deal opens in a modal

Nothing changed about what she can DO. What changed is what her output
looks like, and two of those are worth her knowing:

- **A deal list is chips now, and each one opens the full card.** She no
  longer needs to be asked to show a row that is already on screen. If she
  ever says "tell me which one and I will pull it up", that advice is now
  one click out of date.
- **Row ids in her prose are clickable.** She already puts `#47` in answers
  on purpose. That habit is now load bearing for the UI, so it is worth
  keeping in the prompt rather than tidying away.

Still nothing to build. Listed so a reader does not go looking for a gap.

### The CRM went yellow, and the two detail pages were relaid out

Nothing here changes what she can DO: same rows, same fields, same writes.
Two things follow that are worth her knowing about rather than building:

- **"Where do I find X" answers have moved.** A person's add on and fee now
  sit in a Breakdown card beside their companies rather than in a Profile
  card with their name, and Companies is a grid of cards with no table. If
  she ever describes where something is on screen, that is the new shape.
- **People's Export button is hidden** (`SHOW_EXPORT`). Her export tools are
  the master sheet's and are unaffected, but "click Export on People" is no
  longer advice that works.

### The Active company list

- **`active_companies` follows the new rule** (a company stays listed until
  its deals END, not until they stop being owed) because it shares
  `activeCompanies`. Nothing to build. Named so a reader does not go
  looking for a gap that is not there.

### SHE FINDS OUT TOO LATE THAT A CHANGE CANNOT BE UNDONE, 2026-09-21

**A PROPOSAL, not permission. Small, and it costs the admin a round.**

`revertFieldChange` refuses any field outside `COLUMN_FOR`, and `end_note`
and `review_monthly` are outside it by design: an import writes them, no
form does. She only learns this AFTER the confirm, so the exchange runs
"shall I put Richard's end note back?", "yes", "that one cannot be undone".
She says it plainly, which is right, but she asked first.

`findFieldChanges` now carries `revertible` per change, which is what the
History panel reads to show "Not hand editable" in place of a button.

**What she should be able to DO:** say it at the ASK, not after it.
`peekFieldChange` is the call she makes before confirming, so the flag
belongs there too, and `undo_master_sheet_change` should refuse before the
two call shape rather than inside it. Same reasoning as `notTwice`: the
guard belongs where the claim is made.

---

## OPEN, decided against for now

### Arithmetic on a figure she already has

"What is the difference between his INDIGO and MILKMAN totals" and "what is
10 percent of that". She has both totals and cannot subtract, because
figures are code and never the model. She now SAYS she has no tool for it
rather than dropping the question.

A `compare_totals` returning the finished sentence would close it. It is new
reach, so it waits for a yes.

### Ordering

"Who has the biggest payable amount", "the top five". `amountMin` exists,
ordering does not, and the page does not sort either. She reached for
`audit_master_sheet` and admitted it did not answer.

## DONE 2026-09-24: a group name may be used to pick a deal

Zayn's two deals are both on the company "Workforce", so the only way to
name one is by its GROUP. Told "Zayn's deal on milkman" she sent MILKMAN
as the company and reported it missing, twice, suggesting a spelling
difference that did not exist. The target is now re-homed onto the field
that matches among that person's own rows.

## DONE 2026-09-24: rates cannot be overwritten by accident

"Add 3%" on a 5% add on was written as 3, on the PROFILE when they said
the deal, and reported as "is now 3%". Rates take the two call shape at
both levels through one `settleRates`, the preview names the LEVEL, the
FROM and the TO, and `addonPercentDelta` exists so "add another 3%" needs
no arithmetic she has to remember.

A profile rate change is also LOGGED now, one entry per deal it reaches,
as `personAddonPercent`. It was written nowhere at all before, which is
why it could not be undone or even seen.

## DONE 2026-09-24: undo stopped calling field edits deletions

It decided undoability from a LABEL map, so six fields nobody had written
a word for were refused, `assignedOn` among them. `isUndoableField` on the
repo is the one authority now.

## DONE 2026-09-24: she cannot invent the field on a bulk write

Answered with a list of deals and no field, she chose
`overrideShouldBePaid = false`. Only the fields that decide whether
somebody is PAID must be named; ordinary instructions like "roll them
forward" are untouched. A scope short of what they named refuses too.

## DONE 2026-09-24: the special case RULE is answerable

"Explain why there's a special case" ran the totals tool. The rule now
exists in `explain_preset_rules` as something she can read out, and the
totals tool refuses a rule question.

## DONE 2026-09-24: an instruction is no longer answered with a lookup

Three phrasings of "make X a special case" behaved three different ways,
and `set quillon marsh payable days to 7` came back "Quillon Marsh's
payable days: 30". The hole was the computed reply shortcut, which ends a
turn on a tool's own sentence and so skips every reply guard.

`setIntent.js` denies it when the admin gave an IMPERATIVE and nothing
wrote. Which tools write is a flag ON THE TOOL (`writes: true`).

It costs a model round, never a write. `undo that` was the same fault and
is covered by the same guard.

## DONE 2026-09-24: she knows what the switch is called

`special_case_deal` was renamed and her card, her field description and her
prompt each carried a different old name, so "make Mayah a special case"
matched nothing and the nearest field by words drops the row out of a
payout instead. `shared/specialCase.js` holds the name, `web`'s
`configs/specialCase.js` is the other half of the contract.

## DONE 2026-09-24: the fee goes the right way in her prompt

Her prompt taught "THE FEE IS ADDED, NEVER DEDUCTED", the pre-047 meaning,
beside a tool that deducts it. `RATE_DIRECTIONS` is the one sentence now,
and its test checks it against `amountWithRates` rather than its own
wording.

## DONE 2026-09-24: four guards for things a sentence was doing

| | |
|---|---|
| `checkRelayed` | a deal dropped from a list she was told to relay verbatim |
| `checkPointed` | a pending export promised for a tool that is turned off |
| `alreadyDone` | a bare "yes" redoing a write that just finished |
| `countNoun` | "(1 row)" and "on 2 deals" read as values by two guards |

## DONE 2026-09-21: she briefs you at sign-in

**BUILT AND TESTED.** The orb, full bleed and scattered, speaking. No
transcript, nothing typing. Four counts in one request, each arriving as a
finished sentence; the same lines sit down the side as plain words, each a
link to the data. Skip bottom right, voice only for the yes or no.

- **SHE DOES NOT COMPOSE IT.** Every sentence is computed in
  `shared/briefing.helper.js`. A model call carries ~30,300 tokens before a
  word of conversation, and this is the one screen whose whole job is to be
  quick. A number she writes herself is also a number she can get wrong.
- **Nothing to report means no orb**, not a cheerful zero.
- **Off in Settings**, Whatbot section, migration 060.

**HER REACH DID NOT WIDEN.** This reads four counts that already existed
and it writes nothing. The tools she already has are what the side links
open.

**THE PROPOSAL, and it is yours to say yes to:** the same briefing on
request mid-session, "what needs doing", as a read only tool over the same
helper. It would be her saying at 3pm what she said at sign-in, with no new
reach: the same four counts, the same finished sentences.

## DONE 2026-09-21: the review queue pays the rates

**BUILT AND TESTED.** She read the queue out and Zayn came back at
**AED 3,809.52**. He is paid **4,000**: the stored wage with his 5% add on
left off. Reported live.

- **The cause was upstream of her.** `QUEUE_COLUMNS` never selected
  `addon_percent`, `fee_percent` or `payment_method`, so no reader of that
  queue could have rated a row. She was reporting the row she was handed.
- **All four of her review tools read `shared/reviewQueue.helper.js` now**,
  alongside the panel's route and the export warning. Six readers, one
  definition, the same arrangement `owedThisMonth` already has.
- **Her headline money is rated too**, and so is the export warning's,
  because `pendingThisMonth` sums the rated rows rather than asking SQL.

**Worth checking next:** every other tool of hers that prints a figure off
a query written for a different purpose. The rule is in `backend.md`: any
read model that prints money goes through `withRates` once, as early as
possible, and a missing rate column fails to apply rather than loudly.

## DONE 2026-09-21: she knows his end date words

**BUILT AND TESTED.** His September sheet writes prose in the end date
column on 31 of 92 rows, and the CRM dropped every one in silence.

- **`list_monthly_review` names HIS WORD first.** A block now reads
  *"Workforce, MANBAT, his sheet says "Reviewed monthly""* rather than
  implying a date passed. His word outranks liquidation and a past end
  date, because it is the most specific answer there is: he asked for that
  row by name.
- **The queue gained a third reason, `review_monthly`**, and it is the only
  one that is per deal. A past end date is a date; liquidation is all or
  nothing across a company. Richard and Klaud sit on a shared company and
  were unreachable by either.
- **`list_companies` learned the fifth status**, `going_concern`: trading
  and expected to keep trading, with no end date. Its `status` enum reads
  the repo's values, so it inherited the filter for free.

**Still not hers:** setting either column. `end_note` comes from his sheet
and `review_monthly` from the import or the company status screen, so
neither is in `COLUMN_FOR` and no tool can write one.

## DONE 2026-09-18: the review, hardened by talking to her

**His call: she can take as long as she likes, the review has to be right.**
A wrong answer here stops somebody's income, and it arrives dictated in one
breath. Five faults, every one found live against a green suite.

1. **A SCOPE HIDING INSIDE THE NAME, and this one was dangerous.** "Nathan
   Kryptonia keep running" arrived as person `Nathan Kryptonia`. There is no
   Nathan at Kryptonia, so the scope was IGNORED, the name alone resolved to
   a different Nathan on a different company in another group, and the tool
   tried to write it. Only `scratchOnly` stopped it. A trailing run of words
   that exactly matches a company or group ALREADY IN THE QUEUE is now read
   as the scope, longest run first. It cannot invent one.
2. **"ended" was an answer to one tool and not the other.** The bulk path
   read their own words; the single tool replied *"ended is not an answer"*.
   One vocabulary now, `ANSWER_WORDS`.
3. **Two instructions became two writes.** Answered with two calls to the
   single tool: two writes, two chances to stop half way, nothing to undo as
   one act. A second answer in one turn is turned back to `entries`, the
   first one named.
4. **A scope word matches a company OR a group**, wherever she puts it.
5. **"Close everything in manbat" said "no company called manbat"**, which
   is true and useless: it is a GROUP with three companies on it. The
   refusal now gives the exit and names the tool that does take a group.
6. **`stop_deal` asked an unanswerable question**, found while verifying the
   rest: *"Gloria holds 4 live deals: Workforce, Workforce, Workforce,
   Workforce. Ask which company they mean."* The company is what all four
   SHARE. Third place this shape appeared, so `resume_deal` was fixed in the
   same change rather than leaving a fourth. Both now name the company AND
   the group, and both gained `group`, so the question she asks can be
   answered at all.

**Verified live afterwards**, not just by test: "gary kp done and nathan
kryptonia keep running" now answers one deal for Gary and refuses Nathan
instead of writing to a stranger in another group.

## DONE 2026-09-18: the review, any scope, any answer, one message

**BUILT AND TESTED.** The review is dictated:

```
zayn milkman final
zayn indigo continue
paddy workforce ended
close everything in manbat
```

Every scope existed and every answer was ONE value across all of them, so
that was four calls, four confirmations and nothing to undo as one act.
`bulk_answer_monthly_review` takes `entries`, keyed on the DEAL: one person
can want different answers in two groups.

- **She never classifies the scope**, and a scope word is tried as a
  company OR a group. Found live on the first run: "zayn milkman final"
  put MILKMAN in `company`, matched nothing, and came back "not up for
  review" with the deal sitting in the queue.
- **Their own words are read**: continue, ongoing, ended, stop, done,
  close. A word that is not an answer refuses the whole message.
- **One pass, then the whole picture**: groups, then what needs deciding,
  then what matched nothing, then the totals. Same order every time,
  because a confirmation you cannot skim is one you say yes to blindly.
- **Every deal on its own line, and the untouched ones in a named group
  too.** No "all 6 deals". "Close manbat" and "close 3 of manbat" must not
  read the same.
- **Two entries disagreeing about one deal refuses**, naming it.
- **A scope with no person answers all of it. A person plus a scope still
  reaching several asks.**

**And the list had to be readable first.** It grouped on the bare company
name, so one person's four Workforce deals across four groups printed four
identical lines. `answer_monthly_review` gained `group` for the same
reason: that deal was refused by the single tool and swept up by the bulk
one, a refusal with no exit.

**A scope that matched nothing is no longer reported as answered.** It said
"everything for Gloria has been answered" when the scope simply missed and
four of her deals were unanswered.

## DONE 2026-09-18: she knows the first week rule

Asked live "when does someone appointed on the 3rd of august start getting
paid", she said "90 days, so around the 1st of November". Wrong since the
rule landed: it is 30 October, and the whole of October is owed.

`explain_preset_rules` carries both branches now, including that the payday
is the last Friday of the month for everyone.

## DONE 2026-09-18: "show both" described one person

Two cards drawn, a sentence about one:

> "James McCamley has one deal. The full details are on screen."

`runAgent` took the FIRST tool reply as the turn's answer. A second,
different terminal reply now disqualifies that shortcut: neither describes
the whole screen, so the round costs a model call and she writes a sentence
covering both. Verified live, she now names both people and their figures.

## DONE 2026-09-18: `say` was dead, and the speech cap was silent

Three tools set a `say` key and **nothing read it**. Deleted; their tests
now assert on `reply`, which is what actually reaches the screen and the
voice.

The speech route also cut at 4,096 characters with no notice. The caller
chunks well under it, so arriving over is a caller fault: logged as one,
still spoken. A failed chunk in the browser queue is logged rather than
swallowed.

## DONE 2026-09-18: she accounts for a month's difference

**BUILT.** "Why is Nicola bigger this September than past months" had half
an answer: `compare_months` printed the step ("up GBP 500, 5.2%") and
nothing could say what made it move.

It is not a cause, it is an ACCOUNT. `compare_months` now prints, under the
step, every deal behind the difference:

```
August 2026 to September 2026: up GBP 500.00 (17.24%).
What moved between August 2026 and September 2026:
  + GBP 700.00 added: Nicola, Relia, Mid 2
  - GBP 300.00 removed from the sheet: Nicola, Acqua, Dir 1
  - GBP 100.00 ended: Nicola, Leadstone, Dir 1, stopped 2026-08-31
  - GBP 200.00 not counted this month: Nicola, Workforce, Mid 1, preset is 2026-10
  + GBP 400.00 changed: Nicola, Northstar Care, Dir 1, add on up GBP 400.00
  GBP: that accounts for the whole GBP 500.00 rise, with nothing left over.
```

- **REMOVED, ENDED and NOT COUNTED are three different answers.** All three
  used to be "ended", on her and on the dashboard, so a live deal marked for
  October was reported as finished.
- **IT BALANCES OR IT SAYS SO.** A list of events that does not add up to
  the difference is an answer that looks right and is wrong. An unexplained
  remainder is a WARNING line telling her not to present it as complete.
- **A change names which part moved**, so an add on rising is never
  reported as the wage rising.
- **One definition, `shared/monthReconcile.helper`**, read by the dashboard
  too. She cannot disagree with the screen about the same month.
- **Per currency.** A GBP rise never cancels an AED fall.
- **The live current month is included**, which is the comparison actually
  asked for. It had no drivers at all before.

**Still not hers:** deciding anything about it. She reports the account.

## DONE 2026-09-18: a mid-turn line has to be covering something

One "hi" came back as TWO greetings. `say` puts a line on screen and lets
the round carry on; she used it to ask a question, then the reply asked the
same question again.

`interimLine.js`: a LONE `say` is never emitted (nothing to wait for), and a
`say` ending in a question is never emitted (she cannot ask and work at
once). A question mark inside the sentence is not the ask.

**Its own description already forbade both**, in those words. Prompting is
not a guard, and that is the third time it has been paid for.

**A refused line is reported to her as NOT DELIVERED.** Told it was
delivered, she would leave it out of the reply too and the answer would
vanish instead of doubling.

---

## DONE, last cycle

Everything shipped before 2026-09-18 has been deleted from this file, per
rule 1 above: a DONE entry is kept one cycle so a reader can see what
landed, then it goes. What the system now IS lives in `state.md`; the
reasoning behind each one is in the code beside the guard it produced.

---

## What she deliberately cannot do, and why

Kept here so nobody proposes it twice.

| | why |
|---|---|
| Create a person or a company | One exists because a deal names it. That is `add_deal`. |
| Guess which row | `search_master_sheet` returns every candidate. More than one PERSON stops her dead. |
| Total over a page | A cap on a total looks right and is not. Refused outright. |
| Upload a sheet, edit settings, read logs | Not hers. Say so if asked, do not attempt. Exporting is the exception and is OPEN above: it writes nothing. |
| Change a global rate | A crypto rate is one number for the whole system. It belongs to a person sitting in Settings, not to a sentence. |
| **Delete a person or a company** | **Tools removed 2026-09-14.** Nothing in the CRM can, not a page and not a route. Asked to, she says she cannot; she must NOT reach for `delete_master_sheet_row` in its place, which deletes a DEAL and is a different act. `state.md` "Delete versus Remove". |
| Write to an expense | Create, edit, archive and delete are the page's. She reads and totals only, and never adds one to a payout figure. See OPEN above. |
| Make a deal a SPECIAL CASE without a confirm | It moves a TOTAL, in the direction nobody audits. `confirmSpecialCaseDeal` makes it the two call shape, so the first call is inert. Migrations 064-065. |
| Special case or payable amount over a FILTER | The admin would agree to a count, not to the deals. Several NAMED deals is allowed, each line with its figure (`NAMED_DEALS_ONLY`, 2026-09-25). |
| Confirm ending ONE named deal | No confirm by design: one row, and resume_deal puts it back. A confirm there trains yes without reading. |

## DONE 2026-09-24: several people is ONE act

"Update Alex and Blake's add on to 5%" went wrong in both directions in one
session. She refused it ("I can't update both at once by name here"), and
when she did propose both, the runtime applied one of the two pending calls
and told her it was done: one person was written, her answer named both,
and nobody was told.

`update_person` takes `people` now. One confirmation, one set of writes,
every name resolved before anything is written, and one unknown or
ambiguous name stops all of it. Each person gets their own copy of the
fields, because a delta resolves against the person in front of it: a
shared object put the first person's new total on everybody after them.
Somebody already on the rate is NAMED as unchanged rather than dropped from
the preview, and a display name is refused across several.

The runtime half is `confirmReplay.recallAll`: one agreement applies EVERY
remembered call it covers, oldest first, each still having to pass
`alreadyShown` on its own.

## DONE 2026-09-24: a plain yes stopped being asked twice

The replay compares the pending summary's facts against her own last
answer. A summary writes a change FROM AND TO, always, and she says "to
5%": the 0 read as a change the admin had not been shown, so "yes pls
proceed" fell through to an identical second question. The value a change
is LEAVING is no longer required. The destination still is.

"5 of their deals" was also read as a value, because the count noun rule
needed the noun straight after the number. One determiner is allowed
between them now.

## OPEN

Nothing open from the rate work.

### The two data checks, in conversation, 2026-09-28

The welcome page now finds deals with **special case still on** and deals
**payable more than their monthly amount** this month
(`shared/briefing.helper.js`, keys `specialCase` and `payableOver`). She
cannot answer either when asked: "who still has special case on?" and "who is
paid more than their monthly?" need a read, from the same helper so the page
and her answer cannot disagree, naming each deal with both amounts. Read only.
A proposal, not permission.

## DONE 2026-09-28: her figures and her acts, audited by talking to her

Every tool that speaks money, on ZZTEST, then twice more live.

| Was wrong | Now |
|---|---|
| "Stop Suki's deal" switched her pay off, then said she was archived | Ending a deal is `stop_deal`, never a payment switch (`bulkIntent.endingNotSwitch`); saying stopped or archived needs a tool that stops (`checkClaimedWrite.claimedStop`) |
| "Who is up for review?" answered "Nobody" with no tool | An empty answer with nothing behind it is sent back once (`checkEmptyClaim.js`) |
| The Archive printed the raw wage, and added GBP to AED | Rated, one total per currency (`shared/ratedRows.helper.js`, `money.helper.moneyPerCurrency`) |
| The review queue's totals added currencies together | One total per currency, in all four places |
| A pay switch confirm quoted 3,000 for a 3,150 deal; `check_rates` ranged 700 to 900 for 686 to 882 | Both rated |
| "Total for ZZTEST" read "the whole sheet", or "no company ZZTEST" | The group is read from the sentence, and a group repeated as a company is dropped (`resolveDealScope`) |
| "What was stopped in ZZTEST" answered nothing | `list_stopped_deals` resolves a group sent as a company |
| "Total last month" answered September when she sent an invented month | The month in the sentence wins over hers |
| Stop, resume and the review answers counted as lookups | Flagged `writes: true` and `stops: true` |

Figures read "plus" and "less", never a sign that reads as a dash.

## DONE 2026-09-28: the welcome page reads you the cards

His calls, one after another the same day. What she does at sign in now:

1. **A count, then the card read aloud.** Each topic says its count, then every
   company with its deals ("Workforce 23, Relia PA 4, …"). No totals, said or
   shown: the pages carry those. Each entry lights as she says it. Flagged people are grouped by
   count, the word said once. The data checks read every deal with both
   amounts. The card and her voice are one list (`briefingAnswer.cardEntries`).
2. **Eight topics**: winding down, past a year, review this month, not marked
   paid, whatbot flagged, import checks, special case on, payable over monthly.
3. **A JARVIS HUD**, fixed cyan whatever the theme (`dianeTheme.JARVIS_HUD`):
   cut corner panels stacked in depth, the newest in front. Back, Next and a
   click on a card behind move through them.
4. **"Which one first?"** answered by voice with a topic word, yes or no.
5. **Live**: a row sorted while she talks is ticked, a new one tagged, and her
   closing line counts both.
6. **Her first line is made on the loading screen** (`speechCache.js`), so she
   opens speaking. The rest is requested 12 parts ahead: the voice service
   takes 3 to 9 seconds a request.

## DONE 2026-09-25: she takes her time, in code

Replayed the admin's own 34 turn test four times, then in the browser, until
every turn held. What she now cannot do:

| No longer possible | Held by |
|---|---|
| Ask "shall I?" with nothing prepared behind it | `checkUnbackedAsk.js` |
| Apply a proposal to any message but the next one | `confirmReplay.nextTurn` |
| Write on a "yes" to an answer that asked nothing | `invokeTool` |
| Quote a total while a change waits, or after one | `__pending`, the figure retry |
| Pick a deal, or a person, they did not name for money | `guessedDeal`, `namedBy` |
| Undo an undo on "undo that", or reach a deleted batch | `undoes`, the named fallback |
| Drop the Yes or No | `withVerdict` |
| Offer to go ahead after a bare "no" | `declined` |
| Say a rate moved the wrong way, or name the wrong rate | `checkRateDirection` |
| Put "take N% off" on top of a fee unasked, or mishear the answer | `feeAsk` |
| Call a removed deal one of the listed ones | recent changes, said apart |

## DONE 2026-09-25: the dead list, read only

Widened on his say so. Two tools, `tools/deadPeople.js`, nothing written:

| She can now | How |
|---|---|
| Say who is on the dead list, and how many, by name, phone or group | `list_dead_people` |
| Give one person's history company by company: roles, started, stopped, owed a month, what kept months recorded, contact and bank | `dead_person_details`, exact name first, two candidates is a question |

Figures come from `deadPersonJourney.helper.js`, the same as the page.
She cannot take anyone off the list: that is a deal added back.

"Take N% off" is a fee preview at once, and "yes" applies that fee. A rate put
beside `set` is moved into it. Previews read "fee 0% to 1%" and "paid: off
to on", never "(added)" or `to "true"`.

## DONE 2026-09-25: rates, audited by talking to her

Twelve scripted and six random conversations over ZZTEST people. What she
can do now, and what was wrong before:

1. **Undo a profile rate.** "Undo that" and "undo it for Ines only" put the
   PROFILE back, one press for the whole act. Refused if the profile moved
   since. Undo for a named person picks the newest change that holds them.
2. **A person's rate with no deal named is their profile**, one deal or
   nine. "Which company?" is no longer asked about a rate.
3. **"Take 5% off Bram" is a 5% fee.** Never a lower rate, never below zero.
4. **"Everyone at a company"**: a deal rate by bulk, each row shown FROM and
   TO; `check_rates` takes `company` and answers per person, for that
   company's deals only. A company sent as a group is re-homed.
5. **A rate question is answered with rates**, whichever tool she picked.

Runtime faults found and closed:

1. **She claimed writes nobody made.** "Already done" now needs a real
   write (its broadcast), never a question or a refusal.
2. **An unseen person was written.** Her own `confirmed` stands only for a
   pending the admin was shown and agreed to. Same rule for the runtime's
   replay, which also no longer confirms a pending born in the same turn.
3. **The bulk pending was invisible to the runtime**, so "yes" asked again.
4. **An invented name ("Bram Quennell") became Orla**, twice in one preview.
   Two names that are one person are asked about.
5. **The same undo was applied twice** on one "yes".

Figures she reads now agree with the pages: the People and Companies lists
and both detail pages rate their totals. Detail in `state.md`.

## DONE 2026-09-25: a yes or no about a rate is answered yes or no

"Is Dov on a 5% fee?" opens with a verdict worked out in code:
`rateChange.rateVerdict` gives Yes, No or Partly (a deal rate stacked on top),
with both figures. `check_rates` hands it over as the opening sentence, and
`checkVerdict.js` sends her back once if the reply does not carry it, or if she
answered with no tool at all. Several people get a line each; a company
narrowing says "at <company>". Any other rate question is unchanged.

## DONE 2026-09-25: bulk acts on any column, one clean confirmation

Tested end to end on ZZTEST, the database checked after every act.

| She can now | How |
|---|---|
| Make several NAMED deals special cases | `perPerson`, one entry per deal with its company. Each line names the month and the figure it adds |
| Add an amount to named deals | `add: { payableAmount: N }` (also `monthlyAmount`, `payableDays`), on one deal or per person. The tool does the sum; FROM and TO are shown |
| Set this month's payable by hand | Asks first, every field it moves from and to |
| Mark several people paid | One preview listing every deal |
| End deals up for review, keep one running | `bulk_answer_monthly_review` / `answer_monthly_review` |
| Close a company | `bulk_close_companies` |

**Special case and payable stay NAMED DEALS ONLY, never over a filter**
(`NAMED_DEALS_ONLY`). A person holding several deals is asked WHICH; the
answer completes the whole plan, so nobody named with it is dropped.

**The runtime makes the hand over.** Two people through the one deal tool in
one turn become one per person preview built by the runtime and remembered AS
that call, so one "yes" applies everyone. She never followed the instruction
to do it herself.

