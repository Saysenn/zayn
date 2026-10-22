/**
 * HELD OUT, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Winding down, closing, status, next steps from the documents and plain
 * company updates, said the way a busy admin really types. Quarry Lane
 * (HMRC petition, hearing notice on file), Pinecrest (CVL, liquidator's
 * letter on file) and Brightwell (strike off suspended) start winding down.
 * Ironleaf, Harbor Nine and Harbor Point (the look-alike) start active.
 * Every write is checked in the database.
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
/** "7 November 2026", n days from today. */
const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** Any fair way to say the day n days from today: "7 Nov", "7th November", "November 7", "07/11", "2026-11-07". */
const said = (n) => {
  const iso = isoIn(n);
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return `(?:\\b${day}(?:st|nd|rd|th)?(?: of)? ${m.slice(0, 3)}|\\b${m.slice(0, 3)}[a-z]* ${day}(?:st|nd|rd|th)?\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b|${iso})`;
};
const re = (...parts) => new RegExp(parts.join(''), 'i');

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
  const rel = `${row.id}/zzheld-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`;
  fs.mkdirSync(path.join(DOCS_ROOT, String(row.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, rel), buffer);
  const doc = (await db.query(
    'INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [row.id, name, rel, mime, buffer.length],
  )).rows[0];
  await api('POST', `/liquidations/${row.id}/docs/${doc.id}/read`);
}

