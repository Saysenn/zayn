# Diane hands over a sheet

## The problem

Everything in the export modal is unreachable from a conversation. An admin
who wants the bank sheet for MILKMAN has to leave her, open the modal, and
rebuild in six clicks what they just said in six words.

## The question that was blocking it, answered

**Where does the workbook go?** The chat returns text and cards. It was
looking like the file needs a home, a signed URL and a lifetime, which the
codebase has already refused once: the upload's rows travel out and back
rather than sitting in a server cache, precisely to avoid *"state to expire"*.

**It needs no home. `/export/xlsx` is already a GET whose entire input is
the query string**, behind the same admin cookie the chat uses.

So she does not produce a file. **She produces the LINK that produces the
file**, and the browser downloads it exactly as the modal does.

```
  she resolves the words  ->  a query string  ->  the SAME endpoint the modal calls
  "bank sheet for MILKMAN"    ?template=bank&preset=bank&group=MILKMAN
```

What that buys, all of it for free:

1. **No storage, no expiry, no cleanup.** Nothing new to go stale.
2. **One export path.** Her file and the modal's are byte identical because
   they are the same code, not two callers that agree today.
3. **Re-clickable.** The link regenerates against live data rather than
   handing back a snapshot that is wrong by the time it is opened.
4. **Auth is already right.** Same cookie, same session, no new surface.

## What gets built

### 1. `export_sheet`, one tool, read only

Read only is the point: generating a file writes nothing, so this is the
one large capability that needs no confirm step. **Keep it that way. No
"export and mark them paid".**

| argument | from |
|---|---|
| `template` | `/export/templates`, so she offers what exists |
| `month` | `YYYY-MM`, or omitted for the current month |
| `group` | one group |
| `people` | names, resolved through `resolvePerson` like every other tool |
| `breakdownDesign` | `/export/breakdown-designs` |
| `multiFile` | one file per group, zipped |

It returns a `file` result: the URL, the filename, and the counts.

### 2. It COUNTS before it offers, and says what is in the file

`/export/count` already returns rows, people, groups and the month stats.
The tool calls the same code and the reply names them:

> The MILKMAN bank sheet for August: 19 rows, 12 people, 1 group. Two rows
> are carried with an ended period. Here it is.

**A file that does not say what it contains cannot be checked**, and this
is the same rule as a total that does not say what it counted.

### 3. A `file` event, rendered as a download

`runAgent` already emits `tool`, `message`, `form`, `form-fill`, `card`,
`list`. This adds `file`, carrying `{ url, name, summary }`, drawn as a
download button in the conversation.

**This is the only part in `agentOrb/`**, which is off limits under the
standing rule, so it needs saying go on separately. Everything else is
server side.

## The three ways this goes wrong, and the guard for each

### 1. She invents a filter

A sheet quietly missing rows is worse than no sheet, because nobody can see
what is absent. Same failure as a total computed over one page.

**Guard:** every filter she passes must come from something the admin said.
An unresolvable name **refuses the whole export** rather than quietly
narrowing, exactly as the combined total already does. Names go through
`resolvePerson`, so "Gloria" cannot silently become "Gloria difference".

### 2. She hands over the wrong shape

Six templates and four breakdown designs. Picking one silently means the
admin opens a bank run when they asked for the month sheet.

**Guard:** she OFFERS and ASKS, the way `new_deal_checklist` does for a
deal. Served lists, never a list typed into the agent, or it drifts from
the modal's.

### 3. The reply and the file disagree

She says "19 rows" and the file has 20 because the count and the build ran
different filters.

**Guard:** the count comes from the same `applyFilters` + preset + month
chain the build uses, and the link carries the identical query string. One
input, two readers.

## Not in scope

- **Sending the file anywhere.** It downloads to the admin's machine.
  Emailing it is a different capability with a different blast radius.
- **Writing.** No marking rows, no changing presets from the export path.
- **A crypto template.** Crypto reuses `bank` filtered to the method, per
  the card work; the export presets already cover cash, bank and expensing.

## Order

1. The tool, server side, returning the URL and the counts. Testable with
   no UI at all.
2. Tests: filters resolve or refuse, the count matches the build, the query
   string round trips.
3. The `file` event and its button in `agentOrb/`, **on your go**.

Steps 1 and 2 are useful on their own: the tool can be exercised, and the
link works if pasted, before anything in the orb changes.

## The blocking question, ANSWERED

