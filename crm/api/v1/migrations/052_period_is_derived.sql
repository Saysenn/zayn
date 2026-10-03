-- ***************************************************
-- * The payment period is derived, so nothing may claim it
-- ***************************************************
--
-- `status` in `manually_overridden_fields` made paymentPeriodSql return the
-- STORED column instead of computing. `isOwedThisMonth` never saw that
-- claim, so the money never moved with it: a row read Ended beside a GREEN
-- payment start cell with its amount still in the month's total. Gloria
-- carried four deals with identical dates and read Ended on two of them.
--
-- The read side is fixed in shared/paymentPeriod.helper.js and the two
-- write paths are closed (ROW_FIELDS dropped `status`, the Person page's
-- cell is a badge). This clears the claims that were already there, which
-- would otherwise sit on rows forever with nothing able to add or remove
-- one.
--
-- IT REMOVES A CLAIM, NEVER A VALUE. `tb_mastersheet.status` is untouched:
-- it is still stored, still written at upload, still filtered on. Only the
-- assertion "a human owns this column" goes, and that assertion no longer
-- means anything.
--
-- Every other claimed column is left exactly as it is. This names `status`
-- and nothing else, so a person's typed payment start or monthly amount
-- keeps its protection against the next upload.

UPDATE tb_mastersheet
   SET manually_overridden_fields = array_remove(manually_overridden_fields, 'status')
 WHERE 'status' = ANY(manually_overridden_fields);
