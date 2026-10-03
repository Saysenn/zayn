-- Every timestamp column so far was `timestamp` (no time zone). The
-- Postgres session itself is UTC (confirmed via `SHOW timezone`), so the
-- raw digits stored are genuine UTC wall-clock values — but node-postgres's
-- default parser for a *naive* timestamp column reads those digits back
-- using the Node process's own local system timezone, not UTC. On a
-- machine whose local zone isn't UTC, every timestamp read out and
-- JSON-serialized to the frontend lands on the wrong instant — enough to
-- make a row synced moments ago look like it happened in the future
-- relative to the browser's real clock, which is why "seen X ago" style
-- labels could get stuck reading a negative delta as "just now" forever.
--
-- `timestamptz` doesn't have this problem — it's a real UTC instant both in
-- storage and over the wire. `USING col AT TIME ZONE 'UTC'` reinterprets
-- the existing naive digits as UTC (which is what they already were, per
-- the session's own timezone), so this is a pure type fix, not a data change.
ALTER TABLE admins ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE companies ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE companies ALTER COLUMN last_seen_at TYPE timestamptz USING last_seen_at AT TIME ZONE 'UTC';
ALTER TABLE assignments ALTER COLUMN synced_at TYPE timestamptz USING synced_at AT TIME ZONE 'UTC';
ALTER TABLE payment_status ALTER COLUMN replied_at TYPE timestamptz USING replied_at AT TIME ZONE 'UTC';
ALTER TABLE concerns ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE messages ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE thread_reads ALTER COLUMN last_read_at TYPE timestamptz USING last_read_at AT TIME ZONE 'UTC';
ALTER TABLE app_settings ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE logs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
