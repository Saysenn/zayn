-- DIANE'S HMRC & CIS KNOWLEDGE (his call 2026-10-10).
--
-- What she answers HMRC and CIS questions from: GOV.UK guidance and HMRC
-- manuals, fetched with their "last updated" date, and the admin's OWN
-- notes ("how we do it"), which are read first. Each source is cut into
-- chunks with an embedding, so a question finds the passages that answer it.
--
--   kind   govuk  a GOV.UK page or HMRC manual section (re-fetched on refresh)
--          note   the admin's own knowledge, never overwritten by a refresh

CREATE TABLE IF NOT EXISTS tb_hmrc_sources (
  id          serial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('govuk', 'note')),
  url         text UNIQUE,
  title       text NOT NULL,
  body        text NOT NULL,
  topic       text,
  updated_on  date,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  added_by    text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tb_hmrc_sources_kind_idx ON tb_hmrc_sources (kind, active);

CREATE TABLE IF NOT EXISTS tb_hmrc_chunks (
  id          serial PRIMARY KEY,
  source_id   integer NOT NULL REFERENCES tb_hmrc_sources (id) ON DELETE CASCADE,
  n           integer NOT NULL,
  text        text NOT NULL,
  embedding   real[] NOT NULL,
  UNIQUE (source_id, n)
);
