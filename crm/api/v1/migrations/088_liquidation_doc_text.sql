-- A LIQUIDATION DOCUMENT IS READABLE (his call 2026-10-13): Diane, lawyer
-- mode above all, reads them and answers from them. On upload each file's
-- text is taken out once (PDF, Word, Excel, CSV, text, email, PowerPoint;
-- pictures and scanned PDFs read by the model), cut into passages, and each
-- passage given an embedding, the same as the HMRC knowledge (tb_hmrc_chunks),
-- so a question finds the passages that answer it in milliseconds.
--
-- The original file is always kept; the text is a reading of it.
ALTER TABLE tb_liquidation_docs
  ADD COLUMN IF NOT EXISTS read_status text NOT NULL DEFAULT 'waiting'
    CHECK (read_status IN ('waiting', 'reading', 'read', 'unreadable')),
  ADD COLUMN IF NOT EXISTS read_how text,
  ADD COLUMN IF NOT EXISTS read_error text,
  ADD COLUMN IF NOT EXISTS text text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE TABLE IF NOT EXISTS tb_liquidation_doc_chunks (
  id         serial PRIMARY KEY,
  doc_id     integer NOT NULL REFERENCES tb_liquidation_docs (id) ON DELETE CASCADE,
  n          integer NOT NULL,
  text       text NOT NULL,
  embedding  real[] NOT NULL
);
CREATE INDEX IF NOT EXISTS tb_liquidation_doc_chunks_doc ON tb_liquidation_doc_chunks (doc_id);

-- WHAT DIANE'S UNDO PUTS BACK now covers documents too.
ALTER TABLE tb_agent_undo DROP CONSTRAINT IF EXISTS tb_agent_undo_kind_check;
ALTER TABLE tb_agent_undo ADD CONSTRAINT tb_agent_undo_kind_check
  CHECK (kind IN ('liquidations', 'flags', 'rates', 'documents'));

-- FILES ATTACHED IN DIANE'S CHAT, kept as they came so they can be saved into
-- a company's documents ("save these to Quarry Lane"). On disk under
-- storage/chat-files; a row here says what and whose. Cleared after a day.
CREATE TABLE IF NOT EXISTS tb_chat_files (
  id          uuid PRIMARY KEY,
  file_name   text NOT NULL,
  stored_path text NOT NULL,
  mime        text,
  size_bytes  integer,
  by_user     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
