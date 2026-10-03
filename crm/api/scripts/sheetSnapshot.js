#!/usr/bin/env node
/**
 * ***************************************************
 * * A READ ONLY fingerprint of the whole sheet
 * ***************************************************
 *
 * Taken before and after a write test, so anything that changed OUTSIDE
 * the scratch group is caught. The danger in testing writes is not the
 * rows you meant to touch; it is `bulk_update_master_sheet` running
 * against a filter that was wider than anybody thought.
 *
 * IT WRITES NOTHING AND DELETES NOTHING. It reads, hashes and prints.
 *
 *   node scripts/sheetSnapshot.js            print the fingerprint
 *   node scripts/sheetSnapshot.js before.json  also save it
 *   node scripts/sheetSnapshot.js after.json --diff before.json
 */
require('dotenv').config();
const fs = require('node:fs');
const crypto = require('node:crypto');

const SCRATCH = 'ZZTEST';

// The columns worth watching. A change to any of these on a real row is
// the thing this exists to catch.
const WATCH = [
  'person_name', 'group_name', 'company', 'role_label', 'monthly_amount',
  'payable_amount', 'currency', 'payment_method', 'preset_on', 'payment_start_on',
  'end_on', 'status', 'addon_percent', 'fee_percent',
  'override_should_be_paid', 'override_paid', 'notes',
];

const fingerprint = (r) => crypto
  .createHash('sha1')
  .update(WATCH.map((k) => `${k}=${r[k] ?? ''}`).join('|'))
  .digest('hex')
  .slice(0, 12);

(async () => {
  const repo = require('../v1/repos/masterSheetRows.repo');
  const all = await repo.findAllRows();

  const real = all.filter((r) => r.group_name !== SCRATCH);
  const scratch = all.filter((r) => r.group_name === SCRATCH);

  const snap = {
    takenAt: new Date().toISOString(),
    realRows: real.length,
    scratchRows: scratch.length,
    rows: Object.fromEntries(real.map((r) => [r.id, fingerprint(r)])),
  };

  console.log(`REAL rows ${snap.realRows} · scratch (${SCRATCH}) ${snap.scratchRows}`);

  const out = process.argv[2];
  if (out && !out.startsWith('--')) {
    fs.writeFileSync(out, JSON.stringify(snap, null, 1));
    console.log(`saved ${out}`);
  }

  const against = process.argv.indexOf('--diff');
  if (against !== -1) {
    const was = JSON.parse(fs.readFileSync(process.argv[against + 1], 'utf8'));
    const changed = [];
    for (const [id, hash] of Object.entries(was.rows)) {
      if (!(id in snap.rows)) changed.push(`#${id} DELETED`);
      else if (snap.rows[id] !== hash) changed.push(`#${id} CHANGED`);
    }
    for (const id of Object.keys(snap.rows)) {
      if (!(id in was.rows)) changed.push(`#${id} APPEARED`);
    }

    console.log(`\nreal rows before ${was.realRows}, after ${snap.realRows}`);
    if (changed.length === 0) {
      console.log('NOTHING OUTSIDE THE SCRATCH GROUP MOVED.');
    } else {
      console.log(`\x1b[31m${changed.length} REAL ROWS AFFECTED:\x1b[0m`);
      for (const c of changed) console.log(`  ${c}`);
    }
  }

  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
