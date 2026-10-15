/**
 * THE NEW CAPABILITIES, ASKED THE WAY PEOPLE ASK. SUITE_SET=night.
 *
 * His ask 2026-10-13 (overnight): test everything Diane gained today, in
 * messy words: a company's details, its documents (list, open, download,
 * save from the chat, rename, remove, undo), answers from what the
 * documents say (PDF, text, CSV, Word, Excel), lawyer mode reading only,
 * days said in full and real bullets. Every write is checked in the
 * database; every read against the documents' own text.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const ExcelJS = require('exceljs');

/**
 * RANDOM WORDING, AND A HELD-OUT POOL (his call 2026-10-13: "unbiased test
 * and randomized conversation"). Each ask has phrasings people really use;
 * a run picks one at random (SUITE_SEED repeats a run). Fixes are made
 * against the `dev` pool only; SUITE_POOL=holdout asks in words nobody tuned
 * for, which is the honest score.
 */
const SEED = Number(process.env.SUITE_SEED ?? Math.floor(Math.random() * 1e9));
const POOL = process.env.SUITE_POOL === 'holdout' ? 'holdout' : 'dev';
let rng = SEED;
const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
// eslint-disable-next-line no-console
console.log(`night set: pool ${POOL}, seed ${SEED}`);
const YES = () => ask(['yes', 'yep', 'go ahead', 'yes please', 'do it'], ['yeah go on', 'ok do it', 'sure, go ahead', 'yes that is right', 'confirm']);
const ask = (dev, holdout) => { const list = POOL === 'holdout' ? holdout : dev; return list[Math.floor(rand() * list.length)]; };

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

