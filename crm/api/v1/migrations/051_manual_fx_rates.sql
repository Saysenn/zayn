-- ===============================
-- * THE RATES WE SET OURSELVES, WHEN NOBODY IS SERVING THEM
-- ===============================
-- `fxRates.helper` fetches from FX_RATES_URL and, when that fails, falls
-- back to a hardcoded table carrying GBP, USD and AED and NOTHING ELSE.
-- That is why the sheet's EURO rows went unconverted for weeks: the
-- endpoint answered in ~2.6s against a 2.5s timeout, every call fell back,
-- and the fallback has no euro in it.
--
-- A hardcoded fallback cannot be fixed from the CRM. This table is the
-- answer to that: a rate an admin sets, sees, and can check before any
-- conversion runs.
--
-- ONE ROW PER CURRENCY, and the code IS the key. A column per currency
-- would be a migration every time a new one appears on the sheet.
--
-- USD PER UNIT, one direction for every currency. "1 GBP = 1.3517 USD" is
-- how the setting reads on screen and how it is stored, so nobody has to
-- know which way round a given currency is quoted. AED is normally quoted
-- the other way (3.6725 per dollar); it is stored inverted like the rest
-- so the column means one thing.
--
-- AED IS HERE TOO, EVEN THOUGH IT IS A PEG. Fixed at 3.6725 since 1997 and
-- hardcoded on that basis, but a peg is a decision somebody made and can
-- unmake, and the admin asked to be able to set it. The constant stays as
-- the last resort when no row exists.
--
-- IT DOES NOT REACH THE PAST. A month snapshot freezes the rates it was
-- taken with, so editing a rate moves the CURRENT month and every month
-- after it, and never a saved actual. That is what keeps a payout file
-- reproducible.
CREATE TABLE IF NOT EXISTS tb_fx_rates (
  code         text PRIMARY KEY CHECK (code = upper(code) AND char_length(code) BETWEEN 2 AND 8),
  usd_per_unit numeric(18, 8) NOT NULL CHECK (usd_per_unit > 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

COMMENT ON TABLE tb_fx_rates IS
  'Manually set FX rates, used when FX_RATES_URL serves nothing. usd_per_unit is how many USD one unit is worth.';
