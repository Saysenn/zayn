# The master sheet — what the bot needs

For whoever maintains the payroll workbook.

**One row is one assignment, not one person.** The same person appears on as many rows as
they hold assignments, across as many groups. That is expected.

Today: 115 assignments, 88 people, 1 tab.

---

## What to change

### Stops the bot answering

| # | Change                             | Why                                                                                                                         | Today     |
| - | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1 | Add **`Employee ID`** to every row | Without it people are identified by name. Two people sharing one become a single person who can read both their pay packets | no column |
| 2 | Fill **`Phone`**                   | No phone, no bot. That person cannot be recognised at all                                                                   | 12 of 115 |
| 3 | Fill **`End date`**                | "When does this end" is unanswerable, and nobody can be marked finished                                                     | 0 of 115  |

### Decisions for you

| # | Question                                                                                                                                                                                                                         |
| - | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4 | Does **`Status`** ever mean *do not contact*? `End date` decides who is finished and `Status` is ignored, so use it however you like. But if it ever means suspended or left, tell us, or the monthly check keeps messaging them |
| 5 | **Row 46** — payable 250 against a monthly of 500 at 31 of 31 days. We kept the 250. Which is right?                                                                                                                             |

### Rules for the file

| #  | Rule                                                             | Why                                                                                                                                                                    |
| -- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6  | Never rename a column heading                                   | Silent failure. Rename `Payable days this month` and everybody keeps their full monthly rate, with no error anywhere                                                 |
| 7  | Leave **two blank columns** between side-by-side tables         | One blank is a spacer inside a single table. See Layout                                                                                                               |
| 8  | No two people sharing a name until every row has an ID          | See 1                                                                                                                                                                 |
| 9  | Consider adding a **month** column                               | The sheet is one snapshot. Past months are gone permanently                                                                                                           |
| 10 | Keep company name spelling and casing consistent across updates | "Acme Ltd" and "acme ltd" are read as two different companies — a casing change looks like a rename and creates a duplicate instead of updating the one that exists |

---

## The three columns to sort out

Everything else in the sheet is already read correctly and needs nothing.

### 1. `Employee ID` — add it

Not in the sheet today. It is the identity, and the most important field on the row.

- Any format: `EMP-001`, `1042`, whatever payroll numbers you already use
- **Unique per person, never reused**, even after somebody leaves
- **The same ID on every row that person appears on**, across every company and every
  group. That is how MILKMAN Nathan and INDIGO Nathan are known to be one human
- Case and punctuation are ignored: `EMP 001`, `emp-001` and `EMP001` all read the same

Two different people sharing a name is fine once they have different IDs. Without it they
become one person who can read both their pay packets.

### 2. `Phone` — fill it in

12 of 115 rows have one. The other 103 people cannot use the bot at all.

- **Country code and a `+`**: `+447353839670`, `+971501234567`, `+5351234567`
- Spaces, brackets and dashes are fine, they get stripped. `00` instead of `+` is fine too
- **A foreign number without the `+` is rejected.** `971501234567` would otherwise be read
  as the UK number `+44971501234567`, belonging to a stranger — and the monthly check sends
  to this column
- UK numbers written locally still work: `07353839670`

A blank is safe. That person simply cannot be recognised. A wrong one is not safe.

### 3. `End date` — fill it in

0 of 115 rows have one. Until it is filled, "when does this end", "how long have I got
left" and "is this my last month" cannot be answered, and nobody can ever be marked as
finished.

If something genuinely has no end, leave it blank on purpose — the bot says so rather than
guessing.

---

Column order does not matter, and extra columns are ignored, so your own working columns
are safe to keep.

---

## Layout

**Put tables wherever you like.** Any row, any column, as many per sheet as you want.

A block is read as a table when its heading row has **3 or more recognised column names
plus a name or role column**. Nothing else about where it sits matters.

| Layout                                            | Read?                                |
| ------------------------------------------------- | ------------------------------------ |
| Table starting on row 1, or row 200               | ✅                                    |
| Several tables stacked down one sheet             | ✅                                    |
| Two tables side by side                           | ✅ **two blank columns between them** |
| Columns in any order, a different order per table | ✅                                    |
| A title or blank rows above a table               | ✅                                    |
| Extra columns you use for your own working        | ✅ ignored                            |
| One blank column in the middle of a table         | ✅ read as part of that table         |
| Blank rows, spacer rows, subtotal lines           | ✅ skipped                            |
| A heading row repeated halfway down               | ✅ skipped                            |
| Hidden tabs                                       | ✅ skipped                            |
| Several tabs                                      | ✅ the tab name becomes the group     |

### The two-blank-column rule

This is the only layout rule that needs care.

**One** blank column is treated as a spacer **inside** a table — the master sheet already
has one, between `Location:` and the working columns, and splitting there would cut the
table in half.

**Two or more** blank columns mean "a different table starts here".

```
  A .. Q          R  S    T .. AC
  [ table one ]   .  .    [ table two ]
                  ^^^^
              two blank columns
```

So if you put two tables beside each other and leave only one column between them, they
are read as one wide table and the second one's headings are ignored.

### What is NOT read

- A table whose headings we do not recognise. `Emp | Position | Firm | Amt` is invisible,
  not because of where it is but because none of those words are in the column list.
  Tell us the headings and it is a one line change
- **Merged heading cells.** Excel stores the text in the first cell and leaves the rest
  empty, so a heading merged across three columns loses two of them
- A table turned on its side, with fields down the left and people across the top

### If a sheet has no table at all

The sync says so rather than quietly loading nothing:

```
no table found on this sheet — a header row needs at least 3 recognised
columns and a name column
```

---

## After each update

Check the sync log:

```
synced 115 assignments for 88 people from "excel"
  0 rejected
  1 where payable disagrees with the monthly rate
```

- **`rejected` above 0** — those rows are in nobody's total
- **`mismatched` above 0** — the sheet contradicts itself on a figure
- **`assignments` below the row count** — rows are being dropped, usually a renamed column
  or a table whose headings we do not recognise