**Should "give me the sheet" export all 96 rows unfiltered?**

**Neither. It opens a SESSION.** The ambiguity was never hers to resolve by
picking, and it is not worth one yes/no question either. "Give me the sheet"
is the START of building a document, not a command with a missing argument.

---

# The export session

A different mode, and it should feel like one. Everywhere else she answers
and the turn ends. Here she holds an open workbench, and it stays open until
the admin takes the file or walks away.

## What is on screen

**A PANEL, NOT A CHAT.** Every choice is visible at once, because a document
being assembled from six decisions cannot be held in a scrollback. It is a
`wizards/` shape, which is already the folder for "a form with STEPS".

```
  TEMPLATE     8 of them, served. Picking one redraws everything below.
  SAMPLE       three REAL rows in the chosen shape. Not a mock.
  COLUMNS      ticked, in columns. Required ones locked.
  BREAKDOWN    ONE picker. "None" is one of the four designs.
  COLOURS      the five palette colours, primary and secondary.
  DELIVERY     one file, or one per group as a zip.
  WARNINGS     what is wrong with this file BEFORE it is built.
  COUNT        rows, people, groups. Moves on every tick.
  [ Build it ]
```

**MULTI TAB IS NOT A CHOICE, it is what a template IS.** `monthly-sheet`
writes a tab per group; the payout templates write one sheet. Offering it as
a toggle would promise something the builders do not take. The only delivery
choice is `multiFile`, and even that does nothing on a single group: the
route already declines to make a zip holding one file.

**BREAKDOWN IS NOT A TOGGLE EITHER, and I had this wrong twice.** `none` is
a DESIGN in the list, not an off switch. `breakdowns/index.js` says why: two
shapes of one block cannot be a switch without a second control that only
means something while the first is on, which nobody can predict from looking
at it. `breakdown=false` still resolves to `none` so old links keep working,
which is what misled me.

**So it is ONE picker with four entries**, None among them. Her session must
not reintroduce the toggle in a new coat.

### A DESIGN IS A BLOCK, NOT A DOCUMENT

The breakdown does NOT follow the ticked columns, and must not learn to.

- The **columns** govern the row table.
- The **design** governs the block at the foot of each group tab, which has
  its own vocabulary: locations, people, amounts, add ons, fees, converted
  totals. Those are not sheet columns and never were.

Making the block reshape itself around column ticks would mean a payout file
whose totals section changes because somebody unticked Postcode. **The two
are independent on purpose.**

**Where each panel's CONTENT comes from** is under "her UI is hers" below.
Every one of them is already an endpoint, so none of it is invented here.

**If a panel needs something neither side has, it goes in the SERVER.** That
is what keeps her file and the modal's byte identical: not shared components,
a shared source.

## THE SAMPLE IS REAL ROWS, NEVER A MOCK

The one thing that would make this worse than the modal: a preview that does
not match the file. A mock table is a promise nobody checked.

- **Three real rows** off the current filter, through the same column set
  and the same headers the build uses.
- Fewer than three rows in scope, show what there is. **None, say so and
  refuse to build**: an empty workbook is not a document.
- The sample redraws on every change, because the sample IS the count's
  visual half.

## Voice steers it, which is the part a modal cannot do

The session is a form, and `form-fill` already exists for putting dictated
values into an open one. So the panel is not a dead end she hands over to:

> "drop the postcode column"
> "no breakdowns"
> "one file per group"
> "make it blue"
> "actually just Nicola and Byron"

Each one patches the panel and re-counts. **She narrates only what changed**,
one line, not the whole state back.

## It can be paused or dropped at any moment, and it SAYS SO

**Decided.** A session nobody knows how to leave is a trap, and an admin who
does not know they are allowed to ask something else will not ask.

- **The panel carries the line itself**, quietly, always visible: *ask me
  anything, or drop this whenever you like*. Not a toast, not something she
  says once at the start and never again. Somebody arriving three questions
  later has to be able to see the exit.
- **A question does not cancel it.** "What is Gloria on?" is answered and
  the panel is still there, untouched. She says one short line coming back
  so the return is obvious.
- **PAUSE AND CANCEL ARE DIFFERENT ACTS**, and each says what survives, the
  same rule Delete and Remove already follow.
  - **Pause** keeps every choice. She can bring it back with "carry on with
    the sheet" and it opens exactly as it was.
  - **Cancel** drops it. Nothing was written and no file was built, so there
    is nothing to warn about: it just goes.
