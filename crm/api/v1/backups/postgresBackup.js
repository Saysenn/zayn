const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const env = require('../../configs/env');

const MANIFEST_SUFFIX = '.manifest.json';
const RESTORE_PHRASE = 'RESTORE DATABASE';

function backupConfig() {
  return {
    directory: env.backupDir,
    intervalHours: env.backupIntervalHours,
    pgDump: env.pgDumpPath,
    pgRestore: env.pgRestorePath,
    databaseUrl: env.databaseUrl,
  };
}

function inside(directory, file) {
  const root = path.resolve(directory);
  const target = path.resolve(file);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Backup file must be inside BACKUP_DIR');
  }
  return target;
}

function execute(binary, args, databaseUrl, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, PGDATABASE: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (part) => { stdout += part; });
    child.stderr?.on('data', (part) => { stderr += part; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(binary)} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function sha256(file) {
  const content = await fs.readFile(file);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function fileName(now = new Date()) {
  return `crm-${now.toISOString().replace(/[:.]/g, '')}.dump`;
}

function manifestFor(dumpFile) {
  return `${dumpFile}${MANIFEST_SUFFIX}`;
}

async function verifyBackup(dumpFile, options = {}) {
  const config = { ...backupConfig(), ...options };
  if (!config.directory) throw new Error('BACKUP_DIR is not configured');
  const dump = inside(config.directory, dumpFile);
  const manifestFile = inside(config.directory, manifestFor(dump));
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const stat = await fs.stat(dump);
  const checksum = await sha256(dump);
  if (checksum !== manifest.sha256 || stat.size !== manifest.bytes) {
    throw new Error('Backup checksum or size does not match its manifest');
  }
  await execute(config.pgRestore, ['--list', dump], config.databaseUrl, config.spawnImpl);
  return { ...manifest, dumpFile: dump, manifestFile, valid: true };
}

async function createBackup(options = {}) {
  const config = { ...backupConfig(), ...options };
  if (!config.directory) throw new Error('BACKUP_DIR is not configured');
  const directory = path.resolve(config.directory);
  await fs.mkdir(directory, { recursive: true });
  const dump = inside(directory, path.join(directory, fileName(config.now)));

  await execute(
    config.pgDump,
    ['--format=custom', '--no-owner', '--no-privileges', '--file', dump],
    config.databaseUrl,
    config.spawnImpl,
  );
  await execute(config.pgRestore, ['--list', dump], config.databaseUrl, config.spawnImpl);

  const stat = await fs.stat(dump);
  const createdAt = (config.now ?? new Date()).toISOString();
  const manifest = {
    version: 1,
    createdAt,
    verifiedAt: new Date().toISOString(),
    dumpFile: path.basename(dump),
    bytes: stat.size,
    sha256: await sha256(dump),
  };
  const manifestFile = manifestFor(dump);
  const pending = `${manifestFile}.pending`;
  await fs.writeFile(pending, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.rename(pending, manifestFile);
  return { ...manifest, dumpFile: dump, manifestFile, valid: true };
}

async function latestBackup(options = {}) {
  const config = { ...backupConfig(), ...options };
  if (!config.directory) return { configured: false };
  const directory = path.resolve(config.directory);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return { configured: true, found: false };
    throw error;
  }
  const latest = names.filter((name) => name.endsWith(MANIFEST_SUFFIX)).sort().at(-1);
  if (!latest) return { configured: true, found: false };
  const dump = path.join(directory, latest.slice(0, -MANIFEST_SUFFIX.length));
  return { configured: true, found: true, ...(await verifyBackup(dump, config)) };
}

async function restoreBackup(dumpFile, confirmation, options = {}) {
  if (confirmation !== RESTORE_PHRASE) throw new Error(`Type ${RESTORE_PHRASE} to restore`);
  const config = { ...backupConfig(), ...options };
  const verified = await verifyBackup(dumpFile, config);
  await execute(
    config.pgRestore,
    ['--clean', '--if-exists', '--single-transaction', '--no-owner', '--no-privileges',
      '--dbname=', verified.dumpFile],
    config.databaseUrl,
    config.spawnImpl,
  );
  return verified;
}

module.exports = {
  createBackup,
  verifyBackup,
  latestBackup,
  restoreBackup,
  backupConfig,
  inside,
  fileName,
  manifestFor,
  execute,
  RESTORE_PHRASE,
  MANIFEST_SUFFIX,
};
