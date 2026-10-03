-- A fifth payday-check outcome: 'partial'.
--
-- The money arrived, but not all of it. Until now that reply had nowhere
-- to go: it landed as 'not_received', which reads as "nothing came" and
-- puts the row in the same bucket as someone who was never paid at all.
-- The two need chasing for completely different reasons.
--
-- Deliberately NOT a separate needs_review flag. "Needs a human" is what
-- 'partial' and 'not_received' already mean, so a boolean beside them
-- could only ever drift out of agreement with the outcome it describes.
-- The UI derives the indicator from the outcome (PaydayIndicator.jsx).
--
-- 'partial' counts as PAID, since they did receive money — see agent.js's
-- PATCH /payment-status, where the Paid toggle follows "did anything
-- arrive", not "was it right".
--
-- The CHECK is unnamed in migration 004, so Postgres named it
-- payment_status_outcome_check. Dropped and re-added rather than altered,
-- since a CHECK constraint can't be modified in place.
ALTER TABLE payment_status DROP CONSTRAINT IF EXISTS payment_status_outcome_check;
ALTER TABLE payment_status ADD CONSTRAINT payment_status_outcome_check
  CHECK (outcome IN ('sent', 'confirmed', 'partial', 'not_received', 'no_response'));
