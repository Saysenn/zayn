/**
 * HELD OUT 2, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Ironleaf is in a CVL (Leonard Curtis), Harbor Nine is under a winding up
 * order (Official Receiver), each with the paper that step leaves behind.
 * Quarry Lane was closed three weeks ago, its deals stopped. Pinecrest and
 * Brightwell are active, and so is Ironleigh, the one look-alike name.
 * Dates are relative to today. Every write is checked in the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DEALS } from './seed.mjs';

const require = createRequire(import.meta.url);
const { currentDay } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

const API_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DOCS_ROOT = process.env.LIQUIDATION_DOCS_DIR || path.join(API_DIR, 'storage/liquidations');
const seedState = {};

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoIn = (n) => new Date(Date.parse(currentDay()) + n * 86_400_000).toISOString().slice(0, 10);
const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** How an admin types a day: "11 nov". */
const typedIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()].slice(0, 3).toLowerCase()}`; };
/** Any fair way of writing that day: "7 November", "7th Nov", "November 7", "07/11". */
const said = (n) => {
  const d = new Date(`${isoIn(n)}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return new RegExp(`\\b${day}(?:st|nd|rd|th)?(?: of)? ${m.slice(0, 3)}|\\b${m.slice(0, 3)}\\w* ${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b|${isoIn(n)}`, 'i');
};
const both = (a, b) => new RegExp(`(?=[\\s\\S]*(?:${a.source}))(?=[\\s\\S]*(?:${b.source}))`, 'i');

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
  const rel = `${row.id}/zzheld2-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

// ---------- checks ----------
const liq = async (db, key) => (await db.query('SELECT *, deadline::text AS deadline_text FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const liveKept = (name) => async (db) => ((await live(db, name)) > 0 ? null : `${name} lost its live deals`);
const closed = (name) => all(statusIs(name, 'closed'), liveIs(name, 0));
const winding = (name) => all(statusIs(name, 'liquidation'), liveKept(name));
const liveAt = { ironleaf: 4, 'harbor nine': 3, pinecrest: 3, brightwell: 2, ironleigh: 1 };
// Read when the check runs, not when the file loads: the seed is not there yet.
const keptAsSeeded = (name) => async (db) => all(statusIs(name, seedStatus(name)), liveIs(name, liveAt[name]))(db);
const seedStatus = (name) => seedState.status.find((c) => c.name.toLowerCase() === name)?.status ?? 'active';
const deadlineIs = (key, iso) => async (db) => { const r = await liq(db, key); return r?.deadline_text === iso ? null : `${key} deadline ${r?.deadline_text}, not ${iso}`; };
const fieldLike = (key, field, re) => async (db) => { const r = await liq(db, key); return re.test(String(r?.[field] ?? '')) ? null : `${key} ${field} is "${r?.[field]}"`; };
// NOTHING MOVED: statuses, live deals, and every field on the winding down page.
const untouched = async (db) => {
  for (const s of seedState.liq) {
    const r = (await db.query('SELECT *, deadline::text AS deadline_text FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    if (!r) return `${s.company_key} winding down row gone`;
    for (const f of ['stage', 'stage_kind', 'next_action', 'liquidator', 'deadline_text']) {
      if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to ${r[f]}`;
    }
  }
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved to ${await status(db, c.name.toLowerCase())}`;
  for (const name of ['pinecrest', 'brightwell', 'ironleigh']) if ((await status(db, name)) !== seedStatus(name)) return `${name} status moved`;
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};

export async function extraSeed({ api, db }) {
  // The one look-alike: Ironleigh, a small active client.
  const otto = DEALS.find((d) => d.personName === 'Otto Fenn');
  const made = await api('POST', '/master-sheet', { ...otto, personName: 'Dara Finch', company: 'Ironleigh', roleLabel: 'Ops', monthlyAmount: 950 });
  if (made.status !== 201) throw new Error(`seed Ironleigh: ${made.status} ${JSON.stringify(made.body)}`);

  for (const key of ['ironleaf', 'harbor nine', 'quarry lane']) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );

  // IRONLEAF: creditors' voluntary liquidation, statement of affairs due.
  await set('ironleaf', { stage: 'own_liq', kind: 'cvl', deadline: isoIn(5), next: 'Send the statement of affairs to Leonard Curtis', liquidator: 'Leonard Curtis' });
  await putDoc(db, api, 'ironleaf', 'Notice of decision procedure - Ironleaf.pdf', pdf([
    'Ironleaf Ltd - Creditors\' voluntary liquidation',
    'Notice of a virtual meeting of creditors under Rule 6.14 of the Insolvency England and Wales Rules 2016.',
    `The virtual meeting of creditors will be held on ${longIn(12)} at 11.00am.`,
    `Creditors must lodge proofs of debt by 12 noon on ${longIn(11)}.`,
    `The director must deliver the statement of affairs and the company books and records to the proposed liquidator by ${longIn(5)}.`,
    'Proposed liquidator: Leonard Curtis, Manchester. Estimated deficiency to creditors: 41,300.00 GBP.',
  ]), 'application/pdf');

  // HARBOR NINE: HMRC got its winding up order; the Official Receiver is in.
  await set('harbor nine', { stage: 'hmrc_liq', kind: 'winding_up_order', deadline: isoIn(2), next: 'Return the Official Receiver questionnaire', liquidator: 'Official Receiver' });
  await putDoc(db, api, 'harbor nine', 'Winding up order - Harbor Nine.pdf', pdf([
    'In the High Court of Justice, Business and Property Courts - Insolvency and Companies List',
    `Winding up order made on ${longIn(-9)} on the petition of HM Revenue and Customs.`,
    'Debt: 27,640.18 GBP of unpaid PAYE, NIC and VAT.',
    'The Official Receiver is appointed liquidator of Harbor Nine Ltd. All company bank accounts are frozen from the date of the order.',
    `The director must complete and return the preliminary information questionnaire by ${longIn(2)}.`,
    `The director must attend an interview at the Official Receiver's office in Birmingham on ${longIn(16)}.`,
  ]), 'application/pdf');

  // QUARRY LANE: closed three weeks ago, every deal stopped with it.
  const closedOn = isoIn(-23);
  await db.query("DELETE FROM tb_liquidations WHERE company_key = 'quarry lane'");
  await db.query("UPDATE tb_companies SET status = 'closed', closed_on = $1 WHERE lower(name) = 'quarry lane'", [closedOn]);
  seedState.quarryIds = (await db.query("SELECT id FROM tb_mastersheet WHERE lower(btrim(company)) = 'quarry lane'")).rows.map((r) => r.id);
  seedState.closedOn = closedOn;
  await db.query("UPDATE tb_mastersheet SET stopped_on = $2, stopped_reason = 'company_closed' WHERE id = ANY($1::int[])", [seedState.quarryIds, closedOn]);

  for (let i = 0; i < 90; i += 1) {
    const { n } = (await db.query("SELECT count(*)::int n FROM tb_liquidation_docs WHERE read_status IN ('waiting','reading')")).rows[0];
    if (!n) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  seedState.liq = (await db.query('SELECT *, deadline::text AS deadline_text FROM tb_liquidations')).rows;
  seedState.status = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
  seedState.liveIds = (await db.query('SELECT id FROM tb_mastersheet WHERE stopped_on IS NULL')).rows.map((r) => r.id);
  seedState.reviewIds = (await db.query('SELECT id FROM tb_mastersheet WHERE review_monthly')).rows.map((r) => r.id);
}

