#!/usr/bin/env node
require('dotenv').config();

const { repairMissingSummaries } = require('../v1/agent/summaryRecovery');

async function main() {
  const parsed = Number(process.argv[2] ?? 2);
  const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
  const repaired = await repairMissingSummaries(limit);
  process.stdout.write(`${JSON.stringify({ repaired, limit })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
