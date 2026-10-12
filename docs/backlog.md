# Backlog

Parked; may not happen. Planned work is in `feature.md`. Numbers are stable
(other docs cite them): never renumber. Delete an entry when it ships or is
dropped.

6. Roll presets to the new month automatically. Needs his word first; skip
   hand-set rows.
7. Release a typed cell back to the sheet's formula. The claim is invisible
   today; showing it is the real work.
8. Group managers on the Cash sheet. Needs a `tb_groups` table.
11. History with Recover on every row. Risk: duplicates when the person,
    company or sync key has moved on.
12. Rolling xlsx backup the admin can open in Excel when the CRM is down.
13. Diane's forecasts: no horizon limit, pence lost in `amountText`, a
    percentage rounded twice. Needs more saved months first.
14. Compact Diane's old memories: mark superseded, never delete.
15. Dashboard filters: the page panel moves only some cards.
16. Diane's draft shows as final before the guards finish (fix is in
    `agentOrb/`).
17. Company status upload tab does two jobs: tiers and active/closed.
18. "Show fees" toggle on the export: changes what is printed, not counted.
20. Money received in: a group paying its collection back. Per group or per
    company?
21. 12-month forward earnings per person. Same limit as 13.
22. "We need to export" takes two turns before the panel opens.
24. Pick the assistant's persona: name, voice and colours together.
25. Small, none blocking:
    1. PDF layouts for the payout sheets.
    2. A month picker on People's payment status.
    3. The group name above the breakdown block.
    4. "Remember me", hidden (`SHOW_REMEMBER`); needs a session length.
    5. Add person / Add company wizards, hidden. One door or none?
    6. Mobile layout beyond cards.
    7. Field captions on detail pages vs floating labels in modals.
    8. Remove the hidden Chat page and its socket code.
    9. Partial payday answers: let the person say which companies were short.
    10. WhatBot recognising "my payment is wrong" outside the menu.
26. SQLite instead of Postgres; weigh against `feature.md` 3.
28. `tb_expenses.archived_at` is read but never set. Decide with
    `feature.md` 0: use it or drop it.
29. Unwire the end date from the tint. Two answers needed first.
30. Retire Diane's old one-off patches: log which are used for a week or
    two, remove unused ones one at a time.

## Settled no

Do not reopen.

- `read_dashboard` tool: the drift it was for is fixed.
- Ranking ("who earned the most"): she declines it.
- The export warnings panel stays in the Export modal only.
