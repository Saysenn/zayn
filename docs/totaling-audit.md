# What counts toward a total

2026-08-25. Traced through the source, not from memory. Nothing here changed
any code.

Files that decide it, and they are the only ones:

| question | file |
|---|---|
| is this row in the total | `masterSheet/buildPayoutSheet.js` `countsTowardTotal` |
| is the period ended | `shared/paymentPeriod.helper.js` `isPeriodEnded` |
| ended, for a generated month | `masterSheet/rollToMonth.js` `endedBefore` |
| is this row for this month | `shared/presetMonth.helper.js` `isForMonth` |
| the two figures | `calculator/computePayable.js` |

---

## The one rule

```js
countsTowardTotal(r) =
  !isPeriodEnded(r) && shouldBePaid(r) && (r.for_this_month ?? isForMonth(r))
```

Three gates. **All three must pass.** Then a fourth, in `totalsByCurrency`:

```js
const amount = Number(r.payable_amount);
if (!Number.isFinite(amount)) continue;   // a null amount is skipped
```

So there are **four** reasons a row on the sheet adds nothing, not three:

1. the payment period ended,
2. an admin set should be paid to no,
3. its preset says another month,
4. its payable amount is null, meaning nobody could work it out.

The fourth is silent. Nothing warns about it and nothing on the row says so.
See finding T3.

**Payable days and monthly amount gate nothing.** They are not in the rule at
all. They matter only because they feed `payable_amount`, which is the number
actually added. That collapses most of the combinations below.

---

## Table 1: preset, for an August 2026 run

Confirmed. This is `isForMonth`: null preset returns true, otherwise the
preset's `YYYY-MM` must equal the run's.

| preset | in the total | why |
|---|---|---|
| 2026-07-01 (old) | **no** | a different month |
| 2026-08-01 (current) | **yes** | this run |
| 2026-09-01 (future) | **no** | a different month |
| none / "NA" | **yes** | the standing roster, owed every month |

Cases worth adding:

| preset | in the total | why |
|---|---|---|
| 2025-08-01 (right month, wrong year) | **no** | compared as `YYYY-MM`, so 2025-08 is not 2026-08. This is the Anteep shape: theirs is 2024-09 |
| 2026-08-31 (this month, not the 1st) | **yes** | only the month is read, never the day |
| an unreadable value | **yes** | `monthOf` returns null for anything it cannot parse, and null means "always counted". A corrupt preset therefore reads as a roster row, not as an error |

That last one is finding T4.

---

## Table 2: end date, for an August 2026 run

Confirmed, with one important qualifier: **there are two different answers
depending on which export you generate.**

`endedBefore(end_on, month)` compares MONTHS, not days:
`monthOf(end_on) < month`.

| end date | in the total | why |
|---|---|---|
| 2026-07-31 (old) | **no** | 2026-07 is before 2026-08 |
| 2026-08-31 (current) | **yes** | payable for all of the month it ends in |
| 2026-09-30 (future) | **yes** | still running through August |
| none / Ongoing | **yes** | no end date means ongoing, never ended |

Cases worth adding:

| end date | in the total | why |
|---|---|---|
| 2026-08-15, run in August, **today is later than the 15th** | **it depends on the export** | see T1. The month sheet counts it in full; Cash, Bank and Expensing exclude it |
| any date, with `status` in `manually_overridden_fields` | **it depends on the export** | see T2. The month sheet ignores the override, the payout exports honour it |
| 2026-08-31, run in **September** | **no** | 2026-08 is before 2026-09 |

**Why preset and end date differ on `future`, and it is correct.** The preset
says which run a row belongs to, so a September row is not part of August's.
The end date says when the deal stops, so ending in September means it is
still running through August. The only end date that excludes a row is one
that finished before the month being generated.

---

## Table 3: payable days

From `payableDaysFor(payment_start_on, preset_on)`. **The month is the PRESET
month**, never the run month, never today.

