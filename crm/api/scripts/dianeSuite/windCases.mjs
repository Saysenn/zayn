/**
 * WINDING DOWN, END TO END. SUITE_SET=wind.
 *
 * His ask 2026-10-21: Diane checks each winding down company's documents and
 * tells us the next step, and keeps the page's stages and statuses right,
 * however messy the request. Five companies, one at each kind of step, each
 * with the paper that step leaves behind. Dates are relative to today so the
 * set never goes stale. Every write is checked in the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentDay } = require('../../v1/shared/presetMonth.helper');
const { dayFrom } = require('../../v1/shared/dayWords.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

const API_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DOCS_ROOT = process.env.LIQUIDATION_DOCS_DIR || path.join(API_DIR, 'storage/liquidations');
const seedState = {};

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoIn = (n) => new Date(Date.parse(currentDay()) + n * 86_400_000).toISOString().slice(0, 10);
/** "7 November 2026", n days from today. */
const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** Her words for that day: "7 November", "7 Nov", "07/11". */
const said = (n) => saidIso(isoIn(n));
const saidIso = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return new RegExp(`\\b${day}(?:st|nd|rd|th)? ${m.slice(0, 3)}|\\b${m} ${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b`, 'i');
};
const day = (words) => dayFrom(words, currentDay());
// Ironleaf goes 2 months after its First Gazette notice (20 days ago).
const struckOn = () => { const d = new Date(`${isoIn(-20)}T00:00:00Z`); const m = d.getUTCMonth() + 2; d.setUTCMonth(m); if (d.getUTCMonth() !== m % 12) d.setUTCDate(0); return d.toISOString().slice(0, 10); };

/** A real one page PDF with these lines of text. */
function pdf(lines) {
  const objs = [];
  const add = (x) => objs.push(x);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const body = `BT /F1 10 Tf 40 790 Td ${lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${l.replace(/[()\\]/g, '')}) Tj`).join(' ')} ET`;
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
  const rel = `${row.id}/zzwind-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

