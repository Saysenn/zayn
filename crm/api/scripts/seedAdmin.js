const bcryptHelper = require('../v1/shared/bcrypt.helper');
const adminsRepo = require('../v1/repos/admins.repo');
const pool = require('../configs/db');

// The code is optional so an existing account's password can be changed
// without retyping it, and vice versa: the repo COALESCEs whichever is
// omitted. A NEW account with no code cannot sign in, so say so.
async function run() {
  const [username, password, code] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: npm run seed-admin -- <username> <password> [secret-code]');
    process.exit(1);
  }

  const existing = await adminsRepo.findByUsername(username);
  await adminsRepo.upsertAccount({
    username,
    passwordHash: await bcryptHelper.hash(password),
    secretCodeHash: code ? await bcryptHelper.hash(code) : null,
  });

  console.log(`Admin "${username}" saved.`);
  if (!code && !existing?.secret_code_hash) {
    console.warn('NO SECRET CODE SET. This account cannot sign in until one is.');
    console.warn(`  npm run seed-admin -- ${username} <password> <secret-code>`);
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
