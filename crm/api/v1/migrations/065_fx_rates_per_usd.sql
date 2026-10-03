-- ***************************************************
-- * THE RATE IS STORED THE WAY IT IS TYPED AND THE WAY IT IS USED
-- ***************************************************
--
-- `usd_per_unit` held the INVERSE of both. The Settings box takes what one
-- dollar buys, because that is how Xe, Google and the sheet's own "3.6725
-- per dollar" all print it, and `toUsd` divides by units per dollar. One
-- column in the middle, inverted on the way in and again on the way out.
--
-- THE ROUND TRIP DOES NOT SURVIVE IT. numeric(18, 8) keeps eight decimals,
-- and 1 / (1 / 3.75) is 3.74999995 at that precision. Typed 3.75 and saved,
-- the box read back 3.74999995; 3.67 came back 3.67000005 and the AED peg
-- 3.6725 came back 3.67249997. Reported on sight 2026-09-23: "why setting
-- aed auto convert it to that value".
--
-- ROUNDING THE DISPLAY WAS THE ALTERNATIVE AND IS NOT A FIX. Six decimals
-- straightens AED and mangles PHP; eight significant figures does the same.
-- Every rounding rule holds until the next currency.
--
-- So the column holds what is typed. No inversion survives anywhere except
-- the one GBP line that has always needed it.

-- INVERTED BEFORE THE RENAME, so a half applied migration cannot leave
-- values whose meaning no longer matches the name they are under.
UPDATE tb_fx_rates SET usd_per_unit = 1 / usd_per_unit WHERE usd_per_unit > 0;

ALTER TABLE tb_fx_rates RENAME COLUMN usd_per_unit TO per_usd;

-- A CONSTRAINT KEEPS ITS NAME THROUGH A RENAME, so the old one is still
-- called ..._usd_per_unit_check and still guards the right column. Dropped
-- by its real name and added back under the new one, or the next reader
-- looking for it by name finds nothing.
ALTER TABLE tb_fx_rates
  DROP CONSTRAINT IF EXISTS tb_fx_rates_usd_per_unit_check;

ALTER TABLE tb_fx_rates
  DROP CONSTRAINT IF EXISTS tb_fx_rates_per_usd_check;

ALTER TABLE tb_fx_rates
  ADD CONSTRAINT tb_fx_rates_per_usd_check CHECK (per_usd > 0);

COMMENT ON COLUMN tb_fx_rates.per_usd IS
  'How many of this currency one US dollar buys, exactly as a rate site prints it and exactly as toUsd divides by. Typed into Settings unchanged. 3.6725 for AED.';

COMMENT ON TABLE tb_fx_rates IS
  'Manually set FX rates, used when FX_RATES_URL serves nothing. per_usd is units per dollar. See migration 065 for why it is no longer stored inverted.';
