# Backlog

Parked, and it might not happen. Intended work lives in `feature.md`.
Numbers are stable identifiers (other docs cite them): never renumber.
Delete an entry when it ships or is dropped. Full write-ups are in this
file's git history (before 2026-10-07).

6. **Roll presets to the new month automatically.** Needs his word first
   (the preset is his). Skip hand-set rows; roll only rows on last month.
7. **Release a typed cell back to the sheet's formula.** A typed value is
   protected from uploads forever, and the claim is invisible. Showing it is
   the real work.
8. **Group managers on the Cash sheet.** Needs a `tb_groups` table; groups
   are only text today.
11. **History with Recover on every row.** Parked: recovering a row whose
    person, company or sync key has moved on can create a duplicate.
12. **Rolling xlsx backup the admin can open in Excel.** Postgres backups
    exist; this is a working sheet for when the CRM is down.
13. **Diane's forecasts:** no limit on how far ahead she projects, money
    loses pence in `amountText`, a percentage rounded twice. Real forecasting
    needs more saved months first.
14. **Compact Diane's old memories:** mark superseded summaries, never delete.
    Not needed at this volume.
15. **Dashboard filters:** the page-level panel only moves some cards.
    Placement and scope are one job.
16. **Diane's draft shown as final before the guards finish.** His words:
    "I don't understand this, put it in backlog for now."
17. **Company status upload tab does two jobs:** tiers (asked for) and
    active/closed (the Close button's job).
18. **"Show fees" toggle on the export:** changes what is printed, never what
    is counted.
20. **Money received in:** a group paying its collection back. Open: per
    group or per company.
21. **12-month forward earnings per person.** Same limit as 13.
22. **"We need to export" takes two turns** before the panel opens.
24. **Pick the assistant's persona:** name, voice and colours together. Voice
    is limited by OpenAI's voices.
25. **Small, none blocking:**
    1. PDF layouts for the payout sheets.
    2. A month picker on People's payment status.
    3. The group name above the breakdown block.
    4. "Remember me", hidden (`SHOW_REMEMBER`); needs a session length.
    5. Add person / Add company wizards, hidden. Open: one door or none.
    6. Mobile layout beyond cards.
    7. Field captions on detail pages vs floating labels in modals.
    8. Remove the hidden Chat page and its socket code properly.
    9. Partial payday answers flag every deal in that group, and the admin
       marks each Paid or Unpaid (2026-10-08). Open: let the person say
       which companies were short.
    10. WhatBot recognising "my payment is wrong" outside the menu.
26. **SQLite instead of Postgres.** Would work at this size; weigh against
    `feature.md` 3.
28. **`tb_expenses.archived_at` is unused.** Decide with `feature.md` 0
    (expense retention): drop it or use it.
29. **Unwire the end date from the tint.** Plan in `unwire-end-date.md`; two
    answers needed first.
30. **Stage 4: retire Diane's old one-off patches.** Risky (rare cases the
    tests may not cover), small benefit. Safe way: log which patches are
    still used for a week or two, remove only unused ones, one at a time.

## Settled NO. Closed, not deferred

Do not list these as open again.

- **`read_dashboard`.** Cancelled: the drift it was for is fixed, and another
  tool worsens tool selection.
- **Ranking ("who earned the most").** She declines it; it is never a feature.
- **The export warnings panel stays in the Export modal only** (2026-09-08).
