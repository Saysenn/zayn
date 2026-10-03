const repo = require('../repos/conversations.repo');
const { summarise, SUMMARY_VERSION } = require('./summarise');
const logger = require('../../configs/logger');

let running = false;

async function repairMissingSummaries(limit = 2, dependencies = {}) {
  if (running) return 0;
  running = true;
  let repaired = 0;
  const memoryRepo = dependencies.repo ?? repo;
  const makeSummary = dependencies.summarise ?? summarise;

  try {
    const ids = await memoryRepo.needingSummary(limit, SUMMARY_VERSION);
    for (const id of ids) {
      const messages = await memoryRepo.messagesFor(id);
      const memory = await makeSummary(messages);
      if (!memory?.text) continue;
      await memoryRepo.setSummary(id, memory.text, memory);
      repaired += 1;
    }
  } catch (err) {
    logger.error({ err }, 'diane: repairing conversation summaries failed');
  } finally {
    running = false;
  }

  return repaired;
}

function queueSummaryRepair() {
  setImmediate(() => repairMissingSummaries());
}

module.exports = { repairMissingSummaries, queueSummaryRepair };
