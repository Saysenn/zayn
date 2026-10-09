-- WHAT CHANGED ON GOV.UK (his call 2026-10-10: "she should answer based on
-- the current state of HMRC and CIS"). A page Diane relies on that GOV.UK
-- updated: when, a one or two sentence summary of what changed, and whether
-- the admin has been told yet (once, at the start of her next HMRC answer).

CREATE TABLE IF NOT EXISTS tb_hmrc_changes (
  id               serial PRIMARY KEY,
  source_id        integer REFERENCES tb_hmrc_sources (id) ON DELETE CASCADE,
  url              text NOT NULL,
  title            text NOT NULL,
  old_updated_on   date,
  new_updated_on   date,
  summary          text,
  told_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tb_hmrc_changes_untold_idx ON tb_hmrc_changes (told_at, created_at DESC);