| situation | payable days | note |
|---|---|---|
| no preset | **null** | there is no period to prorate against |
| preset unreadable | **null** | same |
| payment start blank | **full preset month** | a long standing arrangement with no recorded start |
| payment start unreadable prose | **null** | we do not know, so we do not guess |
| start on or before the 1st | **full preset month** | |
| start mid month | `days − start_day + 1` | e.g. 3 Aug in a 31 day month is 29 |
| start after the preset month ended | **0** | nothing owed yet |

**null is not 0.** Zero means "owed nothing", null means "we could not work
it out". Collapsing them would quietly pay somebody nothing.

**Does it gate the total? No.** A row with null payable days is still in the
total if the three gates pass. What excludes it is its payable amount also
being null, which is the fourth gate.

**No upper bound.** A hand typed 45 in a 31 day month is accepted and pays
45/31 of a month. See finding T5.

---

## Table 4: monthly amount

| situation | effect on the total |
|---|---|
| a real number above 0 | prorated normally |
| **0** | a real, known figure. Prorates to 0, adds 0. The sheet writes it for deals agreed but not yet paying |
| null, blank, or unreadable | payable amount becomes **null**, so the row adds nothing |

**Does it gate the total? No.** It reaches the total only through payable
amount.

The export warnings panel flags `!(Number(monthly_amount) > 0)`, so it
catches both 0 and missing. It does **not** catch a good monthly amount that
still produced a null payable amount, which is finding T3.

---

## Table 5: payable amount

This is the only figure that is actually added.

```
payable_amount = monthly_amount ÷ days_in_PRESET_month × payable_days
```

| situation | in the total | adds |
|---|---|---|
| a real number | yes, if the three gates pass | itself |
| **0** | yes, if the gates pass | 0 |
| **null** | **no**, skipped silently | nothing |
| **no preset at all** | yes | **the full monthly amount** |

**The asymmetry to know about.** With no preset, payable *days* is null but
payable *amount* is the full monthly. Both are deliberate and both match the
sheet: the twelve "NA" roster rows set payable amount equal to monthly amount
on every one. It means a real deal that loses its preset does not fail
loudly, it starts being paid in full every month forever. Finding T6.

**Rounded to the penny, once, at the end.** Un-rounded, 1100/31×13 prints as
461.2903225806452 on a payout document.

**Currency.** Totals are per currency, and a row with no currency defaults to
GBP, so a mislabelled row lands silently in the GBP total.

---

## Your six questions

Assume should be paid is yes throughout, since it is an independent gate.

### 1. Preset current or empty, end date old

**Not in the total.** The preset gate passes and the ended gate fails. One
failed gate is enough.

The row still prints on the sheet with its full figures, and its Status cell
is tinted amber. So the sheet shows a row reading £1,100 that is not in the
total beneath it. That is intended, and it is the single most likely "why
does this not add up" question.

**Caveat:** if the end date is earlier this same month and today is past it,
the two exports disagree. See T1.

### 2. Preset current or empty, end date future

**In the total.** All three gates pass. This is the ordinary healthy row.

### 3. Preset old or future, end date old

**Not in the total, for two independent reasons.** Either alone would
exclude it.

Worth knowing: the export warnings panel only reports the preset one. Pressing
**Set to August 2026** fixes the preset, rewrites the row, and the total does
not move, because the ended gate still blocks it. That reads as the button
not working. Finding T7.

### 4. Preset old or future, end date future or current

**Not in the total.** The ended gate passes, the preset gate fails. This is
the Anteep Sourcing shape and the £2,500 divergence: a live, running deal
sitting out of the run because its preset says another month.

This one **is** fixed by the Set to August button, because the preset is the
only failing gate.

### 5. Preset current or empty, payable days a full month, end date old

**Not in the total.** Payable days does not gate anything. The figures are
computed and stored and correct; they are simply not counted, because the
period ended.

