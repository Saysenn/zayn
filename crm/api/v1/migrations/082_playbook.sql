-- OUR PLAYBOOK (his call 2026-10-12): in lawyer mode, how this business does
-- things (its processes, internal ways, how things work here), saved through
-- Diane and read FIRST on every lawyer-mode answer.
--
-- A playbook entry is a source of its own kind beside GOV.UK pages and notes,
-- so it is cut and searched the same way; `topic` is its section ("Payroll",
-- "Onboarding"). Never cut short: a long process is split into passages.
-- Every change is kept in tb_playbook_history (who, when, before and after),
-- so any of them can be put back.

ALTER TABLE tb_hmrc_sources DROP CONSTRAINT IF EXISTS tb_hmrc_sources_kind_check;
ALTER TABLE tb_hmrc_sources ADD CONSTRAINT tb_hmrc_sources_kind_check CHECK (kind IN ('govuk', 'note', 'playbook'));

CREATE TABLE IF NOT EXISTS tb_playbook_history (
  id          serial PRIMARY KEY,
  source_id   integer NOT NULL,
  action      text NOT NULL CHECK (action IN ('add', 'edit', 'remove', 'undo')),
  before      jsonb,
  after       jsonb,
  by_user     text,
  undone_at   timestamptz,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tb_playbook_history_source_idx ON tb_playbook_history (source_id, at DESC);
