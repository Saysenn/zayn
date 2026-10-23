/**
 * DOC FRESH 4, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * SUITE_SET=doc4. Winding down companies' documents: answering from them and
 * updating the stage from them. Five new companies, each with the paper its
 * step leaves behind, dates relative to today written in words:
 *   Hallowdene Print       page: HMRC liq petition    paper: winding-up order, Official Receiver   (page behind)
 *   Brackenridge Couriers  page: HMRC liq petition    paper: hearing notice, court MAY make order  (page right)
 *   Wexcombe Glazing       page: own liq, no kind     paper: CVL letter, IP Tamsin Rook, meeting    (page behind)
 *   Ottery Mill Foods      page: active proposal vol. paper: First then Final Gazette, dissolved    (page behind, closes)
 *   Gullsworth Dental      page: strike off suspended paper: Gazette, HMRC objection, then withdrawn (page behind)
 * Questions change nothing; an update previews; only a yes saves; a dissolve
 * closes the company and stops its deals, and previews first in auto mode too.
 * Every write is checked in the database.
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

// ---------- dates ----------
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoIn = (n) => new Date(Date.parse(currentDay()) + n * 86_400_000).toISOString().slice(0, 10);
/** "14 November 2026", n days from today. */
const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** Any fair way of saying that day: "14 November", "14th Nov", "November 14", "14/11". */
const saidSrc = (n) => {
  const d = new Date(`${isoIn(n)}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return `\\b${day}(?:st|nd|rd|th)? (?:of )?${m.slice(0, 3)}|\\b${m.slice(0, 3)}\\w* ${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b`;
};
const said = (...ns) => new RegExp(ns.map(saidSrc).join('|'), 'i');

// ---------- a real one page PDF ----------
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
  const rel = `${row.id}/zzdoc4-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

// ---------- this set's own deals, made through the API as seed.mjs does ----------
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
const DEALS = [
  D({ personName: 'Rosalind Pike', groupName: 'BAKER', company: 'Hallowdene Print', roleLabel: 'Director', monthlyAmount: 1800 }),
  D({ personName: 'Declan Hume', groupName: 'CORVID', company: 'Brackenridge Couriers', roleLabel: 'Mid 1', monthlyAmount: 1400 }),
  D({ personName: 'Imogen Tate', groupName: 'OTTER', company: 'Wexcombe Glazing', roleLabel: 'Accounts', monthlyAmount: 1600 }),
  D({ personName: 'Callum Reeve', groupName: 'BAKER', company: 'Ottery Mill Foods', roleLabel: 'Director', monthlyAmount: 2100 }),
  D({ personName: 'Esme Larkin', groupName: 'CORVID', company: 'Ottery Mill Foods', roleLabel: 'Sales', monthlyAmount: 950 }),
  D({ personName: 'Hugo Penrose', groupName: 'OTTER', company: 'Gullsworth Dental', roleLabel: 'Admin', monthlyAmount: 1250 }),
];

const PAGE = ['hallowdene print', 'brackenridge couriers', 'wexcombe glazing', 'ottery mill foods', 'gullsworth dental'];

// ---------- checks ----------
const liq = async (db, key) => (await db.query('SELECT * FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const stageIs = (key, stage, kind) => async (db) => {
  const r = await liq(db, key);
  if (!r) return `${key} has no winding down row`;
  if (r.stage !== stage) return `${key} stage ${r.stage}, not ${stage}`;
  if (kind !== undefined && r.stage_kind !== kind) return `${key} kind ${r.stage_kind}, not ${kind}`;
  return null;
};
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const closed = (name) => all(statusIs(name, 'closed'), liveIs(name, 0));
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
// Only this company's stage moved; the rest of the page is as seeded.
const onlyMoved = (key, check) => async (db) => {
  const why = await check(db);
  if (why) return why;
  for (const s of seedState.liq.filter((r) => r.company_key !== key)) {
    const r = (await db.query('SELECT stage, stage_kind FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    if (!r) return `${s.company_key} row gone`;
    if (r.stage !== s.stage || String(r.stage_kind ?? '') !== String(s.stage_kind ?? '')) return `${s.company_key} moved to ${r.stage}/${r.stage_kind}`;
  }
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status && c.name.toLowerCase() !== key) return `${c.name} status moved`;
  return null;
};

export async function extraSeed({ api, db }) {
  for (const d of DEALS) {
    const r = await api('POST', '/master-sheet', d);
    if (r.status !== 201) throw new Error(`doc4 seed ${d.personName}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const key of PAGE) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );

  // HALLOWDENE PRINT: page says petition; the court has made the order.
  await set('hallowdene print', { stage: 'hmrc_liq', kind: 'petition', next: 'Wait for the hearing' });
  await putDoc(db, api, 'hallowdene print', 'Winding up order - Hallowdene.pdf', pdf([
    'In the High Court of Justice, Business and Property Courts in Leeds, Insolvency and Companies List',
    `Before District Judge Okafor, on ${longIn(-9)}.`,
    'Upon the petition of the Commissioners for HM Revenue and Customs,',
    'IT IS ORDERED that Hallowdene Print Ltd be wound up under the Insolvency Act 1986.',
    'The Official Receiver, Insolvency Service, Leeds, is the liquidator of the company.',
    `The directors must attend an interview with the Official Receiver on ${longIn(8)}.`,
  ]), 'application/pdf');

  // BRACKENRIDGE COURIERS: petition filed, hearing ahead. The page is right.
  await set('brackenridge couriers', { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(12), next: 'Pay HMRC before the hearing', liquidator: '' });
  await putDoc(db, api, 'brackenridge couriers', 'Notice of petition hearing.pdf', pdf([
    'County Court at Birmingham - Notice of hearing of winding up petition',
    'Petitioner: the Commissioners for HM Revenue and Customs. Company: Brackenridge Couriers Ltd.',
    'Debt claimed: 27,640.18 GBP of unpaid PAYE, NIC and VAT.',
    `The petition will be heard on ${longIn(19)} at 10.30am.`,
    'At the hearing the court MAY make a winding up order against the company.',
    `To have the petition dismissed, pay the debt or agree terms with HMRC Enforcement by ${longIn(12)}.`,
  ]), 'application/pdf');

  // WEXCOMBE GLAZING: page says own liq with no kind; the IP's letter is a CVL's.
  await set('wexcombe glazing', { stage: 'own_liq', next: 'Send the books to the IP' });
  await putDoc(db, api, 'wexcombe glazing', 'Letter from Rook Ashby Insolvency.pdf', pdf([
    'Rook Ashby Insolvency LLP, 4 Quay Street, Bristol',
    'Re: Wexcombe Glazing Ltd - Creditors\' Voluntary Liquidation',
    'The directors have resolved that the company cannot pay its debts and should be wound up.',
    'Tamsin Rook, licensed insolvency practitioner, is proposed as liquidator.',
    `A virtual meeting of creditors will be held on ${longIn(11)} at 2pm by video link.`,
    `Proofs of debt must reach us by ${longIn(10)}. Yours sincerely, Tamsin Rook.`,
  ]), 'application/pdf');

  // OTTERY MILL FOODS: our own strike off. First Gazette, then the Final one.
  await set('ottery mill foods', { stage: 'active_proposal', kind: 'voluntary', next: 'Wait for the strike off' });
  await putDoc(db, api, 'ottery mill foods', 'First Gazette - Ottery Mill.pdf', pdf([
    'The Gazette - First Gazette notice for voluntary strike-off',
    'The Registrar of Companies gives notice that, unless cause is shown to the contrary,',
    `at the expiration of 2 months from ${longIn(-66)} Ottery Mill Foods Ltd will be struck off the register`,
    'and the company will be dissolved. Application made by the directors on form DS01.',
  ]), 'application/pdf');
  await putDoc(db, api, 'ottery mill foods', 'Final Gazette - Ottery Mill.pdf', pdf([
    'The Gazette - Final Gazette notice',
    `Notice is hereby given that on ${longIn(-4)} Ottery Mill Foods Ltd was struck off the register`,
    'of companies and is now dissolved. Companies House, Crown Way, Cardiff.',
  ]), 'application/pdf');

  // GULLSWORTH DENTAL: Gazette, HMRC objected, and now the strike off is withdrawn.
  await set('gullsworth dental', { stage: 'strike_off_suspended', next: 'Wait on HMRC' });
  await putDoc(db, api, 'gullsworth dental', 'First Gazette - Gullsworth.pdf', pdf([
    'The Gazette - First Gazette notice for compulsory strike-off',
    'The Registrar of Companies gives notice that, unless cause is shown to the contrary,',
    `at the expiration of 2 months from ${longIn(-55)} Gullsworth Dental Ltd will be struck off the register.`,
    'Reason: annual accounts overdue.',
  ]), 'application/pdf');
  await putDoc(db, api, 'gullsworth dental', 'HMRC objection - Gullsworth.pdf', pdf([
    'HM Revenue and Customs objects to the striking off of Gullsworth Dental Ltd.',
    `Objection lodged with Companies House on ${longIn(-30)}. Unpaid corporation tax: 3,980.00 GBP.`,
    'The strike off action is suspended while the objection stands.',
  ]), 'application/pdf');
  await putDoc(db, api, 'gullsworth dental', 'Companies House letter - strike off withdrawn.pdf', pdf([
    'Companies House, Crown Way, Cardiff',
    'Company: Gullsworth Dental Ltd',
    `As the overdue accounts were delivered on ${longIn(-6)}, the Registrar has withdrawn the`,
    'compulsory strike-off action. The company will remain on the register. No further action is needed.',
    `Dated ${longIn(-3)}. Signed, Priya Lomax, for the Registrar of Companies.`,
  ]), 'application/pdf');

  for (let i = 0; i < 90; i += 1) {
    const { n } = (await db.query("SELECT count(*)::int n FROM tb_liquidation_docs WHERE read_status IN ('waiting','reading')")).rows[0];
    if (!n) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  seedState.liq = (await db.query('SELECT * FROM tb_liquidations')).rows;
  seedState.status = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
  seedState.liveIds = (await db.query('SELECT id FROM tb_mastersheet WHERE stopped_on IS NULL')).rows.map((r) => r.id);
}

const reset = {
  act: async ({ db }) => {
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    for (const r of seedState.liq) {
      await db.query('UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6, owner = $7 WHERE id = $1',
        [r.id, r.stage, r.stage_kind, r.deadline, r.next_action, r.liquidator, r.owner]);
    }
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

const OFFER = /update|change|move|bring|want me|shall i|should i|fix/i;

// ================= READS: answering from the documents =================
read('paper further on than the page, she says so and offers', [
  { say: 'whats goin on with halowdene print, anything new in the docs', expect: { reply: new RegExp(`(?=[\\s\\S]*(?:winding[- ]up order|wound up|official receiver))(?=[\\s\\S]*(?:${OFFER.source}))`, 'i'), db: untouched } },
]);
read('person name from the IP letter', [
  { say: 'whos the liquidator on wexcom glazing', expect: { reply: /Tamsin Rook/i, db: untouched } },
]);
read('follow-up with no company: the meeting', [
  { say: 'wexcombe glazng - what does the letter from the insolvency lot say', expect: { reply: /CVL|creditors'? voluntary/i, db: untouched } },
  { say: "and when's the meeting", expect: { reply: said(11), db: untouched } },
]);
read('is the page right, and it is', [
  { say: 'is the page right for brackenrige couriers or is it behind', expect: { reply: /\byes\b|right|correct|matches|up to date|still (?:at )?(?:the )?petition/i, noReply: /\b(?:page|it)(?:'s| is) (?:behind|out of date|wrong)\b|winding[- ]up order (?:was|has been) made/i, db: untouched } },
]);
read('next step quoting a date', [
  { say: 'brackenridge couriers whats next', expect: { reply: said(12, 19), db: untouched } },
]);
read('follow-up with no company: who signed it', [
  { say: 'gullsworh dental any word from companies house', expect: { reply: /withdrawn|discontinued|cancel+ed|remain on the register|no longer/i, db: untouched } },
  { say: 'wait who signed it', expect: { reply: /Priya Lomax/i, db: untouched } },
]);

// ================= WRITES: the stage from the documents =================
write('page is behind: sort it previews, yes saves', [
  { say: 'halowdene page is behind, sort it', expect: { db: untouched } },
  { say: 'yes', expect: { db: onlyMoved('hallowdene print', stageIs('hallowdene print', 'hmrc_liq', 'winding_up_order')) } },
]);
write('a paper that only threatens a step changes nothing', [
  { say: 'brackenridge got a court letter saying they could wind them up, update it', expect: { reply: /may|could|not (?:yet|been made|made)|hearing|already|no change|nothing to change/i, db: untouched } },
  { say: 'yes', expect: { db: untouched } },
]);
write('Final Gazette: dissolving previews, yes closes', [
  { say: 'otery mill final gazette came thru, fix it', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('ottery mill foods'), stageIs('brackenridge couriers', 'hmrc_liq', 'petition'), statusIs('hallowdene print', 'liquidation')) } },
]);
write('question then "ok update it" on the company just discussed', [
  { say: 'wexcombe - does the paperwork say mvl or cvl', expect: { reply: /CVL|creditors'? voluntary/i, db: untouched } },
  { say: 'ok update it', expect: { db: untouched } },
  { say: 'yes', expect: { db: onlyMoved('wexcombe glazing', stageIs('wexcombe glazing', 'own_liq', 'cvl')) } },
]);
write('go through all of them and fix', [
  { say: 'go thru all the winding down ones n fix whatever the docs say', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    stageIs('hallowdene print', 'hmrc_liq', 'winding_up_order'),
    stageIs('wexcombe glazing', 'own_liq', 'cvl'),
    stageIs('gullsworth dental', 'strike_off_rejected'),
    closed('ottery mill foods'),
    stageIs('brackenridge couriers', 'hmrc_liq', 'petition'),
    statusIs('brackenridge couriers', 'liquidation'),
    liveIs('brackenridge couriers', 1),
  ) } },
]);

// ================= AUTO MODE: a dissolve still previews =================
write('auto mode: dissolving from the Final Gazette still previews', [
  { say: 'ottery mill foods page is behind the gazette, update it', expect: { db: untouched } },
  { say: 'yes', expect: { db: closed('ottery mill foods') } },
], true);
