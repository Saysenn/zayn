-- Single-row settings table (id is always 1) — a place for CRM-wide toggles
-- that aren't tied to any one admin. Starts with just dev_mode.
CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dev_mode boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Captured only while dev_mode is on (see shared/captureLog.helper.js) — this
-- is a debugging aid, not an audit trail, so it's fine for it to be empty
-- most of the time. `source` distinguishes crm/api's own errors from ones
-- whatbot forwards over POST /api/v1/agent/logs.
CREATE TABLE IF NOT EXISTS logs (
  id serial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('api', 'agent')),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message text NOT NULL,
  detail jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logs_created_at_idx ON logs (created_at DESC);
