-- The actual subject: opens, closes, changes hands. See
-- whatbot/docs/crm-dashboard-plan.md for why this exists separately from
-- `assignments` (which just mirrors the sheet).
CREATE TABLE IF NOT EXISTS companies (
  id serial PRIMARY KEY,
  name text NOT NULL,
  group_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'newly_opened', 'closing', 'closed')),
  opened_on date,
  closing_on date,
  owner_name text,
  notes text,
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (name, group_name)
);
