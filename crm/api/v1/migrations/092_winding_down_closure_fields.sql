-- ===============================
-- * WINDING DOWN AS THE BOSS'S CLOSURE SHEET KEEPS IT (his call 2026-11-04)
-- ===============================
-- "WR CLOSURE SPREADSHEET NEW 1-3.xlsx" tracks more per company than the
-- page did. Every column it has that we lacked is a field here now:
--
--   official_receiver  who the Official Receiver is (or "appointed as liquidator")
--   last_action        what was done last
--   unresolved         unresolved matters
--   play               current play: wait, chase, leave, do not contact
--   prompts            what the director said, who was blamed and why
--   stage_date         the Companies House date of the stage (gazette,
--                      suspension), not the day it was set here
--
-- LIQUIDATORS ARE A LIST: `liquidator` keeps its text, one name per line
-- (joint liquidators). Text already there stays as it is: a line is a name.
ALTER TABLE tb_liquidations
  ADD COLUMN IF NOT EXISTS official_receiver text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_action       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unresolved        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS play              text
    CHECK (play IS NULL OR play IN ('wait', 'chase', 'leave', 'do_not_contact')),
  ADD COLUMN IF NOT EXISTS prompts           text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stage_date        date;

-- OTHER INVOLVED PARTIES: everyone on the case besides the liquidator, with
-- their position ("Chloe Fletcher, Insolvency Examiner"). Several a company.
CREATE TABLE IF NOT EXISTS tb_liquidation_parties (
  id              serial PRIMARY KEY,
  liquidation_id  integer NOT NULL REFERENCES tb_liquidations (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  position        text NOT NULL DEFAULT '',
  by_user         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_liquidation_parties_row ON tb_liquidation_parties (liquidation_id, id);

-- ===============================
-- * THE AUDIT TRAIL (his call 2026-11-04: "history auditing is super important")
-- ===============================
-- Every change on a winding down company: which field, from what, to what,
-- who (an admin, Diane, the import), how, when, and the file an import came
-- from. KEPT FOREVER, never pruned. Keyed on the company too, so a status
-- change made before the company had a row here is still its own.
--
-- `field` is the page's word: stage, stage kind, deadline, …, party,
-- contact log, document, status. Added or removed things (a party, a log
-- line, a document) have the one side empty.
CREATE TABLE IF NOT EXISTS tb_liquidation_audit (
  id              bigserial PRIMARY KEY,
  liquidation_id  integer REFERENCES tb_liquidations (id) ON DELETE SET NULL,
  company_key     text NOT NULL,
  field           text NOT NULL,
  old_value       text,
  new_value       text,
  by_user         text,
  via             text NOT NULL DEFAULT 'admin' CHECK (via IN ('admin', 'diane', 'import', 'undo', 'system')),
  source          text,
  batch_id        uuid,
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_liquidation_audit_company ON tb_liquidation_audit (company_key, changed_at DESC, id DESC);

-- The stage history so far is the trail's first lines.
INSERT INTO tb_liquidation_audit (liquidation_id, company_key, field, old_value, new_value, by_user, via, changed_at)
SELECT h.liquidation_id, l.company_key, 'stage', h.from_stage, h.to_stage, h.by_user,
       CASE WHEN h.by_user ILIKE 'diane%' THEN 'diane' ELSE 'admin' END, h.changed_at
  FROM tb_liquidation_history h JOIN tb_liquidations l ON l.id = h.liquidation_id
 WHERE NOT EXISTS (SELECT 1 FROM tb_liquidation_audit);

-- ===============================
-- * EACH CLOSURE SHEET IMPORT (Settings), and how to undo it
-- ===============================
-- One row per import: the file, who, what it did, and what it replaced, so
-- the whole act can be put back. Its every change is on the audit trail
-- under the same batch id.
CREATE TABLE IF NOT EXISTS tb_closure_imports (
  id          serial PRIMARY KEY,
  file_name   text NOT NULL,
  by_user     text,
  batch_id    uuid NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  restore     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz,
  undone_by   text
);
