/**
 * DOC STATUS DEV, written blind 2026-10-22. Fixes may be made against these.
 *
 * Diane reads each winding down company's documents against its page. When a
 * document shows the company further along than the page she says so and
 * offers to update; "update it from the docs" previews, only a yes saves. A
 * document that only says a step MAY happen is no evidence it did. Moving to
 * dissolved closes the company and stops its live deals, always after a
 * preview, auto mode too. Questions change nothing. Every write is checked
 * in the database.
 *
 * Page vs documents at seed time (T = today):
 *   Harbor Nine  page HMRC liq / petition   doc: winding-up order made T-5        -> behind
 *   Brightwell   page Liquidation (no kind) doc: MVL, liquidator appointed T-14   -> behind
 *   Ironleaf     page Active proposal / compulsory  doc: Final Gazette T-3        -> behind (dissolved)
 *   Quarry Lane  page HMRC liq / petition   doc: petition, hearing T+12, "may"    -> right
 *   Pinecrest    page Own liq / CVL         docs: liquidator letter + email       -> right
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
  const rel = `${row.id}/zzdocdev-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

const PAGE = ['harbor nine', 'brightwell', 'ironleaf', 'quarry lane', 'pinecrest'];
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
  for (const key of PAGE) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );

  // HARBOR NINE: the page still says petition; the court already made the order.
  await set('harbor nine', { stage: 'hmrc_liq', kind: 'petition', next: 'Wait for the petition hearing' });
  await putDoc(db, api, 'harbor nine', 'Sealed winding up order.pdf', pdf([
    'IN THE HIGH COURT OF JUSTICE, BUSINESS AND PROPERTY COURTS OF ENGLAND AND WALES',
    'INSOLVENCY AND COMPANIES LIST (ChD)        No. CR-2026-004871',
    'IN THE MATTER OF HARBOR NINE LIMITED and IN THE MATTER OF THE INSOLVENCY ACT 1986',
    'Before ICC Judge Barber, sitting at 7 Rolls Building, Fetter Lane, London',
    `ORDER made on ${longIn(-5)} upon the petition of the Commissioners for HM Revenue and Customs`,
    'presented on 3 August 2026.',
    'IT IS ORDERED that Harbor Nine Limited be wound up by the court under the provisions of the Insolvency Act 1986.',
    'The Official Receiver is by virtue of this order liquidator of the company.',
    'AND IT IS ORDERED that the costs of the petitioner be paid out of the assets of the company.',
  ]), 'application/pdf');

  // BRIGHTWELL: page says liquidation, kind not said. It is a members' voluntary.
  await set('brightwell', { stage: 'liquidation', next: 'Find out which kind of liquidation' });
  await putDoc(db, api, 'brightwell', 'Notice of appointment of liquidators.pdf', pdf([
    'BRIGHTWELL LIMITED - IN MEMBERS VOLUNTARY LIQUIDATION',
    'Company number 10482216',
    'NOTICE OF APPOINTMENT OF LIQUIDATOR - Rule 5.4, Insolvency England and Wales Rules 2016',
    `A declaration of solvency was sworn by the directors on ${longIn(-20)}.`,
    `At a general meeting of the members held on ${longIn(-14)} a special resolution was passed`,
    'that the company be wound up voluntarily, and Priya Sandhu of Leonard Curtis was appointed liquidator.',
    `All creditors are required to send their claims to the liquidator by ${longIn(19)}.`,
    'This is a solvent liquidation and all known creditors are expected to be paid in full.',
  ]), 'application/pdf');

  // IRONLEAF: page says compulsory strike-off proposal; the Final Gazette says it is dissolved.
  await set('ironleaf', { stage: 'active_proposal', kind: 'compulsory', next: 'Watch for the Final Gazette' });
  await putDoc(db, api, 'ironleaf', 'Final Gazette notice.pdf', pdf([
    'THE GAZETTE - Official Public Record',
    'Companies Act 2006 - Section 1000(4)',
    'NOTICE OF STRIKING OFF AND DISSOLUTION',
    `Notice is hereby given that the following company was on ${longIn(-3)} struck off the register`,
    'and is dissolved by virtue of section 1000(5) of the Companies Act 2006:',
    'IRONLEAF LTD   Company number 11937054',
    'Registrar of Companies, Companies House, Crown Way, Cardiff CF14 3UZ',
    `Notice ID 4729183   Publication date ${longIn(-3)}`,
  ]), 'application/pdf');

  // QUARRY LANE: a petition and a hearing date. Nothing has been ordered yet.
  await set('quarry lane', { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(12), next: 'Agree terms with HMRC before the hearing', liquidator: '' });
  await putDoc(db, api, 'quarry lane', 'Winding up petition HMRC.pdf', pdf([
    'IN THE COUNTY COURT AT LEEDS        Petition No. 000318 of 2026',
    'IN THE MATTER OF QUARRY LANE LIMITED and IN THE MATTER OF THE INSOLVENCY ACT 1986',
    `A petition to wind up the above company was presented on ${longIn(-24)} by the`,
    'Commissioners for HM Revenue and Customs, claiming to be creditors of the company',
    'in respect of unpaid PAYE, National Insurance and VAT totalling GBP 41,260.17.',
    `The petition will be heard at Leeds Combined Court Centre, 1 Oxford Row, Leeds LS1 3BG on ${longIn(12)} at 10:00 am.`,
    'Any person intending to appear must give notice to the petitioner by 4 pm on the business day before the hearing.',
    'If the debt is not paid or the petition is not otherwise disposed of, the court may make a winding-up order.',
  ]), 'application/pdf');

  // PINECREST: page is right. A liquidator letter and an email with the facts.
  await set('pinecrest', { stage: 'own_liq', kind: 'cvl', next: 'Send the payroll records to the liquidator', liquidator: 'Moorfields Advisory' });
  await putDoc(db, api, 'pinecrest', 'Letter to creditors from liquidator.pdf', pdf([
    'Moorfields Advisory Limited, 82 St John Street, London EC1M 4JN',
    'PINECREST LIMITED - IN CREDITORS VOLUNTARY LIQUIDATION',
    `Dear Sirs, I write to confirm that I, Hannah Rees, was appointed liquidator of the company on ${longIn(-30)}.`,
    'The directors statement of affairs shows an estimated deficiency to creditors of GBP 96,400.',
    `A virtual meeting of creditors will be held by Microsoft Teams on ${longIn(9)} at 11:00 am`,
    'to consider the basis of the liquidator fees and whether a liquidation committee should be formed.',
    'Please lodge your proof of debt before the meeting if you wish to vote.',
    'Yours faithfully, Hannah Rees, Liquidator',
  ]), 'application/pdf');
  await putDoc(db, api, 'pinecrest', 'email from liquidator.txt', Buffer.from(
    `From: Hannah Rees <hrees@moorfields.example>\nSent: ${longIn(-6)}\nSubject: Pinecrest Ltd - payroll records\n\n`
    + `Hi, could you send over the last 12 months of payroll records and the P32s by ${longIn(7)} please? `
    + 'We need them before the creditors meeting. Thanks, Hannah',
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

// ================= DOC AHEAD OF THE PAGE: offer, preview, yes =================
write('next step spots a winding-up order the page missed', [
  { say: 'whats next for harbor nine', expect: { reply: WUO, db: untouched } },
  { say: 'ya do it', expect: { db: untouched } },
  { say: 'yes', expect: { db: movedTo('harbor nine', 'hmrc_liq', 'winding_up_order') } },
]);
write('update from the docs, said straight', [
  { say: 'update harbor nine from its documents', expect: { reply: WUO, db: untouched } },
  { say: 'yes', expect: { db: all(movedTo('harbor nine', 'hmrc_liq', 'winding_up_order'), asSeeded('quarry lane'), asSeeded('ironleaf')) } },
]);
write('lazy: brightwell docs say which liquidation', [
  { say: 'brightwel got a letter from leonard curtis, wat kind of liq is it. fix the page if its wrong', expect: { reply: /MVL|members'? voluntary/i, db: untouched } },
  { say: 'go ahead', expect: { db: movedTo('brightwell', 'own_liq', 'mvl') } },
]);

// ================= FINAL GAZETTE: dissolved closes, always previews =================
write('page wrong after a Final Gazette, then dissolve', [
  { say: 'is the ironleaf page right?', expect: { reply: GONE, db: untouched } },
  { say: 'update it from the docs', expect: { db: untouched } },
  { say: 'yes', expect: { db: dissolved('ironleaf', 'struck_off') } },
]);
write('a no after the preview saves nothing', [
  { say: 'move ironleaf on from the gazette notice', expect: { db: untouched } },
  { say: 'no', expect: { noReply: NO_SAVE_CLAIM, db: untouched } },
]);
write('auto mode: dissolving from a doc still previews', [
  { say: 'ironleaf final gazette came thru, update it from the docs', expect: { db: untouched } },
  { say: 'yes', expect: { db: dissolved('ironleaf', 'struck_off') } },
], true);

// ================= A DOC THAT ONLY THREATENS: nothing to change =================
write('petition says the court may: no change', [
  { say: 'quarry lane - has the court wound it up yet? check the docs n update if so', expect: {
    reply: /\bno\b|not yet|hasn'?t|has not|hearing|petition/i,
    noReply: /\b(?:has been|was|is now) wound up\b|winding[- ]up order (?:was|has been) made|court (?:has )?made (?:a|the) winding[- ]up order/i,
    db: untouched,
  } },
  { say: 'just fix whatever the docs say then', expect: { noReply: NO_SAVE_CLAIM, db: untouched } },
]);

// ================= QUESTIONS FROM THE DOCUMENTS =================
read('next step quotes the hearing date', [
  { say: 'whats next on quarry lane n by when', expect: { reply: said(12), noReply: /\b(?:has been|was) wound up\b/i, db: untouched } },
]);
read('hearing date and court, typos', [
  { say: 'wen is the quary lane hearing n which court', expect: { reply: new RegExp(`(?=[\\s\\S]*(?:${said(12).source}))(?=[\\s\\S]*Leeds)`, 'i'), db: untouched } },
]);
read('page is right: says so', [
  { say: 'is the pinecrest page right according to the docs?', expect: {
    reply: /\b(?:yes|right|correct|matches|accurate|up to date|in line)\b/i,
    noReply: /further along|(?:page|it) is (?:behind|wrong|out of date)|should (?:be )?(?:move|moved|updated) to/i,
    db: untouched,
  } },
]);
read('creditors meeting date', [
  { say: 'when is the pinecrest creditors meeting', expect: { reply: said(9), db: untouched } },
]);
read('who the liquidator is, per the letter', [
  { say: 'whos the actual liquidator on pinecrest, the person not the firm', expect: { reply: /Hannah Rees/i, db: untouched } },
]);

// ================= SEVERAL COMPANIES AT ONCE =================
write('check all the docs and fix the stages: one preview', [
  { say: 'check all the docs and fix the stages', expect: {
    reply: /(?=[\s\S]*Harbor Nine)(?=[\s\S]*Brightwell)(?=[\s\S]*Ironleaf)/i,
    db: untouched,
  } },
  { say: 'yes', expect: { db: all(
    movedTo('harbor nine', 'hmrc_liq', 'winding_up_order'),
    movedTo('brightwell', 'own_liq', 'mvl'),
    dissolved('ironleaf', 'struck_off'),
    asSeeded('quarry lane'),
    asSeeded('pinecrest'),
  ) } },
]);
write('two from the docs, then drop one', [
  { say: 'fix the stages for harbor nine and ironleaf from their docs', expect: { db: untouched } },
  { say: 'actually leave ironleaf for now, just harbor nine', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    movedTo('harbor nine', 'hmrc_liq', 'winding_up_order'),
    asSeeded('ironleaf'),
    liveKept('ironleaf'),
  ) } },
]);
