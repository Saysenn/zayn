-- One row per company. Replaces the `companies` table dropped in 022,
-- which was whatbot's sync target and tracked a different thing entirely
-- (open/close lifecycle, owner name, last seen).
--
-- NO group_name COLUMN. A company can span groups: `Workforce` appears
-- under INDIGO, MILKMAN, MANBAT and ALL BOOKS across 21 deals and 18
-- people, and the user confirmed that is ONE company, not four. The group
-- belongs to the deal, not to the company. Every other company in the real
-- sheet sits in exactly one group, so this decision only actually affects
-- Workforce — but getting it wrong would have baked a false key in.
--
-- NO monthly_amount COLUMN. The user asked for one, and the data says no:
-- of 28 companies with more than one handler, 20 pay their handlers
-- DIFFERENT amounts.
--     Souracore          Director £1,800   Mid 1 £700
--     Relia PA           Director £1,000   Mid 1 £750  Mid 2 £125  Mid 3 £125
--     Red Horizon        Director £1,200   Mid   £1,300   (the Mid earns more)
-- There is no per-company rate to store. A company's monthly total is the
-- SUM of its deals, calculated on read, never stored — store it and it is
-- wrong the first time a deal is edited.
--
-- NO handlers COLUMN either, for the same reason: a handler IS a deal
-- (person + company + role + amount). Storing the list here would put the
-- same fact in two places and guarantee drift.
--
-- Case-insensitive unique on name: the real sheet contains both
-- "Relia PA" and "Relia Pa", which are one company typed twice. A plain
-- UNIQUE(name) would happily keep both.

CREATE TABLE IF NOT EXISTS tb_companies (
  company_id serial PRIMARY KEY,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  notes      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tb_companies_name_key ON tb_companies (lower(name));

CREATE INDEX IF NOT EXISTS tb_companies_name_trgm_idx
  ON tb_companies USING gin (name gin_trgm_ops);

-- Backfill, collapsing whitespace and case drift. The sheet has trailing
-- spaces ("Reliapay back runner ") and mixed case, and those are the same
-- company as their clean spelling — not a new one.
INSERT INTO tb_companies (name)
SELECT DISTINCT ON (lower(regexp_replace(btrim(company), '\s+', ' ', 'g')))
       regexp_replace(btrim(company), '\s+', ' ', 'g')
FROM tb_mastersheet
WHERE company IS NOT NULL AND btrim(company) <> ''
ORDER BY lower(regexp_replace(btrim(company), '\s+', ' ', 'g')), id
ON CONFLICT DO NOTHING;
