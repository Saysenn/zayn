-- Escalations, flagged for a person to review. Raised by whatbot, worked by
-- an admin in the CRM's flagged queue.
CREATE TABLE IF NOT EXISTS concerns (
  id serial PRIMARY KEY,
  person_id text NOT NULL,
  group_name text NOT NULL,
  category text NOT NULL
    CHECK (category IN ('dispute', 'distress', 'legal', 'wrong-recipient', 'wants-human', 'anger', 'data-request')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at timestamp NOT NULL DEFAULT now()
);
