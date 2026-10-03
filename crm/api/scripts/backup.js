const {
  createBackup, verifyBackup, restoreBackup,
} = require('../v1/backups/postgresBackup');

async function main() {
  const [action = 'create', file] = process.argv.slice(2);
  let result;
  if (action === 'create') result = await createBackup();
  else if (action === 'verify' && file) result = await verifyBackup(file);
  else if (action === 'restore' && file) {
    result = await restoreBackup(file, process.env.BACKUP_RESTORE_CONFIRM);
  } else {
    throw new Error('Use create, verify FILE, or restore FILE');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