- **Nothing here needs a confirm.** The whole session is read only, which is
  the reason this capability is cheap. Confirming a cancel that destroys
  nothing is noise.

## The orb

`ParticleOrb` already takes `mode`, `level`, `reaction`, `intensity`,
`density`, `opacity` and `formIn`, and keys its colour off `mode`. **Almost
none of this is new work. It is one new mode and a use of what is there.**

### A fifth mode: `building`

`mode` is `idle | listening | thinking | speaking`, each with its own colour
in `GREEN` and `BLACK_GREEN`. Add `building` to both maps and the session has
its own light. That is the "different vibe" and it is two entries and a
colour, not a component.

Held for the WHOLE session, including while she is silent. Every other mode
is momentary; this one is a state she is in, and that difference is the
point: she is not waiting for you, she is building with you.

Suggested: cooler and deeper than `thinking`, brighter than `idle`, so the
room reads it as sustained work rather than a pause.

### Spread, for free

`scaleFor(h)` already grows the orb with its container height. **The session
gives it a taller frame and it spreads on its own**, no orb change at all.

Only if that is not enough: one `spread` uniform in `orbShaders.js` pushing
the particles out along their normals. A real change, so do it only after
seeing the free version.

### Reactions as punctuation

`REACTION_DURATION` is `glow: 1.4, sing: 5.5, dance: 5.5, explode: 2.4`.

| moment | reaction |
|---|---|
| a choice lands, the count moves | `glow` |
| the file is built | `explode` |
| the session opens | `formIn` |

`sing` and `dance` at 5.5s are too long to fire per tick. **Do not fire glow
on every keystroke either**, only when the COUNT actually changes: a reaction
that fires constantly stops meaning anything.

### DO NOT FAKE `level`

`level` is real amplitude, from the mic or from TTS playback, and it is the
one signal on screen that cannot lie. Driving it from "activity" so she looks
busy while silent would spend that for decoration. The orb goes still when
she is not speaking, in this mode like every other.

### Empty is visible

A filter matching nothing dims her: `intensity` down, `opacity` down. The
panel says it in words too, but the light going out of her is the faster
read, and it is honest rather than decorative.

## The guards

### 1. The columns must follow the template

`/export/columns` is served PER TEMPLATE because the payout sheets rename
the same field: one `payable_amount` is "Payable amount" on Expensing,
"Amount" on Cash, "Amount payable" on Bank. **Changing template must remap
the ticks, never carry a name the new document has never heard of.**

### 2. Required columns cannot be untickable

`REQUIRED` (person_name) exists in `buildPayoutSheet`. Locked and shown as
locked. A bank run with no names is a file nobody can act on.

### 3. The count and the file are one input

Same `applyFilters` + preset + month chain, same query string. She says 19
rows, the file has 19.

### 4. She still cannot invent a filter

Unchanged from above: an unresolvable name refuses the whole export.

### 5. Warnings BEFORE the build, not after

`ExportWarnings` in the panel, not a note on the finished file. Seven rows
marked bank with nothing to pay into is something to fix or acknowledge
while the document is still being decided.

## It opens on the last shape, as ONE confirm

**Decided.** `recall_past_conversations` already exists, so the session
opens pre-filled with what they built last time and one line saying so:

> Bank sheet, MILKMAN, August, no breakdowns, one file. 19 rows, 12 people.
> Same again?

One confirm instead of six decisions. **Everything stays editable**: it is a
filled panel, never a shortcut that skips the panel, because a pre-fill you
cannot see is just a guess.

Two things this must not do:

- **Never carry the MONTH forward silently.** Last time's August is this
  time's mistake. The month re-resolves to current and is shown as such.
- **Say WHEN the shape came from**, so an old habit is recognisable as one.
  "Same as August" beats "same as last time" when it is now October.

## The column picker, specifically

"Checkboxes in column format" is right, and the house rules already say how:

- **Multi column grid**, not one tall list. Thirty columns in a single
  column is a scroll nobody reads to the end of.
- **Select all is a CHECKBOX with an INDETERMINATE third state**, never a
  pair of Select all / Clear buttons. It is a DOM property, so it needs a
  ref. This is already the rule everywhere else.
- **Required columns are shown LOCKED**, not hidden. `person_name` is in
  `REQUIRED`; a bank run with no names is a file nobody can act on, and
  hiding the lock makes it look like an oversight.