/** A real Word file with these paragraphs. */
async function docx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A real Excel file with these rows. */
async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
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
  await db.query(`UPDATE tb_liquidations SET stage = 'hmrc_liq', deadline = current_date + 5, liquidator = 'Begbies Traynor',
    next_action = 'Send 12 months of bank statements', instructions = 'Gather bank statements and payroll records' WHERE company_key = 'quarry lane'`);
  await db.query("UPDATE tb_liquidations SET stage = 'own_liq', deadline = current_date + 20, liquidator = 'FRP Advisory' WHERE company_key = 'pinecrest'");
  await putDoc(db, api, 'quarry lane', 'HMRC winding up petition.pdf', pdf([
    'HM Revenue and Customs - Winding up petition',
    'Company: Quarry Lane Ltd. Debt: 48,210.55 GBP of unpaid PAYE and NIC.',
    'The petition will be heard at the High Court on 21 November 2026.',
    'To stop the petition, pay the debt in full or contact HMRC Insolvency before 7 November 2026.',
  ]), 'application/pdf');
  await putDoc(db, api, 'quarry lane', 'call notes.txt', Buffer.from(
    'Call with Begbies Traynor: the liquidator wants 12 months of bank statements and the payroll records by 30 October.',
  ), 'text/plain');
  await putDoc(db, api, 'quarry lane', 'Begbies engagement letter.docx', await docx([
    'Begbies Traynor - Letter of engagement for Quarry Lane Ltd',
    'Our fixed fee for the creditors voluntary liquidation is 6,500 GBP plus VAT.',
    'Half of the fee is payable on signing, the balance on appointment.',
  ]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await putDoc(db, api, 'pinecrest', 'creditors list.csv', Buffer.from(
    'Creditor,Amount,Type\nHMRC,19500.00,Preferential\nNorthbank,12000.00,Secured\nOffice landlord,3500.00,Unsecured\n',
  ), 'text/csv');
  await putDoc(db, api, 'pinecrest', 'statement of affairs.xlsx', await xlsx([
    ['Item', 'Amount GBP'], ['Cash at bank', 2150], ['Debtors', 8400], ['Total assets', 10550], ['Total liabilities', 35000], ['Deficiency', -24450],
  ]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  for (let i = 0; i < 120; i += 1) {
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
      const aside = (await db.query('SELECT stored_path FROM tb_liquidation_docs WHERE id = $1', [d.id])).rows[0]?.stored_path;
      if (aside && aside !== d.stored_path && fs.existsSync(path.join(DOCS_ROOT, aside))) {
        fs.mkdirSync(path.dirname(path.join(DOCS_ROOT, d.stored_path)), { recursive: true });
        fs.renameSync(path.join(DOCS_ROOT, aside), path.join(DOCS_ROOT, d.stored_path));
      }
      await db.query('UPDATE tb_liquidation_docs SET file_name = $2, stored_path = $3, removed_at = NULL WHERE id = $1', [d.id, d.file_name, d.stored_path]);
    }
    for (const r of seed.liq) {
      await db.query('UPDATE tb_liquidations SET stage = $2, deadline = $3, note = $4, next_action = $5, liquidator = $6, instructions = $7 WHERE id = $1',
        [r.id, r.stage, r.deadline, r.note, r.next_action, r.liquidator, r.instructions]);
    }
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, extra = {}) => WRITES.push({ name, turns: [reset, ...turns], ...extra });
const read = (name, turns, extra = {}) => READS.push({ name, turns, ...extra });

const docsOf = async (db, key) => (await db.query(
  `SELECT d.file_name FROM tb_liquidation_docs d JOIN tb_liquidations l ON l.id = d.liquidation_id
    WHERE l.company_key = $1 AND d.removed_at IS NULL ORDER BY d.id`, [key],
)).rows.map((r) => r.file_name);
const QL = ['HMRC winding up petition.pdf', 'call notes.txt', 'Begbies engagement letter.docx'];
const PC = ['creditors list.csv', 'statement of affairs.xlsx'];
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const untouched = async (db) => {
  const q = await docsOf(db, 'quarry lane');
  const p = await docsOf(db, 'pinecrest');
  return same(q, QL) && same(p, PC) ? null : `documents changed: ${JSON.stringify({ q, p })}`;
};
const liqRow = async (db, key) => (await db.query('SELECT stage, deadline::text AS deadline, next_action, note FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];

/** A file waiting in the chat, as the paperclip leaves it. */
function chatFile(name, buffer, mime) {
  const id = crypto.randomUUID();
  return {
    id,
    make: async (db) => {
      fs.mkdirSync(CHAT_ROOT, { recursive: true });
      const ext = path.extname(name);
      fs.writeFileSync(path.join(CHAT_ROOT, `${id}${ext}`), buffer);
      await db.query('INSERT INTO tb_chat_files (id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5)', [id, name, `${id}${ext}`, mime, buffer.length]);
    },
    attachment: { filename: name, fileId: id },
  };
}

// Short day names cut her speech ("Sun" read as the word).
const SHORT_DAY = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? \d/;
// Markdown markers the chat strips, leaving a bare list.
const BARE_LIST = /^\s*(?:-|\d+\.)\s/m;

// ================= READING: details, lists, opening =================
read('a company in plain words', [
  { say: ask(["what's going on with quarry lane?", 'any update on quarry lane', 'whats the latest with quarry lane'], ['where are we with quarry lane?', 'give me the rundown on quarry lane', 'tell me everything about quarry lane', 'show me quarry lane in full', 'any update on quarry lane']), expect: { reply: /Begbies/i, noReply: SHORT_DAY, files: /petition/i } },
]);
read('the deadline, said in full', [
  { say: ask(['when is quarry lanes deadline', "what's the deadline for quarry lane", 'quarry lane deadline?'], ['when does quarry lane have to be done by', 'remind me of the quarry lane deadline', 'how long have we got on quarry lane']), expect: { reply: /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/, noReply: SHORT_DAY } },
]);
read('a typo in the ask still lists', [
  { say: ask(['list pinecrests docs', 'what files do we have for pinecrest', 'show pinecrest documents'], ['which documents are on pinecrest?', 'pinecrest docs pls', 'what paperwork have we got for pinecrest']), expect: { reply: /creditors list[\s\S]*statement of affairs|statement of affairs[\s\S]*creditors list/i, files: /creditors/i, noReply: BARE_LIST } },
]);
read('open one, loosely named', [
  { say: ask(['can u pull up the call notes for quarry lane', 'open the call notes on quarry lane', 'show me the quarry lane call notes'], ['bring up the call notes for quarry lane', 'i need to see the call notes for quarry lane', 'let me see quarry lanes call notes']), expect: { files: /call notes/i } },
]);
read('send every one', [
  { say: ask(['send me every doc quarry lane has', 'open all of quarry lanes documents', 'show me all the quarry lane files'], ['give me all the docs for quarry lane', 'all quarry lane documents please', 'can i see everything we have on file for quarry lane']), expect: { files: /engagement letter/i } },
]);
read('download all as one', [
  { say: ask(["download all of pinecrest's documents", 'zip up the pinecrest docs', 'download pinecrests files'], ['i want to download everything for pinecrest', 'get me a zip of pinecrest documents', 'download the pinecrest paperwork']), expect: { files: /statement of affairs/i, reply: /Download all/i } },
]);
read('a document that is not there', [
  { say: ask(['open the hmrc letter for pinecrest', 'show me the hmrc letter on pinecrest'], ['pull up the hmrc notice for pinecrest', 'where is pinecrests hmrc letter']), expect: { noReply: /^\s*(?:here is|here's|here are)\b/i } },
]);
read('every company in liquidation', [
  { say: ask(['show me all the companies in liquidation', 'which companies are in liquidation', 'list the liquidations'], ['what companies are we winding up', 'who is in liquidation right now', 'run me through all the liquidations']), expect: { reply: /Quarry Lane[\s\S]*Pinecrest|Pinecrest[\s\S]*Quarry Lane/i, noReply: BARE_LIST } },
]);

// ================= READING: what the documents say =================
read('a figure from a CSV', [
  { say: ask(['according to the creditors list, who does pinecrest owe the most?', 'who is the biggest creditor on pinecrests creditors list', 'per pinecrests creditors list, how much is owed to hmrc'], ['looking at the pinecrest creditors list, whos owed the most', 'from pinecrests creditors list which creditor is largest and how much', 'whats hmrc owed according to the pinecrest creditors list']), expect: { reply: /HMRC[\s\S]*19,?500|19,?500[\s\S]*HMRC/i } },
]);
read('the right document with no company named', [
  { say: ask(['what did begbies ask for on the call?', 'what does begbies want from us', 'what did the liquidator ask for on the call notes'], ['remind me what begbies needs from us', 'on the call, what did begbies request', 'what have begbies asked us to send']), expect: { reply: /bank statements/i } },
]);
read('a date from a PDF', [
  { say: ask(['when is the court hearing for the hmrc petition', 'when is the petition hearing', 'what date is the hmrc petition heard'], ['when do we go to court on the petition', 'what is the hearing date in the winding up petition', 'when is the high court hearing for quarry lane']), expect: { reply: /21 November/i } },
]);
read('a total from an Excel file', [
  { say: ask(["what are pinecrest's total liabilities on the statement of affairs?", 'total liabilities on the pinecrest statement of affairs?', 'what does the statement of affairs say pinecrest owes in total'], ['how much are pinecrests liabilities per the statement of affairs', 'in the statement of affairs, what is the total liabilities figure for pinecrest', 'whats the liabilities total on pinecrests statement of affairs']), expect: { reply: /35,?000/ } },
]);
read('a fee from a Word file', [
  { say: ask(['how much is begbies charging quarry lane', 'what is the fee in the begbies engagement letter', 'whats begbies fee'], ['what does the engagement letter say the fee is', 'how much will begbies cost us for quarry lane', 'what are begbies charging']), expect: { reply: /6,?500/ } },
]);

// ================= LAWYER MODE: reading only =================
read('lawyer mode plans from the documents', [
  { say: ask(['based on our documents, what deadlines are coming up for quarry lane and what should we do first?', 'from the quarry lane documents, what dates matter and what do we do first?'], ['looking at quarry lanes paperwork, what are the key dates and our next step?', 'what do the quarry lane documents say we must do and by when?']), expect: { reply: /7 November|21 November/i } },
], { context: 'hmrc' });
read('lawyer mode reads a spreadsheet document', [
  { say: ask(['per our creditors list, what does pinecrest owe hmrc?', 'how much does pinecrest owe hmrc on the creditors list'], ['on the pinecrest creditors list, what is the hmrc debt?', 'what is pinecrests hmrc debt according to our records']), expect: { reply: /19,?500/ } },
], { context: 'hmrc' });
write('lawyer mode will not rename', [
  { say: ask(['rename the call notes on quarry lane to begbies call', 'delete the call notes from quarry lane'], ['remove quarry lanes call notes', 'change the call notes name on quarry lane to begbies call']), expect: { reply: /master sheet|Liquidations page|Winding down page/i, db: untouched } },
], { context: 'hmrc' });

// ================= CHANGING: saving from the chat =================
const one = chatFile('Board minutes.pdf', pdf(['Board minutes - Pinecrest Ltd', 'The directors resolved to enter voluntary liquidation.']), 'application/pdf');
write('save one attachment, said loosely', [
  { act: async ({ db }) => one.make(db) },
  { say: ask(['put this on pinecrest pls', 'save this to pinecrest', 'add this to pinecrests documents'], ['file this under pinecrest', 'upload this to pinecrest', 'attach this to pinecrest please']), attachment: one.attachment, expect: { db: untouched } },
  { say: YES(), expect: { db: async (db) => ((await docsOf(db, 'pinecrest')).includes('Board minutes.pdf') ? null : `pinecrest has ${await docsOf(db, 'pinecrest')}`) } },
]);
const two = [
  chatFile('bank statement March.pdf', pdf(['Northbank statement March 2026']), 'application/pdf'),
  chatFile('payroll records.csv', Buffer.from('Name,Gross\nA,2000\n'), 'text/csv'),
];
write('save two attachments at once', [
  { act: async ({ db }) => { for (const f of two) await f.make(db); } },
  {
    say: ask(['file these under quarry lane', 'save these to quarry lane', 'put these on quarry lane'], ['add these files to quarry lane', 'upload both to quarry lane', 'store these on quarry lanes documents']),
    attachment: { filename: two[0].attachment.filename, fileId: two[0].id, files: two.map((f) => ({ filename: f.attachment.filename, fileId: f.id })) },
    expect: { db: untouched },
  },
  { say: YES(), expect: { db: async (db) => { const q = await docsOf(db, 'quarry lane'); return q.includes('bank statement March.pdf') && q.includes('payroll records.csv') ? null : `quarry lane has ${q}`; } } },
]);
write('save with nothing attached', [
  { say: ask(['save this to quarry lane', 'put this on quarry lane'], ['file this under quarry lane', 'add this to quarry lane docs']), expect: { db: untouched, noReply: /^\s*saved to\b/i } },
]);

// ================= CHANGING: rename, remove, undo, change of mind =================
write('rename, company named', [
  { say: ask(["rename quarry lane's call notes to Begbies call 12 Oct", 'rename the call notes on quarry lane to Begbies call 12 Oct'], ['on quarry lane, rename call notes to Begbies call 12 Oct', 'call notes for quarry lane should be called Begbies call 12 Oct']), expect: { db: untouched } },
  { say: YES(), expect: { db: async (db) => ((await docsOf(db, 'quarry lane')).includes('Begbies call 12 Oct.txt') ? null : `names ${await docsOf(db, 'quarry lane')}`) } },
]);
write('rename, no company named', [
  { say: ask(['rename the hmrc petition to HMRC winding up petition 2026', 'rename the winding up petition to HMRC winding up petition 2026'], ['the hmrc petition should be renamed HMRC winding up petition 2026', 'change the petitions name to HMRC winding up petition 2026']), expect: { db: untouched } },
  { say: YES(), expect: { db: async (db) => ((await docsOf(db, 'quarry lane')).includes('HMRC winding up petition 2026.pdf') ? null : `names ${await docsOf(db, 'quarry lane')}`) } },
]);
write('delete, then undo', [
  { say: ask(['delete the creditors list from pinecrest', 'remove pinecrests creditors list'], ['bin the creditors list on pinecrest', 'take the creditors list off pinecrest']), expect: { db: untouched } },
  { say: YES(), expect: { db: async (db) => ((await docsOf(db, 'pinecrest')).includes('creditors list.csv') ? 'not removed' : null) } },
  { say: ask(['actually undo that', 'undo that'], ['put it back', 'oops, undo please']), expect: { db: async (db) => ((await docsOf(db, 'pinecrest')).includes('creditors list.csv') ? null : 'not back') } },
]);
write('change of mind before yes', [
  { say: ask(["remove both of pinecrest's docs", 'delete all pinecrest documents'], ['get rid of both pinecrest files', 'clear out the pinecrest documents']), expect: { db: untouched } },
  { say: ask(['no wait, cancel that', 'actually no, leave them'], ['hold on, dont do that', 'scrap that, keep them']), expect: { db: untouched } },
]);

// ================= CHANGING: the liquidation itself =================
write('three changes in one breath', [
  { say: ask(['set quarry lane to own liq, next action chase begbies for the statements, and note that the director is abroad', 'quarry lane: stage own liq, next action chase begbies for the statements, note the director is abroad'], ['move quarry lane to own liq, make the next action chase begbies for the statements, and add a note that the director is abroad', 'for quarry lane change the stage to own liq, next action chase begbies for the statements, note director is abroad']), expect: { db: async (db) => ((await liqRow(db, 'quarry lane')).stage === 'hmrc_liq' ? null : 'written before yes') } },
  { say: YES(), expect: { db: async (db) => { const r = await liqRow(db, 'quarry lane'); return r.stage === 'own_liq' && /chase begbies/i.test(r.next_action ?? '') && /abroad/i.test(r.note ?? '') ? null : JSON.stringify(r); } } },
]);
write('a deadline in words', [
  { say: ask(["push pinecrest's deadline to the end of the month", 'move pinecrests deadline to end of this month'], ['pinecrest deadline should be the end of the month', 'change the pinecrest deadline to the last day of this month']), expect: { reply: /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/, noReply: SHORT_DAY } },
  { say: YES(), expect: { db: async (db) => { const r = await liqRow(db, 'pinecrest'); const d = new Date(); const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); return r.deadline === end ? null : `deadline ${r.deadline}, expected ${end}`; } } },
]);
