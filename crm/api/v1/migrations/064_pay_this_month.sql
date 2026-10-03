-- ***************************************************
-- * PAY THIS DEAL THIS MONTH, WHATEVER THE START SAYS
-- ***************************************************
--
-- His call 2026-09-23. A deal whose payment start lands after the month is
-- owed nothing by the formula, and sometimes it is paid anyway: Mayah's
-- start is 11 Oct against a September preset, and September pays her.
--
-- THE MIRROR OF `stopped_on`. That column is somebody saying this deal is
-- OVER, and it beats the derived end. Nothing said the opposite, so the
-- only ways to express it were faking the payment start or overriding the
-- two figures, and both leave somebody remembering to change it back.
--
-- NOT `manually_overridden_fields`. That list means one thing, "do not let
-- an upload overwrite this cell", and an upload, the appointment cascade
-- and Diane can all add to it without anybody deciding anything. Nothing
-- that can happen by accident may move a total. It also cannot be cleared:
-- there is no array_remove anywhere in the repo.
--
-- RENAMED BY 065 to `special_case_deal`, his call the same day. This file
-- is left exactly as it was applied: a migration already run is a record
-- of what happened, not a document to keep current, and editing one the
-- runner has ticked off changes nothing in any database.

ALTER TABLE tb_mastersheet
  -- ===============================
  -- * PER MONTH BY CONSTRUCTION, WITH NO MONTH STORED
  -- ===============================
  -- It means "the month this row's PRESET is for", so rolling the preset
  -- rolls the decision with it and nothing expires. A date here would be a
  -- second answer to a question preset_on already answers.
  ADD COLUMN IF NOT EXISTS pay_this_month boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tb_mastersheet.pay_this_month IS
  'Pay this deal for its preset month although the payment start says nothing is owed. Forces the full month. Read by shared/owedThisMonth.helper.js, so the total, the cell colour and the badge all follow it together.';
