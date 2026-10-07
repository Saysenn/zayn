-- EXPENSES THROUGH WHATBOT, his call 2026-10-07 (docs/whatbot-crm-expenses.md).
--
-- Each group has its own WhatBot number. An admin registered on that number
-- sends expenses to it as text, photos or files; the CRM reads them, talks
-- to the admin before saving, and saves to tb_expenses. Nobody else can.

-- WHO MAY SEND EXPENSES, AND ON WHICH GROUP'S NUMBER. One row per admin per
-- group: the group comes from the bot's number, so an admin registered on
-- MANBAT cannot save or see INDIGO's expenses. A phone is E.164 ("+44...").
CREATE TABLE IF NOT EXISTS tb_expense_admins (
  id          serial PRIMARY KEY,
  group_name  text NOT NULL CHECK (btrim(group_name) <> ''),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  phone       text NOT NULL CHECK (phone ~ '^\+[0-9]{7,15}$'),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_name, phone)
);

-- THE CONVERSATION, per admin per group: the preview waiting on a "yes" and
-- the last few turns. In the database, never in memory, so a restart does
-- not lose a half-agreed batch of receipts.
CREATE TABLE IF NOT EXISTS tb_expense_chats (
  phone       text NOT NULL,
  group_name  text NOT NULL,
  state       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, group_name)
);

-- WHAT THE BOT DID, so "undo" can put it back exactly: each entry holds the
-- rows before and after. A removed expense keeps its whole row here, which
-- is how an undo brings it back.
CREATE TABLE IF NOT EXISTS tb_expense_actions (
  id          serial PRIMARY KEY,
  phone       text NOT NULL,
  group_name  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('add', 'edit', 'remove', 'undo')),
  changes     jsonb NOT NULL,
  summary     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz
);
CREATE INDEX IF NOT EXISTS tb_expense_actions_who ON tb_expense_actions (phone, group_name, created_at DESC);
