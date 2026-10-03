const { latestBackup } = require('../../backups/postgresBackup');
const { businessTimezone } = require('../../shared/presetMonth.helper');

const backupStatus = {
  name: 'backup_status',
  description: 'Check whether the newest external database backup exists and passes its checksum and PostgreSQL validation. Read only.',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const status = await latestBackup();
    if (!status.configured) return { summary: 'External database backups are not configured.' };
    if (!status.found) return { summary: 'No external database backup has been created yet.' };
    // In the business's zone, not whichever machine answered.
    const created = new Date(status.createdAt).toLocaleString('en-GB', { timeZone: businessTimezone() });
    const size = (status.bytes / 1024 / 1024).toLocaleString('en-GB', { maximumFractionDigits: 2 });
    return {
      summary: `The newest database backup is valid. Created ${created}, size ${size} MB.`,
      backup: { createdAt: status.createdAt, bytes: status.bytes, valid: true },
    };
  },
};

module.exports = { backupStatus };
