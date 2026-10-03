-- A deal that pays a FULL month, whatever the preset month is.
--
-- The sheet says so in words. Six rows read "AUGUST END FULL" or
-- "OCTOBER END FULL" in the Payment start date column, and since
-- paymentStartText.js those parse into a real date (the last day of that
-- month) plus an instruction about the money: the whole monthly amount is
-- owed, not a slice. The boss backs it up by hand on every one of them, with
-- a typed 31 payable days and a payable amount equal to the monthly one.
--
-- WHY A COLUMN AND NOT THE STORED payable_days. An upload already saves the
-- day count correctly for the month it came in on: 31 against a July preset,
-- matching the sheet. But payable_days is a fact about ONE month, so
-- rollToMonth has to re-derive it for the month being generated or every
-- other row on the sheet is wrong. Re-deriving from the date alone paid Drew
-- and James King one day of August (£40.32 against £1,250) because their
-- start IS 31 August. The number cannot be carried; the RULE behind it can,
-- and this is the rule.
--
-- FALSE is the ordinary case and the safe default: every existing row keeps
-- being pro-rated exactly as it is today.
ALTER TABLE tb_mastersheet
  ADD COLUMN IF NOT EXISTS payment_start_full boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tb_mastersheet.payment_start_full IS
  'The sheet wrote FULL beside the payment start ("AUGUST END FULL"): the whole monthly amount is owed for the preset month, never a slice. Set by upload from the cell, honoured by computePayable.';
