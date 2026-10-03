const burnRepo = require('../repos/burn.repo');
const { takeSnapshot } = require('./takeSnapshot');
const { currentMonth } = require('../shared/presetMonth.helper');

async function closeMonth({ snapshot = takeSnapshot, burn = burnRepo.burnMonth } = {}) {
  const saved = await snapshot(currentMonth());
  await burn();
  return saved;
}

module.exports = { closeMonth };
