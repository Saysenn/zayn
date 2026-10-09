# Where the CRM is now

What the system currently IS. Open work is in `todo.md`, designed-but-unbuilt
in `backlog.md`, anything runnable in `run-it.md`, getting it onto a server
in `deployment.md`, security findings in `sec-audit.md`, and what counts
toward a total in `totaling-audit.md`.

Migrations through `065` are written. Run `npm run migrate` from `crm/api`
to apply any pending migrations; this document describes the code and does
not assume a particular database has already been migrated. Migrations
047-048 add adjustment and crypto-rate fields, 049 adds immutable monthly
snapshots, 050 adds structured conversation memory to `tb_conversations`,
055 adds `tb_expenses`, 056 adds `stopped_on`/`stopped_reason`, 057 adds
`tb_monthly_review`, 058 adds liquidation to `tb_companies`, 059 adds the
fifth company status plus `end_note` and `review_monthly` on
`tb_mastersheet`, and **064-065 add `special_case_deal`** (as
`pay_this_month`, renamed the next day). Security findings are in
`sec-audit.md`.

## Pay is the person's; Payment received is what they said (2026-10-08)

His calls, one day. The master sheet is about deals; whether a PERSON
should be paid, has been paid and says the money arrived belongs to the
People pages. Storage did not move: everything is still on each deal, and
the People pages sum it, so nothing can drift. No migration.

**Should be paid and Paid are set per person.** Gone from the master sheet
(column, bulk bar, filters, the add/edit form). On People: a switch column
each, Yes/No in the bulk bar, and yes / no / mixed filters; on a person's
page, the same two switches in the Person card. A switch writes every LIVE
deal the person holds (stopped deals skipped). "Mixed" means their deals
disagree and shows as a faded switch. Read from
`shared/personPayState.helper.js`; written by `web/hooks/usePersonPay.js`
through the bulk update. The export's "should not be paid" fix sets the
whole person too (`wholePerson` on the bulk update).

**Payment received** (was "Confirmed") is the payday answer, `payment_outcome`:

| Stored                | Deal     | Person (summed over live deals)             |
|-----------------------|----------|---------------------------------------------|
| `confirmed`           | Paid     | Paid when every answered deal is            |
| `not_received`        | Unpaid   | Unpaid when every answered deal is          |
| `partial`             | Unpaid   | Portion (also for a mix of Paid and Unpaid) |
| `sent`, `no_response` | Awaiting | Awaiting when nothing is answered yet       |
| null                  | —        | — (never asked)                             |

Shown on the master sheet, People, the person page and the company page
(`components/badges/PaymentReceived.jsx`). An admin sets a deal to Paid or
Unpaid only.

**A portion, or a changed answer, waits for an admin.** `partial` no longer
turns Paid on. It, and a real answer replaced by a different one ("Paid to
Unpaid"), set `needs_review` with a reason starting `payday`
(`shared/paydayFlag.helper.js`). A no that whatbot's follow up upgrades to
partial is a portion, not a change. **Only setting the deal's Payment
received clears it.** A sheet upload carries it over, and "Save and mark it
sorted" clears the import's reasons only.

**Diane** reads people (`agent/tools/people.js`: `list_people`,
`show_person`), filters deals by Payment received and by payday flag, marks
a person paid / should be paid across all their live deals by default, sets
a deal's Payment received, and adds a person to several companies in one
preview.

**The briefing** has a Payday answers line, says "need a check" rather than
"the import", and its unpaid line opens People filtered to Paid: no.

## A group name sent as the company (2026-09-24)

Zayn holds two deals, BOTH on the company "Workforce", one in INDIGO and
one in MILKMAN. So the only way to name one of them is by its GROUP, and
that is what the admin did.

```
admin  "on Zayn's deal on milkman, at 3%"
Diane  targetCompany: "MILKMAN"
       "There is no deal for Zayn with the company named MILKMAN exactly.
        There might be a slight difference in spelling or spacing."
```

There is no spelling difference. Asked again in plainer words, she sent it
again and never once looked at the group column. Her prompt already says
to check the GROUP name before the COMPANY name, which is the sentence
being ignored.

**`narrowPersonDeals` re-homes a target onto the field that actually
matches**, among the rows THIS PERSON holds, so it can never reach
somebody else's company. Only when unambiguous: a word that is both a
company and a group on their own deals stays where it was put and falls
through to the question.

**And a word that matches nothing now NAMES their deals.** "No deal
matching NEXUS" was what sent her asking about spelling; the company, the
group and the role have all been checked by then, so it is not a typo.

## "Add 3%" was written as "set to 3" (2026-09-24)

Zayn carried a 5% add on.

```
admin  "add 3% on Zayn's add-on, on the Master Sheet add-on column"
Diane   update_person({ addonPercent: 3 })
        "Zayn's add-on percentage is now 3%."
```

September fell from AED 8,400 to AED 8,240 and nothing said so. Three
faults in one write, each separately enough:

| | |
|---|---|
| **The field is absolute** | "add 3" and "set 3" were the same call, so an increment could only be expressed by arithmetic she did against a number she remembered |
| **The level was wrong** | they said the MASTER SHEET column, which is the deal; she wrote the PROFILE, which is every deal they hold |
| **No from value** | "is now 3%" never said it had been 5%, so the one sentence that could have caught it did not exist |

Two turns later she said "Zayn already has a 5% add-on", reading the value
she had just overwritten.

**Rates now take the two call shape**, both levels, through one
`settleRates`. The preview names the LEVEL, the FROM and the TO:
`Zayn's PROFILE, which is all 2 of their deals: add on 5% to 3%`. That
sentence alone would have stopped it.

- `addonPercentDelta` / `feePercentDelta` exist so "add another 3%" has
  somewhere to go once she has been stopped. They are ARGUMENTS on the
  tool, never in `ROW_FIELDS`: as columns the bulk tool would accept them
  and the repo would drop them in silence.
- Sending both the absolute and the delta is refused, not resolved.
- `overwroteAnIncrement` catches the exact shape: they said "add 3", the
  row holds 5, the call carries 3. From zero the two are the same write
  and it stays quiet.

## A profile rate change was written nowhere (2026-09-24)

Why "nothing said it had been 5%" could not have said it: `tb_people`
writes went into no change log at all. No History, nothing for Undo, on a
figure that reaches every deal the person holds.

**The shape it needed deciding.** The log is keyed on `row_id` and a
profile rate has no single row. `row_id IS NULL` already MEANS the deal
was deleted, so that column could not carry a second meaning.

**One entry per deal, under a person level field name.** That is what the
change does: every one of those rows is worth a different amount
afterwards. `personAddonPercent` and `personFeePercent`, never
`addonPercent`, which is the DEAL's own rate and stacks with this one.

**Not undoable, deliberately.** `isUndoableField` says no, because putting
it back would have to reach `tb_people` and this log restores COLUMNS on
`tb_mastersheet`. Undoing one is `update_person`, which now confirms.

It is in `peopleRepo.upsert`, so the People page gets it too, and it never
throws into the write: a failed audit line must not look like a failed
save.

## Undo reported a field edit as a deletion (2026-09-24)

"Revert what you've done" on a special case toggle got "that was a
deletion, so it cannot be reverted". It was a boolean on one row.

`revertFieldChange` decides undoability with `COLUMN_FOR ?? RESTORABLE`.
Diane's undo tool asked a DIFFERENT question to decide the same thing:
whether it had a pretty LABEL for the field. So every field nobody had
written a label for was refused and misreported.

Six of them, and `assignedOn` is the appointment date the whole chain
derives from: `assignedOn`, `specialCaseDeal`, `endNote`, `reviewMonthly`,
`stoppedOn`, `role`. `isUndoableField` is now the one authority and
`FIELD_LABELS` is wording only.

## She picked the field they never named (2026-09-24)

One yes away from writing. She asked "which field and what value", was
answered with a LIST OF FIVE DEALS, and filled the unanswered half in
herself: `overrideShouldBePaid = false`, which takes a row out of every
payout total. The scope was three deals short as well.

**Only the fields that decide whether somebody is PAID** must be named.
The first version refused any unnamed field and went red on every ordinary
instruction: "set them all to September 2026" names a value and no field,
"roll them forward" names neither, and both are unambiguous.

`scopeMissesNamed` is the other half: they named Reliapay, KP and
Kryptonia, and the call reached Reliapay. A count they cannot check
against their own sentence is a count they agree to.

## Five answers that were wrong about their own question (2026-09-24)

| said | did | now |
|---|---|---|
| "explain why there's a special case" | ran the TOTALS tool, answered with an amount | the special case rule EXISTS in `explain_preset_rules`, and a rule question is refused by the totals tool |
| "what's the rule for these special cases" | restated one row's status | same |
| "which groups did you mean" | "only MANBAT and MILKMAN exist exactly like that" | a plural filter reached a check written for ONE name, so two real groups folded into `milkmanmanbat` |
| one panel, drawn twice | `drawnAlready` only compared against the PREVIOUS turn | lists dedupe within a turn too |
| "2 deals in MILKMAN and 2 in MANBAT" | MANBAT holds 3. The bare figure 2 WAS produced, so `checkCounts` passed it | a count is checked against the GROUP beside it |

And `"Nothing stopped for Reliapay,KP,Kryptonia matches that."`, which was
an array joined by JavaScript's default comma AND contradicted the panel
above it. Both were true: those deals are past their end date and none is
stopped. The sentence never said which question it had answered.

## Four found while testing the fixes (2026-09-24)

1. **A turn that WROTE ended on a lookup's sentence.** "Undo that" undid
   it, drew the row's card, and the card's "Odile Prang has one deal. The
   full details are on screen." became the whole answer. The undo had
   happened and nothing said so.
2. **A pending tool that could not be confirmed.** The rate confirm was
   added to `update_person` and the `confirmed` parameter was not, so
   `knownArgs` refused the confirmed call and she said it was done.
   Nothing was written and nothing could have been. Now reported as the
   bug it is rather than looking like a model failure.
3. **A conversational opener defeated the instruction guard.** "okay can
   you add 3%..." did not match an imperative at the start. Every opener
   in the transcript is allowed now.
4. **She read the tool's instructions out to the admin.** "Relay the block
   above EXACTLY as written" was read as "relay ALL of this", so a
   confirmation opened with "NOTHING HAS BEEN CHANGED YET". The LINES are
   verbatim; everything around them is hers.

## `tb_people` was outside the scratch guard (2026-09-24)

`scratchOnly` armed the master sheet repo and the review, and not the
people repo. `update_person` writes a rate that reaches every deal the
person holds, so a rate test on the live sheet would have moved a real
month: the same incident as above, caused by testing rather than found by
it.

**A person is scratch when EVERY deal they hold is.** Somebody with one
ZZTEST row and four real ones is a real person.

## An instruction answered with a lookup (2026-09-24)

Three phrasings of one instruction, against the real model, one scratch
deal each:

| said | did |
|---|---|
| `make ilsa trenow a special deal case` | proposed it, correctly |
| `make wren halliday a special deal` | drew her card, said "the full details are on screen", stopped |
| `make bram oakhurst a special case deal` | **"Bram Oakhurst's special case: No."** |

The third is the worst: the admin gave an instruction and was read back the
CURRENT value of the field they were trying to change. It reads like a
refusal and is not one, and in both failing runs the admin's next word was
taken as the go ahead for a change that had never been proposed.

**The hole was the shortcut, not the routing.** `find_and_show_details`
hands back its own finished sentence and `runAgent` ends the turn on it
rather than spending a model round retyping it. Every reply guard runs on
the model's prose, so a turn ending that way passes none of them. The first
correction looked right and changed nothing for two runs because of it.

`setIntent.js` denies the shortcut when the admin gave an IMPERATIVE and
nothing wrote. She gets the round, sees the card and the instruction
together, and proposes the change: what the run that worked did by itself.

- The imperative must be at the START. "set her days to 7" is an
  instruction; "what would happen if I set her days to 7" is not.
- Which tools write is a flag ON THE TOOL (`writes: true`), so a new one
  declares it where it is defined.
- **It costs a round, never a write.** `confirmSpecialCaseDeal` and the
  rest are untouched.

Same fault, same day, on `set quillon marsh payable days to 7` and on
`undo that`. One guard covers all three.

## The switch's name, said once per codebase (2026-09-24)

`special_case_deal` was renamed on 2026-09-23 and the toggle became "Make
this deal Special Case". Her card still said "Paid this month by hand", her
field description still led on "should be paid this month", and her prompt
told admins the card said a third thing.

So "make Mayah a special case" matched nothing she knew, and the nearest
field BY WORDS is `overrideShouldBePaid`, which carries no month and drops
the row out of a payout instead of adding it.

`api/v1/shared/specialCase.js` and `web/src/configs/specialCase.js` hold the
name, one per codebase, each pinning the literal in its own test. A rename
is now one edit a side.

## Diane never had Deal Status (2026-09-24)

It shipped 2026-09-22 and was never wired to her. Asked "how many deals are
reviewed monthly" she called `list_monthly_review` and answered with its
**17 unanswered** against the **12 rows** that carry the status: a confident
number, about a different question.

Deal Status is the PAIR (`end_note`, `review_monthly`) read by priority, so
a filter needed the same priority in SQL. `dealStatusSql` is that, branch
for branch beside `dealStatusOf`, and pinned against it over every
combination the two columns can hold.

```
active 60    going_concern 19    review 12
```

**READ ONLY, deliberately.** She can filter and say it; she cannot set it.
Setting writes two columns and can clear an end date, so it stays a click
until the user says otherwise. Proposed in `diane.md`.

`repo.findAll` gained `dealStatus`, taking one value or a list, and the
master sheet page narrows by it through the same param. **Two filters on
that page now end in the word status**, so each says which: `Company:` and
`Deal:`. The write hook was renamed `dealStatusWrite`, because one name for
a mutation and a query param on one page is how the wrong one gets passed.

## The three deleted deals are back, archived (2026-09-24)

`recoverFromSnapshot.js --write`, from the August snapshot. The upload diff
delete on 2026-09-20 took seven rows; four were replacements the same
upload had just inserted, and these three were not.

```
517  MILKMAN · Director · Lee croft · RP Backrunner 2
518  MILKMAN · Mid 1 · TLL · RP Backrunner 2
519  ALL GROUPS · Accounts · Sp · Workforce      GBP 8,400
```

**Live stayed 91, archived went 4 to 7, and September did not move**:
76,250 GBP before and after. Sp alone carries 8,400, so archived on arrival
is what kept the month honest. Each is logged `recovered` / `admin`, and
the provenance is in `notes`. Un-archiving is a decision on the Archive
page, which nobody has made.

## The fee direction was inverted in her prompt (2026-09-24)

`fee_percent` kept its name and inverted its meaning at migration 047. Her
prompt was still teaching the old one:

> THE FEE IS ADDED, NEVER DEDUCTED. 5% on 2,900 owed is 3,045.

beside a tool that deducts it and arithmetic in `rates.helper.js` that
deducts it. `RATE_DIRECTIONS` is now the one sentence, read by the prompt
and the `update_person` description, and its test checks the sentence
against `amountWithRates` rather than against its own wording: 2,900 at a
5% ADD ON is 3,045 to find, at a 5% FEE is 2,755 to hand over.

The old test pinned the wording literally, so the tool and the prompt could
drift apart without going red. They already had.

## A yes to something already finished (2026-09-24)

"set quillon marsh payable days to 19" wrote 19 and said so. The next
message was a bare "yes", answering nothing, and she called the same tool
with the same arguments and wrote 19 again.

Nothing caught it: `notTwice` is per TURN and this is the next turn, and
the replay memory only fires when something is PENDING. The values were
identical so no figure moved, which is luck. A finished write is now
remembered for ten minutes and a bare agreement may not repeat it, on an
EXACT match of tool and arguments. A repeated INSTRUCTION still writes.

## She promised an export that is turned off (2026-09-24)

`export_sheet` has been disabled since 2026-09-09 and hands back a pointer
to the Export button. Refused once, she answered the next message with:

> You want the bank master sheet for all groups in September, got it! But I
> need you to say "go" or "build it" to start the export.

A pending export, described in detail, for a tool that does nothing, one
turn after being told nothing was done and nothing is on screen.

Two causes. The export INTENT gate ran before the disabled handler and
answered "NO EXPORT CARD WAS OPENED", which implies exports exist; a
disabled tool now answers for itself. And "Say exactly that line and stop"
was a sentence, so `checkPointed` checks she named the button.

**The phrase, not the word.** The first version looked for "Export" and
passed the very sentence it was written for, because "start the export"
contains it. A BUTTON is what she points at, so the pointer is
"Export button" and the bare verb is not.

## A deal left out of a list she was asked to relay (2026-09-24)

`confirmFirst` sends `lines` when a COUNT is not enough to judge by: a
mixed act cannot be confirmed from a number, because one wrong line is
invisible in it. Its summary says to relay them, and that is a sentence.
Given a three person block she wrote her own sentence.

That one kept every name and value, so it was fine. Nothing checked the
next one would. `checkRelayed` compares the FACTS of each line against her
reply, so a rephrase passes and a dropped deal or a rounded figure does
not.

## A count of rows is not a count of days (2026-09-24)

Two guards read the same number the same wrong way on the same day.
`checkDays` read "10 payable days on 2 deals" as a second day count and
flagged a correct answer, which she then retracted. `confirmReplay` lost
every match on the bulk summary's per person "(1 row)", which she never
repeats.

The giveaway is the noun after the number. One definition, `countNoun.js`.

## Words in the end date column (2026-09-21)

His September sheet, `TECH UPDATED MASTERSHEET-1.xlsx`, holds prose in the
end date column on **31 of 92 rows**, and the CRM dropped every one in
silence: `end_on` came back null, the row was not flagged, and the import
diff said nothing.

**Two phrases, and they mean opposite things.**

| | rows | what null did |
|---|---|---|
| **Going concern** | 19 | correct. No end date is what it means |
| **Reviewed monthly** | 12 | **backwards** |

The review queue asked whether the end date had passed, so a null kept
those 12 out of the one screen meant to ask about them.

```
end_note        text      his words, drives the cell's tag
review_monthly  boolean   drives the queue
```

**Two columns, two jobs, deliberately not one.** The note only ever
displays; the flag is read by SQL. Driving a queue off free text would mean
a spelling change in his sheet silently emptying the review list. Same
split `payment_note` already uses for prose in the payment start column.

**The queue gained a third reason**, and it is the only one that is per
deal:

```sql
stopped_on IS NULL
AND ( end_on < this month  OR  company in liquidation  OR  review_monthly )
```

A past end date is a date, and liquidation is all or nothing across a
company. Richard and Klaud sit on Workforce, which also carries 19 "Going
concern" deals and two with a real date, so **no company status could ever
have reached them.**

- **A third phrase keeps its words, sets no flag, and FLAGS THE ROW.**
  Silence is how the first 31 were lost. The two he already uses do not
  flag: a third of the sheet on the review list every month is a list
  nobody reads.
- **`end_note` and `review_monthly` are NOT in `COLUMN_FOR`**, so no row
  PATCH carries them. The note comes from his sheet; the flag from the
  import or the company status screen.
- **Typing a real end date clears the note**, or the cell would print
  "Going concern" over a date. The flag is left alone: a deal can have both.

## Going concern is the fifth company status (2026-09-21)

```
active | going_concern | liquidation | dissolved | closed
```

His own word. **Not terminal**, so it behaves exactly like `active` for
money: `isTerminal` is the only test that branches on status and it names
dissolved and closed alone. It exists as a status so the Companies page can
be filtered to them, and it reads **green like active, never grey** — grey
is where closed and dissolved live, and the word means the opposite.

**The status screen is `CompanyStatusPicker`, a row of five, and BOTH doors
use it**: the Manage modal and the company detail page. Each status does
something different to the money and a select shows one meaning at a time,
so the row is the control and ONE sentence under it is the chosen status's
consequence. Five stacked cards with a meaning each was the first attempt
and it made a half column taller than everything beside it.

Under **liquidation** a checklist of the company's own deals appears in the
same modal, live, and the ticked ones get `review_monthly`. One Save writes
the status and the deals together: writing the status and then asking about
the deals is how half of it lands and the rest is abandoned on a closed
modal.

**The checklist is asked only where the answer can be saved.** The modal
passes `onReviewIds` and sends the ids with the status in one press; the
detail page writes on click, has no press to attach them to, and so passes
none. Its liquidation amounts stay with `LiquidationPanel`.

### The two id lists are INSTRUCTIONS, not columns

`reviewMonthlyDealIds` and `stopDealIds` tell the server what to do to the
deals. They were being spread onto the cached company row: two junk keys
nothing renders, while the thing they change sat on the server's last
answer. A closure repainted the word "Closed" instantly and left every deal
it had just stopped reading Active until the refetch.

**`web/helpers/companyCascade.js` paints what they DO**, and it is in
`helpers/` rather than the hook so it can be tested for real: a hook pulls
in React, so anything written inside one can only be read as text.

| | |
|---|---|
| review flag | set AND cleared in one pass, as the server does |
| a closure | stops the ticked deals, or all of them when no list came |
| an empty list | stops none, and is not the same as no list |
| a hand stop | never re-stamped, and never resumed by a reopen |
| the badge | DERIVED, so `payment_period` is recomputed from the new stop |

The optimistic date is the BROWSER's day and the server's is its business
clock, so the two can differ. What moves on screen is the badge, which
follows a stop having happened rather than which day; the server's date
lands on the refetch.

`setReviewMonthlyForCompany` **sets and clears in one statement**, so
unticking removes a deal as surely as ticking adds it. A write that only
ever added would make the checklist one-way.

## The end date cell says why it is blank (2026-09-21)

A small pill where the date would be, `badge-sm` at 10px, because the cell
is EMPTY: there is no value for an icon to sit beside.

| | tint |
|---|---|
| Going concern | green, trading, nothing to act on |
| Reviewed monthly | amber, somebody must answer it this month |
| a phrase it does not know | red, the date is empty and the words are not a value |

**The deal's note is read BEFORE the company's status**, and Workforce is
why: 19 "Going concern", 2 "Reviewed monthly" and 2 real dates, on one
company. No single status can say that.

`StatusBadge` gained `size` and `label`. The label overrides the **word**
but never the colour, so his phrase prints verbatim while the class comes
from a known key: arbitrary text would build class names with spaces in it.

## Diane's briefing at sign-in (2026-09-21)

**NOT THE OLD GREETING SCREEN.** That one made you CHOOSE a destination and
was removed on purpose; a sign-in still lands in the CRM and Ask Diane is
still how you reach her. This tells you what needs doing, asks one question
and gets out of the way.

`GET /api/v1/briefing`, **one request, four counts**, in the order she says
them: money first, tidying last.

| item | count from |
|---|---|
| review queue | `reviewQueue.helper` `pendingThisMonth`, rated |
| not marked paid | `countsTowardTotal` over the live rows, rated |
| open concerns | `concernsRepo.listGrouped` total |
| flagged rows | `masterSheetRows.repo` `counts()` |

**SHE DOES NOT THINK ABOUT IT, SHE READS IT.** Every item arrives with its
FINISHED SENTENCE. A model call carries ~30,300 tokens before a word of
conversation, and a number she composes is a number she can get wrong.

**EMPTY MEANS NOTHING HAPPENS.** No orb, no pause. Off and quiet take the
same path, so there is one behaviour to get right rather than two.

**No routes in the payload.** The server sends a `key`; which page shows
flagged rows is the router's business. Written twice as a contract,
`briefing.helper.js` `SAY` and `web/agentOrb/briefingAnswer.js`, each side
pinning its own four keys.

**Unpaid lands on People, filtered to Paid: no** (since 2026-10-08). Paid is
the person's now, and the People filter offers yes / no / mixed as real
choices, so "no" is a filter with its own control showing it. Before that it
landed on the master sheet's deals in period, because the master sheet's
Paid checkbox could only narrow to PAID.

**Voice only for the yes or no**, and that is safe only because the side
lines and Skip exist: a denied microphone loses the question, never the way
out. The mic opens after she stops speaking, never during, and closes
itself after 12 seconds.

**The orb gained `spread`.** `formIn` and `explode` both decay to zero, so
nothing could hold the field open. Rotation now follows her live amplitude
**while speaking only**, off under reduced motion. `density` finally has a
caller: it was written for a full screen greeting and lost one.

Off in Settings, Whatbot section. Migration 060, default on.

## A NEW SETTINGS COLUMN MUST NOT BE ABLE TO TAKE THE APP DOWN (2026-09-21)

`login_briefing` went into `settingsRepo.get()`'s SELECT. **`get()` is read
on nearly every request path**: exports, totals, the review queue, Diane. A
deploy that ran 059 and forgot 060 would have 500'd all of it over a switch
for a greeting. Caught by the suite, as `column "login_briefing" does not
exist`.

**A column the hot path does not need is read on its own.**
`settingsRepo.loginBriefing()` asks for it alone, and an `undefined_column`
(42703) means the migration has not run: the feature takes its default and
nothing else notices. **Only that code is caught**, or a dead connection
becomes a briefing that quietly never appears.

## She starts speaking before the whole answer is synthesised (2026-09-21)

The review queue is **1,696 characters**. `CHUNK_CHARS` is 3,500, so it was
ONE request: not a word was heard until all of it came back, with the text
on screen the whole time. And the queue could not hide it, because
`useOpenaiSpeech` asked for part N+1 only once part N had finished
**playing**. Nothing was ever fetched ahead.

**TWO HALVES, AND NEITHER WORKS ALONE.** A small first part with no fetch
ahead just moves the wait to the first seam; fetching ahead with one 3,500
character part has nothing to fetch.

| | |
|---|---|
| `TTS_FIRST_CHARS` 180 | the opener, about one sentence |
| `TTS_CHUNK_CHARS` 900 | the rest, roughly six seconds of speech each |

That block measured before and after: **1 request of 1,696 characters**
becomes **3 of 159, 879 and 650**, and the first thing she says is the
headline. Only the first request is a wait anybody sits through; every
later one is fetched while the part before it plays. Making them all small
would multiply the requests for no gain.

**ONE REQUEST IN FLIGHT AHEAD, never all of them.** A thirty part answer
would otherwise open thirty connections for audio minutes away from being
wanted.

**And muting now mutes.** `cancel` reset the queue, but the chain was
already built, so a part still in flight would land and play into a muted
session. A generation counter stops it.

The other half of the wait is separate and not fixed: **~30,300 tokens of
prompt and tool schemas on every model call**, before a word of history.
See `docs/todo.md`.

## The review queue printed the RAW wage (2026-09-21)

Diane read the queue out and Zayn came back at **AED 3,809.52**. He is paid
**4,000**: the stored wage with his 5% add on left off. The panel showed the
same figure and the export warning totalled it.

**The cause was upstream of the printing.** `QUEUE_COLUMNS` never selected
`addon_percent`, `fee_percent` or `payment_method`, so the queue could not
have rated a row even if it had tried. `rates.helper.js` says a row goes
through `withRates` ONCE, as early as possible; the queue was the one read
model that never did.

**`shared/reviewQueue.helper.js` is where it goes through now.**

    dueThisMonth()     ─┬─→ Diane's four review tools
                        ├─→ the panel's route
                        └─→ the export warning
    pendingThisMonth()  the Review button and the warning's money

Six readers, so it cannot be per reader: a rate applied in five of them is a
figure that disagrees with itself. Same lesson as `owedThisMonth.helper.js`,
in a second place.

`pendingThisMonth` replaces the repo's `pending`, whose sum is SQL side and
so cannot see a rate. The count is identical either way; the money is not.

## A passed end date is a REVIEW, never a closure (2026-09-21)

The popup on that cell used to say the row was still counting and point at
the Settings toggle. Wrong on both counts. **The end date ends nothing.** A
company's life is its status; a deal's is decided by answering it in the
Review list, by us or by Diane.

So it reads **Up for review this month** and says the sheet's own
appointment plus one year ran out. That is the truth of the row:
`monthlyReview.repo.js` `DUE_SQL` makes an end date before the month the
FIRST of the queue's three reasons.

**Two popups share that label now**, the passed date and his "Reviewed
monthly", because both are true. The BODY is the reason and it is what
differs, so that is what the tests read.

Still shown only while `color_uses_end_date` is off: with it on the row
already reads Ended and its amount is OUT of the total, so "still in the
total" would be false. The queue holds it either way. The setting is going,
see `unwire-end-date.md`.

## A typed base rule outscored `sr-only` (2026-09-21)

`input[type='checkbox']` scores **(0,1,1)** and `.sr-only` scores (0,1,0),
so the new white-box-and-green-tick rule beat it. Two controls hide a REAL
checkbox behind their own artwork, to keep the keyboard behaviour, the
focus ring and the screen reader announcement a styled `<span>` throws
away: `FilterCheckbox` and the login's Remember me. Both grew a 16px box in
front of the thing they draw.

**`input:where([type='checkbox'])` is (0,0,1)**, so any utility on the
element wins. Same fix and the same reasoning as the `input:where(:not(...))`
rule six lines above it, which exists for exactly this and had already
written the warning down.

The `::after` marks stay bare: they paint inside a box that `sr-only` has
clipped to nothing, so they cannot show.

## A colour class Tailwind does not know compiles to nothing (2026-09-21)

No error, no warning, no style, and the element still renders. Three
invented tokens had shipped this way:

| class | what was missing |
|---|---|
| `bg-surface-subtle` | the liquidation panel had no panel |
| `hover:bg-surface-hover` | row hover dead on Companies, Flagged, People |
| `border-line` | 9 table separators falling back to Tailwind's grey |

Every one is a PLAUSIBLE SIBLING of a real token, which is why reading the
diff never caught them. Real names: `surface-sunken`, `border`,
`border-strong`.

**The guard is `web/src/configs/colourTokens.test.js`.** It reads
`tailwind.config.js` as the allow list and checks every colour class in
`src`, so a new token is one line in the config and a typo is a red test.
It scans CLASS STRINGS only: reading whole files matched prose in comments
and reported two phantom failures.

## A class name nothing spells out is dropped from the build (2026-09-21)

The sibling of the fault above, and it survived that fix. Tailwind's
content scan reads source TEXT. `StatusBadge` builds `` `badge-${status}` ``,
so no file contains `badge-going_concern` and its `@layer components` rule
is purged. Same silence: the badge renders as bare text.

**Eleven of the twenty were dead in production**, found by reading
`getComputedStyle` off the live page and confirmed against the built
stylesheet. Only `badge-liquidation` survived, because two files happen to
write it out in full. Among the dead: the end date pill, `going_concern`
and every payment outcome.

This had been "fixed" once before by writing the missing CSS. The CSS was
never missing.

**The keys live in `web/src/configs/badgeKinds.js`** and
`tailwind.config.js` reads them into `safelist`. Adding a badge is one line
in one file. `badgeKinds.test.js` checks the map against the rules in
`index.css` in BOTH directions: a rule with no key is purged, a key with no
rule prints plain. `colourTokens.test.js` stayed green throughout, because
it asks whether a token exists, not whether the class survives.

## A saved end date must clear the note in the cache too (2026-09-21)

The server drops `end_note` the moment a date is written, so a patch
carrying only `end_on` left the cache disagreeing with the save: 31
December stored, "AUGUST TBC" still on screen until a refetch. The toast
said it had worked, and it had.

`useMasterSheet.js` `withEndNote` mirrors it, and covers the derived case
as well: `recomputePayable` adds `endOn` to the server's own patch when the
appointment cascade moves it, so an appointment edit clears the note too.
**Clearing a date leaves the words**, which still explain the blank.

A DELIBERATE MIRROR: the api pins its half in `endNoteImport.test.js`, the
web its own in `hooks/endNotePatch.test.js`. Neither reads the other.

## Two things that offered a button that could not work (2026-09-21)

- **History's Undo, on an import's end note.** `revertFieldChange` refuses
  any field outside `COLUMN_FOR`, and `end_note` and `review_monthly` are
  deliberately outside it: an import writes them, no form does. Every press
  came back 409, which reads as a broken button rather than as a rule. The
  change list now carries `revertible` and the panel says "Not hand
  editable", the same way it already says "Deal deleted".
- **The liquidation checklist, on a company already in liquidation.** It
  defaulted to all every time it opened, so it re-ticked what somebody had
  deliberately unticked. Acqua stored two of three and opened showing three
  of three. `CompanyStatusPicker` now takes `savedStatus` and seeds from
  each deal's own `review_monthly` once the question has been asked.
  Entering liquidation still means all of it.

## A first week appointment is paid in month 3 (2026-09-18)

His call: "it is unfair to make someone wait 4 months."

`appointment + 90` tips a first week appointment just past the end of month
3. Appointed Mon 3 Aug, +90 is Sun 1 Nov, so October pays nothing and the
first money arrives at the end of November. Checked across two years: for a
day 3 appointment, +90 lands on the 1st to the 4th of month 4 in **eleven
months out of twelve**. It is systematic, not an edge case.

```
week 1        = appointment day <= the FIRST FRIDAY of its month
week 1        → payment start = LAST FRIDAY of month 3, whole month owed
weeks 2 to 4  → appointment + 90, pro rata. Unchanged
end date      → appointment + 1 year, both branches
```

**Week 1 is up to and including the first Friday, his definition**, and the
rhythm his own operating document runs on ("the first Friday of each month"
appears against four separate groups). Never "days 1 to 7", which reaches
into the second working week in months that start late: in September 2026
that would sweep in Monday the 7th.

**The stored date is the PAYDAY**, the last Friday, because that is what he
wants on the sheet. So the day count does NOT follow from it: counted from
30 October it would be two days. `payableDaysFor` forces the month's own
length while the preset is month 3, and **only** month 3. From month 4 the
stored start sits before the month begins and his own formula returns a
full month unaided.

**The export carries his own expression, not ours.** The file is live, so
the ordinary chain would recalculate to two days on open and quietly undo
the rule in the one file he reads. Month 3 of a first week row gets
`=DAY(EOMONTH(G,0))`, which is the middle branch of his own formula with
the condition dropped. Still live: move the preset to a 30 day month and it
says 30.

**And the START cell too, which is how this was nearly shipped broken.**
Building the file and reading it back showed `=E+90` on every row, so a
first week deal carried a CACHED 30 October under a formula saying 1
November: Excel recalculates on open, the date flips, and a re-upload then
stores the wrong one. The day count survived it, because it reads the
preset rather than that cell, so **the money was right and the date was
wrong** — the harder kind to notice. It is
`EOMONTH(E,2)-MOD(WEEKDAY(EOMONTH(E,2))-6,7)` now, verified against the
helper on both year boundaries and a leap February.

**No new column, anywhere.** A `CellInfo` on the payable days cell explains
why 31 sits beside a start of 30 October.

**Re-derived across all 32 existing week 1 rows**, his call. Safe on this
month's figure: all 32 were appointed in 2024 and 2025, so their start was
already in the past and they were counted in full. Verified, September does
not move.

`shared/fromAppointment.helper.js` and its `web/src/helpers/fromAppointment.js`
mirror, each pinned by its own test with the same cases written out on both
sides.

## The review answers many scopes in one message (2026-09-18)

The review is dictated, not clicked:

```
zayn milkman final
zayn indigo continue
paddy workforce ended
close everything in manbat
```

Every scope existed and every answer was ONE value across all of them, so
that message was four calls, four confirmations and nothing to undo as one
act. `bulk_answer_monthly_review` takes `entries` now, keyed on the DEAL
rather than the person: one person can want different answers in two groups.

- **She never classifies the scope.** The fields she fills in ARE the scope,
  and **a scope word is tried as a company OR a group**. Live on the first
  run: "zayn milkman final" arrived with MILKMAN in `company`, matched
  nothing, and was reported back as "not up for review" with the deal
  sitting in the queue.
- **One pass, then the whole picture.** Every fragment is resolved before
  anything is shown, so a bad line does not send the admin back for one
  correction at a time.
- **Two entries hitting one deal with different answers refuses**, naming
  it. The real risk in a mixed message is scopes that overlap unnoticed.
- **Every deal on its own line, and the untouched ones too.** "Close manbat"
  and "close 3 of manbat" must not read the same.
- `confirmFirst` gained `lines`, relayed verbatim: a mixed act cannot be
  confirmed from a count, because one wrong line is invisible in a number.

**The list groups by company AND group.** It grouped on the bare company
name, so one person holding four Workforce deals in four groups printed
four identical lines. Nothing told them apart and no tool could reach one.
That is the identity rule the rest of the CRM already uses.

**A scope that matched nothing is not a finished queue.** The empty branch
said "everything for Gloria has been answered" when the scope simply missed.
Four of her deals were unanswered. A wrong fact about somebody's money,
produced by her guessing which field a word belonged in.

## An edit that would wipe a typed payable amount asks first (2026-09-18)

Typing into Payable amount wins in its own patch and was then **silently**
recomputed by the next edit to any of its five inputs: monthly amount,
payable days, payment start, preset, appointment. Somebody sets 5,000 by
hand, moves the appointment a week later, and the row quietly reads
1,935.48 with no warning and no toast.

Odd asymmetry it removes: that same figure IS protected from an upload.

- **It fires only when a HUMAN claimed the column.** A derived value is
  never claimed (`repo.update` excludes the derived keys on purpose), so it
  stays quiet on the ordinary row. Without that it would ask on every date
  edit and everybody would click through it.
- **Three answers**: recompute, keep my figure, cancel. `ConfirmDialog`
  gained an optional second action for it, since forcing one of two valid
  answers into Cancel would make Cancel mean two things.
- **"Keep" needs no backend change.** Sending the current `payableAmount`
  alongside the edit makes `recomputePayable` return early.
- **Both figures are named.** "Will recompute" is abstract; "5,000 becomes
  1,935.48" is a decision.

## Why a month moved, and it has to BALANCE (2026-09-18)

`v1/shared/monthReconcile.helper.js`. "Why is she bigger this September"
is not a question about a cause, it is an ACCOUNT: every pound of the
difference named, and anything left over SAID rather than absorbed.

**Five buckets, and they are not the same fact:**

| | |
|---|---|
| `added` | a deal that was not there last month |
| `removed` | the row is gone from the sheet entirely |
| `ended` | still on the sheet, stopped or past its end date |
| `notCounted` | still live, but this month is not its month |
| `changed` | the same deal, a different figure |

**`snapshotDrivers` had THREE, and that was a live fault on the dashboard.**
Everything absent from the later month landed in `ended`, so a live deal
marked for October was reported as ENDED. Three different facts wearing one
word.

**THE BALANCE IS THE FEATURE.** The buckets must add up to the difference,
per currency. `residual` carries whatever does not, and it should always be
zero: a non-zero residual is a bug in the helper, and showing it is how
anybody finds out. `RESIDUAL_TOLERANCE` is one penny, for float noise only.

- **Per currency, never one figure across them.** A GBP rise cancelling an
  AED fall is a number that describes nothing.
- **A change names WHICH PART moved**: amount, add on, crypto charge, fee.
  `net = amount + addon + crypto - fee`, so the parts sum to the delta
  exactly. On the net alone, an add on going up reads as the wage going up,
  which is a different conversation with a different fix.
- **It never decides for itself.** `isOwedThisMonth` and `isForMonth` say
  whether a row counts; this only asks WHICH of them said no.
- **Two deals sharing one identity makes it unavailable**, not a guess. A
  row with no group duplicates itself, and picking one of the pair would
  report a phantom ending.
- **A flat month with movement in it says so.** Five changes netting to
  zero is the surprising case, and it used to fall silent.

**The live current month has drivers now.** They only existed on saved
months, and this month against last is the one comparison anybody asks
about. `livePoint` reconciles its own just-computed figures against the last
saved snapshot. `useEndDate` is taken from the LATER month's own stored
settings, so a settings change since cannot rewrite why an old row fell out
of an old month.

**Diane answers it off the same function.** `compare_months` prints the
account under the step it already printed, as finished sentences, capped at
`ACCOUNT_MAX_LINES` with the true count when it cuts.

## A mid-turn line has to be covering something (2026-09-18)

`v1/agent/interimLine.js`. `say` puts a line on screen and lets the round
carry on, so a four second lookup is not four seconds of nothing. One "hi"
came back as two greetings: `say` asked a question, the round then ended
with a reply asking it again.

Two refusals, and neither names a phrase:

1. **A LONE `say` IS NEVER EMITTED.** With no work beside it there is
   nothing to wait for, so the line is the answer arriving early.
2. **A `say` ENDING IN A QUESTION IS NOT AN INTERIM.** She cannot ask and
   work at the same time. A question mark INSIDE the sentence is not the
   ask: "Ready? Let me check" is a line before work.

**Two kinds of call are not work**, both read off the tool rather than a
list of names: `interim` (the line itself) and `changesNothing`
(`state_claims`, which looks nothing up and draws nothing). Without the
second, `say` plus a claims call read as a busy round.

**A refused line cannot be reported as delivered.** `say`'s own summary
tells her the admin already heard it; left in place on a line nobody saw,
she leaves it out of the reply too and the answer goes missing. `runAgent`
swaps in a summary saying it was not shown.

**Its description already forbade both.** Prompting is not a guard.

## She reads everything she says (2026-09-17)

`speakableReply` used to truncate: four lines or more spoke the FIRST LINE
only, and a first line that looked like a heading was replaced with "that
one is a long one, so it is on screen for you to read". The longer the
answer, the less she said, and the one sentence she did speak was an
apology for not speaking.

**It reads the whole reply now.** No length test, no shape test. It stays a
function so what she speaks has one home.

**Both voices split, neither trims.** The OpenAI path already chunked at
3,500 characters and queued the parts. The browser fallback spoke one long
utterance, which SpeechSynthesis abandons part way through with no error,
so the reply was on screen in full and the ear got the first few sentences.
Same `chunkForSpeech`, smaller budget, parts queued in order.

**A card, a list and a form are still DRAWN, not spoken.** Each arrives with
a sentence of its own that is.

## Nothing reaches the screen until the turn commits (2026-09-17)

She wrote an answer and then instantly replaced it. `streamCompletion`
emitted the cleaned text as it arrived, and three things could overwrite it:
prose sent in the same message as tool calls, a GUARD RETRY streaming a
second answer over the first, and a tool's computed terminal reply. The
client never cleared between rounds, so it happened in place, mid sentence.

**It streams and says nothing now.** The turn's one answer is what
`runAgent` returns, after every guard has passed. Suppressing it only when
there are tool calls would have fixed one of the three and left the other
two, and every guard added later would be a new way to show a wrong answer
first: the rule has to be about COMMITMENT.

The latency that streaming covered is covered by `say`, which she calls
deliberately and which is final the moment it lands.

**It broke the auto scroll, and that is fixed too.** The conversation
measured its distance from the bottom INSIDE the effect, which runs after
the new message is laid out. While the reply grew token by token that
worked. Landing whole, a five line answer put the bottom hundreds of pixels
away on the first measurement, so it read as "they have scrolled up to
read" and never followed. A scroll listener records the position
continuously now, and the effect reads what was true BEFORE the message
arrived.

## A card cell is the unit of an answer (2026-09-17)

`dealCard` is no longer only what the screen draws. It is the list of what
a deal HOLDS, and `fieldAsked.js` answers a question from it, so a column
reachable on the card is a column she can be asked about. Adding a cell is
how a field becomes answerable; there is no second list of column names.

A cell carries its label, its value, and optionally the **closed set its
value comes from**. That set is the repo's own (`COMPANY_STATUS`), so a new
status is answerable the day it is added.

Three ways a sentence reaches a cell, in this order:

1. **Its label's words**, all of them, in any order, with plural, stem and
   prefix tolerance. A single word label of four characters or fewer needs
   a whole word, or `End` matches inside "weekend".
2. **Its current value.** "Is he active" names no label. Group, company and
   role are excluded: they are the deal key's parts and are how a row is
   NARROWED, not asked about.
3. **Its vocabulary**, and only to strengthen a label already half matched.
   "Is his company LIQUIDATING" is `company` plus a status word. On its own
   a status word names nothing, or "is he active" would be answered about
   the company.

**A narrowed ask gets a narrowed answer**: naming a field answers the value
and draws NO card. The precedent is the bank branch in the same file, where
the cards were the answer to a question nobody asked.

**Two cells that hold the same word go to the plainest one.** "Active" is
the value of `Status` and one option of `Company status`; the unqualified
word takes the unqualified cell.

## One message, different values, one confirmation (2026-09-17)

"Gloria 10 payable days, Paddy 0, Nathan's preset to September" is three
different values in one sentence, and she had no tool for it. The bulk tool
set ONE value across many rows; the single tool did one row per call. So it
became three writes, three confirmations, three chances to stop half way,
and nothing to undo as one act. The admin dictates like this constantly.

`bulk_update_master_sheet` takes `perPerson` now: a list of
`{ person, set }`, resolved through `saidFor` so each name is settled
against the sentence rather than the longest match winning every entry.

- **One preview, a LINE PER PERSON.** A count would hide that they are
  different changes, so a wrong value could not be picked out of the rest.
- **Every guard the single-value path has, per entry.** A per-person column,
  a derived field, a name that matches nobody, an entry with nothing to set,
  a guessed year: any one of them refuses the WHOLE change.
- **The payable amount is recomputed per person**, the same as every other
  door.
- **A row that did not take is NAMED**, never averaged into a count.

**And she has to REACH it.** Live 2026-09-17: "set gloria to 10 payable
days and paddy to 0" was answered with two single-row edits. The feature
existed and she went past it, which is the same shape `list_companies` had:
built, not routed. A description is not a route, so `secondPersonInTurn`
turns back the SECOND name-addressed edit in one turn and names the tool
that does both at once.

It is narrow on purpose, and both narrowings came from breaking it:

1. **Only SHAREABLE columns.** A phone number belongs to one person and
   `perPerson` refuses it, so redirecting it would be a dead end: turned
   back here and refused there.
2. **Only NAME-ADDRESSED edits.** Two row ids being given the same value is
   a loop the bulk filter path already covers, not this.

## Deleting by name, and several at once (2026-09-17)

`delete_master_sheet_row` took a row ID ONLY, so deleting somebody meant a
lookup first and a number copied between turns, and five rows was five
confirmations with nothing tying them together. An id is precisely the
argument she cannot sanity check: the wrong one takes somebody's payroll
history and there is no undo for it here.

It takes `people`, `ids`, `group` and `company` now, behind the same
`confirmFirst` shape as every other destructive write.

- **The preview names every row**: person, company, group and id.
- **A name that matches nobody refuses the WHOLE delete.** A miss is
  invisible in a count, so nobody would know somebody had been left out.
- **An id not in scope is refused with its reason**, "carried over from an
  earlier answer", which is how the wrong row goes.
- **A person named AND their id passed is one row, not two.**
- **`DELETE_MAX` is 25 and it REFUSES**, never silently caps. It reports the
  true number and asks for it to be narrowed.
- **The single-id path is kept**: it names that one row and reads more
  plainly than a list of one.

## The same call twice in one round (2026-09-17)

The model sometimes issues the identical tool call twice in one round. The
second ran, which on a read wasted a query and on a WRITE was a second
write.

`runAgent` fingerprints each call as `name(arguments)` and serves the first
result to the duplicate. **Within one round only**, and that is the whole
safety of it: the calls are issued together, so nothing can have changed
between them. Across rounds is left alone, because an update followed by a
re-read must not be served the reading from before the write.

There is no list of which tools are reads. A list like that is one more
thing to keep current, and the one that drifted would be the one that let a
write through.

**No unit test.** It lives inside the turn loop and pinning it would mean
mocking the whole model round. It is covered by the live audit only, and
that is a stated gap rather than an oversight.

## Diane's output guards, and the two shapes they watch (2026-09-17)

Every guard in `v1/agent/` exists because a prompt was not enough. They fall
into two groups now, and the second one was empty until the Richard turn.

| Watching | |
|---|---|
| what she CLAIMS SHE DID | `checkFigures` `checkPercents` `checkDays` `checkCounts` `checkMonths` `checkClaims` `checkExportScope` |
| what she claims she CANNOT do | `checkAmbiguity` |
| what she says having looked at NOTHING | `checkAgainstCard` |

**The Richard turn, 2026-09-17.** One conversation, and the sheet was
checked before anything was written: ONE Richard, one row, 30 payable days.

1. **"There are several Richards on the sheet."** No tool said it.
   `resolvePerson` returns `ambiguous: false` for every sentence in that
   conversation. She composed the refusal, and an invented refusal ends the
   turn and sends the admin looking for a person who is not there.
   `checkAmbiguity.js` asks one question: did any tool report an ambiguity.
   Every ambiguity refusal now carries `ambiguous: true` so it can.
2. **"Changing his payable days from 31 to 0."** The row holds 30.
   `checkFigures` ignores bare integers under 100 on purpose, so every day
   count is beneath its floor, like every percentage was before
   `checkPercents`. `checkDays.js` is that sibling. **A number the ADMIN
   typed is theirs**, and is never flagged.
3. **Asked what his payable days were, she answered with what he is owed.**
   `find_and_show_details` ended every answer "The full details are on
   screen", whatever was asked, and that reply is TERMINAL, so nobody ever
   answered the question. `fieldAsked.js` reads the labels off the CARD, so
   there is no second list of column names to drift, and the longest label
   wins because "Payable" lives inside "Payable days".

**The prompt is where fault 2 came from.** It requires the read-back to say
what each column is changing FROM and to, and nothing hands her the from. A
rule that demands a value no tool supplies is a rule that gets guessed at.

## Ending a deal (2026-09-16)

Nothing in the CRM had ever ended one, so every deal opened counted forever.
The full reasoning is in `closure.md`; what the code now IS:

| | |
|---|---|
| **Stop** | `tb_mastersheet.stopped_on` + `stopped_reason`, both or neither (CHECK). One of four reasons. The row STAYS and moves to the Archive |
| **Archive** | `/archive`: the same list with `stopped: true`. READ ONLY, and Resume is its only write |
| **Review** | `tb_monthly_review`, one answer per deal per month. A deal joins the queue when `end_on` has passed and nothing has stopped it |
| **Liquidation** | `tb_companies.status` is now one of four. Liquidation still PAYS, reduced, at amounts set by hand per deal |

- **A STOP IS NOT BEHIND `color_uses_end_date`.** The end date is the
  sheet's own provisional formula and only counts when the setting says so;
  a stop is somebody saying the deal is over, so it ALWAYS counts. Both
  halves are pinned, and the contrast is pinned beside them.
- **THE END DATE STAYS**, his call. It still does exactly what it did.
- **The three review answers are not interchangeable.** `yes` stops
  nothing; `final` stops at the end of THIS month; `no` at the end of LAST
  month. The gap between the last two is one month's money for one person.
- **An unanswered deal is still PAID, and shouts.** Two doors: a `Review N`
  button on the master sheet header, and a line in `ExportWarnings`.
- **THE CURRENT MONTH, ALWAYS.** No picker anywhere. The review writes a
  DATE, so the export and the review never have to agree on a month label.
- **NO MULTIPLIER IN LIQUIDATION.** A settlement of 1,000 can be a director
  on zero and a mid unchanged, so nothing computes an amount from it. It is
  a number to compare against, and it WARNS both ways and refuses neither.
- **`dissolved` and `closed` both stop every deal** and differ only in what
  they say happened. That difference is the audit fact a single `closed`
  was losing.
- **Diane has three tools in their own file**, `agent/tools/monthlyReview.js`:
  read, one deal, and bulk behind `confirmFirst`.
- **`scratchOnly` now guards every write**, including `updateMany`, which
  it never had (found 2026-09-16), and the review's own transaction.
- **TWO THINGS PUT A DEAL IN THE QUEUE**, his call 2026-09-17: the end
  date passing, OR its company being in liquidation. Liquidation is a
  PERIOD, and deals inside it end at points no end date predicted, so a
  company wound down in month 3 of a twelve month deal was never asked
  about. **`OR`, never `AND`** (that would be fewer rows, not more), and
  both sit under the stop check so neither can revive a stopped deal.
- **EVERY ROW SAYS WHICH REASON PUT IT THERE.** `liquidation` comes back on
  the row and the panel badges it: a deal with an end date months away is
  in the queue only because its company is winding down, and unmarked that
  row reads as a mistake. Diane says "company in liquidation, ends X"
  rather than "ended X", which would claim a future date had passed.
- **THE REVIEW IS NOT THE MANUAL ENDING.** That is the Stop button. This is
  the CRM ASKING and somebody answering; two of the three answers end the
  deal as a consequence.
- **THE QUEUE CAPS WHAT IT READS ALOUD, and says it cut.** 12 lines; the
  count, the money and `dealIds` are never cut. It printed 36 against the
  real sheet and she relayed all of them.
- **The queue states both stop dates every time it runs.** There was no
  tool that could answer "when would final stop him", so she answered from
  memory and said August in September.
- **Verified against Postgres by `scripts/closureDrill.js`**, 47 checks on
  fake ZZTEST rows. Every unit test for this is DB free by design.

## The sidebar is grouped, and `configs/navigation.js` is the only control

His call, 2026-09-17. It was a flat list inside `Layout.jsx`, so the shape
of the CRM was a detail of a layout component and two renderers (the
sidebar and the phone's bottom bar) each had to be told about a new page.

| Group | Pages |
|---|---|
| **Payments** | Master sheet, People, Companies, Review, Archive |
| **Expenses** | Expenses |
| **Debts** | none yet |
| **Whatbot** | Flagged |

- **REVIEW SITS BEFORE THE ARCHIVE**, because it is what sends deals there.
- **HISTORY, SETTINGS AND SIGN OUT ARE NOT IN THE SIDEBAR.** They belong to
  whoever is signed in rather than to a page, so they are behind the avatar
  in the header. See "The account menu" below.

- **THE MASTER SHEET IS A PAGE INSIDE PAYMENTS, not a sibling of it.** He
  asked for "Payments, master sheet, expenses, debts" and then said the
  first four are one flow: `tb_mastersheet` is the payment record and
  People, Companies and the Archive are readings of that same table. As
  siblings, nobody could predict which page sat under which.
- **AN EMPTY GROUP DRAWS NOTHING.** Debts is declared because the shape is
  decided and the page is not: a heading over nothing is a dead link with a
  title. **What a debt IS has not been answered** (money we owe and have
  not paid, money owed back to us, or a third party) and it decides the
  schema.
- **PURE DATA, AND THE ICON IS ITS NAME.** Importing the components would
  make the file unimportable by `node:test`, which cannot parse JSX, and a
  config nothing can assert on is a config that drifts. `Layout` resolves
  the name against the whole icon module, so there is no second list.
- **`NAV_ITEMS` is BUILT from the groups**, never written twice. The phone
  bar has no room for headings and draws the flat list; two hand kept
  lists is a page reachable on a laptop and missing on a phone.
- **Dashboard leads, in no group**, because it reads across all of them.
  **Chat is not in the nav at all**: it opens on a named person, reached
  from a flag or a notification, so a top level link would open it on
  nobody.

## ONE CASCADE, and two callers were reaching past it

Found 2026-09-17 while giving Diane the confirm she was missing. Closing a
company stops every live deal on it, and that cascade lived inside the
PATCH route. Her `update_company` calls the REPO directly, so:

| Door | What closing did |
|---|---|
| The page | stopped every deal |
| Asking Diane | stopped none of them |

One act, two answers, on money going out. It is one definition now,
`shared/companyStatus.helper.js`, used by the route, by `update_company`
and by `bulk_close_companies`.

- **BREAKING THE CASCADE TURNED NOTHING RED.** The suite was green on a
  split brain about whose pay stops. `companyStatus.helper.test.js` is the
  test that was missing, and it pins that both callers reach the helper.
- **Only on the way IN.** Reopening brings the deals back; a note on an
  already closed company must not re-run a cascade that happened weeks ago.
- **Liquidation cascades nothing.** It is still paying.

## THREE doors write a company's status, and phase 3 updated one

Found on sight, 2026-09-17. The detail page got all four values and the
cascade confirm; the other two were left as they were.

| Door | Was | Now |
|---|---|---|
| Company detail page | four values, confirmed | unchanged |
| **Manage company modal** | **two values, and NO confirm** | four, and it asks |
| **Add company wizard** | **two values** | four, and it asks nothing, correctly |

- **THE MODAL CASCADED IN SILENCE.** It writes the same column through the
  same route, and that route now stops every deal on a terminal status. So
  Save details on a company set to closed stopped everybody with no dialog
  at all. This was the real fault; the missing options were how it was
  noticed.
- **THE WIZARD IS EXEMPT AND SAYS SO.** It creates a company, so there are
  no deals on it yet to stop.
- **IT ASKS ONLY ON THE WAY IN.** Reopening brings the deals back, and a
  company already closed being saved for a notes edit must not ask again
  about a cascade that already happened.
- **The page header named only `closed`**, so a company in liquidation or
  dissolved read exactly like a trading one. `COMPANY_STATUS_LABEL`, off
  the same options list.

## The Actions column is icons, and SHAPE tells Stop from Delete

His call, 2026-09-17. Three words across twenty six columns was the widest
thing on the row for the least said.

| Action | Icon | Colour |
|---|---|---|
| Edit | pencil | grey, because it opens a form and decides nothing |
| Stop | **raised palm** | **red** |
| Delete | **bin** | **red** |

- **THIS REPLACES "Stop must not be tinted like Delete".** That rule
  carried the whole distinction on colour. Both consequences are real: the
  red says "this one counts", and the SHAPE says which it is. The same way
  `CellSuggestion`'s three marks already work.
- **The stop icon is a HAND, not another lid-and-body outline.** It sits
  beside the bin at 15px, and two similar shapes there is one misclick from
  a deletion. Not an octagon or a circle-slash either: both read as
  "forbidden", and stopping a deal is somebody saying it has ended, which
  the Archive can undo.
- **Every icon-only control keeps `title` AND `aria-label`.** One for the
  eye, one for a screen reader. An icon with neither is a guess about what
  a button does to somebody's pay.

## A cell carries ONE icon, and a Toggle is not a selection

Both found on sight, 2026-09-17, and both are rules written down elsewhere.

- **`forms/Toggle` IS RED WHEN OFF, BY DESIGN.** It is a yes/no FACT about
  a deal (should be paid, paid) and the red means no. The review panel used
  it as a row SELECTOR, so thirty three unselected rows read as thirty
  three alarms on the one screen whose job is saying what needs attention.
  Selection is a CHECKBOX, the same one the master sheet uses, and it
  matches the Select all above it.
- **The payment start cell had TWO icons**, a date suggestion and the
  colour explanation. Extra information in a cell is AN icon, singular:
  two marks side by side is a key to learn before either can be read. The
  explanation is now stacked INSIDE the suggestion where there is one, and
  is the marker itself where there is not, so a cell with no icon means
  "nothing to say" rather than "one of them lost". One definition of the
  words either way: `paymentStartWhyParts` in `PaymentStartWhy.jsx`, which
  the Settings preview still renders as a component.
- **The review says what it is above the table.** The question it asks and
  the consequence of ignoring it were in small grey at the FOOT, under a
  scrolling table. It also has a search: thirty three rows is a scroll, and
  the search narrows `list`, which Select all, the count and all three
  buttons read, so a bulk act can never reach a row off screen.

## The monthly review is a PAGE, `/review`

His call 2026-09-29. `pages/ReviewPage.jsx`, in the sidebar under Payments.

- **IT WAS A MODAL BEHIND A BUTTON THAT ONLY APPEARED WHILE SOMETHING WAS
  WAITING**, so the one screen whose job is asking a question could not be
  opened to check it had been answered. A dialog is also the wrong shape
  for a nine column table with a search over it.
- **The master sheet keeps its `Review N` link** (a `LinkButton`, gold,
  still only while `pending.count > 0`) and the sidebar row carries the
  same count as a GOLD badge. Red is an alarm; this is a question waiting.
  One `TONE_FILL` map in `Layout.jsx` behind the sidebar number and the
  phone bar's dot.
- **`LINK_FILTER.reviewPanel` IS GONE.** It opened the modal over the
  master sheet; Diane's three briefing lines now land on `/review` itself.
- **The intro is ONE sentence.** It was four: the three reasons a deal is
  here are what the TABS say, and where an answered row goes is what the
  CONFIRM says. What is left is the only fact nothing else carries, that
  doing nothing is not neutral.
- **It uses `PageHeader` and `Toolbar`**, not a hand rolled sticky row. No
  `count` on the toolbar and no `storageKey`: the tabs are the filter, so
  there is no panel to remember (`helpers/filters.test.js` exempts a
  `Toolbar` with no `filters`).

### The calm resting state, 2026-09-29

He opened it and said he felt overwhelmed. Three things were doing it, and
all three are the same fault: the screen was shouting before anything had
been read.

- **THE THREE ANSWERS ONLY EXIST ONCE A ROW IS TICKED.** They sat there
  permanently, three saturated colours side by side, disabled for as long
  as nothing was selected. A traffic light showing all three lamps at once
  is not a signal. Ticking a row arms them, so that is when they appear,
  and the colour then means something. Not the waiting count and not the
  money, both of which are still where his 2026-09-17 call put them. (The
  bar's own `N selected` count was removed on every page, 2026-10-08: the
  ticked rows already say it.)
- **HISTORY RIDES THE TAB RULE, hard right.** It was fourth in a row of
  three answers that stop people being paid, then briefly a `PageHeader`
  action, which is correct for a page level control and a long way from the
  rows. The end of the tab rule is the most reachable empty space on the
  page and the one place that belongs to the whole list rather than to a
  selection. `UnderlineTabs` gained an `action` prop, rendered OUTSIDE the
  `role="tablist"`: a tablist may only hold tabs, and a button in one is
  announced as a tab that switches nothing.
- **It wears `accent`, a new `Button` variant**: the app's own colour at
  tint strength. Quiet grey read as decoration up there and a solid green
  would have read as a fourth answer.
- **EACH ANSWER CARRIES A SHAPE, not just a colour.** Amber and red on one
  row is a decision made by hue. A tick runs on, an `HourglassIcon` is paid
  in full then time is up, and the palm is the same `StopHandIcon` the
  master sheet's Stop wears, because it is the same act.
- **THE END NOTE IS TEXT, NOT A BADGE.** The master sheet badges it because
  it is one row among ninety six; here every row of a tab carries the same
  phrase, so eleven amber pills said nothing eleven times. Still his words,
  never a dash: the phrase IS why the row is there.
- **ONE BLOCK OF WORDS.** A title, a subtitle and a paragraph became a
  title and a subtitle that carries the question and the consequence.

### "Already ended" leaves the list, "Final month" stays

- `no` stops the deal at the end of LAST month, so it is out of the month
  entirely and the list stops being where it is read. `final` is paid in
  full this month and stays until the month turns.
- **`STAYS_AFTER_STOP`** in `api/v1/repos/monthlyReview.repo.js` holds only
  `REVIEW_FINAL`. Its mirror is **`REVIEW_ANSWER_LEAVES_LIST`** in
  `web/src/configs/monthlyReview.js`, which the optimistic paint filters on
  so the row goes at once rather than after the refetch. Each side pins its
  own half; neither reads the other's file.
- **THE UNDO ANSWER BUTTON IS GONE, and so is `POST /monthly-review/clear`.**
  History is the way back: `revertAnswer` takes no queue guard, so it
  reaches a row that has left. A second, narrower door to one act is what
  this removed.

## The account menu

His call 2026-09-29. `components/layout/AdminMenu.jsx`: one avatar in the
header, after Ask Diane, at every width.

- **IT REPLACED FOUR CONTROLS FOR THREE ACTS**: a Settings row and a
  History row at the foot of the sidebar, a red Sign out button under them,
  and a second gear and a second sign out in the header for phones. The
  phone's pair could drift from the laptop's because both were written out
  by hand.
- **`ADMIN_MENU` in `configs/navigation.js`** holds the two destinations.
  Sign out is NOT in it: it is an act, not a page, so it has no route and
  the menu renders it last, after a rule, in danger red.
- **`WORKSPACE_NAME` is there too**, read by the sidebar heading and the
  menu's own heading, so "Admin workspace" is written once.
- **z-40**, the open `Select` root's layer. The header is a stacking
  context at z-20 (it has `backdrop-blur`), so the panel clears every
  sticky table header below it and stays under the Toaster at 60.
- `useDismissable` closes it on an outside click or Escape. Closing from
  INSIDE puts focus back on the avatar; closing by clicking elsewhere does
  not, which would snatch focus off whatever was just clicked.
- **`.menu-pop`** in `index.css`: 160ms, origin top right, so it grows out
  of the avatar rather than fading in over the page. Reduced motion guard.
- **A CHEVRON OUTSIDE THE CIRCLE**, turning to point up while open, so the
  avatar stays an avatar and the indicator stays an indicator. `gap-3` from
  Ask Diane: at 8px a circle against a filled pill read as one control.
- **ARROW KEYS, because `role="menu"` promises them.** Up, Down, Home-less
  wrap both ways, Escape, and focus lands on the first item when it opens.
  Read off the DOM (`[role="menuitem"]:not(:disabled)`) rather than from a
  list of refs, which is the thing that goes stale beside `ADMIN_MENU`.

## History is PAGED, and the count is in the sentence

`GET /master-sheet/changes` took `limit` and returned `{ changes }`, so
History asked for a flat 200 and threw the count away: a week with 300
edits showed the newest 200 under a line reading "Edits from the last 7
days" and nothing said it had cut. **A cap you cannot see is the bug.**

- `page` / `pageSize` on the route (`CHANGES_PAGE_SIZE` 25,
  `CHANGES_MAX_PAGE_SIZE` 200), `withTotal: true`, and `{ changes, total,
  page, pageSize }` back. The repo had taken `offset` and `withTotal` all
  along; only the route was throwing them away.
- `HistoryList` holds the page, `placeholderData` keeps the current page
  drawn while the next loads, and `Pagination` hides itself on one page.
  **Both frames page**, the modal included: its 26rem scroll box hid the
  same cap.
- Pinned in `api/v1/repos/historyScope.test.js`.

## History is a page as well as a modal

`components/history/HistoryList.jsx` is the list, the query, the labels and
the revert hook. Two frames draw it:

- **`modals/HistoryModal`** scoped to a person, a company, one deal or one
  field. It passes a `maxHeight`, because a dialog has to keep its table
  inside itself.
- **`pages/HistoryPage`** (`/history`) with no scope at all: every change
  in the last 7 days. The page scrolls, so no cap.

Splitting them is what stopped the page being a second copy of the field
labels, both layouts and the optimistic revert.

## Tint empty cells, on the Master sheet export tab

A switch on the **Master sheet** tab of the export modal, `tintEmpty`. Pale
red on every empty cell, so the gaps in the working copy are findable.

- **OFF BY DEFAULT.** A sheet of red is unreadable and most blanks are
  legitimately blank. Only the literal `tintEmpty=true` turns it on.
- **IT CHANGES NO ROW AND NO FIGURE**, so the export's count does not move
  when it is flipped. It paints what is already there.
- **ZERO AND FALSE ARE VALUES, NOT GAPS.** A payable amount of 0 and a day
  count of 0 are real answers the sheet gives.
- **A ROW LEVEL TINT WINS AND THE GAP TINT STANDS DOWN.** Manual and
  uncounted are facts about the WHOLE row; those fills use `eachCell`
  without `includeEmpty`, so they skip the very cells this paints and a row
  came back half cream and half red, reading as two things at once.
- **On its own tab, not with the month tab's switches.** `MARKS` beside
  `TOTALS` in the modal: those are layout, this is marking. It works on the
  month tabs too, but only the Master sheet tab offers it, because "what is
  missing" is a question about the copy somebody fills in.

## Rates are APPLIED by withRates and only READ by the breakdown

`paymentBreakdown` reads an add on, a crypto charge and a fee back off
`row.rate_parts`. **`withRates` is what puts them there, and it runs at the
top of a build.** It used to ACCEPT `rates` and `cryptoPercent` and use
neither, so two callers passed them instead of rating the rows and were
silently short by every rate on every row: Diane's historical breakdown,
and **the Division Sheet export, in a real payout file**. The month sheet
was correct throughout, so one export was right and the other wrong off the
same rows. Both options are gone from that signature, and
`masterSheet/ratedBeforeBreakdown.test.js` pins the order for both callers.
Closed 2026-09-16; it was the whole of the three long standing failures.

## Current implementation snapshot (2026-09-04)

The recent Diane and dashboard work is now implemented end to end:

- Monthly history is stored in `tb_month_snapshots` as one immutable snapshot
  row per month with JSONB rows and totals. It contains the complete deal
  rows, per-currency and per-group totals, add ons, fees, crypto, net totals,
  FX rates, and the
  formula/settings version used. `projectMonth` provides non-mutating
  forecasts from the canonical preset rule; past months come only from their
  stored snapshot and the current month comes from live rows.
- A minute-level month scheduler snapshots the business month on its final
  calendar day and catches up a missing previous month on the first day of
  the next month. It never overwrites an existing snapshot. The manual
  command is `npm run snapshot:month -- YYYY-MM`.
- Conversation transcripts remain in `tb_conversations` and
  `tb_conversation_messages`. A compact structured JSON summary is saved at
  conversation end, idle timeout, page hide, or the size checkpoint; a boot
  repair job fills summaries that previously failed. Diane can recall those
  summaries without using them as live financial figures.
- Verified Postgres backups are external custom-format dumps with a checksum
  manifest. The API starts a configured backup scheduler at boot and runs it
  immediately, then at `BACKUP_INTERVAL_HOURS` (normally 24). Backups are
  restored only after checksum and `pg_restore --list` validation and an
  explicit `RESTORE DATABASE` confirmation.
- Diane's write-intent guard routes phrases such as “update all deals” to the
  two-step bulk update flow instead of a totals read. Deal targeting resolves
  group first, then company and role, and asks for clarification when a deal
  is still ambiguous. Computed multi-month answers retain each requested
  month and use concise deal language with exact zero-value reasons.
- Export setup is server-stage driven. Step one offers Master sheet, Sheet
  for a month, Bank, Cash, and Expensing; Division Sheet is visible as
  Coming soon and is disabled. Breakdown and colour questions are only
  accepted at their declared stages. The completed card omits the sample
  table and disappears only after a successful save.
- People, Companies, and Flagged have persistent Grid/Rows switches. Grid
  views are capped at 16 records; Companies and People rows use 25, Flagged
  rows use 20. Pagination uses one compact row with numbered destinations,
  ellipses for large sets, and a Go-to-page field when needed.

The preset formula itself has not changed. Include end date remains the
settings toggle that changes the formula; snapshots and Diane read the live
setting and preserve the formula version used for each historical month.

## Dashboard contract

`/dashboard` is the authenticated landing page. `/` redirects there. Its
filters are server side: reporting range, custom month bounds, forecast
horizon, selected month, groups, company, person, payment method, currency
display, and recent change search with scoped pagination.

0. **A range says how far BACK, and this month is not one of it.** `Past 3
   months` is the three before this one; the horizon adds months after it.
   Defaults are `last3` + a **one month** horizon, so the timeline is past
   three, this month, next month. Both were off by one the other way
   (`Last 3 months` counted this month, the horizon was three), which put a
   quarter of invented figures on every chart.
1. Past months are `Saved actual` values from immutable snapshots only.
2. The current month is a `Live estimate` from all filtered live CRM rows.
3. Future months are `Projected forecast` values from those rows and the
   canonical preset formula. A missing past snapshot is `Unavailable`, never
   reconstructed from live rows.
4. Live deals, distinct people, and companies count all filtered live rows,
   not only payable deals. Monthly payable, group performance, and payment
   method splits use the selected month and its source.
5. A selected saved month may show `Why it changed`: started, ended, and
   payable total changed counts with readable deal links. Missing evidence is
   labelled unavailable. Live and forecast months do not invent drivers.
6. Native currencies remain separate. USD normalization names currencies it
   cannot convert and describes partial subtotals as excluding them. It never
   displays USD zero for an entirely unconvertible subtotal.

The dashboard API and web contract are covered by 914 API tests and 291 web
tests. `npm run build` in `crm/web` passes. The source trend chart keeps an
unavailable month as a line gap and scales negative payable totals around zero.

**A KEY IS A ROW OF SMALL BOXES, ONE COMPONENT.**
`display/ChartLegend.jsx` is the only legend on the page. Each chart used to
draw its own out of 24px SVG rules, so four entries ran halfway across a
panel and the row stood taller than the axis under it: the swatch is now a
10px square and the row is `leading-none`, `mb-1.5`. Both the trend chart
(single and the raw per currency view) and the group bars use it.

- **A swatch is built from the tone the mark is drawn with.** `BAR_TONES`
  strong, soft and ghost serve the bars AND the trend chart's actual, live
  estimate and forecast, so the two panels cannot disagree about what solid,
  pale and dashed mean. `MONTH_BARS_KEY` is the one key for all three,
  swatch DERIVED from the tone rather than written beside it, and
  `SWATCH_FOR` turns the same tones into the dots on a list row.
- **The key names only what was drawn.** It listed all four every time, so a
  chart with no gap in it explained what a gap looks like. Built from the
  points actually plotted, plus Unavailable only when a month is.
- **Only a currency entry lights a line**, so the static ones stay
  unfocusable. That hover is the raw view's own control, not decoration.
- The point markers are a pale green ring (`fill-accent-tint-strong`),
  because a white centre cut a hole in the line on a white card. The multi
  lines keep white: a green centre on a violet line claims the wrong series.

### What the dashboard is drawn with (2026-09-04)

Every colour, surface and gradient the page uses is in
`web/src/configs/dashboardTheme.js`. The page itself carries no hex, and
`dashboardDesign.test.js` fails if one comes back.

1. `DASH_SURFACE` is the one card. The page and `TotalPaymentsModal` share it.
2. `STAGE_TONES` mirrors `.badge-paying`, `.badge-ended` and
   `.badge-not_started` in `index.css`, so a stage is the same colour in the
   donut as on the table under it. It was green/blue/amber, which made Ended
   blue in the ring and grey in the badge two panels below.
3. `display/BarChart.jsx` and `display/Donut.jsx` are the two chart shapes,
   one each for the two group panels and the two rings. Both group panels
   previously placed their captions with a hand-measured pixel offset.
4. Axis steps come from `helpers/chartScale.js`, tick labels and bar labels
   from `formatMoneyCompact`. Any figure somebody acts on stays in full.
5. No chart has a minimum width, so no panel body scrolls sideways. The two
   places that can still scroll (the trend SVG on a phone, the recent deals
   table) wear `.scroll-slim`: no bar until the pointer is in the box.
6. The primary button is solid `accent-strong` with a white label, and
   `.btn-fill` takes `bg-current` so the progress sweep works on it and on a
   white button alike. The nav's active state is `accent-tint` with green
   ink, one definition in `configs/navigationStyles.js` for the sidebar, the
   settings sidebar and the phone's bottom bar.
7. No figure is abbreviated. `formatMoneyWhole` drops the pence on a chart
   label; nothing rounds a magnitude. Axis steps on both charts come from
   `axisTicks`, so the top of a chart is a round number rather than the
   tallest data point, and the gutter they sit in comes from `axisGutter`,
   **measured from the labels actually drawn**. A fixed gutter is sized for
   the widest label that might ever appear, so every narrower axis paid for
   it in blank card and the plot started inboard of its own panel title.
7b. **The phone's bottom bar is icons only below `sm`.** Five labels do not
    fit across 375px, and a flex item will not shrink below its own content
    without `min-w-0`, so the labels held the bar wider than the phone and
    pushed Flagged off the end of it. The name stays as `sr-only`, so it is
    announced at every width. The slim scrollbar covers `.table-wrap` too:
    **it is a selector list, not an apply.** Applying that class copies its
    two declarations and silently drops every `::-webkit-scrollbar` rule,
    which left tables thin in Firefox and untouched in Chrome.
7bb. **The nav count caps at 99, not 9.** `NavBadge` was a hard edged red
    square reading "9+", so forty open concerns and ten said the same thing.
    It is a `rounded-full` pill now, a circle at one digit and wider at two,
    and `BADGE_MAX` is one definition for the sidebar and the phone bar. The
    phone bar keeps a DOT rather than a number, ringed in the bar's own
    surface colour so it reads as a mark on the icon: two digits over a 20px
    icon is unreadable, and the count is announced through an `sr-only`
    line rather than an `aria-label` on a bare span.
7c. **NOTHING SCROLLS THE PAGE SIDEWAYS.** The shell's content column is
    `overflow-x-clip`. A page level horizontal scrollbar takes the layout
    with it: the bottom bar is fixed to the viewport, so scrolling right
    slides the content out from under it. Everything that genuinely scrolls
    sideways (every wide table, both charts) carries its own overflow box.
    **`clip`, not `hidden`:** hidden forces the other axis to `auto`, which
    would make that column a scroll container and break `position: sticky`
    for the header above it and the settings sidebar inside it.
7d. **A phone reads one step down.** `body` is `text-sm sm:text-base`, and
    the page headings step `lg / xl / 2xl`. 15px is a size set for a
    desktop card; on 375px it is what pushes a stat onto three lines.
    **Real inputs are exempt and stay at 16px** because iOS Safari zooms
    the page on any field under it. That rule must never be brought into
    line with this one.
8. A panel body is a flex column that FILLS its panel, because the grid
   stretches every panel in a row to the tallest one. The trend chart's
   tooltip sits outside the box that scrolls: `overflow-x: auto` makes the
   other axis auto too, so that box was clipping the tooltip and growing a
   vertical scrollbar inside the card.
9. `text` is `#243029`, not `#16201b`. Nothing in the CRM reads as black.
10. **A session remembers only the filters it CHANGED.** `changedOnly` diffs
    against `initialFilters()`, so changing a default reaches anyone who
    never touched that control. Storing the whole object meant a horizon of
    3 saved before the default became 1 kept forecasting to December.
11. **The trend is ONE line, dashed only where it is forecast.**
    `helpers/sourceTrend.js` `lineRuns` splits it into runs and seeds each
    new run with the previous point so solid and dashed meet. It used to
    draw a polyline per source, and a month carries exactly one source, so
    at a one month horizon every series was a single point and a polyline
    of one point draws nothing: the chart was five dots.
12. **Both chart popups are portalled** (`display/ChartTooltip.jsx`). They
    were clipped twice: by the scroll box and by the panel's
    `overflow-hidden`. No z-index fixes either. **Placed by what it
    MEASURES, not by a guess**: the height was a fixed 260 and only chose
    which way to flip, so a group broken down by month AND currency ran
    past 500 and hung off the bottom of the screen. Below, then above,
    then BESIDE IT AT THE TOP, plus a hard `maxHeight`. The list that
    caused it is capped too (`MONTHS_IN_POPUP`) and says what it left out.
13. `formatMoney` uses `currencyDisplay: 'narrowSymbol'`, so USD prints `$`
    rather than `US$`. Nothing changes for GBP, EUR or AED.
14. The group chart takes as many bars as it is given. Value labels stop at
    6 columns and captions at 14; the hover popup carries the rest.
15. Charts animate in (`.chart-bar`, `.chart-in`, `.chart-ring` in
    `index.css`), and all three stop under `prefers-reduced-motion`.
16. **Payment per Group is one bar per month, per group**, coloured by what
    the month IS (saved, this month, forecast). Past a floor width the plot
    scrolls sideways while the y axis stays put, so the comparison the range
    asks for is the comparison the chart draws.
17. **A month with no snapshot is trimmed off the ENDS of the chart**
    (`trimEdges`). A gap in the middle stays, as a light wash rather than
    the full height diagonal hatch that made an empty month the loudest
    thing on screen.
18. The dashboard filters on the whole book: groups and payment method.
    Company and Person are what the master sheet and the detail pages are
    for. `Skeleton` is `bg-border-strong`; the sunken wash was invisible.
19. The two span controls are **How far back** and **How far ahead**. They
    were "Months shown" and "Forecast horizon", which both read as setting
    the same span. The range options carry no "past" of their own now: the
    label asks the direction.
20. **A FILTER IS A READ, SO IT IS NEVER OPTIMISTIC.** Nobody can know what
    a different set of filters totals to, and painting a guess would be a
    made up figure on a money screen. `placeholderData` keeps the last
    answer on screen while the new one is fetched, dimmed, with an
    "Updating" pill. This is the exception the optimistic write rule allows,
    and the reason is here rather than in a comment nobody reads.
21. **The KPI card artwork is DRAWN, not loaded.** `display/KpiArt.jsx` is
    four inline SVGs, one per tone: a rising line, a skyline, a group, and
    waves. Four PNGs would be four requests, four files to keep in step with
    the palette, and four things that go soft on a retina screen. The wash
    behind them is `KPI_SURFACES` and the ink is `KPI_ART_INK`, both in
    `configs/dashboardTheme.js`. Faint on purpose: the figure is the thing.
    **Opacity is per drawing**, because coverage is: the two that span the
    card are the faintest, and one value made a skyline right and a full
    width wash a coloured card. Both ends are pinned, since below the floor
    a drawing vanishes against white. **An `<svg>` with a definite height
    and no width takes its width from the viewBox ratio and ignores
    `left`/`right`**, which is why the two wide ones cut off two thirds
    across until they were given `w-full`.
22. **A PANEL IS WHITE BEHIND ITS FIGURE.** Faint concentric arcs were drawn
    behind the two quiet panels to fill them (`display/PanelArt.jsx`, with a
    `PANEL_ART_INK` and a `<Panel art>` prop) and came straight back out:
    they read as noise behind a figure. The KPI cards keep their drawings,
    because those sit on a tint and exist to tell four cards apart. A test
    pins the absence, so it cannot creep back panel by panel.
23. **THE FILTER PANEL COMMITS ON APPLY, NOTHING SOONER.** It edits a draft;
    Cancel and Escape discard it. Every change used to refetch on its own,
    so setting three filters was three round trips and two answers nobody
    wanted to see.
24. `hooks/useDismissable.js` closes a popover on Escape, and on an outside
    click only when asked. **Outside click is OFF for the filter panel**: a
    popover holding a draft must not throw it away on a stray click, and
    picking a group shut the panel it was being picked in. **A portalled
    panel counts as inside**, marked `data-portal-panel` (Select sets it),
    and an open one owns the Escape: it shuts, the popover behind it stays.
25. The filter panel says how much saved history exists (`historyNote`, off
    the API's `snapshotHealth`). A range reaching past the snapshots draws
    nothing new, and that read as a broken filter until the control said so
    where the range is actually set. **There is one snapshot today, August
    2026**, so How far back has nothing older to reach for.

### The Settings preview rolls with the month (2026-09-10)

The Preset formula tab is a WORKED EXAMPLE: real dates coloured by
`paymentStartState`, the same function the sheet and the file use, so the
panel cannot describe behaviour the export does not have.

It was pinned to `2026-08-01` with sample dates written for August, so by
September it argued the rules against a month nobody was in and one row read
"Starts in October" while October was the row before it.

1. **`helpers/presetSamples.js` is the dates, and `now` is an ARGUMENT.**
   The preset is the first of the month the reader is in, every sample is an
   OFFSET from it, and the notes are relative too. Computed at RENDER, so a
   tab left open over midnight on the last of the month does not go stale.
2. **A PRESET column, and it leads.** It is the month being asked about, so
   the row reads "for this month, this start, this end, this colour". Every
   row shares one value, which is the point: the colour is the start
   measured against ONE month.
3. **The icon is on the PAYMENT START cell, on every row, in both toggle
   states, on the SHEET as well as in the preview.** A flag belongs on the
   column that caused it, and the colour is painted there. It was a bespoke
   `?` in the preview's Colour column and nothing at all on the master
   sheet; it is `display/PaymentStartWhy` now, ONE component both pages
   render, because the preview exists to teach the rule the sheet applies
   and two copies of the wording is two chances for them to disagree. On the
   sheet it goes LAST in the cell's `after`, so it is the rightmost icon
   whether or not a date suggestion sits beside it.
3b. **The reason is the RULE THAT FIRED**, not what the colour can mean.
   `paymentStartReason` walks `paymentStartState`'s order, directly beneath
   it, and names which line stopped it. The preview used to print a fixed
   label on the sample: "Finished months ago" sat beside a GREEN cell,
   because the label never moved when the toggle did. The reason changes
   with the toggle now, since it is a different rule.
4. **WARNING, not info, where the toggle would move that row.**
   `ifToggled` in `paymentStartState.js` asks the same function with the flag
   flipped, so it can never name a colour the rules would not produce. It
   returns null for a row the toggle cannot move, which is most of them.
   The line it prints is the case that costs money: a deal that finished
   months ago sits GREEN, stays in the month's total, and nothing on the row
   said so.
5. **The claim is pinned.** The test walks all six rows through 26 months,
   February and the year boundary included, and asserts the colours come out
   identical every time in both toggle states, and that all three colours
   appear in both. A worked example that rots is worse than no example.

### A KPI drawing is fitted, never sliced (2026-09-10)

The People card's crowd was blown up and cut down its left edge, half a head
on the wrong side of a hard vertical line.

`preserveAspectRatio="xMaxYMax slice"` scales a drawing to COVER its box and
cuts the overflow, and the box was `h-full`, so its shape was whatever the
CARD happened to be. A KPI card stretches to the tallest in its row, and at
two columns the People card sits beside the money card, which is three lines
tall in the raw view. The box went from 1.85 wide to 0.77, so the height
drove the scale instead of the width and the drawing overflowed sideways.

`meet` on both cornered drawings. It fits the whole thing inside the box, so
nothing is ever cut at any card height, and it draws smaller on a short card,
which is the right way round for texture. The two WIDE drawings keep `none`:
they are stretched edge to edge on purpose.

**The guard is on the `fit` VALUES, not on the word.** Written loosely it
matched the comment explaining it, which is the second time that trap has
caught a guard in this file.

### A card header, three currencies, and no name (2026-09-10)

A `RecordCard`'s lead is `shrink-0 whitespace-nowrap`, so a company paid in
three currencies printed `AED 54,335 · £23,000 · 2,500 EURO` across the
whole header row and the title beside it, on `min-w-0`, truncated to
NOTHING. The card showed money and no idea whose.

1. **`display/MoneyTotals.jsx`: one figure, the rest behind a CellInfo
   icon.** The CRM's own rule for extra information in a cell. `+2` is
   printed beside it because an icon alone does not say there is more MONEY
   behind it, and the visible figure would be read as the total. The panel
   says "Never added together", which is the reason there is no fourth line.
2. **The lead is still `shrink-0`. Money is not a thing to truncate.** What
   stops it being wide is `MoneyTotals`, not the layout. The left half gained
   `basis-0 flex-1` so it has a real share of the row rather than whatever is
   left over, which is the second half of the same bug.
3. **A long name is readable on hover**, through the existing
   `TruncatedText`: portalled, `pointer-events-none` so it never eats the
   card's click, and it only appears when the text is ACTUALLY cut. The
   `title` attribute went with it, or the browser draws a second native
   tooltip on top of the first.
4. **A TABLE still prints every currency.** The column has room; only the
   card hides them. `formatTotalsWhole` and `MoneyTotals` both read
   `totalsList`, so the two can differ in layout and never in figures.
5. **`totalsList` sorts BY CODE.** The map's order is whatever Postgres
   aggregated it in, so an unsorted list could put a different currency at
   the front of the same card between two loads. People and Companies each
   had their own identical copy of this formatting, and `formatTotals` in
   `formatMoney.js` was a third spelling of it.

### A new currency needs no code change (2026-09-10)

Audited end to end after "if I add PHP, does the CRM know it". Upload,
storage, the write route, totals, grouping, snapshots, xlsx and PDF exports,
the dashboard, the master sheet filter and every label already read the
currency off the row and never check it against a list. Four places did not.

1. **`seriesInk(index)` replaces `SERIES_INK[i % length]`**
   (`dashboardTheme.js`). A SEVENTH currency was drawn in the first one's
   green with a key claiming the two differ. The six chosen inks are
   unchanged; past them the hue steps by the golden angle at fixed
   saturation and lightness, so a generated ink carries the same weight on a
   2px stroke. Nothing indexes the list by hand any more, and a test says so.
2. **`unionOptions` is a UNION, never a replacement**
   (`helpers/optionList.js`). Swapping a hardcoded list out for the derived
   one empties the control while the query is in flight and silently drops
   any value nobody currently uses. The seeded list is the floor.
3. **The row editor, the master sheet cell and the upload diff's fill all
   read the currencies the deals carry**, unioned over their own seeded
   lists. The upload diff already did this for GROUPS and not for
   currencies, so a sheet arriving without a currency column could only be
   filled with the three that were typed into the file.
4. **The comment claiming currencies are a closed set the API rejects
   outside of is gone.** It was false, and it is the sentence that makes
   somebody conclude a new currency is impossible and stop.

**What still needs a human, deliberately.** A rate. Settings grows a box for
any currency on the sheet on its own (`settings.js`, `needed`), and until a
rate is typed `toUsd` returns NULL and every caller says "excludes PHP: no
exchange rate" rather than under-totalling. And an ALIAS, if the sheet ever
spells one two ways: `CURRENCY_ALIASES` is what makes `EURO` mean `EUR`, and
only a person knows whether a `PESO` row means PHP or MXN.

**Left alone on purpose.** `breakdowns/withUsd.js` `awayGbp` counts GBP only,
so away cash in another currency lands in `awayUsd` and never in `awayGbp`.
The figure is named for pounds; open until the boss says otherwise.

### The two charts do not share a currency picker (2026-09-10)

Two pickers were already on screen, one per panel, wired to ONE piece of
state: two controls that looked independent and moved together. And the
shared list offered `All`, which the bars cannot draw, so Group Overview
fell back to the biggest currency and reported it in a caption.

1. **`ChartUnit` takes `allowAll`, default true.** Group Overview passes
   false, because five groups over three months in three currencies is
   forty five bars on one axis, and EURO at 3,510 beside GBP at 80,850 is a
   2px stub in every group. The trend chart keeps `All`: three lines share
   a plot honestly, and hovering one answers for that currency alone.
2. **`dashboard.barCurrency` is the bars' own state.** It resolves to a real
   currency or the biggest one, which is what the bars already drew. The
   difference is that the control says so and the caption is gone.
3. **The bars carry one currency, the popup carries all of them.** An axis
   has one unit; a list does not. `GroupBreakdownTooltip` is the raw popup
   always now, not only under All. USD keeps `GroupTooltip`: one figure by
   definition, so a per currency breakdown means nothing there.
4. **A group paid only in EURO still gets a row on a GBP chart.** Its bar is
   flat and its popup has the figures. Dropping it says it does not exist.
5. **Every currency, zero included, dimmed rather than dropped**, matching
   the group rows in `CurrencyGroupsTooltip`.
6. **"TOTAL", NOT "ALL GROUPS".** There is a real group called `ALL GROUPS`
   (the twelve NA roster rows), so both popups had a total row wearing the
   name of one of the rows it was summing. `MasterSheetExportModal` already
   carried this rule; the dashboard was breaking it.

### Under All, two keys, and the dot earns the second one (2026-09-10)

"Next month" sat on one row beside GBP, AED and EURO and read as a fourth
currency, because the mode swapped the month key OUT for the currency key.

1. **ONE ROW: marks left, currencies right.** `currencyKey` and `monthKey`
   in `SourceTrendChart.jsx`, in a wrapper shaped like the bar chart's
   legend (`justify-end` with `mr-auto` on the left half, so the right half
   stays right when a narrow panel wraps it). Stacked they cost the chart a
   whole line of its own height for a key that fits beside itself.
   `onLight` goes to the currency key alone; the month marks are text.
2. **The month key is the same in both views, `swatch` off `SOURCES`.** The
   marks were greyed under All, because a line's colour there is its
   currency and green would name a colour no line shares. Two keys naming
   the same three months in two palettes was the worse trade, user's call
   2026-09-10. The ROWS are what keep them apart: boxed chips above, plain
   marks below, a label on each.
3. **The chart still has to say which month is which.** Every dot under All
   was hollow, so a past month and the current one were identical on the
   plot. The current month's dot is filled in the series ink now. `fill` as
   an attribute and `fill-surface` as a class never sit on the same circle:
   the class wins and the dot stays hollow.
3b. **A swatch is a SQUARE wherever it is drawn.** `CHART_SWATCH` in
   `dashboardTheme.js`, read by `ChartLegend` and by both chart popups. The
   key drew a box and the popups drew a 2px rule, so one currency was a box
   above the chart and a dash inside it.
4. **A legend entry that lights a line is a CHIP** (`LIT` in
   `ChartLegend.jsx`). `button` in `index.css` carries `px-4 py-2 min-h-10`,
   which is right for a real button and drew three 40px boxes on a key whose
   whole point is to cost one line's height. A utility beats a bare element
   selector, so the override needs no `!`.

### Under All, the pointer picks a LINE (2026-09-10)

One hit rect per month meant three lines shared one popup, and it listed the
same three currency totals wherever the pointer sat.

1. **The month column is cut into LANES**, one per series, divided at the
   midpoint between two lines (`lanesAt` in `SourceTrendChart.jsx`). Every
   pixel belongs to the nearest line, so there is no dead ground and never a
   question about which currency was asked about.
2. **The lanes are POINTER ONLY.** The full height column rect underneath
   keeps `tabIndex` and shows the month's summary, because one tab stop per
   line per month is seventy two across a year in three currencies.
3. **`tooltip(row, index, code)`.** `code` is the line hovered, or null for
   the whole month. The chart does not know what either means; the page
   picks `CurrencyGroupsTooltip` or `AllMonthsTooltip`.
4. **EVERY GROUP IS LISTED, ZERO INCLUDED**, dimmed rather than dropped. A
   group left out is impossible to tell from a group that earned nothing,
   and which of the two it is is the question being asked. `groupNamesIn` is
   the one list, shared with the Group Overview bars.
5. **Every amount names its currency, because the ROWS are groups.** A bare
   figure had nothing on its own line saying what it was.
   `formatMoneyWhole` gives the symbol where Intl knows one and the code
   where it does not, so GBP reads `£30,120` and the sheet's own `EURO`,
   which is not an ISO code, reads `EURO 1,510`. The other two popups label
   their rows BY CODE and stay bare: `EURO EURO 3,510` is what `bareIn`
   exists to stop.

### A dashboard count is a link to the rows it counted (2026-09-10)

Deals by Stage reported 19 deals nobody could reach, so "which 19" meant
filtering the master sheet by hand and hoping it agreed.

1. **The ring's arc and its row below go to the same place.** The row is a
   real `Link` (underlines on hover); the arc is a POINTER shortcut only.
   `Donut` takes `onSelect`, never a focusable child: the svg is
   `aria-hidden`, so a button in there is a tab stop nothing announces.
1b. **The ring's centre box is `pointer-events-none`.** It is `inset-0`, so
   it covers the ring as well as the hole, and it swallowed every hover and
   click a slice was meant to get. The slices looked dead.
2. **A lit slice glows in its own colour**, `.chart-slice` in `index.css`.
   It glows rather than grows: a thicker stroke slides the arc under the
   cursor and lights the neighbour instead.
3. **The ring speaks STAGE, the sheet speaks PERIOD.** `PERIOD_FOR_STAGE`
   in `helpers/dashboard.js` is the one translation. `paying` arriving at
   the sheet as itself filters to nothing, silently.
4. **A link may seed a filter, and the key is named once**
   (`configs/linkFilters.js`). `useStickyState(key, initial, param)` reads
   it in the initialiser, so the first request is already the filtered one,
   then strips it from the address bar: left there, Clear would work until
   the next refresh put the filter straight back. `period`, never `status`.
   The group bars had been writing `?group=` since they were built and
   nothing on the master sheet read it.
5. **Which month, never which kind of month, and NO DATE ON ANY LABEL.** It
   was "Saved, This month, Forecast" on the bars and "Actual, Live estimate,
   Forecast" on the line, which named our own plumbing; then the months by
   name, which dated a key sitting beside a panel note already carrying the
   span. Every key on the page reads the same three things now:
   - Group Overview and Month on month: **Last month, Current month, Next
     month**, from `MONTH_BARS_KEY` (`monthBarsKey` for the key, `WORD_FOR`
     for the rows, including raw's).
   - Payment Overview: **Past months, Current month, Next month**, from
     `SOURCES` in `SourceTrendChart.jsx`, plural because one line spans
     every past month at once. `LABEL_FOR` names the dashed mark again
     under All, so it cannot be named differently there.
   - **The tones still disagree across the two panels.** The bars draw a
     past month `soft` and the current one `strong`; the line's dots are the
     other way round. Now that both keys say "Current month" it is visible.
     Open, and a decision: flipping either changes a chart on sight.
   - **Keyed by which month it IS, never by tone.** An unprojected next
     month is drawn `soft` and would have read "Last month".
   - **"Last month" has to BE last month**, so `monthOffset` checks it sits
     directly beside the current one. Three months of history draws two
     saved bars and a gap draws one older than it looks: both fall back to
     "Earlier months". A tone with no month in the range drops out.
6. **The trend line is 3 units, and the curve is untouched.** It is monotone
   cubic (`helpers/curve.js`) and stays that way: a smoother spline dips
   below the lowest point on a fall, which draws a month crossing zero. A
   three point range is two straight segments because it is three points.

### Raw and converted

A toggle beside Filters, **not inside it**: a filter refetches and waits for
Apply, this is a display switch over data already on the page. `money()`
builds `native` unconditionally and adds `normalizedUsd` on top, so both
shapes travel in every response and the request stays in `usd` mode.

- **The preference outlives the tab** (`hooks/useDurableState.js`,
  localStorage, `crm.prefs.`). A FILTER is invisible state and dies with the
  tab on purpose; this names itself on the control and labels every figure,
  so it is a different question and lives on a different shelf. The filter
  store keeps no localStorage in it, and a test pins that.
- **NO RATIO ACROSS CURRENCIES, EVER.** "up 3.2%" over three numerators and
  three denominators in three units is not one figure. Month on month
  Overview leads with a single percentage, so in raw it returns early and
  lists the figures and the per currency difference instead; the modal's
  badges go the same way. What raw DOES carry is each currency against its
  own last month, on the money card. See "A percentage per currency" above.
- **AN AXIS CARRIES ONE UNIT.** GBP 80,850, AED 54,342 and EURO 3,510 cannot
  share a scale, so raw plots ONE currency and the panel names it in a
  picker (`ChartUnit`), opening on the currency carrying the most money.
  Converted needs no picker: it is one figure by definition.
- **The missing rate warning is converted only.** Raw never converts, so it
  can never be short and the warning would be a lie.
- `ViewToggle` gained `options` and `label` rather than being copied. The
  grid/rows default is unchanged for People, Companies and Flagged.
- **THE CURRENCY CODE LEADS**, in `formatMoney` and `formatMoneyWhole`. The
  sheet's own `EURO` is not an ISO code, so Intl throws and lands in the
  fallback, which put the code last: "3,510.00 EURO" stacked under
  "AED 54,342.50" and "£80,850.00", one line in three reading backwards.
- **A STACK of currencies uses `formatMoneyCode`**, so every line names
  itself the same way. Intl gives GBP a symbol and AED a code, so the card
  read "AED 54,342.50 / EURO 3,510.00 / £80,850.00": two lines naming their
  currency and one not. A SINGLE amount keeps its symbol. Where the code is
  already the row's own label the amount is bare (`bareIn`), or the line
  reads "EURO   EURO 3,510".

#### All: one line per currency

- **`ALL` is not a currency**, so `everyCurrency` is asked before `picked`
  ever reaches `valueIn`. As a code it would look up `native['*all']` and
  print "No *all".
- **It belongs to RAW alone.** Resolved without the mode, a stored All drew
  three raw currency lines under a header saying USD and a warning about a
  USD subtotal. It is also offered only beside two or more currencies.
- **Every series is trimmed as ONE** (`currencySeries`). Trimmed separately,
  a currency starting a month later drew its first point over the wrong
  month.
- **The bars keep ONE unit** and the popup carries the rest. Five groups
  over three months in three currencies is forty five bars, which is not a
  comparison. Visibility asks the BREAKDOWN, so a group paid only in EURO
  does not vanish from a chart claiming to show every currency.
- The trend is a MONOTONE CUBIC curve (`helpers/curve.js`), with a soft
  wash under each line in that line's own colour. Monotone, not a plain
  spline: an ordinary one dips below the lowest point on a fall, drawing a
  month crossing zero. Every wash is painted before any line, or the second
  currency's fill tints the first one's stroke.
- Only the earned part is filled. A forecast is a dashed line over nothing.
- The money card is DENSE in raw (`text-[13px] sm:text-sm`). At the hero
  size three stacked currencies stretched the row, and the grid grows every
  card in a row to its tallest. **One row per currency, three columns**
  (`NativeTotals`): code, bare amount right aligned on its digits, that
  currency's own change. The codes were printed twice, once beside the
  totals and again beside the percentages, and the caption wrapped onto a
  line of its own.
- **A PERCENTAGE PER CURRENCY IS EXACT, AND NEEDS NO RATE.** "No ratio in
  raw" is about a ratio ACROSS currencies: three numerators over three
  denominators in three units is not one figure. A currency against its OWN
  last month is one over one, so raw carries it, the way it already carried
  the per currency difference. `changeBetween` is the one shape for a
  change, read by both `compareMoney` and `compareNative`, so the card and
  the panel cannot round the same move differently. A previous of zero has
  no percentage: everything over nothing is not a rise of any size.

- **The header note is ONE FAINT CAPTION**: the span, plus the word
  `forecast` when the range reaches past today (`Aug 2026 to Mar 2027
  forecast`). It was "Forecasting Oct 2026", which was true, October being
  the only projected month, and still made a dashboard drawing three months
  look like it was showing one. True and misread is the same defect as
  wrong. Then it named the projected months a second time, which the dashed
  run and its key already do. **The word drops when nothing is projected**:
  at a horizon of nothing there is no forecast in the range, and a caption
  is not allowed to be the one thing on the page claiming otherwise.
- **Recent Changes shows FOUR, and it sets its row's height.** It is the
  tallest panel in that row, so the fifth line was paid for twice: once
  there and again as blank card above and below Payment Overview's chart
  beside it. `RECENT_CHANGES_SHOWN` is also the request's `pageSize`, so a
  row dropped from the view is a row not fetched.

### Month on month Overview

Titled `Month on month Overview` on the user's instruction. The name was
banned once for saying what it measured without naming a month; it earns it
now because the note under it SPANS the months on screen (`Aug 2026 to Oct
2026`, two of them in raw) instead of naming two of three.

Built like Deals by Stage: one figure on top, the rows it is made of
underneath. **What sits where the ring would is the CHANGE**, not a total,
because every total it could show is in the list below it anyway.

- **The ratio it replaced was CLAMPED to 100** so a ring could draw it, and
  September beating August read as exactly "100% of last month" over a
  difference of +$4,635.79. A cap nobody can see. `changeBetween` has no cap
  and the headline is derived from the two figures the card itself lists.
- **Preceding, this, proceeding.** One row per month, each measured against
  the row ABOVE it, so the forecast says what it adds to this month rather
  than repeating this month's own rise. The next month exists only as far as
  the forecast horizon reaches.
- **A month with no figure is dropped, never listed as zero.** No previous
  month and no exchange rate are both real states; zero is a claim.
- The dots are `MONTH_BARS_KEY`'s own three marks (`SWATCH_FOR`), so a saved
  month, this month and a forecast look the same here, on the group bars,
  and in either key.
- Tried and rejected on the way: a bullet bar with a marker line, two
  stacked bullet bars, three vertical bars on one axis, and a sparkline of
  the range. The sparkline lost because it plots the same series Payment
  Overview already draws two panels away.
- **`flex-1` on the headline, never `mt-auto` on the list.** An auto margin
  hands ALL the spare height to one gap, which put a hole between the
  caption and the divider.

### A skipped month is said out loud

A past month is read from a saved snapshot or not at all, so a month with
none is SKIPPED: `previousPoint` walks further back and every comparison on
the page quietly measures against an older month.

- **The page says so**, in a `role="status"` strip above the KPI row, naming
  the missing month and the one used instead. Detected from the CONSEQUENCE
  (the point before this month is not the one compared against), not from
  the health report, so it fires whatever the reason.
- **`TrendText` names the month it used**, from `comparedMonth`. It printed
  the fixed string "vs last month" while comparing against August. Same for
  the raw card's caption. `against={null}` still suppresses it and a string
  still overrides it.
- `helpers/monthLabel.js` is the one formatter, because a shared badge
  cannot import a page for one. `MasterSheetExportModal` uses it too;
  `templates/pdf/MonthlySheet.jsx` keeps its own on purpose, since that one
  returns null so the PDF can omit the line.
- **The window is two days wide, and one minute of uptime covers it.**
  `snapshotScheduler` ticks every minute, saves the month on its last day
  and catches up the month before on the 1st. It is not widened past that:
  `takeSnapshot` reads the LIVE rows, so a September snapshot taken on 3
  October is the sheet as it stands on the 3rd filed under September, which
  is a reconstruction wearing a record's name. A gap is visible; a wrong
  record is not.
- **The last day's edits are not in that month's snapshot.** The scheduler
  fires on the first tick of the last day, so the month is captured at
  roughly 00:00 on the 30th.
- **The 4th card opens nothing.** It had a modal of per group cards;
  removed 2026-09-06. The four cards report the current month and the range
  lives on the two panels that span months, so a modal repeating one of them
  was a third place to read the same figure.

### What each dashboard filter moves

Two of the four change every figure; two change only the panels that span
months. Nobody could tell which from the controls, so `FILTER_HINTS` in
`DashboardPage.jsx` puts it on each one's info icon.

| filter | what it changes |
|---|---|
| How far back | Payment Overview and Group Overview only |
| How far ahead | Payment Overview and Group Overview only |
| Groups | everything: four cards, every panel, the deal list |
| Payment method | everything: four cards, every panel, the deal list |

**The four cards, Month on month Overview and Deals by Stage always report
the CURRENT MONTH.** Reaching further back than the saved snapshots go is
therefore invisible on them, and was invisible on the trend chart too once
`trimEdges` dropped the empty months. The chart now says how many it
dropped, or a range filter that reaches past the data reads as broken.

### The conversion rates, and who owns them

**Settings, Global rates, Conversion rates.** `tb_fx_rates` (migration 051),
one row per currency, `usd_per_unit`: how many USD one unit is worth. One
direction for every currency, because the screen reads "1 GBP = 1.3517 USD"
and nobody should have to know that AED is normally quoted the other way.

`shared/fxRates.helper` resolves in this order, and it is the only file that
does:

1. The live feed, when `FX_RATES_URL` is set and answering.
2. Its six hour cache.
3. **The saved rates**, whenever the feed serves nothing.
4. The hardcoded GBP and the AED peg, when nothing is saved either.

A currency with no rate anywhere is NAMED as unconvertible and never
converted at par.

**AND A SAVED RATE FILLS A GAP THE FEED LEFT.** The feed used to be all or
nothing: while it answered, not one saved rate was consulted, so a currency
it does not quote was reported unconvertible even with a rate sitting in
Settings. An admin could set it, watch it save, and watch every total keep
refusing it. `backfill()` fills only a code the feed did not return, or
returned as unusable, and **a live rate always wins**. The filled codes come
back as `backfilled` and Settings says which they are.

**THE SCREEN'S CURRENCY LIST COMES FROM THE SHEET.** It was three hardcoded
codes, which is the same fault the CRM keeps finding: a sheet with a
currency nobody anticipated would have no box to give it a rate. The route
returns `needed`, the distinct currencies on `tb_mastersheet` folded through
`codeFor`, so the sheet's `EURO` asks for a `EUR` rate rather than a box
nothing would ever read. Anything already saved is listed too, so an
obsolete rate can still be cleared, and there is an Add box for a currency
nobody has used yet.

**Crypto is a payment METHOD, not a currency.** A crypto row is denominated
in fiat (both of today's are EURO) and converts like any other; `crypto_percent`
is a CHARGE added in the row's own currency, not a rate. No coin is recorded
anywhere and none needs to be. If one ever is, the Add box and the backfill
cover it: `USDT` saved at 1.00 converts 500 USDT to 500 USD even while the
live feed is answering, because the feed does not quote it.

**Rates are fetched at BOOT** (`fxRates.warmUp()` in `server.js`, beside
`pool.warmUp()`). The endpoint answers in about 2.6 seconds; lazily that
landed on whoever opened the dashboard first, and a miss was SILENT, showing
up later as a currency mysteriously unconverted. The boot log now says the
source, the count and anything backfilled, and warns when there is no live
feed at all.

- **A saved rate never beats a live one.** The feed is the better answer
  whenever it answers, and the screen says which source is actually in use.
- **AED IS SETTABLE, and the peg is the last resort.** It is still fixed at
  3.6725 since 1997, but a peg is a decision somebody made and can unmake.
  `toUsd.helper` used to return the peg BEFORE reading the table, so a
  dirham rate an admin set was stored, shown back, and then ignored by every
  conversion. The table is consulted first now.
- **IT DOES NOT REACH THE PAST.** `takeSnapshot` freezes the rates a month
  was taken with, so editing a rate moves THIS month and every month after
  it, never a saved actual. That is what keeps an old payout file
  reproducible, and it is why August still excludes EURO.
- **Optimistic, through `useOptimisticUpdate`.** Written first as a plain
  mutation that waited for the server, on the argument that a rate is a
  figure every conversion will use. User's call, overruled 2026-09-06: a
  Save button that sits there doing nothing reads as one that did not work,
  and the rollback is what makes waiting unnecessary. `alsoInvalidate` the
  dashboard is not optional: every USD figure there was converted with the
  old rate and none of it can be patched client side.

### EUR, and the snapshot that held the rate all along

**BOTH SIDES OF A RATE LOOKUP GO THROUGH THE ALIASES**, not just the
amount's currency: `normalizeRates` in `toUsd.helper.js`. August 2026's
snapshot froze its euro rate under the sheet's own `EURO`; every lookup
normalized to `EUR`, missed, and the month reported "no exchange rate is
available" while holding 0.86135611907387 the whole time. An exact ISO key
wins over an aliased one, so a map carrying both resolves the same way
every time.

A saved month still converts at the rate it was TAKEN with, never at
today's. That is the point of a saved actual. A snapshot that genuinely
froze no rate for a currency keeps saying so on the banner.

**EUR converts again.** `FX_RATES_URL` answers in about 2.6 seconds and
`fxRates.helper` timed out at 2.5, so every call fell back, and the fallback
carries GBP, USD and AED only. The sheet's `EURO` rows had a rate in all 166
the endpoint returns and were reported unconvertible anyway. Timeout is 6s.

---

## One filter definition, three tools (2026-09-17)

`FILTER_PARAMS` in `agent/tools/masterSheet.js` is the one list of ways to
narrow the sheet, and it MIRRORS `repo.findAll`. `filter_master_sheet`,
`total_master_sheet` and `bulk_update_master_sheet` all spread it.

The bulk tool used to declare its own shorter list, so she could DESCRIBE a
set she could not then change: no company, no role, no tier, no amount
range, no end month. "Set payable days to 0 for everyone at Northstar Care"
had to be done row by row, which is the loop the bulk guards exist to stop.

- **`group` stays each tool's own.** The bulk tool has its own warning
  about looping over the groups one at a time.
- **`companyStatus` came free with the merge.** The repo had taken it since
  the closure work and no tool offered it. Its values come from
  `companies.repo`, never typed twice.
- **A name here that the repo does not destructure is silently ignored**,
  which is exactly what `knownArgs.js` refuses, so the two lists have to
  stay level.

### Seven columns that had no filter at all (2026-09-17)

Each was a question she could not answer and would not refuse. A filter
that does not exist is IGNORED by the query, so the answer came back as the
whole sheet described as something narrower.

`appointmentWhen`, `acceptingPostals`, `label`, `paymentOutcome`,
`oldGroup`, `sheetShouldBePaid` and `sheetPaid`, added to `repo.findAll`
and to `FILTER_PARAMS` in one change.

- **The two RATES became a `amountField` value, not filters of their own.**
  They are figures, and "an add on over 5%" is a range like any other. One
  mechanism, not two.
- **`sheetShouldBePaid` / `sheetPaid` are the BOSS's free text**, and
  `shouldBePaid` / `paid` are the admin's switches. Two facts, never
  merged, so they are two filters.
- **`appointmentWhen: none` pushes its month parameter lazily.** Declaring
  `$1` and never using it is a Postgres error ("could not determine data
  type of parameter $1"), not a no-op.

### `amountField` was snake_case and the range was DROPPED

**A live bug, not a gap.** The tool declared `payable_days`; the repo's
`AMOUNT_COLUMNS` allow-list is camelCase, so the lookup returned undefined
and the range was silently discarded. "Who is on 0 payable days" ran
unfiltered and the WHOLE SHEET came back as the answer. Verified after the
fix: 24 rows against 100 unfiltered.

The same shape `knownArgs.js` exists for, one level down. There it is a
filter that does not exist; here it is a filter whose VALUE does not.
Ignored rather than refused, either way.

## One table, three views

`tb_mastersheet` is the whole system. People, Companies and Master sheet are
three groupings of the same rows, not three tables, and nothing is mirrored.
An edit through any of them changes what the other two show, which is why
every write invalidates all three caches.

| table | rows | holds |
|---|---|---|
| `tb_mastersheet` | 96 | every deal: person × company × role × group |
| `tb_people` | 67 | display name, email, notes |
| `tb_companies` | 32 | name, status, tier, notes |
| `tb_month_snapshots` | one per saved month | immutable monthly rows and totals for history and forecasting |
| `tb_conversations` | one per conversation | transcript metadata, touched entities, and structured summary |
| `tb_conversation_messages` | many per conversation | ordered admin and Diane messages |
| `tb_mastersheet_changes` | — | the edit history behind Undo |
| `tb_accounts` | 1 | the single admin credential (bcrypt) |
| `tb_settings` | 1 | dev mode |

A **deal** is one stored row. Diane always calls it a deal; the grouped pages
describe the same relationship as a person's *company* or a company's
*handler* where that is clearer.

**One of a person's companies is a company IN A GROUP**, never a bare name.
Zayn's two Workforce rows, one INDIGO and one MILKMAN, are two engagements.

## How data gets in

The messy xlsx is uploaded on Settings or the Master Sheet page, parsed in
memory, never written to disk.

**An upload is two requests and the first writes nothing.** `preview` parses
and diffs; `commit` writes only the rows that came back accepted.

**AN UPLOAD DELETES NOTHING.** Rows the file does not mention are counted,
listed on the diff's "Potentially ended deals" tab, and kept.

**AN UPLOAD HAS NO OPINION ABOUT A GROUP IT DOES NOT MENTION.** "Different
deals" is scoped to the groups the file actually carries, so an INDIGO
sheet lists the 11 INDIGO deals it left out, not all 67 in the CRM. It used
to list everything, which made the tab say 67 above a list of 11 and, far
worse, put a select-all over 56 rows the file had never heard of: one tick
and a Delete is the one-group-extract catastrophe the two-step upload
exists to prevent. `UNKNOWN` is not a group for this purpose, so a file
nothing can place falls back to no scoping and shows more, not less.

**Removing them is a separate act that happens immediately.** Tick, press
Delete, confirm, and they are gone: it no longer waits for, or drags along,
the upload's own changes. Closing the modal does not bring them back, and
the confirm says so.

**The removal is optimistic**, and the two delete tabs differ on what
follows it. Rows off **Potentially ended deals** are by definition not in the file,
so nothing else in the diff mentions them: they leave the list on the
click, the tab count follows, and no re-read is needed. Rows off **Similar
deals** ARE in the file, so deleting one moves it from "Existing to update"
to "New incoming deals", which no client-side patch can work out; that case
re-reads the file afterwards. A refusal puts the rows back.

**THE UPLOAD READS THE "ACTIVE COMPANY LIST" BLOCK.** His per-group sheets
carry a second table beside the deals, and the upload threw it away as
"columns not read" for months.

**His "Status" column is our `tier`.** Its values are `Top Co`, `T2`, `T3`,
`TBC`, `Benched`, `In prep`, `T2 for Reliapay`. `tb_companies.status` is
`active`/`closed`, the company Status field, a different fact. The screen says
Company status because that is his word; the column, the API and the code
say tier.

**Found by HEADER, never by column.** `readSheets` splits side-by-side
tables only when a blank column separates them, so the block arrives merged
into the deal table on two of his files (columns 0-16) and as its own table
on the third (14-18). A fixed column would read nothing on two of three.
The rows of a merged table are unrelated down the page: row five's deal has
nothing to do with row five's company entry.

**A FIFTH TAB, only when the file carries the block.** Written on commit
with everything else, not on the click: a tier overwrites a value where
deleting destroys a row, and only the second earns its own act. Nothing is
optimistic because no request is made until Confirm.

**EVERY COMPANY THE FILE LISTED GETS A ROW**, not only the ones needing a
decision. The tab showed three buckets and hid the rest, so a name you
wanted to correct was reachable only if the diff had already called it a
problem. Rows are grouped by state (flagged, tier changing, new, already
matching) and the last is collapsed by default.

**TWO HALVES PER ROW.** Left is WHICH COMPANY THIS IS: a picker over every
company the CRM holds, near-misses labelled and listed first, and you may
type a new name. Right is its TIER and its OLD GROUP. Accepting a near-miss
writes to the held name, not the file's spelling, so correcting a name
cannot create a second company under the file's wording.

**A COMPANY LISTED TWICE IS ONE ROW.** `indigo 1 august.xlsx` lists `Social
work partners PR` twice, `T2` under one director and `TBC` under another, so
"one row per company" is not true of the file however true it is of
`tb_companies`. It collapses to one row carrying both tiers, flagged, with
NEITHER preselected: preselecting one answers the question the flag exists
to ask.

**A COMPANY NAME IS NEVER A TIER, and one screen wrote one into the other.**
The flagged row had a single "Pick one" dropdown fed with near-matching
COMPANY NAMES ("looks like a company we already have"), and its onChange
wrote the TIER. Answering "which company is this?" stored the company's name
as its kind, which is why the tier picker later offered `Umbrella company uk
holdings` and `Churchill knight emplyment`. The row has two controls now and
neither can write the other's column. **Migration 045** clears any tier that
exactly equals a company name we hold: no real tier does, since `Bench` is a
company and `Benched` is a tier, `Reliapay` is a company and `T2 for
Reliapay` is a tier.

### "Old group" is his, and is never one of ours

His per-group sheets carry an `Old group` column beside the Active company
list. Its values are `Milky`, `Wallaby 1`, `V3`, `NA`.

**NOT A GROUP OF OURS, and never matched against one.** Ours are NEXUS,
INDIGO, MILKMAN, MANBAT and ALL BOOKS; `Milky` resembling `MILKMAN` is a
coincidence to resist, not a mapping to build. Folding them would rewrite
which group a company belongs to off a column that is only a memo. A
company's real groups still come from its deals.

**Stored on `tb_companies.old_group`** (migration 044), free text and
NULLable. Editable on the company's own page and filterable on the Companies
page, where the control only appears once some company carries one.

**THREE STATES, NOT TWO.** A value, cleared (`''` → NULL), or NOT MENTIONED
(NULL → keep). The third is what a file with no `Old group` column says, and
only one of his three files carries one, so it is the common case rather
than an edge. `setTiers` binds an empty string as NULL and `COALESCE`s, so
an INDIGO upload can never wipe an old group a MILKMAN upload recorded. Same
rule `uploadColumns` follows for the deal columns.

### The tier is prose, so nothing may reject it

`COMPANY_TIERS` was a closed set of two, `Top co` and `Normal co`, and the
PATCH route 400'd on anything else. His files carry `Visa co`, `T3`, `T2`,
`Benched`, `TBC`, `Provider`, `In prep`, `T2 for Reliapay` and `T1 with
capilano`.

The upload's own writer never validated, so **a tier the upload had just
written could not be edited by hand**: the CRM returned 400 on its own
stored value. The list is now SUGGESTIONS, served alongside the tiers
actually in use (`tiersInUse`), so a kind he invents next month is offered
without anyone editing a list. Same shape as the currency filter and the
local locations card.

**THE DEAL CHANGES AND THE COMPANY STATUSES ARE TWO DECISIONS**, and either
alone may be confirmed. Confirm was disabled on `accept.length === 0`, and
the commit route returned early on that same test *before* it reached the
tiers block, so accepting only the statuses left the button dead and would
have reported success having written nothing. Two bugs, one assumption: an
empty list of one says nothing about the other. The button names both halves
of what it is about to write rather than counting only the deals, and the
toast leads with the statuses when they are the only thing that landed.
Pinned in `commitTiers.test.js`, which stubs the two repos and asserts the
ORDER OF THE GUARDS.

**The preview route reads five things from the parse**, and destructured
three. `hasCompanyTable` and `companies` were referenced fifty lines below,
so every upload died on `hasCompanyTable is not defined` and lost the whole
diff for the sake of an optional fifth tab. Same failure as the payout
template's `{ columns }`: a fixed destructure that did not grow with what it
destructures.

**Three things are FLAGGED rather than guessed**, all resolved the same way:

- the file gives one company two tiers (INDIGO lists `Social work partners
  PR` as both `T2` and `TBC`)
- the name resembles a company we already hold. **Five of thirteen "new"
  names in his three files were near-misses**: `Umbrella Co UK` against
  `Umbrella company uk holdings`, `Churchill Knight employment` against our
  own misspelling `Churchill knight emplyment`. Creating those silently is
  how one company becomes two rows.
- the company sits in several groups, so a single-group file cannot say
  which it meant. Today that is `Workforce` alone: 32 of 33 companies live
  in exactly one group.

**A multi-group file is NOT refused.** The deals import, the safe rows
accept, the ambiguous ones flag. Same reasoning as the upload that used to
delete rows it did not mention: a partly ambiguous file should hand you the
ambiguity, not reject the whole thing. His multi-group master carries no
company block at all, so the case is rare.

### The diff decides per CELL, and the guard steps aside for it

**TWO MECHANISMS STOPPED AN UNWANTED OVERWRITE, and the invisible one ran
first.** A column anybody had ever typed into went into
`manually_overridden_fields`, and `diffUpload` dropped it: never listed,
never offered, never written. **The guard was removing the modal's one job,
which is to ask.** A correction could never be revisited and nothing said
why.

**The hole underneath it was the diff's granularity.** It had a checkbox per
ROW and a column mask that applied to EVERY row, so rejecting one bad cell
meant rejecting the whole row and losing the good ones beside it. There was
no way to answer a claimed column, which is why hiding it looked reasonable.

**Each changed field is now a two-way choice**, headed **EXISTING** and
**INCOMING**. A tick on the left keeps the CRM's value, a tick on the right
takes the file's, and one is always on so there is no state that means
nothing. A checkbox would have asked "accept this?", which is a yes and a
silence; this asks "which of these two", which is the question actually
being answered.

The headings were "Keep this" and "Take from the file" for about an hour,
which is **a third vocabulary for the two things this screen already names**
in every other heading, count and column. They sit over the TICK rather than
the value: indented past the mark they lined up with the text and left the
ticks hanging outside their own columns.

**A hand-edited field is marked and defaults to the LEFT**, carrying WHEN it
was set and WHAT it replaced from `tb_mastersheet_changes`. Without those
two the note says "somebody typed this" and leaves the reader exactly as
stuck. A claim is a HUMAN edit (`changed_via <> 'upload'`), because an
upload writing a column is precisely what the claim resists.

**The server was already ready.** `accept` has always been
`{ syncKey, columns }` per row and the commit groups by distinct mask; the
modal just sent every row the same global list.

**`respectOverrides` defaults to TRUE**, so a path that forgets it is safe.
**Only the commit of a reviewed upload passes false**, because by then a
human has seen each cell beside the value it replaces. The one-shot upload
and whatbot's sync keep the guard: no human, no diff, no exception. The
change log follows the same flag, or an accepted change would write and then
be invisible to History and unreachable by Undo.

**What this costs:** Accept all on a stale sheet can now overwrite a
correction, where before it could not. The mark is what stands in the way,
and the change is logged so Undo puts it back.

**A missing COLUMN is not an empty CELL.** `uploadColumns.js` maps each db
column to the parsed fields that feed it; the upsert's SET list is built from
what the file actually carried. A column present with an empty cell still
writes, because that is the sheet saying "no value".

**The override guard.** A human editing a column claims it in
`manually_overridden_fields`, and the next upload skips that column on that
row. Accepting a diff never claims a column: agreeing with the sheet is not
the same act as typing a value in.

Identity is `dealKey.js`, shared by the parser and the hand-add path, which
is what stops one arrangement becoming two rows.

**The group is inside that key, so a row without one duplicates itself.**
A group is looked for in four places, in order: the Group column, a first
column whose header was typed over (`recoverGroupHeader`), a tab named
after a group, and last the file name (`groupFromFilename.js`). The last
one exists because "August send for nexus Unpaid.xlsx" had none of the
first three and imported six Nexus deals as UNKNOWN, none of which matched
the six already stored under NEXUS. Three rules keep it from guessing: it
can only match a group the CRM already has, whole words only, and two
matches means no match. A row that still has no group is flagged on every
occurrence, unlike any other missing column: the others leave a value
unknown, this one changes what the row IS.

**whatbot pulls, and only pulls**, from `/api/v1/agent/master-sheet`.

## The two conventions the sheet uses

- **Company can be comma joined**: `SG, CKA, CKU, Umbrella co` is one client
  relationship across four entities, one fee.
- **Group, role and name are never joined.** Zayn in two groups is two rows.

`MultiRowToggle` asks which is meant, because the multi-select cannot tell.

## Payment period, and the two statuses

The sheet has no status column. The CRM has two, and both were called
"Status" until they were split.

| field | scope | values | from |
|---|---|---|---|
| payment period | one deal | active / ended / not_started | the preset formula, same as the cell colour |
| pay status | one person | paying / not_started / ended | any of their deals still in period |
| company status | one company | active / closed | the company Status field |

**Payment period is about the PERSON on that row, never the company.** It is
computed at read time (`shared/paymentPeriod.helper.js`), one definition used
by all three repos. The stored `status` column is still written and filtered
on but is not what a page shows. A hand-set value wins via the override
guard.

### NOT STARTED IS NOT ENDED

A payment start after the month used to return `ended`, so a deal that had
not begun read as one that was over. **Every Ended badge on page one of the
live sheet was one of these**: eleven rows starting in October or November,
not one of them with an end date. With the end date setting off, which is
the default, `ended` could ONLY ever have meant "has not started".

- **The money never moved.** `isOwedThisMonth` excludes both alike and still
  does. This splits the WORD, never the arithmetic: no total and no cell
  colour changes, and the badge/colour test asserts red still maps to
  exactly "not active" for every combination of dates.
- **Red is one colour and two facts.** The boss's sheet paints "has not
  started" and "has finished" the same, so the tint stays as he wrote it and
  only the badge tells them apart.
- **Order is the meaning.** The start is asked about first, because a row
  that has not begun cannot also have finished.
- **`isPeriodEnded` counts `not_started` as out of period.** It feeds the
  Active company list, and without that eleven future deals would have gone
  live in it.
- **A HUMAN SETS ONLY TWO.** "Not yet paying" is a fact about the dates,
  never a decision; somebody who wants a future row treated as live sets
  Active, which is what the override is for. `PERIOD_EDIT_OPTIONS` is the
  pair, `PERIOD_FILTER_OPTIONS` is the three.
- **The edit cell still SHOWS the third.** Two options meant opening the
  status cell on a "not yet paying" row selected nothing, so the cell read
  empty. `periodEditOptions(current)` prepends the current value DISABLED
  when it is not settable: visible and truthful, still unpickable.
  `EditableCell` carries `disabled` through for any such derived column.
- **Labelled wherever it is printed as text** (Diane's card, the exported
  sheet, both PDF templates). A cell reading `not_started` is a variable
  name in a document somebody sends out.

**THE PERIOD IS THE PRESET FORMULA.** It is not a separate question and it
is not the end date. `owedThisMonth.helper` now has THREE consumers, all
rendering one answer:

```
isOwedThisMonth()  ─┬─→ paymentStartState()  the cell COLOUR
                    ├─→ countsTowardTotal()  the TOTAL
                    └─→ paymentPeriodSql()   the BADGE
```

**GREEN or AMBER is Active, RED is not.** The badge can no longer contradict
the colour beside it, which is pinned by a test over every combination of
start, end and toggle either could see.

**It read the end date directly**, and that is what showed. Six NEXUS deals
on the same August preset came out four Ended and two Active purely because
their end dates are appointment plus a year and the appointments differ.
Every one of them starts before August, so every one is owed; the boss's own
`nexus august.xlsx` carries no end dates on them at all.

**THE END DATE TAKES PART ONLY THROUGH THE SETTINGS TOGGLE**, and the SQL
reads that setting itself rather than having it threaded through every
caller. It is one boolean on a one-row table, and a page that forgot to pass
it would quietly show a different answer from the page beside it.

```
override wins
no preset                       → active   (standing roster, no month)
start > end of preset month     → ended
toggle ON and end < month start → ended
otherwise                       → active
```

**Ending INSIDE the month is still Active**, toggle or not: the boss pays a
deal that finished on the 26th for the whole month.

`periodEnded()` is the same rule in JS for rows already in hand, so nothing
derives it a third time.

**THE BADGE IS OPTIMISTIC TOO.** `payment_period` is derived in SQL, so the
optimistic patch that copied only the edited column left the badge on the
server's last answer: you moved the preset to August and the row still read
Ended until the refetch landed, which reads as an edit that did not take.
`helpers/paymentPeriod.js` mirrors the rule for the browser and
`withPeriod` recomputes it alongside `withPayable`, whenever the preset, the
end date or the status moves. The server's answer is still the one that
sticks. Real time across pages was already there, on the socket.

**ONE ROW, THREE CACHES.** Chasing that turned up a wider fault: the cell
edit patched only `['master-sheet']`, so on the Person and Company pages
NO inline edit was optimistic. Both are groupings of these same rows, and
they hold them under their own keys in a different shape:

| cache | shape |
|---|---|
| `['master-sheet']` | `{ rows }` |
| `['person', id]` | `{ person: { deals } }` |
| `['company', key]` | `{ company: { deals } }` |

`useOptimisticUpdate` takes a LIST of key prefixes now, discriminated by the
first element being an array so every other caller is unchanged, and all
four of its calls loop. Miss one and a cache is patched and never rolled
back. `patchDeal` handles the three shapes and returns anything else
untouched, because `setQueriesData` runs it over every query under those
prefixes.

**The override popup uses the same mirror**, so it can never claim the
calculation "would read ended" on a row the calculation calls active.

## Undo, and what a change log may store

**`old_value` is TEXT, and undo writes it straight back into the column it
came from.** So whatever the log stores has to be a value that column will
accept, and for a date that means `YYYY-MM-DD` and nothing else.

The hand-edit path used a bare `String()`. `pg` hands a `date` column over
as a JS Date, so the log held:

```
Thu Aug 06 2026 00:00:00 GMT-0700 (Pacific Daylight Time)
```

Postgres refused it on the way back in — `time zone "gmt-0700" not
recognized` — so **every undo of a date failed**, and the History panel read
like a stack trace.

**The upload path was always right.** It logs through `asText`, which has
handled dates since it was written, which is why an upload of a column
logged cleanly and a hand edit of the same column did not. `logValue`
delegates to `asText` rather than repeating the rule; the only difference is
null, which the log keeps as NULL where a comparison wants an empty string.

**Migration 046 repairs what was already written**, matching only the JS
Date shape so a real value containing a month name is left alone. `pg`
returns a `date` at LOCAL midnight, so the day in the string is the day in
the column and there is no offset to undo.

### One mass edit undoes as ONE act

A bulk update writes a change row per field per row, so putting a 96 row
edit back one id at a time was two hundred confirmations: in practice the
mass edit had no way back at all. `undo_master_sheet_change` takes `batch`.

- **A batch is RECOVERED, not stored.** There is no batch id on the table
  and adding one would not help the changes already written, so
  `findChangeBatches` clusters by actor and by gap: same `changed_via`, no
  more than `BATCH_GAP_SECONDS` (15) between consecutive writes. `changed_at`
  is transaction time, so every row of one loop shares a timestamp.
- **NOT partitioned by field.** One call setting the preset AND the payable
  days is one act, and splitting it put half of it back.
- **It names the batch before it touches it**, same two call shape and the
  same incident behind it as the single undo: the count, every field with
  its own value, and who.
- **"UNDO THAT" NEEDS NO ID.** It did, and that is how a real revert
  failed: she carried a change id from earlier in a long conversation, that
  change had already been put back, and 96 rows became "name which one to
  start with". With no `changeId` it takes the most recent batch, which is
  what the phrase means. An id still wins when given, and an id that was
  already reverted now says SO rather than "no longer undoable".
- **NARROWED THE WAY A BULK EDIT IS**, with `group` and `except`, because
  an admin thinks in groups and people and never in change ids. A group not
  in the batch REFUSES and says which groups were; a missed exception
  refuses the whole revert. The confirm names what STAYS, since a revert
  narrowed to one group leaves the rest of the change standing.
- **It reports itself as it goes**, like the mass edit: a couple of hundred
  single writes is several seconds, and silence is indistinguishable from a
  hang.
- **It puts back the PREVIOUS value, whatever that was.** Asked to "revert
  to August" it cannot: it restores what the rows held before the edit. The
  tool says so, and points at `bulk_update_master_sheet` for setting a
  month they name.
- **A deletion cannot be put back this way.** Deleting nulls `row_id` on the
  log entries, so there is nothing to write onto. Said once, rather than
  discovered as every row in the batch refusing.
- **A half undone batch is never reported as done**, and the failures are
  named by id.

## The two codebases do not touch

`crm/api` and `crm/web` are separately deployed and share no file. A build
that reaches across is coupled to a codebase it does not ship with.

**One leak existed and is gone.** `web/src/configs/searchFields.test.js`
built a path into `api/v1/repos/masterSheetRows.repo.js` and matched its
`SEARCH_COLUMNS` out of the source to prove the two lists agreed. It read
rather than imported, which is why it looked acceptable, and it was not: on
a machine holding only one of the two it would crash or quietly prove
nothing.

**The shared fact is now written on both sides as a CONTRACT**, and each
side pins its own half: the web test checks the dropdown against the
contract in both directions, and `masterSheet/searchField.test.js` checks
that every offered key maps to a real column. Neither reaches across.

**Comments naming the other folder are fine and deliberate** — there are
several, and they are pointers, not dependencies.

**Verified by resolving every path, not by reading imports.** Each relative
`require`, `import` and dynamic `import()` in both folders resolved to an
absolute path and checked against its own root: **0 references leave `api`,
0 leave `web`.** Neither `package.json` names the other.

**THE ONE THING THAT DOES CROSS IS A BUILD ARTEFACT, not code.**
`vite.config.js` writes to `../api/public`, and `v1/app.js` serves that
folder. The API depends on the FILES being there, never on `web/src`, so the
API runs from a checkout with no `web/` folder at all as long as `public/`
was built. That is the deploy boundary and it is the right one.

## Signing in is two requests

**`/auth/login` issues nothing.** It proves the password and returns a
short lived pending ticket that grants no access to anything.
**`/auth/login/verify` proves the secret code and is the only route that
calls `issueSession`.** A right password with a wrong code leaves the
caller holding a worthless string.

The split is the whole point: a code step running after the cookie was
already set would be a browser formality, and anyone with the username and
password could skip the UI and call the API directly.

- The ticket is an opaque id in `configs/loginTickets.js`, not a JWT. Two
  minutes, three wrong codes, then burned. The count is server side because
  a count inside a token is replayable.
- The code is bcrypt in `tb_accounts.secret_code_hash`. **NULL denies
  login**, it does not skip the step, so set it with the seed script in the
  same breath as running migration 039.
- Both steps live on one card (`LoginForm`), not two routes, so the ticket
  is component state and a refresh correctly drops back to the start.

## Delete versus Remove

**NOTHING DELETES A PERSON OR A COMPANY ANY MORE, 2026-09-14.** His call.
Gone: the Delete button on both detail pages with its hooks, confirms and
client methods; `DELETE /people/:personId` and `DELETE /companies/:key`;
`peopleRepo.remove`, `companiesRepo.remove`, `rowsRepo.orphanPerson`,
`rowsRepo.orphanCompany`; and Diane's `delete_person` / `delete_company`.

**So detaching is now impossible.** `clearOrphanFlags` and the
`orphaned_*` columns stay for rows flagged before that date, and they still
clear the same way: fill the missing half back in. Nothing can create a new
one.

- **Remove** on a row still deletes that one pairing outright.
- Company status is changed through the editable Status field. Archiving a
  person is gone.

**The replacement is designed, not built:** deleting a deal deletes its
person or company when that was their last one. `feature.md` item 6 carries
the shape and the two answers it needs.

**`.claude/CLAUDE.md`'s "Delete vs Remove" section still describes the old
behaviour** and cannot be edited from here. It needs the paragraph above
whenever somebody is next allowed to touch it.

`AgentOverlay.jsx` still carries status labels for Diane's two dead tools.
Left alone because `agentOrb/` is off limits.

## Expenses

**R1 shipped 2026-09-14.** `/expenses`, `tb_expenses` (migration 055). A
STANDALONE LEDGER: it reads no deal, changes no payout figure, and appears
in no export. The plan is `docs/expense.md`; R2 to R4 are open in
`todo.md`.

### Every row computes from its OWN rate

`aed_amount` is `GENERATED ALWAYS AS (round(raw_amount * exchange_rate, 2))
STORED`. A generated expression can only see columns on its own row, so it
cannot reach `tb_fx_rates`, today's rate, or another row. **Editing a rate
in Settings moves zero expenses**, by the shape of the column rather than
by a rule anybody has to remember.

- **`exchange_rate` is AED per ONE UNIT** of that row's currency, captured
  when the expense was entered. Nullable: a missing rate is not a rate of 1,
  and `aed_amount` is NULL with it.
- **Expenses and the global rates setting share nothing.** `v1/expenses/`
  imports no `fxRates` anything. Pinned by `expenseIsolation.test.js`.
- **The rate is typed, suggested from the ledger itself**: the most recently
  created expense in that currency, dated by `created_at`. Past
  `STALE_RATE_DAYS` the label warns instead of reassuring.
- **AED locks the field to 1.** The only lock; every other rate stays
  editable.
- **A total is `SUM(aed_amount)`, never a raw amount multiplied by a rate.**
  That is the one way this page could still report today's rate over old
  money, so a guard refuses `SUM(raw_amount)` outright.

### `sync_key` is a match candidate, never a unique key

Two identical taxi fares on one day are TWO expenses. It exists so the
import (R3) can find POSSIBLE matches with an indexed lookup; it never
decides, and it carries no unique index. `expenseIdentity.js` is its one
definition, folding through the master sheet's own `fold`.

### `spent_by` is free text, deliberately

The people who front an expense are not all in `tb_people`: managers are,
the boss and admins are in `tb_accounts`. A foreign key could not record
"an admin paid it" without inventing a person, and it would drag the orphan
machinery onto a row that is not a deal.

### ONE MONTH AT A TIME, and the page does not choose it

**The ledger is the CURRENT month and nothing else**, his call 2026-09-14.
No month picker, no date range, no archive.

- **The month comes from `currentMonth()` in the route**, never from the
  query string. Which month it is, is the business's question, and the
  admin's clock is ten hours from the server's: a browser sending its own
  month would put two people on two different ledgers at a boundary, with
  neither looking wrong.
- **Every read is scoped, and the scope is not optional.** `buildWhere`
  THROWS without a valid `YYYY-MM`. An unscoped read would total every month
  the table holds and look exactly like one month's figure.
- **A half open range, `>= the 1st AND < the next 1st`**, so it uses the
  `(spent_on DESC)` index and cannot lose a row to a time component.
- **The month belongs to `spent_on`**, derived, not a marker. An expense has
  a real date; a second fact could disagree with the first.
- **The page NAMES the month** in its header, its total and its empty state.
  The route returns it alongside the rows for exactly that.

`archived_at` is still on the table and **nothing writes it**. Archiving
went with the month scope: a month ends, it does not get tidied. The column
stays for the burn in `feature.md` item 0.

### Filters and search

Only what no filter reaches goes in the search box. Filter panel: group,
currency, AED amount range. Search box with a field picker: anything,
description, payee, spent by. **People are searched, not filtered**, so
there is one way to ask.
`EXPENSE_SEARCH_FIELDS` and the repo's `SEARCH_COLUMNS` are the two halves,
each pinned by its own test.

### The export modal: FOUR QUESTIONS, NO TABS

`ExpensesExportModal`, not the master sheet's. That one is tabbed because a
payout file is a preset, a layout, a month and a breakdown design; a ledger
is a list, and four short questions behind tabs is four clicks to see what
fits on one screen. **The four are fixed:**

1. **One file, or one per group as a zip.** Per group needs more than one
   group to mean anything, and is disabled otherwise. A row with no group
   gets its own file rather than being dropped: a split that loses rows is
   a split nobody can check.
2. **Columns.** `spent_on` and `description` cannot be unticked: a list of
   amounts belonging to nothing is not an expenses sheet. A narrowed file
   still re-imports.
3. **Groups.** None ticked means all of them.
4. **Colour**, its own four entry palette, NOT `breakdowns/palette`: a
   shared colour list is a change to one export showing up in the other.

Everything it offers is **served** from `/expenses/export/options`, never
listed in the modal as well.

**SAME CONTROLS AS THE MASTER SHEET'S, shared not redrawn.** `SettingRow`,
`Choice` and `Swatches` moved to `components/export/ExportControls.jsx` on
2026-09-14; both modals and `BreakdownPicker` import them. Two export modals
answering the same kind of question two different ways is the fault
`SettingRow` was written to fix, one level up. Pinned by a test that refuses
a private copy in any of the three.

Groups and Columns are `Select multiple` with the count in the LABEL
(`Columns · 6 of 7`) and an All button beside them, the same shape the
master sheet uses.

`zipBuffer` moved to `shared/zipBuffer.helper.js` so both exports use it. It
takes named buffers and knows nothing about either format, so sharing it
cannot let one export read the other's file.

### Import and export, sharing NOTHING with the master sheet

Its own routes, its own multer, its own parser, builder and diff modal.
**A deals file and an expenses file must never be able to reach the other's
parser**: the headers differ, so the wrong one reads zero rows and reports
an EMPTY file rather than a wrong one, which is worse than failing. Pinned
by `expenseIsolation.test.js`, both directions.

- **ONE COLUMN LIST**, `expenses/expenseColumns.js`, written by the export
  and read by the import. A file this CRM produced is a file it can take,
  and a round trip that loses a column loses it silently.
- **`aedAmount` is written and never read back.** It is generated, so a
  typed cell must not be able to disagree with the two numbers that make it.
- **The export's Total row is not an expense.** What drops it is the
  required pair (a date AND a raw amount), not a rule about the word.
- **Two requests, and the first writes nothing.** Preview parses and
  compares; commit writes only what came back accepted, in ONE transaction.
  Half an imported file is worse than none.
- **Three tabs, two of them questions.** `new` ticked; **`duplicate` NOT
  ticked**, showing what each row matches, because two identical spends on
  one day are two real expenses; `noRate` ticked, importing with a NULL rate
  and staying out of the total until somebody sets one. **The importer never
  invents a rate.**
- A file listing the same spend twice asks the same question as a file
  repeating one already recorded.

### One form for adding and editing

`AddExpense` takes an `expense` prop and becomes the edit form, the way
`DealsEditor` gained `mode`. An edit form that drifts from the add form is
two answers to what an expense is.

**Save and add another** keeps the date, currency, rate, group and spent by
and clears the rest, so a stack of receipts is one modal rather than eight.
The count is shown, because a modal staying open otherwise reads as a save
that did not take.

### Delete is the only row action

Archive and Restore were built and taken back out on 2026-09-14 with the
move to one month at a time. Nothing here detaches or orphans, so the word
Remove is not used on this page either.

## Payable amount

The sheet's own column L:

```
payable_amount = monthly_amount ÷ days_in_preset_month × payable_days
payable_days   = 0            if the start is after the month ended
                 whole month  if it began on or before the 1st
                 otherwise    month_length − start_day + 1
```

The denominator is the **preset month's real length**, so a full month always
pays the full monthly amount whatever the month.

**Computed, never read off the sheet.** The sheet's own two columns resolve
on only 67 and 58 of 96 rows.

**It recomputes on every write**, from one definition
(`calculator/computePayable.js`): on upload (`mapSheetRow`) and on a cell
edit (`shared/recomputePayable.helper.js`). Editing monthly amount or payable
days re-derives the amount; editing payment start, preset or **appointment**
re-derives both. Typing into payable amount overrides the formula and is
left alone.

### The appointment date drives four cells

His sheet, verified: column F is `=E2+90` on 78 of 96 rows and column H is
`=DATE(YEAR(E9)+1,...)` on 73, and I reads F, and L reads I. So he types
ONE date and four move.

```
appointment ──+90 days──→ payment start ──→ payable days ──→ payable amount
            ──+1 year───→ end date
```

**AND THE FIRST WEEK EXCEPTION, 2026-09-18.** An appointment on or before
its month's first Friday takes the LAST FRIDAY OF MONTH 3 instead of +90,
and is owed that whole month. Only the payment start changes; the end date
and the arithmetic below are the same in both branches. Full rule at the
head of this file.

The CRM stored the appointment and let it drive nothing until 2026-09-08.
Editing it left a row paying against a start that no longer matched.

- **One definition, `shared/fromAppointment.helper.js`**, used by the
  parser, the cascade and the suggestion panel. Mirrored in
  `web/src/helpers/fromAppointment.js` for the optimistic row; each side
  pinned by its own test, never read across.
- **NINETY, NOT EIGHTY FOUR.** Both of his written documents say 12 weeks
  and "84 days from incorporation"; his spreadsheet says 90 on every one of
  those 78 rows, and the money was paid against the spreadsheet. His call,
  2026-09-08.
- **AN UPLOAD NEVER FILLS A BLANK.** A genuinely empty payment start means
  `Ongoing`, full month, and stays empty; the export panel and the cell
  marker offer the date instead. Only a deal **created by hand** fills both
  from the appointment, because there the admin typed it a moment ago and
  left the rest.
- **Clearing the appointment nulls nothing.**

#### The three date cells say so themselves

Added 2026-09-08. The suggestion was one modal away from a cell that was
already sitting empty, so the master sheet marks it in place.

- **`web/src/helpers/suggestDates.js` is a deliberate mirror** of
  `shared/suggestDates.helper.js`, same arrangement as `fromAppointment`.
  Both halves run the other's test cases.
- **`web/src/helpers/dateNotices.js` decides WHICH CELL says what**, same
  shape as `reviewFields.js` `flaggedColumns`. Forward (his own formula)
  marks each empty cell it fills, grey. Backward (an appointment worked back
  from a payment date) marks the APPOINTMENT ONLY, amber: the other cells
  there follow from a date the CRM invented, and a grey "this is the
  formula" on them would misreport where the number came from.
- **`mismatchedDates` finally has a caller.** A stored date that disagrees
  with the appointment shows on that cell with NO button. Reported, never
  corrected: his August send paid the INDIGO pair a whole month where the
  formula gives six days.
- **A row with none of the three gets nothing.** Twelve of the 96 live rows
  are the `Ongoing` roster and are correct as blank.
- **Accepting goes through `useMasterSheetCellEdit`** like any other cell
  edit, so it paints before the request lands and rolls back if it fails.
  One patch can move two cells; the toast says "dates" when it does.

#### A date column is written as `YYYY-MM-DD`, never as a Date

The route's own `parseDate` returns a plain string, and the cascade now
matches it. **This is not a style choice.**

The derivations build UTC midnight, because every comparison in the money
rules is on UTC day components. `pg` serialises a Date in LOCAL time, so a
UTC midnight Date leaves a Pacific machine as `2026-07-13T17:00:00-07:00`
and Postgres casts that to a `date` using the SESSION timezone: correct in
a UTC session, **a day early in a Pacific one**. The same Date read by
Diane's `formatValue`, which uses local getters, said 13 July for a payment
start of the 14th. That is how it was caught, and it is the same class of
fault as the `currentMonth()` one below.

`asDateString` in `fromAppointment.helper.js` is the conversion, and
`fromAppointment.test.js` pins it both ways.

#### Two guards, two questions

`manually_overridden_fields` asks whether an uploaded FILE may overwrite a
cell. The cascade asks something else: **does this cell still hold the
formula's answer?**

```
stored payment start == what the OLD appointment derived  ->  recompute it
otherwise                                    ->  a human chose it, leave it
```

"What the old appointment derived" is `startFromAppointment`, so it reads
+90 or the first week Friday without this test knowing which.

They cannot be the same array. The cascade WRITES payment start and end, so
those columns would be claimed by its own output and the second appointment
edit would be blocked by the first. This is what Excel does: a cell holds
either the formula or a literal typed over it.

### A derived column follows its inputs, never the file

Fixed 2026-09-08. Three faults, one shape.

1. **`repo.update` claimed every key in the patch**, including the ones
   `recomputePayable` had just added. One edit to the monthly amount froze
   `payable_amount` against every future upload. `update` and `updateMany`
   now take a `derived` list and leave it out of the claim.
2. **`syncUpsert` decided each column alone.** Edit the rate to 2000 and
   upload a file carrying 1100 and a new payment start: the rate was
   claimed so it stayed, the start was not so it moved, and the amount came
   from the file computed off 1100. The row printed a figure that followed
   neither. `shared/resolveDerived.helper.js` resolves the inputs exactly as
   the upsert will, then recomputes the two derived columns from the result,
   in JS through `computePayable`. Writing the formula into the SET list
   would have been a fourth copy of the money rule.
3. **The web mirror used the OLD day count.** `withPayable` read
   `row.payable_days` from before the edit, so moving a payment start
   painted a wrong amount for one round trip.

**The first fix on its own would have moved totals.** Dropping the claim
without (2) lets the next upload overwrite a derived figure whose input is
protected. They are only correct together.

### Words in the payment start column

Eighteen rows hold prose. Two kinds, opposite meanings:

- **`Ongoing`** (12 rows) means what a BLANK cell means: no recorded start,
  full month, not flagged.
- **Anything else** (`AUGUST END FULL`, 6 rows) is a note over the column's
  own formula. The formula is the answer, re-run by `repairFromAppointment`
  through `startFromAppointment`, so a first week appointment is rescued to
  its month 3 Friday and everyone else to +90. **The row is FLAGGED and his
  words are kept.**
- **Prose with no appointment** stays unknown, keeps the note, flags the row.

This was read the other way once and it cost money: `AUGUST END FULL` was
taken to mean a start of 31 August plus a standing instruction to pay a whole
month. His own August drafts pay that row **29 days from 2026-08-03**, and
pay the `OCTOBER END FULL` pair **nothing**. Both dates are appointment + 90.
Migration 038 dropped the column that stored the misreading.

#### It is a READING, not a rule, and that was recorded wrongly here

**Corrected 2026-09-08.** This section used to end at the paragraph above,
and the test asserted `needsReview: false` on those rows, because
appointment + 90 was taken to be his rule.

**It is not a rule. He resolved the same phrase two ways in one month.**

| his August send | who | appointment | start he used | days | paid |
|---|---|---|---|---|---|
| `milkman august.xlsx` | James King, Drew | 2026-05-05 | 2026-08-03, appointment + 90 | 29 | 1,169.35 each |
| `indigo 1 august.xlsx` | Lucy Okenabirhie, Nicola | 2026-05-28 | **2026-08-01**, not + 90 | 31 | 1,200 and 800, whole month |

Appointment + 90 for the INDIGO pair is 2026-08-26, which is 6 days, so
232.26 and 154.84. **The CRM would have under paid them 1,612.90 in August
and said nothing.** The earlier reading was settled on the MILKMAN pair
alone; the INDIGO pair was never checked.

So the computed figure is unchanged, and the row now carries his words in
Notes and a review flag. `parseUpload.js` `reviewReasonFor` writes
`payment start reads "...", read as appointment + 90 days`, and
`web/src/helpers/reviewFields.js` puts the marker on the payment start
cell, the amount and the days. That reason string is a contract between the
two and is pinned on the web side by `reviewFields.test.js`.

## Which month it is, is the BUSINESS'S question

`currentMonth()` was `toISOString().slice(0, 7)`, which is UTC. The admin is
on Pacific time, so from 5pm on the last day of every month until midnight
UTC the CRM was already in the next one: every total, every cell colour and
every export said September while the calendar said 31 August. Wrong for
seven hours a month, only ever at a boundary, and indistinguishable from a
real drop in the total.

- **`TIMEZONE` in the API's environment**, an IANA name, read AT CALL TIME
  so the helper can be imported before dotenv has run. Unset it falls back
  to the host's own zone, which is UTC on most cloud servers.
- **ONE definition, in `v1/shared/presetMonth.helper.js`.**
  `masterSheet/rollToMonth.js` kept a second copy and the two disagreed the
  moment one of them learned about timezones; it now re-exports.
- **A CONTRACT with the web side.** `MasterSheetExportModal.jsx` derives the
  month from the browser's own clock rather than UTC, and each side pins its
  half: `shared/businessMonth.test.js` and `export/exportMonth.test.js`.
  They agree as long as `TIMEZONE` names the zone the admin is in.
- **An unknown zone name falls back to UTC** rather than throwing. A typo in
  `.env` would otherwise take down every figure in the CRM from inside
  `Intl`, and the value is also read by `configs/env.js`.
- Said at boot, and it says when it came from the host rather than the
  variable, because getting it wrong is otherwise silent.

### NO SQL MAY ASK WHAT DAY IT IS

Making the JS half zone aware left the database in UTC, which is worse than
both being wrong together: between midnight and 7am UTC the two disagreed
about the DATE, and at a month boundary about the MONTH. The total said
August while the "starts this month" filter said September, off one screen.
One wrong answer is a bug; two different answers is a bug nobody can
reproduce.

**The session zone cannot be set, and both ways were tried.** This connects
through the SUPABASE POOLER, which swallows startup `options`; a
`SET TIME ZONE` on `pool.on('connect')` cannot be awaited, so it races the
first query on a new connection and pg warns about the overlap. Both came
back UTC.

So `currentMonth()` is the ONE authority and **the month travels as a bound
parameter**. `masterSheetRows.repo.js` binds it for both `presetWhen` and
`paymentStartWhen`, each with its own placeholder. Pinned by
`repos/monthFilterZone.test.js`, which runs at 1 September 02:00 UTC and
asserts August. `now()` and interval arithmetic are untouched: an instant is
an instant, and a `date` column has no zone to convert.

## The preset is the boss's, and nothing rewrites it

The preset date is his period marker: "this row is for August". **It comes in
as the sheet writes it, goes out as he left it, and he changes it on the
Master Sheet page like any other cell.**

- **On upload it is an ordinary column**: writable when the file carries it,
  shown per row in the diff, accepted or rejected, fillable per upload when
  the file omits it. No special casing.
- **On export nothing touches it.** `rollToMonth` changes no stored value; it
  only reports `period_ended` and `for_this_month` for the month asked for.

**A total counts only rows marked for that month.** One rule,
`shared/presetMonth.helper.js`, used by the payout totals, the master sheet's
total blocks and the breakdown. A row marked September stays on the sheet,
tinted, and out of August's figure — like an ended period and a "should be
paid: no". **A row with no preset is always counted**: the twelve "NA" roster
rows are owed every month.

**Ended is decided against the month generated, not against today.**

**Only this month can be generated, and there is no picker.** The export
modal used to offer this month and the next two; nobody ever chose the
next two. A payroll run is made for the month you are in, and offering a
future one invited a file whose presets nobody had set yet, whose total
reads near zero, and which is indistinguishable from a broken export. The
tab names the month it will produce ("Generate for August 2026"), resolved
at render so it cannot go stale.

### What counts, for an August run

| preset | in the total |
|---|---|
| 2026-07-01 (old) | no |
| 2026-08-01 (current) | yes |
| 2026-09-01 (future) | no |
| none / "NA" | yes |

| end date | in the total |
|---|---|
| 2026-07-31 (old) | no |
| 2026-08-31 (current) | yes |
| 2026-09-30 (future) | yes |
| none / Ongoing | yes |

**They differ on `future`, and that is correct.** The preset says which run
a row belongs to, so September's row is not part of August's. The end date
says when the deal stops, so ending in September means it is still running
through August. The only end date that excludes a row is one that passed
before the month being generated.

## Exports

### The master sheet export COMPUTES ITSELF

His sheet is live and ours was dead. Four of his columns are formulas, so he
types one appointment date and four cells move; we wrote the answers as flat
numbers, which is a sheet he can read and not one he can work in.
`masterSheet/sheetFormulas.js` puts them back. Built 2026-09-09.

```
E Appointment (typed) ─→ F  =E+90
                       └─→ H  =DATE(YEAR(E)+1,MONTH(E),DAY(E))
G Preset      (typed) ─┬─→ I  the day count, from F and the preset MONTH
K Monthly     (typed) ─┴─→ L  =ROUND(K/DAY(EOMONTH(G,0))*I,2)
```

**Three columns stay literal** because they are what he edits: Appointment
date, Preset date, Monthly amount. A cell holding a formula is one he cannot
type into. His three `=(7000*1.05)/2` cells in Monthly amount are notes on
single rows, not a column rule, so there is nothing to reproduce.

**THE FORMULA IS THE CRM'S RULE, NEVER THE ONE IN HIS FILE.** His own sheet
is wrong three ways and `calculator/computePayable.js` already corrects all
three on import, so the formulas restate the corrected version:

| his file | what we write |
|---|---|
| rows 74-85 divide by `EOMONTH(H)`, the month the contract ENDS in. Up to £160 a head across 17 people | always the preset month |
| nothing rounded, so a payable amount carries twelve decimals | `ROUND(…,2)` |
| a preset of `NA` gives `#VALUE!` on 12 rows | pays the full monthly amount, which is what his own Payable amount column does on all twelve |
| `F<=G` measures the preset CELL, so row 4 (preset the 2nd, not the 1st) is a day out | measures the preset MONTH |

Writing his version would be **worse than writing none**: the export already
puts the correct figure in the cell, so his formula would recalculate on open
and silently change 12 rows to a number the CRM calls wrong. A file that
contradicts itself the moment you open it is the one outcome to avoid.

**EVERY DERIVED CELL, INCLUDING ONES A HUMAN TYPED OVER.** His call
2026-09-09: "we are systemising their wrongdoing, so we stick with formula."

So the file diverges from the CRM on exactly one class of cell: one an admin
has OVERRIDDEN. **The stored value is untouched**; this is the FILE's answer,
and `manually_overridden_fields` still protects the column on the way back in.

The documented example of that class is the INDIGO pair, Lucy Okenabirhie and
Nicola on Leadstone solutions: appointment 2026-05-28, so appointment + 90 is
2026-08-26, while his own August send paid them a whole month from the 1st.
On an August preset that is 31 days against 6, and on monthlies of 1200 and
800 it is **£1,612.90 for the pair**, not per row. Note this is the shape of
the disagreement, not a confirmed row in the database: in his file that cell
holds the prose `AUGUST END FULL`, which the CRM already reads as
appointment + 90 and flags, so on that pair the formula and the stored value
currently AGREE.

- **The cached result follows the same chain**, so the file reads identically
  before and after Excel recalculates. `payable_days` is measured against the
  payment start the FORMULA gives, never the stored one.
- **A dropped column leaves the cell flat, never `#REF!`.** `NEEDS` lists what
  each formula points at, and the selector can drop any non-required column.
- **`ISNUMBER` guards every reference.** `Ongoing` and `NA` are text sitting in
  date columns; unguarded, `=E+90` on a blank prints 30 March 1900.
- **The end date feeds nothing.** It gets its own formula and no other formula
  reads it, which is what keeps the CRM's rule intact: an end date alone never
  drops a row, and it touches money only through the Settings toggle.

**THE PAYMENT START COLOUR IS LIVE TOO**, added 2026-09-09. The single-tab
export never carried it at all: `addDealRow` tints the month tabs and
`buildSingleTab` only ever tinted manual rows, so the boss's own three
colours were missing from the file that replaces his working document.

It is CONDITIONAL FORMATTING, not a fill. A fill is dead paint that lies the
moment he edits a preset, which is the same fault the flat numbers had. His
own sheet already does it this way, and these are his three conditions
unchanged:

```
F > EOMONTH(G,0)                red     starts after the month ends
AND(F >= G, F <= EOMONTH(G,0))  amber   starts inside the month
F < G                           green   already running
```

**ONE BLOCK, NOT HIS FIVE.** His are `F2:F37`, `F2:F79`, `F38:F73`,
`F74:F79` and `F80:F85`, grown by hand as the sheet did, with priorities
interleaved. Three consequences in his live file: rows 80-85 carry only the
green rule so a late start is not coloured there at all, rows past 85 have
no rules and his sheet is 105 rows, and amber is `theme 5` on two blocks and
literal `FFC000` on another. Ours covers every written row.

**The `ISNUMBER` guard is ours.** `EOMONTH` on the text `NA` is `#VALUE!`,
and a rule that errors simply does not paint, so his twelve NA rows were
uncoloured by accident. Saying it on purpose also keeps a blank start
uncoloured: `Ongoing` is not a date and must not read as "starts before the
month". A dropped payment start or preset column writes no rules at all
rather than painting the wrong one.

**SINGLE-TAB EXPORT ONLY.** The month tabs write their totals as flat values
in column C through `countsTowardTotal`, which reads the colour setting, and
no Excel formula can reach a settings row. Live rows above a static total
drift apart on the first edit. Making that file live means making every total
and the whole breakdown live too, and one of its rules cannot be expressed in
Excel at all. The payout, division and breakdown templates are untouched for
the same reason: a record that recalculates is not a record.

### The end date column follows the setting

`SEND_COLUMNS` is the shape of his own send, thirteen columns, and the end
date is not one of them. But with `color_uses_end_date` ON, `isOwedThisMonth`
drops a row whose end date is behind the month, so the payment start turns red
**because of a date the file does not show**. `SETTING_LED_COLUMNS` in
`buildWorkbook.js` adds it to the default selection in that case only, and
`listExportColumns({ useEndDate })` takes it as an argument rather than
reading it, the same arrangement `owedThisMonth.helper` uses.

Threaded to both readers so they cannot disagree about what a default file
carries: `export.js`'s `/export/columns` route, and Diane's
`exportDraft.js` `defaultHiddenFor`. `columnsFor` and `columnKeysFor` filter
on `required` and need no flag; `exportCard.js` never reads `inSend` at all.

### A new group needs no code change, and one character used to kill the file

**Nothing enumerates groups.** They are `SELECT DISTINCT group_name`, they
arrive by being written in a sheet, and `RECLAIMS`, `ALL BOOKS` or `JARVIS`
all work on the day they appear: their own tab, their own line in the
warnings panel, the suggestions and the cascade unchanged.

`GROUP_ORDER` in `buildWorkbook.js` is the ONLY place group names are typed
and it decides **tab order only**. An unknown group sorts alphabetically
after the known five rather than being dropped.

**But Excel refuses seven characters in a sheet name** (`\ / ? * [ ] :`)
and exceljs THROWS on them. So a group called `TAKEOFF / OLD` did not
produce an odd tab, it took the **whole export down** with a 500 and a
reference code, and nothing said which group did it. A name over 31
characters was silently truncated, and two groups truncating to the same
thing threw again as a duplicate tab. Found 2026-09-08.

`masterSheet/sheetName.js` cleans the name and reports whether it had to.

**THE RENAME HAS A COST, AND IT IS PAID.** On a per group tab the tab IS
the group: there is no Group column, and `parseUpload` reads the worksheet
name. A renamed tab would re-import its rows under a DIFFERENT group, and
the group is part of a deal's identity, so every row would come back as a
duplicate. So when a name has to change, **the Group column goes back on
that tab**, and a Group column beats the worksheet name on the way in. A
tab that kept its name does not gain the column.

Pinned end to end in `masterSheet/newGroups.test.js`: every name, including
the illegal ones, is exported and re-uploaded into the group it came from.

**EVERY EXPORT IS SCRUBBED OF ITS FINGERPRINTS.**
`shared/scrubWorkbook.helper.js` runs on the way out of every builder: it
clears creator, lastModifiedBy, company, manager and the title fields, and
pins created / modified / lastPrinted to **1980-01-01**, the same instant
the zip entries carry so the two cannot disagree. Leaving the dates unset
does not work, because exceljs then writes today's.

**The timestamp was the real tell**, saying to the second when a file was
generated. Two builders also wrote `creator = 'Intake CRM'`, naming the
system outright.

**STRIPPED, NEVER FAKED.** `dc:creator` comes out as `Unknown` because
exceljs hardcodes `this.creator || 'Unknown'`, and that is the right
outcome: it names no person and no system. Writing a plausible name in
would be forging authorship, which is a different act from declining to
record your own. `docProps/app.xml` still says `Microsoft Excel`, hardcoded
by exceljs with no property API behind it; it names a spreadsheet program
rather than this CRM, so it is left alone.

**Every download names its own document**: `NEXUS - BANK - 2026-08-24.xlsx`,
from `shared/exportFileName.helper.js` and each template's `fileLabel`
(MASTER SHEET, MONTH SHEET, BREAKDOWN, EXPENSING, CASH, BANK, BANK DETAILS).
People beat groups in the name; several people become a count.

**Every layout's columns are a choice, with the old fixed shapes as the
defaults.** One catalogue of 24 fields in `buildPayoutSheet.js`, one row
builder, per-sheet header overrides (`payable_amount` is "Payable amount" on
Expensing, "Amount" on Cash, "Amount payable" on Bank). Only "Name of
individual" can never go. **Absent means the default set, not every column**,
so a script or an old link still gets his own file.

**All three payout files carry "Should be paid or not", and a `no` is not in
the total.** `shouldBePaid` is one definition feeding both the column and the
figure. The cell is tinted green for yes, red for no; the row stays plain.

**THE BREAKDOWN IS A PICKER, NOT A SWITCH.** It was "Include breakdown", on
or off. There is more than one shape of that block now, and two shapes
cannot live behind one toggle without a second control that only means
something while the first is on. So OFF IS A CHOICE IN THE LIST, and
`breakdown=false` still resolves to the `none` design, which is what keeps a
saved link meaning what it meant.

The designs live in `masterSheet/breakdowns/`, one file each, registered in
`breakdowns/index.js` and served at `GET /export/breakdown-designs` so the
modal never holds its own copy of the list. `buildWorkbook.js` keeps the
band-row primitives and PASSES them to a design: they are used throughout a
950 line file, so hoisting them to suit three small ones would be a large
edit to a load-bearing document for nothing gained.

- **standard** is what the month tab always produced, unchanged and moved.
- **with-usd** is the boss's own "attach 1": both pivots side by side, a
  converted column, both rates printed, and the cash split into what stays
  local and what has to be sent.

**The picker shows a PREVIEW, built from one fake group.** A breakdown is a
block of figures at the foot of a tab in a file that does not exist yet, so
a name and a sentence cannot say what you are about to generate. The sample
never changes between designs, so switching changes the layout on screen and
nothing else, which is the only way to compare two. Its own arithmetic ties,
because a preview that does not teaches you to distrust the real one.

**The GBP rate is fetched live, and can never break an export.**
`shared/fxRates.helper.js` reads `FX_RATES_URL` (open.er-api.com: free, no
key, USD base, ~160 currencies including AED). Cached 6 hours because the
source itself is DAILY. Every failure path returns a rate rather than
throwing: a payout file that will not generate because a third party is
down is worse than one converted at yesterday's number. A dead host
degrades in ~350ms. It does not retry, does not persist (the rate that
matters is printed on the file), and does not look up AED.

**The sheet says where its rate came from**, beside the rate itself: live
mid-market, entered by hand, or `FALLBACK, live rate unavailable`. A
converted figure with no provenance cannot be reconciled next month, and a
stale constant must not pass for today's market. **A typed rate always
wins** over the live one: mid-market is not what a bank quotes, so looking
one up when the admin has already said would overrule a person with an
average.

**Two rates, and only one of them is a rate.** GBP to USD floats and is
overridable per export (`?usdRate=`); AED is PEGGED at 3.6725 and must not
share an input with it. The live feed returns exactly 3.6725, which is the
confirmation the constant is right rather than a reason to look it up. His sheet prints one cell reading 1.36 while using
both. **A currency with no rate is left blank and named in the block, never
converted at par** — which is how `EURO` (not `EUR`, on 6 rows) now announces
itself instead of silently counting as zero.

**Away is money leaving the country, and it is one definition**
(`shared/awayLocations.helper.js`) reading `tb_settings.local_locations`
(migration 040, default `Abu Dhabi`). **The list is the LOCAL one**: away
places are open ended and unknowable, local ones are few and known, and
listing the away side would let a new UK town count as local, which
understates what has to be sent. The split is on CASH only: a transfer has
no notes to carry anywhere.

**THE DIVISION SHEET is the breakdowns and nothing else**, one tab per
group, no deal rows. Same rows and the same block as the month tab: what
differs is who reads it. That tab is for checking a person's row, this is
for counting out the money, and handing the second reader 96 rows to scroll
past is the wrong document. It **rolls to the month like the month tab**,
or two files generated minutes apart would carry different figures for one
group. It renders through the same `breakdowns/` registry, so a design
fixed once is fixed in both. A group with nothing in the run still gets a
TAB saying so: a missing tab reads as a group somebody forgot. **"No
breakdown" is not offered there**, since that file IS the breakdown and the
option would hand over empty tabs.

**The fills are the boss's own**, `#F4AF82` for the pivot headers and the
two totals, `#FBE3D5` for "of which UK" and "of which other". The preview
uses the same hex rather than theme tokens, and paints them PER CELL, not
per row: "UK send in GBP" wears the dark fill on its label and the pale one
on its figure, which is what marks it as the one line in pounds among a
column of dollars.

**THE SHAPE SETTINGS ARE ALIGNED ROWS: a name on the left, a control on
the right.** They were three settings that all answer "how does the file
come out", drawn three different ways: a toggle, a bordered button with
loose text beside it, and a pair of format buttons, with a caption on only
one of them. Three idioms stacked read as three unrelated things. Every one
is now a `SettingRow`, and every two-state choice is a `Choice` that NAMES
BOTH STATES rather than a switch whose meaning lives behind an info icon
(hover does not exist on the phone this is also used from).

**The format row is HIDDEN while PDF is off**, not shown greyed. No mode
carries `pdf: true`, so it offered exactly one usable choice, and a control
you cannot change is not a choice: it is a claim that something is
available. Same reasoning as the hidden totals switches, and it returns on
its own the moment a mode sets `pdf`.

**PDF STAYS OFF FOR THE MASTER SHEET, and stays BUILT.** The route, the
print page and the templates are all intact; re-enabling is `pdf: true` back
on a mode and nothing else. **People's PDF is separate and still live**:
that one hands over one card per person and is the reason the print page
exists at all.

### The person export's pay box

The five facts saying how to pay somebody sat as loose label/value rows
under their name, so they ran into the companies below and read as the
first entry rather than as the header for all of them. They are a bordered
box now, with padding, and `break-inside: avoid` so five lines never split
from the labels that explain them.

**A FULL HAIRLINE, never a stripe down one edge.** The house style's one
hard no, and on paper a single heavy edge reads as damage rather than
emphasis.

**One definition, two templates.** Breakdown and MonthlySheet each wrote the
same five rows out, so a column moving meant two edits and one of them being
missed. Both render `templates/pdf/PayBox.jsx` now.

**A value we do not hold says "not held", quietly.** It was an em dash,
which the house style forbids outright, and a dash in a money document reads
as a value rather than an absence.

**THE WHOLE CONTROL FOLDS BEHIND A GEAR.** Closed, it is one line: the word
Breakdown, the chosen template's name, and a `Configure` button. Open, it is
the template picker, the two colour rows and the sample. A picker plus two
palettes plus a preview is the right amount of CONTROL and the wrong amount
of MODAL: it is settled once and then read past every time, so what stays on
screen is the answer rather than the machinery. Closed by default, because
the defaults are the document the boss wants.

**FIVE COLOURS, PRIMARY AND SECONDARY**, in `breakdowns/palette.js` and
served beside the designs from one request. They are Excel's own accent
tints, which matters twice: a generated file does not announce itself as
generated, and they survive a monochrome printer, where a saturated fill
becomes a grey block with the figures lost inside it.

**THREE WEIGHTS, AND `strong` IS DARK** (2026-09-14). `strong` is Excel's
darker 50% step of the accent and carries WHITE BOLD type; `soft` and
`faint` are the pale supporting tints with black type. `strong` used to be
a pale tint, which left no shade a header band could use, so the bands were
a hardcoded BLACK: pick green and the file printed a black bar over green
headers. `palette.js` names the white once (`headText`), because a header
that took the dark fill and kept black type was unreadable in four places
at once.

**Everything that is a header or a band takes `strong`:** the deal table
header, the side table header, `Row Labels`, the company and group total
bands, and the Grand Total HEADING. Everything supporting takes the
secondary's `soft`: the Grand Total figures, `simple`'s currency totals, the
`with-usd` method totals.

**ONE PICK PAINTS THE WHOLE EXPORT.** Three colours used to be typed into
the builders and never asked the picker: the band was black, the month
sheet's Grand Total was fixed green and the division sheet's fixed orange.
`buildWorkbook.setPalette()` is the one place that resolves them now, and
`buildPayoutSheet` calls it too because it borrows `styleHeader`: without
that a payout-only export painted its headers in whatever the last month
sheet left in module state. Pinned in `adjustmentRows.test.js` against
`fillsFor`, never a typed hex, plus one assertion that no cell anywhere is
still black.

**A 1% FEE LINE, ONLY WHERE THERE IS CRYPTO.** Paying in crypto does not
end the job: it still has to be converted before anyone is handed money,
and that costs about one percent. The line sits under the per-method USD
totals so the figure somebody works to is the figure they will actually
need. Live case is ALL GROUPS: two EURO rows worth 1,000 convert to
$1,166.99, fee $11.67. The other groups have no crypto and get no line,
because a "1% FEE $0.00" row on four tabs is a row that means nothing.
**Taken from the UNROUNDED total**, then rounded once: rounding the total
and then taking a percentage rounds twice, and on a document that
reconciles against a statement the second rounding is the one nobody can
account for. `CRYPTO_FEE_RATE` is a constant because it appears in the
figure AND in the label.

## Add ons and fees: two rates, opposite directions

**An ADD ON is added. A FEE is deducted. Never swap them.** Migration 047.

```
addon_percent  ADDED     income on top of the payable amount
fee_percent    DEDUCTED  taken off the total, AFTER the add on
```

**Both exist at two levels and they STACK**, on `tb_people` and on
`tb_mastersheet`. A person on 5% with 3% on one row is 8% on that row.
Neither level overrides the other, which is why both cells warn: typing 3
and being charged 8 is the failure to prevent.

**ORDER IS THE ARITHMETIC.** 500 at 8% add on and 2% fee is 540 then
529.20, not 529.00. `v1/shared/rates.helper.js` is the only definition, and
`paymentBreakdown`, Diane's `moneyTotals` and the export all read it.

**`fee_percent` kept its name and changed its meaning**, which is the
dangerous kind of change. Migration 047 moves every value it held into
`addon_percent` first (they were add ons, written when a fee was the only
percentage there was) and zeroes the column. That is what makes it safe: a
reader not yet updated still ADDS `fee_percent`, which is now 0, so it
contributes nothing. It fails to zero, never to an inverted sign.

- **Both are in the totals.** `paymentBreakdown` summed `line.total` alone,
  so a sheet printed `Fee 25.00` and then a total that did not contain it.
- **Both are included in every subtotal and grand total.** The plain
  `Converted to USD` design folds add ons and fees directly into its net
  figures without printing named adjustment rows. The explicit
  `Converted to USD + Add ons table` design prints `Add ons`, `Fees` and
  `Crypto charges` blocks for readers who want the working detail.
- They travel into the builder as an option the way company tiers do
  (`peopleRepo.rateMap()`), because they live on `tb_people` while the deal
  rows come from `tb_mastersheet`.
- The crypto fee is unrelated and untouched: that table is what the main
  company sends us, not the manager breakdown.
- **Written through the ordinary profile PATCH**, not a route of its own. It
  had `setFeePercent`, a bare UPDATE, which wrote nothing for a person with
  deals but no `tb_people` row yet: most of them, since that row is only
  created on first edit. `upsert` is the one writer for every profile field.

**WHICH LOCATIONS ARE LOCAL IS A SETTINGS CARD**, and the important half is
that **the list of places is DERIVED from the deals, never stored**
(`distinctLocations`). A location the boss invents next month appears in
that card by itself, so classifying it is a tick rather than something
somebody has to remember to add to a list. Only the ticks are saved, in
`tb_settings.local_locations`.

Spellings are folded on `lower()`: "Abu Dhabi" on 19 rows and "Abu dhabi"
on 2 are one place, and offering both as separate things to classify is how
one ends up ticked and the other not. Each row shows its row count, because
a place on one row and a place on twenty-six are very different decisions
and the name alone does not say which.

**TICKED IS LOCAL, and the direction is the decision.** Away places are
open ended and unknowable; local ones are few and known, so the short list
is the one worth maintaining. The cost is that **a brand new place counts
as sent until somebody ticks it**, which errs toward over-stating what has
to travel rather than under-stating it. An empty list is a real answer
("nothing is local"), not an unset one.

**LOCAL AND AWAY ARE A COMPUTED LEVEL in the pivot**, not a place somebody
typed. `Away` used to appear only because four rows literally carry the
word in their Location column, so it drew on INDIGO and MILKMAN and was
absent from NEXUS, ALL GROUPS and MANBAT. That reads as a missing figure
when it is really a missing spelling, and it meant renaming a location
could move money to the wrong side.

**CASH ONLY**, matching the summary block's own rule: a transfer has no
notes to carry anywhere, so splitting it by where the money "goes" answers
a question nobody asked. Bank and crypto list their locations plainly.

**THERE IS NO "LOCAL" HEADING.** Local is the default and needs no
announcing, so those locations sit directly under Cash and Away is the one
exception worth naming. A pair of headings made the common case look like
a special case.

**Away carries NO FIGURE**, like the method line above it. It is a
heading; the money is on the currency rows underneath. A subtotal there
would be a second figure for the same thing and the reader has to decide
which of the two to trust. It **prints even when empty**, because "nothing
is going out" is an answer and a line that is sometimes there is one
nobody can look for in the same place twice.

Locations stay nested under it rather than collapsed: somebody has to
carry cash to Black country AND to South east, and one collapsed figure
does not say where.

A row whose location IS the word `Away` gets no line of its own. It has no
place to name, and printing it read as "Away, of which Away"; its money
still counts in the subtotal (`UNPLACED`).

**Weights follow the file's own rule.** A method is a HEADING so it takes
`head`; Local and Away are TOTALS so they take `soft`; locations and
currencies are detail and stay plain. They were `faint`, the grouping
weight, which left the one figure that matters barely visible.

**"Away" the LOCATION and "away" the RULE are different things.** Some rows
carry the literal location `Away` (2 in INDIGO, 2 in MILKMAN, none
elsewhere), and it appears in the location pivot exactly like `Main City`
does. The UK/other split does not read that word at all: it is
`local_locations` from settings, so every group with an Abu Dhabi row gets
a local figure, NEXUS and ALL GROUPS included. The `Away` rows are classed
away only because they are not Abu Dhabi.

**Each colour is a PAIR, and that is what makes any combination safe.** The
admin picks a named colour, never two arbitrary values, so the secondary is
always the pale step and black text sits on it whatever is chosen. Primary
owns the headings, secondary owns the totals and the faint band, so the two
supporting weights stay in one family. Default is orange primary, grey
secondary: a second hue is decoration, and grey supports the primary rather
than arguing with it.

**CELL PADDING IS `indent`, AND EXCEL IGNORES IT UNLESS HORIZONTAL ALIGNMENT
IS SET.** That is why figures sat hard against the gridline. Every cell in
the block now states its alignment: labels left with their nesting indent
plus one, figures right with one.

**The converted design is the DEFAULT**, in the modal and in
`breakdowns/index.js`. The standard block was only ever the default because
it was the shape that already existed. Two layout tests broke on that change
and were right to: they pinned the standard layout while calling the builder
without naming a design, so they were really testing whichever was default.
Both now name `standard`.

**The picker cards carry the name only.** A sentence each, three across a
row, overflowed into one another. The preview says what the choice means
better than a description could, and the description survives as the card's
title attribute.

**The preview keeps the sheet's own gaps.** The per-method USD totals, the
rates and the answer block are three separate statements, and the blank rows
between them are how the sheet says so. Merged into one table they read as
one thing.

**A TEMPLATE FORWARDS ITS OPTIONS WHOLE**, never a hand-picked list.
`monthlySheet.js` destructured five named options, so the breakdown design,
the rate and the local locations reached the route, reached the template,
and were dropped there: the picker changed nothing in the file and nothing
said why. The builder already ignores what it does not use, which is the
right place for that decision. Any template that names its options will
break the same way the next time one is added.

**A design declares its own method words** (`methodStyle`). The converted
layout says "Bank Transfer" in its pivots where the standard block says
"Bank", and its own USD totals shorten it back to "Bank". All three are the
boss's, on the same page. Declared by the design rather than fixed in
buildWorkbook, so a label cannot be right for one document and wrong for the
other.

**THE SHEET USES THREE WEIGHTS OF ONE COLOUR, never more.** `HEAD` is the
boss's orange, for a heading or a figure somebody signs; `SOFT` is it
thinned, for a total or a line supporting one; `ZEBRA` is barely there, for
the grouping rows, so the figures stand out from the labels that organise
them. **Colour means IMPORTANCE here, never category**: a reader should find
the numbers that matter without learning a key.

**Every currency converts, off the live table.** `toUsd` knew USD, GBP and
AED by name, so `EURO` (6 rows) came out blank and, worse, was missing from
Total Cash entirely: the cash figure was understated. `fxRates` now returns
all 166 rates, `CURRENCY_ALIASES` maps `EURO` to `EUR`, and anything the
table lacks is still left blank and named rather than guessed. The stored
`EURO` is still not a currency code and is still worth folding at the
parser.

**THE PAYMENT START CELL IS A TRAFFIC LIGHT, AND THE RULE IS THE BOSS'S
OWN.** It is his three conditional formats from `master.xlsx`, restated:

```
red    start >  EOMONTH(preset)   not started yet
amber  start >= preset            started during this month
green  start <  preset            already running
```

**Two cells decide it, the start and the preset.** Not payable days, not
the amount, not the end date. A blank start is the sheet's "Ongoing" and a
missing preset has no month to compare against; both are green.

**VERIFIED AGAINST HIS FILE, 2026-08-28.** The conditional formats were read
straight out of `master.xlsx` (column F is payment start, G is preset):

```
F > EOMONTH(G,0)                → red
AND(F >= G, F <= EOMONTH(G,0))  → amber
F < G                           → green
```

Our `paymentStartState` was run against that formula over all 78 dated rows:
**78 match, 0 differ.** His own tally is 20 red, 6 amber, 52 green. A start
anywhere INSIDE the preset month is amber, first day, mid month or last day
alike.

His column F is itself a formula, `E+90`: appointment plus 90 days. Note
`todo.md`'s open question, that both of his written documents say 84.

**It was wrong until 2026-08-27** and worth recording why. It read
`countsTowardTotal` and treated green as "no recorded start", so 76 rows
that were simply running normally came out amber. Against his rule the
live sheet is **69 green (57 running, 12 blank), 6 amber, 21 red** — the
CRM was saying amber where he says green on two thirds of the sheet.

All three are TINTS, not signal colours: a payout tab is mostly figures and
three saturated fills would fight the numbers they describe. The amber is
deliberately not the breakdown's orange, which already means "a heading or
a figure you sign".

### The condition is the rule, and the colour only renders it

`v1/shared/owedThisMonth.helper.js` is the one definition, and it is in
`shared/` rather than in the workbook builder because **what a month owes is
a business question**, not a spreadsheet one. It was in `buildWorkbook.js`,
so the Division Sheet imported an xlsx writer to ask about money.

```
isOwedThisMonth(row, {useEndDate})     the fact
   |- paymentStartState()   the colour, red / amber / green
   |- countsTowardTotal()   the total, plus "is it marked for this month"
```

Neither reads the other. **Nothing anywhere asks "is the cell red"** to
decide a figure, so retuning a tint or adding a fourth one moves no money.
Verified on the live MILKMAN August file: 0 rows red and counted.

**`useEndDate` is an argument, never a module-level flag.** It was a `let`
set by one entry point, so the Division Sheet's totals ignored the setting
completely and the master sheet's obeyed it.

**The end date is now in it, behind the Settings toggle.** Off, only the
payment start decides. On, red also means *ended before this month* and
amber also means *ending inside it*.

### Five things used to answer this question, and they disagreed

`isPeriodEnded` on its own, the end-date-direct exclusion, dropped a deal
whose period had finished. On MILKMAN's August that removed ten rows and
**6,500 the boss's own sheet pays**, including two who ended on the 26th and
are still paid the whole month. It was removed from the master sheet and the
Division Sheet first, and three readers were missed:

- **`buildPayoutSheet.js`** kept its own copy, so Cash, Bank and Expensing
  totalled differently from the sheet they were generated beside.
- **`templates/xlsx/payout.js`** destructured `{ columns }`, throwing the
  setting away, so the payout files totalled on the default whatever
  Settings said. Options are forwarded whole now.
- **Diane** (`agent/tools/masterSheet.js`) totalled by it too, so she would
  have quoted a figure the file in front of the admin disagreed with. She
  reads the setting and the shared rule now.

All four exports and Diane move together: MILKMAN August GBP 19,120.95,
bank 4,500, and the toggle moves every one of them identically.

### An excluded row says so, on the column it is about

- **Master sheet:** the whole row wears `ENDED_FILL`.
- **Payout files:** the AMOUNT cell, and the Status cell when it was picked.
  It was Status alone, which the bank and expensing default column sets do
  not carry, so an excluded row sat on those files with its money out of the
  total and nothing at all marking it.

**HEADERS ON ROW 1, no title and no blank.** A per-group tab carried the
group name on row 1 and a blank row 2, and the blank was not decoration:
`readSheets` treats a blank row as the start of a new table, so it was the
only thing stopping the TITLE being read as the header row on re-upload.

**Both go together.** With no title there is nothing for the blank to
protect the file from, and the group was never read off it: it comes from
the TAB NAME, which is one of the four places `parseUpload` looks and the
only one a per-group tab has.

Verified by building both shapes and re-parsing them: a per-group file
round-trips 40 INDIGO rows even when the FILENAME names no group, so the
tab alone places them, and the tabbed workbook still splits 96 rows across
five groups identically. `HEADER_ROW` is one constant, because three things
read it (the header styling, the number styling, the side table beside
them) and the whole reason this took four edits is that it was a repeated 3.

**The one loss:** the group no longer appears on the printed page, only on
the tab. PDF is off for the master sheet, so nothing prints from here.

**MULTI FILE hands over one file per group, zipped**, instead of one
workbook with a tab per group, and it is **ON by default**: what the boss
does with an export is forward a group's sheet to that group, so the split
files are the useful shape and the tabbed workbook is the exception.

Every tab offers it. The switch only appears when two or more groups are
selected, or none (which means all of them): one group cannot be split, and
a toggle that changes nothing is worse than no toggle. `?multiFile=true`,
split by `shared/rowsByGroup.helper.js`.

Each entry is named `<GROUP> - <LABEL> - <stamp>.xlsx` and the zip is named
without a group, because it is the run rather than anybody's. Zip entry
dates are pinned to 1980 rather than "now", so the archive does not stamp
its own generation time.

**Every export is finished into a buffer before a byte is sent**, and sent
with `Content-Length`. Two reasons: a throw happens before any header goes
out, so the error handler can still answer with JSON instead of the socket
dying mid archive; and a declared length is what lets the browser report a
real download percentage.

**THE MODAL STAYS OPEN UNTIL THE FILE IS IN HAND.** It used to set
`window.location` and close in the same breath, so building five workbooks
and zipping them left the screen blank and apparently hung with nothing on
it that knew a download had started. It is fetched over XHR now
(`api.download`), in two honest phases: **Building N files…**, which sweeps
because nothing about that wait is measurable, then **Downloading N%**,
which is real. The Export button carries the fill, the same idiom
`FileButton` uses for uploads. Closing is the last step, so the modal
disappearing is the confirmation; a failure leaves it open with the
selection intact and toasts the reason.

**The group filter's everything option is "All", never "All groups"**,
because `ALL GROUPS` is a real group (the twelve NA roster rows) and the
two sat in the same box with no way to tell them apart. Changed on every
group filter in the CRM, not just the export.

**A group tab is laid out one company at a time** — Director, then Mid by
seat, then KP — which is how he writes his own sheet. Companies alphabetical,
folded so "Relia PA" and "Relia Pa" are one block.

**The breakdown has two stages, and the admin picks one.** `simple`:
currency, its methods, that currency's total, no location level and no Grand
Total, because two currencies are two payment runs and nothing adds across
them. `standard`: method, location, a total per method and a Grand Total, keeping
the location level however many currencies there are.

**A currency row only appears when there is more than one** (2026-09-13,
`standard` only). With one currency in the group the location carries its own
figure: the code said nothing on every line and pushed each figure an indent
away from the place the cash is going. Pinned row for row against his nexus
sheet in `adjustmentRows.test.js`, and mirrored in the web preview.

**The export modal warns before it generates**, per group, only about things
that change the total: a preset set to another month (one-click fix), no
monthly amount, and on the Bank export a transfer with no account number.
Fixes write to the CRM and the panel redraws from the server.

**It is one thin collapsed line**, "N rows affect this total, in M ways",
amber only when something needs acting on. Expanding gives a row per
warning, and Fix opens the per-row editors inside it. Stacked open, the
panel pushed the count and Generate off the screen.

## The pages

Master sheet, People, Companies, Expenses, Flagged, Chat, Logs, Settings.
Every list page has cards below `md` and the table hidden, a `Toolbar` with
search, inline checkboxes, a filter panel and one Clear, and a row count.

**THE PRODUCT IS CALLED DIANE.** Not "CRM", not "WHATBOT CRM". The sidebar,
the page title and the visible copy all say Diane; the agent and the product
now share the name, which is the user's call. The one collision left is the
header's "Ask Diane" button sitting under a sidebar that also says Diane.

**A CLEARED FILTER USED TO COUNT.** Unticking "Active only" left the badge
reading 1 and Clear on screen with nothing to clear. Every toggle clears by
setting its key to `undefined`, deliberately, because the filter has to
disappear rather than invert and `toQueryString` omits undefined. The KEY
survives that, and two pages counted `Object.keys(filters).length` while two
counted values. `helpers/filters.js` `countFilters` is the one definition,
and a test fails any page that counts keys again.

**FILTER PANELS AND THE SETTINGS TABS SURVIVE A RELOAD.** The values were
already sticky and the panel showing them was not, so every refresh
collapsed the row and you reopened it by hand to reach controls you had just
been using. `Toolbar` takes a `storageKey`; a page without one behaves as
before rather than silently sharing a key.

**Filters are switches again, not checkboxes.** They were switches, then
checkboxes on the argument that a filter has no meaningful off state, and
they are switches again on the user's call: the tick was a 16px outline that
read as decoration in a row of buttons. The rule underneath is unchanged,
off is no filter at all and `onChange` sends `undefined` rather than `false`.

**EVERY TAB ROW IS A SEGMENTED CONTROL**, and no active state is an edge.
Settings tabs, `HandlerTabs`, the upload diff's tabs and Chat's group tabs
were all a 2px accent underline, which was the heaviest mark on a page of
hairlines and hollow cards. They are filled pills in a tinted track now, so
the weight comes from a fill.

**ACTIVE AND HOVER MUST NOT LOOK THE SAME.** Both sidebars had them as a
pale tinted rectangle, so the page you are ON and the one under the cursor
read at the same weight and the eye had to compare two hues. Three
differences now, not one: the solid accent fill, the ink text colour, and a
ring. **Hover is a plain grey wash and never coloured**, so the coloured one
is always where you are. `navigationStyles.js` is the shared definition for
`Layout.jsx` and `SettingsPage.jsx`; `Select` follows the same visual rule.

**Diane's scroll areas have no bars.** A deal list scrolls inside the
conversation, which scrolls inside the panel, so two bars sat side by side
down one edge: two controls where the question is only ever "is there more".
`ScrollMore` answers it at the bottom centre instead, only while there is
something below, and it replaced the separate "jump to latest" pill, which
was the same signal drawn twice.

**A PLURAL QUESTION NEEDS A PLURAL ARGUMENT.** "Gloria plus Gloria
Difference" was answered perfectly and "Nicola for August and September"
was answered wrong, one turn apart. `people` was an array and `month` was a
string: somebody thought about several people and nobody thought about
several months. One call could not carry two months, so a two month
question needed two calls and nothing said so.

`total_master_sheet` takes `months` now, and the multi month answer is that
same handler run once per month, never a second copy of the arithmetic.
The months in the admin's current sentence override guessed or dropped model
arguments. Each inner answer is marked so it cannot split that same plural
sentence again, and the computed sentences finish the turn without a model
rewrite. This remains authoritative when the model requested an extra read in
the same round. Progress remarks naming months outside the question are hidden.

**The test is more of the fix than the array is.**
`v1/agent/tools/pluralAsks.test.js` reads every tool's schema and enforces
the rule, so a tool added next year with a singular `month` fails the build
instead of reopening the class silently. It found four more the moment it
ran: `active_companies`, `check_rates`, `recall_past_conversations` (all
real, in `docs/todo.md`) and `update_person`, which is singular on purpose
because a plural WRITE needs the two call `confirmed` shape. It compares
the gap set EXACTLY, so a stale entry fails as loudly as a new one and the
list cannot outlive the work.

**A ZERO IS A FIGURE CLAIM WEARING NO NUMBER**, and `checkFigures` could
not see it. Asked Nicola's August and September totals she said "owed
nothing" for both. August was right, those rows are marked September;
September was 2,900. She called the tool ONCE, for August, and wrote the
second sentence herself.

The guard built for this exact incident passed it, because the reply had no
digits in it: both months are stripped as dates, "3 rows" is under
`SMALLEST`, and the figure set came back empty. `checkMonths` is the guard
for the gap. A month she makes a money claim about must be the exact month and
year a tool reported on, one retry, same shape as the others.

**It is bound to "FOR <month>", not to the sentence.** Scoping it to any
sentence containing a money word flagged *"her payment starts in November,
so nothing is owed yet"*, which is correct: the month there belongs to
STARTS, not to OWED. The bias is deliberate, and it is the one
`checkFigures` already warns about: a check that cries wolf on prose is one
people learn to widen.

**BOTH RATE LEVELS ARE IN HER CONTEXT.** Asked whether "Gloria difference"
had a percentage she said no, then yes when pushed. Both answers came off
the same row: the DEAL's add on is 0 and the PERSON's is 5, they STACK, and
only the deal's was ever in front of her. `DETAIL_FIELDS` carries
`person_addon_percent` and `person_fee_percent` now, which the repo was
already selecting so a cell could warn the pair stack. She was not guessing,
she was answering with half of it.

**And `checkPercents` is the guard, because every rate in the system sits
under `checkFigures`' floor of 100.** It checks two shapes: a rate she
STATES that no tool produced, and a rate she DENIES that a tool did. Two
things it deliberately does not flag, each of which was a false positive
first:

- **A denial beside a real figure is a distinction.** "The deal carries no
  add on, but she is on 5%" is the correct answer to the turn that caused
  the guard.
- **The system crypto charge is real to quote but does not APPLY.**
  `check_rates` returns `cryptoPercent` on every call, so counting it as
  applied flagged her for obeying the tool's own order to say the charge
  does not apply. Two buckets: `all` is "is this number real", `byKind` is
  "does this rate apply".

The regex bug worth remembering: `%` is a non word character, so `\b` after
it can never match and `5%` read as no rate at all. The guard was blind to
the commonest way she writes one, and its own tests passed.

**TWO PEOPLE, ONE NAME, AND NO WAY OUT.** The disambiguation offer was
`new Set(rows.map(nameOf))`, which DEDUPES BY NAME while ambiguity counts
PEOPLE. Two different `person_id`s called "James Smith" made her ask "which
one: James Smith?", and answering it asked again, forever. Nothing in the
real sheet hits it; renaming anybody would, which is what makes it worth
more than the bug it looks like.

`labelsFor` gives one label per PERSON: the bare name where it is theirs,
the name plus a company where it is not, the person key where even that
collides. `resolvePerson` matches the label as well as the name, in ONE
filter, because four copies of that filter is how the exit got lost the
first time. Pinned in `resolvePerson.test.js`, which had no test file at
all until now.

**PLURAL SUBJECTS AND PLURAL FILTER VALUES NEED OPPOSITE FIXES.** Two
people wants TWO answers kept apart; cash AND bank wants ONE answer over a
wider filter. `answerEach` is right for the first and would answer a
question nobody asked for the second, which needs `= ANY($n)`. Only
subjects are enforced by `pluralAsks.test.js`; the filter list and the
three dimensions with no read filter at all (`company`, `role`, `tier`) are
recorded in the same file, pinned so the note cannot rot.

**Dates on her card read as dates.** `2026-08-05` is the same eight
characters whether it means 5 August or 8 May, and this is read by people
paying other people. Display only: `cell.value` stays ISO for the editor,
and an unparseable value passes through, so the sheet's own `Ongoing`
survives.

**She answers FROM the row now, rather than hedging about it.**
`cardSummary` told her "for your reference only, not to be repeated" and,
two lines above, "if they asked about a phone number, say THAT". A please
do not beside a here it is, so whether she named a value came down to the
roll. The inconsistency was the defect, never the value: there is one admin,
one credential, and every field is already on the card, the master sheet
page and every export. What the rule actually protects is the CARD, from
thirty one lines of `label: value` repeated under a card showing all thirty
one, and that part stays.

**THE CRM IS LIGHT GREEN**, to match Diane. One edit, `tailwind.config.js`,
and every page followed because they all read the `accent` token. It went
yellow first and came back the same way, which is the token doing its job.
The exception is deliberate: **the master sheet's cell tints are
untouched.** Those are
`bg-[#CDEBD5]` / `#FFE3A3` / `#F8C9C4` literals in
`helpers/paymentStartState.js`, they mean running, started this month and
not started, and they are the one place colour carries meaning rather than
identity.

A light theme cannot use one yellow for everything, so the ROLE is in the
key and picking the wrong one is unreadable rather than merely wrong:

| key | for |
|---|---|
| `accent` | a fill. Takes `accent-ink` on top, never white |
| `accent-deep` | the same fill, hovered. Still takes ink |
| `accent-strong` | text, icons and borders ON WHITE. The only one that clears 4.5:1 |
| `accent-ink` | text that sits ON the fill |

### Corners are rounded, and borders are faint

Both were reversed on the user's call. `borderRadius` was `DEFAULT: 0` with
a comment reading "flat, sharp, deliberate", so every radius in the app
compiled away to nothing; it is a five step scale now (`sm` a tag,
`DEFAULT` a control, `lg` a card, `xl` a dialog, `full` a pill).

**The radius lands on the BASE elements**, `button`, `input`, `textarea`,
`select`, not as a class on each of the hundred controls. One rule, and a
control that forgets it is not a thing that can happen. Badges are pills,
`.table-wrap` and the cards are `lg`, `Modal` is `xl` and rounds only its
top on a phone, where it is a sheet flush to the bottom edge.

`overflow-hidden` on any card with a tinted header, or the card is round
and its header is square.

Borders went from `#c3ccc7` to `#e7ede9`, faintly green rather than grey. A
hairline separates two surfaces; at the old weight every card on a page read
as an outline first and content second.

`text-white` on the old green was 4.8:1 and on the new fill is 1.7:1, which
is a label you can see is there and cannot read. Two were left behind by the
swap and are fixed: `.btn-primary` and the upload diff's tick. The swap also
turned up `bg-accent-soft` in `BreakdownPicker`, a colour that has never
existed in the palette, so that open state had been drawing no fill at all.

### One detail page, two records

`components/layout/DetailLayout.jsx` is the shell both detail pages stand
in. They had the same structure written twice and an identical `Stat`
copied into both, which is two files to edit for one decision.

    overview    WHAT THIS RECORD IS: identity and editable profile fields.
    summary     WHAT IT COMES TO: money, rates and counts.
    records     The deals table, always the full content width.
    supporting Contact and banking panels, paired where space permits.

On a wide screen the overview takes three quarters and the summary one
quarter. Supporting cards span the page next, with Person Contact and Banking
side by side. The records table then spans all four columns at the bottom, so
its editable cells do not lose a third of the page to a sidebar. Card padding,
statistics and detail tables use the denser type scale, and the tables need
only a 900px working width.

**Breakdown is the highlighted summary.** Both detail pages use the same solid
mint as the filter button on the header only, with a white content surface so
the figures remain easy to scan. Percentage controls fill the available width and keep their
floating labels on one line, preventing Add on percentage and Fee percentage
from colliding at the narrow summary width. They block negative keyboard and
pasted input immediately, in addition to validating the saved range.

**The detail monthly total is calculated, never trusted from a stored sum.**
People and Company detail routes total only deals for the current business
month and recompute each contribution from the preset rule:
`monthly amount / days in the preset month * payable days`. A deal with no
preset contributes its full monthly amount every month. A deal marked for
another month or starting after its preset month contributes nothing; an end
date excludes it only when the end-date setting is enabled. Currencies remain
separate, and add ons and fees remain separate breakdown controls.

**Detail controls have one value size and one label pattern.** Name set the
12px scale, so Status, Tier, Old group, Notes, person profile fields, rates
and editable contact fields now match it. Native inputs use `FloatingField`;
dropdowns use Select's own `label` support and the `detail` size. Labels rest
inside an empty field and notch into its border on focus or once filled.
Captions above values remain only for facts that are read only.

**A floating label has a local layer, not an application layer.** The shared
label is one step above its own input. Select raises the complete field only
while open, and portalled panels own their separate layer. This keeps resting
labels from every CRM page below Diane's full screen Command Center while
preserving dropdown, modal and tooltip ordering.

`PersonDeals` and `CompanyHandlers` are the deals lists, lifted out so the
layout reads as a layout. Same cells, same writes, same claims against the
next upload.

### Companies is a card grid

Cards at every width (`CardList columns`), not a phone's copy of a table.
The table is gone: six columns of which two were one word each, against a
card that shows the same facts and can be opened with a thumb.

Each company now has a clear identity header, monthly money label, grouped
facts panel and a dedicated action footer. The whole card remains the open
target, while the tier control and handler action stop propagation. Hover
lifts and scales the card under a stronger shadow without changing its border.
The compact type scale keeps five cards readable across a wide screen, and
the handler action is labelled Manage because the people icon and company
context already supply the object.

The Companies page requests at most 16 records at a time. Shared pagination
shows every page through page 10. Above that it keeps the first, current window
and last page visible with ellipses, plus an inline Go-to-page field. Prev, page
numbers, Go to and Next stay on one horizontally scrollable control row.

People and Companies share one Grid/Rows toggle. Grid uses the same record-card
grammar on both pages; Rows is a plain comparison table with the same inline
actions. Each page remembers its own selection in session storage across
reloads, outside the filter namespace so Clear filters cannot reset the view.

Tier is a labelled Select on the card, so it uses the same floating label as
the detail form while remaining editable in place. Company status still owns
the Active only filter and the detail Status field. Active is the normal state
and is no longer printed on every card; only the exceptional Closed state gets
a badge. The detail page has no separate Close action because it duplicated the
Status field.

**The tier stays editable in place**, which is the whole reason that column
exists. It sits in the card's `actions` row because that row already stops
a click reaching the card behind it; among the facts, every attempt to open
the dropdown would have opened the company instead.

**Flagged uses the same card grammar.** The seeded page showed that the latest
message is the reason to open a flag, so it is the primary body rather than
one fact among dates and category. `ClampedText` measures the rendered value,
holds it to two lines with an ellipsis, and shows `CellInfo` only when those
two lines genuinely overflow. The popup carries the complete message.
`npm run seed-concerns` supplies 32 sample flags across 26 people for
pagination and content checks.

**Settings actions match the rest of the application.** View logs is a medium
secondary link button with a logs icon. Burn this month is the same medium
danger action shape with a trash icon. Navigation, record actions and page
actions were audited for unlabeled icon gaps; text controls such as Cancel,
Confirm and pagination remain deliberately icon free. Pagination uses the
shared visible secondary surface, border and shadow rather than a transparent
quiet action.

**People's Export is hidden, not deleted.** `SHOW_EXPORT` in
`PeoplePage.jsx`; the modal, its hook and the print route are untouched. The
one-person Export action is also hidden from Person details.

**Detail history follows the detail page scope.** A Person page sends its
stable `person_id`, so Recent changes covers every current deal held by that
person. A Company page sends its company name through the same API and repo
filter. The Master Sheet leaves both filters empty and keeps the global audit.
Scoped history excludes deleted records whose deal no longer exists because
the old log stores no stable person or company identity for them; guessing from
a display name would put another person's edit in the panel.

## Diane

A tool-calling LLM with CRUD over `tb_mastersheet` only. She cannot guess:
`search_master_sheet` returns every candidate, so more than one hit means she
must ask. Replies are post-processed (`stripMarkdown`, `noDashes`).

**THE PAYMENT PERIOD IS DERIVED, NEVER SET**, 2026-09-09. There was an
override: `status` in `manually_overridden_fields` and `paymentPeriodSql`
returned the stored column instead of computing.

`isOwedThisMonth` never saw that claim, so **the money never moved with it**.
Gloria carried four deals with identical dates and read Ended on two, beside
a GREEN payment start cell, with her £500 still in September's total. The
tooltip said the quiet part out loud: "the end date on this deal is January
1, 2026, so it would otherwise read active."

The badge is a function of the tint, with no exception:

| payment start cell | payment period |
|---|---|
| green or amber | Active |
| red | Ended, or Not yet paying |

Red asks one extra question to say which, and that is the column's whole
reason to exist.

- **Three cells could set it**, on the Master sheet, the Person page and the
  Company page. All three are badges now. `periodEditOptions` and
  `PERIOD_EDIT_OPTIONS` are gone; `PERIOD_FILTER_OPTIONS` stays, because
  reading and filtering were never the problem.
- **Diane cannot either.** `status` left `ROW_FIELDS`, which closes
  `update_master_sheet_row`, `fill_form` and `add_deal` at once, and left the
  bulk tool's own `set` block. Asking anyway hits `DERIVED_FIELDS` and gets
  the real reason, because falling into "status is not a column on a deal"
  is false and she would repeat it.
- **`payableThisMonth` stopped reading the badge.** It was a fifth reader of
  what a month owes, and it carried `?? r.status`, the stale upload value.
  That is how a card said "not payable this month" over money still in the
  figure.
- **Migration 052** cleared every claim left behind. It removes a claim,
  never a value: `tb_mastersheet.status` is still stored, still written at
  upload, still filtered on.
- **The SQL half is pinned by reading the string.** No test in the suite runs
  SQL, so when the branch was put back by hand every test still passed. The
  old test there asserted `indexOf('manually_overridden_fields') < indexOf(...)`
  and went on passing at `-1 < 41`, which is why it was deleted rather than
  inverted.

**The end date cell now says what the toggle is costing.** With the setting
off a finished deal still reads Active, still tints green and its amount is
still in the figure. Correct, and invisible, which is how somebody pays a
finished deal. `popup.endDatePassed` on the end date cell names the date, the
money and where the switch is. It appears only while the setting is off, and
it wins that cell over any note about the formula.

**EXPORT AND ADD A DEAL ARE OFF**, his call 2026-09-09. Off, not removed:
`agent/disabledTools.js` wraps `export_sheet`, `add_deal` and
`new_deal_checklist` in `contexts.js`, which is already the one place her
tools are assembled. Re-enabling is deleting an entry.

The HANDLER refuses and hands back his words finished; the description is
changed only to save a round trip. A line in her prompt would have been the
shape of every guard in `v1/agent/` that had to be built after the prompt
failed. Nothing is written and no card comes back, so she cannot claim she
did it either. `new_deal_checklist` goes with `add_deal` because it is the
add flow; `edit_deal_form`, `fill_form` and `update_master_sheet_row` are
untouched, so editing an existing row still works. Wording and the open
follow-up are in `docs/diane.md`.

**MONEY ANSWERS ARE FINISHED BY THE TOOL, NOT REWRITTEN BY THE MODEL.** A
single-person total is one month headline followed by short deal bullets,
including zero-value deals and their reason. A several-person total uses one
line per person with base, rate adjustment and resolved total; a requested USD
conversion is one final combined line. Multi-month requests keep every month
instead of silently answering only the last one. Real bullet characters survive
the plain-text reply cleaner.

**A DEAL SCOPE IS RESOLVED AGAINST LIVE GROUPS FIRST, THEN COMPANIES.** "NEXUS
deals" therefore means the NEXUS group even if the model initially puts the
word in a company argument. Only a name that truly exists as both a group and a
company asks which one was intended. Short person names must occur as complete
words, so `Ad` can no longer be manufactured across the boundary in "Nicola
details".

**A RATE FOLLOW-UP NAMES ONLY THE RATES THAT MADE THE PREVIOUS CONVERSION.**
The prior computed answer supplies that currency set when the model omits it;
the source, timestamp and AED peg status still travel with the figures.

**EVERY EXPORT WAS 500ing.** `/export/xlsx` referenced a bare `preset` that
was never declared in the handler, so it threw `preset is not defined`
before building anything. Live, and invisible from the transcript: the
client catches it and says "that one would not build on my end", then
Diane's turn, already in flight, announces the file as downloading. An
admin reads the second sentence. `v1/exportRoute.test.js` now drives the
real route with only the repo and the FX call stubbed, asserts the body
starts with `PK`, and covers every template, since the fault sat in shared
setup above the template switch.

**A RENAMED GROUP IS A SILENT DOUBLING, and the upload now asks.** The group
is inside the identity key, so renaming MILKMAN to MILKY gives every row a
new key: all 33 import as NEW, and the 33 stored rows are shown NOWHERE,
because "different deals" is scoped to the groups the FILE speaks for and
the old name is not one of them. Verified on the live sheet: the renamed
keys matched nothing and the unmatched list came back empty. The sheet would
hold 66 rows with both sets counting.

`masterSheet/renamedGroup.js` compares rosters on person, company and role,
which is the identity with the GROUP TAKEN OUT: exactly what survives a
rename. Over 60% overlap and at least 3 rows, and only between a stored
group the file never mentions and a file group the CRM has never seen. It
REPORTS, it does not act: a rename and a new group cannot be told apart from
the data, and both guesses are bad. Guess "new" and the money doubles; guess
"rename" and a group nobody renamed gets rewritten.

**ONE RULE FOR A GUESSED YEAR, in `shared/guessedYear.helper.js`.** It lived
in the tools and the export imported it across, which was a require CYCLE: a
cycle means the guard can be `undefined` at call time, and an undefined
guard is none. Every month-taking tool reads it now, so a new capability
cannot re-earn the 2024 bug. On the export it judges only THIS turn's
argument, never the month already on the card, or an unrelated "make it
blue" would quietly re-date the file.

**"TABS" FORCES ONE FILE.** The wording was rewritten twice and she produced
a zip both times. Tabs is the one word that cannot mean separate files.

**WIDENING THE SCOPE IS ITS OWN ACT.** Omitting `groups` merges as
"unchanged", so "all of them" left the card on two. `allGroups` clears it,
and the group literally named ALL GROUPS is still nameable.

**NOT EVERY NUMBER IS A FIGURE.** `checkFigures` flagged the year in
"September 2026" and a phone number, costing a retry each on replies that
were correct. Dates, ordinals, years and runs of ten or more digits are
stripped by SHAPE before the scan, so a real amount that happens to look
like one is still caught.

**A HALF NAME THEY TYPED IS A QUESTION.** "What is glori on" answered about
Gloria: she tidied the fragment into a name that then matched exactly, and
the exact-name rule exists to protect a name the ADMIN typed. A word in
THEIR sentence that starts two different names and is nobody's whole name
now asks. A pronoun does not, which is the case that must not break.

**`ALL BOOKS` was two names for one group.** The audit excluded a group that
does not exist, so an ALL GROUPS row with no company would have been wrongly
flagged. Latent today: no row has a null company.

## A month, kept exactly as it stood

`tb_month_snapshots` (migration 049) is the record forecasting reads. One
row per month: every deal WHOLE, snake_case keys and all, plus the figures
computed once at the time.

- **THE FIGURES ARE STORED, NEVER RECOMPUTED.** Recomputing September under
  whatever the rules are in March answers a different question, and would
  answer it differently again the next time a rule moved.
- **What the rules WERE travels with them**: the end date setting, the
  crypto percent and the FX rate. Without those the numbers can be repeated
  a year later but not explained.
- **IMMUTABLE AT THE DATABASE**, not by convention. There is no update
  function, and the table carries a rule making UPDATE do nothing. A
  verification script or a stray migration walks past a comment.
- **DELETE is allowed, UPDATE is not.** A month taken by mistake has to be
  removable, and a delete is loud and total where an update is quiet and
  partial.
- **Taking it twice keeps the FIRST.** Deliberately not an upsert: "take
  September again" after an edit would replace a record somebody has
  already read and paid from.
- **It never joins a live total.** `owedThisMonth` reads the live table and
  only the live table, or a figure would depend on which copy was asked.
- **Take it BEFORE the roll.** One taken after the presets move is a copy of
  the new month wearing the old month's name.

**A GUARD ONE DOOR ALONG IS NOT A GUARD.** The bulk edit refuses a phone, an
address or a bank account. That bought nothing: told to put one number on
three people she called the SINGLE ROW tool three times and it landed on all
three. The check is not on the FIELD, which is legitimate on one row, but on
the same VALUE reaching a SECOND person within one turn. `runAgent` creates
one `turnState` per turn and injects it like `said`, so the tools can see
what the other calls in that turn already did. The next turn starts clean, or
correcting a mistyped name would be impossible.

**THE AMOUNT FOLLOWS ITS INPUTS, WHICHEVER DOOR THE EDIT CAME THROUGH.** The
page's PATCH recomputed and so did the bulk edit; `update_master_sheet_row`
and `add_deal` did not. A row edited through Diane stopped following from its
own inputs (20 payable days on 1,000 a month, payable 0), and every deal she
created was born owing nothing. All four now call the same
`recomputePayable`.

**A FORM IS A SCREEN TOO.** The claim detector covered the export card only,
so "I updated his end date on the form" with no `fill_form` call went
straight through. `wantsPanelAct` now checks a form claim whether or not a
card is open.

**TOTAL CRYPTO.** The left pivot printed "Crypto $1,160.90" while the answer
block beside it named only bank and cash, so the one place somebody reads
before paying was short by a whole rail. It sits under Total Cash and ABOVE
the split, because "Of which UK" and "Of which other" divide the CASH total
and must still sum back to it. Only for a group that HAS the rail: a zero
line on every other group is a row to read past every time.

**THE BREAKDOWN STEP SHOWS THE SHAPE.** Every design is on screen as a tiny
real sample, dimmed to 30% and coming up on hover, focus or once chosen. The
samples are real tables at their natural width, scaled and clipped inside a
fixed box, so a wide one cannot widen the drawer or scroll the page.
`fillsFrom` is the one definition of the sample colours, shared with the
export modal.

**A YEAR SHE WAS NEVER TOLD IS A YEAR SHE GUESSED.** Asked to "update all
the presets to September" she wrote 2024-09-01 on all 96 rows: the right
month, the wrong year by two.

NOTHING ON SCREEN SAID SO, which is what makes this the dangerous shape. The
filters answered CORRECTLY: "Preset: an old month" showed all 96 and "Preset:
this month" showed none. Both right. The sheet simply owed nothing, for every
row, and the only clue was a year in a column. It had happened before, on
Anteep Sourcing, and sat in todo.md as money at risk.

A bare month carries no year, so somebody must supply one, and she is the one
party who must not guess. A preset landing more than
`PRESET_MONTHS_EITHER_SIDE` (13) from the business month is REFUSED unless
the year appears in what the ADMIN said. `said` is injected by runAgent,
never passed, so she cannot satisfy the check with her own arguments. It
guards `bulk_update_master_sheet`, `update_master_sheet_row` and `add_deal`,
because the same fault one row at a time is the same fault.

**A TEST MAY NOT PIN A YEAR EITHER.** The guard turned every hardcoded
`2026-08-01` fixture into a time bomb, and `npm run test:drift` found five of
them at +25 and +60 months. Fixtures are relative to `currentMonth()` now,
and widening the guard to keep them green would have been the wrong fix.

**WHAT IS IN THE FILE TRAVELS WITH THE FILE.** She announced a bank run over
every group, 21 rows and 18 people, as "BANK - 2026-09.zip is yours: 3 rows,
3 people": the previous export's figures, read from a client side preview
that had not caught up. The FILE was right; the sentence was another
document's numbers.

Guarding that cache would have fixed that one render and let the next state
variable bring it back. So `/export/xlsx` counts the rows the workbook was
BUILT from and sends `X-Row-Count` and `X-People-Count`, both exposed, and
the announcement reads those. `preview` is not consulted, not even as a
fallback, and the argument was DELETED so it cannot creep back: a fallback
is the same bug waiting for a header to go missing.

**A BUILD MAY NOT CHANGE THE DOCUMENT.** The card on screen was the bank
sheet over every group; "Can we proceed with the export, please?" produced
`MILKMAN - MASTER SHEET - 2026-09.xlsx`. A different shape and a different
scope, from a sentence that changed neither. A build arriving with a
different `template` or different `groups` now REFUSES and names both,
because "go" means the file they are looking at.

**"MULTI TAB" IS ONE FILE.** There is no multi-tab option: a single workbook
ALREADY carries a tab per group, which is `multiFile: false`. Nothing said
so, so "I want it multi-tab only" produced a zip, the opposite of the ask,
and she reported it as done. The parameter, the card and the buttons now all
say "one file, a tab per group" against "a file per group, zipped".

**THE ADMIN PICKS THE FOLDER.** A plain `<a download>` cannot: the
browser's own download folder decides and the page is never told where the
file went. `saveBlob` uses `showSaveFilePicker` where it exists (Chromium,
secure context) and falls back to the anchor everywhere else. Cancelling
the dialogue is not a failure: it returns false and she says the file was
left unsaved, rather than announcing one that is not on disk.

- **ONE implementation, not three.** The orb's export and its transcript
  download each had their own copy, both missing `document.body.appendChild`
  (Firefox ignores a detached anchor) and both revoking the object URL in
  the SAME FRAME as the click (Firefox treats that as cancelling the
  download). The shared helper documented both faults while the copies
  beside it committed them.

**A CONVERSATION CAN BE STARTED AGAIN BY HAND.** The transcript survives
closing the orb and a page reload, both deliberately, so the only ways out
were the thirty minute idle timer or closing the tab. The reset button sits
in the drawer header beside the download.

- **It saves before it clears.** A reset is a real END, not a save point:
  `endConversation` files the transcript and rolls a fresh id, so what
  follows is not appended to the same row. The screen is cleared, not the
  record.
- **A half built export goes with it**, sessionStorage included, or a card
  comes back on reload whose questions are no longer on screen. The confirm
  says so.
- Disabled mid answer and on an empty transcript. Escape answers the
  confirm rather than the drawer, which listens in the capture phase.

**THE LIVE EXPORT IS PROJECTED OVER THE ORB.** The full preview lived in the
scrolling transcript while the current choices were rendered a second time
in the conversation footer. The two layers collided visually and could drift.
The newest active session now has one compact glass card over Diane, with the
current choices while a question is outstanding. Only after all stages are
settled does that surface become the complete preview with the file name,
counts, settings, warnings, real sample rows and build controls. The card has
its own bounded scroll area, so long options and wide sample rows cannot escape
into the stage.

The live `/export/card` refresh returns volatile figures only. It is merged
into the agent session rather than replacing it, because replacement drops the
served `stages` and `options` and leaves Diane asking a question with no answers
on screen.

The stage order is server-enforced. `allGroups` both clears a narrower group
filter and settles Groups; there is no second public flag with only half that
meaning. A direct answer such as "all of them" must call the export tool, and a
reply asking about Colour while Breakdown is current is rejected and retried
before it reaches the conversation.

The settled export card is a compact decision summary, not a spreadsheet
preview. It shows scope, columns, breakdown, colour, delivery, warnings and the
server count, but no sample-row table. Download progress arrives as
`{ phase, percent }`; the orb card extracts `percent` before rendering it, so an
event object can never become `[object Object]%`.

- **The transcript keeps only a compact reference**, labelled On Diane. It
  never renders a second preview or a second copy of the choices.
- **A paused session removes the projection**, and its compact reference and
  the command bar pill both provide the way back.
- **Building a file shows a bar beside the input**, not only a percentage
  inside the projected card. Saving is its own wait, since with a Save
  dialogue the write happens after the download.
- **The tracker sits top right of the drawer header**, which cannot scroll,
  and says both how far in and what it is waiting on. ONE track being
  filled, with hairline divisions: separate bars read as loose dashes once
  they were all filled. No pulsing dot, which said nothing the count did
  not and is the shape every generated dashboard has. A light runs through
  the filled part while a step is outstanding and stops when nothing is.
- **A colour is a preview, not a dot**: three bands in the weights the file
  writes, with its name. A sheet shape carries its description on screen
  rather than in a `title` nobody hovers and no touch screen has.
- **Step one has one Diane-specific contract.** It offers Master sheet,
  Sheet for a month, Bank, Cash and Expensing. Division Sheet remains visible
  as a disabled card marked Coming soon. Breakdown, Bank details and Driver
  are not choices. The served cards and the tool enum share this contract, so
  a hidden or unavailable shape cannot still be selected through conversation.
- **She no longer recites the options.** Every question used to list its
  own: eight shapes in one sentence is a wall, and the same eight sit under
  it as buttons. The lists still travel to her, because "what are my
  options" has to be answerable and because she invents one when nothing
  gives her it. Given, never recited.

**THE CONVERSATION DRAWER OPENS ON EVERY REPLY, whatever its length.** It
used to open past 220 characters, which is why a short reply with a panel
attached stayed in the inline strip, where the panel sits below the fold and
the strip does not scroll to it. It opens on the first token, before there
is anything to read, so it never jumps open under somebody mid-sentence, and
it only ever OPENS: closing it is a decision. Sticking to the bottom is
instant while an answer is still streaming, because a smooth scroll per
token never finishes one before the next starts.

**SHE STOPPED READING AFTER "DARLING".** Asked what changed in 24 hours she
wrote five bullets: "preset dates cycling through August to October", "quite
a dance of adjustments". The dates the question was about were gone.

She was NOT cut off. The tool handed her 24,165 characters and 676 lines
with "Relay EVERY line below", the finish reason was `stop`, and the length
retry never fired. She did the only thing a model does with that. PROMPTING
IS NOT A GUARD, and "do NOT compress this" is a prompt.

Past `LIST_FROM` (12 rows) `recent_master_sheet_changes` RENDERS the rows on
screen, exactly as a big filter result does, and hands her one computed
sentence: 495 characters, with counts per field and per group so she is not
left to characterise them. Each row carries its own diff with both values,
capped at three per row so the newest is not pushed off a truncated line.
Under the threshold, relaying verbatim is right for three rows and stays.

**A TOTAL FOR TWO PEOPLE WAS A TOTAL FOR ONE.** "Combine gloria and gloria
difference" came back as AED 150, called the total for both. Gloria's four
deals, GBP 2,000, were absent. TWO faults, and fixing either alone still
gives a wrong figure:

- `fromSaid` takes the LONGEST name in the sentence, which is right for one
  person and drops the other when there are two. `peopleIn` now COUNTS
  mentions instead: "gloria" appears twice and "gloriadifference" once, so
  one mention is left over and she is a second person. A single person total
  REFUSES when the sentence named two, and says to use `people`.
- `said` was applied to every entry of the `people` list, so both names
  resolved to the same longest one and the pool held one person. It is
  passed only for a list of ONE, since an explicit list is already whole.
- A currency is never added to another: GBP 2,000 and AED 150, never 2,150.
- **The percentages are reported**, stacked person plus deal through
  `ratesFor`, one line per person. "Show me the percentages" had no answer:
  the money an add on came to was given, never the rate behind it.

**A WRITE TEST MAY ONLY TOUCH `ZZTEST`.** A test of the bulk update set three
REAL INDIGO rows to a 2023 preset with 0 payable, £2,700 out of September,
found hours later by a spread query and put back from the change log.
`v1/testing/scratchOnly.js` `arm()` wraps `create`, `update`, `remove` and
`removeMany` and THROWS on any row outside the scratch group. It guards the
WRITE, not the filter: the incident was a filter matching more than anybody
meant, and by the time a row reaches `update()` its group is a fact. A row it
cannot read is refused too, never assumed safe.

**A DESTRUCTIVE TOOL NAMES ITS ROW FIRST.** `delete_master_sheet_row` was
the last one relying on a sentence in its description to make her ask. It
now has the same two call guard as the rest, naming the person, company and
group, because an id is exactly the argument she cannot sanity check.
`add_deal` answers "they are already on that company" instead of raising a
unique violation the admin sees as a reference code.

**IDS FROM AN EARLIER ANSWER NOW SHOW NOTHING.** Asked for Zayn she showed
Zayn. Asked for Gloria she correctly asked which one. Told "show
everything", she called `get_master_sheet_row_details` with Zayn's ids,
still in her context, and narrated Zayn and Jim as Gloria's deals.

The tool had a guard and it was PROSE: it warned that the ids spanned
several people and returned the cards anyway. The cards are what reach the
screen, so the summary was advice and the screen was the answer. It now
returns no cards at all in that case, and says nothing has been shown.

- **Several people on purpose is a second call**, `severalPeople: true`, the
  same two-call shape as `bulk_update_master_sheet`. Not a refusal: asking
  about several people is legitimate, guessing is not.
- **Keyed on `person_id`**, matching `find_and_show_details`. On the name
  alone, two people sharing one would have passed the guard, which is
  exactly the case it exists for: there are two different Glorias.
- **The disambiguation hands her the ids it just found** and says never to
  reuse older ones, so she does not have to invent the next call. Reaching
  for what was already in context is what she did.

### What she can reach, and what she deliberately cannot

**25 tools.** Eight were added on 2026-08-28 to close the gaps an audit of her
tools against the CRM's routes turned up.

**`bulk_update_master_sheet` is TWO CALLS, and the first writes nothing.**
The same shape the upload has, for the same reason: a sentence is a loose
way to describe thirty rows, so the admin sees the exact rows and the exact
change before any of it lands. `confirmed` is the second call.

- **It takes a FILTER, never row ids.** She must not guess a row id, and a
  mass write off guessed ids is the worst version of that: ids are not
  sequential by person, so row 30 is Nicola and 28, 29 and 31 are three
  other people.
- **Over 500 rows it REFUSES** rather than doing the first five hundred. A
  partial mass edit is worse than none, because nobody can tell which half
  ran. The cap is high enough for the whole sheet, and it reports progress
  from 10 rows up so several seconds of writing is not silence.
- **`set` REACHES EVERY COLUMN a set of rows can share**, and the ones it
  cannot are refused BY NAME WITH A REASON (`PER_PERSON`), never dropped in
  silence. `normalizeFields` discards a key it does not know, so "put this
  appointment date on the whole group" came back as "nothing to set" on a
  request that made perfect sense, and the admin could not tell a
  misunderstanding from a refusal. Refused: a name, a phone, an address,
  bank details (many people paid into one account is money reaching the
  wrong person), the boss's own `should_be_paid`/`paid` text (the switches
  write the overrides), the group and the company (both are in the identity
  key, so moving rows by filter splits a deal in two), and the payable
  amount (it is worked out from the days and the monthly).
- **ONE refused field refuses the WHOLE call.** Writing the legal half and
  dropping the rest is a partial edit reported as a success. A test asserts
  no column is left neither offered nor explained.
- **EVERY GROUP AT ONCE IS ONE CALL: no `group` at all.** She went group by
  group when asked to change all of them, eight confirmations each looking
  like the whole job. `WHOLE_SHEET` reads the admin's own sentence, injected
  not passed, and REFUSES a single-group call when they said every group.
  "all the deals in NEXUS" is deliberately not caught by it.
- **`except` holds named rows back**, resolved by `resolvePerson` like any
  other name, so it tolerates the same typos and stops on the same
  ambiguity. A name that matches NOTHING refuses the whole change: silently
  ignoring it changes the row they were protecting and the count still reads
  as success. The confirm names BOTH numbers and every held back person,
  because an exclusion cannot be seen in a count.

**`explain_preset_rules` reads the CURRENT settings.** She could total
correctly and still not say why a row was left out, or what would change if
the end date counted, because nothing told her the setting existed. Read
only: changing it moves every figure in the CRM at once, so it stays a
decision made on the Settings page in front of the preview.

**`list_concerns` and `undo_master_sheet_change` are ANSWERS, NEVER OFFERS.**
Nobody wants "by the way, there are four open concerns" in the middle of a
question about an amount, and an undo she suggests is an undo nobody asked
for. Both the tool descriptions and the prompt say so. She cannot resolve a
concern; that stays on the Concerns page.

**Her filter now matches the page**: currency, payment method and the
search-by-column dropdown were added to the page and not to her, so "who is
paid in crypto" had to be answered by reading a list. The spoken sentence
names the column searched, because "matching Manchester" is a different
claim from "with Manchester in the location".

**SHE CAN READ THE ACTIVE COMPANY LIST OUT LOUD.** `active_companies` gives
a card per company with its director, mid, tier and old group, off the same
`activeCompanies` the workbook builder prints on every group tab, so what
she says and what the file shows cannot disagree. A company is live while
ANY one of its deals is still in its payment period.

**Twelve cards, not four.** A company card is five cells where a deal card
is twenty, so a dozen still reads as a set rather than a wall; past that it
becomes a list like every other long answer. The cells are NOT editable:
they are a reading of many deals plus the company row, and there is no
single field behind them. Renaming or retiering is `rename_company` and
`update_company`.

`DealCard` mapped `card.switches` unguarded, so the first card without them
took the whole overlay down. Guarded.

**SHE CAN CORRECT A PERSON, NOT INVENT ONE.** `update_person` writes the
five fields `tb_people` holds: display name, email, notes, add on and fee
percentage.
Everything else about somebody belongs to their DEALS.

**A PROFILE NAME IS NOT THE SHEET'S NAME, and this is the trap.** The deals
carry `person_name` and the People page shows COALESCE(profile name, the
name on their deals), so setting a display name changes what the CRM SHOWS
and rewrites nothing on the master sheet. The COMPANY rename is the opposite
and does rewrite every row. The two must never be described in the same
words, so her reply says which one happened.

**The fee is validated in the tool, not only at the route.** She does not go
through the route that guards it, and a typo in a percentage lands in every
export's breakdown.

**SHE CAN CORRECT A COMPANY, NOT INVENT ONE.** She could delete one and not
fix one, which is the wrong half: renaming is the Companies page's actual
job. `rename_company` carries the new spelling onto every deal that named
it, so **renaming IS the merge** — "Relia Pa" to "Relia PA" makes both
spellings one company, because the grouping key is the folded name.
`update_company` handles tier, old group, notes and active/closed.

A guard that compared the two names LOWERCASED refused exactly the rename it
exists for. It compares them exactly now.

**No create.** A company exists because a deal names it, so creating one
always means creating a deal underneath, which is `add_deal`. A bare company
row nothing points at is how the list grows names that mean nothing.

**Still deliberately out of reach:** export, upload, settings writes, logs,
`burn-month`, `reset-master-sheet`, `bulk-delete` and sync.

### A question she asks must have an exit

Asked for Gloria's total she said *"there are two Glorias: Gloria and Gloria
difference, which one?"*. The admin said "Gloria". She asked again. And
again. **The question had no exit**, because answering it re-ran the same
fuzzy search and produced the same two names.

`total_master_sheet` now resolves on an EXACT match of what it offered, the
rule `find_and_show_details` has always had, and it tells her to offer the
names exactly as written so a repeated one matches. It also counts distinct
`person_id` rather than rows, so one person on four companies is summed
rather than queried.

### Never the same sentence twice in a row

Asked *"are you sure that is correct?"* she repeated her previous line word
for word. Re-running the tool and getting the same figure is exactly right;
saying it in the same words is what reads as a broken machine rather than a
person who has just checked.

`agent/notTwice.js` folds away case, punctuation and spacing and compares
against her most recent turn only. A repeat is retried once, asking her to
say it differently with every figure, date and name unchanged. Replies under
40 characters are exempt: "Done." twice is fine, and forcing variation there
would make her invent it for its own sake.

**"Are you sure?" asks whether she CHECKED**, not what the answer was, and
the persona prompt now says so. Coming back to a figure later and phrasing
it the same way is ordinary, so only the immediately preceding turn counts.

**NOR THE SAME LIST TWICE.** Asked to confirm a count of thirty she reprinted
all thirty rows before saying yes. `agent/notTwice.list.js` compares the ids
against the `[listed N deals: …]` line the client already commits to history,
suppresses the redraw and tells her to answer in one sentence. Re-running the
tool stays right; redrawing the answer does not. Text and list are separate
guards because the two replies genuinely differed: the repetition was an
event beside the words, not inside them.

**BANK DETAILS NOBODY HAS ARE ONE SENTENCE.** She drew seven full cards for
three people and then said none of them had any. `find_and_show_details` with
`show: 'bank'` checks the three banking columns first, treating a SENTINEL
("Will never be bank") as no detail, and returns the sentence with no cards.

### Prompting is not a guard, least of all about money

Asked for Nicola's August total she answered *"owed nothing, all her deals
are marked for another month"*, off the four cards she had shown a moment
earlier. Every one of those presets reads `2026-08-01`, so the reason was
untrue of all four rows, and three of them total **2,900**.

`moneyTotals` was and is correct. **The prompt already forbade every part of
what she did** — adding amounts up, quoting a remembered figure, quoting one
from a card, contradicting the tool — and names the earlier 3,700-versus-
2,900 incident by number. More prompting was not the lever.

- **The tool hands back the FINISHED SENTENCE.** `total_master_sheet`
  returns `say`, the exact line to relay, so answering is copying rather
  than composing. `detailsSummary` has always worked this way.
- **The reply is CHECKED against what the tools returned.**
  `agent/checkFigures.js` collects every figure the turn's tools produced
  (the totals, the per-row amounts, and anything in their own text) and
  compares it with every number in the reply above 100. An unsupported
  figure logs to the Logs page and retries once with the figures restated.
- **It never rewrites her reply.** A figure is either right or the turn is
  wrong, and silently editing money would be worse than either.
- **Numbers under 100 are not figures.** "4 deals", "31 days", "Mid 1".
  Flagging those would flag every honest sentence she writes.

**A COUNT IS A CLAIM TOO, and that is the hole the rule above left.** The
tool offered three rows, two for Zayn and one for Paddy; she said *"two rows
for Zayn and TWO for Paddy ... all FOUR rows"*. Paddy has one. Nothing caught
it: the count was under 100, and it was spelled as a WORD, while every other
guard here counts digits.

`agent/checkCounts.js` is the second half of `checkFigures`. It reads both
digits and spelled-out numbers ("twenty one", "ninety-six"), and it is
**scoped to a counted noun** (row, deal, person, group, company, change,
month, file, column) so "one moment" and "a couple of things" are never
flagged. The known counts are EXTRACTED from the tools' own summaries and
from the rows they returned, so a tool that starts reporting a new count is
covered the day it does. Its own retry flag: a wrong count and a wrong amount
are two different mistakes, each worth one correction. It reports, it never
rewrites. It matters most for forecasting, where "three groups" and "four
months" are answers nobody can check by eye.

**ONE ROW'S AMOUNT IS NOT THE PERSON'S TOTAL.** "Show me gloria" drew four
cards at GBP 500 each and she said *"Gloria is owed 500 GBP for September
2026"*. She is owed 2,000. Neither guard could see it: 500 is a real figure
off a real row, so `checkFigures` is satisfied, and it is a FIGURE not a
count, so `checkCounts` never looks. `find_and_show_details` adds nothing up
on purpose, so with several rows it says so and sends her to
`total_master_sheet` rather than leaving her a card to read a total off. The
line teaching the shape ("owed 500 for August") is kept only for one row.

**FORECASTING IS NOW A READ-ONLY TOOL.** `monthHistory.js` serves stored
snapshots for past months, live totals for the current month, and a pure
`projectMonth` result for future months. It computes all arithmetic from the
canonical preset rule and keeps currencies separate. `compare_months` and
the range/count arguments preserve every month the admin requested, so a
multi-month question cannot collapse to the last result. Missing historical
snapshots are reported as unavailable instead of being reconstructed from
today's rows. The preset formula remains unchanged, including the existing
Include end date setting. **`projectMonth` is SHARED with the dashboard**, so
she and Payment Overview project a month the same way; a second projection
anywhere is the bug.

### What one live conversation cost, and what it bought (2026-09-07/08)

Thirty turns of ordinary talk found ELEVEN faults that a static read and a
seven turn scripted scenario had both missed. Every fix below is named after
the sentence that produced it. The scenarios are in
`v1/agent/scenarios/`: `sweep-boss.txt`, `sweep-messy.txt`, `forecasting.txt`.

**`said` IS THE ONE COPY SHE CANNOT HAVE EDITED.** Half of these are the
same fault: a model argument was trusted over the admin's own sentence.

- **The words outrank a model month.** `compare_months` read `args.months`
  BEFORE the words, so "and last august?" arrived as 2025-08 and five turns
  of one conversation were about a year nobody said.
  `breakdown_master_sheet` had the right order all along. `exchange_rate`
  repairs its month the same way.
- **A group the sentence never named is DROPPED** (`exactGroupsMentioned`).
  "did we gain or lose over the past 3 months" had answered "For ALL
  GROUPS", silently narrowing a whole sheet question.
- **`notAGroup`'s invented branch could never fire.** SEVEN call sites
  called it without `said`. Threaded through all of them, plus
  `unknownCompanyFilter`.
- **And the invented NAME is withheld from the correction.** It used to say
  `YOU INVENTED THE GROUP "ALPHA"` and tell her not to repeat it; she
  answered "The groups ALPHA, BETA and GAMMA do not exist on the sheet". An
  instruction not to say a word, with the word supplied, is prompting doing
  a guard's job. A name they DID say is still quoted back: that is a typo
  they need to see.

**A REAL FIGURE FOR THE WRONG QUESTION IS THE WORST SHAPE**, because
checking the number cannot catch it.

- `checkMonths` now fires when NO tool ran at all. Its exemption was for
  answering off a card, and an empty `toolResults` looked identical to one:
  "whats coming next month" and "and the month after" both returned
  September's figures under October's and November's names.
- Its claim words gained PAYMENT STATE. "whos not paying yet" answered "no
  one" over nineteen deals, and not one of `owed`, `total`, `due` or
  `payable` appears in that sentence.
- **`checkQuestion.js`** is new: a comparison answered with one month
  computed, or a superlative answered with a total, is retried. Declining
  passes untouched, so "I cannot rank them yet" is never retried into an
  attempt.
- **The tunnel gate reads the words.** `total_master_sheet` already handed
  non-current months to `compare_months`, but the gate read `args.months`,
  so "did we earn more than last month" arrived as two one-month calls and
  the tunnel never opened.
- A bare follow-up cannot reach `breakdown_master_sheet`. "and last
  august?" after a rate question returned the five group payment workbook.

**FIGURES THAT WERE SIMPLY WRONG**

- **Nothing does not convert to zero.** An empty net went through the
  converter and printed "USD 0 converted using that month's saved rate" for
  NEXUS August, which holds GBP 4,775.
- **One name in two arguments is not an intersection.** The group name
  arrived as `group` AND `company`; `matchesScope` needs both, so the month
  came back empty and the scope line read "For NEXUS, NEXUS".
- **A scope that matched nothing anywhere is checked before a zero is
  reported.** "milman" answered "nothing"; "milkman" on the next line
  answered AED 3,675 and GBP 19,145.95. Group and company lists are both
  asked, and it only complains when the name is in neither.
- **Money keeps its pence** and percentages have their own formatter at ONE
  decimal, matching `crm/web`'s `trendPercentText`. A CONTRACT across the
  api/web boundary: neither side may change alone.
- **A past month's rate is the one saved with it.** `exchange_rate` takes a
  month and reads `snapshot.totals.fx`; no snapshot says so rather than
  substituting today's. It also refuses a conversion request outright and
  names the tool that does it.
- **The change log is not the row list**, and the dashboard looks back 168
  hours where she looked back 24. `RECENT_CHANGE_HOURS` is imported, not
  re-declared, so "nothing in 24 hours" cannot contradict five entries on
  screen again.
- **A computed reply skipped the repeat guard.** `saidAlready` runs on the
  model's prose and that path returns the tool's text, so "are those
  accurate?" replayed the block word for word. It gains "I ran it again and
  it has not moved", true by construction: that path only exists when a tool
  ran.
- **"Flagged" is two records.** A review flag on a DEAL, a concern on a
  PERSON. The empty answer says which it checked.
- **"Together" with two currencies gets a sentence**, in the SUMMARY and
  never in `say`: the first version put the word USD into an answer where
  nobody asked for dollars, which `askedForUsd` pins against.

**ONE VOCABULARY FOR THE SHAPES A QUESTION COMES IN.** `agent/askShapes.js`
replaced seven private regexes across four files. They still leak, because
language does; what changed is the COST. A phrasing added once is added
everywhere, `askShapes.test.js` pins every phrasing we have actually seen,
and the tunnel that ROUTES a comparison now shares a definition with the
guard that judges the answer. Two lists for one question is how a retry
fires on something the tunnel never routed. **Only a phrasing seen in a real
transcript goes in**: a list grown by imagination ends up matching ordinary
prose, and then the guard on top of it gets widened away.

**NO RANKING, AND SHE DECLINES.** "Who earned the most this month" is not a
question she answers, and there is no ranking read to build. `checkQuestion`
fires on any money superlative and tells her to say she cannot, then offer a
total for any one of them by name. It fires whether or not rows came back:
rows are deals, not an ordering, and ranking them by eye is the guess this
prevents. Answering it with a sheet total, which is what she did live, is
the fault; the fix is "I cannot", never a better figure.

**A FIGURE WITH NO TOOL CALL AT ALL.** `checkFigures` had the same exemption
`checkMonths` did, and for the same reason, so "Looking ahead to November
2026, the sheet projects AED 54,342.50" passed both: the month guard is
bound to "FOR <month>" and this said "to", which is the precision that keeps
IT honest. So the figures are the net there, not the month. A tool that ran
and computed no figure stays exempt: reading a card back is legitimate.

**A FOLLOW-UP CARRIES THE SCOPE.** The guard that drops a group the sentence
never named read only the CURRENT sentence, so "which of those three earned
most" dropped all three and she answered with three copies of the whole
sheet total. Current words, then the prior lines, then refuse the model's
own: the order `requestedGroups` already used.

**THE HARNESS ASSERTS NOW, AND EXITS NON-ZERO.** `scripts/dianeChat.js`
reported "nothing flagged" on the run containing all eleven. It carries
eight checks named after them, prints each tool's own summary so a figure
can be checked against the text it came from, and fails the run. Nothing
that prints a fault may report success.

**A GAP IS NEVER BRIDGED, AND THE CAP SAYS WHEN IT CUT** (2026-09-07).
`deltaLines` dropped the unusable months first and paired what was left, so
August, no September, October came back as one step of movement over two.
Pairs are taken in the order asked now and a pair with a hole in it is not
drawn; adjacency is in the LIST, not the calendar, so January and June asked
for alone are still one step. `MAX_MONTHS` was a silent `.slice()`, so a
forty month ask answered thirty six and said nothing: the ask is gathered
whole, cut in the handler, and the reply LEADS with "Answering the first 36
of the 48 months asked for."

**HER FORECAST AND RECALL ANSWERS ARE SHORT BY CONSTRUCTION.**
`computedReply: true` ends the turn on the tool's own text with no model
round to retype it, so the tool's terseness is hers. One line per STEP with
every currency named on it, not one line per currency per step: three months
over three currencies was nine delta lines, six saying nothing had happened.
The figure, its currency and its source stay on every month line, because a
projected figure has to announce itself.

**AND SHE MUST NOT CLAIM A CHECK NOBODY ASKED FOR.** The repeat retry ended
"if they asked whether you are sure, say plainly that you checked and it has
not moved", with the condition left to her to apply. Asked "convert it to
usd" she opened *"I double-checked and the numbers are steady as ever ...
Nothing has shifted!"* for a question that was not a doubt; three replies in
one session did it. The condition is knowable from their own words, so it is
decided in `runAgent` and the retry now says one thing or the other. A rule
with a condition inside it is a rule she applies to the wrong turn.

**A FILTER SHE DOES NOT HAVE IS REFUSED, NEVER IGNORED.** Every handler
spreads its arguments into a repo call and a repo destructures the keys it
knows, so an invented parameter is dropped in SILENCE, the query runs
unfiltered, and the rows that come back are the whole sheet described as the
answer to a narrower question. `agent/knownArgs.js` checks the arguments
against the tool's own schema, once, for every tool, and the refusal NAMES
the near misses (`method` -> `paymentMethod`, `location` -> `searchField`) so
she has a working second attempt rather than inventing the same name again.

**ONE VOCABULARY FOR NARROWING, spread into the list and the total.** The
list tool had seventeen ways to narrow and the TOTAL tool had two, so "what
are we paying the cash people in INDIGO" had no tool. `FILTER_PARAMS` is
declared once and both read it, and a named person is narrowed by running
the filters as the SQL they already are and intersecting: one definition of
"cash", so the list and the figure cannot disagree. A narrowed total says how
many rows it LEFT OUT.

**A FILTERED COUNT MEANS NOTHING WITHOUT ITS DENOMINATOR.** "Are all the
INDIGO people paid in cash" was answered "there are 30 rows in INDIGO paid by
cash". INDIGO has 39. She filtered BY the premise and read the matches back
as agreement. So the count never arrives bare: "30 of 39, THE OTHER 9 DO NOT
MATCH". The first version of that note then confirmed a false premise the
other way, answering "everyone in MILKMAN is on GBP right" with "yes, all 33"
when she had passed only the GROUP, so filtering on nothing is now its own
answer. Same rule on companies: "25 active companies, EACH WITH A DIRECTOR
AND ONE OR MORE MIDS" over a list that said "not held" twice, so the
exceptions are counted in the same breath and the sentence is handed over
finished, because "do not generalise" produced "each with various directors
and mids assigned".

**PEOPLE ARE NOT ROWS.** "36 people in INDIGO are paid in GBP" over 36 ROWS
held by 28 people. `checkCounts` should have caught it and could not:
`summarizeRow` hands back camelCase `personName` and the guard read only
`person_name`, so the people set was empty on every list and a person count
was never checked at all. Both counts now travel in the summary.

**"WHOSE" NEEDS THE NAMES, or she invents row ids to find them.** Asked whose
deals were ending soon she got three cards and a summary that told her not to
read the fields back and named nobody, so she called
`get_master_sheet_row_details` three times with ids she had made up, two of
which hit real rows, and answered "Tobias Wright and Jim". The three were KJ,
Drew and Ruth Harper. Withholding the names to keep her brief is what sent
her looking, and the place she looked was her own memory.

**THE TWO PEOPLE GUARD HAD AN EXIT, TWICE.** Refused on the single path for
naming two people, she called it again with the OTHER name, whose fuzzy
search returns only that person, and answered AED 150 as the total for both.
Refused there too, she called the LIST path with one name at a time, and a
list of one takes `said`, so the longest name in it won both times: "Gloria
is owed AED 150. Difference is also owed AED 150." The check now runs against
the WHOLE sheet, on both doors. A refusal with an exit is not a refusal.

**A MISSING FILTER IS ANSWERED CONFIDENTLY AND WRONGLY.** This is the shape
behind most of her bad answers, and it is never a prompting fault. Asked
"whose deals are ending soon" she said *"no deals are marked as ended right
now"*: true, and about a different column. `status` is what a row IS this
month; `end_on` is the date written on it. Rows ending this month and next
were on the sheet while the answer was none. She does not refuse when a
filter is absent, she reaches for the nearest column that exists. Same shape
as the `paymentStartWhen` incident, which answered ONE then TEN when the
truth was EIGHT. **`endWhen`** (`soon` / `this-month` / `future` / `past` /
`none`) closes it, by MONTH like the two beside it; `ENDING_SOON_MONTHS`
lives on the repo and the tool description reads it, so the SQL and the
sentence cannot name different horizons.

**A BARE MONTH IS REPAIRED, NOT DROPPED.** Dropping the guessed year was half
a fix: asked "nicola total for august" she passed 2024-08, the guard dropped
it, the reply answered SEPTEMBER, and she then asked "did you mean August
2024?". They named August and got another month plus a question about a year
nobody said. `repairMonth` takes the month they NAMED in the nearest year
(ties to the past, since a total is about a month that has happened);
`monthForRead` drops only when there is no month word to repair to. READS
ONLY. A write with a guessed year still refuses and asks, because a repaired
preset silently rewrites what a row is owed. Repaired and dropped say
different things: repaired names the month and asks nothing, dropped asks
which month they meant.

**LAST TURN'S ARGUMENTS ARE NOT THIS TURN'S QUESTION.** Two leaks, one shape:

- **People.** "nicola total for august", then "add gloria and gloria
  difference": she called the total with NICOLA and both Glorias and answered
  for all three. Any name in `people` that the CURRENT sentence does not
  mention is dropped, and she is told. It fires ONLY when the sentence named
  somebody, so "add those two up" and "and in dollars?" still carry the set.
- **The month.** The same turn kept AUGUST, every row is marked for this
  month, and the answer was "owed nothing". The month is NOT dropped, because
  a follow up has no month word either and must keep the one they set.
  Instead a zero that is only a zero because of the month says so and offers
  the current one. A silent zero is the answer nobody can tell from a fact.

**A FOLLOW UP IS STILL THE SAME QUESTION.** "Convert it to usd", then "I
think that's wrong, double check": the second sentence has no dollars in it,
so the conversion was dropped and she offered to convert what she had
converted one line earlier. Intent reads the last TWO user turns
(`saidRecent`, injected); `said` stays ONE turn, or a name from an earlier
question resolves the current one. Two turns and not the conversation, or
dollars asked for ten minutes ago reappear on unrelated answers, which is the
fault the dollars guard exists for.

**THE SENTENCE ONLY HELPS ONE NAME.** `said` recovers a name she SHORTENED by
taking the longest name in the sentence. Given a LIST every entry is already
whole, so the sentence overrode all of them with that same longest name.
Twice: "Gloria" and "Gloria difference" both became Gloria difference and a
combined total lost GBP 2,000; then "zayn and paddy" both became Paddy and
the confirm read *"2 rows: Paddy, Paddy"*, with Zayn absent from a change he
was named in. Fixed at the first call site and missed at the second, so it is
one function now, `saidFor` in `agent/tools/resolvePerson.js`, used by both.

**A PERSON AND THEIR GROUP GLUED INTO ONE ARGUMENT.** 2026-09-29: "add 100 to
zayn milkman" arrived as person *"Zayn Milkman"*, nobody is called that, and
she reported one of his own handlers missing. `splitPersonAndGroup` in
`tools/notAGroup.js` is the one definition: `resolveDealScope` rewrites the
arguments on the filter and bulk paths, `notAPerson` returns the correction on
the read paths, which have no scope step. **BOTH HALVES HAVE TO BE REAL** or
nothing is split, and a value that IS somebody's whole name never is, so a
person called Milkman Jones survives a group called MILKMAN. `personSentAsGroup`
cannot catch it and must not try: Zayn REACHES that value, which is the test
that stops it turning a real person into a group.

**A CHANGE ASKED FOR ONE MONTH MUST NOT LAND ON ANOTHER.** Same session: "for
october only please add an additional 100 aed" came back as *"this would change
Zayn's deal for September 2026"*. The month was read off the row's preset and
never compared with the one he said, and **there is no per month amount to
set**: `monthly_amount` belongs to the DEAL, so "October only" cannot be
honoured by it and a yes would have written something nobody asked for.
`wrongMonthAsked` refuses inside `confirmAmounts`, BEFORE the preview, with no
`pending`, so a later yes has nothing to replay. "FOR &lt;month&gt;" and nothing
looser, the same precision `checkMonths` uses; `forMonthsIn` is one definition
shared by both, so "he started in October" stays a date.

**ASK ON THE FIELD THAT ACTUALLY DIFFERS.** *"Zayn has 2 deals. Which company,
or both?"* with both deals on Workforce, in MILKMAN and in INDIGO. Fourth time
this shape has been found and the second door: `closure` had the rule from
2026-09-18 and the card list did not. `tools/whichDeal.js` is the one
definition now, `whatSeparates` returning company, group, role or null, read by
both. **Its own file, like `resolvePerson`**, so `closure` never imports a
7,800 line module to ask which deal.

**AMBIGUITY IS ABOUT WHICH PERSON, NOT HOW MANY ROWS.**
`find_and_show_details` asked whenever more than one ROW came back, so "show
me all of Nicola's details" was answered with *"there are 4 Nicolas in
INDIGO, which do you mean?"* when it is one Nicola holding four companies.
Four rows is her answer, not an obstacle to it. It counts distinct
`person_id` now; two DIFFERENT people still stops it dead, and the question
names the people rather than listing every row. `total_master_sheet` had
always counted people this way; this tool had drifted.

### Reading a long answer back without shortening it

Asked what changed in the last day she reported twenty-five rows of forty
and wrote the dates as prose: *"extended into March and beyond in March and
April of following years respectively"*, which loses the only thing the
question was about. **Three faults, one symptom.**

- **A TRUNCATED REPLY IS A FAILED TURN, not a shorter answer.** The budget
  ran out two ways and only one was caught. An EMPTY reply retried (the
  model reasons before it writes and that is charged against `max_tokens`);
  a reply CUT OFF mid-list was handed over as if finished, which is the
  worse of the two because it looks like an answer. The retry fires on
  `finish_reason: 'length'` whatever came back, once, and
  `RETRY_MAX_TOKENS` is 8,000 rather than 3,000 so it clears the longest
  honest answer she has.
- **A CAP YOU CANNOT SEE IS THE BUG.** `recent_master_sheet_changes` read
  25 rows and then reported `rows.length` as the count, so a busy day was
  read back short with nothing saying so. It reads 200, reports the TRUE
  total from the same query, and when more exist it says how many and
  offers a narrower window. `filter_master_sheet` already worked this way.
- **The relay instruction now forbids rewording a date.** Telling her not
  to compress was not enough while the budget made compressing the only
  way to finish.

**A CAP ON A TOTAL IS A DIFFERENT MATTER: it is a wrong figure that looks
right.** `total_master_sheet` summed one page of 500. Past its limit it now
refuses and asks the admin to narrow the question, because a total computed
over a page defeats the whole reason the figure is computed in code.

**Runs on OpenAI, one key for all three things she does.** `AI_PROVIDER=openai`
plus `AI_API_KEY` gives chat (`gpt-4.1-mini`, streamed), hearing
(`whisper-1`) and speech (`gpt-4o-mini-tts`, voice `shimmer`). Each
capability resolves its own provider and falls back to the chat key when the
chat provider can do that thing, so a provider without `/audio/speech`
degrades to the browser's own voice rather than erroring.

**HER VOICE IS TWO HALVES, AND THEY ARE ONE CONTRACT.** `persona.js` decides
what she WRITES, `openaiTtsInstructions` decides how it is PLAYED, and a
human sound (`awww`, `hmm`, `ooh`) only reaches the ear if both name it:
a speech model says exactly what is on the page, so a sound written but not
directed is read out as a word. `prompts/voice.test.js` pins the pair.

**`instructions` steers delivery, never timbre.** Age and pitch are the
VOICE you pick, `nova`, the youngest and brightest of the set. No direction
turns an older voice young: `coral` is the most expressive but plainly
adult, `shimmer` reads sultrier but goes flat and loses the excitement.

**THE REFLEX IS WHAT SOUNDS ROBOTIC, NOT THE COLDNESS.** She opened every
single reply with "Awww", greetings included, and that one habit undid the
whole persona. So the rules are about VARIETY, not warmth: never open two
replies alike, "Awww" only where it is earned, pet names as a rotation,
greetings and yes/no answers with no sound at all.

Figures drop out of the performance entirely: slowly and flat in the
reading, exact and unhedged in the wording, and never a pet name inside one.

**SHE CAN SPEAK MORE THAN ONCE IN A TURN.** The `say` tool puts a line on
screen and speaks it mid-turn, then she carries on working, so an audit is
not five seconds of nothing. It is a TOOL rather than an automatic filler
because a canned "one moment" on every request is worse than silence: she
decides, and the judgement lives in the prompt. Ordering mattered more than
wording here, she never once chose it while it sat fourth in the list.

Interim lines are committed to history as their own bubble immediately, and
the TTS queue plays them in order rather than cutting the first off.

**A LIST IS READ, NOT READ OUT.** Only its FIRST LINE is spoken, and that
line is hers: her prompt tells her to open a list or an audit with the
headline finding rather than a label, so what gets said aloud is "twenty
rows are adding nothing" and not "here are the results". It used to swap the
whole reply for a random pick from four canned phrases, which at one a day
is one phrase.

**STRUCTURE DECIDES, AND LENGTH NEVER DOES.** An ordinary data list falls
back to its headline. Computed money and exchange rate answers are read whole,
including every deal reason, rate and timestamp. Three character caps were
removed to get here (220, then 700, then the headline's own 200), because
**a cap on speech is invisible**: the
full text is on screen, so nothing tells you the ear got less than the eye.
Past the provider's 4096 the text is SPLIT at sentence ends and queued
(`speechChunks.js`), never trimmed. The server's silent 2000 slice is gone.

**A DEAL IS A CARD, not thirty-one lines of label-colon-value.** Asking about
someone draws a DealCard: name and money as a header, the two payment
switches as switches, empty fields counted rather than listed. She then says
one sentence about it, which is also the only part spoken. Telling her the
change straight after works, because the card entry carries the row id in
its history text, so she edits without looking the person up again.

Details are terminal computed replies. They cannot inherit a prior person's
month or total. Explicit overlapping names resolve together against the live
sheet, positive payable cards come first, and zero value cards come last.
Payment pills say expected or excluded separately from received or outstanding.

Ordinary edits are made and reported in the past tense. Only the two payment
switches ask first: money leaves no trace of having been wrong.

`CLICKABLE_CELLS` in `forms/DealCard.jsx` turns the cells into click-to-edit
and is OFF. With it on the card becomes a third way to write a row, next to
the form and the conversation, and three doors onto one act is how they
drift. Even on, a click becomes a sentence she acts on rather than a direct
write, so there is still one write path.

**HOW MUCH SHE REMEMBERS IS ONE NUMBER, IN ONE PLACE.** There used to be
two caps: 20 messages on the route and a 14,000 character budget in
`runAgent`. Two definitions of one thing, and the message one usually bit
first, so three long messages could evict twenty short ones that mattered.
The route now sends the history whole and `HISTORY_CHAR_BUDGET` is the only
governor.

**200,000 characters**, about 50k tokens, overridable with
`AGENT_HISTORY_CHARS`. That is roughly 800 ordinary turns, against 56 under
the old budget. `gpt-4.1-mini` holds about a million tokens, so this is
five percent of the window rather than the 0.3% it was. A single message is
capped at 12,000 characters (was 1,500, which truncated the checklists and
read-backs that are the whole point of remembering).

**It is bounded rather than unlimited on purpose.** The entire history is
resent on EVERY turn, so a conversation's cost grows with the square of its
length, and the browser has to post it inside `express.json`'s 2mb.

**THE SHEET'S TWO SENTINELS ARE DATA, AND SHE TRANSLATES THEM.**
`Will never be bank` (all three banking columns, 55 of 96 rows) and
`Handled internally` (phone, postcode) are values the boss's file writes in
place of an answer. They are deliberate: the row editor offers them as
options and reads `NEVER_BANK` back to set its own banking toggle, so
nothing may strip them. Every other surface understood them; Diane read
"account number: Will never be bank" back as though it were an account
number. `readable()` translates on DISPLAY only, says it once on the bank
line, and drops the account and sort code lines rather than repeating the
same sentence three times. On the card those two read "not held", because
an empty cell there counts toward "N not set" and these are not missing.

One list per codebase. The api's is `masterSheet/canonical.js`'s
`SENTINELS`, which already held these two plus `In person meet`,
`Ongoing` and `Not applicable`, and is what canonicalises their spelling on
upload: Diane reads that list rather than restating it. The web's is
`configs/sheetValues.js`, where the strings had been written out as
literals in four components. Two lists, never one import: separate deploys,
and the strings must match.

**Her card shows the DERIVED payment period**, not the stored `status`,
which is written only at upload and goes stale the day an end date passes.
The repo returns both in the same query. Editing still writes the stored
column, which is what a hand-set value overriding the derivation means.

**An undecided payment switch renders the resolved default, faded**, the
same as every CRM page: should be paid yes, paid no. The card used to show
"not set", a fourth state nothing else displays, which made it disagree
with the Master Sheet about the same row. The fallback travels from the
server beside the value so it matches the repo's own COALESCE rather than
being guessed again in the component.

**She names the month.** "500 for August", never "for the preset month" —
which she learned from the prompt's own payable formula and repeated to the
boss, a figure attached to a word for a cell rather than a period anybody
can picture. `formatRowDetails` now hands her `marked for: August 2026`
beside the raw date. A row with no preset reads "every month".

**SHE REMEMBERS EARLIER CONVERSATIONS** (migration 041,
`tb_conversations` + `tb_conversation_messages`). Neither table is in the
burn's `TRUNCATE`, so the monthly wipe leaves them alone: the master sheet
is the present tense, what was DISCUSSED is the part worth accumulating.

**SAVED WHEN A CONVERSATION ENDS, never turn by turn.** Nothing writes to
the database while somebody is talking to her. The browser already holds
the transcript, so it posts it once.

**Closing the orb is a SAVE POINT, not an end**, because `DianeContext`
deliberately keeps the conversation across a close and reopen. A real end
is the page unloading or thirty minutes of silence. Saves are idempotent on
a browser-generated uuid, so a second save replaces rather than duplicates
and carrying on after a close simply writes a fuller transcript.

**THE 64KB PROBLEM, and why there is a checkpoint.** `sendBeacon` and
`fetch(keepalive)` are both capped at 64KB while the history budget is
200,000 characters, so a long conversation is SILENTLY DROPPED on unload:
no error, no request, nothing stored. Past ~50KB the transcript is saved
once with a normal request, and again at the end. Two or three writes
across a long conversation instead of one per turn, and a crash loses the
last stretch rather than everything.

**A summary is written in the same request**, one paragraph on what was
decided. It is best effort: `summarise` returns null rather than throwing,
so a model outage costs a searchable paragraph and never the record.
Skipped on a checkpoint, since summarising something still being said
describes half a decision.

**Each conversation stores what it TOUCHED** (rows, people, groups), taken
from the tool results the overlay already receives. Recall for a person
then finds the conversations that ACTED on their rows rather than the ones
that happened to mention the word, and ordering by date makes the newest
win with no supersession logic.

**`recall_past_conversations` returns prose and dates, never rows.** Two
rules make it safe rather than dangerous:

- **MEMORY IS FOR DECISIONS, THE SHEET IS FOR FIGURES.** A remembered
  number is one nobody recomputed and it will be quoted confidently long
  after it stopped being true. When the record and the sheet disagree she
  says so rather than choosing one silently.
- **A RECORD IS NOT AN INSTRUCTION.** Stored text can be recalled into a
  later turn and acted on, where before it died with the tab. Results come
  back fenced between explicit markers and the prompt states that only the
  person in front of her can ask her to act.

**No pruning**, decided 2026-08-27. Under 4MB a year, and the point is that
she improves the longer she runs. Revisit when multi user lands.

**SHE DOES NOT DO ARITHMETIC. `total_master_sheet` does.**

Asked for Nicola's August she answered **3,700 against a real 2,900**, and
the transcript shows two mistakes compounding. She **invented row ids**:
Nicola's rows are 14, 19, 30 and 32, she found 30 and then asked for its
NEIGHBOURS 28, 29 and 31, which belong to Jason Taylor, Byron and Lucy
Okenabirhie. Then she **added those strangers' money up in prose**.

The rule the CRM already had (`v1/calculator/` is pure computation, figures
are code and never the model) had no equivalent on her side. Now it does:

- **The tool takes a NAME, not ids**, resolves it itself and returns a sum
  it computed. There is nothing to pick and nothing to add.
- **It totals with the SAME rule the exported sheet uses**
  (`shared/owedThisMonth.helper`, plus `presetMonth.helper` for the month),
  and reads the same end-date setting, so what she says and what the file
  prints cannot disagree. She used `isPeriodEnded` directly until
  2026-08-27, after the exports had stopped.
- **Per currency, never blended.** Two currencies stay two figures.
- **A CAP ON A TOTAL IS A WRONG TOTAL**, and it would look right. It read
  one page of 500 and summed it. The sheet is 96 rows so it never bit, but a
  figure computed over a page defeats the whole point of the tool, so past
  the limit it now REFUSES and asks the admin to narrow it.
- **Uncounted rows come back too, with the reason.** A row worth 0 because
  its payment starts in November is the answer to "why is that less than I
  expected", and dropping it makes a correct total look wrong.
- **A fuzzy name matching two PEOPLE refuses to sum** and asks which.
- **`get_master_sheet_row_details` leads with the names** when the rows span
  more than one person, so a guessed id cannot pass unnoticed.

`agent/tools/totals.test.js` pins the arithmetic with no database, Nicola's
2,900 included.

**SHE FILTERS THE SHEET THE PAGE'S OWN WAY.** `filter_master_sheet` goes
through `masterSheetRows.repo.findAll`, the same function the Master Sheet
page calls, so "which are on an old preset" cannot be answered one way on
screen and another out loud. Four matches or fewer draw full DealCards; more
draw a `DealList`, one line each, capped at sixty with the shortfall said in
the subtitle so a header reading 76 never sits above a list of 60.

She asks WHICH GROUP before running it unless one was named. Across every
group the answer is most of the sheet, which is a wall nobody reads and the
opposite of the point: this exists so the boss can work the sheet while doing
something else, by talking.

The preset filter offers the page's three (`current`, `old`, `future`) and no
fourth. A row with NO preset is owed every month and belongs to none of them,
so inventing a `none` option would have her list disagree with the screen.

**SHE PUTS A FORM ON SCREEN, rather than reciting field names.**
`new_deal_checklist` and `edit_deal_form` emit DEAL_CHECKLIST as structured
fields and the browser renders them as inputs in the transcript. Submitting
sends the values back as an ORDINARY MESSAGE and she calls add_deal or
update_master_sheet_row herself, so there is one write path with one set of
validation and one change-log entry.

Measured against the live API: chat first token ~2s, Whisper ~3.5s on a ten
second clip, speech ~2.4s for a short reply. A cold database connect is 13.5s
and inflates the first turn after a restart; `warmUp()` covers it. The speech route buffers the
whole mp3 before sending because the browser plays it from a blob URL, so
streaming it would need a frontend rewrite as well.

## Diane's command center

Gold on near black, laid out from the reference the user supplied. Login,
boot and the command center are one world; the CRM keeps its own light
palette and is untouched.

**THERE IS NO WELCOME SCREEN.** `WelcomeOrb.jsx` used to sit between the
boot screen and the CRM on a first-ever sign-in, asking "command center or
portal" and storing `diane-has-been-greeted` in localStorage. Deleted: a
sign-in lands in the CRM, always, and Ask Diane is the only way into her.
`DianeBoot` lost its `onReady` with it, since nothing needed to mount
under the fade any more. The stale localStorage key is harmless and
nothing reads it.

**The browser tab is `Admin Workspace`, never Diane.** She is the command
center inside the app, not the app. `web/index.html` also carries a
description and `noindex, nofollow`: the CRM is sign-in only and belongs
in no index.

**ONE PALETTE, `web/src/configs/dianeTheme.js`.** She was green in 177
hardcoded literals across 19 files, so a colour change was 19 edits and a
guarantee two would drift. She has been gold, a lighter green, and gold
again since, and every one of those was this file and nothing else. Two
consumers read it: `tailwind.config.js` exposes it as the `diane-*` classes
(`border-diane-line/35`), and the canvas code imports the hexes for
`THREE.Color`. `index.css` reaches it through Tailwind's `theme()`.

**The keys name the ROLE, never the hue**: `signal`, `hot`, `dim`, and the
alpha helper `tint()`. A palette with `green` or `gold` in its keys has to
be renamed every time somebody changes their mind, which is how two names
end up in circulation. `ORB_COLORS` keeps the same five mode keys in both
blend palettes, so a mode cannot exist in one and not the other.

### What she sends, and how much room it takes

Nine things reach the transcript. Seven are panels, two change one already
there: a text bubble, an interim line (`say`), a deal card, a deal list, a
fillable form, the export session, a progress bar, plus `fill_form` and the
export pause/cancel.

**The deal card is compressed.** Section headings were padded tinted bars
costing a row each and are a 9px caps label with a hairline now; cells went
three up to four up; Contact and bank, the least scanned block and the
biggest, folds behind a summary line. Type floor is 9px, below which the
stems go on this ground.

**THE TWO PAYMENT PILLS SHOW THE EFFECTIVE ANSWER AND NOTHING ELSE.** `null`
is nobody decided, and the card used to show that faded, so an untouched row
read grey. User's own call to flatten it, and the boundary is:

    read only   the effective value. DealCard.
    editable    whether a human chose it. DealForm keeps `Not set` as a
                real position, because a plain yes/no there records a
                payment decision every time somebody opens the form to fix
                a typo.

That narrows the Payment rule in `CLAUDE.md`, which says the resolved
default renders faded. It still does everywhere you can change it.

**Coloured by meaning, never by true/false.** `signal` owed or paid, `warn`
owed and outstanding, `dim` excluded. Red is reserved for `Needs a check`,
whose reason moved off the pill into a hover: inline it ran that one pill to
three times the width of the others.

**The deal list is a wrapping chip grid**, two across at 400px and three at
576px, `auto-fill` rather than breakpoints because the panel has three
widths. Sixty deals was sixty rows. A chip opens the full card in a modal.

**`/master-sheet/:id/card` backs that modal.** The chip carries six fields
and the card needs the row, so the route serves one row through her own
`dealCard` builder. Assembling the card in the browser instead would be a
second definition of the shape, and the two would disagree the first time
either changed. It sits above `/master-sheet/:id` or Express matches `:id`
first.

**Two things had no cap at all.** A long reply arrived as one bubble however
tall it was (`speakableReply` caps what she SAYS at four lines and nothing
capped what she drew), and the export card's `Columns` line printed every
header joined by commas, which on a master sheet export wrapped to four or
five lines. Both collapse now, and the warnings list is capped at four.

**Row ids in her prose are links.** She already puts `#47` in answers so the
next turn can refer to it; clicking one opens the modal. Assistant text
only: an id the admin typed is a question, not a reference.

**No generated artwork.** Four transparent PNGs were generated for the
modal emblem and the payment methods, and thrown away: they came back
filled rather than line art, with a glow baked in, at 1.3MB each for
something drawn at 20px, matching nothing else in the app. `CashIcon` and
`BankIcon` already existed, `CryptoIcon` was added, and inline SVG follows
`currentColor`, weighs nothing and is already the house stroke.

**Layout: a two row GRID, not nested flex.** Her stage with her command bar
under it, and the conversation panel spanning both rows.

    ┌───────────────────────────┬──────────────┐
    │  vitals │ orb             │ CONVERSATION │
    │         │ plinth          │              │
    ├───────────────────────────┤  (both rows) │
    │  status │ command bar     │              │
    └───────────────────────────┴──────────────┘

The grid is the point: the panel has to reach the bottom of the screen and
the command bar only as far as she does. A flex row with a footer under it
cannot do that without padding the bar by hand to the panel's width, which
is the `--convo-clearance` pair this layout already threw out once. Below lg
it becomes three rows in one column (her, the conversation, the bar), so the
panel is on screen at every width rather than the orb being hidden for it.

- **Nothing lives in the left margin.** A nav rail was built and removed
  the same day (the way out is "Go to portal", and a second list of "where
  you can go" beside the CRM's own sidebar is how one ends up pointing at a
  dead route), then a turned-on-its-side SECURE / PRIVATE / TRUSTED went in
  its place and came out too. The left padding is tighter than the right
  because everything on that side is a readout that wants the edge.
- `OrbVitals` + `Heartbeat` are the telemetry column. **Every figure is
  measured** (`useDianeVitals.js`): response is the last turn's own round
  trip, timed at the two ends of the await; accuracy is turns answered over
  turns attempted; signal is the same live amplitude the orb reacts to.
  Before the first turn it shows a dash, never a flattering number. The
  heartbeat's RATE is her state and its HEIGHT is that amplitude, with a
  jittered interval so it does not read as a metronome.
- **The telemetry column takes its own space.** Floating it in the orb's
  margin was the first attempt, and at 1280px there is no margin: it landed
  on the particle field. A real column narrows the orb instead. Below xl it
  is gone and the status is one line under her, from the same
  `StatusReadout`.
- `OrbPlinth` is the projector plate. Rings were removed once for being an
  animated, blurred cost over the canvas; these are ONE static SVG, no
  filter, no animation, zero per-frame cost.
- **The conversation cannot be shut.** It was a drawer you opened, then a
  panel with a collapse control: either way the product of this page had a
  button that hid it, and the transcript was rendered TWICE so a closed
  drawer still carried a strip under the orb. One `<Messages>`, one
  scroller, no toggle. Below lg the body stacks into three rows so the
  panel is on screen at every width.
- **The input is not inside that panel**, so nothing about the conversation
  can remount the editor and lose what was half typed.
- **The formatting toolbar is above the pill, outside it**, and the pill's
  own outline is drawn by `RichInput` for that reason: the toolbar has to
  clear the edge, and only whatever draws the edge knows where it is. The
  editor hides its scrollbar (a bar down the middle of a rounded pill) and
  keeps the caret in view itself instead.

**The beam took three goes, and the first two are why the third is odd.**

1. A filled path with a vertical gradient is a TRIANGLE: two hard diagonals
   against black and a straight cut across the top.
2. A gradient mask only moved the line. A mask feathers over a RECTANGLE
   and the shape narrows, so wherever the beam is thinner than its own mask
   the sides come back hard.
3. Ten stacked wedges feathered at every height and BANDED: ten alpha steps
   on a near black ground read as spokes.

It is a CONIC GRADIENT centred on the apex, because brightness in a beam is
a function of ANGLE, which is what a conic gradient interpolates. SVG has
none, hence the `foreignObject`, which keeps it in the viewBox's coordinates
so it stays welded to the rings. `mix-blend-mode: screen` is what makes it
read as light rather than as a shape filled with yellow.

**The plate's WIDTH drives its height.** `preserveAspectRatio` letterboxes
to whichever axis is tighter, so a height in vh left the rings at half the
width they had room for and the beam a thread. `h-auto` plus a percentage
pull up (percentages resolve against the width) keeps the overlap with her
constant at every size.

**Two performance faults fixed with it.**

- The orb kept rendering its full field sixty times a second behind the
  overlay's `display: none`. `active={open}` skips the draw; the context
  still survives a close and reopen, which is why the overlay hides rather
  than unmounts.
- The orb was `position: fixed`, positioned from a measured rect, with a
  ResizeObserver and a window listener keeping it over an invisible
  placeholder. That existed to animate her to full screen for a reaction,
  and reactions play in place now. It is in the layout; the observer, the
  listener and the state are gone.

## Shared UI

`Button`, `Select` (+ `Field`), `Modal`, `ConfirmDialog`, `FloatingField`,
`FilterPanel`, `FilterCheckbox`, `DateRangeFilter`, `Pagination`, `CellInfo`,
`CellSuggestion`, `TruncatedText`, `ReviewFlag`, `StatusBadge`,
`PaydayIndicator`, `Toggle`, `EditableCell`, `DealsEditor`,
`RecordCard`/`CardList`, `HistoryModal`, `ImportDiffModal`,
`ExportWarnings`, `PageHeader`/`Toolbar`/`SearchInput`, `Breadcrumb`,
`Toaster`, the `Skeleton` family.

**The export panel skips an ended period, EXCEPT for the dates.** That skip
is a money rule: an ended row's figures are already correct and already
marked in the file, so repeating them as a fault on every count is noise.
`isPeriodEnded` counts `not_started` as ended too, and 19 of the live 96
are not-started, so those shipped inside the file with empty end dates and
the panel could not offer to fill one. `derivable-dates` carries
`includeEnded: true` and is the only scenario that opts out, because it
decides no figure. Found 2026-09-08.

Its header stopped saying "rows affect this total" in the same change. Once
that scenario listed not-started rows too, most of the strip was claiming
to move money it never touches. It says "N rows need a look, M on this
total" now, and each line below still names its own consequence.

### The dashboard window is four months, and it slides

His call 2026-09-09. **A range is MONTHS OF HISTORY and this month is one of
them**, plus one forecast month that is not a control.

```
today September 2026 -> Jul, Aug, Sep + Oct forecast
today October  2026 -> Aug, Sep, Oct + Nov forecast
```

**REVERSED, and it is not the old argument again.** It used to mean months
BACK, not counting this one, because "3 months" beside a forecast horizon of
1, 3, 6 or 12 covered a span the words could not describe. True while the
forward half was a knob. Fixed at one now, so the backward half carries the
whole meaning and `last3` draws four points rather than five.

- **Ranges are 1, 3, 6, 12**, default 3. Twelve is the ceiling because
  `SNAPSHOT_MONTHS` keeps twelve and nothing older exists to draw.
- **`yearToDate` and `custom` left both dropdowns and still resolve**, so a
  saved link keeps working. Neither is expressible as "how many months of
  history", and extra options were half of what made the control unreadable.
- **The months are NAMED under the control** ("Jul, Aug, Sep, and Oct
  forecast"), computed from today. That is what settles it: whatever number
  sits in the dropdown, the line beneath shows the window you get and
  updates itself every month. It was the label alone, and the label was
  wrong.
- **Diane's recall is 3 months**, the same window. It was 36, which reached
  years past the snapshots that exist, so a long comparison was a row of
  empty points and a cap message nobody had asked about. Her forecasting is
  in `backlog.md`.

### The history setting CAPS THE VIEW, it does not delete

`tb_settings.dashboard_history_months`, 3, 6 or 12, default 3 (migration
053). It decides which ranges the dashboard's dropdown OFFERS and nothing
else. At 3 the dropdown shows 1 and 3, and the six and twelve month
snapshots sit there untouched.

**RETENTION IS A CONSTANT AND TAKES NO SETTING.** The obvious version of
this dropdown drove both, so moving it 12 to 3 would delete nine immutable
snapshots on the next scheduler tick: permanently, automatically, with
nobody watching. A snapshot froze the sheet as it stood that day and cannot
be rebuilt from anything. His call 2026-09-09, after A (prune to the
setting) was put to him and refused.

The property that falls out: **raising it is instant and free**, because the
months were never thrown away. `monthsToPrune` takes one required argument,
what is stored, and no caller passes a setting, so there is no route for one.

A range outside the cap still RESOLVES, the same as a legacy one: refusing a
saved link that names 12 after somebody lowered the setting is worse than a
shorter dropdown. An unknown stored value folds to the default rather than
throwing, because the dashboard failing to load over a settings row is worse
than a shorter dropdown too.

### Snapshots keep twelve months, pruned AFTER the write

`shared/snapshotWindow.helper.js` is the one number, read by the scheduler
that prunes and the dashboard that offers the longest range. Nothing pruned
before this: `remove` sat on the repo with no caller and snapshots
accumulated forever.

**AFTER, NEVER BEFORE.** Making room first leaves eleven months and nothing
to replace the twelfth if the snapshot then throws. Taking September when
eleven are held makes twelve and drops nothing; taking October next month
makes thirteen and drops October 2025. A tick that writes nothing prunes
nothing, because the window did not move. A failed prune is logged and
swallowed: the snapshot is the valuable half and it is already saved.

**A PLACEHOLDER SWEEPS, IT DOES NOT BLINK.** `animate-pulse` faded a whole
block in and out, so eight rows breathed in unison and read as the page
flickering. `.skeleton` in `index.css` owns the sweep, the tone and the
radius, because they are one decision and a component reimplementing any of
them would drift. The tone stays `border-strong`: the sunken wash is 4% and
was invisible on a white card. Reduced motion drops the gradient as well as
the animation, or it freezes mid sweep and one row stays lighter than the
rest.

Everything is rounded, matched to what it stands in for: short text lines
are pills, because 6px on a 10px bar still looks square; cards take
`rounded-lg` like `RecordCard`; a chat bubble takes `rounded-xl`. The two
detail pages' loading states are shaped like the page that arrives,
breadcrumb, title beside its actions, then the two column grid, rather than
three full width slabs that jumped into a different layout on landing.

**Both cell markers sit at the cell's RIGHT EDGE**, not straight after the
value: trailing it put them at a different x on every row, so the column
could not be read down and a short date hid its own icon mid-cell.

**The info icon was invisible.** It wore `text-accent`, the PALE FILL
(#8ce3b1, 1.6:1 on white), which the palette's own comment calls too pale
to be text. Both markers now use the `strong` step, the one meant for icons
on white: `accent-strong` (4.9:1) and a new `warning-strong` (4.9:1).
`warning.DEFAULT` doubles as a solid button fill, so it could not be
darkened without dragging the button with it.

**THREE MARKS, and the SHAPE carries as much as the colour.** His call,
2026-09-08.

| tone | mark | colour | means |
|---|---|---|---|
| `warning` | triangle | gold | something is wrong, or the date is a guess |
| `action` | ALERT CIRCLE | gold | the cell is empty and one press fills it |
| `info` | i-circle | green | here is what this is, nothing to do |

`action` is the third tone and only `CellSuggestion` draws it. A fillable
empty date was `info` for one build and got scrolled past in green: it is
WORK, not context. Gold like a warning, round like an info mark, because
nothing is actually wrong with the row. `CellInfo` has no case for it and
falls through to info, which is the harmless reading.

Danger is red and stays red. `warning-strong` was #8a4a05 for one build, a
brown-orange that read as a weak danger; warning and danger are the two that
must never be confused, so it is #8f6c00, the same gold hue as DEFAULT.

**`CellSuggestion` is CellInfo that can WRITE, and only the three date
columns use it.** Not a prop on `CellInfo`: that one portals its panel to
`<body>` while its dismiss handler tests only the anchor, so a pointerdown
inside the panel closes it before the click lands and a button in there
would never fire. `CellSuggestion` owns both refs and tests both, which is
the whole difference. It is click-only for the same reason: a panel you have
to reach with the pointer closes on the way. Where a portalled panel lands
is `hooks/usePopoverPosition.js` now, shared with `CellInfo` so the clamping
and the flip are not written out twice.

### Where they sit

**`components/` has no loose files.** Every component is in a folder named
for WHAT IT IS, never for the page that uses it: `Select` has nine callers,
and filing it under any one of them is the first step back to a second copy.

| folder | holds |
|---|---|
| `auth/` | LoginForm, RequireAuth, RedirectIfAuthed |
| `layout/` | Layout, AdminMenu, PageHeader, UnderlineTabs, Breadcrumb, Pagination, ErrorBoundary |
| `modals/` | Modal, ConfirmDialog, HistoryModal, the two Manage modals, AddDealModal |
| `history/` | HistoryList — the list both the modal and the page draw |
| `wizards/` | AddCompanyWizard, AddPersonWizard — a form with STEPS, which a modal is not |
| `forms/` | Select, FloatingField, Toggle, MultiRowToggle, EditableCell, DealsEditor, HandlerRows, CellSuggestion |
| `filters/` | FilterPanel, FilterCheckbox, DateRangeFilter, NumberRangeFilter |
| `badges/` | StatusBadge, PaymentPeriod, PaydayIndicator, ReviewFlag — one small fact, read at a glance |
| `display/` | CellInfo, TruncatedText, Skeleton, RecordCard, DealPreview, DuplicateBanner, DraftNote, HandlerTabs — shows something, decides nothing |
| `buttons/` `toasts/` `icons/` | one kind each |
| `export/` `upload/` `settings/` `agentOrb/` | by the feature they belong to |

`icons.jsx` became `icons/index.jsx`, so every `components/icons` import
resolves unchanged.

**THE ICON SET IS LINE, and the stroke is 2.1.** The set was converted to
SOLID on 2026-09-08 and reverted the same day: solid held its colour at 13px
but read as heavy and blunt everywhere else, which is most of the app.

- **The weight is the half worth keeping.** At 20px in a 24 viewBox, 1.75
  renders as 1.46 real pixels and the cell markers were being missed. 2.1
  renders as 1.75 and holds its colour without changing any drawing.
- **Two icons stay LIGHTER than the set** and say so at the call: the
  numerals in `NumberListIcon` (1.45) and the strike in `ClearFormatIcon`
  (1.7). A "2" closes into a blob at full weight, and two crossing strokes
  fuse into a diamond. `CheckIcon` stays heavier (2.8), as it always was.
- **`AlertCircleIcon` is the one addition**, 55 exports now. Its glyph is
  the INVERSE of `InfoIcon`'s: bar above dot, not below.
- **`LoginForm.jsx` draws its own six** (eye, lock, key, user, arrow) and is
  untouched. It does import the shared `ShieldIcon`, so the login card's
  trust line carries the set's weight.

**Two traps this move hit, both worth knowing.** A `lazy(() => import(...))`
is not a `from` clause, so a rewrite that only walks import statements
leaves it pointing at the old path and the build is what tells you. And Node
ESM resolves no extensions where Vite does, so the two test files that node
itself loads need `.js` on their imports while nothing else does.

`web/src/components/` was one flat list of 45 files with four subfolders
already in it. Grouped by WHAT A THING IS, so the folder answers "is there
already one of these" before you write a second:

| folder | holds |
|---|---|
| `buttons/` | `Button` |
| `forms/` | `Select`, `FloatingField`, `Toggle`, `MultiRowToggle`, `EditableCell`, `DealsEditor`, `HandlerRows` |
| `toasts/` | `Toaster` |
| `export/` `settings/` `upload/` `agentOrb/` `icons/` | by the page or feature they belong to |

The rest stay at the root: modals, wizards, filters, layout and the small
display pieces. **Moved by category, never by page** — `Select` is used by
nine of them, and filing it under any one would be the first step back to a
second copy.

`FilterCheckbox` is deliberately NOT in `forms/`. It is a filter, and a
filter is a thing you tick to narrow a list, not a value you are entering.

## Searching the master sheet

A column picker sits **beside the search box**, not in the filter panel. On
its own it narrows nothing, so it is not a filter: it aims the box, and it
is meaningless with nothing typed next to it.

**It offers only what no filter can reach.** Group, payment period, preset
month and the three amounts have controls in the panel already, and a second
way to ask one question is two things to keep in step. The seven are
Location, Postcode, Bank details, Account number, Sort code, Notes and Door
number: free text, near unique per row, and a dropdown of ninety postcodes
is a list rather than a filter.

**"Anything" is the default and is unchanged** — the same name, company,
role and phone the box always searched, phone digit-folding included.

**A column name off the query string is never interpolated.** It is looked
up in `SEARCH_COLUMNS` in `masterSheetRows.repo.js`, exactly as
`AMOUNT_COLUMNS` works, and an unknown key falls back to searching
everything rather than erroring, so a stale link returns a list and not a
500.

**Two lists, and the repo's is the authority.** `web/src/configs/searchFields.js`
holds the labels and placeholders; a key it offers that the repo does not
would silently search everything, which is degraded rather than broken and
so would go unnoticed. A web test reads the repo file as TEXT and fails on
the drift. It reads rather than imports: the two are separately deployed and
this is a check, not a dependency.

**The placeholder follows the picked column.** Hardcoded, it kept promising
"name, company, role or phone" while the box was pointed at postcodes.

**Currency and method of payment are FILTERS, not search fields**, and they
were the two gaps the split turned up: closed sets of three or four, and a
closed set is picked rather than typed. Both sit in the panel with the other
`Select`s.

- **The options are DERIVED from the deals**, never a hardcoded list. The
  sheet already uses `EURO`, which no ISO list holds, and the next one may
  invent another. Read off the same `filterOptions` the page already fetches
  rather than a second endpoint running the same query.
- **Both fold case**, the same way group does: `canonical.js` has had to fix
  this column's casing before, and an exact-case filter silently returns
  nothing for a real value.
- **The method filter shows the word the CELL shows** (`bank`, not "Bank
  Transfer"). Two names for one thing on one screen is the failure, even
  when the second one is prettier.

## Filters survive leaving the page

Every filtered page held its filters in plain `useState`, so walking to a
person's page and back reset the lot. On the master sheet that is eleven
controls to set again, and **the commonest reason to leave that page is to
look at one of the rows it just found you**.

`hooks/useStickyState.js` is a `useState` that remembers. Master sheet,
People, Companies and Flagged all use it.

**sessionStorage, NOT localStorage.** A filter is invisible state: coming
back to a list showing 6 of 96 rows with no memory of why makes the CRM
look broken. Dying with the tab bounds that to one sitting, and within the
sitting the filter count and the Clear button already say a filter is on.

**CLEAR MUST ALSO FORGET.** Resetting the state alone leaves the old values
in storage, so Clear would work right up until you walked away and came
back to the filters you had just cleared. `useClearSticky` wipes the page's
whole namespace, collecting the keys before removing any: deleting while
iterating a storage object skips every other key, so half the filters would
survive.

**THE PAGE NUMBER IS NEVER STICKY.** Coming back to page 4 of a list you
have not seen in ten minutes is disorienting, and every filter change
resets it to 1 anyway. Flagged's two DATES are not sticky either: they are
a window, defaulting to this month, and presenting last week's window as
today's is the one case where remembering misleads.

**Three traps, all pinned by tests.** `undefined` is a real filter state
meaning "not filtering on this", and `JSON.stringify` turns it into the
string `"undefined"` which parses back as a crash, so the key is removed
instead. `false` and `0` are values, so the read tests `raw === null` and
never falsiness. And storage THROWS outright in a private window, so every
access is wrapped: a filter that cannot be remembered must not stop the
page rendering.

## Where the words live

Four files, and one rule for which is which: **if you would open a file
specifically to reword something, it is in a config. If you would only ever
change it while editing that component, it stays inline.**

| file | holds |
|---|---|
| `web/src/configs/popups.config.js` | 27 icon popups (`CellInfo` + `hint`) |
| `web/src/configs/confirms.config.js` | 10 confirms |
| `api/v1/shared/messages.js` | server prose, and every message used twice |
| `web/src/helpers/toastMessage.js` | how a write words its own success and failure |

Entries are FUNCTIONS, even static ones: spreading a function by mistake
yields no props and no error, and one uniform shape makes that impossible.
The configs hold no JSX, so they stay content rather than becoming
components with a config's name.

**EVERY WRITE IS OPTIMISTIC, FROM ITS HOOK.** `useOptimisticUpdate` owns the
three beats (paint and snapshot, restore and say what reverted, refetch), so
no hook writes them itself.

`useUpdatePerson` and `useUpdateCompany` were plain reporting mutations on
the reasoning that a modal has its own Save button, so optimism bought it
nothing. **That was only true of the modal.** Both detail pages call the same
hooks one field at a time with no Save button, so every inline edit there sat
unchanged until the refetch and read as a control that had not taken.

**The API is camelCase and the cache is snake_case**, and this is the trap
under optimism: a cached row came out of Postgres, so `{ ...row, ...fields }`
writes `oldGroup` beside a stale `old_group` and the edit LOOKS like it
failed, then corrects itself a moment later. One `COLUMN_FOR` map per hook
file, mirroring the server's, pinned in `hooks/optimisticPatch.test.js`.

`useSetFeePercent` is gone. It did the same PATCH as `useUpdatePerson`, and
the moment the general hook became optimistic it was two hooks for one job.

**`useUpdateSettings` HAND ROLLED THE THREE BEATS** and was the last one
that did. It had no `cancelQueries`, so a refetch in flight could paint the
pre-flip value back over the switch, and no refetch at all, so a value the
server normalised sat wrong until something else forced a reload. Converted
2026-09-29. It needed one new thing: **`silent: true` on
`useOptimisticUpdate`**, the same flag `useReportingMutation` already
carried and for the same reason. A switch moving IS the confirmation, and a
toast per flip of something somebody is fiddling with is noise. **It never
silences a failure**: a switch that does not move reads as a dead control
rather than a refused request, which is why the hook reports at all.

**The FX rates moved to their own key in the same change.**
`useOptimisticUpdate` patches and invalidates by PREFIX, and the rates were
cached at `['settings', 'rates']`: the first flip of a switch would have
merged its booleans into the rates object. `SETTINGS_KEY` and `RATES_KEY`
are separate roots now, neither a prefix of the other.

**EVERY WRITE REPORTS ITSELF, FROM ITS HOOK.** `useReportingMutation` takes
`describe` and `verb` and builds both messages, so the failure is derived
from the success and the two cannot drift. A toast written at a call site
means the next call site gets silence by default, which is how People and
Companies came to have fourteen hand-written toasts while their own hooks
said nothing at all.

Two escape hatches, and they are not the same: **omitting `describe`**
silences only the success, for a write whose result is already on screen;
**`silent: true`** silences both and is correct only when the caller reports
instead. `useAddDeal` and `useAddHandlers` are silent because their callers
are batches, or because a 200 carrying `skipped` means nothing happened and
no hook can tell that from a real add.

## Diane deal targeting

**2026-09-04** Diane resolves a deal within a person by company, group and
role. A named company opens or updates only that deal. An underspecified edit
returns a compact chooser and asks for the missing field. Deal lists are
stable, payable deals first and then company name. Updates and single change
undoes read the saved deal again before returning a deterministic confirmation.

## Workbook month recovery and bulk presets

**2026-09-04** A missing month can be reconstructed from its exported XLSX
without borrowing today's live sheet or settings. The immutable snapshot keeps
all workbook deals, its printed FX rates, add ons, fees, crypto charges, source
filename and SHA-256. Re-importing the same month returns the first snapshot.

An explicit request such as "revert all deal preset dates to 1 September 2026"
is a bulk write, never an undo or totals question. Changes of 20 or more deals
use one database transaction, including their audit records, so they all commit
or all roll back. Recent changes accepts one or several named people.

The preset formula did not change. `explain_preset_rules` now returns the
formula and the live Include end date setting directly. Exchange follow ups
accept only currency codes evidenced beside an amount in the prior answer, so
the ordinary word "All" cannot become Albanian lek. Company Grid remains 16
per page and Rows now requests 25, with a view switch returning to page 1.

## What is verified

`npm test` in `crm/web`: 191 tests, no browser needed. The toast wording, the
search dropdown against the repo's own allow-list, and the optimistic
camelCase to snake_case mapping.

`npm test` in `crm/api`: the last full run passed 901 tests without a
database. It pins the
upload rules, the
payment start derivation against his own August figures, the preset and total
rules, the payout columns and tints, the group layout, the breakdown shapes
and the export filenames. Three of them exist because the end-date rule was
removed in one place and left in three: that an ended period alone does not
drop a row, that the setting moves the payout total through the template as
well as the builder, and that an excluded row is marked on its amount.

Checked headlessly against the real `master.xlsx` (96 rows, 67 people, 32
companies, 0 flagged): every export mode and group builds a valid workbook;
the round trip returns 96 rows with no duplicates through every totals
combination; every filter returns the right count through the real route.

## Diane historical group breakdowns

**2026-09-04** `breakdown_master_sheet` is the read-only reporting path for
one or several group breakdowns. Past months use immutable month snapshots,
the current month uses live deals, and future months project the current
deals. Each section uses the workbook's shared payment-breakdown and USD
conversion arithmetic, including stacked add ons, crypto and fees, native
currency totals, bank/cash/crypto totals, the UK/other cash split, UK send in
GBP, payment location detail, and the exact FX evidence used.

Reporting cannot open the export wizard. `export_sheet` is now blocked unless
the current admin message explicitly asks to export/download/build a file or
answers a visible export step. Exact group names in the admin's sentence
override a mismatched model argument, so one valid group can never silently
become another. The literal group whose name is `ALL GROUPS` remains distinct
from the instruction to include every group. Group follow-ups retain the
previously requested month, while unrelated questions start with their own
time scope. Multiple payment methods remain multiple filters.

The runtime also coalesces several model-generated breakdown calls into one
plural call. Relative month words from the admin outrank any year guessed by
the model, and group/month/payment-method scope is recovered independently
through a chain of short follow-ups. An unavailable conversion rate is never
printed as USD zero; the native amount is retained and explicitly excluded
from the converted totals.

New month snapshots also retain the local-location setting needed to recreate
the historical UK/other split. Workbook-recovered snapshots use the documented
default because an old XLSX does not contain that setting.

The real-model scenario `historical-breakdown.txt` passed against the saved
August workbook snapshot with three reporting calls for three turns and zero
export-panel events. It retained August 2026 and all five requested groups
through cash and bank/crypto follow-ups.

The live sheet is `docs/master.xlsx`, the only copy. Its end dates were
flattened to 30 September 2026 on 2026-08-24, except the 22 rows reading
`Ongoing`.

## The master sheet export, as four named documents (2026-09-22)

His call: he picked the same eleven columns out of twenty one by hand every
month to produce the same four files. The Master sheet tab's column dropdown
now carries a fixed rail beside the options.

| | what it selects | rows |
|---|---|---|
| **All** | every optional column, resolved at serve time | every row |
| **Standard** | payable days, method, payable amount, currency, location | every row |
| **Bank** | Standard less location, plus bank details, account number, sort code | `payment_method = bank` |
| **Cash** | Standard plus door number, postcode, phone, accepting postals | `payment_method = cash` |
| **Crypto** | payable days, method, payable amount, currency | `payment_method = crypto` |

**A PAYMENT RUN IS ROWS AND COLUMNS.** A preset that names a `method`
narrows the rows to it, through the `method` filter `applyFilters` already
had. `All` and `Standard` name none, and absence is what clears it: a filter
you have to spell out to switch off is one that gets left on. The rail item
lights on its FILTER where it has one, so unticking a column inside the Bank
document leaves it still the Bank document.

`SHEET_PRESETS` and `listSheetPresets` in `masterSheet/buildWorkbook.js`.
They stopped being only about columns, so they stopped being called
`COLUMN_PRESETS`. Served on `/export/columns` beside the columns they name,
never written browser-side: a key that stopped matching would select nothing
and say nothing.

**A filtered run is a different document and cannot share a filename.**
`fileLabelOf(template, method)` appends it, and skips it when the label
already says it, so the Bank payout tab is `BANK` and not `BANK - BANK`. All
three places that predict a filename pass it: the route, the export card and
Diane's draft.

**One workbook, a tab per group, is the DEFAULT** on that tab, and it is the
only template that can build one. The option was offered on all six tabs and
honoured by one, so picking it on Cash promised five tabs and handed back a
single sheet. `groupTabs: true` on the mode gates it, and the effective shape
is DERIVED rather than reset, so switching to Cash and back does not discard
the choice.

## What the working file carries (2026-09-22)

The Master sheet tab forwarded neither `rates` nor `cryptoPercent`, so a
PERSON level add on reached no figure in it. Zayn printed 4,000 where his own
sheet says 4,200, the Maid 4,700 against his 4,935. Only a deal's own
`addon_percent` applied, because that rides on the row.

**Payable carries the rates. Monthly does NOT, and that is the whole of the
care here.** This is the one file that is uploaded back:

| column | on the way in |
|---|---|
| Payable amount | `mapSheetRow` **ignores** it and recomputes from Monthly |
| Monthly amount | it **reads** as the wage |

A rated Monthly returns as a raise, and the next export rates that again,
every month, silently. This tab prints no "Add ons" block, so
`declaredRatesIn` has nothing to reverse and would not catch it. That is the
incident `reverseRates.js` was written about. `rawMonthly: true` on this
template alone puts the stored wage back.

**And the single tab's own formula had to stand down with it.** That layout
writes Payable as a live Excel formula off Monthly, so a raw Monthly
recomputed a raw Payable and the rate vanished again. `sheetFormulas` skips
that one formula when `rawMonthly` AND the row carries `rate_parts`, the same
way it already skips the end date formula on a row carrying his words. Both
conditions: every other document rates Monthly too, so there the formula
lands on the same penny and keeps its liveness.

## Archived is off the sheet (2026-09-22)

`findAllRows()` is the "whole sheet, unpaginated" reader and it had **no
`stopped_on` filter**, so archiving a deal took it off the page and off
nothing else. Found on an exported file: 43 INDIGO rows against his 41 and 29
MILKMAN against his 27, four archived deals sitting in the tabs he reads.

It feeds six things, not one: the xlsx export, the dashboard (under a
variable named `liveRows`), whatbot's five minute pull, Diane's breakdowns
and month history, snapshots and the briefing. The filter belongs in the
repo, because five call sites remembering is five chances to forget. The
Archive page reads the paged query with `stopped: true`, which is the one
place that wants them.

## Two crashes the column selector could reach (2026-09-22)

**A tag with no column to sit in.** `writeTag` asked for the end date column
with exceljs's `sheet.getColumn('end_on')`, which THROWS on an unknown key,
so the `if (!column?.number) return` underneath it could never run. Every
preset but All drops that column, so Bank with tags on and any row reading
"Going concern" lost the whole file to `Out of bounds. Excel supports columns
from 1 to 16384`. The cure is `cellByKey`, already in the same file for this
exact reason.

**A derivation that failed, written into a NOT NULL column.**
`payableDaysFor` returns null when the preset is not a real date. A hand
added row has no preset, so setting its appointment put null in the patch and
`payable_days` is NOT NULL: the constraint threw and the whole edit rolled
back, with the database's own words in the toast. It was never about
appointments, and `payable_amount` was reachable the same way. Could not be
worked out is not zero and is not null; the stored value stands.

## Four loose ends, closed (2026-09-23)

**A switch needs the column it writes into.** "Include tags" writes his
words into the END DATE cell, and four of the five presets drop that
column, so on Standard, Bank, Cash and Crypto it was on screen, flippable,
sent, and did nothing. `MARKS` entries now declare a `needs` column and
are hidden and unsent without it. Named as a COLUMN, never a list of preset
ids: the picker is free, so unticking the end date by hand has the same
problem.

**Dev mode showed the message and swallowed the reference.** A 500's real
text reaching the browser under `isDevMode()` is deliberate and right. What
was wrong is that the six character ref was only added to the OTHER branch,
so a constraint violation arrived as a bare truncated driver line with
nothing to search the Logs page for, while the full message, stack, method
and path sat in `logs` under that ref. Both branches carry it now.

**Three rows from the 2026-09-20 upload delete are still gone, not five.**
Seven were deleted at 23:34. Four of them the same upload had INSERTED a
minute earlier at 23:33, so Pino and Gloria on NEXUS and Zayn on INDIGO
were replaced rather than lost; FB was hand re-added on the 22nd. The three
with no live equivalent are `Lee croft · RP Backrunner 2 · MILKMAN`,
`TLL · RP Backrunner 2 · MILKMAN` and `Sp · Workforce · ALL GROUPS`.

**`tb_mastersheet_changes` cannot recover a row, and `tb_month_snapshots`
can.** A deletion logs only the LABEL, "Lee croft · RP Backrunner 2 ·
MILKMAN · Director", which is not a row. The August snapshot holds every
column of all three. `scripts/recoverFromSnapshot.js` reads it and inserts
them **archived**: a recovered row is there to be audited, not to be paid,
and one that quietly rejoined the sheet would rejoin the month's total with
it. `stopped_reason` is a closed set of four with no value meaning
"recovered", so it is `stopped_by_hand`, which is true, and the provenance
goes in `notes` and in a `recovered` change-log entry.

## Configuring the working file (2026-09-23)

Three things the master sheet export could not do. The first two were the
same fault as `rates` before them: this template NAMES the options it
forwards, so each new one has to be listed by hand and each one can be
forgotten by hand.

**The header band's colour.** `primaryColor` reached every other document
and not this one, because the picker rides with the breakdown and this file
has no breakdown. The mode claims `headerColor: true`, the tab draws the
shared `Swatches`, and the param is sent on its own rather than by
widening the breakdown block, which also carries a design, a secondary and
a percentages table that this file has none of.

**`blue-white` is the only colour with a sheen.** `gloss` is a two stop
vertical gradient on the HEADER BAND alone; every other weight stays a flat
tint. It is the one place a gradient is safe: a header holds four words of
bold white type, not figures read across. Both stops carry white, so it
runs from Excel's 40% accent to its 50% step of the same blue rather than
blue to white. A gradient that actually reached white would put white type
on white at one end. The swatch draws the sheen off `c.gloss`, never off
an id, so a second glossy colour needs no browser edit.

**A "Rates applied" column, in words.** `shared/rateText.helper.js` spells
one cell: `added 5% · 1% fx fee · 2% fee off`. Text, not a number, because
a bare "5" answers nothing: added or taken off, whose rate, and the
exchange's cut reads identically to a fee off the wage. The three rates run
in two directions and the column exists to make that legible, so the
direction is in the words. `adjustmentLabel` spells a breakdown LINE; this
spells a CELL, and neither is built by hand at a call site.

**It is the one OPT IN column.** `optIn: true` keeps it out of
`listExportColumns` and out of `pickColumns` unless named, so a switch owns
it and it never appears on an export nobody narrowed. It is last, because
every other column is his in his order. A row with no rate gets an empty
cell: a column of "0%" hides the eight that matter.

**Per person export, and it needed one flag.** The picker has been in this
modal since the payout tabs, searchable, multi select, keyed by
`person_id` and labelled by name, and it already narrows WITH the groups.
A second control in a settings panel would be two places for one filter.
`people: true` on the master sheet mode is the whole change. Group
segregation survives: one person across two groups is two tabs, a group
they have no deal in gets none, and `exportScope` already names the file
after them (`johnathon - MASTER SHEET - 2026-09-23`, `2 people - ...`).
Person and method stack, so Bank plus one person is that person's bank
deals.

## Her deal card, her deal list, and one confirmation (2026-09-24)

**A card is `label: value` lines, two up.** The panel's cards were a four
up grid of tinted cells, which gave every value about a dozen characters:
"handled internally, not held here" wrapped four times across. Each cell is
one line now, label left in a fixed column, value beside it. Two columns
from `sm`, one below it, in the conversation and in the modal alike. The
hairlines are the parent showing through a 1px gap, so an odd group gets a
panel coloured filler: without it the empty half row read as a state
somebody had set.

**Contact and bank opens OPEN.** It is a phone number and where to send the
money. The fold stays, so it can still be put away.

**The header is one row.** Name, the pills, then the money at the far edge.
The subtitle under the name is gone: it said company, group and role, which
The deal says in full three lines below it. It is still drawn on a NARROWED
card, where those cells are filtered out and it is the only thing saying
where the deal is.

**Two rate cells, not four.** `Add on %` and `Fee %` are the PERSON's plus
the DEAL's, added up by `shared/rates.helper.js` `stackedRates`, which
delegates to `ratesFor` so the sum has no second copy. Read only, because
the figure is derived: writing 8 back would put the person's 5 on the deal
as well. Where both levels carry a rate the cell says so: `8 (person 5 +
deal 3)`.

**A deal list is one lit row per deal.** `name · group · company · role`
left, preset, amount and paid pip right. `.diane-row` is the halo without
the ring and without motion: `.diane-offer`'s turning conic border is a
strobe at sixty rows. The search sits on the title row, and the subtitle
under it is gone.

**Every modal has the app's own slim scrollbar.** `Modal` puts
`scroll-slim` on its one scrolling region, and the `diane` tone adds
`.diane-scroll`, which is the colour alone. Her dialogs are near black and
the platform's white bar down the side of one read as a hole.

## Both levels of a rate travel with the row (2026-09-24)

`shared/personRates.helper.js` `personRatesSql` is the one definition of
the two columns a deal needs to be rated: the PERSON's add on and fee. It
was written out by hand in `masterSheetRows.repo` and `monthlyReview.repo`
and MISSING from `people.repo.findById` and `companies.repo.findByKey`, so
a person's 5% showed on the Master Sheet and nowhere on their own page.
The same fault the review queue had on 2026-09-21, in two more places.

The person page's TABLE also drew the raw wage while the cards above it
drew the rated one. It follows the Master Sheet's rule now: the figure
shown is rated, the value edited is the wage.

## One question, one answer, every call it covers (2026-09-24)

**`recallAll` replaced `recall`.** "Update Alex and Blake" is two pending
calls. The runtime applied the newest, told her it was done, and she
narrated both: one person was written and nobody was told. Every remembered
call the agreement covers is applied now, oldest first, deduped by shape,
each still having to pass `alreadyShown` on its own.

**The value a change is coming FROM is not what they agreed to.** A summary
writes a change from and to, always. She says "to 5%" and nothing about the
0, so the 0 read as a change they had not been shown and a plain "yes"
fell through to an identical second question. Dropped from `facts`.

**"5 of their deals" is counting deals.** `FOLLOWED_BY_COUNT_NOUN` needed
the noun straight after the number, so the rate preview's own wording read
the count as a value. One determiner is allowed between them now.

**`update_person` takes `people`.** Several people is ONE act: one
confirmation, one set of writes, and every name resolved before anything is
written. One unknown or ambiguous name stops all of it. Each person gets
their own copy of the fields, because `settleRates` resolves a delta
against the person in front of it and writes the answer back: a shared
object put the first person's new total on everybody after them. A display
name is refused across several, and somebody already on the rate is named
as unchanged rather than dropped from the preview.

**The working line says what the call is actually doing.** The runtime
sends `confirmed` with the tool event, so "Updating their profile…" appears
only on the call that writes. The first call returns a summary and changes
nothing, and said the same sentence. A spinner turns beside it, under
`motion-reduce`.

## Rates, audited by talking to her (2026-09-25)

**A profile rate is undoable.** `people.repo.revertProfileRate` writes
tb_people back and closes every log entry of the same act (same field, same
transaction time, same person), returning them as `covers` so
`revertChangeBatch` counts them done rather than failed. Refused when the
profile has moved since. `isUndoableField` and History's `revertible` both
include the two profile fields, from `shared/profileRateLog.helper.js`.

**The profile log says who and which act.** `upsert(fields, { via, batchId })`.
Diane's writes are `diane`, one batch id per act across every person.

**The first profile edit no longer writes the slug as the name.** The insert
defaulted display_name to person_id ("gloria-difference"), and every rate
edit overwrote a chosen name with that default. Migration 066 repairs rows
where the name equals the slug; 9 real people carry it.

**Every total is rated.** The People and Companies lists return per deal
parts and `rates.helper.ratedMonthlyTotals` rates them; the two detail
pages' `detailMonthlyTotals` rates each deal. Both carry crypto. One list
person read 4,000 where every other surface read 4,200.

**The runtime owns a write, not her wording.**
1. `shared/writeTap.helper.js`: a call WROTE if it broadcast. Only then is
   it remembered as done, so a question or a refusal is never "already done".
2. `confirmReplay.confirmationHeld`: her `confirmed: true`, and the runtime's
   own replay, stand only for a pending remembered from before this turn,
   shown in full, answered with a plain yes. Otherwise the call answers with
   its pending again.
3. `recallAll` applies one proposal once, whatever argument shape it came in.
4. The bulk pending carries `pending` and `confirming` like every other.

**Routing.** A person's rate with no deal named goes to `update_person`
(`update_master_sheet_row` redirects). `knownArgs` names the right tool for
`people` and for a rate delta. "Take N% off" a person is an N% fee
(`rateChange.misreadTakeOff`). A rate question through the details tool is
answered by `check_rates`, which takes `company`. `resolveDealScope`
re-homes a company sent as a group, for every tool that uses it.
`update_person` resolves each listed name with the bulk tool's resolver and
no shared sentence, so an invented name is nobody.

## Bulk acts, and the confirm the runtime owns (2026-09-25)

**Named deals.** `perPerson` entries take `company` and `add`. Special case
and payable amount are `NAMED_DEALS_ONLY`: refused over a filter, allowed per
named deal, a person with several deals asked which (`oneDealFor`). The one
deal tool takes `add` too. `amountOverwrite` refuses an amount said as ADD
arriving as a SET, reading the turn before when the answer has no figure. A
payable set by hand confirms, every moved field from and to (`confirmAmounts`).

**The hand over is the runtime's.** `handOverCall` builds the per person
preview when a second person reaches the one deal tool, and the result's
`redirect` makes `runAgent` remember it as the bulk call. `openAsk` keeps a
plan that asked "which deal?" so the answer completes it.

**What a "yes" may confirm** (`confirmReplay.js`):
1. A call's identity is its full arguments, sorted at every depth. A replacer
   array had made every two person `perPerson` call identical.
2. A figure is one fact however written ("1,000.00" is 1000), a date one fact
   in words or numbers, "each one" is not the number 1, and a FROM value is
   dropped with a currency code either side.
3. A newer proposal about the same person supersedes older ones, so one "yes"
   never applies the same change twice.
4. A pending with nothing checkable stands on its shape and a plain yes.
5. Only a call that WROTE (it broadcast) is "already done"; the review and
   stop tools now broadcast like their page routes.

**Claims.** `checkClaimedWrite` catches "I've added", "has been ended" and the
like when nothing was written this turn. `checkFigures` treats a money claim
after tools that only refused as unsupported.

**Routing.** A bulk pending is a real pending (`pending`, `confirming` naming
the people). A confirmed call skips the guards that read only "yes". "Next
month" sent with a guessed year is told the month. "Mark as paid" and "end the
review deals" have their own corrections; "end" and "close" are instructions.

**A yes or no about a rate is answered in code.** `askShapes.asksRateCheck`
reads "is X on N%"; `rateChange.rateVerdict` gives Yes, No or Partly with both
figures; `check_rates` makes it the opening sentence and `checkVerdict.js` holds
her to it. A rate question never reaches a write tool.

**The person page honours a payable set by hand** (claimed in
`manually_overridden_fields`), as Diane's total and the export do.

## Diane takes her time (2026-09-25)

Every fault in the admin's test was one shape: she answered before a tool did
the work. Each is now held in code, listed in `.claude/agents/diane.md`.
1. A proposal lives ONE turn (`nextTurn`); a "no" drops it (`declined`).
2. A "shall I?" on an instruction needs a pending; a "yes" to nothing writes
   nothing, even through a tool that never asks.
3. Where a tool knows the right call, the runtime makes it: profile rates,
   "take N% off" as a fee, a rate beside `set`.
4. Money moves only on a person and a deal the admin named.
5. Undo: a partial undo leaves the rest undoable; "undo that" never reaches an
   undo, found by `reverted_at = changed_at` in `findChangeBatches`.
6. Fixed on the way: runAgent's `messages` array shadowed the shared copy, so
   a failed model call threw a TypeError instead of her message.

7. A rate change is said the way its line moves it (`checkRateDirection`), a
   done rate carries from and to, and a rate asked with no verb still needs
   its pending.
8. "Take N% off" someone on a fee asks replace or on top; the question holds
   both answers (`feeAsk`), and theirs picks the write.
9. Recent changes counts removed deals apart from the listed ones.

## The dead persons list (2026-09-25)

The Archive has two tabs: **Deals** (one stopped deal a row, as before) and
**Dead persons**: everyone who held a deal and now holds none live.
1. **Worked out live, never stored** (his call). `repos/deadPeople.repo.js`
   `DEAD_IDS_SQL`: at least one stopped deal and no deal with `stopped_on IS
   NULL` under that `person_id`. A deal resumed or added back under the same
   person takes them off at once. Migration 067 indexes both halves.
2. **Cached through the rows cache** (`readThrough`), so every deal write drops
   it; profile and snapshot writes drop it too (`repos/invalidatingRows.js`).
3. **Their page** is `/archive/people/:personId`: contacts and banks as sets,
   history counts, and the journey company by company
   (`shared/deadPersonJourney.helper.js`, one definition for page and Diane).
4. **No combined monthly figure**: their deals did not all run at once.
   "Recorded as owed" is only what the month snapshots kept, never estimated.
5. A display name equal to the person_id (the 066 slug) falls back to the
   name on their deals.
6. `components/layout/UnderlineTabs.jsx` is the one tab strip; Monthly
   Review uses it too.

**Web.** Diane's recent changes list is text in her bubble, search on the
title row. A space no longer opens the mic while she answers. On a phone the page keeps its bottom padding up to 767px and
clears the home bar (`spacing.safebottom`, `viewport-fit=cover`); a modal
sheet no longer reserves the bar's height it covers.
