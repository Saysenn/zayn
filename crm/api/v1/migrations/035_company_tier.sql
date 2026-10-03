-- What KIND of company this is, as the boss's own sheet calls it: his side
-- table beside each group's rows reads "Top co" / "Normal co".
--
-- NOT `status`, which this table already has and which means something
-- else entirely: active/closed, the Close button. Two facts about one
-- company both called Status is exactly the confusion that made payment
-- period read as company life, and the CRM only just finished untangling
-- that. So this is `tier`, and it is `tier` everywhere the UI says it too.
--
-- NULLable, and blank on every existing row. It has never been in the
-- master sheet, so there is nothing to backfill from and guessing a
-- default would put a value on 33 companies that nobody chose.

ALTER TABLE tb_companies ADD COLUMN IF NOT EXISTS tier text;
