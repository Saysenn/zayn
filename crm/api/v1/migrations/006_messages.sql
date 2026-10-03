-- The chatbox's own history. Both directions: what a person sent in on
-- WhatsApp (inbound, recorded by whatbot best-effort after it already
-- replied) and what an admin sent from the CRM (outbound, delivered via
-- whatbot's admin-reply webhook). Thread identity is (group_name, person_id)
-- — the same identity whatbot itself uses, never merged across groups.
CREATE TABLE IF NOT EXISTS messages (
  id serial PRIMARY KEY,
  group_name text NOT NULL,
  person_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('sending', 'sent', 'failed', 'received')),
  created_at timestamp NOT NULL DEFAULT now()
);

-- one thread, ordered by time — what both the thread view and "latest
-- message per thread" (the thread list) query against
CREATE INDEX IF NOT EXISTS messages_thread_idx
  ON messages (group_name, person_id, created_at);