- **Renaming per template is visible.** Ticking `payable_amount` on Cash
  shows "Amount", on Bank "Amount payable". The picker offers the name the
  reader of THAT document knows, because `/export/columns` serves it that
  way. Switching template remaps rather than carrying a name across.

## THE SAMPLE REDRAWS AS YOU TICK

The single thing that makes this feel alive rather than like a form: **untick
Postcode and the column leaves the sample table in front of you.** Same for
a colour, a breakdown design, a template.

It is the reason the sample must be real rows and not a mock. A mock that
does not move is a picture; three real rows that move are the document.

## Worth adding, best first

1. **CLICKABLE WARNINGS THAT FIX IN PLACE.** `/export/count` already returns
   warnings **with the row ids**. So "seven rows marked bank with nothing to
   pay into" is not a note to go and deal with later, it is seven rows you
   fix without leaving the session, and the count updates under you. The
   data is already shaped for this; nothing else in the plan uses it yet.
2. **A diff against the last one.** The same count endpoint with last
   month's parameters: *"Three more rows than August, and two people have
   dropped off."* The most common real question about a payout file is what
   changed, and nothing in the CRM answers it today.
3. **The filename, shown and editable, before the file.** It is the only
   part that survives on their disk.
4. **Re-run chips.** The last two or three exports as one tap each, from the
   same recall the pre-fill uses. Most months are the same file again.
5. **A spoken closing line naming the contents**, because a download is
   silent: *"MILKMAN bank sheet, nineteen rows, twelve people, two carried
   with an ended period."*
6. **Currencies per group, said before the build.** Already in
   `/export/count`. Every live group is paid in more than one, so it is a
   fact about the file rather than an edge case to notice in the totals.
7. **The link is re-clickable and says so.** It regenerates against live
   data rather than handing back a snapshot.

## Two of yours that need a decision, not an answer

### "Driver sheet"

**There is no driver template.** The eight are master-sheet, breakdown,
monthly-sheet, division-sheet, expensing, cash, bank, bank-details.

Three ways to go, and it is yours to pick:

1. It is a **filter on an existing shape**, the way crypto is bank filtered
   to the method. Free, today, if a driver is identifiable from a column.
2. It is a **new template** in `v1/templates/xlsx/`. One file, and it then
   appears in her session and the modal at once because both are served.
3. It is not a thing, and I misread it. Say so and it goes.

**Nothing in the sheet identifies a driver that I can find**, so I am not
guessing at which. What makes a row a driver?

### "Multifile or multitab"

**Multi tab is not a toggle today, it is what a template IS.**
`monthly-sheet` writes a tab per group; the payout templates write one
sheet. Only `multiFile` is a query option, and it already declines to zip a
single group.

So the honest choice:

- **As it stands:** the panel offers one file or one per group, and tabs are
  whatever the chosen template does. Zero work, slightly less control.
- **If you want the toggle:** the payout builders learn to write a tab per
  group, which is real work in `buildPayoutSheet` and changes documents that
  go out. Worth doing only if you actually want a bank run split by tab.

**Say which, and I will write it in.** I would not build it on a guess.

## Not a template

**There is no driver sheet.** The eight are master-sheet, breakdown,
monthly-sheet, division-sheet, expensing, cash, bank, bank-details. Crypto
is the bank shape filtered to the method, per the card work. If a driver
document is wanted it is a new template in `v1/templates/xlsx/`, which is
its own decision, not something the session can fake.

## HER UI IS HERS. THE BACKEND IS SHARED.

**Decided: she gets her own surface, and reuses no modal component.** The
modal is the CRM's way of exporting. Hers should look like somebody helping
you build a document, not a dialog with a voice in front of it.

**The drift objection does not apply, and it was overstated.** The export is
already an API, not a modal with data in it:

| endpoint | what it already answers |
|---|---|
| `/export/templates` | the eight, with labels |
| `/export/columns?template=` | what that document can carry, named ITS way |
| `/export/breakdown-designs` | the designs, the palette, AND the default id |
| `/export/count` | rows, people, groups, month stats, currencies, warnings |
| `/export/rows` | the actual rows plus layout, which IS the sample |
| `/export/xlsx` | the file |

The modal is one renderer of that. She is a second. **Neither owns the
truth, so there is nothing for them to disagree about.**

### The rule that keeps it that way

**HER UI MAY DRAW ANYTHING. IT MAY NOT KNOW ANYTHING.**