const reset = {
  act: async ({ db }) => {
    for (const r of seedState.liq) {
      await db.query(
        'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, owner = $6, blamed = $7, liquidator = $8, note = $9, instructions = $10 WHERE id = $1',
        [r.id, r.stage, r.stage_kind, r.deadline_text, r.next_action, r.owner, r.blamed, r.liquidator, r.note, r.instructions],
      );
    }
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_liquidations WHERE NOT (id = ANY($1::int[]))', [seedState.liq.map((r) => r.id)]);
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    // A company with no record until a case set its status is active again.
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    // Quarry Lane stays closed: a reopen case brought its deals back.
    await db.query("UPDATE tb_mastersheet SET stopped_on = $2, stopped_reason = 'company_closed' WHERE id = ANY($1::int[])", [seedState.quarryIds, seedState.closedOn]);
    await db.query('UPDATE tb_mastersheet SET review_monthly = (id = ANY($1::int[]))', [seedState.reviewIds]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

// ================= READS =================
read('next step one, from the order', [
  { say: 'whats next for harbour nine', expect: { reply: both(/questionnaire/, said(2)), db: untouched } },
]);
read('next steps for everything winding down', [
  {
    say: 'wat do i need to do next on all the ones being wound up, from the docs',
    expect: { reply: both(both(/Ironleaf/, /Harbou?r Nine/), /statement of affairs|questionnaire/), noReply: /Pinecrest|Brightwell|Ironleigh/i, db: untouched },
  },
]);
read('this week', [
  { say: 'anything due this week on the closures stuff', expect: { reply: both(/Harbou?r Nine/, /Ironleaf/), noReply: /Pinecrest|Brightwell/i, db: untouched } },
]);
read('a closed company', [
  { say: 'quarry lane where is it at now', expect: { reply: /closed|shut|dissolved/i, noReply: /still (?:winding|active|trading)/i, db: untouched } },
]);
read('several, mixed', [
  {
    say: 'status on ironleaf quarry lane and pinecrest pls',
    expect: {
      reply: new RegExp([/Ironleaf/, /Quarry Lane/, /Pinecrest/, /closed/, /CVL|liquidat|winding|Leonard Curtis/].map((r) => `(?=[\\s\\S]*${r.source})`).join(''), 'i'),
      db: untouched,
    },
  },
]);
read('dates from the notice, follow up', [
  { say: 'whens the creditors meeting for ironleaf', expect: { reply: said(12), db: untouched } },
  { say: 'and the proofs deadline?', expect: { reply: said(11), db: untouched } },
]);
read('unknown name', [
  {
    say: 'whats happening with the cobalt ridge liquidation',
    expect: { reply: /can'?t find|couldn'?t find|cannot find|no (?:company|record|match)|not (?:on|in|found|one)|don'?t (?:see|have)|which company|did you mean/i, noReply: /Leonard Curtis|Official Receiver/i, db: untouched },
  },
]);
read('look-alike name', [
  {
    say: 'is ironleigh winding down too',
    expect: { reply: /\bno\b|\bnot\b|isn'?t|active|trading/i, noReply: /Leonard Curtis|statement of affairs|creditors'? meeting/i, db: untouched },
  },
]);
read('by person, then that one', [
  { say: 'which company is juno park at', expect: { reply: /Harbou?r Nine/i, db: untouched } },
  { say: 'whos the liquidator on that one', expect: { reply: /Official Receiver|\bOR\b/i, noReply: /Leonard Curtis/i, db: untouched } },
]);

// ================= WRITES =================
write('reopen a closed company', [
  { say: 'quarry lane is trading again apparently can we reopen it', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(statusIs('quarry lane', 'active'), liveIs('quarry lane', 2)) } },
]);
write('close one, wind down another', [
  { say: 'pinecrest can be closed off and put brightwell into winding down', expect: { db: untouched } },
  { say: 'yep both', expect: { db: all(closed('pinecrest'), winding('brightwell'), keptAsSeeded('ironleaf')) } },
]);
write('a no', [
  { say: 'close harbour nine', expect: { db: untouched } },
  { say: 'no leave it for now', expect: { db: untouched } },
]);
write('correction, then yes', [
  { say: 'close ironleaf', expect: { db: untouched } },
  { say: 'sorry not ironleaf i meant harbor nine', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('harbor nine'), keptAsSeeded('ironleaf')) } },
]);
write('undo a wind down', [
  { say: 'wind down pinecrest', expect: { db: untouched } },
  { say: 'yes', expect: { db: winding('pinecrest') } },
  { say: 'actually undo that', expect: { db: winding('pinecrest') } },
  { say: 'yes', expect: { db: all(statusIs('pinecrest', 'active'), liveIs('pinecrest', 3)) } },
]);
write('move a deadline, in words', [
  { say: `ironleaf deadline needs moving to ${typedIn(20)} leonard curtis gave us more time`, expect: { db: untouched } },
  { say: 'ok', expect: { db: all(deadlineIs('ironleaf', isoIn(20)), fieldLike('ironleaf', 'liquidator', /Leonard Curtis/i), statusIs('ironleaf', 'liquidation')) } },
]);
write('liquidator and next step, rambling', [
  {
    say: 'so harbor nine the OR handed it over, liquidator is Kroll now and the next thing is chase kroll for the asset list',
    expect: { db: untouched },
  },
  { say: 'yes go', expect: { db: all(fieldLike('harbor nine', 'liquidator', /Kroll/i), fieldLike('harbor nine', 'next_action', /asset/i), statusIs('harbor nine', 'liquidation')) } },
]);
write('auto mode: one wind down saves at once', [
  { say: 'brightwel is going under, wind it down', expect: { db: all(winding('brightwell'), keptAsSeeded('pinecrest')) } },
], true);
write('auto mode: a close still shows first', [
  { say: 'close down ironleaf now the meeting is booked', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('ironleaf'), statusIs('harbor nine', 'liquidation')) } },
], true);
write('auto mode: several at once still shows first', [
  { say: 'wind down pinecrest and brightwell both', expect: { db: untouched } },
  { say: 'go ahead', expect: { db: all(winding('pinecrest'), winding('brightwell')) } },
], true);
write('the one kiran is at', [
  { say: 'close the company kiran is at', expect: { reply: /which|Brightwell|Ironleaf|Harbou?r Nine/i, db: untouched } },
  { say: 'the harbor one', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('harbor nine'), keptAsSeeded('brightwell'), keptAsSeeded('ironleaf')) } },
]);
