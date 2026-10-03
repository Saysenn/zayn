#!/usr/bin/env node
require('dotenv').config();

const fs = require('node:fs');

const { takeSnapshot } = require('../v1/masterSheet/takeSnapshot');
const { takeWorkbookSnapshot } = require('../v1/masterSheet/workbookSnapshot');

async function main() {
  const month = process.argv[2];
  const fileFlag = process.argv.indexOf('--file');
  const file = fileFlag >= 0 ? process.argv[fileFlag + 1] : null;
  if (fileFlag >= 0 && !file) throw new Error('Pass an xlsx path after --file.');
  const saved = file
    ? await takeWorkbookSnapshot(fs.readFileSync(file), { month, filename: file })
    : await takeSnapshot(month);
  process.stdout.write(`${JSON.stringify(saved, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
