-- THE LIQUIDATION TRACKER (his call 2026-10-13, docs/feature.md item 16).
--
-- One row per company being wound down, or watched. Keyed on the company's
-- normalised name (trimmed, spaces collapsed, lowercased), the key every
-- company page uses: a company can exist only in the deals, with no
-- tb_companies row. A rename carries the key across (companies.repo.js).
--
-- `stage` is the wind-down's own word, NOT the company status that pays the
-- deals (tb_companies.status). Own liq and HMRC liq set that status to
-- liquidation, Active sets it back; dissolving is done on the company page,
-- where the deals that stop are chosen. Strike off changes no pay.
CREATE TABLE IF NOT EXISTS tb_liquidations (
  id            serial PRIMARY KEY,
  company_key   text NOT NULL UNIQUE CHECK (btrim(company_key) <> ''),
  stage         text NOT NULL DEFAULT 'active'
                CHECK (stage IN ('own_liq', 'hmrc_liq', 'strike_off', 'strike_off_rejected', 'dissolved', 'active')),
  instructions  text NOT NULL DEFAULT '',
  deadline      date,
  next_action   text NOT NULL DEFAULT '',
  -- an admin's username (tb_accounts); kept as text so a removed account
  -- still reads as who owned it
  owner         text,
  blamed        boolean NOT NULL DEFAULT false,
  liquidator    text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- LAST COMM IS A LOG, not one cell: each contact keeps its date and words.
CREATE TABLE IF NOT EXISTS tb_liquidation_comms (
  id              serial PRIMARY KEY,
  liquidation_id  integer NOT NULL REFERENCES tb_liquidations (id) ON DELETE CASCADE,
  said_on         date NOT NULL DEFAULT current_date,
  body            text NOT NULL CHECK (btrim(body) <> ''),
  by_user         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_liquidation_comms_row ON tb_liquidation_comms (liquidation_id, said_on DESC, id DESC);

-- EVERY STAGE CHANGE: from, to, when, who. The row's first stage is one too.
CREATE TABLE IF NOT EXISTS tb_liquidation_history (
  id              serial PRIMARY KEY,
  liquidation_id  integer NOT NULL REFERENCES tb_liquidations (id) ON DELETE CASCADE,
  from_stage      text,
  to_stage        text NOT NULL,
  by_user         text,
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_liquidation_history_row ON tb_liquidation_history (liquidation_id, changed_at DESC);

-- SUPPORTING DOCS. The file is on this machine's disk (LIQUIDATION_DOCS_DIR,
-- like receipts), never a cloud bucket; this is where it is. A removed doc is
-- moved aside, not deleted, and its row says when.
CREATE TABLE IF NOT EXISTS tb_liquidation_docs (
  id              serial PRIMARY KEY,
  liquidation_id  integer NOT NULL REFERENCES tb_liquidations (id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  stored_path     text NOT NULL,
  mime            text,
  size_bytes      integer,
  by_user         text,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS tb_liquidation_docs_row ON tb_liquidation_docs (liquidation_id) WHERE removed_at IS NULL;
