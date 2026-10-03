const fs = require('fs');
const path = require('path');
const pool = require('../configs/db');

const migrationsDir = path.join(__dirname, '..', 'v1', 'migrations');

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }

  console.log('Migrations up to date.');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
