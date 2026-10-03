#!/usr/bin/env node
/**
 * ***************************************************
 * * PUT A DELETED DEAL BACK, ARCHIVED, FROM A MONTH SNAPSHOT
 * ***************************************************
 *
 * WHY IT EXISTS. Deleting from the upload diff is its own act and writes
 * immediately, separately from the commit. On 2026-09-20 at 23:34 one of
 * those deletes took seven rows. Four were replacements the same upload
 * had just inserted a minute earlier, so nothing was lost. Three were not,
 * and `tb_mastersheet_changes` keeps only their LABEL, not their columns:
 * "Lee croft · RP Backrunner 2 · MILKMAN · Director" cannot be turned back
 * into a row.
 *
 * `tb_month_snapshots` can. It holds every column of every row as it stood
 * when the month was closed, so a recovery reads the CRM's own record
 * rather than reconstructing one from a spreadsheet and a memory.
 *
 * ===============================
 * * IT COMES BACK ARCHIVED, ALWAYS
 * ===============================
 * `stopped_on` is set on arrival. A recovered row is there to be AUDITED,
 * not to be paid: it was deleted for a reason nobody has re-examined, and
 * a row that quietly rejoined the sheet would rejoin the month's total
 * with it. Un-archiving is a human decision on the Archive page.
 *
 * `stopped_reason` is a closed set of four in the database and none of
 * them means "recovered", so it is `stopped_by_hand`, which is true: a
 * human put it here. The provenance goes in `notes`, which is free text
 * and shows on the row, and in `tb_mastersheet_changes` as `recovered`.
 *
 * ===============================
 * * READ ONLY UNTIL YOU SAY OTHERWISE
 * ===============================
 * With no `--write` it prints what it WOULD insert and touches nothing.
 * It never updates and never deletes: a key already in the table is
 * skipped, never overwritten, because the row that is there now is newer
 * than any snapshot.
 *
 *   node scripts/recoverFromSnapshot.js --month 2026-08 --key <syncKey> [...]
 *   node scripts/recoverFromSnapshot.js --month 2026-08 --key <syncKey> --write
 *   node scripts/recoverFromSnapshot.js --month 2026-08 --list <text>
 *
 * `--list` searches a snapshot for a name or company and prints the keys,
 * which is how you find what to pass to `--key`.
 */
require('dotenv').config();
const pool = require('../configs/db');

// The one place this script decides anything about the row it writes.
const AS = Object.freeze({
  source: 'synced',
  stoppedReason: 'stopped_by_hand',
  changedVia: 'admin',
  field: 'recovered',
});

function args(argv) {
  const out = { keys: [], month: null, list: null, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--write') out.write = true;
    else if (argv[i] === '--month') { i += 1; out.month = argv[i]; }
    else if (argv[i] === '--list') { i += 1; out.list = String(argv[i] ?? '').toLowerCase(); }
    else if (argv[i] === '--key') { i += 1; if (argv[i]) out.keys.push(argv[i]); }
  }
  return out;
}

// Postgres refuses a null in these, and a snapshot from an older shape can
// be missing one. Zero and '' are what the table's own defaults mean.
const NUM = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const TXT = (v) => (v === null || v === undefined ? '' : String(v));
// A DATE COLUMN IS WRITTEN AS `YYYY-MM-DD`, never as a Date. See
// shared/fromAppointment.helper: pg serialises a Date in LOCAL time and
// the cast can land a day out. Same rule here.
const DAY = (v) => (v ? String(v).slice(0, 10) : null);

const label = (r) => [r.group_name, r.role_label, r.person_name, r.company].join(' · ');

function noteFor(month) {
  return `Recovered from the ${month} month snapshot on ${new Date().toISOString().slice(0, 10)}. `
    + 'Archived on arrival: it is here to be audited, not to be paid.';
}

async function snapshotRows(month) {
  const { rows } = await pool.query('SELECT rows FROM tb_month_snapshots WHERE month = $1', [month]);
  if (!rows.length) throw new Error(`no snapshot for ${month}`);
  const held = rows[0].rows;
  return Array.isArray(held) ? held : (held?.rows ?? []);
}

