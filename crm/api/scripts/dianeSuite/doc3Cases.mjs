/**
 * DOC FRESH 3, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Updating a winding down company's stage from its documents, and answering
 * from those documents. Five new companies, each made through the API with
 * its own deals, then put into winding down with real looking UK papers:
 *   Marlowe Joinery     page: HMRC liq, petition   doc: winding-up order MADE, Official Receiver appointed
 *   Thistle & Vane      page: HMRC liq, petition   doc: hearing notice, the court MAY make an order (page is right)
 *   Copperbeck Studios  page: Liquidation, no kind doc: liquidator's letter, CVL, Harriet Okonjo, creditors' decision date
 *   Fernhollow Bakery   page: Active proposal       docs: First Gazette, then Final Gazette (struck off and dissolved)
 *   Saltmarsh Logistics page: Active proposal       docs: First Gazette, then HMRC objection suspending the strike off
 * A preview first, only a yes saves; dissolving closes the company and stops
 * its deals, and previews first in auto mode too. Every write is db checked.
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
  return new RegExp(`\\b${day}(?:st|nd|rd|th)? ${m.slice(0, 3)}|\\b${m} ${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b`, 'i');
};

// ---------- the new companies and their deals ----------
const [thisYear, thisPart] = currentMonth().split('-').map(Number);
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthAt = (o) => ym(new Date(Date.UTC(thisYear, thisPart - 1 + o, 1)));
const daysInMonth = new Date(Date.UTC(thisYear, thisPart, 0)).getUTCDate();
const D = (o) => ({
  assignedOn: `${monthAt(-8)}-01`,
  paymentStartOn: `${monthAt(-7)}-01`,
  presetOn: `${monthAt(0)}-01`,
  endOn: `${monthAt(6)}-28`,
  payableDays: daysInMonth,
  currency: 'GBP',
  paymentMethod: 'bank',
  ...o,
});
const NEW_DEALS = [
  D({ personName: 'Rory Bexley', groupName: 'BAKER', company: 'Marlowe Joinery', roleLabel: 'Director', monthlyAmount: 2100 }),
  D({ personName: 'Esme Larkin', groupName: 'CORVID', company: 'Marlowe Joinery', roleLabel: 'Mid 1', monthlyAmount: 950 }),
  D({ personName: 'Dev Raines', groupName: 'OTTER', company: 'Thistle & Vane', roleLabel: 'Director', monthlyAmount: 1800 }),
  D({ personName: 'Lottie Crane', groupName: 'BAKER', company: 'Copperbeck Studios', roleLabel: 'Director', monthlyAmount: 2400 }),
  D({ personName: 'Hugo Penrith', groupName: 'CORVID', company: 'Copperbeck Studios', roleLabel: 'Graphics', monthlyAmount: 1250 }),
  D({ personName: 'Maisie Thorne', groupName: 'OTTER', company: 'Fernhollow Bakery', roleLabel: 'Director', monthlyAmount: 1600 }),
  D({ personName: 'Callum Reay', groupName: 'BAKER', company: 'Fernhollow Bakery', roleLabel: 'KP', monthlyAmount: 700 }),
  D({ personName: 'Priya Hale', groupName: 'CORVID', company: 'Saltmarsh Logistics', roleLabel: 'Director', monthlyAmount: 2600 }),
];
const MARLOWE = 'marlowe joinery';
const THISTLE = 'thistle & vane';
const COPPER = 'copperbeck studios';
const FERN = 'fernhollow bakery';
const SALT = 'saltmarsh logistics';
const PAGE = [MARLOWE, THISTLE, COPPER, FERN, SALT];

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
  const rel = `${row.id}/zzdoc3-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

// ---------- db checks ----------
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
/** One company's row exactly as seeded. */
const kept = (key) => async (db) => {
  const s = seedState.liq.find((r) => r.company_key === key);
  const r = await liq(db, key);
  for (const f of ['stage', 'stage_kind', 'next_action', 'owner', 'liquidator']) {
    if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${key} ${f} moved to ${r[f]}`;
  }
  if (String(r.deadline ?? '').slice(0, 10) !== String(s.deadline ?? '').slice(0, 10)) return `${key} deadline moved`;
  return null;
};
// NOTHING MOVED: every winding down row, every company status, every live deal as seeded.
const untouched = async (db) => {
  for (const s of seedState.liq) {
    const why = await kept(s.company_key)(db);
    if (why) return why;
  }
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved`;
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};
/** Only this company moved; the rest of the page is as seeded. */
const othersKept = (...moved) => async (db) => {
  for (const s of seedState.liq) {
    if (moved.includes(s.company_key)) continue;
    const why = await kept(s.company_key)(db);
    if (why) return why;
  }
  return null;
};

export async function extraSeed({ api, db }) {
  for (const d of NEW_DEALS) {
    const r = await api('POST', '/master-sheet', d);
    if (r.status !== 201) throw new Error(`doc3 seed ${d.personName}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const key of PAGE) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );
  await set(MARLOWE, { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(-9), next: 'Wait for the hearing outcome' });
  await set(THISTLE, { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(12), next: 'Pay HMRC or agree terms before the hearing' });
  await set(COPPER, { stage: 'liquidation', next: 'Find out which liquidator is acting' });
  await set(FERN, { stage: 'active_proposal', kind: 'compulsory', next: 'Wait for Companies House' });
  await set(SALT, { stage: 'active_proposal', kind: 'compulsory', next: 'Wait for Companies House' });

  // MARLOWE: the order has been MADE. The page still says petition.
  await putDoc(db, api, MARLOWE, 'Winding up order - Marlowe Joinery.pdf', pdf([
    'IN THE HIGH COURT OF JUSTICE, BUSINESS AND PROPERTY COURTS OF ENGLAND AND WALES',
    'INSOLVENCY AND COMPANIES LIST (ChD)   No. CR-2026-004417',
    'IN THE MATTER OF MARLOWE JOINERY LIMITED and IN THE MATTER OF THE INSOLVENCY ACT 1986',
    'WINDING-UP ORDER',
    `Upon the petition of the Commissioners for His Majesty's Revenue and Customs presented on ${longIn(-64)},`,
    `and upon hearing counsel for the petitioner on ${longIn(-9)}, no one attending for the company,`,
    'IT IS ORDERED that Marlowe Joinery Limited be wound up by this court under the provisions',
    'of the Insolvency Act 1986.',
    'The Official Receiver, Public Interest Unit, is appointed as liquidator of the company.',
    'The costs of the petition are to be paid out of the assets of the company.',
    `Dated ${longIn(-9)}.`,
  ]), 'application/pdf');

  // THISTLE & VANE: only a hearing notice. The court MAY make an order. The page is right.
  await putDoc(db, api, THISTLE, 'Notice of petition hearing.pdf', pdf([
    'THISTLE & VANE LIMITED  -  Company number 11873520',
    'NOTICE OF HEARING OF A WINDING-UP PETITION',
    `A petition to wind up the above company was presented on ${longIn(-21)} by the Commissioners`,
    "for His Majesty's Revenue and Customs, claiming to be a creditor of the company.",
    `The petition will be heard at the Royal Courts of Justice, 7 Rolls Building, London EC4A 1NL on ${longIn(12)} at 10:30am.`,
    'At that hearing the court may make a winding-up order against the company.',
    'Any person intending to appear must give notice to the petitioner by 4pm on the business day before.',
    'The company may avoid an order by paying the debt in full or agreeing terms with HMRC before the hearing.',
  ]), 'application/pdf');

  // COPPERBECK: a CVL, the liquidator named, a creditors' decision date.
  await putDoc(db, api, COPPER, 'Letter from liquidator.pdf', pdf([
    'Larchmont Recovery LLP, 14 Fenwick Street, Leeds LS1 4DY',
    `${longIn(-4)}`,
    'To all known creditors',
    'COPPERBECK STUDIOS LIMITED - IN CREDITORS\' VOLUNTARY LIQUIDATION',
    'Dear Sirs,',
    'The directors have resolved that the company cannot continue trading because of its liabilities',
    'and that it should be wound up by way of a creditors\' voluntary liquidation.',
    'The members have nominated Harriet Okonjo of Larchmont Recovery LLP as liquidator.',
    `A virtual meeting of creditors will be held by video link on ${longIn(16)} at 11:00am to confirm`,
    'the nomination of the liquidator and to consider forming a liquidation committee.',
    'Proofs of debt should be returned to this office before that meeting.',
    'Yours faithfully, Harriet Okonjo, Licensed Insolvency Practitioner',
  ]), 'application/pdf');

  // FERNHOLLOW: the First Gazette long ago, then the Final Gazette: struck off and dissolved.
  await putDoc(db, api, FERN, 'First Gazette notice.pdf', pdf([
    'THE GAZETTE - Companies House notice, Companies Act 2006 section 1000(3)',
    `Notice published ${longIn(-75)}`,
    'FERNHOLLOW BAKERY LTD  (Company number 10446291)',
    'The Registrar of Companies gives notice that, unless cause is shown to the contrary,',
    'at the expiration of 2 months from the above date the name of the above company will be',
    'struck off the register and the company will be dissolved.',
  ]), 'application/pdf');
  await putDoc(db, api, FERN, 'Final Gazette notice.pdf', pdf([
    'THE GAZETTE - Companies House notice, Companies Act 2006 section 1000(4)',
    `Notice published ${longIn(-5)}`,
    'FERNHOLLOW BAKERY LTD  (Company number 10446291)',
    'The Registrar of Companies gives notice that the above company has been struck off',
    'the register and is dissolved as from the date of this notice.',
  ]), 'application/pdf');

  // SALTMARSH: First Gazette, then HMRC objected and the strike off is suspended.
  await putDoc(db, api, SALT, 'First Gazette - Saltmarsh.pdf', pdf([
    'THE GAZETTE - Companies House notice, Companies Act 2006 section 1000(3)',
    `Notice published ${longIn(-30)}`,
    'SALTMARSH LOGISTICS LIMITED  (Company number 09328815)',
    'Unless cause is shown to the contrary, at the expiration of 2 months from the above date',
    'the name of the above company will be struck off the register and the company will be dissolved.',
  ]), 'application/pdf');
  await putDoc(db, api, SALT, 'Companies House letter - objection.pdf', pdf([
    'Companies House, Crown Way, Cardiff CF14 3UZ',
    `${longIn(-6)}`,
    'Re: SALTMARSH LOGISTICS LIMITED  09328815',
    'We have received an objection from HM Revenue & Customs to the company being struck off the register.',
    'HMRC state that the company has outstanding PAYE and VAT returns and liabilities.',
    'As a result the strike off action has been suspended for a period of 60 days while the matter is resolved.',
    'The company will not be struck off while the objection remains in place.',
  ]), 'application/pdf');

  for (let i = 0; i < 120; i += 1) {
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

const ORDERED = /winding.?up order (?:was |has been )?(?:made|granted)|ordered|been wound up|official receiver/i;

// ================= QUESTIONS: answered from the documents, nothing changes =================
read('doc is further on than the page, she says so', [
  { say: 'wheres marlowe at? hav a look at the docs', expect: { reply: new RegExp(`(?=[\\s\\S]*(?:${ORDERED.source}))(?=[\\s\\S]*(?:page|petition|update|change))`, 'i'), db: untouched } },
]);
read('is the page right, and it is', [
  { say: 'is the page right for thistle n vane or is it out of date', expect: { reply: /(?=[\s\S]*\b(?:yes|right|correct|matches|up to date|accurate|in line)\b)(?=[\s\S]*petition)/i, db: untouched } },
]);
read('the liquidator by name', [
  { say: 'whos the liquidator on copperbek', expect: { reply: /Harriet Okonjo/i, db: untouched } },
]);
read('next step with the date', [
  { say: 'whats next w thistle & vane, is there a date', expect: { reply: new RegExp(`(?=[\\s\\S]*hearing)(?=[\\s\\S]*(?:${said(12).source}))`, 'i'), db: untouched } },
]);
read('struck off yet? then why not', [
  { say: 'has saltmarsh been struck off yet', expect: { reply: /\bno\b|not (?:been |yet )?struck|suspended|on hold|objection/i, db: untouched } },
  { say: 'why not', expect: { reply: /HMRC|objection|object/i, db: untouched } },
]);

// ================= WRITES: a preview first, only a yes saves =================
write('update from the docs, a question in between', [
  { say: 'marlowe joinery - update it from the docs', expect: { db: untouched } },
  { say: 'wait who got appointed', expect: { reply: /official receiver/i, db: untouched } },
  { say: 'ok yes save it', expect: { db: all(stageIs(MARLOWE, 'hmrc_liq', 'winding_up_order'), stillWinding(MARLOWE), othersKept(MARLOWE)) } },
]);
write('a document that only threatens changes nothing', [
  { say: 'sort thistle and vane out from its paperwork pls', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(untouched, stageIs(THISTLE, 'hmrc_liq', 'petition')) } },
]);
write('fix it, CVL from the liquidator letter', [
  { say: 'copperbeck page is behind i think. fix it', expect: { db: untouched } },
  { say: 'yep', expect: { db: all(stageIs(COPPER, 'own_liq', 'cvl'), stillWinding(COPPER), othersKept(COPPER)) } },
]);
write('Final Gazette: dissolving closes the company, preview first', [
  { say: 'fernhollw docs are in, update the stage', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(dissolvedClosed(FERN), othersKept(FERN), stillWinding(SALT)) } },
]);
write('auto mode: dissolving still previews', [
  { say: 'sort fernhollow bakery from the docs', expect: { db: untouched } },
  { say: 'go ahead', expect: { db: all(dissolvedClosed(FERN), othersKept(FERN)) } },
], true);
write('typo, objection suspends the strike off', [
  { say: 'saltmarsh logistcs anything new in the paperwork? update the page if so', expect: { db: untouched } },
  { say: 'ok do it', expect: { db: all(stageIs(SALT, 'strike_off_suspended'), stillWinding(SALT), othersKept(SALT)) } },
]);
write('check everything and fix', [
  { say: 'go thru all the winding down docs n fix whatevers wrong on the page', expect: { db: untouched } },
  { say: 'yes all of it', expect: { db: all(
    stageIs(MARLOWE, 'hmrc_liq', 'winding_up_order'), stillWinding(MARLOWE),
    stageIs(COPPER, 'own_liq', 'cvl'), stillWinding(COPPER),
    stageIs(SALT, 'strike_off_suspended'), stillWinding(SALT),
    dissolvedClosed(FERN),
    kept(THISTLE), stillWinding(THISTLE),
  ) } },
]);