This is question 1 with the most alarming presentation: a full month's money
printed on a row that contributes nothing.

### 6. Preset current or empty, payable days 0, end date old

**Not in the total, twice over.** The ended gate excludes it, and it would
have added 0 anyway.

Payable days being 0 means the payment start is after the preset month ended,
which usually means the preset is stale rather than the days being wrong.
Worth checking the preset before "fixing" the days.

---

## The full combination matrix

Reading the columns. **T means the row passes on that column**, F means it
fails, so T is always the "counts" direction:

- **preset** T = this month, or empty/NA. F = old or future.
- **end date** T = current, future, or none. F = ended before this run.
- **payable days** T = a real number above 0. F = 0 or null.
- **monthly** T = a real number above 0. F = 0 or null.
- **payable amount** T = a real number above 0. F = 0 or null.

### Part A: the gate. Only these two columns decide it

| # | preset | end date | in the total | reason |
|---|---|---|---|---|
| 1 | T | T | **yes** | the only combination that counts |
| 2 | T | F | no | period ended |
| 3 | F | T | no | another month |
| 4 | F | F | no | both |

Plus the third gate, which is independent of all five columns:

| # | should be paid | in the total |
|---|---|---|
| 5 | null (untouched) | **yes**, the default resolves to yes |
| 6 | true | **yes** |
| 7 | false | **no**, whatever the other four say |

### Part B: what a passing row actually adds

Only rows on line 1 above reach here.

| # | payable days | monthly | payable amt | adds | note |
|---|---|---|---|---|---|
| 8 | T | T | T | the amount | the ordinary row |
| 9 | T | T | F (=0) | 0 | only reachable by hand editing payable amount |
| 10 | T | T | F (null) | **nothing, silently** | only by hand. The fourth gate |
| 11 | T | F (=0) | F (=0) | 0 | agreed, not yet paying. Correct |
| 12 | T | F (null) | F (null) | **nothing, silently** | monthly missing. Warned about |
| 13 | F (=0) | T | F (=0) | 0 | start is after the preset month ended |
| 14 | F (null) | T | F (null) | **nothing, silently** | payment start is prose. Row is flagged, total is not |
| 15 | F (null) | T | T | the full monthly | **no preset**. The NA roster rows |
| 16 | F (null) | F | F (null) | nothing | nothing is known about this row |

**Lines 10, 12 and 14 are the dangerous ones.** The row passes every gate, is
printed on the sheet, and contributes nothing to the number underneath it.

**Line 15 is not a fault.** It is how the twelve roster rows are meant to
behave, and it is also what a real deal does if its preset is lost.

### Part C: combinations that cannot happen on their own

Reachable only by hand editing, because `payable_amount` is an editable
column and typing into it overrides the formula:

- payable days 0 with a payable amount above 0
- payable days above 0, monthly above 0, payable amount 0
- payable days above 0 with a null payable amount

If you see one of these in the data, somebody typed it. The override guard
(`manually_overridden_fields`) will then keep the next upload from correcting
it, which is the intended behaviour and also how a typo becomes permanent.

---

## Scenarios not in your list

### T1. A mid month end date makes the two exports disagree

**The most concrete problem here.** An end date of 2026-08-15, an August run,
today the 25th.

| export | verdict | why |
|---|---|---|
| Generate for a month | **counted in full** | `endedBefore` compares months: 2026-08 is not before 2026-08 |
| Cash / Bank / Expensing | **excluded** | falls back to `payment_period`, which the database derives as `end_on < CURRENT_DATE` |

So the same row, on the same day, is in one document's total and out of
another's. Both readings are defensible. They cannot both be right at once.

**Open question for you:** does a deal ending on 15 August get paid for
August? If yes, the payout exports are wrong. If it should be prorated to the
15th, neither is right and the end date needs to feed payable days.

### T2. A manual status override is honoured by one export and ignored by the other

