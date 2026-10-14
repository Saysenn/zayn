-- WHAT DIANE'S CHANGES REPLACED, so "undo that" puts it back (his call
-- 2026-10-13). For the writes with no change log of their own: the
-- Liquidations page, flags and exchange rates. One row per act (a batch
-- of companies, people or rates), holding what to restore. The master
-- sheet keeps its own log (tb_mastersheet_changes) and does not use this.
CREATE TABLE IF NOT EXISTS tb_agent_undo (
  id          serial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('liquidations', 'flags', 'rates')),
  summary     text NOT NULL,
  restore     jsonb NOT NULL,
  by_user     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz
);
CREATE INDEX IF NOT EXISTS tb_agent_undo_latest ON tb_agent_undo (kind, created_at DESC) WHERE undone_at IS NULL;
