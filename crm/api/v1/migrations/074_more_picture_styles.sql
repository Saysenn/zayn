-- MORE PICTURE STYLES (his call 2026-10-07): plain text becomes a RECEIPT
-- picture (one monospace face, like a till receipt), and two more looks,
-- LEDGER (an old accounts book) and CHALKBOARD (textured slate).
ALTER TABLE tb_settings DROP CONSTRAINT IF EXISTS tb_settings_expense_style_check;
UPDATE tb_settings SET expense_style = 'receipt' WHERE expense_style = 'text';
ALTER TABLE tb_settings ADD CONSTRAINT tb_settings_expense_style_check
  CHECK (expense_style IN ('sheet', 'notebook', 'receipt', 'ledger', 'chalkboard'));
