-- ***************************************************
-- * ONE ROW PER SIGNED-IN ADMIN SESSION
-- ***************************************************
--
-- Replaces the single in-memory slot in configs/sessionStore.js. A row per
-- login means a restart keeps everyone signed in, a second admin no longer
-- kicks the first, and logout revokes only the session that asked.
--
-- `id` is the JWT's jti. Expired and revoked rows are dead weight only;
-- nothing reads them past the WHERE below.

CREATE TABLE IF NOT EXISTS tb_sessions (
  id uuid PRIMARY KEY,
  admin_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS tb_sessions_expires_at_idx ON tb_sessions (expires_at);
