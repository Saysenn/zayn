-- ***************************************************
-- * The dead list, indexed
-- ***************************************************
--
-- A person is dead when every deal they hold is stopped. Worked out live
-- (repos/deadPeople.repo.js), so the two questions it asks have to be cheap:
--
--   does this person still hold a LIVE deal?   the anti join, per person
--   which people hold STOPPED deals?           the group it starts from
--
-- Both partial, on person_id, so each reads only the half of the table it
-- is about and never touches a row's other columns.

CREATE INDEX IF NOT EXISTS tb_mastersheet_live_person_idx
  ON tb_mastersheet (person_id)
  WHERE stopped_on IS NULL AND person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tb_mastersheet_stopped_person_idx
  ON tb_mastersheet (person_id)
  WHERE stopped_on IS NOT NULL AND person_id IS NOT NULL;
