-- The other half of #11's remaining direction: an edit on the Master
-- Sheet page (by hand or via Diane) now mirrors onto the matching
-- `assignments` row too — but assignments.upsert() (whatbot's 15-min
-- sync) unconditionally overwrites every field on every run, same as
-- companies.repo.js's touch(). Without this, a mirrored edit would look
-- like it worked, then silently revert within 15 minutes.
--
-- Array of column names, not a single boolean — different fields can be
-- overridden independently (a manually-corrected phone number shouldn't
-- block the payable amount from still tracking the sheet, for instance).
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS manually_overridden_fields text[] NOT NULL DEFAULT '{}';