`paymentPeriodSql` checks `manually_overridden_fields` first, so an admin who
sets the status by hand outranks the date. `rollToMonth` does not: it reads
`end_on` directly, and only consults the override when `end_on` is null.

| override | end date | month sheet | payout exports |
|---|---|---|---|
| active | 2026-07-31 (old) | **ended**, excluded | **active**, counted |
| ended | 2026-09-30 (future) | **active**, counted | **ended**, excluded |
| either | none | agrees | agrees |

So the override works everywhere except the one document that is actually the
month's payroll. Whenever an end date exists and the status is overridden,
the two disagree.

### T3. A null payable amount is excluded silently, and nothing warns

The fourth gate has no warning behind it. The export warnings panel checks
`monthly_amount`, so it catches a missing monthly amount. It does **not**
catch a row with a good monthly amount whose payable amount came out null,
which happens when the payment start is unreadable prose (line 14 above).

The row prints, looks complete, is not tinted, and adds nothing.

**Suggested fix, not applied:** a fifth scenario in `exportWarnings.js` on
`payable_amount == null`, worded as "N rows have no payable amount, so they
add nothing". It is the same shape as the existing monthly amount warning.

### T4. An unreadable preset reads as a roster row, not as an error

`monthOf` returns null for anything it cannot parse, and `isForMonth` treats
null as "always counted". So a corrupt preset does not exclude a row or flag
it. It promotes it to a standing monthly obligation.

**Suggested fix, not applied:** `isForMonth` cannot tell "absent" from
"unparseable" today because both arrive as null. Distinguishing them means
checking the raw column before `monthOf` collapses it.

### T5. Payable days has no upper or lower bound

`payableFromDays` does the arithmetic on whatever number is in the column.
45 days in a 31 day month pays 145% of the monthly amount. A negative number
pays a negative amount and reduces the group total.

**Suggested fix, not applied:** clamp to 0 and to the preset month's length
at the point of edit, and flag rather than silently clamp.

### T6. Losing a preset does not fail loudly, it pays in full

Covered in Table 5. A deal whose preset is cleared gets the full monthly
amount, every month, with no proration and no flag, because that is exactly
what the NA roster rows are meant to do.

**Suggested fix, not applied:** the roster rows are identifiable another way
(group ALL GROUPS, roles Admin, Sales, Holding, Accounts, Maid). If "no
preset" meant "full amount" only for those, a lost preset on any other row
could be flagged instead.

### T7. The Set to August button can fix the preset and not move the total

When a row fails both the preset gate and the ended gate (question 3), the
warning names only the preset. Pressing the fix writes the rows, the panel
redraws, the warning clears, and the total does not change.

**Suggested fix, not applied:** exclude already ended rows from the
`preset-other-month` warning, the same way `exportWarnings.js` already skips
ended rows for every other scenario. Reading the code, the `isPeriodEnded(r)`
skip at the top of the loop should already do this on exports that carry
`period_ended`, and not on those that do not, which is T1 again.

### T8. One row can be in three warnings at once

Ended, wrong preset, and should not be paid are independent. The warnings
panel groups by scenario and by group, so the same row appears under each. A
count of warned rows is therefore not a count of rows.

### T9. Currency has no gate

A row with a null currency is added to the GBP total. There is no warning for
a group whose rows are split across currencies unexpectedly, only the
breakdown's layout change.

---

## Questions for you

Ordered by what they cost.

1. **A deal ending mid month: paid for that whole month, not paid at all, or
   prorated to the end date?** T1. Today the answer differs by which export
   you press, so one of the two documents is wrong every time this happens.
2. **Should a manual status override beat the end date on the month sheet?**
   T2. It already does everywhere else.
3. **Should a row with no payable amount be warned about before generating?**
   T3.
4. **Should a lost preset be an error rather than a full payment?** T4 and
   T6.
5. **Should payable days be clamped to the preset month?** T5.

No code has been changed for any of these. They are recorded here and the
ones with a concrete fix are cross referenced into `todo.md`.
