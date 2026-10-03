const logger = require('../../configs/logger');
const { backupConfig, createBackup } = require('./postgresBackup');

const HOURS_TO_MS = 60 * 60 * 1000;

function startBackupScheduler({ run = createBackup } = {}) {
  const config = backupConfig();
  if (!config.directory || !(config.intervalHours > 0)) return null;

  let running = false;
  const create = async () => {
    if (running) return;
    running = true;
    try {
      const result = await run();
      logger.info({ file: result.dumpFile }, 'database backup verified');
    } catch (err) {
      logger.error({ err }, 'database backup failed');
    } finally {
      running = false;
    }
  };
  setImmediate(create);
  const timer = setInterval(create, config.intervalHours * HOURS_TO_MS);
  timer.unref();
  return timer;
}

module.exports = { startBackupScheduler, HOURS_TO_MS };
