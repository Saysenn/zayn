/**
 * LIQUIDATION DOCUMENTS, IN MASTER SHEET MODE AND LAWYER MODE. SUITE_SET=docs.
 *
 * His ask 2026-10-13: CRUD a company's documents from the chat (list, open,
 * save what was attached, rename, remove one or many, undo), and answer from
 * what they SAY, lawyer mode above all, read only. Every check reads the
 * database or her words against the documents' own text.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const READS = [];
export const WRITES = [];
export const PENDING = [];

const API_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DOCS_ROOT = process.env.LIQUIDATION_DOCS_DIR || path.join(API_DIR, 'storage/liquidations');
const CHAT_ROOT = process.env.CHAT_FILES_DIR || path.join(API_DIR, 'storage/chat-files');
const seed = {};

/** A real one page PDF with these lines of text. */
function pdf(lines) {
  const objs = [];
  const add = (x) => objs.push(x);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const body = `BT /F1 12 Tf 50 780 Td ${lines.map((l, i) => `${i ? '0 -20 Td ' : ''}(${l.replace(/[()\\]/g, '')}) Tj`).join(' ')} ET`;
  add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}

async function putDoc(db, api, key, name, buffer, mime) {
  const row = (await db.query('SELECT id FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
  const rel = `${row.id}/zzsuite-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
  return doc.id;
}

export async function extraSeed({ api, db }) {
  for (const key of ['quarry lane', 'pinecrest']) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  await db.query("UPDATE tb_liquidations SET stage = 'hmrc_liq', deadline = current_date + 6, liquidator = 'Begbies Traynor' WHERE company_key = 'quarry lane'");
  await putDoc(db, api, 'quarry lane', 'HMRC winding up petition.pdf', pdf([
    'HM Revenue and Customs - Winding up petition',
    'Company: Quarry Lane Ltd. Debt: 48,210.55 GBP of unpaid PAYE and NIC.',
    'The petition will be heard at the High Court on 21 November 2026.',
    'To stop the petition, pay the debt in full or contact HMRC Insolvency before 7 November 2026.',
  ]), 'application/pdf');
  await putDoc(db, api, 'quarry lane', 'call notes.txt', Buffer.from(
    'Call with Begbies Traynor: the liquidator wants 12 months of bank statements and the payroll records by 30 October.',
  ), 'text/plain');
  await putDoc(db, api, 'pinecrest', 'creditors list.csv', Buffer.from(
    'Creditor,Amount,Type\nHMRC,19500.00,Preferential\nNorthbank,12000.00,Secured\nOffice landlord,3500.00,Unsecured\n',
  ), 'text/csv');
  // every one read before a case runs
  for (let i = 0; i < 90; i += 1) {
    const { n } = (await db.query("SELECT count(*)::int n FROM tb_liquidation_docs WHERE read_status IN ('waiting','reading')")).rows[0];
    if (!n) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  seed.docs = (await db.query('SELECT * FROM tb_liquidation_docs')).rows;
  seed.liq = (await db.query('SELECT * FROM tb_liquidations')).rows;
}

const reset = {
  act: async ({ db }) => {
    const ids = seed.docs.map((d) => d.id);
    await db.query('DELETE FROM tb_liquidation_docs WHERE NOT (id = ANY($1::int[]))', [ids]);
    for (const d of seed.docs) {
      // the file back where it was, if a case moved it aside
      const aside = (await db.query('SELECT stored_path FROM tb_liquidation_docs WHERE id = $1', [d.id])).rows[0]?.stored_path;
      if (aside && aside !== d.stored_path && fs.existsSync(path.join(DOCS_ROOT, aside))) {
        fs.mkdirSync(path.dirname(path.join(DOCS_ROOT, d.stored_path)), { recursive: true });
        fs.renameSync(path.join(DOCS_ROOT, aside), path.join(DOCS_ROOT, d.stored_path));
      }
      await db.query('UPDATE tb_liquidation_docs SET file_name = $2, stored_path = $3, removed_at = NULL WHERE id = $1', [d.id, d.file_name, d.stored_path]);
    }
    for (const r of seed.liq) await db.query('UPDATE tb_liquidations SET stage = $2, deadline = $3, note = $4 WHERE id = $1', [r.id, r.stage, r.deadline, r.note]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, extra = {}) => WRITES.push({ name, turns: [reset, ...turns], ...extra });
const read = (name, turns, extra = {}) => READS.push({ name, turns, ...extra });

const docsOf = async (db, key) => (await db.query(
  `SELECT d.file_name FROM tb_liquidation_docs d JOIN tb_liquidations l ON l.id = d.liquidation_id
    WHERE l.company_key = $1 AND d.removed_at IS NULL ORDER BY d.id`, [key],
)).rows.map((r) => r.file_name);
const untouched = async (db) => {
  const q = await docsOf(db, 'quarry lane');
  const p = await docsOf(db, 'pinecrest');
  return q.length === 2 && p.length === 1 ? null : `documents changed: ${JSON.stringify({ q, p })}`;
};

// ================= MASTER SHEET MODE: reading =================
read('list a company\'s documents', [
  { say: 'what documents does quarry lane have?', expect: { tools: ['liquidation_document'], reply: /winding up petition[\s\S]*call notes|call notes[\s\S]*winding up petition/i } },
]);
read('open one in the chat', [
  { say: 'open the hmrc petition for quarry lane', expect: { files: /winding up petition/i } },
]);
read('answer from what a document says', [
  { say: 'what does the hmrc petition for quarry lane say about the hearing?', expect: { reply: /21 November/i } },
]);
read('a figure from a spreadsheet document', [
  { say: "according to pinecrest's creditors list, how much do we owe hmrc?", expect: { reply: /19,?500/ } },
]);

// ================= LAWYER MODE: reading only =================
read('lawyer mode reads the petition and guides', [
  { say: "what is HMRC's winding up petition against quarry lane asking us to do, and by when?", expect: { reply: /7 November/i } },
], { context: 'hmrc' });
read('lawyer mode knows our liquidations', [
  { say: 'which of our companies in liquidation has the nearest deadline, and who is the liquidator?', expect: { reply: /Quarry Lane[\s\S]*Begbies|Begbies[\s\S]*Quarry Lane/i } },
], { context: 'hmrc' });
write('lawyer mode changes nothing', [
  { say: 'remove the call notes from quarry lane', expect: { reply: /master sheet|Liquidations page|Winding down page/i, db: untouched } },
], { context: 'hmrc' });

// ================= MASTER SHEET MODE: changing =================
let chatFileId = null;
write('save a file attached in the chat onto a company', [
  {
    act: async ({ db }) => {
      chatFileId = crypto.randomUUID();
      fs.mkdirSync(CHAT_ROOT, { recursive: true });
      const buf = pdf(['Statement of affairs - Pinecrest Ltd', 'Total liabilities: 35,000.00 GBP']);
      fs.writeFileSync(path.join(CHAT_ROOT, `${chatFileId}.pdf`), buf);
      await db.query('INSERT INTO tb_chat_files (id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5)',
        [chatFileId, 'Statement of affairs.pdf', `${chatFileId}.pdf`, 'application/pdf', buf.length]);
    },
  },
  {
    say: 'save this to pinecrest',
    attachment: () => ({ filename: 'Statement of affairs.pdf', fileId: chatFileId, files: [{ filename: 'Statement of affairs.pdf', fileId: chatFileId }] }),
    expect: { db: untouched },
  },
  { say: 'yes', expect: { db: async (db) => ((await docsOf(db, 'pinecrest')).includes('Statement of affairs.pdf') ? null : `pinecrest has ${await docsOf(db, 'pinecrest')}`) } },
]);
write('remove one, then undo puts it back', [
  { say: 'remove the call notes from quarry lane', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await docsOf(db, 'quarry lane')).some((n) => /call notes/i.test(n)) ? 'not removed' : null) } },
  { say: 'undo that', expect: { db: async (db) => ((await docsOf(db, 'quarry lane')).some((n) => /call notes/i.test(n)) ? null : 'not back') } },
]);
write('rename one', [
  { say: 'rename the call notes on quarry lane to Begbies call 12 Oct', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await docsOf(db, 'quarry lane')).includes('Begbies call 12 Oct.txt') ? null : `names ${await docsOf(db, 'quarry lane')}`) } },
]);
write('remove several at once', [
  { say: "remove both of quarry lane's documents", expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await docsOf(db, 'quarry lane')).length === 0 ? null : `left ${await docsOf(db, 'quarry lane')}`) } },
]);
