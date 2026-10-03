-- Payday check outcomes, per handler per month. One row per assignment per
-- period — UNIQUE(assignment_id, period) is what makes a re-check idempotent.
CREATE TABLE IF NOT EXISTS payment_status (
  id serial PRIMARY KEY,
  assignment_id integer NOT NULL REFERENCES assignments(id),
  period text NOT NULL,
  outcome text NOT NULL
    CHECK (outcome IN ('sent', 'confirmed', 'not_received', 'no_response')),
  note text,
  replied_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, period)
);
