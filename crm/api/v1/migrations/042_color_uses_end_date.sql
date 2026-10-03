-- ===============================
-- * Does the end date colour the payment start cell?
-- ===============================
-- His sheet's three rules read the payment start against the preset and
-- nothing else, so red only ever means "not started yet" and a finished
-- deal looks identical to a running one.
--
-- He asked for the provisional end date in it too (amber when the period
-- ends this month, red once it is past) and then was not sure. So it is a
-- SETTING rather than a decision baked into code: he flips it, generates,
-- and sees.
--
-- DEFAULT FALSE, which is his original three rules exactly. An export
-- nobody touches stays the document it was.
ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS color_uses_end_date boolean NOT NULL DEFAULT false;
