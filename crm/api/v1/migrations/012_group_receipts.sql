-- "Money received in" — the group paying the collected-total figure into
-- the business, the reverse direction of the existing cash/bank/expensing
-- payroll (which pays individuals out). Group-level, not per-person or
-- per-company — a company doesn't pay anyone, it's just the reason a
-- handler is owed money (root CLAUDE.md's payment-flow note).
--
-- Per (group, period, currency): a group can legitimately pay in more than
-- one currency for one period, same reasoning as the calculator's own
-- Totals tab never blending currencies together.
CREATE TABLE IF NOT EXISTS group_receipts (
  id serial PRIMARY KEY,
  group_name text NOT NULL,
  period text NOT NULL, -- "2026-08", same convention as payment_status.period
  currency text NOT NULL,
  amount numeric,
  received_at timestamptz,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_name, period, currency)
);
