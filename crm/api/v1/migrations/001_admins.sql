-- One row per admin login (1-3 admins, no user management beyond this).
-- password_hash is bcrypt — never store the plaintext, never accept one in a migration.
CREATE TABLE IF NOT EXISTS admins (
  id serial PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
