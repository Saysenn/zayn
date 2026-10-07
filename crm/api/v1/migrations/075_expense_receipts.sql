-- RECEIPTS KEPT WITH THEIR EXPENSE, REPEATS CAUGHT, CATEGORIES. His calls
-- 2026-10-07.
--
-- receipt_path: the receipt file on the CRM's own disk (RECEIPTS_DIR),
--   relative, e.g. 2026-10/412-ab12cd.jpg. Kept for the current month and
--   the two before; then the file is deleted and receipt_cleared_at is set.
--   The expense itself is never deleted with it.
-- category: fuel, travel, food, office, bills or other.
ALTER TABLE tb_expenses
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS receipt_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN ('fuel', 'travel', 'food', 'office', 'bills', 'other'));

-- A receipt's FINGERPRINT, kept forever (a few bytes): the same receipt sent
-- again months later is still recognised after its file is cleared.
--   kind 'image': a 64 bit picture hash (hex), compared by how many bits differ
--   kind 'file':  sha256 of the file's bytes, compared exactly
CREATE TABLE IF NOT EXISTS tb_receipt_prints (
  id          serial PRIMARY KEY,
  expense_id  integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('image', 'file')),
  print       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tb_receipt_prints_print ON tb_receipt_prints (kind, print);
