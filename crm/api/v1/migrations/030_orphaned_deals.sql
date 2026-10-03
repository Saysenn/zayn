-- Deleting a person or a company must not delete their deals.
--
-- A company is handled by several people and a person handles several
-- companies, so "remove Drew" and "remove Workforce" are each a request to
-- detach ONE SIDE of a set of deals, never to destroy them. Cascading the
-- delete would take out rows that are still owed money and still belong to
-- somebody else.
--
-- So the deal survives with the deleted side blanked, and says so.

-- The person's side has to be blankable, and until now it was not: both
-- columns were NOT NULL. Writing '' instead would have been worse than a
-- null, because the People page groups by person_id — every orphaned deal
-- in the table would have collapsed into a single phantom person named ''.
-- NULL means "nobody is on this deal", which is exactly the fact, and the
-- People query filters those rows out instead of inventing a person.
ALTER TABLE tb_mastersheet ALTER COLUMN person_id   DROP NOT NULL;
ALTER TABLE tb_mastersheet ALTER COLUMN person_name DROP NOT NULL;

-- Two flags, not one enum: a deal can lose BOTH sides (its person deleted
-- one week, its company the next) and still needs to say so about each.
--
-- They are also not the same fact as needs_review, which the importer sets
-- when a sheet row could not be parsed. Both raise needs_review so one
-- filter still catches everything, but these two say the row is INCOMPLETE
-- and name the missing half, where a parse flag says the row arrived
-- messy. Different problem, different fix, different wording.
--
-- company was already nullable, and a blank company legitimately means
-- "pays against the group" (the ALL GROUPS rows). So a flag is required
-- either way: a null company on its own cannot tell the two apart.
ALTER TABLE tb_mastersheet
  ADD COLUMN IF NOT EXISTS orphaned_person  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orphaned_company boolean NOT NULL DEFAULT false;

-- The Master Sheet page's "missing a person or a company" filter, and the
-- People page's "skip the deals with no person" join. Partial, because
-- orphans are a small slice of the table.
CREATE INDEX IF NOT EXISTS tb_mastersheet_orphaned_idx
  ON tb_mastersheet (id)
  WHERE orphaned_person OR orphaned_company;

CREATE INDEX IF NOT EXISTS tb_mastersheet_person_idx
  ON tb_mastersheet (person_id)
  WHERE person_id IS NOT NULL;

-- sync_key is deliberately LEFT ALONE.
--
-- It still holds the deleted person's id, which looks wrong and is not:
-- the key's job is to match this row against the same row in next month's
-- sheet, and it is already unique. Recomputing it on a blanked row would
-- collide the moment two deals on one company lost their handlers, and it
-- would break the one useful behaviour here — if the next uploaded sheet
-- still lists that person on that company, the upsert matches this row and
-- fills it back in on its own.
