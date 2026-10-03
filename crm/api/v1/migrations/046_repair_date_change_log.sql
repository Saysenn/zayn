-- ===============================
-- * Undo could not put a date back.
-- ===============================
-- `tb_mastersheet_changes.old_value` is text and UNDO WRITES IT STRAIGHT
-- BACK into the column it came from. The hand-edit path stored a date with
-- a bare String(), and `pg` hands a `date` column over as a JS Date, so the
-- log held:
--
--   "Thu Aug 06 2026 00:00:00 GMT-0700 (Pacific Daylight Time)"
--
-- Postgres refused that on the way back in: `time zone "gmt-0700" not
-- recognized`. Every undo of a date failed, and the History panel read like
-- a stack trace. The writer is fixed; this repairs what it already wrote.
--
-- ONLY ROWS THAT MATCH THE JS SHAPE. Anchored on "Ddd Mmm DD YYYY" followed
-- by a time and a GMT offset, so a real value that merely contains a month
-- name is left alone. Anything unparseable is left alone too.
--
-- THE DATE PART IS THE RIGHT ONE. `pg` returns a `date` at LOCAL midnight,
-- so the day in the string is the day in the column; there is no offset to
-- undo here.
UPDATE tb_mastersheet_changes
   SET old_value = to_char(
         to_date(substring(old_value from '^\w{3} (\w{3} \d{2} \d{4})'), 'Mon DD YYYY'),
         'YYYY-MM-DD')
 WHERE old_value ~ '^\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}';

UPDATE tb_mastersheet_changes
   SET new_value = to_char(
         to_date(substring(new_value from '^\w{3} (\w{3} \d{2} \d{4})'), 'Mon DD YYYY'),
         'YYYY-MM-DD')
 WHERE new_value ~ '^\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}';