const WINDING = ['quarry lane', 'pinecrest', 'brightwell'];
const liq = async (db, key) => (await db.query('SELECT *, deadline::text AS deadline_text FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const liveKept = (name) => async (db) => ((await live(db, name)) > 0 ? null : `${name} lost its live deals`);
const closed = (name) => all(statusIs(name, 'closed'), liveIs(name, 0));
const winding = (name) => all(statusIs(name, 'liquidation'), liveKept(name));
const fieldIs = (key, field, test) => async (db) => {
  const r = await liq(db, key);
  if (!r) return `${key} has no winding down record`;
  const v = field === 'deadline' ? r.deadline_text : r[field];
  const ok = test instanceof RegExp ? test.test(String(v ?? '')) : String(v ?? '') === String(test);
  return ok ? null : `${key} ${field} is ${v}`;
};
/** The page as seeded, minus the named fields of one company (those are checked on their own). */
const pageAsSeeded = (skip = {}) => async (db) => {
  for (const s of seedState.liq) {
    const r = (await db.query('SELECT *, deadline::text AS deadline_text FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    if (!r) return `${s.company_key} record gone`;
    for (const f of PAGE_FIELDS) {
      if ((skip[s.company_key] || []).includes(f)) continue;
      if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to ${r[f]}`;
    }
  }
  return null;
};
// NOTHING MOVED: the page, every company status and every live deal, as seeded.
const untouched = async (db) => {
  const page = await pageAsSeeded()(db);
  if (page) return page;
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved to ${await status(db, c.name.toLowerCase())}`;
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};
const PAGE_FIELDS = ['stage', 'stage_kind', 'next_action', 'liquidator', 'deadline_text'];
/** Every company status as seeded, except these companies. */
const statusesAsSeeded = (...names) => async (db) => {
  for (const c of seedState.status) {
    const key = c.name.toLowerCase();
    if (names.includes(key)) continue;
    if ((await status(db, key)) !== c.status) return `${c.name} status moved to ${await status(db, key)}`;
  }
  return null;
};
/** Everything as seeded except these companies (their status, deals and page row are checked on their own). */
const othersUntouched = (...names) => all(pageAsSeeded(Object.fromEntries(names.map((n) => [n, PAGE_FIELDS]))), statusesAsSeeded(...names));

export async function extraSeed({ api, db }) {
  // HARBOR POINT: a look-alike of Harbor Nine, active, one live deal.
  const today = currentDay();
  const [y, m] = today.split('-').map(Number);
  const ym = (off) => { const d = new Date(Date.UTC(y, m - 1 + off, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const made = await api('POST', '/master-sheet', {
    personName: 'Rhea Dunmore', groupName: 'OTTER', company: 'Harbor Point', roleLabel: 'Admin', monthlyAmount: 1800,
    assignedOn: `${ym(-6)}-01`, paymentStartOn: `${ym(-5)}-01`, presetOn: `${ym(0)}-01`, endOn: `${ym(8)}-28`,
    payableDays: new Date(Date.UTC(y, m, 0)).getUTCDate(), currency: 'GBP', paymentMethod: 'bank',
  });
  if (made.status !== 201) throw new Error(`heldout seed Harbor Point: ${made.status} ${JSON.stringify(made.body)}`);

  for (const key of WINDING) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const set = (key, f) => db.query(
    'UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE company_key = $1',
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? ''],
  );

  // QUARRY LANE: HMRC petition, hearing in 13 days. No liquidator yet.
  await set('quarry lane', { stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(5), next: 'Agree time to pay with HMRC before the hearing' });
  await putDoc(db, api, 'quarry lane', 'Notice of petition hearing.pdf', pdf([
    'IN THE HIGH COURT OF JUSTICE',
    'BUSINESS AND PROPERTY COURTS OF ENGLAND AND WALES',
    'INSOLVENCY AND COMPANIES LIST ChD    No. CR-2026-004417',
    'IN THE MATTER OF QUARRY LANE LIMITED AND IN THE MATTER OF THE INSOLVENCY ACT 1986',
    `A petition to wind up the above-named company was presented on ${longIn(-18)}`,
    'by the Commissioners for His Majesty\'s Revenue and Customs, claiming to be a creditor',
    'of the company in the sum of 48,213.66 pounds for unpaid PAYE, NIC and VAT.',
    `The petition will be heard at the Rolls Building, 7 Rolls Buildings, Fetter Lane, London EC4A 1NL`,
    `on ${longIn(13)} at 10.30 am.`,
    'Any person intending to appear on the hearing, whether to support or oppose it, must give',
    `notice of intention to do so to the petitioner or its solicitor by 4 pm on ${longIn(12)}.`,
    'If the company does not pay or secure the debt, the court may make a winding-up order.',
    'HMRC Solicitor\'s Office and Legal Services, Insolvency Litigation Team.',
  ]), 'application/pdf');

  // PINECREST: CVL, liquidator appointed, creditors decision in 9 days.
  await set('pinecrest', { stage: 'own_liq', kind: 'cvl', deadline: isoIn(10), next: "Return the director's questionnaire to the liquidator", liquidator: 'Marsh Whitlow Insolvency' });
  await putDoc(db, api, 'pinecrest', 'Letter from liquidator.pdf', pdf([
    'Marsh Whitlow Insolvency LLP, 4 Canal Wharf, Leeds LS11 5PS',
    'PINECREST LTD - IN CREDITORS\' VOLUNTARY LIQUIDATION',
    'Dear Director,',
    `I write to confirm that Daniel Okafor was appointed liquidator of the company on ${longIn(-4)}.`,
    'Under section 235 of the Insolvency Act 1986 you are required to co-operate with the liquidator.',
    `Please complete and return the enclosed director's questionnaire within 14 days of ${longIn(-4)},`,
    `that is by ${longIn(10)}, together with the company books, records and bank statements.`,
    `A virtual meeting of creditors will be held by video link on ${longIn(9)} at 11.00 am`,
    'to decide whether a liquidation committee should be formed and to approve the liquidator\'s fees.',
    'Creditors wishing to vote must lodge a proof of debt by 4 pm on the business day before.',
    'Yours faithfully, Daniel Okafor, Licensed Insolvency Practitioner, for Marsh Whitlow Insolvency LLP',
  ]), 'application/pdf');

  // BRIGHTWELL: strike off suspended after HMRC objected. No documents.
  await set('brightwell', { stage: 'strike_off_suspended', deadline: isoIn(3), next: 'File the overdue CT600 so HMRC withdraws its objection' });

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
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    // A company with no record until a case set its status is active again.
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    await db.query('UPDATE tb_mastersheet SET review_monthly = (id = ANY($1::int[]))', [seedState.reviewIds]);
    for (const r of seedState.liq) {
      await db.query('UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE id = $1',
        [r.id, r.stage, r.stage_kind, r.deadline_text, r.next_action, r.liquidator]);
    }
    await db.query('DELETE FROM tb_liquidations WHERE NOT (id = ANY($1::int[]))', [seedState.liq.map((r) => r.id)]);
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
// Harbor Nine closed for real before the case starts: status closed, every live deal stopped.
const closeHarborNine = {
  act: async ({ db, api }) => {
    await api('PATCH', `/companies/${encodeURIComponent('harbor nine')}`, { status: 'closed' });
    // Harbor Nine is only on its deals (no company row), so the UPDATE alone changed nothing.
    const done = await db.query("UPDATE tb_companies SET status = 'closed', closed_on = $1 WHERE lower(name) = 'harbor nine'", [currentDay()]);
    if (!done.rowCount) await db.query("INSERT INTO tb_companies (name, status, closed_on) VALUES ('Harbor Nine', 'closed', $1)", [currentDay()]);
    await db.query("UPDATE tb_mastersheet SET stopped_on = $1, stopped_reason = 'company_closed' WHERE lower(btrim(company)) = 'harbor nine' AND stopped_on IS NULL", [currentDay()]);
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

const ASKS = /\?|which|do you mean|did you mean|can you confirm|confirm|clarify/i;

// ================= NEXT STEPS FROM THE DOCUMENTS =================
read('next step for one, from the hearing notice', [
  { say: 'wats next for quarry lane', expect: { reply: re('(?=[\\s\\S]*', said(13), ')(?=[\\s\\S]*(?:hearing|court|petition))'), db: untouched } },
]);
read('next step, typo, from the liquidator letter', [
  { say: 'pincrest next step??', expect: { reply: re('(?=[\\s\\S]*(?:', said(9), '|', said(10), '))(?=[\\s\\S]*(?:questionnaire|creditors|meeting|liquidator))'), db: untouched } },
]);
read('next steps for all of them', [
  { say: 'ok can u run me thru what we gotta do next on all the ones winding down, like each one', expect: {
    reply: re('(?=[\\s\\S]*Quarry Lane)(?=[\\s\\S]*', said(13), ')(?=[\\s\\S]*Pinecrest)(?=[\\s\\S]*(?:', said(9), '|', said(10), '|questionnaire|creditors))(?=[\\s\\S]*Brightwell)'),
    noReply: /Ironleaf|Harbor Point/,
    db: untouched,
  } },
]);
read('what do we need to do this week', [
  { say: 'what do we need to do this week on the closures', expect: { reply: /(?=[\s\S]*Brightwell[\s\S]*(?:CT600|HMRC|objection))(?=[\s\S]*Quarry Lane)/i, db: untouched } },
]);
read('deadlines coming up', [
  { say: 'any deadlines coming up i shud know about for the liquidations', expect: { reply: re('(?=[\\s\\S]*Brightwell)(?=[\\s\\S]*', said(3), ')(?=[\\s\\S]*Quarry Lane)(?=[\\s\\S]*', said(5), ')'), db: untouched } },
]);
read('liquidator from the page, then the other one', [
  { say: 'whos the liquidator on pinecrest again', expect: { reply: /Marsh Whitlow|Okafor/i, db: untouched } },
  { say: 'and quarry lane?', expect: { reply: /no liquidator|not (?:yet )?(?:been )?(?:appointed|set|named|recorded|listed)|none|no one|nobody|blank|isn'?t one|hasn'?t|no .{0,20}liquidator|petition|hearing/i, noReply: /Marsh Whitlow|Okafor/i, db: untouched } },
]);
read('status of an active company', [
  { say: 'hows ironleaf, is it closing or wat', expect: { reply: /\bno\b|not (?:winding|closing|being)|active|trading|still running|isn'?t/i, db: untouched } },
]);
read('follow up by person', [
  { say: 'where are we with nell ardens company', expect: { reply: /Quarry Lane[\s\S]*(?:HMRC|petition|hearing|winding)/i, db: untouched } },
  { say: 'what about theo brandts one', expect: { reply: /Brightwell[\s\S]*(?:strike|struck|suspend|objection|CT600)/i, db: untouched } },
]);

// ================= PLAIN UPDATES ON THE PAGE =================
write('change a deadline', [
  { say: `brightwell deadline needs moving to ${longIn(14).toLowerCase()} hmrc gave us more time` },
  { say: 'yes', expect: { db: all(fieldIs('brightwell', 'deadline', isoIn(14)), pageAsSeeded({ brightwell: ['deadline_text'] }), statusesAsSeeded()) } },
]);
write('change the liquidator', [
  { say: 'quarry lane got a liquidator now its fenwick rowe, appointed yday' },
  { say: 'yes', expect: { db: all(fieldIs('quarry lane', 'liquidator', /Fenwick Rowe/i), pageAsSeeded({ 'quarry lane': ['liquidator'] }), statusesAsSeeded()) } },
]);
write('change next action, voice note', [
  { say: 'ok so um for pinecrest the next thing isnt the questionnaire anymore we sent that, its actually chasing the bank for the closing statements so put that as the next thing to do yeah' },
  { say: 'yes', expect: { db: all(fieldIs('pinecrest', 'next_action', /(?=.*bank)(?=.*statement)/i), pageAsSeeded({ pinecrest: ['next_action'] }), statusesAsSeeded()) } },
]);

// ================= CLOSE AND WIND DOWN =================
write('wind one down and close another in one breath', [
  { say: 'put ironleaf into winding down n close off pinecrest while ur at it', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(winding('ironleaf'), closed('pinecrest'), othersUntouched('ironleaf', 'pinecrest')) } },
]);
write('close, then a no', [
  { say: 'close brightwell', expect: { db: untouched } },
  { say: 'no leave it for now', expect: { db: untouched } },
]);
write('close, corrected, then yes', [
  { say: 'close quarry lane', expect: { db: untouched } },
  { say: 'wait no not quarry lane, pinecrest', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('pinecrest'), winding('quarry lane'), othersUntouched('pinecrest')) } },
]);
write('mixed ask: a question and a close', [
  { say: 'whos pinecrests liquidator, and also close brightwell', expect: { reply: /Marsh Whitlow|Okafor/i, db: untouched } },
  { say: 'yes', expect: { db: all(closed('brightwell'), othersUntouched('brightwell')) } },
]);
write('closed company status, then reopen', [
  closeHarborNine,
  { say: 'is harbor nine still going', expect: { reply: /closed/i, db: closed('harbor nine') } },
  { say: 'bring it back, they got a new contract', expect: { db: closed('harbor nine') } },
  { say: 'yes', expect: { db: all(statusIs('harbor nine', 'active'), liveIs('harbor nine', 3), othersUntouched('harbor nine')) } },
]);
write('unknown company', [
  { say: 'close fernhill pls', expect: { reply: /(?:can'?t|cannot|couldn'?t|don'?t|do not|didn'?t) (?:find|see|know|have)|no (?:company|record|match)|not (?:on|in|found)|which company|\?/i, db: untouched } },
]);

// ================= AUTO MODE =================
write('auto mode: look-alike names must ask', [
  { say: 'wind down harbor', expect: { reply: re('(?=[\\s\\S]*Harbor Nine)(?=[\\s\\S]*Harbor Point)'), db: untouched } },
], true);
write('auto mode: single wind down saves', [
  { say: 'harbour nine is going under, wind it down', expect: { db: all(winding('harbor nine'), statusIs('harbor point', 'active'), othersUntouched('harbor nine')) } },
], true);
write('auto mode: a close still previews', [
  { say: 'close off quarry lane now pls', expect: { db: untouched } },
  { say: 'go ahead', expect: { db: all(closed('quarry lane'), othersUntouched('quarry lane')) } },
], true);
write('auto mode: undo asks first', [
  { say: 'wind down ironleaf', expect: { db: winding('ironleaf') } },
  { say: 'undo that', expect: { reply: ASKS, db: winding('ironleaf') } },
  { say: 'yes', expect: { db: untouched } },
], true);
write('auto mode: two companies preview', [
  { say: 'wind down ironleaf and harbor nine', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(winding('ironleaf'), winding('harbor nine'), othersUntouched('ironleaf', 'harbor nine')) } },
], true);
