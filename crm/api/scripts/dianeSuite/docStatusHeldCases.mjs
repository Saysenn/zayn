/**
 * DOC STATUS HELD OUT, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Same behaviour as the dev set, different companies, documents and wording.
 * Five invented companies, each given two live deals here, each winding down
 * with its own paperwork. Every write is checked in the database.
 *
 * Page vs documents at seed time (T = today):
 *   Saltmarsh Kitchens  page HMRC liq / petition          doc: winding-up order made T-8        -> behind
 *   Fenwick Joinery     page Active proposal / compulsory doc: Final Gazette dissolved T-6      -> behind (dissolved)
 *   Copperbeck Studio   page Liquidation (no kind)        doc: CVL, liquidator appointed T-4    -> behind
 *   Larkspur Print      page Active proposal / voluntary  doc: First Gazette, "unless cause"    -> right
 *   Tidewell Freight    page HMRC liq / petition          docs: petition notice T+16 + call note -> right
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

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
/** "14 November 2026", n days from today. */
const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** Any fair way of saying that day: "14 November", "14th Nov", "November 14", "14/11", "2026-11-14". */
const said = (n) => {
  const iso = isoIn(n);
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return new RegExp(`\\b${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${m.slice(0, 3)}|\\b${m.slice(0, 3)}[a-z]*\\.?\\s+${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b|${iso}`, 'i');
};

