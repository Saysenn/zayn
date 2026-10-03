const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  createBackup, verifyBackup, restoreBackup, inside, RESTORE_PHRASE,
} = require('./postgresBackup');

function fakeSpawn(calls) {
  return (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const fileAt = args.indexOf('--file');
    if (fileAt >= 0) fs.writeFileSync(args[fileAt + 1], 'verified custom dump');
    process.nextTick(() => child.emit('close', 0));
    return child;
  };
}

test('a backup is listed, hashed, and manifested before success', async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'crm-backup-'));
  context.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const options = {
    directory,
    databaseUrl: 'postgres://private',
    pgDump: 'pg_dump_test',
    pgRestore: 'pg_restore_test',
    spawnImpl: fakeSpawn(calls),
    now: new Date('2026-09-04T12:00:00.000Z'),
  };
  const made = await createBackup(options);

  assert.equal(made.valid, true);
  assert.equal(calls[0].binary, 'pg_dump_test');
  assert.deepEqual(calls[1].args.slice(0, 1), ['--list']);
  assert.equal(calls[0].options.env.PGDATABASE, 'postgres://private');
  assert.equal(calls[0].args.includes('postgres://private'), false);
  assert.equal(JSON.parse(await fsp.readFile(made.manifestFile, 'utf8')).sha256, made.sha256);
  assert.equal((await verifyBackup(made.dumpFile, options)).valid, true);
});

test('a changed dump fails checksum verification', async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'crm-backup-'));
  context.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const options = {
    directory,
    databaseUrl: 'postgres://private',
    pgDump: 'dump',
    pgRestore: 'restore',
    spawnImpl: fakeSpawn([]),
  };
  const made = await createBackup(options);
  await fsp.appendFile(made.dumpFile, 'changed');
  await assert.rejects(() => verifyBackup(made.dumpFile, options), /checksum or size/);
});

test('paths outside the configured backup directory are refused', () => {
  const safe = path.join(os.tmpdir(), 'safe');
  const elsewhere = path.join(os.tmpdir(), 'elsewhere', 'copy.dump');
  assert.throws(() => inside(safe, elsewhere), /inside BACKUP_DIR/);
});

test('restore requires the exact destructive confirmation before validation', async () => {
  await assert.rejects(
    () => restoreBackup('anything.dump', 'yes', { directory: 'C:\\safe' }),
    new RegExp(RESTORE_PHRASE),
  );
});

test('restore keeps the database URL out of process arguments', async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'crm-backup-'));
  context.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const options = {
    directory,
    databaseUrl: 'postgres://private',
    pgDump: 'dump',
    pgRestore: 'restore',
    spawnImpl: fakeSpawn(calls),
  };
  const made = await createBackup(options);
  await restoreBackup(made.dumpFile, RESTORE_PHRASE, options);

  const restore = calls.at(-1);
  assert.equal(restore.args.includes('postgres://private'), false);
  assert.equal(restore.args.includes('--dbname='), true);
  assert.equal(restore.args.includes('--single-transaction'), true);
  assert.equal(restore.options.env.PGDATABASE, 'postgres://private');
});
