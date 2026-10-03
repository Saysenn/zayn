-- Take the spreadsheet's row position out of a deal's identity.
--
-- THE BUG THIS FIXES
-- sync_key is currently `group|company|role|seat|person|rowNcolN`, where
-- the last segment is literally where the row sat in the uploaded file:
--
--     indigo|workforce|admin|-|johnathon|1c0
--     indigo|gab|director|-|gab|4c0            <- row 4
--
-- Insert one line at the top of next month's sheet and every deal below it
-- takes a new identity. The upload then creates a full set of new deals,
-- orphans every existing one, and silently detaches every correction an
-- admin ever made — including, once migration 024 lands, their
-- manually_overridden_fields guard.
--
-- WHY POSITION CAN GO
-- The stated reason for including it (whatbot's own rule: "the same person
-- legitimately holds the same role on the same company twice with
-- different payable days, and collapsing those deletes someone's wages")
-- is sound in principle. Measured against the boss's actual sheet it does
-- not occur:
--     deals                                          96
--     distinct group|company|role|seat|person        96
--     collisions                                      0
-- The natural key is already unique across the whole file. Position bought
-- nothing and cost the entire edit history.
--
-- If it ever DOES occur, the row_number() below appends an explicit
-- dedupe suffix (|2, |3, ...) rather than failing the migration — so the
-- duplicate is preserved and visible, which is the behaviour that rule was
-- protecting in the first place.
--
-- Manual rows are untouched. Their keys are `manual|person|timestamp`,
-- have no positional segment, and must never collide with a synced key.

WITH ranked AS (
  SELECT
    id,
    regexp_replace(sync_key, '\|[0-9]+c[0-9]+$', '') AS base,
    row_number() OVER (
      PARTITION BY regexp_replace(sync_key, '\|[0-9]+c[0-9]+$', '')
      ORDER BY id
    ) AS rn
  FROM tb_mastersheet
  WHERE source = 'synced'
    AND sync_key ~ '\|[0-9]+c[0-9]+$'
)
UPDATE tb_mastersheet m
SET sync_key = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '|' || r.rn END
FROM ranked r
WHERE m.id = r.id;
