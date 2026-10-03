-- When a flag's status last moved.
--
-- ONE COLUMN, NOT TWO. "Resolved at" and "last updated" look like two
-- facts and are one: the moment the status last changed. When the status
-- reads 'resolved' that moment IS when it was resolved, and when it reads
-- 'in_progress' it is when somebody picked it up.
--
-- Storing a separate resolved_at would go stale the first time a resolved
-- flag is reopened: the row would say 'open' and carry a date claiming it
-- was resolved, and nothing would ever clear it.
--
-- Backfilled to created_at rather than left NULL. Every existing flag has
-- been at its current status since it was raised, because until now there
-- was nothing to record a change — so created_at is the true answer, not a
-- placeholder for one.

ALTER TABLE tb_concerns
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

UPDATE tb_concerns SET status_changed_at = created_at WHERE status_changed_at > created_at;
