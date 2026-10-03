-- ***************************************************
-- * Money going out, beside the money coming in
-- ***************************************************
--
-- A STANDALONE LEDGER. It hangs off nothing and changes no payout figure,
-- which is what keeps it out of shared/owedThisMonth.helper.js and out of
-- every export. See docs/expense.md.

CREATE TABLE IF NOT EXISTS tb_expenses (
  id             serial PRIMARY KEY,
  spent_on       date          NOT NULL,
  description    text          NOT NULL,
  payee          text,
  -- Uppercased on the way in, the same rule tb_fx_rates.code uses, so
  -- `Php` and `PHP` cannot become two currencies.
  currency       text          NOT NULL
                 CHECK (currency = upper(currency)
                        AND char_length(currency) BETWEEN 2 AND 8),
  raw_amount     numeric(14,2) NOT NULL CHECK (raw_amount >= 0),

  -- ===============================
  -- * EVERY ROW COMPUTES FROM ITS OWN RATE
  -- ===============================
  --
  -- AED per ONE UNIT of `currency`, captured when the expense was entered.
  -- Nullable: a missing rate is not a rate of 1.
  --
  -- `aed_amount` is GENERATED, so it can only ever see these two columns on
  -- this row. It cannot reach tb_fx_rates, today's rate, or another row.
  -- Editing a rate in Settings therefore moves zero expenses, by the shape
  -- of the column rather than by a rule somebody has to remember.
  --
  -- A hand written third number is free to disagree with the two it comes
  -- from, which is the fault payment_period was made derived to stop.
  exchange_rate  numeric(18,8) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  aed_amount     numeric(18,2)
                 GENERATED ALWAYS AS (round(raw_amount * exchange_rate, 2)) STORED,

  group_name     text,
  -- FREE TEXT, never a person_id: admins front expenses too and they live
  -- in tb_accounts, not tb_people.
  spent_by       text,

  -- ===============================
  -- * sync_key IS A MATCH CANDIDATE, NEVER A UNIQUE KEY
  -- ===============================
  --
  -- Two identical taxi fares on the same day are TWO expenses, not a
  -- duplicate. This exists so the import can find POSSIBLE matches with an
  -- indexed lookup instead of a table scan. It never decides: matches land
  -- on a tab and a human answers. Do not add a unique index to it.
  sync_key       text,

  -- NULL is live. Archive is the reversible one, beside Delete.
  archived_at    timestamptz,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  -- Written by the server on every write, never accepted from the client.
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE tb_expenses IS
  'Standalone ledger of money going out. Changes no payout figure. See docs/expense.md.';

-- The live list is every default view, so the partial index is the one that
-- earns its keep.
CREATE INDEX IF NOT EXISTS tb_expenses_live_idx
  ON tb_expenses (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tb_expenses_spent_on_idx   ON tb_expenses (spent_on DESC);
CREATE INDEX IF NOT EXISTS tb_expenses_aed_amount_idx ON tb_expenses (aed_amount);
CREATE INDEX IF NOT EXISTS tb_expenses_group_idx      ON tb_expenses (group_name);
CREATE INDEX IF NOT EXISTS tb_expenses_sync_key_idx   ON tb_expenses (sync_key);
-- Feeds the rate suggestion: the most recently entered expense per currency.
CREATE INDEX IF NOT EXISTS tb_expenses_rate_hint_idx  ON tb_expenses (currency, created_at DESC);

-- pg_trgm is installed by migration 014. All three search fields.
CREATE INDEX IF NOT EXISTS tb_expenses_description_trgm
  ON tb_expenses USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tb_expenses_payee_trgm
  ON tb_expenses USING gin (payee gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tb_expenses_spent_by_trgm
  ON tb_expenses USING gin (spent_by gin_trgm_ops);
