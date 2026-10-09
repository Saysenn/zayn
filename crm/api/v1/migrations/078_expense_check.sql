-- THE EXPENSES CHECK (his calls 2026-10-08).
--
-- Expenses are refunded on their own, apart from pay: a payday "yes" says
-- nothing about them. So each expense now carries whether it has been
-- refunded, and a check of its own asks each person on payday, right after
-- they answer their payday check:
--
--   unsettled   not refunded yet (every expense starts here)
--   settled     refunded: their "yes" to the check that listed it, or the
--               CRM admin by hand. Locked: WhatBot and Diane can't change it.
--   review      for the CRM admin to look at: a "no", a "partial", a
--               "sorry, that was a mistake", or the admin marked it.
--
-- Late / unpaid / overdue are worked out, never stored: an unsettled one
-- from an earlier month is LATE when no check has listed it yet, UNPAID
-- when one did and it is still not refunded, and OVERDUE once 2 paydays
-- have gone by (dated before the start of last month).

ALTER TABLE tb_expenses
  ADD COLUMN IF NOT EXISTS settle_status text NOT NULL DEFAULT 'unsettled'
    CHECK (settle_status IN ('unsettled', 'settled', 'review')),
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by text,
  -- the last Expenses check that listed it (tb_expense_checks.id)
  ADD COLUMN IF NOT EXISTS settle_check_id integer;

CREATE INDEX IF NOT EXISTS tb_expenses_settle_idx ON tb_expenses (settle_status, spent_on);

-- ONE CHECK PER PERSON PER GROUP PER PAYDAY: the question, what it listed,
-- and their answer. UNIQUE so a resent message never asks twice.
CREATE TABLE IF NOT EXISTS tb_expense_checks (
  id          serial PRIMARY KEY,
  period      text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  group_name  text NOT NULL,
  person_id   text NOT NULL,
  phone       text,
  name        text,
  expense_ids integer[] NOT NULL,
  total_aed   numeric(14, 2),
  status      text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'settled', 'review')),
  answer      text,
  note        text,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  replied_at  timestamptz,
  UNIQUE (period, group_name, person_id)
);

-- EVERY SETTLE AND UNSETTLE, who and why (his call 2026-10-08)
CREATE TABLE IF NOT EXISTS tb_expense_settle_log (
  id          serial PRIMARY KEY,
  expense_id  integer NOT NULL,
  from_status text NOT NULL,
  to_status   text NOT NULL,
  by_who      text,
  via         text NOT NULL CHECK (via IN ('check', 'crm', 'diane', 'whatbot')),
  check_id    integer,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_expense_settle_log_expense ON tb_expense_settle_log (expense_id, created_at DESC);

-- HIS SWITCH: off until he turns it on (Settings → Whatbot)
ALTER TABLE tb_settings ADD COLUMN IF NOT EXISTS expense_check_enabled boolean NOT NULL DEFAULT false;

-- THE FLAGGED PAGE'S NEW CATEGORY: an expense refund to look at. The CHECK
-- from 005 is unnamed, so every CHECK on the column is dropped by name
-- before the new one goes on.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'tb_concerns'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE tb_concerns DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE tb_concerns ADD CONSTRAINT tb_concerns_category_check
  CHECK (category IN ('dispute', 'distress', 'legal', 'wrong-recipient', 'wants-human', 'anger', 'data-request', 'expense-refund'));
