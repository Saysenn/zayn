-- ***************************************************
-- * Searchable conversation knowledge
-- ***************************************************

ALTER TABLE tb_conversations
  ADD COLUMN IF NOT EXISTS touched_companies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS summary_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS summary_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS summarized_at timestamptz;

CREATE INDEX IF NOT EXISTS tb_conversations_companies_idx
  ON tb_conversations USING gin (touched_companies);