async function insertArchived(client, r, note) {
  const { rows } = await client.query(
    `INSERT INTO tb_mastersheet (
       sync_key, source, person_id, person_name, phone, role, seat, role_label,
       group_name, company, assigned_on, payment_start_on, preset_on, end_on,
       payable_days, monthly_amount, payable_amount, currency, payment_method,
       location, postcode, label, should_be_paid, paid, notes, bank_details,
       status, needs_review, review_reason, door_number, accepting_postals,
       account_number, sort_code, manually_overridden_fields,
       addon_percent, fee_percent, stopped_on, stopped_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11::date, $12::date, $13::date, $14::date,
       $15, $16, $17, $18, $19,
       $20, $21, $22, $23, $24, $25, $26,
       $27, false, '', $28, $29,
       $30, $31, '{}',
       $32, $33, CURRENT_DATE, $34
     ) RETURNING id`,
    [
      r.sync_key, AS.source, r.person_id, r.person_name, TXT(r.phone), r.role, r.seat, r.role_label,
      r.group_name, r.company, DAY(r.assigned_on), DAY(r.payment_start_on), DAY(r.preset_on), DAY(r.end_on),
      NUM(r.payable_days), NUM(r.monthly_amount), NUM(r.payable_amount), TXT(r.currency), TXT(r.payment_method),
      TXT(r.location), TXT(r.postcode), TXT(r.label), TXT(r.should_be_paid), TXT(r.paid), note, TXT(r.bank_details),
      r.status === 'ended' ? 'ended' : 'active', TXT(r.door_number), TXT(r.accepting_postals),
      TXT(r.account_number), TXT(r.sort_code), NUM(r.addon_percent), NUM(r.fee_percent), AS.stoppedReason,
    ],
  );
  return rows[0].id;
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (!opts.month) throw new Error('--month is required, e.g. --month 2026-08');

  const held = await snapshotRows(opts.month);

  if (opts.list) {
    const hits = held.filter((r) => [r.person_name, r.company, r.group_name]
      .some((v) => String(v ?? '').toLowerCase().includes(opts.list)));
    console.log(`${hits.length} in ${opts.month} matching "${opts.list}"`);
    hits.forEach((r) => console.log(`  ${r.sync_key}\n      ${label(r)}`));
    return;
  }
  if (opts.keys.length === 0) throw new Error('pass at least one --key, or --list <text> to find one');

  const byKey = new Map(held.map((r) => [r.sync_key, r]));
  const note = noteFor(opts.month);

  // WHOLE OR NOTHING. Three rows recovered and the fourth failing on a
  // constraint would leave a half-done audit nobody could tell apart from
  // a complete one.
  const client = await pool.connect();
  try {
    if (opts.write) await client.query('BEGIN');
    for (const key of opts.keys) {
      const r = byKey.get(key);
      if (!r) { console.log(`NOT IN ${opts.month}  ${key}`); continue; }

      const { rows: seen } = await client.query('SELECT id FROM tb_mastersheet WHERE sync_key = $1', [key]);
      if (seen.length) { console.log(`ALREADY THERE  id ${seen[0].id}  ${label(r)}`); continue; }

      if (!opts.write) { console.log(`WOULD RECOVER  ${label(r)}\n      ${key}`); continue; }

      const id = await insertArchived(client, r, note);
      await client.query(
        `INSERT INTO tb_mastersheet_changes (row_id, person_name, field, old_value, new_value, changed_via)
         VALUES ($1, $2, $3, '', $4, $5)`,
        [id, r.person_name, AS.field, `${label(r)} (${opts.month} snapshot)`, AS.changedVia],
      );
      console.log(`RECOVERED  id ${id}  ${label(r)}`);
    }
    if (opts.write) await client.query('COMMIT');
    else console.log('\nNothing was written. Add --write to do it.');
  } catch (err) {
    if (opts.write) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error(err.message); process.exit(1); });
