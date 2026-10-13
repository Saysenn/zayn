-- ***************************************************
-- * THE RATE IS TYPED THE WAY THE BOSS READS IT: 1 GBP = 1.36 USD
-- ***************************************************
--
-- His call 2026-10-13. He reads xe.com, "1 GBP = 1.36 USD", and typed 1.36
-- into a box that meant "1 USD = 1.36 GBP" (migration 065). Every pound
-- total would have come out a fifth too low.
--
-- THE TYPED NUMBER IS KEPT EXACTLY, in its own unscaled column, so 1.36
-- comes back 1.36: the round trip 065 warned about cannot happen to it.
-- `per_usd` STAYS, worked out from it on save, because twenty readers
-- (toUsd, every export, the dashboard, month snapshots, Diane) divide by
-- it and none of them changes. 8 decimals of units per dollar is under a
-- millionth of a cent per dollar off.
ALTER TABLE tb_fx_rates ADD COLUMN IF NOT EXISTS usd_per_unit numeric CHECK (usd_per_unit > 0);

-- The rates already saved were typed the other way: their mirror, to six
-- decimals, until somebody saves them again from xe.com.
UPDATE tb_fx_rates SET usd_per_unit = round(1 / per_usd, 6) WHERE usd_per_unit IS NULL AND per_usd > 0;

COMMENT ON COLUMN tb_fx_rates.usd_per_unit IS
  'What one of this currency is worth in US dollars, exactly as typed in Settings and as xe.com prints it: 1.36 for GBP. per_usd is worked out from it.';

-- ***************************************************
-- * TODAY'S RATES, PULLED ONCE A DAY (Open Exchange Rates)
-- ***************************************************
--
-- His call 2026-10-13: a currency nobody set by hand still converts, at a
-- real rate fetched once a day with OPENEXCHANGERATES_APP_ID (open.er-api
-- when that is unset or down). A SEPARATE TABLE, so the pull can never
-- overwrite a rate set by hand: tb_fx_rates is only ever written from
-- Settings. A hand set rate always wins over this one.
CREATE TABLE IF NOT EXISTS tb_fx_rates_daily (
  code        text PRIMARY KEY,
  per_usd     numeric NOT NULL CHECK (per_usd > 0),
  source      text NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  -- when the source says the rate is from, if it says
  as_of       timestamptz
);