Every option, label, default and number is fetched. Not one list, not one
default, not one column name typed into her components. The moment her panel
hardcodes "cash, bank, expensing" it becomes the second version I was wrong
to warn about, and a template added in `v1/templates/xlsx/` stops reaching
her while still reaching the modal.

Specifically:

- The **default breakdown design** is served as `defaultId`. She does not
  pick one, for the same reason the modal does not.
- The **warnings** come from `/export/count`, computed off the same rows the
  file would contain, so a warning cannot describe a row that is not in it.
  She renders them her way; she does not decide them.
- The **sample** is `/export/rows`, real rows through the real layout.
- The **count** is never derived from a list she is holding.

A test asserting her panel contains no hardcoded template, column or design
id is worth writing, because this is the only rule holding the two apart.

## Order

1. **DONE. `export_sheet` server side**: resolves the words to a query
   string, returns the link, the counts and the warnings.
2. **DONE. Tests**, 19 of them.
3. **DONE. Her session surface**, all her own, fed entirely by the endpoints.
4. **DONE. The download and the sustained orb.**

### What landed in 3 and 4

| file | |
|---|---|
| `agentOrb/forms/ExportSession.jsx` | NEW. Her panel. Shares nothing with the modal |
| `agentOrb/forms/exportSession.test.js` | NEW, 12 tests. The panel may draw anything, it may not know anything |
| `Messages.jsx` | the panel is a turn, and a paused one is a chip |
| `AgentOverlay.jsx` | the `export-session` event, build, pause, cancel, and the orb mode |
| `ParticleOrb.jsx` | a fifth mode, `building` |
| `api.config.js` | `exports.templates()`, served since the route was written and unused until now |

**No `file` event was needed.** The panel already holds the query, so the
download is one call to the existing `exports.xlsx` with progress, and the
overlay says what is in the file afterwards. A second event carrying a URL
would have been a third way to describe the same export.

**One panel at a time.** A second "give me the bank sheet" mid session is
them changing their mind, not opening a rival panel, so the open one is
replaced in place and its ticked columns carry.

### What landed in 1 and 2

| file | |
|---|---|
| `masterSheet/exportQuery.js` | NEW. The presets, filters, month and count, lifted out of `export.js` so the route and Diane share one reader |
| `agent/exportDraft.js` | NEW. Words to a draft, a query, a link and a filename. Pure |
| `agent/tools/exportSheet.js` | NEW. The tool |
| `agent/tools/resolvePerson.js` | NEW. Lifted out of the 2,600 line tools file so a second one need not require it |
| `export.js` | the three routes now go through `rowsFor` / `previewExport` |
| `runAgent.js` | emits `export-session` |
| `prompts/masterSheet.js` | exporting is a session, not an answer |

**A real bug the tests caught: two method filters cancelled out.** "The
crypto sheet" is the bank SHAPE filtered to coin, but the bank template
derives the bank PRESET, which filters to `payment_method = 'bank'`. Bank
plus crypto matched nothing, and the panel refused a perfectly good request
with "nothing matches". An explicit method is the narrower, more deliberate
fact, so it wins and the preset steps back to one that filters nothing. The
template still decides the columns and still names the file.

---

# The conversation flow

Figures below are the live sheet's where they are known (INDIGO cash is 30,
NEXUS bank is 2, Gloria is 4 rows and GBP 2,000). The rest are illustrative.

## The states, and the only four ways between them

```
                  export intent
        none ────────────────────────→ BUILDING ──── "go" ────→ file, none
          ↑                            │      ↑
          │                    "pause" │      │ "the sheet"
          │                            ↓      │
          └────── "forget it" ────── PAUSED ──┘

   a QUESTION changes nothing. It is answered and the state stays.
```

**Four verbs, and the admin never has to learn them**, because the panel
says so itself: *ask me anything, or drop this whenever you like.*

| they say | what happens |
|---|---|
| "give me the cash sheet for INDIGO", "export", "I need a file" | **start** |
| "pause that", "hold on", "later", "not now" | **pause**, everything kept |
| "the sheet", "carry on", "back to the sheet" | **resume**, exactly as left |
| "forget it", "cancel", "never mind" | **cancel**, it goes |
| "go", "build it", "yes" | **build**, and the session ends |
| anything else | answered, panel untouched |

## Starting

### Everything named

```
you    give me the cash sheet for indigo
diane  [panel: Cash · INDIGO · August · 30 rows · 22 people]
       Cash run for INDIGO, honey. Thirty rows. Have a look before I build it.
```

