/**
 * DOC FRESH 5, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Winding down companies' DOCUMENTS: Diane answers from them (names, dates,
 * courts) and updates the stage from them. Five new companies, each with the
 * paper its step really leaves behind:
 *   Thistlecombe Larder   page says Liquidation (no kind); the papers say the
 *                         administration moved to a CVL, plus a creditors'
 *                         decision procedure notice. PAGE BEHIND.
 *   Gorsebrook Kilnworks  page says Own liq MVL; members' voluntary winding-up
 *                         notice with a declaration of solvency. PAGE RIGHT.
 *   Wrenfield Tannery     page says HMRC liq petition; a petition advert where
 *                         the court MAY make an order. THREAT ONLY, PAGE RIGHT.
 *   Quayle & Oddbody      page says HMRC liq petition; a winding-up order naming
 *   Haulage               the Official Receiver. PAGE BEHIND.
 *   Marrowdene Print      page says Active proposal (voluntary); First Gazette,
 *                         objection lodged then withdrawn, final Gazette
 *                         dissolution. PAGE BEHIND, and dissolving closes it.
 * Dates are relative to today, written in words. Every write is db-checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentDay, currentMonth } = require('../../v1/shared/presetMonth.helper');

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
/** Any fair way of saying that day: "7 November", "7th Nov", "November 7", "07/11". */
const said = (n) => {
  const d = new Date(`${isoIn(n)}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return new RegExp(`\\b${day}(?:st|nd|rd|th)? (?:of )?${m.slice(0, 3)}|\\b${m.slice(0, 3)}[a-z]* ${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b`, 'i');
};

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
  const rel = `${row.id}/zzdoc5-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

// ---------- new deals, made the way seed.mjs makes them ----------
const [thisYear, thisPart] = currentMonth().split('-').map(Number);
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthAt = (offset) => ym(new Date(Date.UTC(thisYear, thisPart - 1 + offset, 1)));
const daysInMonth = new Date(Date.UTC(thisYear, thisPart, 0)).getUTCDate();
const D = (o) => ({
  assignedOn: `${monthAt(-8)}-01`,
  paymentStartOn: `${monthAt(-7)}-01`,
  presetOn: `${monthAt(0)}-01`,
  endOn: `${monthAt(8)}-28`,
  payableDays: daysInMonth,
  currency: 'GBP',
  paymentMethod: 'bank',
  ...o,
});
const NEW_DEALS = [
  D({ personName: 'Odile Penhaligon', groupName: 'BAKER', company: 'Thistlecombe Larder', roleLabel: 'Director', monthlyAmount: 2100 }),
  D({ personName: 'Barnaby Quist', groupName: 'CORVID', company: 'Thistlecombe Larder', roleLabel: 'Mid 1', monthlyAmount: 950 }),
  D({ personName: 'Lysander Mote', groupName: 'OTTER', company: 'Gorsebrook Kilnworks', roleLabel: 'Director', monthlyAmount: 2600 }),
  D({ personName: 'Hettie Fairweather', groupName: 'BAKER', company: 'Gorsebrook Kilnworks', roleLabel: 'Accounts', monthlyAmount: 1150 }),
  D({ personName: 'Cosmo Drabble', groupName: 'CORVID', company: 'Wrenfield Tannery', roleLabel: 'Director', monthlyAmount: 1800 }),
  D({ personName: 'Ysolde Tarrant', groupName: 'OTTER', company: 'Wrenfield Tannery', roleLabel: 'Tech', monthlyAmount: 1400 }),
  D({ personName: 'Ambrose Kettlewell', groupName: 'BAKER', company: 'Quayle & Oddbody Haulage', roleLabel: 'Director', monthlyAmount: 3100 }),
  D({ personName: 'Peregrine Sloane', groupName: 'CORVID', company: 'Quayle & Oddbody Haulage', roleLabel: 'Admin', monthlyAmount: 800 }),
  D({ personName: 'Winifred Ashcombe', groupName: 'OTTER', company: 'Marrowdene Print', roleLabel: 'Director', monthlyAmount: 1700 }),
  D({ personName: 'Tobias Grindle', groupName: 'BAKER', company: 'Marrowdene Print', roleLabel: 'Sales', monthlyAmount: 1000 }),
];

const T = 'thistlecombe larder';
const G = 'gorsebrook kilnworks';
const W = 'wrenfield tannery';
const Q = 'quayle & oddbody haulage';
const M = 'marrowdene print';
const PAGE = [T, G, W, Q, M];

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
const stillWinding = (name) => all(statusIs(name, 'liquidation'), liveKept(name));
const dissolvedClosed = (name) => all(stageIs(name, 'dissolved', 'struck_off'), statusIs(name, 'closed'), liveIs(name, 0));
// NOTHING MOVED: every stage, kind, deadline, next action, liquidator, status and live deal as seeded.
const untouched = async (db) => {
  for (const s of seedState.liq) {
    const r = (await db.query('SELECT * FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    if (!r) return `${s.company_key} row gone`;
    for (const f of ['stage', 'stage_kind', 'next_action', 'owner', 'liquidator']) {
      if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to ${r[f]}`;
    }
    if (String(r.deadline ?? '').slice(0, 10) !== String(s.deadline ?? '').slice(0, 10)) return `${s.company_key} deadline moved`;
  }
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved`;
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};
// The two companies whose page is already right never move, whatever else saves.
const rightOnesKept = all(stageIs(G, 'own_liq', 'mvl'), stillWinding(G), stageIs(W, 'hmrc_liq', 'petition'), stillWinding(W));

export async function extraSeed({ api, db }) {
  for (const d of NEW_DEALS) {
    const r = await api('POST', '/master-sheet', d);
    if (r.status !== 201) throw new Error(`doc5 seed ${d.personName}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const key of PAGE) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );

  // THISTLECOMBE LARDER: administration moved to a CVL. The page never caught up.
  await set(T, { stage: 'liquidation', next: 'Chase the administrators for their progress report', liquidator: 'Quillfeather Insolvency LLP' });
  await putDoc(db, api, T, 'AM22 notice - move to CVL.pdf', pdf([
    'Notice of move from administration to creditors\' voluntary liquidation',
    'Form AM22 - Insolvency Act 1986, paragraph 83 of Schedule B1',
    'Company name: Thistlecombe Larder Limited. Company number 11873402.',
    'The joint administrators, Rosalind Achterberg and Desmond Ilkley of Quillfeather Insolvency LLP,',
    `give notice that the administration has ended and the company moved into a creditors' voluntary`,
    `liquidation on registration of this notice by the Registrar of Companies on ${longIn(-12)}.`,
    'Rosalind Achterberg is the liquidator of the company. IP number 19422.',
  ]), 'application/pdf');
  await putDoc(db, api, T, 'Creditors decision procedure.pdf', pdf([
    'THISTLECOMBE LARDER LIMITED - IN CREDITORS\' VOLUNTARY LIQUIDATION',
    'Notice of a decision procedure by electronic voting - Rule 15.8 Insolvency Rules 2016',
    'Convener: Rosalind Achterberg, Liquidator, Quillfeather Insolvency LLP, 4 Saddler Row, Shrewsbury.',
    'Decision sought: approval of the liquidator\'s fees on a time costs basis.',
    `Votes, with a proof of debt, must reach the convener by 23:59 on ${longIn(11)}, the decision date.`,
    'Creditors may ask for a physical meeting within five business days of this notice.',
  ]), 'application/pdf');

  // GORSEBROOK KILNWORKS: solvent MVL. The page is right.
  await set(G, { stage: 'own_liq', kind: 'mvl', deadline: isoIn(16), next: 'Send our claim to Heronsgate before the last date for proving', liquidator: 'Heronsgate Restructuring' });
  await putDoc(db, api, G, 'Gazette - MVL resolution and notice to creditors.pdf', pdf([
    'THE GAZETTE - Corporate insolvency - Resolutions for winding-up',
    'GORSEBROOK KILNWORKS LTD - Members\' Voluntary Liquidation',
    `At a general meeting held on ${longIn(-30)} the members passed a special resolution that the company`,
    'be wound up voluntarily, and that Ptolemy Varga of Heronsgate Restructuring, Unit 9 Mill Yard, Stoke-on-Trent,',
    'be appointed liquidator. The directors swore a statutory declaration of solvency on ' + longIn(-35) + '.',
    `Creditors are asked to prove their debts to the liquidator by ${longIn(16)}, the last date for proving.`,
    'This is a solvent liquidation and all known creditors are expected to be paid in full.',
  ]), 'application/pdf');

  // WRENFIELD TANNERY: petition advertised. The court MAY wind it up. Nothing more yet.
  await set(W, { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(19), next: 'Pay HMRC or agree terms before the hearing' });
  await putDoc(db, api, W, 'Gazette petition advert.pdf', pdf([
    'THE GAZETTE - Petitions to wind up - Companies',
    'In the County Court at Bristol, No. CR-2026-00418',
    'In the Matter of WRENFIELD TANNERY LTD and in the Matter of the Insolvency Act 1986',
    `A petition to wind up the above-named company was presented on ${longIn(-14)} by the Commissioners for`,
    `HM Revenue and Customs, claiming to be a creditor. The petition will be heard on ${longIn(19)} at 10:00.`,
    'Any person wishing to appear must give notice to the petitioner by 16:00 on the business day before.',
    'If the debt is not paid or the petition dismissed, the court may make a winding-up order.',
  ]), 'application/pdf');

  // QUAYLE & ODDBODY HAULAGE: the order has been made. The page still says petition.
  await set(Q, { stage: 'hmrc_liq', kind: 'petition', next: 'Wait for the hearing' });
  await putDoc(db, api, Q, 'Sealed winding up order.pdf', pdf([
    'IN THE HIGH COURT OF JUSTICE, BUSINESS AND PROPERTY COURTS IN LEEDS',
    'INSOLVENCY AND COMPANIES LIST (ChD) - No. 000731 of 2026',
    'IN THE MATTER OF QUAYLE & ODDBODY HAULAGE LIMITED',
    `Before District Judge Okonkwo-Hale, sitting on ${longIn(-9)}.`,
    'Upon the petition of the Commissioners for HM Revenue and Customs, IT IS ORDERED that',
    'Quayle & Oddbody Haulage Limited be wound up by the court under the Insolvency Act 1986.',
    'The Official Receiver attached to the court, of the Public Interest Unit Leeds, is liquidator.',
    `The directors must attend the Official Receiver's office by ${longIn(5)}.`,
  ]), 'application/pdf');

  // MARROWDENE PRINT: proposed, objected, objection withdrawn, dissolved. Page stuck on the proposal.
  await set(M, { stage: 'active_proposal', kind: 'voluntary', next: 'Wait out the two months' });
  await putDoc(db, api, M, 'First Gazette DS01 notice.pdf', pdf([
    'THE GAZETTE - Companies Act 2006, section 1003(3)',
    `Notice is hereby given that, on ${longIn(-75)}, the Registrar received an application from the directors`,
    'of MARROWDENE PRINT LTD to strike the company off the register. Unless cause is shown to the contrary,',
    'the company will be struck off and dissolved at the end of two months from this notice.',
  ]), 'application/pdf');
  await putDoc(db, api, M, 'Objection lodged then withdrawn.txt', Buffer.from([
    `Companies House email ${longIn(-60)}: an objection to the striking off of Marrowdene Print Ltd has been lodged by`,
    'Ferncastle Paper Supplies Ltd over an unpaid invoice. The strike off is suspended for now.',
    `Companies House email ${longIn(-30)}: Ferncastle Paper Supplies Ltd has withdrawn its objection. The strike off`,
    'action has resumed and the company will be struck off at the next available Gazette date.',
  ].join('\n')), 'text/plain');
  await putDoc(db, api, M, 'Final Gazette - dissolved.pdf', pdf([
    'THE GAZETTE - Companies Act 2006, section 1003(5)',
    `Notice is hereby given that the following company was struck off the register on ${longIn(-4)}`,
    'and is accordingly dissolved: MARROWDENE PRINT LTD, company number 09981254.',
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
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

// ================= ANSWERING FROM THE DOCUMENTS =================
// 1. The papers are further on than the page: she says so and offers, saves nothing.
read('docs ahead of the page, she says so', [
  { say: 'wat does the thistlecomb larder paperwork actually say', expect: {
    reply: /(?=[\s\S]*(?:CVL|creditors'? voluntary))(?=[\s\S]*(?:behind|out of date|not (?:yet )?(?:match|reflect|show)|doesn'?t (?:match|show|reflect)|still (?:says|shows|on|at)|update|change))/i,
    db: untouched,
  } },
]);
// 2. Page is right: she says it is right, saves nothing.
read('is the page right, and it is', [
  { say: 'is the page right for gorsbrook kiln works or is it behind the docs', expect: {
    reply: /(?=[\s\S]*(?:MVL|members'? voluntary))(?=[\s\S]*(?:\byes\b|right|correct|match|up to date|accurate|in line|agrees))/i,
    noReply: /\b(?:is|looks|seems) behind\b|out of date/i,
    db: untouched,
  } },
]);
// 3. A named person in a document.
read('who is the named person', [
  { say: 'whos ptolmey varga, he keeps coming up in the gorsebrook stuff', expect: {
    reply: /(?=[\s\S]*liquidator)(?=[\s\S]*(?:Heronsgate|Gorsebrook))/i,
    db: untouched,
  } },
]);
// 4. Short follow-up with no company: refers to the one just discussed.
read('which court, follow-up with no company', [
  { say: 'what happend in court with quayle n oddbody', expect: { reply: /winding.?up order|wound up|Official Receiver/i, db: untouched } },
  { say: 'which court was that and who is liquidator', expect: { reply: /(?=[\s\S]*Leeds)(?=[\s\S]*Official Receiver)/i, db: untouched } },
]);
// 5. Next step, quoting the deadline from the decision procedure notice.
read('next step with a deadline from the docs', [
  { say: 'thistlecombe whats next for us, when do creditors need to vote by', expect: { reply: said(11), db: untouched } },
]);

// ================= UPDATING THE STAGE FROM THE DOCUMENTS =================
// 6. "page is behind, sort it": a preview, then yes saves the CVL.
write('page is behind, sort it, yes', [
  { say: 'thistlecomb larder page is behind the docs, sort it', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageIs(T, 'own_liq', 'cvl'), stillWinding(T), rightOnesKept) } },
]);
// 7. A no after the preview saves nothing.
write('update it, then no', [
  { say: 'quayle oddbody haulage - update it from the docs', expect: { db: untouched } },
  { say: 'no', expect: { db: untouched } },
]);
// 8. Follow-up with no company, then a write: the company just discussed.
write('question then "ok update it"', [
  { say: 'whats the latest doc on quale & oddbody say', expect: { reply: /winding.?up order|wound up|Official Receiver/i, db: untouched } },
  { say: 'ok fix it then', expect: { db: untouched } },
  { say: 'yep', expect: { db: all(stageIs(Q, 'hmrc_liq', 'winding_up_order'), stillWinding(Q), rightOnesKept) } },
]);
// 9. A petition only threatens the order: nothing changes, even when pushed.
write('threat only, nothing to change', [
  { say: 'wrenfeild tannery got the court thing, theyre being wound up. page is behind fix it', expect: { reply: /may|hearing|petition|not (?:yet )?(?:been )?(?:made|wound)|no order/i, db: untouched } },
  { say: 'yes do it', expect: { db: untouched } },
]);
// 10. Dissolution closes the company, and always previews first.
write('dissolved per the Gazette, preview then yes', [
  { say: 'marrowdean print got dissolved per the gazette, update the page', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(dissolvedClosed(M), rightOnesKept) } },
]);
// 11. Auto mode: dissolving still previews first.
write('auto mode: dissolving still previews', [
  { say: 'marowdene page is out of date, sort it', expect: { db: untouched } },
  { say: 'go ahead', expect: { db: all(dissolvedClosed(M), rightOnesKept) } },
], true);
// 12. Check them all: the three behind ones move, the two right ones stay.
write('check them all and fix what is out of date', [
  { say: 'check them all against the docs and fix whats out of date', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    stageIs(T, 'own_liq', 'cvl'), stillWinding(T),
    stageIs(Q, 'hmrc_liq', 'winding_up_order'), stillWinding(Q),
    dissolvedClosed(M),
    rightOnesKept,
  ) } },
]);