const PAGE = ['quarry lane', 'pinecrest', 'ironleaf', 'harbor nine', 'brightwell'];
const liq = async (db, key) => (await db.query('SELECT * FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const stageIs = (key, stage, kind) => async (db) => {
  const r = await liq(db, key);
  if (r.stage !== stage) return `${key} stage ${r.stage}, not ${stage}`;
  if (kind !== undefined && r.stage_kind !== kind) return `${key} kind ${r.stage_kind}, not ${kind}`;
  return null;
};
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const liveKept = (name) => async (db) => ((await live(db, name)) > 0 ? null : `${name} lost its live deals`);
// NOTHING ON THE PAGE MOVED: every stage, kind, deadline, next action and status as seeded.
const untouched = async (db) => {
  for (const s of seedState.liq) {
    const r = (await db.query('SELECT * FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    for (const f of ['stage', 'stage_kind', 'next_action', 'owner', 'liquidator']) {
      if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to ${r[f]}`;
    }
    if (String(r.deadline ?? '').slice(0, 10) !== String(s.deadline ?? '').slice(0, 10)) return `${s.company_key} deadline moved`;
  }
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved`;
  return null;
};

export async function extraSeed({ api, db }) {
  for (const key of PAGE) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, fields) => db.query(
    `UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1`,
    [key, fields.stage ?? null, fields.kind ?? null, fields.deadline ?? null, fields.next ?? '', fields.liquidator ?? ''],
  );
  // QUARRY LANE: HMRC petitioned. Pay before the hearing or it is wound up.
  await set('quarry lane', { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(6), next: 'Chase Begbies for the bank statements', liquidator: 'Begbies Traynor' });
  await putDoc(db, api, 'quarry lane', 'HMRC winding up petition.pdf', pdf([
    'HM Revenue and Customs - Winding up petition',
    'Company: Quarry Lane Ltd. Debt: 48,210.55 GBP of unpaid PAYE and NIC.',
    `The petition will be heard at the High Court on ${longIn(31)}.`,
    `To stop the petition, pay the debt in full or contact HMRC Insolvency before ${longIn(17)}.`,
  ]), 'application/pdf');
  await putDoc(db, api, 'quarry lane', 'call notes.txt', Buffer.from(
    `Call with Begbies Traynor: the adviser wants 12 months of bank statements and the payroll records by ${longIn(9)}.`,
  ), 'text/plain');
  // PINECREST: on the page with no stage, but its paper is a CVL's.
  await set('pinecrest', {});
  await putDoc(db, api, 'pinecrest', 'Statement of affairs.pdf', pdf([
    'Pinecrest Ltd - Creditors\' voluntary liquidation',
    `Statement of affairs as at ${longIn(-5)}.`,
    'Total liabilities: 35,000.00 GBP. Assets: 4,200.00 GBP.',
    `Creditors' decision procedure by virtual meeting on ${longIn(12)}.`,
    'Proposed liquidator: FRP Advisory.',
  ]), 'application/pdf');
  // IRONLEAF: Companies House's own strike off proposal.
  await set('ironleaf', { stage: 'active_proposal', kind: 'compulsory' });
  await putDoc(db, api, 'ironleaf', 'First Gazette notice.pdf', pdf([
    'The Gazette - Companies House - First Gazette notice for compulsory strike-off',
    'The Registrar of Companies gives notice that, unless cause is shown to the contrary,',
    `at the expiration of 2 months from ${longIn(-20)} the name of Ironleaf Ltd will be struck off`,
    'the register and the company will be dissolved.',
    `Reason: confirmation statement overdue since ${longIn(-70)}.`,
  ]), 'application/pdf');
  // HARBOR NINE: the page says petition, but the court has made the order.
  await set('harbor nine', { stage: 'hmrc_liq', kind: 'petition' });
  await putDoc(db, api, 'harbor nine', 'Winding up order.pdf', pdf([
    'In the High Court of Justice, Insolvency and Companies List',
    `On ${longIn(-7)} the court ordered that Harbor Nine Ltd be wound up on the petition of HMRC.`,
    'The Official Receiver is the liquidator of the company.',
    `The directors must submit a statement of affairs to the Official Receiver within 21 days of ${longIn(-7)}.`,
  ]), 'application/pdf');
  // BRIGHTWELL: our strike off, held by HMRC's objection.
  await set('brightwell', { stage: 'strike_off_suspended' });
  await putDoc(db, api, 'brightwell', 'HMRC objection.pdf', pdf([
    'HM Revenue and Customs objects to the striking off of Brightwell Ltd.',
    'Unpaid VAT: 6,200.00 GBP. The strike off is suspended while this is outstanding.',
    `Pay the VAT or agree a payment plan with HMRC by ${longIn(25)}.`,
  ]), 'application/pdf');
  for (let i = 0; i < 90; i += 1) {
    const { n } = (await db.query("SELECT count(*)::int n FROM tb_liquidation_docs WHERE read_status IN ('waiting','reading')")).rows[0];
    if (!n) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  seedState.liq = (await db.query('SELECT * FROM tb_liquidations')).rows;
  seedState.status = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
  seedState.liveIds = (await db.query('SELECT id FROM tb_mastersheet WHERE stopped_on IS NULL')).rows.map((r) => r.id);
  seedState.reviewIds = (await db.query('SELECT id FROM tb_mastersheet WHERE review_monthly')).rows.map((r) => r.id);
}

const reset = {
  act: async ({ db }) => {
    for (const r of seedState.liq) {
      await db.query(
        'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, owner = $6, blamed = $7, liquidator = $8, note = $9, instructions = $10 WHERE id = $1',
        [r.id, r.stage, r.stage_kind, r.deadline, r.next_action, r.owner, r.blamed, r.liquidator, r.note, r.instructions],
      );
    }
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    await db.query('UPDATE tb_mastersheet SET review_monthly = (id = ANY($1::int[]))', [seedState.reviewIds]);
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_liquidations WHERE NOT (id = ANY($1::int[]))', [seedState.liq.map((r) => r.id)]);
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    // A company with no record until a case set its status is active again.
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

// ================= BASIC: the next step for one company =================
read('next step, plain', [
  { say: 'whats next for quarry lane', expect: { tools: ['liquidation_next_step'], reply: said(17), db: untouched } },
]);
read('next step, typos and slang', [
  { say: 'wats nxt w/ quary lane??', expect: { tools: ['liquidation_next_step'], reply: /Quarry Lane/i, db: untouched } },
]);
read('what to do and by when, an objection', [
  { say: 'brightwell, hmrc objected to the strike off. what do we do and by when', expect: { tools: ['liquidation_next_step'], reply: /6,?200[\s\S]*|VAT/i, db: untouched } },
]);
read('the by-when of an objection', [
  { say: 'brightwell - whats the deadline to sort hmrc out', expect: { tools: ['liquidation_next_step'], reply: said(25), db: untouched } },
]);

// ================= MIDDLE: the documents against the page =================
read('the documents say more than the page', [
  { say: 'pinecrest - check the docs n tell me where we are', expect: { tools: ['liquidation_next_step'], reply: /CVL|creditors'? voluntary/i, db: untouched } },
]);
read('is the page right', [
  { say: 'harbor nine, is the page right on its stage?', expect: { reply: /winding[\s-]?up order|Official Receiver/i, db: untouched } },
]);
read('a date worked out from the paper', [
  { say: 'if we do nothing when does ironleaf actually get struck off', expect: { reply: saidIso(struckOn()), db: untouched } },
]);
read('a figure from the paper, still', [
  { say: 'how much does pinecrest owe in total according to the statement of affairs', expect: { reply: /35,?000/, db: untouched } },
]);

// ================= ADVANCED: the whole page =================
read('every company, what needs doing', [
  { say: 'go thru all the winding down companies and tell me what needs doing', expect: { tools: ['liquidation_next_step'], reply: /(?=[\s\S]*Quarry Lane)(?=[\s\S]*Pinecrest)(?=[\s\S]*Ironleaf)(?=[\s\S]*Harbor Nine)(?=[\s\S]*Brightwell)/i, db: untouched } },
]);
read('the most urgent one', [
  { say: 'which winding down company is most urgent right now and why', expect: { tools: ['liquidation_next_step'], noTools: ['list_liquidations'], reply: /Quarry Lane/i, noReply: /^\d+ companies in liquidation/i, db: untouched } },
]);
read('a messy morning brief', [
  { say: 'morning diane, quick one, whats outstanding on the closures this week? anything due', expect: { tools: ['liquidation_next_step'], reply: /Quarry Lane/i, db: untouched } },
]);

// ================= WRITES: the stage from the documents =================
write('one company from its documents', [
  { say: 'pinecrest docs say its a cvl right? if so update the page', expect: { db: untouched } },
  { say: 'yes', expect: { db: stageIs('pinecrest', 'own_liq', 'cvl') } },
]);
write('every stage from the documents', [
  { say: 'update all the stages on the winding down page from the docs', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    stageIs('pinecrest', 'own_liq', 'cvl'), stageIs('harbor nine', 'hmrc_liq', 'winding_up_order'),
    stageIs('quarry lane', 'hmrc_liq', 'petition'), stageIs('ironleaf', 'active_proposal', 'compulsory'), stageIs('brightwell', 'strike_off_suspended'),
  ) } },
]);
write('the next step, then make it the next action', [
  { say: 'whats next for pinecrest', expect: { db: untouched } },
  { say: 'ok put that as its next action, deadline the meeting date', expect: {} },
  { say: 'yes', expect: { db: async (db) => {
    const r = await liq(db, 'pinecrest');
    if (!r.next_action) return 'no next action saved';
    return String(r.deadline ?? '').slice(0, 10) === isoIn(12) ? null : `deadline ${r.deadline}, not ${isoIn(12)}`;
  } } },
]);

// ================= WRITES: messy news =================
write('wound up, with a next action and a deadline', [
  { say: 'harbor nine got wound up by the court, next action send records to the official receiver, deadline in 2 weeks', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageIs('harbor nine', 'hmrc_liq', 'winding_up_order'), async (db) => {
    const r = await liq(db, 'harbor nine');
    if (!/official receiver/i.test(r.next_action)) return `next action "${r.next_action}"`;
    return String(r.deadline).slice(0, 10) === day('in 2 weeks') ? null : `deadline ${r.deadline}`;
  }) } },
  { say: 'undo that', expect: {} },
  { say: 'yes', expect: { db: stageIs('harbor nine', 'hmrc_liq', 'petition') } },
]);
write('objection withdrawn, the strike off is back on', [
  { say: 'brightwell paid hmrc off so the objections withdrawn, strike off is back on', expect: { db: untouched } },
  { say: 'yes', expect: { db: stageIs('brightwell', 'active_proposal', null) } },
]);
write('petition dismissed, off the page', [
  { say: 'quarry lane paid hmrc in full and the petition got dismissed, its trading fine now, take it off winding down', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(statusIs('quarry lane', 'active'), liveKept('quarry lane')) } },
]);
write('dissolved after the liquidation', [
  { say: 'harbor nine is done, dissolved after the liquidation', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageIs('harbor nine', 'dissolved', 'after_liquidation'), statusIs('harbor nine', 'closed'), liveIs('harbor nine', 0)) } },
]);
write('a call logged and its day the deadline', [
  { say: 'log: rang begbies re quarry lane, they want payroll by friday. make friday the deadline', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => {
    const c = (await db.query("SELECT c.body FROM tb_liquidation_comms c JOIN tb_liquidations l ON l.id = c.liquidation_id WHERE l.company_key = 'quarry lane'")).rows;
    if (!c.some((x) => /payroll/i.test(x.body))) return 'no contact line';
    const r = await liq(db, 'quarry lane');
    return String(r.deadline).slice(0, 10) === day('friday') ? null : `deadline ${r.deadline}, not ${day('friday')}`;
  } } },
]);
write('three companies in one breath', [
  { say: 'ironleaf - we filed the confirmation statement so companies house cancelled the strike off; brightwell liquidator is grant thornton; pinecrest liquidator is frp advisory', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageIs('ironleaf', 'strike_off_rejected'), async (db) => {
    if (!/grant thornton/i.test((await liq(db, 'brightwell')).liquidator)) return 'brightwell liquidator not saved';
    return /frp/i.test((await liq(db, 'pinecrest')).liquidator) ? null : 'pinecrest liquidator not saved';
  }) } },
]);
write('an objection suspends the strike off', [
  { say: 'someone objected, ironleaf strike off is suspended now', expect: { db: untouched } },
  { say: 'yes', expect: { db: stageIs('ironleaf', 'strike_off_suspended', null) } },
]);
write('a status move by its news', [
  { say: 'ironleaf got struck off, its gone', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageIs('ironleaf', 'dissolved', 'struck_off'), statusIs('ironleaf', 'closed'), liveIs('ironleaf', 0)) } },
]);
