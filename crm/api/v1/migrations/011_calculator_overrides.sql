-- Per-person business overrides for the payment calculator, living in the
-- CRM rather than the master sheet — per the boss's own instruction that
-- "all human input should be filtered through the CRM." Keyed by
-- (group, company, person name) since the sheet itself has no stable ID
-- for a row (same identity problem whatbot already has with its own
-- sheet-derived personId).
--
-- should_be_paid: defaults true. A business decision (a mistake, a
-- dispute) can flip it to false for one person on one company without
-- touching the master sheet or removing them from it.
--
-- paid / paid_at: the admin confirming a payment was actually sent,
-- separate from payment_status (that's the *person* confirming receipt
-- over WhatsApp). paid_at is set the moment `paid` turns true, cleared if
-- it's unticked — a real timestamp, not just a boolean.
CREATE TABLE IF NOT EXISTS calculator_overrides (
  id serial PRIMARY KEY,
  group_name text NOT NULL,
  company text NOT NULL DEFAULT '',
  person_name text NOT NULL,
  should_be_paid boolean NOT NULL DEFAULT true,
  should_be_paid_note text,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_name, company, person_name)
);
