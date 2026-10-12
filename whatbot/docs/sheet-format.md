# Sheet format

What `sheet/parseSheet.js` expects from a payroll workbook. The worker itself pulls the
roster from the CRM; this applies to the `excel` / `sheets` sources used by the offline tools.

**One row is one assignment, not one person.** A person appears on as many rows as they hold.

## Key columns

- **`Employee ID`** — unique per person, never reused, the same on every row they hold.
  Case and punctuation ignored. Without it people are matched by name, so two people
  sharing a name become one.
- **`Phone`** — country code with `+` (`+447353839670`). Spaces, brackets, dashes, `00` and
  UK local `07…` are fine. A foreign number **without** `+` is rejected. Blank = cannot use
  the bot.
- **`End date`** — needed for "when does this end". Blank = the bot says none is recorded.

`Status` is ignored; `End date` decides who is finished.

## Rules

1. Never rename a heading — it fails silently (e.g. renamed `Payable days this month` =
   everyone keeps the full monthly rate).
2. Keep company spelling and casing consistent — "Acme Ltd" and "acme ltd" are two companies.
3. Column order does not matter; extra columns are ignored.

## Layout

A block is a table when its heading row has **3+ recognised column names plus a name or
role column**. Anywhere on the sheet, any number of tables, any column order.

- Side-by-side tables need **two** blank columns between them. One blank column is read as
  a spacer inside a table.
- Skipped: blank / spacer / subtotal rows, repeated heading rows, hidden tabs, tabs in
  `SHEET_SKIP_TABS`.
- Several tabs: the tab name becomes the group.
- Not read: unrecognised headings, merged heading cells, tables turned on their side.

## After each sync

```
synced 115 assignments for 88 people from "excel"
  0 rejected
  1 where payable disagrees with the monthly rate
```

- `rejected` > 0 — those rows are in nobody's total
- mismatched > 0 — the sheet contradicts itself on a figure
- assignments below the row count — rows dropped, usually a renamed heading
