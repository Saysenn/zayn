-- Archiving is gone. Deletion already covered it, and two ways to make a
-- person disappear meant two states to reason about on every listing.
--
-- Nothing is lost by dropping the column: archiving never touched a deal,
-- so anybody who was archived still has every row they ever had. They
-- simply become visible again, which is the point.
--
-- The route (POST /people/:personId/archive), the repo's setArchived, and
-- the web app's useArchivePerson were all removed in the same change, so
-- nothing reads this column any more.

ALTER TABLE tb_people DROP COLUMN IF EXISTS archived_at;
