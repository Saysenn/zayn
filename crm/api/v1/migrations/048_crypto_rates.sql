-- ===============================
-- * What a crypto payment costs us in gas.
-- ===============================
-- ONE RATE, not two. We pay the gas on a crypto payment, so it is ADDED to
-- what that row is owed. The boss calls it a fee; in the CRM a fee is a
-- DEDUCTION, so internally it is an add on and the sheet heads the block
-- "Crypto charges" rather than putting an adding block next to a
-- subtracting one both called fees.
--
-- ON THE ROW, not on a subtotal. It applies where payment_method is
-- crypto, so it reaches every total through shared/rates.helper.js like the
-- person and deal rates. It used to be worked out on the crypto subtotal
-- inside one breakdown design and printed in one cell, which meant no total
-- anywhere contained it.
--
-- SETTINGS, NOT PER PERSON. It is what the rail costs, identical for
-- everyone paid that way, and nothing to do with tb_people.addon_percent.
ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS crypto_percent numeric(5,2) NOT NULL DEFAULT 1
    CHECK (crypto_percent >= 0 AND crypto_percent <= 100);