She does not build on the first turn even when nothing is ambiguous. **The
panel IS the answer to "give me a sheet"**, because six defaults were chosen
for them and they have not seen one of them yet.

### Nothing named, and there is a last time

```
you    give me the sheet
diane  [panel, pre-filled]
       Same as August, sweetheart? Bank sheet, MILKMAN, no breakdowns, one
       file. Change anything you like, or say go.
```

### Nothing named, and no last time

```
you    export
diane  [panel: Master sheet · no filter · 96 rows]
       Which shape, lovely? I've put the master sheet up to start from.
       The whole thing is 96 rows, which is probably not what you're after.
```

**Never a bare "which template?" with the panel empty.** A question with
nothing on screen is the modal's job done worse.

## Steering it

```
you    drop the postcode column
diane  Postcode's out. Still thirty rows.

you    make it blue
diane  Blue, done.

you    no breakdowns
diane  Breakdowns off. That's the design picker gone with it.
```

**One line, naming only what CHANGED.** Reading the whole state back every
time is how a panel becomes unreadable out loud.

### When steering and asking look the same

```
you    just nicola and byron
diane  Narrowed to Nicola and Byron, six rows now, down from thirty.
       Say "show me Nicola" if you meant her details instead.
```

**While the panel is open a bare name NARROWS THE SHEET**, and she says so
plainly with the exit in the same breath. The alternative is asking "did you
mean the sheet or the person" every single time, which is worse.

## Asking something else

```
you    hang on, what's gloria on?
diane  Five percent add on, no fee, dear.
       [card]
       [panel still there, untouched]

you    right, where were we
diane  Cash, INDIGO, Nicola and Byron. Six rows, blue.
```

**A question never pauses it and never edits it.** It is answered and the
panel is exactly as it was, which is the whole reason it is a panel and not
a chat thread.

## Pausing and coming back

```
you    pause that, I'll come back to it
diane  Parked, honey. Everything's kept. Say "the sheet" when you want it.
       [panel collapses to a chip: Cash · INDIGO · 6 rows · paused]

  ... twenty minutes of other work ...

you    ok, the sheet
diane  Right where you left it: cash, INDIGO, Nicola and Byron, six rows, blue.
```

**A pause leaves something VISIBLE.** A session that vanishes when paused is
a session nobody comes back to, so the chip stays on screen. It is also the
cancel button: one thing to dismiss, no hunting.

## Cancelling

```
you    forget the sheet
diane  Gone, lovely. Nothing was built, so there's nothing to undo.
```

**No confirm.** The session is read only and nothing was written, so a
"are you sure" here is noise. Cancel says what did NOT happen instead, which
is the reassurance that is actually worth giving.

## Building, and the end of the session

```
you    go on then
diane  [file: INDIGO-cash-2026-08.xlsx]
       Cash run for INDIGO, six rows, two people, all in GBP. It's yours.
       [panel closes]
```

The closing line **names what is in the file**, because a download is silent
and this is the only sentence that gets spoken.

## The three stops

### Warnings, before the build and not after

```
diane  Before I build it, sweetheart: seven of those are marked bank with
       nothing to pay into. In anyway, or shall I drop them?
```

### Nothing to export

```
you    the crypto sheet for nexus
diane  Nothing in NEXUS is paid in coin, honey, so there's no file to make.
       Want the bank one instead?
```

**A stop with the reason and a way forward**, never an empty workbook.

### A name that could be two people

```
you    just gloria and pino
diane  Two Glorias, dear: Gloria in INDIGO, and Gloria difference in
       Workforce. Which one? I'd rather ask than hand you a sheet quietly
       missing somebody.
```

**The whole export refuses**, exactly as the combined total already does.
A file missing a person looks identical to a file that never included them.

## Still open

- **How does she know the session should start?** A tool she calls when
  export is asked for, versus a mode the overlay enters. Leaning tool, so
  the server decides and the UI renders, same as everything else.
- **Does the panel survive a page reload?** It holds no unsaved work, so
  losing it costs nothing but a re-ask. Probably not worth persisting.
- **Which contexts offer it.** Only the master sheet workspace has these
  tools today.

## Elsewhere

`diane.md` now carries a separate request: **one colour setting driving the
orb, command center, login, loading and welcome pages**, currently all
green. Related to the palette above but not part of this: that is the app's
theme, this is the workbook's.
