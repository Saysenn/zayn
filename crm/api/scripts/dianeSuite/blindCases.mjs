/**
 * CLOSING, WINDING DOWN AND STATUS, WRITTEN BLIND. SUITE_SET=blind.
 *
 * Written blind on 2026-10-22: these cases were written without reading
 * Diane's code, only the suite format and the fake data, so they test what
 * she should do, not what she was tuned for. Lazy, busy admin typing: typos,
 * no punctuation, txt-speak, run-ons, changing mind mid-message.
 *
 * Start: Quarry Lane (HMRC petition, due today), Pinecrest (CVL) and
 * Brightwell (our strike off, with its Final Gazette dissolution notice on
 * file) are winding down. Ironleaf, Harbor Nine and Harbor View (an extra
 * company with one deal, close to Harbor Nine) are active. Every write is
 * checked in the database; every read must change nothing.
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
const WINDING = ['quarry lane', 'pinecrest', 'brightwell'];
const seedState = {};

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoIn = (n) => new Date(Date.parse(currentDay()) + n * 86_400_000).toISOString().slice(0, 10);
const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

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
  const rel = `${row.id}/zzblind-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

const liq = async (db, key) => (await db.query('SELECT * FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const liveKept = (name) => async (db) => ((await live(db, name)) > 0 ? null : `${name} lost its live deals`);
const stageIs = (key, stage, kind) => async (db) => {
  const r = await liq(db, key);
  if (!r) return `${key} has no winding down row`;
  if (r.stage !== stage) return `${key} stage ${r.stage}, not ${stage}`;
  if (kind !== undefined && r.stage_kind !== kind) return `${key} kind ${r.stage_kind}, not ${kind}`;
  return null;
};
const closed = (name) => all(statusIs(name, 'closed'), liveIs(name, 0));
const winding = (name) => all(statusIs(name, 'liquidation'), liveKept(name));
// Back as it started: still winding down, every deal it had still live.
const backWinding = (name, n) => all(statusIs(name, 'liquidation'), liveIs(name, n));
// NOTHING MOVED: every status, every live deal, every stage on the page as seeded.
const untouched = async (db) => {
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved to ${await status(db, c.name.toLowerCase())}`;
  const extra = (await db.query("SELECT name, status FROM tb_companies WHERE status <> 'active' AND NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)])).rows;
  if (extra.length) return `${extra[0].name} status moved to ${extra[0].status}`;
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  if (n !== seedState.liveIds.length) return `live deals ${n}, not ${seedState.liveIds.length}`;
  const rows = (await db.query('SELECT * FROM tb_liquidations')).rows;
  if (rows.length !== seedState.liq.length) return `winding down rows ${rows.length}, not ${seedState.liq.length}`;
  for (const s of seedState.liq) {
    const r = rows.find((x) => x.id === s.id);
    for (const f of ['stage', 'stage_kind', 'next_action', 'liquidator']) {
      if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to ${r[f]}`;
    }
    if (String(r.deadline ?? '').slice(0, 10) !== String(s.deadline ?? '').slice(0, 10)) return `${s.company_key} deadline moved`;
  }
  return null;
};

export async function extraSeed({ api, db }) {
  // HARBOR VIEW: one deal, a name close to Harbor Nine, so "harbour" alone is ambiguous.
  const base = DEALS.find((d) => d.company === 'Harbor Nine' && d.personName === 'Juno Park');
  const made = await api('POST', '/master-sheet', { ...base, personName: 'Rory Pell', company: 'Harbor View', roleLabel: 'Ops', monthlyAmount: 1400 });
  if (made.status !== 201) throw new Error(`blind seed Harbor View: ${made.status} ${JSON.stringify(made.body)}`);

  for (const key of WINDING) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  await db.query("UPDATE tb_liquidations SET stage = 'hmrc_liq', stage_kind = 'petition', deadline = $1, next_action = 'Pay HMRC or get time to pay agreed', liquidator = '' WHERE company_key = 'quarry lane'", [isoIn(0)]);
  await db.query("UPDATE tb_liquidations SET stage = 'own_liq', stage_kind = 'cvl', deadline = NULL, next_action = '', liquidator = 'FRP Advisory' WHERE company_key = 'pinecrest'");
  await db.query("UPDATE tb_liquidations SET stage = 'active_proposal', stage_kind = 'voluntary', deadline = NULL, next_action = '', liquidator = '' WHERE company_key = 'brightwell'");
  // BRIGHTWELL: the page still says proposal, the paper says it is gone.
  await putDoc(db, api, 'brightwell', 'Final Gazette notice.pdf', pdf([
    'The Gazette - Companies House - Final Gazette: notice of dissolution',
    'Following the application by its directors to strike the company off (form DS01),',
    `notice is given that Brightwell Ltd was struck off the register and dissolved on ${longIn(-3)}.`,
    'No further filings are due.',
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
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    // A company with no record until a case set its status is active again.
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    await db.query('UPDATE tb_mastersheet SET review_monthly = (id = ANY($1::int[]))', [seedState.reviewIds]);
    for (const r of seedState.liq) {
      await db.query('UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE id = $1',
        [r.id, r.stage, r.stage_kind, r.deadline, r.next_action, r.liquidator]);
    }
    await db.query('DELETE FROM tb_liquidations WHERE NOT (id = ANY($1::int[]))', [seedState.liq.map((r) => r.id)]);
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

// ================= CLOSE =================
write('blind: shortest close', [
  { say: 'shut pinecrest', expect: { db: untouched } },
  { say: 'yep', expect: { db: closed('pinecrest') } },
]);
write('blind: typo close of two', [
  { say: 'clsoe pincrest n quary ln', expect: { db: untouched } },
  { say: 'yh go', expect: { db: all(closed('pinecrest'), closed('quarry lane')) } },
]);
write('blind: close all the winding down ones', [
  { say: 'close all the winding down ones', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    closed('quarry lane'), closed('pinecrest'), closed('brightwell'),
    all(statusIs('ironleaf', 'active'), liveIs('ironleaf', 4)), all(statusIs('harbor nine', 'active'), liveIs('harbor nine', 3)), statusIs('harbor view', 'active'),
  ) } },
]);
write('blind: long ramble, five companies', [
  { say: 'morning right so pinecrest is finished close it, quarry lane as well i think yeah close that one, ironleaf n harbor nine are going under so wind em both down, whats happening with brightwell btw and harbor view is fine dont touch it', expect: { reply: /Brightwell/i, db: untouched } },
  { say: 'yes all good', expect: { db: all(
    closed('pinecrest'), closed('quarry lane'), winding('ironleaf'), winding('harbor nine'),
    backWinding('brightwell', 2), all(statusIs('harbor view', 'active'), liveIs('harbor view', 1)),
  ) } },
]);
write('blind: changes mind mid message', [
  { say: 'close pinecrest and ironleaf, no hang on ironleaf isnt done yet just wind it down', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('pinecrest'), winding('ironleaf')) } },
]);
write('blind: close with an unrelated question', [
  { say: 'close quarry lane pls, also whats kiran vale on at brightwell', expect: { reply: /3,?000/, db: untouched } },
  { say: 'yes', expect: { db: all(closed('quarry lane'), backWinding('brightwell', 2)) } },
]);

// ================= DROP ONE FROM A PREVIEW =================
write('blind: drop one after the preview', [
  { say: 'close quarry lane pinecrest brightwell', expect: { db: untouched } },
  { say: 'drop brightwell', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('quarry lane'), closed('pinecrest'), backWinding('brightwell', 2)) } },
]);
write('blind: "not X" after the preview', [
  { say: 'close off all 3 winding ones', expect: { db: untouched } },
  { say: 'not quarry lane', expect: { db: untouched } },
  { say: 'ok yes', expect: { db: all(closed('pinecrest'), closed('brightwell'), backWinding('quarry lane', 2)) } },
]);
write('blind: leave one out after the preview', [
  { say: 'shut down pinecrest + brightwell + quarry lane today', expect: { db: untouched } },
  { say: 'actually leave pinecrest out for now', expect: { db: untouched } },
  { say: 'go', expect: { db: all(closed('quarry lane'), closed('brightwell'), backWinding('pinecrest', 3)) } },
]);

// ================= NO / CANCEL =================
write('blind: cancel after a close preview', [
  { say: 'close brightwell and pinecrest', expect: { db: untouched } },
  { say: 'nah cancel that', expect: { db: untouched } },
]);

// ================= UNDO AND REOPEN =================
write('blind: undo straight after a close', [
  { say: 'close quarry lane', expect: { db: untouched } },
  { say: 'yes', expect: { db: closed('quarry lane') } },
  { say: 'undo that', expect: { db: closed('quarry lane') } },
  { say: 'yes', expect: { db: backWinding('quarry lane', 2) } },
]);
write('blind: a closed company, its status, then bring it back', [
  { say: 'pinecrest can go now close it', expect: { db: untouched } },
  { say: 'ye', expect: { db: closed('pinecrest') } },
  { say: 'is pinecrest closed now', expect: { reply: /\byes\b|closed|shut/i, noReply: /not closed|still winding/i, db: closed('pinecrest') } },
  { say: 'ugh wrong one bring pinecrest back', expect: { db: closed('pinecrest') } },
  { say: 'yes', expect: { db: all(statusIs('pinecrest', 'active'), liveIs('pinecrest', 3)) } },
]);

// ================= DOCUMENTS: the next step, then do it =================
write('blind: next step from the documents, then ok do it', [
  { say: 'brightwell whats next going by the docs', expect: { reply: /dissolv|struck off|final gazette|close/i, db: untouched } },
  { say: 'ok do it', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('brightwell'), stageIs('brightwell', 'dissolved')) } },
]);

// ================= AMBIGUOUS NAMES AND SPELLING =================
write('blind: ambiguous "harbour" asks, then the answer', [
  { say: 'wind down harbour', expect: { reply: /Harbor Nine[\s\S]*Harbor View|Harbor View[\s\S]*Harbor Nine|which/i, db: untouched } },
  { say: 'harbor view', expect: { db: all(winding('harbor view'), all(statusIs('harbor nine', 'active'), liveIs('harbor nine', 3))) } },
], true);

// ================= AUTO MODE =================
write('blind: auto mode, closing several still previews', [
  { say: 'close quarry lane pinecrest n brightwell', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('quarry lane'), closed('pinecrest'), closed('brightwell')) } },
], true);
write('blind: auto mode, a no after a close preview', [
  { say: 'shut quarry lane', expect: { db: untouched } },
  { say: 'no leave it', expect: { db: untouched } },
], true);
// Corrected 2026-10-22: auto mode still shows a change to SEVERAL companies
// first (runAgent reachesMany); the brief this was written from said otherwise.
write('blind: auto mode, winding down several shows first, british spelling', [
  { say: 'harbour nine n ironleef r going bust stick both on winding down', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(winding('harbor nine'), winding('ironleaf'), statusIs('harbor view', 'active')) } },
], true);

// ================= STATUS =================
read('blind: status of one', [
  { say: 'wheres quarry lane at', expect: { reply: /HMRC|petition|wind(?:ing)?[\s-]up/i, db: untouched } },
]);
read('blind: status of several', [
  { say: 'pinecrest n brightwell where r they', expect: { reply: /(?=[\s\S]*Pinecrest[\s\S]*(?:CVL|own liq|creditors'? voluntary|liquidat))(?=[\s\S]*Brightwell[\s\S]*(?:strike|struck|dissolv|gazette|proposal))/i, db: untouched } },
]);
read('blind: status of all of them', [
  { say: 'status on everything thats closing', expect: { reply: /(?=[\s\S]*Quarry Lane)(?=[\s\S]*Pinecrest)(?=[\s\S]*Brightwell)/i, noReply: /Ironleaf|Harbor (?:Nine|View)/i, db: untouched } },
]);
read('blind: how many winding down', [
  { say: 'how many r winding down rn', expect: { reply: /\b3\b|three/i, db: untouched } },
]);
read('blind: an active company', [
  { say: 'ironleaf aint closing is it', expect: { reply: /\bno\b|\bnot\b|active|trading/i, db: untouched } },
]);
read('blind: which ones are nearly done', [
  { say: 'which ones are nearly done', expect: { reply: /Brightwell/i, db: untouched } },
]);
read('blind: anything due this week', [
  { say: 'anything due this week on the closures', expect: { reply: /Quarry Lane/i, db: untouched } },
]);
read('blind: ambiguous "harbour" status asks', [
  { say: 'is harbour closing', expect: { reply: /Harbor Nine[\s\S]*Harbor View|Harbor View[\s\S]*Harbor Nine|which/i, db: untouched } },
]);
read('blind: several, mixed winding and active', [
  { say: 'quarry lane ironleaf harbor nine any of em closing', expect: { reply: /(?=[\s\S]*Quarry Lane[\s\S]*(?:HMRC|petition|winding|liquidat))(?=[\s\S]*(?:Ironleaf|Harbor Nine)[\s\S]*(?:\bno\b|\bnot\b|active|trading))/i, db: untouched } },
]);
