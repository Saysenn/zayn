const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const pool = require('../../../configs/db');
const logger = require('../../../configs/logger');

// ***************************************************
// * RECEIPTS: KEPT WITH THEIR EXPENSE, ON THIS MACHINE, FOR THREE MONTHS
// ***************************************************
//
// His calls 2026-10-07:
//   - a receipt is kept with the expense it proves, on the CRM's own disk
//     (RECEIPTS_DIR), never a cloud bucket;
//   - only the current month and the two before are kept: on the 1st the
//     oldest month's folder goes, so the folder never grows. The EXPENSE is
//     never deleted with it, only its file (receipt_cleared_at says so);
//   - the same receipt FILE sent again is caught, months later too: its
//     fingerprint is a few bytes in tb_receipt_prints, kept forever (a
//     re-photographed one is caught by what is on it, check.js);
//   - RECEIPTS_BACKUP_DIR, when he sets it, gets a copy of the folder.
//
// A photo is shrunk (1600px, JPEG) before it is kept: still clearly
// readable, about 200–300 KB. A PDF or a sheet is kept exactly as sent.

const ROOT = process.env.RECEIPTS_DIR || path.join(__dirname, '../../../storage/receipts');
const PENDING = path.join(ROOT, '_pending');
const KEEP_MONTHS = 3;
const isImage = (mime) => /^image\//.test(String(mime ?? ''));
const extOf = (f) => (isImage(f.mime) ? 'jpg' : (String(f.filename ?? '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, ''));

/**
 * A RECEIPT'S FINGERPRINT: the exact bytes it arrived as (sha256). The same
 * file sent again (forwarded, re-sent, the same PDF) matches, forever.
 *
 * NOT A PICTURE HASH. Tried 2026-10-07 on the test receipts: a receipt is
 * mostly white paper, so light and compression flip a picture hash about as
 * much as a different receipt does (same ≥ 36 bits apart, different ≤ 35).
 * A RE-PHOTOGRAPHED receipt is caught instead by what is on it: the same
 * day, amount, currency and payee as a saved expense ("looks already
 * saved", check.js duplicates), which reads any month.
 */
async function fingerprint(file) {
  const buffer = Buffer.from(file.base64, 'base64');
  return { kind: 'file', print: crypto.createHash('sha256').update(buffer).digest('hex') };
}

/**
 * A file held while its preview is open, until "yes" or it expires. Photos
 * are shrunk here, once. Returns what the preview item carries.
 */
async function hold(file) {
  const { kind, print } = await fingerprint(file);
  let buffer = Buffer.from(file.base64, 'base64');
  if (isImage(file.mime)) {
    buffer = await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer().catch(() => buffer);
  }
  await fs.mkdir(PENDING, { recursive: true });
  const name = `${Date.now()}-${print.slice(0, 12)}.${extOf(file)}`;
  await fs.writeFile(path.join(PENDING, name), buffer);
  return { held: name, kind, print, mime: isImage(file.mime) ? 'image/jpeg' : file.mime, filename: file.filename ?? name };
}

/** SEEN BEFORE? The saved expense this exact file was the receipt of, or null. */
async function seenBefore(receipt) {
  if (!receipt?.print) return null;
  const { rows } = await pool.query(
    'SELECT e.id, e.spent_on, e.payee, e.currency, e.raw_amount FROM tb_receipt_prints p JOIN tb_expenses e ON e.id = p.expense_id WHERE p.print = $1 AND e.archived_at IS NULL ORDER BY p.id DESC LIMIT 1',
    [receipt.print],
  );
  return rows[0] ?? null;
}

/** On "yes": the held file goes to its month's folder and onto the expense. */
async function keep(receipt, expense) {
  if (!receipt?.held) return null;
  const month = String(expense.spent_on instanceof Date ? expense.spent_on.toISOString() : expense.spent_on).slice(0, 7);
  const rel = `${month}/${expense.id}-${receipt.print.slice(0, 8)}.${receipt.held.split('.').pop()}`;
  await fs.mkdir(path.join(ROOT, month), { recursive: true });
  // one file can prove several expenses (a sheet of 20): copied, not moved
  await fs.copyFile(path.join(PENDING, receipt.held), path.join(ROOT, rel));
  await pool.query('UPDATE tb_expenses SET receipt_path = $1 WHERE id = $2', [rel, expense.id]);
  await pool.query('INSERT INTO tb_receipt_prints (expense_id, kind, print) VALUES ($1, $2, $3)', [expense.id, receipt.kind, receipt.print]);
  return rel;
}

/**
 * AN EXPENSE TAKEN BACK TAKES ITS RECEIPT WITH IT (his call 2026-10-07):
 * the file is deleted and its fingerprint forgotten, so the same receipt
 * can be sent again as new. `row` is the expense as it was (needs id and
 * receipt_path). Never throws: a file already gone is fine.
 */
async function forget(row) {
  if (!row?.id) return;
  if (row.receipt_path) {
    const full = path.join(ROOT, row.receipt_path);
    if (full.startsWith(ROOT)) await fs.rm(full, { force: true }).catch(() => null);
  }
  await pool.query('DELETE FROM tb_receipt_prints WHERE expense_id = $1', [row.id]).catch(() => null);
}

/**
 * A REMOVED EXPENSE BROUGHT BACK (undo) gets its receipt back: the file was
 * kept for that, and its fingerprint moves to the new row. A file cleared
 * since (3 months) stays cleared.
 */
async function reattach(oldId, newId, receiptPath) {
  await pool.query('UPDATE tb_receipt_prints SET expense_id = $2 WHERE expense_id = $1', [oldId, newId]);
  if (!receiptPath) return;
  const exists = await fs.stat(path.join(ROOT, receiptPath)).then(() => true, () => false);
  if (exists) await pool.query('UPDATE tb_expenses SET receipt_path = $1 WHERE id = $2', [receiptPath, newId]);
}

/** The receipt file of a saved expense: { buffer, mime, filename } or why not. */
async function fileOf(expenseId) {
  const { rows } = await pool.query('SELECT receipt_path, receipt_cleared_at FROM tb_expenses WHERE id = $1', [expenseId]);
  const r = rows[0];
  if (!r) return { missing: 'no such expense' };
  if (!r.receipt_path) return { missing: r.receipt_cleared_at ? 'cleared' : 'none' };
  const full = path.join(ROOT, r.receipt_path);
  if (!full.startsWith(ROOT)) return { missing: 'none' };
  const buffer = await fs.readFile(full).catch(() => null);
  if (!buffer) return { missing: 'cleared' };
  const ext = r.receipt_path.split('.').pop();
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';
  return { buffer, mime, filename: path.basename(r.receipt_path) };
}

/** A held (not yet saved) file, for "show me the receipt for 4" before yes. */
async function heldFile(receipt) {
  if (!receipt?.held) return null;
  const buffer = await fs.readFile(path.join(PENDING, receipt.held)).catch(() => null);
  return buffer ? { buffer, mime: receipt.mime, filename: receipt.filename } : null;
}

const monthsKept = (today = new Date()) => {
  const out = [];
  for (let i = 0; i < KEEP_MONTHS; i += 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
};

/**
 * THE MONTHLY CLEAR: every month folder older than the current month and
 * the two before goes, its expenses marked cleared; held files from a
 * preview nobody answered go after a day. Safe to run any time, any
 * number of times.
 */
async function clearOld({ today = new Date() } = {}) {
  const keepSet = new Set(monthsKept(today));
  const entries = await fs.readdir(ROOT, { withFileTypes: true }).catch(() => []);
  const cleared = [];
  for (const e of entries) {
    if (!e.isDirectory() || !/^\d{4}-\d{2}$/.test(e.name) || keepSet.has(e.name) || e.name > [...keepSet][0]) continue;
    // eslint-disable-next-line no-await-in-loop
    await fs.rm(path.join(ROOT, e.name), { recursive: true, force: true });
    // eslint-disable-next-line no-await-in-loop
    await pool.query("UPDATE tb_expenses SET receipt_path = NULL, receipt_cleared_at = now() WHERE receipt_path LIKE $1", [`${e.name}/%`]);
    cleared.push(e.name);
  }
  const held = await fs.readdir(PENDING).catch(() => []);
  for (const name of held) {
    const at = Number(name.split('-')[0]);
    // eslint-disable-next-line no-await-in-loop
    if (at && Date.now() - at > 24 * 60 * 60 * 1000) await fs.rm(path.join(PENDING, name), { force: true });
  }
  if (cleared.length) logger.info({ cleared }, 'receipts: months cleared');
  return { cleared, kept: [...keepSet] };
}

/** A copy of the kept months to RECEIPTS_BACKUP_DIR, when he has set one. */
async function backupCopy() {
  const to = process.env.RECEIPTS_BACKUP_DIR;
  if (!to) return { skipped: 'RECEIPTS_BACKUP_DIR is not set' };
  const months = (await fs.readdir(ROOT, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name));
  for (const m of months) {
    // eslint-disable-next-line no-await-in-loop
    await fs.cp(path.join(ROOT, m.name), path.join(to, m.name), { recursive: true, force: false, errorOnExist: false });
  }
  // the backup keeps the same three months as the original
  const keepSet = new Set(monthsKept());
  for (const e of await fs.readdir(to, { withFileTypes: true }).catch(() => [])) {
    // eslint-disable-next-line no-await-in-loop
    if (e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name) && !keepSet.has(e.name) && e.name < [...keepSet].at(-1)) await fs.rm(path.join(to, e.name), { recursive: true, force: true });
  }
  return { copied: months.map((m) => m.name) };
}

/** Every 6 hours inside the CRM, like its database backup: clear, then copy. */
function startReceiptsKeeper() {
  const run = async () => {
    try {
      await clearOld();
      await backupCopy();
    } catch (err) {
      logger.error({ err: err.message }, 'receipts: the clear or the copy failed');
    }
  };
  setImmediate(run);
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = {
  hold, seenBefore, keep, forget, reattach, fileOf, heldFile, clearOld, backupCopy, startReceiptsKeeper, fingerprint, monthsKept, ROOT,
};