/** A real one page PDF with these lines of text (plain ASCII only). */
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
  const rel = `${row.id}/zzdocheld-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

import { DEALS } from './seed.mjs';

const PAGE = ['saltmarsh kitchens', 'fenwick joinery', 'copperbeck studio', 'larkspur print', 'tidewell freight'];
const NEW_DEALS = [
  ['Rhea Lindqvist', 'Saltmarsh Kitchens', 'Chef'], ['Owen Pike', 'Saltmarsh Kitchens', 'KP'],
  ['Tamsin Rowe', 'Fenwick Joinery', 'Director'], ['Dev Malhotra', 'Fenwick Joinery', 'Joiner'],
  ['Lucia Brenner', 'Copperbeck Studio', 'Designer'], ['Amos Kettle', 'Copperbeck Studio', 'Admin'],
  ['Freya Oduya', 'Larkspur Print', 'Printer'], ['Calum Stroud', 'Larkspur Print', 'Sales'],
  ['Nadia Velez', 'Tidewell Freight', 'Driver'], ['Hugo Marsh', 'Tidewell Freight', 'Accounts'],
];
const liq = async (db, key) => (await db.query('SELECT * FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const stageIs = (key, stage, kind) => async (db) => {
  const r = await liq(db, key);
  if (!r) return `${key} has no winding down row`;
  if (r.stage !== stage) return `${key} stage ${r.stage}, not ${stage}`;
  if (kind !== undefined && (r.stage_kind ?? null) !== kind) return `${key} kind ${r.stage_kind}, not ${kind}`;
  return null;
};
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const liveKept = (name) => async (db) => ((await live(db, name)) > 0 ? null : `${name} lost its live deals`);
/** Still winding down, on this stage, deals live. */
const movedTo = (key, stage, kind) => all(stageIs(key, stage, kind), statusIs(key, 'liquidation'), liveKept(key));
/** Dissolved: closed, every live deal stopped as company_closed. */
const dissolved = (key, kind) => all(
  stageIs(key, 'dissolved', kind),
  statusIs(key, 'closed'),
  liveIs(key, 0),
  async (db) => {
    const { n } = (await db.query(
      "SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NOT NULL AND stopped_reason <> 'company_closed' AND id = ANY($2::int[])",
      [key, seedState.liveIds],
    )).rows[0];
    return n ? `${key} deals stopped for a reason other than company_closed` : null;
  },
);
/** This company exactly as seeded. */
const asSeeded = (key) => async (db) => {
  const s = seedState.liq.find((r) => r.company_key === key);
  const r = await liq(db, key);
  for (const f of ['stage', 'stage_kind', 'next_action', 'liquidator']) {
    if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${key} ${f} moved to ${r[f]}`;
  }
  const c = seedState.status.find((x) => x.name.toLowerCase() === key);
  if (c && (await status(db, key)) !== c.status) return `${key} status moved`;
  return null;
};
// NOTHING MOVED: every stage, kind, deadline, next action, liquidator, status and live deal as seeded.
const untouched = async (db) => {
  for (const s of seedState.liq) {
    const r = (await db.query('SELECT * FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    if (!r) return `${s.company_key} winding down row gone`;
    for (const f of ['stage', 'stage_kind', 'next_action', 'owner', 'liquidator']) {
      if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to ${r[f]}`;
    }
    if (String(r.deadline ?? '').slice(0, 10) !== String(s.deadline ?? '').slice(0, 10)) return `${s.company_key} deadline moved`;
  }
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved`;
  const { n } = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0];
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};
// She must not claim she saved anything when nothing was saved.
const NO_SAVE_CLAIM = /\bI(?:'ve| have) (?:now )?(?:updated|saved|changed|moved|marked|closed|dissolved)\b|\b(?:updated|saved)(?: it)?[.!]?\s*$/i;

export async function extraSeed({ api, db }) {
  const base = DEALS.find((d) => d.currency === 'GBP' && !d.feePercent && d.endOn === DEALS[1].endOn) || DEALS[1];
  for (const [personName, company, roleLabel] of NEW_DEALS) {
    const r = await api('POST', '/master-sheet', { ...base, personName, company, roleLabel, groupName: 'CORVID', monthlyAmount: 1800, phone: undefined });
    if (r.status !== 201) throw new Error(`held seed ${personName}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const key of PAGE) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );

  // SALTMARSH KITCHENS: page says petition; the order was made at Manchester.
  await set('saltmarsh kitchens', { stage: 'hmrc_liq', kind: 'petition', next: 'Await hearing outcome' });
  await putDoc(db, api, 'saltmarsh kitchens', 'Order for winding up - Manchester.pdf', pdf([
    'IN THE HIGH COURT OF JUSTICE        BUSINESS AND PROPERTY COURTS IN MANCHESTER',
    'INSOLVENCY AND COMPANIES LIST (ChD)        Case No. 1127 of 2026',
    'SALTMARSH KITCHENS LTD   Registered office: Unit 4, Ancoats Works, Manchester M4 6DE',
    `Upon hearing the petition of HM Revenue and Customs on ${longIn(-8)}, before District Judge Khan,`,
    'and upon the company not appearing,',
    'THE COURT ORDERS that Saltmarsh Kitchens Ltd be wound up under the Insolvency Act 1986.',
    'The Official Receiver, Public Interest Unit Manchester, is liquidator of the company by virtue of this order.',
    'The directors must provide a statement of affairs to the Official Receiver within 21 days of being asked.',
  ]), 'application/pdf');

  // FENWICK JOINERY: page says strike-off proposal; the Final Gazette says dissolved.
  await set('fenwick joinery', { stage: 'active_proposal', kind: 'compulsory', next: 'Object or let it go' });
  await putDoc(db, api, 'fenwick joinery', 'Gazette - struck off and dissolved.pdf', pdf([
    'The Gazette   Notice type: Final Gazette   Companies Act 2006, s.1000',
    `Publication date: ${longIn(-6)}`,
    'The Registrar of Companies gives notice that the companies listed below have been',
    'STRUCK OFF THE REGISTER and are now DISSOLVED.',
    '  FENWICK JOINERY LIMITED   09811402',
    'Any property or rights vested in a dissolved company are deemed bona vacantia and belong to the Crown.',
  ]), 'application/pdf');

  // COPPERBECK STUDIO: page says liquidation, kind not said. It is a CVL.
  await set('copperbeck studio', { stage: 'liquidation', next: 'Wait for the IP to confirm' });
  await putDoc(db, api, 'copperbeck studio', 'Kingsbridge letter to creditors.pdf', pdf([
    'Kingsbridge Insolvency LLP, 14 Temple Row, Birmingham B2 5JT',
    'COPPERBECK STUDIO LIMITED - IN CREDITORS VOLUNTARY LIQUIDATION',
    `The members resolved on ${longIn(-4)} that the company cannot continue its business by reason of its liabilities`,
    'and that it be wound up voluntarily. Creditors approved the nomination by deemed consent.',
    `Daniel Okafor of Kingsbridge Insolvency LLP was appointed liquidator on ${longIn(-4)}.`,
    `Creditors must submit a proof of debt to the liquidator by ${longIn(18)}.`,
    `A virtual meeting to decide the liquidator remuneration will be held on ${longIn(11)} at 2:30 pm.`,
    'Employees may claim arrears of pay and redundancy from the Redundancy Payments Service.',
  ]), 'application/pdf');

  // LARKSPUR PRINT: a voluntary First Gazette. Only a warning of what will happen.
  await set('larkspur print', { stage: 'active_proposal', kind: 'voluntary', next: 'Keep the DS01 going, no objections expected' });
  await putDoc(db, api, 'larkspur print', 'First Gazette - voluntary strike off.pdf', pdf([
    'The Gazette   Notice type: First Gazette - Voluntary Strike-off Action   Companies Act 2006 s.1003(3)',
    `Publication date: ${longIn(-15)}`,
    'The Registrar of Companies gives notice that application has been made to strike off:',
    '  LARKSPUR PRINT LTD   12274590',
    'Unless cause is shown to the contrary, at the expiration of two months from the date of this notice',
    'the name of the company will be struck off the register and the company will be dissolved.',
    'Any person may object to the Registrar of Companies, Companies House, Cardiff CF14 3UZ.',
  ]), 'application/pdf');

  // TIDEWELL FREIGHT: petition advertised, hearing to come, plus a call note.
  await set('tidewell freight', { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(16), next: 'Find the money for HMRC before the hearing' });
  await putDoc(db, api, 'tidewell freight', 'Gazette notice of petition.pdf', pdf([
    'The Gazette   Notice type: Petitions to Wind Up (Companies)',
    'In the High Court of Justice, Business and Property Courts in Birmingham, Insolvency and Companies List (ChD)',
    'No. 000522 of 2026   In the Matter of TIDEWELL FREIGHT LIMITED, company number 08460331',
    `A petition to wind up the company was presented on ${longIn(-19)} by HM Revenue and Customs.`,
    `The petition is to be heard at Birmingham Civil and Family Justice Centre, 33 Bull Street, Birmingham B4 6DS, on ${longIn(16)} at 10:30 am.`,
    'Any person wishing to appear should notify the petitioner in writing.',
    'Should the court make a winding-up order, the Official Receiver will become liquidator.',
  ]), 'application/pdf');
  await putDoc(db, api, 'tidewell freight', 'hmrc call note.txt', Buffer.from(
    `Call with HMRC Debt Management, ${longIn(-2)}\n`
    + 'Spoke to the officer on the petition. Balance owed is £18,400 (PAYE and NIC, Feb to Jul).\n'
    + 'They refused a 12 month time to pay. Said they would consider 6 months if we pay £5,000 up front before the hearing.\n',
  ), 'text/plain');

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


const WUO = /winding[- ]up order|wound up|Official Receiver/i;
const GONE = /dissolved|struck off|Final Gazette/i;

// ================= DOC AHEAD OF THE PAGE =================
write('has it moved on: the order is in the paperwork', [
  { say: 'has saltmarsh kitchens moved on at all? have a look at the paperwork', expect: { reply: WUO, db: untouched } },
  { say: 'update it from the docs', expect: { db: untouched } },
  { say: 'yes', expect: { db: movedTo('saltmarsh kitchens', 'hmrc_liq', 'winding_up_order') } },
]);
write('liquidator letter names the kind', [
  { say: 'copperbeck - liquidator letter came in, sort the stage out pls', expect: { reply: /CVL|creditors'? voluntary/i, db: untouched } },
  { say: 'yep', expect: { db: all(movedTo('copperbeck studio', 'own_liq', 'cvl'), asSeeded('larkspur print')) } },
]);

// ================= FINAL GAZETTE =================
write('what do the docs say, then dissolve', [
  { say: 'fenwick joinery, what do the docs say and is the page right', expect: { reply: GONE, db: untouched } },
  { say: 'ok sort it', expect: { db: untouched } },
  { say: 'yes', expect: { db: dissolved('fenwick joinery', 'struck_off') } },
]);
write('preview then nah', [
  { say: 'mark fenwik joinery off as per the gazette', expect: { db: untouched } },
  { say: 'nah leave it as is', expect: { noReply: NO_SAVE_CLAIM, db: untouched } },
]);
write('auto mode: the gazette close still previews', [
  { say: 'fenwick joinery is gone per the gazette, update it', expect: { db: untouched } },
  { say: 'yes go', expect: { db: dissolved('fenwick joinery', 'struck_off') } },
], true);

// ================= ONLY A WARNING: nothing to change =================
write('unless cause is shown is not dissolved', [
  { say: 'larkspur print - docs say its struck off now? update it if so', expect: {
    reply: /\bno\b|not yet|hasn'?t|has not|two months|2 months|First Gazette|unless/i,
    noReply: /\b(?:has been|is now|was) (?:struck off|dissolved)\b(?![^.]*\b(?:unless|if|not)\b)/i,
    db: untouched,
  } },
]);
read('is the page right when it is', [
  { say: 'larkspur print page correct vs the gazette notice?', expect: {
    reply: /\b(?:yes|right|correct|matches|accurate|up to date|in line)\b/i,
    noReply: /further along|(?:page|it) is (?:behind|wrong|out of date)|should (?:be )?(?:move|moved|updated) to/i,
    db: untouched,
  } },
]);

// ================= QUESTIONS FROM THE DOCUMENTS =================
read('who was appointed', [
  { say: 'who did copperbeck end up with as liquidator', expect: { reply: /Daniel Okafor|Okafor/i, db: untouched } },
]);
read('proof of debt cut-off', [
  { say: 'copperbeck proof of debt deadline?', expect: { reply: said(18), db: untouched } },
]);
read('hearing when and where', [
  { say: 'tidewell freight hearing - when n where', expect: { reply: new RegExp(`(?=[\\s\\S]*(?:${said(16).source}))(?=[\\s\\S]*Birmingham)`, 'i'), db: untouched } },
]);
read('next step from the call note and the petition', [
  { say: 'wat do we do next w tidewel freight', expect: {
    reply: new RegExp(`(?=[\\s\\S]*(?:${said(16).source}))(?=[\\s\\S]*(?:5,?000|18,?400|time to pay|HMRC))`, 'i'),
    noReply: /\b(?:has been|was) wound up\b|winding[- ]up order (?:was|has been) made/i,
    db: untouched,
  } },
]);

// ================= EVERY COMPANY AT ONCE =================
write('go through every company and bring the stages up to date', [
  { say: 'go thru every companys docs n update the stages where the page is behind', expect: {
    reply: /(?=[\s\S]*Saltmarsh)(?=[\s\S]*Fenwick)(?=[\s\S]*Copperbeck)/i,
    db: untouched,
  } },
  { say: 'yes all of them', expect: { db: all(
    movedTo('saltmarsh kitchens', 'hmrc_liq', 'winding_up_order'),
    dissolved('fenwick joinery', 'struck_off'),
    movedTo('copperbeck studio', 'own_liq', 'cvl'),
    asSeeded('larkspur print'),
    asSeeded('tidewell freight'),
  ) } },
]);
