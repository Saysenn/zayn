/**
 * Copy live into a LOCAL database for testing. Live is opened READ ONLY.
 *
 *   node scripts/cloneLive.js                 -> crm_clone on 127.0.0.1:54329
 *   CLONE_URL=postgresql://... node scripts/cloneLive.js
 *
 * Builds the schema with our own migrations, then copies every table's
 * rows. Refuses any target that is not localhost. Then run the API with
 *   DATABASE_URL=<clone url> DB_SSL=false
 */
require('dotenv').config();
const path = require('path');
const { execFileSync } = require('child_process');
require('../configs/pgTypes');
const { Client } = require('pg');

const LIVE = process.env.DATABASE_URL;
const CLONE = process.env.CLONE_URL || 'postgresql://postgres:localtest@127.0.0.1:54329/crm_clone';
const BATCH = 300;

const target = new URL(CLONE);
if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error(`Refusing a non-local clone target: ${target.hostname}`);
if (!LIVE || LIVE === CLONE) throw new Error('DATABASE_URL must be live, and not the clone.');
const dbName = target.pathname.slice(1);
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Odd database name: ${dbName}`);

async function columns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

async function main() {
  const admin = new Client({ connectionString: Object.assign(new URL(CLONE), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  // UTF8 explicitly: a Windows Postgres defaults to WIN1252 and rejects "→".
  await admin.query(`CREATE DATABASE ${dbName} WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await admin.end();

  execFileSync(process.execPath, ['scripts/migrate.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: CLONE, DB_SSL: 'false' },
  });

  const live = new Client({ connectionString: LIVE, ssl: { rejectUnauthorized: false } });
  const local = new Client({ connectionString: CLONE });
  await live.connect();
  await local.connect();
  await live.query('SET default_transaction_read_only = on');
  await live.query('BEGIN READ ONLY');

  const { rows: tableRows } = await local.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'`,
  );
  const { rows: liveTableRows } = await live.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const onLive = new Set(liveTableRows.map((r) => r.table_name));

  // Foreign keys and triggers off while copying, so table order does not matter.
  await local.query("SET session_replication_role = 'replica'");
  for (const { table_name: table } of tableRows) {
    if (!onLive.has(table)) { console.log(`${table}: not on live yet, left empty`); continue; }
    const liveCols = new Set((await columns(live, table)).map((c) => c.column_name));
    const shared = (await columns(local, table)).filter((c) => liveCols.has(c.column_name));
    const names = shared.map((c) => `"${c.column_name}"`).join(', ');
    const { rows } = await live.query(`SELECT ${names} FROM "${table}"`);
    // Migrations seed some rows (app_settings); live's copy replaces them.
    await local.query(`DELETE FROM "${table}"`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const params = [];
      const values = rows.slice(i, i + BATCH).map((row) => `(${shared.map((c) => {
        const v = row[c.column_name];
        params.push(v !== null && (c.data_type === 'json' || c.data_type === 'jsonb') ? JSON.stringify(v) : v);
        return `$${params.length}`;
      }).join(', ')})`).join(', ');
      await local.query(`INSERT INTO "${table}" (${names}) VALUES ${values}`, params);
    }
    console.log(`${table}: ${rows.length}`);
  }
  await live.query('ROLLBACK');

  // Sequences follow the copied ids, so new rows do not collide.
  const { rows: seqs } = await local.query(
    `SELECT table_name, column_name, pg_get_serial_sequence('"' || table_name || '"', column_name) AS seq
       FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval%'`,
  );
  for (const s of seqs.filter((x) => x.seq)) {
    await local.query(
      `SELECT setval($1, COALESCE((SELECT MAX("${s.column_name}") FROM "${s.table_name}"), 0) + 1, false)`,
      [s.seq],
    );
  }
  await live.end();
  await local.end();
  console.log(`Clone ready: ${target.hostname}:${target.port}/${dbName}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
