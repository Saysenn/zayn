const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-'));
process.env.RECEIPTS_DIR = DIR;
const receipts = require('./receipts');
const { categoryOf } = require('./check');
const { readReply } = require('./reply');

const photo = path.join(__dirname, '../../../../../docs/test/receipt-07-amazon.png');
const b64 = (buf) => buf.toString('base64');

test('THE SAME FILE SENT AGAIN has the same fingerprint; another file does not', async () => {
  const a = await receipts.fingerprint({ mime: 'image/png', base64: b64(fs.readFileSync(photo)) });
  const again = await receipts.fingerprint({ mime: 'image/png', base64: b64(fs.readFileSync(photo)) });
  const other = await receipts.fingerprint({ mime: 'image/jpeg', base64: b64(fs.readFileSync(path.join(__dirname, '../../../../../docs/test/receipt-01-carrefour.jpg'))) });
  assert.equal(a.print, again.print);
  assert.notEqual(a.print, other.print);
});

test('A RECEIPT IS HELD: a photo shrunk to JPEG, a PDF kept as sent', async () => {
  const held = await receipts.hold({ filename: 'amazon.png', mime: 'image/png', base64: b64(fs.readFileSync(photo)) });
  assert.match(held.held, /\.jpg$/);
  assert.equal(held.mime, 'image/jpeg');
  assert.ok(fs.statSync(path.join(DIR, '_pending', held.held)).size > 1000);
  const pdf = await receipts.hold({ filename: 'bill.pdf', mime: 'application/pdf', base64: b64(Buffer.from('%PDF-1.4 x')) });
  assert.match(pdf.held, /\.pdf$/);
  assert.equal((await receipts.heldFile(pdf)).buffer.toString(), '%PDF-1.4 x');
});

test('A CATEGORY BY ITS WORDS when the reading gave none', () => {
  assert.equal(categoryOf({ description: 'Fuel', payee: 'ENOC' }), 'fuel');
  assert.equal(categoryOf({ description: 'Taxi to office', payee: 'Careem' }), 'travel');
  assert.equal(categoryOf({ description: 'Lunch', payee: 'Shake Shack' }), 'food');
  assert.equal(categoryOf({ description: 'Electricity & water', payee: 'DEWA' }), 'bills');
  assert.equal(categoryOf({ description: 'Printer ink', payee: 'Amazon' }), 'office');
  assert.equal(categoryOf({ description: 'Gift', payee: 'Someone' }), 'other');
});

test('"4 IS TRAVEL" sets the category', () => {
  const pending = { kind: 'add', items: [1, 2, 3, 4].map((n) => ({ n, missing: [], doubts: [] })) };
  assert.deepEqual(readReply('4 is travel', pending), { kind: 'fix', parts: [{ which: [4], fixes: [{ field: 'category', value: 'travel' }] }], ok: [] });
});

test('THE 3 MONTH CLEAR keeps the current month and the two before, and nothing else', async () => {
  for (const m of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    fs.mkdirSync(path.join(DIR, m), { recursive: true });
    fs.writeFileSync(path.join(DIR, m, '1-a.jpg'), 'x');
  }
  // the database half is stubbed: only the files are under test here
  const pool = require('../../../configs/db');
  const real = pool.query;
  const marked = [];
  pool.query = async (sql, params) => { marked.push(params?.[0]); return { rows: [] }; };
  try {
    const out = await receipts.clearOld({ today: new Date('2026-10-15T00:00:00Z') });
    assert.deepEqual(out.kept, ['2026-10', '2026-09', '2026-08']);
    assert.deepEqual(out.cleared.sort(), ['2026-06', '2026-07']);
    assert.deepEqual(fs.readdirSync(DIR).filter((d) => /^\d/.test(d)).sort(), ['2026-08', '2026-09', '2026-10']);
    // each month is read (what is still owed) and then marked: the same two months
    assert.deepEqual([...new Set(marked)].sort(), ['2026-06/%', '2026-07/%'], 'their expenses are marked cleared, never deleted');
  } finally {
    pool.query = real;
    fs.rmSync(DIR, { recursive: true, force: true });
  }
});
