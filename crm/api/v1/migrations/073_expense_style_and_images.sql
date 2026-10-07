-- HOW EXPENSE PREVIEWS LOOK, and THE PICTURES DIANE SENDS. His calls
-- 2026-10-07.
--
-- expense_style: the picture WhatBot and Diane send for an expense preview:
--   sheet     a clean table, the master sheet export's Blue white colours
--   notebook  a handwritten note on ruled paper
--   text      no picture, the one-field-per-line text
ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS expense_style text NOT NULL DEFAULT 'sheet'
    CHECK (expense_style IN ('sheet', 'notebook', 'text'));

-- A picture Diane sent in the command center, kept so the conversation's
-- Attachments panel can show it again later. Small PNGs; old ones can be
-- cleared without losing anything else.
CREATE TABLE IF NOT EXISTS tb_agent_images (
  id          uuid PRIMARY KEY,
  png         bytea NOT NULL,
  caption     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_agent_images_created ON tb_agent_images (created_at DESC);
