const pool = require('../../configs/db');

// Only repos touch the database — same rule whatbot follows for its own
// storage layer.
function findByUsername(username) {
  return pool
    .query(
      `SELECT id, username, password_hash, secret_code_hash
         FROM tb_accounts
        WHERE username = $1`,
      [username],
    )
    .then((result) => result.rows[0] ?? null);
}

// COALESCE, so seeding a password does not wipe the secret code and vice
// versa. Passing neither would otherwise blank the account it was meant to
// update.
function upsertAccount({ username, passwordHash, secretCodeHash }) {
  return pool.query(
    `INSERT INTO tb_accounts (username, password_hash, secret_code_hash)
     VALUES ($1, COALESCE($2, ''), $3)
     ON CONFLICT (username) DO UPDATE SET
       password_hash    = COALESCE($2, tb_accounts.password_hash),
       secret_code_hash = COALESCE($3, tb_accounts.secret_code_hash)`,
    [username, passwordHash ?? null, secretCodeHash ?? null],
  );
}

module.exports = { findByUsername, upsertAccount };
