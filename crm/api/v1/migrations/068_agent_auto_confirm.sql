-- ***************************************************
-- * AUTO MODE: the confirmations Diane may stop asking for
-- ***************************************************
--
-- His call 2026-09-29, and he named the shape himself: Claude Code's
-- shift-tab. Ask once, then stop asking for the kind of change that was
-- just agreed to.
--
-- OFF by default, and it stays off until somebody turns it on. A write
-- that skips its preview is a write nobody read before it happened, so the
-- default cannot be the convenient one.
--
-- IT IS NOT "SKIP EVERY CONFIRMATION". The closed list of what may skip
-- lives in v1/agent/autoConfirm.js, and it is an ALLOW list: a tool added
-- tomorrow asks first until somebody puts it there on purpose. Nothing
-- that deletes, stops, closes, renames or reaches more than the one named
-- row is on it, whatever this column says.

ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS agent_auto_confirm boolean NOT NULL DEFAULT false;
