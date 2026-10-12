# Expenses

The Expenses page and what is still open. The WhatBot and Diane expense
brain is in `whatbot-crm-expenses.md`.

## Where it lives

| Piece          | Where                                                     |
| -------------- | --------------------------------------------------------- |
| Page           | `crm/web/src/pages/ExpensesPage.jsx`, nav `/expenses`     |
| Routes         | `crm/api/v1/expenses.js`                                  |
| Repo           | `crm/api/v1/repos/expenses.repo.js`                       |
| Import, export | `crm/api/v1/expenses/` (parse, diff, build sheet)         |
| Import modal   | `crm/web/src/components/import/ExpensesDiffModal.jsx`     |
| Tables         | `tb_expenses` (migration 055), spender link (077)         |

## Rules

- `ExpensesDiffModal` is deliberately separate from the master sheet's
  `ImportDiffModal`: append only, no per cell compare, no fills. If a third
  import appears, extract shared parts then.
- `spent_by` stays free text for display. `spent_by_person_id` is set only
  when the name matches exactly one person; `saved_by` records who saved it.

## Still open

1. **Change log, History and undo** (R4): `tb_expenses_changes` in the shape
   of `tb_mastersheet_changes`, using the existing `HistoryModal`.
2. **Burn and snapshot**: ending a period from Settings, snapshot first, burn
   only if it succeeded. Nothing built assumes it.
3. **Who fronted a cash payment**: not built. The period and amount are not
   known (`closure.md` §10). Ask before building.
4. A receipt file attached to a row.
5. An expenses figure on the dashboard.
6. `tb_expenses.archived_at` is read but nothing writes it. Decide with the
   burn.
