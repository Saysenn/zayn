/**
 * One SQL statement on the TEST database (DEV), printed the way `psql -tAc`
 * prints it: one row per line, columns joined by '|'. The nightly sweep's
 * stand-in for `docker exec crm-clone psql`. Refuses LIVE (scripts/testDb.js).
 *
 *   node scripts/testDbSql.js "select count(*) from tb_mastersheet"
 */
const { testDbUrl, ssl } = require('./testDb');
const { Client } = require('pg');

(async () => {
  const url = testDbUrl();
  const c = new Client({ connectionString: url, ssl: ssl(url) });
  await c.connect();
  try {
    const { rows } = await c.query(process.argv[2]);
    for (const row of rows) console.log(Object.values(row).map((v) => (v ?? '')).join('|'));
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
