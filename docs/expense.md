# Expenses

**What is NOT built yet.** `feature.md` item 0 points here.

**R1, R2 and R3 shipped 2026-09-14**, minus row-select bulk acts. Their
sections were deleted from this file, which is what this file is for.

**What the page IS lives in `state.md`** under "Expenses": the table, the
one month at a time rule, the per row rate, the contract, the filter and
search split, the import, the export modal, and why `spent_by` is free text.
Read that first.

Two things left, both open in `todo.md` section 5.

---

## Still to build

### Bulk acts over SELECTED ROWS

The only part of R2 left. Row checkboxes, a select all with an INDETERMINATE
third state (a DOM property, so it needs a ref), and `POST
/expenses/bulk-update` and `bulk-delete` sharing one id validator the way the
master sheet's two do. Both optimistic, through `useOptimisticUpdate`.

**Bulk set the rate is the one that earns its place.** Expenses read no
global rate, so a month of one currency entered before the rate was known is
the case that hurts, and fixing it row by row is the reason somebody would
ask for a spreadsheet instead.

**Bulk ADDITION already shipped** two other ways: "Save and add another" in
the form, and the import.

### R4. Change log, History and undo

`tb_expenses_changes`, the same shape as `tb_mastersheet_changes`, and the
existing `HistoryModal`. Nothing here is novel. It is last because it also
answers open question 3 below, and neither is urgent.

---

## Decisions worth keeping, made while building

**The diff modal did NOT extract shared primitives, deliberately.**
`ImportDiffModal.jsx` is 1370 lines and deal specific at module level.
Generalising a working component that decides money was the wrong risk to
take alongside everything else, so `ExpensesDiffModal` is its own smaller
file: append only, no per cell EXISTING versus INCOMING, no fills, no
override guard.

**If a third import ever appears**, extract `SelectAll`, `RowCard`, `Side`
and `CellRow` then, with two real callers to shape them. The two export
modals DID share theirs (`ExportControls.jsx`), because there the same
decision was being drawn two ways.

---

## Not in scope

**Burn and snapshot.** A Settings section that ends a period: snapshot
first, burn only if it succeeded. **Parked in `feature.md` item 0** with the
table shape and the two answers it needs, at his call 2026-09-14. Nothing
built assumes it exists.

**A ledger of who FRONTED a cash payment.** `closure.md` §10 hands it here.

**The period and the figure are NOT known.** That section used to say "the
first 90 days" and "roughly £6,000 per company"; neither is in any document
he gave us, and §10 now says so. What he actually wrote is that payment
"usually at the start its cash then one day it moves to bank when there is a
sufficient flow, then after it will move to cash again at the end", with no
duration and no amount. **Ask him before building to it.**

What is real either way: `payment_method` records that a deal is cash, and
nothing records who put the money in or whether they got it back.

When it lands, add a NULLABLE `spent_by_person_id` BESIDE the text, never
replacing it. Text stays the display, the id becomes the join.

## Open, none of it blocking

1. A receipt file attached to a row.
2. Whether the dashboard grows an expenses figure. Standalone until it does.
3. **WHO CHANGED IT, as against who spent it.** `updated_at` says when a row
   last moved and nothing says by whom. One shared admin login makes that
   less useful than it sounds, so it is not in the table. R4 would carry it.
4. **`tb_expenses.archived_at` is a column nothing writes.** `backlog.md`
   item 28: decide it with the burn, not before.
5. **Nothing here has run against Postgres.** Every test is deliberately
   database-free, which is the house rule, so `createMany`'s transaction,
   `options()`'s DISTINCT arrays and the month bounds against a `date`
   column are all unproven until somebody adds a row.
6. **Diane's entry is written** in `docs/diane.md` under OPEN: read and total
   per group and per month, never add one to a payout figure, never convert
   one herself. It is a PROPOSAL. She gets no tool until the user says so.
