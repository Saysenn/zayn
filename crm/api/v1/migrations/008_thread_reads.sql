-- Shared "last read" marker per (group, person) thread — not per-admin,
-- since login is one shared credential with no such concept. Any admin
-- opening a thread updates this, and every admin's tab (and a page refresh)
-- sees the same unread state, because it's the actual source of truth
-- instead of client-side memory.
CREATE TABLE IF NOT EXISTS thread_reads (
  group_name text NOT NULL,
  person_id text NOT NULL,
  last_read_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (group_name, person_id)
);
