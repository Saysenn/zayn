-- The switch for whatbot's one remaining write.
--
-- whatbot writes exactly two things onto a deal — the payday outcome and
-- the Paid flag it implies (PATCH /api/v1/agent/payment-status). The user
-- asked for that to be turn-off-able, so it lives here rather than in an
-- env var: a toggle on the Settings page takes effect on the next request,
-- where an env var needs a redeploy and can't be flipped mid-payday.
--
-- Defaults ON, because that write is the whole point of the payday check
-- and a fresh install that silently ignored it would look broken.
--
-- When it is off the endpoint returns 200 with `accepted: false` rather
-- than an error — whatbot should not retry, log an incident, or fall over
-- because an admin deliberately turned it off.
ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS whatbot_writes_enabled boolean NOT NULL DEFAULT true;
