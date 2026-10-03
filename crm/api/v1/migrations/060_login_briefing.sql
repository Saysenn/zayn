-- ***************************************************
-- * Diane's briefing at sign-in, and the switch that stops it
-- ***************************************************
--
-- ON by default: the whole point is that nobody has to remember to look at
-- the review queue. Off is the admin deciding they would rather not be
-- spoken to, which is a preference and belongs beside every other one.
--
-- Nothing else is stored. What she says is computed at sign-in from the
-- live counts (v1/shared/briefing.helper.js), so there is no state here to
-- go stale and no "last shown" to keep in step with anything.

ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS login_briefing boolean NOT NULL DEFAULT true;
